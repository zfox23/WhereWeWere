// ============================================================================
// One-off importer for a hand-maintained ride-log CSV (columns:
//   Date, Ride Name, Park, Count, Rode With, Comments).
//
// Injects the rides into the location check-in history: for each row it finds
// or creates check-ins on the listed date at the named ride venue, associates
// the companions from "Rode With", adds the comment where appropriate, and
// categorizes the venue as "Amusement Ride".
//
// Usage (from server/):
//   npm run import:ride-log -- --dry-run           # preview: read-only, no writes
//   npm run import:ride-log                        # apply, using the default CSV
//   npm run import:ride-log -- --dry-run /path     # preview a different CSV
//   npm run import:ride-log -- /path/to.csv        # apply, with a different CSV
//
// Docker / production:
//   The compiled script ships inside the server image and is meant to be run
//   from the host via the wrapper:
//     ./scripts/run-import-ride-log.sh --dry-run /app/data/rides.csv
//     ./scripts/run-import-ride-log.sh /app/data/rides.csv
//   The CSV path is resolved INSIDE the container, so it must be reachable
//   there. The server container mounts ./data/server -> /app/data, so drop
//   the CSV in ./data/server/ on the host and pass its in-container path.
//
// Behavior:
//   - A "checkin match" for a row = an existing check-in on that date
//     (venue-local date: checked_in_at AT TIME ZONE COALESCE(checkin_timezone,
//     'UTC')) at a venue whose name matches the Ride Name.
//   - Name matching is normalized (NFKC + lowercase + straight quotes +
//     whitespace collapse + leading/trailing standalone "The" stripped), with
//     a punctuation-insensitive fallback key. "Beast" matches "The Beast";
//     "King's Island" matches "Kings Island"; "Takabisha" matches
//     "Takabisha (高飛車)".
//   - The database holds duplicate venue rows per place. All rows with the
//     matched name are treated as one venue: check-ins at any duplicate row
//     count toward the row's total, category updates touch all duplicates,
//     and new check-ins attach to the canonical row (most check-ins, tie:
//     earliest id). A name matching multiple distinct locations is
//     disambiguated using the Park column; if it cannot be resolved the row
//     is reported as ambiguous and skipped.
//   - Cases per row:
//       A: enough existing matched check-ins  -> categorize + companions on
//          each matched check-in + comment on the earliest matched check-in
//          that has no notes (skip if all already have notes).
//       B: some but not enough existing matched check-ins -> case A, plus
//          create the missing check-ins at 5-minute intervals immediately
//          after the last existing matched check-in (with companions).
//       D: no matched check-ins on the date, but the venue exists by name ->
//          categorize + create Count check-ins at NOON on the date (venue-
//          local), first one gets the comment, companions on each.
//       C: no matched check-ins and the venue does not exist -> create the
//          venue (name = Ride Name, coordinates from the park venue, Nominatim
//          geocode as fallback) with the "Amusement Ride" category, then
//          create Count check-ins at NOON on the date.
//     New check-ins get checkin_timezone = the venue's IANA timezone
//     (inferred from coordinates via geo-tz), so "noon" is venue-local noon.
//   - "Rode With": comma-separated names; "--" and blanks mean none.
//   - Rows with a placeholder ride name (starting with "*") or a missing /
//     invalid Count (or invalid Date) are skipped and reported.
//   - Idempotent: a second run finds every ride already at its Count on its
//     date, falls into case A, and changes nothing (companions insert with
//     ON CONFLICT DO NOTHING; notes are only added when empty; no check-ins
//     are created when the total already reaches Count).
//
// A backup is recommended before the first real run (Settings page has a full
// backup export, or pg_dump).
// ============================================================================

import fs from 'fs';
import os from 'os';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { pool } from '../../../server/src/db';
import {
  insertCompanions,
  normalizeCompanions,
} from '../../../server/src/services/companions';
import { getVenueTimezone } from '../services/geoTimezone';
import { searchPlacesByName } from '../services/nominatim';
import { DEFAULT_USER_ID as USER_ID } from '../../../server/src/constants';

