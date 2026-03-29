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
  rating: number | null;
  checked_in_at: string;
  photo_count?: number;
  photos?: Photo[];
  created_at: string;
}

export interface Photo {
  id: string;
  checkin_id: string;
  file_path: string;
  original_filename: string | null;
  mime_type: string | null;
  caption: string | null;
  url: string;
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
  total_photos: number;
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

export interface UserSettings {
  username: string;
  email: string;
  display_name: string | null;
  dawarich_url: string | null;
  dawarich_api_key: string | null;
  immich_url: string | null;
  immich_api_key: string | null;
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
  };
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}
