export interface User {
  id: string;
  username: string;
  email: string;
  display_name: string | null;
  created_at: string;
}

export interface VenueCategory {
  id: string;
  name: string;
  icon: string | null;
  parent_id: string | null;
}

export interface Venue {
  id: string;
  name: string;
  category_id: string | null;
  category_name?: string;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postal_code: string | null;
  latitude: number;
  longitude: number;
  osm_id: string | null;
  parent_venue_id: string | null;
  parent_venue_name?: string;
  child_venues?: { id: string; name: string }[];
  checkin_count?: number;
  created_at: string;
}

import type { StoredThemePreference } from '../themes';
import type { AppThemeId } from '../themes';

export interface CheckIn {
  id: string;
  user_id: string;
  venue_id: string;
  venue_name?: string;
  venue_category?: string;
  venue_latitude?: number;
  venue_longitude?: number;
  parent_venue_id?: string;
  parent_venue_name?: string;
  notes: string | null;
  venue_timezone?: string | null;
  checked_in_at: string;
  created_at: string;
}

export interface NearbyVenue {
  name: string;
  category: string;
  latitude: number;
  longitude: number;
  address: string | null;
  osm_id: string;
  source: 'local' | 'osm';
  id?: string; // only for local venues
}

export interface Stats {
  total_checkins: number;
  unique_venues: number;
  days_with_checkins: number;
  member_since: string;
}

export interface TopVenue {
  venue_id: string;
  venue_name: string;
  category_name: string | null;
  checkin_count: number;
}

export interface CategoryBreakdown {
  category_name: string;
  checkin_count: number;
}

export interface HeatmapDay {
  date: string;
  count: number;
}

export interface SearchResults {
  venues: Venue[];
  checkins: CheckIn[];
}

export interface CountryStats {
  country: string;
  checkin_count: number;
  unique_venues: number;
}

export interface MapDataPoint {
  venue_id: string;
  venue_name: string;
  latitude: number;
  longitude: number;
  checkin_count: number;
  last_checkin_at?: string;
  last_checkin_timezone?: string | null;
  dates: string[];
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
  total_errors: number;
}

export interface BackupImportEntityCount {
  inserted: number;
  skipped: number;
}

export interface BackupImportResult {
  message: string;
  schemaVersion: number;
  counts: Record<string, BackupImportEntityCount>;
  errors: string[];
}

export interface TimestampReconciliationSuggestion {
  id: string;
  type: 'venue' | 'mood' | 'media';
  detail_path: string;
  original_timestamp: string;
  original_timezone: string | null;
  suggested_timezone: string;
  reason: string;
}

export interface TimestampReconciliationUninferableMoodCheckin {
  id: string;
  type: 'mood';
  detail_path: string;
  original_timestamp: string;
  original_timezone: string | null;
  reason: string;
}

export interface TimestampReconciliationUninferableMediaCheckin {
  id: string;
  type: 'media';
  detail_path: string;
  original_timestamp: string;
  original_timezone: string | null;
  reason: string;
}

export interface TimestampReconciliationScanResult {
  suggestions: TimestampReconciliationSuggestion[];
  uninferable_mood_checkins: TimestampReconciliationUninferableMoodCheckin[];
  uninferable_media_checkins: TimestampReconciliationUninferableMediaCheckin[];
}

export interface TimestampReconciliationUpdate {
  id: string;
  type: 'venue' | 'mood' | 'media';
  suggested_timezone: string;
}

export interface MoodActivityGroup {
  id: string;
  name: string;
  display_order: number;
  activities: MoodActivity[];
}

export interface MoodActivity {
  id: string;
  group_id: string;
  name: string;
  display_order: number;
  icon?: string | null;
  mood_checkin_count?: number;
}

export interface MoodCheckIn {
  id: string;
  user_id: string;
  mood: number;
  note: string | null;
  mood_timezone?: string | null;
  activities: { id: string; name: string; group_name: string }[];
  checked_in_at: string;
  created_at: string;
}

export interface SleepEntry {
  id: string;
  user_id: string;
  sleep_as_android_id: number;
  sleep_timezone: string;
  started_at: string;
  ended_at: string;
  rating: number;
  comment: string | null;
  created_at: string;
  updated_at?: string;
}

export interface TrackPoint {
  /** Epoch milliseconds, or null if the point had no timestamp */
  t: number | null;
  /** Elevation in meters, or null */
  ele: number | null;
  /** Heart rate in bpm, or null */
  hr: number | null;
}

export interface TrackEntry {
  id: string;
  user_id: string;
  name: string;
  activity_type: string | null;
  timezone: string;
  started_at: string;
  ended_at: string;
  distance_m: number;
  elapsed_time_s: number;
  moving_time_s: number;
  elevation_gain_m: number;
  avg_speed_mps: number;
  max_speed_mps: number;
  avg_hr: number | null;
  max_hr: number | null;
  point_count: number;
  created_at: string;
  updated_at?: string;
  geometry?: [number, number][];
  /** Per-point series (same order as `geometry`), null for older tracks */
  points?: TrackPoint[] | null;
}

export interface TrackMapEntry {
  id: string;
  name: string;
  activity_type: string | null;
  timezone: string;
  started_at: string;
  distance_m: number;
  elapsed_time_s: number;
  moving_time_s: number;
  elevation_gain_m: number;
  avg_speed_mps: number;
  max_speed_mps: number;
  /** [lng, lat] per point */
  coordinates: [number, number][];
  bounds: {
    minLng: number;
    minLat: number;
    maxLng: number;
    maxLat: number;
  } | null;
}

