import { Router, Request, Response } from 'express';
import type { CheckinTypeServer, PluginLlmHook } from 'wwp-shared';
import { allPlugins, pluginTimestampBranches } from '../plugins/registry';
import sharp from 'sharp';
import { query } from '../db';
import {
  callLlm,
  condenseLifeData,
  finalCharBudget,
  getLlmSettings,
  type LlmSettings,
  type LlmContentPart,
} from '../services/llmClient';
import { buildChronologicalEntries } from '../services/llmCompaction';
import {
  addDays,
  currentMonthRange,
  pickRandomTop,
  randomMacroWindow,
  randomSample,
  scoreWindows,
  ymOf,
  type CandidateWindow,
} from '../services/postcard';

const router = Router();

import { DEFAULT_USER_ID as USER_ID } from '../constants';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Cap on how many candidate images we return to the client.
const CANDIDATE_IMAGE_LIMIT = 200;
// Cap on how many images we forward to the LLM per request.
const MAX_LLM_IMAGES = 10;
// Conservative vision-token reserve per 1024px image, so text data is always
// prioritized over photos when the context window is small.
const IMAGE_TOKEN_RESERVE = 1200;

function validateDateRange(from: unknown, to: unknown): { ok: true } | { ok: false; error: string } {
  if (typeof from !== 'string' || typeof to !== 'string' || !DATE_RE.test(from) || !DATE_RE.test(to)) {
    return { ok: false, error: 'from and to must be dates in YYYY-MM-DD format' };
  }
  if (from > to) {
    return { ok: false, error: 'from must be on or before to' };
  }
  return { ok: true };
}

interface PluginLlmRow {
  checked_in_at: string;
  timezone: string | null;
  data: Record<string, unknown>;
}

interface LlmPluginEntry {
  plugin: CheckinTypeServer;
  hook: PluginLlmHook;
}

/** Plugins that contribute to the LLM life summary. */
function allLlmPlugins(): LlmPluginEntry[] {
  return allPlugins()
    .map((plugin) => ({ plugin, hook: plugin.server.llm }))
    .filter((entry): entry is LlmPluginEntry => entry.hook !== null && entry.hook !== undefined);
}

/** Gather ALL check-ins in the period as one flat chronological entry list. */
async function gatherLifeData(from: string, to: string) {
  const llmPlugins = allLlmPlugins();
  // Every check-in type (location, mood, sleep, tracks, ...) contributes via
  // its llm hook (gather + toLines).
  const pluginRowsList = await Promise.all(
    llmPlugins.map(({ plugin, hook }) => hook.gather(USER_ID, from, to).catch((err: unknown) => {
      console.error(`Plugin "${plugin.id}" llm.gather failed:`, err);
      return [];
    }))
  );

  const sources = llmPlugins.map(({ hook }, i) => ({
    label: hook.label,
    rows: (pluginRowsList[i] ?? []) as PluginLlmRow[],
    hook,
  }));

  const { entries, totals } = await buildChronologicalEntries(sources);
  return { entries, totals, hasAnyData: entries.length > 0 };
}

// Convert an image buffer to JPEG so it always matches the format vision
// models (and vLLM) expect, regardless of Immich's source encoding.
// Returns null when the buffer isn't a decodable image (e.g. HEIC/HEIF).
async function toJpegBase64(buffer: Buffer): Promise<string | null> {
  try {
    const jpeg = await sharp(buffer, { failOn: 'error' }).rotate().jpeg({ quality: 85 }).toBuffer();
    return jpeg.toString('base64');
  } catch {
    return null;
  }
}

const SYSTEM_PROMPT = `You are a thoughtful life-journal analyst. The user provides their personal activity data (location check-ins, mood check-ins, fitness tracks, sleep data) for a specific time period, plus a selection of photos from that period.

Write a useful, actionable summary of the user's life during this period. Your summary should include:
- Key milestones and significant events you can identify from the data
- Patterns worth noting (recurring places, mood trends, activity or sleep habits)
- Reflections on what the period tells you about the user's life
- 2-4 concrete, actionable suggestions for the future based on the patterns you see

Be specific — reference actual places, dates, moods, and activities from the data rather than speaking in generalities. Be warm but honest. Use markdown headings and short sections. Keep it focused: aim for something a person can read in a few minutes.`;

