/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
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

// Cache API responses
registerRoute(
  /\/api\/v1\//,
  new NetworkFirst({
    cacheName: 'api-cache',
    plugins: [new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 60 * 5 })],
  })
);
