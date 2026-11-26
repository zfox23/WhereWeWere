/**
 * Client API helpers for the Music plugin (`/api/v1/music/*`).
 */

import { apiFetch, request } from '../../../client/src/api/client';
import type { RankSessionState } from '../../../client/src/components/lists/ranking/engine';
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
  DuplicateScan,
  RemovedPlay,
  MusicReflectionYear,
  MusicLibraryView,
  MusicAggregate,
  MusicSettingsData,
  MusicStats,
  SessionTrack,
  SongPlay,
  SongDetail,
  ArtistDetail,
  Ties,
  DailyListening,
  ClockCell,
  Discovery,
  LifeBy,
  LifeSoundtrack,
  GenreCount,
  GenreDetail,
  GenreStatus,
  GenreBackfillStatus,
  GenreStream,
  ItemGenres,
  SpotifyExport,
  SpotifyLink,
  SpotifyPlaylist,
  SpotifyPlaylistDetail,
  SpotifyStatus,
  PlaySeries,
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
  const res = await apiFetch(url, { method: 'POST', body: form });
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
    const res = await apiFetch('/api/v1/music/scrobbles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    opts: { q?: string; genre?: string; sort?: string; dir?: 'asc' | 'desc'; limit?: number; offset?: number } = {},
  ) => {
    const extra: Record<string, string> = { view };
    if (opts.q) extra.q = opts.q;
    if (opts.genre) extra.genre = opts.genre;
    if (opts.sort) extra.sort = opts.sort;
    if (opts.dir) extra.dir = opts.dir;
    if (opts.limit) extra.limit = String(opts.limit);
    if (opts.offset) extra.offset = String(opts.offset);
    return request<{ rows: MusicAggregate[]; total: number }>(`/music/library${rangeQuery(from, to, extra)}`);
  },
  song: (songKey: string) => request<SongDetail>(`/music/song?${new URLSearchParams({ song_key: songKey })}`),
  artist: (name: string) => request<ArtistDetail>(`/music/artist?${new URLSearchParams({ name })}`),
  genre: (name: string) => request<GenreDetail>(`/music/genre?${new URLSearchParams({ name })}`),
  /** Every genre played, most played first. */
  genres: () => request<GenreCount[]>('/music/genres'),
  /** Correct an album's (by album ref) or artist's genres; null goes back to MusicBrainz's. */
  setGenres: (kind: 'album' | 'artist', ref: string, genres: string[] | null) =>
    request<ItemGenres>('/music/genres', { method: 'PUT', body: JSON.stringify({ kind, ref, genres }) }),
  genreStatus: () => request<GenreStatus>('/music/genres/status'),
  startGenreBackfill: (retryMissing: boolean) =>
    request<GenreBackfillStatus>('/music/genres/backfill', { method: 'POST', body: JSON.stringify({ retry_missing: retryMissing }) }),
  cancelGenreBackfill: () => request<GenreBackfillStatus>('/music/genres/backfill/cancel', { method: 'POST' }),
  genreStream: (from?: string, to?: string) => request<GenreStream>(`/music/insights/genres${rangeQuery(from, to)}`),
  /** Companions, places and moods around a song's, an artist's or a genre's plays. */
  ties: (scope: { songKey: string } | { artist: string } | { genre: string }) =>
    request<Ties>(
      `/music/ties?${new URLSearchParams(
        'songKey' in scope ? { song_key: scope.songKey } : 'artist' in scope ? { artist: scope.artist } : { genre: scope.genre },
      )}`,
    ),
  /** One page of a song's plays, newest first, optionally within local dates. */
  songPlays: (songKey: string, opts: { limit?: number; offset?: number; from?: string; to?: string } = {}) => {
    const params = new URLSearchParams({ song_key: songKey });
    if (opts.from) params.set('from', opts.from);
    if (opts.to) params.set('to', opts.to);
    if (opts.limit) params.set('limit', String(opts.limit));
    if (opts.offset) params.set('offset', String(opts.offset));
    return request<{ rows: SongPlay[]; total: number }>(`/music/song-plays?${params}`);
  },
  dailyListening: (year: number, today: string) =>
    request<DailyListening>(`/music/insights/daily?${new URLSearchParams({ year: String(year), today })}`),
  listeningClock: (from?: string, to?: string) => request<ClockCell[]>(`/music/insights/clock${rangeQuery(from, to)}`),
  discovery: (from?: string, to?: string) => request<Discovery>(`/music/insights/discovery${rangeQuery(from, to)}`),
  lifeSoundtrack: (by: LifeBy, from?: string, to?: string) =>
    request<LifeSoundtrack>(`/music/insights/life${rangeQuery(from, to, { by })}`),
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
  /** Plays per day of a list's most played items, for its wave chart. */
  listSeries: (listId: string) => request<PlaySeries>(`/music/lists/${listId}/series`),
  // Drag-to-rank: these ids become ranks 1..n; everything else on the list is unranked.
  rankList: (listId: string, rankedIds: string[]) =>
    request<{ ranked_ids: string[] }>(`/music/lists/${listId}/ranks`, { method: 'PUT', body: JSON.stringify({ ranked_ids: rankedIds }) }),
  settings: () => request<MusicSettingsData>('/music/settings'),
  updateSettings: (patch: Partial<Pick<MusicSettingsData, 'session_gap_minutes' | 'min_session_tracks' | 'timezone'>>) =>
    request<MusicSettingsData>('/music/settings', { method: 'PUT', body: JSON.stringify(patch) }),
  /** The dry run: bursts of impossible repeat plays. Changes nothing. */
  duplicates: () => request<DuplicateScan>('/music/duplicates'),
  removeDuplicates: (ids: string[]) =>
    request<{ removed: number; plays: RemovedPlay[] }>('/music/duplicates/remove', { method: 'POST', body: JSON.stringify({ ids }) }),
  refreshTimezones: () =>
    request<{ updated: number }>('/music/timezones/refresh', { method: 'POST' }),
  regenerateKey: () =>
    request<{ scrobbler_key: string }>('/music/settings/regenerate-key', { method: 'POST' }),
  importScrobbles: (file: File) => uploadImport('/api/v1/music/import/scrobbles', file),
  importLastfm: (file: File) => uploadImport('/api/v1/music/import/lastfm', file),
};