/** Human-readable per-type counts, e.g. "location check-ins: 512, mood: 300". */
function formatCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([label, n]) => `${label}: ${n}`)
    .join(', ');
}

// Fetch the requested Immich images as content parts (text data always
// prioritized over photos). Returns the parts plus include/skip counters.
async function fetchImageParts(
  llm: LlmSettings,
  imageIds: string[]
): Promise<{ parts: LlmContentPart[]; included: number; skipped: number }> {
  const parts: LlmContentPart[] = [];
  let included = 0;
  let skipped = 0;
  if (!llm.image_support || imageIds.length === 0) return { parts, included, skipped };

  const immichResult = await query(
    'SELECT immich_url, immich_api_key FROM user_settings WHERE user_id = $1',
    [USER_ID]
  );
  const immichRow = immichResult.rows[0];
  if (!immichRow?.immich_url || !immichRow?.immich_api_key) {
    return { parts, included: 0, skipped: imageIds.length };
  }
  const immichUrl = String(immichRow.immich_url).replace(/\/+$/, '');

  const imageResults = await Promise.all(
    imageIds.map(async (assetId) => {
      try {
        // Use the 1024px preview rather than the full-resolution original:
        // vision models don't need more, and it keeps the payload small.
        const imgRes = await fetch(
          `${immichUrl}/api/assets/${assetId}/thumbnail?size=preview`,
          {
            headers: {
              'x-api-key': String(immichRow.immich_api_key),
              Accept: 'image/jpeg',
            },
          }
        );
        if (!imgRes.ok) return null;
        const buffer = Buffer.from(await imgRes.arrayBuffer());
        const data = await toJpegBase64(buffer);
        if (!data) {
          console.warn(
            `LLM summarize: skipping Immich asset ${assetId} — not a decodable image ` +
              `(content-type: ${imgRes.headers.get('content-type') || 'unknown'})`
          );
          return null;
        }
        return { contentType: 'image/jpeg', data };
      } catch {
        return null;
      }
    })
  );

  for (const img of imageResults) {
    if (!img) {
      skipped += 1;
      continue;
    }
    parts.push({
      type: 'image_url',
      image_url: { url: `data:${img.contentType};base64,${img.data}` },
    });
    included += 1;
  }
  return { parts, included, skipped };
}

// GET /candidate-images?from=&to= - Immich images taken within the date range
router.get('/candidate-images', async (req: Request, res: Response) => {
  try {
    const { from, to } = req.query;
    const range = validateDateRange(from, to);
    if (!range.ok) return res.status(400).json({ error: range.error });

    const settingsResult = await query(
      'SELECT immich_url, immich_api_key FROM user_settings WHERE user_id = $1',
      [USER_ID]
    );
    const row = settingsResult.rows[0];
    if (!row?.immich_url || !row?.immich_api_key) {
      return res.json({ assets: [] });
    }
    const immichUrl = String(row.immich_url).replace(/\/+$/, '');
    const immichApiKey = String(row.immich_api_key);

    const response = await fetch(`${immichUrl}/api/search/metadata`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': immichApiKey },
      body: JSON.stringify({
        takenAfter: `${from}T00:00:00.000Z`,
        takenBefore: `${to}T23:59:59.999Z`,
        type: 'IMAGE',
        size: CANDIDATE_IMAGE_LIMIT,
        order: 'asc',
      }),
    });

    if (!response.ok) {
      console.error('Immich candidate image search failed:', response.status, await response.text());
      return res.json({ assets: [] });
    }

    const data = await response.json() as {
      assets?: { items?: { id: string; thumbhash: string | null; originalFileName: string; localDateTime: string }[] };
    };

    const assets = (data.assets?.items || []).map((a) => ({
      id: a.id,
      thumbhash: a.thumbhash,
      originalFileName: a.originalFileName,
      localDateTime: a.localDateTime,
    }));

    res.json({ assets });
  } catch (err) {
    console.error('Error fetching candidate images:', err);
    res.status(500).json({ error: 'Failed to fetch candidate images' });
  }
});

