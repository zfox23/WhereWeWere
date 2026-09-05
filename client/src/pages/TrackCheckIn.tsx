import { useCallback, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  FileUp,
  Loader2,
  Route,
  X,
} from 'lucide-react';
import { tracks } from '../api/client';
import { usePageTitle } from '../utils/pageTitle';

type UploadStatus = 'pending' | 'uploading' | 'done' | 'duplicate' | 'error';

interface UploadItem {
  /** Local key for this row (not the server track id) */
  id: string;
  file: File;
  status: UploadStatus;
  /** Server track id, set on successful upload */
  trackId?: string;
  /** Server track name, set on successful upload */
  trackName?: string;
  /** Error message, set on failed upload */
  message?: string;
  /** Existing track info, set when the upload was rejected as a duplicate */
  duplicate?: { id: string; name: string };
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function TrackCheckIn() {
  const navigate = useNavigate();
  usePageTitle('Track Check In');

  const [items, setItems] = useState<UploadItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const updateItem = useCallback((id: string, patch: Partial<UploadItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  const acceptFiles = useCallback((files: File[]) => {
    const valid: File[] = [];
    let rejected = 0;
    for (const f of files) {
      const lower = f.name.toLowerCase();
      if (lower.endsWith('.gpx') || lower.endsWith('.tcx')) {
        valid.push(f);
      } else {
        rejected++;
      }
    }
    if (rejected > 0) {
      setError(
        `${rejected} file${rejected > 1 ? 's' : ''} skipped — only .gpx and .tcx track files are supported.`
      );
    } else {
      setError(null);
    }
    if (valid.length > 0) {
      setItems((prev) => [
        ...prev,
        ...valid.map((file) => ({
          id: newId(),
          file,
          status: 'pending' as const,
        })),
      ]);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const dropped = Array.from(e.dataTransfer.files ?? []);
      if (dropped.length > 0) acceptFiles(dropped);
    },
    [acceptFiles]
  );

  const handleSubmit = async () => {
    if (submitting) return;
    const pending = items.filter((it) => it.status === 'pending');
    if (pending.length === 0) return;
    setSubmitting(true);
    setError(null);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

    await Promise.all(
      pending.map(async (item) => {
        updateItem(item.id, { status: 'uploading' });
        try {
          const result = await tracks.upload(item.file, timezone);
          updateItem(item.id, {
            status: 'done',
            trackId: result.id,
            trackName: result.name,
          });
        } catch (err) {
          const dup = (err as any)?.duplicate;
          if (dup?.id && dup?.name) {
            updateItem(item.id, { status: 'duplicate', duplicate: dup });
          } else {
            updateItem(item.id, {
              status: 'error',
              message: err instanceof Error ? err.message : 'Failed to upload track',
            });
          }
        }
      })
    );
    setSubmitting(false);
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const clearAll = () => {
    setItems([]);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const pendingCount = items.filter((it) => it.status === 'pending').length;
  const uploadingCount = items.filter((it) => it.status === 'uploading').length;

  const formatSize = (bytes: number) =>
    bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : `${(bytes / 1024).toFixed(0)} KB`;

  return (
    <div className="max-w-lg mx-auto space-y-3 pb-44 md:pb-28">
      <div className="flex items-center gap-3 text-gray-900 dark:text-gray-100">
        <button
          onClick={() => navigate(-1)}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          aria-label="Go back"
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-bold">Track Check In</h1>
      </div>

      <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 p-4 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
          <Route size={16} className="text-rose-500" />
          GPX Track Files
        </div>

        <input
          ref={inputRef}
          type="file"
          accept=".gpx,.tcx,application/gpx+xml,text/xml"
          multiple
          className="hidden"
          onChange={(e) => {
            const selected = Array.from(e.target.files ?? []);
            if (selected.length > 0) acceptFiles(selected);
            e.target.value = '';
          }}
        />

        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-10 cursor-pointer transition-colors ${
            dragOver
              ? 'border-rose-400 bg-rose-50/60 dark:bg-rose-950/30'
              : 'border-gray-300 dark:border-gray-700 hover:border-rose-300 dark:hover:border-rose-700 bg-white/40 dark:bg-gray-900/30'
          }`}
        >
          <FileUp size={28} className="text-gray-400" />
          <span className="text-sm font-medium text-gray-600 dark:text-gray-300 text-center">
            {items.length > 0
              ? 'Drop more .gpx / .tcx files here, or tap to browse'
              : 'Drop .gpx or .tcx files here, or tap to browse'}
          </span>
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {items.length > 0
              ? 'You can add multiple track files at once'
              : 'Track files exported from Strava, Garmin, Wahoo, etc.'}
          </span>
        </div>

        {items.length > 0 && (
          <ul className="space-y-2">
            {items.map((item) => (
              <li
                key={item.id}
                className="rounded-xl border border-gray-200 bg-white/50 dark:border-gray-700 dark:bg-gray-900/40 px-3 py-2"
              >
                <div className="flex items-start gap-2.5">
                  <div className="mt-0.5 shrink-0">
                    {item.status === 'uploading' ? (
                      <Loader2 className="animate-spin text-primary-600" size={18} />
                    ) : item.status === 'done' ? (
                      <Check className="text-green-600 dark:text-green-400" size={18} />
                    ) : item.status === 'error' ? (
                      <X className="text-red-500" size={18} />
                    ) : item.status === 'duplicate' ? (
                      <Route className="text-amber-500" size={18} />
                    ) : (
                      <FileUp className="text-gray-400" size={18} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="text-sm font-medium text-gray-800 dark:text-gray-200 break-all">
                      {item.file.name}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {formatSize(item.file.size)}
                      {item.status === 'pending' && ' — ready to upload'}
                      {item.status === 'uploading' && ' — uploading & processing…'}
                      {item.status === 'error' && (
                        <span className="text-red-600 dark:text-red-400"> — {item.message}</span>
                      )}
                    </div>
                    {item.status === 'done' && item.trackId && (
                      <Link
                        to={`/tracks/${item.trackId}`}
                        className="inline-flex items-center gap-1 text-sm font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 underline underline-offset-2"
                      >
                        <Route size={13} />
                        View {item.trackName || 'track'}
                      </Link>
                    )}
                    {item.status === 'duplicate' && item.duplicate && (
                      <span className="block text-sm text-amber-700 dark:text-amber-300">
                        Duplicate of{' '}
                        <Link
                          to={`/tracks/${item.duplicate.id}`}
                          className="font-semibold underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-100"
                        >
                          {item.duplicate.name}
                        </Link>
                      </span>
                    )}
                  </div>
                  {!submitting && (
                    <button
                      type="button"
                      onClick={() => removeItem(item.id)}
                      className="shrink-0 p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-gray-800 transition-colors"
                      aria-label={`Remove ${item.file.name}`}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {items.length > 0 && (
          <button
            type="button"
            onClick={clearAll}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-50"
          >
            <X size={14} />
            Clear all
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Submit — fixed at bottom of screen (above the bottom nav on mobile) */}
      <div className="fixed inset-x-0 bottom-14 z-40 md:bottom-0">
        <div className="border-t border-white/40 bg-white/70 dark:border-gray-700/40 dark:bg-gray-900/70">
          <div className="mx-auto max-w-lg space-y-2 px-2 py-3 md:px-4">
            <button
              onClick={handleSubmit}
              disabled={pendingCount === 0 || submitting}
              className="btn-primary w-full py-3 text-base font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="animate-spin" size={20} />
                  Uploading {uploadingCount} track{uploadingCount === 1 ? '' : 's'}…
                </span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <Route size={16} />
                  {pendingCount > 1 ? `Save ${pendingCount} Tracks` : 'Save Track'}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
