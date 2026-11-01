/**
 * How speakers look in a transcript. Speakers are per-file ids ("S1", "S2"...);
 * the user may have named them ("S1" -> "Dad"), otherwise they read "Speaker 1".
 */

/** "S3" -> 3; anything else -> 0. */
export function speakerNumber(id: string): number {
  const n = /^S(\d+)$/.exec(id)?.[1];
  return n ? Number(n) : 0;
}

export function speakerLabel(id: string, names: Record<string, string> | undefined): string {
  const named = names?.[id]?.trim();
  if (named) return named;
  const n = speakerNumber(id);
  return n > 0 ? `Speaker ${n}` : id;
}

/** Static class strings (Tailwind only emits classes it can see), cycled for files with many speakers. */
export const SPEAKER_STYLES = [
  { chip: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200', bar: 'border-sky-400' },
  { chip: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200', bar: 'border-rose-400' },
  { chip: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200', bar: 'border-emerald-400' },
  { chip: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200', bar: 'border-violet-400' },
  { chip: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200', bar: 'border-amber-400' },
  { chip: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200', bar: 'border-teal-400' },
] as const;

export function speakerStyle(id: string): (typeof SPEAKER_STYLES)[number] {
  return SPEAKER_STYLES[(Math.max(speakerNumber(id), 1) - 1) % SPEAKER_STYLES.length];
}
