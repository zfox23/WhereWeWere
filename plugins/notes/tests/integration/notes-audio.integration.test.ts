import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../../../server/src/index';
import { noteAudioDir } from '../../services/audioFiles';
import { MAX_ATTEMPTS, UNAVAILABLE_RETRY_MS, cleanupAbandonedUploads, drainTranscriptionQueue, releaseIdleHeldAudio } from '../../services/transcription';
import { pool, query } from '../../../../server/src/db';
import { restoreAudioBackup } from '../../services/audioBackup';
import { NOTE_TEXT_SQL, PENDING_WHERE } from '../../services/analysis';
import {
  DEFAULT_USER_ID,
  resetIntegrationDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
} from '../../../../server/tests/helpers/testDb';
import { createTestUser, type TestUser } from '../../../../server/tests/helpers/auth';

const app = createApp();
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

// Every user these tests create; their audio folders (real files under DATA_DIR) are removed at the end.
const createdUserIds = new Set<string>();
async function makeUser(name: string): Promise<TestUser> {
  const user = await createTestUser(name);
  createdUserIds.add(user.id);
  return user;
}

beforeAll(setupIntegrationDatabase);
afterAll(async () => {
  for (const id of [DEFAULT_USER_ID, ...createdUserIds]) fs.rmSync(noteAudioDir(id), { recursive: true, force: true });
  await teardownIntegrationDatabase();
});

describe('notes audio: resumable upload, range playback, ownership', () => {
  let other: TestUser;
  const data = crypto.randomBytes(3000);

  beforeEach(async () => {
    await resetIntegrationDatabase();
    other = await makeUser('other');
  });
  afterAll(() => {
    // The tests write real files under DATA_DIR; leave nothing behind.
    for (const id of [DEFAULT_USER_ID, other?.id]) {
      if (id) fs.rmSync(noteAudioDir(id), { recursive: true, force: true });
    }
  });

  async function startUpload(buf = data, mime = 'audio/webm;codecs=opus') {
    const res = await request(app).post('/api/v1/notes/audio/uploads')
      .send({ filename: 'm.webm', mime, bytes: buf.length, sha256: sha(buf), duration_ms: 1234 });
    return res;
  }
  const put = (id: string, offset: number, chunk: Buffer) =>
    request(app).put(`/api/v1/notes/audio/uploads/${id}?offset=${offset}`)
      .set('Content-Type', 'application/octet-stream').send(chunk);

  it('uploads in chunks, resumes after a mismatch, verifies, and serves ranges', async () => {
    const start = await startUpload();
    expect(start.status).toBe(201);
    const id = start.body.id as string;

    expect((await put(id, 0, data.subarray(0, 1000))).body.offset).toBe(1000);
    // A retried / out-of-order chunk is rejected and reports where to resume.
    const dup = await put(id, 0, data.subarray(0, 1000));
    expect(dup.status).toBe(409);
    expect(dup.body.offset).toBe(1000);
    expect((await request(app).get(`/api/v1/notes/audio/uploads/${id}`)).body.offset).toBe(1000);

    // Completing early is refused.
    expect((await request(app).post(`/api/v1/notes/audio/uploads/${id}/complete`)).status).toBe(409);

    expect((await put(id, 1000, data.subarray(1000))).body.offset).toBe(3000);
    const done = await request(app).post(`/api/v1/notes/audio/uploads/${id}/complete`);
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('pending');
    // Idempotent.
    expect((await request(app).post(`/api/v1/notes/audio/uploads/${id}/complete`)).status).toBe(200);

    const full = await request(app).get(`/api/v1/notes/audio/${id}`).buffer(true).parse((r, cb) => {
      const parts: Buffer[] = [];
      r.on('data', (c: Buffer) => parts.push(c));
      r.on('end', () => cb(null, Buffer.concat(parts)));
    });
    expect(full.status).toBe(200);
    expect(Buffer.compare(full.body, data)).toBe(0);

    const ranged = await request(app).get(`/api/v1/notes/audio/${id}`).set('Range', 'bytes=100-199').buffer(true).parse((r, cb) => {
      const parts: Buffer[] = [];
      r.on('data', (c: Buffer) => parts.push(c));
      r.on('end', () => cb(null, Buffer.concat(parts)));
    });
    expect(ranged.status).toBe(206);
    expect(ranged.headers['content-range']).toBe('bytes 100-199/3000');
    expect(Buffer.compare(ranged.body, data.subarray(100, 200))).toBe(0);
    expect((await request(app).get(`/api/v1/notes/audio/${id}`).set('Range', 'bytes=9999-')).status).toBe(416);
  });

  it('rejects a corrupted upload and lets the client start over', async () => {
    const start = await startUpload();
    const id = start.body.id as string;
    const bad = Buffer.from(data);
    bad[5] ^= 0xff;
    await put(id, 0, bad);
    const done = await request(app).post(`/api/v1/notes/audio/uploads/${id}/complete`);
    expect(done.status).toBe(422);
    expect(done.body.offset).toBe(0);
  });

  it('rejects unsupported types and oversize declarations', async () => {
    expect((await startUpload(data, 'text/plain')).status).toBe(400);
    const res = await request(app).post('/api/v1/notes/audio/uploads')
      .send({ mime: 'audio/webm', bytes: 2 * 1024 ** 3, sha256: 'a'.repeat(64) });
    expect(res.status).toBe(413);
  });

  it('attaches to the owner’s note only, and hides audio from other users', async () => {
    const id = (await startUpload()).body.id as string;
    await put(id, 0, data);
    await request(app).post(`/api/v1/notes/audio/uploads/${id}/complete`);
    const note = await request(app).post('/api/v1/notes/checkins')
      .send({ title: 'Voice', body: '', checked_in_at: '2024-01-01T00:00:00Z', checkin_timezone: 'UTC' });
    expect(note.status).toBe(201);
    const as = (r: request.Test) => r.set('Cookie', other.cookie);

    expect((await as(request(app).put(`/api/v1/notes/audio/${id}/attach`).send({ note_id: note.body.id }))).status).toBe(404);
    expect((await as(request(app).get(`/api/v1/notes/audio/${id}`))).status).toBe(404);
    expect((await as(request(app).delete(`/api/v1/notes/audio/${id}`))).status).toBe(404);
    expect((await as(request(app).get(`/api/v1/notes/audio/uploads/${id}`))).status).toBe(404);

    const attached = await request(app).put(`/api/v1/notes/audio/${id}/attach`).send({ note_id: note.body.id });
    expect(attached.status).toBe(200);
    expect(attached.body.position).toBe(0);
    expect((await request(app).get(`/api/v1/notes/checkins/${note.body.id}/audio`)).body).toHaveLength(1);
    expect((await as(request(app).get(`/api/v1/notes/checkins/${note.body.id}/audio`))).body).toHaveLength(0);

    expect((await request(app).delete(`/api/v1/notes/audio/${id}`)).status).toBe(200);
    expect((await request(app).get(`/api/v1/notes/audio/${id}`)).status).toBe(404);
  });
});

