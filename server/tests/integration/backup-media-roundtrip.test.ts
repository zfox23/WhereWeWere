import request from 'supertest';
import { describe, expect, beforeAll, beforeEach, afterAll, it } from 'vitest';
import app from '../../src/index';
import { query } from '../../src/db';
import {
  resetIntegrationDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
} from '../helpers/testDb';

describe('Backup export/import media round-trip', () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  async function seed() {
    // Game item with a platform.
    const game = await request(app)
      .post('/api/v1/media/items')
      .send({ media_type: 'game', title: 'Hades', platform: 'Nintendo Switch' });
    expect(game.status).toBe(201);

    // Book item with page count / series metadata.
    const book = await request(app)
      .post('/api/v1/media/items')
      .send({
        media_type: 'book',
        title: 'Dune',
        author: 'Frank Herbert',
        release_year: 2020,
        page_count: 412,
        series_name: 'Dune',
        series_position: 1,
        series_count: 6,
      });
    expect(book.status).toBe(201);

    // Check-ins: the game check-in carries cumulative time played, the book one does not.
    const gameCheckin = await request(app)
      .post(`/api/v1/media/items/${game.body.id}/checkins`)
      .send({
        checkin_type: 'in_progress',
        rating: 4,
        time_played_minutes: 185,
        checked_in_at: '2023-01-02T20:00:00Z',
        timezone: 'UTC',
      });
    expect(gameCheckin.status).toBe(201);

    const bookCheckin = await request(app)
      .post(`/api/v1/media/items/${book.body.id}/checkins`)
      .send({
        checkin_type: 'completed',
        checked_in_at: '2023-02-01T20:00:00Z',
        timezone: 'UTC',
      });
    expect(bookCheckin.status).toBe(201);

    return { game: game.body, book: book.body, gameCheckin: gameCheckin.body, bookCheckin: bookCheckin.body };
  }

  async function startOverMedia() {
    const startOver = await request(app)
      .post('/api/v1/backup/start-over')
      .send({
        first_confirmation: 'DELETE MY DATA',
        second_confirmation: 'START OVER',
        options: { delete_media_items: true },
      });
    expect(startOver.status).toBe(200);
    return startOver.body.counts;
  }

  it('survives export -> start-over -> import with all media columns intact', async () => {
    const { game, book, gameCheckin, bookCheckin } = await seed();

    // 1. Export and assert the new fields are present in the JSON.
    const exportRes = await request(app).get('/api/v1/backup/export');
    expect(exportRes.status).toBe(200);
    const payload = exportRes.body;

    const exportedGame = payload.data.mediaItems.find((i: any) => i.id === game.id);
    expect(exportedGame).toBeTruthy();
    expect(exportedGame.platform).toBe('Nintendo Switch');
    expect(exportedGame.page_count).toBeNull();
    expect(exportedGame.series_name).toBeNull();
    expect(exportedGame.series_position).toBeNull();
    expect(exportedGame.series_count).toBeNull();

    const exportedBook = payload.data.mediaItems.find((i: any) => i.id === book.id);
    expect(exportedBook).toBeTruthy();
    expect(exportedBook.platform).toBeNull();
    expect(exportedBook.page_count).toBe(412);
    expect(exportedBook.series_name).toBe('Dune');
    expect(exportedBook.series_position).toBe(1);
    expect(exportedBook.series_count).toBe(6);

    const exportedGameCheckin = payload.data.mediaCheckins.find((c: any) => c.id === gameCheckin.id);
    expect(exportedGameCheckin).toBeTruthy();
    expect(exportedGameCheckin.time_played_minutes).toBe(185);

    const exportedBookCheckin = payload.data.mediaCheckins.find((c: any) => c.id === bookCheckin.id);
    expect(exportedBookCheckin).toBeTruthy();
    expect(exportedBookCheckin.time_played_minutes).toBeNull();

    // 2. Wipe media data.
    const counts = await startOverMedia();
    expect(counts.media_items).toBe(2);
    expect(counts.media_checkins).toBe(2);

    // 3. Re-import the export.
    const importRes = await request(app).post('/api/v1/backup/import').send(payload);
    expect(importRes.status).toBe(200);
    expect(importRes.body.counts.mediaItems.inserted).toBe(2);
    expect(importRes.body.counts.mediaCheckins.inserted).toBe(2);

    // 4. Re-fetch and assert every field survived.
    const gameAfter = await request(app).get(`/api/v1/media/items/${game.id}`);
    expect(gameAfter.status).toBe(200);
    expect(gameAfter.body.platform).toBe('Nintendo Switch');
    expect(gameAfter.body.total_time_played_minutes).toBe(185);

    const bookAfter = await request(app).get(`/api/v1/media/items/${book.id}`);
    expect(bookAfter.status).toBe(200);
    expect(bookAfter.body.page_count).toBe(412);
    expect(bookAfter.body.series_name).toBe('Dune');
    expect(bookAfter.body.series_position).toBe(1);
    expect(bookAfter.body.series_count).toBe(6);

    const gameCheckins = await request(app).get(`/api/v1/media/items/${game.id}/checkins`);
    expect(gameCheckins.status).toBe(200);
    expect(gameCheckins.body).toHaveLength(1);
    expect(Number(gameCheckins.body[0].time_played_minutes)).toBe(185);

    const bookCheckins = await request(app).get(`/api/v1/media/items/${book.id}/checkins`);
    expect(bookCheckins.status).toBe(200);
    expect(bookCheckins.body).toHaveLength(1);
    expect(bookCheckins.body[0].time_played_minutes).toBeNull();
  });

  it('imports legacy-shaped payloads (missing new keys) as nulls without error', async () => {
    const { game, book, gameCheckin, bookCheckin } = await seed();

    const exportRes = await request(app).get('/api/v1/backup/export');
    expect(exportRes.status).toBe(200);
    const payload = exportRes.body;

    // Strip the new keys to simulate a backup created before the fix.
    for (const item of payload.data.mediaItems) {
      delete item.platform;
      delete item.page_count;
      delete item.series_name;
      delete item.series_position;
      delete item.series_count;
    }
    for (const checkin of payload.data.mediaCheckins) {
      delete checkin.time_played_minutes;
    }

    await startOverMedia();

    const importRes = await request(app).post('/api/v1/backup/import').send(payload);
    expect(importRes.status).toBe(200);
    expect(importRes.body.counts.mediaItems.inserted).toBe(2);
    expect(importRes.body.counts.mediaCheckins.inserted).toBe(2);
    expect(importRes.body.errors).toHaveLength(0);

    const gameAfter = await request(app).get(`/api/v1/media/items/${game.id}`);
    expect(gameAfter.status).toBe(200);
    expect(gameAfter.body.platform).toBeNull();
    expect(gameAfter.body.total_time_played_minutes).toBeNull();

    const bookAfter = await request(app).get(`/api/v1/media/items/${book.id}`);
    expect(bookAfter.status).toBe(200);
    expect(bookAfter.body.page_count).toBeNull();
    expect(bookAfter.body.series_name).toBeNull();
    expect(bookAfter.body.series_position).toBeNull();
    expect(bookAfter.body.series_count).toBeNull();

    // Both check-ins still exist, with null time_played_minutes.
    const checkinRows = await query('SELECT id, time_played_minutes FROM media_checkins ORDER BY id');
    expect(checkinRows.rows).toHaveLength(2);
    expect(checkinRows.rows.every((r: any) => r.time_played_minutes === null)).toBe(true);
    expect(checkinRows.rows.map((r: any) => r.id).sort()).toEqual(
      [gameCheckin.id, bookCheckin.id].sort()
    );
  });
});
