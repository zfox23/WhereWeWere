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

/** What the user picks: a channel count, or leave it to the microphone and browser. */
export type ChannelChoice = Channels | 'auto';

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
 * channel stays mono whatever is asked (the recorder reports that). With
 * `hints: false` the channel count, sample rate and sample size are not asked
 * for at all, leaving the browser's own capture format (the fallback for
 * microphones that go silent when those hints are present).
 */
export function audioConstraints(
  deviceId: string,
  channels: ChannelChoice = 2,
  processing: AudioProcessing = DEFAULT_PROCESSING,
  hints = true,
): MediaStreamConstraints {
  const { sampleRate: _rate, sampleSize: _size, ...flags } = processingConstraints(processing);
  return {
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      ...(hints && channels !== 'auto' ? { channelCount: { ideal: channels } } : {}),
      ...(hints ? processingConstraints(processing) : flags),
    },
  };
}

/** One way of opening the microphone, tried in order until one produces sound. */
export interface CaptureAttempt {
  /** Said to the user when this is what finally worked ("…recording with noise suppression on"). */
  label: string;
  /** Channel count, sample rate and sample size were left to the browser. */
  hintsDropped: boolean;
  processing: AudioProcessing;
}

/**
 * Some browsers (Firefox on Android, notably) give a silent stream when every
 * voice-processing flag is off. The attempts, least intrusive first: as
 * requested; without the format hints; then with noise suppression on; then
 * with echo cancellation on. Only used when echo cancellation AND noise
 * suppression are both off: with either on, exact silence can be legitimate
 * gating of a quiet room, so it proves nothing.
 */
export function captureAttempts(processing: AudioProcessing): CaptureAttempt[] {
  const asked: CaptureAttempt = { label: 'with your settings', hintsDropped: false, processing };
  if (processing.echoCancellation || processing.noiseSuppression) return [asked];
  const plain: AudioProcessing = { ...processing, sampleRate: null, sampleSize: null };
  return [
    asked,
    { label: "using the browser's default audio format", hintsDropped: true, processing: plain },
    { label: 'with noise suppression turned on', hintsDropped: true, processing: { ...plain, noiseSuppression: true } },
    { label: 'with echo cancellation turned on', hintsDropped: true, processing: { ...plain, echoCancellation: true } },
  ];
}

/** Is the stream carrying sound? `unknown` when it cannot be measured (never treated as a failure). */
export type SignalResult = 'signal' | 'silent' | 'unknown';

/** How long a stream may stay exactly silent before it is called dead. A live microphone's noise floor is never exactly zero. */
export const SIGNAL_TIMEOUT_MS = 1500;

export type RecorderState = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping' | 'interrupted';

export interface RecorderEvents {
  onState?: (state: RecorderState) => void;
  /** Wall-clock recording time (pauses excluded), roughly every 250 ms. */
  onTick?: (elapsedMs: number) => void;
  /** Input level 0..1, for a meter. */
  onLevel?: (level: number) => void;
  /** What the browser actually applied to the microphone (getSettings), once the stream is open. */
  onSettings?: (applied: MediaTrackSettings) => void;
  /**
   * The microphone gave no sound with the chosen settings, and these made it work
   * instead. The caller can keep them (so the next recording starts working at once).
   */
  onRecovered?: (fix: { attempt: CaptureAttempt; label: string }) => void;
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
  /** Measure whether a freshly opened stream carries any sound (absent in tests that don't care). */
  detectSignal?: (stream: MediaStream, timeoutMs: number) => Promise<SignalResult>;
  acquireWakeLock?: () => Promise<() => void>;
}

