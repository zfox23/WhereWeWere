/**
 * Settings > Food: the Mealie instance URL and API token (stored in this
 * plugin's settings, plugin_settings with plugin_id = 'food').
 */

import { useEffect, useState } from 'react';
import { AlertCircle, Check, ChefHat } from 'lucide-react';
import { plugins } from '../../../client/src/plugins/api';
import { food } from './api';

export function FoodSettings() {
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  // Saving before the stored values arrive would overwrite them with blanks.
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    plugins.settings
      .get('food')
      .then((s) => {
        setUrl(typeof s.mealie_url === 'string' ? s.mealie_url : '');
        setToken(typeof s.mealie_api_token === 'string' ? s.mealie_api_token : '');
        setLoaded(true);
      })
      .catch((err) => {
        setMsg({
          type: 'error',
          text: `Could not load Food settings (${err instanceof Error ? err.message : 'unknown error'}). Reload to edit them.`,
        });
      });
  }, []);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await plugins.settings.set('food', {
        mealie_url: url.trim().replace(/\/+$/, '') || null,
        mealie_api_token: token.trim() || null,
      });
      if (!url.trim() || !token.trim()) {
        setMsg({ type: 'success', text: 'Saved. Add both the URL and a token to connect Mealie.' });
        return;
      }
      const status = await food.mealieStatus();
      if (status.configured && status.reachable) {
        const { recipes } = await food.recipes(true);
        setMsg({ type: 'success', text: `Connected to Mealie: ${recipes.length} recipes found.` });
      } else {
        setMsg({ type: 'error', text: `Saved, but Mealie could not be reached: ${status.configured ? status.error : 'not configured'}` });
      }
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save.' });
    } finally {
      setSaving(false);
    }
  };

  const inputClass = 'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm';

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-6 space-y-4">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
        <ChefHat size={20} className="text-orange-500" />
        Mealie
      </h2>
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Connect your self-hosted{' '}
        <a href="https://mealie.io" target="_blank" rel="noreferrer" className="underline hover:text-gray-800 dark:hover:text-gray-200">Mealie</a>
        {' '}to pick meals from your recipes. Checking in a recipe marks it as made in Mealie and adds a
        note to its timeline, and meal suggestions can be added to your Mealie meal plan. Create a token
        in Mealie under your user profile &gt; API Tokens.
      </p>
      <div>
        <label htmlFor="mealie-url" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Mealie URL</label>
        <input
          id="mealie-url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://mealie.mydomain.io"
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor="mealie-token" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">API token</label>
        <input
          id="mealie-token"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoComplete="off"
          className={inputClass}
        />
      </div>
      <button
        type="button"
        onClick={save}
        disabled={!loaded || saving}
        className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
      >
        {saving ? 'Saving...' : 'Save and test'}
      </button>
      {msg && (
        <div className={`flex items-center gap-2 text-sm ${msg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
          {msg.type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
          {msg.text}
        </div>
      )}
    </div>
  );
}
