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
  /** Venue-level star rating (1-4); null when unrated. */
  rating?: number | null;
  /** Names of venue lists this venue belongs to (library view). */
  lists?: string[];
  created_at: string;
}

/** A named list of venues (mirrors the media plugin's lists). */
export interface VenueListItemRef {
  id: string;
  name: string;
  added_at: string;
}

export interface VenueList {
  id: string;
  name: string;
  created_at: string;
  items: VenueListItemRef[];
}

/** One row of the "All Venues" library view. */
export interface VenueLibraryItem {
  id: string;
  name: string;
  category_id: string | null;
  category_name: string | null;
  category_icon?: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  rating: number | null;
  lists: string[];
  last_checkin_at: string | null;
  last_checkin_timezone: string | null;
  checkin_count: number;
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
  /** Check-in star rating (1-4); null when unrated. */
  rating?: number | null;
  /** People "here with" on this check-in (ordered names). */
  companions?: string[];
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

export interface TimestampReconciliationUninferableCheckin {
  id: string;
  type: string;
  detail_path: string;
  original_timestamp: string;
  original_timezone: string | null;
  reason: string;
}

export interface TimestampReconciliationScanResult {
  suggestions: TimestampReconciliationSuggestion[];
  /** Uninferable check-ins grouped by type id. */
  uninferable: Record<string, TimestampReconciliationUninferableCheckin[]>;
}

export interface TimestampReconciliationUpdate {
  id: string;
  /** Check-in type (built-in 'venue' or a plugin id). */
  type: string;
  suggested_timezone: string;
}

export interface ReflectionItem {
  type: 'location' | (string & {});
  [pluginField: string]: unknown;
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
  /** Plugin-typed payload for plugin reflection entries. */
  data?: Record<string, unknown> | null;
}

export interface ReflectionYear {
  year: number;
  years_ago: number;
  items: ReflectionItem[];
}

export interface TimelineItem {
  type: 'location' | 'sleep' | 'media' | (string & {});
  [pluginField: string]: unknown;
  id: string;
  user_id: string;
  checked_in_at: string;
  created_at: string;
  notes: string | null;
  /** IANA timezone of the check-in (all check-in types). */
  timezone?: string | null;
  /** People "with" on this check-in (types that implement companions). */
  companions?: string[] | null;
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

export interface UserSettings {
  username: string;
  email: string;
  display_name: string | null;
  dawarich_url: string | null;
  dawarich_api_key: string | null;
  immich_url: string | null;
  immich_api_key: string | null;
  maloja_url: string | null;
  // Media provider API keys + plex_usernames live in the media plugin's
  // plugin_settings (see plugins/media), not in user_settings.
  llm_api_url: string | null;
  llm_model: string | null;
  llm_reasoning_level: string | null;
  llm_context_window: number | null;
  llm_image_support: boolean | null;
  theme: StoredThemePreference;
  system_light_theme: AppThemeId;
  system_dark_theme: AppThemeId;
  distance_unit: 'metric' | 'imperial';
  timeline_density: 'comfortable' | 'compact';
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

