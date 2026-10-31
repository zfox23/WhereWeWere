/**
 * Sleep check-in type — client API helpers.
 *
 * All endpoints live under the sleep plugin's own API routers (mounted at
 * `/sleep-entries`, `/webhook/sleep-as-android/:token`, and `/import/sleep-as-android`).
 * Previously these helpers lived in the core client (`client/src/api/client.ts`)
 * and pointed at removed core routes; they now hit the plugin's real endpoints
 * so the sleep type is fully self-contained.
 */

import { apiFetch, request } from '../../../client/src/api/client';
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

function rangeQp(from?: string, to?: string) {
  const qp = new URLSearchParams();
  if (from && to) { qp.set('from', from); qp.set('to', to); }
  return qp.toString();
}

// Stats are always the signed-in user's own (the server scopes by session).
export const sleepStats = {
  summary: (from?: string, to?: string) =>
    request<SleepSummaryStats>(`${STATS}/summary?${rangeQp(from, to)}`),
  daily: (from?: string, to?: string) =>
    request<SleepDailyPoint[]>(`${STATS}/daily?${rangeQp(from, to)}`),
  ratingDistribution: (from?: string, to?: string) =>
    request<SleepRatingBucket[]>(`${STATS}/rating-distribution?${rangeQp(from, to)}`),
  earliest: () =>
    request<{ date: string | null }>(`${STATS}/earliest`),
};

export const sleepWebhook = {
  /** Number of webhook events received for the signed-in user. */
  stats: () => request<{ count: number }>(`${STATS}/webhook-events`),
  /**
   * The user's personal webhook URL. The secret token is per user; regenerating
   * it (Settings > Account) changes the URL.
   */
  url: async () => {
    const { token } = await request<{ token: string }>('/auth/webhook-token');
    return `${window.location.origin}/api/v1/webhook/sleep-as-android/${token}`;
  },
};

export const sleepAsAndroidImport = {
  /** Import a Sleep as Android .csv export into sleep entries. */
  importFile: async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    const res = await apiFetch(`/api/v1/import/sleep-as-android`, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(error.message || `Import failed: ${res.status}`);
    }
    return res.json() as Promise<{ imported: number; skipped: number; errors: string[]; total_errors: number }>;
  },
};
