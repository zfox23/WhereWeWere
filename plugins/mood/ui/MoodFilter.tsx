import { Smile } from 'lucide-react';
import PluginFilterShell from '../../../client/src/components/filters/PluginFilterShell';
import { MOOD_LABELS, MOOD_COLORS } from './MoodIcons';

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
    <PluginFilterShell
      icon={<Smile size={16} className="text-green-500" />}
      label="Mood"
      included={included}
      filtersDisabled={filtersDisabled}
      sectionDisabled={sectionDisabled}
      typeToggleDisabled={typeToggleDisabled}
      onToggleIncluded={onToggleIncluded}
    >
      <div>
        <div className="flex gap-1.5 flex-wrap">
          {([1, 2, 3, 4, 5] as const).map((m) => {
            const isActive = mood === String(m);
            return (
              <button
                key={m}
                disabled={sectionDisabled}
                onClick={() => onSetMood(isActive ? '' : String(m))}
                className={`px-2.5 py-2 rounded-lg text-xs font-medium transition-colors border disabled:cursor-not-allowed disabled:opacity-60 ${
                  isActive
                    ? 'bg-primary-600 text-white border-primary-600'
                    : 'bg-white/70 dark:bg-gray-800/70 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-primary-400 dark:hover:border-primary-600'
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
    </PluginFilterShell>
  );
}
