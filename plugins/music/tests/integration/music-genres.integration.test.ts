import request from 'supertest';
import { describe, expect, beforeAll, beforeEach, afterAll, afterEach, it } from 'vitest';
import app from '../../../../server/src/index';
import { query } from '../../../../server/src/db';
import {
  DEFAULT_USER_ID,
  resetIntegrationDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
} from '../../../../server/tests/helpers/testDb';
import { createTestUser } from '../../../../server/tests/helpers/auth';
import { getMusicSettings } from '../../services/scrobbles';
import { setGenreProvider, whenGenreBackfillDone } from '../../services/genres';
import { ProviderUnavailableError } from '../../services/albumProviders';
import type { GenreMatch } from '../../services/genreProviders';
import { server } from '../../server';

const BASE = '/apis/mlj_1';
const T0 = 1714564800; // 2024-05-01T12:00:00Z
const DAY = 86_400;
const api = (path: string) => `/api/v1/music${path}`;

let key = '';
let lookups: string[] = [];

/** A fake MusicBrainz: genres per album title and per artist name; unknown names aren't found. */
function useCatalog(albums: Record<string, string[]>, artists: Record<string, string[]>, opts: { failArtist?: string } = {}) {
  const hit = (table: Record<string, string[]>, name: string): GenreMatch | null =>
    name in table ? { mbid: '00000000-0000-0000-0000-000000000001', genres: table[name] } : null;
  setGenreProvider({
    album: async ({ album }) => {
      lookups.push(`album:${album}`);
      return hit(albums, album);
    },
    artist: async (name) => {
      lookups.push(`artist:${name}`);
      if (name === opts.failArtist) throw new ProviderUnavailableError('down');
      return hit(artists, name);
    },
  });
}

const push = (title: string, album: string | undefined, artists: string[], offset = 0) =>
  request(app).post(`${BASE}/newscrobble`).send({ title, artists, album, time: T0 + offset, key });
const backfill = async (body: object = {}) => {
  const res = await request(app).post(api('/genres/backfill')).send(body);
  await whenGenreBackfillDone();
  return res;
};
const playGenres = async () =>
  Object.fromEntries(
    ((await request(app).get(api('/library?view=songs'))).body.rows as { name: string; song_key: string }[]).map((r) => [r.name, r.song_key]),
  );
const songGenres = async (title: string) => {
  const keys = await playGenres();
  return ((await request(app).get(api(`/song?${new URLSearchParams({ song_key: keys[title] })}`))).body.genres as { name: string }[]).map((g) => g.name);
};
const albumRef = async (title: string) =>
  (await query(`SELECT album_key FROM music_scrobbles WHERE title = $1`, [title])).rows[0].album_key as string;

/** Three plays on Group Therapy (album: trance), one off-album, one by an artist whose album has no genres. */
async function seed() {
  await push('Sun & Moon', 'Group Therapy', ['Above & Beyond'], 0);
  await push('Thing Called Love', 'Group Therapy', ['Above & Beyond'], 300);
  await push('Alone Tonight', 'Group Therapy', ['Above & Beyond', 'Richard Bedford'], 600);
  await push('Loose Single', undefined, ['Above & Beyond'], 900);
  await push('Ghost Voices', 'Untagged Album', ['Virtual Self'], DAY);
}

