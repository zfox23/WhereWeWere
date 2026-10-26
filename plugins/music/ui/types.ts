export interface MusicTotals {
  scrobbles: number;
  listened_seconds: number;
  unique_artists: number;
  unique_tracks: number;
}

export interface MusicAggregate {
  name: string;
  /** Cover of the album (most played, for songs), when one was found. */
  art_id?: string | null;
  /** Present for songs (artist list) and albums (album artists). */
  artists?: string[];
  album?: string | null;
  unique_tracks?: number;
  plays: number;
  listened_seconds: number;
  first_played_at: string;
  last_played_at: string;
}

export interface MusicStats {
  totals: MusicTotals;
  top_songs: MusicAggregate[];
  top_artists: MusicAggregate[];
  top_albums: MusicAggregate[];
}

export type MusicLibraryView = 'songs' | 'artists' | 'albums';

export interface MusicSettingsData {
  scrobbler_key: string;
  session_gap_minutes: number;
  min_session_tracks: number;
  timezone: string;
  scrobbles: number;
  last_scrobbled_at: string | null;
}

export interface MusicImportResult {
  parsed: number;
  inserted: number;
  duplicates: number;
  skipped: number;
}

export interface SessionTrack {
  played_at: string;
  title: string;
  artists: string[];
  album: string | null;
  track_length: number | null;
  listened_for: number | null;
  /** IANA zone this play happened in. */
  timezone: string;
  art_id?: string | null;
}

export interface MusicSessionData {
  started_at?: string;
  ended_at?: string;
  track_count?: number;
  listened_seconds?: number;
  top_artists?: string[];
}

export interface ReflectTrack {
  title: string;
  artists: string[];
  count: number;
}

export interface MusicReflectionYear {
  year: number;
  tracks: ReflectTrack[];
}

export interface AlbumBackfillStatus {
  state: 'idle' | 'running' | 'done' | 'cancelled' | 'error';
  processed: number;
  total: number;
  matched: number;
  not_found: number;
  durations_filled: number;
  thumbnails_restored: number;
  error: string | null;
}

export interface AlbumStatus {
  enabled: boolean;
  albums: { total: number; matched: number; not_found: number; pending: number };
  job: AlbumBackfillStatus;
}

export interface AlbumDetail {
  id: string;
  title: string;
  artist: string;
  release_date: string | null;
  label: string | null;
  plays: number;
  listened_seconds: number;
  tracks: { position: number; title: string; length: number | null; plays: number }[];
}
