const loginForm = document.getElementById('parentLoginForm');
const loadDashboardBtn = document.getElementById('loadDashboardBtn');
const statusEl = document.getElementById('parentStatus');
const dashboardContent = document.getElementById('dashboardContent');
const childrenList = document.getElementById('childrenList');
const walletSummary = document.getElementById('walletSummary');
const walletLedger = document.getElementById('walletLedger');
const dueNotifications = document.getElementById('dueNotifications');
const payableItems = document.getElementById('payableItems');
const optionalPayments = document.getElementById('optionalPayments');
const accountCreditSummary = document.getElementById('accountCreditSummary');
const paymentRecords = document.getElementById('paymentRecords');
const entranceResultPanel = document.getElementById('entranceResultPanel');
const academicTermResults = document.getElementById('academicTermResults');
const entranceResults = document.getElementById('entranceResults');
const parentAcademicSchedule = document.getElementById('parentAcademicSchedule');
const parentAcademicAttendance = document.getElementById('parentAcademicAttendance');
const clinicRecords = document.getElementById('clinicRecords');
const schoolStores = document.getElementById('schoolStores');
const storeSearch = document.getElementById('storeSearch');
const storeSearchSummary = document.getElementById('storeSearchSummary');
const storeOrders = document.getElementById('storeOrders');
const storeCartEl = document.getElementById('storeCart');
const checkoutStoreCartBtn = document.getElementById('checkoutStoreCartBtn');
const storeCheckoutStatus = document.getElementById('storeCheckoutStatus');
const restrictionForm = document.getElementById('restrictionForm');
const walletStatus = document.getElementById('walletStatus');
const txnLimit = document.getElementById('txnLimit');
const dailyLimit = document.getElementById('dailyLimit');
const pinThreshold = document.getElementById('pinThreshold');
const refreshDashboardBtn = document.getElementById('refreshDashboardBtn');
const signOutDashboardBtn = document.getElementById('signOutDashboardBtn');
const changeParentPasswordBtn = document.getElementById('changeParentPasswordBtn');
const changeParentPasswordDialog = document.getElementById('changeParentPasswordDialog');
const changeParentPasswordForm = document.getElementById('changeParentPasswordForm');
const changeParentPasswordStatus = document.getElementById('changeParentPasswordStatus');
const dashboardNav = document.getElementById('dashboardNav');
const dashboardViewPanels = Array.from(document.querySelectorAll('[data-dashboard-view]'));
const parentDocumentUploadForm = document.getElementById('parentDocumentUploadForm');
const parentDocumentTarget = document.getElementById('parentDocumentTarget');
const parentUploadDocumentsBtn = document.getElementById('parentUploadDocumentsBtn');
const parentReplaceExistingDocument = document.getElementById('parentReplaceExistingDocument');
const parentDocumentUploadStatus = document.getElementById('parentDocumentUploadStatus');
const parentDocumentUploadResults = document.getElementById('parentDocumentUploadResults');
const parentDocumentUploadProgress = document.getElementById('parentDocumentUploadProgress');
const parentDocumentUploadProgressFill = document.getElementById('parentDocumentUploadProgressFill');
const parentDocumentUploadProgressText = document.getElementById('parentDocumentUploadProgressText');
const parentNotificationsBtn = document.getElementById('parentNotificationsBtn');
const parentNotificationBadge = document.getElementById('parentNotificationBadge');
const parentNotificationPanel = document.getElementById('parentNotificationPanel');
const parentNotificationList = document.getElementById('parentNotificationList');
const parentNotificationStatus = document.getElementById('parentNotificationStatus');
const markAllParentNotificationsReadBtn = document.getElementById('markAllParentNotificationsReadBtn');
const manageParentNotificationsBtn = document.getElementById('manageParentNotificationsBtn');
const parentNotificationDialog = document.getElementById('parentNotificationDialog');
const parentNotificationHistory = document.getElementById('parentNotificationHistory');

let dashboard = null;
let selectedChildKey = '';
let activeDashboardView = 'overview';
const notificationLinkedView = new URLSearchParams(window.location.search).get('tab') || new URLSearchParams(window.location.search).get('view');
if (['overview', 'payments', 'optional', 'results', 'academics', 'documents', 'wallet', 'clinic', 'stores'].includes(notificationLinkedView)) {
  activeDashboardView = notificationLinkedView;
}
const loadedPayables = new Set();
const passportPhotoCache = new Map();
const storeCart = new Map();
const parentDocumentIdempotencyKeys = new Map();
let selectedChildLoadController = null;
let dashboardLoadController = null;
let parentNotifications = [];
let parentNotificationMeta = {};
let parentNotificationHistoryRows = [];
const PARENT_DOCUMENT_MAX_FILE_SIZE = 8 * 1024 * 1024;

