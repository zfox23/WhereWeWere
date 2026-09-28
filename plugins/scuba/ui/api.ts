/**
 * SCUBA dive check-in type — client API helpers.
 *
 * Check-in CRUD uses the framework's generic plugin API
 * (`/plugins/scuba/checkins`). The stats endpoints live under the plugin's
 * own `/scuba` router; the Diving Log import under `/import/scuba-logbook`.
 */

import { request, withAuthHeader } from '../../../client/src/api/client';

export interface ScubaSummaryStats {
  total_dives: number;
  total_bottom_time: number;
  avg_bottom_time: number | null;
  max_depth: number | null;
  avg_depth: number | null;
  air_consumed_bar: number;
  unique_sites: number;
  first_dive: string | null;
  last_dive: string | null;
}

export interface ScubaYearPoint {
  year: number;
  dives: number;
  total_bottom_time: number;
  max_depth: number | null;
}

export interface ScubaGroupCount {
  water_type?: string | null;
  dive_type?: string | null;
  dives: number;
}

export interface ScubaTopSite {
  place: string | null;
  city: string | null;
  country: string | null;
  dives: number;
  max_depth: number | null;
}

export interface ScubaMonthlyPoint {
  date: string;
  count: number;
  total_bottom_time: number;
  max_depth: number | null;
}

export interface ScubaImportResult {
  imported: number;
  skipped: number;
  errors: string[];
  total_errors: number;
}

const BASE = '/scuba/stats';

function rangeQp(userId: string, from?: string, to?: string) {
  const qp = new URLSearchParams({ user_id: userId });
  if (from && to) {
    qp.set('from', from);
    qp.set('to', to);
  }
  return qp.toString();
}

export const scubaStats = {
  summary: (userId: string, from?: string, to?: string) =>
    request<ScubaSummaryStats>(`${BASE}/summary?${rangeQp(userId, from, to)}`),
  byYear: (userId: string) => request<ScubaYearPoint[]>(`${BASE}/by-year?user_id=${userId}`),
  byWater: (userId: string, from?: string, to?: string) =>
    request<ScubaGroupCount[]>(`${BASE}/by-water?${rangeQp(userId, from, to)}`),
  byType: (userId: string, from?: string, to?: string) =>
    request<ScubaGroupCount[]>(`${BASE}/by-type?${rangeQp(userId, from, to)}`),
  topSites: (userId: string, from?: string, to?: string) =>
    request<ScubaTopSite[]>(`${BASE}/top-sites?${rangeQp(userId, from, to)}`),
  monthly: (userId: string, year: number) =>
    request<ScubaMonthlyPoint[]>(`${BASE}/monthly?user_id=${userId}&year=${year}`),
  earliest: (userId: string) => request<{ date: string | null }>(`${BASE}/earliest?user_id=${userId}`),
};

export const scubaLogbookImport = {
  /** Import a Diving Log .sql (SQLite) backup into SCUBA check-ins. */
  importFile: async (file: File, fallbackTimezone: string): Promise<ScubaImportResult> => {
    const form = new FormData();
    form.append('file', file);
    form.append('fallback_timezone', fallbackTimezone);
    const res = await fetch('/api/v1/import/scuba-logbook', {
      method: 'POST',
      headers: withAuthHeader(),
      body: form,
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || error.message || `Import failed: ${res.status}`);
    }
    return res.json() as Promise<ScubaImportResult>;
  },
};
