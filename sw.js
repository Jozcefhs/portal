const CACHE = 'digc-suite-v13-workspace-launcher';
const SHELL = ['/', '/index.html', '/school.html', '/parent-dashboard.html', '/css/style.css', '/js/preferences.js', '/js/launcher.js', '/js/site-config.js', '/js/parent-dashboard.js', '/app-icon.svg'];
self.addEventListener('install', (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => null)));
self.addEventListener('activate', (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))));
self.addEventListener('fetch', (event) => { if (event.request.method !== 'GET') return; event.respondWith(fetch(event.request).then((response) => { const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(event.request, copy)); return response; }).catch(() => caches.match(event.request))); });
