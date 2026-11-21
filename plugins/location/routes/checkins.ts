/**
 * /location-checkins — location check-in CRUD, plus the check-in lists
 * (/lists/*) and stats (/stats/*) sub-routers.
 */

import { Router, Request, Response } from 'express';
import { checkinLocalDate, scheduleWeatherForDate } from '../services/weatherEnrich';
import { query, pool } from '../../../server/src/db';
import { normalizeCompanions, getCompanions, insertCompanions, setCompanions, deleteCompanionsForCheckins, companionNamesSql } from '../../../server/src/services/companions';
import { currentUserId } from '../../../server/src/auth/context';
import { addTimezone, inferVenueTimezone, normalizeRating } from './helpers';
import { attachCheckinLists, checkinListsRouter, getCheckinListIds, normalizeListIds } from './checkinLists';
import { statsRouter } from './stats';

export const checkinsRouter = Router();

// The 1-segment /lists routes must be registered before /:id.
checkinsRouter.use(checkinListsRouter);

// GET / - list check-ins with venue info
checkinsRouter.get('/', async (req: Request, res: Response) => {
  try {
    // A client-supplied user_id is ignored: the list is always the caller's.
    const {
      venue_id, from, to,
      limit = '50', offset = '0',
    } = req.query;

    const params: unknown[] = [currentUserId()];
    const conditions: string[] = ['c.user_id = $1'];
    let paramIndex = 2;

    if (venue_id) {
      conditions.push(`c.venue_id = $${paramIndex}`);
      params.push(venue_id);
      paramIndex++;
    }

    if (from) {
      conditions.push(`c.checked_in_at >= $${paramIndex}`);
      params.push(from);
      paramIndex++;
    }

    if (to) {
      conditions.push(`c.checked_in_at <= $${paramIndex}`);
      params.push(to);
      paramIndex++;
    }

    if (req.query.category) {
      conditions.push(`vc.name = $${paramIndex}`);
      params.push(req.query.category);
      paramIndex++;
    }

    if (req.query.country) {
      conditions.push(`v.country = $${paramIndex}`);
      params.push(req.query.country);
      paramIndex++;
    }

    if (req.query.q) {
      const searchQuery = req.query.q as string;
      conditions.push(
        `(c.search_vector @@ plainto_tsquery('english', $${paramIndex})
         OR v.search_vector @@ plainto_tsquery('english', $${paramIndex}))`
      );
      params.push(searchQuery);
      paramIndex++;
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    // Clamp: NaN/negative values would 500 in Postgres, and no cap loads everything.
    params.push(Math.min(Math.max(parseInt(limit as string, 10) || 50, 1), 500));
    const limitParam = `$${paramIndex}`;
    paramIndex++;

    params.push(Math.max(parseInt(offset as string, 10) || 0, 0));
    const offsetParam = `$${paramIndex}`;

    const sql = `
      SELECT c.id, c.user_id, c.venue_id, c.notes, c.rating,
              (${companionNamesSql('location', 'c.id')}) AS companions,
              c.checked_in_at, c.checkin_timezone AS venue_timezone, c.created_at, c.updated_at,
              v.name AS venue_name, v.latitude AS venue_latitude, v.longitude AS venue_longitude,
              vc.name AS venue_category,
              pv.id AS parent_venue_id, pv.name AS parent_venue_name
      FROM checkins c
      JOIN venues v ON c.venue_id = v.id
      LEFT JOIN venue_categories vc ON v.category_id = vc.id
      LEFT JOIN venues pv ON v.parent_venue_id = pv.id
      ${whereClause}
      ORDER BY c.checked_in_at DESC
      LIMIT ${limitParam} OFFSET ${offsetParam}
    `;

    const result = await query(sql, params);
    res.json(result.rows.map((row) => ({
      ...addTimezone(row),
      companions: Array.isArray(row.companions) ? row.companions : [],
    })));
  } catch (err) {
    console.error('Error listing check-ins:', err);
    res.status(500).json({ error: 'Failed to list check-ins' });
  }
});

// GET /:id - get single check-in with venue details
checkinsRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const checkinResult = await query(
      `SELECT c.id, c.user_id, c.venue_id, c.notes, c.rating,
              c.checked_in_at, c.checkin_timezone AS venue_timezone, c.created_at, c.updated_at,
              v.name AS venue_name, v.address AS venue_address,
              v.city AS venue_city, v.state AS venue_state,
              v.country AS venue_country, v.latitude AS venue_latitude,
              v.longitude AS venue_longitude,
              vc.name AS venue_category, vc.icon AS venue_category_icon,
              pv.id AS parent_venue_id, pv.name AS parent_venue_name
       FROM checkins c
       JOIN venues v ON c.venue_id = v.id
       LEFT JOIN venue_categories vc ON v.category_id = vc.id
       LEFT JOIN venues pv ON v.parent_venue_id = pv.id
       WHERE c.id = $1 AND c.user_id = $2`,
      [id, currentUserId()]
    );

    if (checkinResult.rows.length === 0) {
      return res.status(404).json({ error: 'Check-in not found' });
    }

    res.json({
      ...addTimezone(checkinResult.rows[0]),
      companions: await getCompanions('location', String(id)),
      lists: await getCheckinListIds(String(id)),
    });
  } catch (err) {
    console.error('Error getting check-in:', err);
    res.status(500).json({ error: 'Failed to get check-in' });
  }
});

