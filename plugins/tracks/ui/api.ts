/**
 * Tracks check-in type — client API helpers.
 *
 * All endpoints live under the tracks plugin's own API router (mounted at
 * `/tracks` by the framework). Previously these helpers lived in the core
 * client (`client/src/api/client.ts`) and pointed at the removed core
 * `/api/v1/tracks` route; they now hit the plugin's real endpoint so the
 * Tracks plugin is fully self-contained.
 */

import { request, withAuthHeader } from '../../../client/src/api/client';
import type { TrackEntry, TrackMapEntry } from './types';

const API_BASE = '/api/v1';
const BASE = '/tracks';

export const tracks = {
  list: (params?: Record<string, string>) =>
    request<any[]>(`${BASE}?${new URLSearchParams(params)}`),
  mapData: (params?: Record<string, string>) =>
    request<TrackMapEntry[]>(`${BASE}/map-data?${new URLSearchParams(params)}`),
  get: (id: string) => request<TrackEntry>(`${BASE}/${id}`),
  update: (id: string, data: { name?: string; activity_type?: string | null }) =>
    request<TrackEntry>(`${BASE}/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  trim: (id: string, start_index: number, end_index: number) =>
    request<TrackEntry>(`${BASE}/${id}/trim`, {
      method: 'POST',
      body: JSON.stringify({ start_index, end_index }),
    }),
  activityTypes: () => request<string[]>(`${BASE}/activity-types`),
  delete: (id: string) =>
    request<{ message: string; id: string }>(`${BASE}/${id}`, { method: 'DELETE' }),
  download: async (id: string): Promise<{ blob: Blob; filename: string }> => {
    const res = await fetch(`${API_BASE}${BASE}/${id}/download`, {
      headers: withAuthHeader(),
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({} as Record<string, unknown>));
      throw new Error(
        (error.message as string) || (error.error as string) || `Track download failed: ${res.status}`
      );
    }
    let filename = `track-${id}.gpx`;
    const disposition = res.headers.get('Content-Disposition') || '';
    const match =
      disposition.match(/filename="([^"]+)"/) || disposition.match(/filename=([^;]+)/);
    if (match) {
      try {
        filename = decodeURIComponent(match[1].trim());
      } catch {
        // keep fallback
      }
    }
    return { blob: await res.blob(), filename };
  },
  upload: async (file: File, timezone?: string) => {
    const form = new FormData();
    form.append('file', file);
    if (timezone) form.append('timezone', timezone);
    const res = await fetch(`${API_BASE}${BASE}`, {
      method: 'POST',
      headers: withAuthHeader(),
      body: form,
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({} as Record<string, unknown>));
      if (res.status === 409 && error.duplicate) {
        const dup = error.duplicate as { id: string; name: string };
        const dupError = new Error(
          (error.message as string) || (error.error as string) || 'This track is a duplicate'
        );
        dupError.name = 'DuplicateTrackError';
        (dupError as any).duplicate = dup;
        throw dupError;
      }
      throw new Error(
        (error.message as string) || (error.error as string) || `Track upload failed: ${res.status}`
      );
    }
    return res.json();
  },
};

export interface DuplicateTrackError extends Error {
  duplicate: { id: string; name: string };
}
