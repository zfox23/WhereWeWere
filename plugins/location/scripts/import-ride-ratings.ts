// ============================================================================
// One-off importer for a hand-maintained ride-ratings CSV (columns:
//   Ride Name, Park, Rating).
//
// Injects the rating into the associated EXISTING venue row(s) and assigns
// the "Amusement Ride" category to each modified venue.
//
// Usage (from server/):
//   npm run import:ride-ratings -- --dry-run        # preview: read-only, no writes
//   npm run import:ride-ratings                     # apply, using the default CSV
//   npm run import:ride-ratings -- --dry-run /path  # preview a different CSV
//   npm run import:ride-ratings -- /path/to.csv     # apply, with a different CSV
//
// Docker / production:
//   The compiled script ships inside the server image and is meant to be run
//   from the host via the wrapper:
//     ./scripts/run-import-ride-ratings.sh --dry-run /app/data/rides.csv
//     ./scripts/run-import-ride-ratings.sh /app/data/rides.csv
//   The CSV path is resolved INSIDE the container, so it must be reachable
//   there. The server container mounts ./data/server -> /app/data, so drop the
//   CSV in ./data/server/ on the host and pass its in-container path
//   (e.g. /app/data/My Amusement Park Rides - Ride Ratings.csv).
//
// Behavior:
//   - Only existing venues are modified. Rides with no matching venue are
//     reported as "no existing venue" — nothing is created.
//   - Matching: normalized-name match (NFKC + lowercase + trim + whitespace
//     collapse + straight-quote normalization), with a punctuation-insensitive
//     fallback key. The database holds duplicate venue rows per place (no
//     parent hierarchy on rides), so when a name matches venues at exactly
//     ONE distinct location (city + country) ALL of those rows are updated
//     to keep the duplicates consistent. A name matching multiple distinct
//     locations is disambiguated using the Park column ("… Sandusky, OH" →
//     city hint, "… Japan" → country hint); if it cannot be resolved, the
//     row is reported as ambiguous and skipped.
//   - Rating: the CSV uses a 0.5-step scale (e.g. 3.5) but venues.rating is
//     a SMALLINT CHECK (1..4), so values are rounded to whole stars
//     (3.5 → 4). Non-numeric or out-of-range values skip the row.
//   - Category: the "Amusement Ride" venue_categories row is looked up
//     (created only on a real run) and set on every modified venue.
//   - Idempotent: re-running only touches venues whose rating or category
//     actually differs; already-correct venues are reported as no-change.
//
// A backup is recommended before the first real run (Settings → backup
// export, or pg_dump).
// ============================================================================

import fs from 'fs';
import os from 'os';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { pool } from '../../../server/src/db';

const DEFAULT_CSV = path.join(
  'D:',
  'Downloads',
  'My Amusement Park Rides - Ride Ratings.csv'
);

/** Category assigned to every modified venue (created if missing). */
const RIDE_CATEGORY = 'Amusement Ride';

// ============================================================================
// CSV parsing
// ============================================================================

interface RideCsvRow {
  line: number;
  rideName: string;
  park: string | null;
  rawRating: string | null;
  /** Whole-star rating (1-4) after rounding, or null when invalid/absent. */
  rating: number | null;
  ratingNote: string | null;
}

function cleanStr(value: unknown): string | null {
  if (value == null) return null;
  const str = String(value).trim();
  return str === '' ? null : str;
}

export function parseRidesCsv(csv: string): RideCsvRow[] {
  const records = parse<Record<string, string>, Record<string, string>>(csv, {
    columns: true,
    bom: true,
    relax_column_count: true,
    skip_empty_lines: true,
  });

  return records.map((rec, idx) => {
    const rideName = cleanStr(rec['Ride Name']);
    if (!rideName) {
      throw new Error(`Line ${idx + 2}: missing Ride Name`);
    }

    const rawRating = cleanStr(rec['Rating']);
    let rating: number | null = null;
    let ratingNote: string | null = null;
    if (rawRating != null) {
      const value = Number(rawRating);
      if (!Number.isFinite(value) || value < 0) {
        ratingNote = `invalid rating "${rawRating}" — row skipped`;
      } else if (value < 1 || value > 4) {
        ratingNote = `rating ${value} outside 1-4 — row skipped`;
      } else {
        rating = Math.round(value);
        if (value !== rating) {
          ratingNote = `rating ${value} → ${rating} (rounded to whole star)`;
        }
      }
    } else {
      ratingNote = 'no rating — row skipped';
    }

    return {
      line: idx + 2,
      rideName,
      park: cleanStr(rec['Park']),
      rawRating,
      rating,
      ratingNote,
    };
  });
}

