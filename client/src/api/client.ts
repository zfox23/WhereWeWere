import type {
  CompanionSummary,
  ListeningBefore,
  TimestampReconciliationScanResult,
} from '../types';

import { notifySettingsChanged } from '../utils/settingsEvents';
import { createListsApi } from './lists';

const API_BASE = '/api/v1';
const API_ACCESS_TOKEN = (import.meta.env.VITE_API_ACCESS_TOKEN || '').trim();

export function withAuthHeader(headers: HeadersInit = {}): HeadersInit {
  if (!API_ACCESS_TOKEN) return headers;
  return { ...headers, 'X-WhereWeWere-Token': API_ACCESS_TOKEN };
}

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  // Headers are merged explicitly and placed after the spread: the old order
  // let a caller-supplied `options.headers` replace Content-Type and the auth
  // header wholesale.
  const { headers: extraHeaders, ...rest } = options ?? {};
  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: withAuthHeader({
      'Content-Type': 'application/json',
      ...(extraHeaders as Record<string, string> | undefined),
    }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }));
    // Server error bodies use { error: "..." }; fall back to `message`, then status.
    throw new Error(error.error || error.message || `Request failed: ${res.status}`);
  }
  // 204 No Content has no body to parse (res.json() would throw on it).
  if (res.status === 204) return undefined as T;
  return res.json();
}

// Location check-ins (location plugin)
export const checkins = {
  list: (params?: Record<string, string>) =>
    request<any[]>(`/location-checkins?${new URLSearchParams(params)}`),
  get: (id: string) => request<any>(`/location-checkins/${id}`),
  create: (data: any) =>
    request<any>('/location-checkins', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: any) =>
    request<any>(`/location-checkins/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) =>
    request<void>(`/location-checkins/${id}`, { method: 'DELETE' }),
};

// Companions (core, shared by every check-in type that implements them)
export const companions = {
  // One row per name: check-in count + most recent check-in (Profile tab).
  list: () => request<CompanionSummary[]>('/companions'),
  // Distinct companion names (across all check-in types), for the
  // "Here With…" autocomplete.
  names: (q?: string, limit = 50) => {
    const qp = new URLSearchParams();
    if (q) qp.set('q', q);
    qp.set('limit', String(limit));
    return request<string[]>(`/companions/names?${qp.toString()}`);
  },
  // Add a standalone name to the shared pool (409 when it already exists).
  add: (name: string) =>
    request<{ name: string }>('/companions/names', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  // Rename a name across every check-in it appears on.
  rename: (from: string, to: string) =>
    request<{ updated: number }>('/companions/names', {
      method: 'PUT',
      body: JSON.stringify({ from, to }),
    }),
  // Remove a name from every check-in.
  remove: (name: string) =>
    request<{ deleted: number }>('/companions/names', {
      method: 'DELETE',
      body: JSON.stringify({ name }),
    }),
  // Featured Immich photo for a name (img src; 404 when Immich is disabled
  // or no matching person exists — server caches lookups on disk).
  photoUrl: (name: string) => `${API_BASE}/immich/person-photo?name=${encodeURIComponent(name)}`,
};

// Venues
export const venues = {
  list: (params?: Record<string, string>) =>
    request<any[]>(`/venues?${new URLSearchParams(params)}`),
  get: (id: string) => request<any>(`/venues/${id}`),
  // "All Venues" library view (venues with at least one check-in), searched,
  // filtered, sorted and paged by the server.
  library: (
    from?: string,
    to?: string,
    opts: { q?: string; category?: string; list?: string; sort?: string; dir?: 'asc' | 'desc'; limit?: number; offset?: number } = {},
  ) => {
    const qp = new URLSearchParams();
    if (from) qp.set('from', from);
    if (to) qp.set('to', to);
    for (const [key, value] of Object.entries(opts)) {
      if (value !== undefined && value !== '') qp.set(key, String(value));
    }
    const qs = qp.toString();
    return request<{ rows: any[]; total: number }>(`/venues/library${qs ? `?${qs}` : ''}`);
  },
  create: (data: any) =>
    request<any>('/venues', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: any) =>
    request<any>(`/venues/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) =>
    request<{ message: string; id: string }>(`/venues/${id}`, { method: 'DELETE' }),
  mergeInto: (sourceId: string, targetId: string) =>
    request<any>(`/venues/${sourceId}/merge-into`, { method: 'POST', body: JSON.stringify({ target_id: targetId }) }),
  nearby: (params: Record<string, string>) =>
    request<any[]>(`/venues/nearby?${new URLSearchParams(params)}`),
  placeSearch: (params: Record<string, string>) =>
    request<any[]>(`/venues/place-search?${new URLSearchParams(params)}`),
  categories: () => request<any[]>('/venues/categories'),
  importOsm: (data: any) =>
    request<any>('/venues/import-osm', { method: 'POST', body: JSON.stringify(data) }),
  geocode: () =>
    request<{ updated: number; remaining: number }>('/venues/geocode', { method: 'POST' }),
  categorize: () =>
    request<{ updated: number; remaining: number }>('/venues/categorize', { method: 'POST' }),
};

