import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

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

export const config = {
  port: 3001,
  databaseUrl: process.env.DATABASE_URL || 'postgres://wherewewere:wherewewere@localhost:5432/wherewewere',
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret',
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigins: parseCorsOrigins(process.env.CORS_ORIGINS),
  trustProxy: parseBoolean(process.env.TRUST_PROXY, false),
  // Photon geocoder used for reverse geocoding / place search. Venue
  // coordinates are sent to this host, so self-hosters should point it at their
  // own instance (or a public one such as https://photon.komoot.io).
  photonUrl: (process.env.PHOTON_URL || 'https://photon.home.zachfox.io').replace(/\/+$/, ''),
  // Web Push (notifications). Leave the keys unset to have the server
  // generate a pair once and keep it in the database. Set them only to pin a
  // specific pair; changing keys invalidates every device's subscription.
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY || '',
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY || '',
  // Contact URL push services may use about this sender (mailto: or https:).
  vapidSubject: process.env.VAPID_SUBJECT || 'mailto:notifications@wherewewere.invalid',
  dataDir: process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(process.cwd(), 'data'),
};