// ============================================================================
// Name normalization & local DB state
// ============================================================================

/** NFKC + lowercase + straight quotes + collapsed whitespace. */
export function normalizeName(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u2018\u2019\u201a\u02bc]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Punctuation-insensitive key (last-resort match fallback). */
export function looseKey(name: string): string {
  return normalizeName(name).replace(/[^a-z0-9]+/g, '');
}

interface LocalVenue {
  id: string;
  name: string;
  city: string | null;
  country: string | null;
  rating: number | null;
  category_id: string | null;
}

/**
 * Load all venues into memory, indexed by normalized name (exact key first,
 * loose key as fallback) — no per-row lookups.
 */
async function loadVenues(): Promise<{
  byExact: Map<string, LocalVenue[]>;
  byLoose: Map<string, LocalVenue[]>;
}> {
  const res = await pool.query<LocalVenue>(
    'SELECT id, name, city, country, rating, category_id FROM venues'
  );

  const byExact = new Map<string, LocalVenue[]>();
  const byLoose = new Map<string, LocalVenue[]>();
  const push = (map: Map<string, LocalVenue[]>, key: string, v: LocalVenue) => {
    const list = map.get(key);
    if (list) list.push(v);
    else map.set(key, [v]);
  };

  for (const v of res.rows) {
    push(byExact, normalizeName(v.name), v);
    push(byLoose, looseKey(v.name), v);
  }
  return { byExact, byLoose };
}

// ============================================================================
// Matching
// ============================================================================

interface ParkHint {
  city: string | null;
  country: string | null;
}

/**
 * Derive a location hint from a Park value:
 *   "Cedar Point, Sandusky, OH"   → city  = "sandusky"
 *   "Fuji-Q Highland, Japan"      → country = "japan"
 */
function parkHint(park: string | null): ParkHint {
  if (!park) return { city: null, country: null };
  const tokens = park.split(',').map((t) => t.trim()).filter(Boolean);
  if (tokens.length >= 3) {
    return { city: normalizeName(tokens[tokens.length - 2]), country: null };
  }
  if (tokens.length === 2) {
    return { city: null, country: normalizeName(tokens[1]) };
  }
  return { city: null, country: null };
}

type MatchResult =
  | { status: 'matched'; venues: LocalVenue[] }
  | { status: 'not_found' }
  | { status: 'ambiguous'; locations: string[] };

function locationLabel(v: LocalVenue): string {
  const parts = [v.city, v.country].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : 'unknown location';
}

/**
 * Match a CSV ride against existing venues. All rows at one distinct location
 * are treated as duplicates of the same venue and all get the update; names
 * spanning multiple locations need the Park hint to disambiguate.
 */
function matchVenues(
  row: RideCsvRow,
  byExact: Map<string, LocalVenue[]>,
  byLoose: Map<string, LocalVenue[]>
): MatchResult {
  const candidates =
    byExact.get(normalizeName(row.rideName)) ??
    byLoose.get(looseKey(row.rideName)) ??
    [];
  if (candidates.length === 0) return { status: 'not_found' };

  const groups = new Map<string, LocalVenue[]>();
  for (const v of candidates) {
    const key = `${(v.city ?? '').toLowerCase()}|${(v.country ?? '').toLowerCase()}`;
    const list = groups.get(key);
    if (list) list.push(v);
    else groups.set(key, [v]);
  }

  if (groups.size === 1) {
    return { status: 'matched', venues: [...groups.values()][0] };
  }

  const hint = parkHint(row.park);
  const hinted: LocalVenue[][] = [];
  for (const [key, venues] of groups) {
    const [city, country] = key.split('|');
    if ((hint.city && city === hint.city) || (hint.country && country === hint.country)) {
      hinted.push(venues);
    }
  }
  if (hinted.length === 1) {
    return { status: 'matched', venues: hinted[0] };
  }

  const locations = [...groups.values()].map((vs) => locationLabel(vs[0]));
  return { status: 'ambiguous', locations };
}

// ============================================================================
// Category
// ============================================================================

async function findCategoryId(): Promise<string | null> {
  const res = await pool.query('SELECT id FROM venue_categories WHERE name = $1', [
    RIDE_CATEGORY,
  ]);
  return (res.rows[0]?.id as string | undefined) ?? null;
}