// Checkin lists (location plugin) — named lists of location check-ins.
export const checkinLists = {
  ...createListsApi<any, any>('/location-checkins'),
  addCheckin: (listId: string, checkinId: string) =>
    request<{ message: string }>(`/location-checkins/lists/${listId}/items`, {
      method: 'POST',
      body: JSON.stringify({ checkin_id: checkinId }),
    }),
  removeCheckin: (listId: string, checkinId: string) =>
    request<{ message: string }>(`/location-checkins/lists/${listId}/items/${checkinId}`, { method: 'DELETE' }),
  setRank: (listId: string, checkinId: string, rank: number | null) =>
    request<{ rank: number | null }>(`/location-checkins/lists/${listId}/items/${checkinId}/rank`, {
      method: 'PUT',
      body: JSON.stringify({ rank }),
    }),
};

// Venue lists (location plugin)
export const venueLists = {
  ...createListsApi<any, any>('/venues'),
  addVenue: (listId: string, venueId: string) =>
    request<{ message: string }>(`/venues/lists/${listId}/items`, { method: 'POST', body: JSON.stringify({ venue_id: venueId }) }),
  removeVenue: (listId: string, venueId: string) =>
    request<{ message: string }>(`/venues/lists/${listId}/items/${venueId}`, { method: 'DELETE' }),
};

// Stats
export const stats = {
  summary: (userId: string, from?: string, to?: string) => {
    const qp = new URLSearchParams({ user_id: userId });
    if (from && to) {
      qp.set('from', from);
      qp.set('to', to);
    }
    return request<any>(`/location-checkins/stats/summary?${qp.toString()}`);
  },
  topVenues: (userId: string, limit = 10, from?: string, to?: string) => {
    const qp = new URLSearchParams({ user_id: userId, limit: String(limit) });
    if (from && to) {
      qp.set('from', from);
      qp.set('to', to);
    }
    return request<any[]>(`/location-checkins/stats/top-venues?${qp.toString()}`);
  },
  categoryBreakdown: (userId: string, from?: string, to?: string) => {
    const qp = new URLSearchParams({ user_id: userId });
    if (from && to) {
      qp.set('from', from);
      qp.set('to', to);
    }
    return request<any[]>(`/location-checkins/stats/category-breakdown?${qp.toString()}`);
  },
  heatmap: (userId: string, year: number) =>
    request<any[]>(`/location-checkins/stats/heatmap?user_id=${userId}&year=${year}`),
  countries: (userId: string, from?: string, to?: string) => {
    const qp = new URLSearchParams({ user_id: userId });
    if (from && to) {
      qp.set('from', from);
      qp.set('to', to);
    }
    return request<any[]>(`/location-checkins/stats/countries?${qp.toString()}`);
  },
  mapData: (userId: string, from?: string, to?: string) => {
    const qp = new URLSearchParams({ user_id: userId });
    if (from && to) {
      qp.set('from', from);
      qp.set('to', to);
    }
    return request<any[]>(`/location-checkins/stats/map-data?${qp.toString()}`);
  },
  dayOfWeek: (userId: string, from?: string, to?: string) => {
    const qp = new URLSearchParams({ user_id: userId });
    if (from && to) {
      qp.set('from', from);
      qp.set('to', to);
    }
    return request<any[]>(`/location-checkins/stats/day-of-week?${qp.toString()}`);
  },
  timeOfDay: (userId: string, from?: string, to?: string) => {
    const qp = new URLSearchParams({ user_id: userId });
    if (from && to) {
      qp.set('from', from);
      qp.set('to', to);
    }
    return request<any[]>(`/location-checkins/stats/time-of-day?${qp.toString()}`);
  },
  busiestDays: (userId: string, from?: string, to?: string) => {
    const qp = new URLSearchParams({ user_id: userId });
    if (from && to) {
      qp.set('from', from);
      qp.set('to', to);
    }
    return request<any[]>(`/location-checkins/stats/busiest-days?${qp.toString()}`);
  },
  topCities: (userId: string, from?: string, to?: string) => {
    const qp = new URLSearchParams({ user_id: userId });
    if (from && to) {
      qp.set('from', from);
      qp.set('to', to);
    }
    return request<any[]>(`/location-checkins/stats/top-cities?${qp.toString()}`);
  },
  reflections: (userId: string, targetDate?: string) => {
    const qp = new URLSearchParams({ user_id: userId });
    if (targetDate) {
      qp.set('target_date', targetDate);
    }
    return request<any[]>(`/stats/reflections?${qp.toString()}`);
  },
  additionalStats: (userId: string) =>
    request<any>(`/location-checkins/stats/additional-stats?user_id=${userId}`),
  earliestDates: (userId: string) =>
    request<{ checkins: string | null; tracks: string | null; [typeId: string]: string | null }>(`/stats/earliest-dates?user_id=${userId}`),
};

