/**
 * Records microphone audio at the best quality the browser offers and writes
 * every chunk to IndexedDB the moment it exists (see recordingStore.ts), so
 * the recording survives a crash, a closed tab or a flat battery.
 *
 * Quality: the browser's voice processing (echo cancellation, noise
 * suppression, auto gain) is switched OFF, 48 kHz is requested, the device's
 * own channel layout is kept, and Opus is encoded at 256 kbps (Safari falls
 * back to AAC in MP4 at its highest bitrate). The stored file is the encoder's
 * output, byte for byte, which is what the server keeps.
 *
 * Framework-free and dependency-injected so the failure paths are testable.
 */

import {
  appendChunk, createRecording, updateRecording, type RecordingMeta,
} from './recordingStore';
import { micErrorMessage } from './audioInput';
import { DEFAULT_PROCESSING, appliedMismatches, processingConstraints, type AudioProcessing } from './audioSettings';

export type Channels = 1 | 2;

/** Opus bitrate: 256 kbps for stereo, and half that for mono, which is the same 128 kbps per channel. */
export const AUDIO_BITS_PER_SECOND = 256_000;
export const MONO_BITS_PER_SECOND = 128_000;

export function bitrateFor(channels: Channels): number {
  return channels === 1 ? MONO_BITS_PER_SECOND : AUDIO_BITS_PER_SECOND;
}
export const TIMESLICE_MS = 1000;

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
];

export function pickMimeType(isSupported: (mime: string) => boolean): string | null {
  return MIME_CANDIDATES.find((m) => isSupported(m)) ?? null;
}

export function extensionForMime(mime: string): string {
  const base = mime.split(';')[0].trim().toLowerCase();
  if (base === 'audio/webm') return '.webm';
  if (base === 'audio/ogg') return '.ogg';
  if (base === 'audio/mp4' || base === 'audio/x-m4a') return '.m4a';
  if (base === 'audio/mpeg') return '.mp3';
  if (base === 'audio/wav' || base === 'audio/x-wav') return '.wav';
  if (base === 'audio/flac') return '.flac';
  return '.audio';
}

/**
 * `channels` is a request, not a guarantee: a microphone that only has one
 * channel stays mono whatever is asked (the recorder reports that).
 */
export function audioConstraints(deviceId: string, channels: Channels = 2, processing: AudioProcessing = DEFAULT_PROCESSING): MediaStreamConstraints {
  return {
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      channelCount: { ideal: channels },
      ...processingConstraints(processing),
    },
  };
}

export type RecorderState = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping' | 'interrupted';

export interface RecorderEvents {
  onState?: (state: RecorderState) => void;
  /** Wall-clock recording time (pauses excluded), roughly every 250 ms. */
  onTick?: (elapsedMs: number) => void;
  /** Input level 0..1, for a meter. */
  onLevel?: (level: number) => void;
  /** What the browser actually applied to the microphone (getSettings), once the stream is open. */
  onSettings?: (applied: MediaTrackSettings) => void;
  /** Something the user should know while the recording continues. */
  onWarning?: (message: string | null) => void;
  /** The recording ended without the user stopping it; what was captured is saved. */
  onInterrupted?: (reason: string, meta: RecordingMeta | null) => void;
}

export interface RecorderDeps {
  getUserMedia: (c: MediaStreamConstraints) => Promise<MediaStream>;
  MediaRecorderCtor: typeof MediaRecorder;
  now: () => number;
  /** Optional level metering and screen wake lock; absent in tests. */
  createMeter?: (stream: MediaStream, onLevel: (level: number) => void) => () => void;
  acquireWakeLock?: () => Promise<() => void>;
}

export function browserDeps(): RecorderDeps {
  return {
    getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
    MediaRecorderCtor: MediaRecorder,
    now: () => Date.now(),
    createMeter: createAnalyserMeter,
    acquireWakeLock: acquireScreenWakeLock,
  };
}

export interface StopResult {
  meta: RecordingMeta | null;
  /** Chunks that could not be stored locally (storage failure). Hold them so the user can still save the audio. */
  unsaved: Blob | null;
}

export class NoteRecorder {
  private state: RecorderState = 'idle';
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private meta: RecordingMeta | null = null;
  private seq = 0;
  private writes: Promise<void> = Promise.resolve();
  /** Chunks the store refused, oldest first; retried before every later write so order is kept. */
  private unsaved: { seq: number; blob: Blob }[] = [];
  private storageWarned = false;
  private elapsedBefore = 0;
  private resumedAt = 0;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private stopMeter: (() => void) | null = null;
  private releaseWakeLock: (() => void) | null = null;
  private userStopped = false;
  private finishing: Promise<StopResult> | null = null;

  constructor(
    private readonly opts: { userId: string; deviceId: string; deviceLabel: string | null; channels?: Channels; processing?: AudioProcessing },
    private readonly events: RecorderEvents = {},
    private readonly deps: RecorderDeps = browserDeps(),
  ) {}

