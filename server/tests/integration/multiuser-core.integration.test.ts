/**
 * Multi-user isolation for the core server: jobs, backup export/restore,
 * Start Over, companions, generic plugin check-ins and settings, user
 * settings, the unified timeline, stats, LLM tasks and Immich photos.
 *
 * Every request is the default user ("A", an admin) unless it sets
 * `.set('Cookie', b.cookie)` to act as the second user ("B"). Another
 * user's rows must behave exactly like missing ones, and nothing B does may
 * read, change, or delete A's data.
 */

import request from 'supertest';
import { describe, expect, beforeAll, beforeEach, afterAll, afterEach, it, vi } from 'vitest';
import { createApp } from '../../src/index';
import { query } from '../../src/db';
import {
  DEFAULT_USER_ID as A,
  resetIntegrationDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
} from '../helpers/testDb';
import { createTestUser, type TestUser } from '../helpers/auth';
import { registerPlugin } from '../../src/plugins/registry';
import { currentUserId } from '../../src/auth/context';
import fs from 'fs';
import path from 'path';
import {
  BACKUP_FORMAT,
  LATEST_BACKUP_SCHEMA_VERSION,
  buildBackupZip,
  extractBackupZip,
  readBackupJsonFile,
  removeBackupTempDir,
} from '../../src/services/backupArchive';
import { genericPlugin, PLUGIN_ID } from '../fixtures/genericPlugin';

const app = createApp();

