/**
 * Client API helpers for the Music plugin (`/api/v1/music/*`).
 */

import { request, withAuthHeader } from '../../../client/src/api/client';
import type {
  AlbumBackfillStatus,
  AlbumView,
  ListTarget,
  MusicList,
  AlbumStatus,
  MusicImportResult,
  MusicReflectionYear,
  MusicLibraryView,
  MusicAggregate,
  MusicSettingsData,
  MusicStats,
  SessionTrack,
} from './types';

function rangeQuery(from?: string, to?: string, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams(extra);
  if (from && to) {
    params.set('from', from);
    params.set('to', to);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

async function uploadImport(url: string, file: File): Promise<MusicImportResult> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(url, { method: 'POST', headers: withAuthHeader(), body: form });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(error.error || error.message || `Import failed: ${res.status}`);
  }
  return res.json();
}

export const albumArtUrl = (id: string, size: 'thumb' | 'large' = 'thumb') =>
  `/api/v1/music/albums/${id}/art${size === 'large' ? '?size=large' : ''}`;

export const music = {
  stats: (from?: string, to?: string, limit = 25) =>
    request<MusicStats>(`/music/stats${rangeQuery(from, to, { limit: String(limit) })}`),
  library: (view: MusicLibraryView, from?: string, to?: string) =>
    request<MusicAggregate[]>(`/music/library${rangeQuery(from, to, { view })}`),
  sessionTracks: (sessionId: string) =>
    request<SessionTrack[]>(`/music/sessions/${sessionId}/tracks`),
  reflect: (date: string) => request<MusicReflectionYear[]>(`/music/reflect?date=${date}`),
  albumStatus: () => request<AlbumStatus>('/music/albums/status'),
  startAlbumBackfill: (retryMissing: boolean) =>
    request<AlbumBackfillStatus>('/music/albums/backfill', {
      method: 'POST',
      body: JSON.stringify({ retry_missing: retryMissing }),
    }),
  cancelAlbumBackfill: () => request<AlbumBackfillStatus>('/music/albums/backfill/cancel', { method: 'POST' }),
  albumView: (id: { ref?: string | null; artId?: string | null }) => {
    const params = new URLSearchParams();
    if (id.artId) params.set('art_id', id.artId);
    else if (id.ref != null) params.set('ref', id.ref);
    return request<AlbumView>(`/music/album-view?${params}`);
  },
  lists: () => request<MusicList[]>('/music/lists'),
  createList: (name: string) => request<MusicList>('/music/lists', { method: 'POST', body: JSON.stringify({ name }) }),
  renameList: (id: string, name: string) =>
    request<{ id: string; name: string }>(`/music/lists/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  deleteList: (id: string) => request<{ id: string }>(`/music/lists/${id}`, { method: 'DELETE' }),
  addToList: (listId: string, target: ListTarget) =>
    request<{ added: boolean }>(`/music/lists/${listId}/items`, { method: 'POST', body: JSON.stringify(target) }),
  removeFromList: (listId: string, itemId: string) =>
    request<{ id: string }>(`/music/lists/${listId}/items/${itemId}`, { method: 'DELETE' }),
  reorderList: (listId: string, itemIds: string[]) =>
    request<{ item_ids: string[] }>(`/music/lists/${listId}/order`, { method: 'PUT', body: JSON.stringify({ item_ids: itemIds }) }),
  settings: () => request<MusicSettingsData>('/music/settings'),
  updateSettings: (patch: Partial<Pick<MusicSettingsData, 'session_gap_minutes' | 'min_session_tracks' | 'timezone'>>) =>
    request<MusicSettingsData>('/music/settings', { method: 'PUT', body: JSON.stringify(patch) }),
  refreshTimezones: () =>
    request<{ updated: number }>('/music/timezones/refresh', { method: 'POST' }),
  regenerateKey: () =>
    request<{ scrobbler_key: string }>('/music/settings/regenerate-key', { method: 'POST' }),
  importScrobbles: (file: File) => uploadImport('/api/v1/music/import/scrobbles', file),
  importLastfm: (file: File) => uploadImport('/api/v1/music/import/lastfm', file),
};
