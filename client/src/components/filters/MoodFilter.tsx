import { MOOD_LABELS, MOOD_COLORS } from '../MoodIcons';

export interface ActivityOption {
  id: string;
  name: string;
  groupName: string;
}

export interface MoodFilterProps {
  included: boolean;
  filtersDisabled: boolean;
  sectionDisabled: boolean;
  typeToggleDisabled: boolean;
  mood: string;
  activity: string;
  activityOptions: ActivityOption[];
  onToggleIncluded: () => void;
  onSetMood: (value: string) => void;
  onSetActivity: (value: string) => void;
}

export default function MoodFilter({
  included,
  filtersDisabled,
  sectionDisabled,
  typeToggleDisabled,
  mood,
  activity,
  activityOptions,
  onToggleIncluded,
  onSetMood,
  onSetActivity,
}: MoodFilterProps) {
  return (
    <div className={`rounded-xl border p-3 grid grid-cols-1 gap-3 ${filtersDisabled ? 'border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-900/40 opacity-60' : 'border-indigo-200 dark:border-indigo-800/60 bg-indigo-50/50 dark:bg-indigo-950/20'}`}>
      <div>
        <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={included}
            disabled={typeToggleDisabled}
            onChange={onToggleIncluded}
            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 disabled:cursor-not-allowed"
          />
          <span>Mood</span>
        </label>
      </div>
      {filtersDisabled && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Clear location/sleep filters to enable mood filtering.
        </p>
      )}
      <div>
        <div className="flex gap-1.5 flex-wrap">
          {([1, 2, 3, 4, 5] as const).map((m) => {
            const isActive = mood === String(m);
            return (
              <button
                key={m}
                disabled={sectionDisabled}
                onClick={() => onSetMood(isActive ? '' : String(m))}
                className={`px-2 py-2 rounded-lg text-xs font-medium transition-colors border disabled:cursor-not-allowed disabled:opacity-60 ${
                  isActive
                    ? 'bg-indigo-500 text-white border-indigo-500'
                    : 'bg-white/70 dark:bg-gray-800/70 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-indigo-300 dark:hover:border-indigo-600'
                }`}
              >
                <span className={isActive ? '' : MOOD_COLORS[m]}>{MOOD_LABELS[m]}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <select
          value={activity}
          disabled={sectionDisabled}
          onChange={(e) => onSetActivity(e.target.value)}
          className="input disabled:cursor-not-allowed disabled:opacity-60"
        >
          <option value="">All activities</option>
          {activity && !activityOptions.some((o) => o.name === activity) && (
            <option value={activity}>{activity} (current)</option>
          )}
          {Array.from(new Set(activityOptions.map((o) => o.groupName))).map((groupName) => (
            <optgroup key={groupName} label={groupName}>
              {activityOptions
                .filter((o) => o.groupName === groupName)
                .map((o) => (
                  <option key={o.id} value={o.name}>{o.name}</option>
                ))}
            </optgroup>
          ))}
        </select>
      </div>
    </div>
  );
}
