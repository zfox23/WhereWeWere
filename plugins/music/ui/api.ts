/**
 * Client API helpers for the Music plugin (`/api/v1/music/*`).
 */

import { request, withAuthHeader } from '../../../client/src/api/client';
import type { RankSessionState } from './ranking/engine';
import type {
  AlbumBackfillStatus,
  ManualScrobbleInput,
  ScrobbleDetail,
  NearDuplicate,
  SongSuggestion,
  AlbumView,
  ListItemWithStats,
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

/** A hand-entered play that a near-identical play on file already covers. */
export class NearDuplicateError extends Error {
  constructor(readonly duplicate: NearDuplicate) {
    super('You already have this song around that time');
  }
}

export const music = {
  suggest: (artist: string, title: string) =>
    request<{ suggestions: SongSuggestion[]; catalog_unavailable: boolean }>(
      `/music/suggest?${new URLSearchParams({ artist, title })}`,
    ),
  /** Write down a song you heard. Throws NearDuplicateError (not stored) unless `force`. */
  createScrobble: async (input: ManualScrobbleInput): Promise<{ id: string; session_id: string | null }> => {
    const res = await fetch('/api/v1/music/scrobbles', {
      method: 'POST',
      headers: withAuthHeader({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(input),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 409 && body.duplicate) throw new NearDuplicateError(body.duplicate as NearDuplicate);
    if (!res.ok) throw new Error(body.error || body.message || `Request failed: ${res.status}`);
    return body;
  },
  scrobble: (id: string) => request<ScrobbleDetail>(`/music/scrobbles/${id}`),
  /** Correct any play. */
  updateScrobble: (id: string, input: Omit<ManualScrobbleInput, 'force'>) =>
    request<{ id: string; session_id: string | null }>(`/music/scrobbles/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  deleteScrobble: (id: string) => request<{ id: string }>(`/music/scrobbles/${id}`, { method: 'DELETE' }),
  stats: (from?: string, to?: string, limit = 25) =>
    request<MusicStats>(`/music/stats${rangeQuery(from, to, { limit: String(limit) })}`),
  /** One page of the library, filtered and sorted by the server (the whole history when no range is given). */
  library: (
    view: MusicLibraryView,
    from?: string,
    to?: string,
    opts: { q?: string; sort?: string; dir?: 'asc' | 'desc'; limit?: number; offset?: number } = {},
  ) => {
    const extra: Record<string, string> = { view };
    if (opts.q) extra.q = opts.q;
    if (opts.sort) extra.sort = opts.sort;
    if (opts.dir) extra.dir = opts.dir;
    if (opts.limit) extra.limit = String(opts.limit);
    if (opts.offset) extra.offset = String(opts.offset);
    return request<{ rows: MusicAggregate[]; total: number }>(`/music/library${rangeQuery(from, to, extra)}`);
  },
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
  /** A new list holding these, ranked in the order given; a taken name gets " (2)" etc. */
  createListFromItems: (name: string, items: ListTarget[]) =>
    request<{ id: string; name: string; added: number }>('/music/lists/from-items', {
      method: 'POST',
      body: JSON.stringify({ name, items }),
    }),
  renameList: (id: string, name: string) =>
    request<{ id: string; name: string }>(`/music/lists/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  deleteList: (id: string) => request<{ id: string }>(`/music/lists/${id}`, { method: 'DELETE' }),
  addToList: (listId: string, target: ListTarget) =>
    request<{ added: boolean }>(`/music/lists/${listId}/items`, { method: 'POST', body: JSON.stringify(target) }),
  removeFromList: (listId: string, itemId: string) =>
    request<{ id: string }>(`/music/lists/${listId}/items/${itemId}`, { method: 'DELETE' }),
  rankSession: (listId: string) => request<{ state: RankSessionState; updated_at: string }>(`/music/lists/${listId}/rank-session`),
  saveRankSession: (listId: string, state: RankSessionState) =>
    request<{ saved: boolean }>(`/music/lists/${listId}/rank-session`, { method: 'PUT', body: JSON.stringify({ state }) }),
  discardRankSession: (listId: string) => request<{ deleted: boolean }>(`/music/lists/${listId}/rank-session`, { method: 'DELETE' }),
  listItems: (listId: string) => request<ListItemWithStats[]>(`/music/lists/${listId}/items`),
  // Drag-to-rank: these ids become ranks 1..n; everything else on the list is unranked.
  rankList: (listId: string, rankedIds: string[]) =>
    request<{ ranked_ids: string[] }>(`/music/lists/${listId}/ranks`, { method: 'PUT', body: JSON.stringify({ ranked_ids: rankedIds }) }),
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