describe('notes audio: transcription queue', () => {
  const data = crypto.randomBytes(2000);
  let fake: http.Server;
  let fakeUrl = '';
  let requests: { auth?: string; body: Buffer }[] = [];
  let respond: (res: http.ServerResponse) => void = () => {};
  // Like Speaches: transcription 404s until the model has been installed (by the service, not by us).
  let modelInstalled = true;
  let installs: string[] = [];

  beforeAll(async () => {
    fake = http.createServer((req, res) => {
      const parts: Buffer[] = [];
      req.on('data', (c: Buffer) => parts.push(c));
      req.on('end', () => {
        if (req.url?.endsWith('/models')) {
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ data: [{ id: 'fake-model' }] }));
        }
        if (req.method === 'POST' && req.url?.includes('/models/')) {
          installs.push(decodeURIComponent(req.url));
          res.statusCode = 405;
          return res.end('{}');
        }
        requests.push({ auth: req.headers.authorization, body: Buffer.concat(parts) });
        if (!modelInstalled) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ detail: "Model 'fake-model' is not installed locally. You can download the model using `POST /v1/models`" }));
        }
        respond(res);
      });
    });
    await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
    fakeUrl = `http://127.0.0.1:${(fake.address() as { port: number }).port}/v1`;
  });
  beforeEach(async () => {
    await resetIntegrationDatabase();
    requests = [];
    installs = [];
    modelInstalled = true;
    respond = (res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        text: 'Hello there. General Kenobi.', language: 'en', duration: 4.2,
        segments: [{ start: 0, end: 1.5, text: ' Hello there.' }, { start: 1.5, end: 4.2, text: ' General Kenobi.' }],
      }));
    };
  });
  afterAll(async () => {
    await new Promise((r) => fake.close(r));
    fs.rmSync(noteAudioDir(DEFAULT_USER_ID), { recursive: true, force: true });
  });

  async function uploadedAudio(): Promise<string> {
    const start = await request(app).post('/api/v1/notes/audio/uploads')
      .send({ filename: 'm.webm', mime: 'audio/webm', bytes: data.length, sha256: sha(data) });
    const id = start.body.id as string;
    await request(app).put(`/api/v1/notes/audio/uploads/${id}?offset=0`).set('Content-Type', 'application/octet-stream').send(data);
    await request(app).post(`/api/v1/notes/audio/uploads/${id}/complete`);
    return id;
  }
  const configure = () => query(
    `INSERT INTO plugin_settings (user_id, plugin_id, key, value) VALUES
       ($1, 'notes', 'transcription_api_url', $2::jsonb), ($1, 'notes', 'transcription_model', '"fake-model"'::jsonb),
       ($1, 'notes', 'transcription_api_key', '"sekret"'::jsonb)`,
    [DEFAULT_USER_ID, JSON.stringify(fakeUrl)],
  );
  const state = async (id: string) => (await query('SELECT status, attempts, error, transcript_text, language, duration_ms FROM note_audio WHERE id = $1', [id])).rows[0];

  it('transcribes a completed upload and stores timestamped segments', async () => {
    await configure();
    const id = await uploadedAudio();
    expect(await drainTranscriptionQueue()).toBe(1);

    const row = await state(id);
    expect(row).toMatchObject({ status: 'done', transcript_text: 'Hello there. General Kenobi.', language: 'en', duration_ms: 4200 });
    const segs = (await query('SELECT idx, start_ms, end_ms, text FROM note_audio_segments WHERE audio_id = $1 ORDER BY idx', [id])).rows;
    expect(segs).toEqual([
      { idx: 0, start_ms: 0, end_ms: 1500, text: 'Hello there.' },
      { idx: 1, start_ms: 1500, end_ms: 4200, text: 'General Kenobi.' },
    ]);
    // The original bytes and the key reached the service.
    expect(requests[0].auth).toBe('Bearer sekret');
    expect(requests[0].body.includes(data)).toBe(true);
    // Voice activity detection is not requested: it discards quiet speech (children, singing).
    expect(requests[0].body.toString('latin1')).not.toContain('name="vad_filter"');
  });

  it('parks audio without burning attempts when no endpoint is configured, and says so to the page', async () => {
    const id = await uploadedAudio();
    await drainTranscriptionQueue();
    expect(await state(id)).toMatchObject({ status: 'pending', attempts: 0 });
    expect(requests).toHaveLength(0);

    const note = await request(app).post('/api/v1/notes/checkins')
      .send({ title: 'T', body: '', checked_in_at: '2024-02-02T10:00:00Z', checkin_timezone: 'UTC', audio_ids: [id] });
    const listed = async () => (await request(app).get(`/api/v1/notes/checkins/${note.body.id}/audio`)).body[0];
    expect(await listed()).toMatchObject({ status: 'pending', transcription_configured: false });
    await configure();
    expect(await listed()).toMatchObject({ status: 'pending', transcription_configured: true });
  });

  it('picks up waiting audio as soon as settings are saved, with no leftover delay', async () => {
    const id = await uploadedAudio();
    await drainTranscriptionQueue(); // nothing configured: it just waits
    expect(await state(id)).toMatchObject({ status: 'pending', attempts: 0 });
    const before = (await query('SELECT next_attempt_at FROM note_audio WHERE id = $1', [id])).rows[0].next_attempt_at;
    await drainTranscriptionQueue();
    expect((await query('SELECT next_attempt_at FROM note_audio WHERE id = $1', [id])).rows[0].next_attempt_at).toEqual(before);

    await configure();
    expect(await drainTranscriptionQueue()).toBe(1); // the very next pass, not minutes later
    expect(await state(id)).toMatchObject({ status: 'done' });
  });

  const retryInMs = async (id: string) => Number((await query(
    `SELECT EXTRACT(EPOCH FROM next_attempt_at - NOW()) * 1000 AS ms FROM note_audio WHERE id = $1`, [id])).rows[0].ms);

  it('shows the service’s own error while the model is still installing, and waits without using attempts', async () => {
    await configure();
    modelInstalled = false;
    const id = await uploadedAudio();
    await drainTranscriptionQueue();
    expect(installs).toEqual([]); // the app never installs models; the service does that from its own config
    const row = await state(id);
    expect(row).toMatchObject({ status: 'pending', attempts: 0 });
    expect(row.error).toContain('is not installed locally');
    expect(await retryInMs(id)).toBeGreaterThan(UNAVAILABLE_RETRY_MS - 10_000);
  });

  it('waits out a service that is down or busy (503) without ever failing the audio', async () => {
    await query(
      `INSERT INTO plugin_settings (user_id, plugin_id, key, value) VALUES
         ($1, 'notes', 'transcription_api_url', '"http://127.0.0.1:1/v1"'::jsonb), ($1, 'notes', 'transcription_model', '"m"'::jsonb)`,
      [DEFAULT_USER_ID],
    );
    const id = await uploadedAudio();
    for (let i = 0; i < MAX_ATTEMPTS + 2; i++) {
      await query('UPDATE note_audio SET next_attempt_at = NOW() WHERE id = $1', [id]);
      await drainTranscriptionQueue();
    }
    const down = await state(id);
    expect(down).toMatchObject({ status: 'pending', attempts: 0 });
    expect(down.error).toContain('Could not reach the transcription service');

    await query('DELETE FROM plugin_settings WHERE user_id = $1', [DEFAULT_USER_ID]);
    await configure();
    respond = (res) => { res.statusCode = 503; res.end('busy'); };
    await query('UPDATE note_audio SET next_attempt_at = NOW() WHERE id = $1', [id]);
    await drainTranscriptionQueue();
    expect(await state(id)).toMatchObject({ status: 'pending', attempts: 0 });
    expect((await state(id)).error).toContain('503');
  });

  it('fails audio the service refuses at once, and never queues it again by itself', async () => {
    await configure();
    respond = (res) => { res.statusCode = 400; res.end('{"detail":"could not decode"}'); };
    const refused = await uploadedAudio();
    await drainTranscriptionQueue();
    expect(await state(refused)).toMatchObject({ status: 'failed', attempts: 1 });

    respond = (res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ text: 'fine' })); };
    await uploadedAudio();
    await drainTranscriptionQueue();
    expect(await state(refused)).toMatchObject({ status: 'failed' });
  });

  it('queues files that ran out of attempts again once a transcription succeeds', async () => {
    await configure();
    respond = (res) => { res.statusCode = 500; res.end('boom'); };
    const id = await uploadedAudio();
    await query(`UPDATE note_audio SET attempts = $2 WHERE id = $1`, [id, MAX_ATTEMPTS - 1]);
    await drainTranscriptionQueue();
    expect(await state(id)).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS });

    respond = (res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ text: 'back up' })); };
    const next = await uploadedAudio();
    await drainTranscriptionQueue();
    expect(await state(next)).toMatchObject({ status: 'done' });
    expect(await state(id)).toMatchObject({ status: 'done', attempts: 0, transcript_text: 'back up' });
  });

  it('picks up audio left marked "processing" (a crash or an escaped error) on the next pass, not only after a restart', async () => {
    await configure();
    const id = await uploadedAudio();
    await query(`UPDATE note_audio SET status = 'processing' WHERE id = $1`, [id]);
    // Retry is refused while it looks busy...
    expect((await request(app).post(`/api/v1/notes/audio/${id}/retranscribe`)).status).toBe(404);
    // ...but the worker, with nothing in flight, knows it isn't and takes it back.
    expect(await drainTranscriptionQueue()).toBe(1);
    expect(await state(id)).toMatchObject({ status: 'done', attempts: 0 });
  });

  it('retries with backoff on failure, gives up after MAX_ATTEMPTS, and retranscribe resets', async () => {
    await configure();
    respond = (res) => { res.statusCode = 500; res.end('boom'); };
    const id = await uploadedAudio();
    await drainTranscriptionQueue();
    expect(await state(id)).toMatchObject({ status: 'pending', attempts: 1 });
    expect((await state(id)).error).toContain('500');

    await query(`UPDATE note_audio SET attempts = $2, next_attempt_at = NOW() WHERE id = $1`, [id, MAX_ATTEMPTS - 1]);
    await drainTranscriptionQueue();
    expect(await state(id)).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS });

    respond = (res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ text: 'ok again' })); };
    expect((await request(app).post(`/api/v1/notes/audio/${id}/retranscribe`)).status).toBe(200);
    await drainTranscriptionQueue();
    expect(await state(id)).toMatchObject({ status: 'done', attempts: 0, transcript_text: 'ok again' });
  });

  /** An upload the way an import run makes one: held from transcription. */
  async function heldAudio(bytes = data, name = 'held.m4a'): Promise<string> {
    const start = await request(app).post('/api/v1/notes/audio/uploads')
      .send({ filename: name, mime: 'audio/mp4', bytes: bytes.length, sha256: sha(bytes), defer: true });
    const id = start.body.id as string;
    await request(app).put(`/api/v1/notes/audio/uploads/${id}?offset=0`).set('Content-Type', 'application/octet-stream').send(bytes);
    await request(app).post(`/api/v1/notes/audio/uploads/${id}/complete`);
    return id;
  }
  const isHeld = async (id: string) => (await query(`SELECT next_attempt_at = 'infinity' AS held FROM note_audio WHERE id = $1`, [id])).rows[0].held as boolean;

  it('holds imported audio from transcription until the run finishes, then releases exactly the files named', async () => {
    await configure();
    const a = await heldAudio(crypto.randomBytes(500), 'a.m4a');
    const b = await heldAudio(crypto.randomBytes(500), 'b.m4a');
    expect(await state(a)).toMatchObject({ status: 'pending' });
    expect(await isHeld(a)).toBe(true); // still held after the upload completed

    expect(await drainTranscriptionQueue()).toBe(0); // the worker leaves held audio alone
    expect(requests).toHaveLength(0);

    const fin = await request(app).post('/api/v1/import/notes/audio/finish').send({ audio_ids: [a, 'not-a-uuid'] });
    expect(fin.body).toEqual({ released: 1, transcription_configured: true });
    expect(await isHeld(a)).toBe(false);
    expect(await isHeld(b)).toBe(true); // not named: still held
    expect(await drainTranscriptionQueue()).toBe(1);
    expect(await state(a)).toMatchObject({ status: 'done' });
    expect(await state(b)).toMatchObject({ status: 'pending' });
  });

  it('finish reports when transcription is not set up, and never releases another user’s audio', async () => {
    const id = await heldAudio();
    const other = await makeUser('releaser');
    const res = await request(app).post('/api/v1/import/notes/audio/finish').set('Cookie', other.cookie).send({ audio_ids: [id] });
    expect(res.body).toEqual({ released: 0, transcription_configured: false });
    expect(await isHeld(id)).toBe(true);
    expect((await request(app).post('/api/v1/import/notes/audio/finish').send({ audio_ids: [id] })).body.transcription_configured).toBe(false);
  });

  it('releases a user’s held audio once none of it has been touched for an hour (an abandoned run)', async () => {
    const a = await heldAudio(crypto.randomBytes(300), 'a.m4a');
    const b = await heldAudio(crypto.randomBytes(300), 'b.m4a');
    // updated_at is maintained by a trigger; switch it off just long enough to backdate rows.
    const backdate = async (id: string, interval: string) => {
      await query('ALTER TABLE note_audio DISABLE TRIGGER update_note_audio_updated_at');
      try {
        await query(`UPDATE note_audio SET updated_at = NOW() - $2::interval WHERE id = $1`, [id, interval]);
      } finally {
        await query('ALTER TABLE note_audio ENABLE TRIGGER update_note_audio_updated_at');
      }
    };
    // The run is still going: b was touched just now, so neither is released.
    await backdate(a, '3 hours');
    expect(await releaseIdleHeldAudio()).toBe(0);
    expect(await isHeld(a)).toBe(true);
    expect(await isHeld(b)).toBe(true);
    // The run died: everything has been idle for over an hour.
    await backdate(b, '2 hours');
    expect(await releaseIdleHeldAudio()).toBe(2);
    expect(await isHeld(a)).toBe(false);
    expect(await isHeld(b)).toBe(false);
  });

  it('tests the connection using saved or supplied settings', async () => {
    const ok = await request(app).post('/api/v1/notes/transcription/test').send({ api_url: fakeUrl, model: 'fake-model' });
    expect(ok.body).toEqual({ ok: true, message: 'Connected.' });
    const unknownModel = await request(app).post('/api/v1/notes/transcription/test').send({ api_url: fakeUrl, model: 'other' });
    expect(unknownModel.body.message).toContain('not installed on the service');
    const down = await request(app).post('/api/v1/notes/transcription/test').send({ api_url: 'http://127.0.0.1:1/v1', model: 'x' });
    expect(down.body.ok).toBe(false);
    expect((await request(app).post('/api/v1/notes/transcription/test').send({})).status).toBe(400);
  });
});

