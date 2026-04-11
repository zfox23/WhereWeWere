import { useState, useRef } from 'react';
import { Download, Upload, Loader2, Check, AlertCircle, RotateCcw } from 'lucide-react';
import { backupApi } from '../../api/client';
import type { BackupImportResult } from '../../types';

export function BackupRestoreSection() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [result, setResult] = useState<BackupImportResult | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    setMessage(null);
    try {
      const { blob, fileName } = await backupApi.export();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setMessage({ type: 'success', text: 'Backup downloaded.' });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Backup export failed.' });
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async () => {
    if (!selectedFile) return;
    setImporting(true);
    setMessage(null);
    setResult(null);
    try {
      const data = await backupApi.import(selectedFile);
      setResult(data as BackupImportResult);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setMessage({ type: 'success', text: 'Backup restored.' });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Backup import failed.' });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-6 space-y-4">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
        <Download size={20} className="text-gray-600 dark:text-gray-400" />
        Backup & Restore
      </h2>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={handleExport}
          disabled={exporting || importing}
          className="btn-primary"
        >
          {exporting ? <Loader2 size={16} className="animate-spin mr-2" /> : <Download size={16} className="mr-2" />}
          Download Backup
        </button>
      </div>

      <div className="border-t border-gray-100 dark:border-gray-800 pt-4 space-y-3">
        <div
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-6 text-center cursor-pointer hover:border-primary-400 hover:bg-primary-50/30 dark:hover:bg-primary-900/20 transition-colors"
        >
          <Upload size={24} className="mx-auto text-gray-400 mb-2" />
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {selectedFile ? selectedFile.name : 'Select backup .json file'}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={(e) => {
              const file = e.target.files?.[0] || null;
              setSelectedFile(file);
              setResult(null);
              setMessage(null);
            }}
            className="hidden"
          />
        </div>

        {selectedFile && (
          <button
            onClick={handleImport}
            disabled={importing || exporting}
            className="btn-secondary"
          >
            {importing ? <Loader2 size={16} className="animate-spin mr-2" /> : <RotateCcw size={16} className="mr-2" />}
            Restore Backup
          </button>
        )}
      </div>

      {message && (
        <div className={`flex items-center gap-2 text-sm ${message.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-600'}`}>
          {message.type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
          {message.text}
        </div>
      )}

      {result && (
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 space-y-3">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            Imported backup schema v{result.schemaVersion}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-gray-600 dark:text-gray-300">
            {Object.entries(result.counts).map(([key, value]) => (
              <div key={key} className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1.5">
                <p className="font-medium">{key}</p>
                <p>Inserted: {value.inserted} | Skipped: {value.skipped}</p>
              </div>
            ))}
          </div>
          {result.errors.length > 0 && (
            <div>
              <button
                onClick={() => setShowErrors(!showErrors)}
                className="text-xs text-primary-600 hover:text-primary-700"
              >
                {showErrors ? 'Hide' : 'Show'} restore warnings
              </button>
              {showErrors && (
                <ul className="mt-2 space-y-1 text-xs text-red-600 max-h-40 overflow-y-auto">
                  {result.errors.map((err, idx) => (
                    <li key={idx}>{err}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
