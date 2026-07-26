const loginCard = document.getElementById('staffLoginCard');
const loginForm = document.getElementById('staffLoginForm');
const loginButton = document.getElementById('staffLoginButton');
const loginStatus = document.getElementById('staffLoginStatus');
const dashboardEl = document.getElementById('staffDashboard');
const dashboardStatus = document.getElementById('staffDashboardStatus');
const identityEl = document.getElementById('staffIdentity');
const displayNameEl = document.getElementById('staffDisplayName');
const roleEl = document.getElementById('staffRole');
const welcomeTitle = document.getElementById('staffWelcomeTitle');
const signOutButton = document.getElementById('staffSignOut');
const sidebarSignOutButton = document.getElementById('staffSidebarSignOut');
const refreshButton = document.getElementById('staffRefresh');
const summaryEl = document.getElementById('adminSummary');
const dashboardChartsEl = document.getElementById('dashboardCharts');
const tabsEl = document.getElementById('adminTabs');
const panelEl = document.getElementById('adminPanel');
const passwordDialog = document.getElementById('staffPasswordDialog');
const passwordForm = document.getElementById('staffPasswordForm');
const passwordButton = document.getElementById('staffPasswordButton');
const passwordStatus = document.getElementById('staffPasswordStatus');
const sidebarEl = document.getElementById('staffSidebar');
const sidebarScrim = document.getElementById('staffSidebarScrim');
const staffAvatar = document.getElementById('staffAvatar');
const editionLabel = document.getElementById('staffEditionLabel');
const workspaceTitle = document.getElementById('staffWorkspaceTitle');
const overviewLabel = document.getElementById('staffOverviewLabel');
const welcomeCopy = document.getElementById('staffWelcomeCopy');
const mobileNav = document.getElementById('staffMobileNav');
const moduleDialog = document.getElementById('staffModuleDialog');
const moduleGrid = document.getElementById('staffModuleGrid');
const moduleCloseButton = document.getElementById('staffModuleClose');

let currentUser = null;
let dashboardData = null;
let activeSection = '';
let financeData = null;
let staffUsersData = [];
let staffAuditData = [];
let staffApprovalAccounts = [];
let activeTabs = [];

const tabConfig = [
  ['admissions', 'Admissions'],
  ['formPurchases', 'Form Purchases'],
  ['students', 'Students'],
  ['members', 'Members & Households'],
  ['services', 'Services & Attendance'],
  ['funds', 'Funds & Mappings'],
  ['offerings', 'Offerings'],
  ['donations', 'Donations'],
  ['accounts', 'Accounts'],
  ['financeRequests', 'Bills & Requisitions'],
  ['payroll', 'My Payroll'],
  ['clinic', 'Clinic'],
  ['kitchen', 'Kitchen'],
  ['tuckShop', 'Tuck Shop'],
  ['bookstore', 'Books & Supplies'],
  ['uniformStore', 'Clothing & Supplies'],
  ['staffUsers', 'Staff & Permissions']
];

const tabIcons = {
  admissions: '✦', formPurchases: '▤', students: '♟', members: '♟',
  services: '◷', funds: '₦', offerings: '◉', donations: '♡', accounts: '▥',
  financeRequests: '✓', payroll: '▦', clinic: '+', kitchen: '⌂', tuckShop: '▣',
  bookstore: '▤', uniformStore: '◇', staffUsers: '♙'
};

function clean(value) {
  return String(value ?? '').trim();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function pick(row, keys) {
  for (const key of keys) {
    if (row && row[key] !== undefined && row[key] !== null && clean(row[key]) !== '') return row[key];
  }
  return '';
}

function money(value) {
  const amount = Number(String(value ?? '0').replace(/[₦,\s]/g, ''));
  return Number.isFinite(amount)
    ? new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(amount)
    : clean(value);
}

function setStatus(element, message, type = '') {
  element.textContent = message || '';
  element.className = type ? `status ${type}` : 'status';
}

function setButtonLoading(button, loading, loadingText, normalText) {
  button.disabled = loading;
  button.classList.toggle('is-loading', loading);
  button.setAttribute('aria-busy', loading ? 'true' : 'false');
  button.textContent = loading ? loadingText : normalText;
}

function setSidebarOpen(open) {
  const shouldOpen = Boolean(open) && window.matchMedia('(max-width: 680px)').matches && !dashboardEl.hidden;
  sidebarEl.classList.toggle('is-open', shouldOpen);
  sidebarScrim.hidden = !shouldOpen;
  document.body.classList.toggle('staff-sidebar-open', shouldOpen);
  if (shouldOpen) sidebarEl.querySelector('[data-tab]')?.focus();
}

function installSidebarSwipeGestures() {
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let tracking = false;
  let openingGesture = false;
  let gestureAxis = '';

  document.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1 || window.innerWidth > 680 || dashboardEl.hidden || moduleDialog.open) return;
    const touch = event.touches[0];
    const sidebarOpen = sidebarEl.classList.contains('is-open');
    const startedAtLeftEdge = touch.clientX <= 32;
    const startedInsideSidebar = sidebarOpen && sidebarEl.contains(event.target);
    if (!startedAtLeftEdge && !startedInsideSidebar) return;
    startX = touch.clientX;
    startY = touch.clientY;
    lastX = startX;
    openingGesture = !sidebarOpen && startedAtLeftEdge;
    gestureAxis = '';
    tracking = true;
  }, { passive: true });

  document.addEventListener('touchmove', (event) => {
    if (!tracking || event.touches.length !== 1) return;
    lastX = event.touches[0].clientX;
    const deltaX = lastX - startX;
    const deltaY = event.touches[0].clientY - startY;
    if (!gestureAxis && Math.max(Math.abs(deltaX), Math.abs(deltaY)) >= 10) {
      gestureAxis = Math.abs(deltaX) > Math.abs(deltaY) ? 'horizontal' : 'vertical';
    }
    if (gestureAxis === 'vertical') {
      tracking = false;
      return;
    }
    const movingInExpectedDirection = openingGesture ? deltaX > 0 : deltaX < 0;
    if (gestureAxis === 'horizontal' && movingInExpectedDirection) event.preventDefault();
  }, { passive: false });

  document.addEventListener('touchend', (event) => {
    if (!tracking) return;
    const touch = event.changedTouches[0];
    const deltaX = (touch?.clientX ?? lastX) - startX;
    const deltaY = (touch?.clientY ?? startY) - startY;
    tracking = false;
    if (gestureAxis !== 'horizontal') return;
    if (openingGesture && deltaX >= 64 && Math.abs(deltaX) > Math.abs(deltaY)) setSidebarOpen(true);
    if (!openingGesture && deltaX <= -38 && Math.abs(deltaX) >= Math.abs(deltaY) * .85) setSidebarOpen(false);
  }, { passive: true });

  document.addEventListener('touchcancel', () => {
    tracking = false;
    gestureAxis = '';
  }, { passive: true });
}

function showLogin(message = '', type = '') {
  setSidebarOpen(false);
  currentUser = null;
  dashboardData = null;
  activeSection = '';
  activeTabs = [];
  dashboardEl.hidden = true;
  identityEl.hidden = true;
  mobileNav.hidden = true;
  if (moduleDialog.open) moduleDialog.close();
  loginCard.hidden = false;
  setStatus(loginStatus, message, type);
}

function showDashboard(user) {
  currentUser = user;
  const displayName = user.displayName || user.username || 'Staff';
  const explicitEdition = clean(user.organisationEdition || user.organizationEdition || user.edition).toLowerCase();
  const profileName = clean(window.SCHOOL_PROFILE?.SchoolName);
  const isChurch = explicitEdition === 'church' || /dunamis|digc|church/i.test(profileName);
  displayNameEl.textContent = displayName;
  roleEl.textContent = [user.role, user.department].filter(Boolean).join(' • ');
  staffAvatar.textContent = displayName.charAt(0).toUpperCase();
  sidebarEl.querySelector('.staff-sidebar-heading')?.setAttribute('data-initial', displayName.charAt(0).toUpperCase());
  editionLabel.textContent = isChurch ? 'Church Operations' : 'Staff Web Companion';
  workspaceTitle.textContent = isChurch ? 'Church Operations' : 'Operations Centre';
  overviewLabel.textContent = isChurch ? 'Ministry overview' : 'Operations overview';
  welcomeCopy.textContent = isChurch
    ? 'Monitor giving, members, services and ministry activity.'
    : 'Monitor records, requests and departmental activity.';
  welcomeTitle.textContent = `Welcome, ${displayName}`;
  document.documentElement.dataset.edition = isChurch ? 'church' : 'school';
  loginCard.hidden = true;
  identityEl.hidden = false;
  dashboardEl.hidden = false;
  mobileNav.hidden = false;
}

async function continueAfterAuthentication(user) {
  showDashboard(user);
  if (user.mustChangePassword) {
    passwordDialog.showModal();
    document.getElementById('staffNewPassword').focus();
    return;
  }
  await loadDashboard();
}

async function sessionRequest(method = 'GET', body = null) {
  const response = await fetch('/api/staff-session', {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({ ok: false, message: 'Staff authentication did not return JSON.' }));
  return { response, data };
}

async function loadDashboard() {
  setButtonLoading(refreshButton, true, 'Refreshing...', 'Refresh Dashboard');
  setStatus(dashboardStatus, 'Loading permitted Firestore records...');
  try {
    const response = await fetch('/api/admin', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    const data = await response.json().catch(() => ({ ok: false, message: 'Staff dashboard did not return JSON.' }));
    if (response.status === 401) {
      showLogin(data.message || 'Your staff session has expired.', 'bad');
      return;
    }
    if (!response.ok || !data.ok) throw new Error(data.message || 'Could not load staff dashboard.');
    dashboardData = data;
    currentUser = data.user || currentUser;
    showDashboard(currentUser);
    renderSummary(data.summary || {});
    renderDashboardCharts(data.charts || {});
    const allowed = data.allowedSections || currentUser.allowedSections || [];
    if (!activeSection || !allowed.includes(activeSection)) activeSection = allowed[0] || '';
    renderTabs(allowed);
    renderSection(activeSection);
    setStatus(dashboardStatus, 'Dashboard updated.', 'ok');
  } catch (error) {
    setStatus(dashboardStatus, error.message || String(error), 'bad');
  } finally {
    setButtonLoading(refreshButton, false, 'Refreshing...', 'Refresh Dashboard');
  }
}

function renderDashboardCharts(charts) {
  if (!dashboardChartsEl) return;
  if (document.documentElement.dataset.edition === 'church') {
    dashboardChartsEl.hidden = true;
    dashboardChartsEl.innerHTML = '';
    return;
  }
  dashboardChartsEl.hidden = false;
  const groups = [
    ['Students by Gender', charts.studentGender || [], false],
    ['New Intake / Returning', charts.studentCategory || [], false],
    ['Fee Balance by Class', charts.classBalances || [], true],
    ['Top 10 Defaulters', charts.topDefaulters || [], true]
  ];
  dashboardChartsEl.innerHTML = groups.map(([title, rows, currency]) => {
    const max = Math.max(1, ...rows.map((row) => Number(row.value || 0)));
    const bars = rows.length ? rows.map((row) => `<div class="chart-row"><span title="${escapeHtml(row.label)}">${escapeHtml(row.label)}${row.secondary ? `<small>${escapeHtml(row.secondary)}</small>` : ''}</span><i><b style="width:${Math.max(2, Math.round(Number(row.value || 0) / max * 100))}%"></b></i><strong>${currency ? money(row.value) : escapeHtml(row.value)}</strong></div>`).join('') : '<p class="muted">No data yet.</p>';
    return `<article><h3>${escapeHtml(title)}</h3>${bars}</article>`;
  }).join('');
}

function renderSummary(summary) {
  const items = [
    ['Applications', summary.applications],
    ['Form Purchases', summary.formPurchases],
    ['Payments', summary.payments],
    ['Invoices', summary.invoices],
    ['Clinic Records', summary.clinicRecords],
    ['Kitchen Items', summary.kitchenInventory],
    ['Tuck Shop Purchases', summary.tuckShopPurchases],
    ['Low Clinic Stock', summary.lowClinicStock],
    ['Low Kitchen Stock', summary.lowKitchenStock]
  ].filter(([, value]) => value !== undefined);
  const studentCard = summary.students === undefined ? '' : `<div class="student-summary-card"><strong>${escapeHtml(summary.students || 0)}</strong><span>Total Students</span><small><b>${escapeHtml(summary.dayStudents || 0)}</b> Day <i></i> <b>${escapeHtml(summary.boardingStudents || 0)}</b> Boarding</small></div>`;
  summaryEl.innerHTML = studentCard + items.map(([label, value]) => `<div><strong>${escapeHtml(value || 0)}</strong><span>${escapeHtml(label)}</span></div>`).join('');
}

function renderTabs(allowed) {
  const tabs = tabConfig.filter(([key]) => allowed.includes(key));
  activeTabs = tabs;
  const isChurch = tabs.some(([key]) => key === 'members' || key === 'services');
  if (isChurch) {
    document.documentElement.dataset.edition = 'church';
    editionLabel.textContent = 'Church Operations';
    workspaceTitle.textContent = 'Church Operations';
    overviewLabel.textContent = 'Ministry overview';
    welcomeCopy.textContent = 'Monitor giving, members, services and ministry activity.';
  }
  tabsEl.innerHTML = tabs.map(([key, label]) => {
    const selected = key === activeSection ? ' selected' : '';
    return `<button type="button" class="child-card${selected}" data-tab="${escapeHtml(key)}" aria-selected="${key === activeSection}">${escapeHtml(label)}</button>`;
  }).join('');
  tabsEl.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => selectSection(button.dataset.tab, allowed));
  });
  renderMobileNavigation(tabs);
}

