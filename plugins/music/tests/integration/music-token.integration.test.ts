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
import { createTestUser, type TestUser } from '../../../../server/tests/helpers/auth';

const BASE = '/apis/mlj_1';
const T0 = 1714564800;

/** The scrobbler key of whoever `cookie` signs in (generated on first read). */
async function keyOf(cookie?: string): Promise<string> {
  const req = request(app).get('/api/v1/music/settings');
  const res = cookie ? await req.set('Cookie', cookie) : await req;
  expect(res.status).toBe(200);
  return res.body.scrobbler_key;
}

// Multi-scrobbler has no session: every protocol call goes out signed out.
const scrobble = (key: string, title: string, offset = 0) =>
  request(app).post(`${BASE}/newscrobble`).unset('Cookie').send({ title, artists: ['Artist'], time: T0 + offset, key });
const history = (params: Record<string, string> = {}) =>
  request(app).get(`${BASE}/scrobbles`).unset('Cookie').query(params);

describe('scrobbler protocol with several accounts', () => {
  let other: TestUser;
  let ownerKey = '';
  let otherKey = '';

  beforeAll(async () => {
    await setupIntegrationDatabase();
  });
  beforeEach(async () => {
    await resetIntegrationDatabase();
    other = await createTestUser('other');
    ownerKey = await keyOf();
    otherKey = await keyOf(other.cookie);
  });
  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  it('keeps the app API behind login but lets multi-scrobbler in with a key alone', async () => {
    expect((await request(app).get('/api/v1/music/settings').unset('Cookie')).status).toBe(401);
    expect((await request(app).get(`${BASE}/serverinfo`).unset('Cookie')).status).toBe(200);
    expect((await request(app).get(`${BASE}/test`).unset('Cookie').query({ key: ownerKey })).body).toEqual({ status: 'ok' });
    expect((await request(app).get(`${BASE}/test`).unset('Cookie').query({ key: otherKey })).body).toEqual({ status: 'ok' });
  });

  it('gives every user their own key', async () => {
    expect(ownerKey).toMatch(/^[0-9a-f]{48}$/);
    expect(otherKey).toMatch(/^[0-9a-f]{48}$/);
    expect(otherKey).not.toBe(ownerKey);
  });

  it('rejects a wrong or missing key', async () => {
    expect((await request(app).get(`${BASE}/test`).unset('Cookie').query({ key: 'wrong' })).status).toBe(403);
    expect((await request(app).get(`${BASE}/test`).unset('Cookie')).status).toBe(403);
    expect((await scrobble('wrong', 'Nope')).status).toBe(403);
    expect((await request(app).post(`${BASE}/newscrobble`).unset('Cookie').send({ title: 'Nope', artists: ['A'], time: T0 })).status).toBe(403);
    expect((await history({ key: 'wrong' })).status).toBe(403);
    expect((await query('SELECT 1 FROM music_scrobbles')).rowCount).toBe(0);
  });

  it("files each play under the key's owner only", async () => {
    expect((await scrobble(ownerKey, 'Owner song')).status).toBe(200);
    expect((await scrobble(otherKey, 'Other song', 60)).status).toBe(200);
    const rows = (await query('SELECT user_id, title FROM music_scrobbles ORDER BY title')).rows;
    expect(rows).toEqual([
      { user_id: other.id, title: 'Other song' },
      { user_id: DEFAULT_USER_ID, title: 'Owner song' },
    ]);

    // Each account's app API sees only its own plays.
    const ownerStats = await request(app).get('/api/v1/music/settings');
    const otherStats = await request(app).get('/api/v1/music/settings').set('Cookie', other.cookie);
    expect(ownerStats.body.scrobbles).toBe(1);
    expect(otherStats.body.scrobbles).toBe(1);
  });

  it('lists history only for the key sent, and nothing without one', async () => {
    await scrobble(ownerKey, 'Owner song');
    await scrobble(otherKey, 'Other song', 60);
    const titles = (res: request.Response) => res.body.list.map((s: any) => s.track.title);

    expect(titles(await history({ key: ownerKey }))).toEqual(['Owner song']);
    expect(titles(await history({ key: otherKey }))).toEqual(['Other song']);
    // No key: no telling whose history it is, so none is shown.
    const anonymous = await history();
    expect(anonymous.status).toBe(200);
    expect(anonymous.body.list).toEqual([]);
  });

  it('carries the key on in pagination links', async () => {
    for (let i = 0; i < 3; i++) await scrobble(ownerKey, `Song ${i}`, i * 60);
    const first = await history({ key: ownerKey, perpage: '2' });
    expect(first.body.list).toHaveLength(2);
    const next = new URL(first.body.pagination.next_page, 'http://x');
    expect(next.searchParams.get('key')).toBe(ownerKey);
    const second = await request(app).get(`${next.pathname}${next.search}`).unset('Cookie');
    expect(second.body.list.map((s: any) => s.track.title)).toEqual(['Song 0']);
  });

  it("stops the old key and leaves the other user's alone when one regenerates", async () => {
    const rotated = await request(app).post('/api/v1/music/settings/regenerate-key').set('Cookie', other.cookie);
    expect(rotated.body.scrobbler_key).not.toBe(otherKey);
    expect((await request(app).get(`${BASE}/test`).unset('Cookie').query({ key: otherKey })).status).toBe(403);
    expect((await request(app).get(`${BASE}/test`).unset('Cookie').query({ key: rotated.body.scrobbler_key })).status).toBe(200);
    expect((await request(app).get(`${BASE}/test`).unset('Cookie').query({ key: ownerKey })).status).toBe(200);
  });

  it('opens neither account with a key two users share', async () => {
    await query(
      `UPDATE plugin_settings SET value = to_jsonb($1::text) WHERE user_id = $2 AND plugin_id = 'music' AND key = 'scrobbler_key'`,
      [ownerKey, other.id],
    );
    expect((await request(app).get(`${BASE}/test`).unset('Cookie').query({ key: ownerKey })).status).toBe(403);
    expect((await scrobble(ownerKey, 'Ambiguous')).status).toBe(403);
    expect((await history({ key: ownerKey })).status).toBe(403);
    expect((await query('SELECT 1 FROM music_scrobbles')).rowCount).toBe(0);
  });

  it("refuses a disabled account's key", async () => {
    await query('UPDATE users SET disabled_at = NOW() WHERE id = $1', [other.id]);
    expect((await scrobble(otherKey, 'Late')).status).toBe(403);
    expect((await scrobble(ownerKey, 'Fine')).status).toBe(200);
  });

  it("won't let a second account take over a key another user holds", async () => {
    const res = await request(app).put('/api/v1/plugins/music/settings').set('Cookie', other.cookie).send({ scrobbler_key: ownerKey });
    expect(res.status).toBe(409);
    expect(await keyOf(other.cookie)).toBe(otherKey);
    expect((await scrobble(ownerKey, 'Still mine')).status).toBe(200);
  });

  it("restoring the owner's backup into another account keeps the owner's key working", async () => {
    const exported = await request(app)
      .get('/api/v1/backup/export')
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(exported.status).toBe(200);

    const fresh = await createTestUser('fresh');
    const restored = await request(app)
      .post('/api/v1/backup/import')
      .set('Cookie', fresh.cookie)
      .attach('file', exported.body as Buffer, { filename: 'backup.zip', contentType: 'application/zip' });
    expect(restored.status).toBe(200);

    expect(await keyOf(fresh.cookie)).not.toBe(ownerKey);
    expect((await scrobble(ownerKey, 'Still mine')).status).toBe(200);
    const owners = await query(`SELECT DISTINCT user_id FROM music_scrobbles WHERE title = 'Still mine'`);
    expect(owners.rows).toEqual([{ user_id: DEFAULT_USER_ID }]);
  });
});
