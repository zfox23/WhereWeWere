import request from 'supertest';
import { describe, expect, beforeAll, beforeEach, afterAll, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import app from '../../../../server/src/index';
import { query } from '../../../../server/src/db';
import {
  resetIntegrationDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
} from '../../../../server/tests/helpers/testDb';
import {
  extractBackupZip,
  readBackupJsonFile,
  removeBackupTempDir,
} from '../../../../server/src/services/backupArchive';

/**
 * Fetch the current backup (v2 ZIP) and return both the raw buffer (for
 * restoring) and the per-plugin JSON payloads decoded from it.
 */
async function fetchBackupBundle(): Promise<{
  zip: Buffer;
  manifest: Record<string, any>;
  plugins: Record<string, any>;
}> {
  const zip = await new Promise<Buffer>((resolve, reject) => {
    request(app)
      .get('/api/v1/backup/export')
      .buffer(true)
      .parse((res: any, cb: any) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
        res.on('error', reject);
      })
      .end((err: any, res: any) => {
        if (err) return reject(err);
        if (res.status !== 200) return reject(new Error(`export failed: ${res.status}`));
        resolve(res.body as Buffer);
      });
  });

  const root = await extractBackupZip(zip);
  try {
    const manifest = readBackupJsonFile(root, 'backup.json') as Record<string, any>;
    const plugins: Record<string, any> = {};
    const pluginsDir = path.join(root, 'plugins');
    for (const name of fs.readdirSync(pluginsDir)) {
      if (!name.endsWith('.json')) continue;
      plugins[name.slice(0, -'.json'.length)] = readBackupJsonFile(
        root,
        `plugins/${name}`,
      );
    }
    return { zip, manifest, plugins };
  } finally {
    removeBackupTempDir(root);
  }
}

/** Build a v1-style single-JSON document from bundle parts (for the legacy import path). */
function v1Document(manifest: Record<string, any>, data: Record<string, unknown>) {
  return {
    format: 'wherewewere-backup',
    schemaVersion: 1,
    exportedAt: manifest.exportedAt,
    data,
  };
}

