import { useEffect, useRef, useState } from 'react';
import { Brain, Clapperboard, MapPin, Moon, Route } from 'lucide-react';
import { allClientPlugins } from '../plugins/registry';
import { AutoProfileTab } from '../plugins/autoProfileTab';
import { MediaTab } from '../components/MediaTab';
import { PlacesTab } from '../components/PlacesTab';
import { ReflectTab } from '../components/ReflectTab';
import { SleepTab } from '../components/SleepTab';
import { TracksTab } from '../components/TracksTab';
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
  type ProfileTab = 'places' | 'reflect' | 'sleep' | 'tracks' | 'media' | `plugin:${string}`;

  const isProfileTab = (value: string | null): value is ProfileTab => {
    if (!value) return false;
    if (value === 'places' || value === 'reflect' || value === 'sleep' || value === 'tracks' || value === 'media') {
      return true;
    }
    if (value.startsWith('plugin:')) {
      return PROFILE_PLUGINS.some((p) => `plugin:${p.id}` === value);
    }
    return false;
  };

  const getTabFromLocation = (): ProfileTab => {
    const tabParam = new URLSearchParams(window.location.search).get('tab');
    return isProfileTab(tabParam) ? tabParam : 'places';
  };

  const [activeTab, setActiveTab] = useState<ProfileTab>(getTabFromLocation);
  // Skip the param-strip on the initial render so a deep link to a tab with
  // its filter params (e.g. ?tab=plugin:mood&moodsWeek=...) isn't cleared
  // before that tab reads its params.
  const didStripParamsRef = useRef(false);

  const tabTitleMap: Record<string, string> = {
    places: 'Profile: Places',
    sleep: 'Profile: Sleep',
    tracks: 'Profile: Tracks',
    media: 'Profile: Media',
    reflect: 'Profile: Reflect',
    ...Object.fromEntries(PROFILE_PLUGINS.map((p) => [`plugin:${p.id}`, `Profile: ${p.strings.title}`])),
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
    if (activeTab === 'places') return <PlacesTab />;
    if (activeTab === 'reflect') return <ReflectTab />;
    if (activeTab === 'sleep') return <SleepTab />;
    if (activeTab === 'tracks') return <TracksTab />;
    if (activeTab === 'media') return <MediaTab />;
    const plugin = PROFILE_PLUGINS.find((p) => `plugin:${p.id}` === activeTab);
    if (plugin) return renderPluginTab(plugin, '00000000-0000-0000-0000-000000000001');
    return null;
  };

  return (
    <div className="space-y-6">

      {/* Tab bar */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800/60 rounded-xl p-1 w-fit max-w-full overflow-x-auto">
        <button onClick={() => setActiveTab('places')} className={tabButtonClass(activeTab === 'places')}>
          <MapPin size={14} />
          Places
        </button>
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
        <button onClick={() => setActiveTab('sleep')} className={tabButtonClass(activeTab === 'sleep')}>
          <Moon size={14} />
          Sleep
        </button>
        <button onClick={() => setActiveTab('tracks')} className={tabButtonClass(activeTab === 'tracks')}>
          <Route size={14} />
          Tracks
        </button>
        <button onClick={() => setActiveTab('media')} className={tabButtonClass(activeTab === 'media')}>
          <Clapperboard size={14} />
          Media
        </button>
        <button onClick={() => setActiveTab('reflect')} className={tabButtonClass(activeTab === 'reflect')}>
          <Brain size={14} />
          Reflect
        </button>
      </div>

      {renderBody()}
    </div>
  );
}