describe('notes audio: audio-only notes, transcript search, content hash', () => {
  beforeEach(resetIntegrationDatabase);

  /** An audio row as the upload flow leaves it, optionally with a finished transcript. */
  async function audioRow(transcript = ''): Promise<string> {
    const r = await query(
      `INSERT INTO note_audio (user_id, filename, mime, bytes, sha256, status, transcript_text)
       VALUES ($1, 'a.webm', 'audio/webm', 10, $2, $3, $4) RETURNING id`,
      [DEFAULT_USER_ID, 'a'.repeat(64), transcript ? 'done' : 'pending', transcript],
    );
    return r.rows[0].id as string;
  }
  const hash = async (noteId: string) => (await query('SELECT content_hash FROM note_checkins WHERE id = $1', [noteId])).rows[0].content_hash as string;
  const create = (extra: Record<string, unknown>) =>
    request(app).post('/api/v1/notes/checkins').send({ checked_in_at: '2024-02-02T10:00:00Z', checkin_timezone: 'UTC', ...extra });

  it('allows a note that is only audio, and still rejects a truly empty one', async () => {
    expect((await create({ title: '', body: '' })).status).toBe(400);
    const id = await audioRow();
    const made = await create({ title: '', body: '', audio_ids: [id] });
    expect(made.status).toBe(201);
    expect((await request(app).get(`/api/v1/notes/checkins/${made.body.id}/audio`)).body).toHaveLength(1);
    // Editing keeps working while audio remains attached; unknown audio is rejected.
    expect((await request(app).put(`/api/v1/notes/checkins/${made.body.id}`)
      .send({ title: '', body: '', checked_in_at: '2024-02-02T10:00:00Z', checkin_timezone: 'UTC' })).status).toBe(200);
    expect((await create({ body: 'x', audio_ids: ['00000000-0000-0000-0000-00000000dead'] })).status).toBe(400);
    // The sole content of an otherwise empty note can't be deleted out from under it.
    expect((await request(app).delete(`/api/v1/notes/audio/${id}`)).status).toBe(409);
  });

  it('saves an empty note whose recording has not started uploading, and attaches it when it lands', async () => {
    // Saved right after Stop: the device has the recording but no server id for it yet.
    const made = await create({ title: '', body: '', pending_audio: true });
    expect(made.status).toBe(201);
    // Only the literal flag counts.
    expect((await create({ title: '', body: '', pending_audio: 'yes' })).status).toBe(400);
    const id = await audioRow();
    expect((await request(app).put(`/api/v1/notes/audio/${id}/attach`).send({ note_id: made.body.id })).status).toBe(200);
    expect((await request(app).get(`/api/v1/notes/checkins/${made.body.id}/audio`)).body).toHaveLength(1);
  });

  it('finds notes by what was said in their audio, and only the owner’s', async () => {
    const spoken = await create({ title: 'Walk', body: 'Went outside', audio_ids: [await audioRow('We saw a magnificent heron by the river')] });
    await create({ title: 'Other', body: 'Nothing relevant' });
    const search = async (q: string) =>
      ((await request(app).get('/api/v1/timeline').query({ q })).body.checkins ?? (await request(app).get('/api/v1/timeline').query({ q })).body)
        .map((c: { id: string }) => c.id);
    expect(await search('heron')).toEqual([spoken.body.id]);
    expect(await search('herons')).toEqual([spoken.body.id]); // stemmed like body text
    expect(await search('platypus')).toEqual([]);
    const other = await makeUser('searcher');
    const res = await request(app).get('/api/v1/timeline').query({ q: 'heron' }).set('Cookie', other.cookie);
    expect(JSON.stringify(res.body)).not.toContain(spoken.body.id);
  });

  it('changes the note’s content hash when a transcript is saved, edited or removed', async () => {
    const note = await create({ title: 'T', body: 'B' });
    const noteId = note.body.id as string;
    const plain = await hash(noteId);
    expect(plain).toBe((await query(`SELECT md5('T' || E'\\n' || 'B') AS h`)).rows[0].h); // unchanged formula without audio

    const audio = await audioRow();
    await request(app).put(`/api/v1/notes/audio/${audio}/attach`).send({ note_id: noteId });
    expect(await hash(noteId)).toBe(plain); // no transcript yet

    await query(`UPDATE note_audio SET transcript_text = 'first words', status = 'done' WHERE id = $1`, [audio]);
    const withFirst = await hash(noteId);
    expect(withFirst).not.toBe(plain);
    await query(`UPDATE note_audio SET transcript_text = 'second words' WHERE id = $1`, [audio]);
    expect(await hash(noteId)).not.toBe(withFirst);
    await query('DELETE FROM note_audio WHERE id = $1', [audio]);
    expect(await hash(noteId)).toBe(plain);
  });

  it('queues a note for analysis once its transcript exists, and not before', async () => {
    const made = await create({ title: '', body: '', audio_ids: [await audioRow()] });
    const pending = async () => (await query(
      `SELECT n.id FROM note_checkins n LEFT JOIN note_embeddings e ON e.note_id = n.id WHERE ${PENDING_WHERE}`,
      [DEFAULT_USER_ID, 'm'],
    )).rows.map((r) => r.id);
    expect(await pending()).toEqual([]);
    await query(`UPDATE note_audio SET transcript_text = 'something to analyse', status = 'done' WHERE note_id = $1`, [made.body.id]);
    expect(await pending()).toEqual([made.body.id]);
    expect((await query(`SELECT ${NOTE_TEXT_SQL} AS t FROM note_checkins n WHERE n.id = $1`, [made.body.id])).rows[0].t).toContain('something to analyse');
  });
});

