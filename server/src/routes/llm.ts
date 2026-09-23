import { Router, Request, Response } from 'express';
import type { CheckinTypeServer, PluginLlmHook } from 'wwp-shared';
import { allPlugins } from '../plugins/registry';
import sharp from 'sharp';
import { query } from '../db';
import {
  DEFAULT_TOKEN_CONFIG,
  buildChronologicalEntries,
  chunkByBudget,
  condenseUntilFits,
  formatDateRange,
  type Chunk,
} from '../services/llmCompaction';

const router = Router();

import { DEFAULT_USER_ID as USER_ID } from '../constants';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Token-bucket model shared by every LLM call in this route.
const TOKEN_CONFIG = {
  ...DEFAULT_TOKEN_CONFIG,
  promptOverheadTokens: 500,
};
// Cap on how many candidate images we return to the client.
const CANDIDATE_IMAGE_LIMIT = 200;
// Cap on how many images we forward to the LLM per request.
const MAX_LLM_IMAGES = 10;
// Conservative vision-token reserve per 1024px image, so text data is always
// prioritized over photos when the context window is small.
const IMAGE_TOKEN_RESERVE = 1200;


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

// Prompt used to condense one chronological slice of the period (map phase,
// and each reduce level). Dense and factual: it must preserve every specific
// the final summary will need, without doing any reflection itself.
const DIGEST_SYSTEM_PROMPT = `You are condensing personal activity data from a life journal. You are given a chronological slice of the user's check-ins (location, mood, fitness tracks, sleep, media).

Write a dense, factual digest of this slice that preserves all the specifics a later analyst will need:
- Every distinct place, venue, person, title, activity, or mood label mentioned
- Key dates and date ranges (use ranges for repeated events, e.g. "3 visits to X, May 1–3")
- All notes and comments written by the user, quoted or closely paraphrased
- Counts and totals (e.g. "12 workouts, ~45 km total", "7 bad mood check-ins")
- Notable highs, lows, and standout entries (high ratings, unusual locations, significant notes)

Rules:
- Do NOT omit anything significant — when unsure, keep it.
- Do NOT add interpretation, advice, or reflection; that is done later.
- Keep the output compact: plain text with short bullet points, grouped by day or theme.`;

interface LlmSettings {
  api_url: string;
  model: string;
  reasoning_level: string;
  context_window: number;
  image_support: boolean;
}

/** Call the configured chat-completions endpoint and return the text. */
async function callLlm(
  llm: LlmSettings,
  systemPrompt: string,
  userContent: string | Array<{ type: string; [key: string]: unknown }>,
  maxTokens: number
): Promise<string> {
  const llmResponse = await fetch(`${llm.api_url}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: llm.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      max_tokens: maxTokens,
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
    throw new Error(message);
  }

  const llmData = await llmResponse.json() as {
    choices?: { message?: { content?: string } }[];
  };
  const content = llmData.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('LLM returned an empty response.');
  }
  return content;
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

/** Char budget for text data in the FINAL (reduce) call, given image reserve. */
function finalCharBudget(llm: LlmSettings, imageTokenReserve: number): number {
  const tokens = Math.floor(
    llm.context_window * TOKEN_CONFIG.inputWindowFraction -
      TOKEN_CONFIG.promptOverheadTokens -
      imageTokenReserve
  );
  return Math.max(0, Math.floor(tokens * TOKEN_CONFIG.charsPerToken));
}

/** Max output tokens for a digest call (digests are dense but not a full summary). */
function digestMaxTokens(llm: LlmSettings): number {
  return Math.max(512, Math.min(Math.floor(llm.context_window * TOKEN_CONFIG.digestOutputFraction), 16384));
}

/**
 * Char budget for the INPUT of a digest (map) call — no images there. The
 * input is sized so that input + output can never exceed the context window
 * (window − output reserve − prompt overhead), unlike the plain
 * input-window-fraction estimate.
 */
function digestCharBudget(llm: LlmSettings): number {
  const tokens = llm.context_window - digestMaxTokens(llm) - TOKEN_CONFIG.promptOverheadTokens;
  return Math.max(0, Math.floor(tokens * TOKEN_CONFIG.charsPerToken));
}

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
): Promise<{ parts: Array<{ type: string; [key: string]: unknown }>; included: number; skipped: number }> {
  const parts: Array<{ type: string; [key: string]: unknown }> = [];
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

    // --- Text budget: data is always prioritized over images ---
    const imageTokenReserve =
      llm.image_support && imageIds.length > 0
        ? Math.min(imageIds.length, MAX_LLM_IMAGES) * IMAGE_TOKEN_RESERVE
        : 0;
    const finalBudget = finalCharBudget(llm, imageTokenReserve);
    const fullText = data.entries.map((e) => e.lines.join('\n')).join('\n');
    const fullChars = fullText.length;

    // --- Condense: single call when it fits, else map-reduce ---
    let dataText: string;
    let mode: 'single' | 'map-reduce' = 'single';
    let chunks = 0;
    let digestLevels = 0;

    const digestChunk = async (chunk: Chunk, level: number): Promise<string> => {
      const countLine = formatCounts(chunk.counts) ? `\nCheck-ins in this slice — ${formatCounts(chunk.counts)}.` : '';
      const prompt =
        `Chronological slice of activity data from ${formatDateRange(chunk.from, chunk.to)} ` +
        `(slice ${level === 0 ? 'of the period' : `at reduction level ${level}`}).${countLine}\n\n${chunk.text}`;
      return callLlm(llm, DIGEST_SYSTEM_PROMPT, prompt, digestMaxTokens(llm));
    };

    if (fullChars <= finalBudget && finalBudget > 0) {
      dataText = fullText;
    } else {
      const levelChunks = chunkByBudget(data.entries, digestCharBudget(llm), TOKEN_CONFIG);
      console.log(
        `LLM summarize: ${fullChars} chars exceeds budget (${finalBudget}) — ` +
          `condensing ${levelChunks.length} chunk(s) via map-reduce.`
      );
      const result = await condenseUntilFits(levelChunks, finalBudget, digestChunk, TOKEN_CONFIG);
      dataText = result.text;
      mode = 'map-reduce';
      chunks = levelChunks.length;
      digestLevels = result.level;
      console.log(`LLM summarize: condensation done — ${result.chunks} digest(s), ${result.level} reduction level(s).`);
    }

    // --- Fetch images (if supported and requested) ---
    const imageResult = await fetchImageParts(llm, imageIds);
    const contentParts: Array<{ type: string; [key: string]: unknown }> = [...imageResult.parts];

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

export const llmRouter = router;
