import { useState, useEffect } from 'react';
import { User, Link2, Loader2, Check, AlertCircle } from 'lucide-react';
import { settings } from '../api/client';
import type { UserSettings } from '../types';

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

      {/* Import Section - placeholder for Commit 3 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4" id="import-section">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          Swarm Import
        </h2>
        <p className="text-sm text-gray-500">
          Import your check-in history from Swarm CSV export files. Upload all your CSV files at once for batch import.
        </p>
        <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center text-gray-400">
          <p className="text-sm">Import functionality coming soon.</p>
        </div>
      </div>
    </div>
  );
}