describe('notes audio: transcript segments, editing, timeline count', () => {
  beforeEach(resetIntegrationDatabase);

  async function transcribedNote() {
    const audio = (await query(
      `INSERT INTO note_audio (user_id, filename, mime, bytes, sha256, status, transcript_text, language)
       VALUES ($1, 'v.webm', 'audio/webm', 10, $2, 'done', 'hello world and farewell', 'en') RETURNING id`,
      [DEFAULT_USER_ID, 'b'.repeat(64)],
    )).rows[0].id as string;
    await query(
      `INSERT INTO note_audio_segments (audio_id, idx, start_ms, end_ms, text) VALUES
         ($1, 0, 0, 1500, 'hello world'), ($1, 1, 1500, 3000, 'and farewell')`,
      [audio],
    );
    const note = await request(app).post('/api/v1/notes/checkins')
      .send({ title: 'Voice', body: '', checked_in_at: '2024-03-03T10:00:00Z', checkin_timezone: 'UTC', audio_ids: [audio] });
    return { audio, noteId: note.body.id as string };
  }
  const search = async (q: string) => {
    const res = await request(app).get('/api/v1/timeline').query({ q });
    return (res.body.checkins ?? res.body).map((c: { id: string }) => c.id);
  };

  it('lists a note’s audio with its timestamped segments on request', async () => {
    const { noteId, audio } = await transcribedNote();
    const plain = await request(app).get(`/api/v1/notes/checkins/${noteId}/audio`);
    expect(plain.body[0].segments).toBeUndefined();
    const full = await request(app).get(`/api/v1/notes/checkins/${noteId}/audio?include=segments`);
    expect(full.body[0]).toMatchObject({ id: audio, status: 'done', language: 'en' });
    expect(full.body[0].segments).toEqual([
      { idx: 0, start_ms: 0, end_ms: 1500, text: 'hello world', edited: false, speaker: null },
      { idx: 1, start_ms: 1500, end_ms: 3000, text: 'and farewell', edited: false, speaker: null },
    ]);
  });

  it('keeps an edited transcript searchable, flags edits, and refreshes the analysis hash', async () => {
    const { noteId, audio } = await transcribedNote();
    const before = (await query('SELECT content_hash FROM note_checkins WHERE id = $1', [noteId])).rows[0].content_hash;
    expect(await search('farewell')).toEqual([noteId]);

    const saved = await request(app).put(`/api/v1/notes/audio/${audio}/transcript`)
      .send({ segments: [{ idx: 0, text: 'hello world' }, { idx: 1, text: ' and goodbye ' }] });
    expect(saved.status).toBe(200);
    expect(saved.body.segments.map((s: { text: string; edited: boolean }) => [s.text, s.edited]))
      .toEqual([['hello world', false], ['and goodbye', true]]); // only the changed one is flagged
    expect(await search('goodbye')).toEqual([noteId]);
    expect(await search('farewell')).toEqual([]);
    expect((await query('SELECT transcript_text FROM note_audio WHERE id = $1', [audio])).rows[0].transcript_text).toBe('hello world and goodbye');
    expect((await query('SELECT content_hash FROM note_checkins WHERE id = $1', [noteId])).rows[0].content_hash).not.toBe(before);
  });

  it('rejects malformed edits and edits to someone else’s audio', async () => {
    const { audio } = await transcribedNote();
    const put = (body: unknown) => request(app).put(`/api/v1/notes/audio/${audio}/transcript`).send(body as object);
    expect((await put({})).status).toBe(400);
    expect((await put({ segments: [] })).status).toBe(400);
    expect((await put({ segments: [{ idx: 'a', text: 'x' }] })).status).toBe(400);
    expect((await put({ segments: [{ idx: 0, text: 5 }] })).status).toBe(400);
    const other = await makeUser('editor');
    const res = await request(app).put(`/api/v1/notes/audio/${audio}/transcript`).set('Cookie', other.cookie)
      .send({ segments: [{ idx: 0, text: 'hijacked' }] });
    expect(res.status).toBe(404);
    expect((await query('SELECT text FROM note_audio_segments WHERE audio_id = $1 AND idx = 0', [audio])).rows[0].text).toBe('hello world');
  });

  it('refuses edits aimed at segments that were re-cut since the editor loaded them', async () => {
    const { audio } = await transcribedNote();
    // Speakers were identified meanwhile: segment 1 now starts elsewhere, and there is no segment 5.
    await query('UPDATE note_audio_segments SET start_ms = 2000 WHERE audio_id = $1 AND idx = 1', [audio]);
    const put = (segments: unknown[]) => request(app).put(`/api/v1/notes/audio/${audio}/transcript`).send({ segments });
    expect((await put([{ idx: 1, start_ms: 1500, text: 'and goodbye' }])).status).toBe(409);
    expect((await put([{ idx: 5, start_ms: 9000, text: 'nowhere' }])).status).toBe(409);
    expect((await query('SELECT text, edited FROM note_audio_segments WHERE audio_id = $1 AND idx = 1', [audio])).rows[0])
      .toEqual({ text: 'and farewell', edited: false });
    expect((await put([{ idx: 1, start_ms: 2000, prev_text: 'and so long', text: 'and goodbye' }])).status).toBe(409);
    const ok = await put([{ idx: 1, start_ms: 2000, prev_text: 'and farewell', text: 'and goodbye' }]);
    expect(ok.status).toBe(200);
    expect(ok.body.segments[1]).toMatchObject({ text: 'and goodbye', edited: true });
  });

  it('refuses to edit a transcript that does not exist yet', async () => {
    const pending = (await query(
      `INSERT INTO note_audio (user_id, filename, mime, bytes, sha256, status) VALUES ($1, 'p.webm', 'audio/webm', 1, $2, 'pending') RETURNING id`,
      [DEFAULT_USER_ID, 'c'.repeat(64)],
    )).rows[0].id;
    expect((await request(app).put(`/api/v1/notes/audio/${pending}/transcript`).send({ segments: [{ idx: 0, text: 'x' }] })).status).toBe(404);
  });

  it('puts the number of audio files on the note’s timeline entry', async () => {
    const { noteId } = await transcribedNote();
    const res = await request(app).get('/api/v1/timeline');
    const entry = (res.body.checkins ?? res.body).find((c: { id: string }) => c.id === noteId);
    expect(entry.data.audio_count).toBe(1);
  });
});

describe('notes audio: backup and restore', () => {
  beforeEach(resetIntegrationDatabase);
  const data = crypto.randomBytes(5000);

  /** A finished, transcribed audio attachment on a note, with its file on disk. */
  async function noteWithAudio(title = 'Voice', body = '') {
    const start = await request(app).post('/api/v1/notes/audio/uploads')
      .send({ filename: 'memo.webm', mime: 'audio/webm', bytes: data.length, sha256: sha(data), duration_ms: 4200 });
    const id = start.body.id as string;
    await request(app).put(`/api/v1/notes/audio/uploads/${id}?offset=0`).set('Content-Type', 'application/octet-stream').send(data);
    await request(app).post(`/api/v1/notes/audio/uploads/${id}/complete`);
    await query(`UPDATE note_audio SET status = 'done', transcript_text = 'the quick brown fox', language = 'en', model = 'm' WHERE id = $1`, [id]);
    await query(
      `INSERT INTO note_audio_segments (audio_id, idx, start_ms, end_ms, text, edited) VALUES ($1, 0, 0, 2000, 'the quick', FALSE), ($1, 1, 2000, 4200, 'brown fox', TRUE)`,
      [id],
    );
    const note = await request(app).post('/api/v1/notes/checkins')
      .send({ title, body, checked_in_at: '2024-04-04T10:00:00Z', checkin_timezone: 'UTC', audio_ids: [id] });
    return { audioId: id, noteId: note.body.id as string };
  }

  const fetchZip = () => new Promise<Buffer>((resolve, reject) => {
    request(app).get('/api/v1/backup/export').buffer(true)
      .parse((res, cb) => {
        const parts: Buffer[] = [];
        res.on('data', (c: Buffer) => parts.push(c));
        res.on('end', () => cb(null, Buffer.concat(parts)));
      })
      .end((err, res) => (err ? reject(err) : resolve(res.body as Buffer)));
  });
  const wipeAll = async () => {
    await request(app).delete(`/api/v1/notes/checkins/${(await query('SELECT id FROM note_checkins')).rows[0]?.id}`);
    fs.rmSync(noteAudioDir(DEFAULT_USER_ID), { recursive: true, force: true });
  };

  it('round-trips an audio-only note through the real ZIP export and import', async () => {
    const { audioId, noteId } = await noteWithAudio('', '');
    const zip = await fetchZip();
    // The original is stored uncompressed in the ZIP, next to an index of metadata and transcripts.
    expect(zip.includes(data)).toBe(true);

    await wipeAll();
    expect((await query('SELECT COUNT(*)::int AS n FROM note_audio')).rows[0].n).toBe(0);
    expect(fs.existsSync(noteAudioDir(DEFAULT_USER_ID)) && fs.readdirSync(noteAudioDir(DEFAULT_USER_ID)).length > 0).toBe(false);

    const res = await request(app).post('/api/v1/backup/import').attach('file', zip, 'backup.zip');
    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);

    // The audio-only note and its audio are back, byte for byte, with the transcript and segments.
    const notes = await request(app).get(`/api/v1/notes/checkins/${noteId}/audio?include=segments`);
    expect(notes.body).toHaveLength(1);
    expect(notes.body[0]).toMatchObject({ id: audioId, filename: 'memo.webm', status: 'done', language: 'en', duration_ms: 4200 });
    expect(notes.body[0].segments.map((s: { text: string; edited: boolean }) => [s.text, s.edited]))
      .toEqual([['the quick', false], ['brown fox', true]]);
    const file = await request(app).get(`/api/v1/notes/audio/${audioId}`).buffer(true).parse((r, cb) => {
      const parts: Buffer[] = [];
      r.on('data', (c: Buffer) => parts.push(c));
      r.on('end', () => cb(null, Buffer.concat(parts)));
    });
    expect(Buffer.compare(file.body, data)).toBe(0);
    // ...and it is searchable again.
    const hits = await request(app).get('/api/v1/timeline').query({ q: 'fox' });
    expect((hits.body.checkins ?? hits.body).map((c: { id: string }) => c.id)).toEqual([noteId]);
  });

  it('is idempotent: restoring over existing data adds nothing and breaks nothing', async () => {
    const { audioId } = await noteWithAudio('Keep', 'text');
    const zip = await fetchZip();
    const res = await request(app).post('/api/v1/backup/import').attach('file', zip, 'backup.zip');
    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    expect((await query('SELECT COUNT(*)::int AS n FROM note_audio WHERE id = $1', [audioId])).rows[0].n).toBe(1);
    expect((await query('SELECT COUNT(*)::int AS n FROM note_audio_segments WHERE audio_id = $1', [audioId])).rows[0].n).toBe(2);
  });

  it('restores into another account, never trusting the backup’s user, and keeps the file private to it', async () => {
    const { audioId, noteId } = await noteWithAudio('Mine', 'body');
    const zip = await fetchZip();
    const other = await makeUser('restorer');
    const res = await request(app).post('/api/v1/backup/import').set('Cookie', other.cookie).attach('file', zip, 'backup.zip');
    expect(res.status).toBe(200);
    // The original owner's audio row has that id already (ON CONFLICT DO NOTHING), so nothing leaks or moves.
    expect((await query('SELECT user_id FROM note_audio WHERE id = $1', [audioId])).rows[0].user_id).toBe(DEFAULT_USER_ID);
    expect((await request(app).get(`/api/v1/notes/audio/${audioId}`).set('Cookie', other.cookie)).status).toBe(404);
    expect(noteId).toBeTruthy();
  });

  it('skips a corrupted audio file with a warning instead of restoring bad bytes', async () => {
    await noteWithAudio('Bad', 'text');
    const zip = await fetchZip();
    const at = zip.indexOf(data);
    const tampered = Buffer.from(zip);
    tampered[at + 10] ^= 0xff; // stored uncompressed, so this flips a byte of the audio
    await wipeAll();
    const res = await request(app).post('/api/v1/backup/import').attach('file', tampered, 'backup.zip');
    // The ZIP's own CRC may reject the archive outright; either way bad audio must not be restored.
    if (res.status === 200) expect(res.body.errors.join(' ')).toMatch(/corrupt|checksum/i);
    expect((await query('SELECT COUNT(*)::int AS n FROM note_audio')).rows[0].n).toBe(0);
  });

  it('removes an audio file from disk when its note is deleted', async () => {
    const { audioId, noteId } = await noteWithAudio('Gone', 'x');
    const file = path.join(noteAudioDir(DEFAULT_USER_ID), `${audioId}.webm`);
    expect(fs.existsSync(file)).toBe(true);
    expect((await request(app).delete(`/api/v1/notes/checkins/${noteId}`)).status).toBe(200);
    await new Promise((r) => setTimeout(r, 100));
    expect(fs.existsSync(file)).toBe(false);
    expect((await query('SELECT COUNT(*)::int AS n FROM note_audio WHERE id = $1', [audioId])).rows[0].n).toBe(0);
  });

  it('sweeps upload sessions abandoned for over a week, keeping fresh ones', async () => {
    const stale = (await startUploadFor()).id;
    const fresh = (await startUploadFor()).id;
    await query(`UPDATE note_audio SET created_at = NOW() - INTERVAL '8 days' WHERE id = $1`, [stale]);
    expect(await cleanupAbandonedUploads()).toBe(1);
    const left = (await query('SELECT id FROM note_audio')).rows.map((r) => r.id);
    expect(left).toEqual([fresh]);
  });

  async function startUploadFor() {
    const res = await request(app).post('/api/v1/notes/audio/uploads')
      .send({ filename: 'p.webm', mime: 'audio/webm', bytes: 10, sha256: 'a'.repeat(64) });
    return res.body as { id: string };
  }
});