// POST /summarize - summarize a time period via the configured LLM.
//
// Strategy: ALL check-ins in the period always contribute. When the full
// dataset fits the context budget, a single LLM call receives it verbatim.
// Otherwise, the data is split into contiguous chronological chunks, each
// chunk is condensed (digested) by the LLM in parallel (map phase), and the
// digests are merged (reduce phase). If the digests themselves still exceed
// the budget, they are re-chunked and re-digested (recursive reduce).
router.post('/summarize', async (req: Request, res: Response) => {
  try {
    const { from, to, image_asset_ids } = req.body as {
      from?: string;
      to?: string;
      image_asset_ids?: string[];
    };

    const range = validateDateRange(from, to);
    if (!range.ok) return res.status(400).json({ error: range.error });
    const fromStr = from as string;
    const toStr = to as string;

    const llm = await getLlmSettings(USER_ID);
    if (!llm) {
      return res.status(400).json({ error: 'LLM integration is not configured. Set an API URL and model name in Settings → Integrations.' });
    }

    const imageIds = Array.isArray(image_asset_ids)
      ? image_asset_ids.filter((id): id is string => typeof id === 'string').slice(0, MAX_LLM_IMAGES)
      : [];

    const data = await gatherLifeData(fromStr, toStr);
    if (!data.hasAnyData && imageIds.length === 0) {
      return res.status(400).json({ error: 'No data found for the selected period.' });
    }

    // --- Text budget: data is always prioritized over images ---
    const imageTokenReserve =
      llm.image_support && imageIds.length > 0
        ? Math.min(imageIds.length, MAX_LLM_IMAGES) * IMAGE_TOKEN_RESERVE
        : 0;
    const finalBudget = finalCharBudget(llm, imageTokenReserve);

    // --- Condense: single call when it fits, else map-reduce ---
    const condensed = await condenseLifeData(llm, data.entries, finalBudget);
    const dataText = condensed.text;
    const mode = condensed.mode;
    const chunks = condensed.chunks;
    const digestLevels = condensed.digest_levels;
    if (mode === 'map-reduce') {
      console.log(`LLM summarize: condensation done — ${chunks} digest(s), ${digestLevels} reduction level(s).`);
    }

    // --- Fetch images (if supported and requested) ---
    const imageResult = await fetchImageParts(llm, imageIds);
    const contentParts: LlmContentPart[] = [...imageResult.parts];

    const countsLine = formatCounts(data.totals) ? `\nTotal check-ins in the period — ${formatCounts(data.totals)}.` : '';
    const digestNote =
      mode === 'map-reduce'
        ? ' Because the period is large, the data below is a condensed digest of ALL check-ins in the period (every check-in is represented, but dense/short-lived entries may be summarized rather than listed individually).'
        : '';
    const header =
      `Summarize my life from ${fromStr} to ${toStr}. Below is my activity data from WhereWeWere during that period.` +
      countsLine +
      digestNote +
      (imageResult.included > 0
        ? ` I have also included ${imageResult.included} photo${imageResult.included === 1 ? '' : 's'} taken during this period — describe them where relevant and use them to ground your reflections.`
        : '') +
      '\n\n' +
      dataText;

    contentParts.push({ type: 'text', text: header });

    let summary: string;
    try {
      summary = await callLlm(llm, SYSTEM_PROMPT, contentParts, Math.min(Math.floor(llm.context_window * 0.2), 16384));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate summary';
      return res.status(502).json({ error: message });
    }

    res.json({
      summary,
      images_included: imageResult.included,
      images_skipped: imageResult.skipped,
      mode,
      chunks,
      digest_levels: digestLevels,
      // Kept for backward compatibility with older clients; always empty now
      // since no data is ever sampled away.
      skipped: [] as { type: string; total: number; included: number }[],
    });
  } catch (err) {
    console.error('Error summarizing life period:', err);
    res.status(500).json({ error: 'Failed to generate summary' });
  }
});

// --- Postcard From Your Past ----------------------------------------------

interface PostcardImage {
  id: string;
  originalFileName: string;
  localDateTime: string;
}

interface PostcardPayload {
  id?: string;
  from: string;
  to: string;
  addressed_to: string;
  sender_line: string;
  stamp_city: string | null;
  images: PostcardImage[];
  message: string;
  counts: Record<string, number>;
  created_at?: string;
}

const POSTCARD_SYSTEM_PROMPT = `You are writing the back of a postcard, as a warm and thoughtful version of the user from the past. The user provides their personal activity data (location check-ins, mood check-ins, fitness tracks, sleep, media) for a specific past time period, along with the dates of a handful of photos from it.

Write the text of the postcard's back:
- Address the user directly, as a caring friend who noticed this stretch of their life and wanted to say something.
- Be mindful and gentle: BRIEFLY invite them to pause and remember what this period felt like. Do not lecture, advise, or prescribe.
- Be specific: reference actual places, venues, moods, and activities from the data, and the photos' dates. Weave in at least five concrete details from the data.
- At most TWO short paragraphs (4-7 sentences each), plain text only — no headings, no markdown, no bullet lists, no signature (the "from" line is printed separately).
- Keep it a little nostalgic, like a letter from someone who cares.`;

