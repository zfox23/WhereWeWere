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
  /** Listening session of the most recent play, and the day Home shows it on. */
  last_session_id?: string | null;
  last_session_date?: string | null;
}

/** A song's header in the plays modal. */
/** Plays on one local day ('YYYY-MM-DD'); days without plays are omitted. */
export interface DayCount {
  date: string;
  plays: number;
}

export interface SongDetail {
  name: string;
  artists: string[];
  album_ref: string | null;
  art_id: string | null;
  plays: number;
  listened_seconds: number;
  first_played_at: string;
  last_played_at: string;
  /** Place among every song played, by plays (1 = most played). */
  rank: number;
  songs_total: number;
  daily: DayCount[];
  clock: ClockCell[];
  /** The albums its plays were credited to, most plays first. */
  albums: { album_ref: string; album: string | null; art_id: string | null; plays: number }[];
  /** The genres of its plays, most plays first. */
  genres: GenreCount[];
}

export interface ArtistSong {
  song_key: string;
  name: string;
  artists: string[];
  album_ref: string | null;
  art_id: string | null;
  plays: number;
  last_played_at: string;
}

export interface ArtistAlbum {
  album_ref: string;
  name: string;
  art_id: string | null;
  plays: number;
  unique_tracks: number;
  last_played_at: string;
}

export interface ArtistDetail {
  name: string;
  plays: number;
  listened_seconds: number;
  first_played_at: string;
  last_played_at: string;
  unique_songs: number;
  rank: number;
  artists_total: number;
  daily: DayCount[];
  clock: ClockCell[];
  songs: ArtistSong[];
  albums: ArtistAlbum[];
  /** The artist's own genres (plays fall back to them when an album has none). */
  genres: ItemGenres;
  /** The genres their plays have, most plays first. */
  play_genres: GenreCount[];
}

/** A companion, place category or mood a song or artist is played around. */
export interface Tie {
  key: string;
  label: string;
  plays: number;
  checkins: number;
}

export type Ties = Record<LifeBy, Tie[]> & { gap_minutes: number };

/** One play of a song on its page. */
export interface SongPlay {
  id: string;
  played_at: string;
  timezone: string;
  album: string | null;
  album_ref: string | null;
  art_id: string | null;
  track_length: number | null;
  listened_for: number | null;
  source: string | null;
  session_id: string | null;
  /** The day Home shows the play's session on. */
  session_date: string | null;
}

export interface MusicStats {
  totals: MusicTotals;
  top_songs: MusicAggregate[];
  top_artists: MusicAggregate[];
  top_albums: MusicAggregate[];
  /** A play counts toward each of its genres. */
  top_genres: TopGenre[];
}

export interface TopGenre {
  name: string;
  plays: number;
  listened_seconds: number;
  /** First-credited artists of its plays. */
  artists: number;
}

/** A genre and how many plays (of some group) carry it. */
export interface GenreCount {
  name: string;
  plays: number;
}

/** An album's or artist's own genres. */
export interface ItemGenres {
  /** What counts: the user's edit when there is one, else MusicBrainz's. */
  genres: string[];
  catalog_genres: string[];
  edited: boolean;
  /** MusicBrainz's answer; null before it was asked. */
  lookup: 'found' | 'not_found' | null;
}

export interface GenreDetail {
  name: string;
  plays: number;
  listened_seconds: number;
  first_played_at: string;
  last_played_at: string;
  unique_songs: number;
  unique_artists: number;
  rank: number;
  genres_total: number;
  daily: DayCount[];
  clock: ClockCell[];
  artists: GenreCount[];
  songs: ArtistSong[];
  albums: ArtistAlbum[];
  /** Other genres on the same plays, most shared plays first. */
  related: GenreCount[];
}

export interface GenreStreamBucket {
  start: string;
  /** Plays per band, in `GenreStream.genres` order. */
  counts: number[];
  other: number;
  other_top: GenreCount[];
}

export interface GenreStream {
  bucket: DiscoveryBucketSize;
  /** The bands, most played first. */
  genres: string[];
  buckets: GenreStreamBucket[];
  plays: number;
  plays_with_genres: number;
}

export interface GenreBackfillStatus {
  state: 'idle' | 'running' | 'done' | 'cancelled' | 'error';
  phase: 'artist' | 'album' | null;
  processed: number;
  total: number;
  found: number;
  not_found: number;
  skipped: number;
  error: string | null;
}