describe('notes audio: restore rejects bad entries', () => {
  beforeEach(resetIntegrationDatabase);

  /** A hand-built extracted backup folder (what the framework passes as filesDir). */
  function bundle(entries: Record<string, unknown>[], files: Record<string, Buffer>) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wwp-audio-restore-test-'));
    fs.mkdirSync(path.join(root, 'audio'), { recursive: true });
    for (const [name, buf] of Object.entries(files)) fs.writeFileSync(path.join(root, name), buf);
    fs.writeFileSync(path.join(root, 'audio/index.json'), JSON.stringify({ version: 1, audio: entries }));
    return root;
  }
  const good = crypto.randomBytes(300);
  const entry = (over: Record<string, unknown> = {}) => {
    const id = crypto.randomUUID();
    return { id, note_id: null, filename: 'x.webm', mime: 'audio/webm', bytes: good.length, sha256: sha(good), duration_ms: 1, position: 0,
      status: 'done', error: null, language: 'en', model: 'm', transcript_text: 'hi', created_at: '2024-01-01T00:00:00Z',
      file: `audio/${id}.webm`, segments: [{ idx: 0, start_ms: 0, end_ms: 1, text: 'hi', edited: false }], ...over };
  };
  const restore = async (root: string) => {
    const errors: string[] = [];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const n = await restoreAudioBackup(client, DEFAULT_USER_ID, root, errors);
      await client.query('COMMIT');
      return { n, errors };
    } finally {
      client.release();
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
  afterAll(() => fs.rmSync(noteAudioDir(DEFAULT_USER_ID), { recursive: true, force: true }));

  it('restores a valid entry', async () => {
    const e = entry();
    const { n, errors } = await restore(bundle([e], { [e.file as string]: good }));
    expect({ n, errors }).toEqual({ n: 1, errors: [] });
    expect(fs.readFileSync(path.join(noteAudioDir(DEFAULT_USER_ID), `${e.id}.webm`)).equals(good)).toBe(true);
  });

  it('refuses a file whose bytes do not match the recorded checksum, and leaves no row or file', async () => {
    const e = entry();
    const bad = Buffer.from(good);
    bad[0] ^= 1;
    const { n, errors } = await restore(bundle([e], { [e.file as string]: bad }));
    expect(n).toBe(0);
    expect(errors.join(' ')).toMatch(/corrupted \(checksum mismatch\)/);
    expect((await query('SELECT COUNT(*)::int AS n FROM note_audio WHERE id = $1', [e.id])).rows[0].n).toBe(0);
    expect(fs.existsSync(path.join(noteAudioDir(DEFAULT_USER_ID), `${e.id}.webm`))).toBe(false);
  });

  it('refuses entries that point outside the backup folder or are malformed', async () => {
    const secret = path.join(os.tmpdir(), 'wwp-secret-outside.webm');
    fs.writeFileSync(secret, good);
    const id = crypto.randomUUID();
    const bundles = [
      entry({ id, file: `audio/../../${path.basename(secret)}` }),
      entry({ file: '/etc/passwd' }),
      entry({ id: 'not-a-uuid' }),
      entry({ mime: 'text/html' }),
      entry({ sha256: 'zz' }),
    ];
    const { n, errors } = await restore(bundle(bundles, {}));
    fs.rmSync(secret, { force: true });
    expect(n).toBe(0);
    expect(errors).toHaveLength(bundles.length);
    expect((await query('SELECT COUNT(*)::int AS n FROM note_audio')).rows[0].n).toBe(0);
  });

  it('reports a missing file and an unreadable index without failing the restore', async () => {
    const e = entry();
    expect((await restore(bundle([e], {}))).errors.join(' ')).toMatch(/missing from the backup/);
    const root = bundle([], {});
    fs.writeFileSync(path.join(root, 'audio/index.json'), '{ not json');
    expect((await restore(root)).errors.join(' ')).toMatch(/could not be read/);
  });

  it('queues unfinished transcripts again, and binds rows to the restoring user whatever the backup says', async () => {
    const e = entry({ status: 'processing', transcript_text: '', user_id: '00000000-0000-0000-0000-0000000000ff' });
    await restore(bundle([e], { [e.file as string]: good }));
    const row = (await query('SELECT user_id, status, attempts FROM note_audio WHERE id = $1', [e.id])).rows[0];
    expect(row).toEqual({ user_id: DEFAULT_USER_ID, status: 'pending', attempts: 0 });
  });
});


