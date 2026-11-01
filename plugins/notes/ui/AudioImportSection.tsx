/**
 * Settings > Notes > Import audio files.
 *
 * Drop (or pick) audio files and whole folders, as many batches as you like:
 * each drop adds to one staged list. Every file is checksummed in the browser,
 * the server plans a note for each (title and date from the filename, time zone
 * from your check-in history), and the review table lets you untick rows.
 * Import then uploads the files one by one (resumable, straight from disk),
 * creates a tagged note for each, and only when the run is over hands the audio
 * to the transcriber. Folders are walked recursively; only supported audio types
 * are staged.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, AlertTriangle, CheckCircle2, Clock, Copy, FileAudio, FolderOpen, Loader2, MapPin, Mic, Upload, X } from 'lucide-react';
import { isValidTimeZone } from 'wwp-shared';
import { deviceTimezone } from '../../../client/src/utils/slugify';
import { formatDate, formatTime } from '../../../client/src/utils/checkin';
import { AUDIO_FILE_ACCEPT } from '../audioTypes';
import { notesAudioImport, type AudioImportRow } from './api';
import { sha256Blob } from './audio/sha256';
import { uploadBlob } from './audio/uploader';
import {
  collectFromEntries, collectFromFileList, entriesFromDataTransfer, fileKey, type Collected, type CollectedFile,
} from './audio/collectFiles';
import TagChipInput from './TagChipInput';
import { TimezoneInput } from './TimezoneInput';

interface Staged {
  key: string;
  file: File;
  path: string;
  /** null until hashed. */
  sha256: string | null;
}

interface RunResult {
  imported: number;
  failures: { name: string; message: string }[];
  released: number;
  transcriptionConfigured: boolean;
  stopped: boolean;
}

interface Progress {
  index: number;
  total: number;
  name: string;
  sent: number;
  size: number;
}

