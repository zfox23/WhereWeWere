export interface SleepFilterProps {
  included: boolean;
  filtersDisabled: boolean;
  sectionDisabled: boolean;
  typeToggleDisabled: boolean;
  sleepDuration: string;
  onToggleIncluded: () => void;
  onSetSleepDuration: (value: string) => void;
}

const SLEEP_DURATION_BUCKETS = [
  { value: 'lte6', label: '<=6h' },
  { value: '6to8', label: '6h-8h' },
  { value: 'gte8', label: '>=8h' },
];

export default function SleepFilter({
  included,
  filtersDisabled,
  sectionDisabled,
  typeToggleDisabled,
  sleepDuration,
  onToggleIncluded,
  onSetSleepDuration,
}: SleepFilterProps) {
  return (
    <div className={`rounded-xl border p-3 grid grid-cols-1 gap-3 ${filtersDisabled ? 'border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-900/40 opacity-60' : 'border-amber-200 dark:border-amber-800/60 bg-amber-50/50 dark:bg-amber-950/20'}`}>
      <div>
        <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={included}
            disabled={typeToggleDisabled}
            onChange={onToggleIncluded}
            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 disabled:cursor-not-allowed"
          />
          <span>Sleep</span>
        </label>
      </div>
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
                onClick={() => onSetSleepDuration(isActive ? '' : bucket.value)}
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
    </div>
  );
}
