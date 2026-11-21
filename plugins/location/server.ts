/**
 * Location check-in type — server half.
 *
 * CUSTOM storage: Location keeps its pre-existing tables (`checkins`,
 * `venues`, `venue_categories`, lists, ratings, weather). The framework uses
 * this half for the unified timeline, backups, start-over and cross-cutting
 * hooks, and mounts the plugin-owned API routers:
 *   - /location-checkins   check-in CRUD, check-in lists, stats  (routes/checkins.ts)
 *   - /venues              venue catalog, venue lists, OSM import (routes/venues.ts)
 *   - /weather             daily weather                          (routes/weather.ts)
 *   - /search              unified venue + check-in search        (routes/search.ts)
 *   - /import/swarm        Swarm CSV import                       (routes/swarmImport.ts)
 *   - /place-patterns      place-based background SVGs            (routes/placePatterns.ts)
 * Background jobs live in jobs.ts; backup/restore/start-over in backup.ts.
 */

import { getVenueTimezone, normalizeEtcGmt } from './services/geoTimezone';
import type { CheckinTypeServerPlugin, PluginReconciliationSuggestion, PluginReconciliationUninferable, PluginTimelineContext } from 'wwp-shared';
import { isValidTimeZone } from 'wwp-shared';
import { query } from '../../server/src/db';
import { timelineColumnList } from '../../server/src/plugins/timeline';
import { timelineWhereConditions } from '../../server/src/plugins/sql';
import { companionNamesSql } from '../../server/src/services/companions';
import { currentUserId } from '../../server/src/auth/context';
import { checkinsRouter } from './routes/checkins';
import { venuesRouter } from './routes/venues';
import { weatherRouter } from './routes/weather';
import { searchRouter } from './routes/search';
import { swarmImportRouter } from './routes/swarmImport';
import { placePatternsRouter } from './routes/placePatterns';
import { addTimezone } from './routes/helpers';
import { jobs } from './jobs';
import { backupHooks } from './backup';

