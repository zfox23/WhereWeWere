import { useState, useEffect } from 'react';
import { Loader2, User, Link2, Smile, Download, Ruler } from 'lucide-react';
import { settings } from '../api/client';
import { usePageTitle } from '../utils/pageTitle';
import { AccountTab } from './settings/AccountTab';
import { MoodTab } from './settings/MoodTab';
import { DisplayTab } from './settings/DisplayTab';
import { IntegrationsTab } from './settings/IntegrationsTab';
import { DataTab } from './settings/DataTab';
import type { UserSettings } from '../types';

type SettingsTab = 'account' | 'display' | 'mood' | 'integrations' | 'data';

const isSettingsTab = (value: string | null): value is SettingsTab =>
  value === 'account' || value === 'display' || value === 'mood' || value === 'integrations' || value === 'data';

const getTabFromLocation = (): SettingsTab => {
  if (window.location.hash === '#mood-activities') return 'mood';
  const tabParam = new URLSearchParams(window.location.search).get('tab');
  return isSettingsTab(tabParam) ? tabParam : 'account';
};

export default function Settings() {
  usePageTitle('Settings');

  const [data, setData] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [jobRefreshKey, setJobRefreshKey] = useState(0);
  const [activeTab, setActiveTab] = useState<SettingsTab>(getTabFromLocation);

  useEffect(() => {
    async function loadSettings() {
      try {
        const s = await settings.get();
        setData(s);
      } catch (err) {
        console.error('Failed to load settings:', err);
      } finally {
        setLoading(false);
      }
    }
    loadSettings();
  }, []);

  useEffect(() => {
    const syncTabFromLocation = () => setActiveTab(getTabFromLocation());
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
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {([
            { value: 'account' as const, label: 'Account', icon: User },
            { value: 'display' as const, label: 'Display', icon: Ruler },
            { value: 'mood' as const, label: 'Mood', icon: Smile },
            { value: 'integrations' as const, label: 'Integrations', icon: Link2 },
            { value: 'data' as const, label: 'Data', icon: Download },
          ]).map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => setActiveTab(value)}
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

      {activeTab === 'account' && data && (
        <AccountTab
          initialUsername={data.username || ''}
          initialDisplayName={data.display_name || ''}
          initialNotificationsEnabled={data.notifications_enabled ?? true}
          initialMoodReminderTimes={Array.isArray(data.mood_reminder_times) ? data.mood_reminder_times : []}
        />
      )}

      {activeTab === 'mood' && data && (
        <MoodTab initialMoodIconPack={data.mood_icon_pack} />
      )}

      {activeTab === 'display' && data && (
        <DisplayTab
          initialDistanceUnit={data.distance_unit === 'imperial' ? 'imperial' : 'metric'}
        />
      )}

      {activeTab === 'integrations' && data && (
        <IntegrationsTab
          initialDawarichUrl={data.dawarich_url || ''}
          initialDawarichApiKey={data.dawarich_api_key || ''}
          initialImmichUrl={data.immich_url || ''}
          initialImmichApiKey={data.immich_api_key || ''}
          initialMalojaUrl={data.maloja_url || ''}
        />
      )}

      {activeTab === 'data' && (
        <DataTab
          jobRefreshKey={jobRefreshKey}
          onImportComplete={() => setJobRefreshKey((k) => k + 1)}
        />
      )}
    </div>
  );
}
