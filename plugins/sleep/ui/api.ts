/**
 * Sleep check-in type — client API helpers.
 *
 * All endpoints live under the sleep plugin's own API routers (mounted at
 * `/sleep-entries`, `/webhook/sleep-as-android`, and `/import/sleep-as-android`).
 * Previously these helpers lived in the core client (`client/src/api/client.ts`)
 * and pointed at removed core routes; they now hit the plugin's real endpoints
 * so the sleep type is fully self-contained.
 */

import { request, withAuthHeader } from '../../../client/src/api/client';
import type {
  SleepDailyPoint,
  SleepEntry,
  SleepRatingBucket,
  SleepSummaryStats,
} from './types';

const BASE = '/sleep-entries';

export const sleepEntries = {
  list: (params?: Record<string, string>) =>
    request<SleepEntry[]>(`${BASE}?${new URLSearchParams(params)}`),
  get: (id: string) => request<SleepEntry>(`${BASE}/${id}`),
  create: (data: any) =>
    request<SleepEntry>(BASE, { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: any) =>
    request<SleepEntry>(`${BASE}/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) =>
    request<void>(`${BASE}/${id}`, { method: 'DELETE' }),
};

const STATS = `${BASE}/stats`;

function rangeQp(userId: string, from?: string, to?: string) {
  const qp = new URLSearchParams({ user_id: userId });
  if (from && to) { qp.set('from', from); qp.set('to', to); }
  return qp.toString();
}

export const sleepStats = {
  summary: (userId: string, from?: string, to?: string) =>
    request<SleepSummaryStats>(`${STATS}/summary?${rangeQp(userId, from, to)}`),
  daily: (userId: string, from?: string, to?: string) =>
    request<SleepDailyPoint[]>(`${STATS}/daily?${rangeQp(userId, from, to)}`),
  ratingDistribution: (userId: string, from?: string, to?: string) =>
    request<SleepRatingBucket[]>(`${STATS}/rating-distribution?${rangeQp(userId, from, to)}`),
  earliest: (userId: string) =>
    request<{ date: string | null }>(`${STATS}/earliest?user_id=${userId}`),
};

const WEBHOOK = '/webhook/sleep-as-android';

export const sleepWebhook = {
  stats: () => request<{ count: number }>(`${WEBHOOK}/stats`),
};

export const sleepAsAndroidImport = {
  /** Import a Sleep as Android .csv export into sleep entries. */
  importFile: async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`/api/v1/import/sleep-as-android`, {
      method: 'POST',
      headers: withAuthHeader(),
      body: form,
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(error.message || `Import failed: ${res.status}`);
    }
    return res.json() as Promise<{ imported: number; skipped: number; errors: string[]; total_errors: number }>;
  },
};
