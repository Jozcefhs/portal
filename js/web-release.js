/* Detect a newer web build without reloading work or reading the database. */
(() => {
  'use strict';
  const loaded = document.querySelector('meta[name="dynamax-web-release"]')?.content;
  if (!loaded) return;
  const interval = 5 * 60 * 1000;
  let lastCheck = -Infinity, pending = null, notice = null;
  const generation = value => Number(/^dynamax-v(\d+)-/.exec(String(value || ''))?.[1] || 0);
  function announce(release) {
    if (generation(release) <= generation(loaded) || !document.body) return;
    if (notice) return;
    notice = document.createElement('aside');
    notice.id = 'webReleaseNotice'; notice.setAttribute('role', 'status');
    const message = document.createElement('span');
    message.textContent = 'A newer web update is ready. Save any unfinished work, then reload to use the latest features.';
    const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Reload updated portal';
    // Only an explicit click reloads. Loaded score snapshots and unsaved entries stay intact until then.
    button.addEventListener('click', () => window.location.reload());
    notice.append(message, button); document.body.prepend(notice);
  }
  async function check() {
    if (document.hidden || pending || Date.now() - lastCheck < interval) return pending;
    lastCheck = Date.now();
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    pending = (async () => {
      try {
        const response = await fetch('/sw.js', { cache: 'no-store', credentials: 'omit', signal: controller.signal });
        if (!response.ok) return;
        const text = await response.text();
        const release = /^const\s+CACHE\s*=\s*['"](dynamax-v\d+-[a-z0-9-]+)['"]/m.exec(text)?.[1];
        if (release) announce(release);
      } catch (_) { /* Offline is not evidence of a new release. Keep the current workspace. */ }
      finally { clearTimeout(timer); pending = null; }
    })();
    return pending;
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  window.addEventListener('pageshow', check);
  window.addEventListener('focus', check);
  navigator.serviceWorker?.addEventListener('message', event => {
    if (event.data?.type === 'dynamax:web-release') announce(event.data.release);
  });
  // A visible long-running workspace also checks; no interval runs while the page is hidden.
  setInterval(check, interval);
  check();
})();
