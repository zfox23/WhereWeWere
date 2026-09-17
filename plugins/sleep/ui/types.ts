/**
 * Sleep check-in type — client-side data types (previously in
 * client/src/types/index.ts).
 */

export interface SleepEntry {
  id: string;
  user_id: string;
  sleep_as_android_id: number;
  sleep_timezone: string;
  started_at: string;
  ended_at: string | null;
  rating: number;
  comment: string | null;
  is_pending: boolean;
  created_at: string;
  updated_at: string;
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
