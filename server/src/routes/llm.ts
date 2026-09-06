import { Router, Request, Response } from 'express';
import sharp from 'sharp';
import { query } from '../db';

const router = Router();

const USER_ID = '00000000-0000-0000-0000-000000000001';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Approximate chars-per-token for English text (conservative).
const CHARS_PER_TOKEN = 3;
// Leave headroom for the model's response.
const INPUT_WINDOW_FRACTION = 0.75;
// Cap on how many candidate images we return to the client.
const CANDIDATE_IMAGE_LIMIT = 200;
// Cap on how many images we forward to the LLM per request.
const MAX_LLM_IMAGES = 10;
// Conservative vision-token reserve per 1024px image, so text data is always
// prioritized over photos when the context window is small.
const IMAGE_TOKEN_RESERVE = 1200;
// Fixed overhead reserve (system prompt + header), in tokens.
const PROMPT_OVERHEAD_TOKENS = 500;

const MOOD_LABELS: Record<number, string> = {
  1: 'bad',
  2: 'okay',
  3: 'neutral',
  4: 'good',
  5: 'great',
};

interface LlmSettings {
  api_url: string;
  model: string;
  reasoning_level: string;
  context_window: number;
  image_support: boolean;
}

async function getLlmSettings(): Promise<LlmSettings | null> {
  const result = await query(
    `SELECT llm_api_url, llm_model, llm_reasoning_level, llm_context_window, llm_image_support
     FROM user_settings WHERE user_id = $1`,
    [USER_ID]
  );
  const row = result.rows[0];
  if (!row?.llm_api_url || !row?.llm_model) return null;
  return {
    api_url: String(row.llm_api_url).replace(/\/+$/, ''),
    model: String(row.llm_model),
    reasoning_level: row.llm_reasoning_level ? String(row.llm_reasoning_level) : 'medium',
    context_window: row.llm_context_window ? Number(row.llm_context_window) : 262144,
    image_support: row.llm_image_support !== false,
  };
}

function validateDateRange(from: unknown, to: unknown): { ok: true } | { ok: false; error: string } {
  if (typeof from !== 'string' || typeof to !== 'string' || !DATE_RE.test(from) || !DATE_RE.test(to)) {
    return { ok: false, error: 'from and to must be dates in YYYY-MM-DD format' };
  }
  if (from > to) {
    return { ok: false, error: 'from must be on or before to' };
  }
  return { ok: true };
}

interface CheckinRow {
  checked_in_at: string;
  note: string | null;
  venue_name: string | null;
  city: string | null;
  country: string | null;
  venue_category: string | null;
  timezone: string | null;
}

interface MoodRow {
  checked_in_at: string;
  mood: number;
  note: string | null;
  activities: { name: string; group_name: string }[];
  timezone: string | null;
}

interface TrackRow {
  name: string;
  activity_type: string | null;
  started_at: string;
  ended_at: string;
  distance_m: number;
  elapsed_time_s: number;
  timezone: string;
}

interface SleepRow {
  started_at: string;
  ended_at: string;
  comment: string | null;
  timezone: string | null;
}

async function gatherLifeData(from: string, to: string) {
  const [checkinsResult, moodsResult, tracksResult, sleepResult] = await Promise.all([
    query(
      `SELECT c.checked_in_at, c.notes AS note,
              v.name AS venue_name, v.city, v.country,
              vc.name AS venue_category,
              c.checkin_timezone AS timezone
       FROM checkins c
       JOIN venues v ON c.venue_id = v.id
       LEFT JOIN venue_categories vc ON v.category_id = vc.id
       WHERE c.user_id = $1
         AND (c.checked_in_at AT TIME ZONE COALESCE(c.checkin_timezone, 'UTC'))::date >= $2::date
         AND (c.checked_in_at AT TIME ZONE COALESCE(c.checkin_timezone, 'UTC'))::date <= $3::date
       ORDER BY c.checked_in_at ASC`,
      [USER_ID, from, to]
    ),
    query(
      `SELECT mc.checked_in_at, mc.mood, mc.note, mc.mood_timezone AS timezone,
              COALESCE(
                (
                  SELECT json_agg(json_build_object('name', ma.name, 'group_name', mag.name))
                  FROM mood_checkin_activities mca
                  JOIN mood_activities ma ON mca.activity_id = ma.id
                  JOIN mood_activity_groups mag ON ma.group_id = mag.id
                  WHERE mca.mood_checkin_id = mc.id
                ),
                '[]'::json
              ) AS activities
       FROM mood_checkins mc
       WHERE mc.user_id = $1
         AND (mc.checked_in_at AT TIME ZONE COALESCE(mc.mood_timezone, 'UTC'))::date >= $2::date
         AND (mc.checked_in_at AT TIME ZONE COALESCE(mc.mood_timezone, 'UTC'))::date <= $3::date
       ORDER BY mc.checked_in_at ASC`,
      [USER_ID, from, to]
    ),
    query(
      `SELECT name, activity_type, started_at, ended_at,
              distance_m::float AS distance_m, elapsed_time_s::int AS elapsed_time_s, timezone
       FROM tracks
       WHERE user_id = $1
         AND (started_at AT TIME ZONE timezone)::date >= $2::date
         AND (started_at AT TIME ZONE timezone)::date <= $3::date
       ORDER BY started_at ASC`,
      [USER_ID, from, to]
    ),
    query(
      `SELECT started_at, ended_at, comment, sleep_timezone AS timezone
       FROM sleep_entries
       WHERE user_id = $1
         AND (ended_at AT TIME ZONE COALESCE(sleep_timezone, 'UTC'))::date >= $2::date
         AND (ended_at AT TIME ZONE COALESCE(sleep_timezone, 'UTC'))::date <= $3::date
       ORDER BY ended_at ASC`,
      [USER_ID, from, to]
    ),
  ]);

  const formatWhen = (iso: string, timezone: string | null): string => {
    const opts: Intl.DateTimeFormatOptions = {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    };
    return new Intl.DateTimeFormat('en-US', timezone ? { ...opts, timeZone: timezone } : opts).format(new Date(iso));
  };

  const checkins: CheckinRow[] = checkinsResult.rows;
  const moods: MoodRow[] = moodsResult.rows;
  const tracks: TrackRow[] = tracksResult.rows;
  const sleep: SleepRow[] = sleepResult.rows;

  const totalCheckins = checkins.length + moods.length;
  const hasAnyData = totalCheckins > 0 || tracks.length > 0 || sleep.length > 0;

  return { checkins, moods, tracks, sleep, hasAnyData, formatWhen };
}

