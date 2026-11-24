import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, Gamepad2, RefreshCw } from 'lucide-react';
import { plugins } from '../../../client/src/plugins/api';
import { jobs } from '../../../client/src/api/client';
import { steam } from './api';
import type { SteamStatus } from './types';
import { SteamReview } from './SteamReview';

const JOB_TYPE = 'steam-sync';
const POLL_MS = 2000;

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function summaryText(status: SteamStatus): string | null {
  const s = status.last_summary;
  if (!s) return null;
  return `${s.games} games · ${s.matched} linked · ${s.time_updated} time played updated · ${s.checkins_created} check-ins added`;
}

/**
 * Settings > Media > Steam. The key and the resolved SteamID64 live in the
 * media plugin's settings store. Saving verifies them with Steam first, so a
 * profile URL or custom URL name is stored as the SteamID64 it resolves to.
 */
export function SteamSettings() {
  const [apiKey, setApiKey] = useState('');
  const [steamId, setSteamId] = useState('');
  const [autoSync, setAutoSync] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [status, setStatus] = useState<SteamStatus | null>(null);
  // Bumped after each sync so the review list reloads.
  const [reviewVersion, setReviewVersion] = useState(0);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadStatus = useCallback(() => {
    steam.status().then(setStatus).catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    plugins.settings
      .get('media')
      .then((s) => {
        const v = s as Record<string, unknown>;
        setApiKey(typeof v.steam_api_key === 'string' ? v.steam_api_key : '');
        setSteamId(typeof v.steam_id === 'string' ? v.steam_id : '');
        setAutoSync(v.steam_auto_sync !== false);
        setLoaded(true);
      })
      .catch((err) => {
        setMsg({
          type: 'error',
          text: `Could not load Steam settings (${err instanceof Error ? err.message : 'unknown error'}). Reload to edit them.`,
        });
      });
    loadStatus();
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [loadStatus]);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const key = apiKey.trim();
      const id = steamId.trim();
      if (!key && !id) {
        await plugins.settings.set('media', { steam_api_key: null, steam_id: null, steam_auto_sync: autoSync });
        setMsg({ type: 'success', text: 'Steam disconnected.' });
      } else if (!key || !id) {
        setMsg({ type: 'error', text: 'Enter both a Steam API key and a Steam ID.' });
        return;
      } else {
        const verified = await steam.verify(key, id);
        await plugins.settings.set('media', {
          steam_api_key: key,
          steam_id: verified.steamid64,
          steam_auto_sync: autoSync,
        });
        setSteamId(verified.steamid64);
        setMsg({
          type: 'success',
          text: `Connected as ${verified.persona_name} · ${verified.game_count} games.`,
        });
      }
      loadStatus();
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save.' });
    } finally {
      setSaving(false);
    }
  };

  const pollJob = (jobId: string) => {
    pollTimer.current = setTimeout(async () => {
      try {
        const job = await jobs.get(jobId);
        const message = job?.progress?.message;
        if (typeof message === 'string') setSyncMessage(message);
        if (job.status === 'pending' || job.status === 'running') {
          pollJob(jobId);
          return;
        }
        setSyncing(false);
        if (job.status === 'failed') {
          setSyncMessage(null);
          setMsg({ type: 'error', text: job.error || 'Steam sync failed.' });
        }
        loadStatus();
        setReviewVersion((v) => v + 1);
      } catch {
        setSyncing(false);
        setSyncMessage(null);
      }
    }, POLL_MS);
  };

  const syncNow = async () => {
    setSyncing(true);
    setMsg(null);
    setSyncMessage('Starting Steam sync...');
    try {
      const job = await jobs.start(JOB_TYPE);
      pollJob(job.id);
    } catch (err) {
      setSyncing(false);
      setSyncMessage(null);
      setMsg({ type: 'error', text: err instanceof Error ? err.message : 'Could not start the sync.' });
    }
  };

  const configured = status?.configured ?? false;

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2 flex items-center gap-2">
        <Gamepad2 size={20} className="text-sky-600 dark:text-sky-400" />
        Steam
      </h2>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        Sync time played from your Steam library. A game&rsquo;s time played is only raised, never lowered,
        and new play adds an &ldquo;in progress&rdquo; check-in unless you already logged one.
      </p>
      <div className="space-y-3">
        <div>
          <label htmlFor="steam-api-key" className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
            Steam Web API key
          </label>
          <input
            id="steam-api-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="input"
            placeholder="Steam Web API key"
            autoComplete="off"
          />
          <p className="text-[11px] text-gray-400 mt-1">
            Get a key at{' '}
            <a href="https://steamcommunity.com/dev/apikey" target="_blank" rel="noreferrer" className="underline hover:text-gray-600">
              steamcommunity.com/dev/apikey
            </a>
            .
          </p>
        </div>
        <div>
          <label htmlFor="steam-id" className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
            Steam ID
          </label>
          <input
            id="steam-id"
            type="text"
            value={steamId}
            onChange={(e) => setSteamId(e.target.value)}
            className="input"
            placeholder="SteamID64, profile URL, or custom URL name"
            autoComplete="off"
          />
          <p className="text-[11px] text-gray-400 mt-1">
            Your profile&rsquo;s &ldquo;Game details&rdquo; privacy must be set to Public.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input type="checkbox" checked={autoSync} onChange={(e) => setAutoSync(e.target.checked)} />
          Sync automatically every hour
        </label>
      </div>

      <div className="flex flex-wrap gap-2 mt-3">
        <button type="button" onClick={save} disabled={!loaded || saving} className="btn-primary">
          {saving ? 'Verifying…' : 'Save & Verify Steam'}
        </button>
        <button
          type="button"
          onClick={syncNow}
          disabled={!configured || syncing}
          className="btn-secondary inline-flex items-center gap-1.5"
          title={configured ? undefined : 'Save a Steam API key and Steam ID first.'}
        >
          <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Syncing…' : 'Sync Steam Now'}
        </button>
      </div>

      {msg && (
        <div className={`flex items-center gap-2 text-sm mt-2 ${msg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
          {msg.type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
          {msg.text}
        </div>
      )}
      {syncing && syncMessage && <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">{syncMessage}</p>}
      {!syncing && status && (status.last_synced_at || status.last_error) && (
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-2 space-y-0.5">
          {status.last_synced_at && (
            <p>
              Last synced {formatWhen(status.last_synced_at)}
              {summaryText(status) ? ` · ${summaryText(status)}` : ''}
            </p>
          )}
          {status.last_error && status.last_attempt_at && (
            <p className="text-red-600">
              Last sync failed {formatWhen(status.last_attempt_at)}: {status.last_error}
            </p>
          )}
        </div>
      )}

      {configured && status && (status.unmatched_all > 0 || status.ignored > 0) && (
        <SteamReview key={reviewVersion} status={status} onChange={loadStatus} />
      )}
    </div>
  );
}