  get currentState(): RecorderState {
    return this.state;
  }

  get recordingId(): string | null {
    return this.meta?.id ?? null;
  }

  elapsedMs(): number {
    return this.elapsedBefore + (this.state === 'recording' ? this.deps.now() - this.resumedAt : 0);
  }

  private setState(next: RecorderState) {
    this.state = next;
    this.events.onState?.(next);
  }

  async start(): Promise<RecordingMeta> {
    if (this.state !== 'idle' && this.state !== 'interrupted') throw new Error('Already recording');
    const channels: Channels = this.opts.channels === 1 ? 1 : 2;
    const processing = this.opts.processing ?? DEFAULT_PROCESSING;
    const notes: string[] = []; // things to tell the user once, after the stream is open
    this.setState('starting');
    let stream: MediaStream;
    try {
      stream = await this.deps.getUserMedia(audioConstraints(this.opts.deviceId, channels, processing));
    } catch (err) {
      if (this.opts.deviceId && err instanceof Error && err.name === 'OverconstrainedError') {
        // The remembered microphone isn't plugged in: use the default instead of failing.
        try {
          stream = await this.deps.getUserMedia(audioConstraints('', channels, processing));
          notes.push('The selected microphone was not found; recording with the default one.');
        } catch (inner) {
          this.setState('idle');
          throw new Error(micErrorMessage(inner));
        }
      } else {
        this.setState('idle');
        throw new Error(micErrorMessage(err));
      }
    }

    const mime = pickMimeType((m) => this.deps.MediaRecorderCtor.isTypeSupported(m));
    if (mime === null) {
      stream.getTracks().forEach((t) => t.stop());
      this.setState('idle');
      throw new Error('This browser cannot record audio.');
    }

    try {
      this.meta = await createRecording({
        userId: this.opts.userId,
        mime,
        filename: `recording-${new Date(this.deps.now()).toISOString().replace(/[:.]/g, '-')}${extensionForMime(mime)}`,
        deviceLabel: this.opts.deviceLabel,
        source: 'recorded',
      });
    } catch (err) {
      // Without local storage there is no crash safety: refuse rather than record unprotected.
      stream.getTracks().forEach((t) => t.stop());
      this.setState('idle');
      throw new Error(`Recordings can't be saved on this device (${err instanceof Error ? err.message : 'storage unavailable'}).`);
    }

    this.stream = stream;
    this.seq = 0;
    this.unsaved = [];
    this.storageWarned = false;
    this.userStopped = false;
    this.finishing = null;
    this.elapsedBefore = 0;

    const recorder = new this.deps.MediaRecorderCtor(stream, { mimeType: mime, audioBitsPerSecond: bitrateFor(channels) });
    this.recorder = recorder;
    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) this.enqueueWrite(e.data);
    };
    recorder.onerror = () => void this.handleInterruption('The recorder reported an error.');
    recorder.onstop = () => {
      // A stop the user didn't ask for (the browser or OS ended the capture).
      if (!this.userStopped) void this.handleInterruption('The browser stopped the recording.');
    };
    // Say so when the microphone can't do what was asked (e.g. stereo from a mono mic, or processing forced on).
    const applied = stream.getAudioTracks()[0]?.getSettings?.();
    if (applied) this.events.onSettings?.(applied);
    const actual = applied?.channelCount;
    if (typeof actual === 'number' && actual !== channels) {
      notes.push(
        actual === 1
          ? 'This microphone only records in mono, so the recording will be mono.'
          : 'This microphone records in stereo and the browser would not mix it down to mono.',
      );
    }
    const overridden = appliedMismatches(processing, applied);
    if (overridden.length > 0) notes.push(`The browser overrode some audio settings: ${overridden.join('; ')}.`);
    if (notes.length > 0) this.events.onWarning?.(notes.join(' '));
    for (const track of stream.getAudioTracks()) {
      track.addEventListener('ended', () => {
        if (!this.userStopped) void this.handleInterruption('The microphone was disconnected or taken by the system.');
      });
      track.addEventListener('mute', () => this.events.onWarning?.('The microphone is silenced (the screen may have turned off). Audio recorded so far is safe.'));
      track.addEventListener('unmute', () => this.events.onWarning?.(null));
    }

    recorder.start(TIMESLICE_MS);
    this.resumedAt = this.deps.now();
    this.setState('recording');
    this.ticker = setInterval(() => this.events.onTick?.(this.elapsedMs()), 250);
    this.stopMeter = this.deps.createMeter?.(stream, (l) => this.events.onLevel?.(l)) ?? null;
    void this.deps.acquireWakeLock?.().then((release) => {
      if (this.state === 'idle' || this.state === 'stopping') release();
      else this.releaseWakeLock = release;
    }).catch(() => {});
    return this.meta;
  }

  pause(): void {
    if (this.state !== 'recording' || !this.recorder) return;
    this.recorder.pause();
    this.elapsedBefore += this.deps.now() - this.resumedAt;
    this.setState('paused');
  }

  resume(): void {
    if (this.state !== 'paused' || !this.recorder) return;
    this.recorder.resume();
    this.resumedAt = this.deps.now();
    this.setState('recording');
  }

  /** Serialize writes so chunks land in order; a failed write is retried, never dropped. */
  private enqueueWrite(blob: Blob): void {
    const seq = this.seq++;
    this.unsaved.push({ seq, blob });
    this.writes = this.writes.then(() => this.flush());
  }

  private async flush(): Promise<void> {
    const meta = this.meta;
    if (!meta) return;
    while (this.unsaved.length > 0) {
      const next = this.unsaved[0];
      try {
        await appendChunk(meta.id, next.seq, next.blob, this.elapsedMs());
        this.unsaved.shift();
        if (this.storageWarned) {
          this.storageWarned = false;
          this.events.onWarning?.(null);
        }
      } catch {
        if (!this.storageWarned) {
          this.storageWarned = true;
          this.events.onWarning?.("Warning: this device can't store the recording right now (storage full or blocked). It is held in memory; keep this tab open and free some space.");
        }
        return; // retried with the next chunk, in order
      }
    }
  }

  /** Stop recording; resolves once everything captured has been written. */
  stop(): Promise<StopResult> {
    if (this.finishing) return this.finishing;
    this.userStopped = true;
    this.closeSegment();
    this.setState('stopping');
    this.finishing = this.finalize('stopped');
    return this.finishing;
  }

  /** Add the running segment's time to the total (a paused recorder has none running). */
  private closeSegment(): void {
    if (this.state === 'recording') this.elapsedBefore += this.deps.now() - this.resumedAt;
  }

  private async handleInterruption(reason: string): Promise<void> {
    if (this.finishing || this.state === 'idle') return;
    this.userStopped = true;
    this.closeSegment();
    this.finishing = this.finalize('interrupted');
    const result = await this.finishing;
    this.events.onInterrupted?.(reason, result.meta);
  }

  private async finalize(outcome: 'stopped' | 'interrupted'): Promise<StopResult> {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    const recorder = this.recorder;
    if (recorder && recorder.state !== 'inactive') {
      // stop() makes the recorder emit its final chunk before 'stop'.
      await new Promise<void>((resolve) => {
        const prev = recorder.onstop;
        recorder.onstop = (ev) => {
          prev?.call(recorder, ev);
          resolve();
        };
        try {
          recorder.stop();
        } catch {
          resolve();
        }
      });
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stopMeter?.();
    this.releaseWakeLock?.();
    this.stream = this.recorder = this.stopMeter = this.releaseWakeLock = null;
    this.events.onLevel?.(0);

    await this.writes;
    await this.flush();
    const meta = this.meta;
    let finished: RecordingMeta | null = null;
    if (meta) {
      const stored = this.unsaved.length === 0;
      finished = stored
        ? await updateRecording(meta.id, { state: 'stopped', durationMs: this.elapsedBefore }).catch(() => null)
        : null;
    }
    const unsaved = this.unsaved.length > 0 && this.meta
      ? new Blob(this.unsaved.map((u) => u.blob), { type: this.meta.mime })
      : null;
    this.meta = null;
    this.setState(outcome === 'interrupted' ? 'interrupted' : 'idle');
    return { meta: finished, unsaved };
  }
}

