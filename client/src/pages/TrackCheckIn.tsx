import { useCallback, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, FileUp, Loader2, Route, X } from 'lucide-react';
import { tracks } from '../api/client';
import { usePageTitle } from '../utils/pageTitle';

export default function TrackCheckIn() {
  const navigate = useNavigate();
  usePageTitle('Track Check In');

  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ id: string; name: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const acceptFile = useCallback((f: File) => {
    if (!f.name.toLowerCase().endsWith('.gpx')) {
      setError('Please select a .gpx track file.');
      return;
    }
    setError(null);
    setDuplicate(null);
    setFile(f);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const dropped = e.dataTransfer.files?.[0];
      if (dropped) acceptFile(dropped);
    },
    [acceptFile]
  );

  const handleSubmit = async () => {
    if (!file || uploading) return;
    setUploading(true);
    setError(null);
    setDuplicate(null);
    try {
      const result = await tracks.upload(
        file,
        Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      );
      navigate(`/tracks/${result.id}`);
    } catch (err) {
      const dup = (err as any)?.duplicate;
      if (dup?.id && dup?.name) {
        setDuplicate(dup);
      } else {
        setError(err instanceof Error ? err.message : 'Failed to upload track');
      }
      setUploading(false);
    }
  };

  const clearFile = () => {
    setFile(null);
    setError(null);
    setDuplicate(null);
    if (inputRef.current) inputRef.current.value = '';
  };

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

      <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 p-4 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
          <Route size={16} className="text-rose-500" />
          GPX Track File
        </div>

        <input
          ref={inputRef}
          type="file"
          accept=".gpx,application/gpx+xml,text/xml"
          className="hidden"
          onChange={(e) => {
            const selected = e.target.files?.[0];
            if (selected) acceptFile(selected);
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
          {file ? (
            <>
              <FileUp size={28} className="text-rose-500" />
              <span className="text-sm font-medium text-gray-800 dark:text-gray-200 break-all text-center">
                {file.name}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {(file.size / 1024 / 1024).toFixed(2)} MB — tap to replace
              </span>
            </>
          ) : (
            <>
              <FileUp size={28} className="text-gray-400" />
              <span className="text-sm font-medium text-gray-600 dark:text-gray-300">
                Drop a .gpx file here, or tap to browse
              </span>
              <span className="text-xs text-gray-400 dark:text-gray-500">
                Track files exported from Strava, Garmin, Wahoo, etc.
              </span>
            </>
          )}
        </div>

        {file && (
          <button
            type="button"
            onClick={clearFile}
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            <X size={14} />
            Remove file
          </button>
        )}
      </div>

      {duplicate && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
          This track is a duplicate of{' '}
          <Link
            to={`/tracks/${duplicate.id}`}
            className="font-semibold underline underline-offset-2 hover:text-red-900 dark:hover:text-red-100"
          >
            {duplicate.name}
          </Link>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Submit — fixed at bottom of screen (above the bottom nav on mobile) */}
      <div className="fixed inset-x-0 bottom-14 z-40 md:bottom-0">
        <div className="border-t border-white/40 bg-white/70 backdrop-blur-xl dark:border-gray-700/40 dark:bg-gray-900/70">
          <div className="mx-auto max-w-lg space-y-2 px-2 py-3 md:px-4">
            <button
              onClick={handleSubmit}
              disabled={!file || uploading}
              className="btn-primary w-full py-3 text-base font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploading ? (
                <Loader2 className="animate-spin mx-auto" size={20} />
              ) : (
                <span className="inline-flex items-center gap-2">
                  <Route size={16} />
                  Save Track
                </span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
