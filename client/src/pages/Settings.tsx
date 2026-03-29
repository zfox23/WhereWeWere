import { useState, useEffect, useRef } from 'react';
import { User, Link2, Loader2, Check, AlertCircle, Upload, FileText, Cog, Clock, CheckCircle2, XCircle, Play, Send } from 'lucide-react';
import { settings, importApi, jobs } from '../api/client';
import type { UserSettings, ImportResult, Job } from '../types';

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
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
      <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
        <Upload size={20} className="text-gray-600" />
        Swarm Import
      </h2>
      <p className="text-sm text-gray-500">
        Import your check-in history from Swarm CSV export files. Upload all your CSV files at once for batch import.
      </p>

      <div
        onClick={() => fileInputRef.current?.click()}
        className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center cursor-pointer hover:border-primary-400 hover:bg-primary-50/30 transition-colors"
      >
        <Upload size={24} className="mx-auto text-gray-400 mb-2" />
        <p className="text-sm text-gray-600">
          {selectedFiles.length > 0
            ? `${selectedFiles.length} file${selectedFiles.length !== 1 ? 's' : ''} selected`
            : 'Click to select CSV files'}
        </p>
        <p className="text-xs text-gray-400 mt-1">Select your CSV files</p>
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
                className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 rounded text-xs text-gray-700"
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
        <div className="bg-gray-50 rounded-lg p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm text-green-600">
            <Check size={16} />
            Import complete
          </div>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold text-gray-900">{result.imported}</p>
              <p className="text-xs text-gray-500">Imported</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{result.skipped}</p>
              <p className="text-xs text-gray-500">Skipped</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{result.total_errors}</p>
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

  const hasActiveJob = jobList.some((j) => j.status === 'pending' || j.status === 'running');

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
      <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
        <Cog size={20} className="text-gray-600" />
        Jobs
      </h2>
      <p className="text-sm text-gray-500">
        Run background tasks to enrich venue data or sync with external services.
      </p>

      <div className="flex flex-wrap gap-2">
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
        <button
          onClick={() => startJob('dawarich-export')}
          disabled={starting || hasActiveJob}
          className="btn-secondary"
        >
          <Send size={16} className="mr-2" />
          Export to Dawarich
        </button>
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
          <div className="divide-y divide-gray-100">
            {jobList.map((job) => (
              <div key={job.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <JobStatusIcon status={job.status} />
                    <span className="text-sm font-medium text-gray-900 capitalize">{job.type}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                      job.status === 'completed' ? 'bg-green-50 text-green-700' :
                      job.status === 'running' ? 'bg-blue-50 text-blue-700' :
                      job.status === 'failed' ? 'bg-red-50 text-red-700' :
                      'bg-gray-50 text-gray-600'
                    }`}>
                      {job.status}
                    </span>
                  </div>
                  <span className="text-xs text-gray-400">{formatRelativeTime(job.created_at)}</span>
                </div>
                {job.progress?.message && (
                  <p className="text-xs text-gray-500 mt-1 ml-6">{job.progress.message}</p>
                )}
                {job.error && (
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

export default function Settings() {
  const [data, setData] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [jobRefreshKey, setJobRefreshKey] = useState(0);

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
  const [integrationSaving, setIntegrationSaving] = useState(false);
  const [integrationMsg, setIntegrationMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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
      } catch (err) {
        console.error('Failed to load settings:', err);
      } finally {
        setLoading(false);
      }
    }
    loadSettings();
  }, []);

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
      });
      setIntegrationMsg({ type: 'success', text: 'Integration settings saved.' });
    } catch (err) {
      setIntegrationMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save.' });
    } finally {
      setIntegrationSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-primary-600" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      {/* Profile Section */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <User size={20} className="text-gray-600" />
          Profile
        </h2>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="input"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Display Name</label>
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

      {/* Integrations Section */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Link2 size={20} className="text-gray-600" />
          Integrations
        </h2>

        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Dawarich</h3>
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

          <div className="border-t border-gray-100 pt-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Immich</h3>
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

      {/* Import Section */}
      <SwarmImportSection onImportComplete={() => setJobRefreshKey((k) => k + 1)} />

      {/* Jobs Section */}
      <JobsSection refreshKey={jobRefreshKey} />
    </div>
  );
}