const DEFAULT_CSV = path.join(
  os.homedir(),
  'Downloads',
  'My Amusement Park Rides - Ride Log.csv'
);

/** Category assigned to every ride venue (created if missing). */
const RIDE_CATEGORY = 'Amusement Ride';
/** Gap between check-ins created in case B, in minutes. */
const EXTRA_CHECKIN_GAP_MINUTES = 5;

// ============================================================================
// CSV parsing
// ============================================================================

interface RideLogRow {
  line: number;
  date: string | null;
  rideName: string;
  park: string | null;
  count: number | null;
  companions: string[];
  comment: string | null;
  skipReason: string | null;
}

function cleanStr(value: unknown): string | null {
  if (value == null) return null;
  const str = String(value).trim();
  return str === '' ? null : str;
}

function parseCompanions(raw: string | null): string[] {
  if (!raw) return [];
  const parts = raw.split(',').map((p) => p.trim()).filter((p) => p !== '' && p !== '--');
  return normalizeCompanions(parts);
}

export function parseRideLogCsv(csv: string): RideLogRow[] {
  const records = parse<Record<string, string>, Record<string, string>>(csv, {
    columns: true,
    bom: true,
    relax_column_count: true,
    skip_empty_lines: true,
  });

  return records.map((rec, idx) => {
    const rideName = cleanStr(rec['Ride Name']) ?? '';
    const date = cleanStr(rec['Date']);
    const park = cleanStr(rec['Park']);
    const rawCount = cleanStr(rec['Count']);
    const comment = cleanStr(rec['Comments']);

    let skipReason: string | null = null;
    if (!rideName) {
      skipReason = 'missing Ride Name';
    } else if (rideName.startsWith('*')) {
      skipReason = 'placeholder ride name';
    } else if (rawCount == null || !Number.isInteger(Number(rawCount)) || Number(rawCount) < 1) {
      skipReason = `missing or invalid Count "${rawCount ?? ''}"`;
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) {
      skipReason = `missing or invalid Date "${date ?? ''}"`;
    }

    return {
      line: idx + 2,
      date,
      rideName,
      park,
      count: skipReason ? null : Number(rawCount),
      companions: skipReason ? [] : parseCompanions(cleanStr(rec['Rode With'])),
      comment: skipReason ? null : comment,
      skipReason,
    };
  });
}

// ============================================================================
// Name normalization & local DB state
// ============================================================================

/** NFKC + lowercase + straight quotes + collapsed whitespace + strip a
 *  leading or trailing standalone "the" (word boundary). */
export function normalizeName(name: string): string {
  let n = name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u2018\u2019\u201a\u02bc]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  n = n.replace(/^the\s+/, '').replace(/\s+the$/, '').trim();
  return n;
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
  latitude: string | number | null;
  longitude: string | number | null;
  category_id: string | null;
  checkin_count: number;
}

interface LocalCheckin {
  id: string;
  venue_id: string;
  venue_name: string;
  notes: string | null;
  checked_in_at: string;
  local_date: string;
}

interface VenueIndex {
  byExact: Map<string, LocalVenue[]>;
  byLoose: Map<string, LocalVenue[]>;
}

/**
 * Load all venues into memory (indexed by normalized name) plus per-venue
 * check-in counts — no per-row lookups.
 */
