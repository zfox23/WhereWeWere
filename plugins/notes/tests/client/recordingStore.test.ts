import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DB_NAME, ORPHAN_AFTER_MS, appendChunk, assembleBlob, countUnsent, createRecording, deleteRecording,
  getRecording, isOrphaned, listRecordings, markUploaded, recoverRecording, resetRecordingStoreConnection, updateRecording,
} from '../../ui/audio/recordingStore';

const bytes = (b: Blob) => b.arrayBuffer().then((a) => Array.from(new Uint8Array(a)));

beforeEach(async () => {
  resetRecordingStoreConnection();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
});

async function record(userId = 'u1', chunks = [[1, 2], [3], [4, 5, 6]]) {
  const rec = await createRecording({ userId, mime: 'audio/webm', filename: 'r.webm', deviceLabel: 'Mic', source: 'recorded' });
  for (const [i, c] of chunks.entries()) await appendChunk(rec.id, i, new Blob([new Uint8Array(c)]), (i + 1) * 1000);
  return rec;
}

describe('recordingStore', () => {
  it('stores chunks as they arrive and reassembles them in order', async () => {
    const rec = await record();
    const meta = (await getRecording(rec.id))!;
    expect(meta).toMatchObject({ state: 'recording', chunkCount: 3, bytes: 6, durationMs: 3000 });
    expect(await bytes(await assembleBlob(meta))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('survives a crash: an interrupted recording is detected as orphaned and recovered with its audio', async () => {
    const rec = await record();
    // "Crash": no stop, no finalize. After the heartbeat goes stale it's orphaned.
    const meta = (await getRecording(rec.id))!;
    expect(isOrphaned(meta, meta.updatedAt + 1000)).toBe(false); // a live tab in another window
    expect(isOrphaned(meta, meta.updatedAt + ORPHAN_AFTER_MS + 1)).toBe(true);

    // Simulate the next page load: a fresh connection to the same database.
    resetRecordingStoreConnection();
    const recovered = (await recoverRecording(rec.id))!;
    expect(recovered.state).toBe('stopped');
    expect(recovered.durationMs).toBeGreaterThanOrEqual(3000);
    expect(await bytes(await assembleBlob(recovered))).toEqual([1, 2, 3, 4, 5, 6]);
    expect(await countUnsent('u1')).toBe(1);
  });

  it('discards a recording that crashed before a single chunk was stored', async () => {
    const rec = await createRecording({ userId: 'u1', mime: 'audio/webm', filename: 'r.webm', deviceLabel: null, source: 'recorded' });
    expect(await recoverRecording(rec.id)).toBeNull();
    expect(await getRecording(rec.id)).toBeNull();
  });

  it('keeps local audio until the server confirms, then frees it but keeps the record', async () => {
    const rec = await record();
    await updateRecording(rec.id, { state: 'stopped' });
    expect(await countUnsent('u1')).toBe(1);
    await markUploaded(rec.id);
    expect(await countUnsent('u1')).toBe(0);
    const meta = (await getRecording(rec.id))!;
    expect(meta.state).toBe('uploaded');
    expect((await assembleBlob(meta)).size).toBe(0); // chunks are gone
  });

  it('scopes recordings to the user', async () => {
    await record('u1');
    await record('u2');
    expect(await listRecordings('u1')).toHaveLength(1);
    expect(await listRecordings('u2')).toHaveLength(1);
    expect(await countUnsent('u3')).toBe(0);
  });

  it('deletes a recording together with its chunks', async () => {
    const rec = await record();
    await deleteRecording(rec.id);
    expect(await getRecording(rec.id)).toBeNull();
    expect((await assembleBlob(rec)).size).toBe(0);
  });

  it('refuses to store a chunk for an unknown recording', async () => {
    await expect(appendChunk('nope', 0, new Blob(['x']), 1)).rejects.toThrow();
  });
});
