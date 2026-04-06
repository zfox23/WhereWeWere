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

export interface Streak {
  current_streak: number;
  longest_streak: number;
  last_checkin: string | null;
  current_streak_start: string | null;
  current_streak_end: string | null;
  longest_streak_start: string | null;
  longest_streak_end: string | null;
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
  type: 'location' | 'mood';
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
  theme: 'system' | 'light' | 'dark';
  notifications_enabled: boolean;
  mood_reminder_times: string[];
  mood_icon_pack: 'emoji' | 'lucide' | 'nature';
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

