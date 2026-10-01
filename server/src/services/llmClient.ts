/**
 * Shared LLM client for chat-completions calls (vLLM or any
 * OpenAI-compatible endpoint). Extracted from routes/llm.ts so both the
 * life-summary route and the postcard route share one code path, and so
 * tests can mock a single module.
 */

import { query } from '../db';
import {
  DEFAULT_TOKEN_CONFIG,
  chunkByBudget,
  condenseUntilFits,
  formatDateRange,
  type Chunk,
  type LifeEntry,
} from './llmCompaction';

export interface LlmSettings {
  api_url: string;
  model: string;
  reasoning_level: string;
  context_window: number;
  image_support: boolean;
}

// Token-bucket model shared by every LLM call that condenses life data.
export const TOKEN_CONFIG = {
  ...DEFAULT_TOKEN_CONFIG,
  promptOverheadTokens: 500,
};

/**
 * Read the user's LLM integration settings. Null (rather than throw) when the
 * integration is not configured, so callers can return a friendly 400.
 */
export async function getLlmSettings(userId: string): Promise<LlmSettings | null> {
  const result = await query(
    `SELECT llm_api_url, llm_model, llm_reasoning_level, llm_context_window, llm_image_support
     FROM user_settings WHERE user_id = $1`,
    [userId]
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

export interface LlmContentPart {
  type: string;
  [key: string]: unknown;
}

/** Call the configured chat-completions endpoint and return the text. */
export async function callLlm(
  llm: LlmSettings,
  systemPrompt: string,
  userContent: string | LlmContentPart[],
  maxTokens: number
): Promise<string> {
  // Reasoning models can spend their entire output budget on hidden thinking
  // and return empty visible content. If that happens with finish_reason
  // 'length', retry once with a larger budget before giving up.
  const attempts = [maxTokens, Math.min(maxTokens * 4, 16384)];
  for (let i = 0; i < attempts.length; i++) {
    const content = await attemptLlmCall(llm, systemPrompt, userContent, attempts[i]);
    if (content) return content;
    if (i < attempts.length - 1) {
      console.log(
        `LLM returned empty content at ${attempts[i]} max_tokens (likely reasoning budget) — retrying with ${attempts[i + 1]}.`
      );
    }
  }
  throw new Error('LLM returned an empty response.');
}

async function attemptLlmCall(
  llm: LlmSettings,
  systemPrompt: string,
  userContent: string | LlmContentPart[],
  maxTokens: number
): Promise<string | null> {
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
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    model?: string;
    usage?: Record<string, number>;
  };
  const choice = llmData.choices?.[0];
  const content = choice?.message?.content;
  if (!content) {
    // Empty content usually means a reasoning model spent its entire output
    // budget on hidden reasoning (finish_reason 'length'), or the response
    // shape is unexpected. Log everything useful for diagnosis; the caller
    // (callLlm) decides whether to retry with a larger budget.
    console.error(
      'LLM returned empty content.',
      JSON.stringify({ model: llmData.model, finish_reason: choice?.finish_reason, usage: llmData.usage, max_tokens: maxTokens, body: JSON.stringify(llmData).slice(0, 2000) })
    );
    return null;
  }
  return content;
}

/** Char budget for a final call's text input, given an image token reserve. */
export function finalCharBudget(llm: LlmSettings, imageTokenReserve: number): number {
  const tokens = Math.floor(
    llm.context_window * TOKEN_CONFIG.inputWindowFraction -
      TOKEN_CONFIG.promptOverheadTokens -
      imageTokenReserve
  );
  return Math.max(0, Math.floor(tokens * TOKEN_CONFIG.charsPerToken));
}

/** Max output tokens for a digest call (digests are dense but not a full summary). */
export function digestMaxTokens(llm: LlmSettings): number {
  return Math.max(512, Math.min(Math.floor(llm.context_window * TOKEN_CONFIG.digestOutputFraction), 16384));
}

/**
 * Char budget for the INPUT of a digest (map) call — no images there. The
 * input is sized so that input + output can never exceed the context window
 * (window − output reserve − prompt overhead), unlike the plain
 * input-window-fraction estimate.
 */
export function digestCharBudget(llm: LlmSettings): number {
  const tokens = llm.context_window - digestMaxTokens(llm) - TOKEN_CONFIG.promptOverheadTokens;
  return Math.max(0, Math.floor(tokens * TOKEN_CONFIG.charsPerToken));
}

/**
 * Prompt used to condense one chronological slice of a period (map phase, and
 * each reduce level). Dense and factual: it must preserve every specific the
 * final generation will need, without doing any reflection itself.
 */
export const DIGEST_SYSTEM_PROMPT = `You are condensing personal activity data from a life journal. You are given a chronological slice of the user's check-ins (location, mood, fitness tracks, sleep, media).

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

export interface CondensedLifeData {
  /** The (possibly digested) text to include in the final LLM call. */
  text: string;
  /** 'single' = full data in one call, 'map-reduce' = chunked + condensed. */
  mode: 'single' | 'map-reduce';
  /** Number of chunks condensed during the map phase (0 for single). */
  chunks: number;
  /** Number of recursive reduction levels applied to the digests. */
  digest_levels: number;
}

/**
 * Condense a period's life-data entries to fit the final call's char budget.
 * A single call receives the data verbatim when it fits; otherwise the data
 * is split into contiguous chronological chunks, each condensed by the LLM in
 * parallel (map), and the digests merged (reduce). Recursive when the digests
 * still overflow the budget.
 */
export async function condenseLifeData(
  llm: LlmSettings,
  entries: LifeEntry[],
  finalBudget: number
): Promise<CondensedLifeData> {
  const fullText = entries.map((e) => e.lines.join('\n')).join('\n');

  if (finalBudget > 0 && fullText.length <= finalBudget) {
    return { text: fullText, mode: 'single', chunks: 0, digest_levels: 0 };
  }

  const levelChunks = chunkByBudget(entries, digestCharBudget(llm), TOKEN_CONFIG);
  const digestChunk = async (chunk: Chunk, level: number): Promise<string> => {
    const prompt =
      `Chronological slice of activity data from ${formatDateRange(chunk.from, chunk.to)} ` +
      `(slice ${level === 0 ? 'of the period' : `at reduction level ${level}`}).\n\n${chunk.text}`;
    return callLlm(llm, DIGEST_SYSTEM_PROMPT, prompt, digestMaxTokens(llm));
  };

  const result = await condenseUntilFits(levelChunks, finalBudget, digestChunk, TOKEN_CONFIG);
  return {
    text: result.text,
    mode: 'map-reduce',
    chunks: levelChunks.length,
    digest_levels: result.level,
  };
}
