/**
 * Settings > Music: connection details for multi-scrobbler, timeline/session
 * preferences, and the scrobble-history import.
 */

import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, Copy, Loader2, Music, RefreshCw, Upload } from 'lucide-react';
import { copyText } from '../../../client/src/utils/clipboard';
import { music } from './api';
import type { AlbumStatus, MusicImportResult, MusicSettingsData } from './types';

const CARD =
  'bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-6 space-y-4';

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    copyText(value).then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <code className="flex-1 min-w-0 truncate rounded-lg bg-gray-100 dark:bg-gray-800 px-3 py-2 text-xs font-mono text-gray-800 dark:text-gray-200">
          {value}
        </code>
        <button
          type="button"
          onClick={copy}
          title={copied ? 'Copied!' : `Copy ${label}`}
          className="shrink-0 flex items-center gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 px-2.5 py-2 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        >
          {copied ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

function ConnectionSection({ settings, onKeyChanged }: { settings: MusicSettingsData; onKeyChanged: (key: string) => void }) {
  const [busy, setBusy] = useState(false);
  const url = window.location.origin;

  const regenerate = async () => {
    if (!window.confirm('Generate a new key? Multi-scrobbler will stop scrobbling until you update it.')) return;
    setBusy(true);
    try {
      onKeyChanged((await music.regenerateKey()).scrobbler_key);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={CARD}>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
        <Music size={20} className="text-pink-500" />
        Multi-scrobbler
      </h2>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        WhereWeWere speaks the Maloja client protocol, the only one multi-scrobbler can reach with just a URL and key.
        Add a Maloja client with the values below (the ID is just a label). The URL must be reachable from the multi-scrobbler container.
      </p>
      <CopyField label="MALOJA_URL" value={url} />
      <CopyField label="MALOJA_ID" value="wherewewere" />
      <CopyField label="MALOJA_API_KEY" value={settings.scrobbler_key} />
      <button type="button" onClick={regenerate} disabled={busy} className="btn-secondary inline-flex items-center gap-1.5 text-xs">
        <RefreshCw size={13} className={busy ? 'animate-spin' : ''} />
        Regenerate key
      </button>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {settings.scrobbles.toLocaleString()} scrobble{settings.scrobbles === 1 ? '' : 's'} stored
        {settings.last_scrobbled_at ? `, last at ${new Date(settings.last_scrobbled_at).toLocaleString()}` : ''}.
      </p>
    </div>
  );
}

function PreferencesSection({ settings, onSaved }: { settings: MusicSettingsData; onSaved: (s: MusicSettingsData) => void }) {
  const [gap, setGap] = useState(String(settings.session_gap_minutes));
  const [minTracks, setMinTracks] = useState(String(settings.min_session_tracks));
  const [timezone, setTimezone] = useState(settings.timezone);
  const [saving, setSaving] = useState(false);
  const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const saved = await music.updateSettings({
        session_gap_minutes: Number(gap),
        min_session_tracks: Number(minTracks),
        timezone,
      });
      onSaved({ ...settings, ...saved });
      setMessage({ type: 'success', text: 'Saved.' });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={CARD}>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Timeline sessions</h2>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Plays are grouped into listening sessions, one timeline item each. Changing the gap regroups all history.
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Scrobbles carry no timezone, so each play takes the timezone of your latest check-in at or before it.
        The fallback timezone below is used for plays before your first check-in.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1" htmlFor="music-gap">Session gap (minutes)</label>
          <input id="music-gap" type="number" min={1} max={1440} value={gap} onChange={(e) => setGap(e.target.value)} className="input" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1" htmlFor="music-min">Minimum tracks on timeline</label>
          <input id="music-min" type="number" min={1} max={1000} value={minTracks} onChange={(e) => setMinTracks(e.target.value)} className="input" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1" htmlFor="music-tz">Fallback timezone</label>
          <input id="music-tz" type="text" value={timezone} onChange={(e) => setTimezone(e.target.value)} className="input" placeholder="e.g. America/Chicago" />
          {browserTimezone && browserTimezone !== timezone && (
            <button type="button" onClick={() => setTimezone(browserTimezone)} className="mt-1 text-xs text-primary-600 hover:underline">
              Use this device's timezone ({browserTimezone})
            </button>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={saving} className="btn-primary">
          {saving ? <Loader2 size={16} className="animate-spin" /> : 'Save'}
        </button>
        {message && (
          <span className={`text-xs ${message.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>{message.text}</span>
        )}
      </div>
    </div>
  );
}

function TimezoneSection({ onRefreshed }: { onRefreshed: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const refresh = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const { updated } = await music.refreshTimezones();
      setMessage({ type: 'success', text: `Updated ${updated.toLocaleString()} play${updated === 1 ? '' : 's'}.` });
      onRefreshed();
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to update.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={CARD}>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Play timezones</h2>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        New plays are assigned a timezone as they arrive. After adding or correcting check-ins (or importing history
        before the check-ins that cover it), re-assign every play from your current check-ins.
      </p>
      <div className="flex items-center gap-3">
        <button type="button" onClick={refresh} disabled={busy} className="btn-secondary inline-flex items-center gap-1.5 text-xs">
          <RefreshCw size={13} className={busy ? 'animate-spin' : ''} />
          Re-assign timezones
        </button>
        {message && (
          <span className={`text-xs ${message.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>{message.text}</span>
        )}
      </div>
    </div>
  );
}

function ImportSection({
  title,
  description,
  warning,
  accept,
  fileLabel,
  run: runImport,
  onImported,
}: {
  title: string;
  description: string;
  warning?: string;
  accept: string;
  fileLabel: string;
  run: (file: File) => Promise<MusicImportResult>;
  onImported: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<MusicImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!file) return;
    setImporting(true);
    setResult(null);
    setError(null);
    try {
      setResult(await runImport(file));
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className={CARD}>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
        <Upload size={20} className="text-gray-600 dark:text-gray-400" />
        {title}
      </h2>
      <p className="text-xs text-gray-500 dark:text-gray-400">{description}</p>
      {warning && (
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-800 dark:text-amber-200">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{warning}</span>
        </div>
      )}
      <div
        className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-6 text-center cursor-pointer hover:border-primary-400 transition-colors"
        onClick={() => inputRef.current?.click()}
      >
        <Upload size={24} className="mx-auto text-gray-400 mb-2" />
        <p className="text-sm text-gray-600 dark:text-gray-400">{file ? file.name : fileLabel}</p>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          aria-label={fileLabel}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setResult(null);
            setError(null);
          }}
        />
      </div>
      {file && (
        <button type="button" onClick={run} disabled={importing} className="btn-primary">
          {importing ? (<><Loader2 size={16} className="animate-spin mr-2" />Importing…</>) : (<><Upload size={16} className="mr-2" />Import</>)}
        </button>
      )}
      {result && (
        <div className="flex items-start gap-2 rounded-lg bg-green-50 dark:bg-green-900/20 p-3 text-sm text-green-700 dark:text-green-300">
          <Check size={16} className="mt-0.5 shrink-0" />
          <span>
            Imported {result.inserted.toLocaleString()} new scrobble{result.inserted === 1 ? '' : 's'}
            {result.duplicates > 0 ? `, ${result.duplicates.toLocaleString()} already present` : ''}
            {result.skipped > 0 ? `, ${result.skipped.toLocaleString()} unreadable` : ''}.
          </span>
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-300">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

function ArtworkSection() {
  const [status, setStatus] = useState<AlbumStatus | null>(null);
  const [retryMissing, setRetryMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = status?.job.state === 'running';

  const load = () => music.albumStatus().then(setStatus).catch(() => {});
  useEffect(() => {
    load();
  }, []);
  // Poll while the lookup runs.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [running]);

  const start = async () => {
    setError(null);
    try {
      await music.startAlbumBackfill(retryMissing);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start.');
    }
  };

  if (!status) return null;
  const { albums, job } = status;
  return (
    <div className={CARD}>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Album artwork</h2>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Covers, release dates and tracklists come from Deezer, with MusicBrainz as a fallback. Each album is looked up
        once and stored on this server; new albums are looked up as their first scrobble arrives. Importing history
        adds albums that need a lookup, so run this afterwards.
      </p>
      <p className="text-xs text-gray-600 dark:text-gray-300">
        {albums.matched.toLocaleString()} matched, {albums.not_found.toLocaleString()} not found,{' '}
        {albums.pending.toLocaleString()} waiting, of {albums.total.toLocaleString()} albums.
      </p>
      {!status.enabled && <p className="text-xs text-amber-600">Album lookup is turned off on this server.</p>}
      <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
        <input type="checkbox" checked={retryMissing} onChange={(e) => setRetryMissing(e.target.checked)} disabled={running} />
        Also retry albums that weren't found
      </label>
      <div className="flex items-center gap-3">
        <button type="button" onClick={start} disabled={running || !status.enabled} className="btn-primary">
          Look up album artwork
        </button>
        {running && (
          <button type="button" onClick={() => music.cancelAlbumBackfill().then(load)} className="btn-secondary text-xs">
            Cancel
          </button>
        )}
      </div>
      {running && (
        <p className="text-xs text-gray-600 dark:text-gray-300 flex items-center gap-2">
          <Loader2 size={13} className="animate-spin" />
          {job.processed.toLocaleString()} of {job.total.toLocaleString()} looked up: {job.matched.toLocaleString()} matched
        </p>
      )}
      {(job.state === 'done' || job.state === 'cancelled') && (
        <div className="flex items-start gap-2 rounded-lg bg-green-50 dark:bg-green-900/20 p-3 text-sm text-green-700 dark:text-green-300">
          <Check size={16} className="mt-0.5 shrink-0" />
          <span>
            {job.state === 'cancelled' ? 'Cancelled. ' : ''}Looked up {job.processed.toLocaleString()} album
            {job.processed === 1 ? '' : 's'}: {job.matched.toLocaleString()} matched, {job.not_found.toLocaleString()} not found.
          </span>
        </div>
      )}
      {(error || job.error) && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-300">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{error ?? job.error}. Progress is kept; run it again to continue.</span>
        </div>
      )}
    </div>
  );
}

export function MusicSettings() {
  const [settings, setSettings] = useState<MusicSettingsData | null>(null);
  const [error, setError] = useState(false);

  const load = () => music.settings().then(setSettings).catch(() => setError(true));
  useEffect(() => {
    load();
  }, []);

  if (error) return <p className="text-sm text-red-600">Couldn't load music settings.</p>;
  if (!settings) return <Loader2 className="animate-spin text-primary-600" size={24} />;

  return (
    <div className="space-y-4">
      <ConnectionSection settings={settings} onKeyChanged={(key) => setSettings({ ...settings, scrobbler_key: key })} />
      <PreferencesSection settings={settings} onSaved={setSettings} />
      <ArtworkSection />
      <TimezoneSection onRefreshed={load} />
      <ImportSection
        title="Import from Last.fm"
        description="Import a Last.fm history export (.csv with the columns uts, artist, album, track). Last.fm keeps each artist credit whole, so names like Above & Beyond stay intact. Plays you already have are skipped."
        accept=".csv,text/csv"
        fileLabel="Last.fm export (.csv)"
        run={music.importLastfm}
        onImported={load}
      />
      <ImportSection
        title="Import from Maloja"
        description="Import a Maloja .json export. Plays you already have are skipped, so it is safe to import after live scrobbling has started."
        warning="Maloja splits artist credits such as “Above & Beyond” into separate artists when it imports them, and an export cannot undo that. Prefer the Last.fm import for history that came from Last.fm."
        accept=".json,application/json"
        fileLabel="Scrobble export (.json)"
        run={music.importScrobbles}
        onImported={load}
      />
    </div>
  );
}
