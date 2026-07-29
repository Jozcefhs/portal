const CACHE = 'dynamax-v65-light-edit-icons';
const SHELL = ['/', '/index.html', '/school.html', '/admin.html', '/parent-dashboard.html', '/register-organization.html', '/css/style.css', '/js/preferences.js', '/js/action-feedback.js', '/js/launcher.js', '/js/site-config.js', '/js/admin.js', '/js/parent-dashboard.js', '/js/register-organization.js', '/images/Logo.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => null)
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== 'GET'
    || url.origin !== self.location.origin
    || url.pathname === '/api'
    || url.pathname.startsWith('/api/')
  ) return;

  const networkResponse = fetch(event.request);
  const cacheUpdate = networkResponse
    .then((response) => {
      if (!response.ok || response.type !== 'basic') return undefined;
      return caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
    })
    .catch(() => undefined);

  event.waitUntil(cacheUpdate);
  event.respondWith(
    networkResponse.catch(async () => {
      const cached = await caches.match(event.request, { ignoreSearch: true });
      if (cached) return cached;
      if (event.request.mode === 'navigate') {
        const shell = await caches.match('/index.html');
        if (shell) return shell;
      }
      return Response.error();
    })
  );
});