function newIdempotencyKey() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  const random = window.crypto?.getRandomValues
    ? Array.from(window.crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(16)).join('')
    : Math.random().toString(36).slice(2);
  return `${Date.now().toString(36)}-${random}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function childInitials(child) {
  return String(child.DisplayName || 'Student').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('') || 'ST';
}

function childCardHue(index) {
  return Math.round((207 + index * 137.508) % 360);
}

function childIdentity(child) {
  const scopePath = String(child?.__scopePath || '').trim().replace(/^\/+|\/+$/g, '').toLowerCase();
  const accountRef = String(child?.AccountRef || '').trim().toLowerCase();
  return `${scopePath}|${accountRef}`;
}

function childResult(map, child, fallback) {
  const value = map?.[childIdentity(child)];
  return value === undefined ? fallback : value;
}

function setChildResult(map, child, value) {
  map[childIdentity(child)] = value;
  return value;
}

function normalizeChildResultMaps(data) {
  const children = Array.isArray(data?.children) ? data.children : [];
  const referenceCounts = new Map();
  children.forEach((child) => {
    const reference = String(child?.AccountRef || '').trim().toLowerCase();
    referenceCounts.set(reference, (referenceCounts.get(reference) || 0) + 1);
  });

  const fields = [
    'walletActivity',
    'paymentRecords',
    'accountSummaries',
    'payableItems',
    'payableErrors',
    'dueNotifications',
    'clinicVisits',
    'academicResults',
    'entranceResults',
    'academicSchedules',
    'academicAttendanceSummaries'
  ];
  fields.forEach((field) => {
    const source = data?.[field] && typeof data[field] === 'object' ? data[field] : {};
    const scoped = {};
    children.forEach((child) => {
      const identity = childIdentity(child);
      if (Object.prototype.hasOwnProperty.call(source, identity)) {
        scoped[identity] = source[identity];
        return;
      }
      const accountRef = String(child?.AccountRef || '').trim();
      if (
        referenceCounts.get(accountRef.toLowerCase()) === 1
        && Object.prototype.hasOwnProperty.call(source, accountRef)
      ) {
        scoped[identity] = source[accountRef];
      }
    });
    data[field] = scoped;
  });

  data.storeCatalogByChild = data.storeCatalogByChild || {};
  data.storeOrdersByChild = data.storeOrdersByChild || {};
  data.resultSettingsByChild = data.resultSettingsByChild || {};
  children.forEach((child) => {
    const identity = childIdentity(child);
    const reference = String(child?.AccountRef || '').trim().toLowerCase();
    const uniqueReference = referenceCounts.get(reference) === 1;
    if (uniqueReference && !Object.prototype.hasOwnProperty.call(data.storeCatalogByChild, identity)) {
      data.storeCatalogByChild[identity] = Array.isArray(data.storeCatalog) ? data.storeCatalog : [];
    }
    if (uniqueReference && !Object.prototype.hasOwnProperty.call(data.storeOrdersByChild, identity)) {
      data.storeOrdersByChild[identity] = (Array.isArray(data.storeOrders) ? data.storeOrders : [])
        .filter((order) => String(order.AccountRef || order.AdmissionNo || '').trim().toLowerCase() === reference);
    }
    if (uniqueReference && !Object.prototype.hasOwnProperty.call(data.resultSettingsByChild, identity)) {
      data.resultSettingsByChild[identity] = {
        showResultsOnline: data.showResultsOnline,
        resultDisplayMode: data.resultDisplayMode
      };
    }
  });
}

function passportPhotoCacheKey(child, reference) {
  return `${childIdentity(child)}|${String(reference || '').trim().toLowerCase()}`;
}

async function loadPassportPhoto(child, image) {
  const reference = child.PassportPhotoApplicationReference || child.ApplicationReference || child.AccountRef;
  if (!child.PassportPhotoAvailable || !reference || !image) return;
  const cacheKey = passportPhotoCacheKey(child, reference);
  if (passportPhotoCache.has(cacheKey)) {
    image.src = passportPhotoCache.get(cacheKey);
    image.hidden = false;
    return;
  }
  try {
    const response = await fetch('/api/passport-photo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: freshBody({
        ...authPayload(),
        applicationReference: reference,
        scopePath: child.__scopePath || ''
      })
    });
    if (!response.ok) return;
    const objectUrl = URL.createObjectURL(await response.blob());
    passportPhotoCache.set(cacheKey, objectUrl);
    image.src = objectUrl;
    image.hidden = false;
  } catch (_error) {
    // The initials placeholder remains visible when an image cannot be previewed.
  }
}

function schedulePassportPhoto(child, image) {
  if (!child.PassportPhotoAvailable || !image) return;
  const start = () => loadPassportPhoto(child, image);
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(start, { timeout: 1500 });
  } else {
    window.setTimeout(start, 100);
  }
}

function freshBody(payload) {
  return JSON.stringify({
    ...payload,
    _ts: Date.now()
  });
}

function setStatus(message, type) {
  statusEl.textContent = message || '';
  statusEl.className = 'status ' + (type || '');
}

function setLoginLoading(loading) {
  if (!loadDashboardBtn) return;
  loadDashboardBtn.disabled = loading;
  loadDashboardBtn.classList.toggle('is-loading', loading);
  loadDashboardBtn.setAttribute('aria-busy', loading ? 'true' : 'false');
  loadDashboardBtn.textContent = loading ? 'Opening dashboard...' : 'Open Dashboard';
}

function setActionLoading(button, loading, loadingText = 'Working...', normalText = '') {
  if (!button) return;
  const restingText = normalText || button.dataset.normalText || button.textContent;
  if (loading) button.dataset.normalText = restingText;
  button.disabled = loading;
  button.classList.toggle('is-loading', loading);
  button.setAttribute('aria-busy', loading ? 'true' : 'false');
  button.textContent = loading ? loadingText : restingText;
  if (!loading) delete button.dataset.normalText;
}

function money(value) {
  const amount = Number(String(value || '0').replace(/,/g, ''));
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN'
  }).format(Number.isFinite(amount) ? amount : 0);
}

function authPayload() {
  return {
    email: document.getElementById('parentEmail').value.trim().toLowerCase(),
    code: document.getElementById('verificationCode').value.trim()
  };
}

function selectedChild() {
  return (dashboard?.children || []).find((child) => childIdentity(child) === selectedChildKey) || null;
}

function parentDocumentApplicationReference(child) {
  return String(child?.ApplicationReference || child?.PassportPhotoApplicationReference || child?.AccountRef || '').trim();
}

function resetParentDocumentSelection() {
  parentDocumentUploadForm?.reset();
  if (parentDocumentUploadResults) parentDocumentUploadResults.innerHTML = '';
  if (parentDocumentUploadStatus) {
    parentDocumentUploadStatus.textContent = '';
    parentDocumentUploadStatus.className = 'status';
  }
  if (parentDocumentUploadProgress) parentDocumentUploadProgress.hidden = true;
  if (parentDocumentUploadProgressFill) parentDocumentUploadProgressFill.style.width = '0%';
  if (parentDocumentUploadProgressText) parentDocumentUploadProgressText.textContent = 'Preparing upload...';
}

function renderParentDocumentTarget(child) {
  if (!parentDocumentTarget) return;
  const reference = parentDocumentApplicationReference(child);
  parentDocumentTarget.textContent = child
    ? `Uploading for: ${child.DisplayName || 'Selected student'}${reference ? ` (${reference})` : ''}`
    : 'Select a student before uploading documents.';
}

function parentNotificationId(notification) {
  return String(
    notification?.NotificationId
    || notification?.notificationId
    || notification?.Id
    || notification?.id
    || notification?.__id
    || ''
  ).trim();
}

function parentNotificationIsRead(notification) {
  const value = notification?.Read ?? notification?.read ?? notification?.IsRead ?? notification?.isRead;
  return value === true || ['yes', 'true', '1', 'read'].includes(String(value || '').trim().toLowerCase());
}

function setParentNotificationStatus(message, type = '') {
  if (!parentNotificationStatus) return;
  parentNotificationStatus.textContent = message || '';
  parentNotificationStatus.className = `status ${type}`.trim();
}

function openParentNotificationAction(actionUrl) {
  if (!actionUrl) return;
  try {
    const target = new URL(actionUrl, window.location.href);
    if (target.origin === window.location.origin) {
      const view = target.searchParams.get('tab') || target.searchParams.get('view');
      if (view) showDashboardView(view, true);
      parentNotificationPanel.hidden = true;
      parentNotificationsBtn?.setAttribute('aria-expanded', 'false');
      parentNotificationDialog?.close();
      return;
    }
    if (target.protocol === 'https:') window.open(target.href, '_blank', 'noopener,noreferrer');
  } catch {}
}

function renderParentNotifications() {
  if (!parentNotificationList) return;
  const unreadCount = parentNotifications.filter((item) => !parentNotificationIsRead(item)).length;
  if (parentNotificationBadge) {
    parentNotificationBadge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
    parentNotificationBadge.hidden = unreadCount === 0;
  }
  parentNotificationList.innerHTML = parentNotifications.length
    ? ''
    : '<p class="muted">You have no notifications at the moment.</p>';
  parentNotifications.forEach((notification) => {
    const isRead = parentNotificationIsRead(notification);
    const item = document.createElement('article');
    item.className = 'parent-notification-row';
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `parent-notification-item${isRead ? '' : ' unread'}`;
    const title = notification.Title || notification.title || notification.Type || notification.type || 'School notification';
    const message = notification.Message || notification.message || notification.Body || notification.body || '';
    const dateValue = notification.DisplayDate || notification.displayDate || notification.CreatedAt || notification.createdAt || notification.Date || notification.date || '';
    const parsedDate = dateValue ? new Date(dateValue) : null;
    const date = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toLocaleString() : dateValue;
    row.innerHTML = `
      <span>
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(message)}</span>
      </span>
      <small>${escapeHtml(date)}</small>
    `;
    row.setAttribute('aria-label', isRead ? title : `${title}. Mark as read`);
    row.addEventListener('click', async () => {
      if (!isRead) await markParentNotificationRead(parentNotificationId(notification), false, row);
      openParentNotificationAction(notification.ActionUrl || notification.actionUrl);
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'parent-notification-delete';
    remove.textContent = '\u00d7';
    remove.title = 'Delete from tray';
    remove.setAttribute('aria-label', `Delete ${title} from tray`);
    remove.addEventListener('click', async () => {
      try {
        const data = await parentNotificationRequest('archiveNotification', { notificationId: parentNotificationId(notification) });
        parentNotifications = data.notifications || [];
        renderParentNotifications();
        setParentNotificationStatus('Notification removed from the tray.', 'good');
      } catch (error) { setParentNotificationStatus(error.message, 'bad'); }
    });
    item.append(row, remove);
    parentNotificationList.appendChild(item);
  });
  if (markAllParentNotificationsReadBtn) {
    markAllParentNotificationsReadBtn.disabled = unreadCount === 0;
  }
  renderParentPushPrompt();
}

function renderParentPushPrompt() {
  const prompt = document.getElementById('parentPushPrompt');
  const button = document.getElementById('enableParentPushPrompt');
  const copy = document.getElementById('parentPushPromptCopy');
  if (!prompt || !button || !copy) return;
  const permission = window.DynamaxWebPush?.permission?.() || 'unsupported';
  const thisDevice = (parentNotificationMeta.subscriptions || []).find((row) => row.DeviceId === window.DynamaxWebPush?.deviceId?.());
  prompt.hidden = Boolean(thisDevice) || parentNotificationMeta.messaging?.enabled !== true;
  button.hidden = permission === 'denied' || permission === 'unsupported';
  copy.textContent = permission === 'denied'
    ? 'Notifications are blocked. Allow them for this site in browser settings, then reload.'
    : permission === 'granted'
      ? 'Permission is allowed, but this device is not connected. Tap to reconnect it.'
      : permission === 'unsupported'
        ? 'This browser cannot receive push. On iPhone or iPad, add this site to the Home Screen and open it there.'
        : 'Tap once to receive alerts even when this page is closed.';
}

function parentNotificationErrorMessage(error) {
  const message = String(error?.message || error || '').trim();
  if (/too many subrequests|workers\/wrangler\/configuration\/#limits/i.test(message)) {
    return 'The notification service is temporarily busy. Please wait a moment and try again.';
  }
  return message || 'Could not update notifications.';
}

async function loadParentNotifications() {
  if (!dashboard || !parentNotificationList) return;
  try {
    const response = await fetch('/api/parent-dashboard', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: freshBody({
        action: 'getNotifications',
        limit: 30,
        ...authPayload(),
        accountRefs: (dashboard.children || []).map((child) => child.AccountRef).filter(Boolean)
      })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.message || 'Could not load notifications.');
    parentNotificationMeta = data;
    parentNotifications = data.notifications || [];
    renderParentNotifications();
    setParentNotificationStatus('', '');
  } catch (error) {
    parentNotifications = [];
    renderParentNotifications();
    setParentNotificationStatus(parentNotificationErrorMessage(error), 'bad');
  }
}

async function parentNotificationRequest(action, extra = {}) {
  const response = await fetch('/api/parent-dashboard', {
    method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
    body: freshBody({ action, ...authPayload(), ...extra })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(parentNotificationErrorMessage(data.message || 'Could not update notifications.'));
  parentNotificationMeta = { ...parentNotificationMeta, ...data };
  return parentNotificationMeta;
}

function parentHistoryMarkup(row) {
  const id = parentNotificationId(row);
  return `<article class="notification-item${parentNotificationIsRead(row) ? ' is-read' : ''}" data-parent-notification-id="${escapeHtml(id)}">
    <button type="button" class="notification-open"><span class="notification-item-dot"></span><span class="notification-item-copy"><small>${escapeHtml(row.Category || row.Type || 'System')}</small><strong>${escapeHtml(row.Title || 'Notification')}</strong><span>${escapeHtml(row.Message || '')}</span><time>${escapeHtml(row.CreatedAt ? new Date(row.CreatedAt).toLocaleString() : '')}</time></span></button>
    <button type="button" class="notification-archive-action" data-parent-archive>${row.Archived ? 'Restore' : 'Archive'}</button>
  </article>`;
}

async function loadParentNotificationHistory(append = false) {
  const cursor = append ? parentNotificationMeta.nextCursor : '';
  const data = await parentNotificationRequest('getNotifications', {
    limit: 30,
    before: cursor,
    category: document.getElementById('parentNotificationCategory').value,
    unread: document.getElementById('parentNotificationUnread').checked,
    archived: document.getElementById('parentNotificationArchived').checked
  });
  parentNotificationHistoryRows = append ? [...parentNotificationHistoryRows, ...(data.notifications || [])] : (data.notifications || []);
  parentNotificationHistory.innerHTML = parentNotificationHistoryRows.length ? parentNotificationHistoryRows.map(parentHistoryMarkup).join('') : '<p class="notification-empty">No notifications match these filters.</p>';
  document.getElementById('loadMoreParentNotifications').hidden = !data.hasMore;
}

async function markParentNotificationRead(notificationId, all = false, button = null) {
  if (!all && !notificationId) return;
  const restingText = button?.textContent || '';
  setActionLoading(button, true, 'Updating...', restingText);
  try {
    const response = await fetch('/api/parent-dashboard', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: freshBody({
        action: 'markNotificationRead',
        ...authPayload(),
        notificationId,
        all
      })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.message || 'Could not update the notification.');
    await loadParentNotifications();
  } catch (error) {
    setParentNotificationStatus(error.message, 'bad');
  } finally {
    if (button?.isConnected) setActionLoading(button, false, '', restingText);
  }
}

function showDashboardView(view, scrollToContent = false) {
  activeDashboardView = view || 'overview';
  dashboardViewPanels.forEach((panel) => {
    panel.hidden = panel.dataset.dashboardView !== activeDashboardView;
  });
  dashboardNav?.querySelectorAll('[data-dashboard-target]').forEach((button) => {
    const selected = button.dataset.dashboardTarget === activeDashboardView;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-selected', selected ? 'true' : 'false');
    if (selected && window.matchMedia('(max-width: 680px)').matches) {
      window.requestAnimationFrame(() => button.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' }));
    }
  });
  if (scrollToContent && window.matchMedia('(max-width: 680px)').matches) {
    const targetPanel = dashboardViewPanels.find((panel) => panel.dataset.dashboardView === activeDashboardView);
    if (targetPanel) {
      window.requestAnimationFrame(() => {
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        targetPanel.scrollIntoView({
          behavior: reducedMotion ? 'auto' : 'smooth',
          block: 'start'
        });
      });
    }
  }
}

function renderChildren() {
  childrenList.innerHTML = '';
  const children = dashboard?.children || [];
  children.forEach((child, index) => {
    const identity = childIdentity(child);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'child-card' + (identity === selectedChildKey ? ' selected' : '');
    button.style.setProperty('--child-hue', String(childCardHue(index)));
    button.innerHTML = `
      <span class="child-card-layout">
        <span class="child-passport" aria-hidden="true">
          <span class="child-passport-initials">${escapeHtml(childInitials(child))}</span>
          <img alt="" loading="lazy" decoding="async" hidden>
        </span>
        <span class="child-card-copy">
          <strong>${escapeHtml(child.DisplayName || 'Student')}</strong>
          <span>${escapeHtml(child.AccountRef || '')}</span>
          <span>${escapeHtml([child.ClassName, child.ClassArm, child.StudentType].filter(Boolean).join(' | '))}</span>
          <span>Status: ${escapeHtml(child.Status || 'Active')}</span>
        </span>
      </span>
    `;
    button.addEventListener('click', () => {
      if (selectedChildKey === identity) return;
      storeCart.clear();
      resetParentDocumentSelection();
      selectedChildKey = identity;
      renderDashboard();
      loadPayablesForSelected();
    });
    childrenList.appendChild(button);
    schedulePassportPhoto(child, button.querySelector('.child-passport img'));
  });
}

function renderWallet(child) {
  walletSummary.innerHTML = `
    <div><strong>${money(child.WalletBalance)}</strong><span>Wallet Balance</span></div>
    <div><strong>${child.WalletCardStatus || 'Active'}</strong><span>Card Status</span></div>
    <div><strong>${money(child.WalletTxnLimit)}</strong><span>Per Purchase Limit</span></div>
    <div><strong>${money(child.WalletDailyLimit)}</strong><span>Daily Limit</span></div>
  `;

  walletStatus.value = child.WalletCardStatus || 'Active';
  txnLimit.value = child.WalletTxnLimit || '';
  dailyLimit.value = child.WalletDailyLimit || '';
  pinThreshold.value = child.WalletPinThreshold || '';

  const entries = childResult(dashboard.walletActivity, child, []);
  walletLedger.innerHTML = entries.length ? '' : '<p class="muted">No wallet activity found.</p>';
  if (entries.length > 5) {
    const details = document.createElement('details');
    details.className = 'collapsible-activity';
    const summary = document.createElement('summary');
    summary.textContent = `Show ${entries.length} wallet purchase / top-up activities`;
    details.appendChild(summary);
    walletLedger.appendChild(details);
    entries.slice(0, 100).forEach((entry) => {
      const item = document.createElement('div');
      item.className = 'activity-item';
      item.innerHTML = `
        <strong>${entry.Description || entry.EntryType || 'Wallet activity'}</strong>
        <span>${entry.Date || ''} | ${entry.Debit ? '-' + money(entry.Debit) : '+' + money(entry.Credit)}</span>
        <small>${entry.RecordedBy || entry.Source || ''}</small>
      `;
      details.appendChild(item);
    });
    return;
  }
  entries.slice(0, 20).forEach((entry) => {
    const item = document.createElement('div');
    item.className = 'activity-item';
    item.innerHTML = `
      <strong>${entry.Description || entry.EntryType || 'Wallet activity'}</strong>
      <span>${entry.Date || ''} | ${entry.Debit ? '-' + money(entry.Debit) : '+' + money(entry.Credit)}</span>
      <small>${entry.RecordedBy || entry.Source || ''}</small>
    `;
    walletLedger.appendChild(item);
  });
}

function accountSummaryFor(child) {
  const summary = childResult(dashboard.accountSummaries, child, child || {});
  const totalDebit = Number(String(summary.TotalDebit || '0').replace(/,/g, ''));
  const totalCredit = Number(String(summary.TotalCredit || '0').replace(/,/g, ''));
  const outstanding = Number(String(summary.OutstandingBalance || '0').replace(/,/g, ''));
  const creditBalance = Number(String(summary.CreditBalance || '0').replace(/,/g, ''));
  return {
    TotalDebit: Number.isFinite(totalDebit) ? totalDebit : 0,
    TotalCredit: Number.isFinite(totalCredit) ? totalCredit : 0,
    OutstandingBalance: Number.isFinite(outstanding) ? outstanding : 0,
    CreditBalance: Number.isFinite(creditBalance) ? creditBalance : 0
  };
}

function renderAccountCredit(child) {
  if (!accountCreditSummary) return;
  const summary = accountSummaryFor(child);
  const creditNote = summary.CreditBalance > 0
    ? `<p class="credit-note">This credit will be applied automatically to future school charges unless Accounts refunds or reallocates it.</p>`
    : '';
  accountCreditSummary.innerHTML = `
    <div><strong>${money(summary.TotalDebit)}</strong><span>Total Fee Charges</span></div>
    <div><strong>${money(summary.TotalCredit)}</strong><span>Total Fee Payments</span></div>
    <div><strong>${money(summary.OutstandingBalance)}</strong><span>Outstanding Balance</span></div>
    <div class="${summary.CreditBalance > 0 ? 'credit-good' : ''}"><strong>${money(summary.CreditBalance)}</strong><span>Credit Balance</span></div>
    ${creditNote}
  `;
}

function isYes(value) {
  return ['yes', 'y', 'true', '1'].includes(String(value || '').trim().toLowerCase());
}

function isWalletFee(fee) {
  return String(fee.FeeCode || '').trim() === 'WALLET_TOPUP' || String(fee.FeeCategory || '').trim().toLowerCase() === 'wallet';
}

function allowsItemPartPayment(fee) {
  const mode = String(fee.PartPaymentMode || 'Item').trim().toLowerCase();
  return isYes(fee.AllowInstallment) && (mode === 'item' || mode === 'both');
}

function feeCategory(fee) {
  return String(fee.FeeCategory || '').trim().toLowerCase();
}

function isBusFee(fee) {
  return feeCategory(fee) === 'bus service' || feeCategory(fee) === 'transport';
}

function isClubFee(fee) {
  return feeCategory(fee) === 'club';
}

function isOtherOptionalFee(fee) {
  return ['optional', 'others'].includes(feeCategory(fee));
}

function busModeFor(fee) {
  const text = `${fee.FeeName || ''} ${fee.FeeCode || ''}`.toLowerCase();
  if (text.includes('one way') || text.includes('one-way') || text.includes('single')) return 'One Way';
  if (text.includes('two way') || text.includes('two-way') || text.includes('return')) return 'Two Way';
  return 'General';
}

function busRouteFor(fee) {
  let name = String(fee.FeeName || fee.FeeCode || 'Bus Route').trim();
  name = name
    .replace(/bus\s*route/ig, '')
    .replace(/bus\s*service/ig, '')
    .replace(/transport/ig, '')
    .replace(/one[-\s]*way/ig, '')
    .replace(/two[-\s]*way/ig, '')
    .replace(/return/ig, '')
    .replace(/single/ig, '')
    .replace(/^[\s:|/-]+|[\s:|/-]+$/g, '')
    .trim();
  return name || 'Route';
}

function clubNameFor(fee) {
  return String(fee.FeeName || fee.FeeCode || 'Club').replace(/paid\s*club|club\s*subscription/ig, '').replace(/^[\s:|/-]+|[\s:|/-]+$/g, '').trim() || String(fee.FeeName || fee.FeeCode || 'Club');
}

function optionalNameFor(fee) {
  return String(fee.FeeName || fee.FeeCode || 'Optional Service').replace(/optional\s*service|others/ig, '').replace(/^[\s:|/-]+|[\s:|/-]+$/g, '').trim() || String(fee.FeeName || fee.FeeCode || 'Optional Service');
}

function renderComponents(parent, components) {
  const groups = {};
  (components || []).forEach((component) => {
    const category = component.FeeCategory || component.Department || 'School Fee';
    groups[category] = groups[category] || [];
    groups[category].push(component);
  });
  Object.entries(groups).forEach(([category, rows]) => {
    const heading = document.createElement('small');
    heading.className = 'component-heading';
    heading.textContent = category;
    parent.appendChild(heading);
    const list = document.createElement('ul');
    list.className = 'component-list';
    rows.forEach((component) => {
      const line = document.createElement('li');
      const originalAmount = component.OriginalAmount || component.Amount;
      line.textContent = `${component.FeeName || component.FeeCode}: ${money(originalAmount)}`;
      list.appendChild(line);
    });
    parent.appendChild(list);
  });
}

function renderSubscriptionSelector(child, title, fees, options = {}) {
  if (!fees.length) return null;
  const box = document.createElement('div');
  box.className = 'activity-item payment-action subscription-selector';
  const selectedFee = { current: null };
  const status = document.createElement('small');
  status.className = 'payment-status status';
  const amountLine = document.createElement('span');
  amountLine.className = 'subscription-amount muted';

  const heading = document.createElement('strong');
  heading.textContent = title;
  box.appendChild(heading);

  const routeSelect = document.createElement('select');
  const modeSelect = document.createElement('select');
  const clubSelect = document.createElement('select');

  if (options.kind === 'bus') {
    const routes = [...new Set(fees.map(busRouteFor))].sort();
    routes.forEach((route) => {
      const opt = document.createElement('option');
      opt.value = route;
      opt.textContent = route;
      routeSelect.appendChild(opt);
    });
    ['One Way', 'Two Way', 'General'].forEach((mode) => {
      if (!fees.some((fee) => busModeFor(fee) === mode)) return;
      const opt = document.createElement('option');
      opt.value = mode;
      opt.textContent = mode;
      modeSelect.appendChild(opt);
    });
    box.appendChild(document.createTextNode('Route'));
    box.appendChild(routeSelect);
    box.appendChild(document.createTextNode('Mode'));
    box.appendChild(modeSelect);
  } else {
    fees.forEach((fee, index) => {
      const opt = document.createElement('option');
      opt.value = String(index);
      const label = options.kind === 'club' ? clubNameFor(fee) : optionalNameFor(fee);
      opt.textContent = `${label} - ${money(fee.Amount)}`;
      clubSelect.appendChild(opt);
    });
    box.appendChild(document.createTextNode(options.kind === 'club' ? 'Club' : 'Item'));
    box.appendChild(clubSelect);
  }

  function chooseFee() {
        if (payButton) delete payButton.dataset.idempotencyKey;
    if (options.kind === 'bus') {
      selectedFee.current = fees.find((fee) => busRouteFor(fee) === routeSelect.value && busModeFor(fee) === modeSelect.value) || null;
    } else {
      selectedFee.current = fees[Number(clubSelect.value || 0)] || null;
    }
    amountLine.textContent = selectedFee.current
      ? `Amount: ${money(selectedFee.current.Amount)}${selectedFee.current.Term ? ' | ' + selectedFee.current.Term : ''}`
      : 'No price has been set for this selection.';
    status.textContent = '';
    status.className = 'payment-status status';
    payButton.disabled = !selectedFee.current;
  }

  routeSelect.addEventListener('change', chooseFee);
  modeSelect.addEventListener('change', chooseFee);
  clubSelect.addEventListener('change', chooseFee);

  const payButton = document.createElement('button');
  payButton.type = 'button';
  payButton.textContent = 'Pay Selected';
  payButton.disabled = true;
  payButton.addEventListener('click', () => {
    chooseFee();
    if (!selectedFee.current) {
      status.textContent = 'No matching amount was found for this selection.';
      status.className = 'payment-status status bad';
      payButton.disabled = true;
      return;
    }
    payItem(child, selectedFee.current, box);
  });
  box.appendChild(amountLine);
  box.appendChild(payButton);
  box.appendChild(status);
  chooseFee();
  return box;
}

function activityTarget(container, records, label) {
  container.innerHTML = '';
  if ((records || []).length <= 5) return container;
  const details = document.createElement('details');
  details.className = 'collapsible-activity';
  const summary = document.createElement('summary');
  summary.textContent = `Show ${records.length} ${label}`;
  details.appendChild(summary);
  container.appendChild(details);
  return details;
}

function renderDueNotifications(child) {
  const records = childResult(dashboard.dueNotifications, child, []);
  dueNotifications.innerHTML = records.length ? '' : '<p class="muted">No payment due date notifications at the moment.</p>';
  records.forEach((record) => {
    const item = document.createElement('div');
    item.className = 'activity-item';
    const displayAmount = record.OriginalAmount || record.Amount;
    item.innerHTML = `
      <strong>${record.FeeName || record.FeeCode || 'Payment due'}</strong>
      <span>${record.DueStatus || 'Due date set'} | ${record.DueDate || ''} | ${money(displayAmount)}</span>
      <small>${[record.AcademicSession, record.Term].filter(Boolean).join(' | ')}</small>
    `;
    if (record.Components?.length) {
      renderComponents(item, record.Components);
    }
    dueNotifications.appendChild(item);
  });
}

async function loadPayablesForSelected(force = false) {
  const child = selectedChild();
  if (!child) return;
  const identity = childIdentity(child);
  selectedChildLoadController?.abort();
  if (!force && loadedPayables.has(identity)) return;
  const controller = new AbortController();
  selectedChildLoadController = controller;
  loadedPayables.delete(identity);
  dashboard.payableItems = dashboard.payableItems || {};
  dashboard.payableErrors = dashboard.payableErrors || {};
  dashboard.dueNotifications = dashboard.dueNotifications || {};
  dashboard.accountSummaries = dashboard.accountSummaries || {};
  dashboard.walletActivity = dashboard.walletActivity || {};
  dashboard.paymentRecords = dashboard.paymentRecords || {};
  dashboard.clinicVisits = dashboard.clinicVisits || {};
  dashboard.academicResults = dashboard.academicResults || {};
  dashboard.entranceResults = dashboard.entranceResults || {};
  dashboard.academicSchedules = dashboard.academicSchedules || {};
  dashboard.academicAttendanceSummaries = dashboard.academicAttendanceSummaries || {};
  dashboard.storeCatalogByChild = dashboard.storeCatalogByChild || {};
  dashboard.storeOrdersByChild = dashboard.storeOrdersByChild || {};
  dashboard.resultSettingsByChild = dashboard.resultSettingsByChild || {};
  setChildResult(dashboard.payableItems, child, []);
  setChildResult(dashboard.payableErrors, child, '');
  renderPayableItems(child);
  renderDueNotifications(child);
  renderWallet(child);
  renderPayments(child);
  renderClinic(child);
  renderAcademicResults(child);
  renderEntranceResults(child);
  renderAcademicSchedule(child);
  renderAcademicAttendance(child);
  try {
    const baseBody = {
      ...authPayload(),
      accountRef: child.AccountRef,
      sourceType: child.SourceType || 'Student',
      scopePath: child.__scopePath || '',
      branchId: child.BranchId || 'main',
      schoolSection: child.SchoolSection || 'secondary'
    };
    const payableRequest = fetch('/api/parent-dashboard', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: freshBody({
        action: 'getChildPayable',
        ...baseBody
      })
    });
    const activityRequest = fetch('/api/parent-dashboard', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: freshBody({
        action: 'getChildActivity',
        ...baseBody
      })
    });
    const [payableResponse, activityResponse] = await Promise.all([payableRequest, activityRequest]);
    const payableData = await payableResponse.json();
    const activityData = await activityResponse.json();
    if (controller.signal.aborted) return;
    if (!payableResponse.ok || !payableData.ok) {
      setChildResult(dashboard.payableErrors, child, payableData.message || 'Could not load payable items.');
    } else {
      setChildResult(dashboard.payableItems, child, payableData.payableItems || []);
      setChildResult(dashboard.dueNotifications, child, payableData.dueNotifications || []);
    }
    if (activityResponse.ok && activityData.ok) {
      const payableNotices = childResult(dashboard.dueNotifications, child, []);
      const activityNotices = activityData.dueNotifications || [];
      setChildResult(dashboard.dueNotifications, child, [...new Map(
        [...payableNotices, ...activityNotices].map((notice) => [[
          notice.FeeCode,
          notice.FeeName,
          notice.DueDate,
          notice.AcademicSession,
          notice.Term
        ].map((value) => String(value || '').trim().toLowerCase()).join('|'), notice])
      ).values()]);
      dashboard.resultSettingsByChild[identity] = {
        showResultsOnline: activityData.showResultsOnline,
        resultDisplayMode: activityData.resultDisplayMode
      };
      setChildResult(dashboard.walletActivity, child, activityData.walletActivity || []);
      if (activityData.accountSummary) {
        setChildResult(dashboard.accountSummaries, child, activityData.accountSummary);
        Object.assign(child, activityData.accountSummary);
      }
      setChildResult(dashboard.paymentRecords, child, activityData.paymentRecords || []);
      setChildResult(dashboard.clinicVisits, child, activityData.clinicVisits || []);
      setChildResult(dashboard.academicResults, child, activityData.academicResults || []);
      setChildResult(dashboard.entranceResults, child, activityData.entranceResults || []);
      setChildResult(dashboard.academicSchedules, child, activityData.academicSchedule || []);
      setChildResult(dashboard.academicAttendanceSummaries, child, activityData.academicAttendanceSummary || {});
      dashboard.storeCatalogByChild[identity] = activityData.storeCatalog || [];
      dashboard.storeOrdersByChild[identity] = activityData.storeOrders || [];
      child.WalletBalance = activityData.walletBalance ?? child.WalletBalance;
    } else {
      setChildResult(
        dashboard.payableErrors,
        child,
        childResult(dashboard.payableErrors, child, '') || activityData.message || 'Could not load child activity.'
      );
    }
    if (payableResponse.ok && payableData.ok && activityResponse.ok && activityData.ok) {
      loadedPayables.add(identity);
    }
  } catch (error) {
    if (error?.name === 'AbortError') return;
    setChildResult(dashboard.payableItems, child, []);
    setChildResult(dashboard.dueNotifications, child, []);
    setChildResult(dashboard.payableErrors, child, error.message);
  } finally {
    if (selectedChildLoadController === controller) selectedChildLoadController = null;
  }
  if (selectedChildKey !== identity) return;
  renderPayableItems(child);
  renderDueNotifications(child);
  renderAccountCredit(child);
  renderWallet(child);
  renderPayments(child);
  renderClinic(child);
  renderAcademicResults(child);
  renderEntranceResults(child);
  renderAcademicSchedule(child);
  renderAcademicAttendance(child);
  renderStores(child);
}

function amountInputId(fee) {
  return `amount-${String(fee.FeeCode || 'fee').replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

function setPaymentStatus(container, message, type) {
  const target = container && container.querySelector('.payment-status');
  if (!target) {
    setStatus(message, type);
    return;
  }
  target.textContent = message || '';
  target.className = 'payment-status status ' + (type || '');
}

function paymentAmountFor(fee, container) {
  const input = document.getElementById(amountInputId(fee));
  const amount = Number(String(fee.Amount || '0').replace(/,/g, ''));
  const max = Number(String(fee.MaxAmount || '0').replace(/,/g, ''));
  if (isWalletFee(fee) && isYes(fee.WalletLimitReached)) {
    setPaymentStatus(container, 'This wallet has reached the maximum balance allowed for this class.', 'bad');
    return null;
  }
  if (!isWalletFee(fee) && !isYes(fee.AllowInstallment)) return amount;
  const min = Number(String(fee.MinAmount || '0').replace(/,/g, ''));
  const entered = input ? input.value : '';
  const value = Number(String(entered || '0').replace(/,/g, ''));
  if (!Number.isFinite(value) || value <= 0) {
    setPaymentStatus(container, 'Enter a valid amount.', 'bad');
    return null;
  }
  if (Number.isFinite(min) && min > 0 && value < min) {
    setPaymentStatus(container, `Minimum amount is ${money(min)}.`, 'bad');
    return null;
  }
  const limit = isWalletFee(fee) && Number.isFinite(max) && max > 0 ? max : amount;
  if (Number.isFinite(limit) && limit > 0 && value > limit) {
    setPaymentStatus(container, `Maximum amount is ${money(limit)}.`, 'bad');
    return null;
  }
  setPaymentStatus(container, '', '');
  return value;
}

async function payItem(child, fee, container) {
  const amount = paymentAmountFor(fee, container);
  if (amount === null) return;
  const payButton = container?.querySelector('button');
  if (payButton?.disabled) return;
  let paymentChoice;
  try {
    paymentChoice = await window.DynamaxPaymentMethods.choose({ branchId: child.BranchId || 'main', currency: fee.Currency || 'NGN', amount });
    if (!paymentChoice) return;
  } catch (error) {
    setPaymentStatus(container, error.message || String(error), 'bad');
    return;
  }
  const idempotencyKey = payButton?.dataset.idempotencyKey || newIdempotencyKey();
  if (payButton) {
    payButton.dataset.idempotencyKey = idempotencyKey;
    setActionLoading(payButton, true, paymentChoice.paymentMethod === 'direct_bank_transfer' ? 'Submitting transfer...' : 'Opening checkout...');
  }
  let responseReceived = false;
  try {
    setPaymentStatus(container, 'Starting secure checkout...', '');
    const turnstile = window.DynamaxPublicApi?.getTurnstileToken
      ? await window.DynamaxPublicApi.getTurnstileToken('init_payment')
      : {};
    const response = await fetch('/api/init-payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify({
        ...authPayload(),
        accountRef: child.AccountRef,
        sourceType: child.SourceType || 'Student',
        scopePath: child.__scopePath || '',
        feeCode: fee.FeeCode,
        components: fee.Components || undefined,
        amount: (isWalletFee(fee) || isYes(fee.AllowInstallment)) ? amount : undefined,
        ...paymentChoice,
        idempotencyKey,
        ...turnstile
      })
    });
    responseReceived = true;
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || 'Could not initialize payment.');
    }
    if (data.directTransfer) {
      delete payButton.dataset.idempotencyKey;
      setPaymentStatus(container, window.DynamaxPaymentMethods.directTransferMessage(data), 'ok');
      setActionLoading(payButton, false);
      return;
    }
    window.location.href = data.authorizationUrl;
  } catch (error) {
    if (responseReceived && payButton) delete payButton.dataset.idempotencyKey;
    setPaymentStatus(container, error.message, 'bad');
    setActionLoading(payButton, false);
  }
}

