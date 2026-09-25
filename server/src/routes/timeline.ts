import { Router, Request, Response } from 'express';
import { query } from '../db';
import { allPlugins } from '../plugins/registry';
import { genericTimelineSelect, genericTimelineWhere } from '../plugins/genericStore';
import type { PluginTimelineContext } from 'wwp-shared';

const router = Router();

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
  /** Optional row-level post-processing for this branch's rows (plugins). */
  postProcess?: (rows: unknown[]) => unknown[];
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
    // Core companion filter: only check-ins (of any type) carrying this
    // companion name. Applied on the merged union so it works across all
    // check-in types that implement companions.
    const companionName = typeof req.query.companion === 'string' && req.query.companion.trim() !== ''
      ? req.query.companion.trim()
      : null;

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

    // Decide which branches to include (a type filter narrows to one type;
    // plugin filters win first — a plugin's declared filterParams flow
    // through generically).
    const includedKeys: string[] = [];
    if (activePluginFilterIds.length > 0) {
      includedKeys.push(`plugin:${activePluginFilterIds[0]}`);
    } else {
      includedKeys.push(...plugins.map((p) => `plugin:${p.id}`));
    }

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
          const { sql: selectSql, postProcess } = plugin.server.buildTimelineSelect();
          const clause = plugin.server.buildTimelineWhere(ctx);
          branches.push({ key, selectSql, whereSql: clause?.sql ?? null, values: clause?.values ?? [], postProcess });
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

    const unionSql =
      branches.length === 1
        ? branchSqls[0].sql
        : branchSqls.map((b) => `(\n${b.sql}\n)`).join('\nUNION ALL\n');

    let sql: string;
    if (companionName) {
      // Wrap the union so the companion filter applies to the aliased
      // (type, id) envelope columns of every branch.
      params.push(companionName);
      const companionParam = `$${params.length}`;
      sql = `SELECT * FROM (
        ${unionSql}
      ) AS timeline
      WHERE EXISTS (
        SELECT 1 FROM companions comp
        WHERE comp.checkin_type = timeline.type
          AND comp.checkin_id = timeline.id
          AND comp.name = ${companionParam}
      )
      ORDER BY checked_in_at DESC
      LIMIT ${limitParam} OFFSET ${offsetParam}`;
    } else {
      sql = `${unionSql}
      ORDER BY checked_in_at DESC
      LIMIT ${limitParam} OFFSET ${offsetParam}`;
    }

    const result = await query(sql, params);

    // Row-level post-processing (plugins): slice the merged rows back into
    // per-branch rows by their `type` column, run the branch's hook, and
    // keep the overall order intact.
    const postProcessors = branches.filter((b) => b.postProcess);
    if (postProcessors.length > 0) {
      const byBranch = new Map(postProcessors.map((b) => [b.key, [] as any[]]));
      for (const row of result.rows) {
        const branch = postProcessors.find((b) => b.key === `plugin:${(row as any).type}`);
        if (branch) byBranch.get(branch.key)!.push(row);
      }
      for (const branch of postProcessors) {
        const rows = byBranch.get(branch.key) ?? [];
        if (rows.length > 0) branch.postProcess!(rows);
      }
    }

    res.json(result.rows);
  } catch (err) {
    console.error('Error listing timeline:', err);
    res.status(500).json({ error: 'Failed to list timeline' });
  }
});

export const timelineRouter = router;
