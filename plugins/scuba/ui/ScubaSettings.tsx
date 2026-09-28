/**
 * Settings > SCUBA section: Diving Log backup import.
 *
 * Accepts a Diving Log 4.x `.sql` backup file (a SQLite database). Dives are
 * keyed by their logbook UUID, so re-importing the same backup skips dives
 * that are already present.
 */

import { useState, useRef } from 'react';
import { AlertCircle, Check, FileText, Loader2, Upload, Waves } from 'lucide-react';
import { scubaLogbookImport } from './api';
import type { ScubaImportResult } from './api';

/** A few common IANA timezones for the fallback picker. */
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

export function ScubaSettings() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fallbackTimezone, setFallbackTimezone] = useState('America/Los_Angeles');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ScubaImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setSelectedFile(file);
    setResult(null);
    setImportError(null);
  };

  const handleImport = async () => {
    if (!selectedFile) return;
    setImporting(true);
    setResult(null);
    setImportError(null);
    try {
      const data = await scubaLogbookImport.importFile(selectedFile, fallbackTimezone);
      setResult(data);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

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

        {selectedFile && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded text-xs text-gray-700 dark:text-gray-300">
                <FileText size={12} />
                {selectedFile.name}
              </span>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                Fallback timezone for dives without a stored offset
              </label>
              <select
                value={fallbackTimezone}
                onChange={(e) => setFallbackTimezone(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                {!COMMON_TIMEZONES.includes(fallbackTimezone) && (
                  <option value={fallbackTimezone}>{fallbackTimezone}</option>
                )}
                {COMMON_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Used only when a dive row has no UTC offset and its site has no coordinates.
              </p>
            </div>

            <button onClick={handleImport} disabled={importing} className="btn-primary">
              {importing ? (
                <>
                  <Loader2 size={16} className="animate-spin mr-2" />
                  Importing...
                </>
              ) : (
                <>
                  <Upload size={16} className="mr-2" />
                  Import
                </>
              )}
            </button>
          </div>
        )}

        {importError && (
          <div className="flex items-center gap-2 text-sm text-red-600">
            <AlertCircle size={16} />
            {importError}
          </div>
        )}

        {result && (
          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 space-y-2">
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
          </div>
        )}
      </div>
    </div>
  );
}
