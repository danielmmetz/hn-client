import { registerRoute, NavigationRoute } from 'workbox-routing';
import { StaleWhileRevalidate, NetworkFirst } from 'workbox-strategies';

// Cache navigation requests (HTML) with network-first
// This ensures the app shell loads offline
registerRoute(
  new NavigationRoute(
    new NetworkFirst({
      cacheName: 'pages',
    })
  )
);

// Cache static assets (JS, CSS, images, fonts) with stale-while-revalidate
registerRoute(
  ({ request }) =>
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'image' ||
    request.destination === 'font' ||
    request.destination === 'manifest',
  new StaleWhileRevalidate({
    cacheName: 'assets',
  })
);

// Do NOT intercept /api/* requests — those go through the app's fetch layer

// Handle SW lifecycle
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Clear all old caches to force fresh assets
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.map((name) => caches.delete(name)))
    ).then(() => self.clients.claim())
  );
});
