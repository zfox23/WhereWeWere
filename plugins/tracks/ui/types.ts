/**
 * Tracks check-in type — client types.
 *
 * These types previously lived in the core client (`client/src/types/index.ts`);
 * they moved here so the Tracks plugin is fully self-contained.
 */

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

/** The `track_*` columns the unified timeline emits for track rows. */
export interface TrackTimelineFields {
  track_name?: string;
  track_distance_m?: number;
  track_timezone?: string | null;
  track_started_at?: string;
  track_ended_at?: string;
  track_elapsed_time_s?: number;
}
