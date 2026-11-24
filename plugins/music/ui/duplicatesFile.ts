import type { DuplicatePlay, RemovedPlay } from './types';

/**
 * Plays as a Maloja-style export, which Settings → Import from Maloja reads
 * back (keeping each play's source and timezone).
 */
export function removedPlaysFile(plays: Array<DuplicatePlay | RemovedPlay>): string {
  return JSON.stringify(
    {
      wherewewere: { kind: 'removed-duplicate-plays', exported_at: new Date().toISOString() },
      scrobbles: [...plays]
        .sort((a, b) => a.played_at.localeCompare(b.played_at))
        .map((p) => ({
          time: Math.floor(new Date(p.played_at).getTime() / 1000),
          track: {
            title: p.title,
            artists: p.artists,
            album: p.album ? { albumtitle: p.album, artists: p.album_artists } : null,
            length: p.track_length,
          },
          duration: p.listened_for,
          source: p.source,
          timezone: p.timezone,
        })),
    },
    null,
    2,
  );
}
