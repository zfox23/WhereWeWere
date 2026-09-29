/**
 * Settings > SCUBA section: Diving Log backup import.
 *
 * Accepts a Diving Log 4.x `.sql` backup file (a SQLite database). The
 * import is two-step: first a preview table shows every dive the parser
 * found — including the timezone each dive resolved to (stored UtcOffset,
 * the site's coordinates, or UTC) — and the user can adjust the timezone
 * per dive before finalizing. Dives are keyed by their logbook UUID, so
 * re-importing the same backup skips dives that are already present.
 */

import { useState, useRef } from 'react';
import { AlertCircle, Check, FileText, Loader2, Play, Upload, Waves, X } from 'lucide-react';
import { scubaLogbookImport } from './api';
import type { ScubaImportResult, ScubaLogbookPreview, ScubaLogbookPreviewRow } from './api';
import { pluginDetailPath } from '../../../client/src/plugins/registry';
import { formatDepth, useScubaUnits } from './units';

/** A few common IANA timezones offered in the per-dive picker. */
const COMMON_TIMEZONES = [
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'Pacific/Honolulu',
  'Pacific/Guam',
  'Europe/London',
  'Europe/Berlin',
  'Australia/Sydney',
  'Asia/Tokyo',
];

type Phase = 'idle' | 'previewing' | 'previewed' | 'importing' | 'done';

const SOURCE_LABELS: Record<string, string> = {
  utc_offset: 'Stored offset',
  geo: 'Site location',
  fallback: 'Assumed UTC',
};

function siteLabel(row: ScubaLogbookPreviewRow): string {
  return [row.place, row.city].filter(Boolean).join(', ') || '—';
}