/**
 * Media backup round-trip (post-plugin).
 *
 * New-format backups carry media rows under `data.plugins.media`:
 *   - `checkins`          the media_items rows (the plugin's "primary" table)
 *   - `extra.mediaCheckins` the media_checkins rows
 *   - `extra.mediaLists` / `extra.mediaListItems`
 * Pre-plugin backups keep the rows under the top-level `mediaItems` /
 * `mediaCheckins` / `mediaLists` / `mediaListItems` keys, which the media
 * plugin's restoreLegacyBackup hook still claims.
 */
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
    // Game item with a platform + IGDB-sourced metadata (set via PUT, the
    // same path the provider sync applies through).
    const game = await request(app)
      .post('/api/v1/media/items')
      .send({ media_type: 'game', title: 'Hades', platform: 'Nintendo Switch' });
    expect(game.status).toBe(201);
    const gameItem = await request(app)
      .put(`/api/v1/media/items/${game.body.id}`)
      .send({
        overview: 'Slash your way to freedom from the Underworld.',
        content_rating: 'T - Teen',
        players: 1,
        coop: 'No',
        genres: ['Action', 'Roguelike'],
        developers: ['Supergiant Games'],
        publishers: ['Supergiant Games'],
      });
    expect(gameItem.status).toBe(200);

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

    // Item-level user metadata on the game (independent of check-ins).
    const gameMeta = await request(app)
      .put(`/api/v1/media/items/${game.body.id}`)
      .send({ rating: 4, raw_score: 9.5, notes: 'speedrun gold', time_played_minutes: 185, status: 'in_progress' });
    expect(gameMeta.status).toBe(200);

    // Check-ins: the game check-in carries per-session time played, the book one does not.
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

  async function startOverMedia(options: Record<string, unknown> = { delete_media_checkins: true }) {
    const startOver = await request(app)
      .post('/api/v1/backup/start-over')
      .send({
        first_confirmation: 'DELETE MY DATA',
        second_confirmation: 'START OVER',
        options,
      });
    expect(startOver.status).toBe(200);
    return startOver.body.counts;
  }

  it('survives export -> start-over -> import with all media columns intact', async () => {
    const { game, book, gameCheckin, bookCheckin } = await seed();

    // 1. Export (v2 ZIP) and assert the new fields are present in the
    //    per-plugin JSON payload.
    const { zip, manifest, plugins } = await fetchBackupBundle();
    expect(manifest.schemaVersion).toBe(2);

    const mediaPayload = plugins.media;
    expect(mediaPayload).toBeTruthy();

    const exportedItems = mediaPayload.checkins as any[];
    const exportedGame = exportedItems.find((i) => i.id === game.id);
    expect(exportedGame).toBeTruthy();
    expect(exportedGame.platform).toBe('Nintendo Switch');
    expect(exportedGame.overview).toBe('Slash your way to freedom from the Underworld.');
    expect(exportedGame.content_rating).toBe('T - Teen');
    expect(exportedGame.players).toBe(1);
    expect(exportedGame.coop).toBe('No');
    expect(exportedGame.genres).toEqual(['Action', 'Roguelike']);
    expect(exportedGame.developers).toEqual(['Supergiant Games']);
    expect(exportedGame.publishers).toEqual(['Supergiant Games']);
    expect(exportedGame.page_count).toBeNull();
    expect(exportedGame.rating).toBe(4);
    expect(Number(exportedGame.raw_score)).toBe(9.5);
    expect(exportedGame.notes).toBe('speedrun gold');
    expect(exportedGame.time_played_minutes).toBe(185);
    expect(exportedGame.status).toBe('in_progress');
    expect(exportedGame.series_name).toBeNull();
    expect(exportedGame.series_position).toBeNull();
    expect(exportedGame.series_count).toBeNull();

    const exportedBook = exportedItems.find((i) => i.id === book.id);
    expect(exportedBook).toBeTruthy();
    expect(exportedBook.platform).toBeNull();
    expect(exportedBook.page_count).toBe(412);
    expect(exportedBook.series_name).toBe('Dune');
    expect(exportedBook.series_position).toBe(1);
    expect(exportedBook.series_count).toBe(6);
    expect(exportedBook.rating).toBeNull();
    expect(exportedBook.time_played_minutes).toBeNull();
    expect(exportedBook.status).toBeNull();

    const exportedCheckins = mediaPayload.extra.mediaCheckins as any[];
    const exportedGameCheckin = exportedCheckins.find((c) => c.id === gameCheckin.id);
    expect(exportedGameCheckin).toBeTruthy();
    expect(exportedGameCheckin.time_played_minutes).toBe(185);

    const exportedBookCheckin = exportedCheckins.find((c) => c.id === bookCheckin.id);
    expect(exportedBookCheckin).toBeTruthy();
    expect(exportedBookCheckin.time_played_minutes).toBeNull();

    // 2. Wipe media data (the plugin owns deletion; 2 items + 2 check-ins).
    const counts = await startOverMedia();
    expect(counts.plugin_checkins_media).toBe(4);
    const itemsLeft = await query('SELECT COUNT(*)::int AS n FROM media_items', []);
    expect(itemsLeft.rows[0].n).toBe(0);
    const checkinsLeft = await query('SELECT COUNT(*)::int AS n FROM media_checkins', []);
    expect(checkinsLeft.rows[0].n).toBe(0);

    // 3. Re-import the export (v2 ZIP).
    const importRes = await request(app)
      .post('/api/v1/backup/import')
      .attach('file', zip, 'wherewewere-backup.zip')
      .set('Content-Type', 'application/zip');
    expect(importRes.status).toBe(200);
    expect(importRes.body.schemaVersion).toBe(2);
    expect(importRes.body.counts['plugin:media'].inserted).toBe(4);

    // 4. Re-fetch and assert every field survived.
    const gameAfter = await request(app).get(`/api/v1/media/items/${game.id}`);
    expect(gameAfter.status).toBe(200);
    expect(gameAfter.body.platform).toBe('Nintendo Switch');
    expect(gameAfter.body.overview).toBe('Slash your way to freedom from the Underworld.');
    expect(gameAfter.body.content_rating).toBe('T - Teen');
    expect(gameAfter.body.players).toBe(1);
    expect(gameAfter.body.coop).toBe('No');
    expect(gameAfter.body.genres).toEqual(['Action', 'Roguelike']);
    expect(gameAfter.body.developers).toEqual(['Supergiant Games']);
    expect(gameAfter.body.publishers).toEqual(['Supergiant Games']);
    expect(gameAfter.body.rating).toBe(4);
    expect(Number(gameAfter.body.raw_score)).toBe(9.5);
    expect(gameAfter.body.notes).toBe('speedrun gold');
    expect(Number(gameAfter.body.time_played_minutes)).toBe(185);
    expect(gameAfter.body.status).toBe('in_progress');
    expect(Number(gameAfter.body.my_rating)).toBe(4);

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

    const { manifest, plugins } = await fetchBackupBundle();
    const mediaPayload = plugins.media;

    // Strip the new item keys to simulate a backup created before the
    // metadata columns existed. The primary items table is imported by named
    // access (missing key -> null), so the keys can be removed outright.
    for (const item of mediaPayload.checkins as any[]) {
      delete item.platform;
      delete item.overview;
      delete item.content_rating;
      delete item.players;
      delete item.coop;
      delete item.genres;
      delete item.developers;
      delete item.publishers;
      delete item.page_count;
      delete item.series_name;
      delete item.series_position;
      delete item.series_count;
      delete item.rating;
      delete item.raw_score;
      delete item.notes;
      delete item.time_played_minutes;
      delete item.status;
    }
    // The extra mediaCheckins table is imported positionally, so the key must
    // be present; null it instead of deleting it to exercise the same
    // "missing -> null" behavior.
    for (const checkin of mediaPayload.extra.mediaCheckins as any[]) {
      checkin.time_played_minutes = null;
    }

    await startOverMedia();

    // Restore through the legacy v1 single-JSON path: the per-plugin payload
    // is unchanged in shape between v1 and v2, only the container differs.
    const v1 = v1Document(manifest, {
      user: null,
      settings: null,
      plugins: { media: mediaPayload },
    });
    const importRes = await request(app).post('/api/v1/backup/import').send(v1);
    expect(importRes.status).toBe(200);
    expect(importRes.body.schemaVersion).toBe(1);
    expect(importRes.body.counts['plugin:media'].inserted).toBe(4);
    expect(importRes.body.errors).toHaveLength(0);

    const gameAfter = await request(app).get(`/api/v1/media/items/${game.id}`);
    expect(gameAfter.status).toBe(200);
    expect(gameAfter.body.platform).toBeNull();
    expect(gameAfter.body.overview).toBeNull();
    expect(gameAfter.body.content_rating).toBeNull();
    expect(gameAfter.body.players).toBeNull();
    expect(gameAfter.body.coop).toBeNull();
    expect(gameAfter.body.genres).toBeNull();
    expect(gameAfter.body.developers).toBeNull();
    expect(gameAfter.body.publishers).toBeNull();
    expect(gameAfter.body.rating).toBeNull();
    expect(gameAfter.body.raw_score).toBeNull();
    expect(gameAfter.body.notes).toBeNull();
    expect(gameAfter.body.time_played_minutes).toBeNull();
    expect(gameAfter.body.status).toBeNull();

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

  it('still wipes media via the legacy delete_media_items start-over option', async () => {
    await seed();
    const counts = await startOverMedia({ delete_media_items: true });
    // Pre-plugin clients used this option for the "All Media" checkbox; the
    // server maps it to the media plugin's deleteUserData hook.
    expect(counts.plugin_checkins_media).toBe(4);
    const itemsLeft = await query('SELECT COUNT(*)::int AS n FROM media_items', []);
    expect(itemsLeft.rows[0].n).toBe(0);
  });

  it('restores pre-plugin backups (top-level media keys, no plugins payload)', async () => {
    const { game, book, gameCheckin, bookCheckin } = await seed();

    const { manifest, plugins } = await fetchBackupBundle();
    const mediaPayload = plugins.media;

    // Reshape into the pre-plugin layout: rows under top-level data keys and
    // no plugins section at all.
    const v1 = v1Document(manifest, {
      user: null,
      settings: null,
      mediaItems: mediaPayload.checkins,
      mediaCheckins: mediaPayload.extra.mediaCheckins,
    });

    await startOverMedia();
    const itemsLeft = await query('SELECT COUNT(*)::int AS n FROM media_items', []);
    expect(itemsLeft.rows[0].n).toBe(0);

    const importRes = await request(app).post('/api/v1/backup/import').send(v1);
    expect(importRes.status).toBe(200);
    expect(importRes.body.counts.mediaItems).toEqual({ inserted: 2, skipped: 0 });
    expect(importRes.body.counts.mediaCheckins).toEqual({ inserted: 2, skipped: 0 });

    const gameAfter = await request(app).get(`/api/v1/media/items/${game.id}`);
    expect(gameAfter.status).toBe(200);
    expect(gameAfter.body.platform).toBe('Nintendo Switch');

    const bookAfter = await request(app).get(`/api/v1/media/items/${book.id}`);
    expect(bookAfter.status).toBe(200);
    expect(bookAfter.body.series_name).toBe('Dune');

    const gameCheckins = await request(app).get(`/api/v1/media/items/${game.id}/checkins`);
    expect(gameCheckins.status).toBe(200);
    expect(gameCheckins.body).toHaveLength(1);
    expect(Number(gameCheckins.body[0].time_played_minutes)).toBe(185);
    expect(gameCheckins.body[0].id).toBe(gameCheckin.id);

    const bookCheckins = await request(app).get(`/api/v1/media/items/${book.id}/checkins`);
    expect(bookCheckins.status).toBe(200);
    expect(bookCheckins.body.map((c: any) => c.id)).toEqual([bookCheckin.id]);
  });
});
