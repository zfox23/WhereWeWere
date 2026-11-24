import request from 'supertest';
import { describe, expect, beforeAll, beforeEach, afterAll, it } from 'vitest';
import app from '../../../../server/src/index';
import { query } from '../../../../server/src/db';
import { runAsUser } from '../../../../server/src/auth/context';
import {
  DEFAULT_USER_ID,
  resetIntegrationDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
} from '../../../../server/tests/helpers/testDb';
import { createTestUser, type TestUser } from '../../../../server/tests/helpers/auth';
import { insertScrobblesBulk, type ScrobbleInput } from '../../services/scrobbles';
import { removedPlaysFile } from '../../ui/duplicatesFile';

const T0 = Date.UTC(2018, 10, 27, 20, 0, 0); // 2018-11-27T20:00:00Z
const at = (seconds: number) => new Date(T0 + seconds * 1000);

const play = (title: string, seconds: number, over: Partial<ScrobbleInput> = {}): ScrobbleInput => ({
  playedAt: at(seconds),
  title,
  artists: ['Said the Sky'],
  album: 'Healing',
  albumArtists: ['Said the Sky'],
  source: 'lastfm',
  ...over,
});

const scan = async () => (await request(app).get('/api/v1/music/duplicates')).body;
const titlesLeft = async () =>
  (await query(`SELECT title, source, played_at FROM music_scrobbles WHERE user_id = $1 ORDER BY played_at`, [DEFAULT_USER_ID])).rows;

