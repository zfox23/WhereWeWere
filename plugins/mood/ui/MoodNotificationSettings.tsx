import { useEffect, useState } from 'react';
import { Plus, Trash2, Check, AlertCircle } from 'lucide-react';
import type { PluginNotificationSettingsProps } from 'wwp-shared';
import { validateDailyTimes } from 'wwp-shared';
import { plugins } from '../../../client/src/plugins/api';

/** Keep in sync with MAX_REMINDER_TIMES in plugins/mood/server.ts. */
const MAX_TIMES = 12;

function sortTimes(times: string[]): string[] {
  return [...times].sort();
}

/**
 * Settings > Notifications > Mood: the daily times to ask "How are you
 * feeling?". Stored in this plugin's settings (`reminder_times`); the server
 * sends them in each subscribed device's own timezone.
 */
export function MoodNotificationSettings({ enabled }: PluginNotificationSettingsProps) {
  const [times, setTimes] = useState<string[] | null>(null);
  const [draft, setDraft] = useState('09:00');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    plugins.settings
      .get('mood')
      .then((s) => {
        const value = Array.isArray(s?.reminder_times) ? s.reminder_times.filter((t: unknown) => typeof t === 'string') : [];
        setTimes(sortTimes(value));
      })
      .catch(() => setTimes([]));
  }, []);

  const save = async (next: string[]) => {
    const sorted = sortTimes(next);
    const problem = validateDailyTimes(sorted, MAX_TIMES);
    if (problem) {
      setMessage({ type: 'error', text: problem });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const saved = await plugins.settings.set('mood', { reminder_times: sorted });
      setTimes(Array.isArray(saved?.reminder_times) ? sortTimes(saved.reminder_times) : sorted);
      setMessage({ type: 'success', text: 'Saved.' });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Could not save.' });
    } finally {
      setSaving(false);
    }
  };

  if (!times) return null;

  const add = () => {
    if (!draft) return;
    if (times.includes(draft)) {
      setMessage({ type: 'error', text: `${draft} is already scheduled.` });
      return;
    }
    void save([...times, draft]);
  };

  return (
    <div className={`space-y-3 ${enabled ? '' : 'opacity-60'}`}>
      <div className="text-sm font-medium text-gray-700 dark:text-gray-300">Remind me every day at</div>
      {times.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">No reminder times yet.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {times.map((t) => (
            <li
              key={t}
              className="flex items-center gap-1 rounded-full border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-800/70 pl-3 pr-1 py-1 text-sm text-gray-800 dark:text-gray-200"
            >
              <time>{t}</time>
              <button
                type="button"
                aria-label={`Remove ${t}`}
                className="rounded-full p-1 text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30"
                onClick={() => void save(times.filter((x) => x !== t))}
                disabled={saving}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {times.length < MAX_TIMES && (
        <div className="flex items-center gap-2">
          <label htmlFor="mood-reminder-time" className="sr-only">Reminder time</label>
          <input
            id="mood-reminder-time"
            type="time"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="input w-36"
          />
          <button type="button" className="btn-secondary flex items-center gap-1" onClick={add} disabled={saving || !draft}>
            <Plus size={16} /> Add time
          </button>
        </div>
      )}
      {!enabled && times.length > 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400">Reminders are off. Turn them on above to receive them.</p>
      )}
      {message && (
        <div
          role={message.type === 'error' ? 'alert' : 'status'}
          className={`flex items-center gap-2 text-sm ${message.type === 'success' ? 'text-green-600' : 'text-red-600'}`}
        >
          {message.type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
          {message.text}
        </div>
      )}
    </div>
  );
}
