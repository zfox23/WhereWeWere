import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../../../server/src/index';
import { pool, query } from '../../../../server/src/db';
import { runAsUser } from '../../../../server/src/auth/context';
import { deletePluginData, exportPluginData, importPluginData, type PluginBackupPayload } from '../../../../server/src/plugins/backup';
import {
  DEFAULT_USER_ID,
  resetIntegrationDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
} from '../../../../server/tests/helpers/testDb';
import { createTestUser, type TestUser } from '../../../../server/tests/helpers/auth';
import { server } from '../../server';

const app = createApp();

async function restoreAs(userId: string, payload: PluginBackupPayload) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await runAsUser(userId, () => importPluginData(client, userId, payload));
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

describe('notes: one user never sees or touches another user’s notes', () => {
  let other: TestUser;
  let noteA = '';
  let noteB = '';
  let tagAlpha = '';
  let tagBeta = '';

  const as = (r: request.Test) => r.set('Cookie', other.cookie);
  /** Everything hanging off the owner's notes, to prove it is unchanged. */
  const ownerState = async () => (await query(
    `SELECT (SELECT json_agg(json_build_object('note', l.note_id, 'tag', t.name) ORDER BY t.name)
               FROM note_tag_links l JOIN note_tags t ON t.id = l.tag_id WHERE l.note_id = ANY($1::uuid[])) AS links,
            (SELECT COUNT(*) FROM note_embeddings WHERE note_id = ANY($1::uuid[]))::int AS embeddings,
            (SELECT COUNT(*) FROM note_theme_members WHERE note_id = ANY($1::uuid[]))::int AS members,
            (SELECT COUNT(*) FROM note_neighbors WHERE note_id = ANY($1::uuid[]) OR neighbor_id = ANY($1::uuid[]))::int AS neighbors,
            (SELECT json_agg(name ORDER BY name) FROM companions WHERE checkin_type = 'notes' AND checkin_id = ANY($1::uuid[])) AS companions,
            (SELECT json_agg(json_build_object('title', title, 'tz', checkin_timezone) ORDER BY title)
               FROM note_checkins WHERE id = ANY($1::uuid[])) AS notes`,
    [[noteA, noteB]],
  )).rows[0];

  beforeAll(setupIntegrationDatabase);
  beforeEach(async () => {
    await resetIntegrationDatabase();
    other = await createTestUser('other');
    const a = await request(app).post('/api/v1/notes/checkins').send({
      title: 'Secret A', body: 'Private ocean thoughts', checked_in_at: '2020-05-05T12:00:00Z',
      checkin_timezone: 'UTC', tags: ['Alpha'], companions: ['Sam'],
    });
    const b = await request(app).post('/api/v1/notes/checkins').send({
      title: 'Secret B', body: 'More', checked_in_at: '2021-05-05T12:00:00Z', checkin_timezone: 'UTC', tags: ['Beta'],
    });
    noteA = a.body.id;
    noteB = b.body.id;
    tagAlpha = a.body.tags[0].id;
    tagBeta = b.body.tags[0].id;
  });
  afterAll(teardownIntegrationDatabase);

  it("treats the owner's notes as missing: read, related, update, delete", async () => {
    const before = await ownerState();
    expect((await as(request(app).get(`/api/v1/notes/checkins/${noteA}`))).status).toBe(404);
    expect((await as(request(app).get(`/api/v1/notes/checkins/${noteA}/related`))).status).toBe(404);
    const put = await as(request(app).put(`/api/v1/notes/checkins/${noteA}`).send({ title: 'Mine', body: 'x', tags: ['Beta'], companions: ['Mallory'] }));
    expect(put.status).toBe(404);
    expect((await as(request(app).delete(`/api/v1/notes/checkins/${noteA}`))).status).toBe(404);
    // A failed delete must not take the note's companions with it.
    expect(await ownerState()).toEqual(before);
    expect(before.companions).toEqual(['Sam']);
  });

  it("lists, searches and counts none of the owner's notes", async () => {
    expect((await as(request(app).get('/api/v1/notes/checkins'))).body).toEqual([]);
    expect((await as(request(app).get('/api/v1/notes/tags'))).body).toEqual([]);
    const library = (await as(request(app).get('/api/v1/notes/library'))).body;
    expect(library).toEqual({ notes: [], tags: [], themes: [] });
    const graph = (await as(request(app).get('/api/v1/notes/graph'))).body;
    expect(graph).toEqual({ nodes: [], edges: [], tags: [], themes: [] });
    const stats = (await as(request(app).get('/api/v1/notes/stats'))).body;
    expect(stats.totals.notes).toBe(0);
    expect(stats.by_tag).toEqual([]);
    expect((await as(request(app).get('/api/v1/notes/analysis/status'))).body).toMatchObject({ total: 0, themes: 0, active_job_id: null });
    const feed = (await as(request(app).get('/api/v1/timeline').query({ q: 'ocean' }))).body as { type: string }[];
    expect(feed.filter((i) => i.type === 'notes')).toEqual([]);
    // The owner still sees both.
    expect((await request(app).get('/api/v1/notes/checkins')).body).toHaveLength(2);
  });

  it("doesn't show the other user the owner's analysis runs", async () => {
    await query(
      `INSERT INTO jobs (type, status, user_id, completed_at) VALUES ('notes-similarity', 'completed', $1, NOW())`,
      [DEFAULT_USER_ID],
    );
    const active = await query(
      `INSERT INTO jobs (type, status, user_id) VALUES ('notes-similarity', 'pending', $1) RETURNING id`,
      [DEFAULT_USER_ID],
    );
    expect((await as(request(app).get('/api/v1/notes/analysis/status'))).body)
      .toMatchObject({ last_run_at: null, active_job_id: null });
    expect((await request(app).get('/api/v1/notes/analysis/status')).body.active_job_id).toBe(active.rows[0].id);
  });

  it("can't rename, recolor, merge or delete the owner's tags", async () => {
    expect((await as(request(app).put(`/api/v1/notes/tags/${tagAlpha}`).send({ name: 'Hijacked', color: '#000000' }))).status).toBe(404);
    expect((await as(request(app).delete(`/api/v1/notes/tags/${tagAlpha}`))).status).toBe(404);
    expect((await as(request(app).post(`/api/v1/notes/tags/${tagAlpha}/merge`).send({ into_id: tagBeta }))).status).toBe(404);
    // Merging their own tag into the owner's is just as missing.
    const own = (await as(request(app).post('/api/v1/notes/tags').send({ name: 'Alpha' }))).body;
    expect(own.id).not.toBe(tagAlpha);
    expect((await as(request(app).post(`/api/v1/notes/tags/${own.id}/merge`).send({ into_id: tagAlpha }))).status).toBe(404);

    const tags = (await request(app).get('/api/v1/notes/tags')).body;
    expect(tags.map((t: { name: string; note_count: number }) => [t.name, t.note_count])).toEqual([['Alpha', 1], ['Beta', 1]]);
  });

  it("doesn't flag the owner's notes as duplicates of the other user's import", async () => {
    const preview = await as(request(app).post('/api/v1/import/notes/preview'))
      .field('meta', JSON.stringify([{ name: '2020-05-05 Secret A.md', lastModified: null }]))
      .field('fallback_timezone', 'UTC')
      .attach('files', Buffer.from('Private ocean thoughts'), '2020-05-05 Secret A.md');
    expect(preview.status).toBe(200);
    expect(preview.body.rows[0].duplicate).toBeNull();
    const imported = await as(request(app).post('/api/v1/import/notes'))
      .field('meta', JSON.stringify([{ name: '2020-05-05 Secret A.md', lastModified: null }]))
      .field('fallback_timezone', 'UTC')
      .field('tags', JSON.stringify(['Alpha']))
      .attach('files', Buffer.from('Private ocean thoughts'), '2020-05-05 Secret A.md');
    expect(imported.body.imported).toBe(1);
    const theirs = await query('SELECT n.user_id, t.user_id AS tag_user FROM note_checkins n JOIN note_tag_links l ON l.note_id = n.id JOIN note_tags t ON t.id = l.tag_id WHERE n.id = $1', [imported.body.imported_ids[0]]);
    expect(theirs.rows).toEqual([{ user_id: other.id, tag_user: other.id }]);
  });

  it("can't reconcile the owner's note timezones", async () => {
    expect(await runAsUser(other.id, () => server.reconcile!.apply(noteA, 'Europe/Paris'))).toBe(false);
    expect((await ownerState()).notes[0].tz).toBe('UTC');
  });

  it("starts over only the user's own notes", async () => {
    await as(request(app).post('/api/v1/notes/checkins').send({ body: 'Theirs', tags: ['Gamma'], companions: ['Pat'] }));
    const before = await ownerState();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await runAsUser(other.id, () => deletePluginData(client, other.id, ['notes']));
      await server.resetSettings!({ user_id: other.id, client });
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    expect((await query('SELECT COUNT(*)::int AS n FROM note_checkins WHERE user_id = $1', [other.id])).rows[0].n).toBe(0);
    expect(await ownerState()).toEqual(before);
    expect((await query('SELECT COUNT(*)::int AS n FROM note_tags WHERE user_id = $1', [DEFAULT_USER_ID])).rows[0].n).toBe(2);
  });

  it("restores the owner's backup into the restorer's own account without touching the owner's notes", async () => {
    const payload = await exportPluginData(DEFAULT_USER_ID);
    const before = await ownerState();
    await restoreAs(other.id, { notes: payload.notes });
    expect(await ownerState()).toEqual(before);
    // Every id in it is already the owner's, so each row is skipped rather than taken over.
    expect((await query('SELECT COUNT(*)::int AS n FROM note_checkins WHERE user_id = $1', [other.id])).rows[0].n).toBe(0);
    expect((await as(request(app).get('/api/v1/notes/tags'))).body).toEqual([]);
    expect((await request(app).get('/api/v1/notes/tags')).body.map((t: { name: string }) => t.name)).toEqual(['Alpha', 'Beta']);
  });

  it("never attaches a crafted backup's tags, embeddings, themes or neighbors to the owner's notes", async () => {
    const before = await ownerState();
    const theme = '7a7a7a7a-0000-4000-8000-000000000001';
    await restoreAs(other.id, {
      notes: {
        checkins: [],
        extra: {
          noteTags: [],
          noteTagLinks: [{ note_id: noteA, tag_name: 'Beta' }],
          noteEmbeddings: [{ note_id: noteA, model: 'm', content_hash: 'h', dims: 2, chunk_count: 1, embedding: [1, 0], embedded_at: null }],
          noteThemes: [{ id: theme, label: 'Planted', description: null, color: '#ffffff', size: 1, created_at: null }],
          noteThemeMembers: [{ note_id: noteA, theme_id: theme, rank: 1, score: 1 }],
          noteNeighbors: [{ note_id: noteA, neighbor_id: noteB, similarity: 0.9 }],
        },
      },
    });
    expect(await ownerState()).toEqual(before);
    expect(before).toMatchObject({ embeddings: 0, members: 0, neighbors: 0 });
    // The theme itself is the restorer's.
    expect((await query('SELECT user_id FROM note_themes WHERE id = $1', [theme])).rows).toEqual([{ user_id: other.id }]);
  });
});
