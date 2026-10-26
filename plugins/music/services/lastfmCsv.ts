/**
 * Music plugin — Last.fm CSV import.
 *
 * Reads the history export produced by Last.fm export tools
 * (`uts,utc_time,artist,artist_mbid,album,album_mbid,track,track_mbid`).
 * Last.fm keeps each play's artist as one string, so "Above & Beyond" stays
 * whole. Rows that can't be read are counted, not fatal.
 */

import type { ScrobbleInput } from './scrobbles';
import type { ParsedImport } from './importParser';

/** RFC 4180 reader: quoted fields, doubled quotes, newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  row.push(field);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

export function parseLastfmCsv(text: string): ParsedImport {
  const rows = parseCsv(text);
  const header = (rows.shift() ?? []).map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const [uts, artist, album, track] = ['uts', 'artist', 'album', 'track'].map(col);
  if (uts < 0 || artist < 0 || track < 0) throw new Error('Not a Last.fm CSV export');

  const scrobbles: ScrobbleInput[] = [];
  let skipped = 0;
  for (const r of rows) {
    const time = Number(r[uts]);
    const name = (r[artist] ?? '').trim();
    const title = (r[track] ?? '').trim();
    if (!name || !title || !Number.isFinite(time) || time <= 0) {
      skipped++;
      continue;
    }
    const albumTitle = album >= 0 ? (r[album] ?? '').trim() : '';
    scrobbles.push({
      playedAt: new Date(time * 1000),
      title,
      artists: [name],
      album: albumTitle || null,
      // Last.fm has no album artist; the track's artist is the closest match.
      albumArtists: albumTitle ? [name] : [],
      source: 'lastfm',
    });
  }
  if (scrobbles.length === 0 && skipped === 0) throw new Error('No scrobbles found in file');
  return { scrobbles, skipped };
}