async function loadVenues(): Promise<VenueIndex> {
  const [venuesRes, countsRes] = await Promise.all([
    pool.query<LocalVenue>(
      'SELECT id, name, city, country, latitude, longitude, category_id FROM venues'
    ),
    pool.query<{ venue_id: string; n: string }>(
      'SELECT venue_id, COUNT(*)::text AS n FROM checkins GROUP BY venue_id'
    ),
  ]);

  const counts = new Map<string, number>();
  for (const row of countsRes.rows) counts.set(row.venue_id, Number(row.n));

  const byExact = new Map<string, LocalVenue[]>();
  const byLoose = new Map<string, LocalVenue[]>();
  const push = (map: Map<string, LocalVenue[]>, key: string, v: LocalVenue) => {
    const list = map.get(key);
    if (list) list.push(v);
    else map.set(key, [v]);
  };

  for (const v of venuesRes.rows) {
    v.checkin_count = counts.get(v.id) ?? 0;
    push(byExact, normalizeName(v.name), v);
    push(byLoose, looseKey(v.name), v);
  }
  return { byExact, byLoose };
}

/** Load every check-in on any of the given venue-local dates, oldest first. */
async function loadCheckinsForDates(dates: string[]): Promise<Map<string, LocalCheckin[]>> {
  if (dates.length === 0) return new Map();
  const res = await pool.query<LocalCheckin>(
    `SELECT c.id, c.venue_id, v.name AS venue_name, c.notes, c.checked_in_at,
            (c.checked_in_at AT TIME ZONE COALESCE(c.checkin_timezone, 'UTC'))::date::text AS local_date
     FROM checkins c
     JOIN venues v ON v.id = c.venue_id
     WHERE (c.checked_in_at AT TIME ZONE COALESCE(c.checkin_timezone, 'UTC'))::date = ANY($1::date[])
     ORDER BY c.checked_in_at, c.id`,
    [dates]
  );

  const byDate = new Map<string, LocalCheckin[]>();
  for (const row of res.rows) {
    const list = byDate.get(row.local_date);
    if (list) list.push(row);
    else byDate.set(row.local_date, [row]);
  }
  return byDate;
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

function locationLabel(v: LocalVenue): string {
  const parts = [v.city, v.country].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : 'unknown location';
}

type VenueMatch =
  | { status: 'matched'; venues: LocalVenue[] }
  | { status: 'not_found' }
  | { status: 'ambiguous'; locations: string[] };

/**
 * Match a ride name against venues. Duplicate rows at one distinct location
 * are one venue; names spanning multiple locations need the Park hint.
 */
function matchVenue(
  rideName: string,
  park: string | null,
  index: VenueIndex
): VenueMatch {
  const candidates =
    index.byExact.get(normalizeName(rideName)) ??
    index.byLoose.get(looseKey(rideName)) ??
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

  const hint = parkHint(park);
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

/** The duplicate row new check-ins attach to: most check-ins, then lowest id. */
function pickCanonicalVenue(venues: LocalVenue[]): LocalVenue {
  return [...venues].sort(
    (a, b) => b.checkin_count - a.checkin_count || a.id.localeCompare(b.id)
  )[0];
}

/**
 * Find the park venue (for new-ride coordinates). The park name is the Park
 * value minus the trailing location tokens (city + state for 3+ tokens, the
 * country for 2 — mirroring parkHint), so "New York, New York, Las Vegas, NV"
 * yields the park name "New York, New York", not the city "New York".
 * Matching: normalized name → loose key → loose-key prefix (so "Fuji-Q
 * Highland" finds "Fuji-Q Highland (富士急ハイランド)" and "New York, New
 * York" finds "New York-New York Hotel & Casino"). When several candidates
 * remain, prefer the one matching the Park hint's city/country, then the one
 * with the most check-ins.
 */
function findParkVenue(park: string | null, index: VenueIndex): LocalVenue | null {
  if (!park) return null;
  const tokens = park.split(',').map((t) => t.trim()).filter(Boolean);
  const nameTokens =
    tokens.length >= 3 ? tokens.slice(0, -2) : tokens.slice(0, -1);
  const parkName = (nameTokens.length > 0 ? nameTokens : tokens).join(', ');
  const key = normalizeName(parkName);
  const loose = looseKey(parkName);
  const hint = parkHint(park);

  const candidates: LocalVenue[] = [];
  const seen = new Set<string>();
  const add = (v: LocalVenue) => {
    if (!seen.has(v.id)) {
      seen.add(v.id);
      candidates.push(v);
    }
  };
  for (const v of index.byExact.get(key) ?? []) add(v);
  for (const v of index.byLoose.get(loose) ?? []) add(v);

  if (candidates.length === 0) {
    for (const list of index.byLoose.values()) {
      for (const v of list) {
        if (looseKey(v.name).startsWith(loose)) add(v);
      }
    }
  }
  if (candidates.length === 0) return null;

  const locMatches = (v: LocalVenue): boolean => {
    const city = (v.city ?? '').toLowerCase();
    const country = (v.country ?? '').toLowerCase();
    return Boolean((hint.city && city === hint.city) || (hint.country && country === hint.country));
  };
  return [...candidates].sort(
    (a, b) =>
      Number(locMatches(b)) - Number(locMatches(a)) ||
      b.checkin_count - a.checkin_count ||
      a.id.localeCompare(b.id)
  )[0];
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

type TxClient = {
  query: (
    text: string,
    params?: unknown[]
  ) => Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }>;
};

async function ensureCategoryId(client: TxClient): Promise<string> {
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
// Row planning (shared by dry run and real import)
// ============================================================================

type RowCase = 'A' | 'B' | 'C' | 'D';

interface NewCheckinSpec {
  /** 'noon' = venue-local noon on the date; else a fixed ISO instant. */
  time: { kind: 'noon' } | { kind: 'instant'; iso: string };
  /** Whether this new check-in receives the row's comment. */
  comment: boolean;
}

interface RowPlan {
  row: RideLogRow;
  case: RowCase;
  /** All duplicate rows of the matched venue (cases A/B/D); empty for C. */
  venues: LocalVenue[];
  /** Canonical venue new check-ins attach to; null for case C (created). */
  canonicalVenue: LocalVenue | null;
  /** Existing check-in ids that receive companions. */
  companionCheckinIds: string[];
  /** Existing check-in that receives the comment (cases A/B); null otherwise. */
  commentCheckinId: string | null;
  commentText: string | null;
  newCheckins: NewCheckinSpec[];
  /** Case C: the park venue whose coordinates the new ride inherits. */
  parkForCoords: LocalVenue | null;
  needsGeocode: boolean;
}

type PlanResult = RowPlan | { row: RideLogRow; error: string };

interface ProcessContext {
  index: VenueIndex;
  checkinsByDate: Map<string, LocalCheckin[]>;
  /** Venue key (canonical id or 'new:<name>') → date → check-ins created
   *  earlier in this run, so repeated rows for the same venue+date see them. */
  createdCounts: Map<string, Map<string, number>>;
}

function bumpCreated(ctx: ProcessContext, venueKey: string, date: string, n: number) {
  const byDate = ctx.createdCounts.get(venueKey) ?? new Map<string, number>();
  byDate.set(date, (byDate.get(date) ?? 0) + n);
  ctx.createdCounts.set(venueKey, byDate);
}

function createdSoFar(ctx: ProcessContext, venueKey: string, date: string): number {
  return ctx.createdCounts.get(venueKey)?.get(date) ?? 0;
}

function hasNotes(notes: string | null): boolean {
  return notes != null && notes.trim() !== '';
}

/**
 * Decide the case for a row and build the full plan. Mutates
 * ctx.createdCounts so later rows for the same venue+date account for
 * check-ins created earlier in this run.
 */
function planRow(row: RideLogRow, ctx: ProcessContext): PlanResult {
  if (row.skipReason) return { row, error: row.skipReason };

  const date = row.date!;
  const count = row.count!;
  const match = matchVenue(row.rideName, row.park, ctx.index);

  if (match.status === 'ambiguous') {
    return { row, error: `ambiguous across: ${match.locations.join(' | ')}` };
  }

  if (match.status === 'not_found') {
    // Case C — no checkin match and the venue does not exist.
    const park = findParkVenue(row.park, ctx.index);
    const venueKey = `new:${normalizeName(row.rideName)}`;
    const alreadyCreated = createdSoFar(ctx, venueKey, date);
    const toCreate = count - alreadyCreated;
    const newCheckins: NewCheckinSpec[] = [];
    for (let i = 0; i < toCreate; i++) {
      newCheckins.push({ time: { kind: 'noon' }, comment: i === 0 && alreadyCreated === 0 });
    }
    bumpCreated(ctx, venueKey, date, toCreate);
    return {
      row,
      case: 'C',
      venues: [],
      canonicalVenue: null,
      companionCheckinIds: [],
      commentCheckinId: null,
      commentText: row.comment,
      newCheckins,
      parkForCoords: park,
      needsGeocode: park == null,
    };
  }

  // The venue exists. Match its check-ins on the date (any duplicate row).
  const venueIds = new Set(match.venues.map((v) => v.id));
  const matched = (ctx.checkinsByDate.get(date) ?? []).filter((c) => venueIds.has(c.venue_id));
  const canonical = pickCanonicalVenue(match.venues);
  const created = createdSoFar(ctx, canonical.id, date);
  const total = matched.length + created;
  const commentTarget = matched.find((c) => !hasNotes(c.notes)) ?? null;
  const base: Omit<RowPlan, 'case' | 'newCheckins' | 'companionCheckinIds'> = {
    row,
    venues: match.venues,
    canonicalVenue: canonical,
    commentCheckinId: commentTarget?.id ?? null,
    commentText: row.comment,
    parkForCoords: null,
    needsGeocode: false,
  };

  if (total >= count) {
    // Case A — enough existing check-ins.
    return {
      ...base,
      case: 'A',
      companionCheckinIds: matched.map((c) => c.id),
      newCheckins: [],
    };
  }

  const toCreate = count - total;
  if (matched.length === 0) {
    // Case D — no check-in match on the date, venue exists by name.
    const newCheckins: NewCheckinSpec[] = [];
    for (let i = 0; i < toCreate; i++) {
      newCheckins.push({ time: { kind: 'noon' }, comment: i === 0 && created === 0 });
    }
    bumpCreated(ctx, canonical.id, date, toCreate);
    return {
      ...base,
      case: 'D',
      companionCheckinIds: [],
      newCheckins,
    };
  }

  // Case B — some existing check-ins, create the shortfall right after the
  // last matched check-in at fixed gaps.
  const newCheckins: NewCheckinSpec[] = [];
  const lastAt = matched[matched.length - 1].checked_in_at;
  const baseTime = new Date(lastAt).getTime();
  for (let i = 0; i < toCreate; i++) {
    newCheckins.push({
      time: {
        kind: 'instant',
        iso: new Date(baseTime + (i + 1) * EXTRA_CHECKIN_GAP_MINUTES * 60_000).toISOString(),
      },
      comment: false,
    });
  }
  bumpCreated(ctx, canonical.id, date, toCreate);
  return {
    ...base,
    case: 'B',
    companionCheckinIds: matched.map((c) => c.id),
    newCheckins,
  };
}

// ============================================================================
// Execution
// ============================================================================

function fmtInstant(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

interface Stats {
  rowsSkipped: number;
  caseA: number;
  caseB: number;
  caseC: number;
  caseD: number;
  checkinsCreated: number;
  venuesCreated: number;
  venuesCategorized: number;
  companionsCheckins: number;
  commentsAdded: number;
  geocoded: number;
}

function emptyStats(): Stats {
  return {
    rowsSkipped: 0,
    caseA: 0,
    caseB: 0,
    caseC: 0,
    caseD: 0,
    checkinsCreated: 0,
    venuesCreated: 0,
    venuesCategorized: 0,
    companionsCheckins: 0,
    commentsAdded: 0,
    geocoded: 0,
  };
}

function summarizeStats(stats: Stats, title: string) {
  console.log('');
  console.log(`=== ${title} ===`);
  console.log(`  case A (enough check-ins):      ${stats.caseA}`);
  console.log(`  case B (created extras):        ${stats.caseB}`);
  console.log(`  case C (created venue + rides): ${stats.caseC}`);
  console.log(`  case D (existing venue):        ${stats.caseD}`);
  console.log(`  check-ins created:              ${stats.checkinsCreated}`);
  console.log(`  venues created:                 ${stats.venuesCreated}`);
  console.log(`  venue rows categorized:         ${stats.venuesCategorized}`);
  console.log(`  check-ins receiving companions: ${stats.companionsCheckins}`);
  console.log(`  comments added:                 ${stats.commentsAdded}`);
  if (stats.geocoded > 0) {
    console.log(`  park geocodes performed:        ${stats.geocoded}`);
  }
  console.log(`  rows skipped:                   ${stats.rowsSkipped}`);
}

function logRowDetail(plan: RowPlan, dry: boolean) {
  const { row } = plan;
  const will = dry ? 'would' : 'did';

  const venueDesc =
    plan.case === 'C'
      ? plan.parkForCoords
        ? `venue NOT FOUND → create "${row.rideName}" (coords from park "${plan.parkForCoords.name}")`
        : `venue NOT FOUND → create "${row.rideName}" (geocode "${row.park ?? '—'}" via Nominatim)`
      : `venue "${plan.venues[0].name}" (${locationLabel(plan.venues[0])})`;

  console.log(`  ✓ line ${row.line}: ${row.rideName} (${row.date}) — case ${plan.case}: ${venueDesc}`);
  if (plan.case !== 'C') {
    console.log(
      `      category → "${RIDE_CATEGORY}" (${plan.venues.length} duplicate row${plan.venues.length > 1 ? 's' : ''})`
    );
  }

  const existingWithCompanions = plan.companionCheckinIds.length;
  const compTotal = existingWithCompanions + plan.newCheckins.length;
  if (row.companions.length > 0 && compTotal > 0) {
    console.log(
      `      companions [${row.companions.join(', ')}] → ${compTotal} check-in${compTotal > 1 ? 's' : ''}${existingWithCompanions > 0 ? ` (${existingWithCompanions} existing` : ''}${plan.newCheckins.length > 0 ? `, ${plan.newCheckins.length} new)` : ')'}`
    );
  }

  for (const nc of plan.newCheckins) {
    const t = nc.time;
    const when = t.kind === 'noon' ? `${row.date} at 12:00 venue-local` : `${fmtInstant(t.iso)} local`;
    console.log(`      ${will} create check-in at ${when}${nc.comment ? ' (gets comment)' : ''}`);
  }

  const commentTargetExisting = (plan.case === 'A' || plan.case === 'B') && plan.commentText != null;
  if (commentTargetExisting) {
    if (plan.commentCheckinId) {
      const c = plan.commentText!;
      console.log(`      comment → existing check-in [${plan.commentCheckinId}]: "${c.slice(0, 60)}${c.length > 60 ? '…' : ''}"`);
    } else {
      console.log('      comment: skipped (all matched check-ins already have notes)');
    }
  } else if (plan.case === 'C' || plan.case === 'D') {
    if (plan.commentText && plan.newCheckins.some((nc) => nc.comment)) {
      const c = plan.commentText;
      console.log(`      comment → first new check-in: "${c.slice(0, 60)}${c.length > 60 ? '…' : ''}"`);
    }
  }
}

// ============================================================================
// Dry run (read-only)
// ============================================================================

async function runDryRun(rows: RideLogRow[]): Promise<Stats> {
  const dates = [...new Set(rows.map((r) => r.date).filter((d): d is string => d != null))].sort();
  const [index, checkinsByDate, existingCategoryId] = await Promise.all([
    loadVenues(),
    loadCheckinsForDates(dates),
    findCategoryId(),
  ]);

  console.log('');
  console.log('=== DRY RUN — no writes will be made ===');
  console.log(
    `Category "${RIDE_CATEGORY}": ${existingCategoryId ? 'already exists' : 'would be created'}`
  );
  console.log('');

  const ctx: ProcessContext = { index, checkinsByDate, createdCounts: new Map() };
  const stats = emptyStats();

  for (const row of rows) {
    const plan = planRow(row, ctx);
    if ('error' in plan) {
      console.log(`  ✗ line ${row.line}: ${row.rideName} (${row.date ?? '?'}) — skipped (${plan.error})`);
      stats.rowsSkipped++;
      continue;
    }

    stats[`case${plan.case}`]++;
    stats.checkinsCreated += plan.newCheckins.length;
    stats.companionsCheckins += plan.companionCheckinIds.length + plan.newCheckins.length;
    if (plan.case === 'C') {
      stats.venuesCreated += 1;
      if (plan.needsGeocode) stats.geocoded += 1;
    } else {
      stats.venuesCategorized += plan.venues.length;
    }
    const willComment =
      plan.commentText != null &&
      (plan.commentCheckinId != null ||
        (plan.case === 'C' || plan.case === 'D') ||
        plan.newCheckins.some((nc) => nc.comment));
    if (willComment) stats.commentsAdded += 1;

    logRowDetail(plan, true);
  }

  summarizeStats(stats, 'DRY RUN SUMMARY');
  return stats;
}

// ============================================================================
// Import (single transaction)
// ============================================================================

async function runImport(rows: RideLogRow[]): Promise<Stats> {
  const dates = [...new Set(rows.map((r) => r.date).filter((d): d is string => d != null))].sort();
  const [index, checkinsByDate] = await Promise.all([
    loadVenues(),
    loadCheckinsForDates(dates),
  ]);

  const ctx: ProcessContext = { index, checkinsByDate, createdCounts: new Map() };
  const plans: RowPlan[] = [];
  let skipped = 0;

  for (const row of rows) {
    const plan = planRow(row, ctx);
    if ('error' in plan) {
      console.log(`  ✗ line ${row.line}: ${row.rideName} (${row.date ?? '?'}) — skipped (${plan.error})`);
      skipped++;
      continue;
    }
    plans.push(plan);
  }

  const stats = emptyStats();
  stats.rowsSkipped = skipped;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const categoryId = await ensureCategoryId(client);

    for (const plan of plans) {
      const { row } = plan;
      stats[`case${plan.case}`]++;

      let canonicalVenue: LocalVenue;
      let canonicalVenueId: string;

      if (plan.case === 'C') {
        // Resolve coordinates: park venue first, Nominatim geocode as fallback.
        let latitude: number | null = null;
        let longitude: number | null = null;
        if (plan.parkForCoords) {
          latitude = Number(plan.parkForCoords.latitude);
          longitude = Number(plan.parkForCoords.longitude);
        }
        if (latitude == null || longitude == null) {
          const results = await searchPlacesByName(row.park ?? row.rideName, 3);
          const pick = results.find(
            (r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude)
          );
          if (pick) {
            latitude = pick.latitude;
            longitude = pick.longitude;
            stats.geocoded += 1;
          }
        }
        if (latitude == null || longitude == null) {
          throw new Error(
            `line ${row.line}: no coordinates for "${row.rideName}" (park "${row.park ?? '—'}" not found and geocode failed)`
          );
        }
        const ins = await client.query(
          `INSERT INTO venues (name, category_id, latitude, longitude)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [row.rideName, categoryId, latitude, longitude]
        );
        const newVenueId = ins.rows[0].id as string;
        stats.venuesCreated += 1;
        canonicalVenue = {
          id: newVenueId,
          name: row.rideName,
          city: null,
          country: null,
          latitude,
          longitude,
          category_id: categoryId,
          checkin_count: 0,
        };
        canonicalVenueId = newVenueId;
      } else {
        canonicalVenue = plan.canonicalVenue!;
        canonicalVenueId = canonicalVenue.id;
        const uncategorized = plan.venues
          .filter((v) => v.category_id !== categoryId)
          .map((v) => v.id);
        if (uncategorized.length > 0) {
          await client.query(
            'UPDATE venues SET category_id = $1, updated_at = NOW() WHERE id = ANY($2::uuid[])',
            [categoryId, uncategorized]
          );
          stats.venuesCategorized += uncategorized.length;
        }
      }

      // Venue-local timezone for new check-ins (fallback 'UTC').
      const tz = getVenueTimezone(canonicalVenue.latitude, canonicalVenue.longitude) ?? 'UTC';

      // Cases A/B: comment goes on an EXISTING check-in (only if it has none).
      if ((plan.case === 'A' || plan.case === 'B') && plan.commentText && plan.commentCheckinId) {
        const res = await client.query(
          `UPDATE checkins
           SET notes = $2, updated_at = NOW()
           WHERE id = $1 AND (notes IS NULL OR TRIM(notes) = '')`,
          [plan.commentCheckinId, plan.commentText]
        );
        if ((res.rowCount ?? 0) > 0) stats.commentsAdded += 1;
      }

      // Companions on existing matched check-ins (idempotent).
      if (row.companions.length > 0 && plan.companionCheckinIds.length > 0) {
        for (const checkinId of plan.companionCheckinIds) {
          await insertCompanions('location', checkinId, row.companions, client);
        }
        stats.companionsCheckins += plan.companionCheckinIds.length;
      }

      // New check-ins (cases B/C/D).
      for (const nc of plan.newCheckins) {
        const comment = nc.comment ? (plan.commentText ?? null) : null;
        const checkinRes =
          nc.time.kind === 'noon'
            ? await client.query(
                `INSERT INTO checkins (user_id, venue_id, notes, checked_in_at, checkin_timezone)
                 VALUES ($1, $2, $3,
                         TO_TIMESTAMP($4 || ' 12:00:00', 'YYYY-MM-DD HH24:MI:SS') AT TIME ZONE $5,
                         $5)
                 RETURNING id, checked_in_at`,
                [USER_ID, canonicalVenueId, comment, row.date, tz]
              )
            : await client.query(
                `INSERT INTO checkins (user_id, venue_id, notes, checked_in_at, checkin_timezone)
                 VALUES ($1, $2, $3, $4::timestamptz, $5)
                 RETURNING id, checked_in_at`,
                [USER_ID, canonicalVenueId, comment, nc.time.iso, tz]
              );
        const newCheckinId = checkinRes.rows[0].id as string;
        const newCheckedInAt = checkinRes.rows[0].checked_in_at as string;
        stats.checkinsCreated += 1;
        if (nc.comment && comment != null) stats.commentsAdded += 1;
        if (row.companions.length > 0) {
          await insertCompanions('location', newCheckinId, row.companions, client);
          stats.companionsCheckins += 1;
        }

        // Refresh the local-date snapshot so a later row for the same
        // venue+date counts the check-in just created.
        const day = ctx.checkinsByDate.get(row.date!) ?? [];
        day.push({
          id: newCheckinId,
          venue_id: canonicalVenueId,
          venue_name: row.rideName,
          notes: comment,
          checked_in_at: newCheckedInAt,
          local_date: row.date!,
        });
        ctx.checkinsByDate.set(row.date!, day);
      }

      logRowDetail(plan, false);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
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

  let rows: RideLogRow[];
  try {
    rows = parseRideLogCsv(csv);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to parse CSV: ${message}`);
    process.exit(1);
  }
  console.log(`Parsed ${rows.length} ride log rows from ${resolved}`);

  if (dryRun) {
    await runDryRun(rows);
  } else {
    console.log(`Importing ride log (category "${RIDE_CATEGORY}")…`);
    console.log('');
    const stats = await runImport(rows);
    summarizeStats(stats, 'IMPORT COMPLETE');
  }

  await pool.end();
}

main().catch((err) => {
  console.error('Ride log import failed:', err);
  process.exit(1);
});
