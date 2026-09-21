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

const CSV_HEADER =
  '"media_id","source","media_type","title","image","season_number","episode_number","score","status","notes","start_date","end_date","progress","created_at","progressed_at"';

describe('Media check-in API', () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  describe('media items', () => {
    it('creates a local media item and returns it', async () => {
      const response = await request(app)
        .post('/api/v1/media/items')
        .send({ media_type: 'board_game', title: 'Pandemic' });

      expect(response.status).toBe(201);
      expect(response.body.title).toBe('Pandemic');
      expect(response.body.media_type).toBe('board_game');
      expect(typeof response.body.id).toBe('string');
    });

    it('rejects invalid media types and missing titles', async () => {
      const badType = await request(app)
        .post('/api/v1/media/items')
        .send({ media_type: 'comic', title: 'X' });
      expect(badType.status).toBe(500);

      const noTitle = await request(app)
        .post('/api/v1/media/items')
        .send({ media_type: 'movie' });
      expect(noTitle.status).toBe(400);
    });

    it('dedupes API-sourced items by (media_type, external_source, external_id)', async () => {
      const body = {
        media_type: 'movie',
        external_source: 'tmdb',
        external_id: '550',
        title: 'Dune',
        release_year: 2021,
        image_url: 'https://img/dune.jpg',
        external_url: 'https://www.themoviedb.org/movie/550',
      };
      const first = await request(app).post('/api/v1/media/items').send(body);
      const second = await request(app)
        .post('/api/v1/media/items')
        .send({ ...body, title: 'Dune (2021)' });

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.id).toBe(first.body.id);

      const count = await query('SELECT COUNT(*)::int AS n FROM media_items');
      expect(count.rows[0].n).toBe(1);
    });

    it('persists and backfills book page count / series metadata', async () => {
      const body = {
        media_type: 'book',
        external_source: 'hardcover',
        external_id: '9297',
        title: 'Dune',
        author: 'Frank Herbert',
        release_year: 2020,
        image_url: 'https://covers.example/dune.jpg',
        external_url: 'https://hardcover.app/books/dune',
      };
      const first = await request(app).post('/api/v1/media/items').send(body);
      expect(first.status).toBe(201);
      expect(first.body.page_count).toBeNull();
      expect(first.body.series_name).toBeNull();

      // Second upsert carries the previously-missing metadata (backfill).
      const second = await request(app)
        .post('/api/v1/media/items')
        .send({ ...body, page_count: 412, series_name: 'Dune', series_position: 1, series_count: 6 });
      expect(second.status).toBe(201);
      expect(second.body.id).toBe(first.body.id);
      expect(second.body.page_count).toBe(412);
      expect(second.body.series_name).toBe('Dune');
      expect(second.body.series_position).toBe(1);
      expect(second.body.series_count).toBe(6);

      // GET exposes the stored metadata.
      const item = await request(app).get(`/api/v1/media/items/${first.body.id}`);
      expect(item.status).toBe(200);
      expect(item.body.page_count).toBe(412);
      expect(item.body.series_name).toBe('Dune');
      expect(item.body.series_position).toBe(1);
      expect(item.body.series_count).toBe(6);
    });

    it('persists and validates TGDB game metadata via PUT', async () => {
      const created = await request(app)
        .post('/api/v1/media/items')
        .send({ media_type: 'game', title: 'Sonic the Hedgehog' });
      expect(created.status).toBe(201);
      const id = created.body.id as string;

      const ok = await request(app).put(`/api/v1/media/items/${id}`).send({
        overview: 'Join Sonic as he races through six zones.',
        content_rating: 'E - Everyone',
        players: 1,
        coop: 'No',
        genres: ['Action', 'Platform'],
        developers: ['Sega'],
        publishers: ['Sega'],
      });
      expect(ok.status).toBe(200);
      expect(ok.body.overview).toBe('Join Sonic as he races through six zones.');
      expect(ok.body.content_rating).toBe('E - Everyone');
      expect(ok.body.players).toBe(1);
      expect(ok.body.coop).toBe('No');
      expect(ok.body.genres).toEqual(['Action', 'Platform']);
      expect(ok.body.developers).toEqual(['Sega']);
      expect(ok.body.publishers).toEqual(['Sega']);

      // Non-positive player counts are rejected.
      const badPlayers = await request(app).put(`/api/v1/media/items/${id}`).send({ players: 0 });
      expect(badPlayers.status).toBe(400);
      expect(badPlayers.body.error).toMatch(/players/);

      // Name arrays are validated: non-arrays and oversized entries are rejected.
      const notArray = await request(app).put(`/api/v1/media/items/${id}`).send({ genres: 'Action' });
      expect(notArray.status).toBe(400);
      const tooLong = await request(app)
        .put(`/api/v1/media/items/${id}`)
        .send({ developers: ['x'.repeat(101)] });
      expect(tooLong.status).toBe(400);

      // Empty-string entries are dropped; an all-blank array stores null.
      const blanks = await request(app).put(`/api/v1/media/items/${id}`).send({ publishers: ['  '] });
      expect(blanks.status).toBe(200);
      expect(blanks.body.publishers).toBeNull();

      // GET returns the full shape after the updates.
      const item = await request(app).get(`/api/v1/media/items/${id}`);
      expect(item.status).toBe(200);
      expect(item.body.content_rating).toBe('E - Everyone');
      expect(item.body.players).toBe(1);
      expect(item.body.genres).toEqual(['Action', 'Platform']);
    });
  });

  describe('media check-ins', () => {
    it('creates, lists, updates, and deletes check-ins with timezone', async () => {
      const item = (
        await request(app).post('/api/v1/media/items').send({ media_type: 'movie', title: 'Dune' })
      ).body;

      const created = await request(app)
        .post(`/api/v1/media/items/${item.id}/checkins`)
        .send({
          checkin_type: 'completed',
          rating: 4,
          raw_score: 9.5,
          notes: 'great',
          checked_in_at: '2023-01-02T20:00:00-04:00',
          timezone: 'America/New_York',
        });
      expect(created.status).toBe(201);
      expect(created.body.checkin_type).toBe('completed');
      expect(Number(created.body.rating)).toBe(4);
      expect(created.body.checkin_timezone).toBe('America/New_York');

      const list = await request(app).get(`/api/v1/media/items/${item.id}/checkins`);
      expect(list.status).toBe(200);
      expect(list.body).toHaveLength(1);

      const updated = await request(app)
        .put(`/api/v1/media/checkins/${created.body.id}`)
        .send({ rating: 3 });
      expect(updated.status).toBe(200);
      expect(Number(updated.body.rating)).toBe(3);
      expect(updated.body.checkin_type).toBe('completed');

      const deleted = await request(app).delete(`/api/v1/media/checkins/${created.body.id}`);
      expect(deleted.status).toBe(200);

      const after = await request(app).get(`/api/v1/media/items/${item.id}/checkins`);
      expect(after.body).toHaveLength(0);
    });

    it('partially updates a check-in, leaving omitted fields unchanged (COALESCE)', async () => {
      const item = (
        await request(app).post('/api/v1/media/items').send({ media_type: 'movie', title: 'Dune' })
      ).body;
      const created = await request(app)
        .post(`/api/v1/media/items/${item.id}/checkins`)
        .send({
          checkin_type: 'in_progress',
          rating: 2,
          raw_score: 7,
          notes: 'original',
          time_played_minutes: 90,
          checked_in_at: '2023-01-02T20:00:00Z',
          timezone: 'UTC',
        });
      expect(created.status).toBe(201);

      // Update only the rating: everything else must be preserved.
      const updated = await request(app)
        .put(`/api/v1/media/checkins/${created.body.id}`)
        .send({ rating: 4 });
      expect(updated.status).toBe(200);
      expect(Number(updated.body.rating)).toBe(4);
      expect(updated.body.checkin_type).toBe('in_progress');
      expect(Number(updated.body.raw_score)).toBe(7);
      expect(updated.body.notes).toBe('original');
      expect(Number(updated.body.time_played_minutes)).toBe(90);

      // Explicitly present fields are written, including clearing to null
      // (the edit UI sends a full draft, so this is the expected contract).
      const cleared = await request(app)
        .put(`/api/v1/media/checkins/${created.body.id}`)
        .send({ notes: null, rating: null });
      expect(cleared.status).toBe(200);
      expect(cleared.body.notes).toBeNull();
      expect(cleared.body.rating).toBeNull();
      // checkin_type / raw_score were omitted, so they are preserved.
      expect(cleared.body.checkin_type).toBe('in_progress');
      expect(Number(cleared.body.raw_score)).toBe(7);

      // 404 for an unknown check-in.
      const missing = await request(app)
        .put('/api/v1/media/checkins/11111111-1111-1111-1111-111111111111')
        .send({ rating: 3 });
      expect(missing.status).toBe(404);
    });

    it('rejects invalid checkin_type', async () => {
      const item = (
        await request(app).post('/api/v1/media/items').send({ media_type: 'book', title: '1984' })
      ).body;
      const response = await request(app)
        .post(`/api/v1/media/items/${item.id}/checkins`)
        .send({ checkin_type: 'abandoned' });
      expect(response.status).toBe(400);
    });

    it('stores TV episode numbers and titles on the check-in', async () => {
      const item = (
        await request(app).post('/api/v1/media/items').send({ media_type: 'tv_show', title: 'Severance' })
      ).body;
      const created = await request(app)
        .post(`/api/v1/media/items/${item.id}/checkins`)
        .send({
          checkin_type: 'completed',
          season_number: 1,
          episode_number: 2,
          episode_title: 'Good Orientation',
          checked_in_at: '2023-01-02T20:00:00Z',
          timezone: 'UTC',
        });
      expect(created.status).toBe(201);
      expect(Number(created.body.season_number)).toBe(1);
      expect(Number(created.body.episode_number)).toBe(2);
      expect(created.body.episode_title).toBe('Good Orientation');
    });

    it('full-draft update edits every field and clears to null when present', async () => {
      const item = (
        await request(app).post('/api/v1/media/items').send({ media_type: 'tv_show', title: 'Severance' })
      ).body;
      const created = await request(app)
        .post(`/api/v1/media/items/${item.id}/checkins`)
        .send({
          checkin_type: 'completed',
          season_number: 1,
          episode_number: 2,
          episode_title: 'Good Orientation',
          rating: 4,
          raw_score: 9.5,
          notes: 'original',
          checked_in_at: '2023-01-02T20:00:00Z',
          timezone: 'UTC',
        });
      expect(created.status).toBe(201);
      const id = created.body.id;

      // The edit UI sends a full draft; every present field is applied and
      // explicit nulls clear the stored value.
      const updated = await request(app)
        .put(`/api/v1/media/checkins/${id}`)
        .send({
          season_number: 2,
          episode_number: 5,
          episode_title: '',
          checkin_type: 'in_progress',
          rating: null,
          raw_score: null,
          notes: '',
          checked_in_at: '2023-01-03T09:30:00-05:00',
          timezone: 'America/Chicago',
        });
      expect(updated.status).toBe(200);
      expect(Number(updated.body.season_number)).toBe(2);
      expect(Number(updated.body.episode_number)).toBe(5);
      expect(updated.body.episode_title).toBeNull();
      expect(updated.body.checkin_type).toBe('in_progress');
      expect(updated.body.rating).toBeNull();
      expect(updated.body.raw_score).toBeNull();
      expect(updated.body.notes).toBeNull();
      expect(updated.body.checkin_timezone).toBe('America/Chicago');
      expect(new Date(updated.body.checked_in_at).toISOString()).toBe('2023-01-03T14:30:00.000Z');

      // Invalid checkin_type is rejected with a 400.
      const bad = await request(app)
        .put(`/api/v1/media/checkins/${id}`)
        .send({ checkin_type: 'abandoned' });
      expect(bad.status).toBe(400);
    });

    it('item rating follows the most recent check-in that has a rating', async () => {
      const item = (
        await request(app).post('/api/v1/media/items').send({ media_type: 'movie', title: 'Dune' })
      ).body;

      // Older check-in rated 2.
      const older = await request(app)
        .post(`/api/v1/media/items/${item.id}/checkins`)
        .send({ checkin_type: 'completed', rating: 2, checked_in_at: '2023-01-01T20:00:00Z', timezone: 'UTC' });
      expect(older.status).toBe(201);

      // A newer unrated check-in must not erase the rating.
      const unrated = await request(app)
        .post(`/api/v1/media/items/${item.id}/checkins`)
        .send({ checkin_type: 'in_progress', checked_in_at: '2023-01-02T20:00:00Z', timezone: 'UTC' });
      expect(unrated.status).toBe(201);

      let detail = await request(app).get(`/api/v1/media/items/${item.id}`);
      expect(Number(detail.body.my_rating)).toBe(2);

      // Re-rate on the newest check-in: the item rating follows it.
      const reRated = await request(app)
        .put(`/api/v1/media/checkins/${unrated.body.id}`)
        .send({ rating: 4 });
      expect(reRated.status).toBe(200);
      expect(Number(reRated.body.rating)).toBe(4);

      detail = await request(app).get(`/api/v1/media/items/${item.id}`);
      expect(Number(detail.body.my_rating)).toBe(4);
    });

    it('stores check-in time as per-row context without clamping or touching the item', async () => {
      const item = (
        await request(app).post('/api/v1/media/items').send({ media_type: 'game', title: 'Hades' })
      ).body;

      const first = await request(app)
        .post(`/api/v1/media/items/${item.id}/checkins`)
        .send({
          checkin_type: 'in_progress',
          time_played_minutes: 120,
          checked_in_at: '2023-01-01T20:00:00Z',
          timezone: 'UTC',
        });
      expect(first.status).toBe(201);
      expect(Number(first.body.time_played_minutes)).toBe(120);

      // A later check-in with a lower value is stored as-is: check-ins no
      // longer clamp, and they never touch the item-level total.
      const lower = await request(app)
        .post(`/api/v1/media/items/${item.id}/checkins`)
        .send({
          checkin_type: 'in_progress',
          time_played_minutes: 60,
          checked_in_at: '2023-01-02T20:00:00Z',
          timezone: 'UTC',
        });
      expect(lower.status).toBe(201);
      expect(Number(lower.body.time_played_minutes)).toBe(60);

      let detail = await request(app).get(`/api/v1/media/items/${item.id}`);
      expect(detail.body.time_played_minutes).toBeNull();

      // Omitting time_played_minutes stores null on the check-in row.
      const omitted = await request(app)
        .post(`/api/v1/media/items/${item.id}/checkins`)
        .send({
          checkin_type: 'completed',
          checked_in_at: '2023-01-04T20:00:00Z',
          timezone: 'UTC',
        });
      expect(omitted.status).toBe(201);
      expect(omitted.body.time_played_minutes).toBeNull();

      detail = await request(app).get(`/api/v1/media/items/${item.id}`);
      expect(detail.body.time_played_minutes).toBeNull();
    });

    it('reads and writes item-level rating, notes, status, and time played via PUT /items/:id', async () => {
      const item = (
        await request(app).post('/api/v1/media/items').send({ media_type: 'game', title: 'Hades' })
      ).body;

      // Submitting a check-in never updates item-level fields.
      await request(app).post(`/api/v1/media/items/${item.id}/checkins`).send({
        checkin_type: 'in_progress',
        rating: 2,
        notes: 'session note',
        checked_in_at: '2023-01-01T20:00:00Z',
        timezone: 'UTC',
      });
      let detail = await request(app).get(`/api/v1/media/items/${item.id}`);
      expect(detail.body.rating).toBeNull();
      expect(detail.body.notes).toBeNull();
      expect(detail.body.status).toBeNull();
      expect(detail.body.time_played_minutes).toBeNull();
      // Display rating falls back to the latest check-in rating.
      expect(Number(detail.body.my_rating)).toBe(2);

      const updated = await request(app)
        .put(`/api/v1/media/items/${item.id}`)
        .send({ rating: 4, raw_score: 9.5, notes: 'love it', time_played_minutes: 320, status: 'completed' });
      expect(updated.status).toBe(200);
      expect(Number(updated.body.rating)).toBe(4);
      expect(Number(updated.body.raw_score)).toBe(9.5);
      expect(updated.body.notes).toBe('love it');
      expect(Number(updated.body.time_played_minutes)).toBe(320);
      expect(updated.body.status).toBe('completed');

      detail = await request(app).get(`/api/v1/media/items/${item.id}`);
      // Item rating takes precedence over the check-in rating.
      expect(Number(detail.body.my_rating)).toBe(4);

      // Manual edits may lower the time played.
      const lowered = await request(app).put(`/api/v1/media/items/${item.id}`).send({ time_played_minutes: 240 });
      expect(Number(lowered.body.time_played_minutes)).toBe(240);

      // null explicitly clears fields.
      const cleared = await request(app)
        .put(`/api/v1/media/items/${item.id}`)
        .send({ rating: null, notes: null, time_played_minutes: null, status: null });
      expect(cleared.body.rating).toBeNull();
      expect(cleared.body.notes).toBeNull();
      expect(cleared.body.time_played_minutes).toBeNull();
      expect(cleared.body.status).toBeNull();
      expect(Number(cleared.body.my_rating)).toBe(2);
    });

    it('rejects invalid item-level metadata values', async () => {
      const item = (
        await request(app).post('/api/v1/media/items').send({ media_type: 'game', title: 'Hades' })
      ).body;
      for (const body of [
        { rating: 5 },
        { rating: 'four' },
        { raw_score: 'abc' },
        { time_played_minutes: -1 },
        { status: 'abandoned' },
      ]) {
        const res = await request(app).put(`/api/v1/media/items/${item.id}`).send(body);
        expect(res.status).toBe(400);
      }
      const detail = await request(app).get(`/api/v1/media/items/${item.id}`);
      expect(detail.body.rating).toBeNull();
      expect(detail.body.raw_score).toBeNull();
      expect(detail.body.notes).toBeNull();
      expect(detail.body.time_played_minutes).toBeNull();
      expect(detail.body.status).toBeNull();
    });
  });

  describe('tv seasons', () => {
    async function seedShow(overrides: Record<string, unknown> = {}) {
      const res = await request(app)
        .post('/api/v1/media/items')
        .send({ media_type: 'tv_show', title: 'Severance', external_source: 'tmdb', external_id: '91887', ...overrides });
      expect(res.status).toBe(201);
      return res.body;
    }

    async function cacheEpisodes(itemId: string, cachedAtSql: string) {
      await query(
        `INSERT INTO media_tv_episodes (media_item_id, season_number, episode_number, episode_title, cached_at) VALUES
         ($1, 1, 1, 'Pilot', ${cachedAtSql}),
         ($1, 1, 2, 'Good Orientation', ${cachedAtSql}),
         ($1, 2, 1, 'Bury the Key', ${cachedAtSql})`,
        [itemId]
      );
    }

    it('returns cached episodes with cached: true when the cache is fresh', async () => {
      const show = await seedShow();
      await cacheEpisodes(show.id, 'NOW()');

      const response = await request(app).get(`/api/v1/media/tv/${show.id}/seasons`);
      expect(response.status).toBe(200);
      expect(response.body.cached).toBe(true);
      expect(response.body.seasons).toHaveLength(2);
      expect(response.body.seasons[0].season_number).toBe(1);
      expect(response.body.seasons[0].episodes.map((e: any) => e.episode_number)).toEqual([1, 2]);
      expect(response.body.seasons[0].episodes[0].episode_title).toBe('Pilot');
      expect(response.body.seasons[1].season_number).toBe(2);
      expect(response.body.seasons[1].episodes[0].episode_title).toBe('Bury the Key');
    });

    it('serves cached episodes when the cache is stale and TMDB is unavailable', async () => {
      const show = await seedShow();
      // ~45 days old: past the 30-day max age, but TMDB has no key, so the
      // stale fallback must serve the cached rows (regression for F3).
      await cacheEpisodes(show.id, "NOW() - INTERVAL '45 days'");

      const response = await request(app).get(`/api/v1/media/tv/${show.id}/seasons`);
      expect(response.status).toBe(200);
      expect(response.body.cached).toBe(true);
      expect(response.body.seasons).toHaveLength(2);
      expect(response.body.seasons[0].season_number).toBe(1);
      expect(response.body.seasons[0].episodes.map((e: any) => e.episode_number)).toEqual([1, 2]);
      expect(response.body.seasons[0].episodes.map((e: any) => e.episode_title)).toEqual(['Pilot', 'Good Orientation']);
      expect(response.body.seasons[1].season_number).toBe(2);
      expect(response.body.seasons[1].episodes).toHaveLength(1);
    });

    it('returns empty seasons with cached: false when there is no cache and no TMDB key', async () => {
      const show = await seedShow();

      const response = await request(app).get(`/api/v1/media/tv/${show.id}/seasons`);
      expect(response.status).toBe(200);
      expect(response.body.cached).toBe(false);
      expect(response.body.seasons).toEqual([]);
    });

    it('returns 404 for an unknown tv show', async () => {
      const response = await request(app).get('/api/v1/media/tv/11111111-1111-1111-1111-111111111111/seasons');
      expect(response.status).toBe(404);
    });
  });

  describe('media search', () => {
    it('returns local results and degrades gracefully without API keys', async () => {
      await request(app).post('/api/v1/media/items').send({ media_type: 'movie', title: 'Dune' });

      const response = await request(app)
        .get('/api/v1/media/search')
        .query({ type: 'movie', q: 'dune' });

      expect(response.status).toBe(200);
      expect(response.body.degraded).toBe(true);
      expect(response.body.results).toHaveLength(1);
      expect(response.body.results[0].source).toBe('local');
      expect(response.body.results[0].title).toBe('Dune');
    });

    it('reports last check-in info on local search hits', async () => {
      const item = (
        await request(app).post('/api/v1/media/items').send({ media_type: 'movie', title: 'Blade Runner' })
      ).body;
      await request(app)
        .post(`/api/v1/media/items/${item.id}/checkins`)
        .send({ checkin_type: 'completed', rating: 4, checked_in_at: '2023-05-01T00:00:00Z', timezone: 'UTC' });

      const response = await request(app)
        .get('/api/v1/media/search')
        .query({ type: 'movie', q: 'blade' });

      expect(response.body.results).toHaveLength(1);
      expect(response.body.results[0].last_checkin_type).toBe('completed');
      expect(Number(response.body.results[0].my_rating)).toBe(4);
    });

    it('requires type and q', async () => {
      const response = await request(app).get('/api/v1/media/search').query({ type: 'movie' });
      expect(response.status).toBe(400);
    });
  });

  describe('media stats', () => {
    it('counts completed check-ins by subtype and returns top rated media', async () => {
      const tv = (await request(app).post('/api/v1/media/items').send({ media_type: 'tv_show', title: 'Severance' })).body;
      const movie = (await request(app).post('/api/v1/media/items').send({ media_type: 'movie', title: 'Dune' })).body;

      // Item-level rating takes precedence over check-in ratings for top media.
      const movieSet = await request(app).put(`/api/v1/media/items/${movie.id}`).send({ rating: 4 });
      expect(movieSet.status).toBe(200);

      await request(app).post(`/api/v1/media/items/${tv.id}/checkins`).send({
        checkin_type: 'completed', rating: 3, checked_in_at: '2023-01-02T20:00:00Z', timezone: 'UTC',
      });
      await request(app).post(`/api/v1/media/items/${tv.id}/checkins`).send({
        checkin_type: 'in_progress', checked_in_at: '2023-01-03T20:00:00Z', timezone: 'UTC',
      });
      // A check-in rating lower than the item rating must not drag the item down.
      await request(app).post(`/api/v1/media/items/${movie.id}/checkins`).send({
        checkin_type: 'completed', rating: 2, checked_in_at: '2023-01-04T20:00:00Z', timezone: 'UTC',
      });

      const all = await request(app).get('/api/v1/media/stats');
      expect(all.status).toBe(200);
      expect(all.body.tv_episodes_completed).toBe(1);
      expect(all.body.movies_watched).toBe(1);
      expect(all.body.books_completed).toBe(0);
      expect(all.body.top_media).toHaveLength(2);
      expect(all.body.top_media[0].title).toBe('Dune');
      expect(Number(all.body.top_media[0].rating)).toBe(4);
      expect(all.body.top_media[1].title).toBe('Severance');

      const filtered = await request(app).get('/api/v1/media/stats').query({ from: '2023-01-04', to: '2023-01-04' });
      expect(filtered.body.tv_episodes_completed).toBe(0);
      expect(filtered.body.movies_watched).toBe(1);
    });
  });

  describe('media library', () => {
    it('groups check-ins per item with latest rating, last check-in, and its type', async () => {
      const tv = (await request(app).post('/api/v1/media/items').send({ media_type: 'tv_show', title: 'Severance' })).body;
      const movie = (await request(app).post('/api/v1/media/items').send({ media_type: 'movie', title: 'Dune' })).body;

      await request(app).post(`/api/v1/media/items/${tv.id}/checkins`).send({
        checkin_type: 'in_progress', checked_in_at: '2023-01-02T20:00:00Z', timezone: 'UTC',
      });
      await request(app).post(`/api/v1/media/items/${tv.id}/checkins`).send({
        checkin_type: 'completed', rating: 4, checked_in_at: '2023-01-05T20:00:00Z', timezone: 'UTC',
      });
      await request(app).post(`/api/v1/media/items/${movie.id}/checkins`).send({
        checkin_type: 'completed', rating: 2, checked_in_at: '2023-01-04T20:00:00Z', timezone: 'UTC',
      });

      const response = await request(app).get('/api/v1/media/library');
      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);

      // Most recent check-in first.
      expect(response.body[0].title).toBe('Severance');
      expect(response.body[0].media_type).toBe('tv_show');
      expect(response.body[0].latest_rating).toBe(4);
      expect(response.body[0].last_checkin_type).toBe('completed');
      expect(response.body[0].last_checkin_at).toBe('2023-01-05T20:00:00.000Z');
      // One completed check-in (the in_progress one is not counted).
      expect(response.body[0].completed_count).toBe(1);

      expect(response.body[1].title).toBe('Dune');
      expect(response.body[1].latest_rating).toBe(2);
      expect(response.body[1].last_checkin_type).toBe('completed');
      expect(response.body[1].completed_count).toBe(1);
    });

    it('reports the item-level time played, rating, and status for library rows', async () => {
      const game = (await request(app).post('/api/v1/media/items').send({ media_type: 'game', title: 'Hades' })).body;
      const movie = (await request(app).post('/api/v1/media/items').send({ media_type: 'movie', title: 'Dune' })).body;

      const setGame = await request(app)
        .put(`/api/v1/media/items/${game.id}`)
        .send({ rating: 3, notes: 'fun', time_played_minutes: 540, status: 'in_progress' });
      expect(setGame.status).toBe(200);

      await request(app).post(`/api/v1/media/items/${game.id}/checkins`).send({
        checkin_type: 'in_progress', checked_in_at: '2023-01-05T20:00:00Z', timezone: 'UTC', time_played_minutes: 300,
      });
      await request(app).post(`/api/v1/media/items/${movie.id}/checkins`).send({
        checkin_type: 'completed', checked_in_at: '2023-01-04T20:00:00Z', timezone: 'UTC',
      });

      const response = await request(app).get('/api/v1/media/library');
      expect(response.status).toBe(200);
      const byTitle = Object.fromEntries(response.body.map((row: { title: string }) => [row.title, row]));
      // Item-level fields are reported as stored (not derived from check-ins).
      expect(byTitle.Hades.time_played_minutes).toBe(540);
      expect(byTitle.Hades.rating).toBe(3);
      expect(byTitle.Hades.notes).toBe('fun');
      expect(byTitle.Hades.status).toBe('in_progress');
      expect(byTitle.Hades.latest_rating).toBe(3);
      // Non-game items have no time played and no item-level rating yet.
      expect(byTitle.Dune.time_played_minutes).toBeNull();
      expect(byTitle.Dune.rating).toBeNull();
      // latest_rating falls back to the latest check-in rating.
      expect(byTitle.Dune.latest_rating).toBeNull();
    });

    it('includes items without check-ins only when no date range is set', async () => {
      const checkedIn = (await request(app).post('/api/v1/media/items').send({ media_type: 'game', title: 'Hades' })).body;
      await request(app).post('/api/v1/media/items').send({ media_type: 'game', title: 'Celeste' });

      await request(app).post(`/api/v1/media/items/${checkedIn.id}/checkins`).send({
        checkin_type: 'in_progress', checked_in_at: '2023-01-05T20:00:00Z', timezone: 'UTC',
      });

      // Without a date range (period "all"), the item without check-ins appears…
      const all = await request(app).get('/api/v1/media/library');
      expect(all.status).toBe(200);
      const allByTitle = Object.fromEntries(all.body.map((row: { title: string }) => [row.title, row]));
      expect(allByTitle.Celeste).toBeDefined();
      expect(allByTitle.Celeste.last_checkin_at).toBeNull();
      expect(allByTitle.Celeste.last_checkin_type).toBeNull();
      expect(allByTitle.Celeste.completed_count).toBe(0);
      expect(allByTitle.Celeste.latest_rating).toBeNull();

      // …but with a date range only checked-in items within it appear.
      const ranged = await request(app).get('/api/v1/media/library?from=2023-01-01&to=2023-01-31');
      expect(ranged.status).toBe(200);
      const rangedByTitle = Object.fromEntries(ranged.body.map((row: { title: string }) => [row.title, row]));
      expect(rangedByTitle.Hades).toBeDefined();
      expect(rangedByTitle.Celeste).toBeUndefined();

      // A date range that excludes the check-in drops the item entirely.
      const outside = await request(app).get('/api/v1/media/library?from=2024-01-01&to=2024-01-31');
      expect(outside.status).toBe(200);
      const outsideByTitle = Object.fromEntries(outside.body.map((row: { title: string }) => [row.title, row]));
      expect(outsideByTitle.Hades).toBeUndefined();
      expect(outsideByTitle.Celeste).toBeUndefined();
    });

    it('filters by date range and media types', async () => {
      const tv = (await request(app).post('/api/v1/media/items').send({ media_type: 'tv_show', title: 'Severance' })).body;
      const movie = (await request(app).post('/api/v1/media/items').send({ media_type: 'movie', title: 'Dune' })).body;

      await request(app).post(`/api/v1/media/items/${tv.id}/checkins`).send({
        checkin_type: 'completed', checked_in_at: '2023-01-02T20:00:00Z', timezone: 'UTC',
      });
      await request(app).post(`/api/v1/media/items/${movie.id}/checkins`).send({
        checkin_type: 'completed', checked_in_at: '2023-01-04T20:00:00Z', timezone: 'UTC',
      });

      // Range containing only the movie check-in.
      const byRange = await request(app)
        .get('/api/v1/media/library')
        .query({ from: '2023-01-04', to: '2023-01-04' });
      expect(byRange.body).toHaveLength(1);
      expect(byRange.body[0].title).toBe('Dune');

      // Type filter excluding movies.
      const byType = await request(app)
        .get('/api/v1/media/library')
        .query({ types: 'tv_show' });
      expect(byType.body).toHaveLength(1);
      expect(byType.body[0].title).toBe('Severance');

      // Combined: type filter excludes the only item in the range.
      const neither = await request(app)
        .get('/api/v1/media/library')
        .query({ from: '2023-01-04', to: '2023-01-04', types: 'tv_show' });
      expect(neither.body).toHaveLength(0);
    });

    it('respects item timezone when matching the date range', async () => {
      const movie = (await request(app).post('/api/v1/media/items').send({ media_type: 'movie', title: 'Dune' })).body;
      // 02:00 UTC on Jan 5 is Jan 4 (21:00) in New York.
      await request(app).post(`/api/v1/media/items/${movie.id}/checkins`).send({
        checkin_type: 'completed', checked_in_at: '2023-01-05T02:00:00Z', timezone: 'America/New_York',
      });

      // Matches when the range uses the item's local date (Jan 4)…
      const byLocalDate = await request(app)
        .get('/api/v1/media/library')
        .query({ from: '2023-01-04', to: '2023-01-04' });
      expect(byLocalDate.body).toHaveLength(1);
      expect(byLocalDate.body[0].last_checkin_timezone).toBe('America/New_York');

      // …and does not match the UTC date (Jan 5).
      const byUtcDate = await request(app)
        .get('/api/v1/media/library')
        .query({ from: '2023-01-05', to: '2023-01-05' });
      expect(byUtcDate.body).toHaveLength(0);
    });
  });

  describe('timeline media branch', () => {
    it('includes media check-ins in the timeline with media fields', async () => {
      const item = (
        await request(app).post('/api/v1/media/items').send({ media_type: 'movie', title: 'Dune' })
      ).body;
      await request(app).post(`/api/v1/media/items/${item.id}/checkins`).send({
        checkin_type: 'completed', rating: 4, checked_in_at: '2023-01-02T20:00:00Z', timezone: 'UTC',
      });

      const response = await request(app)
        .get('/api/v1/timeline')
        .query({ user_id: DEFAULT_USER_ID, limit: '20', offset: '0' });

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      const [entry] = response.body;
      expect(entry.type).toBe('media');
      expect(entry.media_title).toBe('Dune');
      expect(entry.media_type).toBe('movie');
      expect(entry.media_checkin_type).toBe('completed');
      expect(Number(entry.media_rating)).toBe(4);
      expect(entry.media_item_id).toBe(item.id);
    });

    it('filters the timeline by media subtype', async () => {
      const movie = (await request(app).post('/api/v1/media/items').send({ media_type: 'movie', title: 'Dune' })).body;
      const book = (await request(app).post('/api/v1/media/items').send({ media_type: 'book', title: 'Dune Book' })).body;
      await request(app).post(`/api/v1/media/items/${movie.id}/checkins`).send({
        checkin_type: 'completed', checked_in_at: '2023-01-02T20:00:00Z', timezone: 'UTC',
      });
      await request(app).post(`/api/v1/media/items/${book.id}/checkins`).send({
        checkin_type: 'completed', checked_in_at: '2023-01-03T20:00:00Z', timezone: 'UTC',
      });

      const moviesOnly = await request(app)
        .get('/api/v1/timeline')
        .query({ user_id: DEFAULT_USER_ID, limit: '20', offset: '0', media_subtype: 'movie' });
      expect(moviesOnly.body).toHaveLength(1);
      expect(moviesOnly.body[0].media_title).toBe('Dune');

      const both = await request(app)
        .get('/api/v1/timeline')
        .query({ user_id: DEFAULT_USER_ID, limit: '20', offset: '0', media_subtype: 'movie,book' });
      expect(both.body).toHaveLength(2);
    });
  });

  describe('media lists', () => {
    it('supports create, add item, list, rename, and delete', async () => {
      const item = (
        await request(app).post('/api/v1/media/items').send({ media_type: 'movie', title: 'Dune' })
      ).body;

      const created = await request(app).post('/api/v1/media/lists').send({ name: 'Watchlist' });
      expect(created.status).toBe(201);
      expect(created.body.name).toBe('Watchlist');

      const added = await request(app)
        .post(`/api/v1/media/lists/${created.body.id}/items`)
        .send({ media_item_id: item.id });
      expect(added.status).toBe(201);

      const lists = await request(app).get('/api/v1/media/lists');
      expect(lists.body).toHaveLength(1);
      expect(lists.body[0].items).toHaveLength(1);
      expect(lists.body[0].items[0].title).toBe('Dune');
      // Membership records when the item was added to the list.
      expect(lists.body[0].items[0].added_at).toBeTruthy();
      expect(Number.isNaN(Date.parse(lists.body[0].items[0].added_at))).toBe(false);

      // Re-adding the same item keeps the original added_at.
      await request(app)
        .post(`/api/v1/media/lists/${created.body.id}/items`)
        .send({ media_item_id: item.id });
      const readded = await request(app).get('/api/v1/media/lists');
      expect(readded.body[0].items[0].added_at).toBe(lists.body[0].items[0].added_at);

      const renamed = await request(app)
        .put(`/api/v1/media/lists/${created.body.id}`)
        .send({ name: 'Must See' });
      expect(renamed.status).toBe(200);
      expect(renamed.body.name).toBe('Must See');

      const removed = await request(app).delete(`/api/v1/media/lists/${created.body.id}/items/${item.id}`);
      expect(removed.status).toBe(200);

      const deleted = await request(app).delete(`/api/v1/media/lists/${created.body.id}`);
      expect(deleted.status).toBe(200);

      const after = await request(app).get('/api/v1/media/lists');
      expect(after.body).toHaveLength(0);
    });
  });

  describe('bulk delete', () => {
    async function makeItemWithCheckins(title: string, checkinCount: number) {
      const item = (
        await request(app).post('/api/v1/media/items').send({ media_type: 'movie', title })
      ).body;
      for (let i = 0; i < checkinCount; i += 1) {
        const created = await request(app)
          .post(`/api/v1/media/items/${item.id}/checkins`)
          .send({
            checkin_type: 'completed',
            checked_in_at: `2023-01-0${i + 1}T20:00:00-04:00`,
            timezone: 'America/New_York',
          });
        expect(created.status).toBe(201);
      }
      return item;
    }

    async function addToList(listId: string, itemId: string) {
      const added = await request(app)
        .post(`/api/v1/media/lists/${listId}/items`)
        .send({ media_item_id: itemId });
      expect(added.status).toBe(201);
    }

    it('rejects missing or empty ids', async () => {
      const empty = await request(app).post('/api/v1/media/items/bulk-delete').send({ ids: [] });
      expect(empty.status).toBe(400);
      const missing = await request(app).post('/api/v1/media/items/bulk-delete').send({});
      expect(missing.status).toBe(400);
    });

    it('dry run reports what would be deleted without deleting anything', async () => {
      const dune = await makeItemWithCheckins('Dune', 2);
      const blade = await makeItemWithCheckins('Blade Runner', 1);

      const list = (await request(app).post('/api/v1/media/lists').send({ name: 'Watchlist' })).body;
      await addToList(list.id, dune.id);
      await addToList(list.id, blade.id);

      const preview = await request(app)
        .post('/api/v1/media/items/bulk-delete')
        .send({ ids: [dune.id, blade.id], dryRun: true });
      expect(preview.status).toBe(200);
      expect(preview.body).toEqual({ deleted_items: 2, deleted_checkins: 3, deleted_list_memberships: 2 });

      // Nothing was touched.
      const items = await query('SELECT COUNT(*)::int AS n FROM media_items');
      expect(items.rows[0].n).toBe(2);
      const checkins = await query('SELECT COUNT(*)::int AS n FROM media_checkins');
      expect(checkins.rows[0].n).toBe(3);
      const memberships = await query('SELECT COUNT(*)::int AS n FROM media_list_items');
      expect(memberships.rows[0].n).toBe(2);
    });

    it('deletes items, their check-ins, and their list memberships', async () => {
      const dune = await makeItemWithCheckins('Dune', 2);
      const blade = await makeItemWithCheckins('Blade Runner', 1);
      const keeper = await makeItemWithCheckins('Interstellar', 1);

      const list = (await request(app).post('/api/v1/media/lists').send({ name: 'Watchlist' })).body;
      await addToList(list.id, dune.id);
      await addToList(list.id, keeper.id);

      const result = await request(app)
        .post('/api/v1/media/items/bulk-delete')
        .send({ ids: [dune.id, blade.id] });
      expect(result.status).toBe(200);
      expect(result.body.deleted_items).toBe(2);
      expect(result.body.deleted_checkins).toBe(3);
      expect(result.body.deleted_list_memberships).toBe(1);

      // The unselected item is intact, along with its check-in and list membership.
      const items = await query('SELECT id FROM media_items');
      expect(items.rows).toHaveLength(1);
      expect(items.rows[0].id).toBe(keeper.id);
      const checkins = await query('SELECT COUNT(*)::int AS n FROM media_checkins');
      expect(checkins.rows[0].n).toBe(1);
      const lists = await request(app).get('/api/v1/media/lists');
      expect(lists.body).toHaveLength(1);
      expect(lists.body[0].items).toHaveLength(1);
      expect(lists.body[0].items[0].id).toBe(keeper.id);
    });

    it('ignores ids that do not exist and reports the real counts', async () => {
      const item = await makeItemWithCheckins('Dune', 1);
      const result = await request(app)
        .post('/api/v1/media/items/bulk-delete')
        .send({ ids: [item.id, '00000000-0000-0000-0000-000000000002'] });
      expect(result.status).toBe(200);
      expect(result.body.deleted_items).toBe(1);
      expect(result.body.deleted_checkins).toBe(1);
    });
  });

  describe('yamtrack import', () => {
    const csv = [
      CSV_HEADER,
      '"100088","tmdb","tv","The Last of Us","img","","","","Completed","","2023-04-04 01:49:00+00:00","2025-05-26 01:50:00+00:00","16","",""',
      // Episode rows store the watch time in end_date (start_date blank).
      '"100088","tmdb","episode","Pilot","img","1","1","10","Completed","","","2023-04-04 01:50:00+00:00","0","",""',
      // Rewatch of the same episode with a different end_date: distinct check-in.
      '"100088","tmdb","episode","Pilot","img","1","1","9","Completed","","","2023-06-01 01:50:00+00:00","0","",""',
      '"550","tmdb","movie","Dune","img","","","","Completed","","","2023-04-05 01:50:00+00:00","0","",""',
      '"880","hardcover","book","Dune Book","img","","","","Planning","","","","0","",""',
    ].join('\n');

    it('previews without writing to the database', async () => {
      const response = await request(app).post('/api/v1/import/yamtrack/preview').send({ csv });

      expect(response.status).toBe(200);
      expect(response.body.counts.total).toBe(5);
      expect(response.body.counts.create_tv_show).toBe(1);
      expect(response.body.counts.create_episode_checkin).toBe(2);
      expect(response.body.counts.create_checkin).toBe(1);
      expect(response.body.counts.create_media_item).toBe(1);

      const items = await query('SELECT COUNT(*)::int AS n FROM media_items');
      const checkins = await query('SELECT COUNT(*)::int AS n FROM media_checkins');
      expect(items.rows[0].n).toBe(0);
      expect(checkins.rows[0].n).toBe(0);
    });

    it('imports media items and check-ins', async () => {
      const response = await request(app).post('/api/v1/import/yamtrack/import').send({ csv });

      expect(response.status).toBe(200);
      expect(response.body.counts.imported_checkins).toBe(3);

      const items = await query('SELECT COUNT(*)::int AS n FROM media_items');
      expect(items.rows[0].n).toBe(3);

      const checkins = await query(
        `SELECT mc.*, mi.title FROM media_checkins mc JOIN media_items mi ON mi.id = mc.media_item_id ORDER BY mi.title`
      );
      expect(checkins.rows).toHaveLength(3);
      expect(checkins.rows.map((r: any) => r.title).sort()).toEqual(['Dune', 'The Last of Us', 'The Last of Us']);

      // Both episode rows imported, each timed at its end_date.
      const episodes = checkins.rows
        .filter((r: any) => r.title === 'The Last of Us')
        .sort((a: any, b: any) => new Date(a.checked_in_at).getTime() - new Date(b.checked_in_at).getTime());
      expect(Number(episodes[0].season_number)).toBe(1);
      expect(Number(episodes[0].episode_number)).toBe(1);
      expect(Number(episodes[0].rating)).toBe(4);
      expect(episodes[0].checkin_timezone).toBe('UTC');
      expect(episodes[0].external_event_id).toBeTruthy();
      expect(episodes[0].checked_in_at.toISOString()).toBe('2023-04-04T01:50:00.000Z');
      expect(episodes[1].checked_in_at.toISOString()).toBe('2023-06-01T01:50:00.000Z');
      expect(episodes[1].external_event_id).not.toBe(episodes[0].external_event_id);

      const movie = checkins.rows.find((r: any) => r.title === 'Dune');
      expect(movie.checkin_type).toBe('completed');
      expect(movie.checked_in_at.toISOString()).toBe('2023-04-05T01:50:00.000Z');

      const planningBook = checkins.rows.find((r: any) => r.title === 'Dune Book');
      expect(planningBook).toBeUndefined();
    });

    it('is idempotent: re-importing the same CSV adds no rows', async () => {
      const first = await request(app).post('/api/v1/import/yamtrack/import').send({ csv });
      expect(first.status).toBe(200);

      const second = await request(app).post('/api/v1/import/yamtrack/import').send({ csv });
      expect(second.status).toBe(200);
      expect(second.body.counts.imported_checkins).toBe(0);

      const items = await query('SELECT COUNT(*)::int AS n FROM media_items');
      const checkins = await query('SELECT COUNT(*)::int AS n FROM media_checkins');
      expect(items.rows[0].n).toBe(3);
      expect(checkins.rows[0].n).toBe(3);
    });

    it('keeps the existing item time when the imported game time is lower (max rule, no check-ins)', async () => {
      const first = [
        CSV_HEADER,
        '"321","tgdb","game","Half-Life","img","","","","In Progress","","","2023-01-01 00:00:00+00:00","5h","","2023-02-01 00:00:00+00:00"',
      ].join('\n');
      const import1 = await request(app).post('/api/v1/import/yamtrack/import').send({ csv: first });
      expect(import1.status).toBe(200);
      expect(import1.body.counts.imported_checkins).toBe(0);
      expect(import1.body.counts.update_game_item).toBe(1);

      // A later export of the same game with lower progress: the item total
      // must not decrease (imported < existing).
      const lower = [
        CSV_HEADER,
        '"321","tgdb","game","Half-Life","img","","","","In Progress","","","2023-01-01 00:00:00+00:00","1h 30min","","2023-02-01 00:00:00+00:00"',
      ].join('\n');
      const import2 = await request(app).post('/api/v1/import/yamtrack/import').send({ csv: lower });
      expect(import2.status).toBe(200);
      expect(import2.body.counts.imported_checkins).toBe(0);

      const items = await query('SELECT time_played_minutes, status FROM media_items WHERE media_type = \'game\'');
      expect(items.rows).toHaveLength(1);
      expect(Number(items.rows[0].time_played_minutes)).toBe(300);
      expect(items.rows[0].status).toBe('in_progress');

      // Games create no check-ins at all.
      const checkins = await query('SELECT COUNT(*)::int AS n FROM media_checkins');
      expect(checkins.rows[0].n).toBe(0);
    });

    it('imports igdb games as local-only and dedupes them by title on re-import', async () => {
      // Yamtrack keys games by IGDB id; that id must NOT be stored as a
      // TGDB external_id, so the item imports local-only.
      const first = [
        CSV_HEADER,
        '"770","igdb","game","Hades","img","","","","In progress","","","2023-04-06 01:50:00+00:00","0","",""',
      ].join('\n');
      const import1 = await request(app).post('/api/v1/import/yamtrack/import').send({ csv: first });
      expect(import1.status).toBe(200);
      expect(import1.body.counts.imported_checkins).toBe(0);

      const after1 = await query(
        'SELECT external_source, external_id, external_url FROM media_items WHERE media_type = \'game\''
      );
      expect(after1.rows).toHaveLength(1);
      expect(after1.rows[0].external_source).toBeNull();
      expect(after1.rows[0].external_id).toBeNull();
      expect(after1.rows[0].external_url).toBeNull();

      // A later export of the same game (different IGDB id, edition-qualifier
      // title): must fold into the existing local-only row, not create a
      // duplicate.
      const second = [
        CSV_HEADER,
        '"888","igdb","game","Hades  Remastered","img","","","","Completed","","","2023-05-06 01:50:00+00:00","0","",""',
      ].join('\n');
      const import2 = await request(app).post('/api/v1/import/yamtrack/import').send({ csv: second });
      expect(import2.status).toBe(200);
      expect(import2.body.counts.imported_checkins).toBe(0);

      const after2 = await query(
        'SELECT external_source, external_id, status FROM media_items WHERE media_type = \'game\''
      );
      expect(after2.rows).toHaveLength(1);
      expect(after2.rows[0].external_source).toBeNull();
      expect(after2.rows[0].external_id).toBeNull();
      // Item-level status tracks the latest import.
      expect(after2.rows[0].status).toBe('completed');
    });

    it('requires a csv string', async () => {
      const response = await request(app).post('/api/v1/import/yamtrack/import').send({});
      expect(response.status).toBe(400);
    });

    it('start-over delete_media_items clears all locally stored media and allows a fresh import', async () => {
      await request(app).post('/api/v1/import/yamtrack/import').send({ csv });

      // delete_media_items is a legacy alias of the media plugin's
      // deleteUserData hook (now wired through the generic plugin loop), so
      // the count is reported per plugin and covers every media table.
      const startOver = await request(app)
        .post('/api/v1/backup/start-over')
        .send({
          first_confirmation: 'DELETE MY DATA',
          second_confirmation: 'START OVER',
          options: { delete_media_items: true },
        });
      expect(startOver.status).toBe(200);
      expect(startOver.body.counts.plugin_checkins_media).toBe(6); // 3 items + 3 check-ins

      const items = await query('SELECT COUNT(*)::int AS n FROM media_items');
      const checkins = await query('SELECT COUNT(*)::int AS n FROM media_checkins');
      expect(items.rows[0].n).toBe(0);
      expect(checkins.rows[0].n).toBe(0);

      // A fresh import after the reset recreates everything.
      const reimport = await request(app).post('/api/v1/import/yamtrack/import').send({ csv });
      expect(reimport.status).toBe(200);
      expect(reimport.body.counts.imported_checkins).toBe(3);
    });
  });
});
