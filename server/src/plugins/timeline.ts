/**
 * Shared unified-timeline column envelope.
 *
 * The unified timeline is a `UNION ALL` of one SELECT per check-in type
 * (built-in types + plugins). `UNION ALL` aligns branches *positionally*, so
 * every branch must emit the exact same columns in the exact same order. This
 * module is the single source of truth for that column set.
 *
 * A branch only needs to declare the columns it *owns* (its real data); the
 * rest are filled with typed NULLs automatically. This removes the ~30-line
 * copy-paste of `NULL::<cast> AS col` from every branch and guarantees a new
 * plugin can never desync the UNION by forgetting a column.
 */

export interface TimelineColumn {
  name: string;
  /** SQL emitted when a branch does not own this column (typed NULL). */
  nullSql: string;
}

/**
 * Canonical column order for every timeline branch. The first seven are the
 * standard envelope every type provides; the rest are domain columns owned by
 * one type each. `timezone` (last) is the IANA timezone of the check-in for
 * every type — the client uses it for day-grouping.
 */
export const TIMELINE_COLUMNS: TimelineColumn[] = [
  { name: 'type', nullSql: `NULL::text AS type` },
  { name: 'id', nullSql: `NULL::uuid AS id` },
  { name: 'user_id', nullSql: `NULL::uuid AS user_id` },
  // UUID columns must be typed: in a UNION ALL, untyped NULLs from several
  // branches followed by a real uuid column fail type resolution
  // ("UNION types text and uuid cannot be matched").
  { name: 'venue_id', nullSql: `NULL::uuid AS venue_id` },
  { name: 'notes', nullSql: `NULL AS notes` },
  { name: 'checked_in_at', nullSql: `NULL::timestamptz AS checked_in_at` },
  { name: 'created_at', nullSql: `NULL::timestamptz AS created_at` },
  { name: 'venue_name', nullSql: `NULL::text AS venue_name` },
  { name: 'venue_latitude', nullSql: `NULL::numeric AS venue_latitude` },
  { name: 'venue_longitude', nullSql: `NULL::numeric AS venue_longitude` },
  { name: 'venue_timezone', nullSql: `NULL::text AS venue_timezone` },
  { name: 'venue_category', nullSql: `NULL::text AS venue_category` },
  { name: 'parent_venue_id', nullSql: `NULL::uuid AS parent_venue_id` },
  { name: 'parent_venue_name', nullSql: `NULL::text AS parent_venue_name` },
  { name: 'mood', nullSql: `NULL::smallint AS mood` },
  { name: 'mood_timezone', nullSql: `NULL::text AS mood_timezone` },
  { name: 'activities', nullSql: `NULL::json AS activities` },
  { name: 'track_name', nullSql: `NULL::text AS track_name` },
  { name: 'track_distance_m', nullSql: `NULL::numeric AS track_distance_m` },
  { name: 'track_timezone', nullSql: `NULL::text AS track_timezone` },
  { name: 'track_started_at', nullSql: `NULL::timestamptz AS track_started_at` },
  { name: 'track_ended_at', nullSql: `NULL::timestamptz AS track_ended_at` },
  { name: 'track_elapsed_time_s', nullSql: `NULL::bigint AS track_elapsed_time_s` },
  { name: 'media_type', nullSql: `NULL::text AS media_type` },
  { name: 'media_item_id', nullSql: `NULL::uuid AS media_item_id` },
  { name: 'media_title', nullSql: `NULL::text AS media_title` },
  { name: 'media_image_url', nullSql: `NULL::text AS media_image_url` },
  { name: 'media_author', nullSql: `NULL::text AS media_author` },
  { name: 'media_rating', nullSql: `NULL::smallint AS media_rating` },
  { name: 'media_checkin_type', nullSql: `NULL::text AS media_checkin_type` },
  { name: 'media_season_number', nullSql: `NULL::int AS media_season_number` },
  { name: 'media_episode_number', nullSql: `NULL::int AS media_episode_number` },
  { name: 'media_episode_title', nullSql: `NULL::text AS media_episode_title` },
  { name: 'media_timezone', nullSql: `NULL::text AS media_timezone` },
  { name: 'data', nullSql: `NULL::jsonb AS data` },
  { name: 'timezone', nullSql: `NULL::text AS timezone` },
];

/**
 * Build the `SELECT` column list for a timeline branch.
 *
 * `owned` maps a canonical column name to the SQL expression (WITHOUT an
 * `AS` alias) that produces it. Columns present in `owned` are emitted as
 * `<expr> AS <name>`; all other columns are emitted as their typed NULL so
 * every branch matches the shared envelope.
 */
export function timelineColumnList(owned: Record<string, string>): string {
  return TIMELINE_COLUMNS.map(({ name, nullSql }) =>
    name in owned ? `${owned[name]} AS ${name}` : nullSql,
  ).join(',\n');
}
