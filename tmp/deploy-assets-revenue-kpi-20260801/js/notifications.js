(() => {
  const identity = document.getElementById('staffIdentity');
  const profile = document.getElementById('staffProfileTrigger');
  if (!identity || !profile) return;

  const centre = document.createElement('div');
  centre.className = 'notification-centre';
  centre.innerHTML = `
    <button type="button" class="staff-header-icon notification-trigger" aria-label="Notifications" title="Notifications" aria-expanded="false">
      <span aria-hidden="true">&#128276;</span>
      <span class="notification-badge" hidden>0</span>
    </button>
    <section class="notification-popover" aria-label="Notifications" hidden>
      <header class="notification-popover-header"><strong>Notifications</strong><button type="button" class="notification-mark-all">Mark all read</button></header>
      <div class="notification-list"><p class="notification-empty">No notifications yet.</p></div>
    </section>`;
  identity.insertBefore(centre, profile);

  const trigger = centre.querySelector('.notification-trigger');
  const badge = centre.querySelector('.notification-badge');
  const popover = centre.querySelector('.notification-popover');
  const list = centre.querySelector('.notification-list');
  const markAll = centre.querySelector('.notification-mark-all');
  let records = [];
  let loading = false;
  let lastLoadedAt = 0;

  const html = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

  function request(input, init = {}) {
    if (typeof staffFetch === 'function') return staffFetch(input, init);
    return fetch(input, { credentials: 'same-origin', ...init });
  }

  function render(data = {}) {
    records = Array.isArray(data.notifications) ? data.notifications : [];
    const unread = Number(data.unreadCount || 0);
    badge.textContent = unread > 99 ? '99+' : String(unread);
    badge.hidden = unread < 1;
    markAll.disabled = unread < 1;
    list.innerHTML = records.length ? records.map((row) => `
      <button type="button" class="notification-item${row.Read ? ' is-read' : ''}" data-notification-id="${html(row.NotificationId)}" data-action-url="${html(row.ActionUrl)}">
        <span class="notification-item-dot" aria-hidden="true"></span>
        <span class="notification-item-copy">
          <strong>${html(row.Title || 'Notification')}</strong>
          <span>${html(row.Message || '')}</span>
          <time datetime="${html(row.CreatedAt || '')}">${html(row.CreatedAt ? new Date(row.CreatedAt).toLocaleString() : '')}</time>
        </span>
      </button>`).join('') : '<p class="notification-empty">No notifications yet.</p>';
  }

  async function load(force = false) {
    if (identity.hidden || loading || (!force && Date.now() - lastLoadedAt < 15000)) return;
    loading = true;
    try {
      const response = await request('/api/staff-notifications', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.ok) {
        render(data);
        lastLoadedAt = Date.now();
      }
    } finally {
      loading = false;
    }
  }

  async function update(action, notificationId = '') {
    const response = await request('/api/staff-notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, notificationId })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.message || 'Could not update notifications.');
    render(data);
    lastLoadedAt = Date.now();
  }

  function openSection(actionUrl) {
    if (!actionUrl) return;
    let section = '';
    try { section = new URL(actionUrl, window.location.href).searchParams.get('section') || ''; } catch {}
    const button = section && document.querySelector(`[data-tab="${CSS.escape(section)}"]`);
    if (button) button.click();
  }

  trigger.addEventListener('click', async () => {
    const open = popover.hidden;
    popover.hidden = !open;
    trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) await load(true);
  });
  document.addEventListener('click', (event) => {
    if (!centre.contains(event.target)) {
      popover.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
    }
  });
  list.addEventListener('click', async (event) => {
    const item = event.target.closest('[data-notification-id]');
    if (!item) return;
    const row = records.find((entry) => entry.NotificationId === item.dataset.notificationId);
    if (row && !row.Read) await update('markRead', row.NotificationId).catch(() => {});
    popover.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    openSection(item.dataset.actionUrl);
  });
  markAll.addEventListener('click', () => update('markAllRead').catch(() => {}));

  new MutationObserver(() => {
    if (!identity.hidden) load(true);
    else {
      popover.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
    }
  }).observe(identity, { attributes: true, attributeFilter: ['hidden'] });
  window.setInterval(() => load(), 30000);
})();
