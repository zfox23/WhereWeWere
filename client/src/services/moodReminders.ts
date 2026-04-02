import { settings } from '../api/client';
import type { UserSettings } from '../types';

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const TIME_24H_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

let refreshIntervalId: number | null = null;
let reminderTimeouts: number[] = [];
let started = false;

function clearReminderTimeouts() {
  for (const id of reminderTimeouts) {
    window.clearTimeout(id);
  }
  reminderTimeouts = [];
}

function normalizeReminderTimes(times: unknown): string[] {
  if (!Array.isArray(times)) return [];

  const unique = new Set<string>();
  for (const time of times) {
    if (typeof time === 'string' && TIME_24H_PATTERN.test(time)) {
      unique.add(time);
    }
  }

  return Array.from(unique).sort();
}

function msUntilNextRun(time: string): number {
  const [hoursStr, minutesStr] = time.split(':');
  const hours = Number(hoursStr);
  const minutes = Number(minutesStr);

  const now = new Date();
  const next = new Date(now);
  next.setHours(hours, minutes, 0, 0);

  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }

  return next.getTime() - now.getTime();
}

function formatTimeLabel(time: string): string {
  const [hoursStr, minutesStr] = time.split(':');
  const d = new Date();
  d.setHours(Number(hoursStr), Number(minutesStr), 0, 0);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function markAndCheckAlreadyFired(time: string): boolean {
  const key = `www:mood-reminder:${time}`;
  const today = new Date().toISOString().slice(0, 10);
  const last = window.localStorage.getItem(key);
  if (last === today) return true;

  window.localStorage.setItem(key, today);
  return false;
}

async function showMoodReminder(time: string) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (markAndCheckAlreadyFired(time)) return;

  const title = 'Mood check-in reminder';
  const body = `How are you feeling? Time for your ${formatTimeLabel(time)} mood check-in.`;

  const registration = await navigator.serviceWorker?.ready;
  if (registration) {
    await registration.showNotification(title, {
      body,
      icon: '/icon-192.svg',
      tag: `mood-reminder-${time}`,
      data: { url: '/mood-check-in' },
      requireInteraction: false,
    });
    return;
  }

  const notification = new Notification(title, {
    body,
    icon: '/icon-192.svg',
    tag: `mood-reminder-${time}`,
  });
  notification.onclick = () => {
    window.focus();
    window.location.href = '/mood-check-in';
  };
}

function scheduleSingleReminder(time: string) {
  const timeoutId = window.setTimeout(async () => {
    try {
      await showMoodReminder(time);
    } catch (err) {
      console.error('Failed to show mood reminder:', err);
    }

    // Reschedule the same reminder for the next day.
    scheduleSingleReminder(time);
  }, msUntilNextRun(time));

  reminderTimeouts.push(timeoutId);
}

function applySchedule(s: Pick<UserSettings, 'notifications_enabled' | 'mood_reminder_times'>) {
  clearReminderTimeouts();
  if (!s.notifications_enabled) return;

  const times = normalizeReminderTimes(s.mood_reminder_times);
  for (const time of times) {
    scheduleSingleReminder(time);
  }
}

async function refreshSchedule() {
  try {
    const s = await settings.get();
    applySchedule(s);
  } catch (err) {
    console.error('Failed to refresh mood reminder schedule:', err);
  }
}

export function startMoodReminderScheduler() {
  if (started) return;
  started = true;

  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch((err) => {
      console.error('Failed to request notification permission:', err);
    });
  }

  void refreshSchedule();
  refreshIntervalId = window.setInterval(() => {
    void refreshSchedule();
  }, REFRESH_INTERVAL_MS);

  window.addEventListener('mood-reminders-updated', () => {
    void refreshSchedule();
  });
}

export function stopMoodReminderScheduler() {
  if (refreshIntervalId !== null) {
    window.clearInterval(refreshIntervalId);
    refreshIntervalId = null;
  }
  clearReminderTimeouts();
  started = false;
}
