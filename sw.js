// AfriAce service worker
// Handles: app-shell caching for installability/offline (stale-while-revalidate,
// so content updates are picked up automatically without bumping a cache
// version on every deploy), classwork/task API caching, and Web Push
// notifications (works even when the tab is closed).

var CACHE_V = 'afriace-shell';
var QUIZ_CACHE = 'afriace-quiz';
var TASK_CACHE = 'afriace-tasks';
var STATIC = [
  './',
  'student-portal.html',
  'manifest.json',
  'icons/afriace-icon.svg'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_V).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_V && k !== QUIZ_CACHE && k !== TASK_CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  // Never intercept non-GET requests (logins, writes, etc). Caching only
  // ever applies to GET; if a POST's network fetch fails, caches.match()
  // can never resolve it, which turns a transient error into a hard
  // "Failed to fetch" instead of letting the real error surface.
  if (e.request.method !== 'GET') return;
  // Cache classwork API responses so tasks are still visible offline
  if (url.includes('supabase') && url.includes('classwork')) {
    e.respondWith(
      fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(TASK_CACHE).then(c => c.put(e.request, clone));
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }
  // Network-first for API calls
  if (url.includes('supabase') || url.includes('api')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  // Stale-while-revalidate for the app shell/static assets: serve the cached
  // copy instantly, but always re-fetch in the background and update the
  // cache. If the freshly fetched content differs from what was cached, tell
  // any open tabs so they can prompt the user to refresh.
  e.respondWith(
    caches.open(CACHE_V).then(cache =>
      cache.match(e.request).then(cached => {
        const networkFetch = fetch(e.request).then(res => {
          if (res.ok) {
            const resClone = res.clone();
            if (cached) {
              cached.clone().text().then(oldText => {
                resClone.clone().text().then(newText => {
                  if (oldText !== newText) {
                    self.clients.matchAll().then(clients =>
                      clients.forEach(c => c.postMessage({ type: 'NEW_VERSION_READY' }))
                    );
                  }
                });
              });
            }
            cache.put(e.request, resClone);
          }
          return res;
        }).catch(() => cached);

        return cached || networkFetch;
      })
    )
  );
});

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

// ── Real push notification handling ──────────────────────────
// Fires even when the app/tab is fully closed, as long as the
// browser process can wake this service worker (standard Web Push).
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch(err) { data = { title: 'AfriAce', body: e.data ? e.data.text() : '' }; }
  const title = data.title || 'AfriAce';
  const options = {
    body: data.body || '',
    icon: data.icon || 'icons/afriace-icon.svg',
    badge: data.badge || 'icons/afriace-icon.svg',
    tag: data.tag || 'afriace-notif',
    data: { url: data.url || './student-portal.html' },
    vibrate: [80, 40, 80],
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const targetUrl = (e.notification.data && e.notification.data.url) || './student-portal.html';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
