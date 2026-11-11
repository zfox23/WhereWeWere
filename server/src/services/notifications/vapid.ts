/**
 * VAPID key pair for Web Push.
 *
 * Env vars (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY) win when both are set.
 * Otherwise the server generates a pair the first time it is needed and keeps
 * it in `server_secrets`, so it survives restarts and redeploys without any
 * configuration. The pair must stay stable: push subscriptions are bound to
 * the public key, and a new key orphans every subscribed device.
 */

import webpush from 'web-push';
import { query } from '../../db';
import { config } from '../../config';

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

const SECRET_KEY = 'vapid';

let cached: Promise<VapidKeys> | null = null;

function isKeyPair(value: unknown): value is VapidKeys {
  const v = value as Partial<VapidKeys> | null;
  return !!v && typeof v.publicKey === 'string' && typeof v.privateKey === 'string' && !!v.publicKey && !!v.privateKey;
}

async function load(): Promise<VapidKeys> {
  if (config.vapidPublicKey && config.vapidPrivateKey) {
    return { publicKey: config.vapidPublicKey, privateKey: config.vapidPrivateKey };
  }
  const existing = await query('SELECT value FROM server_secrets WHERE key = $1', [SECRET_KEY]);
  if (isKeyPair(existing.rows[0]?.value)) return existing.rows[0].value;

  // First use: generate and store. ON CONFLICT keeps whichever process won a
  // simultaneous first start, and everyone re-reads the stored pair.
  const generated = webpush.generateVAPIDKeys();
  await query(
    `INSERT INTO server_secrets (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO NOTHING`,
    [SECRET_KEY, JSON.stringify({ publicKey: generated.publicKey, privateKey: generated.privateKey })],
  );
  const stored = await query('SELECT value FROM server_secrets WHERE key = $1', [SECRET_KEY]);
  if (!isKeyPair(stored.rows[0]?.value)) throw new Error('Could not load VAPID keys');
  return stored.rows[0].value;
}

/** The instance's VAPID key pair (cached after the first successful load). */
export function getVapidKeys(): Promise<VapidKeys> {
  if (!cached) {
    cached = load().catch((err) => {
      cached = null;
      throw err;
    });
  }
  return cached;
}

/** Test hook: forget the cached pair. */
export function resetVapidKeysCache(): void {
  cached = null;
}
