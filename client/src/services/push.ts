/**
 * This device's Web Push subscription.
 *
 * Notifications are opt-in per device: turning them on asks the browser for
 * permission (only ever from a user's click), subscribes through the service
 * worker, and registers the subscription with the server. Everything is sent
 * by the server, so notifications arrive even when the app is closed.
 *
 * `syncPushSubscription()` runs whenever the app opens. It re-posts the
 * subscription so the server follows the device's timezone, and drops a
 * subscription this browser holds for a different (earlier) account.
 */

import { notificationsApi } from '../api/client';

export type PushSupport = 'supported' | 'unsupported' | 'needs-install';

export interface DevicePushState {
  support: PushSupport;
  permission: NotificationPermission | 'unsupported';
  subscribed: boolean;
  endpoint: string | null;
}

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

export function pushSupport(): PushSupport {
  const hasApis =
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;
  if (hasApis) return 'supported';
  // iOS only exposes Web Push to apps added to the Home Screen.
  if (typeof navigator !== 'undefined' && isIos() && !isStandalone()) return 'needs-install';
  return 'unsupported';
}

const READY_TIMEOUT_MS = 10_000;

/**
 * The active service worker registration, waiting for it to activate. Only
 * for turning notifications on: `serviceWorker.ready` never settles when no
 * worker activates (private windows, failed registration), so it is raced
 * against a timeout.
 */
async function readyRegistration(): Promise<ServiceWorkerRegistration> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('The app is still installing. Reload the page and try again.')),
      READY_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([navigator.serviceWorker.ready, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** This browser's push subscription, if any (never waits on activation). */
async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== 'supported') return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Whether this browser's subscription is registered for the signed-in account. */
export async function getDevicePushState(): Promise<DevicePushState> {
  const support = pushSupport();
  if (support !== 'supported') {
    return { support, permission: 'unsupported', subscribed: false, endpoint: null };
  }
  const permission = Notification.permission;
  const sub = await currentSubscription();
  if (!sub || permission !== 'granted') return { support, permission, subscribed: false, endpoint: null };
  const { subscribed } = await notificationsApi.subscribe(sub.toJSON(), deviceTimeZone(), { refreshOnly: true });
  return { support, permission, subscribed, endpoint: subscribed ? sub.endpoint : null };
}

/** Turn notifications on for this device. Call only from a user gesture. */
export async function enablePushOnThisDevice(): Promise<DevicePushState> {
  if (pushSupport() !== 'supported') throw new Error('This browser does not support notifications');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { support: 'supported', permission, subscribed: false, endpoint: null };
  }
  const reg = await readyRegistration();
  const { publicKey } = await notificationsApi.vapidPublicKey();
  const applicationServerKey = urlBase64ToUint8Array(publicKey);
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with a different server key can't receive our pushes.
  if (sub && !sameKey(sub.options?.applicationServerKey ?? null, applicationServerKey)) {
    await sub.unsubscribe().catch(() => {});
    sub = null;
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
  }
  await notificationsApi.subscribe(sub.toJSON(), deviceTimeZone());
  return { support: 'supported', permission, subscribed: true, endpoint: sub.endpoint };
}

function sameKey(a: ArrayBuffer | null, b: Uint8Array): boolean {
  if (!a) return true; // browser didn't report it; assume ours
  const bytes = new Uint8Array(a);
  return bytes.length === b.length && bytes.every((v, i) => v === b[i]);
}

/** Turn notifications off for this device (server row + browser subscription). */
export async function disablePushOnThisDevice(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  try {
    await notificationsApi.unsubscribe(sub.endpoint);
  } finally {
    await sub.unsubscribe().catch(() => {});
  }
}

/**
 * On app open: refresh this device's registration (timezone, keys). A
 * subscription another account owns (left by a previous account whose
 * session expired) is dropped so this account never gets its prompts. One
 * the server has no row for is left alone: it may be mid-registration (an
 * enable whose POST hasn't landed yet).
 */
export async function syncPushSubscription(): Promise<void> {
  try {
    const sub = await currentSubscription();
    if (!sub) return;
    const result = await notificationsApi.subscribe(sub.toJSON(), deviceTimeZone(), { refreshOnly: true });
    if (!result.subscribed && result.owner === 'other') await sub.unsubscribe().catch(() => {});
  } catch {
    // Offline or signed out: try again next time.
  }
}