/** Collect a binary (ZIP) response body into a Buffer. */
function binaryParser(res: any, callback: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

/** A's generic check-in, created through the API. */
async function createGenericCheckin(cookie?: string, flavor = 'chocolate'): Promise<string> {
  let req = request(app).post(`/api/v1/plugins/${PLUGIN_ID}/checkins`);
  if (cookie) req = req.set('Cookie', cookie);
  const res = await req.send({ checked_in_at: '2025-03-01T12:00:00Z', data: { flavor, score: 4 } });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const result = await query(sql, params);
  return Number(result.rows[0].n);
}

describe('Multi-user isolation (core)', () => {
  let b: TestUser;

  beforeAll(async () => {
    await setupIntegrationDatabase();
    registerPlugin(genericPlugin);
    await query(
      `CREATE TABLE IF NOT EXISTS test_extra_rows (id UUID PRIMARY KEY, user_id UUID NOT NULL, label TEXT NOT NULL)`
    );
    // A custom-storage plugin whose extra backup table carries user_id in
    // the row itself (no userIdFirst), as a careless plugin might.
    registerPlugin({
      ...genericPlugin,
      id: 'test_custom_extra',
      server: {
        storage: 'custom',
        backupExport: async () => [],
        backupImport: async () => 0,
        deleteUserData: async () => 0,
        extraBackupTables: [{
          table: 'test_extra_rows',
          select: 'SELECT id, user_id, label FROM test_extra_rows WHERE user_id = $1',
          insert: 'INSERT INTO test_extra_rows (id, user_id, label) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
        }],
      },
    } as any);
  });

  beforeEach(async () => {
    await resetIntegrationDatabase();
    b = await createTestUser('other');
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  // ---------------------------------------------------------------------------
  describe('generic plugin check-ins and settings', () => {
    it("hides A's check-ins from B (list/get/update/delete all behave as missing)", async () => {
      const id = await createGenericCheckin();

      const list = await request(app).get(`/api/v1/plugins/${PLUGIN_ID}/checkins`).set('Cookie', b.cookie);
      expect(list.status).toBe(200);
      expect(list.body).toEqual([]);

      const get = await request(app).get(`/api/v1/plugins/${PLUGIN_ID}/checkins/${id}`).set('Cookie', b.cookie);
      expect(get.status).toBe(404);

      const put = await request(app)
        .put(`/api/v1/plugins/${PLUGIN_ID}/checkins/${id}`)
        .set('Cookie', b.cookie)
        .send({ data: { flavor: 'strawberry' } });
      expect(put.status).toBe(404);

      const del = await request(app).delete(`/api/v1/plugins/${PLUGIN_ID}/checkins/${id}`).set('Cookie', b.cookie);
      expect(del.status).toBe(404);

      const row = await query('SELECT user_id, data FROM plugin_checkins WHERE id = $1', [id]);
      expect(row.rows[0].user_id).toBe(A);
      expect(row.rows[0].data.flavor).toBe('chocolate');

      // A still sees its own; B's own check-in is B's.
      const mine = await request(app).get(`/api/v1/plugins/${PLUGIN_ID}/checkins`);
      expect(mine.body.map((r: { id: string }) => r.id)).toEqual([id]);
      const bId = await createGenericCheckin(b.cookie, 'strawberry');
      const bRow = await query('SELECT user_id FROM plugin_checkins WHERE id = $1', [bId]);
      expect(bRow.rows[0].user_id).toBe(b.id);
      expect((await request(app).get(`/api/v1/plugins/${PLUGIN_ID}/checkins/${bId}`)).status).toBe(404);
    });

    it('keeps plugin settings per user', async () => {
      await request(app).put(`/api/v1/plugins/${PLUGIN_ID}/settings`).send({ demo: 'a-value' }).expect(200);
      const bGet = await request(app).get(`/api/v1/plugins/${PLUGIN_ID}/settings`).set('Cookie', b.cookie);
      expect(bGet.body).toEqual({ demo: null });
      await request(app)
        .put(`/api/v1/plugins/${PLUGIN_ID}/settings`)
        .set('Cookie', b.cookie)
        .send({ demo: 'b-value' })
        .expect(200);
      const aGet = await request(app).get(`/api/v1/plugins/${PLUGIN_ID}/settings`);
      expect(aGet.body).toEqual({ demo: 'a-value' });
    });
  });

  // ---------------------------------------------------------------------------
  describe('timeline', () => {
    it("never returns A's check-ins to B, even when B passes A's user_id", async () => {
      const id = await createGenericCheckin();
      await query(
        `INSERT INTO companions (user_id, checkin_type, checkin_id, name) VALUES ($1, $2, $3, 'Ada')`,
        [A, PLUGIN_ID, id]
      );

      const mine = await request(app).get('/api/v1/timeline');
      expect(mine.status).toBe(200);
      expect(mine.body.map((r: { id: string }) => r.id)).toContain(id);

      for (const qs of ['', `?user_id=${A}`, `?types=${PLUGIN_ID}`, '?companion=Ada', `?q=chocolate`]) {
        const res = await request(app).get(`/api/v1/timeline${qs}`).set('Cookie', b.cookie);
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
      }

      // B's companion row with the same name must not pull A's check-in in.
      await query(`INSERT INTO companions (user_id, name) VALUES ($1, 'Ada') ON CONFLICT DO NOTHING`, [b.id]);
      const filtered = await request(app).get('/api/v1/timeline?companion=Ada').set('Cookie', b.cookie);
      expect(filtered.body).toEqual([]);
      const aFiltered = await request(app).get('/api/v1/timeline?companion=Ada');
      expect(aFiltered.body.map((r: { id: string }) => r.id)).toEqual([id]);
    });
  });

  // ---------------------------------------------------------------------------
  describe('stats', () => {
    async function insertScubaDive(userId: string, at: string) {
      const result = await query(
        `INSERT INTO plugin_checkins (plugin_id, user_id, checked_in_at, checkin_timezone, data)
         VALUES ('scuba', $1, $2, 'UTC', '{"place": "Reef"}'::jsonb) RETURNING id`,
        [userId, at]
      );
      return result.rows[0].id as string;
    }

    it("scopes reflections and earliest dates to the signed-in user (ignores user_id)", async () => {
      const id = await insertScubaDive(A, '2023-06-15T12:00:00Z');

      const aRefl = await request(app).get('/api/v1/stats/reflections?target_date=2026-06-15');
      expect(aRefl.status).toBe(200);
      expect(aRefl.body.flatMap((y: { items: { id: string }[] }) => y.items.map((i) => i.id))).toContain(id);

      const bRefl = await request(app)
        .get(`/api/v1/stats/reflections?user_id=${A}&target_date=2026-06-15`)
        .set('Cookie', b.cookie);
      expect(bRefl.status).toBe(200);
      expect(bRefl.body).toEqual([]);

      const aEarliest = await request(app).get('/api/v1/stats/earliest-dates');
      expect(aEarliest.status).toBe(200);
      expect(aEarliest.body.scuba).toMatch(/^2023-06-15/);

      const bEarliest = await request(app).get(`/api/v1/stats/earliest-dates?user_id=${A}`).set('Cookie', b.cookie);
      expect(bEarliest.status).toBe(200);
      expect(bEarliest.body.scuba).toBeNull();
    });

    it("won't apply a timestamp reconciliation to another user's check-in", async () => {
      const id = await insertScubaDive(A, '2023-06-15T12:00:00Z');
      const res = await request(app)
        .post('/api/v1/settings/timestamp-reconciliation/apply')
        .set('Cookie', b.cookie)
        .send({ updates: [{ id, type: 'scuba', suggested_timezone: 'Europe/Paris' }] });
      expect(res.status).toBe(400);
      const row = await query('SELECT checkin_timezone FROM plugin_checkins WHERE id = $1', [id]);
      expect(row.rows[0].checkin_timezone).toBe('UTC');

      const own = await request(app)
        .post('/api/v1/settings/timestamp-reconciliation/apply')
        .send({ updates: [{ id, type: 'scuba', suggested_timezone: 'Europe/Paris' }] });
      expect(own.status).toBe(200);
      expect(own.body).toEqual({ updated: 1 });
    });
  });

  // ---------------------------------------------------------------------------
  describe('jobs', () => {
    it("scopes list/get/cancel and the one-active-job rule per user", async () => {
      const aJob = await query(
        `INSERT INTO jobs (user_id, type, status) VALUES ($1, 'backfill', 'running') RETURNING id`,
        [A]
      );
      const aJobId = aJob.rows[0].id as string;

      // A's running job doesn't block B's job of the same type...
      const bStart = await request(app).post('/api/v1/jobs').set('Cookie', b.cookie).send({ type: 'backfill' });
      expect(bStart.status).toBe(201);
      // ...but still blocks A's second one (and names A's own job).
      const aStart = await request(app).post('/api/v1/jobs').send({ type: 'backfill' });
      expect(aStart.status).toBe(409);
      expect(aStart.body.job_id).toBe(aJobId);

      const bRow = await query('SELECT user_id FROM jobs WHERE id = $1', [bStart.body.id]);
      expect(bRow.rows[0].user_id).toBe(b.id);

      const bList = await request(app).get('/api/v1/jobs').set('Cookie', b.cookie);
      expect(bList.body.map((j: { id: string }) => j.id)).toEqual([bStart.body.id]);
      const aList = await request(app).get('/api/v1/jobs');
      expect(aList.body.map((j: { id: string }) => j.id)).toEqual([aJobId]);

      expect((await request(app).get(`/api/v1/jobs/${aJobId}`).set('Cookie', b.cookie)).status).toBe(404);
      expect((await request(app).post(`/api/v1/jobs/${aJobId}/cancel`).set('Cookie', b.cookie)).status).toBe(404);
      const status = await query('SELECT status FROM jobs WHERE id = $1', [aJobId]);
      expect(status.rows[0].status).toBe('running');

      // Let B's (empty-DB, instant) job finish so it doesn't outlive the test.
      await new Promise((r) => setTimeout(r, 300));
    });

    it("runs a job's handler as the job's owner, even outside a request", async () => {
      const { runPluginJob, findPluginJob } = await import('../../src/services/jobs');
      const definition = findPluginJob('backfill')!;
      const inserted = await query(
        `INSERT INTO jobs (user_id, type, status) VALUES ($1, 'backfill', 'pending') RETURNING id`,
        [b.id]
      );
      let ranAs: string | null = null;
      await runPluginJob(inserted.rows[0].id, {
        ...definition,
        handler: async () => {
          ranAs = currentUserId();
        },
      });
      expect(ranAs).toBe(b.id);
    });
  });

  // ---------------------------------------------------------------------------
  describe('companions', () => {
    it("keeps each user's name pool, summaries, renames and deletes separate", async () => {
      const id = await createGenericCheckin();
      await query(
        `INSERT INTO companions (user_id, checkin_type, checkin_id, name) VALUES ($1, $2, $3, 'Ada')`,
        [A, PLUGIN_ID, id]
      );
      await request(app).post('/api/v1/companions/names').send({ name: 'Grace' }).expect(201);

      const bNames = await request(app).get('/api/v1/companions/names').set('Cookie', b.cookie);
      expect(bNames.body).toEqual([]);
      const bSummaries = await request(app).get('/api/v1/companions').set('Cookie', b.cookie);
      expect(bSummaries.body).toEqual([]);

      const rename = await request(app)
        .put('/api/v1/companions/names')
        .set('Cookie', b.cookie)
        .send({ from: 'Ada', to: 'Bob' });
      expect(rename.status).toBe(200);
      expect(rename.body).toEqual({ updated: 0 });
      const del = await request(app).delete('/api/v1/companions/names').set('Cookie', b.cookie).send({ name: 'Grace' });
      expect(del.body).toEqual({ deleted: 0 });

      await request(app).post('/api/v1/companions/names').set('Cookie', b.cookie).send({ name: 'Zed' }).expect(201);
      const zed = await query(`SELECT user_id FROM companions WHERE name = 'Zed'`);
      expect(zed.rows.map((r) => r.user_id)).toEqual([b.id]);

      const aNames = await request(app).get('/api/v1/companions/names');
      expect(aNames.body).toEqual(['Ada', 'Grace']);
      const aSummaries = await request(app).get('/api/v1/companions');
      expect(aSummaries.body.map((s: { name: string; checkin_count: number }) => [s.name, s.checkin_count]))
        .toEqual([['Ada', 1], ['Grace', 0]]);
      const aRows = await query('SELECT name, user_id FROM companions WHERE user_id = $1 ORDER BY name', [A]);
      expect(aRows.rows.map((r) => r.name)).toEqual(['Ada', 'Grace']);
    });

    // Migration 074 makes standalone names unique per (user_id, lower(name)).
    it("lets B add a standalone name A already has", async () => {
      await request(app).post('/api/v1/companions/names').send({ name: 'Grace' }).expect(201);
      await request(app).post('/api/v1/companions/names').set('Cookie', b.cookie).send({ name: 'Grace' }).expect(201);
      const bNames = await request(app).get('/api/v1/companions/names').set('Cookie', b.cookie);
      expect(bNames.body).toEqual(['Grace']);
    });
  });

  // ---------------------------------------------------------------------------
  describe('settings', () => {
    it("reads and writes only the signed-in user's settings; PUT /profile is gone", async () => {
      await request(app)
        .put('/api/v1/settings')
        .send({ immich_url: 'http://a-immich', immich_api_key: 'a-secret', theme: 'dark' })
        .expect(200);

      const bGet = await request(app).get('/api/v1/settings').set('Cookie', b.cookie);
      expect(bGet.status).toBe(200);
      expect(bGet.body.username).toBe('other');
      expect(bGet.body.immich_url).toBeNull();
      expect(bGet.body.immich_api_key).toBeNull();
      expect(JSON.stringify(bGet.body)).not.toContain('a-secret');

      await request(app)
        .put('/api/v1/settings')
        .set('Cookie', b.cookie)
        .send({ immich_url: null, immich_api_key: 'b-secret', theme: 'light' })
        .expect(200);
      const aGet = await request(app).get('/api/v1/settings');
      expect(aGet.body).toMatchObject({ username: 'default', immich_url: 'http://a-immich', immich_api_key: 'a-secret', theme: 'dark' });

      const profile = await request(app).put('/api/v1/settings/profile').set('Cookie', b.cookie).send({ username: 'default' });
      expect(profile.status).toBe(404);
      const users = await query('SELECT username FROM users WHERE id = $1', [b.id]);
      expect(users.rows[0].username).toBe('other');
    });
  });

  // ---------------------------------------------------------------------------
  describe('LLM tasks and postcards', () => {
    it("hides a summary task from other users", async () => {
      const start = await request(app).post('/api/v1/llm/summarize').send({ from: 'bad', to: 'range' });
      expect(start.status).toBe(202);
      const taskId = start.body.task_id as string;
      await new Promise((r) => setTimeout(r, 50));
      expect((await request(app).get(`/api/v1/llm/summarize/${taskId}`).set('Cookie', b.cookie)).status).toBe(404);
      const own = await request(app).get(`/api/v1/llm/summarize/${taskId}`);
      expect(own.status).toBe(200);
      expect(own.body.status).toBe('error');
    });

    it("hides postcards from other users", async () => {
      const inserted = await query(
        `INSERT INTO postcards (user_id, period_from, period_to, addressed_to, sender_line, message)
         VALUES ($1, '2024-01-01', '2024-01-07', 'Me', 'Past me', 'Hello') RETURNING id`,
        [A]
      );
      const id = inserted.rows[0].id as string;
      const bList = await request(app).get('/api/v1/llm/postcards').set('Cookie', b.cookie);
      expect(bList.body).toEqual([]);
      expect((await request(app).get(`/api/v1/llm/postcards/${id}`).set('Cookie', b.cookie)).status).toBe(404);
      expect((await request(app).delete(`/api/v1/llm/postcards/${id}`).set('Cookie', b.cookie)).status).toBe(404);
      expect(await count('SELECT COUNT(*) AS n FROM postcards WHERE id = $1', [id])).toBe(1);
    });

    it("picks a postcard period only from the user's own check-ins", async () => {
      await query(
        `INSERT INTO plugin_checkins (plugin_id, user_id, checked_in_at, checkin_timezone, data)
         VALUES ('scuba', $1, '2024-05-01T10:00:00Z', 'UTC', '{}'::jsonb)`,
        [A]
      );
      await query(
        `INSERT INTO user_settings (user_id, llm_api_url, llm_model) VALUES ($1, 'http://llm.test/v1', 'm')`,
        [b.id]
      );
      const res = await request(app).post('/api/v1/llm/postcard').set('Cookie', b.cookie);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Not enough check-in data/);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Immich', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("won't resolve another user's check-in for photo lookups", async () => {
      const id = await createGenericCheckin();
      await query(
        `INSERT INTO user_settings (user_id, immich_url, immich_api_key) VALUES ($1, 'http://b-immich', 'b-key')`,
        [b.id]
      );
      const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ assets: { items: [] } }) }));
      vi.stubGlobal('fetch', fetchMock);

      const single = await request(app).get(`/api/v1/immich/photos/${id}`).set('Cookie', b.cookie);
      expect(single.status).toBe(404);
      const batch = await request(app).get(`/api/v1/immich/photos?checkin_ids=${id}`).set('Cookie', b.cookie);
      expect(batch.status).toBe(200);
      expect(batch.body).toEqual({ [id]: [] });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  describe('backup', () => {
    /** Seed A with one of everything the core backup covers. */
    async function seedA() {
      const checkinId = await createGenericCheckin();
      await query(
        `INSERT INTO companions (user_id, checkin_type, checkin_id, name) VALUES ($1, $2, $3, 'Ada')`,
        [A, PLUGIN_ID, checkinId]
      );
      await query(`INSERT INTO companions (user_id, name) VALUES ($1, 'Grace')`, [A]);
      const postcard = await query(
        `INSERT INTO postcards (user_id, period_from, period_to, addressed_to, sender_line, message)
         VALUES ($1, '2024-01-01', '2024-01-07', 'Me', 'Past me', 'Hello') RETURNING id`,
        [A]
      );
      await request(app).put(`/api/v1/plugins/${PLUGIN_ID}/settings`).send({ demo: 'a-value' }).expect(200);
      return { checkinId, postcardId: postcard.rows[0].id as string };
    }

    async function snapshotA() {
      const [checkins, companions, postcards, settings, user] = await Promise.all([
        query('SELECT id, data, user_id FROM plugin_checkins WHERE user_id = $1 ORDER BY id', [A]),
        query('SELECT checkin_type, checkin_id, name FROM companions WHERE user_id = $1 ORDER BY name', [A]),
        query('SELECT id, message FROM postcards WHERE user_id = $1 ORDER BY id', [A]),
        query('SELECT plugin_id, key, value FROM plugin_settings WHERE user_id = $1 ORDER BY key', [A]),
        query('SELECT username, display_name, is_admin, password_hash, webhook_token FROM users WHERE id = $1', [A]),
      ]);
      return {
        checkins: checkins.rows,
        companions: companions.rows,
        postcards: postcards.rows,
        settings: settings.rows,
        user: user.rows[0],
      };
    }

    async function exportZip(cookie?: string): Promise<Buffer> {
      let req = request(app).get('/api/v1/backup/export');
      if (cookie) req = req.set('Cookie', cookie);
      const res = await req.buffer(true).parse(binaryParser);
      expect(res.status).toBe(200);
      return res.body as Buffer;
    }

    it("exports only the signed-in user's data, without account secrets", async () => {
      await seedA();
      await createGenericCheckin(b.cookie, 'strawberry');

      const root = await extractBackupZip(await exportZip(b.cookie));
      try {
        const manifest = readBackupJsonFile(root, 'backup.json') as Record<string, any>;
        expect(manifest.user.username).toBe('other');
        for (const secret of ['password_hash', 'webhook_token', 'is_admin']) {
          expect(manifest.user).not.toHaveProperty(secret);
        }
        expect(readBackupJsonFile(root, 'companions.json') ?? []).toEqual([]);
        expect(readBackupJsonFile(root, 'postcards.json') ?? []).toEqual([]);
        const generic = readBackupJsonFile(root, `plugins/${PLUGIN_ID}.json`) as { checkins: { data: any }[]; settings?: unknown };
        expect(generic.checkins.map((c) => c.data.flavor)).toEqual(['strawberry']);
        expect(generic.settings).toBeUndefined();
      } finally {
        removeBackupTempDir(root);
      }
    });

    it("restoring A's export as B never touches or links to A's rows", async () => {
      const { checkinId } = await seedA();
      const zip = await exportZip();
      const before = await snapshotA();

      const res = await request(app)
        .post('/api/v1/backup/import')
        .set('Cookie', b.cookie)
        .attach('file', zip, { filename: 'backup.zip', contentType: 'application/zip' });
      expect(res.status).toBe(200);

      expect(await snapshotA()).toEqual(before);

      // A's check-in ids conflict, so nothing of them is restored for B, and
      // B's companion names are not attached to A's check-in.
      expect(await count('SELECT COUNT(*) AS n FROM plugin_checkins WHERE user_id = $1', [b.id])).toBe(0);
      expect(await count('SELECT COUNT(*) AS n FROM companions WHERE checkin_id = $1 AND user_id <> $2', [checkinId, A])).toBe(0);
      expect(await count('SELECT COUNT(*) AS n FROM postcards WHERE user_id = $1', [b.id])).toBe(0);

      // The backup's account record can't rename B or make it an admin.
      const bUser = await query('SELECT username, is_admin FROM users WHERE id = $1', [b.id]);
      expect(bUser.rows[0]).toEqual({ username: 'other', is_admin: false });
    });

    it("won't attach a crafted backup's companion rows to A's check-ins", async () => {
      const { checkinId } = await seedA();
      const zipPath = await buildBackupZip(
        { format: BACKUP_FORMAT, schemaVersion: LATEST_BACKUP_SCHEMA_VERSION, exportedAt: new Date().toISOString(), user: null, settings: null },
        {},
        [],
        [
          { checkin_type: PLUGIN_ID, checkin_id: checkinId, name: 'Mallory' },
          { checkin_type: PLUGIN_ID, checkin_id: checkinId.toUpperCase(), name: 'Eve' },
        ],
        [],
      );
      try {
        const res = await request(app)
          .post('/api/v1/backup/import')
          .set('Cookie', b.cookie)
          .attach('file', fs.readFileSync(zipPath), { filename: 'backup.zip', contentType: 'application/zip' });
        expect(res.status).toBe(200);
        expect(res.body.counts.companions).toEqual({ inserted: 0, skipped: 2 });
      } finally {
        removeBackupTempDir(path.dirname(zipPath));
      }
      expect(await count('SELECT COUNT(*) AS n FROM companions WHERE checkin_id = $1 AND user_id <> $2', [checkinId, A])).toBe(0);
    });

    it("forces the current user onto a plugin's extra-table rows", async () => {
      const rowId = '22222222-2222-4222-8222-222222222222';
      const zipPath = await buildBackupZip(
        { format: BACKUP_FORMAT, schemaVersion: LATEST_BACKUP_SCHEMA_VERSION, exportedAt: new Date().toISOString(), user: null, settings: null },
        { test_custom_extra: { checkins: [], extra: { test_extra_rows: [{ id: rowId, user_id: A, label: 'planted' }] } } },
        [],
        [],
        [],
      );
      try {
        const res = await request(app)
          .post('/api/v1/backup/import')
          .set('Cookie', b.cookie)
          .attach('file', fs.readFileSync(zipPath), { filename: 'backup.zip', contentType: 'application/zip' });
        expect(res.status).toBe(200);
      } finally {
        removeBackupTempDir(path.dirname(zipPath));
      }
      const row = await query('SELECT user_id FROM test_extra_rows WHERE id = $1', [rowId]);
      expect(row.rows[0].user_id).toBe(b.id);
    });

    it("restores B's own export into B's account", async () => {
      const bCheckin = await createGenericCheckin(b.cookie, 'strawberry');
      await query(
        `INSERT INTO companions (user_id, checkin_type, checkin_id, name) VALUES ($1, $2, $3, 'Zed')`,
        [b.id, PLUGIN_ID, bCheckin]
      );
      const zip = await exportZip(b.cookie);
      await query('DELETE FROM companions WHERE user_id = $1', [b.id]);
      await query('DELETE FROM plugin_checkins WHERE user_id = $1', [b.id]);

      const res = await request(app)
        .post('/api/v1/backup/import')
        .set('Cookie', b.cookie)
        .attach('file', zip, { filename: 'backup.zip', contentType: 'application/zip' });
      expect(res.status).toBe(200);
      const restored = await query('SELECT id, user_id FROM plugin_checkins WHERE user_id = $1', [b.id]);
      expect(restored.rows.map((r) => r.id)).toEqual([bCheckin]);
      const companions = await query('SELECT checkin_id, name, user_id FROM companions WHERE user_id = $1', [b.id]);
      expect(companions.rows).toEqual([{ checkin_id: bCheckin, name: 'Zed', user_id: b.id }]);
    });

    it('lets only the creator poll or download an export job', async () => {
      await seedA();
      const start = await request(app).post('/api/v1/backup/export-jobs');
      expect(start.status).toBe(202);
      const id = start.body.id as string;

      expect((await request(app).get(`/api/v1/backup/export-jobs/${id}`).set('Cookie', b.cookie)).status).toBe(404);

      let stage = '';
      for (let i = 0; i < 100 && stage !== 'ready' && stage !== 'error'; i++) {
        const status = await request(app).get(`/api/v1/backup/export-jobs/${id}`);
        expect(status.status).toBe(200);
        stage = status.body.stage;
        if (stage !== 'ready') await new Promise((r) => setTimeout(r, 50));
      }
      expect(stage).toBe('ready');

      const stolen = await request(app).get(`/api/v1/backup/export-jobs/${id}/download`).set('Cookie', b.cookie);
      expect(stolen.status).toBe(404);
      const own = await request(app).get(`/api/v1/backup/export-jobs/${id}/download`).buffer(true).parse(binaryParser);
      expect(own.status).toBe(200);
      expect(own.headers['content-type']).toBe('application/zip');
    });

    it("Start Over as B deletes only B's data", async () => {
      await seedA();
      await query(
        `INSERT INTO user_settings (user_id, immich_url, immich_api_key, theme) VALUES ($1, 'http://a', 'a-key', 'dark')`,
        [A]
      );
      const bCheckin = await createGenericCheckin(b.cookie, 'strawberry');
      await query(
        `INSERT INTO companions (user_id, checkin_type, checkin_id, name) VALUES ($1, $2, $3, 'Zed')`,
        [b.id, PLUGIN_ID, bCheckin]
      );
      await query(
        `INSERT INTO postcards (user_id, period_from, period_to, addressed_to, sender_line, message)
         VALUES ($1, '2024-02-01', '2024-02-07', 'B', 'Past B', 'Hi') RETURNING id`,
        [b.id]
      );
      await request(app)
        .put(`/api/v1/plugins/${PLUGIN_ID}/settings`)
        .set('Cookie', b.cookie)
        .send({ demo: 'b-value' })
        .expect(200);
      const before = await snapshotA();

      const res = await request(app)
        .post('/api/v1/backup/start-over')
        .set('Cookie', b.cookie)
        .send({
          first_confirmation: 'DELETE MY DATA',
          second_confirmation: 'START OVER',
          options: {
            [`delete_${PLUGIN_ID}_checkins`]: true,
            [`reset_${PLUGIN_ID}_settings`]: true,
            delete_companions: true,
            delete_postcards: true,
            reset_account_settings: true,
            reset_integrations_settings: true,
          },
        });
      expect(res.status).toBe(200);

      // B's data is gone...
      for (const table of ['plugin_checkins', 'companions', 'postcards', 'plugin_settings']) {
        expect(await count(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = $1`, [b.id])).toBe(0);
      }
      // ...and A's is exactly as it was.
      expect(await snapshotA()).toEqual(before);
      const aSettings = await query('SELECT immich_url, immich_api_key, theme FROM user_settings WHERE user_id = $1', [A]);
      expect(aSettings.rows[0]).toEqual({ immich_url: 'http://a', immich_api_key: 'a-key', theme: 'dark' });
    });
  });
});
