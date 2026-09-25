/**
 * Client API helpers for the Media plugin.
 *
 * The plugin owns its own endpoints (`/api/v1/media/*` and
 * `/api/v1/webhook/plex`) plus the core's `/import/yamtrack/*` routes, so the
 * fetch helpers live here instead of in the core `api/client.ts`. They reuse
 * the core `request` helper for base-URL/auth handling.
 */

import { request } from '../../../client/src/api/client';
import type {
  MediaCheckIn,
  MediaItem,
  MediaList,
  MediaLibraryItem,
  MediaSearchHit,
  MediaStats,
  MediaTvSeason,
  YamtrackImportResult,
  YamtrackPreview,
} from './types';
import type { MediaSubtype } from '../../../client/src/types';

// Media check-ins
export const media = {
  search: (type: MediaSubtype, q: string) =>
    request<{ results: MediaSearchHit[]; degraded: boolean }>(
      `/media/search?${new URLSearchParams({ type, q })}`
    ),
  createItem: (data: {
    media_type: MediaSubtype;
    external_source?: string | null;
    external_id?: string | null;
    title: string;
    author?: string | null;
    release_year?: number | null;
    image_url?: string | null;
    external_url?: string | null;
    platform?: string | null;
    /** Book: page count of the default physical edition. */
    page_count?: number | null;
    /** Book: series name, if applicable. */
    series_name?: string | null;
    /** Book: this book's number within its series. */
    series_position?: number | null;
    /** Book: total number of books in its series. */
    series_count?: number | null;
  }) => request<MediaItem>('/media/items', { method: 'POST', body: JSON.stringify(data) }),
  getItem: (id: string) => request<MediaItem>(`/media/items/${id}`),
  updateItem: (id: string, data: {
    title?: string;
    author?: string | null;
    release_year?: number | null;
    image_url?: string | null;
    external_url?: string | null;
    platform?: string | null;
    /** Book: page count of the default physical edition. */
    page_count?: number | null;
    /** Book: series name, if applicable. */
    series_name?: string | null;
    /** Book: this book's number within its series. */
    series_position?: number | null;
    /** Book: total number of books in the series. */
    series_count?: number | null;
    /** Set the provider's ID for this item (derives external_source from media_type). */
    external_id?: string | null;
  }) => request<MediaItem>(`/media/items/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  /**
   * Fetch the latest provider metadata; returns a diff-ready payload. For
   * local-only games the server may re-key the item by title instead (writes
   * the external id, signals it via `rekeyed: true`).
   */
  syncItem: (id: string) =>
    request<{ provider: string; found: boolean; rekeyed?: boolean; metadata: Record<string, string | number | null> }>(
      `/media/items/${id}/sync`, { method: 'POST' }
    ),
  listCheckins: (itemId: string) => request<MediaCheckIn[]>(`/media/items/${itemId}/checkins`),
  createCheckin: (itemId: string, data: {
    season_number?: number | null;
    episode_number?: number | null;
    episode_title?: string | null;
    checkin_type: 'completed' | 'in_progress' | 'started' | 'dropped';
    rating?: number | null;
    raw_score?: number | null;
    notes?: string | null;
    checked_in_at?: string | null;
    timezone: string;
    /** Total time played in minutes (games only). */
    time_played_minutes?: number | null;
  }) => request<MediaCheckIn>(`/media/items/${itemId}/checkins`, { method: 'POST', body: JSON.stringify(data) }),
  updateCheckin: (id: string, data: Partial<{
    season_number: number | null;
    episode_number: number | null;
    episode_title: string | null;
    checkin_type: string;
    rating: number | null;
    raw_score: number | null;
    notes: string | null;
    checked_in_at: string | null;
    timezone: string;
    time_played_minutes: number | null;
  }>) => request<MediaCheckIn>(`/media/checkins/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCheckin: (id: string) =>
    request<{ message: string; id: string }>(`/media/checkins/${id}`, { method: 'DELETE' }),
  tvSeasons: (itemId: string) =>
    request<{ seasons: MediaTvSeason[]; cached: boolean }>(`/media/tv/${itemId}/seasons`),
  stats: (from?: string, to?: string) => {
    const qp = new URLSearchParams();
    if (from) qp.set('from', from);
    if (to) qp.set('to', to);
    return request<MediaStats>(`/media/stats?${qp.toString()}`);
  },
  library: (from?: string, to?: string, types?: MediaSubtype[]) => {
    const qp = new URLSearchParams();
    if (from) qp.set('from', from);
    if (to) qp.set('to', to);
    if (types && types.length > 0) qp.set('types', types.join(','));
    const qs = qp.toString();
    return request<MediaLibraryItem[]>(`/media/library${qs ? `?${qs}` : ''}`);
  },
  lists: () => request<MediaList[]>('/media/lists'),
  createList: (name: string) =>
    request<MediaList>('/media/lists', { method: 'POST', body: JSON.stringify({ name }) }),
  renameList: (id: string, name: string) =>
    request<MediaList>(`/media/lists/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  deleteList: (id: string) =>
    request<{ message: string; id: string }>(`/media/lists/${id}`, { method: 'DELETE' }),
  addItemToList: (listId: string, mediaItemId: string) =>
    request<{ message: string }>(`/media/lists/${listId}/items`, { method: 'POST', body: JSON.stringify({ media_item_id: mediaItemId }) }),
  removeItemFromList: (listId: string, mediaItemId: string) =>
    request<{ message: string }>(`/media/lists/${listId}/items/${mediaItemId}`, { method: 'DELETE' }),
  /**
   * Delete media items along with all of their check-ins and list
   * memberships. With `dryRun` it only reports how many rows would be
   * affected, without deleting anything.
   */
  bulkDeleteItems: (ids: string[], dryRun: boolean) =>
    request<{ deleted_items: number; deleted_checkins: number; deleted_list_memberships: number }>(
      '/media/items/bulk-delete',
      { method: 'POST', body: JSON.stringify({ ids, dryRun }) }
    ),
};

// Plex webhook
export const plexWebhook = {
  stats: () => request<{ count: number }>('/webhook/plex/stats'),
};

// Yamtrack import
export const yamtrackImport = {
  preview: async (file: File) => {
    const csv = await file.text();
    return request<YamtrackPreview>('/import/yamtrack/preview', {
      method: 'POST',
      body: JSON.stringify({ csv }),
    });
  },
  import: async (file: File) => {
    const csv = await file.text();
    return request<YamtrackImportResult>('/import/yamtrack/import', {
      method: 'POST',
      body: JSON.stringify({ csv }),
    });
  },
};
