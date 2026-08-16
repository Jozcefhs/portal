const CACHE = 'dynamax-v228-academic-timetable-attendance';
const SHELL = ['/', '/index.html', '/school.html', '/admin.html', '/setup.html', '/activate-account.html', '/onboarding-status.html', '/parent-dashboard.html', '/payments.html', '/buy-form.html', '/register-organization.html', '/subscription-payment.html', '/plan-management.html', '/give.html', '/store.html', '/css/style.css', '/css/school-landing.css', '/css/guest-fee-payment.css', '/css/notifications.css', '/css/payment-methods.css', '/css/store.css', '/css/store-compact.css', '/js/preferences.js', '/js/action-feedback.js', '/js/app-dialogs.js', '/js/activate-account.js', '/js/onboarding-status.js', '/js/financial-values.js', '/js/launcher.js', '/js/site-config.js', '/js/list-sorting.js', '/js/admin.js', '/js/student-face-lookup.js', '/js/setup.js', '/js/payment-methods.js', '/js/buy-form.js', '/js/give.js', '/js/payments.js', '/js/store.js', '/js/notifications.js', '/js/web-push.js', '/js/parent-dashboard.js', '/js/register-organization.js', '/js/subscription-payment.js', '/js/plan-management.js', '/images/Logo.png'];

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

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = { notification: { body: event.data?.text?.() || '' } }; }
  const notification = payload.notification || {};
  const data = payload.data || {};
  const title = notification.title || data.title || 'Dynamax notification';
  const tag = data.notificationId || undefined;
  event.waitUntil((async () => {
    if (tag) {
      const visible = await self.registration.getNotifications({ tag });
      if (visible.length) return;
    }
    const options = {
      body: notification.body || data.message || '',
      silent: false,
      vibrate: [200, 100, 200],
      data: { actionUrl: data.actionUrl || notification.click_action || '/' }
    };
    if (tag) {
      options.tag = tag;
      options.renotify = true;
    }
    await self.registration.showNotification(title, options);
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.actionUrl || '/', self.location.origin).href;
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((client) => client.url === target || client.url.startsWith(target));
    if (existing) return existing.focus();
    return clients.openWindow(target);
  }));
});
