// Pure, testable helpers for the map-reduce life-summary strategy.
//
// Instead of randomly sampling check-ins away when the full period's data
// exceeds the context budget, the data is split into contiguous chronological
// chunks and each chunk is condensed (digested) by the LLM. If the digests
// themselves still exceed the final-call budget, they are re-chunked and
// re-digested (recursive reduce) until everything fits.

import type { PluginLlmHook, PluginLlmRow } from 'wwp-shared';

/** A single check-in rendered into one or more prompt lines. */
export interface LifeEntry {
  /** ISO timestamp used for chronological ordering. */
  timestamp: string;
  /** Plugin pool label, e.g. 'mood check-ins'. */
  label: string;
  lines: string[];
}

/** A contiguous, chronologically-ordered slice of life entries. */
export interface Chunk {
  from: string;
  to: string;
  text: string;
  /** Entry count per pool label. */
  counts: Record<string, number>;
}

export interface TokenConfig {
  /** Conservative chars-per-token estimate for English text. */
  charsPerToken: number;
  /** Fraction of the context window available for prompt input. */
  inputWindowFraction: number;
  /** Fixed overhead reserve (system prompt + header), in tokens. */
  promptOverheadTokens: number;
  /**
   * Fraction of the context window reserved for the model's OUTPUT when
   * digesting a chunk. Digests are dense and factual, so this is smaller
   * than the final summary's budget.
   */
  digestOutputFraction: number;
}

export const DEFAULT_TOKEN_CONFIG: TokenConfig = {
  charsPerToken: 3,
  inputWindowFraction: 0.75,
  promptOverheadTokens: 500,
  digestOutputFraction: 0.4,
};

export interface DigestMeta {
  level: number;
  chunks: number;
}

/**
 * Split chronologically-ordered entries into contiguous chunks, each fitting
 * `charBudget`. A single entry larger than the budget is kept alone in its
 * own chunk (truncated to the budget, with an ellipsis) so the algorithm can
 * never loop on an unbounded entry.
 */
export function chunkByBudget(
  entries: LifeEntry[],
  charBudget: number,
  config: TokenConfig = DEFAULT_TOKEN_CONFIG
): Chunk[] {
  if (entries.length === 0) return [];
  if (charBudget <= 0) charBudget = config.charsPerToken; // at least ~1 token

  const cost = (lines: string[]) => lines.join('\n').length;

  const chunks: Chunk[] = [];
  let current: LifeEntry[] = [];
  let currentChars = 0;

  const flush = () => {
    if (current.length === 0) return;
    const counts: Record<string, number> = {};
    for (const entry of current) {
      counts[entry.label] = (counts[entry.label] || 0) + 1;
    }
    chunks.push({
      from: current[0].timestamp,
      to: current[current.length - 1].timestamp,
      text: current.map((e) => e.lines.join('\n')).join('\n'),
      counts,
    });
    current = [];
    currentChars = 0;
  };

  for (const entry of entries) {
    const c = cost(entry.lines);
    // Entry alone exceeds the budget: isolate and truncate it.
    if (c > charBudget) {
      flush();
      const truncated = entry.lines.join('\n').slice(0, Math.max(0, charBudget - 3)) + '…';
      const counts = { [entry.label]: 1 };
      chunks.push({
        from: entry.timestamp,
        to: entry.timestamp,
        text: truncated,
        counts,
      });
      continue;
    }
    // Newline joins the entry onto the chunk's existing text.
    const added = c + (current.length > 0 ? 1 : 0);
    if (currentChars + added > charBudget) {
      flush();
    }
    current.push(entry);
    currentChars += added;
  }
  flush();

  return chunks;
}

/** Build a human-readable date range from two ISO timestamps. */
export function formatDateRange(fromIso: string, toIso: string): string {
  const fmt = (iso: string) =>
    new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(
      new Date(iso)
    );
  const a = fmt(fromIso);
  const b = fmt(toIso);
  return a === b ? a : `${a} – ${b}`;
}

/** Hard cap on reduction levels so a misbehaving LLM can't loop forever. */
export const MAX_CONDENSE_LEVELS = 5;

/**
 * Recursively condense items (chunks at level 0, digests afterwards) until
 * they all fit `charBudget`. The digest function is injected so this helper
 * stays pure/testable.
 *
 * Each pass re-chunks the current items into budget-fitting slices (packable
 * items are grouped, lone oversized items are isolated and truncated by
 * `chunkByBudget`) and digests every slice in parallel. If items cannot be
 * packed (none fit together), each is digested 1:1 — still shrinking the
 * total. Terminates because `MAX_CONDENSE_LEVELS` bounds the number of
 * passes; best-effort output is returned if the budget is still exceeded.
 */
export async function condenseUntilFits(
  items: Chunk[],
  charBudget: number,
  digest: (chunk: Chunk, level: number) => Promise<string>,
  config: TokenConfig = DEFAULT_TOKEN_CONFIG
): Promise<{ text: string; level: number; chunks: number }> {
  let level = 0;
  let current = items;
  const totalChars = () => current.reduce((sum, it) => sum + it.text.length, 0);

  while (
    current.length > 1 &&
    totalChars() > charBudget &&
    level < MAX_CONDENSE_LEVELS
  ) {
    level += 1;
    const levelChunks = chunkByBudget(
      current.map((it) => ({
        timestamp: it.from,
        label: `digest (level ${level - 1})`,
        lines: [it.text],
      })),
      charBudget,
      config
    );
    const digests = await Promise.all(levelChunks.map((c) => digest(c, level)));
    current = levelChunks.map((c, i) => ({
      from: c.from,
      to: c.to,
      text: digests[i] ?? '',
      counts: c.counts,
    }));
  }

  return {
    text: current.map((it) => it.text).join('\n\n'),
    level,
    chunks: current.length,
  };
}

/** Merge per-chunk per-label counts into a single map. */
export function mergeCounts(chunks: Chunk[]): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const chunk of chunks) {
    for (const [label, n] of Object.entries(chunk.counts)) {
      merged[label] = (merged[label] || 0) + n;
    }
  }
  return merged;
}

/**
 * Normalize a check-in timestamp to an ISO string. The pg driver returns
 * `timestamptz` columns as `Date` objects, but some rows may arrive as
 * strings depending on the query path — handle both.
 */
function toIsoTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/**
 * Build the flat, chronologically-ordered entry list from all plugins that
 * contribute to the life summary. Each check-in becomes one entry whose lines
 * are rendered by the plugin's `toLines` hook (the same lines the single-call
 * path uses, so both paths see identical data).
 */
export async function buildChronologicalEntries(
  plugins: { label: string; rows: PluginLlmRow[]; hook: PluginLlmHook }[]
): Promise<{ entries: LifeEntry[]; totals: Record<string, number> }> {
  const raw: { timestamp: string; label: string; lines: string[] }[] = [];
  const totals: Record<string, number> = {};
  for (const { label, rows, hook } of plugins) {
    totals[label] = rows.length;
    for (const row of rows) {
      const lines = hook.toLines(row);
      if (lines.length > 0) {
        raw.push({ timestamp: toIsoTimestamp(row.checked_in_at), label, lines });
      }
    }
  }
  // Stable chronological ordering across all types.
  raw.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return { entries: raw, totals };
}
