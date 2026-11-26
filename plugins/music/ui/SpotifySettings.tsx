/**
 * Settings > Music > Spotify: the user's own Spotify app (Client ID and
 * Secret), signing in with it, and the playlist sync.
 */

import { useEffect, useState } from 'react';
import { AlertCircle, Check, Loader2, LogIn, RefreshCw, Trash2 } from 'lucide-react';
import { spotify } from './api';
import { CopyField } from './CopyField';
import { refreshSpotifyStatus, useSpotifyStatus } from './useSpotifyStatus';
import { useSpotifySync } from './useSpotifySync';

const CARD =
  'bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-6 space-y-4';
const INPUT =
  'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-mono text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100';

type Msg = { type: 'success' | 'error'; text: string } | null;

/** Read (and clear) the outcome the sign-in redirect left in the URL. */
function takeSignInOutcome(): Msg {
  const url = new URL(window.location.href);
  const ok = url.searchParams.get('spotify');
  const error = url.searchParams.get('spotify_error');
  if (!ok && !error) return null;
  url.searchParams.delete('spotify');
  url.searchParams.delete('spotify_error');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  return error ? { type: 'error', text: error } : { type: 'success', text: 'Spotify is connected. Syncing your playlists…' };
}

function Message({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <p className={`flex items-start gap-1.5 text-xs ${msg.type === 'error' ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-400'}`} role="status">
      {msg.type === 'error' ? <AlertCircle size={14} className="mt-px shrink-0" /> : <Check size={14} className="mt-px shrink-0" />}
      {msg.text}
    </p>
  );
}

