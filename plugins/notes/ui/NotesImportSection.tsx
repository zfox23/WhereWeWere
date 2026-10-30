/**
 * Settings > Notes > Import: upload .md/.markdown/.txt files, preview how
 * each becomes a note (title, first line, date/time, time zone and where it
 * came from, duplicates), untick rows, add tags to the whole batch, import.
 * The preview is stateless: Import uploads the same files again.
 */

import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, AlertTriangle, CheckCircle2, Clock, Copy, FileText, Loader2, MapPin, Upload } from 'lucide-react';
import { isValidTimeZone } from 'wwp-shared';
import { deviceTimezone } from '../../../client/src/utils/slugify';
import { formatDate, formatTime } from '../../../client/src/utils/checkin';
import { notesImport, type ImportPreview, type ImportPreviewRow, type ImportResult } from './api';
import TagChipInput from './TagChipInput';
import { TimezoneInput } from './TimezoneInput';

type Phase = 'idle' | 'previewing' | 'previewed' | 'importing' | 'done';

const DUPLICATE_LABEL: Record<NonNullable<ImportPreviewRow['duplicate']>, string> = {
  date_title: 'Already imported (same date and title)',
  content: 'Already imported (same text)',
  batch: 'Repeats another file in this upload',
};

function Flags({ row }: { row: ImportPreviewRow }) {
  const flags: { icon: React.ReactNode; text: string; tone: string }[] = [];
  if (row.error) flags.push({ icon: <AlertCircle size={12} />, text: row.error, tone: 'text-red-600 dark:text-red-400' });
  if (row.duplicate) flags.push({ icon: <Copy size={12} />, text: DUPLICATE_LABEL[row.duplicate], tone: 'text-amber-700 dark:text-amber-300' });
  if (row.time_source === 'missing') {
    flags.push({ icon: <AlertTriangle size={12} />, text: 'No date in the name or file: dated today', tone: 'text-amber-700 dark:text-amber-300' });
  } else if (row.time_source === 'default_evening') {
    flags.push({ icon: <Clock size={12} />, text: '8pm (no matching file time)', tone: 'text-gray-500 dark:text-gray-400' });
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

export function NotesImportSection({ onImported }: { onImported?: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [fallbackTz, setFallbackTz] = useState(() => deviceTimezone());
  const [phase, setPhase] = useState<Phase>('idle');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [tags, setTags] = useState<string[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const reset = () => {
    setFiles([]);
    setPreview(null);
    setSelected(new Set());
    setTags([]);
    setResult(null);
    setError(null);
    setPhase('idle');
    if (inputRef.current) inputRef.current.value = '';
  };

  const runPreview = async (list: File[], tz: string) => {
    if (list.length === 0) return;
    if (!isValidTimeZone(tz.trim())) {
      setError('Pick a valid fallback time zone first.');
      return;
    }
    setError(null);
    setPhase('previewing');
    try {
      const p = await notesImport.preview(list, tz.trim());
      setPreview(p);
      setSelected(new Set(p.rows.filter((r) => r.selected_default).map((r) => r.index)));
      setPhase('previewed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
      setPhase('idle');
    }
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []);
    setFiles(list);
    setResult(null);
    runPreview(list, fallbackTz);
  };

  const runImport = async () => {
    if (!preview || selected.size === 0) return;
    setPhase('importing');
    setError(null);
    try {
      const res = await notesImport.run(files, fallbackTz.trim(), [...selected].sort((a, b) => a - b), tags);
      setResult(res);
      setPhase('done');
      onImported?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
      setPhase('previewed');
    }
  };

  const importable = useMemo(() => (preview?.rows ?? []).filter((r) => !r.error), [preview]);
  const allSelected = importable.length > 0 && importable.every((r) => selected.has(r.index));

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(importable.map((r) => r.index)));
  };

  const toggle = (index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-6 space-y-4">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
        <Upload size={20} className="text-amber-500" />
        Import text files
      </h2>
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Upload <code>.md</code>, <code>.markdown</code> or <code>.txt</code> files. A name like
        {' '}<code>2017-10-15 Night with Jason.md</code> becomes a note on Oct 15, 2017 titled “Night with Jason”, at the
        file’s modified time when that’s the same day, else 8pm. The time zone comes from your check-ins around that
        date; before your first check-in, the fallback zone below is used.
      </p>

      {phase === 'done' && result ? (
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-xl border border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-3 text-sm text-green-800 dark:text-green-200">
            <CheckCircle2 size={18} className="shrink-0 mt-0.5" />
            <div>
              Imported {result.imported.toLocaleString()} {result.imported === 1 ? 'note' : 'notes'}
              {result.skipped > 0 ? `; ${result.skipped} skipped` : ''}.
              {result.errors.length > 0 && (
                <ul className="mt-1 list-disc pl-4 text-xs text-red-700 dark:text-red-300">
                  {result.errors.map((e) => <li key={e}>{e}</li>)}
                </ul>
              )}
              <div className="mt-1">
                <Link to="/profile?tab=plugin:notes" className="underline">See them in Profile &gt; Notes</Link>
              </div>
            </div>
          </div>
          <button type="button" onClick={reset} className="btn-primary text-sm">Import more files</button>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="notes-import-files" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Files</label>
              <input
                id="notes-import-files"
                ref={inputRef}
                type="file"
                multiple
                accept=".md,.markdown,.txt,text/markdown,text/plain"
                onChange={onPick}
                disabled={phase === 'previewing' || phase === 'importing'}
                className="block w-full text-sm text-gray-600 dark:text-gray-300 file:mr-3 file:rounded-lg file:border-0 file:bg-primary-600 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-primary-700"
              />
            </div>
            <div>
              <label htmlFor="notes-import-tz" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Fallback time zone</label>
              <TimezoneInput id="notes-import-tz" value={fallbackTz} onChange={setFallbackTz} />
              {preview && files.length > 0 && (
                <button
                  type="button"
                  onClick={() => runPreview(files, fallbackTz)}
                  className="mt-1 text-[11px] text-primary-600 dark:text-primary-400 hover:underline"
                >
                  Re-check with this zone
                </button>
              )}
            </div>
          </div>

          {phase === 'previewing' && (
            <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 size={16} className="animate-spin" /> Reading {files.length} files…</div>
          )}

          {preview && phase !== 'previewing' && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-gray-100 dark:bg-gray-800 px-2.5 py-1">{preview.total} files</span>
                <span className="rounded-full bg-primary-50 dark:bg-primary-900/30 px-2.5 py-1 text-primary-700 dark:text-primary-300">{selected.size} selected</span>
                <span className="rounded-full bg-gray-100 dark:bg-gray-800 px-2.5 py-1 inline-flex items-center gap-1">
                  <MapPin size={11} /> {preview.total - preview.fallback_count} zoned from your history
                </span>
                {preview.fallback_count > 0 && (
                  <span className="rounded-full bg-amber-50 dark:bg-amber-900/30 px-2.5 py-1 text-amber-700 dark:text-amber-300">
                    {preview.fallback_count} using the fallback zone
                  </span>
                )}
                {preview.duplicate_count > 0 && (
                  <span className="rounded-full bg-amber-50 dark:bg-amber-900/30 px-2.5 py-1 text-amber-700 dark:text-amber-300">
                    {preview.duplicate_count} likely duplicates (unticked)
                  </span>
                )}
              </div>

              <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700 max-h-[60vh] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800 text-left text-xs text-gray-500 dark:text-gray-400">
                    <tr>
                      <th className="px-3 py-2 w-8">
                        <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
                      </th>
                      <th className="px-3 py-2">Note</th>
                      <th className="px-3 py-2 whitespace-nowrap">Date &amp; time</th>
                      <th className="px-3 py-2">Time zone</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {preview.rows.map((row) => (
                      <tr key={row.index} className={selected.has(row.index) ? '' : 'opacity-60'}>
                        <td className="px-3 py-2 align-top">
                          <input
                            type="checkbox"
                            checked={selected.has(row.index)}
                            disabled={Boolean(row.error)}
                            onChange={() => toggle(row.index)}
                            aria-label={`Import ${row.filename}`}
                          />
                        </td>
                        <td className="px-3 py-2 align-top min-w-[14rem]">
                          <div className="font-medium text-gray-900 dark:text-gray-100">
                            {row.title ?? <span className="italic text-gray-400">No title</span>}
                          </div>
                          {row.excerpt && <div className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1">{row.excerpt}</div>}
                          <div className="flex items-center gap-1 text-[11px] text-gray-400">
                            <FileText size={11} /> {row.filename} · {row.word_count.toLocaleString()} words
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
                    ))}
                  </tbody>
                </table>
              </div>

              <div>
                <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tags for every imported note</span>
                <TagChipInput value={tags} onChange={setTags} placeholder="e.g. Journal Entries" />
              </div>

              <div className="flex items-center justify-end gap-3">
                <button type="button" onClick={reset} className="text-sm text-gray-500 hover:underline">Cancel</button>
                <button
                  type="button"
                  onClick={runImport}
                  disabled={selected.size === 0 || phase === 'importing'}
                  className="btn-primary inline-flex items-center gap-2"
                >
                  {phase === 'importing' ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                  Import {selected.size.toLocaleString()} {selected.size === 1 ? 'note' : 'notes'}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600"><AlertCircle size={16} /> {error}</div>
      )}
    </div>
  );
}
