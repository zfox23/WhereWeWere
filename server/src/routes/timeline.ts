import { Router, Request, Response } from 'express';
import { find as findTimezone } from 'geo-tz';
import { query } from '../db';
import { allPlugins } from '../plugins/registry';
import { genericTimelineSelect, genericTimelineWhere } from '../plugins/genericStore';
import type { PluginTimelineContext } from 'wwp-shared';

const router = Router();

function addTimezone(row: any): any {
  if (row.type === 'location' && !row.venue_timezone && row.venue_latitude != null && row.venue_longitude != null) {
    const tzResults = findTimezone(Number(row.venue_latitude), Number(row.venue_longitude));
    row.venue_timezone = tzResults[0] || null;
  }
  return row;
}

function extractDateString(value: unknown): string | null {
  if (!value) return null;
  const raw = String(value);
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

/** Rebase $n placeholders so they start after `offset` parameters. */
function rebasePlaceholders(sql: string, offset: number): string {
  return sql.replace(/\$(\d+)/g, (_m, n) => `$${offset + parseInt(n, 10)}`);
}

/**
 * A branch of the unified timeline: a SELECT plus its WHERE.
 * Placeholders in `whereSql` are 1-based relative to `values`.
 */
interface TimelineBranch {
  key: string;
  selectSql: string;
  whereSql: string | null;
  values: unknown[];
}

// GET / - unified timeline of all check-in types (built-ins + plugins)
router.get('/', async (req: Request, res: Response) => {
  try {
    const {
      user_id, from, to,
      limit = '50', offset = '0',
    } = req.query;

    const userId = user_id ? String(user_id) : null;
    const fromDate = extractDateString(from);
    const toDate = extractDateString(to);
    const searchQuery = typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim() : null;

    const plugins = allPlugins();

    // Scope each plugin's declared filter params out of the query string.
    const pluginFilterParams = new Map<string, Record<string, string>>();
    for (const plugin of plugins) {
      const params: Record<string, string> = {};
      for (const name of plugin.filterParams ?? []) {
        const v = req.query[name];
        if (typeof v === 'string' && v !== '') params[name] = v;
      }
      pluginFilterParams.set(plugin.id, params);
    }
    const activePluginFilterIds = plugins
      .filter((p) => Object.keys(pluginFilterParams.get(p.id) ?? {}).length > 0)
      .map((p) => p.id);

    const hasLocationTypeFilter = Boolean(req.query.venue_id || req.query.category || req.query.country);
    const hasTrackTypeFilter = Boolean(req.query.track_activity);
    const hasMediaTypeFilter = Boolean(req.query.media_subtype);

    // Decide which branches to include (a type filter narrows to one type;
    // plugin filters win first, mirroring the legacy behavior where the mood
    // filter checked ahead of the location filters).
    const includedKeys: string[] = [];
    if (activePluginFilterIds.length > 0) {
      includedKeys.push(`plugin:${activePluginFilterIds[0]}`);
    } else if (hasLocationTypeFilter) {
      includedKeys.push('location');
    } else if (hasTrackTypeFilter) {
      includedKeys.push('track');
    } else if (hasMediaTypeFilter) {
      includedKeys.push('media');
    } else {
      includedKeys.push('location', ...plugins.map((p) => `plugin:${p.id}`), 'track', 'media');
    }

    // ------------------------------------------------------------------
    // Built-in branches (location, track, media). Mood and Sleep are plugins.
    // ------------------------------------------------------------------
    const builtInWhereBuilders: Record<string, () => { sql: string | null; values: unknown[] }> = {
      location: () => {
        const conditions: string[] = [];
        const values: unknown[] = [];
        const push = (cond: string, value: unknown) => {
          values.push(value);
          conditions.push(cond.replace('?', `$${values.length}`));
        };
        if (userId) push('c.user_id = ?', userId);
        if (fromDate) push(`(c.checked_in_at AT TIME ZONE COALESCE(c.checkin_timezone, 'UTC'))::date >= ?::date`, fromDate);
        if (toDate) push(`(c.checked_in_at AT TIME ZONE COALESCE(c.checkin_timezone, 'UTC'))::date <= ?::date`, toDate);
        if (req.query.venue_id) push('c.venue_id = ?', String(req.query.venue_id));
        if (req.query.category) push('vc.name = ?', String(req.query.category));
        if (req.query.country) push('v.country = ?', String(req.query.country));
        if (searchQuery) {
          values.push(searchQuery, searchQuery);
          conditions.push(
            `(c.search_vector @@ plainto_tsquery('english', $${values.length - 1}) OR v.search_vector @@ plainto_tsquery('english', $${values.length}))`,
          );
        }
        return { sql: conditions.length > 0 ? conditions.join(' AND ') : null, values };
      },
      track: () => {
        const conditions: string[] = [];
        const values: unknown[] = [];
        const push = (cond: string, value: unknown) => {
          values.push(value);
          conditions.push(cond.replace('?', `$${values.length}`));
        };
        if (userId) push('t.user_id = ?', userId);
        if (fromDate) push(`(t.started_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date >= ?::date`, fromDate);
        if (toDate) push(`(t.started_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date <= ?::date`, toDate);
        if (searchQuery) push(`t.name ILIKE '%' || ? || '%'`, searchQuery);
        if (req.query.track_activity) push(`t.activity_type ILIKE ?`, String(req.query.track_activity));
        return { sql: conditions.length > 0 ? conditions.join(' AND ') : null, values };
      },
      media: () => {
        const conditions: string[] = [];
        const values: unknown[] = [];
        const push = (cond: string, value: unknown) => {
          values.push(value);
          conditions.push(cond.replace('?', `$${values.length}`));
        };
        if (userId) push('mmc.user_id = ?', userId);
        if (fromDate) push(`(mmc.checked_in_at AT TIME ZONE COALESCE(mmc.checkin_timezone, 'UTC'))::date >= ?::date`, fromDate);
        if (toDate) push(`(mmc.checked_in_at AT TIME ZONE COALESCE(mmc.checkin_timezone, 'UTC'))::date <= ?::date`, toDate);
        if (searchQuery) {
          values.push(searchQuery, searchQuery);
          conditions.push(
            `(mi.title ILIKE '%' || $${values.length - 1} || '%' OR mmc.notes ILIKE '%' || $${values.length} || '%')`,
          );
        }
        if (req.query.media_subtype) {
          const subtypes = String(req.query.media_subtype)
            .split(',')
            .map((s) => s.trim())
            .filter((s) => ['movie', 'tv_show', 'game', 'book', 'board_game'].includes(s));
          if (subtypes.length > 0) {
            push(`mi.media_type = ANY(?::text[])`, subtypes);
          }
        }
        return { sql: conditions.length > 0 ? conditions.join(' AND ') : null, values };
      },
    };

    const builtInSelects: Record<string, string> = {
      location: `
      SELECT 'location' AS type, c.id, c.user_id, c.venue_id, c.notes,
             c.checked_in_at, c.created_at,
             v.name AS venue_name, v.latitude AS venue_latitude, v.longitude AS venue_longitude,
              c.checkin_timezone AS venue_timezone,
             vc.name AS venue_category,
             pv.id AS parent_venue_id, pv.name AS parent_venue_name,
         NULL::smallint AS mood, NULL::text AS mood_timezone, NULL::json AS activities,
         NULL::text AS track_name,
         NULL::numeric AS track_distance_m,
         NULL::text AS track_timezone,
         NULL::timestamptz AS track_started_at,
         NULL::timestamptz AS track_ended_at,
         NULL::bigint AS track_elapsed_time_s,
         NULL::text AS media_type,
         NULL::uuid AS media_item_id,
         NULL::text AS media_title,
         NULL::text AS media_image_url,
         NULL::text AS media_author,
         NULL::smallint AS media_rating,
         NULL::text AS media_checkin_type,
         NULL::int AS media_season_number,
         NULL::int AS media_episode_number,
         NULL::text AS media_episode_title,
         NULL::text AS media_timezone,
         NULL::jsonb AS data
     FROM checkins c
     JOIN venues v ON c.venue_id = v.id
     LEFT JOIN venue_categories vc ON v.category_id = vc.id
     LEFT JOIN venues pv ON v.parent_venue_id = pv.id
   `,
     track: `
      SELECT 'track' AS type, t.id, t.user_id, NULL AS venue_id, t.name AS notes,
             t.started_at AS checked_in_at, t.created_at,
             NULL AS venue_name, NULL AS venue_latitude, NULL AS venue_longitude,
             NULL::text AS venue_timezone,
             NULL AS venue_category,
             NULL AS parent_venue_id, NULL AS parent_venue_name,
             NULL::smallint AS mood, NULL::text AS mood_timezone, NULL::json AS activities,
             t.name AS track_name, t.distance_m AS track_distance_m, t.timezone AS track_timezone,
             t.started_at AS track_started_at, t.ended_at AS track_ended_at,
             t.elapsed_time_s AS track_elapsed_time_s,
             NULL::text AS media_type,
             NULL::uuid AS media_item_id,
             NULL::text AS media_title,
             NULL::text AS media_image_url,
             NULL::text AS media_author,
             NULL::smallint AS media_rating,
             NULL::text AS media_checkin_type,
             NULL::int AS media_season_number,
             NULL::int AS media_episode_number,
             NULL::text AS media_episode_title,
             NULL::text AS media_timezone,
             NULL::jsonb AS data
             FROM tracks t
            `,
      media: `
            SELECT 'media' AS type, mmc.id, mmc.user_id, NULL AS venue_id, mmc.notes,
                   mmc.checked_in_at, mmc.created_at,
                   NULL AS venue_name, NULL AS venue_latitude, NULL AS venue_longitude,
                   NULL::text AS venue_timezone,
                   NULL AS venue_category,
                   NULL AS parent_venue_id, NULL AS parent_venue_name,
                   NULL::smallint AS mood, NULL::text AS mood_timezone, NULL::json AS activities,
                   NULL::text AS track_name,
                   NULL::numeric AS track_distance_m,
                   NULL::text AS track_timezone,
                   NULL::timestamptz AS track_started_at,
                   NULL::timestamptz AS track_ended_at,
                   NULL::bigint AS track_elapsed_time_s,
                   mi.media_type,
                   mi.id AS media_item_id,
                   mi.title AS media_title,
                   mi.image_url AS media_image_url,
                   mi.author AS media_author,
                   mmc.rating AS media_rating,
                   mmc.checkin_type AS media_checkin_type,
                   mmc.season_number AS media_season_number,
                   mmc.episode_number AS media_episode_number,
                   mmc.episode_title AS media_episode_title,
                   mmc.checkin_timezone AS media_timezone,
                   NULL::jsonb AS data
              FROM media_checkins mmc
              JOIN media_items mi ON mmc.media_item_id = mi.id
          `,
    };

    // ------------------------------------------------------------------
    // Assemble branches in display order, tracking the global param offset.
    // ------------------------------------------------------------------
    const branches: TimelineBranch[] = [];

    for (const key of includedKeys) {
      if (key.startsWith('plugin:')) {
        const plugin = plugins.find((p) => `plugin:${p.id}` === key);
        if (!plugin) continue;

        if (plugin.server.storage === 'custom') {
          if (!plugin.server.buildTimelineSelect || !plugin.server.buildTimelineWhere) {
            console.error(`Plugin "${plugin.id}" declares custom storage but is missing timeline hooks`);
            continue;
          }
          const ctx: PluginTimelineContext = {
            user_id: userId,
            from: fromDate,
            to: toDate,
            q: searchQuery,
            filterParams: pluginFilterParams.get(plugin.id) ?? {},
          };
          const selectSql = plugin.server.buildTimelineSelect().sql;
          const clause = plugin.server.buildTimelineWhere(ctx);
          branches.push({ key, selectSql, whereSql: clause?.sql ?? null, values: clause?.values ?? [] });
        } else {
          const clause = genericTimelineWhere(plugin, {
            user_id: userId,
            from: fromDate,
            to: toDate,
            q: searchQuery,
            filterParams: pluginFilterParams.get(plugin.id) ?? {},
          });
          branches.push({ key, selectSql: genericTimelineSelect(plugin.id), whereSql: clause.sql, values: clause.values });
        }
      } else {
        const where = builtInWhereBuilders[key]?.();
        const selectSql = builtInSelects[key];
        if (!where || !selectSql) continue;
        branches.push({ key, selectSql, whereSql: where.sql, values: where.values });
      }
    }

    if (branches.length === 0) {
      res.json([]);
      return;
    }

    // Concatenate per-branch WHERE values with rebased placeholders, then
    // append limit/offset.
    const params: unknown[] = [];
    const branchSqls = branches.map((branch) => {
      const whereSql = branch.whereSql ? rebasePlaceholders(branch.whereSql, params.length) : null;
      params.push(...branch.values);
      return {
        sql: `${branch.selectSql}
        ${whereSql ? `WHERE ${whereSql}` : ''}`,
      };
    });

    params.push(parseInt(limit as string, 10));
    const limitParam = `$${params.length}`;
    params.push(parseInt(offset as string, 10));
    const offsetParam = `$${params.length}`;

    const sql =
      branches.length === 1
        ? `${branchSqls[0].sql}
          ORDER BY checked_in_at DESC
          LIMIT ${limitParam} OFFSET ${offsetParam}`
        : `${branchSqls.map((b) => `(\n${b.sql}\n)`).join('\nUNION ALL\n')}
          ORDER BY checked_in_at DESC
          LIMIT ${limitParam} OFFSET ${offsetParam}`;

    const result = await query(sql, params);
    res.json(result.rows.map(addTimezone));
  } catch (err) {
    console.error('Error listing timeline:', err);
    res.status(500).json({ error: 'Failed to list timeline' });
  }
});

export const timelineRouter = router;
