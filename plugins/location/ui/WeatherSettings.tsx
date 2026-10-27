import { useState, useEffect } from 'react';
import { Check, AlertCircle, CloudSun } from 'lucide-react';
import { plugins } from '../../../client/src/plugins/api';
import { jobs } from '../../../client/src/api/client';

/**
 * Section of Settings > Location for daily weather from Open-Meteo. Off by
 * default: nothing is sent to Open-Meteo until it is enabled. The flag lives
 * in this plugin's settings store (plugin_settings, plugin_id = 'location').
 */
export default function WeatherSettings() {
  const [enabled, setEnabled] = useState(false);
  // Saving before the stored value arrives would overwrite it.
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    plugins.settings
      .get('location')
      .then((s) => {
        setEnabled((s as Record<string, unknown>).weather_enabled === true);
        setLoaded(true);
      })
      .catch((err) => {
        setMsg({
          type: 'error',
          text: `Could not load weather settings (${err instanceof Error ? err.message : 'unknown error'}). Reload to edit them.`,
        });
      });
  }, []);

  const toggle = async (next: boolean) => {
    setSaving(true);
    setMsg(null);
    try {
      await plugins.settings.set('location', { weather_enabled: next });
      setEnabled(next);
      setMsg({
        type: 'success',
        text: next ? 'Weather enabled. Reload the timeline to see it.' : 'Weather hidden.',
      });
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
      await jobs.start('weather-backfill');
      setMsg({ type: 'success', text: 'Fetching weather for your past days in the background.' });
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : 'Could not start the backfill.' });
    } finally {
      setBackfilling(false);
    }
  };

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-1.5">
        <CloudSun size={14} className="text-sky-600 dark:text-sky-400" />
        Weather
      </h3>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
        Show each day&rsquo;s weather next to its date on the timeline, for the place you were at noon.
        Coordinates of that place are sent to{' '}
        <a href="https://open-meteo.com/" target="_blank" rel="noreferrer" className="underline hover:text-gray-700 dark:hover:text-gray-200">Open-Meteo</a>
        {' '}(free, no key, non-commercial use, CC BY 4.0). New days are fetched when you save a check-in.
      </p>
      <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
        <input
          type="checkbox"
          checked={enabled}
          disabled={!loaded || saving}
          onChange={(e) => toggle(e.target.checked)}
        />
        Show daily weather
      </label>
      <div className="flex flex-wrap gap-2 mt-3">
        <button
          type="button"
          onClick={backfill}
          disabled={!loaded || !enabled || backfilling}
          className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
          title="Fetch weather for past days that have none yet."
        >
          {backfilling ? 'Starting...' : 'Fetch past weather'}
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