// Search
export const search = {
  query: (q: string, type = 'all', limit = 20) =>
    request<any>(`/search?q=${encodeURIComponent(q)}&type=${type}&limit=${limit}`),
};

// Import
export const importApi = {
  swarm: async (files: File[]) => {
    const form = new FormData();
    files.forEach((f) => form.append('files', f));
    const res = await fetch(`${API_BASE}/import/swarm`, {
      method: 'POST',
      headers: withAuthHeader(),
      body: form,
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(error.message || `Import failed: ${res.status}`);
    }
    return res.json();
  },
};

/** Drop the service worker's cached API responses (stale after a restore or wipe). */
function clearApiCache(): void {
  try {
    if (typeof caches !== 'undefined') void caches.delete('api-cache');
  } catch {
    // CacheStorage unavailable (e.g. insecure context): nothing to clear
  }
}

// Backup / Restore
export interface BackupExportProgress {
  stage: 'collecting' | 'zipping' | 'downloading';
  /** 0-1, or null when the total is not known yet. */
  fraction: number | null;
  received?: number;
  total?: number;
}

export const backupApi = {
  /**
   * Build a backup on the server and download it. `onProgress` gets the
   * current stage with a 0-1 fraction (null while the total is unknown).
   */
  export: async (onProgress?: (progress: BackupExportProgress) => void) => {
    const fail = async (res: Response, fallback: string) => {
      const error = await res.json().catch(() => ({ message: res.statusText }));
      return new Error(error.error || error.message || `${fallback}: ${res.status}`);
    };

    const start = await fetch(`${API_BASE}/backup/export-jobs`, { method: 'POST', headers: withAuthHeader() });
    if (!start.ok) throw await fail(start, 'Backup export failed');
    const { id } = (await start.json()) as { id: string };

    for (;;) {
      const res = await fetch(`${API_BASE}/backup/export-jobs/${id}`, { headers: withAuthHeader() });
      if (!res.ok) throw await fail(res, 'Backup export failed');
      const job = await res.json() as {
        stage: 'collecting' | 'zipping' | 'ready' | 'error';
        processed: number;
        total: number;
        error?: string;
      };
      if (job.stage === 'error') throw new Error(job.error || 'Backup export failed');
      if (job.stage === 'ready') break;
      onProgress?.({
        stage: job.stage,
        fraction: job.stage === 'zipping' && job.total > 0 ? job.processed / job.total : null,
      });
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const res = await fetch(`${API_BASE}/backup/export-jobs/${id}/download`, { headers: withAuthHeader() });
    if (!res.ok || !res.body) throw await fail(res, 'Backup download failed');

    const total = Number(res.headers.get('Content-Length')) || 0;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      onProgress?.({ stage: 'downloading', fraction: total > 0 ? received / total : null, received, total });
    }
    const blob = new Blob(chunks as BlobPart[], { type: 'application/zip' });

    const disposition = res.headers.get('Content-Disposition') || res.headers.get('content-disposition');
    const fileNameMatch = disposition?.match(/filename="?([^\"]+)"?/i);
    const fileName = fileNameMatch?.[1] || `wherewewere-backup-v2-${new Date().toISOString().slice(0, 10)}.zip`;
    return { blob, fileName };
  },
  import: async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${API_BASE}/backup/import`, {
      method: 'POST',
      headers: withAuthHeader(),
      body: form,
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(error.error || error.message || `Backup import failed: ${res.status}`);
    }
    clearApiCache();
    return res.json();
  },
  startOver: async (
    firstConfirmation: string,
    secondConfirmation: string,
    options: {
      delete_all_checkins: boolean;
      delete_venue_checkins: boolean;
      reset_account_settings: boolean;
      reset_integrations_settings: boolean;
      /** Per-plugin options: `delete_<pluginId>_checkins`, `reset_<pluginId>_settings`. */
      [key: string]: boolean;
    }
  ) => {
    const result = await request<{ message: string; counts: Record<string, number> }>('/backup/start-over', {
      method: 'POST',
      body: JSON.stringify({
        first_confirmation: firstConfirmation,
        second_confirmation: secondConfirmation,
        options,
      }),
    });
    clearApiCache();
    return result;
  },
};

// Jobs
export const jobs = {
  list: () => request<any[]>('/jobs'),
  get: (id: string) => request<any>(`/jobs/${id}`),
  start: (type: string) =>
    request<any>('/jobs', { method: 'POST', body: JSON.stringify({ type }) }),
  cancel: (id: string) =>
    request<any>(`/jobs/${id}/cancel`, { method: 'POST' }),
};

// Immich photos
export const immich = {
  photos: (checkinId: string) =>
    request<{ assets: { id: string; thumbhash: string | null; originalFileName: string }[] }>(
      `/immich/photos/${checkinId}`
    ),
  photosForCheckins: (checkinIds: string[]) =>
    request<Record<string, { id: string; thumbhash: string | null; originalFileName: string }[]>>(
      `/immich/photos?checkin_ids=${checkinIds.join(',')}`
    ),
  thumbnailUrl: (assetId: string, size: 'thumbnail' | 'preview' = 'thumbnail') =>
    `${API_BASE}/immich/thumbnail/${assetId}?size=${size}`,
};

// Music listening shown on other check-ins' timeline cards
export const musicListening = {
  /** What was playing at the end of each check-in; check-ins with nothing to show are absent. */
  around: (checkinIds: string[]) =>
    request<Record<string, ListeningBefore>>(`/music/around?checkin_ids=${checkinIds.join(',')}`),
};

// Timeline
export const timeline = {
  list: (params?: Record<string, string>) =>
    request<any[]>(`/timeline?${new URLSearchParams(params)}`),
};

// Settings
export const settings = {
  get: () => request<any>('/settings'),
  update: async (data: any) => {
    const result = await request<any>('/settings', { method: 'PUT', body: JSON.stringify(data) });
    // Memoized settings readers (Immich enabled, distance unit) re-read now.
    notifySettingsChanged();
    return result;
  },
  updateProfile: (data: any) =>
    request<any>('/settings/profile', { method: 'PUT', body: JSON.stringify(data) }),
  timestampReconciliationPreview: () =>
    request<TimestampReconciliationScanResult>('/settings/timestamp-reconciliation'),
  applyTimestampReconciliation: (updates: any[]) =>
    request<{ updated: number }>('/settings/timestamp-reconciliation/apply', {
      method: 'POST',
      body: JSON.stringify({ updates }),
    }),
};

// Postcard From Your Past (Profile > Reflect)
export interface PostcardImage {
  id: string;
  originalFileName: string;
  localDateTime: string;
  /** Natural pixel dimensions (EXIF, when available) for collage layout. */
  width?: number;
  height?: number;
}

export interface Postcard {
  id?: string;
  from: string;
  to: string;
  addressed_to: string;
  sender_line: string;
  stamp_city: string | null;
  images: PostcardImage[];
  message: string;
  counts: Record<string, number>;
  created_at?: string;
}

/** Row in the received-postcards history list (GET /llm/postcards). */
export interface PostcardSummary {
  id: string;
  from: string;
  to: string;
  sender_line: string;
  stamp_city: string | null;
  message_preview: string;
  image_ids: string[];
  created_at: string;
}

// LLM (Life Summary)
export const llm = {
  /** "Postcard From Your Past" — one received postcard (front + back data). */
  postcard: () =>
    request<Postcard>('/llm/postcard', { method: 'POST', body: JSON.stringify({}) }),
  /** Received postcards, newest first (history list under the button). */
  postcardHistory: () => request<PostcardSummary[]>('/llm/postcards'),
  getPostcard: (id: string) => request<Postcard>(`/llm/postcards/${id}`),
  deletePostcard: (id: string) =>
    request<{ message: string; id: string }>(`/llm/postcards/${id}`, { method: 'DELETE' }),
  candidateImages: (from: string, to: string) =>
    request<{ assets: { id: string; thumbhash: string | null; originalFileName: string; localDateTime: string }[] }>(
      `/llm/candidate-images?${new URLSearchParams({ from, to })}`
    ),
  /** Starts a summary; generation runs server-side and is polled via summarizeStatus. */
  summarize: (from: string, to: string, imageAssetIds: string[]) =>
    request<{ task_id: string }>('/llm/summarize', {
      method: 'POST',
      body: JSON.stringify({ from, to, image_asset_ids: imageAssetIds }),
    }),
  summarizeStatus: (taskId: string) =>
    request<
      | { status: 'running' }
      | { status: 'error'; error: string }
      | {
          status: 'done';
          result: {
            summary: string;
            images_included: number;
            images_skipped: number;
            /** 'single' = full data in one LLM call, 'map-reduce' = chunked + condensed. */
            mode: 'single' | 'map-reduce';
            /** Number of chunks condensed during the map phase (0 for single). */
            chunks: number;
            /** Number of recursive reduction levels applied to the digests. */
            digest_levels: number;
            /** Always empty (kept for backward compatibility). */
            skipped: { type: string; total: number; included: number }[];
          };
        }
    >(`/llm/summarize/${encodeURIComponent(taskId)}`),
};