function selectSection(key, allowed = activeTabs.map(([tabKey]) => tabKey)) {
  if (!allowed.includes(key)) return;
  activeSection = key;
  renderTabs(allowed);
  renderSection(activeSection);
  setSidebarOpen(false);
  if (moduleDialog.open) moduleDialog.close();
  panelEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderMobileNavigation(tabs) {
  if (!tabs.length) {
    mobileNav.innerHTML = '';
    moduleGrid.innerHTML = '';
    return;
  }
  const findTab = (...keys) => tabs.find(([key]) => keys.includes(key));
  const homeTab = tabs[0];
  const peopleTab = findTab('members', 'students', 'services', 'admissions') || homeTab;
  const financeTab = findTab('donations', 'offerings', 'funds', 'accounts', 'financeRequests') || homeTab;
  const items = [
    [homeTab[0], '⌂', 'Home'],
    [peopleTab[0], tabIcons[peopleTab[0]] || '♟', peopleTab[0] === 'members' ? 'Members' : 'People'],
    ['__modules__', '▦', 'Modules'],
    [financeTab[0], tabIcons[financeTab[0]] || '₦', 'Finance'],
    ['__more__', '☰', 'More']
  ];
  mobileNav.innerHTML = items.map(([key, icon, label]) => {
    const selected = key === activeSection ? ' selected' : '';
    const central = key === '__modules__' ? ' mobile-nav-centre' : '';
    return `<button type="button" class="${selected}${central}" data-mobile-tab="${escapeHtml(key)}" aria-label="${escapeHtml(label)}"><span>${escapeHtml(icon)}</span><small>${escapeHtml(label)}</small></button>`;
  }).join('');
  moduleGrid.innerHTML = tabs.map(([key, label], index) => `<button type="button" data-module="${escapeHtml(key)}" class="module-tone-${index % 6}${key === activeSection ? ' selected' : ''}"><span>${escapeHtml(tabIcons[key] || '•')}</span><strong>${escapeHtml(label)}</strong></button>`).join('');
}

function table(title, rows, columns) {
  const body = rows && rows.length
    ? rows.map((row) => `<tr>${columns.map((column) => `<td>${column.render ? column.render(row) : escapeHtml(column.value(row))}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${columns.length}">No records found.</td></tr>`;
  return `
    <h2>${escapeHtml(title)}</h2>
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead><tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('')}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

const studentProfileSections = [
  ['Student identity', ['DisplayName', 'Surname', 'FirstName', 'MiddleName', 'Gender', 'DateOfBirth', 'PreviousSchool']],
  ['Enrollment', ['ClassName', 'ClassArm', 'StudentType', 'BillingCategory', 'EnrollmentCategory', 'AcademicProgress', 'AcademicSession', 'Term']],
  ['Parent and login', ['ParentName', 'ParentPhone', 'ParentEmail', 'ParentLoginCode', 'ResidentialAddress', 'CityArea', 'StateOfResidence']],
  ['Medical and emergency', ['BloodGroup', 'Genotype', 'MedicalCondition', 'EmergencyContactName', 'EmergencyContactPhone']],
  ['Status and student card', ['Status', 'StatusReason', 'StatusEffectiveDate', 'ExpectedReturnDate', 'WalletCardId', 'WalletCardStatus']]
];

function studentFieldLabel(field) {
  return field.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/Id$/, 'ID');
}

function studentFieldControl(field, value) {
  const safeValue = escapeHtml(value || '');
  const options = {
    Gender: ['', 'Male', 'Female'],
    StudentType: ['', 'Day Student', 'Boarding Student', 'Day', 'Boarding'],
    EnrollmentCategory: ['New Intake', 'Returning'],
    AcademicProgress: ['Promoted', 'Repeating'],
    Term: ['First Term', 'Second Term', 'Third Term'],
    Status: ['Active', 'Enrolled', 'Withdrawn', 'Expelled', 'Graduated'],
    WalletCardStatus: ['', 'Active', 'Blocked', 'Lost', 'Replaced']
  };
  if (options[field]) {
    const values = options[field].includes(value) ? options[field] : [value, ...options[field]];
    return `<select name="${field}">${values.map((item) => `<option value="${escapeHtml(item)}"${clean(item) === clean(value) ? ' selected' : ''}>${escapeHtml(item || 'Select')}</option>`).join('')}</select>`;
  }
  const type = field === 'ParentEmail' ? 'email' : ['DateOfBirth', 'StatusEffectiveDate', 'ExpectedReturnDate'].includes(field) ? 'date' : 'text';
  return `<input name="${field}" type="${type}" value="${safeValue}">`;
}

function renderStudentEditor(students) {
  return `<dialog id="studentProfileDialog" class="workflow-dialog student-profile-dialog">
    <div class="workflow-dialog-header"><div><small>Student register</small><h2>Edit Student Profile</h2></div><button type="button" data-close-student-dialog aria-label="Close">&times;</button></div>
    <form id="studentProfileForm" class="workflow-form config-dialog-form">
      <input type="hidden" name="AccountRef">
      <div class="student-login-guidance"><strong>Parent login</strong><span>Imported parents use Parent Email and Parent Login Code on the Parent Dashboard.</span></div>
      <div data-student-form-sections></div>
      <div class="config-dialog-actions"><p class="status" data-student-form-status></p><button type="submit">Save student profile</button></div>
    </form>
  </dialog>`;
}

function openStudentEditor(student) {
  const dialog = document.getElementById('studentProfileDialog');
  const form = document.getElementById('studentProfileForm');
  if (!dialog || !form || !student) return;
  form.elements.AccountRef.value = pick(student, ['AdmissionNo', 'AccountRef', '__id']);
  form.querySelector('[data-student-form-sections]').innerHTML = studentProfileSections.map(([title, fields]) => `
    <section class="config-group"><header><strong>${escapeHtml(title)}</strong></header><div class="config-grid">
      ${fields.map((field) => {
        let value = pick(student, [field]);
        if (field === 'DisplayName') value = value || pick(student, ['ApplicantName', 'StudentName']);
        if (field === 'ClassName') value = value || pick(student, ['ClassAdmitted']);
        if (field === 'ParentLoginCode') value = value || pick(student, ['VerificationCode']);
        return `<label>${escapeHtml(studentFieldLabel(field))}${studentFieldControl(field, value)}${field === 'ParentLoginCode' ? '<button type="button" class="student-code-generator" data-generate-student-code>Generate secure code</button>' : ''}</label>`;
      }).join('')}
    </div></section>`).join('');
  form.querySelector('[data-generate-student-code]')?.addEventListener('click', () => {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    form.elements.ParentLoginCode.value = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
  });
  setStatus(form.querySelector('[data-student-form-status]'), '', '');
  dialog.showModal();
}

function bindStudentEditor(students) {
  document.querySelector('[data-close-student-dialog]')?.addEventListener('click', () => document.getElementById('studentProfileDialog')?.close());
  panelEl.querySelectorAll('[data-edit-student]').forEach((button) => button.addEventListener('click', () => {
    const student = students.find((row) => clean(pick(row, ['AdmissionNo', 'AccountRef', '__id'])).toLowerCase() === clean(button.dataset.editStudent).toLowerCase());
    openStudentEditor(student);
  }));
  document.getElementById('studentProfileForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const status = form.querySelector('[data-student-form-status]');
    const button = form.querySelector('button[type="submit"]');
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.action = 'update';
    payload.VerificationCode = payload.ParentLoginCode || '';
    setButtonLoading(button, true, 'Saving...', 'Save student profile');
    try {
      const response = await fetch('/api/staff-students', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || 'Could not update student profile.');
      setStatus(status, data.message, 'ok');
      await loadDashboard();
      document.getElementById('studentProfileDialog')?.close();
    } catch (error) {
      setStatus(status, error.message || String(error), 'bad');
    } finally {
      setButtonLoading(button, false, 'Saving...', 'Save student profile');
    }
  });
}

const admissionDocuments = [
  ['BirthCertificate', 'Birth Certificate'],
  ['PreviousSchoolReport', 'Previous School Report'],
  ['PassportPhotograph', 'Passport Photograph'],
  ['MedicalReport', 'Medical Report'],
  ['TransferCertificateDoc', 'Transfer Certificate'],
  ['AcceptanceForm', 'Acceptance Form']
];

function uploadedDocument(row, key) {
  const documents = row && row.documents && typeof row.documents === 'object' ? row.documents : {};
  const entry = documents[key] && typeof documents[key] === 'object' ? documents[key] : {};
  const url = clean(entry.url || row[`Doc${key}Url`] || row[`${key}Url`] || row[`${key}Link`]);
  return url ? { key, fileName: clean(entry.fileName) } : null;
}

function renderAdmissionDocuments(row) {
  const reference = pick(row, ['ApplicationReference', 'ApplicationID', '__id']);
  const uploaded = admissionDocuments.map(([key, label]) => {
    const item = uploadedDocument(row, key);
    return item ? { ...item, label } : null;
  }).filter(Boolean);
  if (!uploaded.length) return '<span class="muted">None uploaded</span>';
  const links = uploaded.map((item) => {
    const query = `applicationReference=${encodeURIComponent(reference)}&documentType=${encodeURIComponent(item.key)}`;
    const canDelete = ['Super Admin', 'Admissions Officer'].includes(clean(currentUser?.role));
    return `<div class="document-action-row"><span>${escapeHtml(item.label)}</span><a href="/api/staff-document?${query}&mode=view" target="_blank" rel="noopener">View</a><a href="/api/staff-document?${query}&mode=download">Download</a>${canDelete ? `<button type="button" class="document-delete compact-icon-action compact-delete-action" data-delete-document="${escapeHtml(item.key)}" data-application-reference="${escapeHtml(reference)}" aria-label="Delete ${escapeHtml(item.label)}" title="Delete document"><span aria-hidden="true">&#128465;&#65038;</span></button>` : ''}</div>`;
  }).join('');
  return `<details class="document-actions"><summary>${uploaded.length} document${uploaded.length === 1 ? '' : 's'}</summary>${links}</details>`;
}

function inventoryColumns() {
  return [
    { label: 'Item', value: (row) => pick(row, ['ItemName', '__id']) },
    { label: 'Category', value: (row) => pick(row, ['Category']) },
    { label: 'Unit', value: (row) => pick(row, ['Unit']) },
    { label: 'Quantity', value: (row) => pick(row, ['Quantity']) },
    { label: 'Reorder Level', value: (row) => pick(row, ['ReorderLevel']) }
  ];
}

function renderStaffStore(section, store) {
  const label = section === 'bookstore' ? 'Bookstore' : 'Uniform Store';
  const categories = store.categories || [];
  const activeCategories = categories.filter((row) => clean(row.Active || 'YES') !== 'NO');
  panelEl.innerHTML = `
    <div class="workflow-intro"><div><p class="eyebrow">School store</p><h2>${label}</h2><p class="muted">List items and prices, monitor paid orders, and record collection.</p></div></div>
    <section class="config-card">
      <header class="config-card-heading"><div><small>Inventory setup</small><h3>Add or update an item</h3><p>Define how this product appears to parents and storekeepers.</p></div></header>
    <form id="staffStoreItemForm" class="workflow-form workflow-form-grid config-form">
      <label>Item code<input name="ItemCode" required></label><label>Item name<input name="ItemName" required></label>
      <label>Category<input name="Category" list="storeCategoryOptions" autocomplete="off" required><datalist id="storeCategoryOptions">${activeCategories.map((row) => `<option value="${escapeHtml(row.Name)}"></option>`).join('')}</datalist></label><label>Size<input name="Size"></label>
      <label>Gender<select name="Gender"><option>All</option><option>Male</option><option>Female</option></select></label><label>Class<input name="ClassName" value="All"></label>
      <label>Price<input name="Price" type="number" min="0" step="0.01" required></label><label>Stock quantity<input name="Quantity" type="number" min="0" step="1" required></label>
      <div class="config-actionbar"><label class="check-row"><input name="Active" type="checkbox" checked> Available to parents</label><p class="status" data-store-status></p><button type="submit">Save item</button></div>
    </form>
    </section>
    <details class="workflow-card config-details"><summary><span>Category management<small>Add, rename or deactivate reusable product categories.</small></span></summary>
      <form id="storeCategoryForm" class="workflow-form workflow-form-grid config-form"><input type="hidden" name="CategoryId"><label>Category name<input name="Name" required></label><label>Available in<select name="AppliesTo"><option value="${label}">${label}</option><option value="Bookstore,Uniform Store">Both stores</option></select></label><div class="config-actionbar"><label class="check-row"><input name="Active" type="checkbox" checked> Category active</label><p class="status" data-category-status></p><button type="submit">Save category</button></div></form>
      <div class="workflow-record-list store-category-list">${categories.length ? categories.map((row) => {
        const categoryActive = clean(row.Active || 'YES') !== 'NO';
        return `<article class="workflow-record store-category-row"><div class="store-category-copy"><strong>${escapeHtml(row.Name)}</strong><small>${escapeHtml((row.StoreScopes || []).join(', '))}</small></div><div class="store-category-actions"><button type="button" class="store-category-edit compact-icon-action compact-edit-action" data-edit-category="${escapeHtml(row.CategoryId)}" aria-label="Edit ${escapeHtml(row.Name)}" title="Edit category"><span aria-hidden="true">&#9998;</span></button><label class="store-category-toggle"><input type="checkbox" data-category-active="${escapeHtml(row.CategoryId)}" aria-label="${categoryActive ? 'Deactivate' : 'Activate'} ${escapeHtml(row.Name)}" ${categoryActive ? 'checked' : ''}><span>Active</span></label></div></article>`;
      }).join('') : '<p class="muted">Existing item categories will be added here automatically.</p>'}</div>
    </details>
    ${table(`${label} Items`, store.items || [], [
      { label: 'Code', value: (row) => pick(row, ['ItemCode', '__id']) }, { label: 'Item', value: (row) => pick(row, ['ItemName']) },
      { label: 'Category / Size', value: (row) => [pick(row, ['Category']), pick(row, ['Size'])].filter(Boolean).join(' / ') },
      { label: 'Price', value: (row) => money(pick(row, ['Price'])) }, { label: 'Stock', value: (row) => pick(row, ['Quantity']) }
    ])}
    <h2>Paid Orders & Collection</h2><div class="workflow-record-list">${(store.orders || []).length ? (store.orders || []).map((order) => {
      const orderStatus = clean(order.Status || 'Paid - Awaiting Collection');
      const statusKey = orderStatus.toLowerCase();
      const collected = statusKey === 'collected';
      const ready = statusKey === 'ready for collection';
      const nextStatus = ready ? 'Collected' : 'Ready for Collection';
      const statusLabel = collected ? 'Collected' : ready ? 'Ready · Verify Collection' : 'Paid · Mark Ready';
      return `
      <article class="workflow-record store-order-record"><div class="workflow-record-heading"><div><strong>${escapeHtml(order.DisplayName || order.AccountRef)}</strong><small>${escapeHtml(order.OrderNo)}</small></div></div>
      <p>${money(order.Amount)} &middot; ${escapeHtml(order.PaidAt || order.CreatedAt || '')}</p>
      <button type="button" class="store-order-status ${collected ? 'is-collected' : ''}" data-store-order="${escapeHtml(order.OrderNo)}" data-store-status="${escapeHtml(nextStatus)}" aria-label="${escapeHtml(statusLabel)} for ${escapeHtml(order.DisplayName || order.AccountRef)}" ${collected ? 'disabled' : ''}>${escapeHtml(statusLabel)}</button></article>`;
    }).join('') : '<p class="muted">No paid orders yet.</p>'}</div>`;
  document.getElementById('staffStoreItemForm')?.addEventListener('submit', async (event) => {
    event.preventDefault(); const form = event.currentTarget; const status = form.querySelector('[data-store-status]');
    const payload = Object.fromEntries(new FormData(form).entries()); payload.Active = form.elements.Active.checked;
    const match = activeCategories.find((row) => clean(row.Name).toLowerCase() === clean(payload.Category).toLowerCase());
    if (!match && !window.confirm(`Create "${payload.Category}" as a new ${label} category?`)) return;
    payload.CategoryId = match?.CategoryId || ''; payload.CreateCategoryIfMissing = !match;
    try {
      const response = await fetch('/api/staff-stores', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'saveItem', section, ...payload }) });
      const data = await response.json(); if (!response.ok || !data.ok) throw new Error(data.message || 'Could not save store item.');
      setStatus(status, data.message, 'ok'); await loadStaffStore(section);
    } catch (error) { setStatus(status, error.message || String(error), 'bad'); }
  });
  const categoryForm = document.getElementById('storeCategoryForm');
  categoryForm?.addEventListener('submit', async (event) => {
    event.preventDefault(); const form = event.currentTarget; const status = form.querySelector('[data-category-status]'); const payload = Object.fromEntries(new FormData(form).entries()); payload.Active = form.elements.Active.checked ? 'YES' : 'NO';
    try { const response = await fetch('/api/staff-stores', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'saveCategory', section, ...payload }) }); const data = await response.json(); if (!response.ok || !data.ok) throw new Error(data.message || 'Could not save category.'); setStatus(status, data.message, 'ok'); await loadStaffStore(section); } catch (error) { setStatus(status, error.message || String(error), 'bad'); }
  });
  panelEl.querySelectorAll('[data-edit-category]').forEach((button) => button.addEventListener('click', () => { const row = categories.find((item) => item.CategoryId === button.dataset.editCategory); if (!row || !categoryForm) return; categoryForm.elements.CategoryId.value = row.CategoryId; categoryForm.elements.Name.value = row.Name; categoryForm.elements.Active.checked = clean(row.Active || 'YES') !== 'NO'; categoryForm.scrollIntoView({ behavior: 'smooth', block: 'center' }); }));
  panelEl.querySelectorAll('[data-category-active]').forEach((checkbox) => checkbox.addEventListener('change', async () => {
    const row = categories.find((item) => item.CategoryId === checkbox.dataset.categoryActive);
    if (!row) return;
    const active = checkbox.checked;
    checkbox.disabled = true;
    try {
      const response = await fetch('/api/staff-stores', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'saveCategory',
          section,
          CategoryId: row.CategoryId,
          Name: row.Name,
          AppliesTo: (row.StoreScopes || [label]).join(','),
          Active: active ? 'YES' : 'NO'
        })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || 'Could not update category.');
      await loadStaffStore(section);
    } catch (error) {
      checkbox.checked = !active;
      checkbox.disabled = false;
      setStatus(dashboardStatus, error.message || String(error), 'bad');
    }
  }));
  panelEl.querySelectorAll('[data-store-order]').forEach((button) => button.addEventListener('click', async () => {
    const collectionReference = button.dataset.storeStatus === 'Collected'
      ? window.prompt("Scan or enter the student's card ID, admission number, or parent verification code.")
      : '';
    if (button.dataset.storeStatus === 'Collected' && !clean(collectionReference)) return;
    button.disabled = true;
    try {
      const response = await fetch('/api/staff-stores', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'updateOrder', section, OrderNo: button.dataset.storeOrder, Status: button.dataset.storeStatus, CollectionReference: collectionReference }) });
      const data = await response.json(); if (!response.ok || !data.ok) throw new Error(data.message || 'Could not update order.'); await loadStaffStore(section);
    } catch (error) { setStatus(dashboardStatus, error.message || String(error), 'bad'); button.disabled = false; }
  }));
}

async function loadStaffStore(section) {
  try { const response = await fetch('/api/staff-stores', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'list', section }) }); const data = await response.json(); if (!response.ok || !data.ok) throw new Error(data.message || 'Could not load school store.'); renderStaffStore(section, data); } catch (error) { panelEl.innerHTML = `<p class="status bad">${escapeHtml(error.message || String(error))}</p>`; }
}

async function loadChurchMembership() {
  try {
    const response = await fetch('/api/staff-members', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list', BranchId: currentUser?.branchId || 'main' })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.message || 'Could not load church membership.');
    if (activeSection !== 'members') return;
    panelEl.innerHTML = `
      <div class="workflow-intro"><div><p class="eyebrow">Church directory</p><h2>Members & Households</h2><p class="muted">Branch ${escapeHtml(data.branchId || 'main')} · ${data.members.length} members · ${data.households.length} households</p></div><button type="button" id="refreshChurchMembers">Refresh</button></div>
      ${table('Members', data.members || [], [
        { label: 'Member ID', value: (row) => pick(row, ['MemberId', '__id']) },
        { label: 'Name', value: (row) => pick(row, ['DisplayName']) },
        { label: 'Phone', value: (row) => pick(row, ['Phone']) },
        { label: 'Email', value: (row) => pick(row, ['Email']) },
        { label: 'Household', value: (row) => pick(row, ['HouseholdId']) },
        { label: 'Status', value: (row) => pick(row, ['MembershipStatus']) }
      ])}
      ${table('Households', data.households || [], [
        { label: 'Household ID', value: (row) => pick(row, ['HouseholdId', '__id']) },
        { label: 'Household', value: (row) => pick(row, ['HouseholdName']) },
        { label: 'Primary contact', value: (row) => pick(row, ['PrimaryContactMemberId']) },
        { label: 'Phone', value: (row) => pick(row, ['Phone']) },
        { label: 'Status', value: (row) => pick(row, ['Status']) }
      ])}`;
    document.getElementById('refreshChurchMembers')?.addEventListener('click', loadChurchMembership);
  } catch (error) {
    if (activeSection === 'members') panelEl.innerHTML = `<p class="status bad">${escapeHtml(error.message || String(error))}</p>`;
  }
}

async function loadChurchServices() {
  try {
    const response = await fetch('/api/staff-services', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list', BranchId: currentUser?.branchId || 'main' })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.message || 'Could not load church services.');
    if (activeSection !== 'services') return;
    panelEl.innerHTML = `
      <div class="workflow-intro"><div><p class="eyebrow">Gatherings</p><h2>Services & Attendance</h2><p class="muted">Branch ${escapeHtml(data.branchId || 'main')} · ${data.services.length} service definitions · ${data.attendance.length} check-ins</p></div><button type="button" id="refreshChurchServices">Refresh</button></div>
      ${table('Service Occurrences', data.occurrences || [], [
        { label: 'Date', value: (row) => pick(row, ['Date']) },
        { label: 'Service', value: (row) => pick(row, ['ServiceName', 'ServiceId']) },
        { label: 'Time', value: (row) => pick(row, ['StartTime']) },
        { label: 'Status', value: (row) => pick(row, ['Status']) },
        { label: 'Members', value: (row) => pick(row, ['MemberAttendance']) },
        { label: 'Visitors', value: (row) => pick(row, ['VisitorAttendance']) },
        { label: 'Total', value: (row) => pick(row, ['TotalAttendance']) }
      ])}
      ${table('Recent Attendance', (data.attendance || []).slice(0, 100), [
        { label: 'Date', value: (row) => pick(row, ['OccurrenceDate']) },
        { label: 'Service', value: (row) => pick(row, ['ServiceName']) },
        { label: 'Name', value: (row) => pick(row, ['DisplayName']) },
        { label: 'Type', value: (row) => pick(row, ['AttendanceType']) },
        { label: 'Check-in', value: (row) => pick(row, ['CheckInAt']) }
      ])}`;
    document.getElementById('refreshChurchServices')?.addEventListener('click', loadChurchServices);
  } catch (error) {
    if (activeSection === 'services') panelEl.innerHTML = `<p class="status bad">${escapeHtml(error.message || String(error))}</p>`;
  }
}

async function loadChurchFunds() {
  try {
    const response = await fetch('/api/staff-funds', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list', BranchId: currentUser?.branchId || 'main' })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.message || 'Could not load church funds.');
    if (activeSection !== 'funds') return;
    panelEl.innerHTML = `
      <div class="workflow-intro"><div><p class="eyebrow">Church finance setup</p><h2>Funds & Accounting Mappings</h2><p class="muted">Branch ${escapeHtml(data.branchId || 'main')} Â· ${data.funds.length} funds Â· ${data.mappings.length} mappings</p></div><button type="button" id="refreshChurchFunds">Refresh</button></div>
      <p class="muted">Fund setup is managed in the desktop suite. Mappings use the shared Chart of Accounts and do not create a separate church ledger.</p>
      ${table('Funds', data.funds || [], [
        { label: 'Fund ID', value: (row) => pick(row, ['FundId', '__id']) },
        { label: 'Name', value: (row) => pick(row, ['Name']) },
        { label: 'Type', value: (row) => pick(row, ['FundType']) },
        { label: 'Purpose', value: (row) => pick(row, ['Purpose']) },
        { label: 'Currency', value: (row) => pick(row, ['Currency']) },
        { label: 'Online', value: (row) => pick(row, ['AllowOnline']) },
        { label: 'Status', value: (row) => pick(row, ['Active']) }
      ])}
      ${table('Accounting Mappings', data.mappings || [], [
        { label: 'Fund', value: (row) => pick(row, ['FundName', 'FundId']) },
        { label: 'Debit account', value: (row) => [pick(row, ['DebitAccountCode']), pick(row, ['DebitAccountName'])].filter(Boolean).join(' - ') },
        { label: 'Income account', value: (row) => [pick(row, ['IncomeAccountCode']), pick(row, ['IncomeAccountName'])].filter(Boolean).join(' - ') },
        { label: 'Effective from', value: (row) => pick(row, ['EffectiveFrom']) },
        { label: 'Effective to', value: (row) => pick(row, ['EffectiveTo']) },
        { label: 'Status', value: (row) => pick(row, ['Active']) }
      ])}
      ${table('Recent Fund Audit', data.audit || [], [
        { label: 'Time', value: (row) => pick(row, ['Timestamp']) },
        { label: 'Action', value: (row) => pick(row, ['Action']) },
        { label: 'Record', value: (row) => [pick(row, ['EntityType']), pick(row, ['EntityId'])].filter(Boolean).join(' - ') },
        { label: 'Actor', value: (row) => pick(row, ['Actor']) },
        { label: 'Details', value: (row) => pick(row, ['Details']) }
      ])}`;
    document.getElementById('refreshChurchFunds')?.addEventListener('click', loadChurchFunds);
  } catch (error) {
    if (activeSection === 'funds') panelEl.innerHTML = `<p class="status bad">${escapeHtml(error.message || String(error))}</p>`;
  }
}

async function doOfferingAction(action, offeringId, reason = '') {
  if (!offeringId) return;
  const response = await fetch('/api/staff-offerings', {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action,
      OfferingId: offeringId,
      BranchId: currentUser?.branchId || 'main',
      Reason: reason
    })
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.message || 'Offering action failed.');
  return data;
}

function splitCsvList(value) {
  return String(value || '')
    .split(/[;,]/)
    .map((item) => clean(item))
    .filter(Boolean);
}

function isRouteActive(value) {
  const text = clean(value).toLowerCase();
  return !['no', 'false', '0', 'inactive', 'disabled'].includes(text);
}

function roleListInput(row, field) {
  const values = row[field];
  if (Array.isArray(values)) return values.join(', ');
  if (typeof values === 'string') return values;
  return '';
}

function routeFundLabel(route, funds) {
  const fundId = clean(route.FundId || '').toLowerCase();
  if (!fundId) return 'General';
  const fund = (funds || []).find((item) => clean(item.FundId || item.__id).toLowerCase() === fundId);
  return fund?.Name ? `${fund.Name} (${route.FundId})` : route.FundId;
}

async function doOfferingRouteAction(action, payload = {}) {
  const response = await fetch('/api/staff-offerings', {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action,
      BranchId: currentUser?.branchId || 'main',
      ...payload
    })
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.message || 'Offering route action failed.');
  return data;
}
async function churchDonationRequest(action, payload = {}) {
  const response = await fetch('/api/staff-church-payments', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action,
      BranchId: currentUser?.branchId || 'main',
      ...payload
    })
  });
  const data = await response.json().catch(() => ({ ok: false, message: 'Church donation service did not return JSON.' }));
  if (!response.ok || !data.ok) {
    if (response.status === 401) {
      showLogin(data.message || 'Your staff session has expired.', 'bad');
    }
    throw new Error(data.message || 'Church donation action failed.');
  }
  return data;
}

async function initChurchDonationPayment(payload = {}) {
  const response = await fetch('/api/init-church-payment', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      BranchId: currentUser?.branchId || 'main'
    })
  });
  const data = await response.json().catch(() => ({ ok: false, message: 'Church donation online-init service did not return JSON.' }));
  if (!response.ok || !data.ok) {
    if (response.status === 401) {
      showLogin(data.message || 'Your staff session has expired.', 'bad');
    }
    throw new Error(data.message || 'Could not initialize online church donation payment.');
  }
  return data;
}


async function loadChurchDonations() {
  try {
    const methods = ['CASH', 'BANK TRANSFER', 'CHEQUE', 'POS', 'ONLINE', 'CARD', 'MOBILE MONEY'];
    const currencies = ['NGN', 'USD', 'GBP', 'EUR', 'KES', 'GHS'];
    const paymentTypes = ['Donation', 'Tithe', 'Offering', 'Seed', 'Building Fund', 'Other'];
    const response = await fetch('/api/staff-church-payments', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list', BranchId: currentUser?.branchId || 'main' })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.message || 'Could not load church donations.');
    if (activeSection !== 'donations') return;

    const summary = data.summary || {};
    const capabilities = data.capabilities || {};
    const byMethod = summary.byMethod || {};
    const methodCards = Object.entries(byMethod)
      .sort((left, right) => clean(right[0]).localeCompare(clean(left[0])))
      .map(([method, value]) => `<div><small>${escapeHtml(method || 'Unknown')}</small><strong>${money(value)}</strong><span>Collected</span></div>`)
      .join('');

    panelEl.innerHTML = `
      <div class="workflow-intro">
        <div>
          <p class="eyebrow">Giving counter</p>
          <h2>Church Donations</h2>
          <p class="muted">Branch ${escapeHtml(data.branchId || 'main')} � ${summary.count || 0} entries � ${summary.paid || 0} paid � ${summary.pending || 0} pending</p>
        </div>
        <button type="button" id="refreshChurchDonations">Refresh</button>
      </div>
      <div class="workflow-kpis">
        <div><small>Total</small><strong>${money(summary.totalAmount || 0)}</strong><span>All records</span></div>
        <div><small>Paid</small><strong>${money((summary.paid || 0) > 0 ? summary.paidAmount || summary.totalAmount : 0)}</strong><span>Recorded as paid</span></div>
        <div><small>Pending</small><strong>${money((summary.pending || 0) > 0 ? summary.pendingAmount || 0 : 0)}</strong><span>Awaiting settlement</span></div>
        <div><small>Pending records</small><strong>${escapeHtml(summary.pending || 0)}</strong><span>Awaiting processing</span></div>
      </div>
      ${methodCards ? `<div class="workflow-kpis">${methodCards}</div>` : ''}
      <section class="config-group">
        <header><strong>New donation entry</strong><small>Record offline and online payments, then optionally send confirmation and link.</small></header>
        <form id="churchDonationForm" class="workflow-form config-form">
          <div class="config-grid">
            <label>Donor name <input name="DonorName" required></label>
            <label>Donor email <input name="DonorEmail" type="email" required></label>
            <label>Amount <input name="Amount" type="number" min="0.01" step="0.01" required></label>
            <label>Currency <select name="Currency">${currencies.map((currency) => `<option value="${escapeHtml(currency)}">${escapeHtml(currency)}</option>`).join('')}</select></label>
            <label>Method <select name="PaymentMethod">${methods.map((method) => `<option value="${escapeHtml(method)}">${escapeHtml(method)}</option>`).join('')}</select></label>
            <label>Payment type <select name="PaymentType">${paymentTypes.map((paymentType) => `<option value="${escapeHtml(paymentType)}">${escapeHtml(paymentType)}</option>`).join('')}</select></label>
            <label>Receipt subject <input name="ReceiptSubject" value="Thank you for your donation"></label>
            <label>Receipt message <input name="ReceiptMessage" value="Your gift was received."></label>
          </div>
          <label>Notes
            <textarea name="Notes" rows="2" placeholder="Optional notes for donation records."></textarea>
          </label>
          <label class="check-row config-switch"><input name="sendReceipt" type="checkbox" checked> Send receipt now</label>
          <label class="check-row config-switch"><input name="sendOnlineEmail" type="checkbox" checked> Send online payment link for this donation</label>
          <div class="config-dialog-actions">
            <p class="status" id="churchDonationStatus"></p>
            <button type="submit">Save donation</button>
          </div>
        </form>
      </section>
      ${table('Donations', data.donations || [], [
        { label: 'Receipt', value: (row) => pick(row, ['ReceiptNo', '__id']) },
        { label: 'Donor', value: (row) => pick(row, ['DonorName']) },
        { label: 'Email', value: (row) => pick(row, ['DonorEmail']) },
        { label: 'Amount', value: (row) => money(pick(row, ['Amount'])) },
        { label: 'Method', value: (row) => pick(row, ['PaymentMethod']) },
        { label: 'Type', value: (row) => pick(row, ['PaymentType']) },
        { label: 'Reference', value: (row) => pick(row, ['Reference', 'DonationId']) },
        { label: 'Status', value: (row) => pick(row, ['Status']) },
        {
          label: 'Actions',
          render: (row) => {
            const donationId = pick(row, ['DonationId', '__id']);
            const status = clean(pick(row, ['Status'])).toLowerCase();
            const method = clean(pick(row, ['PaymentMethod'])).toUpperCase();
            if (!donationId) return 'No id';
            const canSendReceipt = capabilities.canSendReceipt;
            const canCollect = capabilities.canCollect;
            const sendReceipt = canSendReceipt
              ? `<button type="button" class="table-action" data-donation-action="sendreceipt" data-donation-id="${escapeHtml(donationId)}">Send Receipt</button>`
              : '';
            const markPaid = canCollect && status !== 'paid'
              ? `<button type="button" class="table-action" data-donation-action="setstatus" data-donation-id="${escapeHtml(donationId)}" data-status="Paid">Mark Paid</button>`
              : '';
            const sendPayment = canCollect && method === 'ONLINE'
              ? `<button type="button" class="table-action" data-donation-action="sendpayment" data-donation-id="${escapeHtml(donationId)}">Send payment link</button>`
              : '';
            return `${sendReceipt} ${markPaid} ${sendPayment}`.trim();
          }
        }
      ])}
      ${table('Donation Audit', data.audit || [], [
        { label: 'Time', value: (row) => pick(row, ['Timestamp']) },
        { label: 'Action', value: (row) => pick(row, ['Action']) },
        { label: 'Receipt', value: (row) => pick(row, ['DonationId']) },
        { label: 'Actor', value: (row) => pick(row, ['Actor']) },
        { label: 'Details', value: (row) => pick(row, ['Details']) }
      ])}`;

    const form = document.getElementById('churchDonationForm');
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const status = document.getElementById('churchDonationStatus');
      const button = form.querySelector('button[type="submit"]');
      const payload = Object.fromEntries(new FormData(form).entries());
      payload.sendReceipt = form.elements.sendReceipt.checked ? 'yes' : 'no';
      payload.Status = clean(payload.Status || '');
      setButtonLoading(button, true, 'Saving...', 'Save donation');
      try {
        const saved = await churchDonationRequest('save', payload);
        setStatus(status, saved.message, 'ok');
        if ((clean(payload.PaymentMethod).toUpperCase() === 'ONLINE') && form.elements.sendOnlineEmail.checked) {
          await initChurchDonationPayment({
            ...(payload || {}),
            action: 'init',
            DonationId: payload.DonationId || saved.donation?.DonationId,
            Reference: saved.donation?.Reference || payload.Reference || ''
          });
        }
        form.reset();
        await loadChurchDonations();
      } catch (error) {
        setStatus(status, error.message || String(error), 'bad');
      } finally {
        setButtonLoading(button, false, 'Saving...', 'Save donation');
      }
    });

    panelEl.querySelectorAll('[data-donation-action]').forEach((button) => button.addEventListener('click', async () => {
      const action = clean(button.dataset.donationAction);
      const donationId = clean(button.dataset.donationId);
      const row = (data.donations || []).find((item) => clean(item.DonationId || item.__id) === donationId);
      if (!donationId) return;
      const normalText = button.textContent;
      setButtonLoading(button, true, `${action}...`, normalText);
      try {
        if (action === 'setstatus') {
          const status = clean(button.dataset.status);
          const updated = await churchDonationRequest('setstatus', {
            DonationId: donationId,
            Status: status,
            sendReceipt: button.dataset.sendReceipt || 'no'
          });
          await loadChurchDonations();
          setStatus(document.getElementById('churchDonationStatus'), updated.message, 'ok');
          return;
        }
        if (action === 'sendreceipt') {
          const updated = await churchDonationRequest('sendreceipt', { DonationId: donationId });
          await loadChurchDonations();
          setStatus(document.getElementById('churchDonationStatus'), updated.message, 'ok');
          return;
        }
        if (action === 'sendpayment') {
          const payload = {
            action: 'init',
            DonationId: donationId,
            DonorName: row?.DonorName,
            DonorEmail: row?.DonorEmail,
            Amount: row?.Amount,
            Currency: row?.Currency || 'NGN',
            PaymentMethod: 'ONLINE',
            PaymentType: row?.PaymentType || 'Donation',
            ReceiptNo: row?.ReceiptNo,
            ReceiptSubject: row?.ReceiptSubject || 'Payment link for your donation',
            ReceiptMessage: row?.ReceiptMessage || 'Click the link to complete your donation payment.'
          };
          const initialized = await initChurchDonationPayment(payload);
          setStatus(document.getElementById('churchDonationStatus'), initialized.message, 'ok');
        }
      } catch (error) {
        setStatus(document.getElementById('churchDonationStatus'), error.message || String(error), 'bad');
      } finally {
        setButtonLoading(button, false, `${action}...`, normalText);
      }
    }));

    document.getElementById('refreshChurchDonations')?.addEventListener('click', loadChurchDonations);
  } catch (error) {
    if (activeSection === 'donations') panelEl.innerHTML = `<p class="status bad">${escapeHtml(error.message || String(error))}</p>`;
  }
}

async function loadChurchOfferings() {
  try {
    const response = await fetch('/api/staff-offerings', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list', BranchId: currentUser?.branchId || 'main' })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.message || 'Could not load church offerings.');
    if (activeSection !== 'offerings') return;
    const summary = data.summary || {};
    const capabilities = data.capabilities || {};
    const approvalRoutes = data.approvalRoutes || [];
    const canManageApprovalRoutes = Boolean(capabilities.canManageApprovalRoutes);
    const routeFundOptions = [
      { value: '', label: 'General (unassigned)' },
      ...((data.funds || []).map((fund) => {
        const fundId = clean(fund.FundId || fund.__id);
        return { value: fundId, label: fund.Name ? `${fund.Name} (${fundId})` : fundId };
      }).filter((fund) => fund.label))
    ];
    const routeFormSection = canManageApprovalRoutes ? `
      <section class="config-group">
        <header><strong>Approval route maintenance</strong><small>Routes are branch scoped and selected automatically by each offering's fund.</small></header>
        <form id="offeringRouteForm" class="workflow-form config-form">
          <div class="config-grid">
            <label>Route ID <input name="RouteId" placeholder="Blank for auto generated"></label>
            <label>Fund <select name="FundId">${routeFundOptions.map((row) => `<option value="${escapeHtml(row.value)}">${escapeHtml(row.label)}</option>`).join('')}</select></label>
            <label>Description <input name="Description" required placeholder="General approvals"></label>
            <label>Sort order <input name="SortOrder" type="number" min="0" step="1" value="100"></label>
            <label>Status <select name="Active"><option value="YES">Active</option><option value="NO">Inactive</option></select></label>
          </div>
          <label>Approval roles <input name="ApprovalRoles" required placeholder="Super Admin, Church Administrator, Treasurer" value="Super Admin, Church Administrator, Treasurer"></label>
          <label>Posting roles <input name="PostingRoles" required placeholder="Super Admin, Treasurer" value="Super Admin, Treasurer"></label>
          <div class="config-dialog-actions">
            <p class="status" data-offering-route-status></p>
            <button type="submit">Save route</button>
            <button type="button" id="offeringRouteFormReset">Reset</button>
          </div>
        </form>
      </section>
      <p class="muted">You can deactivate a route to stop new assignments, then delete only when inactive.</p>
    ` : '';
    const routeTableSection = `
      <section class="config-group">
        <header><strong>Approval routes</strong><small>Routes drive offering approval and posting permissions.</small></header>
        ${table('Offering Approval Routes', approvalRoutes, [
          { label: 'Route', value: (row) => pick(row, ['RouteId']) },
          { label: 'Fund', value: (row) => routeFundLabel(row, data.funds || []) },
          { label: 'Description', value: (row) => pick(row, ['Description']) },
          { label: 'Approval roles', value: (row) => roleListInput(row, 'ApprovalRoles') },
          { label: 'Posting roles', value: (row) => roleListInput(row, 'PostingRoles') },
          { label: 'Sort', value: (row) => pick(row, ['SortOrder']) },
          { label: 'Active', value: (row) => isRouteActive(row.Active) ? 'YES' : 'NO' },
          {
            label: 'Actions',
            render: (row) => {
              const routeId = pick(row, ['RouteId']);
              if (!canManageApprovalRoutes || !routeId) return 'Read only';
              const routeIdSafe = escapeHtml(routeId);
              const isActive = isRouteActive(row.Active);
              const editButton = `<button type="button" class="table-action compact-icon-action compact-edit-action" data-offering-route-action="edit" data-offering-route-id="${routeIdSafe}" aria-label="Edit route ${routeIdSafe}" title="Edit route"><span aria-hidden="true">&#9998;</span></button>`;
              const actionButton = isActive
                ? `<button type="button" class="table-action workflow-reject" data-offering-route-action="deactivate" data-offering-route-id="${routeIdSafe}">Deactivate</button>`
                : `<button type="button" class="table-action compact-icon-action compact-delete-action" data-offering-route-action="delete" data-offering-route-id="${routeIdSafe}" aria-label="Delete route ${routeIdSafe}" title="Delete route"><span aria-hidden="true">&#128465;&#65038;</span></button>`;
              return `${editButton} ${actionButton}`;
            }
          }
        ])}
      </section>
    `;
    panelEl.innerHTML = `
      <div class="workflow-intro"><div><p class="eyebrow">Giving control</p><h2>Offering Batches</h2><p class="muted">Branch ${escapeHtml(data.branchId || 'main')} Ã‚Â· ${summary.count || 0} batches Ã‚Â· ${summary.reconciled || 0} reconciled</p></div><button type="button" id="refreshChurchOfferings">Refresh</button></div>
      <div class="workflow-kpis">
        <div><small>Total offerings</small><strong>${escapeHtml(money(summary.total || 0))}</strong><span>All captured methods</span></div>
        <div><small>Cash</small><strong>${escapeHtml(money(summary.cash || 0))}</strong><span>Counted by denomination</span></div>
        <div><small>Non-cash</small><strong>${escapeHtml(money(summary.nonCash || 0))}</strong><span>Transfer, POS, online and cheque</span></div>
        <div><small>Draft batches</small><strong>${escapeHtml(summary.draft || 0)}</strong><span>Awaiting reconciliation</span></div>
        <div><small>Pending approval</small><strong>${escapeHtml(summary.pendingApproval || 0)}</strong><span>Reconciled but waiting review</span></div>
        <div><small>Approved</small><strong>${escapeHtml(summary.approved || 0)}</strong><span>Ready for posting</span></div>
        <div><small>Posted</small><strong>${escapeHtml(summary.posted || 0)}</strong><span>Accounting transfer created</span></div>
      </div>
      ${routeFormSection}
      ${routeTableSection}
      <p class="muted">Capture and reconciliation are managed in the desktop suite. Reconciliation locks the batch and prepares a journal preview; it still requires approval before posting to accounting.</p>
      ${table('Offering Batches', data.offerings || [], [
        { label: 'Date', value: (row) => pick(row, ['Date']) },
        { label: 'Batch', value: (row) => pick(row, ['BatchReference']) },
        { label: 'Service', value: (row) => pick(row, ['ServiceName', 'ServiceOccurrenceId']) },
        { label: 'Fund', value: (row) => pick(row, ['FundName', 'FundId']) },
        { label: 'Cash', value: (row) => money(pick(row, ['CashAmount'])) },
        { label: 'Non-cash', value: (row) => money(Number(row.TotalAmount || 0) - Number(row.CashAmount || 0)) },
        { label: 'Total', value: (row) => money(pick(row, ['TotalAmount'])) },
        { label: 'Difference', value: (row) => money(pick(row, ['ReconciliationDifference'])) },
        { label: 'Status', value: (row) => pick(row, ['Status']) },
        { label: 'Approval', value: (row) => pick(row, ['ApprovalStatus']) || 'Pending' },
        { label: 'Accounting', value: (row) => pick(row, ['AccountingStatus']) || 'Unposted' },
        { label: 'Route', value: (row) => pick(row, ['ApprovalRoute']) || 'DEFAULT' },
        { label: 'Mapped', value: (row) => row.HasAccountingMapping ? 'YES' : 'NO' },
        {
          label: 'Actions',
          render: (row) => {
            const status = clean(pick(row, ['Status'])).toLowerCase();
            const approvalStatus = clean(pick(row, ['ApprovalStatus'])).toLowerCase();
            const accountingStatus = clean(pick(row, ['AccountingStatus'])).toLowerCase();
            const buttons = [];
            if (capabilities.canReconcile && status !== 'reconciled') {
              buttons.push(`<button type="button" class="table-action" data-offering-action="reconcile" data-offering-id="${escapeHtml(pick(row, ['OfferingId', '__id']))}">Reconcile</button>`);
            }
            if (row.CanApprove && status === 'reconciled' && approvalStatus !== 'approved' && accountingStatus !== 'posted') {
              buttons.push(`<button type="button" class="table-action" data-offering-action="approvechurchoffering" data-offering-id="${escapeHtml(pick(row, ['OfferingId', '__id']))}">Approve</button>`);
              buttons.push(`<button type="button" class="table-action workflow-reject" data-offering-action="rejectchurchoffering" data-offering-id="${escapeHtml(pick(row, ['OfferingId', '__id']) )}">Reject</button>`);
            }
            if (row.CanPost && status === 'reconciled' && approvalStatus === 'approved' && accountingStatus !== 'posted') {
              buttons.push(`<button type="button" class="table-action" data-offering-action="postchurchoffering" data-offering-id="${escapeHtml(pick(row, ['OfferingId', '__id']) )}">Post to Accounting</button>`);
            }
            return buttons.length ? buttons.join(' ') : 'No actions';
          }
        }
      ])}
      ${table('Recent Offering Audit', data.audit || [], [
        { label: 'Time', value: (row) => pick(row, ['Timestamp']) },
        { label: 'Action', value: (row) => pick(row, ['Action']) },
        { label: 'Batch', value: (row) => pick(row, ['BatchReference']) },
        { label: 'Actor', value: (row) => pick(row, ['Actor']) },
        { label: 'Details', value: (row) => pick(row, ['Details']) }
      ])}`;
    panelEl.querySelectorAll('[data-offering-action]').forEach((button) => {
      button.addEventListener('click', async () => {
        const offeringId = button.getAttribute('data-offering-id');
        const action = button.getAttribute('data-offering-action');
        const actionLabel = {
          reconcile: 'reconcile',
          approvechurchoffering: 'approve',
          rejectchurchoffering: 'reject',
          postchurchoffering: 'post'
        }[action] || action;
        if (!offeringId) return;
        if ((actionLabel === 'approve' || actionLabel === 'reconcile' || actionLabel === 'post') && !window.confirm(`Confirm ${actionLabel} for ${offeringId}?`)) return;
        const reason = actionLabel === 'reject' ? window.prompt(`Optional reason for rejecting ${offeringId}`) : '';
        try {
          const data = await doOfferingAction(action, offeringId, reason);
          setStatus(dashboardStatus, data.message, 'ok');
          await loadChurchOfferings();
        } catch (error) {
          setStatus(dashboardStatus, error.message || String(error), 'bad');
        }
      });
    });
    panelEl.querySelectorAll('[data-offering-route-action]').forEach((button) => {
      button.addEventListener('click', async () => {
        if (!canManageApprovalRoutes) return;
        const routeAction = button.getAttribute('data-offering-route-action');
        const routeId = button.getAttribute('data-offering-route-id');
        if (!routeId) return;
        const selected = approvalRoutes.find((route) => pick(route, ['RouteId']) === routeId) || {};
        if (routeAction === 'edit') {
          const form = document.getElementById('offeringRouteForm');
          if (!form) return;
          form.elements.RouteId.value = clean(routeId);
          form.elements.FundId.value = clean(selected.FundId || '');
          form.elements.Description.value = clean(selected.Description || '');
          form.elements.SortOrder.value = Number(selected.SortOrder || 100);
          form.elements.Active.value = isRouteActive(selected.Active) ? 'YES' : 'NO';
          form.elements.ApprovalRoles.value = roleListInput(selected, 'ApprovalRoles');
          form.elements.PostingRoles.value = roleListInput(selected, 'PostingRoles');
          form.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
        if (routeAction === 'deactivate') {
          if (!window.confirm(`Deactivate route ${routeId}? It will not be used for new assignments.`)) return;
          try {
            const data = await doOfferingRouteAction('deactivateofferingroute', { RouteId: routeId });
            setStatus(dashboardStatus, data.message, 'ok');
            await loadChurchOfferings();
          } catch (error) {
            setStatus(dashboardStatus, error.message || String(error), 'bad');
          }
          return;
        }
        if (routeAction === 'delete') {
          if (!window.confirm(`Delete route ${routeId}?`)) return;
          try {
            const data = await doOfferingRouteAction('deleteofferingroute', { RouteId: routeId });
            setStatus(dashboardStatus, data.message, 'ok');
            await loadChurchOfferings();
          } catch (error) {
            setStatus(dashboardStatus, error.message || String(error), 'bad');
          }
        }
      });
    });
    const routeForm = document.getElementById('offeringRouteForm');
    routeForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!canManageApprovalRoutes) return;
      const form = event.currentTarget;
      const button = form.querySelector('button[type="submit"]');
      const status = form.querySelector('[data-offering-route-status]');
      const payload = {
        RouteId: clean(form.elements.RouteId.value),
        FundId: clean(form.elements.FundId.value),
        Description: clean(form.elements.Description.value),
        SortOrder: Number(form.elements.SortOrder.value || 0),
        Active: clean(form.elements.Active.value || 'YES').toUpperCase(),
        ApprovalRoles: splitCsvList(form.elements.ApprovalRoles.value),
        PostingRoles: splitCsvList(form.elements.PostingRoles.value)
      };
      if (!payload.Description) payload.Description = 'General offering approval route';
      if (!payload.ApprovalRoles.length || !payload.PostingRoles.length) {
        setStatus(status, 'Both approval and posting roles are required.', 'bad');
        return;
      }
      setButtonLoading(button, true, 'Saving...', 'Save route');
      try {
        const data = await doOfferingRouteAction('saveofferingroute', payload);
        form.reset();
        setStatus(status, data.message, 'ok');
        await loadChurchOfferings();
      } catch (error) {
        setStatus(status, error.message || String(error), 'bad');
      } finally {
        setButtonLoading(button, false, 'Saving...', 'Save route');
      }
    });
    document.getElementById('offeringRouteFormReset')?.addEventListener('click', () => {
      const form = document.getElementById('offeringRouteForm');
      if (!form) return;
      form.reset();
      setStatus(form.querySelector('[data-offering-route-status]'), '', '');
    });
    document.getElementById('refreshChurchOfferings')?.addEventListener('click', loadChurchOfferings);
  } catch (error) {
    if (activeSection === 'offerings') panelEl.innerHTML = `<p class="status bad">${escapeHtml(error.message || String(error))}</p>`;
  }
}

function renderSection(active) {
  if (!dashboardData) return;
  panelEl.classList.toggle('school-store-panel', active === 'bookstore' || active === 'uniformStore');
  const departments = dashboardData.departments || {};
  if (active === 'staffUsers') {
    panelEl.innerHTML = '<p class="muted">Loading staff accounts...</p>';
    loadStaffUsers();
  } else if (active === 'payroll') {
    panelEl.innerHTML = '<p class="muted">Loading your payroll history...</p>';
    loadMyPayroll();
  } else if (active === 'financeRequests') {
    panelEl.innerHTML = '<p class="muted">Loading bills and requisitions...</p>';
    loadFinanceWorkflow();
  } else if (active === 'admissions') {
    panelEl.innerHTML = table('Admissions', departments.admissions || [], [
      { label: 'Reference', value: (row) => pick(row, ['ApplicationReference', 'ApplicationID', '__id']) },
      { label: 'Name', value: (row) => pick(row, ['ApplicantName', 'Name']) },
      { label: 'Class', value: (row) => pick(row, ['ClassApplyingFor', 'ClassAppliedFor']) },
      { label: 'Status', value: (row) => pick(row, ['Status', 'ResultStatus']) },
      { label: 'Uploaded Documents', render: renderAdmissionDocuments }
    ]);
    bindDocumentDeleteEvents();
  } else if (active === 'formPurchases') {
    panelEl.innerHTML = table('Admission Form Purchases', departments.formPurchases || [], [
      { label: 'Receipt', value: (row) => pick(row, ['ReceiptNo', '__id']) },
      { label: 'Applicant', value: (row) => pick(row, ['ApplicantName']) },
      { label: 'Email', value: (row) => pick(row, ['Email']) },
      { label: 'Class', value: (row) => pick(row, ['ClassApplyingFor']) },
      { label: 'Amount', value: (row) => money(pick(row, ['AmountPaid', 'Amount'])) }
    ]);
  } else if (active === 'students') {
    const students = departments.students || [];
    panelEl.innerHTML = table('Students', students, [
      { label: 'Admission No', value: (row) => pick(row, ['AdmissionNo', 'AccountRef', '__id']) },
      { label: 'Name', value: (row) => pick(row, ['DisplayName', 'ApplicantName', 'StudentName']) },
      { label: 'Class', value: (row) => [pick(row, ['ClassName']), pick(row, ['ClassArm'])].filter(Boolean).join(' ') },
      { label: 'Type', value: (row) => pick(row, ['StudentType']) },
      { label: 'Status', value: (row) => pick(row, ['Status']) },
      { label: 'Profile', render: (row) => {
        const studentRef = escapeHtml(pick(row, ['AdmissionNo', 'AccountRef', '__id']));
        const studentName = escapeHtml(pick(row, ['DisplayName', 'ApplicantName', 'StudentName']) || 'student');
        return `<button type="button" class="student-edit-icon compact-icon-action compact-edit-action" data-edit-student="${studentRef}" aria-label="Edit profile for ${studentName}" title="Edit student profile"><span aria-hidden="true">&#9998;</span></button>`;
      } }
    ]) + renderStudentEditor(students);
    bindStudentEditor(students);
  } else if (active === 'members') {
    panelEl.innerHTML = '<p class="muted">Loading church members and households...</p>';
    loadChurchMembership();
  } else if (active === 'services') {
    panelEl.innerHTML = '<p class="muted">Loading church services and attendance...</p>';
    loadChurchServices();
  } else if (active === 'funds') {
    panelEl.innerHTML = '<p class="muted">Loading church funds and accounting mappings...</p>';
    loadChurchFunds();
  } else if (active === 'donations') {
    panelEl.innerHTML = '<p class="muted">Loading church donation records...</p>';
    loadChurchDonations();
  } else if (active === 'offerings') {
    panelEl.innerHTML = '<p class="muted">Loading church offering batches...</p>';
    loadChurchOfferings();
  } else if (active === 'bookstore' || active === 'uniformStore') {
    panelEl.innerHTML = '<p class="muted">Loading store catalog...</p>';
    loadStaffStore(active);
  } else if (active === 'accounts') {
    const accounts = departments.accounts || {};
    panelEl.innerHTML = table('Payments', accounts.payments || [], [
      { label: 'Date', value: (row) => pick(row, ['PaidAt', 'Date']) },
      { label: 'Account', value: (row) => pick(row, ['AccountRef', 'AdmissionNo']) },
      { label: 'Fee', value: (row) => pick(row, ['FeeName', 'FeeCode']) },
      { label: 'Amount', value: (row) => money(pick(row, ['Amount'])) },
      { label: 'Reference', value: (row) => pick(row, ['Reference']) }
    ]) + table('Invoices', accounts.invoices || [], [
      { label: 'Date', value: (row) => pick(row, ['Date', 'CreatedAt']) },
      { label: 'Account', value: (row) => pick(row, ['AccountRef']) },
      { label: 'Fee', value: (row) => pick(row, ['FeeName', 'FeeCode']) },
      { label: 'Debit', value: (row) => money(pick(row, ['Debit', 'Amount'])) },
      { label: 'Status', value: (row) => pick(row, ['Status']) }
    ]);
  } else if (active === 'clinic') {
    const clinic = departments.clinic || {};
    panelEl.innerHTML = table('Clinic Records', clinic.records || [], [
      { label: 'Date', value: (row) => pick(row, ['Date']) },
      { label: 'Student', value: (row) => pick(row, ['StudentName']) },
      { label: 'Class', value: (row) => pick(row, ['ClassName']) },
      { label: 'Complaint', value: (row) => pick(row, ['Complaint']) },
      { label: 'Treatment', value: (row) => pick(row, ['Treatment']) }
    ]) + table('Low Stock', clinic.lowStock || [], inventoryColumns());
  } else if (active === 'kitchen') {
    const kitchen = departments.kitchen || {};
    panelEl.innerHTML = table('Kitchen Inventory', kitchen.inventory || [], inventoryColumns()) +
      table('Low Stock', kitchen.lowStock || [], inventoryColumns());
  } else if (active === 'tuckShop') {
    panelEl.innerHTML = table('Tuck Shop Wallet Purchases', (departments.tuckShop || {}).purchases || [], [
      { label: 'Date', value: (row) => pick(row, ['Date']) },
      { label: 'Student', value: (row) => pick(row, ['DisplayName']) },
      { label: 'Class', value: (row) => pick(row, ['ClassName']) },
      { label: 'Amount', value: (row) => money(pick(row, ['Debit'])) },
      { label: 'Description', value: (row) => pick(row, ['Description']) }
    ]);
  } else {
    panelEl.innerHTML = '<p class="muted">No dashboard section is available for this role yet.</p>';
  }
}

