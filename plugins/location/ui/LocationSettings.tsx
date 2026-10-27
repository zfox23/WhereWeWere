/**
 * Location > Settings tab.
 *
 * Self-contained settings tab rendered by the core Settings page through the
 * plugin `settings` slot. Hosts the Swarm import section, moved out of the
 * core Data tab, the Coasterpedia API key for amusement ride lookups, and daily weather.
 */

import { SwarmImportSection } from './SwarmImportSection';
import CoasterpediaSettings from './CoasterpediaSettings';
import WeatherSettings from './WeatherSettings';

export function LocationSettings() {
  return (
    <>
      <SwarmImportSection />
      <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-6">
        <CoasterpediaSettings />
      </div>
      <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-6">
        <WeatherSettings />
      </div>
    </>
  );
}
