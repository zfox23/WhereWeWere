import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NoteRecorder, audioConstraints, pickMimeType, TIMESLICE_MS, AUDIO_BITS_PER_SECOND, type RecorderDeps } from '../../ui/audio/recorder';
import * as store from '../../ui/audio/recordingStore';
import { resolveInput } from '../../ui/audio/audioInput';

class FakeTrack extends EventTarget {
  readyState = 'live';
  stop = vi.fn(() => { this.readyState = 'ended'; });
}
class FakeStream {
  track = new FakeTrack();
  getAudioTracks() { return [this.track]; }
  getTracks() { return [this.track]; }
}
let lastRecorder: FakeRecorder;
class FakeRecorder {
  static isTypeSupported = (m: string) => m === 'audio/webm;codecs=opus';
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: ((e?: unknown) => void) | null = null;
  onerror: (() => void) | null = null;
  options: unknown; timeslice = 0;
  constructor(public stream: FakeStream, options: unknown) { this.options = options; lastRecorder = this; }
  start(timeslice: number) { this.state = 'recording'; this.timeslice = timeslice; }
  pause() { this.state = 'paused'; }
  resume() { this.state = 'recording'; }
  stop() {
    this.ondataavailable?.({ data: new Blob([new Uint8Array([9])]) }); // final chunk, as real recorders do
    this.state = 'inactive';
    queueMicrotask(() => this.onstop?.());
  }
  /** Emit a chunk like the real timeslice would. */
  emit(...bytes: number[]) { this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)]) }); }
}

let clock = 1_000_000;
const settle = () => new Promise((r) => setTimeout(r, 20));

function deps(overrides: Partial<RecorderDeps> = {}): RecorderDeps {
  return {
    getUserMedia: vi.fn(async () => new FakeStream() as unknown as MediaStream),
    MediaRecorderCtor: FakeRecorder as unknown as typeof MediaRecorder,
    now: () => clock,
    ...overrides,
  };
}