export interface SleepSummaryStats {
  total_sleeps: number;
  avg_duration_minutes: number | null;
  total_sleep_minutes: number | null;
  avg_rating: number | null;
  rated_count: number;
}

export interface SleepDailyPoint {
  date: string;
  count: number;
  avg_duration_minutes: number | null;
  total_sleep_minutes: number | null;
  avg_rating: number | null;
}

export interface SleepRatingBucket {
  stars: number;
  count: number;
}

export interface ReflectionItem {
  type: 'location' | 'mood';
  id: string;
  checked_in_at: string;
  note: string | null;
  venue_id?: string | null;
  venue_name?: string | null;
  venue_category?: string | null;
  city?: string | null;
  country?: string | null;
  venue_timezone?: string | null;
  mood?: number | null;
  mood_timezone?: string | null;
  activities?: { id: string; name: string; group_name: string; icon?: string | null }[];
}

export interface ReflectionYear {
  year: number;
  years_ago: number;
  items: ReflectionItem[];
}

export interface TimelineItem {
  type: 'location' | 'mood' | 'sleep' | 'track' | 'media';
  id: string;
  user_id: string;
  checked_in_at: string;
  created_at: string;
  notes: string | null;
  // Location fields
  venue_id?: string;
  venue_name?: string;
  venue_category?: string;
  venue_latitude?: number;
  venue_longitude?: number;
  venue_timezone?: string | null;
  parent_venue_id?: string;
  parent_venue_name?: string;
  // Mood fields
  mood?: number;
  mood_timezone?: string | null;
  activities?: { id: string; name: string; group_name: string; icon?: string | null }[] | null;
  // Sleep fields
  sleep_as_android_id?: number;
  sleep_started_at?: string;
  sleep_ended_at?: string;
  sleep_timezone?: string | null;
  sleep_rating?: number;
  sleep_comment?: string | null;
  // Track fields
  track_name?: string;
  track_distance_m?: number;
  track_timezone?: string | null;
  track_started_at?: string;
  track_ended_at?: string;
  track_elapsed_time_s?: number;
  // Media fields
  media_type?: MediaSubtype;
  media_item_id?: string;
  media_title?: string;
  media_image_url?: string | null;
  media_author?: string | null;
  media_rating?: number | null;
  media_checkin_type?: string | null;
  media_season_number?: number | null;
  media_episode_number?: number | null;
  media_episode_title?: string | null;
  media_timezone?: string | null;
}

export type MediaSubtype = 'movie' | 'tv_show' | 'game' | 'book' | 'board_game';

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
  /** Book: page count of the default physical edition. */
  page_count: number | null;
  /** Book: series name, if applicable. */
  series_name: string | null;
  /** Book: this book's number within its series. */
  series_position: number | null;
  /** Book: total number of books in its series. */
  series_count: number | null;
  created_at: string;
  last_checkin_at?: string | null;
  checkin_count?: number;
  my_rating?: number | null;
  completed_count?: number;
  /** Latest total time played (minutes) for games; null when not tracked. */
  total_time_played_minutes?: number | null;
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
  /** Book: page count of the default physical edition. */
  page_count: number | null;
  /** Book: series name, if applicable. */
  series_name: string | null;
  /** Book: this book's number within its series. */
  series_position: number | null;
  /** Book: total number of books in its series. */
  series_count: number | null;
  local_id: string | null;
  last_checkin_at: string | null;
  last_checkin_type: string | null;
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
  /** Most recent non-null rating, or null when never rated. */
  latest_rating: number | null;
  last_checkin_at: string;
  last_checkin_timezone: string;
  last_checkin_type: 'completed' | 'in_progress' | 'dropped';
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
  duplicate_of_line: number | null;
}

/**
 * A plan row as returned by POST /import/yamtrack/import. The stored ids and
 * time played only exist after the import has run, so they are absent from
 * the preview response.
 */
export interface YamtrackImportPlanRow extends YamtrackPlanRow {
  time_played_minutes: number | null;
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

export interface UserSettings {
  username: string;
  email: string;
  display_name: string | null;
  dawarich_url: string | null;
  dawarich_api_key: string | null;
  immich_url: string | null;
  immich_api_key: string | null;
  maloja_url: string | null;
  tmdb_api_key: string | null;
  tgdb_api_key: string | null;
  hardcover_api_key: string | null;
  llm_api_url: string | null;
  llm_model: string | null;
  llm_reasoning_level: string | null;
  llm_context_window: number | null;
  llm_image_support: boolean | null;
  theme: StoredThemePreference;
  system_light_theme: AppThemeId;
  system_dark_theme: AppThemeId;
  mood_icon_pack: 'emoji' | 'lucide' | 'nature';
  distance_unit: 'metric' | 'imperial';
}

export interface ImmichAsset {
  id: string;
  thumbhash: string | null;
  originalFileName: string;
}

export interface Scrobble {
  artists: string[];
  title: string;
  time: number;
}

export interface Job {
  id: string;
  type: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: {
    phase?: string;
    updated?: number;
    remaining?: number;
    message?: string;
    geocoded?: number;
    categorized?: number;
    scanned?: number;
    merged_venues?: number;
    moved_checkins?: number;
    proposals_found?: number;
    pending_suggestions?: number;
  };
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

