/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import type { RouteHandlerCallback } from 'workbox-core';
import { CacheFirst, NetworkFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

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
  /^\/api\/v1\/(?:settings|backup|immich|llm|jobs|import|webhook|auth|admin)(?:\/|$)|^\/api\/v1\/plugins\/[^/]+\/settings(?:\/|$)|^\/api\/v1\/notes\/audio(?:\/|$)/;

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
