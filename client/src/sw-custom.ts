/// <reference lib="webworker" />
import { createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

declare const self: ServiceWorkerGlobalScope;

// When a new build's service worker is installed, take over all open tabs
// immediately instead of waiting for the next navigation. Combined with
// registerSW()'s auto-update handling in main.tsx, this makes the page
// reload automatically after a deployment so users never see a stale UI.
self.skipWaiting();
self.clients.claim();

// Precache static assets injected by vite-plugin-pwa
precacheAndRoute(self.__WB_MANIFEST);

// Serve the precached app shell for SPA navigations (deep links, reloads) so
// they work offline; API calls and real files are left to the network.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/^\/api\//, /^\/healthz/, /\/[^/?]+\.[^/]+$/],
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
// images), LLM/jobs/import endpoints, webhooks and per-plugin settings (e.g.
// TMDB keys). Those must always hit the network and never land in CacheStorage.
const UNCACHED_API_PATHS =
  /^\/api\/v1\/(?:settings|backup|immich|llm|jobs|import|webhook)(?:\/|$)|^\/api\/v1\/plugins\/[^/]+\/settings(?:\/|$)/;

// Earlier builds cached every API GET; drop whatever they stored (it may
// include API keys or a full backup archive).
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.delete('api-cache'));
});

registerRoute(
  ({ url }) => url.pathname.startsWith('/api/v1/') && !UNCACHED_API_PATHS.test(url.pathname),
  new NetworkFirst({
    cacheName: 'api-cache',
    plugins: [new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 60 * 5 })],
  })
);
