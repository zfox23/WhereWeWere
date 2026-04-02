import { Router, Request, Response } from 'express';
import { query } from '../db';
import { config } from '../config';
import * as webpush from 'web-push';

const router = Router();
const USER_ID = '00000000-0000-0000-0000-000000000001';

// Configure web-push with VAPID details
webpush.setVapidDetails(
  'mailto:noreply@wherewewere.example.com',
  config.vapidPublicKey,
  config.vapidPrivateKey
);

// GET /vapid-public-key - Return public key for client subscription
router.get('/vapid-public-key', (_req: Request, res: Response) => {
  res.json({ publicKey: config.vapidPublicKey });
});

// POST /subscribe - Store new push subscription
router.post('/subscribe', async (req: Request, res: Response) => {
  try {
    const { subscription } = req.body;

    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ error: 'Invalid subscription object' });
    }

    const result = await query(
      `INSERT INTO push_subscriptions (user_id, subscription_json, is_active)
       VALUES ($1, $2, true)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [USER_ID, JSON.stringify(subscription)]
    );

    res.status(201).json({ success: true, id: result.rows[0]?.id });
  } catch (err) {
    console.error('Error subscribing to push notifications:', err);
    res.status(500).json({ error: 'Failed to subscribe to push notifications' });
  }
});

// POST /unsubscribe - Remove push subscription
router.post('/unsubscribe', async (req: Request, res: Response) => {
  try {
    const { endpoint } = req.body;

    if (!endpoint) {
      return res.status(400).json({ error: 'Endpoint is required' });
    }

    await query(
      `UPDATE push_subscriptions
       SET is_active = false, updated_at = NOW()
       WHERE user_id = $1 AND subscription_json->>'endpoint' = $2`,
      [USER_ID, endpoint]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Error unsubscribing from push notifications:', err);
    res.status(500).json({ error: 'Failed to unsubscribe from push notifications' });
  }
});

// GET / - List active subscriptions for user
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT id, subscription_json, created_at
       FROM push_subscriptions
       WHERE user_id = $1 AND is_active = true
       ORDER BY created_at DESC`,
      [USER_ID]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error listing push subscriptions:', err);
    res.status(500).json({ error: 'Failed to list subscriptions' });
  }
});

export const pushRouter = router;

export { webpush };
