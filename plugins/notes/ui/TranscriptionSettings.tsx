/**
 * Settings > Integrations > Audio transcription: the OpenAI-compatible
 * `/audio/transcriptions` endpoint that turns audio attached to notes into
 * searchable text. The optional `transcription` Docker Compose service
 * (`docker compose --profile transcription up -d`) provides one.
 */

import { useEffect, useState } from 'react';
import { AlertCircle, Check, Mic } from 'lucide-react';
import { plugins } from '../../../client/src/plugins/api';
import { notes } from './api';

const DEFAULT_URL = 'http://transcription:8000/v1';
const DEFAULT_MODEL = 'Systran/faster-whisper-large-v3';

export function TranscriptionSettings() {
  const [url, setUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [language, setLanguage] = useState('');
  // Saving before the stored values arrive would overwrite them with blanks.
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    plugins.settings
      .get('notes')
      .then((s) => {
        setUrl(typeof s.transcription_api_url === 'string' ? s.transcription_api_url : '');
        setModel(typeof s.transcription_model === 'string' ? s.transcription_model : '');
        setApiKey(typeof s.transcription_api_key === 'string' ? s.transcription_api_key : '');
        setLanguage(typeof s.transcription_language === 'string' ? s.transcription_language : '');
        setLoaded(true);
      })
      .catch((err) => setMsg({ type: 'error', text: `Could not load the transcription settings (${err instanceof Error ? err.message : 'unknown error'}).` }));
  }, []);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await plugins.settings.set('notes', {
        transcription_api_url: url.trim().replace(/\/+$/, '') || null,
        transcription_model: model.trim() || null,
        transcription_api_key: apiKey.trim() || null,
        transcription_language: language.trim().toLowerCase() || null,
      });
      setMsg({
        type: 'success',
        text: url.trim() && model.trim()
          ? 'Saved. Audio waiting for a transcript is picked up within a minute.'
          : 'Saved. Add a URL and model to turn transcription on.',
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
      const result = await notes.testTranscription({ api_url: url.trim(), model: model.trim(), api_key: apiKey.trim() });
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
        <Mic size={16} className="text-rose-500" /> Audio transcription
      </h3>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        An OpenAI-compatible <code>/audio/transcriptions</code> endpoint (faster-whisper). Start the bundled one with
        {' '}<code>docker compose --profile transcription up -d</code>, then use <code>{DEFAULT_URL}</code>. Audio you attach to a
        note is transcribed in the background; the language is detected automatically unless you set a hint.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="tx-url" className={labelClass}>Transcription API URL</label>
          <input id="tx-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={DEFAULT_URL} className={inputClass} />
        </div>
        <div>
          <label htmlFor="tx-model" className={labelClass}>Transcription model</label>
          <input id="tx-model" type="text" value={model} onChange={(e) => setModel(e.target.value)} placeholder={DEFAULT_MODEL} className={inputClass} />
        </div>
        <div>
          <label htmlFor="tx-key" className={labelClass}>API key (optional)</label>
          <input id="tx-key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" className={inputClass} />
        </div>
        <div>
          <label htmlFor="tx-lang" className={labelClass}>Language hint (optional, e.g. en)</label>
          <input id="tx-lang" type="text" value={language} onChange={(e) => setLanguage(e.target.value)} maxLength={8} placeholder="auto-detect" className={inputClass} />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={save}
          disabled={!loaded || saving}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save transcription settings'}
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
