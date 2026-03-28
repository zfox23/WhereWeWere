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
  uploadPhotos: async (checkinId: string, files: File[]) => {
    const form = new FormData();
    files.forEach((f) => form.append('photos', f));
    const res = await fetch(`${API_BASE}/checkins/${checkinId}/photos`, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) throw new Error('Photo upload failed');
    return res.json();
  },
  deletePhoto: (checkinId: string, photoId: string) =>
    request<void>(`/checkins/${checkinId}/photos/${photoId}`, { method: 'DELETE' }),
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
  nearby: (params: Record<string, string>) =>
    request<any[]>(`/venues/nearby?${new URLSearchParams(params)}`),
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
  mapData: (userId: string) =>
    request<any[]>(`/stats/map-data?user_id=${userId}`),
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
};

// Settings
export const settings = {
  get: () => request<any>('/settings'),
  update: (data: any) =>
    request<any>('/settings', { method: 'PUT', body: JSON.stringify(data) }),
  updateProfile: (data: any) =>
    request<any>('/settings/profile', { method: 'PUT', body: JSON.stringify(data) }),
};
