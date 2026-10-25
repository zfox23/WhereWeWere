/**
 * Music plugin — scrobble-history file import.
 *
 * Reads the JSON export produced by Maloja
 * (`{ maloja: {...}, scrobbles: [{ time, track: { artists, title, album, length }, duration }] }`)
 * or a bare array of the same entries. Rows that can't be read are counted,
 * not fatal.
 */

import type { ScrobbleInput } from './scrobbles';

export interface ParsedImport {
  scrobbles: ScrobbleInput[];
  skipped: number;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(str).filter((v): v is string => v !== null) : [];
}

function seconds(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

export function parseScrobbleExport(text: string): ParsedImport {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('File is not valid JSON');
  }
  const list = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as { scrobbles?: unknown }).scrobbles)
      ? (data as { scrobbles: unknown[] }).scrobbles
      : null;
  if (!list) throw new Error('No scrobbles found in file');

  const scrobbles: ScrobbleInput[] = [];
  let skipped = 0;
  for (const entry of list) {
    const e = (entry && typeof entry === 'object' ? entry : {}) as Record<string, any>;
    const track = (e.track && typeof e.track === 'object' ? e.track : {}) as Record<string, any>;
    const time = Number(e.time);
    const title = str(track.title);
    const artists = strList(track.artists);
    if (!title || artists.length === 0 || !Number.isFinite(time) || time <= 0) {
      skipped++;
      continue;
    }
    const album = track.album;
    scrobbles.push({
      playedAt: new Date(time * 1000),
      title,
      artists,
      album: typeof album === 'string' ? str(album) : str(album?.albumtitle),
      albumArtists: typeof album === 'object' && album ? strList(album.artists) : [],
      trackLength: seconds(track.length),
      listenedFor: seconds(e.duration),
      source: 'import',
    });
  }
  return { scrobbles, skipped };
}