function bindDocumentDeleteEvents() {
  panelEl.querySelectorAll('[data-delete-document]').forEach((button) => button.addEventListener('click', async () => {
    const applicationReference = button.dataset.applicationReference;
    const documentType = button.dataset.deleteDocument;
    if (!window.confirm('Delete this uploaded document? The file will be moved to Google Drive trash.')) return;
    const normalMarkup = button.innerHTML;
    setButtonLoading(button, true, '', '');
    try {
      const response = await fetch('/api/staff-document', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', applicationReference, documentType })
      });
      const data = await response.json().catch(() => ({ ok: false, message: 'Document service did not return JSON.' }));
      if (!response.ok || !data.ok) throw new Error(data.message || 'Document could not be deleted.');
      await loadDashboard();
      setStatus(dashboardStatus, data.message, 'ok');
    } catch (error) {
      setStatus(dashboardStatus, error.message || String(error), 'bad');
      setButtonLoading(button, false, '', '');
      button.innerHTML = normalMarkup;
    }
  }));
}

async function loadMyPayroll() {
  try {
    const response = await fetch('/api/staff-payroll', { credentials: 'same-origin', cache: 'no-store' });
    const data = await response.json().catch(() => ({ ok: false, message: 'Payroll service did not return JSON.' }));
    if (response.status === 401) { showLogin(data.message || 'Your staff session has expired.', 'bad'); return; }
    if (!response.ok || !data.ok) throw new Error(data.message || 'Payroll history could not be loaded.');
    const items = data.items || [];
    const totals = items.reduce((summary, item) => {
      summary.gross += Number(item.GrossPay || 0); summary.net += Number(item.NetPay || 0);
      summary.paid += Number(item.PaidAmount || 0); summary.outstanding += Number(item.OutstandingAmount || 0); return summary;
    }, { gross: 0, net: 0, paid: 0, outstanding: 0 });
    panelEl.innerHTML = `
      <div class="workflow-intro"><div><p class="eyebrow">Private staff record</p><h2>My Payroll & Payslips</h2><p class="muted">Only payroll posted for your signed-in staff username appears here.</p></div></div>
      <div class="workflow-kpis"><div><small>Payroll periods</small><strong>${items.length}</strong><span>Available payslips</span></div><div><small>Total net pay</small><strong>${money(totals.net)}</strong><span>Posted payroll</span></div><div><small>Paid</small><strong>${money(totals.paid)}</strong><span>Recorded salary payments</span></div><div><small>Outstanding</small><strong>${money(totals.outstanding)}</strong><span>Unpaid balance</span></div></div>
      ${table('Payroll History', items, [
        { label: 'Month', value: (row) => row.Month },
        { label: 'Gross Pay', value: (row) => money(row.GrossPay) },
        { label: 'Taxable', value: (row) => money(row.TaxableEarnings) },
        { label: 'PAYE', value: (row) => money(row.FinalPaye) },
        { label: 'Deductions', value: (row) => money(row.TotalDeductions) },
        { label: 'Net Pay', value: (row) => money(row.NetPay) },
        { label: 'YTD PAYE', value: (row) => money(row.YtdPaye) },
        { label: 'Paid', value: (row) => money(row.PaidAmount) },
        { label: 'Status', value: (row) => row.PaymentStatus },
        { label: 'Tax details', render: (row) => row.TaxProfileId ? `<button type="button" class="secondary" data-tax-breakdown="${escapeHtml(row.ItemId)}">View breakdown</button>` : '<span class="muted">Legacy</span>' },
        { label: 'Payslip', render: (row) => `<a class="payslip-download" href="/api/staff-payroll?action=payslip&itemId=${encodeURIComponent(row.ItemId)}">Download PDF</a>` }
      ])}
      <dialog id="taxBreakdownDialog" class="workflow-dialog tax-breakdown-dialog"><div id="taxBreakdownContent"></div><form method="dialog" class="tax-breakdown-close"><button type="submit">Close</button></form></dialog>`;
    const dialog = document.querySelector('#taxBreakdownDialog'); const content = document.querySelector('#taxBreakdownContent');
    panelEl.querySelectorAll('[data-tax-breakdown]').forEach((button) => button.addEventListener('click', () => {
      const item = items.find((row) => clean(row.ItemId) === clean(button.dataset.taxBreakdown)); if (!item || !dialog || !content) return;
      const reliefs = item.QualifyingReliefs || []; const bands = item.PayeBandBreakdown || [];
      content.innerHTML = `<h2>PAYE Breakdown — ${escapeHtml(item.Month)}</h2><p><strong>Profile:</strong> ${escapeHtml(item.TaxProfileId)} v${escapeHtml(item.TaxProfileVersion)}</p>
        <div class="workflow-kpis"><div><small>Taxable earnings</small><strong>${money(item.TaxableEarnings)}</strong></div><div><small>CRA</small><strong>${money(item.CraAmount)}</strong></div><div><small>Chargeable income</small><strong>${money(item.ChargeableIncome)}</strong></div><div><small>Final PAYE</small><strong>${money(item.FinalPaye)}</strong></div></div>
        ${table('Qualifying Reliefs', reliefs, [{ label: 'Relief', value: (row) => row.Name || row.Code }, { label: 'Annual Amount', value: (row) => money(row.AnnualAmount ?? row.Amount) }])}
        ${table('Progressive Bands', bands, [{ label: 'Band', value: (row) => row.Sequence }, { label: 'Amount Taxed', value: (row) => money(row.TaxedAmount) }, { label: 'Rate', value: (row) => `${row.Rate}%` }, { label: 'Tax', value: (row) => money(row.Tax) }])}`;
      dialog.showModal();
    }));
  } catch (error) {
    panelEl.innerHTML = `<p class="status bad">${escapeHtml(error.message || String(error))}</p>`;
  }
}

