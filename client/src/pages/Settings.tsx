import { useState, useEffect, useMemo } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, User, Link2, Download, Ruler, Users, Bell, Search, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { settings } from '../api/client';
import { usePageTitle } from '../utils/pageTitle';
import { allClientPlugins } from '../plugins/registry';
import { AccountTab } from './settings/AccountTab';
import { UsersTab } from './settings/UsersTab';
import { useAuth } from '../contexts/AuthContext';
import { DisplayTab } from './settings/DisplayTab';
import { IntegrationsTab } from './settings/IntegrationsTab';
import { DataTab } from './settings/DataTab';
import { NotificationsTab } from './settings/NotificationsTab';
import { CORE_SECTION_KEYWORDS, PLUGIN_SECTION_KEYWORDS, matchSection } from './settings/settingsSearch';
import type { UserSettings } from '../types';
import type { CheckinTypeClient } from 'wwp-shared';

/**
 * Check-in plugins that ship a `settings` component (e.g. the mood plugin's
 * icon pack + activities, the tracks plugin's activity types). Only these
 * get a Settings section; plugins without settings are omitted entirely.
 */
const SETTINGS_PLUGINS = allClientPlugins().filter((p) => p.client.settings);

type SettingsTab = 'account' | 'users' | 'display' | 'notifications' | 'integrations' | 'data' | `plugin:${string}`;

// `users` (account management) only exists for admins.
const isSettingsTab = (value: string | null, isAdmin: boolean): value is SettingsTab => {
  if (!value) return false;
  if (value === 'users') return isAdmin;
  if (value === 'account' || value === 'display' || value === 'notifications' || value === 'integrations' || value === 'data') {
    return true;
  }
  if (value.startsWith('plugin:')) {
    return SETTINGS_PLUGINS.some((p) => `plugin:${p.id}` === value);
  }
  return false;
};

type IconComponent = React.ElementType<{ size?: number; className?: string }>;

interface NavItem {
  value: SettingsTab;
  label: string;
  icon: IconComponent;
  keywords: string[];
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

function buildNavGroups(isAdmin: boolean): NavGroup[] {
  const core = (value: SettingsTab, label: string, icon: IconComponent): NavItem => ({
    value, label, icon, keywords: CORE_SECTION_KEYWORDS[value] ?? [],
  });
  const groups: NavGroup[] = [
    {
      title: 'General',
      items: [
        core('account', 'Account', User),
        core('display', 'Display', Ruler),
        core('notifications', 'Notifications', Bell),
        core('integrations', 'Integrations', Link2),
        core('data', 'Data', Download),
      ],
    },
    {
      title: 'Check-in types',
      items: SETTINGS_PLUGINS.map((p) => ({
        value: `plugin:${p.id}` as SettingsTab,
        label: p.strings.title,
        icon: p.client.icon as IconComponent,
        keywords: [p.strings.singular, p.strings.plural, ...(PLUGIN_SECTION_KEYWORDS[p.id] ?? [])],
      })),
    },
  ];
  if (isAdmin) groups.push({ title: 'Admin', items: [core('users', 'Users', Users)] });
  return groups.filter((g) => g.items.length > 0);
}

/** Set by `selectTab` when drilling in from the section list, so Back can pop that entry. */
const FROM_LIST_STATE = 'settingsFromList';

export default function Settings() {
  usePageTitle('Settings');
  const { user } = useAuth();
  const isAdmin = user?.is_admin === true;
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  const [data, setData] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [jobRefreshKey, setJobRefreshKey] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  // The section named in the URL, or null when none is (the section list on
  // mobile; Account on desktop, where the sidebar is always visible).
  const tabParam = searchParams.get('tab');
  const selectedTab: SettingsTab | null =
    location.hash === '#mood-activities' && SETTINGS_PLUGINS.some((p) => p.id === 'mood')
      ? 'plugin:mood'
      : isSettingsTab(tabParam, isAdmin) ? tabParam : null;
  const activeTab: SettingsTab = selectedTab ?? 'account';

  const navGroups = useMemo(() => buildNavGroups(isAdmin), [isAdmin]);
  const filteredGroups = useMemo(
    () => navGroups
      .map((g) => ({
        ...g,
        items: g.items
          .map((item) => ({ item, match: matchSection(item, query) }))
          .filter(({ match }) => match.matches),
      }))
      .filter((g) => g.items.length > 0),
    [navGroups, query],
  );
  const activeItem = navGroups.flatMap((g) => g.items).find((i) => i.value === activeTab);

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

  const selectTab = (tab: SettingsTab) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', tab);
    // Drilling in from the list adds a history entry so the back gesture
    // returns to the list; switching between sections replaces it.
    const fromList = selectedTab === null;
    navigate(
      { search: `?${params.toString()}`, hash: '' },
      { replace: !fromList, state: fromList ? { [FROM_LIST_STATE]: true } : null },
    );
  };