beforeEach(async () => {
  clock = 1_000_000;
  store.resetRecordingStoreConnection();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(store.DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
});

const opts = { userId: 'u1', deviceId: 'mic-1', deviceLabel: 'USB Mic' };

describe('NoteRecorder', () => {
  it('asks for unprocessed 48 kHz audio and encodes Opus at 256 kbps with 1 s chunks', async () => {
    const d = deps();
    const rec = new NoteRecorder(opts, {}, d);
    await rec.start();
    expect(d.getUserMedia).toHaveBeenCalledWith({
      audio: { deviceId: { exact: 'mic-1' }, echoCancellation: false, noiseSuppression: false, autoGainControl: false, sampleRate: { ideal: 48000 } },
    });
    expect(lastRecorder.options).toEqual({ mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: AUDIO_BITS_PER_SECOND });
    expect(lastRecorder.timeslice).toBe(TIMESLICE_MS);
    await rec.stop();
  });

  it('writes every chunk to storage as it arrives, in order, before stop', async () => {
    const rec = new NoteRecorder(opts, {}, deps());
    const meta = await rec.start();
    lastRecorder.emit(1, 2);
    lastRecorder.emit(3);
    await settle();
    // No stop yet: this is exactly what a crash would leave behind.
    const mid = (await store.getRecording(meta.id))!;
    expect(mid).toMatchObject({ state: 'recording', chunkCount: 2, bytes: 3 });
    expect(Array.from(new Uint8Array(await (await store.assembleBlob(mid)).arrayBuffer()))).toEqual([1, 2, 3]);
  });

  it('stop() waits for the final chunk and marks the recording stopped with its duration', async () => {
    const rec = new NoteRecorder(opts, {}, deps());
    const meta = await rec.start();
    lastRecorder.emit(1);
    clock += 4000;
    const { meta: done, unsaved } = await rec.stop();
    expect(unsaved).toBeNull();
    expect(done).toMatchObject({ id: meta.id, state: 'stopped', durationMs: 4000, chunkCount: 2 });
    expect(rec.currentState).toBe('idle');
  });

  it('excludes paused time from the duration', async () => {
    const rec = new NoteRecorder(opts, {}, deps());
    await rec.start();
    clock += 3000;
    rec.pause();
    clock += 60_000;
    rec.resume();
    clock += 2000;
    expect((await rec.stop()).meta!.durationMs).toBe(5000);
  });

  it('keeps what was captured when the microphone disappears mid-recording', async () => {
    const onInterrupted = vi.fn();
    const rec = new NoteRecorder(opts, { onInterrupted }, deps());
    const meta = await rec.start();
    lastRecorder.emit(1, 2, 3);
    clock += 2500;
    (lastRecorder.stream as FakeStream).track.dispatchEvent(new Event('ended'));
    await settle();
    expect(onInterrupted).toHaveBeenCalledOnce();
    expect(onInterrupted.mock.calls[0][0]).toContain('microphone');
    const saved = (await store.getRecording(meta.id))!;
    expect(saved).toMatchObject({ state: 'stopped', durationMs: 2500 });
    expect(saved.bytes).toBeGreaterThanOrEqual(3);
    expect(rec.currentState).toBe('interrupted');
  });

  it('treats an OS-initiated stop as an interruption that still saves the audio', async () => {
    const onInterrupted = vi.fn();
    const rec = new NoteRecorder(opts, { onInterrupted }, deps());
    const meta = await rec.start();
    lastRecorder.emit(7, 7);
    lastRecorder.state = 'inactive';
    lastRecorder.onstop?.(); // the browser ended it without us asking
    await settle();
    expect(onInterrupted).toHaveBeenCalledOnce();
    expect((await store.getRecording(meta.id))!.state).toBe('stopped');
  });

  it('warns when the microphone is muted and clears the warning when it returns', async () => {
    const onWarning = vi.fn();
    const rec = new NoteRecorder(opts, { onWarning }, deps());
    await rec.start();
    const track = (lastRecorder.stream as FakeStream).track;
    track.dispatchEvent(new Event('mute'));
    expect(onWarning.mock.calls.at(-1)![0]).toContain('silenced');
    track.dispatchEvent(new Event('unmute'));
    expect(onWarning.mock.calls.at(-1)![0]).toBeNull();
    await rec.stop();
  });

  it('retries chunks the store refused, in order, and never drops one', async () => {
    const onWarning = vi.fn();
    const rec = new NoteRecorder(opts, { onWarning }, deps());
    const meta = await rec.start();
    const real = store.appendChunk;
    let failing = true;
    const spy = vi.spyOn(store, 'appendChunk').mockImplementation(async (...args) => {
      if (failing) throw new Error('QuotaExceededError');
      return real(...args);
    });
    lastRecorder.emit(1);
    lastRecorder.emit(2);
    await settle();
    expect(onWarning.mock.calls.some(([m]) => typeof m === 'string' && m.includes("can't store"))).toBe(true);
    failing = false;
    lastRecorder.emit(3);
    await settle();
    spy.mockRestore();
    const { meta: done } = await rec.stop();
    expect(done).not.toBeNull();
    const blob = await store.assembleBlob((await store.getRecording(meta.id))!);
    expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual([1, 2, 3, 9]); // in order, plus the final chunk
    expect(onWarning.mock.calls.at(-1)![0]).toBeNull();
  });

  it('hands back the audio from memory if storage never recovers', async () => {
    const rec = new NoteRecorder(opts, {}, deps());
    await rec.start();
    const spy = vi.spyOn(store, 'appendChunk').mockRejectedValue(new Error('QuotaExceededError'));
    lastRecorder.emit(1, 2);
    const { meta, unsaved } = await rec.stop();
    spy.mockRestore();
    expect(meta).toBeNull();
    expect(unsaved).not.toBeNull();
    expect(unsaved!.size).toBeGreaterThanOrEqual(2);
  });

  it('refuses to record when local storage is unavailable (no unprotected recordings)', async () => {
    const spy = vi.spyOn(store, 'createRecording').mockRejectedValue(new Error('IndexedDB is not available'));
    const d = deps();
    const rec = new NoteRecorder(opts, {}, d);
    await expect(rec.start()).rejects.toThrow(/can't be saved on this device/);
    spy.mockRestore();
    expect(rec.currentState).toBe('idle');
  });

  it('falls back to the default microphone when the remembered one is gone', async () => {
    const onWarning = vi.fn();
    const getUserMedia = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'OverconstrainedError' }))
      .mockResolvedValueOnce(new FakeStream());
    const rec = new NoteRecorder(opts, { onWarning }, deps({ getUserMedia: getUserMedia as never }));
    await rec.start();
    expect(getUserMedia.mock.calls[1][0]).toEqual(audioConstraints(''));
    expect(onWarning.mock.calls[0][0]).toContain('default one');
    await rec.stop();
  });

  it('reports a blocked microphone clearly and leaves nothing behind', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
    const rec = new NoteRecorder(opts, {}, deps({ getUserMedia: getUserMedia as never }));
    await expect(rec.start()).rejects.toThrow(/blocked/);
    expect(await store.listRecordings('u1')).toHaveLength(0);
  });

  it('releases the microphone, meter and wake lock when it stops', async () => {
    const release = vi.fn();
    const stopMeter = vi.fn();
    const rec = new NoteRecorder(opts, {}, deps({
      createMeter: () => stopMeter,
      acquireWakeLock: async () => release,
    }));
    await rec.start();
    await settle();
    await rec.stop();
    expect(stopMeter).toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
    expect((lastRecorder.stream as FakeStream).track.stop).toHaveBeenCalled();
  });
});

describe('recorder helpers', () => {
  it('prefers Opus in WebM, falling back to AAC in MP4 on Safari', () => {
    expect(pickMimeType(() => true)).toBe('audio/webm;codecs=opus');
    expect(pickMimeType((m) => m.startsWith('audio/mp4'))).toBe('audio/mp4;codecs=mp4a.40.2');
    expect(pickMimeType(() => false)).toBeNull();
  });

  it('resolves the remembered microphone by id, then by label, else the default', () => {
    const devices = [{ deviceId: 'a', label: 'Built-in' }, { deviceId: 'b2', label: 'USB Mic' }];
    expect(resolveInput(devices, { deviceId: 'a', label: 'Built-in' })).toBe('a');
    expect(resolveInput(devices, { deviceId: 'old', label: 'USB Mic' })).toBe('b2');
    expect(resolveInput(devices, { deviceId: 'old', label: 'Gone' })).toBe('');
    expect(resolveInput(devices, null)).toBe('');
  });
});
