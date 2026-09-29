/**
 * Sleep filter section for the Home timeline.
 *
 * Adapted from the former core component (client/src/components/filters/SleepFilter.tsx)
 * to the plugin `PluginFilterSectionProps` contract, rendered inside the
 * shared `PluginFilterShell` so it matches the other plugin filter cards.
 */

import { Moon } from 'lucide-react';
import PluginFilterShell from '../../../client/src/components/filters/PluginFilterShell';
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
    <PluginFilterShell
      icon={<Moon size={16} className="text-indigo-500" />}
      label="Sleep"
      included={included}
      filtersDisabled={filtersDisabled}
      sectionDisabled={sectionDisabled}
      typeToggleDisabled={typeToggleDisabled}
      onToggleIncluded={onToggleIncluded}
    >
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
                    ? 'bg-primary-600 text-white border-primary-600'
                    : 'bg-white/70 dark:bg-gray-800/70 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-primary-400 dark:hover:border-primary-600'
                }`}
              >
                {bucket.label}
              </button>
            );
          })}
        </div>
      </div>
    </PluginFilterShell>
  );
}
