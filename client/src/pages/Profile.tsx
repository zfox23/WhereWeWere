import { useEffect, useRef, useState } from 'react';
import { Brain, Users } from 'lucide-react';
import { allClientPlugins } from '../plugins/registry';
import { AutoProfileTab } from '../plugins/autoProfileTab';
import { ReflectTab } from '../components/ReflectTab';
import { CompanionsTab } from '../components/CompanionsTab';
import { usePageTitle } from '../utils/pageTitle';
import type { CheckinTypeClient } from 'wwp-shared';

/**
 * Tabs contributed by check-in plugins. A plugin that ships a `profileTab`
 * gets a tab keyed `plugin:<id>`; the others fall back to the auto count tab.
 */
const PROFILE_PLUGINS = allClientPlugins();

function renderPluginTab(plugin: CheckinTypeClient, userId: string) {
  const Tab = plugin.client.profileTab;
  return Tab ? <Tab userId={userId} /> : <AutoProfileTab pluginId={plugin.id} />;
}

export default function Profile() {
  type ProfileTab = 'reflect' | 'companions' | `plugin:${string}`;

  const isProfileTab = (value: string | null): value is ProfileTab => {
    if (!value) return false;
    if (value === 'reflect' || value === 'companions') {
      return true;
    }
    if (value.startsWith('plugin:')) {
      return PROFILE_PLUGINS.some((p) => `plugin:${p.id}` === value);
    }
    return false;
  };

  const getTabFromLocation = (): ProfileTab => {
    const tabParam = new URLSearchParams(window.location.search).get('tab');
    return isProfileTab(tabParam) ? tabParam : 'plugin:location';
  };

  const [activeTab, setActiveTab] = useState<ProfileTab>(getTabFromLocation);
  // Skip the param-strip on the initial render so a deep link to a tab with
  // its filter params (e.g. ?tab=plugin:mood&moodsWeek=...) isn't cleared
  // before that tab reads its params.
  const didStripParamsRef = useRef(false);

  const tabTitleMap: Record<string, string> = {
    reflect: 'Profile: Reflect',
    companions: 'Profile: Companions',
    ...Object.fromEntries(PROFILE_PLUGINS.map((p) => [`plugin:${p.id}`, `Profile: ${p.strings.profileTab}`])),
  };
  usePageTitle(tabTitleMap[activeTab] ?? 'Profile');

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
    if (!didStripParamsRef.current) {
      didStripParamsRef.current = true;
      return;
    }
    const url = new URL(window.location.href);
    let changed = false;

    if (url.searchParams.get('tab') !== activeTab) {
      url.searchParams.set('tab', activeTab);
      changed = true;
    }
    // Strip every tab-scoped filter param (the active tab re-syncs its own
    // on mount). Kept generic so plugins' URL params don't have to be listed
    // here — only the reserved `tab` key is preserved.
    for (const key of Array.from(url.searchParams.keys())) {
      if (key === 'tab') continue;
      url.searchParams.delete(key);
      changed = true;
    }

    if (changed) {
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }, [activeTab]);

  const tabButtonClass = (active: boolean) =>
    `flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${active
      ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
      }`;

  const renderBody = () => {
    if (activeTab === 'reflect') return <ReflectTab />;
    if (activeTab === 'companions') return <CompanionsTab />;
    const plugin = PROFILE_PLUGINS.find((p) => `plugin:${p.id}` === activeTab);
    if (plugin) return renderPluginTab(plugin, '00000000-0000-0000-0000-000000000001');
    return null;
  };

  return (
    <div className="space-y-6">

      {/* Tab bar */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800/60 rounded-xl p-1 w-fit max-w-full overflow-x-auto">
        {PROFILE_PLUGINS.map((plugin) => {
          const Icon = plugin.client.icon as React.ElementType<{ size?: number; className?: string }>;
          const key = `plugin:${plugin.id}`;
          return (
            <button key={key} onClick={() => setActiveTab(key as ProfileTab)} className={tabButtonClass(activeTab === key)}>
              <Icon size={14} className={plugin.client.iconColor} />
              {plugin.strings.profileTab}
            </button>
          );
        })}
        <button onClick={() => setActiveTab('reflect')} className={tabButtonClass(activeTab === 'reflect')}>
          <Brain size={14} />
          Reflect
        </button>
        <button onClick={() => setActiveTab('companions')} className={tabButtonClass(activeTab === 'companions')}>
          <Users size={14} />
          Companions
        </button>
      </div>

      {renderBody()}
    </div>
  );
}
