/**
 * Backup / restore / start-over hooks for the location plugin's custom
 * tables. Spread into the plugin object in server.ts.
 */

import type { CheckinTypeServerPlugin } from 'wwp-shared';
import { query, pool } from '../../server/src/db';
import { isUuid } from '../../server/src/services/batching';
import { clearPlacePatterns } from './services/placePatterns';
import { normalizeRating } from './routes/helpers';

/**
 * `WITH RECURSIVE user_venues(id)`: the venues user $1 references through a
 * check-in, a rating or one of their venue lists, plus those venues' parent
 * chains.
 */
const USER_VENUES_CTE = `WITH RECURSIVE user_venues(id) AS (
           SELECT venue_id FROM checkins WHERE user_id = $1
           UNION
           SELECT venue_id FROM venue_ratings WHERE user_id = $1
           UNION
           SELECT vli.venue_id FROM venue_list_items vli
             JOIN venue_lists vl ON vl.id = vli.list_id AND vl.user_id = $1
           UNION
           SELECT v.parent_venue_id FROM venues v
             JOIN user_venues uv ON uv.id = v.id
            WHERE v.parent_venue_id IS NOT NULL
         )`;

type BackupHooks = Required<Pick<CheckinTypeServerPlugin,
  'legacyBackupKeys' | 'backupExport' | 'backupImport' | 'restoreLegacyBackup'
  | 'deleteUserData' | 'deleteAllData' | 'extraBackupTables'>>;

