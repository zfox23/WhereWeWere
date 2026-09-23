import request from 'supertest';
import { describe, expect, beforeAll, beforeEach, afterAll, it } from 'vitest';
import { createApp } from '../../src/index';
import { query } from '../../src/db';
import {
  DEFAULT_USER_ID,
  resetIntegrationDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
} from '../helpers/testDb';
import { registerPlugin } from '../../src/plugins/registry';
import { exportPluginData, importPluginData, deletePluginData } from '../../src/plugins/backup';
import { pool } from '../../src/db';
import { genericPlugin, PLUGIN_ID } from '../fixtures/genericPlugin';

describe('Generic-storage plugin (framework defaults)', () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
    // Register the fixture after DB is up, before any requests. The plugin is
    // read from the registry per request (timeline, plugin routes, backup),
    // so late registration is safe — there is no plugin-owned API to mount.
    registerPlugin(genericPlugin);
  });

  beforeEach(async () => {
    await resetIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  const app = createApp();

  it('exposes the plugin manifest via the framework route', async () => {
    const res = await request(app).get(`/api/v1/plugins/${PLUGIN_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(PLUGIN_ID);
    expect(res.body.fields).toHaveLength(3);
    expect(res.body.filterParams).toEqual(['flavor']);
  });

  it('rejects invalid check-in data (missing required field)', async () => {
    const res = await request(app)
      .post(`/api/v1/plugins/${PLUGIN_ID}/checkins`)
      .send({ data: { score: 4 } }); // no required `flavor`

    expect(res.status).toBe(400);
  });

  it('creates, lists, gets, updates (shallow-merge), and deletes', async () => {
    const created = await request(app)
      .post(`/api/v1/plugins/${PLUGIN_ID}/checkins`)
      .send({
        checked_in_at: '2024-05-01T12:00:00Z',
        checkin_timezone: 'America/New_York',
        data: { flavor: 'chocolate', score: 5, note: 'first' },
      });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    expect(created.body.data.flavor).toBe('chocolate');

    // list
    const list = await request(app).get(`/api/v1/plugins/${PLUGIN_ID}/checkins`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    // get
    const get = await request(app).get(`/api/v1/plugins/${PLUGIN_ID}/checkins/${id}`);
    expect(get.status).toBe(200);
    expect(get.body.id).toBe(id);

    // update: shallow-merge only changes provided keys
    const updated = await request(app)
      .put(`/api/v1/plugins/${PLUGIN_ID}/checkins/${id}`)
      .send({ data: { score: 3 } });
    expect(updated.status).toBe(200);
    expect(updated.body.data.score).toBe(3);
    expect(updated.body.data.flavor).toBe('chocolate'); // preserved
    expect(updated.body.data.note).toBe('first'); // preserved

    // delete
    const del = await request(app).delete(`/api/v1/plugins/${PLUGIN_ID}/checkins/${id}`);
    expect(del.status).toBe(200);
    const afterDelete = await request(app).get(`/api/v1/plugins/${PLUGIN_ID}/checkins`);
    expect(afterDelete.body).toHaveLength(0);
  });

  it('applies plugin filter params in the unified timeline', async () => {
    await request(app)
      .post(`/api/v1/plugins/${PLUGIN_ID}/checkins`)
      .send({ data: { flavor: 'chocolate', score: 5 } });
    await request(app)
      .post(`/api/v1/plugins/${PLUGIN_ID}/checkins`)
      .send({ data: { flavor: 'strawberry', score: 2 } });

    // Unfiltered timeline includes both, each with the full envelope.
    const all = await request(app).get('/api/v1/timeline').query({ user_id: DEFAULT_USER_ID });
    expect(all.status).toBe(200);
    const pluginRows = all.body.filter((row: any) => row.type === PLUGIN_ID);
    expect(pluginRows).toHaveLength(2);
    // Full envelope: the new `timezone` column and the typed `data` payload.
    expect(pluginRows[0]).toHaveProperty('timezone');
    expect(pluginRows[0]).toHaveProperty('data');

    // Filtered to a single value.
    const filtered = await request(app)
      .get('/api/v1/timeline')
      .query({ user_id: DEFAULT_USER_ID, flavor: 'strawberry' });
    expect(filtered.status).toBe(200);
    const filteredPluginRows = filtered.body.filter((row: any) => row.type === PLUGIN_ID);
    expect(filteredPluginRows).toHaveLength(1);
    expect(filteredPluginRows[0].data.flavor).toBe('strawberry');
  });

  it('round-trips a generic plugin through backup export + import', async () => {
    const created = await request(app)
      .post(`/api/v1/plugins/${PLUGIN_ID}/checkins`)
      .send({
        checked_in_at: '2023-01-15T09:30:00Z',
        checkin_timezone: 'Europe/Lisbon',
        data: { flavor: 'strawberry', score: 4, note: 'backup me' },
      });
    const originalId = created.body.id as string;

    // A plugin_settings row must ride along with the check-ins (regression:
    // settings were previously omitted from the export payload).
    await query(
      `INSERT INTO plugin_settings (user_id, plugin_id, key, value)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (user_id, plugin_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [DEFAULT_USER_ID, PLUGIN_ID, 'demo', JSON.stringify('backup me too')],
    );

    // Export via the framework collector.
    const payload = await exportPluginData(DEFAULT_USER_ID);
    expect(payload[PLUGIN_ID]?.checkins).toHaveLength(1);
    expect((payload[PLUGIN_ID].checkins as any[])[0].id).toBe(originalId);
    expect(payload[PLUGIN_ID]?.settings).toEqual({ demo: 'backup me too' });

    // Wipe, then restore through the same transactional path the import route uses.
    await query(`DELETE FROM plugin_checkins WHERE plugin_id = $1`, [PLUGIN_ID]);
    await query(`DELETE FROM plugin_settings WHERE plugin_id = $1`, [PLUGIN_ID]);
    const afterWipe = await request(app).get(`/api/v1/plugins/${PLUGIN_ID}/checkins`);
    expect(afterWipe.body).toHaveLength(0);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const counts = await importPluginData(client, DEFAULT_USER_ID, {
        [PLUGIN_ID]: { checkins: payload[PLUGIN_ID].checkins, settings: payload[PLUGIN_ID].settings },
      });
      await client.query('COMMIT');
      expect(counts[PLUGIN_ID].inserted).toBe(2); // 1 check-in + 1 settings row
      expect(counts[PLUGIN_ID].skipped).toBe(0);
    } finally {
      client.release();
    }

    const restored = await request(app).get(`/api/v1/plugins/${PLUGIN_ID}/checkins`);
    expect(restored.body).toHaveLength(1);
    expect(restored.body[0].id).toBe(originalId);
    expect(restored.body[0].data.flavor).toBe('strawberry');
    expect(restored.body[0].checkin_timezone).toBe('Europe/Lisbon');

    const restoredSettings = await query(
      `SELECT value FROM plugin_settings WHERE plugin_id = $1 AND key = 'demo'`,
      [PLUGIN_ID],
    );
    expect(restoredSettings.rows).toHaveLength(1);
    expect(restoredSettings.rows[0].value).toBe('backup me too');
  });

  it('deletes plugin check-ins (and settings) on start-over', async () => {
    await request(app)
      .post(`/api/v1/plugins/${PLUGIN_ID}/checkins`)
      .send({ data: { flavor: 'chocolate' } });

    // A settings row is cleaned up alongside the check-in data.
    await query(
      `INSERT INTO plugin_settings (user_id, plugin_id, key, value)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (user_id, plugin_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [DEFAULT_USER_ID, PLUGIN_ID, 'demo', JSON.stringify({ on: true })],
    );

    const client = await pool.connect();
    try {
      const counts = await deletePluginData(client, DEFAULT_USER_ID);
      expect(counts[PLUGIN_ID]).toBe(2); // 1 check-in + 1 settings row
    } finally {
      client.release();
    }

    const remaining = await query(
      `SELECT (SELECT COUNT(*) FROM plugin_checkins WHERE plugin_id = $1) AS c,
              (SELECT COUNT(*) FROM plugin_settings WHERE plugin_id = $1) AS s`,
      [PLUGIN_ID],
    );
    // COUNT(*) returns int8, which the pg driver surfaces as a string.
    expect(Number(remaining.rows[0].c)).toBe(0);
    expect(Number(remaining.rows[0].s)).toBe(0);
  });
});
