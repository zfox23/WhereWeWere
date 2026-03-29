/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

declare const self: ServiceWorkerGlobalScope;

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

// Handle notification clicks — navigate to the URL stored in notification data
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url;
  if (!url) return;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.focus();
          client.postMessage({ type: 'notification-click', url });
          return;
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
