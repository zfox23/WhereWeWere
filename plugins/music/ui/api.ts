/**
 * Client API helpers for the Music plugin (`/api/v1/music/*`).
 */

import { request, withAuthHeader } from '../../../client/src/api/client';
import type {
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

export const music = {
  stats: (from?: string, to?: string, limit = 25) =>
    request<MusicStats>(`/music/stats${rangeQuery(from, to, { limit: String(limit) })}`),
  library: (view: MusicLibraryView, from?: string, to?: string) =>
    request<MusicAggregate[]>(`/music/library${rangeQuery(from, to, { view })}`),
  sessionTracks: (sessionId: string) =>
    request<SessionTrack[]>(`/music/sessions/${sessionId}/tracks`),
  reflect: (date: string) => request<MusicReflectionYear[]>(`/music/reflect?date=${date}`),
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
