import type { ListeningBefore } from '../types';

/**
 * Show each play on at most one timeline card: walking the check-ins oldest
 * first, drop plays an earlier check-in already shows, so the first check-in
 * of a cluster (usually the arrival) keeps them. A check-in left with no plays
 * maps to null.
 */
export function dedupeListening(
  listening: Record<string, ListeningBefore | null>,
): Record<string, ListeningBefore | null> {
  const entries = Object.entries(listening).filter((e): e is [string, ListeningBefore] => e[1] !== null);
  entries.sort(([idA, a], [idB, b]) => a.anchor_time - b.anchor_time || idA.localeCompare(idB));
  const shown = new Set<string>();
  const out: Record<string, ListeningBefore | null> = {};
  for (const [id, entry] of entries) {
    const key = (t: ListeningBefore['tracks'][number]) => `${entry.session_id}|${t.time}|${t.title}`;
    const tracks = entry.tracks.filter((t) => !shown.has(key(t)));
    entry.tracks.forEach((t) => shown.add(key(t)));
    out[id] = tracks.length === entry.tracks.length ? entry : tracks.length > 0 ? { ...entry, tracks } : null;
  }
  return out;
}