export function SpotifySettings() {
  const status = useSpotifyStatus();
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const sync = useSpotifySync();
  const syncing = sync.syncing;
  const syncMessage = sync.message;
  const syncNow = sync.start;
  const redirectUri = `${window.location.origin}${status?.callback_path ?? '/api/v1/music/spotify/callback'}`;
  // Spotify only accepts https redirects, or http on a loopback address.
  const insecure = window.location.protocol === 'http:' && !['127.0.0.1', '[::1]'].includes(window.location.hostname);

  // Back from Spotify's sign-in page: report it, and sync right away when it worked.
  useEffect(() => {
    const outcome = takeSignInOutcome();
    if (!outcome) return;
    setMsg(outcome);
    void refreshSpotifyStatus();
    if (outcome.type === 'success') void syncNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (action: () => Promise<unknown>, success: string | null) => {
    setBusy(true);
    setMsg(null);
    try {
      await action();
      if (success) setMsg({ type: 'success', text: success });
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : 'Something went wrong.' });
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      await spotify.saveCredentials(clientId, clientSecret);
      setClientSecret('');
      setEditing(false);
      await refreshSpotifyStatus();
    }, 'Spotify app saved. Now connect your account.');

  const connect = () =>
    run(async () => {
      window.location.href = (await spotify.authorize()).url;
    }, null);

  const disconnect = () => {
    if (!window.confirm('Disconnect your Spotify account? Synced playlists stay until you connect again.')) return;
    void run(async () => {
      await spotify.disconnect();
      await refreshSpotifyStatus();
    }, 'Disconnected from Spotify.');
  };

  const remove = () => {
    if (!window.confirm('Remove Spotify? This forgets your app, signs you out and removes the synced playlists.')) return;
    void run(async () => {
      await spotify.remove();
      setEditing(false);
      await refreshSpotifyStatus();
    }, 'Spotify removed.');
  };

  if (!status) {
    return (
      <div className={CARD}>
        <Loader2 size={20} className="animate-spin text-primary-600" />
      </div>
    );
  }

  const showForm = !status.configured || editing;
  const summary = status.last_summary;

  return (
    <div className={CARD}>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
        <span className="inline-block h-5 w-5 rounded-full bg-green-500" aria-hidden />
        Spotify
      </h2>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Adds Open in Spotify to song, album and artist pages, a Playlists tab under Profile → Music with your plays of each
        playlist's tracks, and Export to Spotify for your lists.
      </p>

      {showForm && (
        <div className="space-y-3">
          <ol className="list-decimal space-y-1 pl-5 text-xs text-gray-600 dark:text-gray-300">
            <li>
              Create an app in the{' '}
              <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:underline">
                Spotify developer dashboard
              </a>{' '}
              and tick <strong>Web API</strong>. The app's owner needs Spotify Premium.
            </li>
            <li>Add this Redirect URI to the app:</li>
          </ol>
          <CopyField label="Redirect URI" value={redirectUri} />
          {insecure && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Spotify only accepts https addresses (or http://127.0.0.1). Open WhereWeWere through its https address before connecting.
            </p>
          )}
          <ol start={3} className="list-decimal space-y-1 pl-5 text-xs text-gray-600 dark:text-gray-300">
            <li>
              Under <strong>User Management</strong>, add the Spotify account you'll sign in with (apps in Development Mode only work for
              accounts listed there).
            </li>
            <li>Paste the app's Client ID and Client Secret here.</li>
          </ol>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-gray-500">
              Client ID
              <input className={`${INPUT} mt-1`} value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" spellCheck={false} />
            </label>
            <label className="block text-xs text-gray-500">
              Client Secret
              <input
                className={`${INPUT} mt-1`}
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={save} disabled={busy || !clientId.trim() || !clientSecret.trim()} className="btn-primary text-xs">
              {busy ? <Loader2 size={13} className="animate-spin" /> : 'Save Spotify app'}
            </button>
            {editing && (
              <button type="button" onClick={() => setEditing(false)} className="btn-secondary text-xs">
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {status.configured && !editing && (
        <div className="space-y-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            App <code className="font-mono">{status.client_id?.slice(0, 8)}…</code>
            {' · '}
            {status.connected ? (
              <span className="text-green-700 dark:text-green-400">Connected as {status.display_name ?? status.spotify_user_id}</span>
            ) : (
              'Not connected'
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            {!status.connected && (
              <button type="button" onClick={connect} disabled={busy} className="btn-primary inline-flex items-center gap-1.5 text-xs">
                <LogIn size={13} />
                Connect Spotify
              </button>
            )}
            {status.connected && (
              <button type="button" onClick={syncNow} disabled={syncing || busy} className="btn-secondary inline-flex items-center gap-1.5 text-xs">
                <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
                Sync playlists now
              </button>
            )}
            {status.connected && (
              <button type="button" onClick={disconnect} disabled={busy || syncing} className="btn-secondary text-xs">
                Disconnect
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setClientId(status.client_id ?? '');
                setClientSecret('');
                setEditing(true);
              }}
              disabled={busy || syncing}
              className="btn-secondary text-xs"
            >
              Change app
            </button>
            <button type="button" onClick={remove} disabled={busy || syncing} className="btn-secondary inline-flex items-center gap-1.5 text-xs text-red-600">
              <Trash2 size={13} />
              Remove
            </button>
          </div>
          {!status.connected && <CopyField label="Redirect URI (must be in your Spotify app)" value={redirectUri} />}
          {syncing && syncMessage && (
            <p className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
              <Loader2 size={13} className="animate-spin" />
              {syncMessage}
            </p>
          )}
          {!syncing && status.last_synced_at && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {status.playlists.toLocaleString()} playlist{status.playlists === 1 ? '' : 's'}, last synced {new Date(status.last_synced_at).toLocaleString()}
              {summary && summary.unavailable > 0 && (
                <>
                  . Spotify doesn't share the tracks of {summary.unavailable} playlist{summary.unavailable === 1 ? '' : 's'} you follow but don't own,
                  so they show without plays
                </>
              )}
              . Playlists sync once a day.
            </p>
          )}
          {!syncing && status.last_error && (
            <p className="flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400">
              <AlertCircle size={14} className="mt-px shrink-0" />
              Last sync: {status.last_error}
            </p>
          )}
        </div>
      )}

      <Message msg={msg ?? (sync.error ? { type: 'error', text: sync.error } : null)} />
    </div>
  );
}