export const server: CheckinTypeServerPlugin = {
  storage: 'custom',

  api: [
    { mount: '/location-checkins', router: checkinsRouter },
    { mount: '/venues', router: venuesRouter },
    { mount: '/weather', router: weatherRouter },
    { mount: '/search', router: searchRouter },
    { mount: '/import/swarm', router: swarmImportRouter },
    { mount: '/place-patterns', router: placePatternsRouter },
  ],

  buildTimelineSelect: () => {
    // Shared companion attribute: carried both on the legacy `data` jsonb
    // (consumed by the location client) and the shared envelope column.
    const companionSql = `(${companionNamesSql('location', 'c.id')})`;
    return {
    sql: `
      SELECT ${timelineColumnList({
        type: `'location'`,
        id: 'c.id',
        user_id: 'c.user_id',
        venue_id: 'c.venue_id',
        notes: 'c.notes',
        checked_in_at: 'c.checked_in_at',
        created_at: 'c.created_at',
        venue_name: 'v.name',
        venue_latitude: 'v.latitude',
        venue_longitude: 'v.longitude',
        venue_timezone: 'c.checkin_timezone',
        venue_category: 'vc.name',
        parent_venue_id: 'pv.id',
        parent_venue_name: 'pv.name',
        companions: companionSql,
        data: `json_build_object(
          'venue_id', c.venue_id,
          'notes', c.notes,
          'rating', c.rating,
          'companions', ${companionSql}
        )::jsonb`,
        timezone: 'c.checkin_timezone',
      })}
      FROM checkins c
      JOIN venues v ON c.venue_id = v.id
      LEFT JOIN venue_categories vc ON v.category_id = vc.id
      LEFT JOIN venues pv ON v.parent_venue_id = pv.id
    `,
    // Legacy rows may lack checkin_timezone; fill it from the venue
    // coordinates (the pre-plugin core did this in JS after the query).
    postProcess: (rows: unknown[]) => rows.map(addTimezone),
    };
  },

  ...backupHooks,

  buildTimelineWhere: (ctx: PluginTimelineContext) => {
    const conds = timelineWhereConditions(ctx, {
      alias: 'c',
      timestampColumn: 'checked_in_at',
      timezoneColumn: 'checkin_timezone',
      search: (c, q) => c.push(
        `(c.search_vector @@ plainto_tsquery('english', ?) OR v.search_vector @@ plainto_tsquery('english', ?))`,
        q,
        q,
      ),
    });
    if (ctx.filterParams.venue_id) conds.push('c.venue_id = ?', ctx.filterParams.venue_id);
    // The stats lists label venues without a category/country 'Uncategorized' /
    // 'Unknown' (COALESCE in SQL); clicking one links here with that label, so
    // map it back to the NULL case instead of matching a literal name.
    if (ctx.filterParams.category === 'Uncategorized') conds.push('vc.id IS NULL');
    else if (ctx.filterParams.category) conds.push('vc.name = ?', ctx.filterParams.category);
    if (ctx.filterParams.country === 'Unknown') conds.push(`(v.country IS NULL OR TRIM(v.country) = '')`);
    else if (ctx.filterParams.country) conds.push('v.country = ?', ctx.filterParams.country);
    return conds.build();
  },


  // ------------------------------------------------------------------
  // Cross-cutting service hooks
  // ------------------------------------------------------------------

  // Photo/scrobble anchor timestamps for Immich and music enrichment.
  resolveTimestamps: () => ({
    sql: 'SELECT id, checked_in_at FROM checkins WHERE id = ANY($1::uuid[])',
  }),

  // Timezone inference for integrations (Plex webhook): the timezone of the
  // most recent location check-in at or before the reference time.
  latestTimezoneAsOf: () => ({
    sql: `SELECT checkin_timezone AS timezone
         FROM checkins
         WHERE user_id = $2
           AND checkin_timezone IS NOT NULL
           AND checked_in_at <= $1
         ORDER BY checked_in_at DESC
         LIMIT 1`,
  }),

  // Every located check-in's timezone, for timezone assignment to
  // timezone-less data (music scrobbles).
  timezoneAnchors: () => ({
    sql: `SELECT checked_in_at AS at, checkin_timezone AS timezone
          FROM checkins
          WHERE user_id = $1 AND checkin_timezone IS NOT NULL`,
  }),

  // "This day in previous years" reflection branch.
  reflectionBranch: () => ({
    sql: `
      SELECT
        'location' AS type,
        c.id,
        c.checked_in_at,
        c.notes AS note,
        v.id AS venue_id,
        v.name AS venue_name,
        v.city,
        v.country,
        v.latitude,
        v.longitude,
        vc.name AS venue_category,
        c.checkin_timezone AS venue_timezone,
        EXTRACT(YEAR FROM c.checked_in_at AT TIME ZONE COALESCE(c.checkin_timezone, 'UTC'))::int AS reflection_year,
        (
          EXTRACT(YEAR FROM $2::date)::int
          - EXTRACT(YEAR FROM c.checked_in_at AT TIME ZONE COALESCE(c.checkin_timezone, 'UTC'))::int
        )::int AS years_ago,
        json_build_object(
          'venue_id', c.venue_id,
          'notes', c.notes
        )::jsonb AS data
      FROM checkins c
      JOIN venues v ON c.venue_id = v.id
      LEFT JOIN venue_categories vc ON v.category_id = vc.id
      WHERE c.user_id = $1
        AND TO_CHAR(c.checked_in_at AT TIME ZONE COALESCE(c.checkin_timezone, 'UTC'), 'MM-DD') = TO_CHAR($2::date, 'MM-DD')
        AND EXTRACT(YEAR FROM c.checked_in_at AT TIME ZONE COALESCE(c.checkin_timezone, 'UTC'))
            < EXTRACT(YEAR FROM $2::date)
    `,
  }),

  // Earliest check-in date for the "all time" period selector.
  earliestDate: () => ({
    sql: `SELECT MIN(DATE(checked_in_at AT TIME ZONE COALESCE(checkin_timezone, 'UTC')))::text AS date
          FROM checkins WHERE user_id = $1`,
  }),

  // LLM life summary contribution.
  llm: {
    label: 'location check-ins',
    gather: async (user_id, from, to) => {
      const result = await query(
        `SELECT c.checked_in_at, c.checkin_timezone AS timezone,
                json_build_object(
                  'venue_name', v.name,
                  'venue_category', vc.name,
                  'city', v.city,
                  'country', v.country,
                  'note', c.notes
                )::jsonb AS data
         FROM checkins c
         JOIN venues v ON c.venue_id = v.id
         LEFT JOIN venue_categories vc ON v.category_id = vc.id
         WHERE c.user_id = $1
           AND (c.checked_in_at AT TIME ZONE COALESCE(c.checkin_timezone, 'UTC'))::date >= $2::date
           AND (c.checked_in_at AT TIME ZONE COALESCE(c.checkin_timezone, 'UTC'))::date <= $3::date
         ORDER BY c.checked_in_at ASC`,
        [user_id, from, to],
      );
      return result.rows;
    },
    toLines: (row) => {
      const d = row.data as {
        venue_name: string | null;
        venue_category: string | null;
        city: string | null;
        country: string | null;
        note: string | null;
      };
      const where = [d.venue_name, d.venue_category, [d.city, d.country].filter(Boolean).join(', ')]
        .filter(Boolean)
        .join(' / ');
      const note = d.note ? ` — note: "${d.note}"` : '';

      const formatWhen = (iso: string | Date, timezone: string | null): string => {
        const opts: Intl.DateTimeFormatOptions = {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        };
        return new Intl.DateTimeFormat('en-US', timezone ? { ...opts, timeZone: timezone } : opts).format(new Date(iso));
      };

      return [`- ${formatWhen(row.checked_in_at, row.timezone)} — location check-in at ${where}${note}`];
    },
  },

  // Timestamp reconciliation participation.
  //
  // Location check-ins are timezone-inferable from their venue's coordinates,
  // so they generate their OWN suggestions via `suggest` (resolving lat/lng
  // to an IANA zone) instead of using the framework's anchor-based pass.
  // Their geo-resolved timezone is also exposed via `anchorTimezone` so other
  // check-in types can anchor to a location row's *true* timezone (not the
  // possibly-wrong stored label).
  reconcile: {
    anchorLabel: 'location check-in',
    scanAll: true,
    detailPath: (id) => `/location-checkins/${id}`,
    loadCheckins: async (user_id) => {
      const result = await query(
        `SELECT c.id, c.checked_in_at, c.checkin_timezone AS original_timezone,
                v.latitude, v.longitude
         FROM checkins c
         JOIN venues v ON v.id = c.venue_id
         WHERE c.user_id = $1
         ORDER BY c.checked_in_at ASC`,
        [user_id],
      );
      return result.rows;
    },
    anchorTimezone: (row) => getVenueTimezone(row.latitude ?? null, row.longitude ?? null),
    suggest: async (_user_id, rows) => {
      const suggestions: PluginReconciliationSuggestion[] = [];
      const uninferable: PluginReconciliationUninferable[] = [];
      for (const row of rows) {
        const suggestedTimezone = getVenueTimezone(row.latitude ?? null, row.longitude ?? null);
        if (!suggestedTimezone) {
          uninferable.push({
            id: row.id,
            reason: 'The check-in has no venue coordinates to resolve a timezone from.',
          });
          continue;
        }
        if (suggestedTimezone === normalizeEtcGmt(row.original_timezone || '')) {
          continue;
        }
        suggestions.push({
          id: row.id,
          suggested_timezone: suggestedTimezone,
          reason: row.original_timezone
            ? `Check-in location resolves to ${suggestedTimezone}, not ${row.original_timezone}.`
            : `Check-in location resolves to ${suggestedTimezone}.`,
        });
      }
      return { suggestions, uninferable };
    },
    apply: async (id, suggested_timezone, executor) => {
      if (!isValidTimeZone(suggested_timezone)) return false;
      const result = await (executor ?? { query }).query(
        `UPDATE checkins
         SET checkin_timezone = $2, updated_at = NOW()
         WHERE id = $1 AND user_id = $3
         RETURNING id`,
        [id, suggested_timezone, currentUserId()],
      );
      return (result.rowCount ?? 0) > 0;
    },
  },

  jobs,

  settingsKeys: [
    { name: 'coasterpedia_api_key', type: 'string', label: 'Coasterpedia API key' },
    { name: 'weather_enabled', type: 'boolean', label: 'Show daily weather (Open-Meteo)', default: false },
  ],
};
