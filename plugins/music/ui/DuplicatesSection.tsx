/**
 * Settings > Music: find and remove plays that can't have happened (bursts of
 * one song scrobbled seconds apart, mostly from Last.fm histories). Scanning
 * is a dry run; removal asks first, and the removed plays can be downloaded
 * in a file the Maloja import restores.
 */

import { useMemo, useState } from 'react';
import { AlertCircle, Check, ChevronDown, ChevronRight, Download, Loader2, Search, Trash2 } from 'lucide-react';
import { music } from './api';
import { formatDay, formatLength, joinArtists } from './format';
import { removedPlaysFile } from './duplicatesFile';
import type { DuplicateBurst, DuplicateScan, RemovedPlay } from './types';

const CARD =
  'bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-6 space-y-4';
const PAGE = 50;

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

/** "2:04:11 PM", in the play's own zone (bursts are seconds apart, so seconds matter). */
function clockWithSeconds(iso: string, timeZone: string | null): string {
  const options: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', second: '2-digit' };
  try {
    return new Intl.DateTimeFormat('en-US', { ...options, ...(timeZone ? { timeZone } : {}) }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat('en-US', options).format(new Date(iso));
  }
}

function sourceShort(source: string | null): string {
  switch (source) {
    case 'lastfm':
      return 'Last.fm import';
    case 'multi-scrobbler':
      return 'multi-scrobbler';
    case 'manual':
      return 'by hand';
    case 'import':
      return 'import';
    default:
      return source ?? 'unknown';
  }
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function BurstRow({ burst, checked, onToggle }: { burst: DuplicateBurst; checked: boolean; onToggle: () => void }) {
  const [open, setOpen] = useState(false);
  const zone = burst.keep[0].timezone;
  const removed = burst.remove;
  const all = useMemo(
    () =>
      [...burst.keep.map((p) => ({ p, kept: true })), ...removed.map((p) => ({ p, kept: false }))].sort((a, b) =>
        a.p.played_at.localeCompare(b.p.played_at),
      ),
    [burst, removed],
  );
  const first = removed[0].played_at;
  const last = removed[removed.length - 1].played_at;
  return (
    <li className="py-2">
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          aria-label={`Remove the duplicates of ${burst.title} on ${formatDay(burst.keep[0].played_at, zone)}`}
          className="mt-1"
        />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-start gap-1 text-left"
        >
          {open ? <ChevronDown size={14} className="mt-0.5 shrink-0 text-gray-400" /> : <ChevronRight size={14} className="mt-0.5 shrink-0 text-gray-400" />}
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">
              {burst.title} <span className="font-normal text-gray-500">· {joinArtists(burst.artists)}</span>
            </span>
            <span className="block text-xs text-gray-500 dark:text-gray-400">
              {formatDay(burst.keep[0].played_at, zone)}: keeps {burst.keep.length === 1 ? 'one play' : plural(burst.keep.length, 'play')}, removes{' '}
              <span className="font-medium text-red-600 dark:text-red-400">{removed.length.toLocaleString()}</span>
              {removed.length > 1 ? ` (${clockWithSeconds(first, zone)} – ${clockWithSeconds(last, zone)})` : ` (${clockWithSeconds(first, zone)})`}
            </span>
          </span>
        </button>
      </div>
      {open && (
        <div className="ml-6 mt-2 space-y-1">
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            {burst.length != null
              ? `The song is ${formatLength(burst.length)} long, so a real repeat starts at least ${burst.threshold}s after the last one.`
              : `The song's length is unknown, so only plays under ${burst.threshold}s apart count as impossible.`}
          </p>
          <ol className="max-h-64 overflow-y-auto text-xs tabular-nums">
            {all.map(({ p, kept }) => (
              <li key={p.id} className={`flex gap-2 ${kept ? 'text-green-700 dark:text-green-400' : 'text-gray-500 line-through decoration-red-400/60'}`}>
                <span className="w-24 shrink-0">{clockWithSeconds(p.played_at, p.timezone)}</span>
                <span className="w-28 shrink-0">{sourceShort(p.source)}</span>
                <span>{kept ? (p.protected ? 'kept (has your notes)' : 'kept') : 'removed'}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </li>
  );
}

export function DuplicatesSection({ onRemoved }: { onRemoved: () => void }) {
  const [scan, setScan] = useState<DuplicateScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState(PAGE);
  const [removing, setRemoving] = useState(false);
  const [removed, setRemoved] = useState<RemovedPlay[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runScan = async () => {
    setScanning(true);
    setError(null);
    setRemoved(null);
    try {
      setScan(await music.duplicates());
      setSkipped(new Set());
      setShown(PAGE);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed.');
    } finally {
      setScanning(false);
    }
  };

  const chosen = useMemo(() => (scan ? scan.bursts.filter((b) => !skipped.has(b.id)) : []), [scan, skipped]);
  const chosenPlays = useMemo(() => chosen.flatMap((b) => b.remove), [chosen]);
  const songs = useMemo(() => new Set(chosen.map((b) => b.song_key)).size, [chosen]);

  const toggle = (id: string) =>
    setSkipped((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const remove = async () => {
    if (chosenPlays.length === 0) return;
    const message =
      `Remove ${plural(chosenPlays.length, 'play')} from ${plural(chosen.length, 'burst')}? ` +
      'One play of each burst stays. You can download the removed plays afterwards to restore them.';
    if (!window.confirm(message)) return;
    setRemoving(true);
    setError(null);
    try {
      const result = await music.removeDuplicates(chosenPlays.map((p) => p.id));
      setRemoved(result.plays);
      setScan(null);
      onRemoved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Removal failed.');
    } finally {
      setRemoving(false);
    }
  };

  const stamp = () => new Date().toISOString().slice(0, 10);

  return (
    <div className={CARD}>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Duplicate plays</h2>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Finds plays of a song that start too soon after the previous play of that song to be a real second listen: sooner
        than half the song (at most 4 minutes), or 30 seconds when its length is unknown. These are usually bursts in an
        imported Last.fm history. Each burst keeps one play, preferring a live scrobble; plays you wrote down by hand or
        added a note, place or companions to are always kept. Scanning changes nothing.
      </p>
      <button type="button" onClick={runScan} disabled={scanning || removing} className="btn-secondary inline-flex items-center gap-1.5 text-xs">
        {scanning ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
        {scan ? 'Scan again' : 'Scan for duplicates'}
      </button>

      {scan && scan.bursts.length === 0 && (
        <div className="flex items-start gap-2 rounded-lg bg-green-50 dark:bg-green-900/20 p-3 text-sm text-green-700 dark:text-green-300">
          <Check size={16} className="mt-0.5 shrink-0" />
          <span>No impossible duplicates found.</span>
        </div>
      )}

      {scan && scan.bursts.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-gray-700 dark:text-gray-300" role="status">
            Found {plural(scan.removable, 'play')} to remove in {plural(scan.bursts.length, 'burst')}.
            {chosen.length !== scan.bursts.length && ` Selected: ${plural(chosenPlays.length, 'play')} in ${plural(chosen.length, 'burst')}.`}
            {` Across ${plural(songs, 'song')}.`}
          </p>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <button type="button" onClick={() => setSkipped(new Set())} className="text-primary-600 hover:underline">
              Select all
            </button>
            <button type="button" onClick={() => setSkipped(new Set(scan.bursts.map((b) => b.id)))} className="text-primary-600 hover:underline">
              Select none
            </button>
          </div>
          <ul className="divide-y divide-gray-100 dark:divide-gray-800" aria-label="Duplicate bursts">
            {scan.bursts.slice(0, shown).map((b) => (
              <BurstRow key={b.id} burst={b} checked={!skipped.has(b.id)} onToggle={() => toggle(b.id)} />
            ))}
          </ul>
          {shown < scan.bursts.length && (
            <button type="button" onClick={() => setShown((n) => n + PAGE)} className="text-xs font-medium text-primary-600 hover:underline">
              Show {Math.min(PAGE, scan.bursts.length - shown)} more of {scan.bursts.length.toLocaleString()}
            </button>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => download(`removed-plays-preview-${stamp()}.json`, removedPlaysFile(chosenPlays))}
              disabled={chosenPlays.length === 0}
              className="btn-secondary inline-flex items-center gap-1.5 text-xs"
            >
              <Download size={13} />
              Download selected plays
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={removing || chosenPlays.length === 0}
              className="btn-primary inline-flex items-center gap-1.5 bg-red-600 hover:bg-red-700"
            >
              {removing ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
              Remove {plural(chosenPlays.length, 'play')}
            </button>
          </div>
        </div>
      )}

      {removed && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-green-50 dark:bg-green-900/20 p-3 text-sm text-green-700 dark:text-green-300">
          <Check size={16} className="shrink-0" />
          <span>Removed {plural(removed.length, 'play')}. Listening sessions have been regrouped.</span>
          {removed.length > 0 && (
            <button
              type="button"
              onClick={() => download(`removed-plays-${stamp()}.json`, removedPlaysFile(removed))}
              className="btn-secondary inline-flex items-center gap-1.5 text-xs"
            >
              <Download size={13} />
              Download removed plays
            </button>
          )}
          <span className="basis-full text-xs text-gray-600 dark:text-gray-400">
            To put them back, import the downloaded file with “Import from Maloja” below.
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