  const backToList = () => {
    const state = location.state as Record<string, unknown> | null;
    if (state?.[FROM_LIST_STATE]) {
      navigate(-1);
      return;
    }
    // Deep-linked straight into a section: going back in history would leave
    // the app, so swap the URL for the list instead.
    const params = new URLSearchParams(searchParams);
    params.delete('tab');
    const search = params.toString();
    navigate({ search: search ? `?${search}` : '', hash: '' }, { replace: true });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-primary-600" size={32} />
      </div>
    );
  }

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
    if (activeTab === 'notifications') {
      return <NotificationsTab />;
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

  const firstMatch = filteredGroups[0]?.items[0]?.item;

  return (
    <div className="space-y-6 max-w-4xl">
      <h1 className={`text-2xl font-bold text-gray-900 dark:text-gray-100 ${selectedTab ? 'hidden md:block' : ''}`}>
        Settings
      </h1>

      <div className="md:grid md:grid-cols-[14rem_minmax(0,1fr)] md:gap-6 md:items-start">
        <nav
          aria-label="Settings sections"
          className={`${selectedTab ? 'hidden md:block' : ''} md:sticky md:top-20 md:max-h-[calc(100vh-6rem)] md:overflow-y-auto bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-2 space-y-3`}
        >
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && firstMatch) {
                  e.preventDefault();
                  selectTab(firstMatch.value);
                } else if (e.key === 'Escape') {
                  setQuery('');
                }
              }}
              placeholder="Search settings"
              aria-label="Search settings"
              className="w-full pl-9 pr-8 py-2 rounded-xl text-sm bg-white/70 dark:bg-gray-800/70 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {filteredGroups.length === 0 && (
            <p className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">No settings match “{query.trim()}”.</p>
          )}

          {filteredGroups.map((group) => (
            <div key={group.title}>
              <h2 className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {group.title}
              </h2>
              <ul className="space-y-0.5">
                {group.items.map(({ item: { value, label, icon: Icon }, match }) => {
                  const current = value === activeTab;
                  return (
                    <li key={value}>
                      <button
                        type="button"
                        onClick={() => selectTab(value)}
                        aria-current={current ? 'page' : undefined}
                        className={`w-full flex items-center gap-3 px-3 py-3 md:py-2 rounded-xl text-sm font-medium text-left transition-all border ${current
                          ? 'md:bg-primary-50 md:dark:bg-primary-900/30 md:border-primary-300 md:dark:border-primary-700 md:text-primary-700 md:dark:text-primary-400 md:shadow-sm border-transparent text-gray-700 dark:text-gray-300'
                          : 'border-transparent text-gray-700 md:text-gray-600 dark:text-gray-300 md:dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                          }`}
                      >
                        <Icon size={16} className="shrink-0" />
                        <span className="flex-1 min-w-0">
                          <span className="block truncate">{label}</span>
                          {match.hint && (
                            <span className="block truncate text-xs font-normal text-gray-500 dark:text-gray-400">{match.hint}</span>
                          )}
                        </span>
                        <ChevronRight size={16} className="shrink-0 text-gray-400 md:hidden" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className={`${selectedTab ? '' : 'hidden md:block'} min-w-0 space-y-6`}>
          {selectedTab && (
            <div className="md:hidden flex items-center gap-2">
              <button
                type="button"
                onClick={backToList}
                className="flex items-center gap-1 -ml-2 px-2 py-1.5 rounded-lg text-sm font-medium text-primary-700 dark:text-primary-400 hover:bg-gray-100/60 dark:hover:bg-gray-800/60"
              >
                <ChevronLeft size={18} />
                Settings
              </button>
              {activeItem && (
                <span className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
                  <activeItem.icon size={18} />
                  {activeItem.label}
                </span>
              )}
            </div>
          )}

          {loadError && ['display', 'integrations'].includes(activeTab) && (
            <div className="text-sm text-red-600">
              Could not load your settings ({loadError}). Reload the page to edit them.
            </div>
          )}

          {renderBody()}
        </div>
      </div>
    </div>
  );
}
