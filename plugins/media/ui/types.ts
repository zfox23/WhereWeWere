/**
 * Client-side data shapes for the Media plugin.
 *
 * These types describe the JSON payloads exchanged with the plugin's own
 * `/media/*` API endpoints (items, check-ins, lists, stats, library) and the
 * core `/import/yamtrack/*` endpoints. `MediaSubtype` itself lives in the
 * core type module because the shared `TimelineItem` envelope references it.
 */
import type { MediaSubtype } from '../../../client/src/types';

export interface MediaItem {
  id: string;
  media_type: MediaSubtype;
  external_source: 'tmdb' | 'tgdb' | 'hardcover' | null;
  external_id: string | null;
  title: string;
  author: string | null;
  release_year: number | null;
  image_url: string | null;
  external_url: string | null;
  platform: string | null;
  /** Game: TGDB synopsis. */
  overview: string | null;
  /** Game: ESRB-style content rating, e.g. "E - Everyone". */
  content_rating: string | null;
  /** Game: minimum player count. */
  players: number | null;
  /** Game: co-op support ("Yes"/"No"). */
  coop: string | null;
  /** Game: genre names from TGDB. */
  genres: string[] | null;
  /** Game: developer names from TGDB. */
  developers: string[] | null;
  /** Game: publisher names from TGDB. */
  publishers: string[] | null;
  /** Book: page count of the default physical edition. */
  page_count: number | null;
  /** Book: series name, if applicable. */
  series_name: string | null;
  /** Book: this book's number within its series. */
  series_position: number | null;
  /** Book: total number of books in its series. */
  series_count: number | null;
  /** Item-level user rating (0-4 stars), set independently of check-ins. */
  rating: number | null;
  /** Item-level raw score (e.g. 0-10 from imports). */
  raw_score: number | null;
  /** Item-level user notes. */
  notes: string | null;
  /** Cumulative time played in minutes (games only). */
  time_played_minutes: number | null;
  /** Item-level status for games (completed/in_progress/dropped). */
  status: 'completed' | 'in_progress' | 'dropped' | null;
  created_at: string;
  last_checkin_at?: string | null;
  checkin_count?: number;
  /** Display rating: the item's rating if set, else the latest check-in's. */
  my_rating?: number | null;
  completed_count?: number;
}

export interface MediaSearchHit {
  source: 'local' | 'tmdb' | 'tgdb' | 'hardcover';
  external_source: 'tmdb' | 'tgdb' | 'hardcover' | null;
  external_id: string | null;
  title: string;
  author: string | null;
  release_year: number | null;
  image_url: string | null;
  external_url: string | null;
  platform: string | null;
  /** Game: TGDB synopsis. */
  overview: string | null;
  /** Game: ESRB-style content rating, e.g. "E - Everyone". */
  content_rating: string | null;
  /** Game: minimum player count. */
  players: number | null;
  /** Game: co-op support ("Yes"/"No"). */
  coop: string | null;
  /** Game: genre names from TGDB. */
  genres: string[] | null;
  /** Game: developer names from TGDB. */
  developers: string[] | null;
  /** Game: publisher names from TGDB. */
  publishers: string[] | null;
  /** Book: page count of the default physical edition. */
  page_count: number | null;
  /** Book: series name, if applicable. */
  series_name: string | null;
  /** Book: this book's number within its series. */
  series_position: number | null;
  /** Book: total number of books in its series. */
  series_count: number | null;
  /** Item-level user rating (local hits only; null for external rows). */
  rating: number | null;
  /** Item-level status for games (local hits only). */
  status: string | null;
  local_id: string | null;
  last_checkin_at: string | null;
  last_checkin_type: string | null;
  /** Display rating: the item's rating if set, else the latest check-in's. */
  my_rating: number | null;
}

