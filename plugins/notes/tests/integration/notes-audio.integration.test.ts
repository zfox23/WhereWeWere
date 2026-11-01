import crypto from 'crypto';
import fs from 'fs';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../../../server/src/index';
import { noteAudioDir } from '../../services/audioFiles';
import {
  DEFAULT_USER_ID,
  resetIntegrationDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
} from '../../../../server/tests/helpers/testDb';
import { createTestUser, type TestUser } from '../../../../server/tests/helpers/auth';

const app = createApp();
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

describe('notes audio: resumable upload, range playback, ownership', () => {
  let other: TestUser;
  const data = crypto.randomBytes(3000);

  beforeAll(setupIntegrationDatabase);
  beforeEach(async () => {
    await resetIntegrationDatabase();
    other = await createTestUser('other');
  });
  afterAll(async () => {
    // The tests write real files under DATA_DIR; leave nothing behind.
    for (const id of [DEFAULT_USER_ID, other?.id]) {
      if (id) fs.rmSync(noteAudioDir(id), { recursive: true, force: true });
    }
    await teardownIntegrationDatabase();
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