function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

function formatSleepDuration(startedAt: string, endedAt: string): string {
  const mins = Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatTrackDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function fisherYatesShuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

interface SkippedType {
  type: string;
  total: number;
  included: number;
}

// Build the data description. Every data type present in the period is
// included in full when the char budget allows. When the budget is exceeded,
// the SAME inclusion fraction is applied to every type (so each type is
// represented proportionally), and each type's entries are randomly sampled
// down to that fraction (kept in chronological order).
function buildLifeDataText(
  data: Awaited<ReturnType<typeof gatherLifeData>>,
  charBudget: number
): { text: string; skipped: SkippedType[] } {
  const { checkins, moods, tracks, sleep, formatWhen } = data;

  const pools: { label: string; lines: string[] }[] = [];

  const locationLines = checkins.map((c) => {
    const where = [c.venue_name, c.venue_category, [c.city, c.country].filter(Boolean).join(', ')]
      .filter(Boolean)
      .join(' / ');
    const note = c.note ? ` — note: "${c.note}"` : '';
    return `- ${formatWhen(c.checked_in_at, c.timezone)} — location check-in at ${where}${note}`;
  });
  if (locationLines.length > 0) pools.push({ label: 'location check-ins', lines: locationLines });

  const moodLines = moods.map((m) => {
    const acts = m.activities?.length ? ` (activities: ${m.activities.map((a) => a.name).join(', ')})` : '';
    const note = m.note ? ` — note: "${m.note}"` : '';
    return `- ${formatWhen(m.checked_in_at, m.timezone)} — mood: ${MOOD_LABELS[m.mood] || m.mood}${acts}${note}`;
  });
  if (moodLines.length > 0) pools.push({ label: 'mood check-ins', lines: moodLines });

  const trackLines = tracks.map((t) => {
    const type = t.activity_type ? `${t.activity_type} ` : '';
    return `- ${formatWhen(t.started_at, t.timezone)} — ${type}track "${t.name}": ${formatDistance(Number(t.distance_m))} in ${formatTrackDuration(Number(t.elapsed_time_s))}`;
  });
  if (trackLines.length > 0) pools.push({ label: 'tracks', lines: trackLines });

  const sleepLines = sleep.map((s) => {
    const comment = s.comment ? ` — comment: "${s.comment}"` : '';
    return `- ${formatWhen(s.ended_at, s.timezone)} — slept ${formatSleepDuration(s.started_at, s.ended_at)}${comment}`;
  });
  if (sleepLines.length > 0) pools.push({ label: 'sleep entries', lines: sleepLines });

  const sectionCost = (lines: string[]) => (pools.length > 1 ? 2 : 0);

  const fullFits =
    pools.reduce((sum, pool) => sum + pool.lines.join('\n').length + sectionCost(pool.lines), 0) <= charBudget;
  if (fullFits) {
    return { text: pools.map((pool) => pool.lines.join('\n')).join('\n\n'), skipped: [] };
  }

  // Over budget: apply one inclusion fraction to every type so all types
  // present in the period remain represented.
  const fullTotalChars = pools.reduce(
    (sum, pool) => sum + pool.lines.join('\n').length + sectionCost(pool.lines),
    0
  );
  // Scale down proportionally to the budget (leaving a small margin for
  // rounding), never including more than 100% of any type.
  const fraction = Math.min(1, (charBudget / fullTotalChars) * 0.95);

  const keptSections: string[] = [];
  const skipped: SkippedType[] = [];

  for (const pool of pools) {
    const total = pool.lines.length;
    const target = fraction >= 1 ? total : Math.max(0, Math.round(total * fraction));

    let chosen: number[];
    if (target >= total) {
      chosen = pool.lines.map((_, i) => i);
    } else {
      chosen = fisherYatesShuffle(pool.lines.map((_, i) => i)).slice(0, target);
      chosen.sort((a, b) => a - b);
    }

    if (chosen.length > 0) {
      keptSections.push(chosen.map((i) => pool.lines[i]).join('\n'));
    }
    if (chosen.length < total) {
      skipped.push({ type: pool.label, total, included: chosen.length });
    }
  }

  return { text: keptSections.join('\n\n'), skipped };
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

// POST /summarize - summarize a time period via the configured LLM
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

    const llm = await getLlmSettings();
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

    // --- Build text prompt first: data is always prioritized over images ---
    const contentParts: Array<{ type: string; [key: string]: unknown }> = [];
    const reserveImageTokens = llm.image_support && imageIds.length > 0;
    const imageTokenReserve = reserveImageTokens
      ? Math.min(imageIds.length, MAX_LLM_IMAGES) * IMAGE_TOKEN_RESERVE
      : 0;
    const textTokenBudget = Math.floor(
      llm.context_window * INPUT_WINDOW_FRACTION - PROMPT_OVERHEAD_TOKENS - imageTokenReserve
    );
    const charBudget = Math.max(0, Math.floor(textTokenBudget * CHARS_PER_TOKEN));
    const { text: lifeDataText, skipped } = buildLifeDataText(data, charBudget);

    // --- Fetch images (if supported and requested) ---
    let imagesIncluded = 0;
    let imagesSkipped = 0;

    if (llm.image_support && imageIds.length > 0) {
      const immichResult = await query(
        'SELECT immich_url, immich_api_key FROM user_settings WHERE user_id = $1',
        [USER_ID]
      );
      const immichRow = immichResult.rows[0];
      if (immichRow?.immich_url && immichRow?.immich_api_key) {
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
            imagesSkipped += 1;
            continue;
          }
          contentParts.push({
            type: 'image_url',
            image_url: { url: `data:${img.contentType};base64,${img.data}` },
          });
          imagesIncluded += 1;
        }
      } else {
        imagesSkipped = imageIds.length;
      }
    }

    const skippedNote =
      skipped.length > 0
        ? ` (Note: to fit the context window, only a random sample of some data was included: ${skipped
            .map((s) => `${s.included} of ${s.total} ${s.type}`)
            .join(', ')}.)`
        : '';
    const header =
      `Summarize my life from ${fromStr} to ${toStr}. Below is my activity data from WhereWeWere during that period.` +
      skippedNote +
      (imagesIncluded > 0
        ? ` I have also included ${imagesIncluded} photo${imagesIncluded === 1 ? '' : 's'} taken during this period — describe them where relevant and use them to ground your reflections.`
        : '') +
      '\n\n' +
      lifeDataText;

    contentParts.push({ type: 'text', text: header });

    const llmResponse = await fetch(`${llm.api_url}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: llm.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: contentParts },
        ],
        max_tokens: Math.min(Math.floor(llm.context_window * 0.2), 16384),
        ...(llm.reasoning_level ? { reasoning_effort: llm.reasoning_level } : {}),
      }),
    });

    if (!llmResponse.ok) {
      const body = await llmResponse.text();
      console.error('LLM request failed:', llmResponse.status, body);
      let message = `LLM request failed (${llmResponse.status})`;
      try {
        const parsed = JSON.parse(body) as { error?: { message?: string } | string };
        const errMsg = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message;
        if (errMsg) message = `LLM request failed: ${errMsg}`;
      } catch {
        if (body) message = `LLM request failed: ${body.slice(0, 300)}`;
      }
      return res.status(502).json({ error: message });
    }

    const llmData = await llmResponse.json() as {
      choices?: { message?: { content?: string } }[];
    };
    const summary = llmData.choices?.[0]?.message?.content;
    if (!summary) {
      return res.status(502).json({ error: 'LLM returned an empty response.' });
    }

    res.json({
      summary,
      images_included: imagesIncluded,
      images_skipped: imagesSkipped,
      skipped: skipped.map((s) => ({ type: s.type, total: s.total, included: s.included })),
    });
  } catch (err) {
    console.error('Error summarizing life period:', err);
    res.status(500).json({ error: 'Failed to generate summary' });
  }
});

export const llmRouter = router;