/** Spotify: the user's app and sign-in, Open in Spotify links, playlists and list exports. */
export const spotify = {
  status: () => request<SpotifyStatus>('/music/spotify/status'),
  saveCredentials: (clientId: string, clientSecret: string) =>
    request<SpotifyStatus>('/music/spotify/credentials', {
      method: 'PUT',
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
    }),
  remove: () => request<{ ok: true }>('/music/spotify', { method: 'DELETE' }),
  /** The Spotify sign-in page to send the browser to. */
  authorize: () =>
    request<{ url: string }>('/music/spotify/authorize', { method: 'POST', body: JSON.stringify({ origin: window.location.origin }) }),
  disconnect: () => request<{ ok: true }>('/music/spotify/disconnect', { method: 'POST' }),
  link: (target: { kind: 'song'; songKey: string } | { kind: 'album'; ref: string } | { kind: 'artist'; name: string }) =>
    request<SpotifyLink>(
      `/music/spotify/link?${new URLSearchParams(
        target.kind === 'song'
          ? { kind: 'song', song_key: target.songKey }
          : target.kind === 'album'
            ? { kind: 'album', ref: target.ref }
            : { kind: 'artist', name: target.name },
      )}`,
    ),
  playlists: () => request<SpotifyPlaylist[]>('/music/spotify/playlists'),
  playlist: (id: string) => request<SpotifyPlaylistDetail>(`/music/spotify/playlists/${encodeURIComponent(id)}`),
  coverUrl: (id: string) => `/api/v1/music/spotify/playlists/${encodeURIComponent(id)}/cover`,
  getExport: (listId: string) => request<SpotifyExport | null>(`/music/spotify/exports/${listId}`),
  exportList: (listId: string) => request<SpotifyExport>(`/music/spotify/exports/${listId}`, { method: 'POST' }),
};
