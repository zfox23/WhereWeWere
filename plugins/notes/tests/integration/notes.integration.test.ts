import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../../server/src/index';
import { pool, query } from '../../../../server/src/db';
import { runAsUser } from '../../../../server/src/auth/context';
import { deletePluginData, exportPluginData, importPluginData } from '../../../../server/src/plugins/backup';
import {
  DEFAULT_USER_ID,
  resetIntegrationDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
} from '../../../../server/tests/helpers/testDb';
import { server } from '../../server';

const app = createApp();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Topic words -> embedding axes, so notes about the same thing land together. */
const AXES = ['mom', 'work', 'dream', 'ocean'];

function fakeEmbedding(text: string): number[] {
  const lower = text.toLowerCase();
  return [...AXES.map((w) => (lower.includes(w) ? 1 : 0.02)), 0.01];
}

/** Stubs the embedding endpoint and the chat LLM; counts embedded inputs. */
function stubExternal() {
  const embedded: string[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === 'http://embed.test/v1/embeddings') {
      const { input: texts } = JSON.parse(String(init?.body)) as { input: string[] };
      embedded.push(...texts);
      return json({ data: texts.map((t, index) => ({ index, embedding: fakeEmbedding(t) })) });
    }
    if (url === 'http://llm.test/v1/chat/completions') {
      const prompt = JSON.parse(String(init?.body)).messages[1].content as string;
      const topic = AXES.find((w) => prompt.toLowerCase().includes(w)) ?? 'misc';
      return json({ choices: [{ message: { content: `{"label": "About ${topic}", "description": "Notes about ${topic}."}` } }] });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, embedded };
}

async function createNote(body: Record<string, unknown>) {
  const res = await request(app).post('/api/v1/notes/checkins').send(body);
  expect(res.status).toBe(201);
  return res.body as { id: string; tags: { id: string; name: string; color: string }[] };
}

async function runJob(): Promise<Record<string, any>> {
  const started = await request(app).post('/api/v1/jobs').send({ type: 'notes-similarity' });
  expect(started.status).toBe(201);
  let job = started.body;
  for (let i = 0; i < 200 && ['pending', 'running'].includes(job.status); i++) {
    await new Promise((r) => setTimeout(r, 25));
    job = (await request(app).get(`/api/v1/jobs/${started.body.id}`)).body;
  }
  return job;
}

