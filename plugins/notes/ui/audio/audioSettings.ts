/**
 * Advanced capture settings: the getUserMedia audio constraints a person might
 * want to change (echo cancellation, noise suppression, automatic gain control,
 * voice isolation, sample rate, sample size), remembered per microphone in this
 * browser.
 *
 * Defaults are the highest-fidelity choice: all voice processing off, 48 kHz.
 * Everything here is a *request*: browsers and devices may ignore it, so the
 * recorder reads back what was applied (getSettings) and the panel shows it.
 */

export interface AudioProcessing {
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  /** null = don't ask (also the only sane value on browsers without the constraint). */
  voiceIsolation: boolean | null;
  /** Hz, or null for the browser's own default. */
  sampleRate: number | null;
  /** Bits per sample, or null for the browser's own default. */
  sampleSize: number | null;
}

export const DEFAULT_PROCESSING: AudioProcessing = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  voiceIsolation: null,
  sampleRate: 48000,
  sampleSize: null,
};

export const PROCESSING_KEY = 'wwp:notes:audio-processing';
const MAX_SAVED_MICROPHONES = 50;

/** The on/off processing switches, in display order. */
export const PROCESSING_TOGGLES = [
  {
    key: 'echoCancellation',
    label: 'Echo cancellation',
    help: 'Removes your speakers’ sound from the recording. Useful for calls without headphones; it can thin out and gate the voice, so leave it off for quality.',
  },
  {
    key: 'noiseSuppression',
    label: 'Noise suppression',
    help: 'Filters steady background noise. Helps in a noisy room, but it can clip quiet speech, breaths and music.',
  },
  {
    key: 'autoGainControl',
    label: 'Automatic gain control',
    help: 'Evens out loud and quiet parts. Off keeps the true dynamics; on can pump the volume up and down.',
  },
  {
    key: 'voiceIsolation',
    label: 'Voice isolation',
    help: 'Tries to keep only the voice and remove everything else. Newer browsers and devices only.',
  },
] as const;

export type ToggleKey = (typeof PROCESSING_TOGGLES)[number]['key'];

export const SAMPLE_RATES = [8000, 16000, 22050, 24000, 32000, 44100, 48000];
export const SAMPLE_SIZES = [16, 24, 32];

/** The constraints that turn `p` into a getUserMedia request. */
export function processingConstraints(p: AudioProcessing): Record<string, unknown> {
  return {
    echoCancellation: p.echoCancellation,
    noiseSuppression: p.noiseSuppression,
    autoGainControl: p.autoGainControl,
    ...(p.voiceIsolation !== null ? { voiceIsolation: p.voiceIsolation } : {}),
    ...(p.sampleRate !== null ? { sampleRate: { ideal: p.sampleRate } } : {}),
    ...(p.sampleSize !== null ? { sampleSize: { ideal: p.sampleSize } } : {}),
  };
}

/**
 * Compare what was asked with what the browser reports it applied. Returns a
 * sentence per setting the browser overrode (iOS, for one, can force processing on).
 */
export function appliedMismatches(requested: AudioProcessing, applied: MediaTrackSettings | undefined): string[] {
  if (!applied) return [];
  const settings = applied as MediaTrackSettings & Record<string, unknown>;
  const out: string[] = [];
  for (const toggle of PROCESSING_TOGGLES) {
    const want = requested[toggle.key];
    const got = settings[toggle.key];
    if (typeof want === 'boolean' && typeof got === 'boolean' && want !== got) {
      out.push(`${toggle.label} is ${got ? 'on' : 'off'} (you chose ${want ? 'on' : 'off'})`);
    }
  }
  return out;
}

function sanitize(raw: unknown): AudioProcessing {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  const optNumber = (v: unknown, allowed: number[], fallback: number | null) =>
    v === null ? null : typeof v === 'number' && allowed.includes(v) ? v : fallback;
  return {
    echoCancellation: bool(r.echoCancellation, DEFAULT_PROCESSING.echoCancellation),
    noiseSuppression: bool(r.noiseSuppression, DEFAULT_PROCESSING.noiseSuppression),
    autoGainControl: bool(r.autoGainControl, DEFAULT_PROCESSING.autoGainControl),
    voiceIsolation: r.voiceIsolation === null || typeof r.voiceIsolation === 'boolean' ? (r.voiceIsolation as boolean | null) : null,
    sampleRate: optNumber(r.sampleRate, SAMPLE_RATES, DEFAULT_PROCESSING.sampleRate),
    sampleSize: optNumber(r.sampleSize, SAMPLE_SIZES, null),
  };
}

export interface MicrophoneRef {
  /** '' is the system default microphone. */
  deviceId: string;
  label: string;
}

interface Entry extends MicrophoneRef {
  settings: AudioProcessing;
}

function readEntries(): Entry[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PROCESSING_KEY) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((e): Entry[] => {
      const r = (e ?? {}) as Record<string, unknown>;
      return typeof r.deviceId === 'string' ? [{ deviceId: r.deviceId, label: typeof r.label === 'string' ? r.label : '', settings: sanitize(r.settings) }] : [];
    });
  } catch {
    return [];
  }
}

/** The saved entry for a microphone: by device id, else by label (some browsers rotate ids). */
function findEntry(entries: Entry[], mic: MicrophoneRef): Entry | undefined {
  return entries.find((e) => e.deviceId === mic.deviceId) ?? (mic.label ? entries.find((e) => e.label === mic.label) : undefined);
}

export function loadProcessing(mic: MicrophoneRef): AudioProcessing {
  return findEntry(readEntries(), mic)?.settings ?? { ...DEFAULT_PROCESSING };
}

function writeEntries(entries: Entry[]): void {
  try {
    window.localStorage.setItem(PROCESSING_KEY, JSON.stringify(entries.slice(-MAX_SAVED_MICROPHONES)));
  } catch {
    // storage blocked: the settings just aren't remembered
  }
}

export function saveProcessing(mic: MicrophoneRef, settings: AudioProcessing): void {
  const entries = readEntries();
  const existing = findEntry(entries, mic);
  const rest = entries.filter((e) => e !== existing);
  writeEntries([...rest, { deviceId: mic.deviceId, label: mic.label || existing?.label || '', settings }]);
}

export function resetProcessing(mic: MicrophoneRef): void {
  const entries = readEntries();
  writeEntries(entries.filter((e) => e !== findEntry(entries, mic)));
}

/** Audio constraints this browser understands (it ignores the rest, so only these are worth offering). */
export function supportedAudioConstraints(): Set<string> {
  try {
    const supported = navigator.mediaDevices?.getSupportedConstraints?.() ?? {};
    return new Set(Object.entries(supported).filter(([, on]) => on).map(([name]) => name));
  } catch {
    return new Set();
  }
}

export interface MicrophoneProbe {
  capabilities: Partial<Record<ToggleKey, boolean[]>> & {
    sampleRate?: { min?: number; max?: number };
    sampleSize?: { min?: number; max?: number };
    channelCount?: { min?: number; max?: number };
  };
  /** What the browser applies by default / with the plain request. */
  settings: MediaTrackSettings;
}

/**
 * Open the microphone for an instant to ask what it can do (getCapabilities) and
 * what it applies by default (getSettings). Needs microphone permission; closed again straight away.
 */
export async function probeMicrophone(deviceId: string): Promise<MicrophoneProbe> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true });
  try {
    const track = stream.getAudioTracks()[0];
    return {
      capabilities: (track?.getCapabilities?.() ?? {}) as MicrophoneProbe['capabilities'],
      settings: track?.getSettings?.() ?? {},
    };
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}
