const API_BASE = '/api/v1';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(error.message || `Request failed: ${res.status}`);
  }
  return res.json();
}

// Checkins
export const checkins = {
  list: (params?: Record<string, string>) =>
    request<any[]>(`/checkins?${new URLSearchParams(params)}`),
  get: (id: string) => request<any>(`/checkins/${id}`),
  create: (data: any) =>
    request<any>('/checkins', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: any) =>
    request<any>(`/checkins/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) =>
    request<void>(`/checkins/${id}`, { method: 'DELETE' }),
};

// Venues
export const venues = {
  list: (params?: Record<string, string>) =>
    request<any[]>(`/venues?${new URLSearchParams(params)}`),
  get: (id: string) => request<any>(`/venues/${id}`),
  create: (data: any) =>
    request<any>('/venues', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: any) =>
    request<any>(`/venues/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
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

// Stats
export const stats = {
  summary: (userId: string) =>
    request<any>(`/stats/summary?user_id=${userId}`),
  streaks: (userId: string) =>
    request<any>(`/stats/streaks?user_id=${userId}`),
  topVenues: (userId: string, limit = 10) =>
    request<any[]>(`/stats/top-venues?user_id=${userId}&limit=${limit}`),
  categoryBreakdown: (userId: string) =>
    request<any[]>(`/stats/category-breakdown?user_id=${userId}`),
  heatmap: (userId: string, year: number) =>
    request<any[]>(`/stats/heatmap?user_id=${userId}&year=${year}`),
  countries: (userId: string) =>
    request<any[]>(`/stats/countries?user_id=${userId}`),
  mapData: (userId: string, from?: string, to?: string) => {
    const qp = new URLSearchParams({ user_id: userId });
    if (from && to) {
      qp.set('from', from);
      qp.set('to', to);
    }
    return request<any[]>(`/stats/map-data?${qp.toString()}`);
  },
  dayOfWeek: (userId: string) =>
    request<any[]>(`/stats/day-of-week?user_id=${userId}`),
  timeOfDay: (userId: string) =>
    request<any[]>(`/stats/time-of-day?user_id=${userId}`),
  busiestDays: (userId: string) =>
    request<any[]>(`/stats/busiest-days?user_id=${userId}`),
  topCities: (userId: string) =>
    request<any[]>(`/stats/top-cities?user_id=${userId}`),
  insights: (userId: string) =>
    request<any[]>(`/stats/insights?user_id=${userId}`),
  reflections: (userId: string) =>
    request<any[]>(`/stats/reflections?user_id=${userId}`),
  additionalStats: (userId: string) =>
    request<any>(`/stats/additional-stats?user_id=${userId}`),
  moodDaily: (userId: string, from?: string, to?: string) => {
    const qp = new URLSearchParams({ user_id: userId });
    if (from && to) { qp.set('from', from); qp.set('to', to); }
    return request<any[]>(`/stats/mood-daily?${qp.toString()}`);
  },
  moodMonthly: (userId: string, year: number) =>
    request<any[]>(`/stats/mood-monthly?user_id=${userId}&year=${year}`),
  moodByDayOfWeek: (userId: string, from?: string, to?: string) => {
    const qp = new URLSearchParams({ user_id: userId });
    if (from && to) {
      qp.set('from', from);
      qp.set('to', to);
    }
    return request<any[]>(`/stats/mood-by-day-of-week?${qp.toString()}`);
  },
  moodActivityCorrelations: (userId: string, from?: string, to?: string) => {
    const qp = new URLSearchParams({ user_id: userId });
    if (from && to) {
      qp.set('from', from);
      qp.set('to', to);
    }
    return request<any[]>(`/stats/mood-activity-correlations?${qp.toString()}`);
  },
  moodActivityCombinations: (userId: string, from?: string, to?: string) => {
    const qp = new URLSearchParams({ user_id: userId });
    if (from && to) {
      qp.set('from', from);
      qp.set('to', to);
    }
    return request<any[]>(`/stats/mood-activity-combinations?${qp.toString()}`);
  },
  moodHeatmap: (userId: string, year: number) =>
    request<any[]>(`/stats/mood-heatmap?user_id=${userId}&year=${year}`),
  moodCountRange: (userId: string, from?: string, to?: string) => {
    const qp = new URLSearchParams({ user_id: userId });
    if (from && to) { qp.set('from', from); qp.set('to', to); }
    return request<any[]>(`/stats/mood-count-range?${qp.toString()}`);
  },
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
      body: form,
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(error.message || `Import failed: ${res.status}`);
    }
    return res.json();
  },
  daylio: async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    form.append('source_timezone', Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    const res = await fetch(`${API_BASE}/import/daylio`, {
      method: 'POST',
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
    const fileName = fileNameMatch?.[1] || `wherewewere-backup-${new Date().toISOString().slice(0, 10)}.json`;
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
      delete_mood_checkins: boolean;
      reset_account_settings: boolean;
      reset_mood_settings: boolean;
      reset_integrations_settings: boolean;
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
};

// Mood Checkins
export const moodCheckins = {
  list: (params?: Record<string, string>) =>
    request<any[]>(`/mood-checkins?${new URLSearchParams(params)}`),
  get: (id: string) => request<any>(`/mood-checkins/${id}`),
  create: (data: any) =>
    request<any>('/mood-checkins', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: any) =>
    request<any>(`/mood-checkins/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) =>
    request<void>(`/mood-checkins/${id}`, { method: 'DELETE' }),
};

// Mood Activities
export const moodActivities = {
  groups: () => request<any[]>('/mood-activities/groups'),
  createGroup: (data: any) =>
    request<any>('/mood-activities/groups', { method: 'POST', body: JSON.stringify(data) }),
  updateGroup: (id: string, data: any) =>
    request<any>(`/mood-activities/groups/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteGroup: (id: string) =>
    request<void>(`/mood-activities/groups/${id}`, { method: 'DELETE' }),
  createActivity: (data: any) =>
    request<any>('/mood-activities/activities', { method: 'POST', body: JSON.stringify(data) }),
  reorderActivities: (groupId: string, activityIds: string[]) =>
    request<{ message: string; count: number }>('/mood-activities/activities/reorder', {
      method: 'PUT',
      body: JSON.stringify({ group_id: groupId, activity_ids: activityIds }),
    }),
  updateActivity: (id: string, data: any) =>
    request<any>(`/mood-activities/activities/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteActivity: (id: string) =>
    request<void>(`/mood-activities/activities/${id}`, { method: 'DELETE' }),
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
};
