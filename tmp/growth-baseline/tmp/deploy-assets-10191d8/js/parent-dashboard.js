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
const entranceResults = document.getElementById('entranceResults');
const clinicRecords = document.getElementById('clinicRecords');
const schoolStores = document.getElementById('schoolStores');
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
const dashboardNav = document.getElementById('dashboardNav');
const dashboardViewPanels = Array.from(document.querySelectorAll('[data-dashboard-view]'));

let dashboard = null;
let selectedAccountRef = '';
let activeDashboardView = 'overview';
const loadedPayables = new Set();
const passportPhotoCache = new Map();
const storeCart = new Map();

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

async function loadPassportPhoto(child, image) {
  const reference = child.PassportPhotoApplicationReference || child.ApplicationReference || child.AccountRef;
  if (!child.PassportPhotoAvailable || !reference || !image) return;
  if (passportPhotoCache.has(reference)) {
    image.src = passportPhotoCache.get(reference);
    image.hidden = false;
    return;
  }
  try {
    const response = await fetch('/api/passport-photo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: freshBody({ ...authPayload(), applicationReference: reference })
    });
    if (!response.ok) return;
    const objectUrl = URL.createObjectURL(await response.blob());
    passportPhotoCache.set(reference, objectUrl);
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
    code: document.getElementById('verificationCode').value.trim().toUpperCase()
  };
}

function selectedChild() {
  return (dashboard?.children || []).find((child) => child.AccountRef === selectedAccountRef) || null;
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
  children.forEach((child) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'child-card' + (child.AccountRef === selectedAccountRef ? ' selected' : '');
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
      if (selectedAccountRef !== child.AccountRef) storeCart.clear();
      selectedAccountRef = child.AccountRef;
      renderDashboard();
      loadPayablesForSelected(true);
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

  const entries = dashboard.walletActivity?.[child.AccountRef] || [];
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
  const summary = dashboard.accountSummaries?.[child.AccountRef] || child || {};
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
  const records = dashboard.dueNotifications?.[child.AccountRef] || [];
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
  if (!force && loadedPayables.has(child.AccountRef)) return;
  loadedPayables.delete(child.AccountRef);
  loadedPayables.add(child.AccountRef);
  dashboard.payableItems = dashboard.payableItems || {};
  dashboard.payableErrors = dashboard.payableErrors || {};
  dashboard.dueNotifications = dashboard.dueNotifications || {};
  dashboard.accountSummaries = dashboard.accountSummaries || {};
  dashboard.walletActivity = dashboard.walletActivity || {};
  dashboard.paymentRecords = dashboard.paymentRecords || {};
  dashboard.clinicVisits = dashboard.clinicVisits || {};
  dashboard.entranceResults = dashboard.entranceResults || {};
  dashboard.payableItems[child.AccountRef] = [];
  dashboard.payableErrors[child.AccountRef] = '';
  renderPayableItems(child);
  renderDueNotifications(child);
  renderWallet(child);
  renderPayments(child);
  renderClinic(child);
  renderEntranceResults(child);
  try {
    const baseBody = {
      ...authPayload(),
      accountRef: child.AccountRef,
      sourceType: child.SourceType || 'Student',
      scopePath: child.__scopePath || ''
    };
    const payableRequest = fetch('/api/parent-dashboard', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: freshBody({
        action: 'getChildPayable',
        ...baseBody
      })
    });
    const activityRequest = fetch('/api/parent-dashboard', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: freshBody({
        action: 'getChildActivity',
        ...baseBody
      })
    });
    const [payableResponse, activityResponse] = await Promise.all([payableRequest, activityRequest]);
    const payableData = await payableResponse.json();
    const activityData = await activityResponse.json();
    if (!payableResponse.ok || !payableData.ok) {
      dashboard.payableErrors[child.AccountRef] = payableData.message || 'Could not load payable items.';
    } else {
      dashboard.payableItems[child.AccountRef] = payableData.payableItems || [];
      dashboard.dueNotifications[child.AccountRef] = payableData.dueNotifications || [];
    }
    if (activityResponse.ok && activityData.ok) {
      const payableNotices = dashboard.dueNotifications[child.AccountRef] || [];
      const activityNotices = activityData.dueNotifications || [];
      dashboard.dueNotifications[child.AccountRef] = [...new Map(
        [...payableNotices, ...activityNotices].map((notice) => [[
          notice.FeeCode,
          notice.FeeName,
          notice.DueDate,
          notice.AcademicSession,
          notice.Term
        ].map((value) => String(value || '').trim().toLowerCase()).join('|'), notice])
      ).values()];
      if (typeof activityData.showResultsOnline === 'boolean') {
        dashboard.showResultsOnline = activityData.showResultsOnline;
      }
      if (activityData.resultDisplayMode) {
        dashboard.resultDisplayMode = activityData.resultDisplayMode;
      }
      dashboard.walletActivity[child.AccountRef] = activityData.walletActivity || [];
      if (activityData.accountSummary) {
        dashboard.accountSummaries[child.AccountRef] = activityData.accountSummary;
        Object.assign(child, activityData.accountSummary);
      }
      dashboard.paymentRecords[child.AccountRef] = activityData.paymentRecords || [];
      dashboard.clinicVisits[child.AccountRef] = activityData.clinicVisits || [];
      dashboard.entranceResults[child.AccountRef] = activityData.entranceResults || [];
      dashboard.storeCatalog = activityData.storeCatalog || [];
      dashboard.storeOrders = activityData.storeOrders || [];
      child.WalletBalance = activityData.walletBalance ?? child.WalletBalance;
    } else {
      dashboard.payableErrors[child.AccountRef] = dashboard.payableErrors[child.AccountRef] || activityData.message || 'Could not load child activity.';
    }
  } catch (error) {
    dashboard.payableItems[child.AccountRef] = [];
    dashboard.dueNotifications[child.AccountRef] = [];
    dashboard.payableErrors[child.AccountRef] = error.message;
  }
  renderPayableItems(child);
  renderDueNotifications(child);
  renderAccountCredit(child);
  renderWallet(child);
  renderPayments(child);
  renderClinic(child);
  renderEntranceResults(child);
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
  try {
    setPaymentStatus(container, 'Starting secure checkout...', '');
    const response = await fetch('/api/init-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...authPayload(),
        accountRef: child.AccountRef,
        sourceType: child.SourceType || 'Student',
        scopePath: child.__scopePath || '',
        feeCode: fee.FeeCode,
        components: fee.Components || undefined,
        amount: (isWalletFee(fee) || isYes(fee.AllowInstallment)) ? amount : undefined
      })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || 'Could not initialize payment.');
    }
    window.location.href = data.authorizationUrl;
  } catch (error) {
    setPaymentStatus(container, error.message, 'bad');
  }
}

