/**
 * Settings > Integrations > Speaker identification: the optional diarization
 * service (`docker compose --profile diarization up -d --build diarization`)
 * that works out who is speaking when, so transcripts can be split by speaker.
 */

import { useEffect, useState } from 'react';
import { AlertCircle, Check, Users } from 'lucide-react';
import { plugins } from '../../../client/src/plugins/api';
import { notes } from './api';

const DEFAULT_URL = 'http://diarization:8001';

/** Blank -> null; a whole number from 1 to 20 -> that number; anything else -> undefined (invalid). */
export function parseSpeakerCount(text: string): number | null | undefined {
  const t = text.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 1 && n <= 20 ? n : undefined;
}

export function DiarizationSettings() {
  const [url, setUrl] = useState('');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  // Saving before the stored values arrive would overwrite them with blanks.
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    plugins.settings
      .get('notes')
      .then((s) => {
        setUrl(typeof s.diarization_api_url === 'string' ? s.diarization_api_url : '');
        setMin(typeof s.diarization_min_speakers === 'number' ? String(s.diarization_min_speakers) : '');
        setMax(typeof s.diarization_max_speakers === 'number' ? String(s.diarization_max_speakers) : '');
        setLoaded(true);
      })
      .catch((err) => setMsg({ type: 'error', text: `Could not load the speaker identification settings (${err instanceof Error ? err.message : 'unknown error'}).` }));
  }, []);

  const save = async () => {
    const lo = parseSpeakerCount(min);
    const hi = parseSpeakerCount(max);
    if (lo === undefined || hi === undefined) {
      setMsg({ type: 'error', text: 'Speaker counts must be whole numbers from 1 to 20, or blank.' });
      return;
    }
    if (lo !== null && hi !== null && lo > hi) {
      setMsg({ type: 'error', text: 'The fewest speakers can’t be more than the most.' });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      await plugins.settings.set('notes', {
        diarization_api_url: url.trim().replace(/\/+$/, '') || null,
        diarization_min_speakers: lo,
        diarization_max_speakers: hi,
      });
      setMsg({
        type: 'success',
        text: url.trim()
          ? 'Saved. New transcripts get speakers automatically; use “Identify speakers” on an existing one.'
          : 'Saved. Speaker identification is off.',
      });
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save.' });
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setMsg(null);
    try {
      const result = await notes.testDiarization(url.trim());
      setMsg({ type: result.ok ? 'success' : 'error', text: result.message });
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : 'The test failed.' });
    } finally {
      setTesting(false);
    }
  };

  const inputClass = 'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm';
  const labelClass = 'block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1';

  return (
    <div className="space-y-3 pt-4 border-t border-gray-200 dark:border-gray-700">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
        <Users size={16} className="text-sky-500" /> Speaker identification
      </h3>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Splits a transcript by who is speaking. Start the optional service with
        {' '}<code>docker compose --profile diarization up -d --build diarization</code> (it needs a Hugging Face token; see the
        audio notes docs), then use <code>{DEFAULT_URL}</code>. Leave the URL blank to turn it off. If you know how many people
        are talking, say so: it usually makes the result better.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-3">
          <label htmlFor="dz-url" className={labelClass}>Speaker identification service URL</label>
          <input id="dz-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={DEFAULT_URL} className={inputClass} />
        </div>
        <div>
          <label htmlFor="dz-min" className={labelClass}>Fewest speakers (optional)</label>
          <input id="dz-min" inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value)} placeholder="auto" className={inputClass} />
        </div>
        <div>
          <label htmlFor="dz-max" className={labelClass}>Most speakers (optional)</label>
          <input id="dz-max" inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value)} placeholder="auto" className={inputClass} />
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 sm:self-end">Same number in both means exactly that many.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={save}
          disabled={!loaded || saving}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save speaker identification settings'}
        </button>
        <button
          type="button"
          onClick={test}
          disabled={testing || !url.trim()}
          className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
        >
          {testing ? 'Testing...' : 'Test connection'}
        </button>
      </div>
      {msg && (
        <div role="status" className={`flex items-center gap-2 text-sm ${msg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
          {msg.type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
          {msg.text}
        </div>
      )}
    </div>
  );
}
