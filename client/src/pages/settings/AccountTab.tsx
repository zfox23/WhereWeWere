import { useState, useEffect, useRef } from 'react';
import { User, Bell, BellOff, Check, AlertCircle, Loader2, Plus, Trash2 } from 'lucide-react';
import { settings } from '../../api/client';
import { PushSettings } from '../../components/PushSettings';

const TIME_24H_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

interface AccountTabProps {
  initialUsername: string;
  initialDisplayName: string;
  initialNotificationsEnabled: boolean;
  initialMoodReminderTimes: string[];
}

export function AccountTab({
  initialUsername,
  initialDisplayName,
  initialNotificationsEnabled,
  initialMoodReminderTimes,
}: AccountTabProps) {
  const [username, setUsername] = useState(initialUsername);
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [notificationsEnabled, setNotificationsEnabled] = useState(initialNotificationsEnabled);
  const [moodReminderTimes, setMoodReminderTimes] = useState<string[]>(initialMoodReminderTimes);
  const [notifSaving, setNotifSaving] = useState(false);
  const [notifMsg, setNotifMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Skip saving on first mount — only save when values change after mount
  const isMountedRef = useRef(false);

  const saveProfile = async () => {
    setProfileSaving(true);
    setProfileMsg(null);
    try {
      await settings.updateProfile({ username, display_name: displayName });
      setProfileMsg({ type: 'success', text: 'Profile updated.' });
    } catch (err) {
      setProfileMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save.' });
    } finally {
      setProfileSaving(false);
    }
  };

  useEffect(() => {
    if (!isMountedRef.current) {
      isMountedRef.current = true;
      return;
    }

    const normalizedReminderTimes = Array.from(
      new Set(moodReminderTimes.map((t) => t.trim()).filter((t) => t.length > 0))
    ).sort();

    if (normalizedReminderTimes.some((t) => !TIME_24H_PATTERN.test(t))) {
      setNotifMsg({ type: 'error', text: 'Reminder times must use HH:MM format.' });
      return;
    }

    const shouldNormalizeState = normalizedReminderTimes.join(',') !== moodReminderTimes.join(',');
    if (shouldNormalizeState) {
      setMoodReminderTimes(normalizedReminderTimes);
      return;
    }

    const timeout = setTimeout(async () => {
      setNotifSaving(true);
      setNotifMsg(null);
      try {
        await settings.update({
          notifications_enabled: notificationsEnabled,
          mood_reminder_times: normalizedReminderTimes,
        });
        setNotifMsg({ type: 'success', text: 'Notification preferences saved.' });
        window.dispatchEvent(new Event('mood-reminders-updated'));
      } catch (err) {
        setNotifMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save.' });
      } finally {
        setNotifSaving(false);
      }
    }, 400);

    return () => clearTimeout(timeout);
  }, [notificationsEnabled, moodReminderTimes]);

  return (
    <>
      {/* Profile Section */}
      <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-6 space-y-4 scroll-mt-24">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <User size={20} className="text-gray-600 dark:text-gray-400" />
          Profile
        </h2>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Username</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="input"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Display Name</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="input"
            placeholder="Optional"
          />
        </div>
        {profileMsg && (
          <div className={`flex items-center gap-2 text-sm ${profileMsg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
            {profileMsg.type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
            {profileMsg.text}
          </div>
        )}
        <button onClick={saveProfile} disabled={profileSaving} className="btn-primary">
          {profileSaving ? <Loader2 size={16} className="animate-spin mr-2" /> : null}
          Save Profile
        </button>
      </div>

      {/* Notifications Section */}
      <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          {notificationsEnabled ? <Bell size={20} className="text-primary-600" /> : <BellOff size={20} className="text-gray-400" />}
          Notifications
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Control which notifications you receive.
        </p>

        <div className="space-y-3">
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Enable Notifications</p>
            </div>
            <button
              onClick={() => setNotificationsEnabled(!notificationsEnabled)}
              className={`relative w-11 h-6 rounded-full transition-colors ${notificationsEnabled ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-600'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${notificationsEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </label>

          <div className={`space-y-3 transition-opacity ${notificationsEnabled ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
            <div className="border-t border-gray-100 dark:border-gray-800 pt-3 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Mood Check-in Schedule</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Set daily reminders like 09:00, 14:00, and 20:30.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setMoodReminderTimes((prev) => [...prev, '09:00'])}
                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <Plus size={12} />
                  Add time
                </button>
              </div>

              {moodReminderTimes.length > 0 ? (
                <div className="space-y-2">
                  {moodReminderTimes.map((time, index) => (
                    <div key={`${time}-${index}`} className="flex items-center gap-2">
                      <input
                        type="time"
                        value={time}
                        onChange={(e) => {
                          const next = [...moodReminderTimes];
                          next[index] = e.target.value;
                          setMoodReminderTimes(next);
                        }}
                        className="input max-w-[160px]"
                        step={60}
                      />
                      <button
                        type="button"
                        onClick={() => setMoodReminderTimes((prev) => prev.filter((_, i) => i !== index))}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-red-200 dark:border-red-800/60 text-red-600 dark:text-red-400 hover:bg-red-50/70 dark:hover:bg-red-900/20"
                        aria-label="Remove reminder time"
                      >
                        <Trash2 size={12} />
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-500 dark:text-gray-400">No mood reminders scheduled yet.</p>
              )}
            </div>

            <div className="border-t border-gray-100 dark:border-gray-800 pt-3">
              <PushSettings enabled={notificationsEnabled} />
            </div>
          </div>
        </div>

        {notifSaving && (
          <p className="text-xs text-gray-500 dark:text-gray-400">Saving changes...</p>
        )}
        {notifMsg && (
          <div className={`flex items-center gap-2 text-sm ${notifMsg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
            {notifMsg.type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
            {notifMsg.text}
          </div>
        )}
      </div>
    </>
  );
}
