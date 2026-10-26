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
  /** Opaque identities for opening the album modal and for lists (songs and albums). */
  album_ref?: string | null;
  song_key?: string | null;
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
  album_ref?: string | null;
  song_key?: string | null;
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
  skipped: number;
  durations_filled: number;
  thumbnails_restored: number;
  error: string | null;
}

export interface AlbumStatus {
  enabled: boolean;
  albums: { total: number; matched: number; not_found: number; pending: number };
  job: AlbumBackfillStatus;
}

export interface AlbumViewTrack {
  position: number | null;
  title: string;
  artists: string[];
  length: number | null;
  plays: number;
  song_key: string | null;
}

export interface AlbumView {
  album_ref: string;
  art_id: string | null;
  matched: boolean;
  title: string;
  artist: string;
  release_date: string | null;
  label: string | null;
  plays: number;
  listened_seconds: number;
  tracks: AlbumViewTrack[];
}

export interface ListItem {
  id: string;
  item_key: string;
  kind: 'song' | 'album';
  title: string;
  artists: string[];
  album: string | null;
  album_ref: string | null;
  art_id: string | null;
  /** 1..n among the ranked items; null when unranked. */
  rank: number | null;
}

/** A list item with the user's all-time plays of it. */
export interface ListItemWithStats extends ListItem {
  plays: number;
  listened_seconds: number;
  last_played_at: string | null;
}

export interface MusicList {
  id: string;
  name: string;
  updated_at: string;
  item_count: number;
  /** Up to four distinct covers, for the index card. */
  covers: string[];
  items: ListItem[];
}

/** What can be put on a list: opaque identities from rows. */
export type ListTarget =
  | { kind: 'album'; album_ref: string }
  | { kind: 'song'; song_key: string; album_ref?: string | null };

/** The key a list item has when it holds this target. */
export const targetItemKey = (t: ListTarget): string => (t.kind === 'album' ? `album:${t.album_ref}` : `song:${t.song_key}`);