export function ScubaSettings() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [preview, setPreview] = useState<ScubaLogbookPreview | null>(null);
  /** source_uuid → IANA zone chosen in the preview (differs from the resolved zone). */
  const [timezones, setTimezones] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ScubaImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const unit = useScubaUnits();

  const reset = () => {
    setSelectedFile(null);
    setPreview(null);
    setTimezones({});
    setResult(null);
    setImportError(null);
    setShowErrors(false);
    setPhase('idle');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    reset();
    setSelectedFile(file);
  };

  const handlePreview = async () => {
    if (!selectedFile) return;
    setPhase('previewing');
    setImportError(null);
    try {
      const data = await scubaLogbookImport.preview(selectedFile);
      setPreview(data);
      setTimezones({});
      setPhase('previewed');
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Preview failed');
      setPhase('idle');
    }
  };

  const handleImport = async () => {
    if (!selectedFile) return;
    setPhase('importing');
    setImportError(null);
    try {
      const data = await scubaLogbookImport.importFile(
        selectedFile,
        adjustedCount > 0 ? timezones : undefined,
      );
      setResult(data);
      setPhase('done');
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
      setPhase('previewed');
    }
  };

  const adjustedCount = Object.keys(timezones).length;

  return (
    <div className="space-y-4">
      <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Waves size={20} className="text-cyan-600 dark:text-cyan-400" />
          Import a Diving Log backup
        </h2>

        <p className="text-sm text-gray-600 dark:text-gray-400">
          Upload a Diving Log 4.x logbook backup <code className="text-xs">(.sql)</code> file
          (Diving Log → Logbook → Backup). Each dive is imported with its site, depths, times,
          gas, equipment, and notes. Re-importing the same backup is safe: dives already
          imported (matched by their logbook UUID) are skipped.
        </p>

        {(phase === 'idle' || phase === 'previewing' || phase === 'previewed') && (
          <>
            <div
              className="space-y-3 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-6 text-center cursor-pointer hover:border-cyan-400 hover:bg-cyan-50/30 dark:hover:bg-cyan-900/20 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={24} className="mx-auto text-gray-400 mb-2" />
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {selectedFile ? selectedFile.name : 'Select a Diving Log .sql backup file'}
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".sql,.sqlite,.db,application/sqlite"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>

            {selectedFile && phase !== 'previewed' && (
              <div className="flex items-center gap-2">
                <button onClick={handlePreview} disabled={phase === 'previewing'} className="btn-primary">
                  {phase === 'previewing' ? (
                    <>
                      <Loader2 size={16} className="animate-spin mr-2" />
                      Previewing...
                    </>
                  ) : (
                    <>
                      <Play size={16} className="mr-2" />
                      Preview
                    </>
                  )}
                </button>
                <button onClick={reset} className="text-sm text-gray-500 hover:text-gray-700">
                  Clear
                </button>
              </div>
            )}

            {selectedFile && (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded text-xs text-gray-700 dark:text-gray-300">
                <FileText size={12} />
                {selectedFile.name}
              </span>
            )}
          </>
        )}

        {importError && phase !== 'done' && (
          <div className="flex items-center gap-2 text-sm text-red-600">
            <AlertCircle size={16} />
            {importError}
          </div>
        )}

        {phase === 'previewed' && preview && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2">
                <div className="text-lg font-semibold">{preview.total}</div>Dives found
              </div>
              <div className="bg-amber-50 dark:bg-amber-950/30 rounded-lg p-2">
                <div className="text-lg font-semibold">
                  {preview.rows.filter((r) => r.timezone_source === 'fallback').length}
                </div>
                Assumed UTC
              </div>
              <div className="bg-cyan-50 dark:bg-cyan-950/30 rounded-lg p-2">
                <div className="text-lg font-semibold">{adjustedCount}</div>Adjusted
              </div>
            </div>

            <p className="text-xs text-gray-500 dark:text-gray-400">
              Dives without a stored UTC offset get their timezone from the site's coordinates when
              available, otherwise UTC. Adjust any dive's timezone before importing — its timestamp
              is re-anchored to the chosen zone using the logged date and entry time.
            </p>

            <datalist id="scuba-import-timezones">
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz} value={tz} />
              ))}
              {preview.rows.map((row) => (
                <option key={row.checkin_timezone} value={row.checkin_timezone} />
              ))}
            </datalist>

            <div className="max-h-96 overflow-auto border border-gray-200 dark:border-gray-700 rounded-xl">
              <table className="w-full text-xs text-gray-900 dark:text-gray-100">
                <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800">
                  <tr className="text-left text-gray-500 dark:text-gray-400">
                    <th className="px-2 py-1.5">#</th>
                    <th className="px-2 py-1.5">Site</th>
                    <th className="px-2 py-1.5">Date</th>
                    <th className="px-2 py-1.5">Depth</th>
                    <th className="px-2 py-1.5">Timezone</th>
                    <th className="px-2 py-1.5">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr key={row.source_uuid ?? row.source_number ?? row.local_date} className="border-t border-gray-100 dark:border-gray-800">
                      <td className="px-2 py-1.5 text-gray-400">{row.source_number ?? '—'}</td>
                      <td className="px-2 py-1.5 max-w-[220px] truncate" title={siteLabel(row)}>
                        {siteLabel(row)}
                      </td>
                      <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap">
                        {row.local_date}
                        {row.entry_time ? ` ${row.entry_time}` : ''}
                      </td>
                      <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap">
                        {formatDepth(row.depth, unit) ?? '—'}
                      </td>
                      <td className="px-2 py-1.5">
                        {row.source_uuid && (
                          <div className="flex items-center gap-1">
                            <input
                              list="scuba-import-timezones"
                              value={timezones[row.source_uuid] ?? row.checkin_timezone}
                              onChange={(e) => {
                                const value = e.target.value.trim();
                                setTimezones((prev) => {
                                  const next = { ...prev };
                                  if (!value || value === row.checkin_timezone) {
                                    delete next[row.source_uuid!];
                                  } else {
                                    next[row.source_uuid!] = value;
                                  }
                                  return next;
                                });
                              }}
                              className="w-44 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-xs text-gray-900 dark:text-gray-100"
                            />
                            {timezones[row.source_uuid] && (
                              <button
                                type="button"
                                onClick={() =>
                                  setTimezones((prev) => {
                                    const next = { ...prev };
                                    delete next[row.source_uuid!];
                                    return next;
                                  })
                                }
                                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                                title="Revert to the resolved timezone"
                              >
                                <X size={12} />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <span
                          className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap ${
                            row.timezone_source === 'fallback'
                              ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                              : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300'
                          }`}
                        >
                          {SOURCE_LABELS[row.timezone_source] ?? row.timezone_source}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {preview.errors.length > 0 && (
              <div className="text-xs text-red-600 dark:text-red-400">
                <button
                  onClick={() => setShowErrors(!showErrors)}
                  className="underline underline-offset-2"
                >
                  {showErrors ? 'Hide' : 'Show'} {preview.errors.length} parse error(s)
                </button>
                {showErrors && (
                  <ul className="mt-1 space-y-1">
                    {preview.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="flex items-center gap-2">
              <button onClick={handleImport} className="btn-primary">
                <Upload size={16} className="mr-2" />
                Import {preview.total} dive(s)
              </button>
              <button onClick={reset} className="text-sm text-gray-500 hover:text-gray-700">
                Cancel
              </button>
            </div>
          </div>
        )}

        {phase === 'importing' && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 size={16} className="animate-spin" />
            Importing...
          </div>
        )}

        {phase === 'done' && result && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
              <Check size={16} />
              Import complete
            </div>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{result.imported}</p>
                <p className="text-xs text-gray-500">Imported</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{result.skipped}</p>
                <p className="text-xs text-gray-500">Skipped</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{result.total_errors}</p>
                <p className="text-xs text-gray-500">Errors</p>
              </div>
            </div>
            {result.errors.length > 0 && (
              <div>
                <button
                  onClick={() => setShowErrors(!showErrors)}
                  className="text-xs text-primary-600 hover:text-primary-700"
                >
                  {showErrors ? 'Hide' : 'Show'} error details
                </button>
                {showErrors && (
                  <ul className="mt-2 space-y-1 text-xs text-red-600 max-h-40 overflow-y-auto">
                    {result.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {result.imported > 0 && (
              <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
                <div>Imported dives:</div>
                <div className="flex flex-wrap gap-1.5">
                  {preview
                    ? preview.rows
                        .map((row, i) => ({ row, id: result.imported_ids?.[i] }))
                        .filter((x): x is { row: ScubaLogbookPreviewRow; id: string } => Boolean(x.id))
                        .map(({ row, id }) => (
                          <a
                            key={id}
                            href={pluginDetailPath('scuba', id)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-cyan-50 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300 hover:underline max-w-[240px]"
                          >
                            <span className="truncate">
                              {row.local_date} · {siteLabel(row)}
                            </span>
                          </a>
                        ))
                    : null}
                </div>
              </div>
            )}
            <button onClick={reset} className="text-sm text-gray-500 hover:text-gray-700 inline-flex items-center gap-1">
              <X size={14} />
              Import another file
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