export const backupHooks: BackupHooks = {
  // Old backups stored location data under the top-level checkins / venues /
  // venueCategories keys; new backups carry a plugins.location payload.
  legacyBackupKeys: ['checkins', 'venues', 'venueCategories'],

  /**
   * Serialize this user's location data for backup. The payload carries
   * check-ins plus the venues they reference (by check-in or list entry, with
   * those venues' parent chains) and those venues' categories (with their
   * parent chains). The rest of the shared catalog is not the user's data.
   */
  backupExport: async ({ user_id }) => {
    // Companions are core-owned: they ship in the backup bundle's
    // companions.json (see the core backup route), not in this payload.
    const [checkinsResult, venuesResult, categoriesResult,
          venueListsResult, venueListItemsResult,
          checkinListsResult, checkinListItemsResult] = await Promise.all([
      query(
        `SELECT id, venue_id, notes, rating,
                checked_in_at, checkin_timezone, created_at, updated_at, swarm_id
         FROM checkins
         WHERE user_id = $1
         ORDER BY checked_in_at ASC`,
        [user_id],
      ),
      query(
        `${USER_VENUES_CTE}
         SELECT v.id, v.name, v.category_id,
                -- the user's own rating, carried on the venue row as before
                (SELECT vr.rating FROM venue_ratings vr WHERE vr.venue_id = v.id AND vr.user_id = $1) AS rating,
                v.address, v.city, v.state, v.country, v.postal_code,
                v.latitude, v.longitude,
                v.osm_id, v.swarm_venue_id,
                v.parent_venue_id,
                v.created_at, v.updated_at
         FROM venues v
         WHERE v.id IN (SELECT id FROM user_venues)
         ORDER BY v.created_at ASC`,
        [user_id],
      ),
      query(
        `${USER_VENUES_CTE},
         user_categories AS (
           SELECT vc.id, vc.parent_id FROM venue_categories vc
           WHERE vc.id IN (SELECT v.category_id FROM venues v WHERE v.id IN (SELECT id FROM user_venues))
           UNION
           SELECT p.id, p.parent_id FROM venue_categories p JOIN user_categories uc ON uc.parent_id = p.id
         )
         SELECT vc.id, vc.name, vc.icon, vc.parent_id, vc.created_at
         FROM venue_categories vc
         WHERE vc.id IN (SELECT id FROM user_categories)
         ORDER BY vc.name ASC`,
        [user_id],
      ),
      query(
        `SELECT id, name, created_at, updated_at
         FROM venue_lists WHERE user_id = $1 ORDER BY created_at`,
        [user_id],
      ),
      query(
        `SELECT vli.list_id, vli.venue_id, vli.position, vli.rank, vli.added_at
         FROM venue_list_items vli
         JOIN venue_lists vl ON vl.id = vli.list_id
         WHERE vl.user_id = $1
         ORDER BY vl.created_at, vli.position`,
        [user_id],
      ),
      query(
        `SELECT id, name, created_at, updated_at
         FROM checkin_lists WHERE user_id = $1 ORDER BY created_at`,
        [user_id],
      ),
      query(
        `SELECT cli.list_id, cli.checkin_id, cli.rank, cli.added_at
         FROM checkin_list_items cli
         JOIN checkin_lists cl ON cl.id = cli.list_id
         WHERE cl.user_id = $1
         ORDER BY cl.created_at, cli.rank, cli.added_at`,
        [user_id],
      ),
    ]);
    return {
      checkins: checkinsResult.rows,
      venues: venuesResult.rows,
      venueCategories: categoriesResult.rows,
      venueLists: venueListsResult.rows,
      venueListItems: venueListItemsResult.rows,
      checkinLists: checkinListsResult.rows,
      checkinListItems: checkinListItemsResult.rows,
    };
  },

  /**
   * Restore location data from backupExport (or restoreLegacyBackup's
   * normalized shape) into the CURRENT user's account (`user_id` from the
   * hook context; any user_id in the payload is ignored). FK order:
   * categories (parent later) -> venues (parent later) -> check-ins -> lists.
   *
   * Venues and categories are a shared catalog: rows that already exist are
   * reused as they are, never overwritten, and only rows this restore
   * inserted get their parent links filled in. Check-in, list and companion
   * rows whose id belongs to another user are skipped, and nothing is ever
   * attached to a check-in or list the current user doesn't own.
   */
  backupImport: async ({ user_id, client: txClient }, payload) => {
    const data = (payload ?? {}) as {
      checkins?: Record<string, unknown>[];
      venues?: Record<string, unknown>[];
      venueCategories?: Record<string, unknown>[];
      checkinCompanions?: Record<string, unknown>[];
      venueLists?: Record<string, unknown>[];
      venueListItems?: Record<string, unknown>[];
      checkinLists?: Record<string, unknown>[];
      checkinListItems?: Record<string, unknown>[];
    };
    const categories = Array.isArray(data.venueCategories) ? data.venueCategories : [];
    const venues = Array.isArray(data.venues) ? data.venues : [];
    const checkins = Array.isArray(data.checkins) ? data.checkins : [];
    const checkinCompanions = Array.isArray(data.checkinCompanions) ? data.checkinCompanions : [];
    const venueLists = Array.isArray(data.venueLists) ? data.venueLists : [];
    const venueListItems = Array.isArray(data.venueListItems) ? data.venueListItems : [];
    const checkinLists = Array.isArray(data.checkinLists) ? data.checkinLists : [];
    const checkinListItems = Array.isArray(data.checkinListItems) ? data.checkinListItems : [];

    // Use the framework's transaction client when provided so restore stays
    // atomic; open our own connection only when running standalone.
    const ownsClient = txClient == null;
    const client = txClient ?? (await pool.connect());
    // Of the given ids, the ones that exist in `table` owned by this user.
    const ownedIds = async (table: 'checkins' | 'venue_lists' | 'checkin_lists', ids: unknown[]): Promise<Set<string>> => {
      const wanted = [...new Set(ids.map((id) => String(id ?? '')).filter(isUuid))];
      if (wanted.length === 0) return new Set();
      const result = await client.query(
        `SELECT id::text AS id FROM ${table} WHERE id = ANY($1::uuid[]) AND user_id = $2`,
        [wanted, user_id]
      );
      return new Set(result.rows.map((r: { id: string }) => r.id));
    };
    try {
      // 1. Categories (parent_id deferred). An existing category with the
      //    same name (or id) is reused untouched; the id map lets venue
      //    category_id references be remapped.
      const categoryIdMap = new Map<string, string>();
      const insertedCategoryIds = new Set<string>();
      for (const category of categories) {
        if (!category?.name) continue;
        const backupId = isUuid(String(category.id ?? '')) ? String(category.id) : null;
        let result = await client.query(
          `INSERT INTO venue_categories (id, name, icon, parent_id, created_at)
           VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, NULL, COALESCE($4::timestamptz, NOW()))
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [backupId, category.name, category.icon || null, category.created_at || null]
        );
        if (result.rows.length > 0) {
          insertedCategoryIds.add(result.rows[0].id);
        } else {
          result = await client.query('SELECT id FROM venue_categories WHERE name = $1', [category.name]);
          if (result.rows.length === 0) {
            // The id is taken by a differently named category: insert under a new id.
            result = await client.query(
              `INSERT INTO venue_categories (name, icon, created_at)
               VALUES ($1, $2, COALESCE($3::timestamptz, NOW()))
               ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
               RETURNING id`,
              [category.name, category.icon || null, category.created_at || null]
            );
            insertedCategoryIds.add(result.rows[0].id);
          }
        }
        categoryIdMap.set(String(category.id), result.rows[0].id);
      }
      for (const category of categories) {
        const localCategoryId = categoryIdMap.get(String(category.id));
        const localParentId = category.parent_id ? categoryIdMap.get(String(category.parent_id)) : null;
        if (!localCategoryId || !localParentId || localCategoryId === localParentId) continue;
        if (!insertedCategoryIds.has(localCategoryId)) continue;
        await client.query(
          `UPDATE venue_categories SET parent_id = $2 WHERE id = $1 AND parent_id IS NULL`,
          [localCategoryId, localParentId]
        );
      }

      // 2. Venues (category_id remapped, parent_venue_id deferred). A venue
      //    whose id already exists is the same shared venue: keep it as is.
      const insertedVenueIds = new Set<string>();
      for (const venue of venues) {
        if (!venue?.id || !venue.name || !isUuid(String(venue.id))) continue;
        const result = await client.query(
          `INSERT INTO venues (
             id, name, category_id,
             address, city, state, country, postal_code,
             latitude, longitude,
             osm_id, swarm_venue_id,
             parent_venue_id, created_by,
             created_at, updated_at
           )
           VALUES (
             $1, $2, $3,
             $4, $5, $6, $7, $8,
             $9, $10,
             $11, $12,
             NULL, $13,
             COALESCE($14::timestamptz, NOW()), COALESCE($15::timestamptz, NOW())
           )
           ON CONFLICT (id) DO NOTHING
           RETURNING id`,
          [
            venue.id,
            venue.name,
            venue.category_id ? (categoryIdMap.get(String(venue.category_id)) ?? null) : null,
            venue.address || null,
            venue.city || null,
            venue.state || null,
            venue.country || null,
            venue.postal_code || null,
            Number(venue.latitude ?? 0),
            Number(venue.longitude ?? 0),
            venue.osm_id || null,
            venue.swarm_venue_id || null,
            user_id,
            venue.created_at || null,
            venue.updated_at || null,
          ]
        );
        if (result.rows.length > 0) insertedVenueIds.add(String(result.rows[0].id));

        // A rating on the venue row (current and older backups alike) is the
        // restoring user's own; an existing rating of theirs is kept.
        const rating = normalizeRating(venue.rating);
        if (rating != null) {
          await client.query(
            `INSERT INTO venue_ratings (user_id, venue_id, rating)
             SELECT $1::uuid, $2::uuid, $3::smallint
             WHERE EXISTS (SELECT 1 FROM venues WHERE id = $2::uuid)
             ON CONFLICT (user_id, venue_id) DO NOTHING`,
            [user_id, venue.id, rating]
          );
        }
      }
      for (const venue of venues) {
        if (!venue.parent_venue_id || venue.parent_venue_id === venue.id) continue;
        // Only venues this restore created get a parent: an existing (shared)
        // venue keeps the hierarchy it has.
        if (!insertedVenueIds.has(String(venue.id)) || !isUuid(String(venue.parent_venue_id))) continue;
        await client.query(
          `UPDATE venues SET parent_venue_id = $2
           WHERE id = $1 AND parent_venue_id IS NULL
             AND EXISTS (SELECT 1 FROM venues WHERE id = $2)`,
          [venue.id, venue.parent_venue_id]
        );
      }

      // 3. Check-ins. An id already taken (by this user: already restored;
      //    by another user: not ours to touch) is skipped. A Swarm id the
      //    user already holds on another check-in is dropped rather than
      //    losing the check-in.
      let inserted = 0;
      for (const row of checkins) {
        if (!row?.id || !row.venue_id || !isUuid(String(row.id)) || !isUuid(String(row.venue_id))) continue;
        const result = await client.query(
          `INSERT INTO checkins (
             id, user_id, venue_id,
             notes, rating,
             checked_in_at, checkin_timezone, created_at, updated_at,
             swarm_id
           )
           SELECT
             $1::uuid, $2::uuid, $3::uuid,
             $4::text, $5::smallint,
             COALESCE($6::timestamptz, NOW()), $7::text,
             COALESCE($8::timestamptz, NOW()),
             COALESCE($9::timestamptz, NOW()),
             CASE WHEN EXISTS (SELECT 1 FROM checkins WHERE swarm_id = $10::varchar AND user_id = $2::uuid) THEN NULL ELSE $10::varchar END
           WHERE EXISTS (SELECT 1 FROM venues WHERE id = $3::uuid)
           ON CONFLICT (id) DO NOTHING`,
          [
            row.id,
            user_id,
            row.venue_id,
            row.notes || null,
            normalizeRating(row.rating),
            row.checked_in_at || null,
            row.checkin_timezone || null,
            row.created_at || null,
            row.updated_at || null,
            row.swarm_id || null,
          ]
        );
        if ((result.rowCount ?? 0) > 0) inserted++;
      }
      // Child rows only ever attach to check-ins this user owns.
      const ownedCheckinIds = await ownedIds('checkins', checkins.map((r) => r?.id));

      // 4. Companions — legacy backups only (old bundles carried
      //    checkinCompanions here; new bundles ship companions.json in the
      //    core bundle, so fresh exports never set this key).
      for (const cc of checkinCompanions) {
        if (!cc?.checkin_id || !cc?.name) continue;
        if (!ownedCheckinIds.has(String(cc.checkin_id))) continue;
        await client.query(
          `INSERT INTO companions (checkin_type, checkin_id, name, user_id)
           VALUES ('location', $1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [cc.checkin_id, String(cc.name), user_id]
        );
      }

      // 5. Venue lists (payload ids are preserved by the insert, so list-item
      //    references use them directly). An id or name already taken is
      //    skipped; items only go into lists this user owns.
      for (const list of venueLists) {
        if (!list?.id || !list?.name || !isUuid(String(list.id))) continue;
        await client.query(
          `INSERT INTO venue_lists (id, user_id, name, created_at, updated_at)
           VALUES ($1, $2, $3, COALESCE($4::timestamptz, NOW()), COALESCE($5::timestamptz, NOW()))
           ON CONFLICT DO NOTHING`,
          [list.id, user_id, list.name, list.created_at || null, list.updated_at || null]
        );
      }
      const ownedVenueListIds = await ownedIds('venue_lists', venueListItems.map((li) => li?.list_id));
      for (const li of venueListItems) {
        if (!li?.list_id || !li?.venue_id || !isUuid(String(li.venue_id))) continue;
        if (!ownedVenueListIds.has(String(li.list_id))) continue;
        await client.query(
          `INSERT INTO venue_list_items (list_id, venue_id, position, rank, added_at)
           SELECT $1::uuid, $2::uuid, COALESCE($3::int, 0), $4::int, COALESCE($5::timestamptz, NOW())
           WHERE EXISTS (SELECT 1 FROM venues WHERE id = $2::uuid)
           ON CONFLICT DO NOTHING`,
          [li.list_id, li.venue_id, li.position ?? 0, li.rank ?? null, li.added_at || null]
        );
      }

      // 6. Checkin lists (after check-ins, since items reference them).
      for (const list of checkinLists) {
        if (!list?.id || !list?.name || !isUuid(String(list.id))) continue;
        await client.query(
          `INSERT INTO checkin_lists (id, user_id, name, created_at, updated_at)
           VALUES ($1, $2, $3, COALESCE($4::timestamptz, NOW()), COALESCE($5::timestamptz, NOW()))
           ON CONFLICT DO NOTHING`,
          [list.id, user_id, list.name, list.created_at || null, list.updated_at || null]
        );
      }
      const ownedCheckinListIds = await ownedIds('checkin_lists', checkinListItems.map((li) => li?.list_id));
      for (const li of checkinListItems) {
        if (!li?.list_id || !li?.checkin_id) continue;
        if (!ownedCheckinListIds.has(String(li.list_id))) continue;
        if (!ownedCheckinIds.has(String(li.checkin_id))) continue;
        const rank =
          typeof li.rank === 'number' && Number.isInteger(li.rank) && li.rank >= 1 ? li.rank : null;
        // A re-run of the same restore must be idempotent even when the
        // local row already carries a (different) rank.
        await client.query(
          // A rank already held by another item in this list (non-deferrable
          // unique index) would abort the whole restore: import it unranked.
          `INSERT INTO checkin_list_items (list_id, checkin_id, rank, added_at)
           VALUES ($1, $2,
             CASE WHEN EXISTS (
               SELECT 1 FROM checkin_list_items WHERE list_id = $1 AND rank = $3::int AND checkin_id <> $2
             ) THEN NULL ELSE $3::int END,
             COALESCE($4::timestamptz, NOW()))
           ON CONFLICT (list_id, checkin_id) DO UPDATE SET
             rank = COALESCE(EXCLUDED.rank, checkin_list_items.rank)`,
          [li.list_id, li.checkin_id, rank, li.added_at || null]
        );
      }

      return inserted;
    } finally {
      if (ownsClient) client.release();
    }
  },

  /**
   * Legacy backup restore (backups without a `plugins.location` payload keep
   * location rows under the top-level checkins / venues / venueCategories
   * keys). Normalizes the raw rows into the backupImport shape and reuses it.
   */
  restoreLegacyBackup: async (ctx, data) => {
    const asArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
    const payload = {
      checkins: asArray<Record<string, unknown>>(data.checkins),
      venues: asArray<Record<string, unknown>>(data.venues),
      venueCategories: asArray<Record<string, unknown>>(data.venueCategories),
      checkinCompanions: asArray<Record<string, unknown>>(data.checkinCompanions),
      venueLists: asArray<Record<string, unknown>>(data.venueLists),
      venueListItems: asArray<Record<string, unknown>>(data.venueListItems),
    };

    // backupImport handles the full FK-ordered insert and returns the number
    // of check-ins inserted; legacy counts are reported per top-level key.
    const insertedCheckins = await backupHooks.backupImport(ctx, payload);

    const categoryCount = asArray<Record<string, unknown>>(data.venueCategories).length;
    const venueCount = asArray<Record<string, unknown>>(data.venues).length;
    const checkinCount = asArray<Record<string, unknown>>(data.checkins).length;

    return {
      venueCategories: { inserted: categoryCount, skipped: 0 },
      venues: { inserted: venueCount, skipped: 0 },
      checkins: { inserted: insertedCheckins, skipped: Math.max(0, checkinCount - insertedCheckins) },
    };
  },

  /**
   * Start-over: delete the user's location check-ins. Venues and
   * venue_categories are shared reference data and are kept.
   */
  deleteUserData: async ({ user_id, client: txClient }) => {
    const client = txClient ?? null;
    const run = (sql: string, values: unknown[]) =>
      client ? client.query(sql, values) : query(sql, values);

    // Companions (shared core table) are removed explicitly for clarity.
    await run(
      `DELETE FROM companions
       WHERE checkin_type = 'location'
         AND checkin_id IN (SELECT id FROM checkins WHERE user_id = $1)`,
      [user_id]
    );

    const result = await run(
      'DELETE FROM checkins WHERE user_id = $1 RETURNING id',
      [user_id]
    );

    // The user's venue lists (memberships cascade). Venues themselves are
    // shared reference data and are kept.
    await run('DELETE FROM venue_lists WHERE user_id = $1', [user_id]);

    // The user's checkin lists. Items that belonged to the deleted check-ins
    // already cascaded above; deleting the lists cascades any remainder.
    await run('DELETE FROM checkin_lists WHERE user_id = $1', [user_id]);

    // Weather is derived from the check-ins that were just deleted.
    await run('DELETE FROM daily_weather WHERE user_id = $1', [user_id]);

    // The user's Coasterpedia lookups (the venues they describe are kept).
    await run('DELETE FROM venue_coasterpedia WHERE user_id = $1', [user_id]);

    // Background patterns drawn from those check-ins.
    await clearPlacePatterns(user_id);

    return result.rowCount ?? 0;
  },

  /**
   * Start-over "all venue data": everything location-related the user owns,
   * including their venue ratings.
   * The start-over route only invokes this after the user's location
   * check-ins have been deleted (the all-data option always implies the
   * check-in deletion). Venues, venue_categories and merge suggestions are a
   * catalog shared by every user and are never deleted here.
   */
  deleteAllData: async ({ user_id, client: txClient }) => {
    const client = txClient ?? null;
    const run = (sql: string, values: unknown[]) =>
      client ? client.query(sql, values) : query(sql, values);

    let deleted = 0;
    for (const sql of [
      'DELETE FROM venue_list_items WHERE list_id IN (SELECT id FROM venue_lists WHERE user_id = $1)',
      'DELETE FROM venue_lists WHERE user_id = $1',
      'DELETE FROM checkin_lists WHERE user_id = $1',
      'DELETE FROM venue_coasterpedia WHERE user_id = $1',
      'DELETE FROM venue_ratings WHERE user_id = $1',
      'DELETE FROM daily_weather WHERE user_id = $1',
    ]) {
      const result = await run(sql, [user_id]);
      deleted += result.rowCount ?? 0;
    }

    return deleted;
  },

  // Weather is derived from check-ins but costs API calls to rebuild, so it
  // ships in backups. The insert runs with user_id first and the select
  // lists columns in the same order.
  extraBackupTables: [
    {
      table: 'daily_weather',
      select: `SELECT TO_CHAR(local_date, 'YYYY-MM-DD') AS local_date, status, latitude, longitude,
                      timezone, data, error, fetched_at
                 FROM daily_weather WHERE user_id = $1 ORDER BY local_date`,
      insert: `INSERT INTO daily_weather (user_id, local_date, status, latitude, longitude, timezone, data, error, fetched_at)
               VALUES ($1, $2::date, $3, $4, $5, $6, $7::jsonb, $8, $9)
               ON CONFLICT (user_id, local_date) DO NOTHING`,
      userIdFirst: true,
    },
  ],
};