// Candidate sub-window lengths (days) considered "interesting periods".
const POSTCARD_WINDOW_LENGTHS = [7, 30, 90];
// Randomize among the top-N ranked periods for variety.
const POSTCARD_TOP_N = 7;
// The postcard collage: 10 images.
const POSTCARD_MAX_IMAGES = 10;
// Cap on Immich search results before sampling.
const POSTCARD_IMAGE_POOL = 40;
// LLM output budget for the postcard message (≈ 2 short paragraphs).
const POSTCARD_MAX_TOKENS = 16384;

/**
 * Strip the `id = ANY($1::uuid[])` predicate (and a dangling AND/WHERE) that
 * each plugin's resolveTimestamps branch carries, so we can full-scan the
 * user's entire check-in history instead of resolving a given id list.
 */
function stripIdFilter(sql: string): string {
  return sql
    .replace(/\s+AND\s+id\s*=\s*ANY\(\$1::uuid\[\]\)/gi, '')
    .replace(/\s+WHERE\s+id\s*=\s*ANY\(\$1::uuid\[\]\)/gi, '');
}

/**
 * Every check-in timestamp across all plugins, as a single UNION of each
 * plugin's resolveTimestamps branch (id, checked_in_at) with the id filter
 * removed — the user's full history.
 */
function allCheckinTimestampSql(): string {
  const branches = pluginTimestampBranches().map((sql) => `(\n    ${stripIdFilter(sql).trim()}\n  )`);
  if (branches.length === 0) {
    return 'SELECT NULL::timestamptz AS checked_in_at WHERE FALSE';
  }
  // Each branch selects (id, checked_in_at); we only need the timestamp.
  return `SELECT checked_in_at FROM (\n  ${branches.join('\n  UNION ALL\n')}\n) AS all_checkins`;
}

/** Per-day check-in counts (UTC day) for the user, inside [from, to]. */
async function dailyCheckinCounts(from: string, to: string): Promise<Map<string, number>> {
  const result = await query(
    `SELECT to_char(checked_in_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, COUNT(*)::int AS n
     FROM (${allCheckinTimestampSql()}) AS ts
     WHERE checked_in_at >= ($1 || 'T00:00:00.000Z')::timestamptz
       AND checked_in_at <= ($2 || 'T23:59:59.999Z')::timestamptz
     GROUP BY 1`,
    [from, to]
  );
  const map = new Map<string, number>();
  for (const row of result.rows) {
    map.set(String(row.day), Number(row.n));
  }
  return map;
}

/** The user's overall first and last check-in dates (YYYY-MM-DD, UTC). */
async function firstAndLastCheckinDate(): Promise<{ first: string; last: string } | null> {
  const result = await query(
    `SELECT MIN(checked_in_at) AS first, MAX(checked_in_at) AS last
     FROM (${allCheckinTimestampSql()}) AS ts
     WHERE checked_in_at IS NOT NULL`
  );
  const row = result.rows[0];
  if (!row?.first || !row?.last) return null;
  const fmt = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
  return { first: fmt(row.first), last: fmt(row.last) };
}

/** Pick the interesting period for a postcard. */
async function pickInterestingPeriod(): Promise<CandidateWindow | null> {
  const span = await firstAndLastCheckinDate();
  if (!span) return null;

  const month = currentMonthRange();
  const macro = randomMacroWindow(span.first, span.last, 6) ?? { from: span.first, to: span.last };

  const daily = await dailyCheckinCounts(macro.from, macro.to);
  let candidates = scoreWindows(
    daily,
    POSTCARD_WINDOW_LENGTHS,
    macro.from,
    macro.to,
    month.from,
    month.to
  );

  // Fallbacks for thin history: drop the current-month exclusion, then the
  // macro-window restriction (whole history).
  if (candidates.length === 0) {
    candidates = scoreWindows(daily, POSTCARD_WINDOW_LENGTHS, macro.from, macro.to, '', '');
  }
  if (candidates.length === 0 && (macro.from !== span.first || macro.to !== span.last)) {
    const wholeDaily = await dailyCheckinCounts(span.first, span.last);
    candidates = scoreWindows(
      wholeDaily,
      POSTCARD_WINDOW_LENGTHS,
      span.first,
      span.last,
      month.from,
      month.to
    );
    if (candidates.length === 0) {
      candidates = scoreWindows(wholeDaily, POSTCARD_WINDOW_LENGTHS, span.first, span.last, '', '');
    }
  }
  return pickRandomTop(candidates, POSTCARD_TOP_N);
}