export interface MediaCheckIn {
  id: string;
  user_id: string;
  media_item_id: string;
  season_number: number | null;
  episode_number: number | null;
  episode_title: string | null;
  checkin_type: 'completed' | 'in_progress' | 'dropped';
  rating: number | null;
  raw_score: number | null;
  notes: string | null;
  checked_in_at: string;
  checkin_timezone: string;
  external_event_id: string | null;
  /** Cumulative total time played at this check-in (minutes); games only. */
  time_played_minutes: number | null;
  created_at: string;
  updated_at: string;
}

export interface MediaListItemRef {
  id: string;
  media_type: MediaSubtype;
  title: string;
  image_url: string | null;
  author: string | null;
  /** When the item was added to this list. */
  added_at: string;
}

export interface MediaList {
  id: string;
  name: string;
  created_at: string;
  items: MediaListItemRef[];
}

export interface MediaStats {
  tv_episodes_completed: number;
  movies_watched: number;
  books_completed: number;
  games_completed: number;
  board_games_completed: number;
  top_media: {
    id: string;
    media_type: MediaSubtype;
    title: string;
    image_url: string | null;
    author: string | null;
    rating: number;
    completed_count: number;
  }[];
}

/** One row of the Profile > Media library view (per media item). */
export interface MediaLibraryItem {
  id: string;
  media_type: MediaSubtype;
  title: string;
  author: string | null;
  image_url: string | null;
  /** Item-level user rating; null when never set. */
  rating: number | null;
  /** Item-level raw score; null when never set. */
  raw_score: number | null;
  /** Item-level user notes. */
  notes: string | null;
  /** Cumulative time played in minutes (games only). */
  time_played_minutes: number | null;
  /** Item-level status for games. */
  status: 'completed' | 'in_progress' | 'dropped' | null;
  /** Display rating: the item's rating if set, else the latest check-in's. */
  latest_rating: number | null;
  /** Null when the item has no check-ins (only in the unfiltered "all" period). */
  last_checkin_at: string | null;
  last_checkin_timezone: string | null;
  last_checkin_type: 'completed' | 'in_progress' | 'dropped' | null;
  /** Number of completed check-ins for this item. */
  completed_count: number;
}

export interface MediaTvSeason {
  season_number: number;
  episodes: { episode_number: number; episode_title: string | null }[];
}

export type YamtrackDisposition =
  | 'create_tv_show'
  | 'create_episode_checkin'
  | 'create_checkin'
  | 'create_media_item'
  | 'update_game_item'
  | 'duplicate'
  | 'skipped';

export interface YamtrackPlanRow {
  line: number;
  media_id: string;
  source: string;
  media_type: string;
  title: string;
  season_number: string | null;
  episode_number: string | null;
  status: string | null;
  score: string | null;
  start_date: string | null;
  end_date: string | null;
  /** The date the check-in will be stored at (end_date for episodes, start_date otherwise). */
  checked_in_at: string | null;
  disposition: YamtrackDisposition;
  reason: string;
  checkin_type: 'completed' | 'in_progress' | 'dropped' | null;
  rating: number | null;
  raw_score: number | null;
  /** Total time played in minutes (games only, from the CSV progress column). */
  time_played_minutes: number | null;
  duplicate_of_line: number | null;
}

/**
 * A plan row as returned by POST /import/yamtrack/import. The stored ids only
 * exist after the import has run, so they are absent from the preview response.
 */
export interface YamtrackImportPlanRow extends YamtrackPlanRow {
  media_item_id: string | null;
  imported_checkin_id: string | null;
}

export interface YamtrackPreview {
  counts: {
    total: number;
    create_tv_show: number;
    create_episode_checkin: number;
    create_checkin: number;
    create_media_item: number;
    update_game_item: number;
    duplicate: number;
    skipped: number;
  };
  plans: YamtrackPlanRow[];
}

export interface YamtrackImportResult {
  counts: YamtrackPreview['counts'] & {
    imported_checkins: number;
    duplicates_skipped: number;
  };
  plans: YamtrackImportPlanRow[];
}
