/**
 * "Advanced audio settings": the capture options the browser's media APIs offer
 * (echo cancellation, noise suppression, automatic gain control, voice
 * isolation, sample rate, sample size), saved per microphone on this device.
 *
 * Only what this browser supports is offered, a microphone can be asked what it
 * can actually do, and the panel shows what the browser really applied, because
 * these are requests that browsers and devices are free to ignore.
 */

import { useMemo, useState } from 'react';
import { ChevronRight, Loader2, RotateCcw, ScanSearch } from 'lucide-react';
import { micErrorMessage } from './audioInput';
import {
  PROCESSING_TOGGLES, SAMPLE_RATES, SAMPLE_SIZES, probeMicrophone, supportedAudioConstraints,
  type AudioProcessing, type MicrophoneProbe, type MicrophoneRef, type ToggleKey,
} from './audioSettings';

const smallBtn = 'inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50';
const selectClass = 'rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm disabled:opacity-60';

export interface AudioAdvancedSettingsProps {
  mic: MicrophoneRef;
  /** Value of the settings for this microphone. */
  value: AudioProcessing;
  onChange: (next: AudioProcessing) => void;
  onReset: () => void;
  /** A recording is in progress: settings are shown but locked. */
  locked: boolean;
  /** What the browser reported applying to the last recording. */
  applied: MediaTrackSettings | null;
}

function onOff(v: unknown): string {
  return typeof v === 'boolean' ? (v ? 'on' : 'off') : '—';
}

/** Rows of what the browser reports applying (or would apply). */
export function appliedRows(s: MediaTrackSettings | null): { label: string; value: string }[] {
  if (!s) return [];
  const r = s as MediaTrackSettings & Record<string, unknown>;
  const rows = [
    { label: 'Echo cancellation', value: onOff(r.echoCancellation) },
    { label: 'Noise suppression', value: onOff(r.noiseSuppression) },
    { label: 'Automatic gain control', value: onOff(r.autoGainControl) },
  ];
  if (typeof r.voiceIsolation === 'boolean') rows.push({ label: 'Voice isolation', value: onOff(r.voiceIsolation) });
  rows.push(
    { label: 'Sample rate', value: typeof s.sampleRate === 'number' ? `${(s.sampleRate / 1000).toFixed(s.sampleRate % 1000 ? 2 : 0)} kHz` : '—' },
    { label: 'Channels', value: typeof s.channelCount === 'number' ? String(s.channelCount) : '—' },
  );
  if (typeof s.sampleSize === 'number') rows.push({ label: 'Sample size', value: `${s.sampleSize}-bit` });
  if (typeof r.latency === 'number') rows.push({ label: 'Latency', value: `${Math.round(r.latency * 1000)} ms` });
  return rows;
}