/** Immich images for the period (random sample of up to 10). Null-safe. */
async function postcardImages(from: string, to: string): Promise<PostcardImage[]> {
  const settingsResult = await query(
    'SELECT immich_url, immich_api_key FROM user_settings WHERE user_id = $1',
    [USER_ID]
  );
  const row = settingsResult.rows[0];
  if (!row?.immich_url || !row?.immich_api_key) return [];
  const immichUrl = String(row.immich_url).replace(/\/+$/, '');
  const immichApiKey = String(row.immich_api_key);

  try {
    const response = await fetch(`${immichUrl}/api/search/metadata`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': immichApiKey },
      body: JSON.stringify({
        takenAfter: `${from}T00:00:00.000Z`,
        takenBefore: `${to}T23:59:59.999Z`,
        type: 'IMAGE',
        size: POSTCARD_IMAGE_POOL,
        order: 'asc',
      }),
    });
    if (!response.ok) return [];
    const data = await response.json() as {
      assets?: { items?: PostcardImage[] };
    };
    const all = (data.assets?.items || []).map((a) => ({
      id: a.id,
      originalFileName: a.originalFileName,
      localDateTime: a.localDateTime,
    }));
    return randomSample(all, POSTCARD_MAX_IMAGES);
  } catch (err) {
    console.error('Postcard Immich search failed:', err);
    return [];
  }
}

/** City the user was in at (or just before) the end of the period. */
async function stampCityAt(periodEnd: string): Promise<string | null> {
  const cutoff = addDays(periodEnd, 1);
  const result = await query(
    `SELECT v.city
     FROM checkins c
     JOIN venues v ON c.venue_id = v.id
     WHERE c.checked_in_at <= ($1 || 'T00:00:00.000Z')::timestamptz
       AND v.city IS NOT NULL AND TRIM(v.city) <> ''
     ORDER BY c.checked_in_at DESC
     LIMIT 1`,
    [cutoff]
  );
  const city = result.rows[0]?.city;
  return typeof city === 'string' && city.trim() ? city.trim() : null;
}

/** Addressed-to: display_name, falling back to username. */
async function addressedTo(): Promise<string> {
  const result = await query('SELECT username, display_name FROM users WHERE id = $1', [USER_ID]);
  const row = result.rows[0];
  const display = row?.display_name && String(row.display_name).trim() ? String(row.display_name).trim() : null;
  return display || (row?.username ? String(row.username) : 'Friend');
}