describe('duplicate plays', () => {
  beforeAll(setupIntegrationDatabase);
  beforeEach(resetIntegrationDatabase);
  afterAll(teardownIntegrationDatabase);

  it('collapses a burst of one song seconds apart to its first play, and changes nothing while scanning', async () => {
    await insertScrobblesBulk(DEFAULT_USER_ID, Array.from({ length: 10 }, (_, i) => play('Rush Over Me', i * 5)));
    const body = await scan();
    expect(body.removable).toBe(9);
    expect(body.bursts).toHaveLength(1);
    const [burst] = body.bursts;
    expect(burst).toMatchObject({ title: 'Rush Over Me', artists: ['Said the Sky'], length: null, threshold: 30 });
    expect(burst.keep.map((p: any) => p.played_at)).toEqual([at(0).toISOString()]);
    expect(burst.remove).toHaveLength(9);
    expect(await titlesLeft()).toHaveLength(10);
  });

  it('leaves genuine repeats alone: a gap of half the song (or 30 s with no length) is possible', async () => {
    await insertScrobblesBulk(DEFAULT_USER_ID, [
      // Unknown length: a minute apart is a plausible skip-back.
      play('Unknown Length', 0),
      play('Unknown Length', 60),
      // 200 s long: 90 s after a play is too soon, 210 s after the kept one isn't.
      play('Known Length', 1000, { trackLength: 200 }),
      play('Known Length', 1090, { trackLength: 200 }),
      play('Known Length', 1300, { trackLength: 200 }),
      // A long song still only needs four minutes.
      play('Long Song', 3000, { trackLength: 900 }),
      play('Long Song', 3250, { trackLength: 900 }),
    ]);
    const body = await scan();
    expect(body.removable).toBe(1);
    expect(body.bursts[0]).toMatchObject({ title: 'Known Length', length: 200, threshold: 100 });
    expect(body.bursts[0].remove.map((p: any) => p.played_at)).toEqual([at(1090).toISOString()]);
  });

  it('borrows the song length from its other plays', async () => {
    await insertScrobblesBulk(DEFAULT_USER_ID, [
      play('Borrowed', 0, { source: 'multi-scrobbler', trackLength: 300, listenedFor: 300 }),
      // 30 s apart with no length of their own: flagged only because the song is 5 minutes long.
      play('Borrowed', 10_000),
      play('Borrowed', 10_045),
    ]);
    expect((await scan()).removable).toBe(1);
  });

  it('keeps the live scrobble over the Last.fm copy of the same listen', async () => {
    await insertScrobblesBulk(DEFAULT_USER_ID, [
      play('Same Listen', 0),
      play('Same Listen', 8, { source: 'multi-scrobbler', trackLength: 240, listenedFor: 230 }),
    ]);
    const [burst] = (await scan()).bursts;
    expect(burst.keep.map((p: any) => p.source)).toEqual(['multi-scrobbler']);
    expect(burst.remove.map((p: any) => p.source)).toEqual(['lastfm']);
  });

  it('never removes a hand entry or a play with a note, and skips bursts with nothing to remove', async () => {
    const manual = await request(app).post('/api/v1/music/scrobbles').send({
      title: 'Heard Live', artists: ['Said the Sky'], played_at: at(5).toISOString(), companions: ['Sam'], force: true,
    });
    expect(manual.status).toBe(201);
    await insertScrobblesBulk(DEFAULT_USER_ID, [play('Heard Live', 0), play('Heard Live', 10)]);
    await insertScrobblesBulk(DEFAULT_USER_ID, [play('Noted', 500, { note: 'first' }), play('Noted', 505, { note: 'second' })]);
    const body = await scan();
    expect(body.bursts).toHaveLength(1);
    expect(body.bursts[0].keep.map((p: any) => p.source)).toEqual(['manual']);
    expect(body.bursts[0].keep[0].protected).toBe(true);
    expect(body.bursts[0].remove).toHaveLength(2);
  });

  it('removes only plays a fresh scan still flags, regroups sessions, and hands back a file that restores them', async () => {
    await insertScrobblesBulk(DEFAULT_USER_ID, [
      ...Array.from({ length: 5 }, (_, i) => play('Rush Over Me', i * 3)),
      play('Other Song', 200),
    ]);
    const body = await scan();
    const flagged = body.bursts[0].remove.map((p: any) => p.id);
    const keeper = body.bursts[0].keep[0].id;
    const other = (await query(`SELECT id FROM music_scrobbles WHERE title = 'Other Song'`)).rows[0].id;

    const res = await request(app).post('/api/v1/music/duplicates/remove').send({ ids: [...flagged, keeper, other] });
    expect(res.status).toBe(200);
    expect(res.body.removed).toBe(4);
    expect(res.body.plays.map((p: any) => p.id).sort()).toEqual([...flagged].sort());
    expect(res.body.plays[0]).toMatchObject({ title: 'Rush Over Me', artists: ['Said the Sky'], album: 'Healing', source: 'lastfm' });
    expect((await titlesLeft()).map((r: any) => r.title)).toEqual(['Rush Over Me', 'Other Song']);
    expect((await query(`SELECT track_count FROM music_sessions WHERE user_id = $1`, [DEFAULT_USER_ID])).rows).toEqual([{ track_count: 2 }]);
    expect((await scan()).removable).toBe(0);

    // The download goes back in through the Maloja import, source and all.
    const restored = await request(app)
      .post('/api/v1/music/import/scrobbles')
      .attach('file', Buffer.from(removedPlaysFile(res.body.plays)), 'removed.json');
    expect(restored.body).toMatchObject({ inserted: 4, skipped: 0 });
    const rows = await titlesLeft();
    expect(rows).toHaveLength(6);
    expect(new Set(rows.map((r: any) => r.source))).toEqual(new Set(['lastfm']));
  });

  it('rejects a malformed request', async () => {
    expect((await request(app).post('/api/v1/music/duplicates/remove').send({ ids: [] })).status).toBe(400);
    expect((await request(app).post('/api/v1/music/duplicates/remove').send({ ids: ['nope'] })).status).toBe(400);
  });

  describe('with another user', () => {
    let other: TestUser;
    beforeEach(async () => {
      other = await createTestUser('other');
    });

    it("neither shows nor removes another user's duplicates", async () => {
      await runAsUser(other.id, () => insertScrobblesBulk(other.id, [play('Theirs', 0), play('Theirs', 5)]));
      expect((await scan()).removable).toBe(0);
      const theirs = (await query(`SELECT id FROM music_scrobbles WHERE user_id = $1 ORDER BY played_at`, [other.id])).rows.map((r: any) => r.id);
      const res = await request(app).post('/api/v1/music/duplicates/remove').send({ ids: theirs });
      expect(res.body.removed).toBe(0);
      expect((await query(`SELECT COUNT(*)::int AS n FROM music_scrobbles WHERE user_id = $1`, [other.id])).rows[0].n).toBe(2);
      // And they see their own.
      const mine = await request(app).get('/api/v1/music/duplicates').set('Cookie', other.cookie);
      expect(mine.body.removable).toBe(1);
    });
  });
});
