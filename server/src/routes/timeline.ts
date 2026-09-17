import { Router, Request, Response } from 'express';
import { find as findTimezone } from 'geo-tz';
import { query } from '../db';
import { allPlugins } from '../plugins/registry';
import { genericTimelineSelect, genericTimelineWhere } from '../plugins/genericStore';
import { timelineColumnList } from '../plugins/timeline';
import { timelineWhereConditions } from '../plugins/sql';
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
    const ctx = { user_id: userId, from: fromDate, to: toDate, q: searchQuery };

    const builtInWhereBuilders: Record<string, () => { sql: string | null; values: unknown[] }> = {
      location: () => {
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
        if (req.query.venue_id) conds.push('c.venue_id = ?', String(req.query.venue_id));
        if (req.query.category) conds.push('vc.name = ?', String(req.query.category));
        if (req.query.country) conds.push('v.country = ?', String(req.query.country));
        return conds.build();
      },
      track: () => {
        const conds = timelineWhereConditions(ctx, {
          alias: 't',
          timestampColumn: 'started_at',
          timezoneColumn: 'timezone',
          search: (c, q) => c.push(`t.name ILIKE '%' || ? || '%'`, q),
        });
        if (req.query.track_activity) conds.push(`t.activity_type ILIKE ?`, String(req.query.track_activity));
        return conds.build();
      },
      media: () => {
        const conds = timelineWhereConditions(ctx, {
          alias: 'mmc',
          timestampColumn: 'checked_in_at',
          timezoneColumn: 'checkin_timezone',
          search: (c, q) => c.push(
            `(mi.title ILIKE '%' || ? || '%' OR mmc.notes ILIKE '%' || ? || '%')`,
            q,
            q,
          ),
        });
        if (req.query.media_subtype) {
          const subtypes = String(req.query.media_subtype)
            .split(',')
            .map((s) => s.trim())
            .filter((s) => ['movie', 'tv_show', 'game', 'book', 'board_game'].includes(s));
          if (subtypes.length > 0) {
            conds.push(`mi.media_type = ANY(?::text[])`, subtypes);
          }
        }
        return conds.build();
      },
    };

    const builtInSelects: Record<string, string> = {
      location: `
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
        timezone: 'c.checkin_timezone',
      })}
     FROM checkins c
     JOIN venues v ON c.venue_id = v.id
     LEFT JOIN venue_categories vc ON v.category_id = vc.id
     LEFT JOIN venues pv ON v.parent_venue_id = pv.id
   `,
      track: `
      SELECT ${timelineColumnList({
        type: `'track'`,
        id: 't.id',
        user_id: 't.user_id',
        notes: 't.name',
        checked_in_at: 't.started_at',
        created_at: 't.created_at',
        track_name: 't.name',
        track_distance_m: 't.distance_m',
        track_timezone: 't.timezone',
        track_started_at: 't.started_at',
        track_ended_at: 't.ended_at',
        track_elapsed_time_s: 't.elapsed_time_s',
        timezone: 't.timezone',
      })}
             FROM tracks t
            `,
      media: `
            SELECT ${timelineColumnList({
        type: `'media'`,
        id: 'mmc.id',
        user_id: 'mmc.user_id',
        notes: 'mmc.notes',
        checked_in_at: 'mmc.checked_in_at',
        created_at: 'mmc.created_at',
        media_type: 'mi.media_type',
        media_item_id: 'mi.id',
        media_title: 'mi.title',
        media_image_url: 'mi.image_url',
        media_author: 'mi.author',
        media_rating: 'mmc.rating',
        media_checkin_type: 'mmc.checkin_type',
        media_season_number: 'mmc.season_number',
        media_episode_number: 'mmc.episode_number',
        media_episode_title: 'mmc.episode_title',
        media_timezone: 'mmc.checkin_timezone',
        timezone: 'mmc.checkin_timezone',
      })}
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
