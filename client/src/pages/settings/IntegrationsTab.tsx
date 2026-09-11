import { useState, useEffect } from 'react';
import { Link2, Moon, Sparkles, Check, AlertCircle, Loader2, Copy, Film, Gamepad2, BookOpen, Tv } from 'lucide-react';
import { settings, sleepWebhook, plexWebhook } from '../../api/client';

interface IntegrationsTabProps {
  initialDawarichUrl: string;
  initialDawarichApiKey: string;
  initialImmichUrl: string;
  initialImmichApiKey: string;
  initialMalojaUrl: string;
  initialPlexUsernames: string;
  initialTmdbApiKey: string;
  initialTgdbApiKey: string;
  initialHardcoverApiKey: string;
  initialLlmApiUrl: string;
  initialLlmModel: string;
  initialLlmReasoningLevel: string;
  initialLlmContextWindow: string;
  initialLlmImageSupport: boolean;
}

export function IntegrationsTab({
  initialDawarichUrl,
  initialDawarichApiKey,
  initialImmichUrl,
  initialImmichApiKey,
  initialMalojaUrl,
  initialPlexUsernames,
  initialTmdbApiKey,
  initialTgdbApiKey,
  initialHardcoverApiKey,
  initialLlmApiUrl,
  initialLlmModel,
  initialLlmReasoningLevel,
  initialLlmContextWindow,
  initialLlmImageSupport,
}: IntegrationsTabProps) {
  const [dawarichUrl, setDawarichUrl] = useState(initialDawarichUrl);
  const [dawarichApiKey, setDawarichApiKey] = useState(initialDawarichApiKey);
  const [immichUrl, setImmichUrl] = useState(initialImmichUrl);
  const [immichApiKey, setImmichApiKey] = useState(initialImmichApiKey);
  const [malojaUrl, setMalojaUrl] = useState(initialMalojaUrl);
  const [plexUsernames, setPlexUsernames] = useState(initialPlexUsernames);
  const [tmdbApiKey, setTmdbApiKey] = useState(initialTmdbApiKey);
  const [tgdbApiKey, setTgdbApiKey] = useState(initialTgdbApiKey);
  const [hardcoverApiKey, setHardcoverApiKey] = useState(initialHardcoverApiKey);
  const [llmApiUrl, setLlmApiUrl] = useState(initialLlmApiUrl);
  const [llmModel, setLlmModel] = useState(initialLlmModel);
  const [llmReasoningLevel, setLlmReasoningLevel] = useState(initialLlmReasoningLevel);
  const [llmContextWindow, setLlmContextWindow] = useState(initialLlmContextWindow);
  const [llmImageSupport, setLlmImageSupport] = useState(initialLlmImageSupport);
  const [integrationSaving, setIntegrationSaving] = useState(false);
  const [integrationMsg, setIntegrationMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [webhookEventCount, setWebhookEventCount] = useState<number | null>(null);
  const [webhookCopied, setWebhookCopied] = useState(false);
  const webhookUrl = `${window.location.origin}/api/v1/webhook/sleep-as-android`;

  const [plexEventCount, setPlexEventCount] = useState<number | null>(null);
  const [plexCopied, setPlexCopied] = useState(false);
  const plexWebhookUrl = `${window.location.origin}/api/v1/webhook/plex`;

  useEffect(() => {
    sleepWebhook.stats()
      .then((data) => setWebhookEventCount(data.count))
      .catch(() => setWebhookEventCount(null));
    plexWebhook.stats()
      .then((data) => setPlexEventCount(data.count))
      .catch(() => setPlexEventCount(null));
  }, []);

  const handleWebhookCopy = () => {
    navigator.clipboard.writeText(webhookUrl).then(() => {
      setWebhookCopied(true);
      setTimeout(() => setWebhookCopied(false), 2000);
    });
  };

  const handlePlexCopy = () => {
    navigator.clipboard.writeText(plexWebhookUrl).then(() => {
      setPlexCopied(true);
      setTimeout(() => setPlexCopied(false), 2000);
    });
  };

  const saveIntegrations = async () => {
    setIntegrationSaving(true);
    setIntegrationMsg(null);
    try {
      const contextWindowNum = parseInt(llmContextWindow, 10);
      await settings.update({
        dawarich_url: dawarichUrl || null,
        dawarich_api_key: dawarichApiKey || null,
        immich_url: immichUrl || null,
        immich_api_key: immichApiKey || null,
        maloja_url: malojaUrl || null,
        // Send the raw string: an empty string clears the filter server-side.
        plex_usernames: plexUsernames,
        tmdb_api_key: tmdbApiKey || null,
        tgdb_api_key: tgdbApiKey || null,
        hardcover_api_key: hardcoverApiKey || null,
        llm_api_url: llmApiUrl || null,
        llm_model: llmModel || null,
        llm_reasoning_level: llmReasoningLevel || null,
        llm_context_window: Number.isFinite(contextWindowNum) && contextWindowNum > 0 ? contextWindowNum : null,
        llm_image_support: llmImageSupport,
      });
      setIntegrationMsg({ type: 'success', text: 'Integration settings saved.' });
    } catch (err) {
      setIntegrationMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save.' });
    } finally {
      setIntegrationSaving(false);
    }
  };

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-6 space-y-4">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
        <Link2 size={20} className="text-gray-600 dark:text-gray-400" />
        Integrations
      </h2>

      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Dawarich</h3>
          <div className="space-y-2">
            <div>
              <label className="block text-xs text-gray-500 mb-1">URL</label>
              <input
                type="url"
                value={dawarichUrl}
                onChange={(e) => setDawarichUrl(e.target.value)}
                className="input"
                placeholder="https://dawarich.example.com"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">API Key</label>
              <input
                type="password"
                value={dawarichApiKey}
                onChange={(e) => setDawarichApiKey(e.target.value)}
                className="input"
                placeholder="Enter API key"
              />
            </div>
          </div>
        </div>

        <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Immich</h3>
          <div className="space-y-2">
            <div>
              <label className="block text-xs text-gray-500 mb-1">URL</label>
              <input
                type="url"
                value={immichUrl}
                onChange={(e) => setImmichUrl(e.target.value)}
                className="input"
                placeholder="https://immich.example.com"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">API Key</label>
              <input
                type="password"
                value={immichApiKey}
                onChange={(e) => setImmichApiKey(e.target.value)}
                className="input"
                placeholder="Enter API key"
              />
            </div>
          </div>
        </div>

        <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Maloja</h3>
          <p className="text-xs text-gray-500 mb-2">
            Connect to your Maloja scrobble server to show what music you were listening to around each check-in.
          </p>
          <div>
            <label className="block text-xs text-gray-500 mb-1">URL</label>
            <input
              type="url"
              value={malojaUrl}
              onChange={(e) => setMalojaUrl(e.target.value)}
              className="input"
              placeholder="https://maloja.example.com"
            />
          </div>
        </div>

        <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-1.5">
            <Tv size={14} className="text-purple-600 dark:text-purple-400" />
            Plex
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
            Automatically track movies and TV shows you watch on your Plex server via{' '}
            <a href="https://support.plex.tv/articles/115002267687-webhooks/" target="_blank" rel="noreferrer" className="underline hover:text-gray-700 dark:hover:text-gray-200">Plex Webhooks</a>
            {' '}(a Plex Pass feature).
          </p>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Track only these Plex users</label>
              <input
                type="text"
                value={plexUsernames}
                onChange={(e) => setPlexUsernames(e.target.value)}
                className="input"
                placeholder="e.g. zach, steve"
              />
              <p className="text-[11px] text-gray-400 mt-1">
                Comma-separated Plex usernames. Leave empty to track media watched by anyone.
              </p>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Webhook URL — add this under{' '}
                <a href="https://app.plex.tv/desktop/#!/settings/webhooks" target="_blank" rel="noreferrer" className="underline hover:text-gray-700 dark:hover:text-gray-200">Plex Webhooks Settings</a>
              </label>
              <div className="flex items-center gap-2">
                <code className="flex-1 min-w-0 truncate rounded-lg bg-gray-100 dark:bg-gray-800 px-3 py-2 text-xs font-mono text-gray-800 dark:text-gray-200">
                  {plexWebhookUrl}
                </code>
                <button
                  onClick={handlePlexCopy}
                  title={plexCopied ? 'Copied!' : 'Copy URL'}
                  className="shrink-0 flex items-center gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 px-2.5 py-2 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                >
                  {plexCopied ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
                  {plexCopied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                {plexEventCount === null
                  ? 'Loading webhook stats…'
                  : `${plexEventCount} Webhook Event${plexEventCount === 1 ? '' : 's'} Received`}
              </p>
            </div>
          </div>
        </div>

        <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-1.5">
            <Film size={14} className="text-red-500" />
            Media Databases
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            API keys used to search for movies, TV shows, video games, and books when creating a media check-in.
          </p>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
                The Movie Database (TMDB) — movies & TV shows
              </label>
              <input
                type="password"
                value={tmdbApiKey}
                onChange={(e) => setTmdbApiKey(e.target.value)}
                className="input"
                placeholder="TMDB API key"
              />
              <p className="text-[11px] text-gray-400 mt-1">
                Get a key at <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer" className="underline hover:text-gray-600">themoviedb.org</a>
              </p>
            </div>
            <div>
              <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
                TheGamesDB (TGDB) — video games
              </label>
              <input
                type="password"
                value={tgdbApiKey}
                onChange={(e) => setTgdbApiKey(e.target.value)}
                className="input"
                placeholder="TGDB API key"
              />
              <p className="text-[11px] text-gray-400 mt-1">
                Get a key at <a href="https://www.thegamesdb.net/" target="_blank" rel="noreferrer" className="underline hover:text-gray-600">thegamesdb.net</a>
              </p>
            </div>
            <div>
              <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
                <BookOpen size={11} className="inline mr-1" />
                Hardcover — books
              </label>
              <input
                type="password"
                value={hardcoverApiKey}
                onChange={(e) => setHardcoverApiKey(e.target.value)}
                className="input"
                placeholder="Hardcover API key"
              />
              <p className="text-[11px] text-gray-400 mt-1">
                Get a key at <a href="https://hardcover.app/settings/api" target="_blank" rel="noreferrer" className="underline hover:text-gray-600">hardcover.app</a>
              </p>
            </div>
          </div>
        </div>

        <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-1.5">
            <Sparkles size={14} className="text-purple-500" />
            Life Summary (LLM)
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
            Connect to an OpenAI-compatible LLM (e.g. a local vLLM instance) to generate AI summaries of a period of your life.
          </p>
          <div className="space-y-2">
            <div>
              <label className="block text-xs text-gray-500 mb-1">OpenAI-Compatible API URL</label>
              <input
                type="url"
                value={llmApiUrl}
                onChange={(e) => setLlmApiUrl(e.target.value)}
                className="input"
                placeholder="http://vllm.example.com:8000/v1"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Model Name</label>
              <input
                type="text"
                value={llmModel}
                onChange={(e) => setLlmModel(e.target.value)}
                className="input"
                placeholder="meta-llama/Llama-3.1-70B-Instruct"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Reasoning Level</label>
                <input
                  type="text"
                  value={llmReasoningLevel}
                  onChange={(e) => setLlmReasoningLevel(e.target.value)}
                  className="input"
                  placeholder="medium"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Context Window (tokens)</label>
                <input
                  type="number"
                  value={llmContextWindow}
                  onChange={(e) => setLlmContextWindow(e.target.value)}
                  className="input"
                  min={1000}
                  step={1000}
                  placeholder="262144"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={llmImageSupport}
                onChange={(e) => setLlmImageSupport(e.target.checked)}
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              Image support (send Immich photos from the selected period to the LLM)
            </label>
          </div>
        </div>

        <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-1.5">
            <Moon size={14} className="text-indigo-500" />
            Sleep as Android
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            Enter this URL in Sleep as Android under Settings → Services → Automation → Webhooks to receive live sleep tracking events.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 truncate rounded-lg bg-gray-100 dark:bg-gray-800 px-3 py-2 text-xs font-mono text-gray-800 dark:text-gray-200">
              {webhookUrl}
            </code>
            <button
              onClick={handleWebhookCopy}
              title={webhookCopied ? 'Copied!' : 'Copy URL'}
              className="shrink-0 flex items-center gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 px-2.5 py-2 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              {webhookCopied ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
              {webhookCopied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            {webhookEventCount === null
              ? 'Loading webhook stats…'
              : `${webhookEventCount} Webhook Event${webhookEventCount === 1 ? '' : 's'} Received`}
          </p>
        </div>
      </div>

      {integrationMsg && (
        <div className={`flex items-center gap-2 text-sm ${integrationMsg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
          {integrationMsg.type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
          {integrationMsg.text}
        </div>
      )}
      <button onClick={saveIntegrations} disabled={integrationSaving} className="btn-primary">
        {integrationSaving ? <Loader2 size={16} className="animate-spin mr-2" /> : null}
        Save Integrations
      </button>
    </div>
  );
}