describe('notes audio import: plan, create notes, reuse', () => {
  beforeEach(resetIntegrationDatabase);
  const bytes = crypto.randomBytes(800);

  async function upload(buf: Buffer, opts: { defer?: boolean; reuse?: boolean; complete?: boolean } = {}) {
    const start = await request(app).post('/api/v1/notes/audio/uploads')
      .send({ filename: 'x.m4a', mime: 'audio/mp4', bytes: buf.length, sha256: sha(buf), defer: opts.defer, reuse: opts.reuse });
    if (start.body.complete || opts.complete === false) return start;
    const id = start.body.id as string;
    await request(app).put(`/api/v1/notes/audio/uploads/${id}?offset=0`).set('Content-Type', 'application/octet-stream').send(buf);
    await request(app).post(`/api/v1/notes/audio/uploads/${id}/complete`);
    return start;
  }
  const plan = (files: unknown[], tz = 'America/Chicago', cookie?: string) => {
    const r = request(app).post('/api/v1/import/notes/audio/plan').send({ files, fallback_timezone: tz });
    return cookie ? r.set('Cookie', cookie) : r;
  };
  const addNote = (item: Record<string, unknown>, cookie?: string) => {
    const r = request(app).post('/api/v1/import/notes/audio').send(item);
    return cookie ? r.set('Cookie', cookie) : r;
  };
  const note = (audio_id: string, over: Record<string, unknown> = {}) => ({
    audio_id, title: 'Walk', checked_in_at: '2023-04-05T19:30:59.000Z', timezone: 'America/Chicago', filename: '2023-04-05 14.30.59 Walk.m4a', tags: [], ...over,
  });

  it('plans titles, dates and zones from the file names, and flags audio already imported by checksum', async () => {
    const id = (await upload(bytes)).body.id as string;
    const attached = await addNote(note(id));
    expect(attached.status).toBe(201);
    const other = crypto.randomBytes(800);
    await upload(other); // finished but never attached to a note: not "imported"

    const res = await plan([
      { name: '2023-04-05 14.30.59 Walk in the park.m4a', size: 800, last_modified: 1, sha256: sha(bytes) },
      { name: '2023-04-06 08.00.00.mp3', size: 800, last_modified: 1, sha256: sha(other) },
      { name: 'notes.txt', size: 5, last_modified: 1, sha256: null },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.rows.map((r: { duplicate: string | null; selected_default: boolean }) => [r.duplicate, r.selected_default]))
      .toEqual([['checksum', false], [null, true], [null, false]]);
    expect(res.body.rows[0]).toMatchObject({ title: 'Walk in the park', checked_in_at: '2023-04-05T19:30:59.000Z', time_source: 'filename', timezone: 'America/Chicago' });
    expect(res.body.rows[1]).toMatchObject({ title: null, local_date: '2023-04-06' });
    expect(res.body.rows[2].error).toBe('Not a supported audio file');
    expect(res.body).toMatchObject({ total: 3, selected: 1, duplicate_count: 1 });
  });

  it('does not count another user’s audio as already imported, and rejects a malformed request', async () => {
    const id = (await upload(bytes)).body.id as string;
    await addNote(note(id));
    const other = await makeUser('planner');
    const res = await plan([{ name: 'a.m4a', size: 800, last_modified: 1, sha256: sha(bytes) }], 'UTC', other.cookie);
    expect(res.body.rows[0].duplicate).toBeNull();
    expect((await plan([])).status).toBe(400);
    expect((await plan([{ size: 1 }])).status).toBe(400);
  });

  it('creates an audio-only note from a held upload: dated, titled, tagged, marked as an import, audio attached', async () => {
    const id = (await upload(bytes, { defer: true })).body.id as string;
    const res = await addNote(note(id, { tags: ['Voice Memos', 'voice memos', 'Walks'] }));
    expect(res.status).toBe(201);
    const row = (await query('SELECT title, body, checked_in_at, checkin_timezone, source, source_filename FROM note_checkins WHERE id = $1', [res.body.note_id])).rows[0];
    expect(row).toMatchObject({ title: 'Walk', body: '', checkin_timezone: 'America/Chicago', source: 'import', source_filename: '2023-04-05 14.30.59 Walk.m4a' });
    expect(new Date(row.checked_in_at).toISOString()).toBe('2023-04-05T19:30:59.000Z');
    const tags = (await query('SELECT t.name FROM note_tag_links l JOIN note_tags t ON t.id = l.tag_id WHERE l.note_id = $1 ORDER BY t.name', [res.body.note_id])).rows.map((r) => r.name);
    expect(tags).toEqual(['Voice Memos', 'Walks']); // names are matched case-insensitively
    expect((await request(app).get(`/api/v1/notes/checkins/${res.body.note_id}/audio`)).body).toHaveLength(1);
    // Held from transcription until the run says it is over.
    expect((await query(`SELECT next_attempt_at = 'infinity' AS held FROM note_audio WHERE id = $1`, [id])).rows[0].held).toBe(true);
  });

  it('is safe to retry: a second request for the same audio returns the same note', async () => {
    const id = (await upload(bytes)).body.id as string;
    const first = await addNote(note(id));
    const again = await addNote(note(id, { title: 'Different' }));
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ note_id: first.body.note_id, already: true });
    expect((await query('SELECT COUNT(*)::int AS n FROM note_checkins')).rows[0].n).toBe(1);
  });

  it('rejects bad input, unfinished uploads, and audio that belongs to someone else', async () => {
    const id = (await upload(bytes)).body.id as string;
    expect((await addNote(note('nope'))).status).toBe(400);
    expect((await addNote(note(id, { timezone: 'Mars/Base' }))).status).toBe(400);
    expect((await addNote(note(id, { checked_in_at: 'yesterday-ish' }))).status).toBe(400);
    expect((await addNote(note(id, { title: 'x'.repeat(400) }))).status).toBe(400);
    expect((await query('SELECT COUNT(*)::int AS n FROM note_checkins')).rows[0].n).toBe(0);

    const unfinished = (await upload(crypto.randomBytes(100), { complete: false })).body.id as string;
    expect((await addNote(note(unfinished))).status).toBe(409);

    const other = await makeUser('thief');
    expect((await addNote(note(id), other.cookie)).status).toBe(404);
    expect((await query('SELECT COUNT(*)::int AS n FROM note_checkins')).rows[0].n).toBe(0);
  });

  it('reuses a finished, unattached upload of identical audio instead of uploading it again', async () => {
    const first = await upload(bytes, { defer: true });
    const again = await upload(bytes, { defer: true, reuse: true });
    expect(again.body).toEqual({ id: first.body.id, offset: bytes.length, complete: true });
    expect((await query('SELECT COUNT(*)::int AS n FROM note_audio')).rows[0].n).toBe(1);

    // Once attached to a note it is "imported" and a new upload is a new file.
    await addNote(note(first.body.id));
    const fresh = await upload(bytes, { defer: true, reuse: true });
    expect(fresh.body.id).not.toBe(first.body.id);
    expect(fresh.body.complete).toBeUndefined();
    expect((await query('SELECT COUNT(*)::int AS n FROM note_audio')).rows[0].n).toBe(2);
  });

  it('never reuses an unfinished upload, or another user’s upload', async () => {
    const half = await upload(bytes, { complete: false });
    const retry = await upload(bytes, { reuse: true, complete: false });
    expect(retry.body.id).not.toBe(half.body.id);
    expect(retry.body.complete).toBeUndefined();

    const done = await upload(crypto.randomBytes(400));
    expect(done.body.id).toBeTruthy();
    const other = await makeUser('reuser');
    const mine = (await query('SELECT sha256, bytes FROM note_audio WHERE id = $1', [done.body.id])).rows[0];
    const res = await request(app).post('/api/v1/notes/audio/uploads').set('Cookie', other.cookie)
      .send({ filename: 'x.m4a', mime: 'audio/mp4', bytes: Number(mine.bytes), sha256: mine.sha256, reuse: true });
    expect(res.body.complete).toBeUndefined();
    expect(res.body.id).not.toBe(done.body.id);
  });
});

describe('notes audio: library rows carry an audio count', () => {
  beforeEach(resetIntegrationDatabase);

  it('counts finished audio per note, not uploads in progress or other users’ audio', async () => {
    const withAudio = await request(app).post('/api/v1/notes/checkins')
      .send({ title: 'Has audio', body: 'x', checked_in_at: '2024-05-05T10:00:00Z', checkin_timezone: 'UTC' });
    const plain = await request(app).post('/api/v1/notes/checkins')
      .send({ title: 'Typed only', body: 'x', checked_in_at: '2024-05-04T10:00:00Z', checkin_timezone: 'UTC' });
    const insert = async (status: string, noteId: string | null) => (await query(
      `INSERT INTO note_audio (user_id, note_id, filename, mime, bytes, sha256, status) VALUES ($1, $2, 'a.webm', 'audio/webm', 1, $3, $4) RETURNING id`,
      [DEFAULT_USER_ID, noteId, crypto.randomBytes(32).toString('hex'), status],
    )).rows[0].id as string;
    await insert('done', withAudio.body.id);
    await insert('pending', withAudio.body.id);
    await insert('uploading', withAudio.body.id); // still uploading: not counted
    await insert('done', null); // unattached: belongs to no note

    const res = await request(app).get('/api/v1/notes/library');
    const byTitle = Object.fromEntries(res.body.notes.map((n: { title: string; audio_count: number }) => [n.title, n.audio_count]));
    expect(byTitle).toEqual({ 'Has audio': 2, 'Typed only': 0 });
    expect(plain.status).toBe(201);
  });
});

