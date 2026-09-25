import type {
  CompanionSummary,
  TimestampReconciliationScanResult,
} from '../types';

const API_BASE = '/api/v1';
const API_ACCESS_TOKEN = (import.meta.env.VITE_API_ACCESS_TOKEN || '').trim();

export function withAuthHeader(headers: HeadersInit = {}): HeadersInit {
  if (!API_ACCESS_TOKEN) return headers;
  return { ...headers, 'X-WhereWeWere-Token': API_ACCESS_TOKEN };
}

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: withAuthHeader({ 'Content-Type': 'application/json', ...options?.headers }),
    ...options,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }));
    // Server error bodies use { error: "..." }; fall back to `message`, then status.
    throw new Error(error.error || error.message || `Request failed: ${res.status}`);
  }
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
};

// Venues
export const venues = {
  list: (params?: Record<string, string>) =>
    request<any[]>(`/venues?${new URLSearchParams(params)}`),
  get: (id: string) => request<any>(`/venues/${id}`),
  // "All Venues" library view (venues with at least one check-in).
  library: (from?: string, to?: string) => {
    const qp = new URLSearchParams();
    if (from) qp.set('from', from);
    if (to) qp.set('to', to);
    const qs = qp.toString();
    return request<any[]>(`/venues/library${qs ? `?${qs}` : ''}`);
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

// Venue lists (location plugin)
export const venueLists = {
  list: () => request<any[]>('/venues/lists'),
  create: (name: string) =>
    request<any>('/venues/lists', { method: 'POST', body: JSON.stringify({ name }) }),
  rename: (id: string, name: string) =>
    request<any>(`/venues/lists/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  delete: (id: string) =>
    request<{ message: string; id: string }>(`/venues/lists/${id}`, { method: 'DELETE' }),
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

// Backup / Restore
export const backupApi = {
  export: async () => {
    const res = await fetch(`${API_BASE}/backup/export`);
    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(error.message || `Backup export failed: ${res.status}`);
    }

    const blob = await res.blob();
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
      body: form,
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(error.error || error.message || `Backup import failed: ${res.status}`);
    }
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
    return request<{ message: string; counts: Record<string, number> }>('/backup/start-over', {
      method: 'POST',
      body: JSON.stringify({
        first_confirmation: firstConfirmation,
        second_confirmation: secondConfirmation,
        options,
      }),
    });
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

// Scrobbles
export const scrobbles = {
  forCheckins: (checkinIds: string[]) =>
    request<Record<string, any[]>>(`/scrobbles?checkin_ids=${checkinIds.join(',')}`),
  forDate: (date: string) =>
    request<any[]>(`/scrobbles/by-date?date=${encodeURIComponent(date)}`),
};

// Timeline
export const timeline = {
  list: (params?: Record<string, string>) =>
    request<any[]>(`/timeline?${new URLSearchParams(params)}`),
};

// Settings
export const settings = {
  get: () => request<any>('/settings'),
  update: (data: any) =>
    request<any>('/settings', { method: 'PUT', body: JSON.stringify(data) }),
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

// LLM (Life Summary)
export const llm = {
  candidateImages: (from: string, to: string) =>
    request<{ assets: { id: string; thumbhash: string | null; originalFileName: string; localDateTime: string }[] }>(
      `/llm/candidate-images?${new URLSearchParams({ from, to })}`
    ),
  summarize: (from: string, to: string, imageAssetIds: string[]) =>
    request<{
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
    }>('/llm/summarize', {
      method: 'POST',
      body: JSON.stringify({ from, to, image_asset_ids: imageAssetIds }),
    }),
};