async function ensureCategoryId(client: {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
}): Promise<string> {
  const res = await client.query('SELECT id FROM venue_categories WHERE name = $1', [
    RIDE_CATEGORY,
  ]);
  if (res.rows.length > 0) return res.rows[0].id as string;
  const ins = await client.query('INSERT INTO venue_categories (name) VALUES ($1) RETURNING id', [
    RIDE_CATEGORY,
  ]);
  return ins.rows[0].id as string;
}

// ============================================================================
// Dry run (read-only)
// ============================================================================

interface DryRunCounts {
  venuesWouldUpdate: number;
  venuesNoChange: number;
  rowsNotFound: number;
  rowsAmbiguous: number;
  rowsSkipped: number;
}

async function runDryRun(rows: RideCsvRow[]): Promise<DryRunCounts> {
  const { byExact, byLoose } = await loadVenues();
  const existingCategoryId = await findCategoryId();

  console.log('');
  console.log('=== DRY RUN — no writes will be made ===');
  console.log(
    `Category "${RIDE_CATEGORY}": ${existingCategoryId ? 'already exists' : 'would be created'}`
  );
  console.log('');

  const counts: DryRunCounts = {
    venuesWouldUpdate: 0,
    venuesNoChange: 0,
    rowsNotFound: 0,
    rowsAmbiguous: 0,
    rowsSkipped: 0,
  };

  for (const row of rows) {
    if (row.rating == null) {
      console.log(`  ✗ line ${row.line}: ${row.rideName} — ${row.ratingNote}`);
      counts.rowsSkipped++;
      continue;
    }

    const match = matchVenues(row, byExact, byLoose);
    if (match.status === 'not_found') {
      console.log(`  ✗ line ${row.line}: ${row.rideName} — no existing venue`);
      counts.rowsNotFound++;
      continue;
    }
    if (match.status === 'ambiguous') {
      console.log(
        `  ✗ line ${row.line}: ${row.rideName} — ambiguous across: ${match.locations.join(' | ')}`
      );
      counts.rowsAmbiguous++;
      continue;
    }

    const note = row.ratingNote ? `  (${row.ratingNote})` : '';
    for (const v of match.venues) {
      const ratingPart =
        v.rating == null ? `rating none → ${row.rating}`
        : v.rating === row.rating ? `rating already ${v.rating}`
        : `rating ${v.rating} → ${row.rating}`;
      // When the category doesn't exist yet it will be created on the real
      // run, so every venue gains the category (a change) — don't rely on
      // null === null for the "already" comparison.
      const hasCategory = existingCategoryId != null && v.category_id === existingCategoryId;
      const catPart =
        hasCategory ? `category already "${RIDE_CATEGORY}"` : `category → "${RIDE_CATEGORY}"`;
      const wouldChange = v.rating !== row.rating || !hasCategory;
      if (wouldChange) counts.venuesWouldUpdate++;
      else counts.venuesNoChange++;

      console.log(
        `  ${wouldChange ? '✓' : '·'} line ${row.line}: ${row.rideName} → "${v.name}" (${locationLabel(v)}) [${v.id}]  ${ratingPart};  ${catPart}${note}`
      );
    }
  }

  console.log('');
  console.log('=== DRY RUN SUMMARY ===');
  console.log(`  venues to update:      ${counts.venuesWouldUpdate}`);
  console.log(`  venues already correct: ${counts.venuesNoChange}`);
  console.log(`  rows, no existing venue: ${counts.rowsNotFound}`);
  console.log(`  rows ambiguous:          ${counts.rowsAmbiguous}`);
  console.log(`  rows skipped (rating):   ${counts.rowsSkipped}`);
  return counts;
}

// ============================================================================
// Real import
// ============================================================================

interface ImportStats {
  venuesUpdated: number;
  venuesNoChange: number;
  rowsNotFound: number;
  rowsAmbiguous: number;
  rowsSkipped: number;
  categoryCreated: boolean;
}