describe('music genres', () => {
  beforeAll(setupIntegrationDatabase);
  beforeEach(async () => {
    await resetIntegrationDatabase();
    key = (await getMusicSettings(DEFAULT_USER_ID)).scrobbler_key;
    lookups = [];
  });
  afterEach(() => setGenreProvider(null));
  afterAll(teardownIntegrationDatabase);

  it('refuses to look anything up without a configured catalog', async () => {
    await seed();
    expect((await request(app).post(api('/genres/backfill')).send({})).status).toBe(503);
    expect((await request(app).get(api('/genres/status'))).body.enabled).toBe(false);
  });

  it('looks up first artists, then albums, most played first, and reports progress', async () => {
    await seed();
    useCatalog({ 'Group Therapy': ['trance', 'progressive trance'] }, { 'Above & Beyond': ['trance'], 'Virtual Self': ['electronic', 'hardcore'] });
    expect((await backfill()).status).toBe(202);
    // Richard Bedford is only ever featured: not part of the backfill.
    expect(lookups).toEqual(['artist:Above & Beyond', 'artist:Virtual Self', 'album:Group Therapy', 'album:Untagged Album']);
    const status = (await request(app).get(api('/genres/status'))).body;
    expect(status.job).toMatchObject({ state: 'done', processed: 4, total: 4, found: 3, not_found: 1, skipped: 0 });
    expect(status.counts).toEqual({
      artists: { found: 2, not_found: 0 },
      albums: { found: 1, not_found: 1 },
      pending: 0,
      plays: 5,
      plays_with_genres: 5,
    });

    // A second run has nothing left; "retry" forgets what wasn't found.
    lookups = [];
    await backfill();
    expect(lookups).toEqual([]);
    await backfill({ retry_missing: true });
    expect(lookups).toEqual(['album:Untagged Album']);
  });

  it('gives a play its album’s genres, else its first artist’s', async () => {
    await seed();
    useCatalog({ 'Group Therapy': ['trance', 'progressive trance'] }, { 'Above & Beyond': ['progressive house'], 'Virtual Self': ['hardcore'] });
    await backfill();
    expect(await songGenres('Sun & Moon')).toEqual(['progressive trance', 'trance']);
    // No album: the artist's.
    expect(await songGenres('Loose Single')).toEqual(['progressive house']);
    // An album nobody tagged: the artist's.
    expect(await songGenres('Ghost Voices')).toEqual(['hardcore']);
  });

  it('skips what MusicBrainz could not answer for and keeps it for the next run', async () => {
    await seed();
    useCatalog({}, { 'Virtual Self': ['hardcore'] }, { failArtist: 'Above & Beyond' });
    await backfill();
    expect((await request(app).get(api('/genres/status'))).body.job).toMatchObject({ state: 'done', skipped: 1 });
    lookups = [];
    useCatalog({}, { 'Above & Beyond': ['trance'] });
    await backfill();
    expect(lookups).toEqual(['artist:Above & Beyond']);
  });

  it('looks up a newly scrobbled play’s artist and album in the background', async () => {
    useCatalog({ 'Group Therapy': ['trance'] }, { 'Above & Beyond': ['trance'] });
    await push('Sun & Moon', 'Group Therapy', ['Above & Beyond']);
    for (let i = 0; i < 50 && lookups.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
    await new Promise((r) => setTimeout(r, 50));
    expect(lookups.sort()).toEqual(['album:Group Therapy', 'artist:Above & Beyond']);
    expect((await query(`SELECT kind, status FROM music_genres ORDER BY kind`)).rows).toEqual([
      { kind: 'album', status: 'matched' },
      { kind: 'artist', status: 'matched' },
    ]);
  });

  describe('corrections', () => {
    beforeEach(async () => {
      await seed();
      useCatalog({ 'Group Therapy': ['trance'] }, { 'Above & Beyond': ['progressive house'] });
      await backfill();
    });

    it('replace an album’s genres, survive a re-lookup, and go back to the catalog’s on reset', async () => {
      const ref = await albumRef('Sun & Moon');
      const saved = await request(app).put(api('/genres')).send({ kind: 'album', ref, genres: [' Uplifting  Trance ', 'uplifting trance', 'Vocal Trance'] });
      expect(saved.status).toBe(200);
      expect(saved.body).toEqual({ genres: ['uplifting trance', 'vocal trance'], catalog_genres: ['trance'], edited: true, lookup: 'found' });
      await backfill({ retry_missing: true });
      expect(await songGenres('Sun & Moon')).toEqual(['uplifting trance', 'vocal trance']);
      const album = (await request(app).get(api(`/album-view?${new URLSearchParams({ ref })}`))).body;
      expect(album.genres.genres).toEqual(['uplifting trance', 'vocal trance']);
      expect(album.artist_genres).toEqual(['progressive house']);

      const reset = await request(app).put(api('/genres')).send({ kind: 'album', ref, genres: null });
      expect(reset.body).toMatchObject({ genres: ['trance'], edited: false });
    });

    it('let an album have no genres, so its plays take the artist’s', async () => {
      const ref = await albumRef('Sun & Moon');
      await request(app).put(api('/genres')).send({ kind: 'album', ref, genres: [] });
      expect(await songGenres('Sun & Moon')).toEqual(['progressive house']);
    });

    it('edit an artist by any spelling of their name, including one never looked up', async () => {
      await request(app).put(api('/genres')).send({ kind: 'artist', ref: 'ABOVE & BEYOND ', genres: ['anjunabeats'] });
      expect(await songGenres('Loose Single')).toEqual(['anjunabeats']);
      const artist = (await request(app).get(api('/artist?name=Above%20%26%20Beyond'))).body;
      expect(artist.genres).toEqual({ genres: ['anjunabeats'], catalog_genres: ['progressive house'], edited: true, lookup: 'found' });
      expect(artist.play_genres.map((g: { name: string }) => g.name)).toEqual(['trance', 'anjunabeats']);

      const featured = await request(app).put(api('/genres')).send({ kind: 'artist', ref: 'Richard Bedford', genres: ['vocal'] });
      expect(featured.body).toEqual({ genres: ['vocal'], catalog_genres: [], edited: true, lookup: null });
    });

    it('refuse an artist’s “Unknown album” and bad input', async () => {
      expect((await request(app).put(api('/genres')).send({ kind: 'album', ref: '|above & beyond', genres: ['x'] })).status).toBe(400);
      expect((await request(app).put(api('/genres')).send({ kind: 'song', ref: 'x', genres: [] })).status).toBe(400);
      expect((await request(app).put(api('/genres')).send({ kind: 'artist', ref: 'x', genres: 'trance' })).status).toBe(400);
    });
  });

  describe('stats', () => {
    beforeEach(async () => {
      await seed();
      useCatalog({ 'Group Therapy': ['trance', 'progressive trance'] }, { 'Above & Beyond': ['trance'], 'Virtual Self': ['hardcore'] });
      await backfill();
    });

    it('count a play in full toward each of its genres in Top genres', async () => {
      const stats = (await request(app).get(api('/stats'))).body;
      expect(stats.top_genres).toEqual([
        { name: 'trance', plays: 4, listened_seconds: 0, artists: 1 },
        { name: 'progressive trance', plays: 3, listened_seconds: 0, artists: 1 },
        { name: 'hardcore', plays: 1, listened_seconds: 0, artists: 1 },
      ]);
      // Bounded by the period: only the second day.
      const day2 = new Date((T0 + DAY) * 1000).toISOString().slice(0, 10);
      const later = (await request(app).get(api(`/stats?from=${day2}&to=${day2}`))).body;
      expect(later.top_genres.map((g: { name: string }) => g.name)).toEqual(['hardcore']);
    });

    it('filter every Library view by genre', async () => {
      const names = async (view: string, genre: string) =>
        ((await request(app).get(api(`/library?view=${view}&genre=${encodeURIComponent(genre)}`))).body.rows as { name: string }[]).map((r) => r.name).sort();
      expect(await names('songs', 'Progressive Trance')).toEqual(['Alone Tonight', 'Sun & Moon', 'Thing Called Love']);
      expect(await names('songs', 'trance')).toEqual(['Alone Tonight', 'Loose Single', 'Sun & Moon', 'Thing Called Love']);
      expect(await names('artists', 'progressive trance')).toEqual(['Above & Beyond', 'Richard Bedford']);
      expect(await names('albums', 'hardcore')).toEqual(['Untagged Album']);
      expect(await names('songs', 'polka')).toEqual([]);
    });

    it('list every genre and show one on its own page', async () => {
      expect((await request(app).get(api('/genres'))).body).toEqual([
        { name: 'trance', plays: 4 },
        { name: 'progressive trance', plays: 3 },
        { name: 'hardcore', plays: 1 },
      ]);
      const genre = (await request(app).get(api('/genre?name=Progressive%20Trance'))).body;
      expect(genre).toMatchObject({ name: 'progressive trance', plays: 3, unique_songs: 3, unique_artists: 2, rank: 2, genres_total: 3 });
      expect(genre.artists).toEqual([{ name: 'Above & Beyond', plays: 3 }, { name: 'Richard Bedford', plays: 1 }]);
      expect(genre.albums.map((a: { name: string }) => a.name)).toEqual(['Group Therapy']);
      expect(genre.related).toEqual([{ name: 'trance', plays: 3 }]);
      expect(genre.daily).toEqual([{ date: '2024-05-01', plays: 3 }]);
      expect((await request(app).get(api('/genre?name=polka'))).status).toBe(404);
      expect((await request(app).get(api('/ties?genre=trance'))).status).toBe(200);
    });

    it('show a play’s genres on its page and in its session', async () => {
      const id = (await query(`SELECT id, session_id FROM music_scrobbles WHERE title = 'Loose Single'`)).rows[0];
      expect((await request(app).get(api(`/scrobbles/${id.id}`))).body.genres).toEqual(['trance']);
      const tracks = (await request(app).get(api(`/sessions/${id.session_id}/tracks`))).body as { title: string; genres: string[] }[];
      expect(tracks.find((t) => t.title === 'Sun & Moon')?.genres).toEqual(['trance', 'progressive trance']);
    });

    it('draw genres over time by each play’s main genre only', async () => {
      const stream = (await request(app).get(api('/insights/genres?from=2024-05-01&to=2024-05-02'))).body;
      expect(stream.bucket).toBe('week');
      // Group Therapy is "trance, progressive trance": its plays count once, as trance.
      expect(stream.genres).toEqual(['trance', 'hardcore']);
      expect(stream.plays).toBe(5);
      expect(stream.plays_with_genres).toBe(5);
      // Plays per day from the period's first day, one array per band.
      expect(stream.first).toBe('2024-05-01');
      expect(stream.daily).toEqual([[4, 0], [0, 1]]);
      expect(stream.other_daily).toEqual([0, 0]);
      expect(stream.other).toEqual({ plays: 0, genres: 0, top: [] });
    });

    it('fold main genres past the eighth into Other, naming the biggest', async () => {
      // Ten more one-play artists, each with a main genre of their own.
      for (let n = 0; n < 10; n++) {
        await push(`Song ${n}`, undefined, [`Artist ${n}`], 2 * DAY + n * 300);
        await request(app).put(api('/genres')).send({ kind: 'artist', ref: `Artist ${n}`, genres: [`g${n}`, 'ignored second'] });
      }
      const stream = (await request(app).get(api('/insights/genres'))).body;
      expect(stream.genres).toEqual(['trance', 'g0', 'g1', 'g2', 'g3', 'g4', 'g5', 'g6']);
      // All time: from the first play (May 1) to the last (May 3). Hardcore on May 2, g7-g9 on May 3.
      expect(stream.first).toBe('2024-05-01');
      expect(stream.other_daily).toEqual([0, 1, 3]);
      expect(stream.daily[1]).toEqual([0, 0, 1]);
      // The period's Other: what's outside the bands, biggest first.
      expect(stream.other).toEqual({
        plays: 4,
        genres: 4,
        top: [{ name: 'g7', plays: 1 }, { name: 'g8', plays: 1 }, { name: 'g9', plays: 1 }, { name: 'hardcore', plays: 1 }],
      });
    });

    it('count genres heard for the first time in Discovery', async () => {
      const d = (await request(app).get(api('/insights/discovery?from=2024-05-01&to=2024-05-02'))).body;
      expect(d.totals.new_genres).toBe(3);
    });
  });

  it('keeps lookups and corrections through a backup, and Start Over removes them', async () => {
    await seed();
    useCatalog({ 'Group Therapy': ['trance'] }, { 'Above & Beyond': ['progressive house'] });
    await backfill();
    await request(app).put(api('/genres')).send({ kind: 'artist', ref: 'Virtual Self', genres: ['hardcore'] });
    const payload = await server.backupExport!({ user_id: DEFAULT_USER_ID });
    expect((payload as { genres: unknown[] }).genres).toHaveLength(4);

    await query('DELETE FROM music_genres');
    setGenreProvider(null);
    await server.backupImport!({ user_id: DEFAULT_USER_ID }, payload);
    expect(await songGenres('Ghost Voices')).toEqual(['hardcore']);
    expect(await songGenres('Sun & Moon')).toEqual(['trance']);
    // Restoring again changes nothing.
    await server.backupImport!({ user_id: DEFAULT_USER_ID }, payload);
    expect((await query('SELECT COUNT(*)::int AS n FROM music_genres')).rows[0].n).toBe(4);

    const res = await request(app)
      .post('/api/v1/backup/start-over')
      .send({ first_confirmation: 'DELETE MY DATA', second_confirmation: 'START OVER', options: { delete_music_checkins: true } });
    expect(res.status).toBe(200);
    expect((await query('SELECT 1 FROM music_genres')).rowCount).toBe(0);
  });

  it('never mixes one user’s genres into another’s plays', async () => {
    await seed();
    useCatalog({}, {});
    await request(app).put(api('/genres')).send({ kind: 'artist', ref: 'Above & Beyond', genres: ['trance'] });
    const other = await createTestUser('other');
    const otherKey = (await getMusicSettings(other.id)).scrobbler_key;
    await request(app).post(`${BASE}/newscrobble`).send({ title: 'Sun & Moon', artists: ['Above & Beyond'], time: T0, key: otherKey });
    const stats = (await request(app).get(api('/stats')).set('Cookie', other.cookie)).body;
    expect(stats.top_genres).toEqual([]);
    expect((await request(app).put(api('/genres')).set('Cookie', other.cookie).send({ kind: 'artist', ref: 'Above & Beyond', genres: ['pop'] })).status).toBe(200);
    expect(await songGenres('Sun & Moon')).toEqual(['trance']);
  });
});
