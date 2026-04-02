const CACHE_NAME = 'attendance-hub-v7';
const ASSETS = [
  './auth.html',
  './index.html',
  './student-dashboard.html',
  './admin.html',
  './faculty-dashboard.html',
  './summary.html',
  './icon-192.png',
  './icon-512.png',
  './icon.svg',
  './college-logo.png',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // cache.addAll might fail if an asset is not found.
      // We log errors and proceed with valid ones.
      return Promise.allSettled(
        ASSETS.map((asset) => cache.add(asset))
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      return fetch(event.request).then((networkResponse) => {
        return networkResponse;
      }).catch(() => {
        if (event.request.mode === 'navigate') {
          return caches.match('./auth.html');
        }
      });
    })
  );
});

self.addEventListener('push', (event) => {
    let data = { title: 'Attendance Alert', body: 'New session has started.' };
    try {
        data = event.data.json();
    } catch(e) {}

    self.registration.showNotification(data.title, {
        body: data.body,
        icon: './icon-192.png',
        badge: './icon-192.png'
    });
});