async function runImport(rows: RideCsvRow[]): Promise<ImportStats> {
  const { byExact, byLoose } = await loadVenues();

  // Pre-resolve every row against the in-memory snapshot.
  interface PlannedRow {
    row: RideCsvRow;
    venueIds: string[];
    changedIds: string[]; // only computed once the category id is known
    venues: LocalVenue[];
  }
  const planned: PlannedRow[] = [];
  const stats: ImportStats = {
    venuesUpdated: 0,
    venuesNoChange: 0,
    rowsNotFound: 0,
    rowsAmbiguous: 0,
    rowsSkipped: 0,
    categoryCreated: false,
  };

  for (const row of rows) {
    if (row.rating == null) {
      console.log(`  ✗ line ${row.line}: ${row.rideName} — ${row.ratingNote}`);
      stats.rowsSkipped++;
      continue;
    }
    const match = matchVenues(row, byExact, byLoose);
    if (match.status === 'not_found') {
      console.log(`  ✗ line ${row.line}: ${row.rideName} — no existing venue`);
      stats.rowsNotFound++;
      continue;
    }
    if (match.status === 'ambiguous') {
      console.log(
        `  ✗ line ${row.line}: ${row.rideName} — ambiguous across: ${match.locations.join(' | ')}`
      );
      stats.rowsAmbiguous++;
      continue;
    }
    planned.push({
      row,
      venueIds: match.venues.map((v) => v.id),
      changedIds: [],
      venues: match.venues,
    });
  }

  if (planned.length === 0) {
    console.log('');
    console.log('Nothing to update — no rows matched an existing venue.');
    return stats;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const beforeCategory = await (async () => {
      const res = await client.query('SELECT id FROM venue_categories WHERE name = $1', [
        RIDE_CATEGORY,
      ]);
      return (res.rows[0]?.id as string | undefined) ?? null;
    })();
    const categoryId = await ensureCategoryId(client);
    stats.categoryCreated = beforeCategory == null;

    for (const item of planned) {
      // Only touch venues whose rating or category actually differs
      // (keeps re-runs a no-op and avoids bumping updated_at).
      item.changedIds = item.venues
        .filter((v) => v.rating !== item.row.rating || v.category_id !== categoryId)
        .map((v) => v.id);

      const note = item.row.ratingNote ? `  (${item.row.ratingNote})` : '';
      for (const v of item.venues) {
        const ratingPart =
          v.rating == null ? `rating none → ${item.row.rating}`
          : v.rating === item.row.rating ? `rating already ${v.rating}`
          : `rating ${v.rating} → ${item.row.rating}`;
        const catPart =
          v.category_id === categoryId
            ? `category already "${RIDE_CATEGORY}"`
            : `category → "${RIDE_CATEGORY}"`;
        const changed = v.rating !== item.row.rating || v.category_id !== categoryId;
        if (changed) stats.venuesUpdated++;
        else stats.venuesNoChange++;

        console.log(
          `  ${changed ? '✓' : '·'} line ${item.row.line}: ${item.row.rideName} → "${v.name}" (${locationLabel(v)}) [${v.id}]  ${ratingPart};  ${catPart}${note}`
        );
      }
    }

    // Per-row ratings: a row's rating applies to its own venues only, so run
    // one update per row (id list already filtered to venues that change).
    for (const item of planned) {
      if (item.changedIds.length === 0) continue;
      await client.query(
        `UPDATE venues
         SET rating = $1,
             category_id = $2,
             updated_at = NOW()
         WHERE id = ANY($3::uuid[])`,
        [item.row.rating, categoryId, item.changedIds]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return stats;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const csvPath = args.find((a) => !a.startsWith('--')) ?? DEFAULT_CSV;

  const resolved = path.isAbsolute(csvPath) ? csvPath : path.resolve(process.cwd(), csvPath);
  if (!fs.existsSync(resolved)) {
    console.error(`CSV not found: ${resolved}`);
    process.exit(1);
  }
  const csv = fs.readFileSync(resolved, 'utf-8');

  let rows: RideCsvRow[];
  try {
    rows = parseRidesCsv(csv);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to parse CSV: ${message}`);
    process.exit(1);
  }
  console.log(`Parsed ${rows.length} ride rows from ${resolved}`);

  if (dryRun) {
    await runDryRun(rows);
  } else {
    console.log(`Applying ride ratings (category "${RIDE_CATEGORY}")…`);
    console.log('');
    const stats = await runImport(rows);
    console.log('');
    console.log('=== IMPORT COMPLETE ===');
    console.log(`  venues updated:            ${stats.venuesUpdated}`);
    console.log(`  venues already correct:    ${stats.venuesNoChange}`);
    console.log(`  category created:          ${stats.categoryCreated ? 'yes' : 'no (already existed)'}`);
    console.log(`  rows, no existing venue:   ${stats.rowsNotFound}`);
    console.log(`  rows ambiguous:            ${stats.rowsAmbiguous}`);
    console.log(`  rows skipped (rating):     ${stats.rowsSkipped}`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error('Ride rating import failed:', err);
  process.exit(1);
});
