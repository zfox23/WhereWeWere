import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NoteRecorder, audioConstraints, bitrateFor, captureAttempts, pickMimeType, SIGNAL_TIMEOUT_MS, type SignalResult, TIMESLICE_MS, AUDIO_BITS_PER_SECOND, MONO_BITS_PER_SECOND, type RecorderDeps } from '../../ui/audio/recorder';
import * as store from '../../ui/audio/recordingStore';
import { resolveInput } from '../../ui/audio/audioInput';
import { DEFAULT_PROCESSING } from '../../ui/audio/audioSettings';

class FakeTrack extends EventTarget {
  readyState = 'live';
  /** What the browser reports it actually delivered. */
  settings: MediaTrackSettings = {};
  getSettings() { return this.settings; }
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
      audio: { deviceId: { exact: 'mic-1' }, channelCount: { ideal: 2 }, echoCancellation: false, noiseSuppression: false, autoGainControl: false, sampleRate: { ideal: 48000 } },
    });
    expect(lastRecorder.options).toEqual({ mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: AUDIO_BITS_PER_SECOND });
    expect(lastRecorder.timeslice).toBe(TIMESLICE_MS);
    await rec.stop();
  });

  it('records mono when asked: requests one channel and halves the bitrate (same quality per channel)', async () => {
    const d = deps();
    const rec = new NoteRecorder({ ...opts, channels: 1 }, {}, d);
    await rec.start();
    expect(vi.mocked(d.getUserMedia).mock.calls[0][0]).toEqual(audioConstraints('mic-1', 1));
    expect((vi.mocked(d.getUserMedia).mock.calls[0][0].audio as MediaTrackConstraints).channelCount).toEqual({ ideal: 1 });
    expect(lastRecorder.options).toEqual({ mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: MONO_BITS_PER_SECOND });
    expect(bitrateFor(1)).toBe(128_000);
    expect(bitrateFor(2)).toBe(256_000);
    await rec.stop();
  });

  it('defaults to stereo, which a mono microphone simply stays mono under', async () => {
    const d = deps();
    const rec = new NoteRecorder(opts, {}, d); // no channels given
    await rec.start();
    expect((vi.mocked(d.getUserMedia).mock.calls[0][0].audio as MediaTrackConstraints).channelCount).toEqual({ ideal: 2 });
    await rec.stop();
  });

  it('says so when the microphone cannot give the channel layout that was chosen', async () => {
    const monoMic = new FakeStream();
    monoMic.track.settings = { channelCount: 1 };
    const onWarning = vi.fn();
    const rec = new NoteRecorder({ ...opts, channels: 2 }, { onWarning }, deps({ getUserMedia: vi.fn(async () => monoMic as unknown as MediaStream) }));
    await rec.start();
    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining('only records in mono'));
    await rec.stop();

    const stereoMic = new FakeStream();
    stereoMic.track.settings = { channelCount: 2 };
    const onWarning2 = vi.fn();
    const rec2 = new NoteRecorder({ ...opts, channels: 1 }, { onWarning: onWarning2 }, deps({ getUserMedia: vi.fn(async () => stereoMic as unknown as MediaStream) }));
    await rec2.start();
    expect(onWarning2).toHaveBeenCalledWith(expect.stringContaining('would not mix it down to mono'));
    await rec2.stop();
  });

  it('stays quiet when the layout matches, or the browser does not report one', async () => {
    const match = new FakeStream();
    match.track.settings = { channelCount: 2 };
    const onWarning = vi.fn();
    const rec = new NoteRecorder(opts, { onWarning }, deps({ getUserMedia: vi.fn(async () => match as unknown as MediaStream) }));
    await rec.start();
    await rec.stop();
    const onWarning2 = vi.fn();
    const rec2 = new NoteRecorder(opts, { onWarning: onWarning2 }, deps()); // settings {} : unknown
    await rec2.start();
    await rec2.stop();
    expect(onWarning).not.toHaveBeenCalled();
    expect(onWarning2).not.toHaveBeenCalled();
  });

  it('asks for exactly the advanced settings it was given', async () => {
    const d = deps();
    const processing = { ...DEFAULT_PROCESSING, echoCancellation: true, noiseSuppression: true, voiceIsolation: true, sampleRate: 16000, sampleSize: 24 };
    const rec = new NoteRecorder({ ...opts, processing }, {}, d);
    await rec.start();
    expect(vi.mocked(d.getUserMedia).mock.calls[0][0]).toEqual({
      audio: {
        deviceId: { exact: 'mic-1' }, channelCount: { ideal: 2 },
        echoCancellation: true, noiseSuppression: true, autoGainControl: false, voiceIsolation: true,
        sampleRate: { ideal: 16000 }, sampleSize: { ideal: 24 },
      },
    });
    await rec.stop();
  });

  it('reports what the browser really applied, and warns about settings it overrode (one message, with any other notes)', async () => {
    const stream = new FakeStream();
    stream.track.settings = { echoCancellation: true, noiseSuppression: false, autoGainControl: false, sampleRate: 44100, channelCount: 1 };
    const onSettings = vi.fn();
    const onWarning = vi.fn();
    const rec = new NoteRecorder({ ...opts, channels: 2 }, { onSettings, onWarning }, deps({ getUserMedia: vi.fn(async () => stream as unknown as MediaStream) }));
    await rec.start();
    expect(onSettings).toHaveBeenCalledWith(expect.objectContaining({ sampleRate: 44100, echoCancellation: true }));
    expect(onWarning).toHaveBeenCalledTimes(1);
    const message = onWarning.mock.calls[0][0] as string;
    expect(message).toContain('only records in mono');
    expect(message).toContain('Echo cancellation is on (you chose off)');
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

describe('a microphone that goes silent with the chosen settings (Firefox on Android)', () => {
  const streams: FakeStream[] = [];
  const dep = (verdicts: SignalResult[], extra: Partial<RecorderDeps> = {}) => {
    streams.length = 0;
    let n = 0;
    const detectSignal = vi.fn(async () => verdicts[n++] ?? 'signal');
    const getUserMedia = vi.fn(async () => {
      const stream = new FakeStream();
      streams.push(stream);
      return stream as unknown as MediaStream;
    });
    return { d: deps({ getUserMedia, detectSignal, ...extra }), detectSignal, getUserMedia };
  };
  const audio = (getUserMedia: ReturnType<typeof vi.fn>, call: number) =>
    (getUserMedia.mock.calls[call][0] as MediaStreamConstraints).audio as Record<string, unknown>;

  it('records normally, without retrying, when sound arrives at once', async () => {
    const { d, detectSignal, getUserMedia } = dep(['signal']);
    const onRecovered = vi.fn();
    const rec = new NoteRecorder(opts, { onRecovered }, d);
    await rec.start();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(detectSignal).toHaveBeenCalledWith(expect.anything(), SIGNAL_TIMEOUT_MS);
    expect(onRecovered).not.toHaveBeenCalled();
    await rec.stop();
  });

  it('first retries without the channel, sample-rate and sample-size hints, keeping processing off', async () => {
    const { d, getUserMedia } = dep(['silent', 'signal']);
    const onRecovered = vi.fn();
    const onWarning = vi.fn();
    const rec = new NoteRecorder({ ...opts, deviceId: '' }, { onRecovered, onWarning }, d);
    await rec.start();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(audio(getUserMedia, 0)).toMatchObject({ channelCount: { ideal: 2 }, sampleRate: { ideal: 48000 }, echoCancellation: false });
    expect(audio(getUserMedia, 1)).toEqual({ echoCancellation: false, noiseSuppression: false, autoGainControl: false });
    expect(streams[0].track.stop).toHaveBeenCalled(); // the dead stream is released
    expect(streams[1].track.stop).not.toHaveBeenCalled(); // the working one is the recording
    expect(onRecovered).toHaveBeenCalledWith(expect.objectContaining({
      attempt: expect.objectContaining({ hintsDropped: true, processing: expect.objectContaining({ noiseSuppression: false, echoCancellation: false, sampleRate: null }) }),
    }));
    expect(onWarning.mock.calls[0][0]).toContain("browser's default audio format");
    await rec.stop();
  });

  it('then turns noise suppression on, then echo cancellation, stopping at the first that works', async () => {
    const a = dep(['silent', 'silent', 'signal']);
    const onRecovered = vi.fn();
    await new NoteRecorder({ ...opts, deviceId: '' }, { onRecovered }, a.d).start();
    expect(audio(a.getUserMedia, 2)).toMatchObject({ noiseSuppression: true, echoCancellation: false });
    expect(audio(a.getUserMedia, 2)).not.toHaveProperty('channelCount');
    expect(onRecovered.mock.calls[0][0].label).toBe('with noise suppression turned on');
    expect(a.getUserMedia).toHaveBeenCalledTimes(3);

    const b = dep(['silent', 'silent', 'silent', 'signal']);
    const onRecoveredB = vi.fn();
    await new NoteRecorder({ ...opts, deviceId: '' }, { onRecovered: onRecoveredB }, b.d).start();
    expect(audio(b.getUserMedia, 3)).toMatchObject({ echoCancellation: true, noiseSuppression: false });
    expect(onRecoveredB.mock.calls[0][0].label).toBe('with echo cancellation turned on');
  });

  it('keeps the other settings the user chose while stepping (automatic gain control stays on)', async () => {
    const { d, getUserMedia } = dep(['silent', 'silent', 'signal']);
    await new NoteRecorder({ ...opts, deviceId: '', processing: { ...DEFAULT_PROCESSING, autoGainControl: true } }, {}, d).start();
    expect(audio(getUserMedia, 2)).toMatchObject({ autoGainControl: true, noiseSuppression: true });
  });

  it('still records when every way fails, and says the microphone is silent', async () => {
    const { d, getUserMedia } = dep(['silent', 'silent', 'silent', 'silent']);
    const onWarning = vi.fn();
    const onRecovered = vi.fn();
    const rec = new NoteRecorder({ ...opts, deviceId: '' }, { onWarning, onRecovered }, d);
    const meta = await rec.start();
    expect(getUserMedia).toHaveBeenCalledTimes(4); // bounded
    expect(meta.id).toBeTruthy();
    expect(onWarning.mock.calls[0][0]).toContain('No sound is coming from this microphone');
    expect(onRecovered).not.toHaveBeenCalled(); // nothing worked, so nothing to remember
    expect(rec.currentState).toBe('recording');
    await rec.stop();
  });

  it('does not judge a stream whose silence could be legitimate noise gating (echo cancellation or noise suppression on)', async () => {
    for (const processing of [{ ...DEFAULT_PROCESSING, echoCancellation: true }, { ...DEFAULT_PROCESSING, noiseSuppression: true }]) {
      const { d, detectSignal, getUserMedia } = dep(['silent']);
      const rec = new NoteRecorder(opts, {}, d);
      await new NoteRecorder({ ...opts, processing }, {}, d).start();
      expect(detectSignal).not.toHaveBeenCalled();
      expect(getUserMedia).toHaveBeenCalledTimes(1);
      void rec;
    }
  });

  it('never fails a recording just because the browser could not measure the signal', async () => {
    const { d, getUserMedia } = dep(['unknown']);
    const onRecovered = vi.fn();
    await new NoteRecorder(opts, { onRecovered }, d).start();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(onRecovered).not.toHaveBeenCalled();
  });

  it('copes with the remembered microphone being gone partway through the attempts', async () => {
    streams.length = 0;
    let call = 0;
    const getUserMedia = vi.fn(async (c: MediaStreamConstraints) => {
      call += 1;
      const a = c.audio as Record<string, unknown>;
      if (a.deviceId) throw Object.assign(new Error('x'), { name: 'OverconstrainedError' });
      const s = new FakeStream();
      streams.push(s);
      return s as unknown as MediaStream;
    });
    const onWarning = vi.fn();
    const verdicts: SignalResult[] = ['silent', 'signal'];
    let n = 0;
    const d = deps({ getUserMedia: getUserMedia as never, detectSignal: async () => verdicts[n++] ?? 'signal' });
    await new NoteRecorder(opts, { onWarning }, d).start();
    expect(call).toBeGreaterThanOrEqual(3);
    const msg = onWarning.mock.calls[0][0] as string;
    expect(msg.match(/was not found/g)).toHaveLength(1); // said once, not per attempt
  });

  it('Auto leaves the channel count to the browser, and sizes the encoder from what was delivered', async () => {
    const mono = new FakeStream();
    mono.track.settings = { channelCount: 1 };
    const d = deps({ getUserMedia: vi.fn(async () => mono as unknown as MediaStream) });
    const onWarning = vi.fn();
    await new NoteRecorder({ ...opts, deviceId: '', channels: 'auto' }, { onWarning }, d).start();
    expect(vi.mocked(d.getUserMedia).mock.calls[0][0].audio).not.toHaveProperty('channelCount');
    expect(lastRecorder.options).toMatchObject({ audioBitsPerSecond: MONO_BITS_PER_SECOND });
    expect(onWarning).not.toHaveBeenCalled(); // nothing was asked, so nothing was missed
  });
});

describe('captureAttempts and audioConstraints', () => {
  it('only plans a ladder when both echo cancellation and noise suppression are off', () => {
    expect(captureAttempts(DEFAULT_PROCESSING).map((a) => [a.hintsDropped, a.processing.noiseSuppression, a.processing.echoCancellation]))
      .toEqual([[false, false, false], [true, false, false], [true, true, false], [true, false, true]]);
    expect(captureAttempts({ ...DEFAULT_PROCESSING, noiseSuppression: true })).toHaveLength(1);
    expect(captureAttempts({ ...DEFAULT_PROCESSING, echoCancellation: true })).toHaveLength(1);
  });

  it('can leave out the format hints, or the channel count alone', () => {
    expect(audioConstraints('', 2, DEFAULT_PROCESSING, false).audio).toEqual({ echoCancellation: false, noiseSuppression: false, autoGainControl: false });
    expect(audioConstraints('', 'auto').audio).toEqual({ echoCancellation: false, noiseSuppression: false, autoGainControl: false, sampleRate: { ideal: 48000 } });
    expect(audioConstraints('mic', 1, DEFAULT_PROCESSING, false).audio).toMatchObject({ deviceId: { exact: 'mic' } });
  });
});
