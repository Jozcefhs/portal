const CACHE = 'digc-suite-v16-shared-mobile';
const SHELL = ['/', '/index.html', '/school.html', '/admin.html', '/parent-dashboard.html', '/css/style.css', '/js/preferences.js', '/js/launcher.js', '/js/site-config.js', '/js/admin.js', '/js/parent-dashboard.js', '/app-icon.svg'];
self.addEventListener('install', (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()).catch(() => null)));
self.addEventListener('activate', (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (event) => { if (event.request.method !== 'GET') return; event.respondWith(fetch(event.request).then((response) => { const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(event.request, copy)); return response; }).catch(() => caches.match(event.request))); });
