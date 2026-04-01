import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, Trash2, Plus, ArrowLeft } from 'lucide-react';
import { moodCheckins, moodActivities, settings as settingsApi } from '../api/client';
import { MoodIcon, MOOD_LABELS, MOOD_COLORS } from '../components/MoodIcons';
import type { MoodActivityGroup } from '../types';

function toLocalDatetimeString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function MoodCheckInPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('edit');

  const [mood, setMood] = useState<number>(0);
  const [note, setNote] = useState('');
  const [checkedInAt, setCheckedInAt] = useState(toLocalDatetimeString(new Date()));
  const [selectedActivities, setSelectedActivities] = useState<Set<string>>(new Set());
  const [groups, setGroups] = useState<MoodActivityGroup[]>([]);
  const [iconPack, setIconPack] = useState('emoji');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loading, setLoading] = useState(!!editId);

  // Inline add group/activity
  const [addingGroupName, setAddingGroupName] = useState('');
  const [showAddGroup, setShowAddGroup] = useState(false);
  const [addingActivityGroupId, setAddingActivityGroupId] = useState<string | null>(null);
  const [addingActivityName, setAddingActivityName] = useState('');

  useEffect(() => {
    moodActivities.groups().then(setGroups).catch(console.error);
    settingsApi.get().then((s: any) => {
      if (s.mood_icon_pack) setIconPack(s.mood_icon_pack);
    }).catch(console.error);
  }, []);

  useEffect(() => {
    if (!editId) return;
    setLoading(true);
    moodCheckins.get(editId).then((mc: any) => {
      setMood(mc.mood);
      setNote(mc.note || '');
      setCheckedInAt(toLocalDatetimeString(new Date(mc.checked_in_at)));
      setSelectedActivities(new Set(mc.activities.map((a: any) => a.id)));
    }).catch(console.error).finally(() => setLoading(false));
  }, [editId]);

  const toggleActivity = (id: string) => {
    setSelectedActivities(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAddGroup = async () => {
    if (!addingGroupName.trim()) return;
    try {
      const group = await moodActivities.createGroup({ name: addingGroupName.trim() });
      setGroups(prev => [...prev, { ...group, activities: [] }]);
      setAddingGroupName('');
      setShowAddGroup(false);
    } catch (err) {
      console.error('Failed to create group:', err);
    }
  };

  const handleAddActivity = async (groupId: string) => {
    if (!addingActivityName.trim()) return;
    try {
      const activity = await moodActivities.createActivity({ group_id: groupId, name: addingActivityName.trim() });
      setGroups(prev => prev.map(g =>
        g.id === groupId
          ? { ...g, activities: [...g.activities, activity] }
          : g
      ));
      setAddingActivityName('');
      setAddingActivityGroupId(null);
    } catch (err) {
      console.error('Failed to create activity:', err);
    }
  };

  const handleSubmit = async () => {
    if (mood === 0) return;
    setSaving(true);
    try {
      const data = {
        mood,
        note: note.trim() || null,
        checked_in_at: new Date(checkedInAt).toISOString(),
        activity_ids: Array.from(selectedActivities),
      };
      if (editId) {
        await moodCheckins.update(editId, data);
      } else {
        await moodCheckins.create(data);
      }
      navigate('/');
    } catch (err) {
      console.error('Failed to save mood checkin:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editId || !confirm('Delete this mood check-in?')) return;
    setDeleting(true);
    try {
      await moodCheckins.delete(editId);
      navigate('/');
    } catch (err) {
      console.error('Failed to delete mood checkin:', err);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin text-gray-400" size={32} />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-bold">{editId ? 'Edit Mood' : 'How are you feeling?'}</h1>
      </div>

      {/* Mood selector */}
      <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 p-4">
        <div className="flex items-center justify-around">
          {[1, 2, 3, 4, 5].map((m) => (
            <button
              key={m}
              onClick={() => setMood(m)}
              className={`flex flex-col items-center gap-1.5 p-3 rounded-xl transition-all ${
                mood === m
                  ? `scale-110 bg-gray-100 dark:bg-gray-800 ring-2 ring-offset-1 ${m === 1 ? 'ring-red-400' : m === 2 ? 'ring-orange-400' : m === 3 ? 'ring-yellow-400' : m === 4 ? 'ring-lime-400' : 'ring-green-400'}`
                  : 'hover:bg-gray-50 dark:hover:bg-gray-800/50 opacity-60 hover:opacity-100'
              }`}
            >
              <MoodIcon mood={m} pack={iconPack} size={32} />
              <span className={`text-xs font-medium ${mood === m ? MOOD_COLORS[m] : 'text-gray-500'}`}>
                {MOOD_LABELS[m]}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Activities */}
      <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 p-4 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Activities</h2>

        {groups.map((group) => (
          <div key={group.id}>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
              {group.name}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {group.activities.map((act) => (
                <button
                  key={act.id}
                  onClick={() => toggleActivity(act.id)}
                  className={`px-3 py-1 text-sm rounded-full border transition-all ${
                    selectedActivities.has(act.id)
                      ? 'bg-primary-500 text-white border-primary-500'
                      : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-primary-300'
                  }`}
                >
                  {act.name}
                </button>
              ))}
              {addingActivityGroupId === group.id ? (
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    value={addingActivityName}
                    onChange={(e) => setAddingActivityName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddActivity(group.id)}
                    placeholder="Activity name"
                    className="px-2 py-1 text-sm rounded-full border border-gray-300 dark:border-gray-600 bg-transparent w-28 focus:outline-none focus:border-primary-400"
                    autoFocus
                  />
                  <button
                    onClick={() => handleAddActivity(group.id)}
                    className="p-1 rounded-full text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/20"
                  >
                    <Plus size={14} />
                  </button>
                  <button
                    onClick={() => { setAddingActivityGroupId(null); setAddingActivityName(''); }}
                    className="text-xs text-gray-400 hover:text-gray-600"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setAddingActivityGroupId(group.id)}
                  className="px-2 py-1 text-sm rounded-full border border-dashed border-gray-300 dark:border-gray-600 text-gray-400 hover:text-gray-600 hover:border-gray-400 transition-colors"
                >
                  <Plus size={12} className="inline -mt-0.5" /> Add
                </button>
              )}
            </div>
          </div>
        ))}

        {/* Add group */}
        {showAddGroup ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={addingGroupName}
              onChange={(e) => setAddingGroupName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddGroup()}
              placeholder="Group name"
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent flex-1 focus:outline-none focus:border-primary-400"
              autoFocus
            />
            <button onClick={handleAddGroup} className="btn-primary text-sm px-3 py-1.5">Add</button>
            <button onClick={() => { setShowAddGroup(false); setAddingGroupName(''); }} className="text-sm text-gray-400 hover:text-gray-600">Cancel</button>
          </div>
        ) : (
          <button
            onClick={() => setShowAddGroup(true)}
            className="text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 flex items-center gap-1"
          >
            <Plus size={14} /> Add Group
          </button>
        )}
      </div>

      {/* Note */}
      <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 p-4">
        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Note</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What's on your mind? (Markdown supported)"
          rows={4}
          className="input w-full resize-none"
        />
      </div>

      {/* Time */}
      <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 p-4">
        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Time</label>
        <input
          type="datetime-local"
          value={checkedInAt}
          onChange={(e) => setCheckedInAt(e.target.value)}
          className="input w-full"
        />
      </div>

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={mood === 0 || saving}
        className="btn-primary w-full py-3 text-base font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {saving ? (
          <Loader2 className="animate-spin mx-auto" size={20} />
        ) : editId ? (
          'Update Mood'
        ) : (
          'Check In'
        )}
      </button>

      {/* Delete (edit mode) */}
      {editId && (
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="btn-danger w-full py-3 text-base font-semibold flex items-center justify-center gap-2"
        >
          {deleting ? (
            <Loader2 className="animate-spin" size={20} />
          ) : (
            <>
              <Trash2 size={16} />
              Delete
            </>
          )}
        </button>
      )}
    </div>
  );
}
