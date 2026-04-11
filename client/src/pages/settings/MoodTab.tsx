import { useState, useEffect } from 'react';
import { Smile, Palette, Loader2 } from 'lucide-react';
import { settings, moodActivities } from '../../api/client';
import { MoodIconRow } from '../../components/MoodIcons';
import ActivityGroupManager from '../../components/ActivityGroupManager';
import type { MoodActivityGroup, MoodActivity } from '../../types';

interface MoodTabProps {
  initialMoodIconPack: 'emoji' | 'lucide' | 'nature';
}

export function MoodTab({ initialMoodIconPack }: MoodTabProps) {
  const [moodIconPack, setMoodIconPack] = useState(initialMoodIconPack);
  const [activityGroups, setActivityGroups] = useState<MoodActivityGroup[]>([]);
  const [activityGroupsLoading, setActivityGroupsLoading] = useState(false);

  useEffect(() => {
    async function loadActivityGroups() {
      try {
        setActivityGroupsLoading(true);
        const groups = await moodActivities.groups();
        setActivityGroups(groups);
      } catch (err) {
        console.error('Failed to load activity groups:', err);
      } finally {
        setActivityGroupsLoading(false);
      }
    }
    loadActivityGroups();
  }, []);

  const sortAllActivitiesAZ = async () => {
    if (activityGroups.length === 0) return;

    const confirmed = window.confirm(
      'Change the sort order for all activities within all groups to alphabetical (A-Z)?'
    );
    if (!confirmed) return;

    const sortedGroups = activityGroups.map((group) => {
      const sortedActivities = [...group.activities]
        .sort((a: MoodActivity, b: MoodActivity) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
        )
        .map((activity, index) => ({ ...activity, display_order: index }));

      return { ...group, activities: sortedActivities };
    });

    const updates = sortedGroups.flatMap((group) => {
      const originalGroup = activityGroups.find((g) => g.id === group.id);
      if (!originalGroup) return [];

      return group.activities
        .map((activity, index) => ({
          id: activity.id,
          display_order: index,
          changed: originalGroup.activities[index]?.id !== activity.id,
        }))
        .filter((activity) => activity.changed)
        .map(({ id, display_order }) => ({ id, display_order }));
    });

    if (updates.length === 0) {
      setActivityGroups(sortedGroups);
      return;
    }

    try {
      setActivityGroupsLoading(true);
      await Promise.all(
        updates.map((activity) =>
          moodActivities.updateActivity(activity.id, { display_order: activity.display_order })
        )
      );
      setActivityGroups(sortedGroups);
    } catch (err) {
      console.error('Failed to sort activities alphabetically:', err);
    } finally {
      setActivityGroupsLoading(false);
    }
  };

  return (
    <>
      {/* Mood Icon Pack */}
      <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Smile size={20} className="text-primary-600" />
          Mood Icons
        </h2>
        <div className="grid grid-cols-3 gap-2">
          {([
            { value: 'emoji' as const, label: 'Emoji' },
            { value: 'lucide' as const, label: 'Rounded' },
            { value: 'nature' as const, label: 'Nature' },
          ]).map(({ value, label }) => (
            <button
              key={value}
              onClick={async () => {
                await settings.update({ mood_icon_pack: value });
                setMoodIconPack(value);
              }}
              className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-all text-sm font-medium ${moodIconPack === value
                ? 'bg-primary-50 dark:bg-primary-900/30 border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-400 shadow-sm'
                : 'bg-white/50 dark:bg-gray-800/50 border-gray-200/60 dark:border-gray-700/60 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                }`}
            >
              <MoodIconRow pack={value} size={20} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Activity Groups Management */}
      <div id="mood-activities" className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Palette size={20} className="text-gray-600 dark:text-gray-400" />
            Activities
          </h2>
          <button
            type="button"
            onClick={sortAllActivitiesAZ}
            disabled={activityGroupsLoading || activityGroups.length === 0}
            className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Sort A&gt;Z
          </button>
        </div>
        {activityGroupsLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="animate-spin text-primary-600" size={24} />
          </div>
        ) : activityGroups.length > 0 ? (
          <ActivityGroupManager
            groups={activityGroups}
            onUpdate={setActivityGroups}
          />
        ) : (
          <p className="text-sm text-gray-500 text-center py-8">
            No activity groups created yet. Create one to get started!
          </p>
        )}
      </div>
    </>
  );
}
