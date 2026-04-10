import dotenv from 'dotenv';
import path from 'path';
import * as webpush from 'web-push';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

let vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
let vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

function parseCorsOrigins(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (typeof value === 'undefined') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

// Generate VAPID keys if not provided (development only)
if (!vapidPublicKey || !vapidPrivateKey) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY environment variables are required in production');
  }
  console.warn('Generating development VAPID keys. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY environment variables to use custom keys.');
  const { publicKey, privateKey } = webpush.generateVAPIDKeys();
  vapidPublicKey = publicKey;
  vapidPrivateKey = privateKey;
}

export const config = {
  port: 3001,
  databaseUrl: process.env.DATABASE_URL || 'postgres://wherewewere:wherewewere@localhost:5432/wherewewere',
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret',
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigins: parseCorsOrigins(process.env.CORS_ORIGINS),
  apiAccessToken: process.env.API_ACCESS_TOKEN || '',
  trustProxy: parseBoolean(process.env.TRUST_PROXY, false),
  vapidPublicKey,
  vapidPrivateKey,
};
