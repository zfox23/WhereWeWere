import request from 'supertest';
import { describe, expect, beforeAll, beforeEach, afterAll, it } from 'vitest';
import app from '../../src/index';
import { query } from '../../src/db';
import {
  DEFAULT_USER_ID,
  resetIntegrationDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
} from '../helpers/testDb';

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

      await request(app).post(`/api/v1/media/items/${tv.id}/checkins`).send({
        checkin_type: 'completed', rating: 4, checked_in_at: '2023-01-02T20:00:00Z', timezone: 'UTC',
      });
      await request(app).post(`/api/v1/media/items/${tv.id}/checkins`).send({
        checkin_type: 'in_progress', checked_in_at: '2023-01-03T20:00:00Z', timezone: 'UTC',
      });
      await request(app).post(`/api/v1/media/items/${movie.id}/checkins`).send({
        checkin_type: 'completed', rating: 3, checked_in_at: '2023-01-04T20:00:00Z', timezone: 'UTC',
      });

      const all = await request(app).get('/api/v1/media/stats');
      expect(all.status).toBe(200);
      expect(all.body.tv_episodes_completed).toBe(1);
      expect(all.body.movies_watched).toBe(1);
      expect(all.body.books_completed).toBe(0);
      expect(all.body.top_media).toHaveLength(2);
      expect(all.body.top_media[0].title).toBe('Severance');

      const filtered = await request(app).get('/api/v1/media/stats').query({ from: '2023-01-04', to: '2023-01-04' });
      expect(filtered.body.tv_episodes_completed).toBe(0);
      expect(filtered.body.movies_watched).toBe(1);
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

  describe('yamtrack import', () => {
    const csv = [
      CSV_HEADER,
      '"100088","tmdb","tv","The Last of Us","img","","","","Completed","","2023-04-04 01:49:00+00:00","2025-05-26 01:50:00+00:00","16","",""',
      // Episode rows store the watch time in end_date (start_date blank).
      '"100088","tmdb","episode","Pilot","img","1","1","10","Completed","","","2023-04-04 01:50:00+00:00","0","",""',
      // Rewatch of the same episode with a different end_date: distinct check-in.
      '"100088","tmdb","episode","Pilot","img","1","1","9","Completed","","","2023-06-01 01:50:00+00:00","0","",""',
      '"550","tmdb","movie","Dune","img","","","","Completed","","2023-04-05 01:50:00+00:00","","0","",""',
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

    it('requires a csv string', async () => {
      const response = await request(app).post('/api/v1/import/yamtrack/import').send({});
      expect(response.status).toBe(400);
    });
  });
});