// POST / - create check-in
checkinsRouter.post('/', async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    // Ownership comes from the session; a user_id in the body is ignored.
    const userId = currentUserId();
    const { venue_id, notes, checked_in_at, also_checkin_parent, rating } = req.body;
    const companions = normalizeCompanions(req.body.companions);
    const checkinRating = normalizeRating(rating);
    const hasListIds = 'list_ids' in req.body;
    const listIds = hasListIds ? normalizeListIds(req.body.list_ids) ?? [] : null;

    if (!venue_id) {
      return res.status(400).json({ error: 'venue_id is required' });
    }

    await client.query('BEGIN');

    const checkinTimezone = await inferVenueTimezone(venue_id, client);

    const result = await client.query(
      `INSERT INTO checkins (user_id, venue_id, notes, checked_in_at, checkin_timezone, rating)
       VALUES ($1, $2, $3, COALESCE($4::timestamptz, NOW()), $5, $6)
       RETURNING *`,
      [userId, venue_id, notes || null, checked_in_at || null, checkinTimezone, checkinRating]
    );

    const checkin = result.rows[0];

    // Companions for the primary check-in
    if (companions.length > 0) {
      await insertCompanions('location', checkin.id, companions, client);
    }

    // Optionally create a check-in at the parent venue too
    let parent_checkin = null;
    if (also_checkin_parent) {
      const venueResult = await client.query(
        'SELECT parent_venue_id FROM venues WHERE id = $1',
        [venue_id]
      );
      const parentVenueId = venueResult.rows[0]?.parent_venue_id;
      if (parentVenueId) {
        const parentResult = await client.query(
          `INSERT INTO checkins (user_id, venue_id, notes, checked_in_at, checkin_timezone, rating)
           VALUES ($1, $2, $3, COALESCE($4::timestamptz, NOW()), $5, $6)
           RETURNING *`,
          [userId, parentVenueId, notes || null, checked_in_at || null, await inferVenueTimezone(parentVenueId, client), checkinRating]
        );
        parent_checkin = parentResult.rows[0];
      }
    }

    // List memberships (optional) attach within the same transaction.
    let lists: string[] = [];
    if (listIds) {
      lists = await attachCheckinLists(checkin.id, listIds, client);
    }

    await client.query('COMMIT');
    res.status(201).json({ ...checkin, parent_checkin, companions, lists });
    // After the response: fetch that day's weather when enabled (non-fatal).
    checkinLocalDate(checkin.id)
      .then((date) => scheduleWeatherForDate(userId, date))
      .catch((err) => console.error('Weather scheduling failed (non-fatal):', err));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error creating check-in:', err);
    res.status(500).json({ error: 'Failed to create check-in' });
  } finally {
    client.release();
  }
});

// PUT /:id - update check-in
checkinsRouter.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { notes, checked_in_at } = req.body;
  const hasRating = 'rating' in req.body;
  const hasCompanions = 'companions' in req.body;
  const hasListIds = 'list_ids' in req.body;
  const listIds = hasListIds ? normalizeListIds(req.body.list_ids) ?? [] : null;
  const userId = currentUserId();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Build the SET clause. checked_in_at keeps its historical "null means no
    // change" behavior; notes and rating use explicit key presence so the
    // client can clear them (null / blank).
    const setClauses: string[] = [];
    const params: unknown[] = [id, userId];
    let paramIndex = 2;

    if (notes !== undefined) {
      setClauses.push(`notes = $${++paramIndex}`);
      params.push(typeof notes === 'string' && notes.trim() ? notes : null);
    }
    if (checked_in_at !== undefined) {
      setClauses.push(`checked_in_at = COALESCE($${++paramIndex}::timestamptz, checked_in_at)`);
      params.push(checked_in_at);
    }
    if (hasRating) {
      setClauses.push(`rating = $${++paramIndex}`);
      params.push(normalizeRating(req.body.rating));
    }
    setClauses.push('updated_at = NOW()');

    const result = await client.query(
      `UPDATE checkins
       SET ${setClauses.join(', ')}
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Check-in not found' });
    }

    // Companions use full-replacement semantics when the key is present.
    let companions: string[];
    if (hasCompanions) {
      companions = await setCompanions('location', String(id), req.body.companions, client);
    } else {
      companions = await getCompanions('location', String(id), client);
    }

    // Checkin lists use full-replacement semantics when the key is present.
    let lists: string[];
    if (listIds) {
      lists = await attachCheckinLists(String(id), listIds, client);
    } else {
      lists = await getCheckinListIds(String(id), client);
    }

    await client.query('COMMIT');
    res.json({ ...result.rows[0], companions, lists });
    checkinLocalDate(String(id))
      .then((date) => scheduleWeatherForDate(userId, date))
      .catch((err) => console.error('Weather scheduling failed (non-fatal):', err));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error updating check-in:', err);
    res.status(500).json({ error: 'Failed to update check-in' });
  } finally {
    client.release();
  }
});

// DELETE /:id - delete check-in
checkinsRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM checkins WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, currentUserId()]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Check-in not found' });
    }

    // The shared companion table has no FK into checkins; clean up explicitly.
    await deleteCompanionsForCheckins('location', [String(id)]);

    res.json({ message: 'Check-in deleted', id });
  } catch (err) {
    console.error('Error deleting check-in:', err);
    res.status(500).json({ error: 'Failed to delete check-in' });
  }
});

checkinsRouter.use('/stats', statsRouter);
