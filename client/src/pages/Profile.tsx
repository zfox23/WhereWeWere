import { useEffect, useState } from 'react';
import { Brain, MapPin, Moon, SmilePlus } from 'lucide-react';
import { MoodsTab } from '../components/MoodStats';
import { PlacesTab } from '../components/PlacesTab';
import { ReflectTab } from '../components/ReflectTab';
import { SleepTab } from '../components/SleepTab';
import { usePageTitle } from '../utils/pageTitle';

export default function Profile() {
  type ProfileTab = 'places' | 'reflect' | 'moods' | 'sleep';

  const isProfileTab = (value: string | null): value is ProfileTab => {
    return value === 'places' || value === 'reflect' || value === 'moods' || value === 'sleep';
  };

  const getTabFromLocation = (): ProfileTab => {
    const tabParam = new URLSearchParams(window.location.search).get('tab');
    return isProfileTab(tabParam) ? tabParam : 'places';
  };

  const [activeTab, setActiveTab] = useState<ProfileTab>(getTabFromLocation);

  const tabTitleMap: Record<ProfileTab, string> = {
    places: 'Profile: Places',
    moods: 'Profile: Moods',
    sleep: 'Profile: Sleep',
    reflect: 'Profile: Reflect',
  };
  usePageTitle(tabTitleMap[activeTab]);

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
    if (url.searchParams.get('tab') === activeTab) {
      return;
    }

    url.searchParams.set('tab', activeTab);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, [activeTab]);

  return (
    <div className="space-y-6">
      
      {/* Tab bar */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800/60 rounded-xl p-1 w-fit">
        <button
          onClick={() => setActiveTab('places')}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${activeTab === 'places'
            ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
        >
          <MapPin size={14} />
          Places
        </button>
        <button
          onClick={() => setActiveTab('moods')}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${activeTab === 'moods'
            ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
        >
          <SmilePlus size={14} />
          Moods
        </button>
        <button
          onClick={() => setActiveTab('sleep')}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${activeTab === 'sleep'
            ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
        >
          <Moon size={14} />
          Sleep
        </button>
        <button
          onClick={() => setActiveTab('reflect')}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${activeTab === 'reflect'
            ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
        >
          <Brain size={14} />
          Reflect
        </button>
      </div>

      {activeTab === 'places'
        ? <PlacesTab />
        : activeTab === 'reflect'
          ? <ReflectTab />
          : activeTab === 'sleep'
            ? <SleepTab />
            : <MoodsTab />}
    </div>
  );
}