/** Input level meter on an AnalyserNode; returns a stop function. */
function createAnalyserMeter(stream: MediaStream, onLevel: (level: number) => void): () => void {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return () => {};
  const ctx = new Ctx();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    onLevel(Math.min(1, Math.sqrt(sum / buf.length) * 3));
  }, 80);
  return () => {
    clearInterval(timer);
    source.disconnect();
    void ctx.close().catch(() => {});
  };
}

/**
 * Keep the screen awake while recording (a locked/sleeping phone suspends the
 * page and with it the recording). Re-acquired when the page becomes visible
 * again, since the browser drops the lock whenever it is hidden.
 */
async function acquireScreenWakeLock(): Promise<() => void> {
  const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock;
  if (!wl) return () => {};
  let sentinel: { release: () => Promise<void> } | null = null;
  let released = false;
  const take = async () => {
    try {
      sentinel = await wl.request('screen');
    } catch {
      // denied (e.g. battery saver): recording still works
    }
  };
  const onVisible = () => {
    if (!released && document.visibilityState === 'visible') void take();
  };
  document.addEventListener('visibilitychange', onVisible);
  await take();
  return () => {
    released = true;
    document.removeEventListener('visibilitychange', onVisible);
    void sentinel?.release().catch(() => {});
  };
}
