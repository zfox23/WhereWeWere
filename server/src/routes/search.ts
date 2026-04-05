import { Router, Request, Response } from 'express';
import { query } from '../db';

const router = Router();

// GET /?q=&type=&limit=&offset= - unified search
router.get('/', async (req: Request, res: Response) => {
  try {
    const { q, type = 'all', limit = '20', offset = '0' } = req.query;

    if (!q || (typeof q === 'string' && q.trim().length === 0)) {
      return res.status(400).json({ error: 'q (search query) is required' });
    }

    const searchQuery = q as string;
    const limitNum = parseInt(limit as string, 10);
    const offsetNum = parseInt(offset as string, 10);

    const searchType = type as string;

    if (!['all', 'venues', 'checkins'].includes(searchType)) {
      return res.status(400).json({ error: 'type must be "all", "venues", or "checkins"' });
    }

    const result: { venues?: unknown[]; checkins?: unknown[] } = {};

    if (searchType === 'venues' || searchType === 'all') {
      const venuesResult = await query(
        `SELECT v.id, v.name, v.address, v.city, v.state, v.country,
                v.latitude, v.longitude, v.osm_id, v.created_at,
                vc.name AS category_name, vc.icon AS category_icon,
                ts_rank(v.search_vector, plainto_tsquery('english', $1)) AS rank
         FROM venues v
         LEFT JOIN venue_categories vc ON v.category_id = vc.id
         WHERE v.search_vector @@ plainto_tsquery('english', $1)
         ORDER BY rank DESC
         LIMIT $2 OFFSET $3`,
        [searchQuery, limitNum, offsetNum]
      );
      result.venues = venuesResult.rows;
    }

    if (searchType === 'checkins' || searchType === 'all') {
      const checkinsResult = await query(
        `SELECT c.id, c.user_id, c.notes, c.checked_in_at, c.created_at,
                v.id AS venue_id, v.name AS venue_name,
                vc.name AS venue_category,
                pv.id AS parent_venue_id, pv.name AS parent_venue_name,
                ts_rank(
                  c.search_vector || COALESCE(v.search_vector, ''::tsvector) || COALESCE(pv.search_vector, ''::tsvector),
                  plainto_tsquery('english', $1)
                ) AS rank
         FROM checkins c
         JOIN venues v ON c.venue_id = v.id
         LEFT JOIN venue_categories vc ON v.category_id = vc.id
         LEFT JOIN venues pv ON v.parent_venue_id = pv.id
         WHERE c.search_vector @@ plainto_tsquery('english', $1)
            OR v.search_vector @@ plainto_tsquery('english', $1)
            OR pv.search_vector @@ plainto_tsquery('english', $1)
         ORDER BY rank DESC
         LIMIT $2 OFFSET $3`,
        [searchQuery, limitNum, offsetNum]
      );
      result.checkins = checkinsResult.rows;
    }

    // If searching a specific type, return the array directly
    if (searchType === 'venues') {
      return res.json(result.venues);
    }

    if (searchType === 'checkins') {
      return res.json(result.checkins);
    }

    // type=all returns both
    res.json(result);
  } catch (err) {
    console.error('Error searching:', err);
    res.status(500).json({ error: 'Failed to search' });
  }
});

export const searchRouter = router;
