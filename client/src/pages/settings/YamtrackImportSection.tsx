import { useState, useRef } from 'react';
import { Upload, FileText, Loader2, Check, AlertCircle, Play, X, ExternalLink } from 'lucide-react';
import { yamtrackImport } from '../../api/client';
import { MEDIA_SUBTYPES } from '../../utils/media';
import { slugify } from '../../utils/slugify';
import type {
  YamtrackDisposition,
  YamtrackImportPlanRow,
  YamtrackPlanRow,
  YamtrackPreview,
  YamtrackImportResult,
} from '../../types';

const DISPOSITION_LABELS: Record<YamtrackDisposition, string> = {
  create_tv_show: 'TV show',
  create_episode_checkin: 'Episode check-in',
  create_checkin: 'Check-in',
  create_media_item: 'Media only (no check-in)',
  duplicate: 'Duplicate',
  skipped: 'Skipped',
};

const DISPOSITION_STYLES: Record<YamtrackDisposition, string> = {
  create_tv_show: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  create_episode_checkin: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  create_checkin: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  create_media_item: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  duplicate: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  skipped: 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500',
};

function dispositionOf(row: YamtrackPlanRow): YamtrackDisposition {
  return row.disposition;
}

function detailHrefFor(row: YamtrackImportPlanRow): string | null {
  const itemId = row.media_item_id;
  if (!itemId) return null;
  const subtype = (MEDIA_SUBTYPES as Record<string, (typeof MEDIA_SUBTYPES)[keyof typeof MEDIA_SUBTYPES]>)[row.media_type];
  if (!subtype) return null;
  const slug = row.title ? slugify(row.title) : '';
  return `${subtype.detailBase}/${itemId}/${slug}`;
}

