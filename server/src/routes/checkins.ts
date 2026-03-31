import { Router, Request, Response } from 'express';
import { query } from '../db';

const router = Router();

// GET / - list check-ins with venue info
router.get('/', async (req: Request, res: Response) => {
  try {
    const {
      user_id, venue_id, from, to,
      limit = '50', offset = '0',
    } = req.query;

    const params: unknown[] = [];
    const conditions: string[] = [];
    let paramIndex = 1;

    if (user_id) {
      conditions.push(`c.user_id = $${paramIndex}`);
      params.push(user_id);
      paramIndex++;
    }

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

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(parseInt(limit as string, 10));
    const limitParam = `$${paramIndex}`;
    paramIndex++;

    params.push(parseInt(offset as string, 10));
    const offsetParam = `$${paramIndex}`;

    const sql = `
      SELECT c.id, c.user_id, c.venue_id, c.notes, c.rating,
             c.checked_in_at, c.created_at, c.updated_at,
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
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing check-ins:', err);
    res.status(500).json({ error: 'Failed to list check-ins' });
  }
});

// GET /:id - get single check-in with venue details
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const checkinResult = await query(
      `SELECT c.id, c.user_id, c.venue_id, c.notes, c.rating,
              c.checked_in_at, c.created_at, c.updated_at,
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
       WHERE c.id = $1`,
      [id]
    );

    if (checkinResult.rows.length === 0) {
      return res.status(404).json({ error: 'Check-in not found' });
    }

    res.json(checkinResult.rows[0]);
  } catch (err) {
    console.error('Error getting check-in:', err);
    res.status(500).json({ error: 'Failed to get check-in' });
  }
});

// POST / - create check-in
router.post('/', async (req: Request, res: Response) => {
  try {
    const { user_id, venue_id, notes, rating, checked_in_at, also_checkin_parent } = req.body;

    if (!user_id || !venue_id) {
      return res.status(400).json({ error: 'user_id and venue_id are required' });
    }

    if (rating !== undefined && rating !== null) {
      const ratingNum = parseInt(rating, 10);
      if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
        return res.status(400).json({ error: 'rating must be between 1 and 5' });
      }
    }

    const result = await query(
      `INSERT INTO checkins (user_id, venue_id, notes, rating, checked_in_at)
       VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, NOW()))
       RETURNING *`,
      [user_id, venue_id, notes || null, rating || null, checked_in_at || null]
    );

    const checkin = result.rows[0];

    // Optionally create a check-in at the parent venue too
    let parent_checkin = null;
    if (also_checkin_parent) {
      const venueResult = await query(
        'SELECT parent_venue_id FROM venues WHERE id = $1',
        [venue_id]
      );
      const parentVenueId = venueResult.rows[0]?.parent_venue_id;
      if (parentVenueId) {
        const parentResult = await query(
          `INSERT INTO checkins (user_id, venue_id, notes, checked_in_at)
           VALUES ($1, $2, $3, COALESCE($4::timestamptz, NOW()))
           RETURNING *`,
          [user_id, parentVenueId, notes || null, checked_in_at || null]
        );
        parent_checkin = parentResult.rows[0];
      }
    }

    res.status(201).json({ ...checkin, parent_checkin });
  } catch (err) {
    console.error('Error creating check-in:', err);
    res.status(500).json({ error: 'Failed to create check-in' });
  }
});

// PUT /:id - update check-in
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { notes, rating, checked_in_at } = req.body;

    if (rating !== undefined && rating !== null) {
      const ratingNum = parseInt(rating, 10);
      if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
        return res.status(400).json({ error: 'rating must be between 1 and 5' });
      }
    }

    const result = await query(
      `UPDATE checkins
       SET notes = COALESCE($2, notes),
           rating = COALESCE($3, rating),
           checked_in_at = COALESCE($4::timestamptz, checked_in_at),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, notes, rating, checked_in_at || null]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Check-in not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating check-in:', err);
    res.status(500).json({ error: 'Failed to update check-in' });
  }
});

// DELETE /:id - delete check-in
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM checkins WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Check-in not found' });
    }

    res.json({ message: 'Check-in deleted', id });
  } catch (err) {
    console.error('Error deleting check-in:', err);
    res.status(500).json({ error: 'Failed to delete check-in' });
  }
});

export const checkinsRouter = router;
