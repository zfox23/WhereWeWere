import { useState, useEffect } from 'react';
import { Loader2, User, Link2, Download, Ruler, Users } from 'lucide-react';
import { settings } from '../api/client';
import { usePageTitle } from '../utils/pageTitle';
import { allClientPlugins } from '../plugins/registry';
import { AccountTab } from './settings/AccountTab';
import { UsersTab } from './settings/UsersTab';
import { useAuth } from '../contexts/AuthContext';
import { DisplayTab } from './settings/DisplayTab';
import { IntegrationsTab } from './settings/IntegrationsTab';
import { DataTab } from './settings/DataTab';
import type { UserSettings } from '../types';
import type { CheckinTypeClient } from 'wwp-shared';

/**
 * Check-in plugins that ship a `settings` component (e.g. the mood plugin's
 * icon pack + activities, the tracks plugin's activity types). Only these
 * get a Settings tab; plugins without settings are omitted from the tab bar
 * entirely.
 */
const SETTINGS_PLUGINS = allClientPlugins().filter((p) => p.client.settings);

type SettingsTab = 'account' | 'users' | 'display' | 'integrations' | 'data' | `plugin:${string}`;

// `users` (account management) only exists for admins.
const isSettingsTab = (value: string | null, isAdmin: boolean): value is SettingsTab => {
  if (!value) return false;
  if (value === 'users') return isAdmin;
  if (value === 'account' || value === 'display' || value === 'integrations' || value === 'data') {
    return true;
  }
  if (value.startsWith('plugin:')) {
    return SETTINGS_PLUGINS.some((p) => `plugin:${p.id}` === value);
  }
  return false;
};

const getTabFromLocation = (isAdmin: boolean): SettingsTab => {
  // Deep link to the mood plugin's activities section.
  if (window.location.hash === '#mood-activities' && SETTINGS_PLUGINS.some((p) => p.id === 'mood')) {
    return 'plugin:mood';
  }
  const tabParam = new URLSearchParams(window.location.search).get('tab');
  return isSettingsTab(tabParam, isAdmin) ? tabParam : 'account';
};

export default function Settings() {
  usePageTitle('Settings');
  const { user } = useAuth();
  const isAdmin = user?.is_admin === true;

  const [data, setData] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [jobRefreshKey, setJobRefreshKey] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => getTabFromLocation(isAdmin));

  // The tabs copy their initial values into local state on mount; keep the
  // cached settings in sync with what they save so re-opening a tab shows the
  // saved values instead of the ones loaded at page start.
  const patchSettings = (patch: Partial<UserSettings>) =>
    setData((prev) => (prev ? { ...prev, ...patch } : prev));

  useEffect(() => {
    async function loadSettings() {
      try {
        const s = await settings.get();
        setData(s);
      } catch (err) {
        console.error('Failed to load settings:', err);
        setLoadError(err instanceof Error ? err.message : 'Failed to load settings');
      } finally {
        setLoading(false);
      }
    }
    loadSettings();
  }, []);

  useEffect(() => {
    const syncTabFromLocation = () => setActiveTab(getTabFromLocation(isAdmin));
    syncTabFromLocation();
    window.addEventListener('popstate', syncTabFromLocation);
    window.addEventListener('hashchange', syncTabFromLocation);
    return () => {
      window.removeEventListener('popstate', syncTabFromLocation);
      window.removeEventListener('hashchange', syncTabFromLocation);
    };
  }, [isAdmin]);

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

  const tabButtons: { value: SettingsTab; label: string; icon: React.ElementType<{ size?: number; className?: string }> }[] = [
    { value: 'account', label: 'Account', icon: User },
    ...SETTINGS_PLUGINS.map((p) => ({
      value: `plugin:${p.id}` as SettingsTab,
      label: p.strings.title,
      icon: p.client.icon,
    })),
    { value: 'display' as const, label: 'Display', icon: Ruler },
    { value: 'integrations' as const, label: 'Integrations', icon: Link2 },
    { value: 'data' as const, label: 'Data', icon: Download },
    ...(isAdmin ? [{ value: 'users' as const, label: 'Users', icon: Users }] : []),
  ];

  const renderBody = () => {
    if (activeTab === 'account') {
      return <AccountTab />;
    }
    if (activeTab === 'users') {
      return isAdmin ? <UsersTab /> : null;
    }
    if (activeTab === 'display') {
      return data && (
        <DisplayTab
          initialDistanceUnit={data.distance_unit === 'imperial' ? 'imperial' : 'metric'}
          onSaved={patchSettings}
        />
      );
    }
    if (activeTab === 'integrations') {
      return data && (
        <IntegrationsTab
          initialDawarichUrl={data.dawarich_url || ''}
          initialDawarichApiKey={data.dawarich_api_key || ''}
          initialImmichUrl={data.immich_url || ''}
          initialImmichApiKey={data.immich_api_key || ''}
          initialLlmApiUrl={data.llm_api_url || ''}
          initialLlmModel={data.llm_model || ''}
          initialLlmReasoningLevel={data.llm_reasoning_level || 'medium'}
          initialLlmContextWindow={data.llm_context_window ? String(data.llm_context_window) : '262144'}
          initialLlmImageSupport={data.llm_image_support !== false}
          onSaved={patchSettings}
        />
      );
    }
    if (activeTab === 'data') {
      return <DataTab jobRefreshKey={jobRefreshKey} onImportComplete={() => setJobRefreshKey((k) => k + 1)} />;
    }
    const plugin: CheckinTypeClient | undefined = SETTINGS_PLUGINS.find((p) => `plugin:${p.id}` === activeTab);
    if (plugin?.client.settings) {
      // Plugin settings sections are self-contained (they read/write their own
      // plugin settings store), so render without core-injected props.
      const Settings = plugin.client.settings as unknown as React.ComponentType;
      return <Settings />;
    }
    return null;
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Settings</h1>

      <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-2">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {tabButtons.map(({ value, label, icon: Icon }) => (
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

      {loadError && ['display', 'integrations'].includes(activeTab) && (
        <div className="text-sm text-red-600">
          Could not load your settings ({loadError}). Reload the page to edit them.
        </div>
      )}

      {renderBody()}
    </div>
  );
}
