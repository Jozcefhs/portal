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
const refreshButton = document.getElementById('staffRefresh');
const summaryEl = document.getElementById('adminSummary');
const dashboardChartsEl = document.getElementById('dashboardCharts');
const tabsEl = document.getElementById('adminTabs');
const panelEl = document.getElementById('adminPanel');
const passwordDialog = document.getElementById('staffPasswordDialog');
const passwordForm = document.getElementById('staffPasswordForm');
const passwordButton = document.getElementById('staffPasswordButton');
const passwordStatus = document.getElementById('staffPasswordStatus');
const menuToggleButton = document.getElementById('staffMenuToggle');
const sidebarEl = document.getElementById('staffSidebar');
const sidebarScrim = document.getElementById('staffSidebarScrim');

let currentUser = null;
let dashboardData = null;
let activeSection = '';
let financeData = null;
let staffUsersData = [];
let staffAuditData = [];
let staffApprovalAccounts = [];

const tabConfig = [
  ['admissions', 'Admissions'],
  ['formPurchases', 'Form Purchases'],
  ['students', 'Students'],
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
  menuToggleButton.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
  document.body.classList.toggle('staff-sidebar-open', shouldOpen);
  if (shouldOpen) sidebarEl.querySelector('[data-tab]')?.focus();
}

function showLogin(message = '', type = '') {
  setSidebarOpen(false);
  currentUser = null;
  dashboardData = null;
  activeSection = '';
  dashboardEl.hidden = true;
  identityEl.hidden = true;
  loginCard.hidden = false;
  setStatus(loginStatus, message, type);
}

