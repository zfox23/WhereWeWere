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
import { createTestUser } from '../../../../server/tests/helpers/auth';

const play = async (iso: string, title: string, artists: string[], album: string | null = null) =>
  query(
    `INSERT INTO music_scrobbles (user_id, played_at, title, artists, album, timezone) VALUES ($1, $2, $3, $4, $5, 'UTC')`,
    [DEFAULT_USER_ID, iso, title, artists, album],
  );

const songKeyOf = async (title: string) =>
  (await query(`SELECT song_key FROM music_scrobbles WHERE title = $1 LIMIT 1`, [title])).rows[0].song_key as string;

describe('music: song, artist and album pages', () => {
  beforeAll(setupIntegrationDatabase);
  beforeEach(async () => {
    await resetIntegrationDatabase();
    await play('2024-05-01T09:40:00Z', 'Pump', ['A'], 'First');
    await play('2024-05-02T10:25:00Z', 'Pump', ['A'], 'First');
    await play('2024-05-02T10:30:00Z', 'Lift', ['A', 'B'], 'First');
    await play('2024-06-01T14:05:00Z', 'Latte', ['A'], 'Second');
    await play('2024-06-01T15:00:00Z', 'Solo', ['B'], 'Elsewhere');
  });
  afterAll(teardownIntegrationDatabase);

  it('describes an artist by every play crediting them', async () => {
    const res = await request(app).get('/api/v1/music/artist').query({ name: 'A' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'A', plays: 4, unique_songs: 3, rank: 1, artists_total: 2 });
    expect(res.body.daily).toEqual([
      { date: '2024-05-01', plays: 1 },
      { date: '2024-05-02', plays: 2 },
      { date: '2024-06-01', plays: 1 },
    ]);
    // Most played, then most recently played.
    expect(res.body.songs.map((s: any) => [s.name, s.plays])).toEqual([['Pump', 2], ['Latte', 1], ['Lift', 1]]);
    expect(res.body.albums.map((a: any) => [a.name, a.plays])).toEqual([['First', 3], ['Second', 1]]);
    // B is credited on Lift as a feature, and on Solo.
    const b = await request(app).get('/api/v1/music/artist').query({ name: 'B' });
    expect(b.body).toMatchObject({ plays: 2, rank: 2 });
  });

  it('rejects a missing artist and answers 404 for one never played, or another user\'s', async () => {
    expect((await request(app).get('/api/v1/music/artist')).status).toBe(400);
    expect((await request(app).get('/api/v1/music/artist').query({ name: 'Nobody' })).status).toBe(404);
    const other = await createTestUser('other');
    expect((await request(app).get('/api/v1/music/artist').set('Cookie', other.cookie).query({ name: 'A' })).status).toBe(404);
  });

  it('gives an album its plays per day and the artist\'s other albums', async () => {
    const res = await request(app).get('/api/v1/music/album-view').query({ ref: 'first|a' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      title: 'First', plays: 3,
      first_played_at: '2024-05-01T09:40:00.000Z', last_played_at: '2024-05-02T10:30:00.000Z',
    });
    expect(res.body.daily).toEqual([{ date: '2024-05-01', plays: 1 }, { date: '2024-05-02', plays: 2 }]);
    // Second is A's too; Elsewhere is B's.
    expect(res.body.other_albums.map((a: any) => [a.album_ref, a.name, a.plays])).toEqual([['second|a', 'Second', 1]]);
  });

  describe('ties to companions, places and moods', () => {
    const category = async (name: string) =>
      (await query(`INSERT INTO venue_categories (name) VALUES ($1) RETURNING id`, [name])).rows[0].id as string;
    const checkin = async (categoryId: string, iso: string) => {
      const venue = await query(`INSERT INTO venues (name, latitude, longitude, category_id) VALUES ('V', 1, 1, $1) RETURNING id`, [categoryId]);
      await query(`INSERT INTO checkins (user_id, venue_id, checked_in_at) VALUES ($1, $2, $3)`, [DEFAULT_USER_ID, venue.rows[0].id, iso]);
    };

    it('counts a song\'s and an artist\'s plays around each group\'s check-ins', async () => {
      const gym = await category('Detail Test Gym');
      const cafe = await category('Detail Test Cafe');
      await checkin(gym, '2024-05-02T10:20:00Z'); // reaches Pump (10:25) and Lift (10:30)
      await checkin(gym, '2024-05-01T09:50:00Z'); // reaches Pump (09:40)
      await checkin(cafe, '2024-06-01T14:30:00Z'); // reaches Latte (14:05) and Solo (15:00)

      const song = await request(app).get('/api/v1/music/ties').query({ song_key: await songKeyOf('Pump') });
      expect(song.status).toBe(200);
      expect(song.body.gap_minutes).toBe(30);
      expect(song.body.place).toEqual([{ key: gym, label: 'Detail Test Gym', plays: 2, checkins: 2 }]);
      expect(song.body.companion).toEqual([]);
      expect(song.body.mood).toEqual([]);

      const artist = await request(app).get('/api/v1/music/ties').query({ artist: 'A' });
      expect(artist.body.place).toEqual([
        { key: gym, label: 'Detail Test Gym', plays: 3, checkins: 2 },
        { key: cafe, label: 'Detail Test Cafe', plays: 1, checkins: 1 },
      ]);
    });

    it('needs a song or an artist', async () => {
      expect((await request(app).get('/api/v1/music/ties')).status).toBe(400);
    });
  });
});