export interface GenreStatus {
  enabled: boolean;
  counts: {
    artists: { found: number; not_found: number };
    albums: { found: number; not_found: number };
    pending: number;
    plays: number;
    plays_with_genres: number;
  };
  job: GenreBackfillStatus;
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
  id?: string;
  /** Written down by hand, not scrobbled. */
  manual?: boolean;
  note?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  companions?: string[];
  genres?: string[];
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
  first_played_at: string | null;
  last_played_at: string | null;
  tracks: AlbumViewTrack[];
  daily: DayCount[];
  /** Other albums by the same album artist that you've played. */
  other_albums: ArtistAlbum[];
  /** The album's own genres; null for an artist's "Unknown album". */
  genres: ItemGenres | null;
  /** The album artist's genres, which plays fall back to while the album has none. */
  artist_genres: string[];
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
  created_at: string;
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

/** An autocomplete suggestion for the hand-entry form. */
export interface SongSuggestion {
  source: 'library' | 'deezer';
  title: string;
  artists: string[];
  album: string | null;
  album_artist: string | null;
  /** Seconds. */
  length: number | null;
  cover_url: string | null;
  /** Your plays of it (library suggestions). */
  plays: number | null;
}

export interface ManualScrobbleInput {
  title: string;
  artists: string[];
  album?: string | null;
  album_artists?: string[];
  /** Seconds. */
  track_length?: number | null;
  played_at: string;
  timezone?: string;
  note?: string | null;
  companions?: string[];
  latitude?: number | null;
  longitude?: number | null;
  location_accuracy?: number | null;
  /** Add even though a near-identical play is already on file. */
  force?: boolean;
}

export interface NearDuplicate {
  id: string;
  played_at: string;
  title: string;
  artists: string[];
  source: string | null;
}

export interface SessionNeighbour {
  id: string;
  title: string;
  artists: string[];
  played_at: string;
}

/** One play, as its own page shows it. */
export interface ScrobbleDetail {
  id: string;
  played_at: string;
  timezone: string;
  title: string;
  artists: string[];
  album: string | null;
  album_artists: string[];
  track_length: number | null;
  listened_for: number | null;
  source: string | null;
  note: string | null;
  latitude: number | null;
  longitude: number | null;
  location_accuracy: number | null;
  companions: string[];
  art_id: string | null;
  album_ref: string;
  song_key: string;
  /** Its album's genres, or its first artist's when the album has none. */
  genres: string[];
  history: { plays: number; first_played_at: string; last_played_at: string };
  session: {
    id: string;
    date: string;
    position: number;
    count: number;
    previous: SessionNeighbour | null;
    next: SessionNeighbour | null;
  } | null;
}

/** Plays per local day of one year, with streaks over the whole history. */
export interface DailyListening {
  days: { date: string; plays: number; seconds: number }[];
  listening_days: number;
  longest_streak: number;
  current_streak: number;
}

/** Plays per local day of week (0 = Sunday) and hour; cells without plays omitted. */
export interface ClockCell {
  dow: number;
  hour: number;
  plays: number;
  seconds: number;
}

export type DiscoveryBucketSize = 'week' | 'month' | 'year';

export interface DiscoveryBucket {
  /** First day of the week, month or year. */
  start: string;
  new_plays: number;
  familiar_plays: number;
  new_songs: number;
  new_artists: number;
  new_genres: number;
}

export interface Discovery {
  bucket: DiscoveryBucketSize;
  buckets: DiscoveryBucket[];
  totals: { plays: number; new_plays: number; new_songs: number; new_artists: number; new_genres: number };
}

export type LifeBy = 'companion' | 'place' | 'mood';

export interface LifeItem {
  name: string;
  plays: number;
  /** Share of the group's plays over share of all plays in the period (> 1: more than usual). */
  lift: number;
}

export interface LifeGroup {
  key: string;
  label: string;
  checkins: number;
  plays: number;
  top_artists: LifeItem[];
  top_songs: (LifeItem & { artists: string[]; song_key: string })[];
  top_genres: LifeItem[];
}

export interface LifeSoundtrack {
  groups: LifeGroup[];
  gap_minutes: number;
}

/** A play in a burst of one song played impossibly close together (Settings → Music). */
export interface DuplicatePlay {
  id: string;
  played_at: string;
  title: string;
  artists: string[];
  album_artists: string[];
  timezone: string | null;
  source: string | null;
  album: string | null;
  track_length: number | null;
  listened_for: number | null;
  /** A hand entry, or a play with a note, place or companions: never removed. */
  protected: boolean;
}

export interface DuplicateBurst {
  /** The kept play's id. */
  id: string;
  song_key: string;
  title: string;
  artists: string[];
  length: number | null;
  /** Gaps shorter than this many seconds chained the burst. */
  threshold: number;
  keep: DuplicatePlay[];
  remove: DuplicatePlay[];
}

export interface DuplicateScan {
  bursts: DuplicateBurst[];
  removable: number;
}

export interface RemovedPlay {
  id: string;
  played_at: string;
  title: string;
  artists: string[];
  album: string | null;
  album_artists: string[];
  track_length: number | null;
  listened_for: number | null;
  source: string | null;
  timezone: string | null;
}
