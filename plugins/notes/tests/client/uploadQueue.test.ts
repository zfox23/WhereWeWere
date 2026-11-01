import 'fake-indexeddb/auto';
import { createHash, randomBytes } from 'crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DB_NAME, appendChunk, assembleBlob, createRecording, getRecording, listRecordings, resetRecordingStoreConnection, updateRecording,
} from '../../ui/audio/recordingStore';
import { processUploads } from '../../ui/audio/uploadQueue';
import type { FetchLike } from '../../ui/audio/audioApi';

/** An in-memory server speaking the same upload protocol as plugins/notes/audioRoutes.ts. */
class FakeServer {
  sessions = new Map<string, { bytes: number; sha: string; data: Buffer; done: boolean }>();
  attached = new Map<string, string>();
  noteExists = true;
  /** Fail the Nth chunk request (1-based) with a network error. */
  dropChunk: number | null = null;
  corruptNext = false;
  chunkRequests: number[] = []; // offsets seen
  private n = 0;
  private chunkCount = 0;

  fetch: FetchLike = async (input, init) => {
    const url = String(input).replace('/api/v1/notes', '');
    const method = init?.method ?? 'GET';
    const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (method === 'POST' && url === '/audio/uploads') {
      const b = JSON.parse(String(init!.body));
      const id = `srv-${++this.n}`;
      this.sessions.set(id, { bytes: b.bytes, sha: b.sha256, data: Buffer.alloc(0), done: false });
      return reply(201, { id, offset: 0 });
    }
    let m = /^\/audio\/uploads\/([^/?]+)(?:\?offset=(\d+))?$/.exec(url);
    if (m) {
      const s = this.sessions.get(m[1]);
      if (!s) return reply(404, { error: 'Upload not found' });
      if (method === 'GET') return reply(200, { id: m[1], offset: s.done ? s.bytes : s.data.length, bytes: s.bytes, status: s.done ? 'pending' : 'uploading' });
      const offset = Number(m[2]);
      this.chunkRequests.push(offset);
      this.chunkCount += 1;
      if (this.dropChunk === this.chunkCount) throw new TypeError('network down');
      if (offset !== s.data.length) return reply(409, { error: 'Offset mismatch', offset: s.data.length });
      let chunk = Buffer.from(await (init!.body as Blob).arrayBuffer());
      if (this.corruptNext) { chunk = Buffer.from(chunk); chunk[0] ^= 0xff; this.corruptNext = false; }
      s.data = Buffer.concat([s.data, chunk]);
      return reply(200, { offset: s.data.length });
    }
    m = /^\/audio\/uploads\/([^/]+)\/complete$/.exec(url);
    if (m) {
      const s = this.sessions.get(m[1])!;
      if (s.done) return reply(200, { id: m[1], status: 'pending' });
      if (s.data.length !== s.bytes) return reply(409, { error: 'Upload incomplete', offset: s.data.length });
      if (createHash('sha256').update(s.data).digest('hex') !== s.sha) { s.data = Buffer.alloc(0); return reply(422, { error: 'Checksum mismatch', offset: 0 }); }
      s.done = true;
      return reply(200, { id: m[1], status: 'pending' });
    }
    m = /^\/audio\/([^/]+)\/attach$/.exec(url);
    if (m) {
      if (!this.noteExists) return reply(404, { error: 'Audio or note not found' });
      this.attached.set(m[1], JSON.parse(String(init!.body)).note_id);
      return reply(200, { id: m[1] });
    }
    return reply(500, { error: `unexpected ${method} ${url}` });
  };
}

const wipe = async () => {
  resetRecordingStoreConnection();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
};

async function stored(userId: string, data: Buffer, chunkSize = 1000, extra: Record<string, unknown> = {}) {
  const rec = await createRecording({ userId, mime: 'audio/webm', filename: 'r.webm', deviceLabel: null, source: 'recorded' });
  for (let i = 0, seq = 0; i < data.length; i += chunkSize, seq++) {
    await appendChunk(rec.id, seq, new Blob([data.subarray(i, i + chunkSize)]), seq * 1000);
  }
  await updateRecording(rec.id, { state: 'stopped', ...extra });
  return rec.id;
}

beforeEach(wipe);

