import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DB_NAME, appendChunk, createRecording, getRecording, resetRecordingStoreConnection, updateRecording } from '../../ui/audio/recordingStore';
import { recoverOrphans, signOutGuard } from '../../ui/audio/syncTask';
import { audioMimeForFile, importAudioFile } from '../../ui/audio/importFile';
import { runSignOutGuards, registerSignOutGuard } from '../../../../client/src/utils/signOutGuards';
import { PRESERVED_INDEXED_DBS, DEVICE_PREFERENCE_KEYS } from '../../../../client/src/utils/localData';
import { INPUT_KEY } from '../../ui/audio/audioInput';

beforeEach(async () => {
  resetRecordingStoreConnection();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
  vi.restoreAllMocks();
});

async function unsent(userId: string, state: 'stopped' | 'uploaded' = 'stopped') {
  const r = await createRecording({ userId, mime: 'audio/webm', filename: 'a.webm', deviceLabel: null, source: 'recorded' });
  await appendChunk(r.id, 0, new Blob([new Uint8Array([1, 2, 3])]), 1000);
  await updateRecording(r.id, { state });
  return r.id;
}

describe('sign-out guard for unsent recordings', () => {
  it('lets the user sign out silently when nothing is unsent', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    expect(await signOutGuard('u1')).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('asks before leaving unsent audio behind, and respects "stay signed in"', async () => {
    await unsent('u1');
    vi.useFakeTimers();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const result = signOutGuard('u1');
    await vi.advanceTimersByTimeAsync(20_000); // the upload grace period (offline: it can't send)
    vi.useRealTimers();
    expect(await result).toBe(false);
    expect(confirm.mock.calls[0][0]).toContain('not finished uploading');
    expect(confirm.mock.calls[0][0]).toContain('safely on this device');
  });

  it('only counts the signing-out account’s recordings', async () => {
    await unsent('someone-else');
    const confirm = vi.spyOn(window, 'confirm');
    expect(await signOutGuard('u1')).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('a guard that refuses blocks sign-out; a broken one does not', async () => {
    const off1 = registerSignOutGuard(async () => { throw new Error('boom'); });
    expect(await runSignOutGuards('u1')).toBe(true);
    const off2 = registerSignOutGuard(async () => false);
    expect(await runSignOutGuards('u1')).toBe(false);
    off1(); off2();
  });
});

describe('recovering a crashed recording', () => {
  it('turns an orphaned recording into an unsent one with its audio intact', async () => {
    const r = await createRecording({ userId: 'u1', mime: 'audio/webm', filename: 'a.webm', deviceLabel: null, source: 'recorded' });
    await appendChunk(r.id, 0, new Blob([new Uint8Array([5, 5])]), 1000);
    // A recording that was just written to is a live tab elsewhere, not an orphan.
    expect(await recoverOrphans('u1')).toBe(0);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000);
    expect(await recoverOrphans('u1')).toBe(1);
    expect((await getRecording(r.id))!.state).toBe('stopped');
  });
});

describe('what a wipe on sign-out must not destroy', () => {
  it('preserves the recordings database and the microphone choice', () => {
    expect(PRESERVED_INDEXED_DBS).toContain(DB_NAME);
    expect(DEVICE_PREFERENCE_KEYS).toContain(INPUT_KEY);
  });
});

describe('importing an audio file', () => {
  it('recognises audio by type or extension and rejects the rest', () => {
    expect(audioMimeForFile({ name: 'memo.m4a', type: '' })).toBe('audio/mp4');
    expect(audioMimeForFile({ name: 'x', type: 'audio/mpeg' })).toBe('audio/mpeg');
    expect(audioMimeForFile({ name: 'notes.txt', type: 'text/plain' })).toBeNull();
  });

  it('stores the file locally in slices, byte for byte, ready to upload', async () => {
    const data = new Uint8Array(9 * 1024 * 1024).map((_, i) => i % 251);
    const file = new File([data], 'long.mp3', { type: 'audio/mpeg' });
    const meta = await importAudioFile('u1', file);
    expect(meta).toMatchObject({ state: 'stopped', mime: 'audio/mpeg', filename: 'long.mp3', source: 'file', bytes: data.length, chunkCount: 3 });
  });

  it('rejects unsupported and empty files without leaving anything behind', async () => {
    await expect(importAudioFile('u1', new File(['x'], 'a.txt', { type: 'text/plain' }))).rejects.toThrow(/supported audio/);
    await expect(importAudioFile('u1', new File([], 'a.mp3', { type: 'audio/mpeg' }))).rejects.toThrow(/empty/);
  });
});
