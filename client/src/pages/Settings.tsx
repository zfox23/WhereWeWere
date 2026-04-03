import { useState, useEffect, useRef } from 'react';
import { User, Link2, Loader2, Check, AlertCircle, Upload, FileText, Cog, Clock, CheckCircle2, XCircle, Play, Send, Ban, StopCircle, Monitor, Sun, Moon, Bell, BellOff, Download, Smile, Plus, Trash2, RefreshCw, MapPin } from 'lucide-react';
import { settings, importApi, jobs, moodActivities, venueMerges } from '../api/client';
import { useTheme } from '../contexts/ThemeContext';
import { MoodIconRow } from '../components/MoodIcons';
import ActivityGroupManager from '../components/ActivityGroupManager';
import { PushSettings } from '../components/PushSettings';
import type { UserSettings, ImportResult, Job, MoodActivityGroup, MoodActivity, VenueMergeSuggestion } from '../types';

function SwarmImportSection({ onImportComplete }: { onImportComplete?: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setSelectedFiles(files);
    setResult(null);
    setImportError(null);
  };

  const handleImport = async () => {
    if (selectedFiles.length === 0) return;
    setImporting(true);
    setResult(null);
    setImportError(null);
    try {
      const data = await importApi.swarm(selectedFiles);
      setResult(data);
      setSelectedFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (data.imported > 0) {
        // Auto-trigger server-side backfill
        try {
          await jobs.start('backfill');
        } catch { /* ignore if already running */ }
        onImportComplete?.();
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-6 space-y-4">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
        <Upload size={20} className="text-gray-600 dark:text-gray-400" />
        Swarm Import
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Import your check-in history from Swarm CSV export files.
      </p>

      <div
        onClick={() => fileInputRef.current?.click()}
        className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-6 text-center cursor-pointer hover:border-primary-400 hover:bg-primary-50/30 dark:hover:bg-primary-900/20 transition-colors"
      >
        <Upload size={24} className="mx-auto text-gray-400 mb-2" />
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {selectedFiles.length > 0
            ? `${selectedFiles.length} file${selectedFiles.length !== 1 ? 's' : ''} selected`
            : 'Select .csv files'}
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          multiple
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      {selectedFiles.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {selectedFiles.map((f, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded text-xs text-gray-700 dark:text-gray-300"
              >
                <FileText size={12} />
                {f.name}
              </span>
            ))}
          </div>
          <button
            onClick={handleImport}
            disabled={importing}
            className="btn-primary"
          >
            {importing ? (
              <>
                <Loader2 size={16} className="animate-spin mr-2" />
                Importing...
              </>
            ) : (
              <>
                <Upload size={16} className="mr-2" />
                Import {selectedFiles.length} file{selectedFiles.length !== 1 ? 's' : ''}
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
  );
}

function DaylioImportSection() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
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
      const data = await importApi.daylio(selectedFile);
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
    <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-6 space-y-4">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
        <Upload size={20} className="text-gray-600 dark:text-gray-400" />
        Daylio Import
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Import your mood history from a Daylio backup file.
      </p>

      <div
        onClick={() => fileInputRef.current?.click()}
        className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-6 text-center cursor-pointer hover:border-primary-400 hover:bg-primary-50/30 dark:hover:bg-primary-900/20 transition-colors"
      >
        <Upload size={24} className="mx-auto text-gray-400 mb-2" />
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {selectedFile ? selectedFile.name : 'Select a .daylio backup file'}
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".daylio"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      {selectedFile && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded text-xs text-gray-700 dark:text-gray-300">
              <FileText size={12} />
              {selectedFile.name}
            </span>
          </div>
          <button
            onClick={handleImport}
            disabled={importing}
            className="btn-primary"
          >
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
  );
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
}

function formatDistanceMeters(distanceMeters: number): string {
  return distanceMeters >= 1000
    ? `${(distanceMeters / 1000).toFixed(1)} km`
    : `${distanceMeters} m`;
}

function JobStatusIcon({ status }: { status: Job['status'] }) {
  switch (status) {
    case 'pending':
      return <Clock size={16} className="text-gray-400" />;
    case 'running':
      return <Loader2 size={16} className="animate-spin text-blue-500" />;
    case 'completed':
      return <CheckCircle2 size={16} className="text-green-500" />;
    case 'failed':
      return <XCircle size={16} className="text-red-500" />;
    case 'cancelled':
      return <Ban size={16} className="text-amber-500" />;
  }
}

function JobsSection({ refreshKey }: { refreshKey: number }) {
  const [jobList, setJobList] = useState<Job[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadJobs = async () => {
    try {
      const data = await jobs.list();
      setJobList(data);
    } catch (err) {
      console.error('Failed to load jobs:', err);
    }
  };

  useEffect(() => {
    loadJobs();
  }, [refreshKey]);

  // Poll while any job is running
  useEffect(() => {
    const hasActive = jobList.some((j) => j.status === 'pending' || j.status === 'running');
    if (!hasActive) return;
    const interval = setInterval(loadJobs, 3000);
    return () => clearInterval(interval);
  }, [jobList]);

  const startJob = async (type: string) => {
    setStarting(true);
    setError(null);
    try {
      await jobs.start(type);
      await loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start job');
    } finally {
      setStarting(false);
    }
  };

  const cancelJob = async (id: string) => {
    try {
      await jobs.cancel(id);
      // Mark as cancelling optimistically in the UI
      setJobList((prev) =>
        prev.map((j) =>
          j.id === id ? { ...j, progress: { ...j.progress, message: 'Cancelling...' } } : j
        )
      );
      // Poll quickly until the job is actually cancelled/completed
      const pollCancel = async (retries: number) => {
        const data = await jobs.list();
        setJobList(data);
        const job = data.find((j: Job) => j.id === id);
        if (job && (job.status === 'pending' || job.status === 'running') && retries > 0) {
          setTimeout(() => pollCancel(retries - 1), 1000);
        }
      };
      pollCancel(15);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel job');
    }
  };

  const hasActiveJob = jobList.some((j) => j.status === 'pending' || j.status === 'running');

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-6 space-y-4">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
        <Cog size={20} className="text-gray-600 dark:text-gray-400" />
        Jobs
      </h2>

      <div className="flex flex-col items-start gap-4">
        <div className='flex flex-col'>
          <button
            onClick={() => startJob('backfill')}
            disabled={starting || hasActiveJob}
            className="btn-primary"
          >
            {starting ? (
              <>
                <Loader2 size={16} className="animate-spin mr-2" />
                Starting...
              </>
            ) : (
              <>
                <Play size={16} className="mr-2" />
                Backfill Venues
              </>
            )}
          </button>
          <p className="text-xs text-gray-400 mt-1">Reverse geocode and categorize venues</p>
        </div>
        <div className='flex flex-col'>
          <button
            onClick={() => startJob('venue-merge')}
            disabled={starting || hasActiveJob}
            className="btn-secondary"
          >
            {starting ? (
              <>
                <Loader2 size={16} className="animate-spin mr-2" />
                Starting...
              </>
            ) : (
              <>
                <Play size={16} className="mr-2" />
                Scan Similar Venues
              </>
            )}
          </button>
          <p className="text-xs text-gray-400 mt-1">Find likely duplicate venues and queue them for manual review</p>
        </div>
        <div className='flex flex-col'>
          <button
            onClick={() => startJob('dawarich-export')}
            disabled={true || starting || hasActiveJob}
            className="btn-secondary"
          >
            <Send size={16} className="mr-2" />
            Export to Dawarich
          </button>
          <p className="text-xs text-gray-400 mt-1">Export Places to Dawarich (disabled; untested)</p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {jobList.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Recent Jobs</h3>
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {jobList.map((job) => (
              <div key={job.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <JobStatusIcon status={job.status} />
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100 capitalize">{job.type}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${job.status === 'completed' ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400' :
                      job.status === 'running' ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' :
                        job.status === 'failed' ? 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400' :
                          'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                      }`}>
                      {job.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {(job.status === 'pending' || job.status === 'running') && (
                      <button
                        onClick={() => cancelJob(job.id)}
                        className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 font-medium"
                      >
                        <StopCircle size={13} />
                        Cancel
                      </button>
                    )}
                    <span className="text-xs text-gray-400">{formatRelativeTime(job.created_at)}</span>
                  </div>
                </div>
                {job.progress?.message && (
                  <p className="text-xs text-gray-500 mt-1 ml-6">{job.progress.message}</p>
                )}
                {job.error && job.status !== 'cancelled' && (
                  <p className="text-xs text-red-500 mt-1 ml-6">{job.error}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ResolveMergesSection() {
  const [suggestions, setSuggestions] = useState<VenueMergeSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [processingIds, setProcessingIds] = useState<string[]>([]);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadSuggestions = async (silent = false) => {
    if (!silent) {
      setLoading(true);
    }
    try {
      const data = await venueMerges.list('pending');
      setSuggestions(data);
      setSelectedIds((prev) => prev.filter((id) => data.some((item) => item.id === id)));
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load merge suggestions.' });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadSuggestions();
    const interval = setInterval(() => {
      loadSuggestions(true).catch(() => undefined);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]);
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => prev.length === suggestions.length ? [] : suggestions.map((item) => item.id));
  };

  const resolveSingle = async (id: string, action: 'approve' | 'deny') => {
    setProcessingIds((prev) => [...prev, id]);
    setMessage(null);
    try {
      if (action === 'approve') {
        await venueMerges.approve(id);
      } else {
        await venueMerges.deny(id);
      }
      setMessage({ type: 'success', text: action === 'approve' ? 'Merge approved.' : 'Merge denied.' });
      await loadSuggestions(true);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to resolve merge.' });
    } finally {
      setProcessingIds((prev) => prev.filter((item) => item !== id));
    }
  };

  const resolveBatch = async (action: 'approve' | 'deny') => {
    if (selectedIds.length === 0) {
      return;
    }
    setProcessingIds(selectedIds);
    setMessage(null);
    try {
      const result = await venueMerges.resolveBatch(selectedIds, action);
      const failures = result.results.filter((item: { status: string }) => item.status === 'error').length;
      setMessage({
        type: failures > 0 ? 'error' : 'success',
        text: failures > 0
          ? `${result.resolved} of ${result.total} suggestions were resolved.`
          : `${action === 'approve' ? 'Approved' : 'Denied'} ${result.resolved} suggestions.`,
      });
      setSelectedIds([]);
      await loadSuggestions(true);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to resolve selected merges.' });
    } finally {
      setProcessingIds([]);
    }
  };

  const allSelected = suggestions.length > 0 && selectedIds.length === suggestions.length;

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <MapPin size={20} className="text-gray-600 dark:text-gray-400" />
            Resolve Merges
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Review nearby venues that look similar before any merge is applied.
          </p>
        </div>
        <button
          onClick={() => {
            setRefreshing(true);
            loadSuggestions(true).catch(() => undefined);
          }}
          disabled={refreshing}
          className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {message && (
        <div className={`flex items-center gap-2 text-sm ${message.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
          {message.type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
          {message.text}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin text-primary-600" size={24} />
        </div>
      ) : suggestions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-700 p-6 text-sm text-gray-500 dark:text-gray-400">
          No pending merge suggestions. Run “Scan Similar Venues” to generate new proposals.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200/70 dark:border-gray-700/70 bg-white/60 dark:bg-gray-800/40 p-3">
            <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                className="rounded border-gray-300 dark:border-gray-600"
              />
              Select all
            </label>
            <span className="text-xs text-gray-500 dark:text-gray-400">{selectedIds.length} selected</span>
            <button
              onClick={() => resolveBatch('approve')}
              disabled={selectedIds.length === 0 || processingIds.length > 0}
              className="btn-primary disabled:opacity-50"
            >
              Approve Selected
            </button>
            <button
              onClick={() => resolveBatch('deny')}
              disabled={selectedIds.length === 0 || processingIds.length > 0}
              className="btn-secondary disabled:opacity-50"
            >
              Deny Selected
            </button>
          </div>

          <div className="space-y-3">
            {suggestions.map((suggestion) => {
              const isProcessing = processingIds.includes(suggestion.id);
              const canonicalMeta = [suggestion.canonical_venue.city, suggestion.canonical_venue.state].filter(Boolean).join(', ');
              const duplicateMeta = [suggestion.duplicate_venue.city, suggestion.duplicate_venue.state].filter(Boolean).join(', ');

              return (
                <div key={suggestion.id} className="rounded-2xl border border-gray-200/70 dark:border-gray-700/70 bg-white/70 dark:bg-gray-800/50 p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(suggestion.id)}
                      onChange={() => toggleSelection(suggestion.id)}
                      className="mt-1 rounded border-gray-300 dark:border-gray-600"
                    />
                    <div className="flex-1 min-w-0 space-y-3">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                        <span className="px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-700/70 text-gray-700 dark:text-gray-300">
                          {Math.round(suggestion.similarity_score * 100)}% similar
                        </span>
                        <span>{formatDistanceMeters(suggestion.distance_meters)} apart</span>
                        <span>{formatRelativeTime(suggestion.created_at)}</span>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="rounded-xl border border-green-200/70 dark:border-green-900/60 bg-green-50/50 dark:bg-green-900/10 p-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-green-700 dark:text-green-400">Keep</p>
                          <p className="mt-1 font-semibold text-gray-900 dark:text-gray-100">{suggestion.canonical_venue.name}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{canonicalMeta || suggestion.canonical_venue.address || 'No location details'}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">{suggestion.canonical_venue.checkin_count} check-ins</p>
                        </div>

                        <div className="rounded-xl border border-amber-200/70 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-900/10 p-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">Merge Into Keep</p>
                          <p className="mt-1 font-semibold text-gray-900 dark:text-gray-100">{suggestion.duplicate_venue.name}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{duplicateMeta || suggestion.duplicate_venue.address || 'No location details'}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">{suggestion.duplicate_venue.checkin_count} check-ins</p>
                        </div>
                      </div>

                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Match reason: {suggestion.reason.replace(/-/g, ' ')}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 justify-end">
                    <button
                      onClick={() => resolveSingle(suggestion.id, 'deny')}
                      disabled={isProcessing || processingIds.length > 0}
                      className="btn-secondary disabled:opacity-50"
                    >
                      {isProcessing ? <Loader2 size={16} className="animate-spin mr-2" /> : null}
                      Deny
                    </button>
                    <button
                      onClick={() => resolveSingle(suggestion.id, 'approve')}
                      disabled={isProcessing || processingIds.length > 0}
                      className="btn-primary disabled:opacity-50"
                    >
                      {isProcessing ? <Loader2 size={16} className="animate-spin mr-2" /> : null}
                      Approve Merge
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Settings() {
  type SettingsTab = 'account' | 'mood' | 'integrations' | 'data';
  const TIME_24H_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

  const isSettingsTab = (value: string | null): value is SettingsTab => {
    return value === 'account' || value === 'mood' || value === 'integrations' || value === 'data';
  };

  const getTabFromLocation = (): SettingsTab => {
    if (window.location.hash === '#mood-activities') return 'mood';
    const tabParam = new URLSearchParams(window.location.search).get('tab');
    return isSettingsTab(tabParam) ? tabParam : 'account';
  };

  const [data, setData] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [jobRefreshKey, setJobRefreshKey] = useState(0);
  const [activeTab, setActiveTab] = useState<SettingsTab>(getTabFromLocation);
  const [activityGroups, setActivityGroups] = useState<MoodActivityGroup[]>([]);
  const [activityGroupsLoading, setActivityGroupsLoading] = useState(false);

  // Profile form
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Integration form
  const [dawarichUrl, setDawarichUrl] = useState('');
  const [dawarichApiKey, setDawarichApiKey] = useState('');
  const [immichUrl, setImmichUrl] = useState('');
  const [immichApiKey, setImmichApiKey] = useState('');
  const [malojaUrl, setMalojaUrl] = useState('');
  const [integrationSaving, setIntegrationSaving] = useState(false);
  const [integrationMsg, setIntegrationMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Notifications
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [moodReminderTimes, setMoodReminderTimes] = useState<string[]>([]);
  const [notifSaving, setNotifSaving] = useState(false);
  const [notifMsg, setNotifMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const notificationsLoadedRef = useRef(false);

  useEffect(() => {
    async function loadSettings() {
      try {
        const s = await settings.get();
        setData(s);
        setUsername(s.username || '');
        setDisplayName(s.display_name || '');
        setDawarichUrl(s.dawarich_url || '');
        setDawarichApiKey(s.dawarich_api_key || '');
        setImmichUrl(s.immich_url || '');
        setImmichApiKey(s.immich_api_key || '');
        setMalojaUrl(s.maloja_url || '');
        setNotificationsEnabled(s.notifications_enabled ?? true);
        setMoodReminderTimes(Array.isArray(s.mood_reminder_times) ? s.mood_reminder_times : []);
      } catch (err) {
        console.error('Failed to load settings:', err);
      } finally {
        setLoading(false);
      }
    }
    loadSettings();
  }, []);

  useEffect(() => {
    if (!loading) {
      notificationsLoadedRef.current = true;
    }
  }, [loading]);

  useEffect(() => {
    async function loadActivityGroups() {
      try {
        setActivityGroupsLoading(true);
        const groups = await moodActivities.groups();
        setActivityGroups(groups);
      } catch (err) {
        console.error('Failed to load activity groups:', err);
      } finally {
        setActivityGroupsLoading(false);
      }
    }
    loadActivityGroups();
  }, []);

  const sortAllActivitiesAZ = async () => {
    if (activityGroups.length === 0) return;

    const confirmed = window.confirm(
      'Change the sort order for all activities within all groups to alphabetical (A-Z)?'
    );
    if (!confirmed) return;

    const sortedGroups = activityGroups.map((group) => {
      const sortedActivities = [...group.activities]
        .sort((a: MoodActivity, b: MoodActivity) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
        )
        .map((activity, index) => ({ ...activity, display_order: index }));

      return {
        ...group,
        activities: sortedActivities,
      };
    });

    const updates = sortedGroups.flatMap((group) => {
      const originalGroup = activityGroups.find((g) => g.id === group.id);
      if (!originalGroup) return [];

      return group.activities
        .map((activity, index) => ({
          id: activity.id,
          display_order: index,
          changed: originalGroup.activities[index]?.id !== activity.id,
        }))
        .filter((activity) => activity.changed)
        .map(({ id, display_order }) => ({ id, display_order }));
    });

    if (updates.length === 0) {
      setActivityGroups(sortedGroups);
      return;
    }

    try {
      setActivityGroupsLoading(true);
      await Promise.all(
        updates.map((activity) =>
          moodActivities.updateActivity(activity.id, { display_order: activity.display_order })
        )
      );
      setActivityGroups(sortedGroups);
    } catch (err) {
      console.error('Failed to sort activities alphabetically:', err);
    } finally {
      setActivityGroupsLoading(false);
    }
  };

  const saveProfile = async () => {
    setProfileSaving(true);
    setProfileMsg(null);
    try {
      await settings.updateProfile({ username, display_name: displayName });
      setProfileMsg({ type: 'success', text: 'Profile updated.' });
    } catch (err) {
      setProfileMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save.' });
    } finally {
      setProfileSaving(false);
    }
  };

  const saveIntegrations = async () => {
    setIntegrationSaving(true);
    setIntegrationMsg(null);
    try {
      await settings.update({
        dawarich_url: dawarichUrl || null,
        dawarich_api_key: dawarichApiKey || null,
        immich_url: immichUrl || null,
        immich_api_key: immichApiKey || null,
        maloja_url: malojaUrl || null,
      });
      setIntegrationMsg({ type: 'success', text: 'Integration settings saved.' });
    } catch (err) {
      setIntegrationMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save.' });
    } finally {
      setIntegrationSaving(false);
    }
  };

  useEffect(() => {
    if (!notificationsLoadedRef.current) return;

    const normalizedReminderTimes = Array.from(
      new Set(moodReminderTimes.map((t) => t.trim()).filter((t) => t.length > 0))
    ).sort();

    if (normalizedReminderTimes.some((t) => !TIME_24H_PATTERN.test(t))) {
      setNotifMsg({ type: 'error', text: 'Reminder times must use HH:MM format.' });
      return;
    }

    const shouldNormalizeState = normalizedReminderTimes.join(',') !== moodReminderTimes.join(',');
    if (shouldNormalizeState) {
      setMoodReminderTimes(normalizedReminderTimes);
      return;
    }

    const timeout = setTimeout(async () => {
      setNotifSaving(true);
      setNotifMsg(null);
      try {
        await settings.update({
          notifications_enabled: notificationsEnabled,
          mood_reminder_times: normalizedReminderTimes,
        });
        setNotifMsg({ type: 'success', text: 'Notification preferences saved.' });
        window.dispatchEvent(new Event('mood-reminders-updated'));
      } catch (err) {
        setNotifMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save.' });
      } finally {
        setNotifSaving(false);
      }
    }, 400);

    return () => clearTimeout(timeout);
  }, [notificationsEnabled, moodReminderTimes]);

  const { theme: currentTheme, setTheme } = useTheme();

  useEffect(() => {
    const syncTabFromLocation = () => {
      setActiveTab(getTabFromLocation());
    };

    syncTabFromLocation();
    window.addEventListener('popstate', syncTabFromLocation);
    window.addEventListener('hashchange', syncTabFromLocation);

    return () => {
      window.removeEventListener('popstate', syncTabFromLocation);
      window.removeEventListener('hashchange', syncTabFromLocation);
    };
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('tab') === activeTab) return;
    url.searchParams.set('tab', activeTab);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, [activeTab]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-primary-600" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Settings</h1>

      <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-2">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {([
            { value: 'account' as const, label: 'Account', icon: User },
            { value: 'mood' as const, label: 'Mood', icon: Smile },
            { value: 'integrations' as const, label: 'Integrations', icon: Link2 },
            { value: 'data' as const, label: 'Data', icon: Download },
          ]).map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => {
                setActiveTab(value);
              }}
              className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-sm font-medium transition-all ${activeTab === value
                ? 'bg-primary-50 dark:bg-primary-900/30 border border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-400 shadow-sm'
                : 'bg-white/50 dark:bg-gray-800/50 border border-transparent text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                }`}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'account' && (
        <>
          {/* Profile Section */}
          <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-6 space-y-4 scroll-mt-24">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <User size={20} className="text-gray-600 dark:text-gray-400" />
              Profile
            </h2>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Display Name</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="input"
                placeholder="Optional"
              />
            </div>
            {profileMsg && (
              <div className={`flex items-center gap-2 text-sm ${profileMsg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                {profileMsg.type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
                {profileMsg.text}
              </div>
            )}
            <button onClick={saveProfile} disabled={profileSaving} className="btn-primary">
              {profileSaving ? <Loader2 size={16} className="animate-spin mr-2" /> : null}
              Save Profile
            </button>
          </div>

          {/* Appearance Section */}
          <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Sun size={20} className="text-primary-600" />
              Appearance
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Choose your preferred color scheme.
            </p>
            <div className="grid grid-cols-3 gap-2">
              {([
                { value: 'system' as const, label: 'Follow System', icon: Monitor },
                { value: 'light' as const, label: 'Light', icon: Sun },
                { value: 'dark' as const, label: 'Dark', icon: Moon },
              ]).map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => setTheme(value)}
                  className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-all text-sm font-medium ${currentTheme === value
                    ? 'bg-primary-50 dark:bg-primary-900/30 border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-400 shadow-sm'
                    : 'bg-white/50 dark:bg-gray-800/50 border-gray-200/60 dark:border-gray-700/60 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                    }`}
                >
                  <Icon size={20} />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Notifications Section */}
          <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              {notificationsEnabled ? <Bell size={20} className="text-primary-600" /> : <BellOff size={20} className="text-gray-400" />}
              Notifications
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Control which notifications you receive.
            </p>

            <div className="space-y-3">
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Enable Notifications</p>
                </div>
                <button
                  onClick={() => setNotificationsEnabled(!notificationsEnabled)}
                  className={`relative w-11 h-6 rounded-full transition-colors ${notificationsEnabled ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-600'
                    }`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${notificationsEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`} />
                </button>
              </label>

              <div className={`space-y-3 transition-opacity ${notificationsEnabled ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                <div className="border-t border-gray-100 dark:border-gray-800 pt-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Mood Check-in Schedule</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Set daily reminders like 09:00, 14:00, and 20:30.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setMoodReminderTimes((prev) => [...prev, '09:00'])}
                      className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                    >
                      <Plus size={12} />
                      Add time
                    </button>
                  </div>

                  {moodReminderTimes.length > 0 ? (
                    <div className="space-y-2">
                      {moodReminderTimes.map((time, index) => (
                        <div key={`${time}-${index}`} className="flex items-center gap-2">
                          <input
                            type="time"
                            value={time}
                            onChange={(e) => {
                              const next = [...moodReminderTimes];
                              next[index] = e.target.value;
                              setMoodReminderTimes(next);
                            }}
                            className="input max-w-[160px]"
                            step={60}
                          />
                          <button
                            type="button"
                            onClick={() => setMoodReminderTimes((prev) => prev.filter((_, i) => i !== index))}
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-red-200 dark:border-red-800/60 text-red-600 dark:text-red-400 hover:bg-red-50/70 dark:hover:bg-red-900/20"
                            aria-label="Remove reminder time"
                          >
                            <Trash2 size={12} />
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500 dark:text-gray-400">No mood reminders scheduled yet.</p>
                  )}
                </div>

                <div className="border-t border-gray-100 dark:border-gray-800 pt-3">
                  <PushSettings enabled={notificationsEnabled} />
                </div>
              </div>
            </div>

            {notifSaving && (
              <p className="text-xs text-gray-500 dark:text-gray-400">Saving changes...</p>
            )}
            {notifMsg && (
              <div className={`flex items-center gap-2 text-sm ${notifMsg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                {notifMsg.type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
                {notifMsg.text}
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === 'mood' && (
        <>
          {/* Mood Icon Pack */}
          <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Smile size={20} className="text-primary-600" />
              Mood Icons
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Choose which icons represent your mood scale.
            </p>
            <div className="grid grid-cols-3 gap-2">
              {([
                { value: 'emoji' as const, label: 'Emoji' },
                { value: 'lucide' as const, label: 'Rounded' },
                { value: 'nature' as const, label: 'Nature' },
              ]).map(({ value, label }) => (
                <button
                  key={value}
                  onClick={async () => {
                    await settings.update({ mood_icon_pack: value });
                    setData(prev => prev ? { ...prev, mood_icon_pack: value } : prev);
                  }}
                  className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-all text-sm font-medium ${data?.mood_icon_pack === value
                    ? 'bg-primary-50 dark:bg-primary-900/30 border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-400 shadow-sm'
                    : 'bg-white/50 dark:bg-gray-800/50 border-gray-200/60 dark:border-gray-700/60 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                    }`}
                >
                  <MoodIconRow pack={value} size={20} />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Activity Groups Management */}
          <div id="mood-activities" className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <Cog size={20} className="text-gray-600 dark:text-gray-400" />
                Mood Activities
              </h2>
              <button
                type="button"
                onClick={sortAllActivitiesAZ}
                disabled={activityGroupsLoading || activityGroups.length === 0}
                className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Sort A&gt;Z
              </button>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Manage and reorder your mood activity groups and activities. Click the palette icon to change an activity's icon.
            </p>
            {activityGroupsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="animate-spin text-primary-600" size={24} />
              </div>
            ) : activityGroups.length > 0 ? (
              <ActivityGroupManager
                groups={activityGroups}
                onUpdate={setActivityGroups}
              />
            ) : (
              <p className="text-sm text-gray-500 text-center py-8">
                No activity groups created yet. Create one to get started!
              </p>
            )}
          </div>
        </>
      )}

      {activeTab === 'integrations' && (
        <>
          {/* Integrations Section */}
          <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Link2 size={20} className="text-gray-600 dark:text-gray-400" />
              Integrations
            </h2>

            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Dawarich</h3>
                <div className="space-y-2">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">URL</label>
                    <input
                      type="url"
                      value={dawarichUrl}
                      onChange={(e) => setDawarichUrl(e.target.value)}
                      className="input"
                      placeholder="https://dawarich.example.com"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">API Key</label>
                    <input
                      type="password"
                      value={dawarichApiKey}
                      onChange={(e) => setDawarichApiKey(e.target.value)}
                      className="input"
                      placeholder="Enter API key"
                    />
                  </div>
                </div>
              </div>

              <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Immich</h3>
                <div className="space-y-2">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">URL</label>
                    <input
                      type="url"
                      value={immichUrl}
                      onChange={(e) => setImmichUrl(e.target.value)}
                      className="input"
                      placeholder="https://immich.example.com"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">API Key</label>
                    <input
                      type="password"
                      value={immichApiKey}
                      onChange={(e) => setImmichApiKey(e.target.value)}
                      className="input"
                      placeholder="Enter API key"
                    />
                  </div>
                </div>
              </div>

              <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Maloja</h3>
                <p className="text-xs text-gray-500 mb-2">
                  Connect to your Maloja scrobble server to show what music you were listening to around each check-in.
                </p>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">URL</label>
                  <input
                    type="url"
                    value={malojaUrl}
                    onChange={(e) => setMalojaUrl(e.target.value)}
                    className="input"
                    placeholder="https://maloja.example.com"
                  />
                </div>
              </div>
            </div>

            {integrationMsg && (
              <div className={`flex items-center gap-2 text-sm ${integrationMsg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                {integrationMsg.type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
                {integrationMsg.text}
              </div>
            )}
            <button onClick={saveIntegrations} disabled={integrationSaving} className="btn-primary">
              {integrationSaving ? <Loader2 size={16} className="animate-spin mr-2" /> : null}
              Save Integrations
            </button>
          </div>
        </>
      )}

      {activeTab === 'data' && (
        <>
          {/* Import Section */}
          <SwarmImportSection onImportComplete={() => setJobRefreshKey((k) => k + 1)} />

          {/* Daylio Import Section */}
          <DaylioImportSection />

          {/* Jobs Section */}
          <JobsSection refreshKey={jobRefreshKey} />

          {/* Resolve Merges Section */}
          <ResolveMergesSection />

          {/* Export Section */}
          <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Download size={20} className="text-gray-600 dark:text-gray-400" />
              Export Data
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Download all your check-in data as a JSON file.
            </p>
            <a
              href="/api/v1/checkins/export"
              download
              className="btn-primary inline-flex items-center gap-2"
            >
              <Download size={16} />
              Export JSON
            </a>
          </div>
        </>
      )}
    </div>
  );
}