describe('upload queue', () => {
  it('uploads a stored recording, verifies it, then frees the local copy', async () => {
    const server = new FakeServer();
    const data = randomBytes(5000);
    const id = await stored('u1', data);
    const result = await processUploads('u1', { fetchImpl: server.fetch, chunkBytes: 2048 });
    expect(result).toEqual({ uploaded: 1, failed: 0 });
    const [session] = [...server.sessions.values()];
    expect(session.done).toBe(true);
    expect(Buffer.compare(session.data, data)).toBe(0);
    const meta = (await getRecording(id))!;
    expect(meta.state).toBe('uploaded');
    expect(meta.serverId).toBe('srv-1');
    expect((await assembleBlob(meta)).size).toBe(0);
  });

  it('keeps the audio when the network drops mid-upload and resumes from the server’s offset', async () => {
    const server = new FakeServer();
    const data = randomBytes(5000);
    const id = await stored('u1', data);
    server.dropChunk = 2; // the second chunk request dies
    const first = await processUploads('u1', { fetchImpl: server.fetch, chunkBytes: 2000 });
    expect(first).toEqual({ uploaded: 0, failed: 1 });
    let meta = (await getRecording(id))!;
    expect(meta.state).toBe('uploading'); // never deleted
    expect((await assembleBlob(meta)).size).toBe(5000); // local audio intact
    expect(meta.error).toContain('network down');

    server.chunkRequests = [];
    const second = await processUploads('u1', { fetchImpl: server.fetch, chunkBytes: 2000 });
    expect(second).toEqual({ uploaded: 1, failed: 0 });
    expect(server.chunkRequests).toEqual([2000, 4000]); // resumed, not restarted from 0
    expect(Buffer.compare([...server.sessions.values()][0].data, data)).toBe(0);
    meta = (await getRecording(id))!;
    expect(meta.state).toBe('uploaded');
  });

  it('resends from zero when the server reports a checksum mismatch', async () => {
    const server = new FakeServer();
    const data = randomBytes(3000);
    await stored('u1', data);
    server.corruptNext = true;
    const result = await processUploads('u1', { fetchImpl: server.fetch, chunkBytes: 4000 });
    expect(result.uploaded).toBe(1);
    expect(Buffer.compare([...server.sessions.values()][0].data, data)).toBe(0);
    expect(server.chunkRequests).toEqual([0, 0]);
  });

  it('starts a new session when the server forgot the old one', async () => {
    const server = new FakeServer();
    const data = randomBytes(2500);
    const id = await stored('u1', data, 1000, { serverId: 'gone', state: 'uploading' });
    expect((await processUploads('u1', { fetchImpl: server.fetch })).uploaded).toBe(1);
    expect((await getRecording(id))!.serverId).toBe('srv-1');
  });

  it('attaches to the note chosen before the upload finished, then forgets the recording', async () => {
    const server = new FakeServer();
    const id = await stored('u1', randomBytes(1500), 1000, { noteId: 'note-9' });
    await processUploads('u1', { fetchImpl: server.fetch });
    expect(server.attached.get('srv-1')).toBe('note-9');
    expect(await getRecording(id)).toBeNull();
  });

  it('keeps the uploaded record (not the audio) if the note was deleted meanwhile', async () => {
    const server = new FakeServer();
    server.noteExists = false;
    const id = await stored('u1', randomBytes(1500), 1000, { noteId: 'note-9' });
    await processUploads('u1', { fetchImpl: server.fetch });
    const meta = (await getRecording(id))!;
    expect(meta).toMatchObject({ state: 'uploaded', noteId: null });
    expect(meta.error).toContain('no longer exists');
  });

  it('retries a failed attach on the next pass', async () => {
    const server = new FakeServer();
    const realFetch = server.fetch;
    let failAttach = true;
    const flaky: FetchLike = async (input, init) => {
      if (String(input).endsWith('/attach') && failAttach) throw new TypeError('offline');
      return realFetch(input, init);
    };
    const id = await stored('u1', randomBytes(1500), 1000, { noteId: 'note-9' });
    expect((await processUploads('u1', { fetchImpl: flaky })).failed).toBe(1);
    expect((await getRecording(id))!.state).toBe('uploaded'); // audio is safe on the server
    failAttach = false;
    await processUploads('u1', { fetchImpl: flaky });
    expect(server.attached.get('srv-1')).toBe('note-9');
    expect(await getRecording(id)).toBeNull();
  });

  it('only touches the signed-in user’s recordings and skips ones still being recorded', async () => {
    const server = new FakeServer();
    await stored('u1', randomBytes(1000));
    await stored('u2', randomBytes(1000));
    const live = await createRecording({ userId: 'u1', mime: 'audio/webm', filename: 'live.webm', deviceLabel: null, source: 'recorded' });
    await appendChunk(live.id, 0, new Blob([randomBytes(100)]), 1000);
    const result = await processUploads('u1', { fetchImpl: server.fetch });
    expect(result.uploaded).toBe(1);
    expect(server.sessions.size).toBe(1);
    expect((await listRecordings('u2'))[0].state).toBe('stopped');
    expect((await getRecording(live.id))!.state).toBe('recording');
  });

  it('never discards audio the server rejected outright', async () => {
    const reject: FetchLike = async () => new Response(JSON.stringify({ error: 'Unsupported audio type' }), { status: 400 });
    const id = await stored('u1', randomBytes(1000));
    const result = await processUploads('u1', { fetchImpl: reject });
    expect(result.failed).toBe(1);
    const meta = (await getRecording(id))!;
    expect(meta.state).not.toBe('uploaded');
    expect((await assembleBlob(meta)).size).toBe(1000);
    expect(meta.error).toContain('Unsupported');
  });
});