async function financeRequest(action, payload = {}) {
  const response = await fetch('/api/finance-workflow', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload })
  });
  const data = await response.json().catch(() => ({ ok: false, message: 'Finance workflow did not return JSON.' }));
  if (response.status === 401) {
    showLogin(data.message || 'Your staff session has expired.', 'bad');
    throw new Error(data.message || 'Your staff session has expired.');
  }
  if (!response.ok || !data.ok) throw new Error(data.message || 'Finance workflow request failed.');
  return data;
}

function materialItemsTable(items) {
  if (!Array.isArray(items) || !items.length) return '';
  const rows = items.map((item, index) => `
    <tr>
      <td>${escapeHtml(item.SNo || index + 1)}</td>
      <td>${escapeHtml(item.Item || item.item || '-')}</td>
      <td>${escapeHtml(item.Specification || item.specification || '-')}</td>
      <td>${escapeHtml(item.Quantity ?? item.quantity ?? '-')}</td>
      <td>${escapeHtml(money(item.UnitPrice ?? item.unitPrice))}</td>
      <td>${escapeHtml(money(item.Total ?? (Number(item.Quantity || item.quantity || 0) * Number(item.UnitPrice || item.unitPrice || 0))))}</td>
    </tr>
  `).join('');
  return `
    <div class="admin-table-wrap material-submission-table">
      <table class="admin-table">
        <thead><tr><th>S/No.</th><th>Item</th><th>Specification</th><th>Quantity</th><th>Unit Price</th><th>Total</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function financeRecordCard(record, type, capabilities) {
  const id = pick(record, type === 'bill' ? ['BillNo', '__id'] : ['ExpenseNo', '__id']);
  const status = pick(record, ['Status']) || 'Submitted';
  const isMaterial = type === 'requisition' && clean(record.RequisitionType).toLowerCase() === 'material';
  const title = isMaterial
    ? 'Material Requisition'
    : type === 'bill'
    ? pick(record, ['VendorName', 'Vendor']) || 'Supplier Bill'
    : pick(record, ['Description']) || 'Requisition';
  const description = pick(record, ['Description']);
  const accountsReviewed = clean(record.AccountsReviewStatus).toLowerCase() === 'reviewed';
  let actions = '';
  if (capabilities.canApprove && clean(status).toLowerCase() === 'submitted') {
    actions += `<button type="button" class="workflow-approve" data-workflow-action="review" data-decision="Approved" data-record-type="${type}" data-record-id="${escapeHtml(id)}">Approve</button>`;
    actions += `<button type="button" class="workflow-reject" data-workflow-action="review" data-decision="Rejected" data-record-type="${type}" data-record-id="${escapeHtml(id)}">Reject</button>`;
  }
  if (capabilities.canAdminOverride && clean(status).toLowerCase() === 'approved' && !record.AdminReviewedAt) {
    actions += `<button type="button" class="workflow-approve" data-workflow-action="review" data-decision="Approved" data-record-type="${type}" data-record-id="${escapeHtml(id)}">Admin OK</button>`;
    actions += `<button type="button" class="workflow-reject" data-workflow-action="review" data-decision="Rejected" data-record-type="${type}" data-record-id="${escapeHtml(id)}">Admin Reject</button>`;
  }
  if (capabilities.canAccountsReview && clean(status).toLowerCase() === 'approved' && !accountsReviewed) {
    actions += `<button type="button" data-workflow-action="accountsReview" data-record-type="${type}" data-record-id="${escapeHtml(id)}">Mark Accounts Reviewed</button>`;
  }
  return `
    <article class="workflow-record">
      <div class="workflow-record-heading">
        <div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(id)}</small></div>
        <span class="workflow-status status-${escapeHtml(clean(status).toLowerCase().replace(/\s+/g, '-'))}">${escapeHtml(status)}</span>
      </div>
      <p>${escapeHtml(description)}</p>
      ${isMaterial ? materialItemsTable(record.MaterialItems || record.Items) : ''}
      <div class="workflow-record-meta">
        <span><strong>${escapeHtml(money(record.Amount))}</strong>Amount</span>
        <span><strong>${escapeHtml(record.Department || '-')}</strong>Department</span>
        <span><strong>${escapeHtml(record.Date || '-')}</strong>Date</span>
        <span><strong>${escapeHtml(type === 'bill' ? (record.DueDate || '-') : (record.Vendor || '-'))}</strong>${type === 'bill' ? 'Due Date' : 'Vendor'}</span>
      </div>
      ${record.Notes ? `<small>Notes: ${escapeHtml(record.Notes)}</small>` : ''}
      ${record.ReviewNotes ? `<small>Review: ${escapeHtml(record.ReviewNotes)}</small>` : ''}
      ${accountsReviewed ? `<small class="status ok">Accounts reviewed by ${escapeHtml(record.AccountsReviewedBy || 'Accounts')}</small>` : ''}
      ${actions ? `<div class="workflow-actions">${actions}</div>` : ''}
    </article>
  `;
}

function financeRecordsSection(title, records, type, capabilities) {
  return `
    <section class="workflow-list-section">
      <h2>${escapeHtml(title)} <small>(${records.length})</small></h2>
      <div class="workflow-record-list">
        ${records.length ? records.map((record) => financeRecordCard(record, type, capabilities)).join('') : '<p class="muted">No records found.</p>'}
      </div>
    </section>
  `;
}

function renderFinanceWorkflow() {
  if (!financeData || activeSection !== 'financeRequests') return;
  const capabilities = financeData.capabilities || {};
  const department = financeData.department || 'Unassigned';
  const requisitions = financeData.requisitions || [];
  const bills = financeData.bills || [];
  const allRecords = [...requisitions, ...bills];
  const statusCount = (status) => allRecords.filter((record) => clean(record.Status).toLowerCase() === status).length;
  const pendingValue = allRecords
    .filter((record) => clean(record.Status).toLowerCase() === 'submitted')
    .reduce((sum, record) => sum + Number(record.Amount || 0), 0);
  const submissionDialogs = capabilities.canSubmit ? `
      <dialog id="requisitionDialog" class="workflow-dialog">
        <div class="workflow-dialog-header"><div><small>${escapeHtml(department)}</small><h2>New Expense Requisition</h2></div><button type="button" data-close-dialog aria-label="Close">×</button></div>
        <form id="requisitionForm" class="workflow-form">
          <h3>Expense Requisition</h3>
          <label>Description <span class="required">*</span><textarea name="description" rows="3" required></textarea></label>
          <label>Amount <span class="required">*</span><input name="amount" type="number" min="1" step="0.01" inputmode="decimal" required></label>
          <label>Preferred vendor<input name="vendor"></label>
          <label>Required date<input name="date" type="date"></label>
          <label>Reference<input name="reference"></label>
          <label>Supporting document URL<input name="attachmentUrl" type="url"></label>
          <label>Notes<textarea name="notes" rows="2"></textarea></label>
          <button type="submit">Submit Requisition</button>
          <p class="status" data-form-status></p>
        </form>
      </dialog>
      <dialog id="materialRequisitionDialog" class="workflow-dialog material-requisition-dialog">
        <div class="workflow-dialog-header"><div><small>${escapeHtml(department)}</small><h2>New Material Requisition</h2></div><button type="button" data-close-dialog aria-label="Close">&times;</button></div>
        <form id="materialRequisitionForm" class="workflow-form">
          <h3>Material Items</h3>
          <p class="muted">List every requested item. Line totals and the requisition total are calculated automatically.</p>
          <div class="admin-table-wrap material-entry-wrap">
            <table class="admin-table material-entry-table">
              <thead><tr><th>S/No.</th><th>Item</th><th>Specification</th><th>Quantity</th><th>Unit Price</th><th>Total</th></tr></thead>
              <tbody data-material-items>
                <tr data-material-row>
                  <td data-material-serial>1</td>
                  <td><div class="material-item-control"><input data-material-field="item" aria-label="Item 1" required><button type="button" class="compact-icon-action compact-delete-action" data-remove-material-item aria-label="Delete item 1" title="Delete item"><span aria-hidden="true">&#128465;&#65038;</span></button></div></td>
                  <td><input data-material-field="specification" aria-label="Specification 1" required></td>
                  <td><input data-material-field="quantity" aria-label="Quantity 1" type="number" min="0.01" step="0.01" inputmode="decimal" required></td>
                  <td><input data-material-field="unitPrice" aria-label="Unit price 1" type="number" min="0.01" step="0.01" inputmode="decimal" required></td>
                  <td><output data-material-line-total>₦0.00</output></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="material-entry-actions"><button type="button" data-add-material-item>+ Add Item</button><strong>Grand Total: <output data-material-grand-total>₦0.00</output></strong></div>
          <label>Preferred vendor<input name="vendor"></label>
          <label>Required date<input name="date" type="date"></label>
          <label>Reference<input name="reference"></label>
          <label>Supporting document URL<input name="attachmentUrl" type="url"></label>
          <label>Notes<textarea name="notes" rows="2"></textarea></label>
          <button type="submit">Submit Material Requisition</button>
          <p class="status" data-form-status></p>
        </form>
      </dialog>
      <dialog id="supplierBillDialog" class="workflow-dialog">
        <div class="workflow-dialog-header"><div><small>${escapeHtml(department)}</small><h2>New Supplier Bill</h2></div><button type="button" data-close-dialog aria-label="Close">×</button></div>
        <form id="supplierBillForm" class="workflow-form">
          <h3>Supplier Bill</h3>
          <label>Supplier <span class="required">*</span><input name="vendorName" required></label>
          <label>Invoice reference<input name="invoiceReference"></label>
          <label>Description <span class="required">*</span><textarea name="description" rows="3" required></textarea></label>
          <label>Amount <span class="required">*</span><input name="amount" type="number" min="1" step="0.01" inputmode="decimal" required></label>
          <label>Bill date<input name="date" type="date"></label>
          <label>Due date<input name="dueDate" type="date"></label>
          <label>Supporting document URL<input name="attachmentUrl" type="url"></label>
          <label>Notes<textarea name="notes" rows="2"></textarea></label>
          <button type="submit">Submit Supplier Bill</button>
          <p class="status" data-form-status></p>
        </form>
      </dialog>
  ` : '';

  panelEl.innerHTML = `
    <div class="workflow-intro">
      <div><p class="eyebrow">Department finance</p><h2>Bills & Requisitions</h2><p class="muted">${escapeHtml(department)} workspace</p></div>
      <div class="workflow-primary-actions">
        ${capabilities.canSubmit ? '<button type="button" data-open-dialog="requisitionDialog">+ New Requisition</button><button type="button" class="workflow-secondary-action" data-open-dialog="materialRequisitionDialog">+ Material Requisition</button><button type="button" class="workflow-secondary-action" data-open-dialog="supplierBillDialog">+ Supplier Bill</button>' : ''}
        <button type="button" class="workflow-icon-action" id="refreshFinanceWorkflow" aria-label="Refresh requests">Refresh</button>
      </div>
    </div>
    <p id="financeWorkflowStatus" class="status"></p>
    ${!capabilities.canSubmit ? '<p class="status bad">A department must be assigned to your staff account before you can submit requests.</p>' : ''}
    <div class="workflow-kpis">
      <div><small>Awaiting Approval</small><strong>${statusCount('submitted')}</strong><span>${escapeHtml(money(pendingValue))} pending</span></div>
      <div><small>Approved</small><strong>${statusCount('approved')}</strong><span>Ready for Accounts</span></div>
      <div><small>Rejected</small><strong>${statusCount('rejected')}</strong><span>Requires attention</span></div>
      <div><small>Total Records</small><strong>${allRecords.length}</strong><span>Current view</span></div>
    </div>
    <div class="workflow-ledger-heading"><div><h2>Recent Transactions</h2><p class="muted">Requisitions and bills synchronized with desktop accounting</p></div></div>
    ${financeRecordsSection('Expense Requisitions', requisitions, 'requisition', capabilities)}
    ${financeRecordsSection('Supplier Bills', bills, 'bill', capabilities)}
    ${submissionDialogs}
  `;
  bindFinanceWorkflowEvents();
}

function formPayload(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function materialEntryRow(index) {
  return `
    <tr data-material-row>
      <td data-material-serial>${index}</td>
      <td><div class="material-item-control"><input data-material-field="item" aria-label="Item ${index}" required><button type="button" class="compact-icon-action compact-delete-action" data-remove-material-item aria-label="Delete item ${index}" title="Delete item"><span aria-hidden="true">&#128465;&#65038;</span></button></div></td>
      <td><input data-material-field="specification" aria-label="Specification ${index}" required></td>
      <td><input data-material-field="quantity" aria-label="Quantity ${index}" type="number" min="0.01" step="0.01" inputmode="decimal" required></td>
      <td><input data-material-field="unitPrice" aria-label="Unit price ${index}" type="number" min="0.01" step="0.01" inputmode="decimal" required></td>
      <td><output data-material-line-total>₦0.00</output></td>
    </tr>
  `;
}

function materialRequisitionItems(form) {
  return [...form.querySelectorAll('[data-material-row]')].map((row) => ({
    item: clean(row.querySelector('[data-material-field="item"]')?.value),
    specification: clean(row.querySelector('[data-material-field="specification"]')?.value),
    quantity: Number(row.querySelector('[data-material-field="quantity"]')?.value || 0),
    unitPrice: Number(row.querySelector('[data-material-field="unitPrice"]')?.value || 0)
  }));
}

function updateMaterialRequisitionTable(form) {
  const rows = [...form.querySelectorAll('[data-material-row]')];
  let grandTotal = 0;
  rows.forEach((row, index) => {
    const serial = index + 1;
    row.querySelector('[data-material-serial]').textContent = serial;
    row.querySelectorAll('[data-material-field]').forEach((input) => {
      const label = input.dataset.materialField === 'unitPrice'
        ? 'Unit price'
        : input.dataset.materialField.charAt(0).toUpperCase() + input.dataset.materialField.slice(1);
      input.setAttribute('aria-label', `${label} ${serial}`);
    });
    const removeButton = row.querySelector('[data-remove-material-item]');
    removeButton.setAttribute('aria-label', `Delete item ${serial}`);
    const quantity = Number(row.querySelector('[data-material-field="quantity"]').value || 0);
    const unitPrice = Number(row.querySelector('[data-material-field="unitPrice"]').value || 0);
    const lineTotal = Math.round((quantity * unitPrice + Number.EPSILON) * 100) / 100;
    grandTotal += lineTotal;
    row.querySelector('[data-material-line-total]').textContent = money(lineTotal);
  });
  form.querySelector('[data-material-grand-total]').textContent = money(grandTotal);
}

function bindMaterialRequisitionForm() {
  const form = document.getElementById('materialRequisitionForm');
  if (!form) return;
  const itemsBody = form.querySelector('[data-material-items]');
  form.querySelector('[data-add-material-item]').addEventListener('click', () => {
    itemsBody.insertAdjacentHTML('beforeend', materialEntryRow(itemsBody.querySelectorAll('[data-material-row]').length + 1));
    updateMaterialRequisitionTable(form);
    itemsBody.lastElementChild?.querySelector('[data-material-field="item"]')?.focus();
  });
  itemsBody.addEventListener('click', (event) => {
    const removeButton = event.target.closest('[data-remove-material-item]');
    if (!removeButton) return;
    const rows = itemsBody.querySelectorAll('[data-material-row]');
    if (rows.length === 1) {
      rows[0].querySelectorAll('input').forEach((input) => { input.value = ''; });
    } else {
      removeButton.closest('[data-material-row]')?.remove();
    }
    updateMaterialRequisitionTable(form);
  });
  itemsBody.addEventListener('input', () => updateMaterialRequisitionTable(form));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const button = form.querySelector('button[type="submit"]');
    const status = form.querySelector('[data-form-status]');
    const payload = { ...formPayload(form), items: materialRequisitionItems(form) };
    setButtonLoading(button, true, 'Submitting...', 'Submit Material Requisition');
    setStatus(status, 'Saving to Firestore...');
    try {
      await financeRequest('submitMaterialRequisition', payload);
      setStatus(status, 'Material requisition submitted.', 'ok');
      await loadFinanceWorkflow();
    } catch (error) {
      setStatus(status, error.message || String(error), 'bad');
    } finally {
      setButtonLoading(button, false, 'Submitting...', 'Submit Material Requisition');
    }
  });
  updateMaterialRequisitionTable(form);
}

function bindSubmissionForm(formId, action, successText) {
  const form = document.getElementById(formId);
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const status = form.querySelector('[data-form-status]');
    setButtonLoading(button, true, 'Submitting...', button.dataset.normalText || button.textContent);
    if (!button.dataset.normalText) button.dataset.normalText = action === 'submitBill' ? 'Submit Supplier Bill' : 'Submit Requisition';
    setStatus(status, 'Saving to Firestore...');
    try {
      await financeRequest(action, formPayload(form));
      form.reset();
      setStatus(status, successText, 'ok');
      await loadFinanceWorkflow();
    } catch (error) {
      setStatus(status, error.message || String(error), 'bad');
    } finally {
      setButtonLoading(button, false, 'Submitting...', button.dataset.normalText);
    }
  });
}

function bindFinanceWorkflowEvents() {
  document.getElementById('refreshFinanceWorkflow')?.addEventListener('click', loadFinanceWorkflow);
  panelEl.querySelectorAll('[data-open-dialog]').forEach((button) => {
    button.addEventListener('click', () => document.getElementById(button.dataset.openDialog)?.showModal());
  });
  panelEl.querySelectorAll('[data-close-dialog]').forEach((button) => {
    button.addEventListener('click', () => button.closest('dialog')?.close());
  });
  bindSubmissionForm('requisitionForm', 'submitRequisition', 'Requisition submitted.');
  bindMaterialRequisitionForm();
  bindSubmissionForm('supplierBillForm', 'submitBill', 'Supplier bill submitted.');
  panelEl.querySelectorAll('[data-workflow-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      const action = button.dataset.workflowAction;
      const decision = button.dataset.decision || '';
      const notes = window.prompt(`${decision || 'Accounts review'} notes (optional):`, '');
      if (notes === null) return;
      const normalText = button.textContent;
      setButtonLoading(button, true, 'Saving...', normalText);
      try {
        const data = await financeRequest(action, {
          recordType: button.dataset.recordType,
          recordId: button.dataset.recordId,
          decision,
          notes
        });
        setStatus(document.getElementById('financeWorkflowStatus'), data.message, 'ok');
        await loadFinanceWorkflow();
      } catch (error) {
        setStatus(document.getElementById('financeWorkflowStatus'), error.message || String(error), 'bad');
      } finally {
        setButtonLoading(button, false, 'Saving...', normalText);
      }
    });
  });
}

async function loadFinanceWorkflow() {
  if (activeSection !== 'financeRequests') return;
  try {
    financeData = await financeRequest('list');
    renderFinanceWorkflow();
  } catch (error) {
    if (activeSection === 'financeRequests') panelEl.innerHTML = `<p class="status bad">${escapeHtml(error.message || String(error))}</p>`;
  }
}

async function staffUserRequest(action, payload = {}) {
  const response = await fetch('/api/staff-users', {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload })
  });
  const data = await response.json().catch(() => ({ ok: false, message: 'Staff-user management did not return JSON.' }));
  if (response.status === 401) showLogin(data.message || 'Your staff session has expired.', 'bad');
  if (!response.ok || !data.ok) throw new Error(data.message || 'Staff-user action failed.');
  return data;
}

function yes(value) {
  return value === true || ['yes', 'true', '1', 'active'].includes(clean(value).toLowerCase());
}

function renderStaffUsers() {
  if (activeSection !== 'staffUsers') return;
  const activeUsers = staffUsersData.filter((user) => yes(user.Active)).length;
  const admins = staffUsersData.filter((user) => user.Role === 'Super Admin' && yes(user.Active)).length;
  panelEl.innerHTML = `
    <div class="workflow-intro">
      <div><p class="eyebrow">Identity & access</p><h2>Staff & Permissions</h2><p class="muted">Shared Firestore accounts for desktop and web access</p></div>
      <div class="workflow-primary-actions"><button type="button" id="newStaffUser">+ New Staff Account</button><button type="button" id="uploadStaffCsv">Upload Staff CSV</button><button type="button" class="workflow-icon-action" id="staffCsvTemplate">CSV Template</button><button type="button" class="workflow-icon-action" id="refreshStaffUsers">Refresh</button><input type="file" id="staffCsvFile" accept=".csv,text/csv" hidden></div>
    </div>
    <p id="staffUsersStatus" class="status"></p>
    <div class="workflow-kpis staff-user-kpis">
      <div><small>Total Accounts</small><strong>${staffUsersData.length}</strong><span>Firestore staff users</span></div>
      <div><small>Active</small><strong>${activeUsers}</strong><span>Can sign in</span></div>
      <div><small>Super Admins</small><strong>${admins}</strong><span>Active administrators</span></div>
      <div><small>Disabled</small><strong>${staffUsersData.length - activeUsers}</strong><span>Access blocked</span></div>
    </div>
    <div class="staff-user-list">
      ${staffUsersData.length ? staffUsersData.map((user) => `
        <article class="staff-user-row">
          <div class="staff-user-avatar">${escapeHtml((user.DisplayName || user.Username || 'U').split(/\s+/).slice(0,2).map((part) => part[0]).join('').toUpperCase())}</div>
          <div class="staff-user-copy"><strong>${escapeHtml(user.DisplayName || user.Username)}</strong><span>@${escapeHtml(user.Username)} • ${escapeHtml(user.Role)}</span><small>${escapeHtml(user.Department || 'No department')} • ${escapeHtml(user.BranchId || 'All branches')} / ${escapeHtml(user.SchoolSectionAccess || 'All sections')}${yes(user.MustChangePassword) ? ' • Password change required' : ''}</small></div>
          <span class="workflow-status ${yes(user.Active) ? 'status-approved' : 'status-rejected'}">${yes(user.Active) ? 'Active' : 'Disabled'}</span>
          <div class="staff-user-actions"><button type="button" class="compact-icon-action compact-edit-action" data-edit-user="${escapeHtml(user.Username)}" aria-label="Edit ${escapeHtml(user.DisplayName || user.Username)}" title="Edit staff account"><span aria-hidden="true">&#9998;</span></button><button type="button" class="compact-icon-action compact-delete-action" data-delete-user="${escapeHtml(user.Username)}" aria-label="Delete ${escapeHtml(user.DisplayName || user.Username)}" title="Delete staff account"><span aria-hidden="true">&#128465;&#65038;</span></button></div>
        </article>
      `).join('') : '<p class="muted">No Firestore staff accounts found. Create the first shared staff account.</p>'}
    </div>
    <section class="staff-security-activity">
      <h2>Recent Security Activity</h2>
      <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Time</th><th>Action</th><th>Account</th><th>Actor</th><th>Platform</th></tr></thead><tbody>
        ${staffAuditData.length ? staffAuditData.map((row) => `<tr><td>${escapeHtml(row.Timestamp)}</td><td>${escapeHtml(row.Action)}</td><td>${escapeHtml(row.Username)}</td><td>${escapeHtml(row.Actor)}</td><td>${escapeHtml(row.SourcePlatform)}</td></tr>`).join('') : '<tr><td colspan="5">No security activity recorded yet.</td></tr>'}
      </tbody></table></div>
    </section>
    <dialog id="staffUserDialog" class="workflow-dialog">
      <div class="workflow-dialog-header"><div><small>Identity & access</small><h2 id="staffUserDialogTitle">New Staff Account</h2></div><button type="button" data-close-user-dialog aria-label="Close">×</button></div>
      <form id="staffUserForm" class="workflow-form config-dialog-form">
        <section class="config-group"><header><strong>Account identity</strong><small>Basic sign-in identity and organizational access.</small></header><div class="config-grid">
          <label>Username <span class="required">*</span><input name="Username" required></label>
          <label>Display name <span class="required">*</span><input name="DisplayName" required></label>
          <label>Role <select name="Role" required>${['Super Admin','Admissions Officer','Accounts Officer','Management','Department User','Tuck Shop User','Clinic User','Kitchen User','Front Desk','Pastor','Church Administrator','Membership Officer','Treasurer','Auditor'].map((role) => `<option>${role}</option>`).join('')}</select></label>
          <label>Department<input name="Department" placeholder="Required for Department User"></label>
          <label>Branch ID<input name="BranchId" placeholder="Blank allows all branches"></label>
          <label>School section<select name="SchoolSectionAccess"><option>All</option><option>Primary</option><option>Secondary</option></select></label>
        </div></section>
        <section class="config-group"><header><strong>Finance approval</strong><small>Approval is blocked unless explicitly enabled by an administrator.</small></header><div class="config-grid">
          <label class="check-row config-switch"><input name="ApprovalEnabled" type="checkbox"> Allow this user to approve finance documents</label>
          <label>Maximum approval amount<input name="ApprovalMaxAmount" type="number" min="0" step="0.01" value="0"><small>Zero blocks approval. Super Admin is unrestricted.</small></label>
        </div><div class="approval-account-list config-option-list"><strong>Accounts this user may approve directly from</strong>${staffApprovalAccounts.length ? staffApprovalAccounts.map((account) => `<label class="check-row"><input type="checkbox" name="ApprovalAccountOption" value="${escapeHtml(account.Code)}"> ${escapeHtml(account.Code)} - ${escapeHtml(account.Name || '')}</label>`).join('') : '<small>Create active Chart of Accounts entries in the desktop Finance tab first.</small>'}</div></section>
        <section class="config-group"><header><strong>Web companion access</strong><small>Leave all clear to use the selected role's default tabs.</small></header><div class="approval-account-list config-option-list config-option-grid">${tabConfig.map(([key, label]) => `<label class="check-row"><input type="checkbox" name="TabAccessOption" value="${escapeHtml(key)}"> ${escapeHtml(label)}</label>`).join('')}</div></section>
        <section class="config-group"><header><strong>Security</strong><small>Password and account-state controls.</small></header><div class="config-grid">
          <label>New or reset password<input name="Password" type="password" minlength="6" autocomplete="new-password"><small>Required for a new account. Leave blank when editing unless resetting it.</small></label>
          <div class="config-toggle-stack"><label class="check-row"><input name="Active" type="checkbox" checked> Account active</label><label class="check-row"><input name="MustChangePassword" type="checkbox" checked> Require password change at next sign-in</label></div>
        </div></section>
        <div class="config-dialog-actions"><p class="status" data-user-form-status></p><button type="submit">Save staff account</button></div>
      </form>
    </dialog>
  `;
  bindStaffUserEvents();
}

function openStaffUserDialog(username = '') {
  const dialog = document.getElementById('staffUserDialog');
  const form = document.getElementById('staffUserForm');
  const user = staffUsersData.find((row) => row.Username.toLowerCase() === username.toLowerCase());
  form.reset();
  form.elements.Username.readOnly = Boolean(user);
  document.getElementById('staffUserDialogTitle').textContent = user ? 'Manage Staff Account' : 'New Staff Account';
  if (user) {
    form.elements.Username.value = user.Username;
    form.elements.DisplayName.value = user.DisplayName || user.Username;
    form.elements.Role.value = user.Role;
    form.elements.Department.value = user.Department || '';
    form.elements.BranchId.value = user.BranchId || '';
    form.elements.SchoolSectionAccess.value = user.SchoolSectionAccess || 'All';
    form.elements.ApprovalEnabled.checked = yes(user.ApprovalEnabled);
    form.elements.ApprovalMaxAmount.value = user.ApprovalMaxAmount || 0;
    const allowedAccounts = new Set(user.ApprovalAccounts || []);
    form.querySelectorAll('[name="ApprovalAccountOption"]').forEach((input) => { input.checked = allowedAccounts.has(input.value); });
    const allowedTabs = new Set(user.TabAccess || []);
    form.querySelectorAll('[name="TabAccessOption"]').forEach((input) => { input.checked = allowedTabs.has(input.value); });
    form.elements.Active.checked = yes(user.Active);
    form.elements.MustChangePassword.checked = yes(user.MustChangePassword);
  } else {
    form.elements.Active.checked = true;
    form.elements.MustChangePassword.checked = true;
    form.elements.ApprovalEnabled.checked = false;
  }
  dialog.showModal();
}

function bindStaffUserEvents() {
  document.getElementById('newStaffUser')?.addEventListener('click', () => openStaffUserDialog());
  document.getElementById('refreshStaffUsers')?.addEventListener('click', loadStaffUsers);
  document.getElementById('uploadStaffCsv')?.addEventListener('click', () => document.getElementById('staffCsvFile').click());
  document.getElementById('staffCsvTemplate')?.addEventListener('click', downloadStaffCsvTemplate);
  document.getElementById('staffCsvFile')?.addEventListener('change', importStaffCsv);
  document.querySelector('[data-close-user-dialog]')?.addEventListener('click', () => document.getElementById('staffUserDialog').close());
  panelEl.querySelectorAll('[data-edit-user]').forEach((button) => button.addEventListener('click', () => openStaffUserDialog(button.dataset.editUser)));
  panelEl.querySelectorAll('[data-delete-user]').forEach((button) => button.addEventListener('click', async () => {
    const username = button.dataset.deleteUser;
    if (!window.confirm(`Delete staff account ${username}? This cannot be undone.`)) return;
    const normalMarkup = button.innerHTML;
    setButtonLoading(button, true, '', '');
    try {
      const data = await staffUserRequest('delete', { Username: username });
      await loadStaffUsers();
      setStatus(document.getElementById('staffUsersStatus'), data.message, 'ok');
    } catch (error) {
      setStatus(document.getElementById('staffUsersStatus'), error.message || String(error), 'bad');
      setButtonLoading(button, false, '', '');
      button.innerHTML = normalMarkup;
    }
  }));
  document.getElementById('staffUserForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const status = form.querySelector('[data-user-form-status]');
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.Active = form.elements.Active.checked;
    payload.MustChangePassword = form.elements.MustChangePassword.checked;
    payload.ApprovalEnabled = form.elements.ApprovalEnabled.checked;
    payload.ApprovalAccounts = Array.from(form.querySelectorAll('[name="ApprovalAccountOption"]:checked')).map((input) => input.value);
    payload.TabAccess = Array.from(form.querySelectorAll('[name="TabAccessOption"]:checked')).map((input) => input.value);
    setButtonLoading(button, true, 'Saving...', 'Save Staff Account');
    try {
      const data = await staffUserRequest('save', payload);
      document.getElementById('staffUserDialog').close();
      await loadStaffUsers();
      setStatus(document.getElementById('staffUsersStatus'), data.message, 'ok');
    } catch (error) {
      setStatus(status, error.message || String(error), 'bad');
      setButtonLoading(button, false, 'Saving...', 'Save Staff Account');
    }
  });
}

function parseCsv(text) {
  const rows = []; let row = []; let field = ''; let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"' && quoted && text[index + 1] === '"') { field += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(field); field = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field); if (row.some((value) => clean(value))) rows.push(row); row = []; field = '';
    } else field += char;
  }
  row.push(field); if (row.some((value) => clean(value))) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows[0].map((value) => clean(value).replace(/^\uFEFF/, ''));
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, clean(values[index])])));
}

function downloadStaffCsvTemplate() {
  const content = 'Username,DisplayName,Role,Department,BranchId,SchoolSectionAccess,Password,Active,MustChangePassword,ApprovalEnabled,ApprovalMaxAmount,ApprovalAccounts,TabAccess\nexample.user,Example User,Front Desk,Administration,main,All,ChangeMe123,YES,YES,NO,0,"6010,6090","admissions,students"\n';
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv' }));
  const link = document.createElement('a'); link.href = url; link.download = 'staff_upload_template.csv'; link.click(); URL.revokeObjectURL(url);
}

async function importStaffCsv(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const users = parseCsv(await file.text());
    if (!users.length) throw new Error('The CSV has no staff data rows. Download the template and try again.');
    const data = { imported: 0, failures: [], message: '' };
    for (let offset = 0; offset < users.length; offset += 25) {
      const result = await staffUserRequest('import', { users: users.slice(offset, offset + 25) });
      data.imported += Number(result.imported || 0);
      data.failures.push(...(result.failures || []).map((failure) => ({ ...failure, row: Number(failure.row || 2) + offset })));
    }
    data.message = `${data.imported} staff account(s) uploaded${data.failures.length ? `; ${data.failures.length} failed.` : '.'}`;
    await loadStaffUsers();
    const failureText = (data.failures || []).slice(0, 5).map((row) => `Row ${row.row}: ${row.message}`).join(' | ');
    setStatus(document.getElementById('staffUsersStatus'), `${data.message}${failureText ? ` ${failureText}` : ''}`, data.failures?.length ? 'bad' : 'ok');
  } catch (error) {
    setStatus(document.getElementById('staffUsersStatus'), error.message || String(error), 'bad');
  } finally {
    event.target.value = '';
  }
}

async function loadStaffUsers() {
  if (activeSection !== 'staffUsers') return;
  try {
    const data = await staffUserRequest('list');
    staffUsersData = data.users || [];
    staffAuditData = data.audit || [];
    staffApprovalAccounts = data.approvalAccounts || [];
    renderStaffUsers();
  } catch (error) {
    if (activeSection === 'staffUsers') panelEl.innerHTML = `<p class="status bad">${escapeHtml(error.message || String(error))}</p>`;
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (loginButton.disabled) return;
  setButtonLoading(loginButton, true, 'Signing in...', 'Sign In');
  setStatus(loginStatus, 'Verifying staff account...');
  try {
    const { response, data } = await sessionRequest('POST', {
      action: 'login',
      username: document.getElementById('staffUsername').value.trim(),
      password: document.getElementById('staffPassword').value
    });
    if (!response.ok || !data.ok) throw new Error(data.message || 'Could not sign in.');
    loginForm.reset();
    await continueAfterAuthentication(data.user);
  } catch (error) {
    setStatus(loginStatus, error.message || String(error), 'bad');
  } finally {
    setButtonLoading(loginButton, false, 'Signing in...', 'Sign In');
  }
});

async function signOutFromPortal(button) {
  button.disabled = true;
  try {
    await sessionRequest('POST', { action: 'logout' });
  } finally {
    button.disabled = false;
    window.location.replace('index.html');
  }
}

signOutButton.addEventListener('click', () => signOutFromPortal(signOutButton));
sidebarSignOutButton.addEventListener('click', () => signOutFromPortal(sidebarSignOutButton));

refreshButton.addEventListener('click', loadDashboard);
sidebarScrim.addEventListener('click', () => setSidebarOpen(false));
installSidebarSwipeGestures();
mobileNav.addEventListener('click', (event) => {
  const button = event.target.closest('[data-mobile-tab]');
  if (!button) return;
  const key = button.dataset.mobileTab;
  if (key === '__modules__') {
    if (!moduleDialog.open) moduleDialog.showModal();
    return;
  }
  if (key === '__more__') {
    setSidebarOpen(true);
    return;
  }
  selectSection(key);
});
moduleGrid.addEventListener('click', (event) => {
  const button = event.target.closest('[data-module]');
  if (button) selectSection(button.dataset.module);
});
moduleCloseButton.addEventListener('click', () => moduleDialog.close());
moduleDialog.addEventListener('click', (event) => { if (event.target === moduleDialog) moduleDialog.close(); });
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  setSidebarOpen(false);
  if (moduleDialog.open) moduleDialog.close();
});
window.addEventListener('resize', () => {
  if (window.innerWidth > 680) {
    setSidebarOpen(false);
    if (moduleDialog.open) moduleDialog.close();
  }
});

passwordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (passwordButton.disabled) return;
  const password = document.getElementById('staffNewPassword').value;
  const confirmPassword = document.getElementById('staffConfirmPassword').value;
  if (password !== confirmPassword) {
    setStatus(passwordStatus, 'Passwords do not match.', 'bad');
    return;
  }
  setButtonLoading(passwordButton, true, 'Changing...', 'Change Password');
  setStatus(passwordStatus, 'Updating your Firestore staff account...');
  try {
    const { response, data } = await sessionRequest('POST', { action: 'changePassword', password, confirmPassword });
    if (!response.ok || !data.ok) throw new Error(data.message || 'Password could not be changed.');
    passwordForm.reset();
    passwordDialog.close();
    await continueAfterAuthentication(data.user);
  } catch (error) {
    setStatus(passwordStatus, error.message || String(error), 'bad');
  } finally {
    setButtonLoading(passwordButton, false, 'Changing...', 'Change Password');
  }
});

document.getElementById('staffPasswordSignOut').addEventListener('click', async () => {
  await sessionRequest('POST', { action: 'logout' });
  passwordDialog.close();
  passwordForm.reset();
  window.location.replace('index.html');
});

(async function restoreSession() {
  setStatus(loginStatus, 'Checking staff session...');
  const { response, data } = await sessionRequest();
  if (response.ok && data.authenticated && data.user) {
    await continueAfterAuthentication(data.user);
  } else {
    showLogin();
  }
}());