describe('Notes plugin (integration)', () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });
  beforeEach(async () => {
    await resetIntegrationDatabase();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  it('creates, edits and deletes a note with tags and companions', async () => {
    const note = await createNote({
      title: 'Session 4',
      body: '# Talked\n\n- about **work**',
      checked_in_at: '2026-10-28T20:00:00-05:00',
      checkin_timezone: 'America/Chicago',
      tags: ["Couple's Therapy Notes", 'Journaling'],
      companions: ['Sam'],
    });
    expect(note.tags.map((t) => t.name)).toEqual(["Couple's Therapy Notes", 'Journaling']);

    // A second note reuses a tag case-insensitively.
    const second = await createNote({ body: 'Another', tags: ['journaling', 'Dream Journal'] });
    expect(second.tags.map((t) => t.name)).toEqual(['Dream Journal', 'Journaling']);
    expect((await query('SELECT COUNT(*)::int AS n FROM note_tags')).rows[0].n).toBe(3);

    const got = await request(app).get(`/api/v1/notes/checkins/${note.id}`);
    expect(got.body).toMatchObject({ title: 'Session 4', word_count: 5, companions: ['Sam'], themes: [] });

    const updated = await request(app).put(`/api/v1/notes/checkins/${note.id}`).send({
      title: 'Session 4',
      body: 'Edited',
      checked_in_at: '2026-10-28T20:00:00-05:00',
      checkin_timezone: 'America/Chicago',
      tags: ['Journaling'],
      companions: [],
    });
    expect(updated.status).toBe(200);
    expect(updated.body.tags.map((t: { name: string }) => t.name)).toEqual(['Journaling']);
    expect(updated.body.companions).toEqual([]);

    const tags = await request(app).get('/api/v1/notes/tags');
    expect(tags.body.map((t: { name: string; note_count: number }) => [t.name, t.note_count])).toEqual([
      ["Couple's Therapy Notes", 0], ['Dream Journal', 1], ['Journaling', 2],
    ]);

    expect((await request(app).delete(`/api/v1/notes/checkins/${note.id}`)).status).toBe(200);
    expect((await request(app).get(`/api/v1/notes/checkins/${note.id}`)).status).toBe(404);
    expect((await request(app).post('/api/v1/notes/checkins').send({ body: '  ' })).status).toBe(400);
  });

  it('shows on the timeline, in search, by tag, in reflections and earliest dates', async () => {
    await createNote({
      title: 'Night with Jason', body: 'We watched the **ocean**.',
      checked_in_at: '2017-10-16T01:00:00Z', checkin_timezone: 'America/Chicago', tags: ['Journaling'],
    });
    await createNote({
      title: 'Flying', body: 'A strange dream.',
      checked_in_at: '2018-03-02T03:00:00Z', checkin_timezone: 'America/Chicago', tags: ['Dream Journal'],
    });

    const day = await request(app).get('/api/v1/timeline?from=2017-10-15&to=2017-10-15');
    const item = day.body.find((r: { type: string }) => r.type === 'notes');
    expect(item).toMatchObject({ notes: 'We watched the **ocean**.', timezone: 'America/Chicago' });
    expect(item.data).toMatchObject({ title: 'Night with Jason', word_count: 4, truncated: false });
    expect(item.data.tags.map((t: { name: string }) => t.name)).toEqual(['Journaling']);

    const ids = async (qs: string) =>
      (await request(app).get(`/api/v1/timeline?types=notes&${qs}`)).body
        .filter((r: { type: string }) => r.type === 'notes')
        .map((r: { data: { title: string } }) => r.data.title);
    expect(await ids('q=oceans')).toEqual(['Night with Jason']); // stemmed full text
    expect(await ids('q=Jas')).toEqual(['Night with Jason']); // title substring
    expect(await ids('q=dream%20jour')).toEqual(['Flying']); // tag name
    expect(await ids('note_tag=dream%20journal')).toEqual(['Flying']);

    const reflections = await request(app).get(`/api/v1/stats/reflections?target_date=2026-10-15`);
    expect(JSON.stringify(reflections.body)).toContain('Night with Jason');

    const earliest = await request(app).get(`/api/v1/stats/earliest-dates`);
    expect(earliest.body.notes).toBe('2017-10-15');
  });

  it('renames, recolors, merges and deletes tags', async () => {
    const a = await createNote({ body: 'one', tags: ['Therapy', 'Journal'] });
    await createNote({ body: 'two', tags: ['Therapy Notes'] });
    const tags = (await request(app).get('/api/v1/notes/tags')).body as { id: string; name: string }[];
    const byName = Object.fromEntries(tags.map((t) => [t.name, t.id]));

    const clash = await request(app).put(`/api/v1/notes/tags/${byName.Therapy}`).send({ name: 'therapy notes' });
    expect(clash.status).toBe(409);
    expect(clash.body.conflict_id).toBe(byName['Therapy Notes']);

    const recolored = await request(app).put(`/api/v1/notes/tags/${byName.Journal}`).send({ name: 'Journaling', color: '#AABBCC' });
    expect(recolored.body).toMatchObject({ name: 'Journaling', color: '#aabbcc' });
    expect((await request(app).put(`/api/v1/notes/tags/${byName.Journal}`).send({ color: 'red' })).status).toBe(400);

    const merged = await request(app).post(`/api/v1/notes/tags/${byName.Therapy}/merge`).send({ into_id: byName['Therapy Notes'] });
    expect(merged.body).toEqual({ merged: true, notes_moved: 1 });
    const note = await request(app).get(`/api/v1/notes/checkins/${a.id}`);
    expect(note.body.tags.map((t: { name: string }) => t.name)).toEqual(['Journaling', 'Therapy Notes']);

    const deleted = await request(app).delete(`/api/v1/notes/tags/${byName['Therapy Notes']}`);
    expect(deleted.body).toEqual({ deleted: true, notes_untagged: 2 });
    expect((await query('SELECT COUNT(*)::int AS n FROM note_checkins')).rows[0].n).toBe(2);
  });

  it('previews and imports files with history zones, 8pm defaults, duplicates and batch tags', async () => {
    // A food check-in puts the user in Tokyo from 2017 on.
    await request(app).post('/api/v1/food/checkins').send({
      meal_type: 'dinner', recipe_name: 'Ramen', checked_in_at: '2017-01-01T10:00:00Z', checkin_timezone: 'Asia/Tokyo',
    });
    await createNote({ title: 'Already here', body: 'old', checked_in_at: '2018-05-05T11:00:00Z', checkin_timezone: 'Asia/Tokyo' });

    const files: [string, string, number | null][] = [
      ['2017-10-15 Night with Jason.md', '# Night\nWe talked.', null],
      ['2018-05-05 Already here.md', 'new text', null],
      ['2016-06-01 Before.txt', 'Before any check-ins', Date.parse('2016-06-01T15:00:00Z')],
      ['Undated.md', 'no date', null],
    ];
    const send = (path: string, extra: Record<string, string> = {}) => {
      let req = request(app).post(path)
        .field('meta', JSON.stringify(files.map(([name, , lastModified]) => ({ name, lastModified }))))
        .field('fallback_timezone', 'America/Chicago');
      for (const [k, v] of Object.entries(extra)) req = req.field(k, v);
      for (const [name, text] of files) req = req.attach('files', Buffer.from(text), name);
      return req;
    };

    const preview = await send('/api/v1/import/notes/preview');
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ total: 4, selected: 2, duplicate_count: 1, fallback_count: 1 });
    expect(preview.body.rows.map((r: Record<string, unknown>) => [r.title, r.timezone, r.tz_source, r.time_source, r.duplicate, r.selected_default]))
      .toEqual([
        ['Night with Jason', 'Asia/Tokyo', 'history', 'default_evening', null, true],
        ['Already here', 'Asia/Tokyo', 'history', 'default_evening', 'date_title', false],
        ['Before', 'America/Chicago', 'fallback', 'file_modified', null, true],
        ['Undated', 'Asia/Tokyo', 'history', 'missing', null, false],
      ]);
    expect(preview.body.rows[0]).toMatchObject({ checked_in_at: '2017-10-15T11:00:00.000Z', excerpt: 'Night' });
    expect(preview.body.rows[0].body).toBeUndefined();

    const imported = await send('/api/v1/import/notes', { selected: JSON.stringify([0, 2]), tags: JSON.stringify(['Journal Entries']) });
    expect(imported.body).toMatchObject({ imported: 2, skipped: 2 });
    const rows = await query(
      `SELECT n.title, n.source, n.checkin_timezone, array_agg(t.name) AS tags FROM note_checkins n
       JOIN note_tag_links l ON l.note_id = n.id JOIN note_tags t ON t.id = l.tag_id
       WHERE n.source = 'import' GROUP BY n.id ORDER BY n.checked_in_at`,
    );
    expect(rows.rows).toEqual([
      { title: 'Before', source: 'import', checkin_timezone: 'America/Chicago', tags: ['Journal Entries'] },
      { title: 'Night with Jason', source: 'import', checkin_timezone: 'Asia/Tokyo', tags: ['Journal Entries'] },
    ]);

    // Re-importing flags the same files as duplicates.
    const again = await send('/api/v1/import/notes/preview');
    expect(again.body.rows[0].duplicate).toBe('date_title');

    const bad = await request(app).post('/api/v1/import/notes/preview').attach('files', Buffer.from('x'), 'a.docx');
    expect(bad.status).toBe(400);
  });

  it('analyzes similarity incrementally, then round-trips everything through backup', async () => {
    const { embedded } = stubExternal();
    const put = await request(app).put('/api/v1/plugins/notes/settings').send({
      embedding_api_url: 'http://embed.test/v1/', embedding_model: 'fake-embed',
    });
    expect(put.status).toBe(200);
    await query(`INSERT INTO user_settings (user_id, llm_api_url, llm_model, llm_context_window)
                 VALUES ($1, 'http://llm.test/v1', 'test', 32768)
                 ON CONFLICT (user_id) DO UPDATE SET llm_api_url = EXCLUDED.llm_api_url,
                   llm_model = EXCLUDED.llm_model, llm_context_window = EXCLUDED.llm_context_window`, [DEFAULT_USER_ID]);

    const topics = ['mom', 'work', 'dream'];
    const notes: { id: string }[] = [];
    for (let i = 0; i < 12; i++) {
      const topic = topics[i % 3];
      notes.push(await createNote({
        title: `${topic} ${i}`, body: `Thinking about ${topic} again (${i}).`,
        checked_in_at: `20${10 + i}-01-01T12:00:00Z`, tags: [topic === 'dream' ? 'Dream Journal' : 'Journal'],
      }));
    }

    let status = (await request(app).get('/api/v1/notes/analysis/status')).body;
    expect(status).toMatchObject({ embeddings_configured: true, llm_configured: true, total: 12, pending: 12, themes: 0 });

    const job = await runJob();
    expect(job.status).toBe('completed');
    expect(embedded).toHaveLength(12);
    status = (await request(app).get('/api/v1/notes/analysis/status')).body;
    expect(status).toMatchObject({ pending: 0, analyzed: 12, themes: 3 });
    expect(status.last_run_at).toBeTruthy();

    const themes = await query('SELECT label, size FROM note_themes ORDER BY label');
    expect(themes.rows).toEqual([
      { label: 'About dream', size: 4 }, { label: 'About mom', size: 4 }, { label: 'About work', size: 4 },
    ]);
    const related = await request(app).get(`/api/v1/notes/checkins/${notes[0].id}/related`);
    expect(related.body.analyzed).toBe(true);
    expect(related.body.related.slice(0, 3).map((r: { title: string }) => r.title.split(' ')[0])).toEqual(['mom', 'mom', 'mom']);

    const graph = await request(app).get('/api/v1/notes/graph');
    expect(graph.body.nodes).toHaveLength(12);
    expect(graph.body.edges.length).toBeGreaterThan(0);
    const stats = await request(app).get('/api/v1/notes/stats');
    expect(stats.body.totals).toMatchObject({ notes: 12, untagged: 0 });
    expect(stats.body.themes).toHaveLength(3);

    // Edit one note: only it is re-embedded, and the themes keep their ids.
    const themeIds = (await query('SELECT id FROM note_themes ORDER BY id')).rows;
    await request(app).put(`/api/v1/notes/checkins/${notes[0].id}`).send({
      title: 'mom 0', body: 'Thinking about mom, edited.', checked_in_at: '2010-01-01T12:00:00Z', tags: ['Journal'],
    });
    expect((await request(app).get('/api/v1/notes/analysis/status')).body.pending).toBe(1);
    embedded.length = 0;
    expect((await runJob()).status).toBe('completed');
    expect(embedded).toHaveLength(1);
    expect((await query('SELECT id FROM note_themes ORDER BY id')).rows).toEqual(themeIds);

    // Backup round trip: every table comes back.
    const counts = async () => (await query(
      `SELECT (SELECT COUNT(*) FROM note_checkins)::int AS notes, (SELECT COUNT(*) FROM note_tags)::int AS tags,
              (SELECT COUNT(*) FROM note_tag_links)::int AS links, (SELECT COUNT(*) FROM note_embeddings)::int AS embeddings,
              (SELECT COUNT(*) FROM note_themes)::int AS themes, (SELECT COUNT(*) FROM note_theme_members)::int AS members,
              (SELECT COUNT(*) FROM note_neighbors)::int AS neighbors`,
    )).rows[0];
    const before = await counts();
    const payload = await exportPluginData(DEFAULT_USER_ID);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await deletePluginData(client, DEFAULT_USER_ID, ['notes']);
      await server.resetSettings!({ user_id: DEFAULT_USER_ID, client });
      await client.query('COMMIT');
      expect(await counts()).toEqual({ notes: 0, tags: 0, links: 0, embeddings: 0, themes: 0, members: 0, neighbors: 0 });
      await client.query('BEGIN');
      await importPluginData(client, DEFAULT_USER_ID, { notes: payload.notes });
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    expect(await counts()).toEqual(before);
    expect((await request(app).get('/api/v1/notes/analysis/status')).body).toMatchObject({ pending: 0, themes: 3 });
    const restored = await request(app).get(`/api/v1/notes/checkins/${notes[0].id}`);
    expect(restored.body.tags.map((t: { name: string }) => t.name)).toEqual(['Journal']);
  });

  it('includes mood check-ins with text only while the setting is on', async () => {
    const { embedded } = stubExternal();
    await request(app).put('/api/v1/plugins/notes/settings').send({
      embedding_api_url: 'http://embed.test/v1/', embedding_model: 'fake-embed',
    });
    await query(`INSERT INTO user_settings (user_id, llm_api_url, llm_model, llm_context_window)
                 VALUES ($1, 'http://llm.test/v1', 'test', 32768)
                 ON CONFLICT (user_id) DO UPDATE SET llm_api_url = EXCLUDED.llm_api_url,
                   llm_model = EXCLUDED.llm_model, llm_context_window = EXCLUDED.llm_context_window`, [DEFAULT_USER_ID]);
    const topics = ['mom', 'work', 'dream'];
    const notes: { id: string }[] = [];
    for (let i = 0; i < 9; i++) {
      notes.push(await createNote({ body: `Thinking about ${topics[i % 3]} (${i}).`, checked_in_at: `20${10 + i}-01-01T12:00:00Z` }));
    }
    const mood = async (note: string | null, at: string) => (await query(
      `INSERT INTO mood_checkins (user_id, mood, note, checked_in_at, mood_timezone)
       VALUES ($1, 4, $2, $3, 'UTC') RETURNING id`, [DEFAULT_USER_ID, note, at],
    )).rows[0].id as string;
    const withText = await mood('Called mom today', '2020-03-01T12:00:00Z');
    await mood('mom', '2020-03-02T12:00:00Z');
    await mood('   ', '2020-03-03T12:00:00Z');
    await mood(null, '2020-03-04T12:00:00Z');

    // Off by default: mood entries are ignored.
    expect((await runJob()).status).toBe('completed');
    expect(embedded).toHaveLength(9);
    expect((await request(app).get('/api/v1/notes/graph')).body.nodes).toHaveLength(9);
    const off = (await request(app).get('/api/v1/notes/analysis/status')).body;
    expect(off).toMatchObject({ include_mood_entries: false, mood_total: 0, total: 9, pending: 0 });

    // On: only the two with text count, and they join the "mom" theme.
    await request(app).put('/api/v1/plugins/notes/settings').send({ include_mood_entries: true });
    expect((await request(app).get('/api/v1/notes/analysis/status')).body)
      .toMatchObject({ include_mood_entries: true, mood_total: 2, total: 11, pending: 2 });
    embedded.length = 0;
    expect((await runJob()).status).toBe('completed');
    expect(embedded.sort()).toEqual(['Called mom today', 'mom']);
    expect((await request(app).get('/api/v1/notes/analysis/status')).body).toMatchObject({ total: 11, pending: 0, themes: 3 });
    const members = await query(
      `SELECT t.label, COUNT(*)::int AS n FROM note_theme_mood_members m JOIN note_themes t ON t.id = m.theme_id
       WHERE m.rank = 1 GROUP BY t.label`);
    expect(members.rows).toEqual([{ label: 'About mom', n: 2 }]);

    const graph = (await request(app).get('/api/v1/notes/graph')).body;
    expect(graph.nodes).toHaveLength(11);
    expect(graph.nodes.filter((n: { kind: string }) => n.kind === 'mood')).toHaveLength(2);
    expect(graph.edges.some((e: { source: string; target: string }) => [e.source, e.target].includes(withText))).toBe(true);
    const related = (await request(app).get(`/api/v1/notes/checkins/${notes[0].id}/related?limit=15`)).body.related;
    expect(related.filter((r: { kind: string }) => r.kind === 'mood').map((r: { id: string }) => r.id)).toContain(withText);
    const stats = (await request(app).get('/api/v1/notes/stats')).body;
    expect(stats.totals.notes).toBe(9);
    expect(stats.themes.find((t: { label: string }) => t.label === 'About mom').notes).toBe(5);

    // Deleting a mood entry takes its derived rows with it.
    await query('DELETE FROM mood_checkins WHERE id = $1', [withText]);
    expect((await query('SELECT COUNT(*)::int AS n FROM note_theme_mood_members')).rows[0].n).toBe(1);
    expect((await query('SELECT COUNT(*)::int AS n FROM note_mood_embeddings')).rows[0].n).toBe(1);

    // Off again: the next run removes mood entries from members, neighbors and the web.
    await request(app).put('/api/v1/plugins/notes/settings').send({ include_mood_entries: false });
    expect((await runJob()).status).toBe('completed');
    expect((await query('SELECT COUNT(*)::int AS n FROM note_theme_mood_members')).rows[0].n).toBe(0);
    expect((await query('SELECT COUNT(*)::int AS n FROM note_mood_neighbors')).rows[0].n).toBe(0);
    expect((await request(app).get('/api/v1/notes/graph')).body.nodes).toHaveLength(9);
  });

  it('restores links onto an existing tag of the same name', async () => {
    const note = await createNote({ body: 'x', tags: ['Therapy'] });
    const payload = await exportPluginData(DEFAULT_USER_ID);
    await query('DELETE FROM note_checkins');
    await query('DELETE FROM note_tags');
    await createNote({ body: 'y', tags: ['therapy'] }); // same name, new id
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await importPluginData(client, DEFAULT_USER_ID, { notes: payload.notes });
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    const got = await request(app).get(`/api/v1/notes/checkins/${note.id}`);
    expect(got.body.tags.map((t: { name: string }) => t.name)).toEqual(['therapy']);
  });

  it('reconciles a note timezone', async () => {
    const note = await createNote({ body: 'x', checkin_timezone: 'UTC' });
    expect(await runAsUser(DEFAULT_USER_ID, () => server.reconcile!.apply(note.id, 'Europe/Paris'))).toBe(true);
    expect((await request(app).get(`/api/v1/notes/checkins/${note.id}`)).body.checkin_timezone).toBe('Europe/Paris');
  });
});
