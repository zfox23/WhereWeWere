import { useState, useEffect, useRef } from 'react';
import { User, Link2, Loader2, Check, AlertCircle, Upload, FileText, Globe } from 'lucide-react';
import { settings, importApi, venues } from '../api/client';
import type { UserSettings, ImportResult } from '../types';

async function runGeocodeBackfill(
  onProgress: (msg: string) => void,
  onDone: () => void
) {
  let remaining = Infinity;
  let totalUpdated = 0;
  while (remaining > 0) {
    const res = await venues.geocode();
    totalUpdated += res.updated;
    remaining = res.remaining;
    if (res.updated === 0) break;
    onProgress(`Geocoded ${totalUpdated} venues, ${remaining} remaining...`);
  }
  onDone();
}

function SwarmImportSection() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeMsg, setGeocodeMsg] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setSelectedFiles(files);
    setResult(null);
    setImportError(null);
  };

  const startGeocode = () => {
    setGeocoding(true);
    setGeocodeMsg('Starting geocoding...');
    runGeocodeBackfill(
      (msg) => setGeocodeMsg(msg),
      () => {
        setGeocoding(false);
        setGeocodeMsg('Geocoding complete!');
      }
    );
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
      // Auto-trigger geocoding after import
      if (data.imported > 0) {
        startGeocode();
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
        <p className="text-xs text-gray-400 mt-1">Up to 9 CSV files</p>
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

      {geocodeMsg && (
        <div className="flex items-center gap-2 text-sm text-gray-600">
          {geocoding ? <Loader2 size={14} className="animate-spin" /> : <Globe size={14} />}
          {geocodeMsg}
        </div>
      )}

      <div className="border-t border-gray-100 pt-4">
        <button
          onClick={startGeocode}
          disabled={geocoding || importing}
          className="btn-secondary text-sm"
        >
          {geocoding ? (
            <>
              <Loader2 size={14} className="animate-spin mr-2" />
              Geocoding...
            </>
          ) : (
            <>
              <Globe size={14} className="mr-2" />
              Resolve Missing Countries
            </>
          )}
        </button>
        <p className="text-xs text-gray-400 mt-1">
          Uses Nominatim to look up country, state, and city for venues missing location data.
        </p>
      </div>
    </div>
  );
}

export default function Settings() {
  const [data, setData] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);

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
      <SwarmImportSection />
    </div>
  );
}
