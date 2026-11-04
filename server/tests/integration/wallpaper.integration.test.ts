/**
 * Photo wallpaper (Settings > Display > Background): upload, serve, delete,
 * per-user isolation, backup round trip and Start Over.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/index';
import { config } from '../../src/config';
import {
  DEFAULT_USER_ID as A,
  resetIntegrationDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
} from '../helpers/testDb';
import { createTestUser, type TestUser } from '../helpers/auth';
import { query } from '../../src/db';

const app = createApp();

// Smallest valid PNG (1×1) and a JPEG header: enough for type sniffing.
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201ffa6e5d1a40000000049454e44ae426082',
  'hex',
);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);

function binaryParser(res: any, callback: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

function put(body: Buffer, contentType: string, cookie?: string) {
  let req = request(app).put('/api/v1/settings/wallpaper').set('Content-Type', contentType);
  if (cookie) req = req.set('Cookie', cookie);
  return req.send(body);
}

function get(cookie?: string) {
  let req = request(app).get('/api/v1/settings/wallpaper');
  if (cookie) req = req.set('Cookie', cookie);
  return req.buffer(true).parse(binaryParser);
}

describe('wallpaper', () => {
  let b: TestUser;
  let tmpDataDir = '';
  const originalDataDir = config.dataDir;

  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  beforeEach(async () => {
    tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wallpaper-'));
    config.dataDir = tmpDataDir;
    await resetIntegrationDatabase();
    b = await createTestUser('other');
  });

  afterEach(() => {
    config.dataDir = originalDataDir;
    fs.rmSync(tmpDataDir, { recursive: true, force: true });
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  it('stores, serves and deletes the signed-in user\'s wallpaper only', async () => {
    expect((await get()).status).toBe(404);

    expect((await put(PNG, 'image/png')).status).toBe(200);
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toBe('private, no-cache');
    expect(Buffer.compare(res.body, PNG)).toBe(0);

    // B sees nothing of A's.
    expect((await get(b.cookie)).status).toBe(404);
    const bDelete = await request(app).delete('/api/v1/settings/wallpaper').set('Cookie', b.cookie);
    expect(bDelete.body).toEqual({ removed: false });
    expect((await get()).status).toBe(200);

    // Replacing with another format leaves exactly one file.
    expect((await put(JPEG, 'image/jpeg')).status).toBe(200);
    expect((await get()).headers['content-type']).toBe('image/jpeg');
    expect(fs.readdirSync(path.join(tmpDataDir, A, 'appearance'))).toEqual(['wallpaper.jpg']);

    const del = await request(app).delete('/api/v1/settings/wallpaper');
    expect(del.body).toEqual({ removed: true });
    expect((await get()).status).toBe(404);
  });

  it('rejects files that are not images, whatever their declared type', async () => {
    const res = await put(Buffer.from('<svg onload="alert(1)"/>'), 'image/png');
    expect(res.status).toBe(400);
    const wrongType = await put(PNG, 'text/plain');
    expect(wrongType.status).toBe(400);
    expect((await get()).status).toBe(404);
  });

  it('carries the wallpaper through backup export and restore', async () => {
    await put(PNG, 'image/png').expect(200);
    const exportRes = await request(app).get('/api/v1/backup/export').buffer(true).parse(binaryParser);
    expect(exportRes.status).toBe(200);

    const restore = await request(app)
      .post('/api/v1/backup/import')
      .set('Cookie', b.cookie)
      .attach('file', exportRes.body as Buffer, { filename: 'backup.zip', contentType: 'application/zip' });
    expect(restore.status).toBe(200);

    const bGet = await get(b.cookie);
    expect(bGet.status).toBe(200);
    expect(Buffer.compare(bGet.body, PNG)).toBe(0);
  });

  it('Start Over with account settings reset removes the wallpaper', async () => {
    await put(PNG, 'image/png', b.cookie).expect(200);
    await put(PNG, 'image/png').expect(200);
    const res = await request(app)
      .post('/api/v1/backup/start-over')
      .set('Cookie', b.cookie)
      .send({
        first_confirmation: 'DELETE MY DATA',
        second_confirmation: 'START OVER',
        options: { reset_account_settings: true },
      });
    expect(res.status).toBe(200);
    expect((await get(b.cookie)).status).toBe(404);
    expect((await get()).status).toBe(200);
  });

  describe('place patterns', () => {
    async function checkIn(userId: string, lat: number, lon: number) {
      const venue = await query(
        `INSERT INTO venues (name, latitude, longitude) VALUES ('Spot', $1, $2) RETURNING id`,
        [lat, lon],
      );
      await query(`INSERT INTO checkins (user_id, venue_id) VALUES ($1, $2)`, [userId, venue.rows[0].id]);
    }

    it("draws My Places from the signed-in user's own check-ins", async () => {
      await checkIn(A, 38.7223, -9.1393);
      await checkIn(A, 38.7169, -9.1399);

      const res = await request(app).get('/api/v1/place-patterns/myplaces.svg').buffer(true).parse(binaryParser);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('image/svg+xml');
      expect(res.headers['cache-control']).toContain('private');
      expect(res.body.toString().match(/<circle /g)).toHaveLength(2);

      // B has no check-ins: nothing to draw, and none of A's.
      const bRes = await request(app).get('/api/v1/place-patterns/myplaces.svg').set('Cookie', b.cookie);
      expect(bRes.status).toBe(404);
    });

    it('rejects unknown pattern names', async () => {
      expect((await request(app).get('/api/v1/place-patterns/secrets.svg')).status).toBe(404);
      expect((await request(app).get('/api/v1/place-patterns/myplaces')).status).toBe(404);
    });
  });
});
