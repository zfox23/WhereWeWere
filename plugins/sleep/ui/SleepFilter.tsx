/**
 * Sleep filter section for the Home timeline.
 *
 * Adapted from the former core component (client/src/components/filters/SleepFilter.tsx)
 * to the plugin `PluginFilterSectionProps` contract.
 */

import { Moon } from 'lucide-react';
import PluginTypeToggle from '../../../client/src/components/filters/PluginTypeToggle';
import type { PluginFilterSectionProps } from 'wwp-shared';

const SLEEP_DURATION_BUCKETS = [
  { value: 'lte6', label: '<=6h' },
  { value: '6to8', label: '6h-8h' },
  { value: 'gte8', label: '>=8h' },
];

export function SleepFilter({
  included,
  filtersDisabled,
  sectionDisabled,
  typeToggleDisabled,
  params,
  onToggleIncluded,
  onSetParam,
}: PluginFilterSectionProps) {
  const sleepDuration = params.sleep_duration ?? '';

  return (
    <div className={`rounded-xl border grid grid-cols-1 gap-3 ${filtersDisabled ? 'border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-900/40 opacity-60' : 'border-amber-200 dark:border-amber-800/60 bg-amber-50/50 dark:bg-amber-950/20'}`}>
      <PluginTypeToggle
        icon={<Moon size={16} className="text-indigo-500" />}
        label="Sleep"
        included={included}
        disabled={typeToggleDisabled}
        onToggle={onToggleIncluded}
      />
      {included && (
        <>
          {filtersDisabled && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Clear location/mood filters to enable sleep filtering.
            </p>
          )}
          <div>
            <div className="flex gap-1.5 flex-wrap">
              {SLEEP_DURATION_BUCKETS.map((bucket) => {
                const isActive = sleepDuration === bucket.value;
                return (
                  <button
                    key={bucket.value}
                    disabled={sectionDisabled}
                    onClick={() => onSetParam('sleep_duration', isActive ? '' : bucket.value)}
                    className={`px-2.5 py-2 rounded-lg text-xs font-medium transition-colors border disabled:cursor-not-allowed disabled:opacity-60 ${
                      isActive
                        ? 'bg-amber-500 text-white border-amber-500'
                        : 'bg-white/70 dark:bg-gray-800/70 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-amber-300 dark:hover:border-amber-600'
                    }`}
                  >
                    {bucket.label}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