describe('notes audio: speaker identification', () => {
  const data = crypto.randomBytes(2000);
  let whisper: http.Server;
  let diarizer: http.Server;
  let whisperUrl = '';
  let diarizerUrl = '';
  let whisperRequests: string[] = [];
  let diarizeRequests: string[] = [];
  let turns: { start: number; end: number; speaker: string }[] = [];
  let diarizeStatus = 200;
  let diarizeBody = '';
  /** Runs while the fake diarizer is "working", before it answers. */
  let whileDiarizing: (() => Promise<void>) | null = null;

  /** One 2-second segment, "How are you? Good, thanks.", with each word's timing. */
  const WORDS = [['How', 0, 0.38], ['are', 0.4, 0.78], ['you?', 0.8, 1.18], ['Good,', 1.2, 1.58], ['thanks.', 1.6, 1.98]];
  const segmentJson = (withWords: boolean) => ({
    text: 'How are you? Good, thanks.', language: 'en', duration: 2,
    segments: [{
      start: 0, end: 1.98, text: ' How are you? Good, thanks.',
      ...(withWords ? { words: WORDS.map(([word, start, end]) => ({ word: ` ${word}`, start, end })) } : {}),
    }],
  });

  const readBody = (req: http.IncomingMessage) => new Promise<string>((resolve) => {
    const parts: Buffer[] = [];
    req.on('data', (c: Buffer) => parts.push(c));
    req.on('end', () => resolve(Buffer.concat(parts).toString('latin1')));
  });

  beforeAll(async () => {
    whisper = http.createServer(async (req, res) => {
      const body = await readBody(req);
      whisperRequests.push(body);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(segmentJson(/name="timestamp_granularities\[\]"\r\n\r\nword/.test(body))));
    });
    diarizer = http.createServer(async (req, res) => {
      if (req.url === '/health') {
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify(diarizeHealth));
      }
      diarizeRequests.push(await readBody(req));
      if (whileDiarizing) await whileDiarizing();
      res.statusCode = diarizeStatus;
      res.setHeader('Content-Type', 'application/json');
      res.end(diarizeBody || JSON.stringify({ duration: 2, speakers: [...new Set(turns.map((t) => t.speaker))], turns }));
    });
    await Promise.all([whisper, diarizer].map((s) => new Promise<void>((r) => s.listen(0, '127.0.0.1', r))));
    whisperUrl = `http://127.0.0.1:${(whisper.address() as { port: number }).port}/v1`;
    diarizerUrl = `http://127.0.0.1:${(diarizer.address() as { port: number }).port}`;
  });
  afterAll(async () => {
    await Promise.all([whisper, diarizer].map((s) => new Promise((r) => s.close(r))));
  });

  let diarizeHealth: Record<string, unknown> = { status: 'ok', pipeline_loaded: true, device: 'cuda' };
  beforeEach(async () => {
    await resetIntegrationDatabase();
    whisperRequests = [];
    diarizeRequests = [];
    turns = [{ start: 0, end: 1.2, speaker: 'SPEAKER_01' }, { start: 1.2, end: 2.5, speaker: 'SPEAKER_00' }];
    diarizeStatus = 200;
    diarizeBody = '';
    whileDiarizing = null;
    diarizeHealth = { status: 'ok', pipeline_loaded: true, device: 'cuda' };
  });

  const setting = (key: string, value: unknown) => query(
    `INSERT INTO plugin_settings (user_id, plugin_id, key, value) VALUES ($1, 'notes', $2, $3::jsonb)
     ON CONFLICT (user_id, plugin_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [DEFAULT_USER_ID, key, JSON.stringify(value)],
  );
  const configureTranscription = async () => {
    await setting('transcription_api_url', whisperUrl);
    await setting('transcription_model', 'fake-model');
  };
  const configureDiarization = (extra: Record<string, unknown> = {}) => Promise.all([
    setting('diarization_api_url', diarizerUrl),
    ...Object.entries(extra).map(([k, v]) => setting(k, v)),
  ]);

  async function transcribedAudio(): Promise<string> {
    const start = await request(app).post('/api/v1/notes/audio/uploads')
      .send({ filename: 'talk.webm', mime: 'audio/webm', bytes: data.length, sha256: sha(data) });
    const id = start.body.id as string;
    await request(app).put(`/api/v1/notes/audio/uploads/${id}?offset=0`).set('Content-Type', 'application/octet-stream').send(data);
    await request(app).post(`/api/v1/notes/audio/uploads/${id}/complete`);
    await drainTranscriptionQueue();
    return id;
  }
  const segments = async (id: string) => (await query(
    'SELECT idx, start_ms, end_ms, text, edited, speaker, src, words IS NOT NULL AS has_words FROM note_audio_segments WHERE audio_id = $1 ORDER BY idx', [id])).rows;
  const audioRow = async (id: string) => (await query(
    'SELECT status, diarization_status, diarization_error, diarization_attempts, speakers, transcript_text FROM note_audio WHERE id = $1', [id])).rows[0];
  const view = (s: { speaker: string | null; text: string }[]) => s.map((x) => [x.speaker, x.text]);

  it('keeps a correction saved while speakers were being identified (and does not re-cut it)', async () => {
    await configureTranscription();
    await configureDiarization();
    whileDiarizing = async () => {
      const res = await request(app).put(`/api/v1/notes/audio/${id}/transcript`)
        .send({ segments: [{ idx: 0, start_ms: 0, text: 'How are you? Fine, thanks.' }] });
      expect(res.status).toBe(200);
    };
    let id = '';
    const start = await request(app).post('/api/v1/notes/audio/uploads')
      .send({ filename: 'talk.webm', mime: 'audio/webm', bytes: data.length, sha256: sha(data) });
    id = start.body.id as string;
    await request(app).put(`/api/v1/notes/audio/uploads/${id}?offset=0`).set('Content-Type', 'application/octet-stream').send(data);
    await request(app).post(`/api/v1/notes/audio/uploads/${id}/complete`);
    await drainTranscriptionQueue();

    expect(diarizeRequests).toHaveLength(1);
    expect(await audioRow(id)).toMatchObject({ diarization_status: 'done', transcript_text: 'How are you? Fine, thanks.' });
    const segs = await segments(id);
    expect(view(segs)).toEqual([['S1', 'How are you? Fine, thanks.']]); // labelled whole: the edit survives
    expect(segs[0].edited).toBe(true);
  });

  it('stops "identifying speakers" when the service is turned off while files wait for it', async () => {
    await configureTranscription();
    diarizeStatus = 503;
    diarizeBody = JSON.stringify({ detail: 'still loading' });
    await configureDiarization();
    const id = await transcribedAudio();
    expect(await audioRow(id)).toMatchObject({ diarization_status: 'pending' });

    await query(`DELETE FROM plugin_settings WHERE user_id = $1 AND key = 'diarization_api_url'`, [DEFAULT_USER_ID]);
    await query('UPDATE note_audio SET diarization_next_at = NOW() WHERE id = $1', [id]);
    await drainTranscriptionQueue();
    expect(await audioRow(id)).toMatchObject({ diarization_status: 'none' });
    expect(diarizeRequests).toHaveLength(1);
  });

  it('refuses an edit made against the transcript as it was before speakers split it', async () => {
    await configureTranscription();
    const id = await transcribedAudio(); // speaker identification off: one segment, as the editor loads it
    const loaded = (await segments(id))[0];
    expect(loaded).toMatchObject({ idx: 0, start_ms: 0, text: 'How are you? Good, thanks.' });

    await configureDiarization();
    await request(app).post(`/api/v1/notes/audio/${id}/diarize`);
    await drainTranscriptionQueue();
    // Without word timings the segment is labelled whole; force the split the editor didn't see.
    await query(`UPDATE note_audio_segments SET end_ms = 1180, text = 'How are you?' WHERE audio_id = $1 AND idx = 0`, [id]);
    await query(`INSERT INTO note_audio_segments (audio_id, idx, start_ms, end_ms, text, src) VALUES ($1, 1, 1200, 1980, 'Good, thanks.', 0)`, [id]);

    // The first piece still starts at 0, so the start time alone would let this through.
    const res = await request(app).put(`/api/v1/notes/audio/${id}/transcript`)
      .send({ segments: [{ idx: 0, start_ms: 0, prev_text: loaded.text, text: 'How are you? Fine, thanks.' }] });
    expect(res.status).toBe(409);
    expect(view(await segments(id)).map(([, text]) => text)).toEqual(['How are you?', 'Good, thanks.']);
  });

  it('takes back a speaker pass left marked "processing" on the next pass', async () => {
    await configureTranscription();
    await configureDiarization();
    const id = await transcribedAudio();
    await query(`UPDATE note_audio SET diarization_status = 'processing' WHERE id = $1`, [id]);
    await drainTranscriptionQueue();
    expect(diarizeRequests).toHaveLength(2);
    expect(await audioRow(id)).toMatchObject({ diarization_status: 'done' });
  });

  it('asks the transcriber for word timings only when speaker identification is set up', async () => {
    await configureTranscription();
    const plain = await transcribedAudio();
    expect(whisperRequests[0]).not.toMatch(/name="timestamp_granularities\[\]"\r\n\r\nword/);
    expect(await audioRow(plain)).toMatchObject({ diarization_status: 'none' });
    expect((await segments(plain)).map((s) => s.speaker)).toEqual([null]);
    expect(diarizeRequests).toHaveLength(0);

    await resetIntegrationDatabase();
    whisperRequests = [];
    await configureTranscription();
    await configureDiarization();
    await transcribedAudio();
    expect(whisperRequests[0]).toMatch(/name="timestamp_granularities\[\]"\r\n\r\nword/);
  });

  it('identifies speakers after transcribing and splits the segment where the speaker changes', async () => {
    await configureTranscription();
    await configureDiarization();
    const id = await transcribedAudio();

    expect(await audioRow(id)).toMatchObject({ status: 'done', diarization_status: 'done', diarization_error: null, speakers: {} });
    const segs = await segments(id);
    expect(view(segs)).toEqual([['S1', 'How are you?'], ['S2', 'Good, thanks.']]); // SPEAKER_01 spoke first, so it is S1
    expect(segs.map((s) => [s.start_ms, s.end_ms])).toEqual([[0, 1180], [1200, 1980]]);
    expect(segs.every((s) => s.src === 0 && s.has_words)).toBe(true);
    // The searchable text is the transcriber's, unchanged (speakers aren't words).
    expect((await audioRow(id)).transcript_text).toBe('How are you? Good, thanks.');
  });

  it('sends the expected number of speakers as a hint: exact when min equals max, else a range', async () => {
    await configureTranscription();
    await configureDiarization({ diarization_min_speakers: 2, diarization_max_speakers: 2 });
    await transcribedAudio();
    expect(diarizeRequests[0]).toMatch(/name="num_speakers"\r\n\r\n2/);
    expect(diarizeRequests[0]).not.toMatch(/name="min_speakers"/);

    await resetIntegrationDatabase();
    diarizeRequests = [];
    await configureTranscription();
    await configureDiarization({ diarization_min_speakers: 1, diarization_max_speakers: 3 });
    await transcribedAudio();
    expect(diarizeRequests[0]).toMatch(/name="min_speakers"\r\n\r\n1/);
    expect(diarizeRequests[0]).toMatch(/name="max_speakers"\r\n\r\n3/);
    expect(diarizeRequests[0]).not.toMatch(/name="num_speakers"/);
  });

  it('re-identifying cuts again from the original segments, so a better answer replaces the first split', async () => {
    await configureTranscription();
    await configureDiarization();
    const id = await transcribedAudio();
    expect(view(await segments(id))).toEqual([['S1', 'How are you?'], ['S2', 'Good, thanks.']]);

    turns = [{ start: 0, end: 0.8, speaker: 'A' }, { start: 0.8, end: 2.5, speaker: 'B' }];
    await request(app).put(`/api/v1/notes/audio/${id}/speakers`).send({ names: { S1: 'Dad' } });
    const res = await request(app).post(`/api/v1/notes/audio/${id}/diarize`);
    expect(res.status).toBe(200);
    await drainTranscriptionQueue();
    expect(view(await segments(id))).toEqual([['S1', 'How are'], ['S2', 'you? Good, thanks.']]);
    expect((await audioRow(id)).speakers).toEqual({}); // names belonged to the old labelling
  });

  it('never re-cuts text the user corrected: it labels whole segments and keeps the correction', async () => {
    await configureTranscription();
    const id = await transcribedAudio(); // no speaker identification yet
    await request(app).put(`/api/v1/notes/audio/${id}/transcript`).send({ segments: [{ idx: 0, text: 'How are you? Fine, thanks.' }] });
    await configureDiarization();
    expect((await request(app).post(`/api/v1/notes/audio/${id}/diarize`)).status).toBe(200);
    await drainTranscriptionQueue();
    const segs = await segments(id);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ text: 'How are you? Fine, thanks.', edited: true, speaker: 'S1' });
  });

  it('works on a transcript made before word timings were requested, labelling whole segments', async () => {
    await configureTranscription();
    const id = await transcribedAudio();
    expect((await segments(id))[0].has_words).toBe(false);
    await configureDiarization();
    await request(app).post(`/api/v1/notes/audio/${id}/diarize`);
    await drainTranscriptionQueue();
    const segs = await segments(id);
    expect(segs).toHaveLength(1); // no words, so no split
    expect(segs[0].speaker).toBe('S1'); // A speaks 1.2 s of 1.98 s
  });

  it('a transcript with no detected speech is done, with a note, not failed', async () => {
    await configureTranscription();
    await configureDiarization();
    turns = [];
    const id = await transcribedAudio();
    expect(await audioRow(id)).toMatchObject({ diarization_status: 'done', diarization_error: expect.stringContaining('No speech') });
    expect((await segments(id))[0].speaker).toBeNull();
  });

  describe('when the diarization service fails', () => {
    it('keeps the transcript, retries a server error with backoff, and gives up after the last attempt', async () => {
      await configureTranscription();
      await configureDiarization();
      diarizeStatus = 503;
      diarizeBody = JSON.stringify({ detail: 'The diarization model is still loading' });
      const id = await transcribedAudio();
      expect(await audioRow(id)).toMatchObject({ status: 'done', diarization_status: 'pending', diarization_attempts: 1 });
      expect((await audioRow(id)).diarization_error).toContain('still loading');
      expect(view(await segments(id))).toEqual([[null, 'How are you? Good, thanks.']]); // transcript untouched

      for (let i = 0; i < 6; i++) {
        await query(`UPDATE note_audio SET diarization_next_at = NOW() WHERE id = $1 AND diarization_status = 'pending'`, [id]);
        await drainTranscriptionQueue();
      }
      expect(await audioRow(id)).toMatchObject({ diarization_status: 'failed', diarization_attempts: 5 });
    });

    it('fails at once when the service refuses the audio itself (4xx)', async () => {
      await configureTranscription();
      await configureDiarization();
      diarizeStatus = 422;
      diarizeBody = JSON.stringify({ detail: 'Could not decode the audio' });
      const id = await transcribedAudio();
      expect(await audioRow(id)).toMatchObject({ diarization_status: 'failed', diarization_attempts: 1 });
      expect((await audioRow(id)).diarization_error).toContain('Could not decode');
    });

    it('recovers when the service comes back and you ask again', async () => {
      await configureTranscription();
      await configureDiarization();
      diarizeStatus = 422;
      const id = await transcribedAudio();
      diarizeStatus = 200;
      await request(app).post(`/api/v1/notes/audio/${id}/diarize`);
      await drainTranscriptionQueue();
      expect(await audioRow(id)).toMatchObject({ diarization_status: 'done', diarization_attempts: 0, diarization_error: null });
      expect((await segments(id)).map((s) => s.speaker)).toEqual(['S1', 'S2']);
    });
  });

  it('puts a waiting transcript back to "not identified", without failing it, for a user who has not set up the service', async () => {
    await configureTranscription();
    const id = await transcribedAudio();
    await query(`UPDATE note_audio SET diarization_status = 'pending' WHERE id = $1`, [id]);
    await drainTranscriptionQueue();
    expect(await audioRow(id)).toMatchObject({ diarization_status: 'none', diarization_attempts: 0 });
    expect(diarizeRequests).toHaveLength(0);
    await configureDiarization(); // now they set it up: Identify speakers works
    expect((await request(app).post(`/api/v1/notes/audio/${id}/diarize`)).status).toBe(200);
    await drainTranscriptionQueue();
    expect(await audioRow(id)).toMatchObject({ diarization_status: 'done' });
  });

  it('refuses to identify speakers until the service is set up, and for audio that is not transcribed or not yours', async () => {
    await configureTranscription();
    const id = await transcribedAudio();
    const none = await request(app).post(`/api/v1/notes/audio/${id}/diarize`);
    expect(none.status).toBe(409);
    expect(none.body.error).toContain('Settings > Integrations');

    await configureDiarization();
    const other = await createTestUser('diarizer');
    expect((await request(app).post(`/api/v1/notes/audio/${id}/diarize`).set('Cookie', other.cookie)).status).toBe(404);
    expect((await request(app).post('/api/v1/notes/audio/not-a-uuid/diarize')).status).toBe(404);
    const pending = (await query(
      `INSERT INTO note_audio (user_id, filename, mime, bytes, sha256, status) VALUES ($1, 'p.webm', 'audio/webm', 1, $2, 'pending') RETURNING id`,
      [DEFAULT_USER_ID, 'e'.repeat(64)])).rows[0].id;
    expect((await request(app).post(`/api/v1/notes/audio/${pending}/diarize`)).status).toBe(404); // not transcribed yet
  });

  it('transcribing again clears the speakers and runs the speaker pass on the new transcript', async () => {
    await configureTranscription();
    await configureDiarization();
    const id = await transcribedAudio();
    await request(app).put(`/api/v1/notes/audio/${id}/speakers`).send({ names: { S1: 'Dad' } });
    await request(app).post(`/api/v1/notes/audio/${id}/retranscribe`);
    await drainTranscriptionQueue();
    expect(await audioRow(id)).toMatchObject({ diarization_status: 'done', speakers: {} });
    expect(view(await segments(id))).toEqual([['S1', 'How are you?'], ['S2', 'Good, thanks.']]);
  });

  describe('naming speakers', () => {
    it('renames speakers per file, blank goes back to the default, and the list carries names and speakers', async () => {
      await configureTranscription();
      await configureDiarization();
      const id = await transcribedAudio();
      const note = await request(app).post('/api/v1/notes/checkins')
        .send({ title: 'Chat', body: '', checked_in_at: '2024-06-06T10:00:00Z', checkin_timezone: 'UTC', audio_ids: [id] });

      const named = await request(app).put(`/api/v1/notes/audio/${id}/speakers`).send({ names: { S1: '  Dad ', S2: 'Cass' } });
      expect(named.body).toEqual({ speakers: { S1: 'Dad', S2: 'Cass' } });
      expect((await request(app).put(`/api/v1/notes/audio/${id}/speakers`).send({ names: { S2: '' } })).body).toEqual({ speakers: { S1: 'Dad' } });

      const list = await request(app).get(`/api/v1/notes/checkins/${note.body.id}/audio?include=segments`);
      expect(list.body[0]).toMatchObject({ diarization_status: 'done', speakers: { S1: 'Dad' } });
      expect(list.body[0].segments.map((s: { speaker: string }) => s.speaker)).toEqual(['S1', 'S2']);
    });

    it('rejects bad names and other users', async () => {
      await configureTranscription();
      const id = await transcribedAudio();
      const put = (names: unknown, cookie?: string) => {
        const r = request(app).put(`/api/v1/notes/audio/${id}/speakers`).send({ names } as object);
        return cookie ? r.set('Cookie', cookie) : r;
      };
      expect((await put({ 'not a speaker': 'x' })).status).toBe(400);
      expect((await put({ S1: 5 })).status).toBe(400);
      expect((await put({ S1: 'x'.repeat(61) })).status).toBe(400);
      expect((await put('nope')).status).toBe(400);
      expect((await put([])).status).toBe(400);
      expect((await put({ S1: 'Dad' }, (await createTestUser('namer')).cookie)).status).toBe(404);
      expect((await audioRow(id)).speakers).toEqual({});
    });
  });

  it('tests the service: ready, still loading, model missing, unreachable', async () => {
    const test = (api_url: string) => request(app).post('/api/v1/notes/diarization/test').send({ api_url });
    expect((await test(diarizerUrl)).body).toEqual({ ok: true, message: 'Connected, model ready (cuda).' });
    diarizeHealth = { status: 'loading', pipeline_loaded: false };
    expect((await test(diarizerUrl)).body.message).toContain('still loading');
    diarizeHealth = { status: 'error', pipeline_loaded: false, error: 'HF_TOKEN is not set' };
    const bad = (await test(diarizerUrl)).body;
    expect(bad.ok).toBe(false);
    expect(bad.message).toContain('HF_TOKEN is not set');
    expect((await test('http://127.0.0.1:1')).body.ok).toBe(false);
    expect((await request(app).post('/api/v1/notes/diarization/test').send({})).status).toBe(400);
  });

  it('survives a backup and restore: speakers, names, word timings and the original-segment link', async () => {
    await configureTranscription();
    await configureDiarization();
    const id = await transcribedAudio();
    await request(app).post('/api/v1/notes/checkins')
      .send({ title: 'Chat', body: 'x', checked_in_at: '2024-06-06T10:00:00Z', checkin_timezone: 'UTC', audio_ids: [id] });
    await request(app).put(`/api/v1/notes/audio/${id}/speakers`).send({ names: { S1: 'Dad' } });
    const before = await segments(id);

    const zip = await new Promise<Buffer>((resolve, reject) => {
      request(app).get('/api/v1/backup/export').buffer(true)
        .parse((res, cb) => {
          const parts: Buffer[] = [];
          res.on('data', (c: Buffer) => parts.push(c));
          res.on('end', () => cb(null, Buffer.concat(parts)));
        })
        .end((err, res) => (err ? reject(err) : resolve(res.body as Buffer)));
    });
    await request(app).delete(`/api/v1/notes/checkins/${(await query('SELECT id FROM note_checkins')).rows[0].id}`);
    expect((await query('SELECT COUNT(*)::int AS n FROM note_audio')).rows[0].n).toBe(0);

    const res = await request(app).post('/api/v1/backup/import').attach('file', zip, 'backup.zip');
    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    expect(await audioRow(id)).toMatchObject({ diarization_status: 'done', speakers: { S1: 'Dad' } });
    expect(await segments(id)).toEqual(before);
    // The word timings came back too, so the speakers can be re-identified after a restore.
    await request(app).post(`/api/v1/notes/audio/${id}/diarize`);
    await drainTranscriptionQueue();
    expect(view(await segments(id))).toEqual([['S1', 'How are you?'], ['S2', 'Good, thanks.']]);
  });
});
