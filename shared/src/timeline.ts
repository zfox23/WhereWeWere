/**
 * Framework-level contract types for the unified timeline and filters.
 *
 * These are shared by the client and server so that a plugin's server half
 * (which produces timeline rows and consumes filter params) and its client
 * half (which renders timeline cards and filter controls) agree on shape.
 */

/**
 * A single timeline row as consumed by the client. Built-in check-in types
 * keep their legacy typed columns during the transition; plugin entries
 * carry their typed data in `data` plus the standard envelope fields.
 */
export interface PluginTimelineEntry {
  /** Plugin id, e.g. 'mood'. */
  type: string;
  id: string;
  user_id: string;
  /** ISO timestamp of the check-in (in `timezone`). */
  checked_in_at: string;
  created_at: string;
  notes: string | null;
  /** IANA timezone the check-in was made in, or null. */
  timezone: string | null;
  /**
   * Plugin-typed data for this entry. For plugins using the generic store
   * this is the validated `data` object; for plugins with a custom store it
   * is whatever the plugin's server `buildTimelineSelect` emits under
   * `data` (JSONB).
   */
  data: Record<string, unknown>;
}

/**
 * Filter parameters a plugin contributes to the timeline query.
 *
 * The client writes these into the URL (e.g. `?mood=3&activity=Walking`),
 * the server's generic timeline route passes them to the plugin's
 * `buildFilterClause`. A plugin's filter params are mutually exclusive with
 * every other plugin's filter params at the framework level (matching the
 * existing behavior of the built-in types).
 */
export interface PluginFilterContext {
  /** Raw query-string params scoped to this plugin (param name -> value). */
  params: Record<string, string>;
  /** True when the user has set any of this plugin's filters. */
  hasPluginFilter: boolean;
}

/**
 * A "this day in previous years" reflection entry as consumed by the client.
 * Built-in types fill their venue/sleep columns; plugin entries carry their
 * typed payload in `data`.
 */
export interface ReflectionEntry {
  /** Built-in type id ('location', 'sleep') or a plugin id (e.g. 'mood'). */
  type: string;
  id: string;
  checked_in_at: string;
  note: string | null;
  venue_id: string | null;
  venue_name: string | null;
  city: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  venue_category: string | null;
  venue_timezone: string | null;
  reflection_year: number;
  years_ago: number;
  sleep_started_at: string | null;
  sleep_ended_at: string | null;
  sleep_timezone: string | null;
  /** Plugin-typed payload for plugin reflection entries. */
  data: Record<string, unknown>;
}

/**
 * A filter clause produced by a plugin's server half. The framework injects
 * the clause into the plugin's timeline SELECT (AND-ed with the shared
 * user/date/search conditions). Params must be positional ($1, $2, ...)
 * starting at the offset the framework assigns.
 */
export interface PluginFilterClause {
  /** SQL fragment, or null when the filter narrows nothing. */
  sql: string | null;
  /** Values for the positional placeholders in `sql`. */
  values: unknown[];
  /**
   * Display label for the active filter (rendered as a removable pill by
   * the client; the client recomputes it locally, but the label is the
   * canonical one).
   */
  label?: string | null;
}