// POST /postcard - generate (and persist) a postcard about an interesting
// period in the user's past.
router.post('/postcard', async (_req: Request, res: Response) => {
  try {
    const llm = await getLlmSettings(USER_ID);
    if (!llm) {
      return res.status(400).json({ error: 'LLM integration is not configured. Set an API URL and model name in Settings → Integrations.' });
    }

    const period = await pickInterestingPeriod();
    if (!period) {
      return res.status(400).json({ error: 'Not enough check-in data to find an interesting period yet.' });
    }
    const { from: fromStr, to: toStr } = period;

    const [images, stampCity, toName, data] = await Promise.all([
      postcardImages(fromStr, toStr),
      stampCityAt(toStr),
      addressedTo(),
      gatherLifeData(fromStr, toStr),
    ]);
    if (!data.hasAnyData) {
      return res.status(400).json({ error: 'No check-in data found for the selected period.' });
    }

    const finalBudget = finalCharBudget(llm, 0);
    const condensed = await condenseLifeData(llm, data.entries, finalBudget);

    const countsLine = formatCounts(data.totals) ? `\nCheck-ins in the period — ${formatCounts(data.totals)}.` : '';
    const photosLine =
      images.length > 0
        ? ` Photos from the period were taken on: ${[...new Set(images.map((i) => (i.localDateTime || '').slice(0, 10)))].sort().join(', ')}.`
        : '';
    const header =
      `Write the back of a postcard about my life from ${fromStr} to ${toStr}.` +
      countsLine +
      photosLine +
      (condensed.mode === 'map-reduce'
        ? ' The data below is a condensed digest of ALL my check-ins in the period.'
        : '') +
      '\n\n' +
      condensed.text;

    let message: string;
    try {
      message = await callLlm(llm, POSTCARD_SYSTEM_PROMPT, header, POSTCARD_MAX_TOKENS);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to generate postcard';
      return res.status(502).json({ error: msg });
    }
    message = message.trim();
    if (!message) {
      return res.status(502).json({ error: 'LLM returned an empty postcard.' });
    }

    const senderLine = `${toName}, ${ymOf(toStr)}`;
    const inserted = await query(
      `INSERT INTO postcards (user_id, period_from, period_to, addressed_to, sender_line, stamp_city, message, images, counts)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, created_at`,
      [
        USER_ID,
        fromStr,
        toStr,
        toName,
        senderLine,
        stampCity,
        message,
        JSON.stringify(images),
        JSON.stringify(data.totals),
      ]
    );
    const row = inserted.rows[0];

    const payload: PostcardPayload = {
      id: row.id,
      from: fromStr,
      to: toStr,
      addressed_to: toName,
      sender_line: senderLine,
      stamp_city: stampCity,
      images,
      message,
      counts: data.totals,
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    };
    res.json(payload);
  } catch (err) {
    console.error('Error generating postcard:', err);
    res.status(500).json({ error: 'Failed to generate postcard' });
  }
});

// GET /postcards - received postcards, newest first (history list).
router.get('/postcards', async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT id, period_from, period_to, sender_line, stamp_city,
              LEFT(message, 160) AS message_preview,
              images, created_at
       FROM postcards
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [USER_ID]
    );
    res.json(
      result.rows.map((r) => ({
        id: r.id,
        from: r.period_from instanceof Date ? r.period_from.toISOString().slice(0, 10) : String(r.period_from).slice(0, 10),
        to: r.period_to instanceof Date ? r.period_to.toISOString().slice(0, 10) : String(r.period_to).slice(0, 10),
        sender_line: r.sender_line,
        stamp_city: r.stamp_city,
        message_preview: r.message_preview,
        image_ids: (Array.isArray(r.images) ? r.images : []).map((i: { id?: string }) => i.id).filter(Boolean),
        created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
      }))
    );
  } catch (err) {
    console.error('Error listing postcards:', err);
    res.status(500).json({ error: 'Failed to list postcards' });
  }
});

// GET /postcards/:id - full postcard payload.
router.get('/postcards/:id', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT id, period_from, period_to, addressed_to, sender_line, stamp_city,
              message, images, counts, created_at
       FROM postcards
       WHERE id = $1::uuid AND user_id = $2`,
      [req.params.id, USER_ID]
    );
    const r = result.rows[0];
    if (!r) return res.status(404).json({ error: 'Postcard not found' });

    const payload: PostcardPayload = {
      id: r.id,
      from: r.period_from instanceof Date ? r.period_from.toISOString().slice(0, 10) : String(r.period_from).slice(0, 10),
      to: r.period_to instanceof Date ? r.period_to.toISOString().slice(0, 10) : String(r.period_to).slice(0, 10),
      addressed_to: r.addressed_to,
      sender_line: r.sender_line,
      stamp_city: r.stamp_city,
      images: Array.isArray(r.images) ? r.images : [],
      message: r.message,
      counts: r.counts && typeof r.counts === 'object' ? r.counts : {},
      created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    };
    res.json(payload);
  } catch (err) {
    console.error('Error fetching postcard:', err);
    res.status(500).json({ error: 'Failed to fetch postcard' });
  }
});

// DELETE /postcards/:id - remove a postcard from history.
router.delete('/postcards/:id', async (req: Request, res: Response) => {
  try {
    const result = await query(
      'DELETE FROM postcards WHERE id = $1::uuid AND user_id = $2 RETURNING id',
      [req.params.id, USER_ID]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Postcard not found' });
    res.json({ message: 'Postcard deleted', id: req.params.id });
  } catch (err) {
    console.error('Error deleting postcard:', err);
    res.status(500).json({ error: 'Failed to delete postcard' });
  }
});

export const llmRouter = router;