function renderPayableItems(child) {
  const records = dashboard.payableItems?.[child.AccountRef] || [];
  const busFees = records.filter(isBusFee);
  const clubFees = records.filter(isClubFee);
  const otherFees = records.filter(isOtherOptionalFee);
  const directRecords = records.filter((fee) => !isBusFee(fee) && !isClubFee(fee) && !isOtherOptionalFee(fee));
  const optionalRecords = [...busFees, ...clubFees, ...otherFees];
  const payableError = dashboard.payableErrors?.[child.AccountRef] || '';
  const loading = !loadedPayables.has(child.AccountRef);
  payableItems.innerHTML = directRecords.length ? '' : `<p class="${payableError ? 'status bad' : 'muted'}">${payableError || (loading ? 'Loading payable items...' : 'There are no regular online payment items due at the moment.')}</p>`;
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
      input.min = fee.MinAmount || '1';
      if (fee.MaxAmount) input.max = fee.MaxAmount;
      input.step = '0.01';
      input.value = defaultAmount;
      input.inputMode = 'decimal';
      if (isWalletFee(fee) && isYes(fee.WalletLimitReached)) {
        input.disabled = true;
        input.value = '';
      }
      item.appendChild(label);
      item.appendChild(input);
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
  const records = dashboard.clinicVisits?.[child.AccountRef] || [];
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
  const records = dashboard.paymentRecords?.[child.AccountRef] || [];
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

function resultDisplayMode() {
  return dashboard?.resultDisplayMode || window.SCHOOL_PROFILE?.ResultDisplayMode || 'subjects';
}

function resultsOnlineEnabled() {
  if (typeof dashboard?.showResultsOnline === 'boolean') {
    return dashboard.showResultsOnline;
  }
  const profileValue = String(window.SCHOOL_PROFILE?.ShowResultsOnline || '').trim().toUpperCase();
  return profileValue === 'YES';
}

function renderEntranceResults(child) {
  const records = dashboard.entranceResults?.[child.AccountRef] || [];
  if (!resultsOnlineEnabled() && records.length === 0) {
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
    if (resultDisplayMode() === 'percentage') {
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
        actionStatus.textContent = 'The customized PDF will be generated and saved when you download it.';
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
  button.disabled = true;
  button.textContent = 'Preparing download...';
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
    await loadDashboard();
  } catch (error) {
    const message = error.message || String(error);
    setStatus(message, 'bad');
    if (actionStatus) {
      actionStatus.textContent = message;
      actionStatus.classList.add('bad');
    }
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

function renderDashboard() {
  const children = dashboard?.children || [];
  if (!selectedAccountRef && children.length) {
    selectedAccountRef = children[0].AccountRef;
  }
  renderChildren();
  const child = selectedChild();
  if (!child) return;
  renderDueNotifications(child);
  renderPayableItems(child);
  renderAccountCredit(child);
  renderEntranceResults(child);
  renderWallet(child);
  renderPayments(child);
  renderClinic(child);
  renderStores(child);
}

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
  const catalog = (dashboard.storeCatalog || []).filter((item) => storeItemMatchesChild(item, child));
  schoolStores.innerHTML = catalog.length ? '' : '<p class="muted">No school-store items are currently available.</p>';
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
      const qty = document.createElement('input'); qty.type = 'number'; qty.min = '1'; qty.max = String(item.Quantity || 1); qty.value = '1'; qty.className = 'store-quantity';
      const buy = document.createElement('button'); buy.type = 'button'; buy.textContent = 'Add to Cart';
      buy.addEventListener('click', () => {
        const quantity = Math.max(1, Math.min(Number(item.Quantity || 1), Number(qty.value || 1)));
        const key = `${item.StoreType}|${item.ItemCode}`;
        const existing = storeCart.get(key);
        storeCart.set(key, { item, quantity: Math.min(Number(item.Quantity || 1), quantity + (existing?.quantity || 0)) });
        renderStoreCart(child);
      });
      row.append(qty, buy); section.appendChild(row);
    });
    schoolStores.appendChild(section);
  });
  renderStoreCart(child);
  const orders = (dashboard.storeOrders || []).filter((order) => String(order.AccountRef || order.AdmissionNo).toLowerCase() === String(child.AccountRef).toLowerCase());
  storeOrders.innerHTML = orders.length ? '' : '<p class="muted">No store orders recorded for this student.</p>';
  orders.forEach((order) => {
    const row = document.createElement('div'); row.className = 'activity-item';
    row.innerHTML = `<strong>${escapeHtml(order.StoreType || 'School Store')} - ${escapeHtml(order.OrderNo)}</strong><span>${escapeHtml(order.Status || 'Paid - Awaiting Collection')}</span><small>${money(order.Amount)} | ${escapeHtml(order.PaidAt || order.CreatedAt || '')}</small>`;
    storeOrders.appendChild(row);
  });
}

