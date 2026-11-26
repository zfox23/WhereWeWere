import request from 'supertest';
import { describe, expect, beforeAll, beforeEach, afterAll, it } from 'vitest';
import app from '../../../../server/src/index';
import { query } from '../../../../server/src/db';
import {
  DEFAULT_USER_ID,
  resetIntegrationDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
} from '../../../../server/tests/helpers/testDb';
import { getMusicSettings } from '../../services/scrobbles';

const BASE = '/apis/mlj_1';
const T0 = 1714564800; // 2024-05-01T12:00:00Z
const DAY = 86_400;
const api = (path: string) => `/api/v1/music${path}`;

let key = '';
const push = (title: string, album: string | undefined, artists: string[], at: number) =>
  request(app).post(`${BASE}/newscrobble`).send({ title, artists, album, time: at, key });

/**
 * "Big Album": ten songs, Track 0 played ten times down to Track 9 once, over
 * the first ten days of May; one more play of Track 0 on June 1.
 */
async function seed() {
  for (let t = 0; t < 10; t++) {
    for (let n = 0; n < 10 - t; n++) await push(`Track ${t}`, 'Big Album', ['Band'], T0 + n * DAY + t * 300);
  }
  await push('Track 0', 'Big Album', ['Band'], T0 + 31 * DAY);
}

describe('music plays over time by song', () => {
  beforeAll(setupIntegrationDatabase);
  beforeEach(async () => {
    await resetIntegrationDatabase();
    key = (await getMusicSettings(DEFAULT_USER_ID)).scrobbler_key;
  });
  afterAll(teardownIntegrationDatabase);

  it('gives an album its eight most played songs as bands, and sums the rest', async () => {
    await seed();
    const ref = (await query(`SELECT album_key FROM music_scrobbles LIMIT 1`)).rows[0].album_key;
    const { series } = (await request(app).get(api(`/album-view?${new URLSearchParams({ ref })}`))).body;
    expect(series.bands.map((b: { name: string }) => b.name)).toEqual(
      ['Track 0', 'Track 1', 'Track 2', 'Track 3', 'Track 4', 'Track 5', 'Track 6', 'Track 7'],
    );
    const first = series.bands[0];
    expect(first).toMatchObject({ name: 'Track 0', artists: ['Band'], plays: 11 });
    expect(first.daily).toHaveLength(11);
    expect(first.daily[0]).toEqual({ date: '2024-05-01', plays: 1 });
    expect(first.daily[10]).toEqual({ date: '2024-06-01', plays: 1 });
    // Track 8 (2 plays) and Track 9 (1): May 1 has both, May 2 only Track 8.
    expect(series.other).toEqual({
      plays: 3,
      count: 2,
      daily: [{ date: '2024-05-01', plays: 2 }, { date: '2024-05-02', plays: 1 }],
    });
  });

  it('does the same for an artist, across albums', async () => {
    await push('Solo', undefined, ['Band'], T0);
    await push('Solo', undefined, ['Band'], T0 + DAY);
    await push('Duet', 'Other Album', ['Someone', 'Band'], T0 + 2 * DAY);
    const artist = (await request(app).get(api('/artist?name=Band'))).body;
    expect(artist.series.bands.map((b: { name: string; plays: number }) => [b.name, b.plays])).toEqual([['Solo', 2], ['Duet', 1]]);
    expect(artist.series.other).toEqual({ plays: 0, count: 0, daily: [] });
  });

  it('re-picks the bands by the plays in a window, keeping every day', async () => {
    await seed();
    const ref = (await query(`SELECT album_key FROM music_scrobbles LIMIT 1`)).rows[0].album_key;
    // May 10 only has Track 0 (its 10th play); the rest keep their all-time order.
    const windowed = (
      await request(app).get(api(`/series?${new URLSearchParams({ album_ref: ref, rank_from: '2024-05-10', rank_to: '2024-05-10' })}`))
    ).body;
    expect(windowed.bands[0]).toMatchObject({ name: 'Track 0', plays: 11 });
    // June 1 too: still Track 0, whose days run to June.
    expect(windowed.bands[0].daily.at(-1)).toEqual({ date: '2024-06-01', plays: 1 });

    // A song played only later: in a window of just its days, it leads the artist's bands.
    await push('Late Song', undefined, ['Band'], T0 + 60 * DAY);
    const artist = (
      await request(app).get(api(`/series?${new URLSearchParams({ artist: 'Band', rank_from: '2024-06-30', rank_to: '2024-07-31' })}`))
    ).body;
    expect(artist.bands[0]).toMatchObject({ name: 'Late Song', plays: 1 });
    expect(artist.bands.map((b: { name: string }) => b.name).slice(1, 3)).toEqual(['Track 0', 'Track 1']);
    // It takes a band, so Tracks 7, 8 and 9 are Other.
    expect(artist.other.count).toBe(3);
  });

  it('refuses a series without a window or a subject', async () => {
    expect((await request(app).get(api('/series?artist=Band'))).status).toBe(400);
    expect((await request(app).get(api('/series?artist=Band&rank_from=2024-06-01&rank_to=2024-05-01'))).status).toBe(400);
    expect((await request(app).get(api('/series?rank_from=2024-05-01&rank_to=2024-05-02'))).status).toBe(400);
    expect(
      (await request(app).get(api('/series?list=00000000-0000-0000-0000-000000000000&rank_from=2024-05-01&rank_to=2024-05-02'))).status,
    ).toBe(404);
  });

  it('splits a list by its items, a song on the list taking its own plays from its album', async () => {
    await push('Song A', 'Album X', ['Band'], T0);
    await push('Song A', 'Album X', ['Band'], T0 + DAY);
    await push('Song B', 'Album X', ['Band'], T0 + DAY);
    await push('Song C', 'Album X', ['Band'], T0 + 2 * DAY);
    await push('Elsewhere', 'Album Y', ['Band'], T0);
    const ids = (await query(`SELECT song_key, album_key FROM music_scrobbles WHERE title = 'Song A' LIMIT 1`)).rows[0];
    const listId = (await request(app).post(api('/lists')).send({ name: 'Mix' })).body.id;
    await request(app).post(api(`/lists/${listId}/items`)).send({ kind: 'album', album_ref: ids.album_key });
    await request(app).post(api(`/lists/${listId}/items`)).send({ kind: 'song', song_key: ids.song_key, album_ref: ids.album_key });

    const series = (await request(app).get(api(`/lists/${listId}/series`))).body;
    // The album band is named for the album, and holds only Song B and Song C.
    expect(series.bands.map((b: { key: string; name: string; plays: number }) => [b.key, b.name, b.plays])).toEqual([
      [`album:${ids.album_key}`, 'Album X', 2],
      [`song:${ids.song_key}`, 'Song A', 2],
    ]);
    expect(series.other.plays).toBe(0);

    expect((await request(app).get(api('/lists/not-a-uuid/series'))).status).toBe(400);
    expect((await request(app).get(api('/lists/00000000-0000-0000-0000-000000000000/series'))).status).toBe(404);
  });
});