export function browserDeps(): RecorderDeps {
  return {
    getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
    MediaRecorderCtor: MediaRecorder,
    now: () => Date.now(),
    createMeter: createAnalyserMeter,
    detectSignal: detectSignalWithAnalyser,
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
    private readonly opts: { userId: string; deviceId: string; deviceLabel: string | null; channels?: ChannelChoice; processing?: AudioProcessing },
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
    const channels: ChannelChoice = this.opts.channels === 1 ? 1 : this.opts.channels === 'auto' ? 'auto' : 2;
    const requested = this.opts.processing ?? DEFAULT_PROCESSING;
    const notes: string[] = []; // things to tell the user once, after the stream is open
    this.setState('starting');

    let deviceId = this.opts.deviceId;
    /** Open the microphone; if the remembered one is gone, fall back to the default (once). */
    const open = async (attempt: CaptureAttempt): Promise<MediaStream> => {
      try {
        return await this.deps.getUserMedia(audioConstraints(deviceId, channels, attempt.processing, !attempt.hintsDropped));
      } catch (err) {
        if (deviceId && err instanceof Error && err.name === 'OverconstrainedError') {
          deviceId = '';
          notes.push('The selected microphone was not found; recording with the default one.');
          return this.deps.getUserMedia(audioConstraints('', channels, attempt.processing, !attempt.hintsDropped));
        }
        throw err;
      }
    };

    // Open it, check that sound is actually arriving, and if not try the next way of opening it.
    const attempts = captureAttempts(requested);
    let stream: MediaStream | null = null;
    let processing = requested;
    try {
      for (let i = 0; i < attempts.length && !stream; i++) {
        const candidate = await open(attempts[i]);
        const verdict = attempts.length > 1 && this.deps.detectSignal
          ? await this.deps.detectSignal(candidate, SIGNAL_TIMEOUT_MS)
          : 'unknown';
        if (verdict === 'silent' && i < attempts.length - 1) {
          candidate.getTracks().forEach((t) => t.stop());
          continue;
        }
        stream = candidate;
        processing = attempts[i].processing;
        if (verdict === 'silent') {
          notes.push('No sound is coming from this microphone. Check that it is not muted or covered, or try another microphone.');
        } else if (i > 0) {
          const label = attempts[i].label;
          notes.push(`No sound came through with your settings, so this recording is ${label}.`);
          this.events.onRecovered?.({ attempt: attempts[i], label });
        }
      }
    } catch (err) {
      stream?.getTracks().forEach((t) => t.stop());
      this.setState('idle');
      throw new Error(micErrorMessage(err));
    }
    if (!stream) {
      this.setState('idle');
      throw new Error('Could not open the microphone.');
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

    // Size the encoder for what the microphone really delivers (mono needs half the bitrate).
    const delivered = stream.getAudioTracks()[0]?.getSettings?.().channelCount;
    const encodeChannels: Channels = typeof delivered === 'number' ? (delivered === 1 ? 1 : 2) : channels === 1 ? 1 : 2;
    const recorder = new this.deps.MediaRecorderCtor(stream, { mimeType: mime, audioBitsPerSecond: bitrateFor(encodeChannels) });
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
    if (typeof actual === 'number' && channels !== 'auto' && actual !== channels) {
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

/**
 * Watch a new stream for up to `timeoutMs` and report whether any non-zero sample arrives.
 * Returns `unknown` (never a failure) if the browser can't run an AudioContext here, so a
 * missing measurement can never block recording.
 */
async function detectSignalWithAnalyser(stream: MediaStream, timeoutMs: number): Promise<SignalResult> {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return 'unknown';
  let ctx: AudioContext | null = null;
  try {
    ctx = new Ctx();
    await ctx.resume().catch(() => {});
    if (ctx.state !== 'running') return 'unknown';
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const startedAt = Date.now();
    return await new Promise<SignalResult>((resolve) => {
      const timer = setInterval(() => {
        analyser.getFloatTimeDomainData(buf);
        for (const v of buf) {
          if (Math.abs(v) > 1e-7) {
            clearInterval(timer);
            resolve('signal');
            return;
          }
        }
        if (Date.now() - startedAt >= timeoutMs) {
          clearInterval(timer);
          resolve('silent');
        }
      }, 40);
    });
  } catch {
    return 'unknown';
  } finally {
    void ctx?.close().catch(() => {});
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
