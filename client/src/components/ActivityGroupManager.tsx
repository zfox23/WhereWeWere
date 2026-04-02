import { useState } from 'react';
import { ChevronDown, ChevronUp, Plus, Trash2, Palette } from 'lucide-react';
import { moodActivities } from '../api/client';
import IconPicker from './IconPicker';
import { resolveActivityIcon } from '../utils/icons';
import type { MoodActivityGroup, MoodActivity } from '../types';

interface ActivityGroupManagerProps {
  groups: MoodActivityGroup[];
  onUpdate: (groups: MoodActivityGroup[]) => void;
}

function renderIcon(iconName?: string | null): React.ReactNode {
  if (!iconName) return null;
  const IconComponent = resolveActivityIcon(iconName);
  if (!IconComponent) return null;
  return <IconComponent size={16} className="flex-shrink-0 text-current" />;
}

export default function ActivityGroupManager({ groups, onUpdate }: ActivityGroupManagerProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(groups.map(g => g.id)));
  const [selectedIconActivity, setSelectedIconActivity] = useState<string | null>(null);
  const [addingActivityGroupId, setAddingActivityGroupId] = useState<string | null>(null);
  const [newActivityName, setNewActivityName] = useState('');
  const [loading, setLoading] = useState(false);

  const toggleGroup = (id: string) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedGroups(newExpanded);
  };

  const moveGroupUp = async (index: number) => {
    if (index === 0) return;
    const newGroups = [...groups];
    [newGroups[index], newGroups[index - 1]] = [newGroups[index - 1], newGroups[index]];

    // Update orders
    setLoading(true);
    try {
      await Promise.all([
        moodActivities.updateGroup(newGroups[index].id, { display_order: index }),
        moodActivities.updateGroup(newGroups[index - 1].id, { display_order: index - 1 }),
      ]);
      onUpdate(newGroups);
    } catch (err) {
      console.error('Failed to reorder groups:', err);
    } finally {
      setLoading(false);
    }
  };

  const moveGroupDown = async (index: number) => {
    if (index === groups.length - 1) return;
    const newGroups = [...groups];
    [newGroups[index], newGroups[index + 1]] = [newGroups[index + 1], newGroups[index]];

    setLoading(true);
    try {
      await Promise.all([
        moodActivities.updateGroup(newGroups[index].id, { display_order: index }),
        moodActivities.updateGroup(newGroups[index + 1].id, { display_order: index + 1 }),
      ]);
      onUpdate(newGroups);
    } catch (err) {
      console.error('Failed to reorder groups:', err);
    } finally {
      setLoading(false);
    }
  };

  const moveActivityUp = async (groupIndex: number, activityIndex: number) => {
    if (activityIndex === 0) return;
    const newGroups = [...groups];
    const activities = [...newGroups[groupIndex].activities];
    [activities[activityIndex], activities[activityIndex - 1]] = [activities[activityIndex - 1], activities[activityIndex]];
    newGroups[groupIndex].activities = activities;

    setLoading(true);
    try {
      await Promise.all([
        moodActivities.updateActivity(activities[activityIndex].id, { display_order: activityIndex }),
        moodActivities.updateActivity(activities[activityIndex - 1].id, { display_order: activityIndex - 1 }),
      ]);
      onUpdate(newGroups);
    } catch (err) {
      console.error('Failed to reorder activities:', err);
    } finally {
      setLoading(false);
    }
  };

  const moveActivityDown = async (groupIndex: number, activityIndex: number) => {
    const activities = groups[groupIndex].activities;
    if (activityIndex === activities.length - 1) return;
    const newGroups = [...groups];
    const actArray = [...newGroups[groupIndex].activities];
    [actArray[activityIndex], actArray[activityIndex + 1]] = [actArray[activityIndex + 1], actArray[activityIndex]];
    newGroups[groupIndex].activities = actArray;

    setLoading(true);
    try {
      await Promise.all([
        moodActivities.updateActivity(actArray[activityIndex].id, { display_order: activityIndex }),
        moodActivities.updateActivity(actArray[activityIndex + 1].id, { display_order: activityIndex + 1 }),
      ]);
      onUpdate(newGroups);
    } catch (err) {
      console.error('Failed to reorder activities:', err);
    } finally {
      setLoading(false);
    }
  };

  const updateActivityIcon = async (activityId: string, icon: string | null) => {
    setLoading(true);
    try {
      await moodActivities.updateActivity(activityId, { icon });
      const newGroups = groups.map(group => ({
        ...group,
        activities: group.activities.map(act =>
          act.id === activityId ? { ...act, icon } : act
        ),
      }));
      onUpdate(newGroups);
      setSelectedIconActivity(null);
    } catch (err) {
      console.error('Failed to update activity icon:', err);
    } finally {
      setLoading(false);
    }
  };

  const addActivity = async (groupId: string) => {
    const trimmedName = newActivityName.trim();
    if (!trimmedName) return;

    setLoading(true);
    try {
      const createdActivity = await moodActivities.createActivity({
        group_id: groupId,
        name: trimmedName,
      });
      const newGroups = groups.map((group) => (
        group.id === groupId
          ? { ...group, activities: [...group.activities, createdActivity] }
          : group
      ));
      onUpdate(newGroups);
      setNewActivityName('');
      setAddingActivityGroupId(null);
      setExpandedGroups((prev) => new Set(prev).add(groupId));
    } catch (err) {
      console.error('Failed to create activity:', err);
    } finally {
      setLoading(false);
    }
  };

  const removeActivity = async (groupId: string, activityId: string) => {
    if (!window.confirm('Remove this activity from the group?')) {
      return;
    }

    setLoading(true);
    try {
      await moodActivities.deleteActivity(activityId);
      const newGroups = groups.map((group) => (
        group.id === groupId
          ? { ...group, activities: group.activities.filter((activity) => activity.id !== activityId) }
          : group
      ));
      onUpdate(newGroups);
    } catch (err) {
      console.error('Failed to delete activity:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      {groups.map((group, groupIndex) => (
        <div
          key={group.id}
          className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden"
        >
          {/* Group header */}
          <button
            onClick={() => toggleGroup(group.id)}
            disabled={loading}
            className="w-full px-4 py-3 flex items-center justify-between bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 transition disabled:opacity-50"
          >
            <span className="font-medium text-gray-900 dark:text-white">{group.name}</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {group.activities.length} activities
              </span>
              {expandedGroups.has(group.id) ? (
                <ChevronUp size={18} />
              ) : (
                <ChevronDown size={18} />
              )}
            </div>
          </button>

          {/* Group reorder buttons */}
          <div className="px-4 py-2 flex gap-1 border-t border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-800/60 text-gray-600 dark:text-gray-200">
            <button
              onClick={() => moveGroupUp(groupIndex)}
              disabled={loading || groupIndex === 0}
              title="Move up"
              className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronUp size={16} />
            </button>
            <button
              onClick={() => moveGroupDown(groupIndex)}
              disabled={loading || groupIndex === groups.length - 1}
              title="Move down"
              className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronDown size={16} />
            </button>
          </div>

          {/* Activities */}
          {expandedGroups.has(group.id) && (
            <div className="border-t border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">
              {group.activities.map((activity, actIndex) => (
                <div
                  key={activity.id}
                  className="px-2 py-3 flex items-center justify-between bg-white dark:bg-gray-900/50 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {activity.icon && (
                      <button
                        onClick={() => setSelectedIconActivity(activity.id)}
                        disabled={loading}
                        title="Change icon"
                        className="flex-shrink-0 p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded disabled:opacity-50"
                      >
                        {renderIcon(activity.icon)}
                      </button>
                    )}
                    <span className="text-sm text-gray-700 dark:text-gray-200 truncate">
                      {activity.name}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                    <button
                      onClick={() => removeActivity(group.id, activity.id)}
                      disabled={loading}
                      title="Remove activity"
                      className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded disabled:opacity-50"
                    >
                      <Trash2 size={16} className="text-gray-500 dark:text-gray-200 hover:text-red-600 dark:hover:text-red-300" />
                    </button>
                    <button
                      onClick={() => moveActivityUp(groupIndex, actIndex)}
                      disabled={loading || actIndex === 0}
                      title="Move up"
                      className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <ChevronUp size={16} />
                    </button>
                    <button
                      onClick={() => moveActivityDown(groupIndex, actIndex)}
                      disabled={loading || actIndex === group.activities.length - 1}
                      title="Move down"
                      className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <ChevronDown size={16} />
                    </button>
                  </div>
                </div>
              ))}

              <div className="px-4 py-3 bg-white dark:bg-gray-900/50">
                {addingActivityGroupId === group.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newActivityName}
                      onChange={(e) => setNewActivityName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          void addActivity(group.id);
                        }
                        if (e.key === 'Escape') {
                          setAddingActivityGroupId(null);
                          setNewActivityName('');
                        }
                      }}
                      placeholder="New activity name"
                      className="input flex-1 text-sm"
                      autoFocus
                    />
                    <button
                      onClick={() => addActivity(group.id)}
                      disabled={loading || !newActivityName.trim()}
                      className="btn-primary px-3 py-2 text-sm disabled:opacity-50"
                    >
                      Add
                    </button>
                    <button
                      onClick={() => {
                        setAddingActivityGroupId(null);
                        setNewActivityName('');
                      }}
                      disabled={loading}
                      className="px-3 py-2 text-sm text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-white"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setAddingActivityGroupId(group.id);
                      setNewActivityName('');
                    }}
                    disabled={loading}
                    className="inline-flex items-center gap-1 text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 disabled:opacity-50"
                  >
                    <Plus size={14} />
                    Add Activity
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Icon picker modal */}
      {selectedIconActivity && (
        <IconPicker
          value={
            groups
              .flatMap(g => g.activities)
              .find(a => a.id === selectedIconActivity)?.icon || undefined
          }
          onChange={(icon) => updateActivityIcon(selectedIconActivity, icon)}
          onClose={() => setSelectedIconActivity(null)}
        />
      )}
    </div>
  );
}