function renderStoreCart(child) {
  if (!storeCartEl || !checkoutStoreCartBtn) return;
  const entries = [...storeCart.entries()];
  storeCartEl.innerHTML = entries.length ? '' : '<p class="muted">Your cart is empty.</p>';
  let total = 0;
  entries.forEach(([key, entry]) => {
    total += Number(entry.item.Price || 0) * entry.quantity;
    const row = document.createElement('div'); row.className = 'activity-item store-item-row';
    row.innerHTML = `<strong>${escapeHtml(entry.item.ItemName)}</strong><span>${escapeHtml(entry.item.StoreType)} × ${entry.quantity}</span><small>${money(Number(entry.item.Price || 0) * entry.quantity)}</small>`;
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove';
    remove.addEventListener('click', () => { storeCart.delete(key); renderStoreCart(child); });
    row.appendChild(remove); storeCartEl.appendChild(row);
  });
  checkoutStoreCartBtn.disabled = !entries.length;
  checkoutStoreCartBtn.textContent = entries.length ? `Checkout ${money(total)}` : 'Checkout Cart';
  checkoutStoreCartBtn.onclick = async () => {
    checkoutStoreCartBtn.disabled = true;
    if (storeCheckoutStatus) { storeCheckoutStatus.textContent = 'Connecting to Paystack...'; storeCheckoutStatus.className = 'status'; }
    try {
      const cart = entries.map(([, entry]) => ({ itemCode: entry.item.ItemCode, storeType: entry.item.StoreType, quantity: entry.quantity }));
      const response = await fetch('/api/init-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...authPayload(),
          accountRef: child.AccountRef,
          sourceType: child.SourceType || 'Student',
          scopePath: child.__scopePath || '',
          feeCode: 'STORE_CART',
          amount: total,
          storeCart: cart
        })
      });
      const responseText = await response.text();
      let data = {};
      try { data = JSON.parse(responseText); } catch (_error) { throw new Error(`Checkout service returned an invalid response (HTTP ${response.status}). Please try again.`); }
      if (!response.ok || !data.ok) throw new Error(data.message || 'Could not start store checkout.');
      if (!data.authorizationUrl) throw new Error('Paystack did not return a checkout link. Please contact the school accounts office.');
      if (storeCheckoutStatus) { storeCheckoutStatus.textContent = 'Opening Paystack secure checkout...'; storeCheckoutStatus.className = 'status ok'; }
      window.location.assign(data.authorizationUrl);
    } catch (error) {
      const message = String(error?.message || error || 'Could not start checkout.').replace(/^Error:\s*/, '');
      if (storeCheckoutStatus) { storeCheckoutStatus.textContent = message; storeCheckoutStatus.className = 'status bad'; }
      setStatus(message, 'bad'); checkoutStoreCartBtn.disabled = false;
    }
  };
}