function showDashboard(user) {
  currentUser = user;
  displayNameEl.textContent = user.displayName || user.username;
  roleEl.textContent = [user.role, user.department].filter(Boolean).join(' • ');
  welcomeTitle.textContent = `Welcome, ${user.displayName || user.username}`;
  loginCard.hidden = true;
  identityEl.hidden = false;
  dashboardEl.hidden = false;
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
  tabsEl.innerHTML = tabs.map(([key, label]) => {
    const selected = key === activeSection ? ' selected' : '';
    return `<button type="button" class="child-card${selected}" data-tab="${escapeHtml(key)}" aria-selected="${key === activeSection}">${escapeHtml(label)}</button>`;
  }).join('');
  tabsEl.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      activeSection = button.dataset.tab;
      renderTabs(allowed);
      renderSection(activeSection);
      setSidebarOpen(false);
      panelEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
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
    return `<div class="document-action-row"><span>${escapeHtml(item.label)}</span><a href="/api/staff-document?${query}&mode=view" target="_blank" rel="noopener">View</a><a href="/api/staff-document?${query}&mode=download">Download</a>${canDelete ? `<button type="button" class="document-delete" data-delete-document="${escapeHtml(item.key)}" data-application-reference="${escapeHtml(reference)}">Delete</button>` : ''}</div>`;
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
      <div class="workflow-record-list">${categories.length ? categories.map((row) => `<article class="workflow-record"><div><strong>${escapeHtml(row.Name)}</strong><small>${escapeHtml((row.StoreScopes || []).join(', '))} · ${escapeHtml(row.Active || 'YES')}</small></div><div class="workflow-actions"><button type="button" data-edit-category="${escapeHtml(row.CategoryId)}">Edit</button>${clean(row.Active || 'YES') === 'NO' ? '' : `<button type="button" data-deactivate-category="${escapeHtml(row.CategoryId)}">Deactivate</button>`}</div></article>`).join('') : '<p class="muted">Existing item categories will be added here automatically.</p>'}</div>
    </details>
    ${table(`${label} Items`, store.items || [], [
      { label: 'Code', value: (row) => pick(row, ['ItemCode', '__id']) }, { label: 'Item', value: (row) => pick(row, ['ItemName']) },
      { label: 'Category / Size', value: (row) => [pick(row, ['Category']), pick(row, ['Size'])].filter(Boolean).join(' / ') },
      { label: 'Price', value: (row) => money(pick(row, ['Price'])) }, { label: 'Stock', value: (row) => pick(row, ['Quantity']) }
    ])}
    <h2>Paid Orders & Collection</h2><div class="workflow-record-list">${(store.orders || []).length ? (store.orders || []).map((order) => `
      <article class="workflow-record"><div class="workflow-record-heading"><div><strong>${escapeHtml(order.DisplayName || order.AccountRef)}</strong><small>${escapeHtml(order.OrderNo)}</small></div><span class="workflow-status">${escapeHtml(order.Status || 'Paid - Awaiting Collection')}</span></div>
      <p>${money(order.Amount)} &middot; ${escapeHtml(order.PaidAt || order.CreatedAt || '')}</p>
      <div class="workflow-actions"><button type="button" data-store-order="${escapeHtml(order.OrderNo)}" data-store-status="Ready for Collection">Ready for Collection</button><button type="button" data-store-order="${escapeHtml(order.OrderNo)}" data-store-status="Collected">Verify & Mark Collected</button></div></article>
    `).join('') : '<p class="muted">No paid orders yet.</p>'}</div>`;
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
  panelEl.querySelectorAll('[data-deactivate-category]').forEach((button) => button.addEventListener('click', async () => { if (!window.confirm('Deactivate this category? Existing inventory and transaction references will remain intact.')) return; const response = await fetch('/api/staff-stores', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'deactivateCategory', section, CategoryId: button.dataset.deactivateCategory, Name: categories.find((row) => row.CategoryId === button.dataset.deactivateCategory)?.Name }) }); const data = await response.json(); if (!response.ok || !data.ok) return setStatus(dashboardStatus, data.message || 'Could not deactivate category.', 'bad'); await loadStaffStore(section); }));
  panelEl.querySelectorAll('[data-store-order]').forEach((button) => button.addEventListener('click', async () => {
    const collectionReference = button.dataset.storeStatus === 'Collected'
      ? window.prompt("Scan or enter the student's card ID, admission number, or parent verification code.")
      : '';
    if (button.dataset.storeStatus === 'Collected' && !clean(collectionReference)) return;
    button.disabled = true;
    try {
      const response = await fetch('/api/staff-stores', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'updateOrder', section, OrderNo: button.dataset.storeOrder, Status: button.dataset.storeStatus, CollectionReference: collectionReference }) });
      const data = await response.json(); if (!response.ok || !data.ok) throw new Error(data.message || 'Could not update order.'); await loadDashboard();
    } catch (error) { setStatus(dashboardStatus, error.message || String(error), 'bad'); button.disabled = false; }
  }));
}

async function loadStaffStore(section) {
  try { const response = await fetch('/api/staff-stores', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'list', section }) }); const data = await response.json(); if (!response.ok || !data.ok) throw new Error(data.message || 'Could not load school store.'); renderStaffStore(section, data); } catch (error) { panelEl.innerHTML = `<p class="status bad">${escapeHtml(error.message || String(error))}</p>`; }
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
      { label: 'Profile', render: (row) => `<button type="button" class="table-action" data-edit-student="${escapeHtml(pick(row, ['AdmissionNo', 'AccountRef', '__id']))}">Edit</button>` }
    ]) + renderStudentEditor(students);
    bindStudentEditor(students);
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
    setButtonLoading(button, true, 'Deleting...', 'Delete');
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
      setButtonLoading(button, false, 'Deleting...', 'Delete');
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

function financeRecordCard(record, type, capabilities) {
  const id = pick(record, type === 'bill' ? ['BillNo', '__id'] : ['ExpenseNo', '__id']);
  const status = pick(record, ['Status']) || 'Submitted';
  const title = type === 'bill'
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
        ${capabilities.canSubmit ? '<button type="button" data-open-dialog="requisitionDialog">+ New Requisition</button><button type="button" class="workflow-secondary-action" data-open-dialog="supplierBillDialog">+ Supplier Bill</button>' : ''}
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
          <div class="staff-user-actions"><button type="button" data-edit-user="${escapeHtml(user.Username)}">Manage</button><button type="button" class="workflow-reject" data-delete-user="${escapeHtml(user.Username)}">Delete</button></div>
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
          <label>Role <select name="Role" required>${['Super Admin','Admissions Officer','Accounts Officer','Management','Department User','Tuck Shop User','Clinic User','Kitchen User','Front Desk'].map((role) => `<option>${role}</option>`).join('')}</select></label>
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
    const normalText = button.textContent;
    setButtonLoading(button, true, 'Deleting...', normalText);
    try {
      const data = await staffUserRequest('delete', { Username: username });
      await loadStaffUsers();
      setStatus(document.getElementById('staffUsersStatus'), data.message, 'ok');
    } catch (error) {
      setStatus(document.getElementById('staffUsersStatus'), error.message || String(error), 'bad');
      setButtonLoading(button, false, 'Deleting...', normalText);
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

signOutButton.addEventListener('click', async () => {
  signOutButton.disabled = true;
  try {
    await sessionRequest('POST', { action: 'logout' });
  } finally {
    signOutButton.disabled = false;
    showLogin('Signed out successfully.', 'ok');
    document.getElementById('staffUsername').focus();
  }
});

refreshButton.addEventListener('click', loadDashboard);
menuToggleButton.addEventListener('click', () => setSidebarOpen(!sidebarEl.classList.contains('is-open')));
sidebarScrim.addEventListener('click', () => setSidebarOpen(false));
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') setSidebarOpen(false); });
window.addEventListener('resize', () => { if (window.innerWidth > 680) setSidebarOpen(false); });

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
  showLogin('Signed out successfully.', 'ok');
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
