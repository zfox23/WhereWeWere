/**
 * Tracks plugin — shared constants used by both the server half (SQL) and
 * the client UI (filters, profile tab), so they always agree.
 */

/**
 * Sentinel value for the `track_activity` timeline filter param meaning
 * "tracks with no activity type" (NULL or blank `activity_type`). A normal
 * filter value is matched with ILIKE, which cannot match NULL, so the
 * server maps this sentinel onto an explicit null/blank condition.
 */
export const NO_ACTIVITY_TYPE = '(none)';

/** Display label for the sentinel in filter UIs. */
export const NO_ACTIVITY_TYPE_LABEL = '(No type)';
