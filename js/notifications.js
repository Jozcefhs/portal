(() => {
  const identity = document.getElementById('staffIdentity');
  const profile = document.getElementById('staffProfileTrigger');
  if (!identity || !profile) return;
  const managedCategories = ['Fees', 'Payments', 'Requisitions', 'Attendance', 'Academics', 'Announcements', 'System'];
  const audiencePolicyMarkup = (audience, label) => {
    const categories = audience === 'Parent'
      ? managedCategories.filter((category) => category !== 'Requisitions')
      : managedCategories;
    return `
      <section class="notification-audience-policy" data-policy-audience="${audience}">
        <h3>${label}</h3>
        <div class="notification-policy-group">
          <h4>Delivery channels</h4>
          <div class="notification-policy-channels"><label><input type="checkbox" data-policy-channel="InApp"><span>In-app</span></label><label><input type="checkbox" data-policy-channel="Push"><span>Browser push</span></label></div>
        </div>
        <div class="notification-policy-group">
          <h4>Notification types</h4>
          <div class="notification-policy-categories">${categories.map((category) => `<label><input type="checkbox" data-policy-category="${category}"><span>${category}</span></label>`).join('')}</div>
        </div>
      </section>`;
  };

  const centre = document.createElement('div');
  centre.className = 'notification-centre';
  centre.innerHTML = `
    <button type="button" class="staff-header-icon notification-trigger" aria-label="Notifications" title="Notifications" aria-expanded="false">
      <span aria-hidden="true">&#128276;</span><span class="notification-badge" hidden>0</span>
    </button>
    <section class="notification-popover" aria-label="Notifications" hidden>
      <header class="notification-popover-header"><strong>Notifications</strong><button type="button" class="notification-mark-all">Mark all read</button></header>
      <div class="notification-push-prompt" hidden>
        <p><strong>Mobile alerts are off</strong><small data-notification-push-copy>Enable push to receive alerts when this page is closed.</small></p>
        <button type="button" data-notification-enable-push>Enable push</button>
      </div>
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
        <button type="button" data-notification-view="compose" data-notification-compose-tab hidden>Compose message</button>
        <button type="button" data-notification-view="settings" data-notification-settings-tab>Devices</button>
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
      <section data-notification-panel="compose" hidden>
        <form class="notification-compose-form">
          <div class="notification-compose-heading"><div><small>SCHOOL ANNOUNCEMENT</small><h3>Compose notification message</h3><p>Messages for student groups are delivered to their linked parent accounts.</p></div></div>
          <label class="notification-compose-wide">Title<input name="Title" maxlength="160" required placeholder="For example: Resumption information"></label>
          <label class="notification-compose-wide">Message<textarea name="Message" maxlength="2000" rows="5" required placeholder="Write the message recipients should receive."></textarea></label>
          <fieldset><legend>Who should receive it?</legend><div class="notification-compose-options"><label><input type="checkbox" name="DayStudents"><span>Day students' parents</span></label><label><input type="checkbox" name="BoardingStudents"><span>Boarding students' parents</span></label><label><input type="checkbox" name="Staff"><span>Staff</span></label></div></fieldset>
          <fieldset><legend>Delivery channels</legend><div class="notification-compose-options"><label><input type="checkbox" name="InApp" checked><span>In-app notification</span></label><label><input type="checkbox" name="Push" checked><span>Browser push</span></label></div></fieldset>
          <label>Delivery time<input type="datetime-local" name="ScheduledAt"><small>Leave blank to send immediately.</small></label>
          <div class="notification-compose-actions"><button type="submit">Send or schedule</button><button type="reset" class="notification-secondary-action">Clear</button></div>
          <p class="notification-compose-status" role="status"></p>
        </form>
        <section class="notification-sent-section"><header><div><small>AUDIT TRAIL</small><h3>Sent and scheduled messages</h3></div><button type="button" data-refresh-announcements>Refresh</button></header><div class="notification-announcement-history"></div></section>
      </section>
      <section data-notification-panel="settings" hidden>
        <form class="notification-settings-form">
          <div class="notification-push-card">
            <div><strong>Browser push</strong><span data-push-status>Checking this device…</span></div>
            <div><button type="button" data-enable-push>Enable on this device</button><button type="button" class="notification-device-delete" data-disable-push aria-label="Delete this device" title="Delete this device">&#128465;</button><button type="button" data-test-push>Send test</button></div>
          </div>
          <div class="notification-device-list" aria-label="Subscribed devices"></div>
          <fieldset class="notification-quiet-settings"><legend>Personal quiet hours</legend><label><input type="checkbox" name="QuietHoursEnabled"> Enable quiet hours</label><label>From <input type="time" name="QuietHoursStart"></label><label>To <input type="time" name="QuietHoursEnd"></label><label>Timezone <input name="Timezone" maxlength="80"></label></fieldset>
          <button type="submit">Save quiet hours</button>
          <fieldset class="notification-system-settings" hidden><legend>School notification policy</legend><p class="notification-policy-help">Choose the channels and notification types available to each group of app users.</p><div class="notification-audience-policy-grid">${audiencePolicyMarkup('Parent', 'Parent portal users')}${audiencePolicyMarkup('Staff', 'Staff app users')}</div><label>Before due (days) <input name="FeeDueIntervals"></label><label>After due (days) <input name="FeeOverdueIntervals"></label><label>Submission reviewer roles <input name="SubmittedRoles"></label><label>Processing roles <input name="ProcessingRoles"></label><label>Management roles <input name="ManagementRoles"></label><label class="notification-template-field">Templates (JSON) <textarea name="Templates" rows="8"></textarea></label><button type="button" data-save-system-settings>Save school notification policy</button></fieldset>
          <p class="notification-settings-status" role="status"></p>
        </form>
      </section>
    </div>`;
  document.body.appendChild(dialog);

  const trigger = centre.querySelector('.notification-trigger');
  const badge = centre.querySelector('.notification-badge');
  const popover = centre.querySelector('.notification-popover');
  const list = centre.querySelector('.notification-list');
  const markAll = centre.querySelector('.notification-mark-all');
  const pushPrompt = centre.querySelector('.notification-push-prompt');
  const pushPromptButton = centre.querySelector('[data-notification-enable-push]');
  const historyList = dialog.querySelector('.notification-history-list');
  const loadMore = dialog.querySelector('.notification-load-more');
  const composeTab = dialog.querySelector('[data-notification-compose-tab]');
  const composeForm = dialog.querySelector('.notification-compose-form');
  const announcementHistory = dialog.querySelector('.notification-announcement-history');
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
      </button>${full
        ? `<button type="button" class="notification-archive-action" data-archive-notification>${row.Archived ? 'Restore' : 'Archive'}</button>`
        : `<button type="button" class="notification-delete-action" data-delete-notification aria-label="Delete ${html(row.Title || 'notification')} from tray" title="Delete from tray">&times;</button>`}
    </article>`;
  }

  function announcementMarkup(row) {
    const hasRecipientSummary = row.RecipientSummary && typeof row.RecipientSummary === 'object';
    const recipients = row.RecipientSummary || {};
    const selected = row.Recipients || {};
    const groups = (hasRecipientSummary ? [
      selected.DayStudents ? `${Number(recipients.DayStudents || 0)} day student${Number(recipients.DayStudents || 0) === 1 ? '' : 's'}` : '',
      selected.BoardingStudents ? `${Number(recipients.BoardingStudents || 0)} boarding student${Number(recipients.BoardingStudents || 0) === 1 ? '' : 's'}` : '',
      selected.Staff ? `${Number(recipients.Staff || 0)} staff` : ''
    ] : [selected.DayStudents ? 'Day students' : '', selected.BoardingStudents ? 'Boarding students' : '', selected.Staff ? 'Staff' : ''])
      .filter(Boolean).join(' · ') || 'Recipient count pending';
    const deliveryTime = row.Status === 'Scheduled' ? row.ScheduledAt : row.SentAt || row.CreatedAt;
    return `<article class="notification-announcement-record">
      <div><small>${html(row.Status || 'Draft')}</small><strong>${html(row.Title || 'Announcement')}</strong><p>${html(row.Message || '')}</p></div>
      <dl><div><dt>Recipients</dt><dd>${html(groups)}</dd></div><div><dt>Channels</dt><dd>${html(Object.entries(row.Channels || {}).filter(([, enabled]) => enabled).map(([name]) => name === 'InApp' ? 'In-app' : name).join(' + '))}</dd></div><div><dt>${row.Status === 'Scheduled' ? 'Scheduled' : 'Sent'}</dt><dd>${html(deliveryTime ? new Date(deliveryTime).toLocaleString() : '')}</dd></div><div><dt>By</dt><dd>${html(row.CreatedBy || '')}</dd></div>${row.Channels?.Push && row.Status !== 'Scheduled' ? `<div><dt>Push status</dt><dd>${Number(row.PushDelivered || 0)} delivered · ${Number(row.PushQueued || 0)} queued${Number(row.PushFailed || 0) ? ` · ${Number(row.PushFailed)} failed` : ''}</dd></div>` : ''}</dl>
      ${row.Error ? `<p class="notification-announcement-error">${html(row.Error)}</p>` : ''}
    </article>`;
  }

  function renderAnnouncements(data = {}) {
    const allowed = data.canComposeAnnouncements === true;
    composeTab.hidden = !allowed;
    if (!allowed && dialog.querySelector('[data-notification-view="compose"]').classList.contains('is-active')) {
      dialog.querySelector('[data-notification-view="history"]').click();
    }
    const announcements = Array.isArray(data.announcements) ? data.announcements : [];
    announcementHistory.innerHTML = announcements.length
      ? announcements.map(announcementMarkup).join('')
      : '<p class="notification-empty">No school announcements have been sent yet.</p>';
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
    renderAnnouncements(currentData);
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

  async function drainAnnouncementPushQueue(initialCount, status) {
    let remaining = Math.max(0, Number(initialCount || 0));
    let processed = 0;
    while (remaining > 0 && processed < 25) {
      status.textContent = `Delivering push notifications… ${processed + 1} of ${Number(initialCount)} batch${Number(initialCount) === 1 ? '' : 'es'}`;
      const response = await request('/api/staff-notifications', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'processAnnouncementPush' })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.message || 'Push delivery will continue through the notification scheduler.');
      if (!Number(data.announcementPush?.inspected || 0)) break;
      remaining = Number(data.announcementPush?.remaining || 0);
      processed += 1;
    }
    await load(true);
    return remaining;
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
    renderAnnouncements(data);
  }

  function renderSettings(data = {}) {
    const form = dialog.querySelector('.notification-settings-form');
    const settings = data.settings || {};
    const permission = window.DynamaxWebPush?.permission?.() || 'unsupported';
    const thisDevice = (data.subscriptions || []).find((row) => row.DeviceId === window.DynamaxWebPush?.deviceId?.());
    const pushConfigured = data.messaging?.enabled === true;
    pushPrompt.hidden = Boolean(thisDevice) || !pushConfigured;
    pushPromptButton.hidden = permission === 'denied' || permission === 'unsupported';
    pushPrompt.querySelector('[data-notification-push-copy]').textContent = permission === 'denied'
      ? 'Notifications are blocked. Allow them for this site in browser settings, then reload.'
      : permission === 'granted'
        ? 'Permission is allowed, but this device is not connected. Tap to reconnect it.'
        : permission === 'unsupported'
          ? 'This browser cannot receive push. On iPhone or iPad, add this site to the Home Screen and open it there.'
          : 'Tap once to receive alerts even when this page is closed.';
    if (!settings.Categories) return;
    form.elements.QuietHoursEnabled.checked = settings.QuietHoursEnabled === true;
    form.elements.QuietHoursStart.value = settings.QuietHoursStart || '21:00';
    form.elements.QuietHoursEnd.value = settings.QuietHoursEnd || '06:00';
    form.elements.Timezone.value = settings.Timezone || 'Africa/Lagos';
    form.elements.FeeDueIntervals.value = (settings.FeeDueIntervals || [14, 7, 3, 1, 0]).join(', ');
    form.elements.FeeOverdueIntervals.value = (settings.FeeOverdueIntervals || [1, 7, 14, 30]).join(', ');
    form.elements.Templates.value = JSON.stringify(settings.Templates || {}, null, 2);
    form.elements.SubmittedRoles.value = (settings.WorkflowRecipients?.SubmittedRoles || ['Super Admin', 'Accounts Officer', 'Management']).join(', ');
    form.elements.ProcessingRoles.value = (settings.WorkflowRecipients?.ProcessingRoles || ['Super Admin', 'Accounts Officer']).join(', ');
    form.elements.ManagementRoles.value = (settings.WorkflowRecipients?.ManagementRoles || ['Super Admin', 'Management']).join(', ');
    form.querySelector('.notification-system-settings').hidden = !data.canManageSystemSettings;
    dialog.querySelector('[data-notification-settings-tab]').textContent = data.canManageSystemSettings ? 'School settings & devices' : 'Devices';
    form.querySelectorAll('[data-policy-audience]').forEach((section) => {
      const policy = settings.AudiencePolicies?.[section.dataset.policyAudience] || {};
      section.querySelectorAll('[data-policy-channel]').forEach((input) => {
        input.checked = policy.Channels?.[input.dataset.policyChannel] !== false;
      });
      section.querySelectorAll('[data-policy-category]').forEach((input) => {
        input.checked = policy.Categories?.[input.dataset.policyCategory] !== false;
      });
    });
    form.querySelector('[data-push-status]').textContent = !pushConfigured
      ? 'Push is not configured for this deployment.'
      : thisDevice ? `Enabled: ${thisDevice.DeviceName || 'this device'}` : `Status: ${permission}`;
    form.querySelector('[data-enable-push]').disabled = !data.messaging?.enabled || Boolean(thisDevice);
    form.querySelector('[data-disable-push]').disabled = !thisDevice;
    form.querySelector('[data-test-push]').disabled = !thisDevice;
    form.querySelector('.notification-device-list').innerHTML = (data.subscriptions || []).length
      ? `<strong>Subscribed devices</strong>${data.subscriptions.map((row) => `<span><span><b>${html(row.DeviceName || 'Browser device')}</b><small>${html(row.LastSeenAt ? new Date(row.LastSeenAt).toLocaleString() : '')}${row.DeviceId === window.DynamaxWebPush?.deviceId?.() ? ' · This device' : ''}</small></span><button type="button" class="notification-device-delete" data-remove-push-device="${html(row.DeviceId)}" aria-label="Delete ${html(row.DeviceName || 'browser device')}" title="Delete device">&#128465;</button></span>`).join('')}`
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
  dialog.querySelector('[data-refresh-announcements]').addEventListener('click', () => load(true).catch(() => {}));

  composeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = composeForm.querySelector('.notification-compose-status');
    const recipients = {
      DayStudents: composeForm.elements.DayStudents.checked,
      BoardingStudents: composeForm.elements.BoardingStudents.checked,
      Staff: composeForm.elements.Staff.checked
    };
    const recipientNames = [recipients.DayStudents ? 'day students' : '', recipients.BoardingStudents ? 'boarding students' : '', recipients.Staff ? 'staff' : ''].filter(Boolean);
    if (!recipientNames.length) { status.textContent = 'Select at least one recipient group.'; return; }
    const policies = currentData.settings?.AudiencePolicies || {};
    const blockedAudiences = [];
    if ((recipients.DayStudents || recipients.BoardingStudents) && policies.Parent?.Categories?.Announcements === false) blockedAudiences.push('parent portal users');
    if (recipients.Staff && policies.Staff?.Categories?.Announcements === false) blockedAudiences.push('staff app users');
    if (blockedAudiences.length) {
      status.textContent = `Announcements are disabled for ${blockedAudiences.join(' and ')} in School settings.`;
      return;
    }
    const scheduledValue = composeForm.elements.ScheduledAt.value;
    const scheduledAt = scheduledValue ? new Date(scheduledValue) : null;
    if (scheduledAt && Number.isNaN(scheduledAt.getTime())) { status.textContent = 'Choose a valid delivery date and time.'; return; }
    const action = scheduledAt && scheduledAt.getTime() > Date.now() ? `schedule this message for ${scheduledAt.toLocaleString()}` : 'send this message now';
    if (!window.confirm(`Are you sure you want to ${action} for ${recipientNames.join(', ')}?`)) return;
    const submit = composeForm.querySelector('[type="submit"]');
    submit.disabled = true;
    status.textContent = scheduledAt && scheduledAt.getTime() > Date.now() ? 'Scheduling notification...' : 'Sending notification...';
    try {
      const data = await update('sendAnnouncement', { announcement: {
        Title: composeForm.elements.Title.value,
        Message: composeForm.elements.Message.value,
        Recipients: recipients,
        Channels: {
          InApp: composeForm.elements.InApp.checked,
          Push: composeForm.elements.Push.checked
        },
        ScheduledAt: scheduledAt ? scheduledAt.toISOString() : ''
      } });
      composeForm.reset();
      composeForm.elements.InApp.checked = true;
      composeForm.elements.Push.checked = true;
      const queued = Number(data.announcement?.PushQueued || 0);
      if (queued) {
        const remaining = await drainAnnouncementPushQueue(queued, status);
        status.textContent = remaining
          ? `Notification sent. ${remaining} push batch${remaining === 1 ? '' : 'es'} will continue through the scheduler.`
          : 'Notification sent and push delivery processed.';
      } else status.textContent = data.message || 'Notification saved.';
    } catch (error) { status.textContent = error.message; }
    finally { submit.disabled = false; }
  });

  async function handleNotificationClick(event, sourceRecords) {
    const item = event.target.closest('[data-notification-id]');
    if (!item) return;
    const row = sourceRecords.find((entry) => entry.NotificationId === item.dataset.notificationId);
    if (event.target.closest('[data-delete-notification]')) {
      await update('archive', { notificationId: item.dataset.notificationId });
      return;
    }
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
  async function enablePushOnThisDevice() {
    const status = settingsForm.querySelector('.notification-settings-status');
    pushPromptButton.disabled = true;
    status.textContent = 'Connecting this device...';
    try {
      await window.DynamaxWebPush.enable(currentData.messaging, (subscription) => update('subscribePush', { subscription }));
      status.textContent = 'Push notifications are enabled on this device.';
    } catch (error) {
      status.textContent = error.message;
      pushPrompt.querySelector('[data-notification-push-copy]').textContent = error.message;
    } finally {
      pushPromptButton.disabled = false;
    }
  }
  pushPromptButton.addEventListener('click', enablePushOnThisDevice);
  settingsForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = settingsForm.querySelector('.notification-settings-status');
    try {
      await update('saveSettings', { settings: {
        QuietHoursEnabled: settingsForm.elements.QuietHoursEnabled.checked,
        QuietHoursStart: settingsForm.elements.QuietHoursStart.value,
        QuietHoursEnd: settingsForm.elements.QuietHoursEnd.value,
        Timezone: settingsForm.elements.Timezone.value
      } });
      status.textContent = 'Quiet hours saved.';
    } catch (error) { status.textContent = error.message; }
  });
  settingsForm.querySelector('[data-enable-push]').addEventListener('click', enablePushOnThisDevice);
  settingsForm.querySelector('[data-disable-push]').addEventListener('click', async () => {
    await window.DynamaxWebPush.disable((deviceId) => update('unsubscribePush', { deviceId })).catch((error) => { settingsForm.querySelector('.notification-settings-status').textContent = error.message; });
  });
  settingsForm.querySelector('[data-test-push]').addEventListener('click', async () => {
    const status = settingsForm.querySelector('.notification-settings-status');
    status.textContent = 'Sending test notification...';
    try { await update('testPush', { deviceId: window.DynamaxWebPush.deviceId() }); status.textContent = 'Test push delivered to this device.'; }
    catch (error) { status.textContent = error.message; }
  });
  settingsForm.querySelector('.notification-device-list').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-remove-push-device]');
    if (!button) return;
    try { await update('unsubscribePush', { deviceId: button.dataset.removePushDevice }); } catch (error) { settingsForm.querySelector('.notification-settings-status').textContent = error.message; }
  });
  settingsForm.querySelector('[data-save-system-settings]').addEventListener('click', async () => {
    const status = settingsForm.querySelector('.notification-settings-status');
    try {
      const templates = JSON.parse(settingsForm.elements.Templates.value || '{}');
      const audiencePolicies = {};
      settingsForm.querySelectorAll('[data-policy-audience]').forEach((section) => {
        const channels = {};
        const categories = {};
        section.querySelectorAll('[data-policy-channel]').forEach((input) => { channels[input.dataset.policyChannel] = input.checked; });
        section.querySelectorAll('[data-policy-category]').forEach((input) => { categories[input.dataset.policyCategory] = input.checked; });
        audiencePolicies[section.dataset.policyAudience] = { Channels: channels, Categories: categories };
      });
      await update('saveSystemSettings', { settings: {
        Timezone: settingsForm.elements.Timezone.value,
        FeeDueIntervals: settingsForm.elements.FeeDueIntervals.value,
        FeeOverdueIntervals: settingsForm.elements.FeeOverdueIntervals.value,
        Templates: templates,
        WorkflowRecipients: {
          SubmittedRoles: settingsForm.elements.SubmittedRoles.value.split(',').map((value) => value.trim()).filter(Boolean),
          ProcessingRoles: settingsForm.elements.ProcessingRoles.value.split(',').map((value) => value.trim()).filter(Boolean),
          ManagementRoles: settingsForm.elements.ManagementRoles.value.split(',').map((value) => value.trim()).filter(Boolean)
        },
        AudiencePolicies: audiencePolicies
      } });
      status.textContent = 'School notification policy saved.';
    } catch (error) { status.textContent = error instanceof SyntaxError ? 'Templates must be valid JSON.' : error.message; }
  });

  window.addEventListener('dynamax:foreground-notification', () => load(true));
  new MutationObserver(() => {
    if (!identity.hidden) load(true);
    else { popover.hidden = true; trigger.setAttribute('aria-expanded', 'false'); }
  }).observe(identity, { attributes: true, attributeFilter: ['hidden'] });
  window.setInterval(() => load(), 30000);
})();