async function loadDashboard() {
  const previousAccountRef = selectedAccountRef;
  const payload = authPayload();
  if (!payload.email || !payload.code) {
    setStatus('Email and verification code are required.', 'bad');
    return;
  }
  setStatus('Loading dashboard...', '');
  const response = await fetch('/api/parent-dashboard', {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: freshBody({ action: 'getDashboard', ...payload })
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.message || 'Could not load parent dashboard.');
  }
  dashboard = data;
  loadedPayables.clear();
  selectedAccountRef = data.children?.some((child) => child.AccountRef === previousAccountRef)
    ? previousAccountRef
    : (data.children?.[0]?.AccountRef || '');
  dashboardContent.hidden = false;
  loginForm.hidden = true;
  renderDashboard();
  showDashboardView(activeDashboardView);
  await loadPayablesForSelected(true);
  setStatus('Dashboard loaded.', 'ok');
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
  const child = selectedChild();
  if (!child) {
    setStatus('Select a child first.', 'bad');
    return;
  }
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
    await loadDashboard();
    setStatus('Wallet restrictions saved.', 'ok');
  } catch (error) {
    setStatus(error.message, 'bad');
  }
});

if (refreshDashboardBtn) {
  refreshDashboardBtn.addEventListener('click', async () => {
    try {
      await loadDashboard();
    } catch (error) {
      setStatus(error.message, 'bad');
    }
  });
}

if (signOutDashboardBtn) {
  signOutDashboardBtn.addEventListener('click', () => {
    passportPhotoCache.forEach((objectUrl) => URL.revokeObjectURL(objectUrl));
    passportPhotoCache.clear();
    loadedPayables.clear();
    dashboard = null;
    selectedAccountRef = '';
    storeCart.clear();
    activeDashboardView = 'overview';
    dashboardContent.hidden = true;
    loginForm.hidden = false;
    loginForm.reset();
    setLoginLoading(false);
    setStatus('Signed out successfully.', 'ok');
    document.getElementById('parentEmail')?.focus();
    loginForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

if (dashboardNav) {
  dashboardNav.addEventListener('click', (event) => {
    const button = event.target.closest('[data-dashboard-target]');
    if (!button) return;
    showDashboardView(button.dataset.dashboardTarget, true);
    const child = selectedChild();
    if (child && button.dataset.dashboardTarget === 'results') renderEntranceResults(child);
  });
}

window.addEventListener('school-profile-ready', () => {
  const child = selectedChild();
  if (child) renderEntranceResults(child);
});
