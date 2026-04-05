import { Router, Request, Response } from 'express';
import { query } from '../db';

const router = Router();

const USER_ID = '00000000-0000-0000-0000-000000000001';

// GET /groups - list all activity groups with nested activities
router.get('/groups', async (_req: Request, res: Response) => {
  try {
    const groupsResult = await query(
      `SELECT g.id, g.name, g.display_order,
              COALESCE(
                (SELECT json_agg(json_build_object(
                  'id', a.id,
                  'name', a.name,
                  'group_id', a.group_id,
                  'display_order', a.display_order,
                  'icon', a.icon,
                  'mood_checkin_count', (
                    SELECT COUNT(*)::int
                    FROM mood_checkin_activities mca
                    JOIN mood_checkins mc ON mc.id = mca.mood_checkin_id
                    WHERE mca.activity_id = a.id AND mc.user_id = $1
                  )
                ) ORDER BY a.display_order)
                FROM mood_activities a WHERE a.group_id = g.id),
                '[]'::json
              ) AS activities
       FROM mood_activity_groups g
       WHERE g.user_id = $1
       ORDER BY g.display_order`,
      [USER_ID]
    );

    res.json(groupsResult.rows);
  } catch (err) {
    console.error('Error listing activity groups:', err);
    res.status(500).json({ error: 'Failed to list activity groups' });
  }
});

// POST /groups - create activity group
router.post('/groups', async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const maxOrder = await query(
      'SELECT COALESCE(MAX(display_order), -1) + 1 AS next_order FROM mood_activity_groups WHERE user_id = $1',
      [USER_ID]
    );

    const result = await query(
      `INSERT INTO mood_activity_groups (user_id, name, display_order)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [USER_ID, name, maxOrder.rows[0].next_order]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating activity group:', err);
    res.status(500).json({ error: 'Failed to create activity group' });
  }
});

// PUT /groups/:id - update activity group
router.put('/groups/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, display_order } = req.body;

    const result = await query(
      `UPDATE mood_activity_groups
       SET name = COALESCE($2, name),
           display_order = COALESCE($3, display_order)
       WHERE id = $1 AND user_id = $4
       RETURNING *`,
      [id, name ?? null, display_order ?? null, USER_ID]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Activity group not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating activity group:', err);
    res.status(500).json({ error: 'Failed to update activity group' });
  }
});

// DELETE /groups/:id - delete activity group
router.delete('/groups/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM mood_activity_groups WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, USER_ID]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Activity group not found' });
    }

    res.json({ message: 'Activity group deleted', id });
  } catch (err) {
    console.error('Error deleting activity group:', err);
    res.status(500).json({ error: 'Failed to delete activity group' });
  }
});

// POST /activities - create activity
router.post('/activities', async (req: Request, res: Response) => {
  try {
    const { group_id, name, icon } = req.body;
    if (!group_id || !name) {
      return res.status(400).json({ error: 'group_id and name are required' });
    }

    const maxOrder = await query(
      'SELECT COALESCE(MAX(display_order), -1) + 1 AS next_order FROM mood_activities WHERE group_id = $1',
      [group_id]
    );

    const result = await query(
      `INSERT INTO mood_activities (group_id, name, display_order, icon)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [group_id, name, maxOrder.rows[0].next_order, icon || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating activity:', err);
    res.status(500).json({ error: 'Failed to create activity' });
  }
});

// PUT /activities/reorder - reorder activities in a group with one request
router.put('/activities/reorder', async (req: Request, res: Response) => {
  try {
    const { group_id, activity_ids } = req.body as {
      group_id?: string;
      activity_ids?: string[];
    };

    if (!group_id || !Array.isArray(activity_ids) || activity_ids.length === 0) {
      return res.status(400).json({ error: 'group_id and non-empty activity_ids are required' });
    }

    const existingActivities = await query(
      `SELECT id
       FROM mood_activities
       WHERE group_id = $1`,
      [group_id]
    );

    const existingIds = existingActivities.rows.map((row) => String(row.id));
    if (existingIds.length !== activity_ids.length) {
      return res.status(400).json({ error: 'activity_ids must include all activities in the group exactly once' });
    }

    const uniqueIncomingIds = new Set(activity_ids);
    if (uniqueIncomingIds.size !== activity_ids.length) {
      return res.status(400).json({ error: 'activity_ids contains duplicates' });
    }

    const existingIdSet = new Set(existingIds);
    const hasUnknownIds = activity_ids.some((id) => !existingIdSet.has(id));
    if (hasUnknownIds) {
      return res.status(400).json({ error: 'activity_ids contains IDs not in this group' });
    }

    const result = await query(
      `UPDATE mood_activities AS a
       SET display_order = ordered.display_order
       FROM (
         SELECT id, (ordinality - 1)::int AS display_order
         FROM unnest($1::uuid[]) WITH ORDINALITY AS t(id, ordinality)
       ) AS ordered
       WHERE a.id = ordered.id
         AND a.group_id = $2
       RETURNING a.*`,
      [activity_ids, group_id]
    );

    if (result.rows.length !== activity_ids.length) {
      return res.status(400).json({ error: 'Failed to reorder all activities in group' });
    }

    res.json({ message: 'Activities reordered', count: result.rows.length });
  } catch (err) {
    console.error('Error reordering activities:', err);
    res.status(500).json({ error: 'Failed to reorder activities' });
  }
});

// PUT /activities/:id - update activity
router.put('/activities/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, group_id, display_order, icon } = req.body;

    const result = await query(
      `UPDATE mood_activities
       SET name = COALESCE($2, name),
           group_id = COALESCE($3, group_id),
           display_order = COALESCE($4, display_order),
           icon = CASE WHEN $5::varchar IS NOT NULL THEN $5 ELSE icon END
       WHERE id = $1
       RETURNING *`,
      [id, name ?? null, group_id ?? null, display_order ?? null, icon ?? null]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Activity not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating activity:', err);
    res.status(500).json({ error: 'Failed to update activity' });
  }
});

// DELETE /activities/:id - delete activity
router.delete('/activities/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM mood_activities WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Activity not found' });
    }

    res.json({ message: 'Activity deleted', id });
  } catch (err) {
    console.error('Error deleting activity:', err);
    res.status(500).json({ error: 'Failed to delete activity' });
  }
});

export const moodActivitiesRouter = router;
