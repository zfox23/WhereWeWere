import { useState, useEffect } from 'react';
import { Check, AlertCircle, FerrisWheel } from 'lucide-react';
import { plugins } from '../../../client/src/plugins/api';
import { jobs } from '../../../client/src/api/client';

/**
 * Section of Settings > Location for the Coasterpedia API key. The key lives
 * in this plugin's settings store (plugin_settings, plugin_id = 'location').
 * Venues in the "Amusement Ride" category are looked up with it after each save.
 */
export default function CoasterpediaSettings() {
  const [apiKey, setApiKey] = useState('');
  // Saving before the stored key arrives would overwrite it with a blank.
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    plugins.settings
      .get('location')
      .then((s) => {
        const value = (s as Record<string, unknown>).coasterpedia_api_key;
        setApiKey(typeof value === 'string' ? value : '');
        setLoaded(true);
      })
      .catch((err) => {
        setMsg({
          type: 'error',
          text: `Could not load Coasterpedia settings (${err instanceof Error ? err.message : 'unknown error'}). Reload to edit them.`,
        });
      });
  }, []);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await plugins.settings.set('location', { coasterpedia_api_key: apiKey.trim() || null });
      setMsg({ type: 'success', text: 'Coasterpedia settings saved.' });
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save.' });
    } finally {
      setSaving(false);
    }
  };

  const backfill = async () => {
    setBackfilling(true);
    setMsg(null);
    try {
      await jobs.start('coasterpedia-backfill');
      setMsg({ type: 'success', text: 'Looking up your amusement ride venues in the background.' });
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : 'Could not start the lookup.' });
    } finally {
      setBackfilling(false);
    }
  };

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-1.5">
        <FerrisWheel size={14} className="text-amber-600 dark:text-amber-400" />
        Coasterpedia
      </h3>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
        Venues in the &ldquo;Amusement Ride&rdquo; category are looked up on{' '}
        <a href="https://developer.coasterpedia.net/docs/" target="_blank" rel="noreferrer" className="underline hover:text-gray-700 dark:hover:text-gray-200">Coasterpedia</a>
        {' '}after you save them. Get a key from the Coasterpedia developer portal.
      </p>
      <label htmlFor="coasterpedia-api-key" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        API key
      </label>
      <input
        id="coasterpedia-api-key"
        type="password"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder="cpk_..."
        autoComplete="off"
        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm"
      />
      <div className="flex flex-wrap gap-2 mt-3">
        <button
          type="button"
          onClick={save}
          disabled={!loaded || saving}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Coasterpedia key'}
        </button>
        <button
          type="button"
          onClick={backfill}
          disabled={!loaded || !apiKey || backfilling}
          className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
          title="Look up existing amusement ride venues that have no Coasterpedia data yet. Save the key first."
        >
          {backfilling ? 'Starting...' : 'Look up existing rides'}
        </button>
      </div>
      {msg && (
        <div className={`flex items-center gap-2 text-sm mt-2 ${msg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
          {msg.type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
          {msg.text}
        </div>
      )}
    </div>
  );
}
