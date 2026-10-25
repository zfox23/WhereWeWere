import { describe, expect, it } from 'vitest';
import {
  SERVER_INFO,
  newScrobbleSuccess,
  parseDateRange,
  parseNewScrobble,
  scrobbleListResponse,
  toScrobbleListEntry,
} from '../services/scrobblerApi';
import type { StoredScrobble } from '../services/scrobbles';

const NOW = new Date('2024-05-01T12:00:00Z');

describe('parseNewScrobble', () => {
  it('maps a full multi-scrobbler payload', () => {
    const parsed = parseNewScrobble({
      title: ' Song ',
      artists: ['A', 'B'],
      album: 'Album',
      albumartists: ['A'],
      time: 1714564800,
      length: 93,
      duration: 92.4,
      key: 'secret',
    }, NOW);
    expect(parsed).toEqual({
      ok: true,
      scrobble: {
        playedAt: new Date(1714564800 * 1000),
        title: 'Song',
        artists: ['A', 'B'],
        album: 'Album',
        albumArtists: ['A'],
        trackLength: 93,
        listenedFor: 92,
        source: 'multi-scrobbler',
      },
    });
  });

  it('accepts the minimal payload and defaults the time to now', () => {
    const parsed = parseNewScrobble({ title: 'T', artists: ['A'] }, NOW);
    expect(parsed.ok && parsed.scrobble).toMatchObject({
      playedAt: NOW, album: null, albumArtists: [], trackLength: null, listenedFor: null,
    });
  });

  it('accepts a single `artist` string and drops blank artists', () => {
    const parsed = parseNewScrobble({ title: 'T', artist: 'Solo' }, NOW);
    expect(parsed.ok && parsed.scrobble.artists).toEqual(['Solo']);
    const blanks = parseNewScrobble({ title: 'T', artists: ['', '  ', 'A'] }, NOW);
    expect(blanks.ok && blanks.scrobble.artists).toEqual(['A']);
  });

  it.each([
    [{ artists: ['A'] }, 'Missing title'],
    [{ title: 'T' }, 'Missing artists'],
    [{ title: 'T', artists: [] }, 'Missing artists'],
    [{ title: 'T', artists: ['A'], time: 'soon' }, 'Invalid time'],
    [{ title: 'T', artists: ['A'], time: -5 }, 'Invalid time'],
    [null, 'Missing title'],
  ])('rejects %j', (body, reason) => {
    expect(parseNewScrobble(body, NOW)).toEqual({ ok: false, reason });
  });
});

describe('responses', () => {
  it('reports a Maloja-compatible server version of at least 3.0.0', () => {
    expect(Number(SERVER_INFO.version[0])).toBeGreaterThanOrEqual(3);
    expect(SERVER_INFO.db_status).toMatchObject({ healthy: true, rebuildinprogress: false });
  });

  it('describes the stored track in the success body', () => {
    const body = newScrobbleSuccess({
      playedAt: NOW, title: 'T', artists: ['A'], album: 'Alb', albumArtists: [],
    });
    expect(body).toMatchObject({
      status: 'success',
      track: { title: 'T', artists: ['A'], album: { albumtitle: 'Alb', artists: ['A'] } },
      warnings: [],
    });
  });

  const row = (overrides: Partial<StoredScrobble> = {}): StoredScrobble => ({
    played_at: new Date(1714564800 * 1000),
    title: 'T',
    artists: ['A'],
    album: null,
    album_artists: [],
    track_length: null,
    listened_for: null,
    ...overrides,
  });

  it('serialises a scrobble list entry with optional fields only when known', () => {
    expect(toScrobbleListEntry(row())).toEqual({ time: 1714564800, track: { artists: ['A'], title: 'T' } });
    expect(toScrobbleListEntry(row({ album: 'Alb', track_length: 90, listened_for: 80 }))).toEqual({
      time: 1714564800,
      track: { artists: ['A'], title: 'T', album: { albumtitle: 'Alb', artists: ['A'] }, length: 90 },
      duration: 80,
    });
  });

  it('links pages and ends with a null next_page', () => {
    const q = new URLSearchParams({ in: '2024/05' });
    const middle = scrobbleListResponse([row()], 1, 50, true, q);
    expect(middle.pagination.next_page).toBe('/apis/mlj_1/scrobbles?in=2024%2F05&page=2&perpage=50');
    expect(middle.pagination.prev_page).toContain('page=0');
    const last = scrobbleListResponse([row()], 0, 50, false, q);
    expect(last.pagination.next_page).toBeNull();
    expect(last.pagination.prev_page).toBeNull();
  });
});

describe('parseDateRange', () => {
  it('covers a single day half-open in UTC', () => {
    expect(parseDateRange('2024/05/01')).toEqual({
      from: new Date('2024-05-01T00:00:00Z'),
      until: new Date('2024-05-02T00:00:00Z'),
    });
  });

  it('covers a month and a year, including rollover', () => {
    expect(parseDateRange('2024/12')).toEqual({
      from: new Date('2024-12-01T00:00:00Z'),
      until: new Date('2025-01-01T00:00:00Z'),
    });
    expect(parseDateRange('2024')?.until).toEqual(new Date('2025-01-01T00:00:00Z'));
  });

  it('accepts dashes and rolls a month-end day over', () => {
    expect(parseDateRange('2024-01-31')?.until).toEqual(new Date('2024-02-01T00:00:00Z'));
  });

  it.each(['', 'yesterday', '2024/13', '2024/01/32', 5, undefined])('rejects %j', (raw) => {
    expect(parseDateRange(raw)).toBeNull();
  });
});
