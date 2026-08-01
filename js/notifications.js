(() => {
  const identity = document.getElementById('staffIdentity');
  const profile = document.getElementById('staffProfileTrigger');
  if (!identity || !profile) return;

  const centre = document.createElement('div');
  centre.className = 'notification-centre';
  centre.innerHTML = `
    <button type="button" class="staff-header-icon notification-trigger" aria-label="Notifications" title="Notifications" aria-expanded="false">
      <span aria-hidden="true">&#128276;</span><span class="notification-badge" hidden>0</span>
    </button>
    <section class="notification-popover" aria-label="Notifications" hidden>
      <header class="notification-popover-header"><strong>Notifications</strong><button type="button" class="notification-mark-all">Mark all read</button></header>
      <div class="notification-list"><p class="notification-empty">No notifications yet.</p></div>
      <footer><button type="button" class="notification-view-all">View all notifications</button></footer>
    </section>`;
  identity.insertBefore(centre, profile);

  const dialog = document.createElement('dialog');
  dialog.className = 'notification-history-dialog';
  dialog.innerHTML = `
    <div class="notification-history-shell">
      <header><div><small>COMMUNICATION CENTRE</small><h2>Notifications</h2></div><button type="button" data-notification-close aria-label="Close">&times;</button></header>
      <nav class="notification-history-tabs" aria-label="Notification views">
        <button type="button" class="is-active" data-notification-view="history">History</button>
        <button type="button" data-notification-view="settings">Preferences & devices</button>
      </nav>
      <section data-notification-panel="history">
        <div class="notification-history-filters">
          <label>Category<select data-notification-category><option value="">All categories</option><option>Fees</option><option>Payments</option><option>Requisitions</option><option>Attendance</option><option>Academics</option><option>Announcements</option><option>System</option></select></label>
          <label><input type="checkbox" data-notification-unread> Unread only</label>
          <label><input type="checkbox" data-notification-archived> Archived</label>
          <button type="button" data-notification-refresh>Refresh</button>
        </div>
        <div class="notification-history-list"></div>
        <button type="button" class="notification-load-more" hidden>Load older notifications</button>
      </section>
      <section data-notification-panel="settings" hidden>
        <form class="notification-settings-form">
          <div class="notification-push-card">
            <div><strong>Browser push</strong><span data-push-status>Checking this device…</span></div>
            <div><button type="button" data-enable-push>Enable on this device</button><button type="button" data-disable-push>Remove this device</button><button type="button" data-test-push>Send test</button></div>
          </div>
          <div class="notification-device-list" aria-label="Subscribed devices"></div>
          <fieldset><legend>Categories</legend><div class="notification-category-grid"></div></fieldset>
          <fieldset><legend>Quiet hours</legend><label><input type="checkbox" name="QuietHoursEnabled"> Enable quiet hours</label><label>From <input type="time" name="QuietHoursStart"></label><label>To <input type="time" name="QuietHoursEnd"></label><label>Timezone <input name="Timezone" maxlength="80"></label></fieldset>
          <fieldset><legend>Channels</legend><label><input type="checkbox" name="InApp"> In-app notifications</label><label><input type="checkbox" name="Push"> Browser push</label></fieldset>
          <fieldset class="notification-system-settings" hidden><legend>Organisation defaults</legend><label>Before due (days) <input name="FeeDueIntervals"></label><label>After due (days) <input name="FeeOverdueIntervals"></label><label>Submission reviewer roles <input name="SubmittedRoles"></label><label>Processing roles <input name="ProcessingRoles"></label><label>Management roles <input name="ManagementRoles"></label><label class="notification-template-field">Templates (JSON) <textarea name="Templates" rows="8"></textarea></label><button type="button" data-save-system-settings>Save organisation defaults</button></fieldset>
          <button type="submit">Save preferences</button><p class="notification-settings-status" role="status"></p>
        </form>
      </section>
    </div>`;
  document.body.appendChild(dialog);

  const trigger = centre.querySelector('.notification-trigger');
  const badge = centre.querySelector('.notification-badge');
  const popover = centre.querySelector('.notification-popover');
  const list = centre.querySelector('.notification-list');
  const markAll = centre.querySelector('.notification-mark-all');
  const historyList = dialog.querySelector('.notification-history-list');
  const loadMore = dialog.querySelector('.notification-load-more');
  let records = [];
  let historyRecords = [];
  let currentData = {};
  let loading = false;
  let lastLoadedAt = 0;

  const html = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  const request = (input, init = {}) => typeof staffFetch === 'function'
    ? staffFetch(input, init)
    : fetch(input, { credentials: 'same-origin', ...init });

  function itemMarkup(row, full = false) {
    return `<article class="notification-item${row.Read ? ' is-read' : ''}" data-notification-id="${html(row.NotificationId)}">
      <button type="button" class="notification-open" data-action-url="${html(row.ActionUrl)}">
        <span class="notification-item-dot" aria-hidden="true"></span><span class="notification-item-copy">
          <small>${html(row.Category || row.Type || 'System')}</small><strong>${html(row.Title || 'Notification')}</strong>
          <span>${html(row.Message || '')}</span><time datetime="${html(row.CreatedAt || '')}">${html(row.CreatedAt ? new Date(row.CreatedAt).toLocaleString() : '')}</time>
        </span>
      </button>${full ? `<button type="button" class="notification-archive-action" data-archive-notification>${row.Archived ? 'Restore' : 'Archive'}</button>` : ''}
    </article>`;
  }

  function render(data = {}) {
    currentData = { ...currentData, ...data };
    records = Array.isArray(data.notifications) ? data.notifications : [];
    const unread = Number(data.unreadCount || 0);
    badge.textContent = unread > 99 ? '99+' : String(unread);
    badge.hidden = unread < 1;
    markAll.disabled = unread < 1;
    list.innerHTML = records.length ? records.slice(0, 10).map((row) => itemMarkup(row)).join('') : '<p class="notification-empty">No notifications yet.</p>';
    renderSettings(currentData);
  }

  async function load(force = false) {
    if (identity.hidden || loading || (!force && Date.now() - lastLoadedAt < 15000)) return;
    loading = true;
    try {
      const response = await request('/api/staff-notifications?limit=100', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.ok) { render(data); lastLoadedAt = Date.now(); }
    } finally { loading = false; }
  }

  async function update(action, values = {}) {
    const response = await request('/api/staff-notifications', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...values })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.message || 'Could not update notifications.');
    render(data);
    lastLoadedAt = Date.now();
    return data;
  }

  function openSection(actionUrl) {
    if (!actionUrl) return;
    try {
      const target = new URL(actionUrl, window.location.href);
      if (target.origin !== window.location.origin) {
        if (target.protocol === 'https:') window.open(target.href, '_blank', 'noopener,noreferrer');
        return;
      }
      const section = target.searchParams.get('section') || '';
      const button = section && document.querySelector(`[data-tab="${CSS.escape(section)}"]`);
      if (button) button.click();
      else if (target.pathname !== window.location.pathname) window.location.href = target.href;
    } catch {}
  }

  function historyQuery(before = '') {
    const params = new URLSearchParams({ limit: '40' });
    const category = dialog.querySelector('[data-notification-category]').value;
    if (category) params.set('category', category);
    if (dialog.querySelector('[data-notification-unread]').checked) params.set('unread', 'true');
    if (dialog.querySelector('[data-notification-archived]').checked) params.set('archived', 'true');
    if (before) params.set('before', before);
    return params;
  }

  async function loadHistory(append = false) {
    const cursor = append ? currentData.nextCursor : '';
    historyList.setAttribute('aria-busy', 'true');
    const response = await request(`/api/staff-notifications?${historyQuery(cursor)}`, { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    historyList.removeAttribute('aria-busy');
    if (!response.ok || !data.ok) throw new Error(data.message || 'Could not load notification history.');
    currentData = data;
    historyRecords = append ? [...historyRecords, ...(data.notifications || [])] : (data.notifications || []);
    historyList.innerHTML = historyRecords.length ? historyRecords.map((row) => itemMarkup(row, true)).join('') : '<p class="notification-empty">No notifications match these filters.</p>';
    loadMore.hidden = !data.hasMore;
    renderSettings(data);
  }

  function renderSettings(data = {}) {
    const form = dialog.querySelector('.notification-settings-form');
    const settings = data.settings || {};
    if (!settings.Categories) return;
    form.elements.QuietHoursEnabled.checked = settings.QuietHoursEnabled === true;
    form.elements.QuietHoursStart.value = settings.QuietHoursStart || '21:00';
    form.elements.QuietHoursEnd.value = settings.QuietHoursEnd || '06:00';
    form.elements.Timezone.value = settings.Timezone || 'Africa/Lagos';
    form.elements.InApp.checked = settings.Channels?.InApp !== false;
    form.elements.Push.checked = settings.Channels?.Push !== false;
    form.elements.FeeDueIntervals.value = (settings.FeeDueIntervals || [14, 7, 3, 1, 0]).join(', ');
    form.elements.FeeOverdueIntervals.value = (settings.FeeOverdueIntervals || [1, 7, 14, 30]).join(', ');
    form.elements.Templates.value = JSON.stringify(settings.Templates || {}, null, 2);
    form.elements.SubmittedRoles.value = (settings.WorkflowRecipients?.SubmittedRoles || ['Super Admin', 'Accounts Officer', 'Management']).join(', ');
    form.elements.ProcessingRoles.value = (settings.WorkflowRecipients?.ProcessingRoles || ['Super Admin', 'Accounts Officer']).join(', ');
    form.elements.ManagementRoles.value = (settings.WorkflowRecipients?.ManagementRoles || ['Super Admin', 'Management']).join(', ');
    form.querySelector('.notification-system-settings').hidden = !data.canManageSystemSettings;
    form.querySelector('.notification-category-grid').innerHTML = Object.entries(settings.Categories).map(([name, enabled]) => `<label><input type="checkbox" name="Category:${html(name)}" ${enabled !== false ? 'checked' : ''}> ${html(name)}</label>`).join('');
    const permission = window.DynamaxWebPush?.permission?.() || 'unsupported';
    const thisDevice = (data.subscriptions || []).find((row) => row.DeviceId === window.DynamaxWebPush?.deviceId?.());
    form.querySelector('[data-push-status]').textContent = thisDevice ? `Enabled: ${thisDevice.DeviceName || 'this device'}` : `Status: ${permission}`;
    form.querySelector('[data-enable-push]').disabled = !data.messaging?.enabled || Boolean(thisDevice);
    form.querySelector('[data-disable-push]').disabled = !thisDevice;
    form.querySelector('[data-test-push]').disabled = !thisDevice;
    form.querySelector('.notification-device-list').innerHTML = (data.subscriptions || []).length
      ? `<strong>Subscribed devices</strong>${data.subscriptions.map((row) => `<span><span><b>${html(row.DeviceName || 'Browser device')}</b><small>${html(row.LastSeenAt ? new Date(row.LastSeenAt).toLocaleString() : '')}${row.DeviceId === window.DynamaxWebPush?.deviceId?.() ? ' · This device' : ''}</small></span><button type="button" data-remove-push-device="${html(row.DeviceId)}">Remove</button></span>`).join('')}`
      : '<span>No browser devices are subscribed.</span>';
  }

  trigger.addEventListener('click', async () => {
    const open = popover.hidden;
    popover.hidden = !open;
    trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) await load(true);
  });
  document.addEventListener('click', (event) => {
    if (!centre.contains(event.target)) { popover.hidden = true; trigger.setAttribute('aria-expanded', 'false'); }
  });
  centre.querySelector('.notification-view-all').addEventListener('click', async () => {
    popover.hidden = true; dialog.showModal(); await loadHistory(false).catch((error) => { historyList.textContent = error.message; });
  });
  dialog.querySelector('[data-notification-close]').addEventListener('click', () => dialog.close());
  dialog.querySelectorAll('[data-notification-view]').forEach((button) => button.addEventListener('click', () => {
    dialog.querySelectorAll('[data-notification-view]').forEach((item) => item.classList.toggle('is-active', item === button));
    dialog.querySelectorAll('[data-notification-panel]').forEach((panel) => { panel.hidden = panel.dataset.notificationPanel !== button.dataset.notificationView; });
  }));
  dialog.querySelectorAll('[data-notification-category], [data-notification-unread], [data-notification-archived]').forEach((control) => control.addEventListener('change', () => loadHistory(false).catch(() => {})));
  dialog.querySelector('[data-notification-refresh]').addEventListener('click', () => loadHistory(false).catch(() => {}));
  loadMore.addEventListener('click', () => loadHistory(true).catch(() => {}));

  async function handleNotificationClick(event, sourceRecords) {
    const item = event.target.closest('[data-notification-id]');
    if (!item) return;
    const row = sourceRecords.find((entry) => entry.NotificationId === item.dataset.notificationId);
    if (event.target.closest('[data-archive-notification]')) {
      await update(row?.Archived ? 'unarchive' : 'archive', { notificationId: item.dataset.notificationId });
      await loadHistory(false);
      return;
    }
    if (row && !row.Read) await update('markRead', { notificationId: row.NotificationId }).catch(() => {});
    const open = event.target.closest('[data-action-url]');
    if (open) { dialog.close(); popover.hidden = true; openSection(open.dataset.actionUrl); }
  }
  list.addEventListener('click', (event) => handleNotificationClick(event, records));
  historyList.addEventListener('click', (event) => handleNotificationClick(event, historyRecords));
  markAll.addEventListener('click', () => update('markAllRead').catch(() => {}));

  const settingsForm = dialog.querySelector('.notification-settings-form');
  settingsForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const categories = {};
    settingsForm.querySelectorAll('[name^="Category:"]').forEach((input) => { categories[input.name.slice(9)] = input.checked; });
    const status = settingsForm.querySelector('.notification-settings-status');
    try {
      await update('saveSettings', { settings: {
        QuietHoursEnabled: settingsForm.elements.QuietHoursEnabled.checked,
        QuietHoursStart: settingsForm.elements.QuietHoursStart.value,
        QuietHoursEnd: settingsForm.elements.QuietHoursEnd.value,
        Timezone: settingsForm.elements.Timezone.value,
        Channels: { InApp: settingsForm.elements.InApp.checked, Push: settingsForm.elements.Push.checked },
        Categories: categories
      } });
      status.textContent = 'Preferences saved.';
    } catch (error) { status.textContent = error.message; }
  });
  settingsForm.querySelector('[data-enable-push]').addEventListener('click', async () => {
    const status = settingsForm.querySelector('.notification-settings-status');
    try {
      await window.DynamaxWebPush.enable(currentData.messaging, (subscription) => update('subscribePush', { subscription }));
      status.textContent = 'Browser push enabled on this device.';
    } catch (error) { status.textContent = error.message; }
  });
  settingsForm.querySelector('[data-disable-push]').addEventListener('click', async () => {
    await window.DynamaxWebPush.disable((deviceId) => update('unsubscribePush', { deviceId })).catch((error) => { settingsForm.querySelector('.notification-settings-status').textContent = error.message; });
  });
  settingsForm.querySelector('[data-test-push]').addEventListener('click', () => update('testPush', { deviceId: window.DynamaxWebPush.deviceId() }).catch((error) => { settingsForm.querySelector('.notification-settings-status').textContent = error.message; }));
  settingsForm.querySelector('.notification-device-list').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-remove-push-device]');
    if (!button) return;
    try { await update('unsubscribePush', { deviceId: button.dataset.removePushDevice }); } catch (error) { settingsForm.querySelector('.notification-settings-status').textContent = error.message; }
  });
  settingsForm.querySelector('[data-save-system-settings]').addEventListener('click', async () => {
    const status = settingsForm.querySelector('.notification-settings-status');
    try {
      const templates = JSON.parse(settingsForm.elements.Templates.value || '{}');
      await update('saveSystemSettings', { settings: {
        Timezone: settingsForm.elements.Timezone.value,
        FeeDueIntervals: settingsForm.elements.FeeDueIntervals.value,
        FeeOverdueIntervals: settingsForm.elements.FeeOverdueIntervals.value,
        Templates: templates,
        WorkflowRecipients: {
          SubmittedRoles: settingsForm.elements.SubmittedRoles.value.split(',').map((value) => value.trim()).filter(Boolean),
          ProcessingRoles: settingsForm.elements.ProcessingRoles.value.split(',').map((value) => value.trim()).filter(Boolean),
          ManagementRoles: settingsForm.elements.ManagementRoles.value.split(',').map((value) => value.trim()).filter(Boolean)
        }
      } });
      status.textContent = 'Organisation notification defaults saved.';
    } catch (error) { status.textContent = error instanceof SyntaxError ? 'Templates must be valid JSON.' : error.message; }
  });

  window.addEventListener('dynamax:foreground-notification', () => load(true));
  new MutationObserver(() => {
    if (!identity.hidden) load(true);
    else { popover.hidden = true; trigger.setAttribute('aria-expanded', 'false'); }
  }).observe(identity, { attributes: true, attributeFilter: ['hidden'] });
  window.setInterval(() => load(), 30000);
})();