function DispositionBadge({ disposition }: { disposition: YamtrackDisposition }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${DISPOSITION_STYLES[disposition]}`}>
      {DISPOSITION_LABELS[disposition]}
    </span>
  );
}

export function YamtrackImportSection({ onImportComplete }: { onImportComplete?: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<'idle' | 'previewing' | 'previewed' | 'importing' | 'done'>('idle');
  const [preview, setPreview] = useState<YamtrackPreview | null>(null);
  const [importResult, setImportResult] = useState<YamtrackImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    setFile(f);
    setPreview(null);
    setImportResult(null);
    setError(null);
    setPhase('idle');
  };

  const handlePreview = async () => {
    if (!file) return;
    setPhase('previewing');
    setError(null);
    setPreview(null);
    try {
      const data = await yamtrackImport.preview(file);
      setPreview(data);
      setPhase('previewed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
      setPhase('idle');
    }
  };

  const handleImport = async () => {
    if (!file) return;
    setPhase('importing');
    setError(null);
    try {
      const data = await yamtrackImport.import(file);
      setImportResult(data);
      setPhase('done');
      onImportComplete?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
      setPhase('previewed');
    }
  };

  const reset = () => {
    setFile(null);
    setPreview(null);
    setImportResult(null);
    setError(null);
    setPhase('idle');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-6 space-y-4">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
        <Upload size={20} className="text-gray-600 dark:text-gray-400" />
        Yamtrack Import
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Import movies, TV shows, games, and books from a Yamtrack CSV export. Duplicate rows are
        skipped so you can safely re-import. Preview before committing.
      </p>

      {(phase === 'idle' || phase === 'previewing') && (
        <>
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-6 text-center cursor-pointer hover:border-primary-400 hover:bg-primary-50/30 dark:hover:bg-primary-900/20 transition-colors"
          >
            <Upload size={24} className="mx-auto text-gray-400 mb-2" />
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {file ? '1 file selected' : 'Select a .csv file'}
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>

          {file && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded text-xs text-gray-700 dark:text-gray-300">
                <FileText size={12} />
                {file.name}
              </span>
              <button onClick={handlePreview} disabled={phase === 'previewing'} className="btn-primary">
                {phase === 'previewing' ? (
                  <><Loader2 size={16} className="animate-spin mr-2" />Previewing…</>
                ) : (
                  <><Play size={16} className="mr-2" />Preview</>
                )}
              </button>
              <button onClick={reset} className="text-sm text-gray-500 hover:text-gray-700">
                Clear
              </button>
            </div>
          )}
        </>
      )}

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {phase === 'previewed' && preview && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 md:grid-cols-6 text-center text-xs">
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2"><div className="text-lg font-semibold">{preview.counts.total}</div>Total</div>
            <div className="bg-sky-50 dark:bg-sky-950/30 rounded-lg p-2"><div className="text-lg font-semibold">{preview.counts.create_tv_show}</div>TV shows</div>
            <div className="bg-violet-50 dark:bg-violet-950/30 rounded-lg p-2"><div className="text-lg font-semibold">{preview.counts.create_episode_checkin}</div>Episodes</div>
            <div className="bg-green-50 dark:bg-green-950/30 rounded-lg p-2"><div className="text-lg font-semibold">{preview.counts.create_checkin}</div>Check-ins</div>
            <div className="bg-amber-50 dark:bg-amber-950/30 rounded-lg p-2"><div className="text-lg font-semibold">{preview.counts.create_media_item}</div>Media only</div>
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2"><div className="text-lg font-semibold">{preview.counts.duplicate}</div>Duplicates</div>
          </div>

          <div className="max-h-96 overflow-auto border border-gray-200 dark:border-gray-700 rounded-xl">
            <table className="w-full text-xs text-gray-900 dark:text-gray-100">
              <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800">
                <tr className="text-left text-gray-500 dark:text-gray-400">
                  <th className="px-2 py-1.5">#</th>
                  <th className="px-2 py-1.5">Title</th>
                  <th className="px-2 py-1.5">Type</th>
                  <th className="px-2 py-1.5">Disposition</th>
                  <th className="px-2 py-1.5">Date</th>
                  <th className="px-2 py-1.5">Rating</th>
                </tr>
              </thead>
              <tbody>
                {preview.plans.map((row) => (
                  <tr key={row.line} className="border-t border-gray-100 dark:border-gray-800">
                    <td className="px-2 py-1.5 text-gray-400">{row.line}</td>
                    <td className="px-2 py-1.5 max-w-[220px] truncate" title={row.title}>
                      {row.title || <span className="text-gray-400 italic">(untitled)</span>}
                    </td>
                    <td className="px-2 py-1.5 text-gray-500">{row.media_type}</td>
                    <td className="px-2 py-1.5"><DispositionBadge disposition={dispositionOf(row)} /></td>
                    <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap" title={row.checked_in_at ?? undefined}>
                      {row.checked_in_at || row.start_date || '—'}
                    </td>
                    <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap">
                      {row.rating != null ? `${row.rating}★` : row.raw_score != null ? String(row.raw_score) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={handleImport} className="btn-primary">
              <Upload size={16} className="mr-2" />
              Import
            </button>
            <button onClick={reset} className="text-sm text-gray-500 hover:text-gray-700">
              Cancel
            </button>
          </div>
        </div>
      )}

      {phase === 'done' && importResult && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
            <Check size={16} />
            Imported {importResult.counts.imported_checkins} check-in(s); skipped {importResult.counts.duplicates_skipped} duplicate(s).
          </div>

          <div className="max-h-96 overflow-auto border border-gray-200 dark:border-gray-700 rounded-xl">
            <table className="w-full text-xs text-gray-900 dark:text-gray-100">
              <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800">
                <tr className="text-left text-gray-500 dark:text-gray-400">
                  <th className="px-2 py-1.5">#</th>
                  <th className="px-2 py-1.5">Title</th>
                  <th className="px-2 py-1.5">Disposition</th>
                  <th className="px-2 py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {importResult.plans.map((row) => {
                  const href = detailHrefFor(row);
                  return (
                    <tr key={row.line} className="border-t border-gray-100 dark:border-gray-800">
                      <td className="px-2 py-1.5 text-gray-400">{row.line}</td>
                      <td className="px-2 py-1.5 max-w-[220px] truncate" title={row.title}>
                        {row.title || <span className="text-gray-400 italic">(untitled)</span>}
                      </td>
                      <td className="px-2 py-1.5"><DispositionBadge disposition={dispositionOf(row)} /></td>
                      <td className="px-2 py-1.5 text-right">
                        {href ? (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-primary-600 hover:text-primary-700"
                          >
                            View <ExternalLink size={12} />
                          </a>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <button onClick={reset} className="text-sm text-gray-500 hover:text-gray-700 inline-flex items-center gap-1">
            <X size={14} /> Reset
          </button>
        </div>
      )}

      {phase === 'importing' && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 size={16} className="animate-spin" />
          Importing…
        </div>
      )}
    </div>
  );
}

