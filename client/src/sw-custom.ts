/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import type { RouteHandlerCallback } from 'workbox-core';
import { CacheFirst, NetworkFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { safeNotificationPath } from './utils/notificationPath';

declare const self: ServiceWorkerGlobalScope;

// When a new build's service worker is installed, take over all open tabs
// immediately instead of waiting for the next navigation. main.tsx then moves
// open pages onto the new build (see checkForNewBuild there).
self.skipWaiting();
clientsClaim();

// Precache static assets injected by vite-plugin-pwa
precacheAndRoute(self.__WB_MANIFEST);

// SPA navigations (deep links, reloads) go to the network first, so a reload
// always gets the deployed build even before this worker has updated. The
// precached shell is the fallback when offline, slow, or the server is
// restarting (5xx from a proxy). API calls and real files aren't navigations.
const NAVIGATION_TIMEOUT_MS = 4000;
const precachedShell = createHandlerBoundToURL('index.html');

const networkFirstShell: RouteHandlerCallback = async (options) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NAVIGATION_TIMEOUT_MS);
  try {
    const response = await fetch(options.request, { signal: controller.signal });
    if (response.type === 'opaqueredirect' || response.status < 500) return response;
  } catch {
    // Offline or timed out.
  } finally {
    clearTimeout(timer);
  }
  return precachedShell(options);
};

registerRoute(
  new NavigationRoute(networkFirstShell, {
    denylist: [/^\/api\//, /^\/healthz/, /\/[^/?]+\.[^/]+$/],
  })
);

// Font files aren't precached (the optional typography choices ship ~100 of
// them, which would make every update download slowly and fail more often).
// Cache each one the first time it is used; hashed names never change.
registerRoute(
  ({ url }) => url.origin === self.location.origin && /^\/assets\/.+\.woff2?$/.test(url.pathname),
  new CacheFirst({
    cacheName: 'fonts',
    plugins: [new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 365 })],
  })
);

// Cache Leaflet CDN assets
registerRoute(
  /^https:\/\/unpkg\.com\/leaflet/,
  new CacheFirst({
    cacheName: 'leaflet-cdn',
    plugins: [new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 30 })],
  })
);

// Cache OSM tiles
registerRoute(
  /^https:\/\/[abc]\.tile\.openstreetmap\.org/,
  new CacheFirst({
    cacheName: 'osm-tiles',
    plugins: [new ExpirationPlugin({ maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 7 })],
  })
);

// Cache API responses, except anything holding secrets or bulk personal data:
// settings (Immich/Dawarich API keys), backups, integration proxies (Immich
// images), LLM/jobs/import endpoints, webhooks, per-plugin settings (e.g.
// TMDB keys), and account endpoints (auth: who is signed in, sessions,
// webhook secret; admin: user management). Those must always hit the network
// and never land in CacheStorage. The page deletes 'api-cache' on sign-out.
const UNCACHED_API_PATHS =
  /^\/api\/v1\/(?:settings|backup|immich|llm|jobs|import|webhook|auth|admin|notifications)(?:\/|$)|^\/api\/v1\/plugins\/[^/]+\/settings(?:\/|$)|^\/api\/v1\/notes\/audio(?:\/|$)/;

// Earlier builds cached every API GET; drop whatever they stored (it may
// include API keys or a full backup archive).
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.delete('api-cache'));
});

registerRoute(
  ({ url }) => url.pathname.startsWith('/api/v1/') && !UNCACHED_API_PATHS.test(url.pathname),
  new NetworkFirst({
    cacheName: 'api-cache',
    plugins: [
      // Only successful responses: never a 401/403 (or an opaque response),
      // which would otherwise be replayed offline or to the next user.
      { cacheWillUpdate: async ({ response }) => (response.status === 200 ? response : null) },
      new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 60 * 5 }),
    ],
  })
);

// ---------------------------------------------------------------------------
// Notifications (Web Push). The server sends every notification, so they
// arrive even when the app is closed. See server/src/services/notifications.
// ---------------------------------------------------------------------------

self.addEventListener('push', (event) => {
  let data: { title?: string; body?: string; url?: string; tag?: string } = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { body: event.data?.text() };
  }
  // showNotification must run inside waitUntil, or Chrome shows its generic
  // "site updated in the background" notice instead.
  event.waitUntil(
    self.registration.showNotification(data.title || 'WhereWeWere', {
      body: data.body || '',
      icon: '/icon-192.png',
      tag: data.tag,
      // Without renotify, a reminder replacing an undismissed one with the
      // same tag arrives silently (no sound, vibration, or heads-up).
      renotify: !!data.tag,
      data: { url: safeNotificationPath(data.url) },
      // renotify is supported by Chromium but missing from TS's DOM types.
    } as NotificationOptions)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = safeNotificationPath((event.notification.data as { url?: unknown } | null)?.url);
  const target = new URL(path, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = windows.find((c) => new URL(c.url).origin === self.location.origin);
      if (existing) {
        const focused = await existing.focus().catch(() => existing);
        try {
          await focused.navigate(target);
        } catch {
          // navigate() fails for uncontrolled clients; let the page route itself.
          focused.postMessage({ type: 'notification-click', url: path });
        }
        return;
      }
      await self.clients.openWindow(target);
    })()
  );
});

// The browser rotated this device's subscription: register the new one (the
// session cookie rides along on this same-origin request).
self.addEventListener('pushsubscriptionchange', (event) => {
  const change = event as Event & {
    oldSubscription?: PushSubscription | null;
    newSubscription?: PushSubscription | null;
    waitUntil: (p: Promise<unknown>) => void;
  };
  change.waitUntil(
    (async () => {
      let sub = change.newSubscription ?? null;
      if (!sub) {
        const res = await fetch('/api/v1/notifications/vapid-public-key', { credentials: 'same-origin' });
        if (!res.ok) return;
        const { publicKey } = await res.json();
        const padding = '='.repeat((4 - (publicKey.length % 4)) % 4);
        const raw = atob((publicKey + padding).replace(/-/g, '+').replace(/_/g, '/'));
        const key = Uint8Array.from(raw, (c) => c.charCodeAt(0));
        sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      }
      await fetch('/api/v1/notifications/subscriptions', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscription: sub.toJSON(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          oldEndpoint: change.oldSubscription?.endpoint,
        }),
      });
    })().catch(() => {})
  );
});
