/**
 * Mood check-in type — client types (owned by the plugin, not core).
 */

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
