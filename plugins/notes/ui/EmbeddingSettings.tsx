/**
 * Settings > Integrations > Note similarity: the OpenAI-compatible embedding
 * endpoint the notes similarity analysis uses (stored in this plugin's
 * settings). The URL may be left blank to reuse the LLM server above.
 */

import { useEffect, useState } from 'react';
import { AlertCircle, Check, Waypoints } from 'lucide-react';
import { plugins } from '../../../client/src/plugins/api';

export function EmbeddingSettings() {
  const [url, setUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  // Saving before the stored values arrive would overwrite them with blanks.
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    plugins.settings
      .get('notes')
      .then((s) => {
        setUrl(typeof s.embedding_api_url === 'string' ? s.embedding_api_url : '');
        setModel(typeof s.embedding_model === 'string' ? s.embedding_model : '');
        setApiKey(typeof s.embedding_api_key === 'string' ? s.embedding_api_key : '');
        setLoaded(true);
      })
      .catch((err) => setMsg({ type: 'error', text: `Could not load the embedding settings (${err instanceof Error ? err.message : 'unknown error'}).` }));
  }, []);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await plugins.settings.set('notes', {
        embedding_api_url: url.trim().replace(/\/+$/, '') || null,
        embedding_model: model.trim() || null,
        embedding_api_key: apiKey.trim() || null,
      });
      setMsg({ type: 'success', text: model.trim() ? 'Saved. Run the analysis from Profile > Notes.' : 'Saved. Add a model name to enable note similarity.' });
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save.' });
    } finally {
      setSaving(false);
    }
  };

  const inputClass = 'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm';

  return (
    <div className="space-y-3 pt-4 border-t border-gray-200 dark:border-gray-700">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
        <Waypoints size={16} className="text-violet-500" /> Note similarity (embeddings)
      </h3>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        An OpenAI-compatible <code>/embeddings</code> endpoint, e.g. vLLM serving an embedding model such as
        {' '}<code>BAAI/bge-m3</code> or <code>nomic-ai/nomic-embed-text-v1.5</code>. Leave the URL blank to use the LLM server
        above. The LLM names the themes the analysis finds.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="embed-url" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Embedding API URL</label>
          <input id="embed-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://vllm-embed:8001/v1" className={inputClass} />
        </div>
        <div>
          <label htmlFor="embed-model" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Embedding model</label>
          <input id="embed-model" type="text" value={model} onChange={(e) => setModel(e.target.value)} placeholder="BAAI/bge-m3" className={inputClass} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="embed-key" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">API key (optional)</label>
          <input id="embed-key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" className={inputClass} />
        </div>
      </div>
      <button
        type="button"
        onClick={save}
        disabled={!loaded || saving}
        className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
      >
        {saving ? 'Saving...' : 'Save embedding settings'}
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