export function AudioAdvancedSettings({ mic, value, onChange, onReset, locked, applied }: AudioAdvancedSettingsProps) {
  const [open, setOpen] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<{ forDevice: string; result: MicrophoneProbe } | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  const supported = useMemo(() => supportedAudioConstraints(), []);

  // A probe describes one microphone: ignore it once another is selected.
  const caps = probe && probe.forDevice === mic.deviceId ? probe.result : null;
  const supports = (name: string) => (supported.size === 0 ? name !== 'voiceIsolation' : supported.has(name));

  const toggleChoices = (key: ToggleKey): boolean[] | null => {
    const offered = caps?.capabilities[key];
    return Array.isArray(offered) ? offered : null;
  };

  const runProbe = async () => {
    setProbing(true);
    setProbeError(null);
    try {
      setProbe({ forDevice: mic.deviceId, result: await probeMicrophone(mic.deviceId) });
    } catch (err) {
      setProbeError(micErrorMessage(err));
    } finally {
      setProbing(false);
    }
  };

  const rate = caps?.capabilities.sampleRate;
  const rateOptions = SAMPLE_RATES.filter((hz) => (rate?.min === undefined || hz >= rate.min) && (rate?.max === undefined || hz <= rate.max));
  const size = caps?.capabilities.sampleSize;
  const sizeOptions = size && size.min !== undefined && size.max !== undefined && size.min < size.max
    ? SAMPLE_SIZES.filter((bits) => bits >= size.min! && bits <= size.max!)
    : [];
  const shown = appliedRows(applied ?? caps?.settings ?? null);
  const micName = mic.label || (mic.deviceId ? 'this microphone' : 'the system default microphone');

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="audio-advanced-panel"
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs font-medium text-gray-600 dark:text-gray-300"
      >
        <ChevronRight size={13} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
        Advanced audio settings
      </button>

      {open && (
        <div id="audio-advanced-panel" className="space-y-4 border-t border-gray-200 dark:border-gray-700 p-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Saved for {micName} on this device. These are requests: the browser or microphone can override them, and
            what was really applied is shown below. {locked ? 'Locked while recording.' : ''}
          </p>

          <ul className="space-y-3">
            {PROCESSING_TOGGLES.map(({ key, label, help }) => {
              const browserOk = supports(key);
              const choices = toggleChoices(key);
              const fixed = choices && choices.length === 1 ? choices[0] : null;
              const checked = fixed !== null ? fixed : value[key] === true;
              const disabled = locked || !browserOk || fixed !== null;
              if (key === 'voiceIsolation' && !browserOk) return null; // nothing to offer on this browser
              return (
                <li key={key}>
                  <label className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={(e) => onChange({ ...value, [key]: e.target.checked })}
                      className="mt-0.5"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-gray-800 dark:text-gray-100">{label}</span>
                      <span className="block text-xs text-gray-500 dark:text-gray-400">{help}</span>
                      {fixed !== null && <span className="block text-xs text-amber-700 dark:text-amber-300">Fixed {fixed ? 'on' : 'off'} by this microphone or browser.</span>}
                      {!browserOk && <span className="block text-xs text-amber-700 dark:text-amber-300">Not supported by this browser.</span>}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          {supports('sampleRate') && (
            <div>
              <label htmlFor="audio-sample-rate" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">Sample rate</label>
              <select
                id="audio-sample-rate"
                value={value.sampleRate === null ? '' : String(value.sampleRate)}
                disabled={locked}
                onChange={(e) => onChange({ ...value, sampleRate: e.target.value === '' ? null : Number(e.target.value) })}
                className={selectClass}
              >
                <option value="">Browser default</option>
                {rateOptions.map((hz) => <option key={hz} value={hz}>{hz / 1000} kHz</option>)}
              </select>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Recordings are encoded at up to 48 kHz, so higher rates can’t be kept.</p>
            </div>
          )}

          {sizeOptions.length > 0 && (
            <div>
              <label htmlFor="audio-sample-size" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">Sample size</label>
              <select
                id="audio-sample-size"
                value={value.sampleSize === null ? '' : String(value.sampleSize)}
                disabled={locked}
                onChange={(e) => onChange({ ...value, sampleSize: e.target.value === '' ? null : Number(e.target.value) })}
                className={selectClass}
              >
                <option value="">Microphone default</option>
                {sizeOptions.map((bits) => <option key={bits} value={bits}>{bits}-bit</option>)}
              </select>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void runProbe()} disabled={locked || probing} className={smallBtn}>
              {probing ? <Loader2 size={12} className="animate-spin" /> : <ScanSearch size={12} />} Check what this microphone supports
            </button>
            <button type="button" onClick={onReset} disabled={locked} className={smallBtn}>
              <RotateCcw size={12} /> Reset to defaults
            </button>
          </div>
          {probeError && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{probeError}</p>}

          {shown.length > 0 && (
            <div>
              <h4 className="mb-1 text-xs font-semibold text-gray-700 dark:text-gray-300">
                {applied ? 'Applied by the browser (last recording)' : 'The browser’s default for this microphone'}
              </h4>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-xs">
                {shown.map((row) => (
                  <div key={row.label} className="contents">
                    <dt className="text-gray-500 dark:text-gray-400">{row.label}</dt>
                    <dd className="tabular-nums text-gray-800 dark:text-gray-100">{row.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
