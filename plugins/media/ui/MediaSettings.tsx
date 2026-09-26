import { useState, useEffect } from 'react';
import { Check, Copy, Clapperboard, Tv, Film, Gamepad2, BookOpen } from 'lucide-react';
import { plugins } from '../../../client/src/plugins/api';
import { plexWebhook } from './api';
import { YamtrackImportSection } from './YamtrackImportSection';

interface MediaPluginSettings {
  plex_usernames?: string | null;
  tmdb_api_key?: string | null;
  hardcover_api_key?: string | null;
  igdb_client_id?: string | null;
  igdb_client_secret?: string | null;
}

/**
 * Media > Settings tab. Self-contained settings tab rendered by the core
 * Settings page through the plugin `settings` slot. Hosts the Plex webhook
 * section and the media-database API keys, moved out of the core Integrations
 * tab so they live under Settings > Media. All values live in this plugin's
 * settings store (`plugin_settings`, plugin_id = 'media') rather than the
 * core `user_settings` table.
 */
export function MediaSettings() {
  const [plexUsernames, setPlexUsernames] = useState('');
  const [tmdbApiKey, setTmdbApiKey] = useState('');
  const [hardcoverApiKey, setHardcoverApiKey] = useState('');
  const [igdbClientId, setIgdbClientId] = useState('');
  const [igdbClientSecret, setIgdbClientSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [plexEventCount, setPlexEventCount] = useState<number | null>(null);
  const [plexCopied, setPlexCopied] = useState(false);
  const plexWebhookUrl = `${window.location.origin}/api/v1/webhook/plex`;

  useEffect(() => {
    plugins.settings
      .get('media')
      .then((s) => {
        const settings = s as unknown as MediaPluginSettings;
        setPlexUsernames(settings.plex_usernames ?? '');
        setTmdbApiKey(settings.tmdb_api_key ?? '');
        setHardcoverApiKey(settings.hardcover_api_key ?? '');
        setIgdbClientId(settings.igdb_client_id ?? '');
        setIgdbClientSecret(settings.igdb_client_secret ?? '');
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    plexWebhook.stats()
      .then((data) => setPlexEventCount(data.count))
      .catch(() => setPlexEventCount(null));
  }, []);

  const handlePlexCopy = () => {
    navigator.clipboard.writeText(plexWebhookUrl).then(() => {
      setPlexCopied(true);
      setTimeout(() => setPlexCopied(false), 2000);
    });
  };

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      // Send the raw string for plex_usernames: an empty string clears the filter server-side.
      await plugins.settings.set('media', {
        plex_usernames: plexUsernames,
        tmdb_api_key: tmdbApiKey || null,
        hardcover_api_key: hardcoverApiKey || null,
        igdb_client_id: igdbClientId || null,
        igdb_client_secret: igdbClientSecret || null,
      });
      setMsg({ type: 'success', text: 'Media settings saved.' });
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
    <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-6 space-y-4">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
        <Clapperboard size={20} className="text-violet-500" />
        Media
      </h2>

      {/* Plex */}
      <div>
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

      {/* Media databases */}
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
              <Gamepad2 size={11} className="inline mr-1" />
              IGDB — video games
            </label>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={igdbClientId}
                onChange={(e) => setIgdbClientId(e.target.value)}
                className="input"
                placeholder="Twitch Client ID"
              />
              <input
                type="password"
                value={igdbClientSecret}
                onChange={(e) => setIgdbClientSecret(e.target.value)}
                className="input"
                placeholder="Twitch Client Secret"
              />
            </div>
            <p className="text-[11px] text-gray-400 mt-1">
              Create a free application at{' '}
              <a href="https://dev.twitch.tv/console/apps" target="_blank" rel="noreferrer" className="underline hover:text-gray-600">dev.twitch.tv/console</a>{' '}
              and use its Client ID / Client Secret (no redirect URL needed).
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

      {msg && (
        <div className={`flex items-center gap-2 text-sm ${msg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
          {msg.type === 'success' ? <Check size={16} /> : null}
          {msg.text}
        </div>
      )}
      <button onClick={save} disabled={saving} className="btn-primary">
        {saving ? 'Saving…' : 'Save Media Settings'}
      </button>
    </div>

    <YamtrackImportSection />
    </>
  );
}