function renderPayableItems(child) {
  const identity = childIdentity(child);
  const records = childResult(dashboard.payableItems, child, []);
  const busFees = records.filter(isBusFee);
  const clubFees = records.filter(isClubFee);
  const otherFees = records.filter(isOtherOptionalFee);
  const directRecords = records.filter((fee) => !isBusFee(fee) && !isClubFee(fee) && !isOtherOptionalFee(fee));
  const optionalRecords = [...busFees, ...clubFees, ...otherFees];
  const payableError = childResult(dashboard.payableErrors, child, '');
  const loading = !loadedPayables.has(identity);
  payableItems.innerHTML = directRecords.length ? '' : `<p class="${payableError ? 'status bad' : 'muted'}">${payableError || (loading ? 'Loading payable items...' : 'There are no regular payment items due at the moment.')}</p>`;
  optionalPayments.innerHTML = optionalRecords.length ? '' : `<p class="${payableError ? 'status bad' : 'muted'}">${payableError || (loading ? 'Loading optional payments...' : 'There are no optional payment items available at the moment.')}</p>`;
  if (optionalRecords.length) {
    const optionalBox = document.createElement('div');
    optionalBox.className = 'activity-item optional-payments';
    const optionalHeading = document.createElement('strong');
    optionalHeading.textContent = 'Other Optional Payments';
    optionalBox.appendChild(optionalHeading);
    const busSelector = renderSubscriptionSelector(child, 'Bus Service Subscription', busFees, { kind: 'bus' });
    if (busSelector) optionalBox.appendChild(busSelector);
    const clubSelector = renderSubscriptionSelector(child, 'Paid Club Subscription', clubFees, { kind: 'club' });
    if (clubSelector) optionalBox.appendChild(clubSelector);
    const otherSelector = renderSubscriptionSelector(child, 'Other Optional Item', otherFees, { kind: 'others' });
    if (otherSelector) optionalBox.appendChild(otherSelector);
    optionalPayments.appendChild(optionalBox);
  }
  directRecords.forEach((fee) => {
    const item = document.createElement('div');
    item.className = 'activity-item payment-action';
    const period = [fee.AcademicSession, fee.Term].filter(Boolean).join(' | ');
    const allowAmountEntry = isWalletFee(fee) || allowsItemPartPayment(fee);
    const defaultAmount = Number(fee.MinAmount || 0) > 0 ? fee.MinAmount : (isWalletFee(fee) ? '' : fee.Amount);
    const displayAmount = fee.OriginalAmount || fee.Amount;
    const creditValue = (field) => Number(String(fee[field] || '0').replace(/,/g, '')) || 0;
    const creditApplied = creditValue('CreditApplied');
    const creditSources = [];
    const acceptanceCredit = creditValue('AcceptanceCreditApplied');
    const schoolFeePayment = creditValue('SchoolFeesTotalCreditApplied');
    const generalCredit = creditValue('GeneralFeeCreditApplied');
    const previousPayment = Math.max(creditValue('PreviousFeePaymentApplied'), creditApplied - acceptanceCredit - schoolFeePayment - generalCredit);
    if (schoolFeePayment > 0) creditSources.push(`an earlier school-fee payment of ${money(schoolFeePayment)}`);
    if (generalCredit > 0) creditSources.push(`account credit of ${money(generalCredit)}`);
    if (acceptanceCredit > 0) creditSources.push(`acceptance-fee credit of ${money(acceptanceCredit)}`);
    if (previousPayment > 0) creditSources.push(`previous component payments of ${money(previousPayment)}`);
    const balanceNote = creditApplied > 0
      ? `<small>Amount to pay is ${money(fee.Amount)} because ${creditSources.join(', ') || `previous payments or credits of ${money(creditApplied)}`} ${creditSources.length === 1 ? 'has' : 'have'} already been applied.</small>`
      : '';
    item.innerHTML = `
      <strong>${fee.FeeName || fee.FeeCode}</strong>
      <span>${money(displayAmount)}${period ? ' | ' + period : ''}${fee.DueDate ? ' | Due: ' + fee.DueDate : ''}</span>
      <small>${fee.FeeCategory || ''}${allowAmountEntry && !isWalletFee(fee) ? ' | Part payment allowed' : ''}</small>
      ${balanceNote}
    `;
    if (isWalletFee(fee) && Number(fee.WalletLimit || 0) > 0) {
      const walletNote = document.createElement('small');
      walletNote.textContent = `Wallet balance: ${money(fee.WalletBalance)} | Class wallet limit: ${money(fee.WalletLimit)} | Maximum top-up now: ${money(fee.MaxAmount || fee.Amount)}`;
      item.appendChild(walletNote);
    }
    if (fee.Components?.length) {
      renderComponents(item, fee.Components);
    }
    if (allowAmountEntry) {
      const label = document.createElement('label');
      label.setAttribute('for', amountInputId(fee));
      label.textContent = isWalletFee(fee) ? 'Wallet top-up amount' : 'Amount to pay now';
      const input = document.createElement('input');
      input.id = amountInputId(fee);
      input.type = 'number';
      input.dataset.financeInput = '';
      input.min = fee.MinAmount || '1';
      if (fee.MaxAmount) input.max = fee.MaxAmount;
      input.step = '0.01';
      input.value = defaultAmount;
      input.inputMode = 'decimal';
      input.addEventListener('input', () => {
        delete button.dataset.idempotencyKey;
      });
      if (isWalletFee(fee) && isYes(fee.WalletLimitReached)) {
        input.disabled = true;
        input.value = '';
      }
      item.appendChild(label);
      item.appendChild(input);
      window.DynamaxFinancialValues?.refresh(input);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Pay Now';
    if (isWalletFee(fee) && isYes(fee.WalletLimitReached)) {
      button.disabled = true;
    }
    button.addEventListener('click', () => payItem(child, fee, item));
    item.appendChild(button);
    const inlineStatus = document.createElement('small');
    inlineStatus.className = 'payment-status status';
    item.appendChild(inlineStatus);
    payableItems.appendChild(item);
  });
}

function renderClinic(child) {
  const records = childResult(dashboard.clinicVisits, child, []);
  if (!records.length) {
    clinicRecords.innerHTML = '<p class="muted">No clinic visits found.</p>';
    return;
  }
  const target = activityTarget(clinicRecords, records, 'clinic visits');
  records.slice(0, 100).forEach((record) => {
    const item = document.createElement('div');
    item.className = 'activity-item';
    item.innerHTML = `
      <strong>${record.Complaint || 'Clinic visit'}</strong>
      <span>${record.Date || ''} | ${record.Disposition || ''}</span>
      <small>${record.Treatment || ''}</small>
    `;
    target.appendChild(item);
  });
}

function renderPayments(child) {
  const records = childResult(dashboard.paymentRecords, child, []);
  if (!records.length) {
    paymentRecords.innerHTML = '<p class="muted">No payment records found.</p>';
    return;
  }
  const target = activityTarget(paymentRecords, records, 'payment records');
  records.slice(0, 100).forEach((record) => {
    const isCredit = Number(record.Credit || record.Amount || 0) > 0 && Number(record.Debit || 0) === 0;
    const amount = record.Amount || record.Credit || record.Debit || 0;
    const period = [record.AcademicSession, record.Term].filter(Boolean).join(' | ');
    const title = record.Description || record.FeeCategory || record.Department || record.RecordType || 'Payment record';
    const item = document.createElement('div');
    item.className = 'activity-item';
    item.innerHTML = `
      <strong>${title}</strong>
      <span>${record.Date || ''}${period ? ' | ' + period : ''} | ${isCredit ? '+' : ''}${money(amount)}</span>
      <small>${record.RecordType || ''}${record.Status ? ' | Status: ' + record.Status : ''}${record.Reference ? ' | Ref: ' + record.Reference : ''}</small>
    `;
    target.appendChild(item);
  });
}

function academicResultSubjectRows(record) {
  return (record.Subjects || []).map((subject) => `<tr>
    <td>${escapeHtml(subject.SubjectName || subject.SubjectId || 'Subject')}</td>
    <td>${escapeHtml(subject.Total ?? '-')}</td>
    <td>${escapeHtml(subject.Grade || '-')}</td>
    <td>${escapeHtml(subject.GradePoint ?? '-')}</td>
    <td>${escapeHtml(subject.Position ?? subject.AssessedCount ?? '-')}</td>
    <td>${escapeHtml(subject.Remark || '')}</td>
  </tr>`).join('');
}

function academicResultPrintMarkup(child, record) {
  const schoolName = window.SCHOOL_PROFILE?.SchoolName || window.SCHOOL_PROFILE?.OrganizationName || 'School';
  const summary = [
    record.OverallAverage !== '' && record.OverallAverage !== undefined ? `Average: ${record.OverallAverage}` : '',
    record.OverallGrade ? `Grade: ${record.OverallGrade}` : '',
    record.OverallPosition !== '' && record.OverallPosition !== undefined ? `Position: ${record.OverallPosition}` : '',
    record.PerformanceBand ? `Band: ${record.PerformanceBand}` : '',
    record.AssessedStudentCount !== '' && record.AssessedStudentCount !== undefined ? `Assessed students: ${record.AssessedStudentCount}` : ''
  ].filter(Boolean).join(' · ');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(record.Term || 'Academic Result')}</title><style>
    body{font:14px Arial,sans-serif;color:#17324d;margin:32px}header{border-bottom:2px solid #08735f;padding-bottom:12px;margin-bottom:18px}h1,h2{margin:0 0 6px}p{margin:5px 0}.meta{color:#526b80}.summary{margin:16px 0;padding:10px;background:#edf8f5;font-weight:700}table{width:100%;border-collapse:collapse;margin-top:14px}th,td{border:1px solid #cad8e3;padding:7px;text-align:left}th{background:#eef4f8}.remarks{margin-top:18px}.verification{display:flex;align-items:center;gap:12px;margin-top:20px;padding-top:12px;border-top:1px solid #cad8e3}.verification img{width:92px;height:92px}.reference{font-size:11px;color:#647b90}@media print{body{margin:15mm}}
  </style></head><body><header><h1>${escapeHtml(schoolName)}</h1><h2>Academic Result</h2><p><strong>${escapeHtml(child.DisplayName || child.AccountRef || 'Student')}</strong></p><p class="meta">${escapeHtml([record.ClassName, record.AcademicSession, record.Term].filter(Boolean).join(' · '))}</p></header>
  ${summary ? `<div class="summary">${escapeHtml(summary)}</div>` : ''}
  <table><thead><tr><th>Subject</th><th>Total</th><th>Grade</th><th>Point</th><th>Position / assessed</th><th>Remark</th></tr></thead><tbody>${academicResultSubjectRows(record)}</tbody></table>
  <div class="remarks"><p><strong>Attendance:</strong> ${escapeHtml(record.Attendance?.AttendancePercentage ?? 0)}%</p><p><strong>Teacher:</strong> ${escapeHtml(record.TeacherRemark || '-')}</p><p><strong>Principal:</strong> ${escapeHtml(record.PrincipalRemark || '-')}</p><p><strong>Recommendation:</strong> ${escapeHtml(record.Recommendation || '-')}</p></div>
  <div class="verification"><img src="${escapeHtml(`${location.origin}/api/academic-result-qr?reference=${encodeURIComponent(record.ResultReference || record.ResultId)}`)}" alt="Result verification QR code"><p class="reference">Result reference: ${escapeHtml(record.ResultReference || record.ResultId)}<br>Verification: ${escapeHtml(`${location.origin}/verify-result.html?reference=${encodeURIComponent(record.ResultReference || record.ResultId)}`)}</p></div></body></html>`;
}

async function printAcademicResult(child, record, button) {
  const originalLabel = button.textContent;
  const printWindow = window.open('', '_blank', 'width=980,height=760');
  if (printWindow) {
    printWindow.opener = null;
    printWindow.document.write('<p style="font:16px Arial;padding:24px">Rechecking result access...</p>');
  }
  setActionLoading(button, true, 'Preparing...', originalLabel);
  try {
    const response = await fetch('/api/parent-dashboard', {
      method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
      body: freshBody({
        action: 'getAcademicResultForPrint',
        ...authPayload(),
        accountRef: child.AccountRef,
        sourceType: child.SourceType || 'Student',
        scopePath: child.__scopePath || '',
        resultId: record.ResultId
      })
    });
    const data = await response.json();
    if (!response.ok || !data.ok || !data.academicResult) throw new Error(data.message || 'Could not prepare this result for printing.');
    if (!printWindow) throw new Error('Allow pop-ups for this site, then try printing again.');
    printWindow.document.open();
    printWindow.document.write(academicResultPrintMarkup(child, data.academicResult));
    printWindow.document.close();
    printWindow.focus();
    window.setTimeout(() => printWindow.print(), 250);
  } catch (error) {
    printWindow?.close();
    setStatus(error.message || String(error), 'bad');
  } finally {
    if (button.isConnected) setActionLoading(button, false, '', originalLabel);
  }
}

function renderAcademicResults(child) {
  if (!academicTermResults) return;
  const records = childResult(dashboard.academicResults, child, []);
  academicTermResults.innerHTML = records.length ? '' : '<p class="muted">No published academic result is currently available.</p>';
  const permitted = records.filter((record) => record.Access?.Allowed === true);
  if (permitted.length) {
    const current = permitted[0];
    const previous = permitted[1];
    const change = previous && Number.isFinite(Number(current.OverallAverage)) && Number.isFinite(Number(previous.OverallAverage))
      ? Math.round((Number(current.OverallAverage) - Number(previous.OverallAverage)) * 10) / 10 : null;
    const focusSubjects = [...(current.Subjects || [])]
      .filter((subject) => Number.isFinite(Number(subject.Total)))
      .sort((left, right) => Number(left.Total) - Number(right.Total)).slice(0, 3);
    const overview = document.createElement('section');
    overview.className = 'academic-progress-overview';
    overview.innerHTML = `<header><div><small>Current approved progress</small><strong>${escapeHtml([current.Term, current.AcademicSession].filter(Boolean).join(' · '))}</strong></div><span>${escapeHtml(current.ClassName || '')}</span></header><div class="academic-progress-metrics"><div><small>Current average</small><strong>${escapeHtml(current.OverallAverage ?? '—')}%</strong></div><div><small>Previous permitted term</small><strong>${previous ? `${escapeHtml(previous.OverallAverage ?? '—')}%` : 'Not available'}</strong></div><div><small>Change</small><strong>${change === null ? '—' : `${change > 0 ? '+' : ''}${escapeHtml(change)} points`}</strong></div><div><small>Attendance</small><strong>${escapeHtml(current.Attendance?.AttendancePercentage ?? 0)}%</strong></div></div>${focusSubjects.length ? `<p><strong>Subjects to watch:</strong> ${focusSubjects.map((subject) => `${escapeHtml(subject.SubjectName || subject.SubjectId)} (${escapeHtml(subject.Total)}%)`).join(' · ')}</p>` : ''}${current.Recommendation ? `<p><strong>Approved recommendation:</strong> ${escapeHtml(current.Recommendation)}</p>` : ''}`;
    academicTermResults.appendChild(overview);
  }
  records.forEach((record) => {
    const item = document.createElement('article');
    item.className = `activity-item academic-result-card${record.Access?.Allowed ? '' : ' academic-result-restricted'}`;
    item.innerHTML = `<header><div><strong>${escapeHtml([record.Term, record.AcademicSession].filter(Boolean).join(' · ') || 'Academic result')}</strong><span>${escapeHtml(record.ClassName || '')}</span></div><span>${record.Access?.Allowed ? 'Available' : 'Restricted'}</span></header>`;
    if (!record.Access?.Allowed) {
      const message = document.createElement('p');
      message.className = 'academic-result-access-message';
      message.textContent = record.Access?.Message || 'This result is not currently available.';
      item.appendChild(message);
      academicTermResults.appendChild(item);
      return;
    }
    const summary = document.createElement('div');
    summary.className = 'academic-result-summary';
    [
      ['Average', record.OverallAverage],
      ['Grade', record.OverallGrade],
      ['Position', record.OverallPosition],
      ['Band', record.PerformanceBand],
      ['Assessed', record.AssessedStudentCount]
    ].filter(([, value]) => value !== '' && value !== undefined).forEach(([label, value]) => {
      summary.insertAdjacentHTML('beforeend', `<span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(label)}</small></span>`);
    });
    item.appendChild(summary);
    if ((record.Subjects || []).length) {
      const table = document.createElement('div');
      table.className = 'admin-table-wrap academic-result-subject-table';
      table.innerHTML = `<table><thead><tr><th>Subject</th><th>Total</th><th>Grade</th><th>Point</th><th>Position / assessed</th><th>Remark</th></tr></thead><tbody>${academicResultSubjectRows(record)}</tbody></table>`;
      item.appendChild(table);
    }
    const actions = document.createElement('div');
    actions.className = 'academic-result-actions';
    const printButton = document.createElement('button');
    printButton.type = 'button';
    printButton.textContent = 'Print result';
    printButton.addEventListener('click', () => printAcademicResult(child, record, printButton));
    actions.appendChild(printButton);
    item.appendChild(actions);
    academicTermResults.appendChild(item);
  });
}

function renderAcademicSchedule(child) {
  if (!parentAcademicSchedule) return;
  const records = childResult(dashboard.academicSchedules, child, []);
  parentAcademicSchedule.innerHTML = records.length ? '' : '<p class="muted">No published class timetable is currently available.</p>';
  const grouped = new Map();
  records.forEach((row) => {
    const day = row.DayName || row.DayCode;
    if (!grouped.has(day)) grouped.set(day, []);
    grouped.get(day).push(row);
  });
  grouped.forEach((lessons, day) => {
    const card = document.createElement('article');
    card.className = 'activity-item parent-academic-schedule-day';
    card.innerHTML = `<strong>${escapeHtml(day)}</strong><div>${lessons.map((lesson) => `<span><b>${escapeHtml(lesson.StartTime || lesson.PeriodCodes?.join(' + '))}${lesson.EndTime ? `–${escapeHtml(lesson.EndTime)}` : ''}</b><em>${escapeHtml(lesson.Subject)}</em><small>${escapeHtml([lesson.Room, lesson.LessonType].filter(Boolean).join(' · '))}</small></span>`).join('')}</div>`;
    parentAcademicSchedule.appendChild(card);
  });
}

function renderAcademicAttendance(child) {
  if (!parentAcademicAttendance) return;
  const summary = childResult(dashboard.academicAttendanceSummaries, child, {});
  const total = Number(summary.Total || 0);
  parentAcademicAttendance.innerHTML = total ? [
    ['Attendance', `${summary.AttendancePercentage || 0}%`],
    ['Present', summary.Present || 0],
    ['Late', summary.Late || 0],
    ['Absent', summary.Absent || 0],
    ['Excused', summary.Excused || 0],
    ['Left early', summary.LeftEarly || 0],
    ['Registers', total]
  ].map(([label, value]) => `<div><strong>${escapeHtml(value)}</strong><small>${escapeHtml(label)}</small></div>`).join('')
    : '<p class="muted">No student attendance has been recorded for the current academic period.</p>';
}

function resultDisplayMode(child) {
  return dashboard?.resultSettingsByChild?.[childIdentity(child)]?.resultDisplayMode
    || window.SCHOOL_PROFILE?.ResultDisplayMode
    || 'subjects';
}

function resultsOnlineEnabled(child) {
  const value = dashboard?.resultSettingsByChild?.[childIdentity(child)]?.showResultsOnline;
  if (typeof value === 'boolean') {
    return value;
  }
  const profileValue = String(window.SCHOOL_PROFILE?.ShowResultsOnline || '').trim().toUpperCase();
  return profileValue === 'YES';
}

function renderEntranceResults(child) {
  const records = childResult(dashboard.entranceResults, child, []);
  if (!resultsOnlineEnabled(child) && records.length === 0) {
    entranceResults.innerHTML = '<p class="muted">Entrance results are not currently enabled for online viewing.</p>';
    if (entranceResultPanel) entranceResultPanel.hidden = activeDashboardView !== 'results';
    return;
  }
  entranceResults.innerHTML = records.length ? '' : '<p class="muted">Entrance result is not available yet.</p>';
  records.forEach((record) => {
    const item = document.createElement('div');
    item.className = 'activity-item';
    const percentage = record.ResultPercentage ? `${record.ResultPercentage}%` : '';
    const status = record.ResultStatus || 'Pending';
    const date = record.ResultUpdatedAt || record.ResultSentAt || '';
    if (resultDisplayMode(child) === 'percentage') {
      item.innerHTML = `
        <strong>${status}</strong>
        <span>${[percentage || 'Percentage not recorded', date].filter(Boolean).join(' | ')}</span>
        <small>${[record.ResultNotes, record.ResultNextStep].filter(Boolean).join(' | ')}</small>
      `;
    } else {
      item.innerHTML = `
        <strong>${status}${percentage ? ' | ' + percentage : ''}</strong>
        <span>${date || ''}</span>
        <div class="result-scores">
          <span>English: <strong>${record.EnglishScore || '-'}</strong></span>
          <span>Mathematics: <strong>${record.MathematicsScore || '-'}</strong></span>
          <span>Interview / General: <strong>${record.InterviewScore || '-'}</strong></span>
          <span>Total: <strong>${record.TotalScore || '-'}</strong></span>
        </div>
        <small>${[record.ResultNotes, record.ResultNextStep].filter(Boolean).join(' | ')}</small>
      `;
    }
    entranceResults.appendChild(item);
    const documentFlow = document.createElement('div');
    documentFlow.className = 'admission-document-flow';
    const documents = [
      { type: 'result', label: 'Entrance Result', buttonLabel: 'Download Result', sent: isYes(record.ResultSent), available: Boolean(record.EntranceResultPdfAvailable), enabled: true },
      { type: 'offer', label: 'Offer of Admission', buttonLabel: 'Download Offer', sent: isYes(record.OfferSent), available: Boolean(record.OfferPdfAvailable), enabled: String(record.ResultStatus || '').toLowerCase() === 'admitted' && isYes(record.ResultSent) },
      { type: 'admission', label: 'Admission Letter', buttonLabel: 'Download Admission Letter', sent: isYes(record.AdmissionLetterSent), available: Boolean(record.AdmissionLetterPdfAvailable), enabled: isYes(record.OfferSent) && isYes(record.AcceptanceFeePaid) }
    ];
    documents.forEach((documentInfo) => {
      const card = document.createElement('div'); card.className = 'activity-item';
      card.dataset.admissionDocumentType = documentInfo.type;
      card.innerHTML = `<strong>${escapeHtml(documentInfo.label)}</strong><span>${documentInfo.sent ? 'Sent / downloaded by parent' : 'Not downloaded'}</span>`;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = documentInfo.buttonLabel;
      button.dataset.documentMode = 'download';
      button.disabled = !documentInfo.enabled;
      button.addEventListener('click', () => downloadAdmissionDocument(child, documentInfo.type, button));
      card.appendChild(button);
      const actionStatus = document.createElement('small');
      actionStatus.className = 'document-download-status';
      actionStatus.setAttribute('aria-live', 'polite');
      if (documentInfo.enabled && !documentInfo.available) {
        actionStatus.textContent = 'The authorized customized PDF has not been archived yet. Generate it from the Applications or Bulk Email tab first.';
      }
      card.appendChild(actionStatus);
      if (!documentInfo.enabled) {
        const note = document.createElement('small');
        note.textContent = documentInfo.type === 'offer' ? 'Download the entrance result first.' : 'Download the offer and complete acceptance payment first.';
        card.appendChild(note);
      }
      documentFlow.appendChild(card);
    });
    entranceResults.appendChild(documentFlow);
  });
  if (entranceResultPanel) entranceResultPanel.hidden = activeDashboardView !== 'results';
}

async function downloadAdmissionDocument(child, documentType, button) {
  const originalLabel = button.textContent;
  const card = button.closest('.activity-item');
  const actionStatus = card?.querySelector('.document-download-status');
  setActionLoading(button, true, 'Preparing download...', originalLabel);
  if (actionStatus) {
    actionStatus.textContent = 'Preparing the original customized PDF...';
    actionStatus.classList.remove('bad', 'good');
  }
  try {
    const response = await fetch('/api/parent-dashboard', {
      method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
      body: freshBody({
        action: 'getAdmissionDocument',
        ...authPayload(),
        accountRef: child.AccountRef,
        sourceType: child.SourceType || 'Student',
        scopePath: child.__scopePath || '',
        documentType
      })
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || 'Could not download that document.');
    }
    const disposition = response.headers.get('Content-Disposition') || '';
    const fileNameMatch = disposition.match(/filename="?([^";]+)"?/i);
    const fileName = fileNameMatch?.[1] || `${documentType || 'admission-document'}.pdf`;
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    if (actionStatus) {
      actionStatus.textContent = 'Download started.';
      actionStatus.classList.add('good');
    }
    window.setTimeout(() => {
      link.remove();
      URL.revokeObjectURL(url);
    }, 1000);
    loadedPayables.delete(childIdentity(child));
    await loadPayablesForSelected(true);
  } catch (error) {
    const message = error.message || String(error);
    setStatus(message, 'bad');
    if (actionStatus) {
      actionStatus.textContent = message;
      actionStatus.classList.add('bad');
    }
  } finally {
    if (button.isConnected) setActionLoading(button, false, '', originalLabel);
  }
}

function renderDashboard() {
  const children = dashboard?.children || [];
  if (!selectedChildKey && children.length) {
    selectedChildKey = childIdentity(children[0]);
  }
  renderChildren();
  const child = selectedChild();
  if (!child) return;
  renderParentDocumentTarget(child);
  renderDueNotifications(child);
  renderPayableItems(child);
  renderAccountCredit(child);
  renderAcademicResults(child);
  renderEntranceResults(child);
  renderWallet(child);
  renderPayments(child);
  renderClinic(child);
  renderStores(child);
}

function parentDocumentFileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.readAsDataURL(file);
  });
}

async function parentPassportThumbnail(file, documentType) {
  if (documentType !== 'PassportPhotograph' || !String(file.type || '').toLowerCase().startsWith('image/')) return null;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 240 / bitmap.width, 280 / bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return {
      mimeType: 'image/jpeg',
      base64: canvas.toDataURL('image/jpeg', 0.82).split(',')[1] || ''
    };
  } catch (_error) {
    return null;
  }
}

function selectedParentDocumentUploads() {
  return Array.from(document.querySelectorAll('input[type="file"][data-parent-document-type]'))
    .map((input) => ({
      documentType: input.dataset.parentDocumentType,
      label: input.closest('.document-upload-row')?.querySelector('label')?.textContent.trim() || 'Document',
      input,
      file: input.files?.[0] || null
    }))
    .filter((upload) => upload.file);
}

function parentDocumentUploadIdentity(upload, child, replaceExisting) {
  return [
    authPayload().email,
    childIdentity(child),
    parentDocumentApplicationReference(child),
    upload.documentType,
    upload.file.name,
    upload.file.size,
    upload.file.lastModified,
    replaceExisting ? 'replace' : 'new'
  ].join('|');
}

function parentDocumentResult(message, type = '') {
  const row = document.createElement('div');
  row.className = `upload-result ${type}`.trim();
  row.textContent = message;
  parentDocumentUploadResults?.appendChild(row);
  return row;
}

function updateParentDocumentResult(row, message, type = '') {
  if (!row) return;
  row.className = `upload-result ${type}`.trim();
  row.textContent = message;
}

function setParentDocumentProgress(done, total, message = '') {
  if (!parentDocumentUploadProgress) return;
  parentDocumentUploadProgress.hidden = false;
  if (parentDocumentUploadProgressFill) {
    parentDocumentUploadProgressFill.style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
  }
  if (parentDocumentUploadProgressText) {
    parentDocumentUploadProgressText.textContent = message || `${done} of ${total} document(s) processed`;
  }
}

function setParentDocumentStatus(message, type = '') {
  if (!parentDocumentUploadStatus) return;
  parentDocumentUploadStatus.textContent = message || '';
  parentDocumentUploadStatus.className = `status ${type}`.trim();
}

function releaseParentDocumentIdempotencyKey(response, data) {
  const status = Number(response?.status || 0);
  if (response?.ok && data?.ok) return true;
  if (status < 400 || status >= 500 || [408, 425, 429].includes(status)) return false;
  if (status === 409 && /IDEMPOTENCY_(IN_PROGRESS|LOCKED|OWNERSHIP_LOST|OUTCOME_UNCERTAIN)|already being processed|outcome.+uncertain|unresolved request|no longer owned/i.test(
    `${data?.code || ''} ${data?.message || ''}`
  )) return false;
  return true;
}

async function loadParentDocumentSettings() {
  if (!parentDocumentUploadForm) return;
  try {
    const data = window.DynamaxPublicApi?.getJson
      ? await window.DynamaxPublicApi.getJson('/api/admission-document-settings', {
          cacheKey: 'parent-admission-document-settings'
        })
      : await fetch('/api/admission-document-settings', { cache: 'no-cache' }).then((response) => response.json());
    if (!data?.ok) return;
    const enabled = new Set((data.documents || []).map((item) => item.key));
    document.querySelectorAll('[data-parent-document-row]').forEach((row) => {
      const active = enabled.has(row.dataset.parentDocumentRow);
      row.hidden = !active;
      row.querySelector('input[type="file"]')?.toggleAttribute('disabled', !active);
    });
  } catch (_error) {
    // Retain the built-in admission document list while settings are temporarily unavailable.
  }
}

parentDocumentUploadForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const child = selectedChild();
  const applicationReference = parentDocumentApplicationReference(child);
  const uploads = selectedParentDocumentUploads();
  const replaceExisting = Boolean(parentReplaceExistingDocument?.checked);
  parentDocumentUploadResults.innerHTML = '';
  setParentDocumentStatus('', '');

  if (!child || !applicationReference) {
    setParentDocumentStatus('Select a student with an admission application before uploading.', 'bad');
    return;
  }
  if (!uploads.length) {
    setParentDocumentStatus('Choose at least one document to upload.', 'bad');
    return;
  }
  const tooLarge = uploads.find((upload) => upload.file.size > PARENT_DOCUMENT_MAX_FILE_SIZE);
  if (tooLarge) {
    setParentDocumentStatus(`${tooLarge.label} is too large. Maximum allowed size is 8 MB.`, 'bad');
    return;
  }

  const buttonLabel = parentUploadDocumentsBtn.textContent;
  setActionLoading(parentUploadDocumentsBtn, true, 'Uploading documents...', buttonLabel);
  setParentDocumentStatus(`Uploading ${uploads.length} document(s) for ${child.DisplayName || 'the selected student'}...`);
  setParentDocumentProgress(0, uploads.length);
  let uploaded = 0;
  let skipped = 0;
  let failed = 0;

  for (let index = 0; index < uploads.length; index += 1) {
    const upload = uploads[index];
    const result = parentDocumentResult(`${upload.label}: uploading...`, 'pending');
    const identity = parentDocumentUploadIdentity(upload, child, replaceExisting);
    const idempotencyKey = parentDocumentIdempotencyKeys.get(identity) || newIdempotencyKey();
    parentDocumentIdempotencyKeys.set(identity, idempotencyKey);
    try {
      setParentDocumentProgress(index, uploads.length, `Uploading ${upload.label}...`);
      const thumbnail = await parentPassportThumbnail(upload.file, upload.documentType);
      const turnstile = window.DynamaxPublicApi?.getTurnstileToken
        ? await window.DynamaxPublicApi.getTurnstileToken('upload_document')
        : {};
      const response = await fetch('/api/upload-document', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify({
          ...authPayload(),
          applicationReference,
          accountRef: child.AccountRef,
          sourceType: child.SourceType || 'Student',
          scopePath: child.__scopePath || '',
          documentType: upload.documentType,
          fileName: upload.file.name,
          mimeType: upload.file.type || 'application/octet-stream',
          fileBase64: await parentDocumentFileToBase64(upload.file),
          thumbnailBase64: thumbnail?.base64 || '',
          thumbnailMimeType: thumbnail?.mimeType || '',
          replaceExisting,
          idempotencyKey,
          ...turnstile
        })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        if (data?.code === 'DOCUMENT_ALREADY_UPLOADED') {
          skipped += 1;
          parentDocumentIdempotencyKeys.delete(identity);
          updateParentDocumentResult(result, `${upload.label}: already uploaded. Tick replace if Admissions requested a newer copy.`, 'bad');
          continue;
        }
        if (releaseParentDocumentIdempotencyKey(response, data)) parentDocumentIdempotencyKeys.delete(identity);
        throw new Error(data?.message || 'Document upload failed.');
      }
      uploaded += 1;
      parentDocumentIdempotencyKeys.delete(identity);
      upload.input.value = '';
      updateParentDocumentResult(result, `${upload.label}: ${data.message || 'Uploaded successfully.'}`, 'ok');
      if (upload.documentType === 'PassportPhotograph') {
        const photoReference = child.PassportPhotoApplicationReference || applicationReference;
        const cacheKey = passportPhotoCacheKey(child, photoReference);
        const cachedPhoto = passportPhotoCache.get(cacheKey);
        if (cachedPhoto) URL.revokeObjectURL(cachedPhoto);
        passportPhotoCache.delete(cacheKey);
        child.PassportPhotoAvailable = true;
        child.PassportPhotoApplicationReference = applicationReference;
      }
    } catch (error) {
      failed += 1;
      updateParentDocumentResult(result, `${upload.label}: ${error.message}`, 'bad');
    } finally {
      setParentDocumentProgress(index + 1, uploads.length);
    }
  }

  setParentDocumentStatus(
    `Completed with ${uploaded} uploaded, ${skipped} skipped and ${failed} failed.`,
    failed ? 'bad' : 'ok'
  );
  setActionLoading(parentUploadDocumentsBtn, false, '', buttonLabel);
  if (uploaded) renderChildren();
});

function storeItemMatchesChild(item, child) {
  const all = (value) => !value || ['all', '*'].includes(String(value).trim().toLowerCase());
  const same = (left, right) => String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase();
  const sectionFor = (record) => {
    const className = normalizePortalClass(record.ClassName || record.ClassAdmitted || '');
    if (/^(creche|prenursery|nursery[1-3]|primary[1-6])$/.test(className)) return 'primary';
    if (/^(jss[1-3]|ss[1-3])$/.test(className)) return 'secondary';
    return String(record.SchoolSection || '').trim().toLowerCase();
  };
  const branchFor = (value) => {
    const key = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    return ['mainbranch', 'default'].includes(key) ? 'main' : key;
  };
  const branchMatches = all(item.BranchId) || !child.BranchId || branchFor(item.BranchId) === branchFor(child.BranchId);
  const sectionMatches = all(item.SchoolSection) || !sectionFor(child) || same(sectionFor(item), sectionFor(child));
  return branchMatches && sectionMatches;
}

function normalizePortalClass(value) {
  let text = String(value || '').trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const numbers = { one: 1, first: 1, two: 2, second: 2, three: 3, third: 3, four: 4, fourth: 4, five: 5, fifth: 5, six: 6, sixth: 6, seven: 7, seventh: 7, eight: 8, eighth: 8, nine: 9, ninth: 9 };
  text = text.replace(/\b(one|first|two|second|three|third|four|fourth|five|fifth|six|sixth|seven|seventh|eight|eighth|nine|ninth)\b/g, (word) => numbers[word]);
  text = text.replace(/[._/\\-]+/g, ' ').replace(/\bclass\b/g, ' ').replace(/\s+/g, ' ').trim();
  let match = text.match(/(?:primary|grade|basic)\s*([1-6])/); if (match) return `primary${match[1]}`;
  match = text.match(/basic\s*([7-9])/); if (match) return `jss${Number(match[1]) - 6}`;
  match = text.match(/(?:jss|junior\s*secondary)\s*([1-3])/); if (match) return `jss${match[1]}`;
  match = text.match(/(?:ss|sss|senior\s*secondary)\s*([1-3])/); if (match) return `ss${match[1]}`;
  match = text.match(/(?:nursery|kg)\s*([1-3])/); if (match) return `nursery${match[1]}`;
  if (/pre\s*nursery|prenursery/.test(text)) return 'prenursery';
  if (/creche|daycare|playgroup/.test(text)) return 'creche';
  return text.replace(/[^a-z0-9]/g, '');
}

function renderStores(child) {
  if (!schoolStores || !storeOrders) return;
  const identity = childIdentity(child);
  const eligibleCatalog = (dashboard.storeCatalogByChild?.[identity] || []).filter((item) => storeItemMatchesChild(item, child));
  const query = String(storeSearch?.value || '').trim().toLowerCase();
  const catalog = query
    ? eligibleCatalog.filter((item) => [
        item.ItemName,
        item.ItemCode,
        item.Category,
        item.Size,
        item.Gender,
        item.ClassName,
        item.StoreType
      ].filter(Boolean).join(' ').toLowerCase().includes(query))
    : eligibleCatalog;
  if (storeSearchSummary) {
    storeSearchSummary.textContent = query
      ? `${catalog.length} of ${eligibleCatalog.length} item${eligibleCatalog.length === 1 ? '' : 's'} found`
      : `${eligibleCatalog.length} item${eligibleCatalog.length === 1 ? '' : 's'} available`;
  }
  schoolStores.innerHTML = catalog.length
    ? ''
    : `<p class="muted">${query ? `No store items match “${escapeHtml(query)}”.` : 'No school-store items are currently available.'}</p>`;
  const groups = ['Bookstore', 'Uniform Store'];
  groups.forEach((storeType) => {
    const items = catalog.filter((item) => item.StoreType === storeType);
    if (!items.length) return;
    const section = document.createElement('section');
    section.className = 'store-catalog-section';
    section.innerHTML = `<h3>${escapeHtml(storeType === 'Bookstore' ? 'Books & General Supplies' : 'Clothing & General Supplies')}</h3>`;
    items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'activity-item store-item-row';
      row.innerHTML = `<strong>${escapeHtml(item.ItemName)}</strong><span>${escapeHtml([item.Category, item.Size, item.Gender].filter(Boolean).join(' | '))}</span><small>${money(item.Price)} | ${escapeHtml(item.Quantity)} available</small>`;
      const available = Math.max(1, Math.floor(Number(item.Quantity || 1) || 1));
      const qty = document.createElement('select');
      qty.className = 'store-quantity';
      qty.setAttribute('aria-label', `Quantity for ${item.ItemName}`);
      Array.from({ length: available }, (_, index) => index + 1).forEach((quantity) => {
        const option = document.createElement('option');
        option.value = String(quantity);
        option.textContent = String(quantity);
        qty.appendChild(option);
      });
      const buy = document.createElement('button');
      buy.type = 'button';
      buy.className = 'compact-icon-action store-cart-action';
      buy.setAttribute('aria-label', `Add ${item.ItemName} to cart`);
      buy.title = 'Add to cart';
      buy.innerHTML = '<span aria-hidden="true">&#128722;</span>';
      const key = `${item.StoreType}|${item.ItemCode}`;
      const markAdded = () => {
        qty.classList.add('is-locked');
        qty.setAttribute('aria-disabled', 'true');
        qty.tabIndex = -1;
        buy.disabled = true;
        buy.classList.add('is-added');
        buy.setAttribute('aria-label', `${item.ItemName} added to cart`);
        buy.title = 'Added to cart';
        buy.innerHTML = '<span aria-hidden="true">&#10003;</span>';
      };
      const existingCartItem = storeCart.get(key);
      if (existingCartItem) {
        qty.value = String(Math.min(available, existingCartItem.quantity));
        markAdded();
      }
      buy.addEventListener('click', () => {
        const quantity = Math.max(1, Math.min(available, Number(qty.value || 1)));
        storeCart.set(key, { item, quantity });
        markAdded();
        renderStoreCart(child);
      });
      const purchaseControls = document.createElement('div');
      purchaseControls.className = 'store-purchase-controls';
      purchaseControls.append(qty, buy);
      row.appendChild(purchaseControls);
      section.appendChild(row);
    });
    schoolStores.appendChild(section);
  });
  renderStoreCart(child);
  const orders = dashboard.storeOrdersByChild?.[identity] || [];
  storeOrders.innerHTML = orders.length ? '' : '<p class="muted">No store orders recorded for this student.</p>';
  orders.forEach((order) => {
    const row = document.createElement('div'); row.className = 'activity-item';
    row.innerHTML = `<strong>${escapeHtml(order.StoreType || 'School Store')} - ${escapeHtml(order.OrderNo)}</strong><span>${escapeHtml(order.Status || 'Paid - Awaiting Collection')}</span><small>${money(order.Amount)} | ${escapeHtml(order.PaidAt || order.CreatedAt || '')}</small>`;
    storeOrders.appendChild(row);
  });
}

storeSearch?.addEventListener('input', () => {
  const child = selectedChild();
  if (child) renderStores(child);
});

function renderStoreCart(child) {
  if (!storeCartEl || !checkoutStoreCartBtn) return;
  const entries = [...storeCart.entries()];
  storeCartEl.innerHTML = entries.length ? '' : '<p class="muted">Your cart is empty.</p>';
  let total = 0;
  entries.forEach(([key, entry]) => {
    total += Number(entry.item.Price || 0) * entry.quantity;
    const row = document.createElement('div'); row.className = 'activity-item store-item-row';
    row.innerHTML = `<strong>${escapeHtml(entry.item.ItemName)}</strong><span>${escapeHtml(entry.item.StoreType)} × ${entry.quantity}</span><small>${money(Number(entry.item.Price || 0) * entry.quantity)}</small>`;
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'compact-icon-action compact-delete-action'; remove.setAttribute('aria-label', `Delete ${entry.item.ItemName} from cart`); remove.title = 'Delete from cart'; remove.innerHTML = '<span aria-hidden="true">&#128465;&#65038;</span>';
    remove.addEventListener('click', () => { storeCart.delete(key); renderStores(child); });
    row.appendChild(remove); storeCartEl.appendChild(row);
  });
  checkoutStoreCartBtn.disabled = !entries.length;
  checkoutStoreCartBtn.textContent = entries.length ? `Checkout ${money(total)}` : 'Checkout Cart';
  const cartFingerprint = entries.map(([key, entry]) => `${key}:${entry.quantity}`).join('|');
  if (checkoutStoreCartBtn.dataset.cartFingerprint !== cartFingerprint) {
    checkoutStoreCartBtn.dataset.cartFingerprint = cartFingerprint;
    delete checkoutStoreCartBtn.dataset.idempotencyKey;
  }
  checkoutStoreCartBtn.onclick = async () => {
    if (checkoutStoreCartBtn.disabled) return;
    const normalText = checkoutStoreCartBtn.textContent;
    let paymentChoice;
    try {
      paymentChoice = await window.DynamaxPaymentMethods.choose({ branchId: child.BranchId || 'main', currency: 'NGN', amount: total });
      if (!paymentChoice) return;
    } catch (error) {
      if (storeCheckoutStatus) { storeCheckoutStatus.textContent = error.message || String(error); storeCheckoutStatus.className = 'status bad'; }
      return;
    }
    setActionLoading(checkoutStoreCartBtn, true, paymentChoice.paymentMethod === 'direct_bank_transfer' ? 'Submitting transfer...' : 'Connecting to Paystack...', normalText);
    if (storeCheckoutStatus) { storeCheckoutStatus.textContent = paymentChoice.paymentMethod === 'direct_bank_transfer' ? 'Submitting transfer for verification...' : 'Connecting to Paystack...'; storeCheckoutStatus.className = 'status'; }
    let responseReceived = false;
    try {
      const cart = entries.map(([, entry]) => ({ itemCode: entry.item.ItemCode, storeType: entry.item.StoreType, quantity: entry.quantity }));
      const idempotencyKey = checkoutStoreCartBtn.dataset.idempotencyKey || newIdempotencyKey();
      checkoutStoreCartBtn.dataset.idempotencyKey = idempotencyKey;
      const turnstile = window.DynamaxPublicApi?.getTurnstileToken
        ? await window.DynamaxPublicApi.getTurnstileToken('init_payment')
        : {};
      const response = await fetch('/api/init-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify({
          ...authPayload(),
          accountRef: child.AccountRef,
          sourceType: child.SourceType || 'Student',
          scopePath: child.__scopePath || '',
          feeCode: 'STORE_CART',
          amount: total,
          storeCart: cart,
          ...paymentChoice,
          idempotencyKey,
          ...turnstile
        })
      });
      responseReceived = true;
      const responseText = await response.text();
      let data = {};
      try { data = JSON.parse(responseText); } catch (_error) { throw new Error(`Checkout service returned an invalid response (HTTP ${response.status}). Please try again.`); }
      if (!response.ok || !data.ok) throw new Error(data.message || 'Could not start store checkout.');
      if (data.directTransfer) {
        delete checkoutStoreCartBtn.dataset.idempotencyKey;
        if (storeCheckoutStatus) { storeCheckoutStatus.textContent = window.DynamaxPaymentMethods.directTransferMessage(data); storeCheckoutStatus.className = 'status ok'; }
        storeCart.clear();
        renderStores(child);
        setActionLoading(checkoutStoreCartBtn, false, '', normalText);
        return;
      }
      if (!data.authorizationUrl) throw new Error('Paystack did not return a checkout link. Please contact the school accounts office.');
      if (storeCheckoutStatus) { storeCheckoutStatus.textContent = 'Opening Paystack secure checkout...'; storeCheckoutStatus.className = 'status ok'; }
      window.location.assign(data.authorizationUrl);
    } catch (error) {
      if (responseReceived) delete checkoutStoreCartBtn.dataset.idempotencyKey;
      const message = String(error?.message || error || 'Could not start checkout.').replace(/^Error:\s*/, '');
      if (storeCheckoutStatus) { storeCheckoutStatus.textContent = message; storeCheckoutStatus.className = 'status bad'; }
      setStatus(message, 'bad');
      setActionLoading(checkoutStoreCartBtn, false, '', normalText);
    }
  };
}

async function loadDashboard({ sessionOnly = false, silent = false } = {}) {
  const previousChildKey = selectedChildKey;
  const payload = sessionOnly ? {} : authPayload();
  if (!sessionOnly && (!payload.email || !payload.code)) {
    throw new Error('Email and password or verification code are required.');
  }
  dashboardLoadController?.abort();
  selectedChildLoadController?.abort();
  const controller = new AbortController();
  dashboardLoadController = controller;
  if (!silent) setStatus(sessionOnly ? 'Restoring dashboard...' : 'Loading dashboard...', '');
  try {
    const response = await fetch('/api/parent-dashboard', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: freshBody({ action: 'getDashboard', ...payload })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || 'Could not load parent dashboard.');
    }
    if (controller.signal.aborted) return;
    dashboard = data;
    if (data.parentEmail) document.getElementById('parentEmail').value = data.parentEmail;
    document.getElementById('verificationCode').value = '';
    normalizeChildResultMaps(dashboard);
    loadedPayables.clear();
    selectedChildKey = data.children?.some((child) => childIdentity(child) === previousChildKey)
      ? previousChildKey
      : (data.children?.[0] ? childIdentity(data.children[0]) : '');
    dashboardContent.hidden = false;
    loginForm.hidden = true;
    renderDashboard();
    showDashboardView(activeDashboardView);
    await loadPayablesForSelected();
    void loadParentNotifications();
    if (controller.signal.aborted) return;
    setStatus('Dashboard loaded.', 'ok');
    return true;
  } catch (error) {
    if (error?.name === 'AbortError') return;
    throw error;
  } finally {
    if (dashboardLoadController === controller) dashboardLoadController = null;
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (loadDashboardBtn?.disabled) return;
  setLoginLoading(true);
  try {
    await loadDashboard();
  } catch (error) {
    dashboardContent.hidden = true;
    setStatus(error.message, 'bad');
  } finally {
    setLoginLoading(false);
  }
});

restrictionForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter || restrictionForm.querySelector('button[type="submit"]');
  if (button?.disabled) return;
  const child = selectedChild();
  if (!child) {
    setStatus('Select a child first.', 'bad');
    return;
  }
  const normalText = button?.textContent || 'Save wallet restrictions';
  setActionLoading(button, true, 'Saving...', normalText);
  try {
    setStatus('Saving wallet restrictions...', '');
    const response = await fetch('/api/parent-dashboard', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: freshBody({
        action: 'updateWalletRestrictions',
        ...authPayload(),
        accountRef: child.AccountRef,
        sourceType: child.SourceType || 'Student',
        scopePath: child.__scopePath || '',
        branchId: child.BranchId || 'main',
        schoolSection: child.SchoolSection || 'secondary',
        walletCardStatus: walletStatus.value,
        walletTxnLimit: txnLimit.value,
        walletDailyLimit: dailyLimit.value,
        walletPinThreshold: pinThreshold.value
      })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || 'Could not save wallet restrictions.');
    }
    Object.assign(child, {
      WalletCardStatus: walletStatus.value,
      WalletTxnLimit: txnLimit.value,
      WalletDailyLimit: dailyLimit.value,
      WalletPinThreshold: pinThreshold.value
    });
    renderWallet(child);
    setStatus('Wallet restrictions saved.', 'ok');
  } catch (error) {
    setStatus(error.message, 'bad');
  } finally {
    setActionLoading(button, false, '', normalText);
  }
});

if (refreshDashboardBtn) {
  refreshDashboardBtn.addEventListener('click', async () => {
    if (refreshDashboardBtn.disabled) return;
    const normalText = refreshDashboardBtn.textContent;
    setActionLoading(refreshDashboardBtn, true, 'Refreshing...', normalText);
    try {
      await loadDashboard({ sessionOnly: true });
    } catch (error) {
      setStatus(error.message, 'bad');
    } finally {
      setActionLoading(refreshDashboardBtn, false, '', normalText);
    }
  });
}

if (signOutDashboardBtn) {
  signOutDashboardBtn.addEventListener('click', async () => {
    const normalText = signOutDashboardBtn.textContent;
    setActionLoading(signOutDashboardBtn, true, 'Signing out...', normalText);
    try {
      await fetch('/api/parent-dashboard', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: freshBody({ action: 'signOut' })
      });
    } catch (_error) {
      // Local cleanup still completes if the network is temporarily unavailable.
    }
    dashboardLoadController?.abort();
    selectedChildLoadController?.abort();
    passportPhotoCache.forEach((objectUrl) => URL.revokeObjectURL(objectUrl));
    passportPhotoCache.clear();
    loadedPayables.clear();
    parentDocumentIdempotencyKeys.clear();
    parentNotifications = [];
    renderParentNotifications();
    if (parentNotificationPanel) parentNotificationPanel.hidden = true;
    parentNotificationsBtn?.setAttribute('aria-expanded', 'false');
    dashboard = null;
    selectedChildKey = '';
    storeCart.clear();
    activeDashboardView = 'overview';
    dashboardContent.hidden = true;
    loginForm.hidden = false;
    loginForm.reset();
    setLoginLoading(false);
    window.location.replace('index.html');
  });
}

changeParentPasswordBtn?.addEventListener('click', () => {
  changeParentPasswordForm?.reset();
  const emailInput = document.getElementById('changeParentEmail');
  if (emailInput) emailInput.value = dashboard?.parentEmail || document.getElementById('parentEmail').value;
  if (changeParentPasswordStatus) {
    changeParentPasswordStatus.textContent = '';
    changeParentPasswordStatus.className = 'status';
  }
  changeParentPasswordDialog?.showModal();
});

function closeParentPasswordDialog() {
  changeParentPasswordForm?.reset();
  changeParentPasswordDialog?.close();
}

document.getElementById('closeChangeParentPasswordDialog')?.addEventListener('click', closeParentPasswordDialog);
document.getElementById('cancelChangeParentPassword')?.addEventListener('click', closeParentPasswordDialog);

changeParentPasswordForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter || document.getElementById('saveParentPasswordBtn');
  if (button?.disabled) return;
  const currentPassword = document.getElementById('currentParentPassword').value;
  const newPassword = document.getElementById('newParentPassword').value;
  const confirmPassword = document.getElementById('confirmParentPassword').value;
  if (newPassword !== confirmPassword) {
    changeParentPasswordStatus.textContent = 'The new password and confirmation do not match.';
    changeParentPasswordStatus.className = 'status bad';
    return;
  }
  const normalText = button?.textContent || 'Save Password';
  setActionLoading(button, true, 'Saving...', normalText);
  changeParentPasswordStatus.textContent = 'Changing password...';
  changeParentPasswordStatus.className = 'status';
  try {
    const response = await fetch('/api/parent-dashboard', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: freshBody({ action: 'changeParentPassword', currentPassword, newPassword, confirmPassword })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.message || 'Could not change the password.');
    changeParentPasswordStatus.textContent = data.message || 'Password changed.';
    changeParentPasswordStatus.className = 'status ok';
    window.setTimeout(closeParentPasswordDialog, 900);
  } catch (error) {
    changeParentPasswordStatus.textContent = error.message;
    changeParentPasswordStatus.className = 'status bad';
  } finally {
    setActionLoading(button, false, '', normalText);
  }
});

parentNotificationsBtn?.addEventListener('click', () => {
  const opening = Boolean(parentNotificationPanel?.hidden);
  if (parentNotificationPanel) parentNotificationPanel.hidden = !opening;
  parentNotificationsBtn.setAttribute('aria-expanded', opening ? 'true' : 'false');
  if (opening) void loadParentNotifications();
});

markAllParentNotificationsReadBtn?.addEventListener('click', () => {
  if (!markAllParentNotificationsReadBtn.disabled) {
    void markParentNotificationRead('', true, markAllParentNotificationsReadBtn);
  }
});

manageParentNotificationsBtn?.addEventListener('click', async () => {
  parentNotificationDialog?.showModal();
  try { await loadParentNotificationHistory(false); } catch (error) { setParentNotificationStatus(error.message, 'bad'); }
});
document.getElementById('closeParentNotificationDialog')?.addEventListener('click', () => parentNotificationDialog?.close());
['parentNotificationCategory', 'parentNotificationUnread', 'parentNotificationArchived'].forEach((id) => document.getElementById(id)?.addEventListener('change', () => loadParentNotificationHistory(false).catch((error) => setParentNotificationStatus(error.message, 'bad'))));
document.getElementById('refreshParentNotificationHistory')?.addEventListener('click', () => loadParentNotificationHistory(false).catch((error) => setParentNotificationStatus(error.message, 'bad')));
document.getElementById('loadMoreParentNotifications')?.addEventListener('click', () => loadParentNotificationHistory(true).catch((error) => setParentNotificationStatus(error.message, 'bad')));
parentNotificationHistory?.addEventListener('click', async (event) => {
  const item = event.target.closest('[data-parent-notification-id]');
  if (!item) return;
  const row = parentNotificationHistoryRows.find((record) => parentNotificationId(record) === item.dataset.parentNotificationId);
  try {
    if (event.target.closest('[data-parent-archive]')) {
      await parentNotificationRequest(row?.Archived ? 'unarchiveNotification' : 'archiveNotification', { notificationId: item.dataset.parentNotificationId });
      await loadParentNotificationHistory(false);
    } else {
      if (row && !parentNotificationIsRead(row)) await parentNotificationRequest('markNotificationRead', { notificationId: item.dataset.parentNotificationId });
      openParentNotificationAction(row?.ActionUrl || row?.actionUrl);
    }
  } catch (error) { setParentNotificationStatus(error.message, 'bad'); }
});
async function enableParentPushOnThisDevice() {
  try {
    await window.DynamaxWebPush.enable(parentNotificationMeta.messaging, (subscription) => parentNotificationRequest('subscribePush', { subscription }));
    setParentNotificationStatus('Push notifications are enabled on this device.', 'ok');
    renderParentPushPrompt();
  } catch (error) {
    const message = parentNotificationErrorMessage(error);
    setParentNotificationStatus(message, 'bad');
    const copy = document.getElementById('parentPushPromptCopy');
    if (copy) copy.textContent = message;
  }
}
document.getElementById('enableParentPushPrompt')?.addEventListener('click', enableParentPushOnThisDevice);
window.addEventListener('dynamax:foreground-notification', () => { if (dashboard) void loadParentNotifications(); });

if (dashboardNav) {
  dashboardNav.addEventListener('click', (event) => {
    const button = event.target.closest('[data-dashboard-target]');
    if (!button) return;
    showDashboardView(button.dataset.dashboardTarget, true);
    const child = selectedChild();
    if (child && button.dataset.dashboardTarget === 'results') {
      renderAcademicResults(child);
      renderEntranceResults(child);
    }
  });
}

loadParentDocumentSettings();

(async function restoreParentSession() {
  setLoginLoading(true);
  try {
    await loadDashboard({ sessionOnly: true, silent: true });
  } catch (_error) {
    dashboardContent.hidden = true;
    loginForm.hidden = false;
    setStatus('', '');
  } finally {
    setLoginLoading(false);
  }
}());

window.addEventListener('school-profile-ready', () => {
  const child = selectedChild();
  if (child) {
    renderAcademicResults(child);
    renderEntranceResults(child);
  }
});