const MAX_ROWS_SHOWN = 1000;

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(Math.round(bytes / 1024), 1)} KB`;
}

function Flags({ row }: { row: AudioImportRow }) {
  const flags: { icon: React.ReactNode; text: string; tone: string }[] = [];
  if (row.error) flags.push({ icon: <AlertCircle size={12} />, text: row.error, tone: 'text-red-600 dark:text-red-400' });
  if (row.duplicate === 'checksum') flags.push({ icon: <Copy size={12} />, text: 'Already imported (identical audio)', tone: 'text-amber-700 dark:text-amber-300' });
  if (row.duplicate === 'batch') flags.push({ icon: <Copy size={12} />, text: 'Same audio as another file in this list', tone: 'text-amber-700 dark:text-amber-300' });
  if (row.time_source === 'missing') {
    flags.push({ icon: <AlertTriangle size={12} />, text: 'No date in the name or file: dated today', tone: 'text-amber-700 dark:text-amber-300' });
  } else if (row.time_source === 'default_evening') {
    flags.push({ icon: <Clock size={12} />, text: '8pm (no matching file time)', tone: 'text-gray-500 dark:text-gray-400' });
  } else if (row.time_source === 'file_modified') {
    flags.push({ icon: <Clock size={12} />, text: 'Time from the file’s modified date', tone: 'text-gray-500 dark:text-gray-400' });
  }
  if (flags.length === 0) return null;
  return (
    <ul className="space-y-0.5">
      {flags.map((f) => (
        <li key={f.text} className={`flex items-center gap-1 text-[11px] ${f.tone}`}>{f.icon}{f.text}</li>
      ))}
    </ul>
  );
}

export function AudioImportSection({ onImported }: { onImported?: () => void }) {
  const [staged, setStaged] = useState<Staged[]>([]);
  const [ignored, setIgnored] = useState(0);
  const [hashing, setHashing] = useState<{ done: number; total: number } | null>(null);
  const [plan, setPlan] = useState<Map<string, AudioImportRow>>(new Map());
  const [planning, setPlanning] = useState(false);
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  const [fallbackTz, setFallbackTz] = useState(() => deviceTimezone());
  const [tags, setTags] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const filesRef = useRef<HTMLInputElement | null>(null);
  const folderRef = useRef<HTMLInputElement | null>(null);
  const stagedRef = useRef<Staged[]>([]);
  const hashingRef = useRef(false);
  const unmountedRef = useRef(false);
  const stopRef = useRef(false);
  const planSeq = useRef(0);

  useEffect(() => () => {
    unmountedRef.current = true;
  }, []);

  const commit = useCallback((fn: (prev: Staged[]) => Staged[]) => {
    const next = fn(stagedRef.current);
    stagedRef.current = next;
    setStaged(next);
  }, []);

  // Checksum staged files one at a time (reads each file once; needed to spot files already imported).
  const startHashing = useCallback(async () => {
    if (hashingRef.current) return;
    hashingRef.current = true;
    let done = 0;
    try {
      for (;;) {
        const pending = stagedRef.current.filter((s) => s.sha256 === null);
        if (pending.length === 0 || unmountedRef.current) break;
        const total = done + pending.length;
        setHashing({ done, total });
        const item = pending[0];
        let sha = '';
        try {
          sha = await sha256Blob(item.file);
        } catch {
          sha = ''; // unreadable here; the upload will report it
        }
        done += 1;
        commit((prev) => prev.map((s) => (s.key === item.key ? { ...s, sha256: sha } : s)));
      }
    } finally {
      hashingRef.current = false;
      if (!unmountedRef.current) setHashing(null);
    }
  }, [commit]);

  const stage = useCallback((collected: Collected) => {
    setResult(null);
    setError(null);
    setIgnored((n) => n + collected.ignored);
    const known = new Set(stagedRef.current.map((s) => s.key));
    const fresh: Staged[] = [];
    for (const c of collected.files as CollectedFile[]) {
      const key = fileKey(c);
      if (known.has(key)) continue; // the same file dropped twice
      known.add(key);
      fresh.push({ key, file: c.file, path: c.path, sha256: null });
    }
    if (fresh.length > 0) {
      commit((prev) => [...prev, ...fresh]);
      void startHashing();
    }
  }, [commit, startHashing]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (running) return;
    // Entries are only valid during the event: read them now, walk folders afterwards.
    const { entries, loose } = entriesFromDataTransfer(e.dataTransfer);
    collectFromEntries(entries, loose)
      .then(stage)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not read the dropped files'));
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) stage(collectFromFileList(e.target.files));
    e.target.value = '';
  };

  // Once every staged file is checksummed, ask the server how each becomes a note.
  const planSig = useMemo(() => staged.map((s) => `${s.key}:${s.sha256 === null ? 0 : 1}`).join('\n'), [staged]);
  useEffect(() => {
    if (hashing !== null) return;
    const list = stagedRef.current;
    if (list.length === 0) {
      setPlan(new Map());
      return;
    }
    if (!isValidTimeZone(fallbackTz.trim())) {
      setError('Pick a valid fallback time zone.');
      return;
    }
    const seq = ++planSeq.current;
    const timer = setTimeout(async () => {
      setPlanning(true);
      setError(null);
      try {
        const res = await notesAudioImport.plan(
          list.map((s) => ({ name: s.file.name, size: s.file.size, last_modified: s.file.lastModified, sha256: s.sha256 || null })),
          fallbackTz.trim(),
        );
        if (seq !== planSeq.current) return;
        setPlan(new Map(res.rows.map((r) => [list[r.index].key, r])));
      } catch (err) {
        if (seq === planSeq.current) setError(err instanceof Error ? err.message : 'Could not plan the import');
      } finally {
        if (seq === planSeq.current) setPlanning(false);
      }
    }, 300);
    return () => clearTimeout(timer);
    // planSig covers staged; hashing flips to null when checksumming ends.
  }, [planSig, hashing, fallbackTz]);

  const rows = useMemo(
    () => staged.flatMap((s) => {
      const row = plan.get(s.key);
      return row ? [{ s, row }] : [];
    }),
    [staged, plan],
  );
  const isSelected = (key: string, row: AudioImportRow) => !row.error && (overrides.get(key) ?? row.selected_default);
  const selectedCount = rows.filter(({ s, row }) => isSelected(s.key, row)).length;
  const selectable = rows.filter(({ row }) => !row.error);
  const allSelected = selectable.length > 0 && selectable.every(({ s, row }) => isSelected(s.key, row));

  const toggle = (key: string, row: AudioImportRow) => setOverrides((prev) => new Map(prev).set(key, !isSelected(key, row)));
  const toggleAll = () => setOverrides(new Map(selectable.map(({ s }) => [s.key, !allSelected])));

  // Don't let the tab close mid-import without a warning.
  useEffect(() => {
    if (!running) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [running]);

  const clearList = () => {
    stagedRef.current = [];
    setStaged([]);
    setPlan(new Map());
    setOverrides(new Map());
    setIgnored(0);
    setResult(null);
    setError(null);
  };

  const runImport = async () => {
    const targets = rows.filter(({ s, row }) => isSelected(s.key, row));
    if (targets.length === 0 || running) return;
    setRunning(true);
    setError(null);
    setResult(null);
    stopRef.current = false;
    const importedIds: string[] = [];
    const doneKeys = new Set<string>();
    const failures: RunResult['failures'] = [];
    let stopped = false;
    for (let i = 0; i < targets.length; i++) {
      if (stopRef.current) {
        stopped = true;
        break;
      }
      const { s, row } = targets[i];
      setProgress({ index: i + 1, total: targets.length, name: s.file.name, sent: 0, size: s.file.size });
      try {
        // Held (not transcribed yet) and reusing an identical finished upload if an earlier run left one.
        const audioId = await uploadBlob(
          {
            filename: s.file.name, mime: row.mime!, durationMs: null, blob: s.file, sha256: s.sha256 || null,
            serverId: null, defer: true, reuse: true,
          },
          { onProgress: (sent) => setProgress((p) => (p ? { ...p, sent } : p)) },
        );
        await notesAudioImport.addNote({
          audio_id: audioId, title: row.title, checked_in_at: row.checked_in_at, timezone: row.timezone, filename: s.file.name, tags,
        });
        importedIds.push(audioId);
        doneKeys.add(s.key);
      } catch (err) {
        failures.push({ name: s.path, message: err instanceof Error ? err.message : 'Import failed' });
      }
    }
    // The run is over: now (and only now) the transcriber may have the audio.
    let released = 0;
    let configured = true;
    if (importedIds.length > 0) {
      try {
        const fin = await notesAudioImport.finish(importedIds);
        released = fin.released;
        configured = fin.transcription_configured;
      } catch (err) {
        failures.push({ name: 'Starting transcription', message: err instanceof Error ? err.message : 'Failed' });
      }
    }
    if (doneKeys.size > 0) commit((prev) => prev.filter((s) => !doneKeys.has(s.key)));
    setProgress(null);
    setRunning(false);
    setResult({ imported: importedIds.length, failures, released, transcriptionConfigured: configured, stopped });
    if (importedIds.length > 0) onImported?.();
  };

  const dropBusy = running;
  const visible = rows.slice(0, MAX_ROWS_SHOWN);

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-6 space-y-4">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
        <Mic size={20} className="text-rose-500" />
        Import audio files
      </h2>
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Drop audio files and folders, as many batches as you like. Each file becomes a note with the audio attached. A name like
        {' '}<code>2023-04-05 14.30.59 Walk in the park.m4a</code> is dated Apr 5, 2023 at 2:30:59pm and titled “Walk in the park”;
        {' '}<code>2023-04-05 Walk in the park.m4a</code> uses the file’s modified time if it’s the same day, else 8pm; with no date
        the file’s modified time is used. The time zone comes from your check-ins around that date, else the fallback zone below.
        Transcription starts when the import finishes.
      </p>

      <div
        onDragOver={(e) => { e.preventDefault(); if (!dropBusy) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        data-testid="audio-import-drop"
        className={`rounded-2xl border-2 border-dashed px-4 py-8 text-center text-sm transition-colors ${
          dragging ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20' : 'border-gray-300 dark:border-gray-600'
        } ${dropBusy ? 'opacity-50' : ''}`}
      >
        <FileAudio size={28} className="mx-auto mb-2 text-gray-400" />
        <p className="text-gray-700 dark:text-gray-300">Drag audio files and folders here</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">mp3, m4a, aac, wav, flac, ogg/opus, webm. Anything else in a folder is skipped.</p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <button type="button" disabled={dropBusy} onClick={() => filesRef.current?.click()} className="btn-primary text-sm">Choose files</button>
          <button
            type="button"
            disabled={dropBusy}
            onClick={() => folderRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
          >
            <FolderOpen size={14} /> Choose folder
          </button>
        </div>
        <input ref={filesRef} type="file" multiple accept={AUDIO_FILE_ACCEPT} hidden onChange={onPick} aria-label="Audio files" />
        <input
          ref={folderRef}
          type="file"
          hidden
          onChange={onPick}
          aria-label="Audio folder"
          {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        />
      </div>

      {(staged.length > 0 || ignored > 0) && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-gray-100 dark:bg-gray-800 px-2.5 py-1">{staged.length} {staged.length === 1 ? 'file' : 'files'} staged</span>
          {ignored > 0 && <span className="rounded-full bg-gray-100 dark:bg-gray-800 px-2.5 py-1">{ignored} unsupported {ignored === 1 ? 'file' : 'files'} skipped</span>}
          {hashing && (
            <span className="inline-flex items-center gap-1 text-gray-500"><Loader2 size={12} className="animate-spin" /> Checking {hashing.done + 1} of {hashing.total}…</span>
          )}
          {planning && !hashing && <span className="inline-flex items-center gap-1 text-gray-500"><Loader2 size={12} className="animate-spin" /> Planning…</span>}
          {staged.length > 0 && !running && (
            <button type="button" onClick={clearList} className="ml-auto inline-flex items-center gap-1 text-gray-500 hover:underline"><X size={12} /> Clear list</button>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="audio-import-tz" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Fallback time zone</label>
          <TimezoneInput id="audio-import-tz" value={fallbackTz} onChange={setFallbackTz} />
        </div>
      </div>

      {rows.length > 0 && !hashing && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-primary-50 dark:bg-primary-900/30 px-2.5 py-1 text-primary-700 dark:text-primary-300">{selectedCount} selected</span>
            <span className="rounded-full bg-gray-100 dark:bg-gray-800 px-2.5 py-1 inline-flex items-center gap-1">
              <MapPin size={11} /> {rows.filter(({ row }) => row.tz_source === 'history').length} zoned from your history
            </span>
            {rows.some(({ row }) => row.tz_source === 'fallback') && (
              <span className="rounded-full bg-amber-50 dark:bg-amber-900/30 px-2.5 py-1 text-amber-700 dark:text-amber-300">
                {rows.filter(({ row }) => row.tz_source === 'fallback').length} using the fallback zone
              </span>
            )}
            {rows.some(({ row }) => row.duplicate) && (
              <span className="rounded-full bg-amber-50 dark:bg-amber-900/30 px-2.5 py-1 text-amber-700 dark:text-amber-300">
                {rows.filter(({ row }) => row.duplicate).length} likely duplicates (unticked)
              </span>
            )}
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700 max-h-[60vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800 text-left text-xs text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="px-3 py-2 w-8"><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" /></th>
                  <th className="px-3 py-2">Note</th>
                  <th className="px-3 py-2 whitespace-nowrap">Date &amp; time</th>
                  <th className="px-3 py-2">Time zone</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {visible.map(({ s, row }) => {
                  const on = isSelected(s.key, row);
                  return (
                    <tr key={s.key} className={on ? '' : 'opacity-60'}>
                      <td className="px-3 py-2 align-top">
                        <input type="checkbox" checked={on} disabled={Boolean(row.error) || running} onChange={() => toggle(s.key, row)} aria-label={`Import ${s.path}`} />
                      </td>
                      <td className="px-3 py-2 align-top min-w-[14rem]">
                        <div className="font-medium text-gray-900 dark:text-gray-100">
                          {row.title ?? <span className="italic text-gray-400">Untitled audio note</span>}
                        </div>
                        <div className="flex items-center gap-1 text-[11px] text-gray-400 break-all">
                          <FileAudio size={11} className="shrink-0" /> {s.path} · {formatSize(s.file.size)}
                        </div>
                        <Flags row={row} />
                      </td>
                      <td className="px-3 py-2 align-top whitespace-nowrap text-xs text-gray-700 dark:text-gray-300">
                        {formatDate(row.checked_in_at, row.timezone)}
                        <br />
                        {formatTime(row.checked_in_at, row.timezone)}
                      </td>
                      <td className="px-3 py-2 align-top text-xs">
                        <div className="text-gray-700 dark:text-gray-300 whitespace-nowrap">{row.timezone}</div>
                        <div className={row.tz_source === 'history' ? 'text-gray-400' : 'text-amber-600 dark:text-amber-400'}>
                          {row.tz_source === 'history' ? 'from your check-ins' : 'fallback'}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length > visible.length && (
            <p className="text-xs text-gray-500">Showing the first {visible.length} of {rows.length} files; all ticked files are imported.</p>
          )}

          <div>
            <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tags for every imported note</span>
            <TagChipInput value={tags} onChange={setTags} placeholder="e.g. Voice Memos" />
          </div>

          <div className="flex items-center justify-end gap-3">
            {running && (
              <button type="button" onClick={() => { stopRef.current = true; }} className="text-sm text-gray-500 hover:underline">Stop after this file</button>
            )}
            <button type="button" onClick={runImport} disabled={selectedCount === 0 || running} className="btn-primary inline-flex items-center gap-2">
              {running ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
              Import {selectedCount.toLocaleString()} {selectedCount === 1 ? 'file' : 'files'}
            </button>
          </div>
        </div>
      )}

      {running && progress && (
        <div role="status" className="space-y-1">
          <div className="text-sm text-gray-700 dark:text-gray-300">
            Importing {progress.index} of {progress.total}: <span className="font-medium">{progress.name}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
            <div className="h-full bg-primary-600 transition-[width]" style={{ width: `${progress.size ? Math.round((progress.sent / progress.size) * 100) : 0}%` }} />
          </div>
        </div>
      )}

      {result && (
        <div className="space-y-2 rounded-xl border border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-3 text-sm text-green-800 dark:text-green-200">
          <div className="flex items-start gap-2">
            <CheckCircle2 size={18} className="shrink-0 mt-0.5" />
            <div>
              Imported {result.imported.toLocaleString()} {result.imported === 1 ? 'note' : 'notes'}
              {result.stopped ? ' (stopped early; the rest are still in the list)' : ''}.
              {result.imported > 0 && (
                result.transcriptionConfigured
                  ? ` Transcription of ${result.released.toLocaleString()} ${result.released === 1 ? 'file' : 'files'} has started.`
                  : ' Set up transcription in Settings > Integrations and they will be transcribed automatically.'
              )}
              <div className="mt-1"><Link to="/profile?tab=plugin:notes" className="underline">See them in Profile &gt; Notes</Link></div>
            </div>
          </div>
          {result.failures.length > 0 && (
            <div className="text-red-700 dark:text-red-300">
              <p className="font-medium">{result.failures.length} failed (still in the list; press Import to retry):</p>
              <ul className="mt-1 list-disc pl-5 text-xs">
                {result.failures.slice(0, 20).map((f) => <li key={`${f.name}${f.message}`}>{f.name}: {f.message}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {error && <div className="flex items-center gap-2 text-sm text-red-600"><AlertCircle size={16} /> {error}</div>}
    </div>
  );
}
