/**
 * Notes plugin — naming a theme (a cluster of similar notes) with the chat
 * LLM from the notes nearest its center. Without an LLM, or when it fails,
 * the theme is named after its most common tags.
 */

import { callLlm, finalCharBudget, type LlmSettings } from '../../../server/src/services/llmClient';

export interface ThemeSample {
  title: string | null;
  excerpt: string;
  date: string;
  tags: string[];
}

export interface ThemeName {
  label: string;
  description: string | null;
}

export const SYSTEM_PROMPT = `You are labeling a group of a person's private notes (journal entries, therapy notes, dreams, and similar) that an embedding model found to be similar.
Name what the notes have in common: a theme, topic, person, place, or recurring situation.
Reply with JSON only, no prose: {"label": "<2-4 words, Title Case>", "description": "<one sentence, second person>"}`;

export function buildThemePrompt(samples: ThemeSample[], charBudget: number): string {
  const perNote = Math.max(200, Math.floor(charBudget / Math.max(1, samples.length)) - 80);
  const lines = samples.map((s, i) => {
    const head = `${i + 1}. ${s.date}${s.title ? ` — ${s.title}` : ''}${s.tags.length ? ` [${s.tags.join(', ')}]` : ''}`;
    const text = s.excerpt.length > perNote ? `${s.excerpt.slice(0, perNote)}…` : s.excerpt;
    return `${head}\n${text}`;
  });
  return `Notes in this group:\n\n${lines.join('\n\n')}`;
}

/** Tolerant parse: the first JSON object in the reply, with a usable label. */
export function parseThemeName(reply: string): ThemeName | null {
  const cleaned = reply.replace(/<think>[\s\S]*?<\/think>/g, '');
  const match = /\{[\s\S]*\}/.exec(cleaned);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { label?: unknown; description?: unknown };
    const label = typeof parsed.label === 'string' ? parsed.label.trim().replace(/^["']|["']$/g, '') : '';
    if (!label) return null;
    const description = typeof parsed.description === 'string' && parsed.description.trim()
      ? parsed.description.trim().slice(0, 300)
      : null;
    return { label: label.slice(0, 60), description };
  } catch {
    return null;
  }
}

/** Name from the most common tags in the samples, else "Theme N". */
export function fallbackThemeName(samples: ThemeSample[], ordinal: number): ThemeName {
  const counts = new Map<string, number>();
  for (const s of samples) for (const t of s.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([t]) => t);
  return { label: top.length ? top.join(' & ') : `Theme ${ordinal}`, description: null };
}

export async function nameTheme(
  llm: LlmSettings | null,
  samples: ThemeSample[],
  ordinal: number,
  call: typeof callLlm = callLlm,
): Promise<ThemeName> {
  if (!llm || samples.length === 0) return fallbackThemeName(samples, ordinal);
  try {
    // A theme name needs a gist, not the whole notes: cap well below the window.
    const budget = Math.min(finalCharBudget(llm, 0), 24_000);
    const reply = await call(llm, SYSTEM_PROMPT, buildThemePrompt(samples, budget), 400);
    return parseThemeName(reply) ?? fallbackThemeName(samples, ordinal);
  } catch (err) {
    console.error('Naming a note theme failed:', err instanceof Error ? err.message : err);
    return fallbackThemeName(samples, ordinal);
  }
}
