import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../../../server/src/index';
import { noteAudioDir } from '../../services/audioFiles';
import { MAX_ATTEMPTS, drainTranscriptionQueue } from '../../services/transcription';
import { query } from '../../../../server/src/db';
import {
  DEFAULT_USER_ID,
  resetIntegrationDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
} from '../../../../server/tests/helpers/testDb';
import { createTestUser, type TestUser } from '../../../../server/tests/helpers/auth';

const app = createApp();
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

beforeAll(setupIntegrationDatabase);
afterAll(teardownIntegrationDatabase);

describe('notes audio: resumable upload, range playback, ownership', () => {
  let other: TestUser;
  const data = crypto.randomBytes(3000);

  beforeEach(async () => {
    await resetIntegrationDatabase();
    other = await createTestUser('other');
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

  beforeAll(async () => {
    fake = http.createServer((req, res) => {
      const parts: Buffer[] = [];
      req.on('data', (c: Buffer) => parts.push(c));
      req.on('end', () => {
        if (req.url?.endsWith('/models')) {
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ data: [{ id: 'fake-model' }] }));
        }
        requests.push({ auth: req.headers.authorization, body: Buffer.concat(parts) });
        respond(res);
      });
    });
    await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
    fakeUrl = `http://127.0.0.1:${(fake.address() as { port: number }).port}/v1`;
  });
  beforeEach(async () => {
    await resetIntegrationDatabase();
    requests = [];
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
  });

  it('parks audio without burning attempts when no endpoint is configured', async () => {
    const id = await uploadedAudio();
    await drainTranscriptionQueue();
    expect(await state(id)).toMatchObject({ status: 'pending', attempts: 0 });
    expect(requests).toHaveLength(0);
  });

  it('retries with backoff on failure, gives up after MAX_ATTEMPTS, and retranscribe resets', async () => {
    await configure();
    respond = (res) => { res.statusCode = 503; res.end('busy'); };
    const id = await uploadedAudio();
    await drainTranscriptionQueue();
    expect(await state(id)).toMatchObject({ status: 'pending', attempts: 1 });
    expect((await state(id)).error).toContain('503');

    await query(`UPDATE note_audio SET attempts = $2, next_attempt_at = NOW() WHERE id = $1`, [id, MAX_ATTEMPTS - 1]);
    await drainTranscriptionQueue();
    expect(await state(id)).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS });

    respond = (res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ text: 'ok again' })); };
    expect((await request(app).post(`/api/v1/notes/audio/${id}/retranscribe`)).status).toBe(200);
    await drainTranscriptionQueue();
    expect(await state(id)).toMatchObject({ status: 'done', attempts: 0, transcript_text: 'ok again' });
  });

  it('tests the connection using saved or supplied settings', async () => {
    const ok = await request(app).post('/api/v1/notes/transcription/test').send({ api_url: fakeUrl, model: 'fake-model' });
    expect(ok.body).toEqual({ ok: true, message: 'Connected.' });
    const unknownModel = await request(app).post('/api/v1/notes/transcription/test').send({ api_url: fakeUrl, model: 'other' });
    expect(unknownModel.body.message).toContain('not listed');
    const down = await request(app).post('/api/v1/notes/transcription/test').send({ api_url: 'http://127.0.0.1:1/v1', model: 'x' });
    expect(down.body.ok).toBe(false);
    expect((await request(app).post('/api/v1/notes/transcription/test').send({})).status).toBe(400);
  });
});
