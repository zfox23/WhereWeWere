/**
 * Mood check-in type — client API helpers.
 *
 * All endpoints live under the mood plugin's own API router (mounted at
 * `/mood-checkins`). Previously these helpers lived in the core client
 * (`client/src/api/client.ts`) and pointed at removed core routes
 * (`/mood-activities`, `/stats/mood-*`); they now hit the plugin's real
 * endpoints so the mood type is fully self-contained.
 */

import { apiFetch, request } from '../../../client/src/api/client';
import type { MoodActivityGroup, MoodCheckIn } from './types';

const BASE = '/mood-checkins';

export const moodCheckins = {
  list: (params?: Record<string, string>) =>
    request<MoodCheckIn[]>(`${BASE}?${new URLSearchParams(params)}`),
  get: (id: string) => request<MoodCheckIn>(`${BASE}/${id}`),
  create: (data: any) =>
    request<MoodCheckIn>(BASE, { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: any) =>
    request<MoodCheckIn>(`${BASE}/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) =>
    request<void>(`${BASE}/${id}`, { method: 'DELETE' }),
};

const ACT = `${BASE}/activities`;

export const moodActivities = {
  groups: () => request<MoodActivityGroup[]>(`${ACT}/groups`),
  createGroup: (data: any) =>
    request<MoodActivityGroup>(`${ACT}/groups`, { method: 'POST', body: JSON.stringify(data) }),
  updateGroup: (id: string, data: any) =>
    request<MoodActivityGroup>(`${ACT}/groups/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteGroup: (id: string) =>
    request<void>(`${ACT}/groups/${id}`, { method: 'DELETE' }),
  createActivity: (data: any) =>
    request<any>(`${ACT}/activities`, { method: 'POST', body: JSON.stringify(data) }),
  reorderActivities: (groupId: string, activityIds: string[]) =>
    request<{ message: string; count: number }>(`${ACT}/activities/reorder`, {
      method: 'PUT',
      body: JSON.stringify({ group_id: groupId, activity_ids: activityIds }),
    }),
  updateActivity: (id: string, data: any) =>
    request<any>(`${ACT}/activities/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteActivity: (id: string) =>
    request<void>(`${ACT}/activities/${id}`, { method: 'DELETE' }),
};

const STATS = `${BASE}/stats`;

function rangeQp(from?: string, to?: string) {
  const qp = new URLSearchParams();
  if (from && to) { qp.set('from', from); qp.set('to', to); }
  return qp.toString();
}

// Stats are always the signed-in user's own (the server scopes by session).
export const moodStats = {
  daily: (from?: string, to?: string) =>
    request<any[]>(`${STATS}/daily?${rangeQp(from, to)}`),
  monthly: (year: number) =>
    request<any[]>(`${STATS}/monthly?year=${year}`),
  byDayOfWeek: (from?: string, to?: string) =>
    request<any[]>(`${STATS}/by-day-of-week?${rangeQp(from, to)}`),
  activityCorrelations: (from?: string, to?: string) =>
    request<any[]>(`${STATS}/activity-correlations?${rangeQp(from, to)}`),
  activityCombinations: (from?: string, to?: string) =>
    request<any[]>(`${STATS}/activity-combinations?${rangeQp(from, to)}`),
  countRange: (from?: string, to?: string) =>
    request<any[]>(`${STATS}/count-range?${rangeQp(from, to)}`),
  heatmap: (year: number) =>
    request<any[]>(`${STATS}/heatmap?year=${year}`),
  earliest: () =>
    request<{ date: string | null }>(`${STATS}/earliest`),
};

export const daylioImport = {
  /** Import a Daylio .daylio backup into mood check-ins. */
  importFile: async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    form.append('source_timezone', Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    const res = await apiFetch(`/api/v1${BASE}/import/daylio`, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(error.message || `Import failed: ${res.status}`);
    }
    return res.json() as Promise<{ imported: number; skipped: number; errors: string[]; total_errors: number }>;
  },
  /** Replace literal <br> text in existing mood check-in notes with newlines. */
  async replaceBreaks(): Promise<{ updated: number }> {
    const res = await apiFetch(`/api/v1${BASE}/import/daylio/replace-br`, {
      method: 'POST',
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(error.error || error.message || `Update failed: ${res.status}`);
    }
    return res.json();
  },
};
