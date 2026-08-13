const loginCard = document.getElementById('staffLoginCard');
const loginForm = document.getElementById('staffLoginForm');
const loginButton = document.getElementById('staffLoginButton');
const passkeyLoginButton = document.getElementById('staffPasskeyLogin');
const passkeySetupButton = document.getElementById('staffPasskeySetup');
const mfaSettingsButton = document.getElementById('staffMfaSettings');
const mfaDialog = document.getElementById('staffMfaDialog');
const mfaLoginDialog = document.getElementById('staffMfaLoginDialog');
const approvalSettingsButton = document.getElementById('staffApprovalSettings');
const approvalSettingsDialog = document.getElementById('staffApprovalSettingsDialog');
const approvalSettingsForm = document.getElementById('staffApprovalSettingsForm');
const paymentSettingsButton = document.getElementById('staffPaymentSettings');
const subscriptionButton = document.getElementById('staffSubscriptionButton');
const subscriptionDialog = document.getElementById('staffSubscriptionDialog');
const profileSubscriptionSection = document.getElementById('staffProfileSubscription');
const financeDecisionDialog = document.getElementById('financeDecisionDialog');
const financeDecisionForm = document.getElementById('financeDecisionForm');
const loginStatus = document.getElementById('staffLoginStatus');
const dashboardEl = document.getElementById('staffDashboard');
const dashboardStatus = document.getElementById('staffDashboardStatus');
const subscriptionAccessBanner = document.getElementById('subscriptionAccessBanner');
const staffBrand = document.getElementById('staffBrand');
const identityEl = document.getElementById('staffIdentity');
const displayNameEl = document.getElementById('staffDisplayName');
const roleEl = document.getElementById('staffRole');
const welcomeTitle = document.getElementById('staffWelcomeTitle');
const signOutButton = document.getElementById('staffSignOut');
const switchUserButton = document.getElementById('staffSwitchUser');
const sidebarSignOutButton = document.getElementById('staffSidebarSignOut');
const sidebarSwitchUserButton = document.getElementById('staffSidebarSwitchUser');
const staffAccountMenu = document.getElementById('staffAccountMenu');
const staffAccountMenuPanel = document.getElementById('staffAccountMenuPanel');
const passwordSwitchUserButton = document.getElementById('staffPasswordSwitchUser');
const headerRefreshButton = document.getElementById('staffHeaderRefresh');
const themeToggleButton = document.getElementById('staffThemeToggle');
const themeToggleIcon = document.getElementById('staffThemeToggleIcon');
const sidebarThemeToggleButton = document.getElementById('staffSidebarThemeToggle');
const sidebarThemeToggleIcon = document.getElementById('staffSidebarThemeToggleIcon');
const summaryEl = document.getElementById('adminSummary');
const dashboardClockEl = document.getElementById('staffDashboardClock');
const dashboardChartsEl = document.getElementById('dashboardCharts');
const tabsEl = document.getElementById('adminTabs');
const panelEl = document.getElementById('adminPanel');
const welcomeEl = document.querySelector('.staff-welcome');
const staffMainContent = document.querySelector('.staff-main-content');
const profileTrigger = document.getElementById('staffProfileTrigger');
const passwordDialog = document.getElementById('staffPasswordDialog');
const passwordForm = document.getElementById('staffPasswordForm');
const passwordButton = document.getElementById('staffPasswordButton');
const passwordStatus = document.getElementById('staffPasswordStatus');
const sidebarEl = document.getElementById('staffSidebar');
const sidebarScrim = document.getElementById('staffSidebarScrim');
const staffAvatar = document.getElementById('staffAvatar');
const staffAvatarImage = document.getElementById('staffAvatarImage');
const staffAvatarFallback = document.getElementById('staffAvatarFallback');
const staffProfileDialog = document.getElementById('staffProfileDialog');
const staffProfileForm = document.getElementById('staffProfileForm');
const editionLabel = document.getElementById('staffEditionLabel');
const workspaceTitle = document.getElementById('staffWorkspaceTitle');
const overviewLabel = document.getElementById('staffOverviewLabel');
const welcomeCopy = document.getElementById('staffWelcomeCopy');
const branchControl = document.getElementById('staffBranchControl');
const branchSelector = document.getElementById('staffBranchSelector');
const mobileNav = document.getElementById('staffMobileNav');
const moduleDialog = document.getElementById('staffModuleDialog');
const moduleGrid = document.getElementById('staffModuleGrid');
const moduleCloseButton = document.getElementById('staffModuleClose');
const requestedWorkspace = new URLSearchParams(window.location.search).get('workspace')?.trim().toLowerCase() || '';
const requestedSection = new URLSearchParams(window.location.search).get('section')?.trim() || '';
const legacyDashboardSections = new Set(['schoolInsights', 'admissions', 'formPurchases', 'students', 'accounts']);

let currentUser = null;
let dashboardData = null;
let activeSection = '';
let financeData = null;
let staffUsersData = [];
let staffAuditData = [];
let securityAuditData = {
  rows: [], facets: {}, warnings: [], fromDate: '', toDate: '', totalMatches: 0, truncated: false,
  filters: { action: '', user: '', module: '', outcome: '', source: '', branchId: '', search: '' }
};
let dataBackupState = { envelope: null, fileName: '', summary: null, busy: false };
let staffApprovalAccounts = [];
let staffRoleAccessData = null;
let staffRoleAccessSelectedRole = '';
let humanResourcesData = null;
let staffAttendanceReportFilters = null;
let activeTabs = [];
let approvalProfile = null;
let approvalAssetState = { signature: '', stamp: '' };
let pendingFinanceDecision = null;
let financeDecisionBiometricVerified = false;
let financeDecisionApprovalProof = '';
let profilePhotoState = '';
let staffBearerToken = '';
let subscriptionData = null;
let subscriptionCycle = 'monthly';
let staffSessionAbortController = new AbortController();
let selectedBranchId = 'all';
let availableBranches = [];
let branchSwitchInProgress = false;
let passkeyStatusRequest = null;
let pendingMfaLogin = null;
let pendingMfaCompletedLogin = null;
let staffMfaData = null;
let staffMfaAdminData = null;
let latestRecoveryCodes = [];
let organizationDepartmentWorkspaceTab = 'overview';
let organizationDashboardChartsRequest = 0;
let dashboardAttendanceRequest = 0;
let dashboardAttendanceCache = null;
let dashboardClockTimer = 0;
let dashboardClockTimeZone = '';
const dashboardSectionRequests = new Map();
let incomeAnalyticsData = null;
let incomeAnalyticsFilter = { period: 'monthly' };
let recordsDeskRequest = 0;
let recordsDeskSearchTimer = 0;
let recordsDeskAbortController = null;
let recordsDeskHandoffContext = null;
let recordsDeskFacePreloadPromise = null;
let recordsDeskFacePreloadScheduled = false;
let attendanceFaceModulePromise = null;
let attendanceFaceWarmupPromise = null;
let executiveOfficeData = null;
let executiveOfficeTab = 'overview';
let executiveDirectoryType = '';
let executiveDirectoryQuery = '';
let executiveDirectoryResults = [];
let executiveAvailableDirectoryTypes = [];
let executiveSelectedRecipient = null;
let studentConductData = null;
const organizationCommerceCarts = {
  organizationStore: new Map(),
  restaurant: new Map()
};
const organizationCommerceSearch = {
  organizationStore: '',
  restaurant: ''
};
const organizationCommerceLastSale = {
  organizationStore: null,
  restaurant: null
};
const organizationCommerceCustomerDraft = {
  organizationStore: { CustomerName: '', CustomerEmail: '', CustomerPhone: '', PaymentMethod: 'Cash', PaymentReference: '' },
  restaurant: { CustomerName: '', CustomerEmail: '', CustomerPhone: '', PaymentMethod: 'Cash', PaymentReference: '' }
};
const organizationCommerceSaleRequestIds = {
  organizationStore: '',
  restaurant: ''
};
let recordsDeskState = {
  query: '',
  type: 'all',
  availableTypes: [],
  results: [],
  totalMatches: 0,
  truncated: false,
  selectedKey: '',
  selectedBranchId: '',
  detail: null,
  loading: false,
  loadingDetail: false,
  error: ''
};

const tabConfig = [
  ['recordsDesk', 'Records Desk'],
  ['executiveOffice', 'Executive Office'],
  ['admissions', 'Admissions'],
  ['formPurchases', 'Form Purchases'],
  ['students', 'Students'],
  ['studentConduct', 'Student Conduct & Discipline'],
  ['humanResources', 'Human Resources'],
  ['members', 'Departments & Members'],
  ['services', 'Services & Attendance'],
  ['staffAttendance', 'Staff Attendance'],
  ['funds', 'Funds & Mappings'],
  ['offerings', 'Offerings'],
  ['donations', 'Donations'],
  ['accounts', 'Accounts'],
  ['incomeAnalytics', 'Income Analytics'],
  ['financeRequests', 'Bills & Requisitions'],
  ['payroll', 'My Payroll'],
  ['clinic', 'Clinic'],
  ['kitchen', 'Kitchen'],
  ['tuckShop', 'Tuck Shop'],
  ['bookstore', 'Books & Supplies'],
  ['uniformStore', 'Clothing & Supplies'],
  ['organizationStore', 'Organisation Store'],
  ['restaurant', 'Restaurant'],
  ['dataBackup', 'Backup & Restore'],
  ['securityAudit', 'Security Audit Log'],
  ['staffUsers', 'Staff & Permissions']
];

const schoolOnlyWebSections = new Set([
  'admissions', 'formPurchases', 'students', 'studentConduct', 'accounts',
  'clinic', 'kitchen', 'tuckShop', 'bookstore', 'uniformStore'
]);

const staffRoleOptions = [
  'Super Admin', 'Principal', 'Senior Pastor', 'Head Minister',
  'Admissions Officer', 'Student Welfare Officer', 'Accounts Officer',
  'Management', 'Department User', 'Tuck Shop User', 'Clinic User',
  'Kitchen User', 'Store User', 'Restaurant User', 'Front Desk', 'Pastor',
  'Church Administrator', 'Membership Officer', 'Treasurer', 'Auditor',
  'HR Director', 'HR Manager', 'HR Business Partner', 'HR Officer',
  'HR Assistant', 'Recruitment Officer', 'Learning & Development Officer',
  'Employee Relations Officer', 'Performance Management Officer',
  'Compensation & Benefits Officer', 'Payroll Officer',
  'Health & Safety Officer', 'Line Manager', 'Executive Director',
  'Organisation Administrator', 'Operations Manager', 'Procurement Officer',
  'Records Officer'
];

const schoolOnlyStaffRoles = new Set([
  'Principal', 'Admissions Officer', 'Student Welfare Officer',
  'Tuck Shop User', 'Clinic User', 'Kitchen User'
]);

const faithOnlyStaffRoles = new Set([
  'Senior Pastor', 'Head Minister', 'Pastor', 'Church Administrator',
  'Membership Officer'
]);

const organizationOnlyStaffRoles = new Set([
  'Executive Director', 'Organisation Administrator', 'Operations Manager',
  'Procurement Officer', 'Records Officer'
]);

const organizationTabLabels = Object.freeze({
  recordsDesk: 'Records Centre',
  members: 'Departments & Personnel',
  services: 'Meetings & Attendance',
  funds: 'Budgets & Account Mappings',
  offerings: 'Income & Receipts',
  donations: 'Grants & Contributions',
  incomeAnalytics: 'Revenue Analytics',
  organizationStore: 'Inventory & Sales',
  restaurant: 'Catering Operations',
  dataBackup: 'Backup & Restore',
  securityAudit: 'Security Audit Log',
  staffUsers: 'Users & Permissions'
});

function webTabsForEdition(edition = resolveDashboardEdition(currentUser || {})) {
  return edition === 'school'
    ? tabConfig
    : tabConfig.filter(([key]) => !schoolOnlyWebSections.has(key));
}

function staffRolesForEdition(edition = resolveDashboardEdition(currentUser || {})) {
  if (edition === 'school') {
    return staffRoleOptions.filter((role) => !faithOnlyStaffRoles.has(role) && !organizationOnlyStaffRoles.has(role));
  }
  if (edition === 'organization') {
    return staffRoleOptions.filter((role) => !schoolOnlyStaffRoles.has(role) && !faithOnlyStaffRoles.has(role));
  }
  return staffRoleOptions.filter((role) => !schoolOnlyStaffRoles.has(role) && !organizationOnlyStaffRoles.has(role));
}

const tabIcons = {
  overview: '\u2302',
  schoolInsights: '\u{1F4CA}',
  recordsDesk: '\u{1F5C2}',
  executiveOffice: '\u{1F4E8}',
  admissions: '\u{1F4DD}',
  formPurchases: '\u{1F9FE}',
  students: '\u{1F465}',
  studentConduct: '\u2696',
  humanResources: '\u{1F465}',
  members: '\u{1F465}',
  services: '\u{1F4C5}',
  staffAttendance: '\u23F1',
  funds: '\u{1F4B0}',
  offerings: '\u{1F9FA}',
  donations: '\u{1F381}',
  accounts: '\u{1F9EE}',
  incomeAnalytics: '\u{1F4CA}',
  financeRequests: '\u{1F4CB}',
  payroll: '\u{1F4B3}',
  clinic: '\u2695',
  kitchen: '\u{1F37D}',
  tuckShop: '\u{1F6D2}',
  bookstore: '\u{1F4DA}',
  uniformStore: '\u{1F455}',
  organizationStore: '\u{1F3EA}',
  restaurant: '\u{1F37D}',
  dataBackup: '\u{1F5C4}',
  securityAudit: '\u{1F6E1}',
  staffUsers: '\u2699'
};

function clean(value) {
  return String(value ?? '').trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function newIdempotencyKey() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  const random = window.crypto?.getRandomValues
    ? Array.from(window.crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(16)).join('')
    : Math.random().toString(36).slice(2);
  return `${Date.now().toString(36)}-${random}`;
}

function receivedResponseError(message) {
  const error = new Error(message);
  error.responseReceived = true;
  return error;
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

function moneyInCurrency(value, currency = 'NGN') {
  const amount = Number(String(value ?? '0').replace(/[,\s]/g, ''));
  const code = clean(currency || 'NGN').toUpperCase();
  if (!Number.isFinite(amount)) return clean(value);
  try {
    return new Intl.NumberFormat('en-NG', { style: 'currency', currency: code }).format(amount);
  } catch {
    return `${code} ${amount.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}

function financialNumber(value, fallback = 0) {
  const parsed = window.DynamaxFinancialValues?.parse
    ? window.DynamaxFinancialValues.parse(value)
    : Number(String(value ?? '').replace(/[,\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function setFinancialInputValue(input, value) {
  if (window.DynamaxFinancialValues?.set) window.DynamaxFinancialValues.set(input, value);
  else if (input) input.value = value ?? '';
}

function setStatus(element, message, type = '') {
  element.textContent = message || '';
  element.className = type ? `status ${type}` : 'status';
}

function setButtonLoading(button, loading, loadingText, normalText) {
  if (!button) return;
  button.disabled = loading;
  button.classList.toggle('is-loading', loading);
  button.setAttribute('aria-busy', loading ? 'true' : 'false');
  button.textContent = loading ? loadingText : normalText;
}

async function runButtonAction(button, loadingText, action, normalText = '') {
  if (!button || button.disabled || button.getAttribute('aria-busy') === 'true') return undefined;
  const restingText = normalText || clean(button.textContent) || 'Continue';
  setButtonLoading(button, true, loadingText || 'Working...', restingText);
  try {
    return await action();
  } finally {
    if (button.isConnected) setButtonLoading(button, false, loadingText || 'Working...', restingText);
  }
}

function setDashboardRefreshLoading(loading) {
  headerRefreshButton.disabled = loading;
  headerRefreshButton.classList.toggle('is-loading', loading);
  headerRefreshButton.setAttribute('aria-busy', loading ? 'true' : 'false');
  staffBrand.classList.toggle('is-refreshing', loading);
  staffBrand.setAttribute('aria-busy', loading ? 'true' : 'false');
  const label = loading ? 'Refreshing dashboard' : 'Refresh dashboard';
  headerRefreshButton.setAttribute('aria-label', label);
  headerRefreshButton.title = label;
}

function updateStaffThemeToggle() {
  const darkTheme = document.documentElement.dataset.theme === 'dark';
  const label = darkTheme ? 'Switch to light mode' : 'Switch to dark mode';
  [themeToggleIcon, sidebarThemeToggleIcon].forEach((icon) => {
    icon.textContent = darkTheme ? '\u2600' : '\u263e';
  });
  [themeToggleButton, sidebarThemeToggleButton].forEach((button) => {
    button.setAttribute('aria-label', label);
    button.title = label;
  });
}

function toggleStaffTheme() {
  const preferences = window.DIGCPreferences?.read();
  if (!preferences || !window.DIGCPreferences?.save) return;
  const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  window.DIGCPreferences.save({ ...preferences, theme: nextTheme });
  updateStaffThemeToggle();
}

function biometricPreferenceEnabled() {
  return Boolean(window.DIGCPreferences?.read().biometric);
}

function passkeysSupported() {
  return Boolean(window.PublicKeyCredential && navigator.credentials);
}

function warmPasskeyCredentialManager() {
  if (!passkeysSupported()) return;
  const availabilityCheck = window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable;
  if (typeof availabilityCheck !== 'function') return;
  try {
    void Promise.resolve(availabilityCheck.call(window.PublicKeyCredential)).catch(() => false);
  } catch (_error) {
    // Availability probing is only a best-effort Android credential-provider warm-up.
  }
}

function staffFetch(input, init = {}) {
  const options = { ...init };
  if (!options.signal) options.signal = staffSessionAbortController.signal;
  const requestUrl = new URL(typeof input === 'string' ? input : input.url, window.location.href);
  if (requestUrl.origin === window.location.origin && requestUrl.pathname.startsWith('/api/')) {
    const headers = new Headers(options.headers || (input instanceof Request ? input.headers : undefined));
    headers.set('X-Dynamax-Branch', selectedBranchId || 'all');
    if (staffBearerToken) headers.set('Authorization', `Bearer ${staffBearerToken}`);
    options.headers = headers;
  }
  return window.fetch(input, options);
}

async function refreshStaffSiteProfile() {
  const refreshProfile = window.DynamaxPublicApi?.refreshSiteProfile;
  if (typeof refreshProfile !== 'function') return null;
  const branchId = clean(selectedBranchId);
  try {
    const headers = new Headers();
    if (staffBearerToken) headers.set('Authorization', `Bearer ${staffBearerToken}`);
    return await refreshProfile({
      branchId: branchId && branchId !== 'all' ? branchId : '',
      headers
    });
  } catch (_error) {
    // Operational data remains available if the public identity endpoint is temporarily unavailable.
    return null;
  }
}

// Dynamic staff-portal modules use the same bearer session and active branch context.
window.DynamaxStaffFetch = staffFetch;

function base64UrlToBytes(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToBase64Url(value) {
  const bytes = new Uint8Array(value || 0);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function registrationOptionsFromJSON(options) {
  return {
    ...options,
    challenge: base64UrlToBytes(options.challenge),
    user: { ...options.user, id: base64UrlToBytes(options.user.id) },
    excludeCredentials: (options.excludeCredentials || []).map((credential) => ({
      ...credential,
      id: base64UrlToBytes(credential.id)
    }))
  };
}

function authenticationOptionsFromJSON(options) {
  return {
    ...options,
    challenge: base64UrlToBytes(options.challenge),
    allowCredentials: (options.allowCredentials || []).map((credential) => ({
      ...credential,
      id: base64UrlToBytes(credential.id)
    }))
  };
}

function retryableCredentialManagerError(error) {
  const name = clean(error?.name);
  const message = clean(error?.message);
  if (!['NotReadableError', 'UnknownError'].includes(name)) return false;
  return /^an unknown error occur(?:red|ed) while talking to (?:the )?credential manager\.?$/i.test(message);
}

async function getPasskeyCredential(options, mediation = 'required') {
  const requestCredential = () => navigator.credentials.get({
    publicKey: authenticationOptionsFromJSON(options),
    mediation
  });
  try {
    return await requestCredential();
  } catch (error) {
    if (!retryableCredentialManagerError(error)) throw error;
    await new Promise((resolve) => window.setTimeout(resolve, 350));
    return requestCredential();
  }
}

function credentialToJSON(credential) {
  if (typeof credential.toJSON === 'function') return credential.toJSON();
  const response = credential.response;
  const json = {
    id: credential.id,
    rawId: bytesToBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment || undefined,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: bytesToBase64Url(response.clientDataJSON)
    }
  };
  if ('attestationObject' in response) {
    json.response.attestationObject = bytesToBase64Url(response.attestationObject);
    json.response.transports = response.getTransports?.() || [];
    if (response.getAuthenticatorData?.()) json.response.authenticatorData = bytesToBase64Url(response.getAuthenticatorData());
    if (response.getPublicKey?.()) json.response.publicKey = bytesToBase64Url(response.getPublicKey());
    if (response.getPublicKeyAlgorithm) json.response.publicKeyAlgorithm = response.getPublicKeyAlgorithm();
  } else {
    json.response.authenticatorData = bytesToBase64Url(response.authenticatorData);
    json.response.signature = bytesToBase64Url(response.signature);
    json.response.userHandle = response.userHandle ? bytesToBase64Url(response.userHandle) : undefined;
  }
  return json;
}

async function passkeyRequest(action, extra = {}) {
  const response = await staffFetch('/api/staff-passkey', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...extra })
  });
  const data = await response.json().catch(() => ({ ok: false, message: 'Biometric sign-in did not return JSON.' }));
  if (!response.ok || !data.ok) throw new Error(data.message || 'Biometric sign-in failed.');
  return data;
}

async function mfaRequest(action, extra = {}) {
  const response = await staffFetch('/api/staff-mfa', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...extra })
  });
  const data = await response.json().catch(() => ({ ok: false, message: 'Two-factor authentication did not return JSON.' }));
  if (!response.ok || !data.ok) throw new Error(data.message || 'Two-factor authentication failed.');
  return data;
}

function recoveryCodeDownload(codes = latestRecoveryCodes) {
  const rows = Array.isArray(codes) ? codes.map(clean).filter(Boolean) : [];
  if (!rows.length) return;
  const account = clean(currentUser?.username || pendingMfaLogin?.username || 'staff-account');
  const content = [
    'Dynamax two-factor authentication recovery codes',
    `Account: ${account}`,
    `Generated: ${new Date().toLocaleString()}`,
    '',
    ...rows,
    '',
    'Each code works once. Store this file securely and do not share it.'
  ].join('\n');
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `dynamax-recovery-codes-${account.replace(/[^a-z0-9._-]+/gi, '-')}.txt`;
  link.click();
  URL.revokeObjectURL(url);
}

function showRecoveryCodes(codes, listId, sectionId) {
  latestRecoveryCodes = Array.isArray(codes) ? codes.map(clean).filter(Boolean) : [];
  const list = document.getElementById(listId);
  const section = document.getElementById(sectionId);
  if (list) list.textContent = latestRecoveryCodes.join('\n');
  if (section) section.hidden = !latestRecoveryCodes.length;
}

async function finishMfaClientLogin(data) {
  const token = clean(data?.sessionToken);
  if (!token) throw new Error('Two-factor verification did not return a staff session.');
  pendingMfaLogin = null;
  pendingMfaCompletedLogin = null;
  latestRecoveryCodes = [];
  if (mfaLoginDialog.open) mfaLoginDialog.close();
  loginForm.reset();
  setStatus(loginStatus, '');
  await continueAfterAuthentication(await confirmFreshStaffSession(data.user, token));
}

function selectMfaLoginMethod(method) {
  if (!pendingMfaLogin) return;
  pendingMfaLogin.method = method;
  const form = document.getElementById('staffMfaLoginCodeForm');
  const input = document.getElementById('staffMfaLoginCode');
  const label = document.getElementById('staffMfaLoginCodeLabel');
  form.hidden = false;
  input.value = '';
  if (method === 'recovery') {
    label.childNodes[0].nodeValue = 'Recovery code ';
    input.inputMode = 'text';
    input.maxLength = 20;
    input.placeholder = 'DMX-XXXX-XXXX';
  } else {
    label.childNodes[0].nodeValue = 'Authenticator code ';
    input.inputMode = 'numeric';
    input.maxLength = 6;
    input.placeholder = '000000';
  }
  document.querySelectorAll('#staffMfaLoginMethods .staff-mfa-method').forEach((button) => {
    button.classList.toggle('active', button.id === (method === 'recovery' ? 'staffMfaLoginRecovery' : 'staffMfaLoginTotp'));
  });
  input.focus();
}

async function beginMfaLoginTotpSetup() {
  if (!pendingMfaLogin?.ticket) return;
  const status = document.getElementById('staffMfaLoginStatus');
  setStatus(status, 'Preparing secure authenticator enrollment...');
  try {
    const data = await mfaRequest('setup-totp', { mfaTicket: pendingMfaLogin.ticket });
    document.getElementById('staffMfaLoginMethods').hidden = true;
    document.getElementById('staffMfaLoginCodeForm').hidden = true;
    const panel = document.getElementById('staffMfaLoginSetup');
    panel.hidden = false;
    document.getElementById('staffMfaLoginQr').innerHTML = data.setup.qrSvg;
    document.getElementById('staffMfaLoginSecret').textContent = data.setup.secret;
    setStatus(status, 'Scan the QR code and enter the current six-digit code.', 'ok');
    document.getElementById('staffMfaLoginSetupCode').focus();
  } catch (error) {
    setStatus(status, error.message || String(error), 'bad');
  }
}

async function openMfaLogin(data, username = '') {
  pendingMfaLogin = {
    ticket: clean(data.mfaTicket),
    methods: Array.isArray(data.methods) ? data.methods : [],
    enrollmentRequired: data.enrollmentRequired === true,
    username: clean(username),
    method: ''
  };
  pendingMfaCompletedLogin = null;
  showRecoveryCodes([], 'staffMfaLoginRecoveryCodeList', 'staffMfaLoginRecoveryCodes');
  document.getElementById('staffMfaLoginMessage').textContent = data.message || 'Complete one more security check to open your workspace.';
  document.getElementById('staffMfaLoginMethods').hidden = false;
  document.getElementById('staffMfaLoginCodeForm').hidden = true;
  document.getElementById('staffMfaLoginSetup').hidden = true;
  setStatus(document.getElementById('staffMfaLoginStatus'), '');
  const methodMap = {
    passkey: document.getElementById('staffMfaLoginPasskey'),
    totp: document.getElementById('staffMfaLoginTotp'),
    recovery: document.getElementById('staffMfaLoginRecovery')
  };
  Object.entries(methodMap).forEach(([method, button]) => {
    button.hidden = !pendingMfaLogin.methods.includes(method) || (method === 'passkey' && !passkeysSupported());
    button.classList.remove('active');
  });
  mfaLoginDialog.showModal();
  if (pendingMfaLogin.enrollmentRequired) {
    await beginMfaLoginTotpSetup();
  } else if (pendingMfaLogin.methods.length === 1 && ['totp', 'recovery'].includes(pendingMfaLogin.methods[0])) {
    selectMfaLoginMethod(pendingMfaLogin.methods[0]);
  }
}

async function verifyMfaLoginWithPasskey() {
  if (!pendingMfaLogin?.ticket) return;
  const button = document.getElementById('staffMfaLoginPasskey');
  const status = document.getElementById('staffMfaLoginStatus');
  const originalMarkup = button.innerHTML;
  button.disabled = true;
  button.classList.add('is-loading');
  button.textContent = 'Checking device...';
  setStatus(status, 'Follow your device prompt to approve this sign-in...');
  try {
    const started = await passkeyRequest('authentication-options', { mfaTicket: pendingMfaLogin.ticket });
    const credential = await getPasskeyCredential(started.options);
    if (!credential) throw new Error('No device credential was returned.');
    const completed = await passkeyRequest('authentication-verify', {
      mfaTicket: pendingMfaLogin.ticket,
      ceremonyId: started.ceremonyId,
      credential: credentialToJSON(credential)
    });
    await finishMfaClientLogin(completed);
  } catch (error) {
    setStatus(status, friendlyPasskeyError(error), 'bad');
  } finally {
    button.disabled = false;
    button.classList.remove('is-loading');
    button.innerHTML = originalMarkup;
  }
}

function renderStaffMfaSummary(data = staffMfaData) {
  const container = document.getElementById('staffMfaSummary');
  if (!container || !data) return;
  const profile = data.profile || {};
  const policy = data.policy || {};
  const requirement = data.requirement || {};
  const policyLabels = {
    DISABLED: 'Disabled by organisation',
    OPTIONAL: 'Optional',
    REQUIRED_ROLES: 'Required for selected roles',
    REQUIRED_ALL: 'Required for all staff'
  };
  container.innerHTML = `
    <article class="${profile.totpActive ? 'protected' : ''}"><small>Authenticator app</small><strong>${profile.totpActive ? 'Active' : 'Not set up'}</strong><span>Time-based six-digit codes</span></article>
    <article class="${profile.passkeyCount > 0 ? 'protected' : ''}"><small>Device passkeys</small><strong>${Number(profile.passkeyCount || 0)}</strong><span>Fingerprint, face, PIN or device password</span></article>
    <article class="${profile.recoveryCodesRemaining > 0 ? 'protected' : ''}"><small>Recovery codes</small><strong>${Number(profile.recoveryCodesRemaining || 0)}</strong><span>Unused single-use codes</span></article>
    <article class="${requirement.required ? 'protected' : ''}"><small>Organisation policy</small><strong>${escapeHtml(policyLabels[policy.Mode] || 'Optional')}</strong><span>${requirement.dueAt ? `Enforcement begins ${escapeHtml(new Date(requirement.dueAt).toLocaleString())}` : (requirement.required ? 'Protection applies to this account' : 'You may enable protection voluntarily')}</span></article>
  `;
  document.getElementById('staffMfaSetupTotp').textContent = profile.totpActive ? 'Replace authenticator app' : 'Set up authenticator app';
  document.getElementById('staffMfaAddPasskey').hidden = !passkeysSupported();
  document.getElementById('staffMfaRecoveryForm').closest('details').hidden = !profile.totpActive;
}

async function openStaffMfaSettings() {
  if (!currentUser) return;
  document.getElementById('staffMfaSetupPanel').hidden = true;
  showRecoveryCodes([], 'staffMfaRecoveryCodeList', 'staffMfaRecoveryCodes');
  setStatus(document.getElementById('staffMfaStatus'), 'Loading two-factor security...');
  mfaDialog.showModal();
  try {
    staffMfaData = await mfaRequest('status');
    renderStaffMfaSummary();
    setStatus(document.getElementById('staffMfaStatus'), 'Security settings loaded.', 'ok');
  } catch (error) {
    setStatus(document.getElementById('staffMfaStatus'), error.message || String(error), 'bad');
  }
}

async function attendancePasskeyProof(siteId, direction) {
  const started = await passkeyRequest('attendance-options', { siteId, direction });
  const credential = await getPasskeyCredential(started.options);
  if (!credential) throw new Error('The device unlock prompt did not return a credential.');
  const completed = await passkeyRequest('attendance-verify', {
    ceremonyId: started.ceremonyId,
    credential: credentialToJSON(credential)
  });
  const proof = clean(completed.attendanceProof);
  if (!proof) throw new Error('Device unlock verification did not return an attendance proof.');
  return proof;
}

function attendanceFaceModule() {
  if (!attendanceFaceModulePromise) {
    attendanceFaceModulePromise = import('./student-face-lookup.js?v=20260812-face-attendance-guidance').catch((error) => {
      attendanceFaceModulePromise = null;
      throw error;
    });
  }
  return attendanceFaceModulePromise;
}

function warmAttendanceIdentity(policy) {
  const required = clean(policy?.IdentityVerification || 'NONE').toUpperCase();
  if (required === 'PASSKEY') warmPasskeyCredentialManager();
  if (required !== 'FACE' || attendanceFaceWarmupPromise) return;
  attendanceFaceWarmupPromise = attendanceFaceModule()
    .then((module) => module.preloadStaffAttendanceFace())
    .catch(() => {
      attendanceFaceWarmupPromise = null;
      return null;
    });
}

async function attendanceIdentityProof(policy, siteId, direction) {
  const required = clean(policy?.IdentityVerification || 'NONE').toUpperCase();
  if (required === 'NONE') return '';
  if (required === 'FACE') {
    const module = await attendanceFaceModule();
    const result = await module.captureStaffAttendanceFace({ mode: 'verify', siteId, direction });
    if (!result) throw new Error('Face verification was cancelled.');
    const proof = clean(result.attendanceProof);
    if (!proof) throw new Error('Face recognition did not return an attendance proof.');
    return proof;
  }
  try {
    return await attendancePasskeyProof(siteId, direction);
  } catch (error) {
    throw new Error(friendlyDeviceUnlockError(error));
  }
}

async function attendanceVerificationEvidence(policy, siteId, direction) {
  // Avoid stacking a browser location prompt and the camera/device-unlock prompt on mobile.
  const location = await browserPosition().catch(() => ({}));
  const attendanceProof = await attendanceIdentityProof(policy, siteId, direction);
  return { location, attendanceProof };
}

function friendlyPasskeyError(error) {
  if (error?.name === 'NotAllowedError') return 'Biometric verification was cancelled or timed out.';
  if (error?.name === 'InvalidStateError') return 'This device is already registered for biometric sign-in.';
  if (error?.name === 'SecurityError') return 'Biometric sign-in requires a secure HTTPS connection.';
  if (retryableCredentialManagerError(error)) return 'Your device credential manager could not open. Please try again or use your password.';
  return error?.message || String(error);
}

function friendlyDeviceUnlockError(error) {
  if (error?.name === 'NotAllowedError') return 'Device unlock was cancelled or timed out.';
  if (error?.name === 'SecurityError') return 'Device unlock requires a secure HTTPS connection.';
  if (retryableCredentialManagerError(error)) return 'The device unlock prompt could not open. Please try again.';
  return error?.message || String(error);
}

async function refreshPasskeyControls() {
  const supported = passkeysSupported();
  const preferred = biometricPreferenceEnabled();
  passkeyLoginButton.hidden = !supported || Boolean(currentUser);
  passkeyLoginButton.classList.toggle('is-preferred', preferred);
  passkeySetupButton.hidden = !supported || !preferred || !currentUser || Boolean(currentUser.mustChangePassword);
  passkeySetupButton.classList.remove('is-registered');
  if (passkeySetupButton.hidden) return;
  const request = passkeyStatusRequest || passkeyRequest('status');
  passkeyStatusRequest = request;
  passkeySetupButton.innerHTML = '<span aria-hidden="true">◉</span> Set up biometric sign-in';
  try {
    const status = await request;
    if (status.registered > 0) {
      passkeySetupButton.classList.add('is-registered');
      passkeySetupButton.innerHTML = '<span aria-hidden="true">✓</span> Add another biometric device';
    }
  } catch (_error) {
    // Dashboard access remains available if the optional status check fails.
  } finally {
    if (passkeyStatusRequest === request) passkeyStatusRequest = null;
  }
}

async function approvalProfileRequest(method = 'GET', payload = null) {
  const response = await staffFetch('/api/staff-approval-profile', {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: payload ? { 'Content-Type': 'application/json' } : undefined,
    body: payload ? JSON.stringify(payload) : undefined
  });
  const data = await response.json().catch(() => ({ ok: false, message: 'User settings did not return JSON.' }));
  if (!response.ok || !data.ok) throw new Error(data.message || 'Could not load approval settings.');
  return data;
}

function renderApprovalAssetPreview(kind) {
  const dataUrl = approvalAssetState[kind] || '';
  const capitalized = kind.charAt(0).toUpperCase() + kind.slice(1);
  const image = document.getElementById(`staff${capitalized}Preview`);
  const empty = document.getElementById(`staff${capitalized}Empty`);
  image.src = dataUrl;
  image.hidden = !dataUrl;
  empty.hidden = Boolean(dataUrl);
}

async function approvalImageDataUrl(file) {
  if (!file || !/^image\/(?:png|jpeg|webp)$/i.test(file.type)) throw new Error('Choose a PNG, JPG or WebP image.');
  if (file.size > 5 * 1024 * 1024) throw new Error('Choose an image smaller than 5 MB.');
  const raw = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the selected image.'));
    reader.readAsDataURL(file);
  });
  const image = await new Promise((resolve, reject) => {
    const loaded = new Image();
    loaded.onload = () => resolve(loaded);
    loaded.onerror = () => reject(new Error('The selected image could not be opened.'));
    loaded.src = raw;
  });
  const scale = Math.min(1, 700 / image.width, 280 / image.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  const optimized = canvas.toDataURL('image/webp', .82);
  if (optimized.length > 350000) throw new Error('The optimized image is still too large. Crop it more closely and try again.');
  return optimized;
}

async function profilePhotoDataUrl(file) {
  if (!file || !/^image\/(?:png|jpeg|webp)$/i.test(file.type)) throw new Error('Choose a PNG, JPG or WebP image.');
  if (file.size > 5 * 1024 * 1024) throw new Error('Choose an image smaller than 5 MB.');
  const raw = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the selected image.'));
    reader.readAsDataURL(file);
  });
  const image = await new Promise((resolve, reject) => {
    const loaded = new Image();
    loaded.onload = () => resolve(loaded);
    loaded.onerror = () => reject(new Error('The selected image could not be opened.'));
    loaded.src = raw;
  });
  const sourceSize = Math.min(image.width, image.height);
  const sourceX = Math.max(0, (image.width - sourceSize) / 2);
  const sourceY = Math.max(0, (image.height - sourceSize) / 2);
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 320;
  canvas.getContext('2d').drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, 320, 320);
  const optimized = canvas.toDataURL('image/webp', .82);
  if (optimized.length > 350000) throw new Error('The optimized picture is still too large. Choose a smaller image.');
  return optimized;
}

function renderProfilePhoto(dataUrl = '', displayName = '') {
  const photo = clean(dataUrl);
  const fallback = clean(displayName).charAt(0).toUpperCase() || 'S';
  staffAvatarImage.src = photo;
  staffAvatarImage.hidden = !photo;
  staffAvatarFallback.textContent = fallback;
  staffAvatarFallback.hidden = Boolean(photo);
  const preview = document.getElementById('staffProfilePhotoPreview');
  const previewFallback = document.getElementById('staffProfilePhotoFallback');
  preview.src = photo;
  preview.hidden = !photo;
  previewFallback.textContent = fallback;
  previewFallback.hidden = Boolean(photo);
  document.getElementById('staffProfilePhotoRemove').hidden = !photo;
}

function openStaffProfile() {
  if (!currentUser) return;
  staffProfileForm.reset();
  document.getElementById('staffLoginDetailsForm').reset();
  profilePhotoState = clean(currentUser.profilePhotoUrl);
  document.getElementById('staffProfileDisplayName').value = currentUser.displayName || currentUser.username || '';
  document.getElementById('staffProfileLoginUsername').value = currentUser.loginUsername || currentUser.username || '';
  renderProfilePhoto(profilePhotoState, currentUser.displayName || currentUser.username);
  const canManageSubscription = currentUser.role === 'Super Admin';
  profileSubscriptionSection.hidden = !canManageSubscription;
  if (canManageSubscription) {
    document.getElementById('staffProfileSubscriptionPlan').textContent = `${clean(currentUser.subscriptionPlan || 'Current')} plan`;
    document.getElementById('staffProfileSubscriptionCopy').textContent = currentUser.subscriptionActive === false || currentUser.subscriptionReadOnly === true
      ? (currentUser.subscriptionMessage || 'This subscription needs attention. Choose a paid plan to restore access.')
      : 'Compare plans, change billing frequency and upgrade securely through Paystack.';
  }
  setStatus(document.getElementById('staffProfileStatus'), '');
  setStatus(document.getElementById('staffLoginDetailsStatus'), '');
  staffProfileDialog.showModal();
}

async function openApprovalSettings() {
  setStatus(document.getElementById('staffApprovalSettingsStatus'), 'Loading saved settings...');
  approvalSettingsDialog.showModal();
  try {
    const data = await approvalProfileRequest();
    approvalProfile = data.profile || {};
    approvalAssetState = {
      signature: approvalProfile.SignatureDataUrl || '',
      stamp: approvalProfile.StampDataUrl || ''
    };
    renderApprovalAssetPreview('signature');
    renderApprovalAssetPreview('stamp');
    ['ApplySignatureOnApproval', 'ApplyStampOnApproval', 'ApplySignatureOnPosting', 'ApplyStampOnPosting']
      .forEach((name) => { approvalSettingsForm.elements[name].checked = Boolean(approvalProfile[name]); });
    setStatus(document.getElementById('staffApprovalSettingsStatus'), '');
  } catch (error) {
    setStatus(document.getElementById('staffApprovalSettingsStatus'), error.message || String(error), 'bad');
  }
}

function subscriptionPlanRank(name) {
  return ['Free', 'Starter', 'Standard', 'Professional', 'Enterprise'].indexOf(clean(name));
}

function subscriptionMoney(amount, currency) {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: clean(currency) || 'NGN', maximumFractionDigits: 0 }).format(Number(amount || 0));
}

function renderStaffSubscription() {
  if (!subscriptionData) return;
  const { catalog, policy, edition } = subscriptionData;
  const currentPlan = clean(policy.Plan || 'Starter');
  const currentCycle = clean(policy.BillingCycle || 'monthly').toLowerCase();
  const renewalRequired = /payment grace|payment failed|past due|suspended|expired/i.test(`${clean(policy.SubscriptionStatus)} ${clean(policy.LifecycleStage)}`);
  const plans = Array.isArray(catalog.Plans) ? catalog.Plans : [];
  document.getElementById('staffSubscriptionSummary').innerHTML = `
    <div><small>Current plan</small><strong>${escapeHtml(currentPlan)}</strong></div>
    <div><small>Billing</small><strong>${escapeHtml(currentCycle === 'yearly' ? 'Yearly' : 'Monthly')}</strong></div>
    <div><small>Status</small><strong>${escapeHtml(policy.SubscriptionStatus || policy.PaymentStatus || 'Active')}</strong></div>
    <div><small>Paid through</small><strong>${policy.PaidThroughAt ? escapeHtml(new Date(policy.PaidThroughAt).toLocaleDateString()) : 'Not recorded'}</strong></div>
    <div><small>Active users allowed</small><strong>${escapeHtml(policy.UserLimit || 0)}</strong></div>`;
  document.querySelectorAll('[data-subscription-cycle]').forEach((button) => {
    button.classList.toggle('active', button.dataset.subscriptionCycle === subscriptionCycle);
  });
  document.getElementById('staffSubscriptionPlans').innerHTML = plans.map((plan) => {
    const amount = subscriptionCycle === 'yearly' ? plan.YearlyAmount : plan.MonthlyAmount;
    const samePlan = clean(plan.Name) === currentPlan;
    const lowerPlan = subscriptionPlanRank(plan.Name) < subscriptionPlanRank(currentPlan);
    const currentChoice = samePlan && subscriptionCycle === currentCycle && !renewalRequired;
    const unavailable = plan.Active === false || clean(plan.Name) === 'Free' || lowerPlan || currentChoice || !(Number(amount) > 0);
    const features = plan.FeaturesByEdition?.[edition] || [];
    const label = currentChoice ? 'Current plan' : lowerPlan ? 'Contact support to downgrade' : samePlan && renewalRequired && subscriptionCycle === currentCycle ? `Renew ${plan.Name}` : samePlan ? `Switch to ${subscriptionCycle}` : `Upgrade to ${plan.Name}`;
    return `<article class="staff-subscription-plan ${currentChoice ? 'current' : ''}">
      <header><div><small>${escapeHtml(plan.Summary || '')}</small><h3>${escapeHtml(plan.Name)}</h3></div>${currentChoice ? '<span>Current</span>' : ''}</header>
      <p class="subscription-price"><strong>${escapeHtml(subscriptionMoney(amount, catalog.Currency))}</strong><span>/${subscriptionCycle === 'yearly' ? 'year' : 'month'}</span></p>
      <p class="subscription-seat-limit">Up to ${escapeHtml(plan.UserLimit)} active users</p>
      <ul>${features.slice(0, 7).map((feature) => `<li>${escapeHtml(feature)}</li>`).join('')}</ul>
      ${features.length > 7 ? `<small class="subscription-more">+${features.length - 7} more included features</small>` : ''}
      <button type="button" data-upgrade-plan="${escapeHtml(plan.Name)}" ${unavailable ? 'disabled' : ''}>${escapeHtml(label)}</button>
    </article>`;
  }).join('');
}

async function openStaffSubscription() {
  subscriptionDialog.showModal();
  setStatus(document.getElementById('staffSubscriptionStatus'), 'Loading subscription options...');
  try {
    const response = await staffFetch('/api/staff-subscription', { credentials: 'same-origin', cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.message || 'Subscription options could not be loaded.');
    subscriptionData = data;
    subscriptionCycle = clean(data.policy?.BillingCycle || 'monthly').toLowerCase();
    renderStaffSubscription();
    setStatus(document.getElementById('staffSubscriptionStatus'), 'Select a higher plan or a different billing cycle.');
  } catch (error) {
    setStatus(document.getElementById('staffSubscriptionStatus'), error.message || String(error), 'bad');
  }
}

async function startSubscriptionUpgrade(plan, button) {
  const original = button.textContent;
  let loading = false;
  try {
    const planEntry = subscriptionData?.catalog?.Plans?.find((entry) => clean(entry.Name) === clean(plan));
    const amount = subscriptionCycle === 'yearly'
      ? Number(planEntry?.YearlyAmount || 0)
      : Number(planEntry?.MonthlyAmount || 0);
    const paymentChoice = await window.DynamaxPaymentMethods.choose({
      methodsUrl: '/api/platform-payment-methods',
      amount,
      currency: subscriptionData?.catalog?.Currency || 'NGN'
    });
    if (!paymentChoice) return;
    const loadingLabel = paymentChoice.paymentMethod === 'direct_bank_transfer' ? 'Submitting transfer...' : 'Opening Paystack...';
    setButtonLoading(button, true, loadingLabel, original);
    loading = true;
    const response = await staffFetch('/api/staff-subscription', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plan,
        billingCycle: subscriptionCycle,
        idempotencyKey: newIdempotencyKey(),
        paymentMethod: paymentChoice.paymentMethod,
        bankReference: paymentChoice.bankReference || '',
        proofDataUrl: paymentChoice.proofDataUrl || '',
        proofFileName: paymentChoice.proofFileName || ''
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.message || 'The upgrade checkout could not be started.');
    if (data.directTransfer) {
      setStatus(document.getElementById('staffSubscriptionStatus'), `Transfer submitted for verification. Reference: ${data.paymentReference}. Your current plan remains active until Dynamax approves it.`, 'ok');
      setButtonLoading(button, false, 'Submitting transfer...', original);
      loading = false;
      return;
    }
    const target = new URL(data.authorizationUrl);
    if (target.protocol !== 'https:') throw new Error('The payment provider returned an invalid checkout address.');
    window.location.assign(target.href);
  } catch (error) {
    setStatus(document.getElementById('staffSubscriptionStatus'), error.message || String(error), 'bad');
    if (loading) setButtonLoading(button, false, 'Opening Paystack...', original);
  }
}

function setSidebarOpen(open) {
  const shouldOpen = Boolean(open) && window.matchMedia('(max-width: 680px)').matches && !dashboardEl.hidden;
  sidebarEl.classList.toggle('is-open', shouldOpen);
  sidebarScrim.hidden = !shouldOpen;
  document.body.classList.toggle('staff-sidebar-open', shouldOpen);
  if (!shouldOpen && staffAccountMenu) staffAccountMenu.open = false;
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

function clearStaffWorkspaceState() {
  staffSessionAbortController.abort();
  staffSessionAbortController = new AbortController();
  window.clearTimeout(recordsDeskSearchTimer);
  recordsDeskAbortController?.abort();
  recordsDeskAbortController = null;
  recordsDeskRequest += 1;
  organizationDashboardChartsRequest += 1;
  setSidebarOpen(false);
  staffBearerToken = '';
  selectedBranchId = 'all';
  availableBranches = [];
  branchSwitchInProgress = false;
  currentUser = null;
  dashboardData = null;
  financeData = null;
  staffUsersData = [];
  staffAuditData = [];
  securityAuditData = {
    rows: [], facets: {}, warnings: [], fromDate: '', toDate: '', totalMatches: 0, truncated: false,
    filters: { action: '', user: '', module: '', outcome: '', source: '', branchId: '', search: '' }
  };
  staffApprovalAccounts = [];
  staffRoleAccessData = null;
  staffRoleAccessSelectedRole = '';
  pendingMfaLogin = null;
  pendingMfaCompletedLogin = null;
  staffMfaData = null;
  staffMfaAdminData = null;
  latestRecoveryCodes = [];
  humanResourcesData = null;
  approvalProfile = null;
  approvalAssetState = { signature: '', stamp: '' };
  pendingFinanceDecision = null;
  financeDecisionBiometricVerified = false;
  financeDecisionApprovalProof = '';
  profilePhotoState = '';
  incomeAnalyticsData = null;
  incomeAnalyticsFilter = { period: 'monthly' };
  organizationDepartmentWorkspaceTab = 'overview';
  dashboardAttendanceRequest += 1;
  dashboardAttendanceCache = null;
  dashboardClockTimeZone = '';
  stopDashboardClock();
  executiveOfficeData = null;
  executiveOfficeTab = 'overview';
  executiveDirectoryType = '';
  executiveDirectoryQuery = '';
  executiveDirectoryResults = [];
  executiveAvailableDirectoryTypes = [];
  executiveSelectedRecipient = null;
  activeSection = '';
  activeTabs = [];
  recordsDeskHandoffContext = null;
  recordsDeskState = {
    query: '', type: 'all', availableTypes: [], results: [], totalMatches: 0,
    truncated: false, selectedKey: '', selectedBranchId: '', detail: null, loading: false, loadingDetail: false, error: ''
  };
  try { sessionStorage.removeItem('dynamaxRecordsDeskContext'); } catch (_error) { /* Ignore private storage. */ }
  tabsEl.replaceChildren();
  summaryEl.replaceChildren();
  dashboardClockEl.replaceChildren();
  dashboardChartsEl.replaceChildren();
  panelEl.replaceChildren();
  mobileNav.replaceChildren();
  loginForm.reset();
  passwordForm.reset();
  staffProfileForm.reset();
  financeDecisionForm.reset();
  approvalSettingsForm.reset();
  document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close());
  displayNameEl.textContent = '';
  roleEl.textContent = '';
  branchControl.hidden = true;
  branchSelector.replaceChildren();
  branchSelector.disabled = false;
  renderProfilePhoto('', 'Staff');
  delete document.documentElement.dataset.edition;
}

function initializeStaffBranchContext(user = {}) {
  const assignedBranchId = clean(user.assignedBranchId || user.branchId);
  const storedBranchId = readStoredStaffBranch(user);
  selectedBranchId = assignedBranchId || clean(user.activeBranchId) || storedBranchId || 'all';
  availableBranches = assignedBranchId
    ? [{ id: assignedBranchId, name: clean(user.branchName) || assignedBranchId }]
    : [];
}

function staffBranchStorageKey(user = currentUser || {}) {
  const username = clean(user.username || user.loginUsername).toLowerCase() || 'anonymous';
  return `dynamax:staff-branch:${window.location.host}:${requestedWorkspace}:${username}`;
}

function readStoredStaffBranch(user = currentUser || {}) {
  try {
    return clean(window.sessionStorage.getItem(staffBranchStorageKey(user)));
  } catch (_error) {
    return '';
  }
}

function rememberStaffBranch(user = currentUser || {}) {
  if (!user || user.canSwitchBranches !== true || !clean(selectedBranchId) || selectedBranchId === 'all') return;
  try {
    window.sessionStorage.setItem(staffBranchStorageKey(user), selectedBranchId);
  } catch (_error) {
    // Browser storage is optional; every request remains server-validated.
  }
}

function renderStaffBranchSelector(user = currentUser || {}) {
  const canSwitch = user.canSwitchBranches === true;
  branchControl.hidden = !canSwitch;
  if (!canSwitch) {
    branchSelector.replaceChildren();
    return;
  }
  const options = [...availableBranches]
    .filter((branch, index, rows) => branch.id && rows.findIndex((item) => item.id.toLowerCase() === branch.id.toLowerCase()) === index);
  branchSelector.innerHTML = options
    .map((branch) => `<option value="${escapeHtml(branch.id)}">${escapeHtml(branch.name)}</option>`)
    .join('');
  const selectedOption = options.find((branch) => branch.id.toLowerCase() === clean(selectedBranchId).toLowerCase());
  const userOption = options.find((branch) => branch.id.toLowerCase() === clean(user.activeBranchId).toLowerCase());
  selectedBranchId = selectedOption?.id || userOption?.id || options[0]?.id || 'all';
  branchSelector.value = selectedBranchId;
  branchSelector.disabled = branchSwitchInProgress;
}

function paymentSettingsUrl() {
  const url = new URL('setup.html', window.location.href);
  if (clean(selectedBranchId) && selectedBranchId !== 'all') {
    url.searchParams.set('scope', 'branch');
    url.searchParams.set('branch', selectedBranchId);
  }
  url.hash = 'payment-settings';
  return `${url.pathname}${url.search}${url.hash}`;
}

function clearBranchScopedWorkspaceData() {
  staffSessionAbortController.abort();
  staffSessionAbortController = new AbortController();
  dashboardSectionRequests.clear();
  window.clearTimeout(recordsDeskSearchTimer);
  recordsDeskAbortController?.abort();
  recordsDeskAbortController = null;
  recordsDeskRequest += 1;
  organizationDashboardChartsRequest += 1;
  dashboardAttendanceRequest += 1;
  dashboardAttendanceCache = null;
  dashboardClockTimeZone = '';
  dashboardData = null;
  financeData = null;
  staffUsersData = [];
  staffAuditData = [];
  securityAuditData = {
    rows: [], facets: {}, warnings: [], fromDate: '', toDate: '', totalMatches: 0, truncated: false,
    filters: { action: '', user: '', module: '', outcome: '', source: '', branchId: '', search: '' }
  };
  staffApprovalAccounts = [];
  staffRoleAccessData = null;
  staffRoleAccessSelectedRole = '';
  staffMfaAdminData = null;
  humanResourcesData = null;
  staffAttendanceReportFilters = null;
  approvalProfile = null;
  incomeAnalyticsData = null;
  incomeAnalyticsFilter = { period: 'monthly' };
  executiveOfficeData = null;
  executiveDirectoryResults = [];
  executiveAvailableDirectoryTypes = [];
  executiveSelectedRecipient = null;
  studentConductData = null;
  Object.values(organizationCommerceCarts).forEach((cart) => cart.clear());
  organizationCommerceLastSale.organizationStore = null;
  organizationCommerceLastSale.restaurant = null;
  recordsDeskState = {
    query: '', type: 'all', availableTypes: [], results: [], totalMatches: 0,
    truncated: false, selectedKey: '', selectedBranchId: '', detail: null, loading: false, loadingDetail: false, error: ''
  };
  summaryEl.replaceChildren();
  dashboardClockEl.replaceChildren();
  dashboardChartsEl.replaceChildren();
  panelEl.replaceChildren();
}

async function switchStaffBranch(nextBranchId) {
  const next = clean(nextBranchId) || 'all';
  if (branchSwitchInProgress || next === selectedBranchId) return;
  const previous = selectedBranchId;
  branchSwitchInProgress = true;
  branchSelector.disabled = true;
  selectedBranchId = next;
  currentUser = {
    ...currentUser,
    branchId: next === 'all' ? '' : next,
    activeBranchId: next
  };
  clearBranchScopedWorkspaceData();
  setStatus(dashboardStatus, `Switching to ${branchSelector.selectedOptions[0]?.textContent || 'the selected branch'}...`);
  const loaded = await loadDashboard({ mode: 'shell' });
  if (!loaded && currentUser) {
    selectedBranchId = previous;
    currentUser = {
      ...currentUser,
      branchId: previous === 'all' ? '' : previous,
      activeBranchId: previous
    };
    clearBranchScopedWorkspaceData();
    await loadDashboard({ mode: 'shell' });
  } else if (loaded) {
    rememberStaffBranch();
  }
  branchSwitchInProgress = false;
  if (currentUser) renderStaffBranchSelector(currentUser);
}

function showLogin(message = '', type = '') {
  clearStaffWorkspaceState();
  dashboardEl.hidden = true;
  identityEl.hidden = true;
  approvalSettingsButton.hidden = true;
  mobileNav.hidden = true;
  loginCard.hidden = false;
  setStatus(loginStatus, message, type);
  refreshPasskeyControls();
  warmPasskeyCredentialManager();
}

function resolveDashboardEdition(user = {}) {
  const explicitEdition = clean(user.organisationEdition || user.organizationEdition || user.edition).toLowerCase();
  if (['school', 'church', 'faith', 'organization'].includes(explicitEdition)) return explicitEdition;
  if (['church', 'faith', 'organization'].includes(requestedWorkspace)) return requestedWorkspace;
  return 'school';
}

function executiveOfficeTitle() {
  const role = clean(currentUser?.role);
  const faithEdition = document.documentElement.dataset.edition === 'church'
    || ['church', 'faith', 'organization'].includes(resolveDashboardEdition(currentUser || {}));
  if (!faithEdition) return "Principal's Office";
  if (role === 'Senior Pastor') return "Senior Pastor's Office";
  return 'Executive Office';
}

function staffTabLabel(key, fallback = '') {
  if (key === 'schoolInsights') return 'School Insights';
  if (key === 'executiveOffice') return executiveOfficeTitle();
  if (resolveDashboardEdition(currentUser || {}) === 'organization') {
    return organizationTabLabels[key] || fallback;
  }
  return fallback;
}

function schoolInsightsAvailable(allowed = [], user = currentUser || {}) {
  return resolveDashboardEdition(user) === 'school' && (allowed || []).includes('accounts');
}

const genericOrganizationTextReplacements = Object.freeze([
  ['Church Donations', 'Grants & Contributions'],
  ['Church Donation', 'Organisation Contribution'],
  ['Church Offerings', 'Income & Receipts'],
  ['Church Attendance', 'Meeting Attendance'],
  ['Church Membership', 'Personnel Directory'],
  ['Offering Batches', 'Income Batches'],
  ['Offering Batch', 'Income Batch'],
  ['Funds & Accounting Mappings', 'Budgets & Account Mappings'],
  ['Funds, Giving Types & Accounting Mappings', 'Budgets, Income Categories & Account Mappings'],
  ['Giving Types', 'Income Categories'],
  ['Giving Type', 'Income Category'],
  ['Services & Attendance', 'Meetings & Attendance'],
  ['Members & Positions', 'Personnel & Positions'],
  ['Departments & Members', 'Departments & Personnel'],
  ['Member Directory', 'Personnel Directory'],
  ['Registered members', 'Personnel Register'],
  ['Department members', 'Department Personnel'],
  ['Home churches', 'Regional Offices'],
  ['Home church', 'Regional Office'],
  ['home-church', 'regional-office'],
  ['Home cell', 'Field Unit'],
  ['Foreign Desk', 'External Relations'],
  ['First-timers', 'First-time attendees'],
  ['New converts', 'New participants'],
  ['Pastoral', 'Confidential'],
  ['Minister', 'Coordinator'],
  ['Tithes', 'Levies'],
  ['Tithe', 'Levy'],
  ['Thanksgiving', 'Appreciation'],
  ['First Fruit', 'Special Contribution'],
  ['membership', 'personnel'],
  ['members', 'personnel'],
  ['member', 'person'],
  ['offerings', 'income receipts'],
  ['offering', 'income receipt'],
  ['donations', 'contributions'],
  ['donation', 'contribution'],
  ['donors', 'contributors'],
  ['donor', 'contributor'],
  ['giving', 'contributions'],
  ['gifts', 'contributions'],
  ['gift', 'contribution'],
  ['services', 'meetings'],
  ['service', 'meeting'],
  ['ministry', 'operational unit'],
  ['church', 'organisation'],
  ['stewardship', 'financial control']
]);

function preserveReplacementCase(source, replacement) {
  if (source === source.toUpperCase()) return replacement.toUpperCase();
  if (source.charAt(0) === source.charAt(0).toUpperCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function genericOrganizationText(value) {
  if (resolveDashboardEdition(currentUser || {}) !== 'organization') return String(value ?? '');
  return genericOrganizationTextReplacements.reduce((output, [source, replacement]) => (
    output.replace(new RegExp(`\\b${source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), (match) => (
      preserveReplacementCase(match, replacement)
    ))
  ), String(value ?? ''));
}

let applyingGenericOrganizationVocabulary = false;

function applyGenericOrganizationVocabulary(root = panelEl) {
  if (!root || applyingGenericOrganizationVocabulary || resolveDashboardEdition(currentUser || {}) !== 'organization') return;
  applyingGenericOrganizationVocabulary = true;
  try {
    const selector = [
      'h1', 'h2', 'h3', 'h4', 'p', 'small', 'label', 'button', 'th', 'legend',
      '.workflow-kpis span', '.module-stat span', '.module-stat small', '.status'
    ].join(',');
    const elements = [root, ...root.querySelectorAll(selector)].filter((element) => element?.nodeType === 1);
    elements.forEach((element) => {
      [...element.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .forEach((node) => {
          const nextValue = genericOrganizationText(node.nodeValue);
          if (nextValue !== node.nodeValue) node.nodeValue = nextValue;
        });
      ['title', 'aria-label', 'data-create-heading', 'data-create-label', 'data-loading-text'].forEach((attribute) => {
        if (!element.hasAttribute(attribute)) return;
        const currentValue = element.getAttribute(attribute);
        const nextValue = genericOrganizationText(currentValue);
        if (nextValue !== currentValue) element.setAttribute(attribute, nextValue);
      });
    });
    root.querySelectorAll('input[placeholder], textarea[placeholder]').forEach((element) => {
      const nextPlaceholder = genericOrganizationText(element.placeholder);
      if (nextPlaceholder !== element.placeholder) element.placeholder = nextPlaceholder;
    });
    const genericOptionLabels = new Set([
      'Home Church', 'Home Cell', 'Foreign Desk', 'Member', 'Visitor',
      'Donation', 'Offering', 'Special Offering', 'Tithe', 'Thanksgiving',
      'First Fruit'
    ]);
    root.querySelectorAll('option').forEach((option) => {
      if (!clean(option.value) || genericOptionLabels.has(clean(option.textContent))) {
        const nextLabel = genericOrganizationText(option.textContent);
        if (nextLabel !== option.textContent) option.textContent = nextLabel;
      }
    });
  } finally {
    applyingGenericOrganizationVocabulary = false;
  }
}

let genericOrganizationVocabularyTimers = [];

function scheduleGenericOrganizationVocabulary() {
  genericOrganizationVocabularyTimers.forEach((timer) => window.clearTimeout(timer));
  genericOrganizationVocabularyTimers = [];
  if (resolveDashboardEdition(currentUser || {}) !== 'organization') return;
  genericOrganizationVocabularyTimers = [0, 250, 1000, 4000, 10000].map((delay) => window.setTimeout(() => {
    applyGenericOrganizationVocabulary(panelEl);
  }, delay));
}

function showDashboard(user, options = {}) {
  currentUser = { ...(currentUser || {}), ...user };
  scheduleGenericOrganizationVocabulary();
  if (currentUser.canSwitchBranches === true && selectedBranchId !== 'all') {
    currentUser.branchId = selectedBranchId;
    currentUser.activeBranchId = selectedBranchId;
  }
  user = currentUser;
  const displayName = user.displayName || user.username || 'Staff';
  const dashboardEdition = resolveDashboardEdition(user);
  const isFaith = ['church', 'faith'].includes(dashboardEdition);
  const isGenericOrganization = dashboardEdition === 'organization';
  const isOrganisationOperations = isFaith || isGenericOrganization;
  const isExecutiveRole = ['Principal', 'Senior Pastor', 'Head Minister'].includes(clean(user.role));
  const executiveWorkspaceName = isFaith && user.role === 'Senior Pastor'
    ? "Senior Pastor's Office"
    : (isExecutiveRole ? (isOrganisationOperations ? 'Executive Office' : "Principal's Office") : '');
  displayNameEl.textContent = displayName;
  roleEl.textContent = [user.role, user.department].filter(Boolean).join(' • ');
  renderProfilePhoto(user.profilePhotoUrl, displayName);
  sidebarEl.querySelector('.staff-sidebar-heading')?.setAttribute('data-initial', displayName.charAt(0).toUpperCase());
  editionLabel.textContent = isFaith ? 'Religious Organisation' : (isGenericOrganization ? 'Organisation Operations' : 'Staff Web Companion');
  workspaceTitle.textContent = executiveWorkspaceName || (isOrganisationOperations ? 'Organisation Operations' : 'Operations Centre');
  overviewLabel.textContent = executiveWorkspaceName ? 'Executive overview' : (isFaith ? 'Community overview' : 'Operations overview');
  welcomeCopy.textContent = executiveWorkspaceName
    ? 'Review the organisation, prepare official correspondence and monitor the summaries selected for your office.'
    : (isGenericOrganization
      ? 'Monitor personnel, departments, meetings, revenue, programmes and organisational activity.'
      : (isOrganisationOperations
      ? 'Monitor departments, meetings, offerings, programs and organisational activity.'
      : 'Monitor records, requests and departmental activity.'));
  welcomeTitle.textContent = `Welcome, ${displayName}`;
  renderStaffBranchSelector(user);
  document.documentElement.dataset.edition = isOrganisationOperations ? 'church' : 'school';
  loginCard.hidden = true;
  identityEl.hidden = false;
  dashboardEl.hidden = false;
  mobileNav.hidden = false;
  approvalSettingsButton.hidden = !(
    user.role === 'Super Admin' ||
    user.role === 'Accounts Officer' ||
    isExecutiveRole ||
    user.approvalEnabled
  );
  paymentSettingsButton.hidden = user.role !== 'Super Admin';
  subscriptionButton.hidden = user.role !== 'Super Admin';
  if (subscriptionAccessBanner) {
    const readOnly = user.subscriptionReadOnly === true;
    subscriptionAccessBanner.hidden = !readOnly;
    subscriptionAccessBanner.innerHTML = readOnly
      ? `<div><strong>Payment grace period &mdash; read-only access</strong><span>${escapeHtml(user.subscriptionMessage || 'Renew the organisation subscription to make operational changes.')}</span></div>${user.role === 'Super Admin' ? '<button type="button" data-open-subscription-renewal>Renew subscription</button>' : ''}`
      : '';
    subscriptionAccessBanner.querySelector('[data-open-subscription-renewal]')?.addEventListener('click', openStaffSubscription);
  }
  if (options.refreshPasskeys !== false) refreshPasskeyControls();
}

async function continueAfterAuthentication(user) {
  initializeStaffBranchContext(user);
  showDashboard(user);
  if (user.mustChangePassword) {
    passwordDialog.showModal();
    document.getElementById('staffNewPassword').focus();
    return;
  }
  await loadDashboard({ mode: 'shell' });
}

async function sessionRequest(method = 'GET', body = null) {
  const response = await staffFetch('/api/staff-session', {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({ ok: false, message: 'Staff authentication did not return JSON.' }));
  return { response, data };
}

async function confirmFreshStaffSession(fallbackUser, fallbackToken = '') {
  const memoryToken = clean(fallbackToken);
  if (memoryToken && fallbackUser) {
    staffBearerToken = memoryToken;
    return fallbackUser;
  }
  staffBearerToken = '';
  const { response, data } = await sessionRequest();
  if (response.ok && data.authenticated && data.user) return data.user;
  throw new Error(data.message || `Your identity was verified, but this browser did not retain the new session for ${fallbackUser?.displayName || fallbackUser?.username || 'this account'}.`);
}

function mergeDashboardResponse(current, incoming) {
  if (!current) return incoming;
  return {
    ...current,
    ...incoming,
    user: { ...(current.user || {}), ...(incoming.user || {}) },
    summary: { ...(current.summary || {}), ...(incoming.summary || {}) },
    charts: { ...(current.charts || {}), ...(incoming.charts || {}) },
    departments: { ...(current.departments || {}), ...(incoming.departments || {}) },
    summaryDeferred: current.summaryDeferred === true && incoming.summaryDeferred !== false
  };
}

async function loadDashboard(options = {}) {
  const section = clean(options.section || (legacyDashboardSections.has(activeSection) ? activeSection : ''));
  const mode = clean(options.mode || (section ? 'section' : 'shell')).toLowerCase();
  const merge = options.merge === true || mode === 'section';
  const requestedBranchId = clean(selectedBranchId) || 'all';
  setDashboardRefreshLoading(true);
  setStatus(dashboardStatus, mode === 'shell'
    ? 'Opening your permitted workspace...'
    : `Loading ${staffTabLabel(section, section) || 'module'} records...`);
  try {
    const response = await staffFetch('/api/admin', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, ...(section ? { section } : {}) })
    });
    const data = await response.json().catch(() => ({ ok: false, message: 'Staff dashboard did not return JSON.' }));
    if (response.status === 401) {
      showLogin(data.message || 'Your staff session has expired.', 'bad');
      return;
    }
    if (!response.ok || !data.ok) throw new Error(data.message || 'Could not load staff dashboard.');
    if (Array.isArray(data.branches)) {
      availableBranches = data.branches.map((branch) => ({
        id: clean(branch.id || branch.Id),
        name: clean(branch.name || branch.Name || branch.id || branch.Id)
      })).filter((branch) => branch.id);
    }
    if (data.user?.canSwitchBranches === true && requestedBranchId === 'all') {
      const storedBranchId = readStoredStaffBranch(data.user);
      const storedBranch = availableBranches.find((branch) => branch.id.toLowerCase() === storedBranchId.toLowerCase());
      selectedBranchId = storedBranch?.id || clean(data.defaultBranchId || availableBranches[0]?.id || 'all');
      data.user = {
        ...data.user,
        branchId: selectedBranchId === 'all' ? '' : selectedBranchId,
        activeBranchId: selectedBranchId
      };
    }
    dashboardData = merge ? mergeDashboardResponse(dashboardData, data) : data;
    const dashboardUser = data.user || {};
    const responseBranchId = clean(dashboardUser.activeBranchId);
    if (
      dashboardUser.canSwitchBranches === true
      && requestedBranchId !== 'all'
      && responseBranchId.toLowerCase() !== requestedBranchId.toLowerCase()
    ) {
      throw new Error('The server did not open the selected branch. Please select the branch again.');
    }
    if (requestedBranchId !== 'all' && responseBranchId) selectedBranchId = responseBranchId;
    currentUser = {
      ...currentUser,
      ...dashboardUser,
      // Profile images live in staffProfileImages and are hydrated by the
      // session endpoint. The general dashboard response intentionally omits
      // that large data URL, so do not let it erase the hydrated avatar.
      profilePhotoUrl: clean(dashboardUser.profilePhotoUrl) || clean(currentUser?.profilePhotoUrl)
    };
    rememberStaffBranch(currentUser);
    showDashboard(currentUser, { refreshPasskeys: false });
    if (mode === 'shell') await refreshStaffSiteProfile();
    const allowed = data.allowedSections || currentUser.allowedSections || [];
    const workspaceSections = [
      'overview',
      ...(schoolInsightsAvailable(allowed, data.user || currentUser || {}) ? ['schoolInsights'] : []),
      ...allowed
    ];
    if (!activeSection || !workspaceSections.includes(activeSection)) {
      activeSection = workspaceSections.includes(requestedSection) ? requestedSection : 'overview';
    }
    renderTabs(allowed);
    renderWorkspace(activeSection);
    renderSection(activeSection);
    scheduleGenericOrganizationVocabulary();
    setStatus(dashboardStatus, currentUser.subscriptionActive === false
      ? (currentUser.subscriptionMessage || 'This subscription is not active. Choose a paid subscription to continue.')
      : currentUser.subscriptionReadOnly === true
      ? (currentUser.subscriptionMessage || 'Payment grace period: records are available in read-only mode.')
      : mode === 'shell'
      ? 'Workspace ready. Records load only when you open a module.'
      : `${staffTabLabel(section, section) || 'Module'} updated.`, currentUser.subscriptionActive === false ? 'bad' : currentUser.subscriptionReadOnly === true ? 'warn' : 'ok');
    return true;
  } catch (error) {
    setStatus(dashboardStatus, error.message || String(error), 'bad');
    if (section && activeSection === section) {
      panelEl.innerHTML = `<p class="status bad">${escapeHtml(error.message || String(error))}</p>`;
    }
    return false;
  } finally {
    setDashboardRefreshLoading(false);
  }
}

function renderDashboardCharts(charts) {
  if (!dashboardChartsEl) return;
  if (activeSection !== 'overview') {
    dashboardChartsEl.hidden = true;
    dashboardChartsEl.innerHTML = '';
    return;
  }
  dashboardChartsEl.hidden = false;
  if (currentUser?.subscriptionActive === false || dashboardData?.subscriptionActive === false) {
    const message = clean(currentUser?.subscriptionMessage || dashboardData?.subscriptionMessage)
      || 'Your 7-day full-access trial has ended. Choose a paid subscription to continue.';
    const endedAt = clean(currentUser?.trialEndsAt || dashboardData?.trialEndsAt);
    dashboardChartsEl.innerHTML = `<article class="department-chart-card dashboard-chart-loading subscription-expired-card"><h3>Subscription required</h3><p class="status bad">${escapeHtml(message)}</p>${endedAt ? `<p class="muted">Trial ended: ${escapeHtml(new Date(endedAt).toLocaleString())}</p>` : ''}<p><a class="button-link" href="/register-organization.html#plans">View paid plans</a></p></article>`;
    return;
  }
  if (dashboardData?.summaryDeferred) {
    dashboardChartsEl.innerHTML = '<article class="department-chart-card dashboard-chart-loading"><h3>Low-read workspace</h3><p class="muted">Open a module to load only the records needed for that task. This prevents sign-in and refresh from scanning the entire database.</p></article>';
    return;
  }
  if (document.documentElement.dataset.edition === 'church') {
    dashboardChartsEl.innerHTML = '<article class="department-chart-card dashboard-chart-loading"><h3>Department recordings</h3><p class="muted">Loading chart summaries...</p></article>';
    loadOrganizationDashboardCharts();
    return;
  }
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

function stopDashboardClock() {
  if (dashboardClockTimer) window.clearInterval(dashboardClockTimer);
  dashboardClockTimer = 0;
}

function updateDashboardClockFace() {
  const timeElement = document.getElementById('staffDashboardClockTime');
  const dateElement = document.getElementById('staffDashboardClockDate');
  if (!timeElement || !dateElement) return;
  const options = dashboardClockTimeZone ? { timeZone: dashboardClockTimeZone } : {};
  const now = new Date();
  try {
    timeElement.textContent = new Intl.DateTimeFormat([], {
      ...options,
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).format(now);
    dateElement.textContent = new Intl.DateTimeFormat([], {
      ...options,
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    }).format(now);
    const dateParts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      ...options,
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(now).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
    const attendanceDate = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
    if (activeSection === 'overview'
        && dashboardAttendanceCache?.data?.todayAttendanceDate
        && attendanceDate !== clean(dashboardAttendanceCache.data.todayAttendanceDate)
        && !dashboardAttendanceCache.loading) {
      void loadDashboardAttendanceCard(true);
    }
  } catch (_error) {
    timeElement.textContent = now.toLocaleTimeString();
    dateElement.textContent = now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
}

function attendanceDashboardAllowed() {
  if (!currentUser || currentUser.mustChangePassword) return false;
  return dashboardData?.subscriptionActive !== false && currentUser.subscriptionActive !== false;
}

function dashboardAttendanceSiteStorageKey(branchId) {
  return `dynamax:staff-attendance:dashboard-site:${clean(branchId) || 'main'}`;
}

function dashboardAttendanceTime(value, timeZone = '') {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat([], {
      ...(timeZone ? { timeZone } : {}),
      hour: '2-digit', minute: '2-digit'
    }).format(new Date(value));
  } catch (_error) {
    return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}

function renderDashboardTimeAttendance(data = null, message = '', tone = '') {
  if (!dashboardClockEl || activeSection !== 'overview') return;
  const loading = dashboardAttendanceCache?.loading && !data;
  const refreshing = Boolean(dashboardAttendanceCache?.loading);
  const state = clean(data?.state || 'CLOCKED_OUT').toUpperCase();
  const complete = state === 'COMPLETED';
  const direction = clean(data?.nextDirection || (state === 'CLOCKED_IN' ? 'OUT' : 'IN')).toUpperCase();
  const sites = data?.sites || [];
  const policy = data?.policy || {};
  warmAttendanceIdentity(policy);
  const identityMode = clean(policy.IdentityVerification || 'NONE').toUpperCase();
  const todaySchedule = data?.todaySchedule || {};
  const daily = data?.todayDaily || {};
  let savedSiteId = '';
  try { savedSiteId = window.localStorage.getItem(dashboardAttendanceSiteStorageKey(data?.branchId)) || ''; } catch (_error) { /* Browser storage is optional. */ }
  const selectedSiteId = sites.some((site) => clean(site.SiteId || site.__id) === savedSiteId)
    ? savedSiteId
    : clean(sites[0]?.SiteId || sites[0]?.__id);
  const stateLabel = complete ? 'Completed today' : state === 'CLOCKED_IN' ? 'Currently clocked in' : 'Not clocked in';
  const timeNote = todaySchedule.Enabled
    ? `${clean(todaySchedule.ResumptionTime)}-${clean(todaySchedule.ClosingTime)}`
    : 'No work schedule for today';
  const identityControl = `<small>${identityMode === 'PASSKEY' ? 'Device unlock required' : identityMode === 'FACE' ? 'Live face recognition with spoken guidance' : 'Location/network verification'}</small>`;
  dashboardClockEl.innerHTML = `
    <article class="dashboard-digital-clock">
      <small>${dashboardClockTimeZone ? escapeHtml(dashboardClockTimeZone) : 'Local time'}</small>
      <strong id="staffDashboardClockTime">--:--:--</strong>
      <span id="staffDashboardClockDate">Loading date...</span>
    </article>
    <article class="dashboard-attendance-quick">
      <div class="dashboard-attendance-heading"><div><small>My attendance</small><strong>${loading ? 'Loading attendance...' : escapeHtml(stateLabel)}</strong></div>${data ? `<span class="dashboard-attendance-state state-${escapeHtml(state.toLowerCase())}">${escapeHtml(daily.AttendanceStatus || stateLabel)}</span>` : ''}</div>
      ${!attendanceDashboardAllowed()
        ? '<p class="muted">Attendance clocking is unavailable while this organisation subscription is inactive.</p>'
        : loading
          ? '<p class="muted">Loading today\'s attendance state and approved locations...</p>'
          : data
            ? `<div class="dashboard-attendance-meta"><span>${escapeHtml(timeNote)}</span>${daily.FirstClockIn ? `<span>In: ${escapeHtml(dashboardAttendanceTime(daily.FirstClockIn, policy.TimeZone))}</span>` : ''}${daily.LastClockOut ? `<span>Out: ${escapeHtml(dashboardAttendanceTime(daily.LastClockOut, policy.TimeZone))}</span>` : ''}</div>
              <div class="dashboard-attendance-controls">
                <label>Location<select id="dashboardAttendanceSite" ${sites.length ? '' : 'disabled'}>${sites.length ? sites.map((site) => { const id = clean(site.SiteId || site.__id); return `<option value="${escapeHtml(id)}"${id === selectedSiteId ? ' selected' : ''}>${escapeHtml(site.Name)}</option>`; }).join('') : '<option value="">No approved location</option>'}</select></label>
                ${identityControl}
                <button type="button" id="dashboardAttendanceClockButton" ${sites.length && !complete && !refreshing ? '' : 'disabled'}>${refreshing ? 'Refreshing...' : complete ? 'Completed' : direction === 'OUT' ? 'Clock out' : 'Clock in'}</button>
              </div>`
            : '<p class="muted">Attendance information could not be loaded.</p>'}
      <p id="dashboardAttendanceStatus" class="status ${tone}">${escapeHtml(message)}</p>
    </article>`;
  updateDashboardClockFace();
  const siteSelect = document.getElementById('dashboardAttendanceSite');
  siteSelect?.addEventListener('change', () => {
    try { window.localStorage.setItem(dashboardAttendanceSiteStorageKey(data?.branchId), clean(siteSelect.value)); } catch (_error) { /* Browser storage is optional. */ }
  });
  document.getElementById('dashboardAttendanceClockButton')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const status = document.getElementById('dashboardAttendanceStatus');
    const siteId = clean(siteSelect?.value);
    if (!siteId) {
      setStatus(status, 'No approved attendance location is available.', 'bad');
      return;
    }
    const normalText = direction === 'OUT' ? 'Clock out' : 'Clock in';
    setButtonLoading(button, true, 'Verifying...', normalText);
    try {
      const { location, attendanceProof } = await attendanceVerificationEvidence(policy, siteId, direction);
      const result = await staffAttendanceRequest('clock', {
        SiteId: siteId,
        Direction: direction,
        Location: location,
        AttendanceProof: attendanceProof
      });
      await loadDashboardAttendanceCard(true, result.message, 'ok');
    } catch (error) {
      setStatus(status, error.message || String(error), 'bad');
    } finally {
      if (button.isConnected) setButtonLoading(button, false, 'Verifying...', normalText);
    }
  });
}

async function loadDashboardAttendanceCard(force = false, message = '', tone = '') {
  if (!dashboardClockEl || activeSection !== 'overview' || !attendanceDashboardAllowed()) return;
  const branchId = clean(selectedBranchId || currentUser?.branchId || 'main');
  if (!force && dashboardAttendanceCache?.branchId === branchId && dashboardAttendanceCache.loading) return;
  if (!force && dashboardAttendanceCache?.branchId === branchId && dashboardAttendanceCache.data) {
    dashboardClockTimeZone = clean(dashboardAttendanceCache.data.policy?.TimeZone);
    renderDashboardTimeAttendance(dashboardAttendanceCache.data, message, tone);
    return;
  }
  const requestId = ++dashboardAttendanceRequest;
  dashboardAttendanceCache = { branchId, data: dashboardAttendanceCache?.branchId === branchId ? dashboardAttendanceCache.data : null, loading: true };
  renderDashboardTimeAttendance(dashboardAttendanceCache.data, message || 'Refreshing attendance...', message ? tone : '');
  try {
    const data = await staffAttendanceRequest('quick');
    if (requestId !== dashboardAttendanceRequest || activeSection !== 'overview') return;
    dashboardAttendanceCache = { branchId, data, loading: false };
    dashboardClockTimeZone = clean(data.policy?.TimeZone);
    renderDashboardTimeAttendance(data, message, tone);
  } catch (error) {
    if (requestId !== dashboardAttendanceRequest || activeSection !== 'overview') return;
    dashboardAttendanceCache = { branchId, data: null, loading: false };
    renderDashboardTimeAttendance(null, error.message || String(error), 'bad');
  }
}

function setDashboardClockActive(active) {
  if (!dashboardClockEl) return;
  dashboardClockEl.hidden = !active;
  if (!active) {
    stopDashboardClock();
    return;
  }
  renderDashboardTimeAttendance(dashboardAttendanceCache?.data || null);
  stopDashboardClock();
  dashboardClockTimer = window.setInterval(updateDashboardClockFace, 1000);
  if (attendanceDashboardAllowed()) void loadDashboardAttendanceCard();
}

async function loadOrganizationDashboardCharts() {
  const requestId = ++organizationDashboardChartsRequest;
  try {
    const data = await organizationDepartmentAction('list');
    if (requestId !== organizationDashboardChartsRequest
      || activeSection !== 'overview'
      || document.documentElement.dataset.edition !== 'church') return;
    const departmentSummary = data.summaries?.departments || [];
    const areaSummary = data.summaries?.homeChurchAreas || [];
    const countrySummary = data.summaries?.participantsByCountry || [];
    dashboardChartsEl.hidden = false;
    dashboardChartsEl.innerHTML = `
      ${verticalBars(genericOrganizationText('Attendance by department'), departmentSummary, 'Name', 'Attendance', 'blue')}
      ${verticalBars(genericOrganizationText('Offerings by department'), departmentSummary, 'Name', 'Offerings', 'gold')}
      ${verticalBars(genericOrganizationText('Home churches by area / zone'), areaSummary, 'AreaZone', 'HomeChurches', 'emerald')}
      ${verticalBars(genericOrganizationText('Weekly home-church attendance by area / zone'), areaSummary, 'AreaZone', 'Attendance', 'purple')}
      ${verticalBars('Programme participants by country', countrySummary, 'Country', 'Participants', 'coral')}`;
  } catch (error) {
    if (requestId !== organizationDashboardChartsRequest
      || activeSection !== 'overview'
      || document.documentElement.dataset.edition !== 'church') return;
    dashboardChartsEl.hidden = false;
    dashboardChartsEl.innerHTML = `<article class="department-chart-card dashboard-chart-loading"><h3>Department recordings</h3><p class="status bad">${escapeHtml(error.message || String(error))}</p></article>`;
  }
}

function renderSummary(summary) {
  if (dashboardData?.summaryDeferred) {
    summaryEl.innerHTML = '<div><strong>Ready</strong><span>Low-read workspace</span><small>Module data loads on demand</small></div>';
    return;
  }
  const items = [
    ['Applications', summary.applications],
    ['Form Purchases', summary.formPurchases],
    ['Payments', summary.payments],
    ['Invoices', summary.invoices],
    ['Clinic Records', summary.clinicRecords],
    ['Kitchen Items', summary.kitchenInventory],
    ['Tuck Shop Purchases', summary.tuckShopPurchases],
    ['Low Clinic Stock', summary.lowClinicStock],
    ['Low Kitchen Stock', summary.lowKitchenStock],
    ['Restaurant Items', summary.restaurantInventory],
    ['Low Restaurant Stock', summary.lowRestaurantStock],
    ['Store Items', summary.organizationStoreItems],
    ['Store Orders', summary.organizationStoreOrders]
  ].filter(([, value]) => value !== undefined);
  const studentCard = summary.students === undefined ? '' : `<div class="student-summary-card"><strong>${escapeHtml(summary.students || 0)}</strong><span>Total Students</span><small><b>${escapeHtml(summary.dayStudents || 0)}</b> Day <i></i> <b>${escapeHtml(summary.boardingStudents || 0)}</b> Boarding</small></div>`;
  summaryEl.innerHTML = studentCard + items.map(([label, value]) => `<div><strong>${escapeHtml(value || 0)}</strong><span>${escapeHtml(label)}</span></div>`).join('');
}

function sumRows(rows, keys) {
  return (rows || []).reduce((total, row) => {
    const value = pick(row, keys);
    const amount = Number(String(value || 0).replace(/[₦,\s]/g, ''));
    return total + (Number.isFinite(amount) ? amount : 0);
  }, 0);
}

function renderSummaryCards(cards = []) {
  summaryEl.innerHTML = cards.filter(Boolean).map((card) => `
    <div class="module-summary-card">
      <span class="module-summary-icon" aria-hidden="true">${escapeHtml(card.icon || tabIcons[activeSection] || '•')}</span>
      <strong>${escapeHtml(card.value ?? 0)}</strong>
      <span>${escapeHtml(genericOrganizationText(card.label || ''))}</span>
      ${card.note ? `<small>${escapeHtml(genericOrganizationText(card.note))}</small>` : ''}
    </div>`).join('');
}

function executiveMetricCatalog(data = executiveOfficeData || {}) {
  const available = Array.isArray(data.availableMetrics) ? data.availableMetrics : [];
  const values = Array.isArray(data.metrics)
    ? Object.fromEntries(data.metrics.map((metric) => [clean(metric.id || metric.key), metric]))
    : (data.metrics || {});
  return available.map((entry) => {
    const definition = typeof entry === 'string' ? { id: entry, label: entry } : entry;
    const id = clean(definition.id || definition.key || definition.metricId);
    const measured = values[id];
    const measuredObject = measured && typeof measured === 'object' ? measured : {};
    return {
      ...definition,
      ...measuredObject,
      id,
      label: clean(definition.label || definition.name || measuredObject.label || id),
      value: measuredObject.value ?? measuredObject.total ?? measured ?? definition.value ?? 0,
      note: clean(measuredObject.note || definition.note || definition.description),
      icon: clean(definition.icon || measuredObject.icon || tabIcons.executiveOffice),
      format: clean(definition.format || measuredObject.format).toLowerCase(),
      series: measuredObject.series || measuredObject.points || definition.series || definition.points || []
    };
  }).filter((metric) => metric.id);
}

function executiveSelectedMetricIds(data = executiveOfficeData || {}) {
  const preference = data.metricPreferences;
  const selected = Array.isArray(preference)
    ? preference
    : (preference?.metricIds || preference?.selectedMetrics || data.selectedMetricIds || []);
  const allowed = new Set(executiveMetricCatalog(data).map((metric) => metric.id));
  const valid = (selected || []).map(clean).filter((id) => allowed.has(id));
  return valid.length ? valid : Array.from(allowed).slice(0, 4);
}

function executiveMetricDisplay(metric) {
  if (metric.format === 'currency' || metric.format === 'money') return money(metric.value);
  if (metric.format === 'percent' || metric.format === 'percentage') return `${Number(metric.value || 0).toLocaleString()}%`;
  return typeof metric.value === 'number' ? metric.value.toLocaleString() : clean(metric.value || 0);
}

function applicationOutcomeValues(row) {
  return ['Status', 'ResultStatus', 'EnrollmentStatus']
    .map((key) => clean(row?.[key]).toLowerCase())
    .filter(Boolean);
}

function applicationIsRejected(row) {
  return applicationOutcomeValues(row).some((status) => /rejected|declined|failed|not admitted/.test(status));
}

function applicationIsAdmitted(row) {
  if (applicationIsRejected(row)) return false;
  return applicationOutcomeValues(row).some((status) => /admitted|accepted|approved|enrolled/.test(status));
}

function renderModuleSummary(active, liveData = null) {
  if (active === 'overview') {
    renderSummary(dashboardData?.summary || {});
    return;
  }
  const departments = dashboardData?.departments || {};
  const icon = tabIcons[active];
  let cards = [];
  if (active === 'schoolInsights') {
    const summary = dashboardData?.summary || {};
    const loaded = Boolean(departments.schoolInsights);
    cards = loaded ? [
      { icon: '\u{1F465}', label: 'Students', value: Number(summary.students || 0).toLocaleString(), note: `${Number(summary.dayStudents || 0).toLocaleString()} day / ${Number(summary.boardingStudents || 0).toLocaleString()} boarding` },
      { icon: '\u{1F9FE}', label: 'Expected Fees', value: money(summary.totalInvoiced), note: `${Number(summary.studentAccounts || 0).toLocaleString()} student accounts` },
      { icon: '\u2713', label: 'Fees Received', value: money(summary.totalPaid), note: `${Number(summary.collectionRate || 0).toFixed(1)}% collected` },
      { icon: '\u26A0', label: 'Outstanding Fees', value: money(summary.outstandingFees), note: `${Number(summary.defaulters || 0).toLocaleString()} account(s) owing` }
    ] : [{ icon, label: 'School Insights', value: 'Loading', note: 'Preparing fee and enrolment summaries' }];
  } else if (active === 'executiveOffice' && liveData) {
    const selected = new Set(executiveSelectedMetricIds(liveData));
    cards = executiveMetricCatalog(liveData)
      .filter((metric) => selected.has(metric.id))
      .map((metric) => ({
        icon: metric.icon,
        label: metric.label,
        value: executiveMetricDisplay(metric),
        note: metric.note
      }));
    if (!cards.length) {
      const rows = liveData.correspondence || [];
      cards = [
        { icon, label: 'Correspondence', value: rows.length },
        { icon: '\u{1F4DD}', label: 'Drafts', value: rows.filter((row) => /draft/i.test(clean(row.Status || row.status))).length },
        { icon: '\u2713', label: 'Issued', value: rows.filter((row) => /issued/i.test(clean(row.Status || row.status))).length },
        { icon: '\u{1F4E4}', label: 'Sent', value: rows.filter((row) => /sent|delivered/i.test(clean(row.Status || row.status))).length }
      ];
    }
  } else if (active === 'recordsDesk') {
    const data = liveData || recordsDeskState;
    cards = [
      { icon, label: 'Record Types', value: (data.availableTypes || []).length, note: 'Allowed for this account' },
      { icon: '\u{1F50D}', label: 'Matches', value: data.totalMatches || 0, note: clean(data.query) ? `Search: ${clean(data.query)}` : 'Enter three or more characters' },
      { icon: '\u2713', label: 'Selected', value: data.detail ? 1 : 0, note: data.detail?.title || 'No record selected' },
      { icon: '\u{1F6E1}', label: 'Scope', value: currentUser?.branchId || 'All', note: currentUser?.schoolSectionAccess || currentUser?.edition || 'Current organisation' }
    ];
  } else if (active === 'admissions') {
    const rows = departments.admissions || [];
    cards = [
      { icon, label: 'Applications', value: rows.length },
      { icon: '\u2713', label: 'Admitted', value: rows.filter(applicationIsAdmitted).length },
      { icon: '\u231B', label: 'Pending', value: rows.filter((row) => !applicationIsAdmitted(row) && !applicationIsRejected(row)).length },
      { icon: '\u{1F4CE}', label: 'With Documents', value: rows.filter((row) => admissionDocuments.some(([key]) => uploadedDocument(row, key))).length }
    ];
  } else if (active === 'formPurchases') {
    const rows = departments.formPurchases || [];
    cards = [
      { icon, label: 'Purchases', value: rows.length },
      { icon: '\u20A6', label: 'Revenue', value: money(sumRows(rows, ['AmountPaid', 'Amount'])) },
      { icon: '\u{1F465}', label: 'Applicants', value: new Set(rows.map((row) => clean(pick(row, ['Email', 'ApplicantName']))).filter(Boolean)).size },
      { icon: '\u{1F4DA}', label: 'Classes', value: new Set(rows.map((row) => clean(pick(row, ['ClassApplyingFor']))).filter(Boolean)).size }
    ];
  } else if (active === 'students') {
    const rows = departments.students || [];
    cards = [
      { icon, label: 'Students', value: rows.length },
      { icon: '\u2713', label: 'Active', value: rows.filter((row) => !/inactive|withdrawn|disabled/i.test(clean(pick(row, ['Status'])))).length },
      { icon: '\u2600', label: 'Day Students', value: rows.filter((row) => /day/i.test(clean(pick(row, ['StudentType'])))).length },
      { icon: '\u2302', label: 'Boarding', value: rows.filter((row) => /board/i.test(clean(pick(row, ['StudentType'])))).length }
    ];
  } else if (active === 'accounts') {
    const data = departments.accounts || {};
    cards = [
      { icon, label: 'Payments', value: (data.payments || []).length },
      { icon: '\u20A6', label: 'Collections', value: money(sumRows(data.payments, ['Amount'])) },
      { icon: '\u{1F9FE}', label: 'Invoices', value: (data.invoices || []).length },
      { icon: '\u{1F4CA}', label: 'Invoice Value', value: money(sumRows(data.invoices, ['Debit', 'Amount'])) }
    ];
  } else if (active === 'incomeAnalytics' && liveData) {
    const summary = liveData.summary || {};
    const comparison = Number(summary.comparisonPercent || 0);
    cards = [
      { icon, label: 'Total Income', value: money(summary.totalIncome), note: `${liveData.period?.dateFrom || ''} to ${liveData.period?.dateTo || ''}` },
      { icon: '\u{1F9FE}', label: 'Transactions', value: summary.transactionCount || 0, note: 'Posted income records' },
      { icon: '\u00F7', label: 'Average Income', value: money(summary.averageIncome), note: 'Per transaction' },
      { icon: comparison >= 0 ? '\u2191' : '\u2193', label: 'Previous Period', value: `${comparison >= 0 ? '+' : ''}${comparison.toFixed(1)}%`, note: money(summary.previousTotal) }
    ];
  } else if (active === 'clinic') {
    const data = liveData || departments.clinic || {};
    cards = [
      { icon, label: 'Clinic Records', value: (data.records || []).length },
      { icon: '\u{1F48A}', label: 'Inventory Items', value: (data.inventory || []).length },
      { icon: '\u26A0', label: 'Low Stock', value: (data.lowStock || []).length }
    ];
  } else if (active === 'kitchen' || active === 'restaurant') {
    const data = liveData || departments[active] || {};
    const commerce = active === 'restaurant' ? commerceSalesSummary(data.sales || []) : null;
    cards = active === 'restaurant' ? [
      { icon, label: 'Today Sales', value: money(commerce.todayAmount), note: `${commerce.todayTransactions} transaction(s)` },
      { icon: '\u{1F9FE}', label: 'Paid Sales', value: commerce.paid },
      { icon: '\u231B', label: 'Pending Online', value: commerce.pending },
      { icon: '\u26A0', label: 'Low Stock', value: (data.lowStock || []).length }
    ] : [
      { icon, label: 'Inventory Items', value: (data.inventory || []).length },
      { icon: '\u{1F4E6}', label: 'Units in Stock', value: sumRows(data.inventory, ['Quantity']) },
      { icon: '\u26A0', label: 'Low Stock', value: (data.lowStock || []).length }
    ];
  } else if (active === 'tuckShop') {
    const data = liveData || departments.tuckShop || {};
    const rows = data.purchases || [];
    cards = [
      { icon, label: 'Purchases', value: rows.length },
      { icon: '\u20A6', label: 'Sales Value', value: money(sumRows(rows, ['Debit', 'Amount'])) },
      { icon: '\u{1F4E6}', label: 'Inventory Items', value: (data.inventory || []).length },
      { icon: '\u26A0', label: 'Low Stock', value: (data.lowStock || []).length }
    ];
  } else if ((active === 'bookstore' || active === 'uniformStore' || active === 'organizationStore') && liveData) {
    const items = liveData.items || [];
    const orders = liveData.orders || [];
    const commerce = active === 'organizationStore' ? commerceSalesSummary(liveData.sales || []) : null;
    cards = active === 'organizationStore' ? [
      { icon, label: 'Today Sales', value: money(commerce.todayAmount), note: `${commerce.todayTransactions} transaction(s)` },
      { icon: '\u{1F9FE}', label: 'Paid Sales', value: commerce.paid },
      { icon: '\u231B', label: 'Pending Online', value: commerce.pending },
      { icon: '\u{1F4E6}', label: 'Units in Stock', value: sumRows(items, ['Quantity']) }
    ] : [
      { icon, label: 'Store Items', value: items.length },
      { icon: '\u2713', label: 'Available Items', value: items.filter((row) => clean(row.Active || 'YES') !== 'NO').length },
      { icon: '\u{1F4E6}', label: 'Units in Stock', value: sumRows(items, ['Quantity']) },
      { icon: '\u{1F6D2}', label: 'Paid Orders', value: orders.length }
    ];
  } else if (active === 'members' && liveData) {
    cards = [
      { icon, label: 'Members', value: (liveData.members || []).length },
      { icon: '\u2302', label: 'Households', value: (liveData.households || []).length },
      { icon: '\u2713', label: 'Active Members', value: (liveData.members || []).filter((row) => !/inactive|former/i.test(clean(row.MembershipStatus))).length }
    ];
  } else if (active === 'services' && liveData) {
    cards = [
      { icon, label: 'Services', value: (liveData.services || []).length },
      { icon: '\u{1F4C5}', label: 'Occurrences', value: (liveData.occurrences || []).length },
      { icon: '\u2713', label: 'Check-ins', value: (liveData.attendance || []).length },
      { icon: '\u{1F464}', label: 'Visitors', value: (liveData.attendance || []).filter((row) => /visitor/i.test(clean(row.AttendanceType))).length }
    ];
  } else if (active === 'funds' && liveData) {
    cards = [
      { icon, label: 'Funds', value: (liveData.funds || []).length },
      { icon: '\u2713', label: 'Active Funds', value: (liveData.funds || []).filter((row) => !/no|false|inactive/i.test(clean(row.Active || 'YES'))).length },
      { icon: '\u{1F517}', label: 'Mappings', value: (liveData.mappings || []).length },
      { icon: '\u{1F4DD}', label: 'Audit Entries', value: (liveData.audit || []).length }
    ];
  } else if (active === 'donations' && liveData) {
    const rows = liveData.donations || [];
    cards = [
      { icon, label: 'Donations', value: rows.length },
      { icon: '\u20A6', label: 'Total Value', value: money(sumRows(rows, ['Amount', 'Total'])) },
      { icon: '\u{1F465}', label: 'Donors', value: new Set(rows.map((row) => clean(pick(row, ['DonorId', 'DonorName', 'Email']))).filter(Boolean)).size },
      { icon: '\u{1F4DD}', label: 'Audit Entries', value: (liveData.audit || []).length }
    ];
  } else if (active === 'offerings' && liveData) {
    const rows = liveData.offerings || [];
    cards = [
      { icon, label: 'Offering Batches', value: rows.length },
      { icon: '\u20A6', label: 'Total Value', value: money(sumRows(rows, ['TotalAmount', 'Amount'])) },
      { icon: '\u231B', label: 'Awaiting Approval', value: rows.filter((row) => /submitted|pending/i.test(clean(row.Status))).length },
      { icon: '\u2713', label: 'Posted', value: rows.filter((row) => /posted|approved/i.test(clean(row.Status))).length }
    ];
  } else if (active === 'financeRequests' && liveData) {
    const rows = [...(liveData.requisitions || []), ...(liveData.bills || [])];
    cards = [
      { icon, label: 'Documents', value: rows.length },
      { icon: '\u231B', label: 'Awaiting Approval', value: rows.filter((row) => /submitted|pending/i.test(clean(row.Status))).length },
      { icon: '\u2713', label: 'Approved', value: rows.filter((row) => /approved|posted/i.test(clean(row.Status))).length },
      { icon: '\u20A6', label: 'Total Value', value: money(sumRows(rows, ['Amount', 'Total'])) }
    ];
  } else if (active === 'payroll' && liveData) {
    const rows = liveData.items || liveData;
    cards = [
      { icon, label: 'Payroll Periods', value: rows.length },
      { icon: '\u20A6', label: 'Net Pay', value: money(sumRows(rows, ['NetPay'])) },
      { icon: '\u2713', label: 'Paid', value: money(sumRows(rows, ['PaidAmount'])) },
      { icon: '\u231B', label: 'Outstanding', value: money(sumRows(rows, ['OutstandingAmount'])) }
    ];
  } else if (active === 'humanResources' && liveData) {
    const leave = liveData.leave || [];
    const vacancies = liveData.vacancies || [];
    cards = [
      { icon, label: 'Staff', value: (liveData.directory || []).length },
      { icon: '\u{1F334}', label: 'Pending Leave', value: leave.filter((row) => /pending/i.test(clean(row.Status))).length },
      { icon: '\u{1F4CB}', label: 'Open Vacancies', value: vacancies.filter((row) => /open/i.test(clean(row.Status))).length },
      { icon: '\u2696', label: 'Open Staff Cases', value: (liveData.employeeCases || []).filter((row) => !/resolved|closed/i.test(clean(row.Status))).length },
      { icon: '\u{1F6E1}', label: 'Compliance Actions', value: (liveData.compliance || []).filter((row) => /action required|overdue/i.test(clean(row.Status))).length }
    ];
  } else if (active === 'securityAudit' && liveData) {
    const rows = liveData.rows || [];
    cards = [
      { icon, label: 'Recorded actions', value: rows.length },
      { icon: '\u2713', label: 'Successful', value: rows.filter((row) => clean(row.Outcome) === 'Success').length },
      { icon: '\u26D4', label: 'Denied / failed', value: rows.filter((row) => /denied|failed/i.test(clean(row.Outcome))).length },
      { icon: '\u{1F465}', label: 'Users', value: new Set(rows.map((row) => clean(row.ActorUsername || row.Actor)).filter(Boolean)).size }
    ];
  } else if (active === 'dataBackup') {
    cards = [
      { icon, label: 'Coverage', value: 'All records' },
      { icon: '\u{1F512}', label: 'Protection', value: 'Encrypted' },
      { icon: '\u21BA', label: 'Restore mode', value: 'Point in time' },
      { icon: '\u{1F6E1}', label: 'Access', value: 'Super Admin' }
    ];
  } else if (active === 'staffUsers' && liveData) {
    const rows = liveData.users || liveData;
    cards = [
      { icon, label: 'Staff Accounts', value: rows.length },
      { icon: '\u2713', label: 'Active', value: rows.filter((row) => yes(row.Active)).length },
      { icon: '\u{1F6E1}', label: 'Administrators', value: rows.filter((row) => row.Role === 'Super Admin' && yes(row.Active)).length },
      { icon: '\u26A0', label: 'Disabled', value: rows.filter((row) => !yes(row.Active)).length }
    ];
  }
  if (!cards.length) cards = [{ icon, label: tabConfig.find(([key]) => key === active)?.[1] || 'Module', value: 'Loading' }];
  renderSummaryCards(cards);
}

function renderTabs(allowed) {
  const allowedSet = new Set(allowed || []);
  const restrictedSet = new Set(
    dashboardData?.restrictedSections || currentUser?.restrictedSections || []
  );
  const editionTabs = webTabsForEdition();
  const insightAllowed = schoolInsightsAvailable(allowed, currentUser || {});
  const insightRestricted = resolveDashboardEdition(currentUser || {}) === 'school'
    && !insightAllowed
    && restrictedSet.has('accounts');
  const tabs = [
    ['overview', 'Dashboard'],
    ...(insightAllowed ? [['schoolInsights', 'School Insights']] : []),
    ...editionTabs.filter(([key]) => allowedSet.has(key))
  ];
  const visibleTabs = [
    ['overview', 'Dashboard', false],
    ...(insightAllowed || insightRestricted ? [['schoolInsights', 'School Insights', insightRestricted]] : []),
    ...editionTabs
      .filter(([key]) => allowedSet.has(key) || restrictedSet.has(key))
      .map(([key, label]) => [key, label, restrictedSet.has(key) && !allowedSet.has(key)])
  ];
  const plan = clean(dashboardData?.subscriptionPlan || currentUser?.subscriptionPlan || 'current');
  const subscriptionInactive = dashboardData?.subscriptionActive === false || currentUser?.subscriptionActive === false;
  activeTabs = tabs;
  tabsEl.innerHTML = visibleTabs.map(([key, label, restricted]) => {
    label = staffTabLabel(key, label);
    const selected = key === activeSection ? ' selected' : '';
    const locked = restricted ? ' subscription-restricted' : '';
    const disabled = restricted ? ' disabled aria-disabled="true"' : '';
    const title = restricted
      ? ` title="${escapeHtml(subscriptionInactive
        ? `${label} is locked because the subscription is not active.`
        : `${label} is not included in the ${plan} plan. Upgrade the subscription to activate it.`)}"`
      : '';
    const icon = restricted ? '\u{1F512}' : (tabIcons[key] || '•');
    return `<button type="button" class="child-card${selected}${locked}" data-tab="${escapeHtml(key)}" aria-selected="${key === activeSection}"${disabled}${title}><span class="staff-tab-icon" aria-hidden="true">${escapeHtml(icon)}</span><span>${escapeHtml(label)}</span>${restricted ? `<small>${subscriptionInactive ? 'Trial ended' : 'Upgrade plan'}</small>` : ''}</button>`;
  }).join('');
  tabsEl.querySelectorAll('[data-tab]:not(:disabled)').forEach((button) => {
    button.addEventListener('click', () => selectSection(button.dataset.tab, tabs.map(([key]) => key)));
  });
  renderMobileNavigation(tabs, visibleTabs);
}

function renderWorkspace(active) {
  const overview = active === 'overview';
  welcomeEl.hidden = !overview;
  dashboardStatus.hidden = !overview;
  panelEl.hidden = overview;
  staffMainContent.classList.toggle('module-view-active', !overview);
  renderModuleSummary(active);
  setDashboardClockActive(overview);
  renderDashboardCharts(dashboardData?.charts || {});
}

function selectSection(key, allowed = activeTabs.map(([tabKey]) => tabKey)) {
  if (!allowed.includes(key)) return;
  activeSection = key;
  const url = new URL(window.location.href);
  url.searchParams.set('section', key);
  let savedView = '';
  try { savedView = clean(window.localStorage.getItem(workspaceViewStorageKey(key))); } catch (_error) { /* optional */ }
  if (savedView) url.searchParams.set('view', savedView);
  else url.searchParams.delete('view');
  window.history.replaceState(window.history.state, '', url);
  renderTabs(allowed);
  renderWorkspace(activeSection);
  renderSection(activeSection);
  scheduleGenericOrganizationVocabulary();
  setSidebarOpen(false);
  if (moduleDialog.open) moduleDialog.close();
  (activeSection === 'overview' ? staffMainContent : panelEl).scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderMobileNavigation(tabs, visibleTabs = tabs.map(([key, label]) => [key, label, false])) {
  if (!tabs.length) {
    mobileNav.innerHTML = '';
    moduleGrid.innerHTML = '';
    return;
  }
  const findTab = (...keys) => tabs.find(([key]) => keys.includes(key));
  const homeTab = findTab('overview') || tabs[0];
  const peopleTab = findTab('recordsDesk', 'humanResources', 'members', 'students', 'services', 'admissions') || homeTab;
  const financeTab = findTab('incomeAnalytics', 'accounts', 'donations', 'offerings', 'funds', 'financeRequests') || homeTab;
  const items = [
    [homeTab[0], tabIcons.overview, 'Home'],
    [peopleTab[0], tabIcons[peopleTab[0]] || '\u{1F465}', peopleTab[0] === 'members' ? 'Members' : 'People'],
    ['__modules__', '▦', 'Modules'],
    [financeTab[0], tabIcons[financeTab[0]] || '\u20A6', 'Finance'],
    ['__more__', '☰', 'More']
  ];
  mobileNav.innerHTML = items.map(([key, icon, label]) => {
    const selected = key === activeSection ? ' selected' : '';
    const central = key === '__modules__' ? ' mobile-nav-centre' : '';
    return `<button type="button" class="${selected}${central}" data-mobile-tab="${escapeHtml(key)}" aria-label="${escapeHtml(label)}"><span>${escapeHtml(icon)}</span><small>${escapeHtml(label)}</small></button>`;
  }).join('');
  moduleGrid.innerHTML = visibleTabs.map(([key, label, restricted], index) => {
    const locked = restricted ? ' subscription-restricted' : '';
    const disabled = restricted ? ' disabled aria-disabled="true"' : '';
    const icon = restricted ? '\u{1F512}' : (tabIcons[key] || '•');
    return `<button type="button" data-module="${escapeHtml(key)}" class="module-tone-${index % 6}${key === activeSection ? ' selected' : ''}${locked}"${disabled}><span>${escapeHtml(icon)}</span><strong>${escapeHtml(staffTabLabel(key, label))}</strong>${restricted ? '<em>Upgrade plan</em>' : ''}</button>`;
  }).join('');
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

function workspaceViewStorageKey(section) {
  return `dynamax:workspace-view:${clean(section)}`;
}

function savedWorkspaceView(section, available = []) {
  const keys = available.map((tab) => clean(tab.key)).filter(Boolean);
  const params = new URLSearchParams(window.location.search);
  const urlView = params.get('section') === section ? clean(params.get('view')) : '';
  if (keys.includes(urlView)) return urlView;
  try {
    const stored = clean(window.localStorage.getItem(workspaceViewStorageKey(section)));
    if (keys.includes(stored)) return stored;
  } catch (_error) {
    // Storage is optional. URL state remains the primary navigation source.
  }
  return keys[0] || '';
}

function normalizeWorkspaceNodes(nodes = []) {
  const values = Array.isArray(nodes) ? nodes.flat(Infinity) : [nodes];
  return values.filter((node, index, all) => node instanceof Node && all.indexOf(node) === index);
}

function workspaceTableNodes(title, root = panelEl) {
  const heading = [...root.querySelectorAll(':scope > h2')]
    .find((node) => clean(node.textContent).toLowerCase() === clean(title).toLowerCase());
  if (!heading) return [];
  const wrap = heading.nextElementSibling?.classList.contains('admin-table-wrap') ? heading.nextElementSibling : null;
  return [heading, wrap].filter(Boolean);
}

function mountWorkspaceTabs(section, tabs = [], options = {}) {
  const host = options.host || panelEl;
  host.querySelector(':scope > .module-workspace-shell')?.remove();
  const usable = tabs.map((tab) => ({
    ...tab,
    key: clean(tab.key),
    label: clean(tab.label),
    nodes: normalizeWorkspaceNodes(tab.nodes)
  })).filter((tab) => tab.key && tab.label && tab.nodes.length);
  if (!usable.length) return null;

  const activeView = savedWorkspaceView(section, usable);
  const shell = document.createElement('section');
  shell.className = 'module-workspace-shell';
  shell.dataset.workspaceSection = section;
  const nav = document.createElement('nav');
  nav.className = 'module-workspace-tabs';
  nav.setAttribute('aria-label', `${section} workspaces`);
  const panels = document.createElement('div');
  panels.className = 'module-workspace-panels';

  usable.forEach((tab) => {
    const panelId = `workspace-${section}-${tab.key}`.replace(/[^a-z0-9_-]/gi, '-');
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.workspaceView = tab.key;
    button.setAttribute('aria-controls', panelId);
    button.innerHTML = `${tab.icon ? `<span aria-hidden="true">${escapeHtml(tab.icon)}</span>` : ''}<strong>${escapeHtml(tab.label)}</strong>${tab.count === undefined ? '' : `<small>${escapeHtml(tab.count)}</small>`}`;
    nav.append(button);

    const panel = document.createElement('section');
    panel.className = 'module-workspace-panel';
    panel.id = panelId;
    panel.dataset.workspacePanel = tab.key;
    panel.setAttribute('role', 'tabpanel');
    tab.nodes.forEach((node) => panel.append(node));
    panels.append(panel);
  });
  shell.append(nav, panels);
  const anchor = options.after instanceof Node ? options.after : host.querySelector(':scope > .workflow-intro');
  if (anchor?.parentNode === host) anchor.after(shell);
  else host.append(shell);

  const activate = (view, updateUrl = true) => {
    const selected = usable.some((tab) => tab.key === view) ? view : usable[0].key;
    nav.querySelectorAll('[data-workspace-view]').forEach((button) => {
      const current = button.dataset.workspaceView === selected;
      button.classList.toggle('selected', current);
      button.setAttribute('aria-selected', String(current));
      button.tabIndex = current ? 0 : -1;
    });
    panels.querySelectorAll('[data-workspace-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.workspacePanel !== selected;
    });
    try { window.localStorage.setItem(workspaceViewStorageKey(section), selected); } catch (_error) { /* optional */ }
    if (updateUrl) {
      const url = new URL(window.location.href);
      url.searchParams.set('section', section);
      url.searchParams.set('view', selected);
      window.history.replaceState(window.history.state, '', url);
    }
    nav.querySelector(`[data-workspace-view="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  nav.addEventListener('click', (event) => {
    const button = event.target.closest('[data-workspace-view]');
    if (!button) return;
    activate(button.dataset.workspaceView);
  });
  nav.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...nav.querySelectorAll('[data-workspace-view]')];
    const current = Math.max(0, buttons.indexOf(document.activeElement));
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault();
    buttons[next].focus();
    activate(buttons[next].dataset.workspaceView);
  });
  activate(activeView, false);
  return { shell, nav, panels, activate };
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
      const response = await staffFetch('/api/staff-students', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
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
  const scopePath = clean(row.__scopePath);
  const uploaded = admissionDocuments.map(([key, label]) => {
    const item = uploadedDocument(row, key);
    return item ? { ...item, label } : null;
  }).filter(Boolean);
  if (!uploaded.length) return '<span class="muted">None uploaded</span>';
  const links = uploaded.map((item) => {
    const query = `applicationReference=${encodeURIComponent(reference)}&documentType=${encodeURIComponent(item.key)}&scopePath=${encodeURIComponent(scopePath)}`;
    const canDelete = ['Super Admin', 'Admissions Officer'].includes(clean(currentUser?.role));
    const fileName = item.fileName || `${reference}-${item.key}`;
    return `<div class="document-action-row"><span>${escapeHtml(item.label)}</span><button type="button" class="payslip-download document-file-action" data-protected-file="${escapeHtml(`/api/staff-document?${query}&mode=view`)}" data-file-mode="view" data-file-name="${escapeHtml(fileName)}">View</button><button type="button" class="payslip-download document-file-action" data-protected-file="${escapeHtml(`/api/staff-document?${query}&mode=download`)}" data-file-mode="download" data-file-name="${escapeHtml(fileName)}">Download</button>${canDelete ? `<button type="button" class="document-delete compact-icon-action compact-delete-action" data-delete-document="${escapeHtml(item.key)}" data-application-reference="${escapeHtml(reference)}" data-application-scope="${escapeHtml(scopePath)}" aria-label="Delete ${escapeHtml(item.label)}" title="Delete document"><span aria-hidden="true">&#128465;&#65038;</span></button>` : ''}</div>`;
  }).join('');
  return `<details class="document-actions"><summary>${uploaded.length} document${uploaded.length === 1 ? '' : 's'}</summary>${links}</details>`;
}

function protectedFileName(response, fallback = 'document') {
  const disposition = clean(response.headers.get('Content-Disposition'));
  const encodedMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const quotedMatch = disposition.match(/filename="([^"]+)"/i);
  const plainMatch = disposition.match(/filename=([^;]+)/i);
  let fileName = encodedMatch?.[1] || quotedMatch?.[1] || plainMatch?.[1] || fallback;
  if (encodedMatch) {
    try {
      fileName = decodeURIComponent(fileName);
    } catch (_error) {
      fileName = fallback;
    }
  }
  return clean(fileName).replace(/[\\/:*?"<>|]+/g, '_') || 'document';
}

async function openProtectedFile(button) {
  const resourceUrl = clean(button.dataset.protectedFile);
  const mode = clean(button.dataset.fileMode) || 'download';
  if (!resourceUrl) return;
  let viewer = null;
  if (mode === 'view') {
    viewer = window.open('about:blank', '_blank');
    if (!viewer) {
      setStatus(dashboardStatus, 'Allow pop-ups for this site to view the document.', 'bad');
      return;
    }
    viewer.opener = null;
  }
  const normalMarkup = button.innerHTML;
  setButtonLoading(button, true, mode === 'view' ? 'Opening...' : 'Downloading...', normalMarkup);
  try {
    const response = await staffFetch(resourceUrl, {
      credentials: 'same-origin',
      cache: 'no-store'
    });
    if (response.status === 401) {
      const data = await response.json().catch(() => ({}));
      if (viewer) viewer.close();
      showLogin(data.message || 'Your staff session has expired. Please sign in again.', 'bad');
      return;
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || 'The requested file could not be opened.');
    }
    const fileName = protectedFileName(response, clean(button.dataset.fileName) || 'document');
    const objectUrl = URL.createObjectURL(await response.blob());
    if (mode === 'view') {
      viewer.location.replace(objectUrl);
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 5 * 60 * 1000);
      viewer = null;
    } else {
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    }
  } catch (error) {
    if (viewer) viewer.close();
    setStatus(dashboardStatus, error.message || String(error), 'bad');
  } finally {
    setButtonLoading(button, false, '', normalMarkup);
    button.innerHTML = normalMarkup;
  }
}

function bindProtectedFileEvents(container = panelEl) {
  container.querySelectorAll('[data-protected-file]').forEach((button) => {
    button.addEventListener('click', () => openProtectedFile(button));
  });
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

function commerceNumber(value) {
  const amount = Number(String(value ?? 0).replace(/[^\d.-]/g, ''));
  return Number.isFinite(amount) ? amount : 0;
}

function commerceInventory(section, data = {}) {
  return section === 'organizationStore' ? (data.items || []) : (data.inventory || []);
}

function commerceItemReference(section, item = {}) {
  return clean(section === 'organizationStore'
    ? (item.ItemCode || item.__id)
    : (item.ItemName || item.__id));
}

function commerceItemPrice(item = {}) {
  return commerceNumber(item.Price ?? item.SalePrice);
}

function commerceItemStock(item = {}) {
  return Math.max(0, Math.floor(commerceNumber(item.Quantity)));
}

function commerceCart(section) {
  return organizationCommerceCarts[section] || new Map();
}

function commerceQuantityOptions(maximum, selected = 1) {
  const max = Math.max(1, Math.min(100, Math.floor(maximum || 1)));
  const selectedQuantity = Math.max(1, Math.min(max, Math.floor(selected || 1)));
  return Array.from({ length: max }, (_, index) => index + 1)
    .map((quantity) => `<option value="${quantity}" ${quantity === selectedQuantity ? 'selected' : ''}>${quantity}</option>`)
    .join('');
}

function syncCommerceCart(section, inventory = []) {
  const cart = commerceCart(section);
  const availableByReference = new Map(inventory.map((item) => [commerceItemReference(section, item), item]));
  [...cart.entries()].forEach(([reference, entry]) => {
    const current = availableByReference.get(reference);
    if (!current || commerceItemStock(current) < 1 || commerceItemPrice(current) <= 0 || clean(current.Active || 'YES').toUpperCase() === 'NO') {
      cart.delete(reference);
      return;
    }
    entry.item = current;
    entry.quantity = Math.min(Math.max(1, entry.quantity), commerceItemStock(current));
  });
}

function commerceSalesSummary(sales = []) {
  const today = new Date().toISOString().slice(0, 10);
  const paid = sales.filter((sale) => clean(sale.PaymentStatus || sale.Status).toLowerCase() === 'paid');
  const todayPaid = paid.filter((sale) => clean(sale.PaidAt || sale.SaleDate || sale.CreatedAt).slice(0, 10) === today);
  return {
    todayTransactions: todayPaid.length,
    todayAmount: todayPaid.reduce((sum, sale) => sum + commerceNumber(sale.Amount || sale.GrossAmount), 0),
    paid: paid.length,
    pending: sales.filter((sale) => /pending/i.test(clean(sale.PaymentStatus || sale.Status))).length
  };
}

function commerceSaleStatus(sale = {}) {
  const status = clean(sale.PaymentStatus || sale.Status || 'Pending');
  return `<span class="commerce-sale-status ${status.toLowerCase() === 'paid' ? 'is-paid' : 'is-pending'}">${escapeHtml(status)}</span>`;
}

function commerceReceiptPreview(sale = {}) {
  const items = Array.isArray(sale.Items) ? sale.Items : [];
  const paid = clean(sale.PaymentStatus || sale.Status).toLowerCase() === 'paid';
  const paymentUrl = clean(sale.AuthorizationUrl);
  return `
    <aside class="commerce-receipt-preview" aria-live="polite">
      <div><small>${paid ? 'Payment recorded' : 'Payment link sent'}</small><strong>${escapeHtml(sale.SaleNo || 'Sale')}</strong><span>${escapeHtml(sale.CustomerName || 'Walk-in customer')} &middot; ${money(sale.Amount || sale.GrossAmount)}${!paid && sale.CustomerEmail ? ` &middot; ${escapeHtml(sale.CustomerEmail)}` : ''}</span></div>
      <div class="inline-action-group">
        ${paid ? `<button type="button" class="compact-icon-action" data-commerce-print="${escapeHtml(sale.SaleNo || '')}" title="Choose receipt format" aria-label="Choose receipt format">&#128424;</button>` : ''}
        ${!paid && /^https:\/\/[A-Za-z0-9.-]+(?:\/|$)/.test(paymentUrl) ? `<button type="button" class="compact-icon-action" data-commerce-open-payment="${escapeHtml(paymentUrl)}" title="Open secure payment page" aria-label="Open secure payment page">&#8599;</button>` : ''}
      </div>
      ${items.length ? `<small>${escapeHtml(items.map((item) => `${item.ItemName} x ${item.Quantity}`).join(', '))}</small>` : ''}
    </aside>`;
}

function showOrganizationStoreQr(data = {}, qrWindow = null) {
  const viewer = qrWindow || window.open('', '_blank', 'width=620,height=780');
  if (!viewer) {
    setStatus(dashboardStatus, 'Allow pop-ups to view and print the public store QR code.', 'bad');
    return;
  }
  viewer.opener = null;
  const organisation = clean(document.querySelector('[data-school-name]')?.textContent || staffBrand?.textContent) || 'Dynamax';
  viewer.document.open();
  viewer.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(organisation)} store QR</title><style>
    @page{size:A5;margin:12mm}*{box-sizing:border-box}body{margin:0;background:#edf3f8;color:#17314b;font:15px/1.5 Arial,sans-serif}.sheet{max-width:540px;margin:24px auto;padding:28px;border-top:7px solid #0b8f76;border-radius:16px;background:#fff;box-shadow:0 14px 35px #173b5820;text-align:center}.eyebrow{margin:0;color:#087d68;font-size:12px;font-weight:bold;letter-spacing:1.3px;text-transform:uppercase}h1{margin:5px 0 4px;color:#164a78;font-size:25px}.subtitle{margin:0 0 18px;color:#36536e}.qr{width:min(330px,90%);margin:0 auto;padding:12px;border:1px solid #cbd9e7;border-radius:14px;background:#fff}.qr svg{display:block;width:100%;height:auto}.instruction{margin:18px auto 8px;max-width:390px}.actions{display:flex;justify-content:center;gap:8px;margin-top:20px}.actions button,.actions a{display:inline-flex;align-items:center;width:fit-content;min-height:40px;padding:8px 14px;border:0;border-radius:8px;background:#1769e0;color:#fff;font-weight:bold;text-decoration:none;cursor:pointer}.actions a{background:#087d68}@media print{body{background:#fff}.sheet{margin:0;box-shadow:none}.actions{display:none}}</style></head><body><main class="sheet"><p class="eyebrow">Reusable self-service store</p><h1>${escapeHtml(organisation)}</h1><p class="subtitle">Organisation Store</p><div class="qr">${data.qrSvg || ''}</div><p class="instruction">Scan this reusable code to browse available items, build an order and pay securely online.</p><div class="actions"><button type="button" onclick="window.print()">Print QR</button><a href="${escapeHtml(data.storeUrl || data.paymentLink)}" target="_blank" rel="noopener">Open store</a></div></main></body></html>`);
  viewer.document.close();
}

function showAdmissionFormPurchaseQr(data = {}, qrWindow = null) {
  const viewer = qrWindow || window.open('', '_blank', 'width=620,height=780');
  if (!viewer) {
    setStatus(dashboardStatus, 'Allow pop-ups to view and print the admission form purchase QR code.', 'bad');
    return;
  }
  viewer.opener = null;
  const organisation = clean(document.querySelector('[data-school-name]')?.textContent || staffBrand?.textContent) || 'Dynamax School';
  const purchaseUrl = clean(data.purchaseUrl || data.paymentLink);
  viewer.document.open();
  viewer.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(organisation)} admission form QR</title><style>
    @page{size:A5;margin:12mm}*{box-sizing:border-box}body{margin:0;background:#edf3f8;color:#17314b;font:15px/1.5 Arial,sans-serif}.sheet{max-width:540px;margin:24px auto;padding:28px;border-top:7px solid #1769e0;border-radius:16px;background:#fff;box-shadow:0 14px 35px #173b5820;text-align:center}.eyebrow{margin:0;color:#087d68;font-size:12px;font-weight:bold;letter-spacing:1.3px;text-transform:uppercase}h1{margin:5px 0 4px;color:#164a78;font-size:25px}.subtitle{margin:0 0 18px;color:#36536e}.qr{width:min(330px,90%);margin:0 auto;padding:12px;border:1px solid #cbd9e7;border-radius:14px;background:#fff}.qr svg{display:block;width:100%;height:auto}.instruction{margin:18px auto 8px;max-width:410px}.actions{display:flex;justify-content:center;gap:8px;margin-top:20px}.actions button,.actions a{display:inline-flex;align-items:center;width:fit-content;min-height:40px;padding:8px 14px;border:0;border-radius:8px;background:#1769e0;color:#fff;font-weight:bold;text-decoration:none;cursor:pointer}.actions a{background:#087d68}@media print{body{background:#fff}.sheet{margin:0;box-shadow:none}.actions{display:none}}</style></head><body><main class="sheet"><p class="eyebrow">Reusable applicant self-service</p><h1>${escapeHtml(organisation)}</h1><p class="subtitle">Admission Form Purchase</p><div class="qr">${data.qrSvg || ''}</div><p class="instruction">Scan this reusable code to enter the applicant's details, choose a class and purchase the admission form securely online.</p><div class="actions"><button type="button" onclick="window.print()">Print QR</button><a href="${escapeHtml(purchaseUrl)}" target="_blank" rel="noopener">Open purchase form</a></div></main></body></html>`);
  viewer.document.close();
}

function directTransferContextLabel(context = '') {
  return ({
    'admission-form': 'Admission form',
    'school-payment': 'School payment',
    'church-donation': 'Donation',
    'organization-store': 'Store purchase'
  })[clean(context)] || 'Payment';
}

function directTransferAmount(row = {}) {
  const currency = clean(row.Currency || 'NGN').toUpperCase();
  try {
    return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(row.Amount || 0));
  } catch (_) {
    return `${currency} ${Number(row.Amount || 0).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
  }
}

function directTransferVerificationWorkspace(id, title = 'Pending direct bank transfers') {
  return `<section class="workflow-list-section direct-transfer-verification" id="${escapeHtml(id)}">
    <div class="workflow-heading"><div><small>Manual bank verification</small><h2>${escapeHtml(title)}</h2><p class="muted">Approve only after confirming the credit in the organisation bank account. Final records and receipts are created after approval.</p></div></div>
    <p class="muted" data-direct-transfer-loading>Loading pending transfers...</p>
    <p class="status" data-direct-transfer-status role="status"></p>
    <div class="workflow-record-list" data-direct-transfer-list></div>
  </section>`;
}

async function refreshDirectTransferModule(contexts = []) {
  if (contexts.includes('church-donation') && activeSection === 'donations') return loadChurchDonations();
  if (contexts.includes('organization-store') && activeSection === 'organizationStore') return loadStaffStore('organizationStore');
  if (contexts.includes('admission-form') && activeSection === 'formPurchases') {
    return loadDashboard({ mode: 'section', section: 'formPurchases', merge: true });
  }
  if (contexts.includes('school-payment') && activeSection === 'accounts') {
    return loadDashboard({ mode: 'section', section: 'accounts', merge: true });
  }
  return null;
}

async function loadDirectTransferVerification(contexts = [], workspaceId = '') {
  const workspace = document.getElementById(workspaceId);
  if (!workspace) return;
  const loading = workspace.querySelector('[data-direct-transfer-loading]');
  const status = workspace.querySelector('[data-direct-transfer-status]');
  const list = workspace.querySelector('[data-direct-transfer-list]');
  try {
    const response = await staffFetch('/api/staff-direct-transfers', {
      credentials: 'same-origin', cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.message || 'Could not load pending bank transfers.');
    if (!workspace.isConnected) return;
    const permitted = new Set(contexts.map(clean));
    const transfers = (data.transfers || []).filter((row) => permitted.has(clean(row.Context)));
    loading.hidden = true;
    list.innerHTML = transfers.length ? transfers.map((row) => {
      const reference = clean(row.Reference);
      const createdAt = clean(row.CreatedAt);
      const proofUrl = `/api/staff-direct-transfers?reference=${encodeURIComponent(reference)}&proof=1`;
      const processing = clean(row.Status).toLowerCase() === 'verification in progress';
      return `<article class="workflow-record direct-transfer-record">
        <div class="workflow-record-heading"><div><strong>${escapeHtml(row.PayerName || row.PayerEmail || 'Payer')}</strong><small>${escapeHtml(reference)}</small></div><span class="workflow-state waiting">${processing ? 'Verification in progress' : 'Awaiting verification'}</span></div>
        <div class="workflow-record-meta">
          <span>Purpose<strong>${escapeHtml(directTransferContextLabel(row.Context))}</strong></span>
          <span>Amount<strong>${escapeHtml(directTransferAmount(row))}</strong></span>
          <span>Bank reference<strong>${escapeHtml(row.BankReference || 'Not supplied')}</strong></span>
          <span>Submitted<strong>${escapeHtml(createdAt ? new Date(createdAt).toLocaleString() : '')}</strong></span>
        </div>
        <small>${escapeHtml([row.PayerEmail, row.PayerPhone].filter(Boolean).join(' | '))}</small>
        <div class="workflow-actions">
          ${row.HasProof ? `<a class="button-link direct-transfer-proof" href="${escapeHtml(proofUrl)}" target="_blank" rel="noopener">View proof</a>` : '<span class="muted">No proof attached</span>'}
          <button type="button" class="workflow-approve" data-direct-transfer-action="approve" data-direct-transfer-reference="${escapeHtml(reference)}">${processing ? 'Continue' : 'Approve'}</button>
          ${processing ? '' : `<button type="button" class="workflow-reject" data-direct-transfer-action="reject" data-direct-transfer-reference="${escapeHtml(reference)}">Reject</button>`}
        </div>
      </article>`;
    }).join('') : '<p class="muted">No direct bank transfer is awaiting verification here.</p>';
    list.querySelectorAll('[data-direct-transfer-action]').forEach((button) => button.addEventListener('click', async () => {
      const action = clean(button.dataset.directTransferAction);
      const reference = clean(button.dataset.directTransferReference);
      let reason = '';
      if (action === 'approve' && !await window.DynamaxDialogs.confirm({ title: 'Approve bank transfer', message: 'Have you confirmed this exact credit in the organisation bank account?', confirmText: 'Approve transfer' })) return;
      if (action === 'reject') {
        reason = clean(await window.DynamaxDialogs.prompt({ title: 'Reject bank transfer', message: 'The payment will remain unverified and no receipt will be issued.', label: 'Rejection reason', required: true, tone: 'danger', confirmText: 'Reject transfer' }));
        if (!reason) return;
      }
      const normalText = button.textContent;
      setButtonLoading(button, true, action === 'approve' ? 'Approving...' : 'Rejecting...', normalText);
      try {
        let result = {};
        for (let step = 0; step < 4; step += 1) {
          const actionResponse = await staffFetch('/api/staff-direct-transfers', {
            method: 'POST', credentials: 'same-origin', cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, Reference: reference, Reason: reason })
          });
          result = await actionResponse.json().catch(() => ({}));
          if (!actionResponse.ok || !result.ok) throw new Error(result.message || `Could not ${action} this transfer.`);
          if (!result.continueApproval) break;
          setStatus(status, result.message || 'Continuing transfer verification...', '');
          setButtonLoading(button, true, result.stage === 'deliver-receipt' ? 'Sending receipt...' : 'Recording...', normalText);
        }
        if (result.continueApproval) throw new Error('Transfer verification paused safely. Select Continue to resume.');
        setStatus(status, result.message, 'ok');
        await refreshDirectTransferModule(contexts);
      } catch (error) {
        setStatus(status, error.message || String(error), 'bad');
        if (button.isConnected) setButtonLoading(button, false, '', normalText);
      }
    }));
  } catch (error) {
    if (loading) loading.hidden = true;
    if (list) list.innerHTML = '';
    setStatus(status, error.message || String(error), 'bad');
  }
}

function admissionFormPurchasesWorkspace(rows = []) {
  return `
    <section class="workflow-intro">
      <div><small>Applicant self-service</small><h2>Admission Form Purchases</h2><p class="muted">Share one reusable QR code that opens the public admission form purchase page.</p></div>
      <button type="button" id="admissionFormPurchaseQrButton">&#9638; Purchase QR</button>
    </section>
    ${table('Purchase records', rows, [
      { label: 'Receipt', value: (row) => pick(row, ['ReceiptNo', '__id']) },
      { label: 'Applicant', value: (row) => pick(row, ['ApplicantName']) },
      { label: 'Email', value: (row) => pick(row, ['Email']) },
      { label: 'Class', value: (row) => pick(row, ['ClassApplyingFor']) },
      { label: 'Amount', value: (row) => money(pick(row, ['AmountPaid', 'Amount'])) }
    ])}
    ${directTransferVerificationWorkspace('admissionDirectTransferVerification', 'Admission transfers awaiting verification')}`;
}

function bindAdmissionFormPurchaseQr() {
  const qrButton = document.getElementById('admissionFormPurchaseQrButton');
  if (!qrButton) return;
  qrButton.addEventListener('click', async () => {
    const normalMarkup = qrButton.innerHTML;
    const viewer = window.open('', '_blank', 'width=620,height=780');
    if (!viewer) {
      setStatus(dashboardStatus, 'Allow pop-ups to view and print the admission form purchase QR code.', 'bad');
      return;
    }
    viewer.document.write('<!doctype html><title>Preparing admission QR</title><p style="font:14px Arial;padding:24px">Preparing reusable admission form purchase QR code&hellip;</p>');
    viewer.document.close();
    setButtonLoading(qrButton, true, 'Preparing...', normalMarkup);
    try {
      const response = await staffFetch('/api/staff-admission-forms', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'genericQr' })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw receivedResponseError(result.message || 'Could not generate the admission form purchase QR code.');
      showAdmissionFormPurchaseQr(result, viewer);
    } catch (error) {
      viewer.close();
      setStatus(dashboardStatus, error.message || String(error), 'bad');
    } finally {
      setButtonLoading(qrButton, false, '', normalMarkup);
      qrButton.innerHTML = normalMarkup;
    }
  });
}

function renderOrganizationCommerceWorkspace(section, data = {}) {
  const inventory = commerceInventory(section, data);
  syncCommerceCart(section, inventory);
  const cart = commerceCart(section);
  const sales = data.sales || [];
  const summary = commerceSalesSummary(sales);
  const label = section === 'restaurant' ? 'Restaurant' : 'Organisation Store';
  const itemLabel = section === 'restaurant' ? 'menu item' : 'product';
  const search = organizationCommerceSearch[section] || '';
  const draft = organizationCommerceCustomerDraft[section];
  const sale = organizationCommerceLastSale[section];
  const cartEntries = [...cart.entries()];
  const cartTotal = cartEntries.reduce((total, [, entry]) => total + commerceItemPrice(entry.item) * entry.quantity, 0);
  const available = inventory.filter((item) => clean(item.Active || 'YES').toUpperCase() !== 'NO'
    && commerceItemStock(item) > 0 && commerceItemPrice(item) > 0);
  const recentSales = sales.slice(0, 30);
  return `
    <section class="config-card organization-commerce-workspace" id="organizationCommercePOS" data-commerce-section="${section}">
      <header class="config-card-heading commerce-heading">
        <div><small>Sales and payments</small><h3>${label} Point of Sale</h3><p>Build a cart, receive payment and issue a branded receipt.</p></div>
        <div class="inline-action-group">${section === 'organizationStore' ? '<button type="button" id="organizationStoreQrButton">&#9638; Public store QR</button>' : ''}<span class="workspace-feature-icon" aria-hidden="true">&#128722;</span></div>
      </header>
      <div class="commerce-summary-grid">
        <div><small>Today's sales</small><strong>${money(summary.todayAmount)}</strong><span>${summary.todayTransactions} transaction(s)</span></div>
        <div><small>Paid sales</small><strong>${summary.paid}</strong><span>Recorded receipts</span></div>
        <div><small>Pending online</small><strong>${summary.pending}</strong><span>Awaiting confirmation</span></div>
        <div><small>Available items</small><strong>${available.length}</strong><span>Priced and in stock</span></div>
      </div>
      ${sale ? commerceReceiptPreview(sale) : ''}
      <div class="commerce-pos-layout">
        <section class="commerce-catalog" aria-label="${label} catalogue">
          <label class="commerce-search-label"><span>Search ${itemLabel}s</span><input id="commerceCatalogSearch" type="search" value="${escapeHtml(search)}" placeholder="Item or category"></label>
          <div class="commerce-product-list">
            ${available.length ? available.map((item, index) => {
              const reference = commerceItemReference(section, item);
              const inCart = cart.has(reference);
              const searchText = [item.ItemName, item.ItemCode, item.Category, item.Size].map(clean).join(' ').toLowerCase();
              return `<article class="commerce-product" data-commerce-search-text="${escapeHtml(searchText)}">
                <div><strong>${escapeHtml(item.ItemName || reference)}</strong><span>${escapeHtml([item.Category, item.Size || item.Unit].filter(Boolean).join(' · '))}</span><small>${money(commerceItemPrice(item))} &middot; ${commerceItemStock(item)} available</small></div>
                <div class="commerce-product-action">
                  <select data-commerce-product-quantity="${index}" aria-label="Quantity for ${escapeHtml(item.ItemName || reference)}">${commerceQuantityOptions(commerceItemStock(item), 1)}</select>
                  <button type="button" class="compact-icon-action commerce-add-button ${inCart ? 'is-added' : ''}" data-commerce-add="${escapeHtml(reference)}" data-commerce-quantity-index="${index}" aria-label="${inCart ? 'Added to cart' : `Add ${escapeHtml(item.ItemName || reference)} to cart`}" title="${inCart ? 'Added to cart' : 'Add to cart'}">${inCart ? '&#10003;' : '&#128722;'}</button>
                </div>
              </article>`;
            }).join('') : `<p class="muted commerce-empty">No priced ${itemLabel}s are currently available. Add stock and a selling price first.</p>`}
          </div>
        </section>
        <section class="commerce-cart" aria-label="Shopping cart">
          <div class="commerce-cart-title"><div><small>Current sale</small><h4>Cart</h4></div><strong>${money(cartTotal)}</strong></div>
          <div class="commerce-cart-lines">
            ${cartEntries.length ? cartEntries.map(([reference, entry]) => `<article class="commerce-cart-line">
              <div><strong>${escapeHtml(entry.item.ItemName || reference)}</strong><span>${money(commerceItemPrice(entry.item))} each</span></div>
              <select data-commerce-cart-quantity="${escapeHtml(reference)}" aria-label="Cart quantity for ${escapeHtml(entry.item.ItemName || reference)}">${commerceQuantityOptions(commerceItemStock(entry.item), entry.quantity)}</select>
              <strong>${money(commerceItemPrice(entry.item) * entry.quantity)}</strong>
              <button type="button" class="compact-icon-action compact-delete-action" data-commerce-remove="${escapeHtml(reference)}" aria-label="Remove ${escapeHtml(entry.item.ItemName || reference)}" title="Remove item">&#128465;</button>
            </article>`).join('') : '<p class="muted commerce-empty">Choose an item to begin this sale.</p>'}
          </div>
          <form id="commerceCheckoutForm" class="commerce-checkout-form">
            <div class="commerce-customer-grid">
              <label>Customer name <input name="CustomerName" value="${escapeHtml(draft.CustomerName)}" placeholder="Walk-in customer"></label>
              <label>Phone <input name="CustomerPhone" value="${escapeHtml(draft.CustomerPhone)}" inputmode="tel"></label>
              <label>Email <input name="CustomerEmail" type="email" value="${escapeHtml(draft.CustomerEmail)}" placeholder="Required for Paystack"></label>
              <label>Payment method <select name="PaymentMethod" id="commercePaymentMethod">
                ${['Cash', 'Bank Transfer', 'POS / Card', 'Paystack Online'].map((method) => `<option ${draft.PaymentMethod === method ? 'selected' : ''}>${method}</option>`).join('')}
              </select></label>
              <label id="commercePaymentReferenceField" ${['Bank Transfer', 'POS / Card'].includes(draft.PaymentMethod) ? '' : 'hidden'}>Payment reference <input name="PaymentReference" value="${escapeHtml(draft.PaymentReference)}" placeholder="Bank or POS reference"></label>
            </div>
            <div class="commerce-checkout-total"><span>Grand total</span><strong>${money(cartTotal)}</strong></div>
            <div class="config-actionbar"><p class="status" data-commerce-status></p><button type="submit" id="commerceCheckoutButton" ${cartEntries.length ? '' : 'disabled'}>${draft.PaymentMethod === 'Paystack Online' ? 'Send payment link' : 'Complete sale'}</button></div>
          </form>
        </section>
      </div>
      <details class="commerce-sales-history" ${recentSales.length ? '' : 'open'}>
        <summary>Recent sales <span>${recentSales.length}</span></summary>
        <div class="table-wrap"><table><thead><tr><th>Date</th><th>Receipt</th><th>Customer</th><th>Payment</th><th>Amount</th><th>Print</th></tr></thead><tbody>
          ${recentSales.length ? recentSales.map((row) => `<tr><td>${escapeHtml(clean(row.PaidAt || row.SaleDate || row.CreatedAt).replace('T', ' ').slice(0, 19))}</td><td>${escapeHtml(row.SaleNo)}</td><td>${escapeHtml(row.CustomerName || 'Walk-in customer')}</td><td>${escapeHtml(row.PaymentMethod)}<br>${commerceSaleStatus(row)}</td><td>${money(row.Amount || row.GrossAmount)}</td><td><button type="button" class="compact-icon-action" data-commerce-print="${escapeHtml(row.SaleNo)}" aria-label="Choose receipt format for ${escapeHtml(row.SaleNo)}" title="Choose receipt format" ${clean(row.PaymentStatus || row.Status).toLowerCase() === 'paid' ? '' : 'disabled'}>&#128424;</button></td></tr>`).join('') : '<tr><td colspan="6">No sales recorded yet.</td></tr>'}
        </tbody></table></div>
      </details>
    </section>`;
}

function updateCommerceWorkspace(section, data) {
  const current = document.getElementById('organizationCommercePOS');
  if (!current || activeSection !== section) return;
  current.outerHTML = renderOrganizationCommerceWorkspace(section, data);
  bindOrganizationCommerceWorkspace(section, data);
}

function organizationCommerceReceiptSale(section, data, saleNo) {
  const lastSale = organizationCommerceLastSale[section];
  if (lastSale && clean(lastSale.SaleNo) === clean(saleNo)) return lastSale;
  return (data.sales || []).find((row) => clean(row.SaleNo) === clean(saleNo));
}

function chooseReceiptPrintFormat() {
  let dialog = document.getElementById('receiptPrintFormatDialog');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'receiptPrintFormatDialog';
    dialog.className = 'workflow-dialog receipt-format-dialog';
    dialog.innerHTML = `<form method="dialog">
      <header class="workflow-dialog-header"><div><small>Receipt printing</small><h2>Choose receipt format</h2></div><button type="submit" value="" aria-label="Close receipt format chooser">&times;</button></header>
      <div class="receipt-format-options">
        <button type="submit" value="standard"><span aria-hidden="true">&#128196;</span><strong>Standard receipt</strong><small>A5 document for office printers or PDF</small></button>
        <button type="submit" value="pos"><span aria-hidden="true">&#129534;</span><strong>POS receipt</strong><small>Compact 80 mm thermal-printer layout</small></button>
      </div>
    </form>`;
    document.body.appendChild(dialog);
  }
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) => dialog.addEventListener('close', () => resolve(dialog.returnValue || ''), { once: true }));
}

function printOrganizationCommerceReceipt(sale = {}, format = 'standard') {
  if (!sale || clean(sale.PaymentStatus || sale.Status).toLowerCase() !== 'paid') return;
  const posFormat = format === 'pos';
  const receiptWindow = window.open('', '_blank', posFormat ? 'width=430,height=820' : 'width=820,height=900');
  if (!receiptWindow) {
    setStatus(dashboardStatus, 'Allow pop-ups to view and print this receipt.', 'bad');
    return;
  }
  receiptWindow.opener = null;
  const organisation = clean(document.querySelector('[data-school-name]')?.textContent || staffBrand?.textContent) || 'Dynamax';
  const logo = clean(document.querySelector('.nav-logo')?.getAttribute('src') || 'images/Logo.png');
  const items = Array.isArray(sale.Items) ? sale.Items : [];
  if (posFormat) {
    receiptWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(sale.SaleNo || 'POS receipt')}</title><style>
      @page{size:80mm auto;margin:3mm}*{box-sizing:border-box}body{width:80mm;margin:0 auto;background:#eee;color:#000;font:11px/1.35 Arial,sans-serif}.receipt{width:74mm;margin:8px auto;padding:4mm 3mm;background:#fff}.brand{text-align:center}.brand img{width:34px;height:34px;object-fit:contain}.brand h1{margin:4px 0 1px;font-size:15px}.brand p{margin:0;font-size:10px}.divider{margin:8px 0;border-top:1px dashed #000}.meta{display:grid;grid-template-columns:30mm 1fr;gap:2px}.meta span{font-weight:700}.meta strong{min-width:0;text-align:right;overflow-wrap:anywhere}table{width:100%;margin:7px 0;border-collapse:collapse;font-size:10px}th,td{padding:3px 1px;border-bottom:1px dotted #777;text-align:left}.number{text-align:right}.total{display:flex;justify-content:space-between;margin-top:7px;padding:7px 0;border-top:2px solid #000;border-bottom:2px solid #000;font-size:14px}.footer{margin-top:9px;text-align:center;font-size:9px}.print{display:block;width:fit-content;margin:10px auto;padding:8px 12px;border:0;border-radius:5px;background:#1769e0;color:#fff;font-weight:700}@media print{body{width:80mm;background:#fff}.receipt{width:74mm;margin:0;padding:0}.print{display:none}}</style></head><body><button class="print" onclick="window.print()">Print POS receipt</button><main class="receipt"><header class="brand">${logo ? `<img src="${escapeHtml(logo)}" alt="">` : ''}<h1>${escapeHtml(organisation)}</h1><p>${escapeHtml(sale.Department || 'Sales')} payment receipt</p></header><div class="divider"></div><section class="meta"><span>Receipt</span><strong>${escapeHtml(sale.SaleNo)}</strong><span>Date</span><strong>${escapeHtml(clean(sale.PaidAt || sale.SaleDate).replace('T', ' ').slice(0, 19))}</strong><span>Customer</span><strong>${escapeHtml(sale.CustomerName || 'Walk-in customer')}</strong><span>Payment</span><strong>${escapeHtml(sale.PaymentMethod || '')}</strong>${sale.PaymentReference ? `<span>Reference</span><strong>${escapeHtml(sale.PaymentReference)}</strong>` : ''}</section><div class="divider"></div><table><thead><tr><th>Item</th><th class="number">Qty</th><th class="number">Amount</th></tr></thead><tbody>${items.map((item) => `<tr><td>${escapeHtml(item.ItemName || item.ItemCode)}</td><td class="number">${escapeHtml(item.Quantity)}</td><td class="number">${money(item.Amount)}</td></tr>`).join('')}</tbody></table><div class="total"><span>TOTAL</span><strong>${money(sale.Amount || sale.GrossAmount)}</strong></div><footer class="footer">Payment received with thanks<br>Generated by Dynamax</footer></main></body></html>`);
    receiptWindow.document.close();
    return;
  }
  receiptWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(sale.SaleNo || 'Receipt')}</title><style>
    @page{size:A5;margin:12mm}*{box-sizing:border-box}body{margin:0;background:#eef4f8;color:#18324d;font:13px/1.45 Arial,sans-serif}.receipt{position:relative;max-width:620px;min-height:760px;margin:18px auto;padding:28px;border-top:7px solid #0c8b78;background:#fff;box-shadow:0 14px 35px #173b5820;overflow:hidden}.watermark{position:absolute;inset:25% 22%;width:56%;height:50%;object-fit:contain;opacity:.045}.brand,.meta,.total,.footer{position:relative}.brand{display:flex;align-items:center;gap:14px;padding-bottom:18px;border-bottom:2px solid #164d7a}.brand img{width:58px;height:58px;object-fit:contain}.brand h1{margin:0;color:#123f6d;font-size:21px}.brand p{margin:3px 0;color:#60758c}.meta{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:18px 0;padding:13px;background:#eaf4ff}.meta strong,.meta span{display:block}.meta span{font-size:11px;color:#60758c}table{position:relative;width:100%;border-collapse:collapse;margin:18px 0}th,td{padding:9px;border-bottom:1px solid #d8e4ee;text-align:left}th{background:#123f6d;color:white;font-size:10px;text-transform:uppercase}.number{text-align:right}.total{display:flex;justify-content:flex-end;gap:20px;padding:13px;background:#e5f7f1;color:#08725c;font-size:18px}.footer{margin-top:28px;padding-top:12px;border-top:1px solid #d8e4ee;color:#60758c;text-align:center}.print{position:fixed;top:10px;right:10px;padding:9px 13px;border:0;border-radius:7px;background:#1769e0;color:#fff;font-weight:bold;cursor:pointer}@media print{body{background:#fff}.receipt{min-height:auto;margin:0;padding:0;box-shadow:none}.print{display:none}}</style></head><body><button class="print" onclick="window.print()">Print / Save as PDF</button><main class="receipt">${logo ? `<img class="watermark" src="${escapeHtml(logo)}" alt="">` : ''}<header class="brand">${logo ? `<img src="${escapeHtml(logo)}" alt="">` : ''}<div><h1>${escapeHtml(organisation)}</h1><p>${escapeHtml(sale.Department || 'Sales')} payment receipt</p></div></header><section class="meta"><div><span>Receipt number</span><strong>${escapeHtml(sale.SaleNo)}</strong></div><div><span>Date</span><strong>${escapeHtml(clean(sale.PaidAt || sale.SaleDate).replace('T', ' ').slice(0, 19))}</strong></div><div><span>Customer</span><strong>${escapeHtml(sale.CustomerName || 'Walk-in customer')}</strong></div><div><span>Payment</span><strong>${escapeHtml(sale.PaymentMethod || '')}</strong></div>${sale.PaymentReference ? `<div><span>Reference</span><strong>${escapeHtml(sale.PaymentReference)}</strong></div>` : ''}</section><table><thead><tr><th>Item</th><th class="number">Qty</th><th class="number">Price</th><th class="number">Total</th></tr></thead><tbody>${items.map((item) => `<tr><td>${escapeHtml(item.ItemName || item.ItemCode)}</td><td class="number">${escapeHtml(item.Quantity)}</td><td class="number">${money(item.UnitPrice)}</td><td class="number">${money(item.Amount)}</td></tr>`).join('')}</tbody></table><div class="total"><span>Grand total</span><strong>${money(sale.Amount || sale.GrossAmount)}</strong></div><footer class="footer">Payment received with thanks &middot; Generated by Dynamax</footer></main></body></html>`);
  receiptWindow.document.close();
}

function bindOrganizationCommerceWorkspace(section, data = {}) {
  const workspace = document.getElementById('organizationCommercePOS');
  if (!workspace) return;
  const qrButton = workspace.querySelector('#organizationStoreQrButton');
  qrButton?.addEventListener('click', async () => {
    const normalMarkup = qrButton.innerHTML;
    const viewer = window.open('', '_blank', 'width=620,height=780');
    if (!viewer) {
      setStatus(dashboardStatus, 'Allow pop-ups to view and print the public store QR code.', 'bad');
      return;
    }
    viewer.document.write('<!doctype html><title>Preparing store QR</title><p style="font:14px Arial;padding:24px">Preparing reusable store QR code&hellip;</p>');
    viewer.document.close();
    setButtonLoading(qrButton, true, 'Preparing...', normalMarkup);
    try {
      const response = await staffFetch('/api/staff-stores', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'genericQr', section: 'organizationStore' })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw receivedResponseError(result.message || 'Could not generate the public store QR code.');
      showOrganizationStoreQr(result, viewer);
    } catch (error) {
      viewer.close();
      setStatus(dashboardStatus, error.message || String(error), 'bad');
    } finally {
      setButtonLoading(qrButton, false, '', normalMarkup);
      qrButton.innerHTML = normalMarkup;
    }
  });
  const search = workspace.querySelector('#commerceCatalogSearch');
  const filterProducts = () => {
    const query = clean(search?.value).toLowerCase();
    organizationCommerceSearch[section] = search?.value || '';
    workspace.querySelectorAll('[data-commerce-search-text]').forEach((row) => {
      row.hidden = Boolean(query) && !clean(row.dataset.commerceSearchText).includes(query);
    });
  };
  search?.addEventListener('input', filterProducts);
  filterProducts();
  workspace.querySelectorAll('[data-commerce-add]').forEach((button) => button.addEventListener('click', () => {
    const reference = button.dataset.commerceAdd;
    const item = commerceInventory(section, data).find((row) => commerceItemReference(section, row) === reference);
    if (!item) return;
    const select = workspace.querySelector(`[data-commerce-product-quantity="${button.dataset.commerceQuantityIndex}"]`);
    const quantity = Math.max(1, Number(select?.value || 1));
    commerceCart(section).set(reference, { item, quantity });
    updateCommerceWorkspace(section, data);
  }));
  workspace.querySelectorAll('[data-commerce-cart-quantity]').forEach((select) => select.addEventListener('change', () => {
    const entry = commerceCart(section).get(select.dataset.commerceCartQuantity);
    if (entry) entry.quantity = Math.max(1, Number(select.value || 1));
    updateCommerceWorkspace(section, data);
  }));
  workspace.querySelectorAll('[data-commerce-remove]').forEach((button) => button.addEventListener('click', () => {
    commerceCart(section).delete(button.dataset.commerceRemove);
    updateCommerceWorkspace(section, data);
  }));
  const form = workspace.querySelector('#commerceCheckoutForm');
  const method = form?.elements?.PaymentMethod;
  const referenceField = workspace.querySelector('#commercePaymentReferenceField');
  const checkoutButton = workspace.querySelector('#commerceCheckoutButton');
  const syncPaymentFields = () => {
    const value = clean(method?.value || 'Cash');
    const referenceRequired = ['Bank Transfer', 'POS / Card'].includes(value);
    referenceField.hidden = !referenceRequired;
    if (referenceField.querySelector('input')) referenceField.querySelector('input').required = referenceRequired;
    if (form?.elements?.CustomerEmail) form.elements.CustomerEmail.required = value === 'Paystack Online';
    if (checkoutButton) checkoutButton.textContent = value === 'Paystack Online' ? 'Send payment link' : 'Complete sale';
  };
  method?.addEventListener('change', syncPaymentFields);
  syncPaymentFields();
  form?.addEventListener('input', () => {
    ['CustomerName', 'CustomerEmail', 'CustomerPhone', 'PaymentMethod', 'PaymentReference'].forEach((key) => {
      if (form.elements[key]) organizationCommerceCustomerDraft[section][key] = form.elements[key].value;
    });
  });
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = form.querySelector('[data-commerce-status]');
    const entries = [...commerceCart(section).entries()];
    if (!entries.length) {
      setStatus(status, 'Choose at least one item for this sale.', 'bad');
      return;
    }
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.action = 'recordSale';
    payload.section = section;
    payload.Items = entries.map(([Reference, entry]) => ({ Reference, Quantity: entry.quantity }));
    organizationCommerceSaleRequestIds[section] ||= newIdempotencyKey();
    payload.SaleRequestId = organizationCommerceSaleRequestIds[section];
    const endpoint = section === 'organizationStore' ? '/api/staff-stores' : '/api/staff-departments';
    setButtonLoading(checkoutButton, true, payload.PaymentMethod === 'Paystack Online' ? 'Emailing link...' : 'Recording sale...', checkoutButton.textContent);
    try {
      const response = await staffFetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': payload.SaleRequestId },
        body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw receivedResponseError(result.message || 'Could not record this sale.');
      organizationCommerceLastSale[section] = result.sale || null;
      setStatus(status, result.message || 'Sale recorded.', 'ok');
      commerceCart(section).clear();
      organizationCommerceSaleRequestIds[section] = '';
      organizationCommerceCustomerDraft[section] = { CustomerName: '', CustomerEmail: '', CustomerPhone: '', PaymentMethod: 'Cash', PaymentReference: '' };
      if (section === 'organizationStore') await loadStaffStore(section);
      else await loadDepartmentOperations(section);
    } catch (error) {
      setStatus(status, error.message || String(error), 'bad');
    } finally {
      setButtonLoading(checkoutButton, false, '', organizationCommerceCustomerDraft[section].PaymentMethod === 'Paystack Online' ? 'Send payment link' : 'Complete sale');
    }
  });
  workspace.querySelectorAll('[data-commerce-open-payment]').forEach((button) => button.addEventListener('click', () => {
    const paymentUrl = clean(button.dataset.commerceOpenPayment);
    if (/^https:\/\/[A-Za-z0-9.-]+(?:\/|$)/.test(paymentUrl)) window.open(paymentUrl, '_blank', 'noopener');
  }));
  workspace.querySelectorAll('[data-commerce-print]').forEach((button) => button.addEventListener('click', async () => {
    const format = await chooseReceiptPrintFormat();
    if (!format) return;
    printOrganizationCommerceReceipt(organizationCommerceReceiptSale(section, data, button.dataset.commercePrint), format);
  }));
}

function renderStaffStore(section, store) {
  const organisationStore = section === 'organizationStore';
  const label = organisationStore ? 'Organisation Store' : (section === 'bookstore' ? 'Bookstore' : 'Uniform Store');
  const storeAudience = organisationStore ? 'customers and storekeepers' : 'parents and storekeepers';
  const categories = store.categories || [];
  const activeCategories = categories.filter((row) => clean(row.Active || 'YES') !== 'NO');
  renderModuleSummary(section, store);
  panelEl.innerHTML = `
    <div class="workflow-intro"><div><p class="eyebrow">${organisationStore ? 'Retail operations' : 'School store'}</p><h2>${label}</h2><p class="muted">List items and prices, monitor paid orders, and record collection.</p></div></div>
    ${organisationStore ? renderOrganizationCommerceWorkspace(section, store) : ''}
    <section class="config-card" id="staffStoreItemWorkspace">
      <header class="config-card-heading"><div><small>Inventory setup</small><h3>Add or update an item</h3><p>Define how this product appears to ${storeAudience}.</p></div></header>
    <form id="staffStoreItemForm" class="workflow-form workflow-form-grid config-form"><input type="hidden" name="ItemId">
      <label>Item code<input name="ItemCode" required></label><label>Item name<input name="ItemName" required></label>
      <label>Category<input name="Category" list="storeCategoryOptions" autocomplete="off" required><datalist id="storeCategoryOptions">${activeCategories.map((row) => `<option value="${escapeHtml(row.Name)}"></option>`).join('')}</datalist></label><label>Variant / size<input name="Size"></label>
      ${organisationStore ? '' : '<label>Gender<select name="Gender"><option>All</option><option>Male</option><option>Female</option></select></label><label>Class<input name="ClassName" value="All"></label>'}
      <label>Price<input name="Price" type="number" min="0" step="0.01" data-finance-input required></label><label>Stock quantity<input name="Quantity" type="number" min="0" step="1" required></label>
      <div class="config-actionbar"><label class="check-row"><input name="Active" type="checkbox" checked> ${organisationStore ? 'Available for sale' : 'Available to parents'}</label><p class="status" data-store-status></p><span class="inline-action-group"><button type="button" data-cancel-store-edit hidden>Cancel edit</button><button type="submit">Save item</button></span></div>
    </form>
    </section>
    <details class="workflow-card config-details" id="staffStoreCategoryWorkspace" open><summary><span>Category management<small>Add, rename or deactivate reusable product categories.</small></span></summary>
      <form id="storeCategoryForm" class="workflow-form workflow-form-grid config-form"><input type="hidden" name="CategoryId"><label>Category name<input name="Name" required></label><label>Available in<select name="AppliesTo"><option value="${label}">${label}</option>${organisationStore ? '' : '<option value="Bookstore,Uniform Store">Both stores</option>'}</select></label><div class="config-actionbar"><label class="check-row"><input name="Active" type="checkbox" checked> Category active</label><p class="status" data-category-status></p><button type="submit">Save category</button></div></form>
      <div class="workflow-record-list store-category-list">${categories.length ? categories.map((row) => {
        const categoryActive = clean(row.Active || 'YES') !== 'NO';
        return `<article class="workflow-record store-category-row"><div class="store-category-copy"><strong>${escapeHtml(row.Name)}</strong><small>${escapeHtml((row.StoreScopes || []).join(', '))}</small></div><div class="store-category-actions"><button type="button" class="store-category-edit compact-icon-action compact-edit-action" data-edit-category="${escapeHtml(row.CategoryId)}" aria-label="Edit ${escapeHtml(row.Name)}" title="Edit category"><span aria-hidden="true">&#9998;</span></button><label class="store-category-toggle"><input type="checkbox" data-category-active="${escapeHtml(row.CategoryId)}" aria-label="${categoryActive ? 'Deactivate' : 'Activate'} ${escapeHtml(row.Name)}" ${categoryActive ? 'checked' : ''}><span>Active</span></label></div></article>`;
      }).join('') : '<p class="muted">Existing item categories will be added here automatically.</p>'}</div>
    </details>
    ${table(`${label} Items`, store.items || [], [
      { label: 'Code', value: (row) => pick(row, ['ItemCode', '__id']) }, { label: 'Item', value: (row) => pick(row, ['ItemName']) },
      { label: 'Category / Size', value: (row) => [pick(row, ['Category']), pick(row, ['Size'])].filter(Boolean).join(' / ') },
      { label: 'Price', value: (row) => money(pick(row, ['Price'])) }, { label: 'Stock', value: (row) => pick(row, ['Quantity']) },
      { label: 'Actions', render: (row) => `<button type="button" class="compact-icon-action compact-edit-action" data-edit-store-item="${escapeHtml(row.__id)}" aria-label="Edit ${escapeHtml(row.ItemName || row.ItemCode || 'store item')}" title="Edit item"><span aria-hidden="true">&#9998;</span></button>` }
    ])}
    ${organisationStore ? directTransferVerificationWorkspace('organizationStoreDirectTransferVerification', 'Store transfers awaiting verification') : ''}
    <section id="staffStoreOrdersWorkspace"><h2>Paid Orders & Collection</h2><div class="workflow-record-list">${(store.orders || []).length ? (store.orders || []).map((order) => {
      const orderStatus = clean(order.Status || 'Paid - Awaiting Collection');
      const statusKey = orderStatus.toLowerCase();
      const collected = statusKey === 'collected';
      const ready = statusKey === 'ready for collection';
      const nextStatus = ready ? 'Collected' : 'Ready for Collection';
      const statusLabel = collected ? 'Collected' : ready ? 'Ready · Verify Collection' : 'Paid · Mark Ready';
      return `
      <article class="workflow-record store-order-record"><div class="workflow-record-heading"><div><strong>${escapeHtml(order.DisplayName || order.CustomerName || order.AccountRef || 'Customer')}</strong><small>${escapeHtml(order.OrderNo)}</small></div></div>
      <p>${money(order.Amount)} &middot; ${escapeHtml(order.PaidAt || order.CreatedAt || '')}</p>
      <button type="button" class="store-order-status ${collected ? 'is-collected' : ''}" data-store-order="${escapeHtml(order.OrderNo)}" data-store-status="${escapeHtml(nextStatus)}" aria-label="${escapeHtml(statusLabel)} for ${escapeHtml(order.DisplayName || order.AccountRef)}" ${collected ? 'disabled' : ''}>${escapeHtml(statusLabel)}</button></article>`;
    }).join('') : '<p class="muted">No paid orders yet.</p>'}</div></section>`;
  mountWorkspaceTabs(section, [
    { key: 'sales', label: organisationStore ? 'Point of sale' : 'Sales', icon: '\u{1F6D2}', nodes: document.getElementById('organizationCommercePOS') },
    ...(organisationStore ? [{ key: 'transfers', label: 'Transfer verification', icon: '\u{1F50E}', nodes: document.getElementById('organizationStoreDirectTransferVerification') }] : []),
    { key: 'items', label: 'Items', icon: '\u25A6', count: (store.items || []).length, nodes: [document.getElementById('staffStoreItemWorkspace'), workspaceTableNodes(`${label} Items`)] },
    { key: 'categories', label: 'Categories', icon: '\u{1F5C2}', count: categories.length, nodes: document.getElementById('staffStoreCategoryWorkspace') },
    { key: 'orders', label: 'Orders & collection', icon: '\u2713', count: (store.orders || []).length, nodes: document.getElementById('staffStoreOrdersWorkspace') }
  ]);
  if (organisationStore) loadDirectTransferVerification(['organization-store'], 'organizationStoreDirectTransferVerification');
  if (organisationStore) bindOrganizationCommerceWorkspace(section, store);
  const itemForm = document.getElementById('staffStoreItemForm');
  const resetStoreItemForm = () => {
    if (!itemForm) return;
    itemForm.reset();
    itemForm.elements.ItemId.value = '';
    itemForm.elements.Active.checked = true;
    itemForm.querySelector('button[type="submit"]').textContent = 'Save item';
    itemForm.querySelector('[data-cancel-store-edit]').hidden = true;
    setStatus(itemForm.querySelector('[data-store-status]'), '');
  };
  itemForm?.addEventListener('submit', async (event) => {
    event.preventDefault(); const form = event.currentTarget; const status = form.querySelector('[data-store-status]');
    const button = event.submitter || form.querySelector('button[type="submit"]');
    if (button?.disabled) return;
    const payload = Object.fromEntries(new FormData(form).entries()); payload.Active = form.elements.Active.checked;
    const match = activeCategories.find((row) => clean(row.Name).toLowerCase() === clean(payload.Category).toLowerCase());
    if (!match && !await window.DynamaxDialogs.confirm({ title: 'Create new category', message: `Create "${payload.Category}" as a new ${label} category?`, confirmText: 'Create category' })) return;
    payload.CategoryId = match?.CategoryId || ''; payload.CreateCategoryIfMissing = !match;
    const normalText = clean(button?.textContent) || 'Save item';
    setButtonLoading(button, true, 'Saving...', normalText);
    try {
      const response = await staffFetch('/api/staff-stores', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'saveItem', section, ...payload }) });
      const data = await response.json(); if (!response.ok || !data.ok) throw new Error(data.message || 'Could not save store item.');
      setStatus(status, data.message, 'ok'); await loadStaffStore(section);
    } catch (error) {
      setStatus(status, error.message || String(error), 'bad');
    } finally {
      if (button?.isConnected) setButtonLoading(button, false, 'Saving...', normalText);
    }
  });
  itemForm?.querySelector('[data-cancel-store-edit]')?.addEventListener('click', resetStoreItemForm);
  panelEl.querySelectorAll('[data-edit-store-item]').forEach((button) => button.addEventListener('click', () => {
    const row = (store.items || []).find((item) => clean(item.__id) === clean(button.dataset.editStoreItem));
    if (!row || !itemForm) return;
    itemForm.elements.ItemId.value = clean(row.__id);
    itemForm.elements.ItemCode.value = clean(row.ItemCode);
    itemForm.elements.ItemName.value = clean(row.ItemName);
    itemForm.elements.Category.value = clean(row.Category);
    itemForm.elements.Size.value = clean(row.Size);
    setFinancialInputValue(itemForm.elements.Price, commerceNumber(row.Price));
    itemForm.elements.Quantity.value = commerceItemStock(row);
    itemForm.elements.Active.checked = clean(row.Active || 'YES').toUpperCase() !== 'NO';
    if (itemForm.elements.Gender) itemForm.elements.Gender.value = clean(row.Gender || 'All');
    if (itemForm.elements.ClassName) itemForm.elements.ClassName.value = clean(row.ClassName || 'All');
    itemForm.querySelector('button[type="submit"]').textContent = 'Update item';
    itemForm.querySelector('[data-cancel-store-edit]').hidden = false;
    setStatus(itemForm.querySelector('[data-store-status]'), `Editing ${clean(row.ItemName || row.ItemCode)}.`);
    itemForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
    itemForm.elements.ItemName.focus({ preventScroll: true });
  }));
  const categoryForm = document.getElementById('storeCategoryForm');
  categoryForm?.addEventListener('submit', async (event) => {
    event.preventDefault(); const form = event.currentTarget; const status = form.querySelector('[data-category-status]'); const button = event.submitter || form.querySelector('button[type="submit"]');
    if (button?.disabled) return;
    const payload = Object.fromEntries(new FormData(form).entries()); payload.Active = form.elements.Active.checked ? 'YES' : 'NO';
    const normalText = clean(button?.textContent) || 'Save category';
    setButtonLoading(button, true, 'Saving...', normalText);
    try {
      const response = await staffFetch('/api/staff-stores', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'saveCategory', section, ...payload }) });
      const data = await response.json(); if (!response.ok || !data.ok) throw new Error(data.message || 'Could not save category.');
      setStatus(status, data.message, 'ok'); await loadStaffStore(section);
    } catch (error) {
      setStatus(status, error.message || String(error), 'bad');
    } finally {
      if (button?.isConnected) setButtonLoading(button, false, 'Saving...', normalText);
    }
  });
  panelEl.querySelectorAll('[data-edit-category]').forEach((button) => button.addEventListener('click', () => { const row = categories.find((item) => item.CategoryId === button.dataset.editCategory); if (!row || !categoryForm) return; categoryForm.elements.CategoryId.value = row.CategoryId; categoryForm.elements.Name.value = row.Name; categoryForm.elements.Active.checked = clean(row.Active || 'YES') !== 'NO'; categoryForm.scrollIntoView({ behavior: 'smooth', block: 'center' }); }));
  panelEl.querySelectorAll('[data-category-active]').forEach((checkbox) => checkbox.addEventListener('change', async () => {
    const row = categories.find((item) => item.CategoryId === checkbox.dataset.categoryActive);
    if (!row) return;
    const active = checkbox.checked;
    checkbox.disabled = true;
    try {
      const response = await staffFetch('/api/staff-stores', {
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
      ? await window.DynamaxDialogs.prompt({
        title: 'Confirm item collection',
        message: organisationStore ? 'Enter the order number or customer collection reference.' : "Scan or enter the student's card ID, admission number, or parent verification code.",
        label: 'Collection reference', required: true, confirmText: 'Confirm collection'
      })
      : '';
    if (button.dataset.storeStatus === 'Collected' && !clean(collectionReference)) return;
    const normalText = clean(button.textContent) || 'Update order';
    setButtonLoading(button, true, 'Updating...', normalText);
    try {
      const response = await staffFetch('/api/staff-stores', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'updateOrder', section, OrderNo: button.dataset.storeOrder, Status: button.dataset.storeStatus, CollectionReference: collectionReference }) });
      const data = await response.json(); if (!response.ok || !data.ok) throw new Error(data.message || 'Could not update order.'); await loadStaffStore(section);
    } catch (error) {
      setStatus(dashboardStatus, error.message || String(error), 'bad');
    } finally {
      if (button.isConnected) setButtonLoading(button, false, 'Updating...', normalText);
    }
  }));
}

async function loadStaffStore(section) {
  try { const response = await staffFetch('/api/staff-stores', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'list', section }) }); const data = await response.json(); if (!response.ok || !data.ok) throw new Error(data.message || 'Could not load school store.'); renderStaffStore(section, data); } catch (error) { panelEl.innerHTML = `<p class="status bad">${escapeHtml(error.message || String(error))}</p>`; }
}

async function submitDepartmentAction(section, action, form) {
  const status = form.querySelector('[data-department-status]');
  const button = form.querySelector('button[type="submit"]');
  if (button?.disabled) return;
  const payload = Object.fromEntries(new FormData(form).entries());
  if (form.elements.Active?.type === 'checkbox') payload.Active = form.elements.Active.checked ? 'YES' : 'NO';
  const normalText = clean(button?.textContent) || 'Save';
  setButtonLoading(button, true, 'Saving...', normalText);
  try {
    const response = await staffFetch('/api/staff-departments', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, section, ...payload })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.message || 'Could not save the department record.');
    renderDepartmentOperations(section, data);
    setStatus(dashboardStatus, data.message, 'ok');
  } catch (error) {
    setStatus(status, error.message || String(error), 'bad');
  } finally {
    if (button?.isConnected) setButtonLoading(button, false, 'Saving...', normalText);
  }
}

async function requestDepartmentAction(section, action, payload = {}, idempotencyKey = '') {
  const headers = { 'Content-Type': 'application/json' };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const response = await staffFetch('/api/staff-departments', {
    method: 'POST',
    credentials: 'same-origin',
    headers,
    body: JSON.stringify({ action, section, ...payload, ...(idempotencyKey ? { idempotencyKey } : {}) })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    const error = new Error(data.message || 'Could not complete the department action.');
    error.responseReceived = true;
    throw error;
  }
  renderDepartmentOperations(section, data);
  setStatus(dashboardStatus, data.message, 'ok');
  return data;
}

function renderInventoryActions(row) {
  const name = escapeHtml(pick(row, ['ItemName', '__id']));
  return `<button type="button" class="compact-icon-action compact-edit-action" data-edit-inventory="${name}" aria-label="Edit ${name}" title="Edit item"><span aria-hidden="true">&#9998;</span></button>`;
}

function decodeNfcRecord(record) {
  if (!record?.data) return '';
  try {
    return new TextDecoder(record.encoding || 'utf-8').decode(record.data).trim();
  } catch (_error) {
    return '';
  }
}

function walletCardIdFromNfc(event) {
  for (const record of event?.message?.records || []) {
    const value = decodeNfcRecord(record);
    if (!value) continue;
    try {
      const parsed = JSON.parse(value);
      const cardId = clean(parsed.WalletCardId || parsed.walletCardId || parsed.CardId || parsed.cardId || parsed.id);
      if (cardId) return cardId;
    } catch (_error) {
      // Plain-text and URL records are valid card identifiers too.
    }
    try {
      const url = new URL(value);
      const cardId = clean(url.searchParams.get('walletCardId') || url.searchParams.get('cardId') || url.searchParams.get('id'));
      if (cardId) return cardId;
    } catch (_error) {
      // Continue with the plain NDEF record below.
    }
    const labelled = value.match(/(?:wallet(?:card)?id|cardid)\s*[:=]\s*([A-Za-z0-9._:-]+)/i);
    if (labelled?.[1]) return labelled[1];
    if (/^[A-Za-z0-9][A-Za-z0-9._:-]{2,80}$/.test(value)) return value;
  }
  return clean(event?.serialNumber).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

async function scanTuckShopNfc(form, button) {
  const status = form.querySelector('[data-department-status]');
  if (!('NDEFReader' in window)) {
    setStatus(status, 'Direct NFC scanning is unavailable in this browser. Use Android Chrome, enter the card ID, or tap a USB reader while the card field is focused.', 'bad');
    form.elements.WalletCardId?.focus();
    return;
  }
  const normalText = button.textContent;
  const controller = new AbortController();
  try {
    setButtonLoading(button, true, 'Waiting for card...', normalText);
    setStatus(status, 'Allow NFC access if prompted, then hold the student card near this device.', 'ok');
    const reader = new NDEFReader();
    reader.addEventListener('readingerror', () => {
      setStatus(status, 'This card could not be read. Confirm it is an NDEF-compatible card or enter its card ID manually.', 'bad');
    }, { once: true });
    reader.addEventListener('reading', (event) => {
      const cardId = walletCardIdFromNfc(event);
      controller.abort();
      setButtonLoading(button, false, 'Waiting for card...', normalText);
      if (!cardId) {
        setStatus(status, 'The NFC card was detected, but it did not contain a usable card ID.', 'bad');
        return;
      }
      form.elements.WalletCardId.value = cardId;
      setStatus(status, `Card ${cardId} scanned. Looking up the student wallet...`, 'ok');
      form.requestSubmit();
    }, { once: true });
    await reader.scan({ signal: controller.signal });
  } catch (error) {
    setButtonLoading(button, false, 'Waiting for card...', normalText);
    if (error?.name === 'AbortError') return;
    setStatus(status, error?.name === 'NotAllowedError'
      ? 'NFC permission was not granted. Allow NFC access or enter the card ID manually.'
      : `NFC scanning could not start: ${error?.message || error}`, 'bad');
  }
}

function renderDepartmentOperations(section, data) {
  if (activeSection !== section) return;
  const labels = { clinic: 'Clinic', kitchen: 'Kitchen', restaurant: 'Restaurant', tuckShop: 'Tuck Shop' };
  const descriptions = {
    clinic: 'Record student visits, maintain medical supplies, and track every stock receipt or issue.',
    kitchen: 'Maintain food and kitchen supplies and track every stock receipt or issue.',
    restaurant: 'Manage restaurant and catering inventory, stock movement, low-stock alerts, and supplier market lists.',
    tuckShop: 'Maintain tuck-shop stock while wallet purchases remain synchronized with Finance and Accounting.'
  };
  const label = labels[section];
  const inventory = data.inventory || [];
  const records = data.records || [];
  const wallet = data.walletAccount || null;
  const clinicReport = data.clinicReport || null;
  const purchases = (dashboardData?.departments?.tuckShop || {}).purchases || [];
  renderModuleSummary(section, {
    ...(dashboardData?.departments?.[section] || {}),
    ...data,
    purchases
  });
  panelEl.innerHTML = `
    <div class="workflow-intro"><div><p class="eyebrow">Department operations</p><h2>${label}</h2><p class="muted">${descriptions[section]}</p></div><button type="button" class="workflow-icon-action" id="refreshDepartmentOperations" aria-label="Refresh ${label}">Refresh</button></div>
    ${section === 'restaurant' ? renderOrganizationCommerceWorkspace(section, data) : ''}
    ${section === 'tuckShop' ? `<nav class="department-workspace-links" aria-label="Tuck shop workspaces">
      <button type="button" class="active" data-department-jump="tuckShopPOS"><span aria-hidden="true">&#128722;</span> Student Purchase</button>
      <button type="button" data-department-jump="departmentInventoryWorkspace"><span aria-hidden="true">&#128230;</span> Inventory</button>
      <button type="button" data-department-jump="departmentStockWorkspace"><span aria-hidden="true">&#8645;</span> Stock In / Out</button>
      <button type="button" data-department-jump="departmentPurchaseHistory"><span aria-hidden="true">&#128203;</span> Purchase History</button>
    </nav>` : ''}
    ${section === 'tuckShop' ? `
    <section class="config-card department-primary-workflow tuck-shop-pos-workspace" id="tuckShopPOS"><header class="config-card-heading"><div><small>Student wallet, card or admission lookup</small><h3>Student Purchase</h3><p>Scan a wallet card or enter the student's admission number, confirm the wallet, then record the sale.</p></div><span class="workspace-feature-icon" aria-hidden="true">&#128722;</span></header>
      <div class="purchase-step-label"><strong>1</strong><span>Find the student wallet</span></div>
      <form id="walletLookupForm" class="workflow-form workflow-form-grid config-form">
        <label>Wallet card ID<input name="WalletCardId" autocomplete="off" placeholder="Scan or enter card ID"></label>
        <label>Admission number<input name="AccountRef" autocomplete="off" placeholder="Or enter admission number"></label>
        <div class="config-actionbar"><p class="status" data-department-status></p><div class="inline-action-group"><button type="button" id="tuckShopNfcScan">&#9673; Scan NFC Card</button><button type="submit">&#128269; Find Student Wallet</button></div></div>
      </form>
      ${wallet ? `<div class="wallet-account-result">
        <div><small>Student</small><strong>${escapeHtml(wallet.DisplayName)}</strong><span>${escapeHtml(wallet.AdmissionNo || wallet.AccountRef)} &middot; ${escapeHtml(wallet.ClassName || '')}</span></div>
        <div><small>Wallet balance</small><strong>${money(wallet.WalletBalance)}</strong><span>${escapeHtml(wallet.WalletCardStatus || 'Active')} &middot; Spent today ${money(wallet.WalletSpentToday)}</span></div>
      </div>
      <div class="purchase-step-label"><strong>2</strong><span>Enter the purchase and complete the sale</span></div>
      <form id="walletPurchaseForm" class="workflow-form workflow-form-grid config-form">
        <input type="hidden" name="AccountRef" value="${escapeHtml(wallet.AccountRef)}">
        <label>Purchase amount<input name="Amount" type="number" min="0.01" step="0.01" data-finance-input required placeholder="0.00"></label>
        <label>Items / description<input name="Description" value="Tuck shop purchase" required placeholder="Describe the items purchased"></label>
        <label>Wallet PIN (when required)<input name="WalletPin" type="password" inputmode="numeric" autocomplete="off"></label>
        <div class="config-actionbar"><p class="status" data-department-status></p><button type="submit">&#10003; Complete Wallet Purchase</button></div>
      </form>` : '<p class="muted">Find the student before recording a purchase. Card limits, balance and PIN rules will be checked automatically.</p>'}
    </section>` : ''}
    ${section === 'clinic' ? `
    <section class="config-card"><header class="config-card-heading"><div><small>Patient care</small><h3>Record a clinic visit</h3></div></header>
      <form id="clinicRecordForm" class="workflow-form workflow-form-grid config-form">
        <label>Date<input type="date" name="Date" value="${new Date().toISOString().slice(0, 10)}" required></label>
        <label>Admission number<input name="AdmissionNo" required placeholder="Finds the enrolled student"></label>
        <label>Complaint<textarea name="Complaint" required></textarea></label><label>Treatment<textarea name="Treatment"></textarea></label>
        <label>Disposition<select name="Disposition"><option>Treated and returned</option><option>Resting in clinic</option><option>Sent home</option><option>Referred to hospital</option></select></label>
        <label>Notes<input name="Notes"></label>
        <div class="config-actionbar"><p class="status" data-department-status></p><button type="submit" data-normal-text="Save visit">Save visit</button></div>
      </form>
    </section>` : ''}
    ${section === 'clinic' ? `
    <section class="config-card department-primary-workflow"><header class="config-card-heading"><div><small>Parent communication</small><h3>Email a clinic report</h3></div></header>
      <form id="clinicReportForm" class="workflow-form workflow-form-grid config-form">
        <label>Admission number<input name="AccountRef" value="${escapeHtml(clinicReport?.AccountRef || '')}" required></label>
        <label>Subject<input name="Subject" value="${escapeHtml(clinicReport ? `Clinic report - ${clinicReport.StudentName}` : 'Clinic Report')}"></label>
        <label class="workflow-wide-field">Message<textarea name="Message">Please find the clinic report below.</textarea></label>
        ${clinicReport ? `<div class="workflow-wide-field report-recipient-preview"><strong>${escapeHtml(clinicReport.StudentName)}</strong><span>${escapeHtml(clinicReport.ClassName)} &middot; ${escapeHtml(clinicReport.ParentEmail)} &middot; ${clinicReport.RecordCount} clinic record(s)</span></div>` : ''}
        <div class="config-actionbar"><p class="status" data-department-status></p><div class="inline-action-group"><button type="button" id="prepareClinicReport">Prepare report</button><button type="submit" ${clinicReport ? '' : 'disabled'}>Send to parent</button></div></div>
      </form>
    </section>` : ''}
    ${['clinic', 'kitchen', 'restaurant'].includes(section) ? `
    <section class="config-card department-primary-workflow"><header class="config-card-heading"><div><small>Procurement</small><h3>Create and email a market list</h3></div></header>
      <form id="marketListForm" class="workflow-form config-form">
        <div class="workflow-form-grid">
          <label>Supplier name<input name="SupplierName" required></label>
          <label>Supplier email<input name="SupplierEmail" type="email" required></label>
          <label class="workflow-wide-field">Subject<input name="Subject" value="${label} market list"></label>
        </div>
        <div class="table-wrap market-list-table"><table><thead><tr><th>Use</th><th>Item</th><th>Current</th><th>Unit</th><th>Order qty</th></tr></thead><tbody>
          ${inventory.map((row, index) => {
            const low = Number(row.ReorderLevel || 0) > 0 && Number(row.Quantity || 0) <= Number(row.ReorderLevel || 0);
            return `<tr data-market-row><td><input type="checkbox" aria-label="Include ${escapeHtml(row.ItemName)}" ${low ? 'checked' : ''}></td><td data-item="${escapeHtml(row.ItemName)}">${escapeHtml(row.ItemName)}</td><td>${escapeHtml(row.Quantity)}</td><td data-unit="${escapeHtml(row.Unit)}">${escapeHtml(row.Unit)}</td><td><input type="number" min="0.01" step="0.01" value="${low ? Math.max(1, Number(row.ReorderLevel || 0) - Number(row.Quantity || 0)) : 1}" aria-label="Order quantity for ${escapeHtml(row.ItemName)}"></td></tr>`;
          }).join('') || '<tr><td colspan="5">Add inventory items before preparing a market list.</td></tr>'}
        </tbody></table></div>
        <div class="config-actionbar"><p class="status" data-department-status></p><button type="submit" ${inventory.length ? '' : 'disabled'}>Send market list</button></div>
      </form>
    </section>` : ''}
    <section class="config-card" id="departmentInventoryWorkspace"><header class="config-card-heading"><div><small>Inventory setup</small><h3>Add or update an item</h3></div></header>
      <form id="departmentInventoryForm" class="workflow-form workflow-form-grid config-form">
        <input type="hidden" name="OriginalItemName">
        <label>Item name<input name="ItemName" required></label><label>Category<input name="Category" value="${section === 'clinic' ? 'Medical Supply' : section === 'kitchen' ? 'Foodstuff' : section === 'restaurant' ? 'Food & Beverage' : 'General Item'}"></label>
        <label>Unit<input name="Unit" value="${section === 'kitchen' ? 'kg' : 'pcs'}" required></label><label>Opening/current quantity<input name="Quantity" type="number" min="0" step="0.01" value="0" required></label>
        <label>Reorder level<input name="ReorderLevel" type="number" min="0" step="0.01" value="0"></label>${section === 'restaurant' ? '<label>Selling price<input name="SalePrice" type="number" min="0" step="0.01" value="0" data-finance-input required></label>' : ''}<label>Notes<input name="Notes"></label>
        ${section === 'restaurant' ? '<label class="check-row commerce-inventory-active"><input name="Active" type="checkbox" checked> Available for sale</label>' : ''}
        <div class="config-actionbar"><p class="status" data-department-status></p><button type="submit" data-normal-text="Save item">Save item</button></div>
      </form>
    </section>
    <section class="config-card" id="departmentStockWorkspace"><header class="config-card-heading"><div><small>Stock control</small><h3>Record stock in or out</h3></div></header>
      <form id="departmentMovementForm" class="workflow-form workflow-form-grid config-form">
        <label>Item<select name="ItemName" required><option value="">Choose item</option>${inventory.map((row) => `<option>${escapeHtml(row.ItemName)}</option>`).join('')}</select></label>
        <label>Movement<select name="MovementType"><option value="IN">Stock In</option><option value="OUT">Stock Out</option></select></label>
        <label>Quantity<input name="Quantity" type="number" min="0.01" step="0.01" required></label><label>Reason<input name="Reason" required></label>
        <div class="config-actionbar"><p class="status" data-department-status></p><button type="submit" data-normal-text="Record movement">Record movement</button></div>
      </form>
    </section>
    ${table(`${label} Inventory`, inventory, [...inventoryColumns(), ...(section === 'restaurant' ? [
      { label: 'Sale Price', value: (row) => money(pick(row, ['SalePrice', 'Price'])) },
      { label: 'For Sale', value: (row) => clean(row.Active || 'YES').toUpperCase() === 'NO' ? 'No' : 'Yes' }
    ] : []), { label: 'Edit', render: renderInventoryActions }])}
    ${table('Low Stock', data.lowStock || [], inventoryColumns())}
    ${section === 'clinic' ? table('Clinic Records', records, [
      { label: 'Date', value: (row) => pick(row, ['Date']) }, { label: 'Student', value: (row) => pick(row, ['StudentName']) },
      { label: 'Class', value: (row) => pick(row, ['ClassName']) }, { label: 'Complaint', value: (row) => pick(row, ['Complaint']) },
      { label: 'Treatment', value: (row) => pick(row, ['Treatment']) }, { label: 'Disposition', value: (row) => pick(row, ['Disposition']) }
    ]) : ''}
    ${section === 'tuckShop' ? `<div id="departmentPurchaseHistory">${table('Wallet Purchases', purchases, [
      { label: 'Date', value: (row) => pick(row, ['Date']) }, { label: 'Student', value: (row) => pick(row, ['DisplayName']) },
      { label: 'Class', value: (row) => pick(row, ['ClassName']) }, { label: 'Amount', value: (row) => money(pick(row, ['Debit'])) },
      { label: 'Description', value: (row) => pick(row, ['Description']) }
    ])}</div>` : ''}
    ${table('Recent Stock Movements', data.movements || [], [
      { label: 'Date', value: (row) => pick(row, ['Date']) }, { label: 'Item', value: (row) => pick(row, ['ItemName']) },
      { label: 'Type', value: (row) => pick(row, ['MovementType']) }, { label: 'Quantity', value: (row) => pick(row, ['Quantity']) },
      { label: 'Reason', value: (row) => pick(row, ['Reason']) }, { label: 'Recorded by', value: (row) => pick(row, ['RecordedBy']) }
    ])}`;
  panelEl.querySelector(':scope > .department-workspace-links')?.remove();
  const departmentCards = [...panelEl.querySelectorAll(':scope > .config-card')];
  const departmentCard = (pattern) => departmentCards.find((node) => pattern.test(clean(node.querySelector('h3')?.textContent)));
  const departmentTabs = [];
  if (section === 'restaurant') departmentTabs.push({ key: 'sales', label: 'Point of sale', icon: '\u{1F6D2}', nodes: document.getElementById('organizationCommercePOS') });
  if (section === 'tuckShop') departmentTabs.push({ key: 'sales', label: 'Student purchase', icon: '\u{1F6D2}', nodes: document.getElementById('tuckShopPOS') });
  if (section === 'clinic') {
    departmentTabs.push({ key: 'visits', label: 'Clinic visits', icon: '\u2695', count: records.length, nodes: [departmentCard(/record a clinic visit/i), workspaceTableNodes('Clinic Records')] });
    departmentTabs.push({ key: 'reports', label: 'Parent reports', icon: '\u2709', nodes: departmentCard(/email a clinic report/i) });
  }
  if (['clinic', 'kitchen', 'restaurant'].includes(section)) departmentTabs.push({ key: 'procurement', label: 'Market list', icon: '\u{1F4CB}', nodes: departmentCard(/market list/i) });
  departmentTabs.push({ key: 'inventory', label: 'Inventory', icon: '\u{1F4E6}', count: inventory.length, nodes: [document.getElementById('departmentInventoryWorkspace'), workspaceTableNodes(`${label} Inventory`), workspaceTableNodes('Low Stock')] });
  departmentTabs.push({ key: 'stock', label: 'Stock in / out', icon: '\u21C5', count: (data.movements || []).length, nodes: [document.getElementById('departmentStockWorkspace'), workspaceTableNodes('Recent Stock Movements')] });
  if (section === 'tuckShop') departmentTabs.push({ key: 'history', label: 'Purchase history', icon: '\u{1F5C2}', count: purchases.length, nodes: document.getElementById('departmentPurchaseHistory') });
  mountWorkspaceTabs(section, departmentTabs);
  if (section === 'restaurant') bindOrganizationCommerceWorkspace(section, data);
  const recordsHandoff = takeRecordsDeskHandoff(section);
  const selectedAccountRef = recordsDeskHandoffReference(recordsHandoff);
  if (selectedAccountRef && section === 'clinic') {
    const clinicRecordForm = document.getElementById('clinicRecordForm');
    const clinicReportForm = document.getElementById('clinicReportForm');
    if (clinicRecordForm?.elements?.AdmissionNo) clinicRecordForm.elements.AdmissionNo.value = selectedAccountRef;
    if (clinicReportForm?.elements?.AccountRef) clinicReportForm.elements.AccountRef.value = selectedAccountRef;
  }
  if (selectedAccountRef && section === 'tuckShop') {
    const walletLookupForm = document.getElementById('walletLookupForm');
    if (walletLookupForm?.elements?.AccountRef) {
      walletLookupForm.elements.AccountRef.value = selectedAccountRef;
      walletLookupForm.elements.AccountRef.focus();
    }
  }
  document.getElementById('refreshDepartmentOperations')?.addEventListener('click', (event) => {
    runButtonAction(event.currentTarget, 'Refreshing...', () => loadDepartmentOperations(section));
  });
  panelEl.querySelectorAll('[data-department-jump]').forEach((button) => button.addEventListener('click', () => {
    panelEl.querySelectorAll('[data-department-jump]').forEach((item) => item.classList.toggle('active', item === button));
    document.getElementById(button.dataset.departmentJump)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  document.getElementById('clinicRecordForm')?.addEventListener('submit', (event) => { event.preventDefault(); submitDepartmentAction(section, 'saveClinicRecord', event.currentTarget); });
  document.getElementById('walletLookupForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget; const status = form.querySelector('[data-department-status]');
    const button = event.submitter || form.querySelector('button[type="submit"]');
    try { await runButtonAction(button, 'Looking up...', () => requestDepartmentAction(section, 'lookupWallet', Object.fromEntries(new FormData(form).entries()))); }
    catch (error) { setStatus(status, error.message || String(error), 'bad'); }
  });
  const nfcButton = document.getElementById('tuckShopNfcScan');
  if (nfcButton) {
    nfcButton.classList.toggle('nfc-unavailable', !('NDEFReader' in window));
    nfcButton.title = 'NDEFReader' in window
      ? 'Scan a compatible NFC student card'
      : 'Direct NFC requires Android Chrome; USB readers and manual entry remain available';
    nfcButton.addEventListener('click', () => scanTuckShopNfc(document.getElementById('walletLookupForm'), nfcButton));
  }
  document.getElementById('walletPurchaseForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget; const status = form.querySelector('[data-department-status]');
    const button = event.submitter || form.querySelector('button[type="submit"]');
    const idempotencyKey = form.dataset.idempotencyKey || newIdempotencyKey();
    form.dataset.idempotencyKey = idempotencyKey;
    try {
      await runButtonAction(button, 'Recording purchase...', () => requestDepartmentAction(section, 'recordWalletPurchase', Object.fromEntries(new FormData(form).entries()), idempotencyKey));
      delete form.dataset.idempotencyKey;
    } catch (error) {
      if (error?.responseReceived) delete form.dataset.idempotencyKey;
      setStatus(status, error.message || String(error), 'bad');
    }
    form.addEventListener('input', () => {
      if (!button?.disabled) delete form.dataset.idempotencyKey;
    }, { once: true });
  });
  document.getElementById('prepareClinicReport')?.addEventListener('click', async (event) => {
    const form = document.getElementById('clinicReportForm'); const status = form.querySelector('[data-department-status]');
    try { await runButtonAction(event.currentTarget, 'Preparing...', () => requestDepartmentAction(section, 'prepareClinicReport', Object.fromEntries(new FormData(form).entries()))); }
    catch (error) { setStatus(status, error.message || String(error), 'bad'); }
  });
  document.getElementById('clinicReportForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget; const status = form.querySelector('[data-department-status]');
    const button = event.submitter || form.querySelector('button[type="submit"]');
    const idempotencyKey = form.dataset.idempotencyKey || newIdempotencyKey();
    form.dataset.idempotencyKey = idempotencyKey;
    try {
      await runButtonAction(button, 'Sending report...', () => requestDepartmentAction(section, 'sendClinicReport', Object.fromEntries(new FormData(form).entries()), idempotencyKey));
      delete form.dataset.idempotencyKey;
    } catch (error) {
      if (error?.responseReceived) delete form.dataset.idempotencyKey;
      setStatus(status, error.message || String(error), 'bad');
    }
    form.addEventListener('input', () => {
      if (!button?.disabled) delete form.dataset.idempotencyKey;
    }, { once: true });
  });
  document.getElementById('marketListForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget; const status = form.querySelector('[data-department-status]');
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.Items = [...form.querySelectorAll('[data-market-row]')].filter((row) => row.querySelector('input[type="checkbox"]').checked).map((row) => ({
      ItemName: row.querySelector('[data-item]').dataset.item,
      Unit: row.querySelector('[data-unit]').dataset.unit,
      OrderQuantity: row.querySelector('input[type="number"]').value
    }));
    const button = event.submitter || form.querySelector('button[type="submit"]');
    const idempotencyKey = form.dataset.idempotencyKey || newIdempotencyKey();
    form.dataset.idempotencyKey = idempotencyKey;
    try {
      await runButtonAction(button, 'Sending list...', () => requestDepartmentAction(section, 'sendMarketList', payload, idempotencyKey));
      delete form.dataset.idempotencyKey;
    } catch (error) {
      if (error?.responseReceived) delete form.dataset.idempotencyKey;
      setStatus(status, error.message || String(error), 'bad');
    }
    form.addEventListener('input', () => {
      if (!button?.disabled) delete form.dataset.idempotencyKey;
    }, { once: true });
  });
  document.getElementById('departmentInventoryForm')?.addEventListener('submit', (event) => { event.preventDefault(); submitDepartmentAction(section, 'saveItem', event.currentTarget); });
  document.getElementById('departmentMovementForm')?.addEventListener('submit', (event) => { event.preventDefault(); submitDepartmentAction(section, 'recordMovement', event.currentTarget); });
  panelEl.querySelectorAll('[data-edit-inventory]').forEach((button) => button.addEventListener('click', () => {
    const row = inventory.find((item) => clean(item.ItemName) === button.dataset.editInventory);
    const form = document.getElementById('departmentInventoryForm');
    if (!row || !form) return;
    ['ItemName', 'Category', 'Unit', 'Quantity', 'ReorderLevel', 'SalePrice', 'Notes'].forEach((key) => {
      if (!form.elements[key]) return;
      const value = row[key] ?? (key === 'SalePrice' ? row.Price : '');
      if (form.elements[key].matches('[data-finance-input]')) setFinancialInputValue(form.elements[key], value);
      else form.elements[key].value = value;
    });
    if (form.elements.Active) form.elements.Active.checked = clean(row.Active || 'YES').toUpperCase() !== 'NO';
    form.elements.OriginalItemName.value = row.ItemName;
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }));
}

async function loadDepartmentOperations(section) {
  try {
    const response = await staffFetch('/api/staff-departments', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'list', section })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.message || 'Could not load department operations.');
    renderDepartmentOperations(section, data);
  } catch (error) {
    if (activeSection === section) panelEl.innerHTML = `<p class="status bad">${escapeHtml(error.message || String(error))}</p>`;
  }
}

async function loadChurchMembership() {
  try {
    const response = await staffFetch('/api/staff-members', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list', BranchId: currentUser?.branchId || 'main' })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.message || 'Could not load church membership.');
    if (activeSection !== 'members') return;
    renderModuleSummary('members', data);
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
    document.getElementById('refreshChurchMembers')?.addEventListener('click', (event) => {
      runButtonAction(event.currentTarget, 'Refreshing...', loadChurchMembership);
    });
  } catch (error) {
    if (activeSection === 'members') panelEl.innerHTML = `<p class="status bad">${escapeHtml(error.message || String(error))}</p>`;
  }
}

function verticalBars(title, rows, labelKey, valueKey, tone = 'blue') {
  const maximum = Math.max(1, ...rows.map((row) => Number(row[valueKey] || 0)));
  return `<section class="department-chart-card"><h3>${escapeHtml(title)}</h3><div class="vertical-bar-chart" role="img" aria-label="${escapeHtml(title)}">${
    rows.length ? rows.map((row) => {
      const value = Number(row[valueKey] || 0);
      const height = Math.max(value ? 12 : 2, Math.round((value / maximum) * 100));
      return `<div class="vertical-bar-item"><strong>${escapeHtml(value)}</strong><span class="vertical-bar-track"><i class="${tone}" style="height:${height}%"></i></span><small>${escapeHtml(row[labelKey] || 'Unassigned')}</small></div>`;
    }).join('') : '<p class="muted">No recordings yet.</p>'
  }</div></section>`;
}

async function organizationDepartmentAction(action, payload = {}) {
  const response = await staffFetch('/api/staff-organization-departments', {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, BranchId: currentUser?.branchId || 'main', ...payload })
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.message || 'Department action failed.');
  return data;
}

function departmentFormPayload(form) {
  const payload = Object.fromEntries(new FormData(form).entries());
  form.querySelectorAll('[name]:disabled').forEach((input) => {
    payload[input.name] = input.value;
  });
  form.querySelectorAll('input[type="checkbox"][name]').forEach((input) => {
    payload[input.name] = input.checked ? (input.value || 'YES') : 'NO';
  });
  return payload;
}

function resetOrganizationRecordEditor(form, focus = false) {
  if (!form) return;
  form.reset();
  form.querySelectorAll('input[name^="Original"]').forEach((input) => {
    input.value = '';
  });
  const idInput = form.elements[form.dataset.recordIdField];
  if (idInput) {
    idInput.readOnly = false;
    idInput.removeAttribute('aria-readonly');
  }
  const parentInput = form.elements[form.dataset.recordParentField];
  if (parentInput) {
    parentInput.disabled = false;
    parentInput.removeAttribute('aria-disabled');
  }
  const heading = form.querySelector('[data-record-editor-heading], h3');
  const submitButton = form.querySelector('button[type="submit"]');
  const cancelButton = form.querySelector('[data-cancel-record-edit]');
  if (heading) heading.textContent = form.dataset.createHeading || 'Create record';
  if (submitButton) submitButton.textContent = form.dataset.createLabel || 'Save';
  if (cancelButton) cancelButton.hidden = true;
  delete form.dataset.editing;
  if (focus) idInput?.focus();
}

function beginOrganizationRecordEdit(form, row, {
  fields = [],
  originalFields = {},
  heading = 'Edit record',
  submitLabel = 'Update record',
  focusField = ''
} = {}) {
  if (!form || !row) return;
  resetOrganizationRecordEditor(form);
  fields.forEach((field) => {
    const input = form.elements[field];
    if (!input) return;
    const value = clean(row[field]);
    if (input.type === 'checkbox') {
      input.checked = !['no', 'false', '0', 'inactive'].includes(lower(value || 'YES'));
    } else {
      input.value = value;
    }
  });
  Object.entries(originalFields).forEach(([field, value]) => {
    if (form.elements[field]) form.elements[field].value = clean(value);
  });
  const idInput = form.elements[form.dataset.recordIdField];
  if (idInput) {
    idInput.readOnly = true;
    idInput.setAttribute('aria-readonly', 'true');
  }
  const parentInput = form.elements[form.dataset.recordParentField];
  if (parentInput) {
    parentInput.disabled = true;
    parentInput.setAttribute('aria-disabled', 'true');
  }
  const headingNode = form.querySelector('[data-record-editor-heading], h3');
  const submitButton = form.querySelector('button[type="submit"]');
  const cancelButton = form.querySelector('[data-cancel-record-edit]');
  if (headingNode) headingNode.textContent = heading;
  if (submitButton) submitButton.textContent = submitLabel;
  if (cancelButton) cancelButton.hidden = false;
  form.dataset.editing = 'true';
  form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  (form.elements[focusField] || idInput)?.focus();
}

function departmentOptions(rows, selected = '') {
  return `<option value="">Choose department</option>${rows.map((row) => {
    const id = clean(row.DepartmentId || row.__id);
    return `<option value="${escapeHtml(id)}"${id === selected ? ' selected' : ''}>${escapeHtml(row.Name || id)}</option>`;
  }).join('')}`;
}

function departmentWorkspace(data) {
  const departments = data.departments || [];
  const positions = data.departmentPositions || [];
  const members = data.members || [];
  const capabilities = data.capabilities || {};
  const canManageMembers = Boolean(capabilities.canManageMembers);
  const meetings = data.departmentMeetings || [];
  const offerings = data.departmentOfferings || [];
  const programs = data.specialPrograms || [];
  const departmentSummary = data.summaries?.departments || [];
  const areaSummary = data.summaries?.homeChurchAreas || [];
  const countrySummary = data.summaries?.participantsByCountry || [];
  const departmentCards = departmentSummary.map((row, index) => `
    <article class="module-stat tone-${(index % 5) + 1}">
      <strong>${escapeHtml(row.Name)}</strong>
      <span>${escapeHtml(row.Members)} members</span>
      <span>${escapeHtml(row.Meetings)} meetings</span>
      <small>${escapeHtml(row.Attendance)} attendance</small>
      <small>${money(row.Offerings)} offerings</small>
    </article>`).join('');
  return `
    <div class="workflow-intro"><div><p class="eyebrow">People and participation</p><h2>Departments</h2><p class="muted">Manage departments, positions, members, meetings, attendance, offerings and programs.</p></div><button type="button" id="refreshOrganizationDepartments" class="compact-action">↻ Refresh</button></div>
    <div class="module-summary-grid department-summary-grid">${departmentCards || '<p class="muted">Create the first department to begin.</p>'}</div>
    <div class="department-chart-grid">
      ${verticalBars('Attendance by department', departmentSummary, 'Name', 'Attendance', 'blue')}
      ${verticalBars('Offerings by department', departmentSummary, 'Name', 'Offerings', 'gold')}
      ${verticalBars('Home churches by area / zone', areaSummary, 'AreaZone', 'HomeChurches', 'emerald')}
      ${verticalBars('Weekly home-church attendance by area / zone', areaSummary, 'AreaZone', 'Attendance', 'purple')}
      ${verticalBars('Program participants by country', countrySummary, 'Country', 'Participants', 'coral')}
    </div>
    <div class="department-form-grid">
      <form class="workflow-card compact-form" data-department-action="saveDepartment">
        <h3>Create or edit department</h3>
        <input name="DepartmentId" placeholder="Department ID" required><input name="Name" placeholder="Department name" required>
        <select name="DepartmentType"><option>Department</option><option>Home Church</option><option>Home Cell</option><option>Foreign Desk</option></select>
        <input name="AreaZone" placeholder="Area / zone"><input name="Description" placeholder="Description">
        <label class="inline-check"><input type="checkbox" name="Active" value="YES" checked><span>Active</span></label>
        <button type="submit" data-loading-text="Saving department...">Save department</button>
      </form>
      <form class="workflow-card compact-form" data-department-action="savePosition">
        <h3>Position</h3><select name="DepartmentId" required>${departmentOptions(departments)}</select>
        <input name="PositionId" placeholder="Position ID" required><input name="Name" placeholder="Position name" required>
        <button type="submit">Save position</button>
      </form>
      <form class="workflow-card compact-form" data-department-action="saveDepartmentMember">
        <h3>Assign member</h3><select name="DepartmentId" required>${departmentOptions(departments)}</select>
        <select name="MemberId" required><option value="">Choose member</option>${members.map((row) => `<option value="${escapeHtml(row.MemberId || row.__id)}">${escapeHtml(row.DisplayName || row.MemberId)}</option>`).join('')}</select>
        <select name="PositionId"><option value="">No position</option>${positions.map((row) => `<option value="${escapeHtml(row.PositionId)}">${escapeHtml(row.Name)}</option>`).join('')}</select>
        <button type="submit">Assign member</button>
      </form>
      <form class="workflow-card compact-form" data-department-action="saveMeeting">
        <h3>Meeting</h3><select name="DepartmentId" required>${departmentOptions(departments)}</select>
        <input name="MeetingId" value="MTG-${Date.now()}" required><input name="Title" placeholder="Meeting title">
        <input name="Date" type="date" required><input name="AreaZone" placeholder="Area / zone"><input name="Location" placeholder="Location">
        <button type="submit">Save meeting</button>
      </form>
      <form class="workflow-card compact-form" data-department-action="recordAttendance">
        <h3>Meeting attendance</h3><select name="MeetingId" required><option value="">Choose meeting</option>${meetings.map((row) => `<option value="${escapeHtml(row.MeetingId)}">${escapeHtml(`${row.Date || ''} · ${row.Title || row.MeetingId}`)}</option>`).join('')}</select>
        <select name="MemberId"><option value="">Visitor / manual name</option>${members.map((row) => `<option value="${escapeHtml(row.MemberId || row.__id)}">${escapeHtml(row.DisplayName || row.MemberId)}</option>`).join('')}</select>
        <input name="DisplayName" placeholder="Attendee name"><button type="submit">Record attendance</button>
      </form>
      <form class="workflow-card compact-form" data-department-action="saveOffering">
        <h3>Submit departmental offering</h3><select name="DepartmentId" required>${departmentOptions(departments)}</select>
        <select name="MeetingId"><option value="">No linked meeting</option>${meetings.map((row) => `<option value="${escapeHtml(row.MeetingId)}">${escapeHtml(row.Title || row.MeetingId)}</option>`).join('')}</select>
        <input name="OfferingId" value="DOF-${Date.now()}" required><input name="Date" type="date" required>
        <input name="Amount" type="number" min="0.01" step="0.01" placeholder="Amount" data-finance-input required>
        <select name="PaymentMethod"><option>Cash</option><option>Online</option><option>Transfer</option><option>Card</option></select>
        <input name="PaymentReference" placeholder="Payment / remittance reference"><button type="submit">Submit offering</button>
      </form>
      <form class="workflow-card compact-form" data-department-action="saveProgram">
        <h3>Special program</h3><input name="ProgramId" value="PRG-${Date.now()}" required><input name="Name" placeholder="Program name" required>
        <input name="StartDate" type="date"><input name="EndDate" type="date"><input name="Venue" placeholder="Venue">
        <button type="submit">Save program</button>
      </form>
      <form class="workflow-card compact-form" data-department-action="registerParticipant">
        <h3>Register participant</h3><select name="ProgramId" required><option value="">Choose program</option>${programs.map((row) => `<option value="${escapeHtml(row.ProgramId)}">${escapeHtml(row.Name)}</option>`).join('')}</select>
        <input name="FullName" placeholder="Full name" required><input name="Country" placeholder="Country" required>
        <input name="Email" type="email" placeholder="Email"><input name="Phone" placeholder="Phone"><button type="submit">Register participant</button>
      </form>
      <form class="workflow-card compact-form" data-department-action="saveForeignVisitor">
        <h3>Foreign Desk visitor</h3><input name="FullName" placeholder="Visitor name" required><input name="Country" placeholder="Country" required>
        <input name="VisitDate" type="date"><input name="Email" type="email" placeholder="Email"><input name="Phone" placeholder="Phone">
        <input name="Purpose" placeholder="Purpose of visit"><button type="submit">Record visitor</button>
      </form>
    </div>
    ${table('Departments', departments, [
      { label: 'Department', value: (row) => row.Name },
      { label: 'Type', value: (row) => typeof genericOrganizationText === 'function' ? genericOrganizationText(row.DepartmentType) : row.DepartmentType },
      { label: 'Area / zone', value: (row) => row.AreaZone },
      { label: 'Status', value: (row) => row.Active },
      { label: 'Actions', render: (row) => `<button class="compact-icon-action compact-delete-action" data-delete-department="${escapeHtml(row.DepartmentId || row.__id)}" title="Delete department" aria-label="Delete ${escapeHtml(row.Name)}">✕</button>` }
    ])}
    ${table('Department members and positions', data.departmentMembers || [], [
      { label: 'Department', value: (row) => row.DepartmentName || row.DepartmentId },
      { label: 'Member', value: (row) => row.DisplayName || row.MemberId },
      { label: 'Position', value: (row) => row.PositionName || row.PositionId },
      { label: 'Status', value: (row) => row.Status },
      ...(canManageMembers ? [
        { label: 'Actions', render: (row) => `<button type="button" class="compact-icon-action compact-delete-action" data-remove-department-member="${escapeHtml(row.MembershipId || row.__id || `${row.DepartmentId || ''}--${row.MemberId || ''}`)}" data-member-name="${escapeHtml(row.DisplayName || row.MemberId || 'member')}" data-department-name="${escapeHtml(row.DepartmentName || row.DepartmentId || 'department')}" title="Remove from department" aria-label="Remove ${escapeHtml(row.DisplayName || row.MemberId || 'member')} from ${escapeHtml(row.DepartmentName || row.DepartmentId || 'department')}">&times;</button>` }
      ] : [])
    ])}
    ${table('Department offerings and remittance', offerings, [
      { label: 'Date', value: (row) => row.Date },
      { label: 'Department', value: (row) => row.DepartmentId },
      { label: 'Amount', value: (row) => money(row.Amount) },
      { label: 'Method', value: (row) => row.PaymentMethod },
      { label: 'Status', value: (row) => row.RemittanceStatus },
      { label: 'Accounting', render: (row) => lower(row.RemittanceStatus) === 'paid' ? '<span class="status good">✓ Paid</span>' : `<button class="compact-icon-action" data-mark-offering-paid="${escapeHtml(row.OfferingId)}" title="Confirm remittance" aria-label="Mark offering paid">✓</button>` }
    ])}
    ${table('Foreign Desk visitors', data.foreignVisitors || [], [
      { label: 'Visit date', value: (row) => row.VisitDate }, { label: 'Visitor', value: (row) => row.FullName },
      { label: 'Country', value: (row) => row.Country }, { label: 'Purpose', value: (row) => row.Purpose },
      { label: 'Follow-up', value: (row) => row.FollowUpOfficer }
    ])}
    <p id="organizationDepartmentStatus" class="status" aria-live="polite"></p>`;
}

function organizedDepartmentWorkspace(data) {
  const departments = data.departments || [];
  const positions = data.departmentPositions || [];
  const members = data.members || [];
  const assignablePeople = data.assignablePeople || members.map((row) => ({
    PersonKey: `member:${row.MemberId || row.__id}`,
    PersonType: 'Member',
    DisplayName: row.DisplayName || row.MemberId,
    Detail: row.MembershipStatus || 'Member'
  }));
  const capabilities = data.capabilities || {};
  const canManageDepartments = Boolean(capabilities.canManageDepartments);
  const canManageMembers = Boolean(capabilities.canManageMembers);
  const departmentMembers = data.departmentMembers || [];
  const meetings = data.departmentMeetings || [];
  const attendance = data.departmentAttendance || [];
  const offerings = data.departmentOfferings || [];
  const programs = data.specialPrograms || [];
  const registrations = data.programRegistrations || [];
  const visitors = data.foreignVisitors || [];
  const departmentSummary = data.summaries?.departments || [];
  const areaSummary = data.summaries?.homeChurchAreas || [];
  const countrySummary = data.summaries?.participantsByCountry || [];
  const tabs = [
    ['overview', '▦', 'Overview'],
    ['departments', '⌂', 'Departments'],
    ['members', '♟', 'Members & Positions'],
    ['meetings', '▣', 'Meetings & Attendance'],
    ['offerings', '₦', 'Offerings'],
    ['programs', '★', 'Programs & Visitors']
  ];
  if (!tabs.some(([key]) => key === organizationDepartmentWorkspaceTab)) organizationDepartmentWorkspaceTab = 'overview';
  const panelState = (key) => key === organizationDepartmentWorkspaceTab ? '' : ' hidden';
  const memberOptions = members.length
    ? `<option value="">Choose member</option>${members.map((row) => `<option value="${escapeHtml(row.MemberId || row.__id)}">${escapeHtml(row.DisplayName || row.MemberId)}</option>`).join('')}`
    : '<option value="">No registered members — create one first</option>';
  const meetingOptions = `<option value="">Choose meeting</option>${meetings.map((row) => `<option value="${escapeHtml(row.MeetingId)}">${escapeHtml(`${row.Date || ''} · ${row.Title || row.MeetingId}`)}</option>`).join('')}`;
  const positionOptions = `<option value="">No position</option>${positions.map((row) => `<option value="${escapeHtml(row.PositionId)}" data-department-id="${escapeHtml(row.DepartmentId)}">${escapeHtml(row.Name)}</option>`).join('')}`;
  const batchPeopleOptions = assignablePeople.map((row) => `
    <label class="department-batch-person check-row" data-batch-person-row data-person-search="${escapeHtml(lower(`${row.DisplayName || ''} ${row.PersonType || ''} ${row.Detail || ''} ${row.PersonId || ''}`))}">
      <input type="checkbox" name="PersonKey" value="${escapeHtml(row.PersonKey)}">
      <span><strong>${escapeHtml(row.DisplayName || row.PersonId)}</strong><small>${escapeHtml([row.PersonType, row.Detail].filter(Boolean).join(' · '))}</small></span>
      <em data-person-assignment-state></em>
    </label>`).join('');
  const programOptions = `<option value="">Choose program</option>${programs.map((row) => `<option value="${escapeHtml(row.ProgramId)}">${escapeHtml(row.Name)}</option>`).join('')}`;
  const departmentCards = departmentSummary.map((row, index) => `
    <article class="module-stat tone-${(index % 5) + 1}">
      <strong>${escapeHtml(row.Name)}</strong>
      <span>${escapeHtml(row.Members)} members</span>
      <span>${escapeHtml(row.Meetings)} meetings</span>
      <small>${escapeHtml(row.Attendance)} attendance</small>
      <small>${money(row.Offerings)} offerings</small>
    </article>`).join('');

  return `
    <div class="workflow-intro department-workspace-intro"><div><p class="eyebrow">People and participation</p><h2>Departments & Members</h2><p class="muted">Organise teams, responsibilities, meetings, participation, offerings and special programmes.</p></div><button type="button" id="refreshOrganizationDepartments" class="compact-action">↻ Refresh</button></div>
    <div class="module-summary-grid department-summary-grid">${departmentCards || '<p class="muted">Create the first department to begin.</p>'}</div>
    <nav class="organization-workspace-tabs" aria-label="Department workspaces">
      ${tabs.map(([key, icon, label]) => `<button type="button" data-organization-workspace-tab="${key}" class="${key === organizationDepartmentWorkspaceTab ? 'active' : ''}" aria-selected="${key === organizationDepartmentWorkspaceTab}"><span aria-hidden="true">${icon}</span>${escapeHtml(label)}</button>`).join('')}
    </nav>

    <section class="organization-workspace-panel" data-organization-workspace-panel="overview"${panelState('overview')}>
      <div class="department-panel-heading"><div><small>Recording summary</small><h3>Participation overview</h3></div><p>Compare attendance, offerings, home churches and programme reach.</p></div>
      <div class="department-chart-grid">
        ${verticalBars('Attendance by department', departmentSummary, 'Name', 'Attendance', 'blue')}
        ${verticalBars('Offerings by department', departmentSummary, 'Name', 'Offerings', 'gold')}
        ${verticalBars('Home churches by area / zone', areaSummary, 'AreaZone', 'HomeChurches', 'emerald')}
        ${verticalBars('Weekly home-church attendance by area / zone', areaSummary, 'AreaZone', 'Attendance', 'purple')}
        ${verticalBars('Program participants by country', countrySummary, 'Country', 'Participants', 'coral')}
      </div>
    </section>

    <section class="organization-workspace-panel" data-organization-workspace-panel="departments"${panelState('departments')}>
      <div class="department-panel-heading"><div><small>Organisation structure</small><h3>Departments</h3></div><p>Create, update or deactivate departments, home churches and the Foreign Desk.</p></div>
      ${canManageDepartments ? `<div class="department-import-actions">
        <button type="button" class="secondary compact-action" id="downloadDepartmentCsvTemplate">Download CSV template</button>
        <button type="button" class="compact-action" id="importDepartmentsCsv">Import departments</button>
        <input type="file" id="departmentsCsvFile" accept=".csv,text/csv" hidden>
      </div>` : ''}
      <div class="department-form-grid department-two-column-grid">
        <form id="organizationDepartmentEditor" class="workflow-card compact-form department-editor-card" data-department-action="saveDepartment" data-record-id-field="DepartmentId" data-create-heading="Create a department" data-create-label="Save department">
          <h3>Create a department</h3>
          <input type="hidden" name="OriginalDepartmentId">
          <input name="DepartmentId" placeholder="Department ID" required><input name="Name" placeholder="Department name" required>
          <select name="DepartmentType"><option>Department</option><option>Home Church</option><option>Home Cell</option><option>Foreign Desk</option></select>
          <input name="AreaZone" placeholder="Area / zone"><input name="MeetingFrequency" placeholder="Meeting frequency"><input name="Description" placeholder="Description">
          <label class="inline-check"><input type="checkbox" name="Active" value="YES" checked><span>Active</span></label>
          <div class="compact-row-actions"><button type="submit" data-loading-text="Saving department...">Save department</button><button type="button" class="secondary compact-action" data-cancel-record-edit hidden>Cancel edit</button></div>
        </form>
        <aside class="workflow-card department-guidance-card"><span aria-hidden="true">⌂</span><div><h3>Structure guidance</h3><p>Use departments for ministry teams, Home Church or Home Cell for area-based groups, and Foreign Desk for international visitors.</p><ul><li>Give every record a stable Department ID.</li><li>Add an area or zone for home churches.</li><li>Deactivate records that should remain in history.</li></ul></div></aside>
      </div>
      ${table('Department register', departments, [
        { label: 'Department', value: (row) => row.Name },
        { label: 'Type', value: (row) => typeof genericOrganizationText === 'function' ? genericOrganizationText(row.DepartmentType) : row.DepartmentType },
        { label: 'Area / zone', value: (row) => row.AreaZone },
        { label: 'Status', value: (row) => row.Active },
        ...(canManageDepartments ? [{ label: 'Actions', render: (row) => `<span class="compact-row-actions"><button type="button" class="compact-icon-action compact-edit-action" data-edit-department="${escapeHtml(row.DepartmentId || row.__id)}" title="Edit department" aria-label="Edit ${escapeHtml(row.Name)}">✎</button><button type="button" class="compact-icon-action compact-delete-action" data-delete-department="${escapeHtml(row.DepartmentId || row.__id)}" title="Delete department" aria-label="Delete ${escapeHtml(row.Name)}">✕</button></span>` }] : [])
      ])}
    </section>

    <section class="organization-workspace-panel" data-organization-workspace-panel="members"${panelState('members')}>
      <div class="department-panel-heading"><div><small>People and responsibilities</small><h3>Members & Positions</h3></div><p>Register people, define positions and assign members to department responsibilities.</p></div>
      ${canManageMembers ? `<div class="department-import-actions">
        <button type="button" class="secondary compact-action" id="downloadMemberCsvTemplate">Download CSV template</button>
        <button type="button" class="compact-action" id="importMembersCsv">Import members</button>
        <input type="file" id="membersCsvFile" accept=".csv,text/csv" hidden>
      </div>` : ''}
      <div class="department-member-onboarding">
        <strong>New here?</strong>
        <span>1. Register the member. 2. Create a position if needed. 3. Assign the member to a department.</span>
      </div>
      <div class="department-form-grid department-three-column-grid">
        <form id="organizationMemberEditor" class="workflow-card compact-form department-member-create-card" data-department-action="saveChurchMember" data-record-id-field="MemberId" data-create-heading="Register a member" data-create-label="Create member">
          <h3>Register a member</h3>
          <input type="hidden" name="OriginalMemberId">
          <input name="MemberId" value="MEM-${Date.now()}" placeholder="Member ID" required>
          <input name="DisplayName" placeholder="Full display name" required>
          <div class="department-member-name-grid">
            <input name="FirstName" placeholder="First name">
            <input name="Surname" placeholder="Surname">
          </div>
          <input name="Phone" inputmode="tel" placeholder="Phone">
          <input name="Email" type="email" placeholder="Email">
          <select name="Gender"><option value="">Gender (optional)</option><option>Male</option><option>Female</option></select>
          <input name="MembershipDate" type="date" value="${new Date().toISOString().slice(0, 10)}">
          <select name="MembershipStatus"><option>Active</option><option>Visitor</option><option>Inactive</option><option>Transferred</option></select>
          <div class="compact-row-actions"><button type="submit">Create member</button><button type="button" class="secondary compact-action" data-cancel-record-edit hidden>Cancel edit</button></div>
        </form>
        <form id="organizationPositionEditor" class="workflow-card compact-form" data-department-action="savePosition" data-record-id-field="PositionId" data-record-parent-field="DepartmentId" data-create-heading="Create a position" data-create-label="Save position"><h3>Create a position</h3><input type="hidden" name="OriginalPositionId"><input type="hidden" name="OriginalDepartmentId"><select name="DepartmentId" required>${departmentOptions(departments)}</select><input name="PositionId" placeholder="Position ID" required><input name="Name" placeholder="Position name" required><input name="Description" placeholder="Description"><label class="inline-check"><input type="checkbox" name="Active" value="YES" checked><span>Active</span></label><div class="compact-row-actions"><button type="submit">Save position</button><button type="button" class="secondary compact-action" data-cancel-record-edit hidden>Cancel edit</button></div></form>
        <form class="workflow-card compact-form department-member-assignment-form" data-department-action="saveDepartmentMember"><h3>Assign a member</h3><select name="DepartmentId" required>${departmentOptions(departments)}</select><select name="MemberId" required${members.length ? '' : ' disabled'}>${memberOptions}</select><select name="PositionId">${positionOptions}</select><input name="JoinedDate" type="date" value="${new Date().toISOString().slice(0, 10)}"><select name="Status"><option>Active</option><option>Inactive</option></select><button type="submit"${departments.length && members.length ? '' : ' disabled'}>Assign member</button>${departments.length ? '' : '<small class="muted">Create a department before assigning members.</small>'}${members.length ? '' : '<small class="muted">Register the first member before making an assignment.</small>'}</form>
      </div>
      ${canManageMembers ? `
        <form id="departmentBatchAssignmentForm" class="workflow-card department-batch-assignment">
          <div class="department-batch-heading"><div><small>Batch assignment</small><h3>Assign multiple members or staff</h3><p>Select a department to display everyone available for assignment.</p></div><strong data-batch-selected-count>0 selected</strong></div>
          <div class="department-batch-controls">
            <label>Department<select name="DepartmentId" required>${departmentOptions(departments)}</select></label>
            <label>Joined date<input name="JoinedDate" type="date" value="${new Date().toISOString().slice(0, 10)}"></label>
            <label>Status<select name="Status"><option>Active</option><option>Inactive</option></select></label>
          </div>
          <div class="department-batch-tools" data-batch-people-tools hidden>
            <label>Find a person<input type="search" id="departmentBatchPersonSearch" placeholder="Search members or staff"></label>
            <div><button type="button" class="secondary compact-action" data-batch-select-all>Select all</button><button type="button" class="secondary compact-action" data-batch-clear>Clear</button></div>
          </div>
          <div id="departmentBatchPeople" class="department-batch-people" hidden>${batchPeopleOptions || '<p class="muted">No eligible members or staff accounts were found.</p>'}</div>
          <div class="department-batch-actions"><p class="status" data-batch-assignment-status></p><button type="submit" disabled>Assign selected people</button></div>
        </form>` : ''}
      ${table('Registered members', members, [
        { label: 'Member ID', value: (row) => row.MemberId || row.__id },
        { label: 'Name', value: (row) => row.DisplayName },
        { label: 'Phone', value: (row) => row.Phone },
        { label: 'Email', value: (row) => row.Email },
        { label: 'Status', value: (row) => row.MembershipStatus },
        ...(canManageMembers ? [{ label: 'Actions', render: (row) => `<span class="compact-row-actions"><button type="button" class="compact-icon-action compact-edit-action" data-edit-member="${escapeHtml(row.MemberId || row.__id)}" title="Edit member" aria-label="Edit ${escapeHtml(row.DisplayName || row.MemberId || 'member')}">✎</button><button type="button" class="compact-icon-action compact-delete-action" data-delete-member="${escapeHtml(row.MemberId || row.__id)}" data-member-name="${escapeHtml(row.DisplayName || row.MemberId || 'member')}" title="Delete member profile" aria-label="Delete ${escapeHtml(row.DisplayName || row.MemberId || 'member')}">✕</button></span>` }] : [])
      ])}
      ${table('Department positions', positions, [
        { label: 'Department', value: (row) => row.DepartmentName || row.DepartmentId },
        { label: 'Position', value: (row) => row.Name || row.PositionName || row.PositionId },
        { label: 'Status', value: (row) => row.Active },
        ...(canManageDepartments ? [{ label: 'Actions', render: (row) => `<span class="compact-row-actions"><button type="button" class="compact-icon-action compact-edit-action" data-edit-position="${escapeHtml(row.PositionId || row.__id)}" data-position-department="${escapeHtml(row.DepartmentId)}" title="Edit position" aria-label="Edit ${escapeHtml(row.Name || row.PositionName || row.PositionId || 'position')}">✎</button><button type="button" class="compact-icon-action compact-delete-action" data-delete-position="${escapeHtml(row.PositionId || row.__id)}" data-position-department="${escapeHtml(row.DepartmentId)}" data-position-name="${escapeHtml(row.Name || row.PositionName || row.PositionId || 'position')}" title="Delete position" aria-label="Delete ${escapeHtml(row.Name || row.PositionName || row.PositionId || 'position')}">✕</button></span>` }] : [])
      ])}
      ${table('Department members and positions', departmentMembers, [
        { label: 'Department', value: (row) => row.DepartmentName || row.DepartmentId },
        { label: 'Person', value: (row) => row.DisplayName || row.MemberId || row.StaffUsername },
        { label: 'Type', value: (row) => typeof genericOrganizationText === 'function' ? genericOrganizationText(row.PersonType || (row.StaffId ? 'Staff' : 'Member')) : (row.PersonType || (row.StaffId ? 'Staff' : 'Member')) },
        { label: 'Position', value: (row) => row.PositionName || row.PositionId },
        { label: 'Status', value: (row) => row.Status },
        ...(canManageMembers ? [
          { label: 'Actions', render: (row) => `<button type="button" class="compact-icon-action compact-delete-action" data-remove-department-member="${escapeHtml(row.MembershipId || row.__id || `${row.DepartmentId || ''}--${row.MemberId || ''}`)}" data-member-name="${escapeHtml(row.DisplayName || row.MemberId || 'member')}" data-department-name="${escapeHtml(row.DepartmentName || row.DepartmentId || 'department')}" title="Remove from department" aria-label="Remove ${escapeHtml(row.DisplayName || row.MemberId || 'member')} from ${escapeHtml(row.DepartmentName || row.DepartmentId || 'department')}">&times;</button>` }
        ] : [])
      ])}
    </section>

    <section class="organization-workspace-panel" data-organization-workspace-panel="meetings"${panelState('meetings')}>
      <div class="department-panel-heading"><div><small>Gatherings and participation</small><h3>Meetings & Attendance</h3></div><p>Schedule a department meeting, then record members or visitors who attended.</p></div>
      <div class="department-form-grid department-two-column-grid">
        <form class="workflow-card compact-form" data-department-action="saveMeeting"><h3>Create a meeting</h3><select name="DepartmentId" required>${departmentOptions(departments)}</select><input name="MeetingId" value="MTG-${Date.now()}" required><input name="Title" placeholder="Meeting title"><input name="Date" type="date" required><input name="AreaZone" placeholder="Area / zone"><input name="Location" placeholder="Location"><button type="submit">Save meeting</button></form>
        <form class="workflow-card compact-form" data-department-action="recordAttendance"><h3>Record attendance</h3><select name="MeetingId" required>${meetingOptions}</select><select name="MemberId"><option value="">Visitor / manual name</option>${memberOptions.replace('<option value="">Choose member</option>', '')}</select><input name="DisplayName" placeholder="Attendee name"><button type="submit">Record attendance</button></form>
      </div>
      ${table('Meeting register', meetings, [
        { label: 'Date', value: (row) => row.Date }, { label: 'Department', value: (row) => row.DepartmentName || row.DepartmentId },
        { label: 'Meeting', value: (row) => row.Title || row.MeetingId }, { label: 'Area / zone', value: (row) => row.AreaZone }, { label: 'Location', value: (row) => row.Location }
      ])}
      ${table('Attendance register', attendance, [
        { label: 'Meeting', value: (row) => row.MeetingId }, { label: 'Attendee', value: (row) => row.DisplayName || row.MemberId },
        { label: 'Type', value: (row) => typeof genericOrganizationText === 'function' ? genericOrganizationText(row.MemberId ? 'Member' : 'Visitor') : (row.MemberId ? 'Member' : 'Visitor') }, { label: 'Recorded at', value: (row) => row.RecordedAt || row.CreatedAt }
      ])}
    </section>

    <section class="organization-workspace-panel" data-organization-workspace-panel="offerings"${panelState('offerings')}>
      <div class="department-panel-heading"><div><small>Department finance</small><h3>Offerings & Remittance</h3></div><p>Submit meeting offerings and track their remittance to Accounts.</p></div>
      <div class="department-form-grid department-single-form-grid">
        <form class="workflow-card compact-form" data-department-action="saveOffering"><h3>Submit departmental offering</h3><select name="DepartmentId" required>${departmentOptions(departments)}</select><select name="MeetingId"><option value="">No linked meeting</option>${meetings.map((row) => `<option value="${escapeHtml(row.MeetingId)}">${escapeHtml(row.Title || row.MeetingId)}</option>`).join('')}</select><input name="OfferingId" value="DOF-${Date.now()}" required><input name="Date" type="date" required><input name="Amount" type="number" min="0.01" step="0.01" placeholder="Amount" data-finance-input required><select name="PaymentMethod"><option>Cash</option><option>Online</option><option>Transfer</option><option>Card</option></select><input name="PaymentReference" placeholder="Payment / remittance reference"><button type="submit">Submit offering</button></form>
      </div>
      ${table('Department offerings and remittance', offerings, [
        { label: 'Date', value: (row) => row.Date }, { label: 'Department', value: (row) => row.DepartmentName || row.DepartmentId },
        { label: 'Amount', value: (row) => money(row.Amount) }, { label: 'Method', value: (row) => row.PaymentMethod },
        { label: 'Status', value: (row) => row.RemittanceStatus },
        { label: 'Accounting', render: (row) => lower(row.RemittanceStatus) === 'paid' ? '<span class="status good">✓ Paid</span>' : `<button class="compact-icon-action" data-mark-offering-paid="${escapeHtml(row.OfferingId)}" title="Confirm remittance" aria-label="Mark offering paid">✓</button>` }
      ])}
    </section>

    <section class="organization-workspace-panel" data-organization-workspace-panel="programs"${panelState('programs')}>
      <div class="department-panel-heading"><div><small>Programmes and visitor care</small><h3>Programs & Foreign Visitors</h3></div><p>Create programmes, register participants by country, and manage Foreign Desk visitors.</p></div>
      <div class="department-form-grid department-three-column-grid">
        <form class="workflow-card compact-form" data-department-action="saveProgram"><h3>Special program</h3><input name="ProgramId" value="PRG-${Date.now()}" required><input name="Name" placeholder="Program name" required><input name="StartDate" type="date"><input name="EndDate" type="date"><input name="Venue" placeholder="Venue"><button type="submit">Save program</button></form>
        <form class="workflow-card compact-form" data-department-action="registerParticipant"><h3>Register participant</h3><select name="ProgramId" required>${programOptions}</select><input name="FullName" placeholder="Full name" required><input name="Country" placeholder="Country" required><input name="Email" type="email" placeholder="Email"><input name="Phone" placeholder="Phone"><button type="submit">Register participant</button></form>
        <form class="workflow-card compact-form" data-department-action="saveForeignVisitor"><h3>Foreign Desk visitor</h3><input name="FullName" placeholder="Visitor name" required><input name="Country" placeholder="Country" required><input name="VisitDate" type="date"><input name="Email" type="email" placeholder="Email"><input name="Phone" placeholder="Phone"><input name="Purpose" placeholder="Purpose of visit"><button type="submit">Record visitor</button></form>
      </div>
      ${table('Special programs', programs, [
        { label: 'Program', value: (row) => row.Name }, { label: 'Start', value: (row) => row.StartDate }, { label: 'End', value: (row) => row.EndDate }, { label: 'Venue', value: (row) => row.Venue }
      ])}
      ${table('Program participants', registrations, [
        { label: 'Program', value: (row) => row.ProgramName || row.ProgramId }, { label: 'Participant', value: (row) => row.FullName },
        { label: 'Country', value: (row) => row.Country }, { label: 'Email', value: (row) => row.Email }, { label: 'Phone', value: (row) => row.Phone }
      ])}
      ${table('Foreign Desk visitors', visitors, [
        { label: 'Visit date', value: (row) => row.VisitDate }, { label: 'Visitor', value: (row) => row.FullName },
        { label: 'Country', value: (row) => row.Country }, { label: 'Purpose', value: (row) => row.Purpose }, { label: 'Follow-up', value: (row) => row.FollowUpOfficer }
      ])}
    </section>
    <p id="organizationDepartmentStatus" class="status organization-workspace-status" aria-live="polite"></p>`;
}

function setOrganizationDepartmentWorkspaceTab(tab) {
  const allowed = ['overview', 'departments', 'members', 'meetings', 'offerings', 'programs'];
  organizationDepartmentWorkspaceTab = allowed.includes(tab) ? tab : 'overview';
  try { window.localStorage.setItem(workspaceViewStorageKey('members'), organizationDepartmentWorkspaceTab); } catch (_error) { /* optional */ }
  const url = new URL(window.location.href);
  url.searchParams.set('section', 'members');
  url.searchParams.set('view', organizationDepartmentWorkspaceTab);
  window.history.replaceState(window.history.state, '', url);
  panelEl.querySelectorAll('[data-organization-workspace-tab]').forEach((button) => {
    const selected = button.dataset.organizationWorkspaceTab === organizationDepartmentWorkspaceTab;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', selected ? 'true' : 'false');
  });
  panelEl.querySelectorAll('[data-organization-workspace-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.organizationWorkspacePanel !== organizationDepartmentWorkspaceTab;
  });
}

async function loadOrganizationDepartments() {
  try {
    const data = await organizationDepartmentAction('list');
    if (activeSection !== 'members') return;
    organizationDepartmentWorkspaceTab = savedWorkspaceView('members', [
      { key: 'overview', label: 'Overview' },
      { key: 'departments', label: 'Departments' },
      { key: 'members', label: 'Members & Positions' },
      { key: 'meetings', label: 'Meetings & Attendance' },
      { key: 'offerings', label: 'Offerings' },
      { key: 'programs', label: 'Programs & Visitors' }
    ]) || organizationDepartmentWorkspaceTab;
    panelEl.innerHTML = organizedDepartmentWorkspace(data);
    const status = document.getElementById('organizationDepartmentStatus');
    document.getElementById('refreshOrganizationDepartments')?.addEventListener('click', (event) => {
      runButtonAction(event.currentTarget, 'Refreshing...', loadOrganizationDepartments);
    });
    panelEl.querySelectorAll('[data-organization-workspace-tab]').forEach((button) => button.addEventListener('click', () => {
      setOrganizationDepartmentWorkspaceTab(button.dataset.organizationWorkspaceTab);
    }));
    setOrganizationDepartmentWorkspaceTab(organizationDepartmentWorkspaceTab);
    document.getElementById('downloadDepartmentCsvTemplate')?.addEventListener('click', () => {
      const organizationEdition = resolveDashboardEdition(currentUser || {}) === 'organization';
      downloadCsvFile(
        'departments_import_template.csv',
        organizationEdition
          ? 'DepartmentId,Name,DepartmentType,AreaZone,Description,MeetingFrequency,Active\nOPS,Operations,Department,,Core operations,Weekly,YES\n'
          : 'DepartmentId,Name,DepartmentType,AreaZone,Description,MeetingFrequency,Active\nCHOIR,Choir,Department,,Music ministry,Weekly,YES\n'
      );
    });
    document.getElementById('downloadMemberCsvTemplate')?.addEventListener('click', () => {
      const organizationEdition = resolveDashboardEdition(currentUser || {}) === 'organization';
      downloadCsvFile(
        organizationEdition ? 'personnel_import_template.csv' : 'members_import_template.csv',
        `MemberId,DisplayName,FirstName,Surname,Phone,Email,Gender,MembershipDate,MembershipStatus\n${organizationEdition ? 'PER' : 'MEM'}-001,Ada Okafor,Ada,Okafor,+2348000000000,ada@example.com,Female,2026-07-29,Active\n`
      );
    });
    document.getElementById('importDepartmentsCsv')?.addEventListener('click', () => {
      document.getElementById('departmentsCsvFile')?.click();
    });
    document.getElementById('importMembersCsv')?.addEventListener('click', () => {
      document.getElementById('membersCsvFile')?.click();
    });
    document.getElementById('departmentsCsvFile')?.addEventListener('change', (event) => {
      importOrganizationCsv(event, {
        action: 'importDepartments',
        payloadKey: 'departments',
        buttonId: 'importDepartmentsCsv',
        loadingText: 'Importing departments...'
      }, status);
    });
    document.getElementById('membersCsvFile')?.addEventListener('change', (event) => {
      importOrganizationCsv(event, {
        action: 'importMembers',
        payloadKey: 'members',
        buttonId: 'importMembersCsv',
        loadingText: 'Importing members...'
      }, status);
    });
    const recordsHandoff = takeRecordsDeskHandoff('members');
    const selectedDepartmentId = clean(recordsHandoff?.context?.DepartmentId);
    const selectedMemberId = clean(recordsHandoff?.context?.MemberId);
    if (selectedDepartmentId) {
      const department = (data.departments || []).find((row) => recordsDeskRowMatches(
        row,
        selectedDepartmentId,
        ['DepartmentId', '__id']
      ));
      const form = document.getElementById('organizationDepartmentEditor');
      if (department && form) {
        setOrganizationDepartmentWorkspaceTab('departments');
        beginOrganizationRecordEdit(form, department, {
          fields: ['DepartmentId', 'Name', 'DepartmentType', 'AreaZone', 'MeetingFrequency', 'Description', 'Active'],
          originalFields: { OriginalDepartmentId: department.DepartmentId || department.__id },
          heading: 'Edit department',
          submitLabel: 'Update department',
          focusField: 'Name'
        });
      }
    } else if (selectedMemberId) {
      setOrganizationDepartmentWorkspaceTab('members');
      panelEl.querySelectorAll('select[name="MemberId"]').forEach((select) => {
        const option = [...select.options].find((item) =>
          recordsDeskReferenceKey(item.value) === recordsDeskReferenceKey(selectedMemberId));
        if (option) select.value = option.value;
      });
    }
    panelEl.querySelectorAll('.department-member-assignment-form').forEach((form) => {
      const departmentSelect = form.elements.DepartmentId;
      const positionSelect = form.elements.PositionId;
      const syncPositions = () => {
        const departmentId = clean(departmentSelect?.value);
        [...(positionSelect?.options || [])].forEach((option, index) => {
          const available = index === 0 || !departmentId
            || clean(option.dataset.departmentId) === departmentId;
          option.hidden = !available;
          option.disabled = !available;
        });
        if (positionSelect?.selectedOptions?.[0]?.disabled) positionSelect.value = '';
      };
      departmentSelect?.addEventListener('change', syncPositions);
      syncPositions();
    });
    const batchAssignmentForm = document.getElementById('departmentBatchAssignmentForm');
    if (batchAssignmentForm) {
      const departmentSelect = batchAssignmentForm.elements.DepartmentId;
      const peopleContainer = document.getElementById('departmentBatchPeople');
      const peopleTools = batchAssignmentForm.querySelector('[data-batch-people-tools]');
      const searchInput = document.getElementById('departmentBatchPersonSearch');
      const submitButton = batchAssignmentForm.querySelector('button[type="submit"]');
      const selectedCount = batchAssignmentForm.querySelector('[data-batch-selected-count]');
      const personRows = [...batchAssignmentForm.querySelectorAll('[data-batch-person-row]')];
      const assignmentKey = (row) => clean(row.PersonKey) || (
        clean(row.PersonType).toLowerCase() === 'staff' || clean(row.StaffId)
          ? `staff:${clean(row.StaffId || row.StaffUsername)}`
          : `member:${clean(row.MemberId)}`
      );
      const updateBatchSelection = () => {
        const chosen = personRows.filter((row) => {
          const input = row.querySelector('input[name="PersonKey"]');
          return input?.checked && !input.disabled;
        }).length;
        if (selectedCount) selectedCount.textContent = `${chosen} selected`;
        if (submitButton) submitButton.disabled = !clean(departmentSelect?.value) || chosen === 0;
      };
      const syncBatchPeople = () => {
        const departmentId = clean(departmentSelect?.value);
        const existing = new Set((data.departmentMembers || [])
          .filter((row) => clean(row.DepartmentId) === departmentId)
          .map((row) => lower(assignmentKey(row)))
          .filter(Boolean));
        if (peopleContainer) peopleContainer.hidden = !departmentId;
        if (peopleTools) peopleTools.hidden = !departmentId;
        if (searchInput) searchInput.value = '';
        personRows.forEach((row) => {
          row.hidden = false;
          const input = row.querySelector('input[name="PersonKey"]');
          const alreadyAssigned = Boolean(departmentId && existing.has(lower(input?.value)));
          if (input) {
            input.checked = alreadyAssigned;
            input.disabled = !departmentId || alreadyAssigned;
          }
          row.classList.toggle('is-assigned', alreadyAssigned);
          const state = row.querySelector('[data-person-assignment-state]');
          if (state) state.textContent = alreadyAssigned ? 'Already assigned' : '';
        });
        updateBatchSelection();
      };
      departmentSelect?.addEventListener('change', syncBatchPeople);
      searchInput?.addEventListener('input', () => {
        const query = lower(searchInput.value);
        personRows.forEach((row) => { row.hidden = Boolean(query && !clean(row.dataset.personSearch).includes(query)); });
      });
      batchAssignmentForm.querySelector('[data-batch-select-all]')?.addEventListener('click', () => {
        personRows.forEach((row) => {
          const input = row.querySelector('input[name="PersonKey"]');
          if (!row.hidden && input && !input.disabled) input.checked = true;
        });
        updateBatchSelection();
      });
      batchAssignmentForm.querySelector('[data-batch-clear]')?.addEventListener('click', () => {
        personRows.forEach((row) => {
          const input = row.querySelector('input[name="PersonKey"]');
          if (input && !input.disabled) input.checked = false;
        });
        updateBatchSelection();
      });
      personRows.forEach((row) => row.querySelector('input[name="PersonKey"]')?.addEventListener('change', updateBatchSelection));
      batchAssignmentForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (batchAssignmentForm.dataset.submitting === 'true' || submitButton?.disabled) return;
        const PersonKeys = personRows.map((row) => row.querySelector('input[name="PersonKey"]'))
          .filter((input) => input?.checked && !input.disabled)
          .map((input) => input.value);
        if (!PersonKeys.length) {
          setStatus(batchAssignmentForm.querySelector('[data-batch-assignment-status]'), 'Select at least one member or staff account.', 'bad');
          return;
        }
        batchAssignmentForm.dataset.submitting = 'true';
        setButtonLoading(submitButton, true, 'Assigning...', 'Assign selected people');
        try {
          const result = await organizationDepartmentAction('batchAssignDepartmentPeople', {
            DepartmentId: departmentSelect.value,
            JoinedDate: batchAssignmentForm.elements.JoinedDate.value,
            Status: batchAssignmentForm.elements.Status.value,
            PersonKeys
          });
          await loadOrganizationDepartments();
          setStatus(dashboardStatus, result.message || 'Selected people assigned.', 'good');
        } catch (error) {
          setStatus(batchAssignmentForm.querySelector('[data-batch-assignment-status]'), error.message || String(error), 'bad');
          delete batchAssignmentForm.dataset.submitting;
          if (submitButton.isConnected) setButtonLoading(submitButton, false, 'Assigning...', 'Assign selected people');
        }
      });
      syncBatchPeople();
    }
    panelEl.querySelectorAll('[data-department-action]').forEach((form) => form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submitButton = form.querySelector('button[type="submit"]');
      if (form.dataset.submitting === 'true' || submitButton?.disabled) return;
      const normalText = clean(submitButton?.textContent) || 'Save';
      const loadingText = clean(submitButton?.dataset.loadingText) || 'Saving...';
      form.dataset.submitting = 'true';
      if (submitButton) setButtonLoading(submitButton, true, loadingText, normalText);
      try {
        setStatus(status, 'Saving...');
        const result = await organizationDepartmentAction(form.dataset.departmentAction, departmentFormPayload(form));
        setStatus(status, result.message || 'Saved.', 'good');
        if (form.matches('[data-record-id-field]')) resetOrganizationRecordEditor(form);
        await loadOrganizationDepartments();
      } catch (error) {
        setStatus(status, error.message || String(error), 'bad');
      } finally {
        delete form.dataset.submitting;
        if (submitButton?.isConnected) setButtonLoading(submitButton, false, loadingText, normalText);
      }
    }));
    panelEl.querySelectorAll('[data-edit-department]').forEach((button) => button.addEventListener('click', () => {
      const department = (data.departments || []).find((row) => clean(row.DepartmentId || row.__id) === clean(button.dataset.editDepartment));
      const form = document.getElementById('organizationDepartmentEditor');
      if (!department || !form) return;
      setOrganizationDepartmentWorkspaceTab('departments');
      beginOrganizationRecordEdit(form, department, {
        fields: ['DepartmentId', 'Name', 'DepartmentType', 'AreaZone', 'MeetingFrequency', 'Description', 'Active'],
        originalFields: { OriginalDepartmentId: department.DepartmentId || department.__id },
        heading: 'Edit department',
        submitLabel: 'Update department',
        focusField: 'Name'
      });
    }));
    panelEl.querySelectorAll('[data-edit-member]').forEach((button) => button.addEventListener('click', () => {
      const member = (data.members || []).find((row) => clean(row.MemberId || row.__id) === clean(button.dataset.editMember));
      const form = document.getElementById('organizationMemberEditor');
      if (!member || !form) return;
      setOrganizationDepartmentWorkspaceTab('members');
      beginOrganizationRecordEdit(form, member, {
        fields: ['MemberId', 'DisplayName', 'FirstName', 'Surname', 'Phone', 'Email', 'Gender', 'MembershipDate', 'MembershipStatus'],
        originalFields: { OriginalMemberId: member.MemberId || member.__id },
        heading: 'Edit member',
        submitLabel: 'Update member',
        focusField: 'DisplayName'
      });
    }));
    panelEl.querySelectorAll('[data-edit-position]').forEach((button) => button.addEventListener('click', () => {
      const position = (data.departmentPositions || []).find((row) =>
        clean(row.PositionId || row.__id) === clean(button.dataset.editPosition)
        && clean(row.DepartmentId) === clean(button.dataset.positionDepartment));
      const form = document.getElementById('organizationPositionEditor');
      if (!position || !form) return;
      setOrganizationDepartmentWorkspaceTab('members');
      beginOrganizationRecordEdit(form, position, {
        fields: ['DepartmentId', 'PositionId', 'Name', 'Description', 'Active'],
        originalFields: {
          OriginalPositionId: position.PositionId || position.__id,
          OriginalDepartmentId: position.DepartmentId
        },
        heading: 'Edit position',
        submitLabel: 'Update position',
        focusField: 'Name'
      });
    }));
    panelEl.querySelectorAll('[data-cancel-record-edit]').forEach((button) => button.addEventListener('click', () => {
      resetOrganizationRecordEditor(button.closest('form'), true);
      setStatus(status, 'Edit cancelled.');
    }));
    panelEl.querySelectorAll('[data-delete-department]').forEach((button) => button.addEventListener('click', async () => {
      if (!await window.DynamaxDialogs.confirm({ title: 'Delete department', message: 'Departments with members or meetings cannot be deleted.', tone: 'danger', confirmText: 'Delete department' })) return;
      try {
        await runButtonAction(button, 'Deleting...', async () => {
          await organizationDepartmentAction('deleteDepartment', { DepartmentId: button.dataset.deleteDepartment });
          await loadOrganizationDepartments();
        });
      }
      catch (error) { setStatus(status, error.message || String(error), 'bad'); }
    }));
    panelEl.querySelectorAll('[data-delete-member]').forEach((button) => button.addEventListener('click', async () => {
      const memberName = clean(button.dataset.memberName) || 'this member';
      if (!await window.DynamaxDialogs.confirm({ title: 'Delete member profile', message: `Permanently delete ${memberName}'s member profile? Remove the member from every department first.`, tone: 'danger', confirmText: 'Delete profile' })) return;
      try {
        await runButtonAction(button, 'Deleting...', async () => {
          const result = await organizationDepartmentAction('deleteMember', {
            MemberId: button.dataset.deleteMember
          });
          setStatus(status, result.message || 'Member profile deleted.', 'good');
          await loadOrganizationDepartments();
        });
      } catch (error) {
        setStatus(status, error.message || String(error), 'bad');
      }
    }));
    panelEl.querySelectorAll('[data-delete-position]').forEach((button) => button.addEventListener('click', async () => {
      const positionName = clean(button.dataset.positionName) || 'this position';
      if (!await window.DynamaxDialogs.confirm({ title: 'Delete position', message: `Delete ${positionName}? Reassign or remove any member using this position first.`, tone: 'danger', confirmText: 'Delete position' })) return;
      try {
        await runButtonAction(button, 'Deleting...', async () => {
          const result = await organizationDepartmentAction('deletePosition', {
            PositionId: button.dataset.deletePosition,
            DepartmentId: button.dataset.positionDepartment
          });
          setStatus(status, result.message || 'Department position deleted.', 'good');
          await loadOrganizationDepartments();
        });
      } catch (error) {
        setStatus(status, error.message || String(error), 'bad');
      }
    }));
    panelEl.querySelectorAll('[data-remove-department-member]').forEach((button) => button.addEventListener('click', async () => {
      if (button.disabled) return;
      const memberName = clean(button.dataset.memberName) || 'this member';
      const departmentName = clean(button.dataset.departmentName) || 'this department';
      if (!await window.DynamaxDialogs.confirm({ title: 'Remove department assignment', message: `Remove ${memberName} from ${departmentName}? The member's main record will be kept.`, confirmText: 'Remove assignment' })) return;
      const normalText = clean(button.textContent) || '×';
      setButtonLoading(button, true, '', normalText);
      try {
        setStatus(status, `Removing ${memberName} from ${departmentName}...`);
        const result = await organizationDepartmentAction('removeDepartmentMember', {
          MembershipId: button.dataset.removeDepartmentMember
        });
        setStatus(status, result.message || 'Member removed from department.', 'good');
        await loadOrganizationDepartments();
      } catch (error) {
        setStatus(status, error.message || String(error), 'bad');
      } finally {
        if (button.isConnected) setButtonLoading(button, false, '', normalText);
      }
    }));
    panelEl.querySelectorAll('[data-mark-offering-paid]').forEach((button) => button.addEventListener('click', async () => {
      const reference = await window.DynamaxDialogs.prompt({ title: 'Post remittance', message: 'Enter the bank or payment reference for this remittance.', label: 'Remittance reference', required: true, confirmText: 'Post remittance' });
      if (reference === null) return;
      try {
        await runButtonAction(button, 'Posting...', async () => {
          await organizationDepartmentAction('markOfferingPaid', { OfferingId: button.dataset.markOfferingPaid, RemittanceReference: reference });
          await loadOrganizationDepartments();
        });
      }
      catch (error) { setStatus(status, error.message || String(error), 'bad'); }
    }));
  } catch (error) {
    if (activeSection === 'members') panelEl.innerHTML = `<p class="status bad">${escapeHtml(error.message || String(error))}</p>`;
  }
}

async function churchServiceAction(action, payload = {}) {
  const response = await staffFetch('/api/staff-services', {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action,
      BranchId: currentUser?.branchId || 'main',
      ...payload
    })
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.message || 'The service or attendance record could not be saved.');
  return data;
}

const churchAttendanceBreakdownFields = [
  ['ChildrenCount', 'Children'],
  ['AdultCount', 'Adults'],
  ['MaleCount', 'Male'],
  ['FemaleCount', 'Female'],
  ['FirstTimerCount', 'First-timers'],
  ['NewConvertCount', 'New converts']
];

function churchAttendanceNumber(row = {}, key) {
  const raw = row?.[key];
  if (raw === undefined || raw === null || clean(raw) === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

function churchAttendanceChartCard(title, rows, total) {
  const maximum = Math.max(1, Number(total || 0), ...rows.map((row) => Number(row.value || 0)));
  return `<article class="department-chart-card service-attendance-chart-card">
    <h3>${escapeHtml(title)}</h3>
    <div role="img" aria-label="${escapeHtml(title)} attendance chart">
      ${rows.map((row) => `<div class="chart-row"><span>${escapeHtml(row.label)}</span><i><b style="width:${Math.max(row.value ? 3 : 0, Math.round(Number(row.value || 0) / maximum * 100))}%"></b></i><strong>${escapeHtml(row.value)}</strong></div>`).join('')}
    </div>
  </article>`;
}

function renderChurchAttendanceBreakdown(target, row = null) {
  if (!target) return;
  if (!row) {
    target.innerHTML = '<div class="service-attendance-empty"><strong>Choose a service occurrence</strong><span>Its saved attendance breakdown and charts will appear here.</span></div>';
    return;
  }
  const total = churchAttendanceNumber(row, 'AttendanceCount') ?? churchAttendanceNumber(row, 'TotalAttendance') ?? 0;
  const values = Object.fromEntries(churchAttendanceBreakdownFields.map(([key]) => [key, churchAttendanceNumber(row, key)]));
  const hasBreakdown = Object.values(values).some((value) => value !== null);
  const label = [pick(row, ['Date']), pick(row, ['ServiceName', 'ServiceId'])].filter(Boolean).join(' Â· ');
  if (!hasBreakdown) {
    target.innerHTML = `<div class="service-attendance-empty"><strong>${escapeHtml(label || 'Attendance breakdown')}</strong><span>A total of ${escapeHtml(total)} is recorded. Enter the breakdown below to generate the charts.</span></div>`;
    return;
  }
  const normalized = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value ?? 0]));
  const summary = [
    ['Total', total],
    ...churchAttendanceBreakdownFields.map(([key, fieldLabel]) => [fieldLabel, normalized[key]])
  ];
  target.innerHTML = `
    <header class="service-attendance-report-heading"><div><small>Attendance analysis</small><h3>${escapeHtml(label || 'Selected occurrence')}</h3></div></header>
    <div class="service-attendance-summary" aria-label="Attendance summary">${summary.map(([fieldLabel, value]) => `<div><small>${escapeHtml(fieldLabel)}</small><strong>${escapeHtml(value)}</strong></div>`).join('')}</div>
    <div class="service-attendance-chart-grid">
      ${churchAttendanceChartCard('Age composition', [
        { label: 'Children', value: normalized.ChildrenCount },
        { label: 'Adults', value: normalized.AdultCount }
      ], total)}
      ${churchAttendanceChartCard('Gender composition', [
        { label: 'Male', value: normalized.MaleCount },
        { label: 'Female', value: normalized.FemaleCount }
      ], normalized.AdultCount)}
      ${churchAttendanceChartCard('Included response groups', [
        { label: 'First-timers', value: normalized.FirstTimerCount },
        { label: 'New converts', value: normalized.NewConvertCount }
      ], total)}
    </div>`;
}

async function loadChurchServices() {
  try {
    const response = await staffFetch('/api/staff-services', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list', BranchId: currentUser?.branchId || 'main' })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.message || 'Could not load church services.');
    if (activeSection !== 'services') return;
    renderModuleSummary('services', data);
    const capabilities = data.capabilities || {};
    const services = (data.services || []).filter((row) => clean(row.Active || 'YES').toLowerCase() !== 'no');
    const occurrences = (data.occurrences || []).filter((row) => clean(row.Status).toLowerCase() !== 'cancelled');
    const members = data.members || [];
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const serviceOptions = services.map((row) => `<option value="${escapeHtml(pick(row, ['ServiceId', '__id']))}">${escapeHtml(pick(row, ['Name', 'ServiceName', 'ServiceId']))}</option>`).join('');
    const occurrenceOptions = occurrences.map((row) => `<option value="${escapeHtml(pick(row, ['OccurrenceId', '__id']))}">${escapeHtml([pick(row, ['Date']), pick(row, ['ServiceName', 'ServiceId']), pick(row, ['StartTime'])].filter(Boolean).join(' · '))}</option>`).join('');
    const memberOptions = members.map((row) => `<option value="${escapeHtml(pick(row, ['MemberId', '__id']))}">${escapeHtml([pick(row, ['DisplayName']), pick(row, ['MemberId', '__id'])].filter(Boolean).join(' · '))}</option>`).join('');
    const occurrenceForm = capabilities.canManageOccurrences
      ? services.length ? `
        <form id="churchOccurrenceForm" class="workflow-card compact-form church-service-entry-form" data-service-workspace="occurrences">
          <h3>Record service occurrence</h3>
          <p class="muted">Capture the schedule and service details in one concise record.</p>
          <div class="church-service-entry-grid">
            <label>Service<select name="ServiceId" required><option value="">Choose service</option>${serviceOptions}</select></label>
            <label>Date<input name="Date" type="date" value="${escapeHtml(today)}" required></label>
            <label>Start time<input name="StartTime" type="time"></label>
            <label>End time<input name="EndTime" type="time"></label>
            <label>Location<input name="Location" placeholder="Service venue"></label>
            <label>Theme<input name="Theme" placeholder="Optional theme"></label>
            <label>Minister<input name="Minister" placeholder="Minister in charge"></label>
            <label>Status<select name="Status"><option>Scheduled</option><option>In Progress</option><option>Completed</option></select></label>
            <label>Notes<input name="Notes" placeholder="Optional notes"></label>
          </div>
          <div class="church-service-entry-actions"><button type="submit">Save occurrence</button><p class="status" data-service-form-status></p></div>
        </form>` : '<article class="workflow-card" data-service-workspace="occurrences"><h3>Record service occurrence</h3><p class="muted">Create an active service definition in the desktop app before recording an occurrence.</p></article>'
      : '';
    const attendanceForms = capabilities.canRecordAttendance
      ? occurrences.length ? `
        <section class="service-attendance-workspace" data-service-workspace="totals">
          <form id="churchAttendanceTotalForm" class="workflow-card compact-form">
            <h3>Record attendance breakdown</h3>
            <p class="muted">Enter any two of Adults, Male and Female; the third is calculated automatically. Adults + Children = Total. First-timers and new converts are already included within these counts.</p>
            <label>Service occurrence<select name="OccurrenceId" required><option value="">Choose occurrence</option>${occurrenceOptions}</select></label>
            <div class="attendance-breakdown-fields">
              <label>Children<input name="ChildrenCount" type="number" min="0" max="1000000" step="1" required></label>
              <label>Adults<input name="AdultCount" type="number" min="0" max="1000000" step="1" required></label>
              <label>Male<input name="MaleCount" type="number" min="0" max="1000000" step="1" required></label>
              <label>Female<input name="FemaleCount" type="number" min="0" max="1000000" step="1" required></label>
              <label>First-timers<input name="FirstTimerCount" type="number" min="0" max="1000000" step="1" required></label>
              <label>New converts<input name="NewConvertCount" type="number" min="0" max="1000000" step="1" required></label>
            </div>
            <label class="attendance-total-field">Total attendance<input name="AttendanceCount" type="number" min="0" max="1000000" step="1" readonly required></label>
            <button type="submit">Save attendance breakdown</button>
            <p class="status" data-service-form-status></p>
          </form>
          <section id="churchAttendanceBreakdownReport" class="service-attendance-report" aria-live="polite"></section>
        </section>
        <form id="churchAttendanceForm" class="workflow-card compact-form church-service-entry-form" data-service-workspace="checkin">
          <h3>Individual attendance check-in</h3>
          <p class="muted">Choose a member or enter a visitor's details for this occurrence.</p>
          <div class="church-service-entry-grid">
            <label>Service occurrence<select name="OccurrenceId" required><option value="">Choose occurrence</option>${occurrenceOptions}</select></label>
            <label>Attendance type<select name="AttendanceType"><option value="Member">Member</option><option value="Visitor">Visitor</option></select></label>
            <label>Member<select name="MemberId"><option value="">Choose member</option>${memberOptions}</select></label>
            <label>Visitor name<input name="DisplayName" placeholder="Required for a visitor"></label>
            <label>Phone<input name="Phone" type="tel"></label>
            <label>Email<input name="Email" type="email"></label>
            <label>First-time visitor<select name="FirstTimeVisitor"><option value="NO">No</option><option value="YES">Yes</option></select></label>
            <label>Notes<input name="Notes" placeholder="Optional notes"></label>
          </div>
          <div class="church-service-entry-actions"><button type="submit">Record check-in</button><p class="status" data-service-form-status></p></div>
        </form>` : '<article class="workflow-card" data-service-workspace="checkin"><h3>Record attendance</h3><p class="muted">Record a service occurrence before entering attendance.</p></article>'
      : '';
    panelEl.innerHTML = `
      <div class="workflow-intro"><div><p class="eyebrow">Gatherings</p><h2>Services & Attendance</h2><p class="muted">Branch ${escapeHtml(data.branchId || 'main')} · ${data.services.length} service definitions · ${data.attendance.length} check-ins</p></div><button type="button" id="refreshChurchServices">Refresh</button></div>
      <div class="department-form-grid church-service-recording">${occurrenceForm}${attendanceForms}</div>
      ${table('Service Occurrences', data.occurrences || [], [
        { label: 'Date', value: (row) => pick(row, ['Date']) },
        { label: 'Service', value: (row) => pick(row, ['ServiceName', 'ServiceId']) },
        { label: 'Time', value: (row) => pick(row, ['StartTime']) },
        { label: 'Status', value: (row) => pick(row, ['Status']) }
      ])}
      ${table('Attendance Summary', data.occurrences || [], [
        { label: 'Date', value: (row) => pick(row, ['Date']) },
        { label: 'Service', value: (row) => pick(row, ['ServiceName', 'ServiceId']) },
        { label: 'Members', value: (row) => pick(row, ['MemberAttendance']) },
        { label: 'Visitors', value: (row) => pick(row, ['VisitorAttendance']) },
        { label: 'Children', value: (row) => pick(row, ['ChildrenCount']) },
        { label: 'Adults', value: (row) => pick(row, ['AdultCount']) },
        { label: 'Male', value: (row) => pick(row, ['MaleCount']) },
        { label: 'Female', value: (row) => pick(row, ['FemaleCount']) },
        { label: 'First-timers', value: (row) => pick(row, ['FirstTimerCount', 'FirstTimeVisitors']) },
        { label: 'New converts', value: (row) => pick(row, ['NewConvertCount']) },
        { label: 'Total', value: (row) => pick(row, ['TotalAttendance']) }
      ])}
      ${table('Recent Attendance', (data.attendance || []).slice(0, 100), [
        { label: 'Date', value: (row) => pick(row, ['OccurrenceDate']) },
        { label: 'Service', value: (row) => pick(row, ['ServiceName']) },
        { label: 'Name', value: (row) => pick(row, ['DisplayName']) },
        { label: 'Type', value: (row) => typeof genericOrganizationText === 'function' ? genericOrganizationText(pick(row, ['AttendanceType'])) : pick(row, ['AttendanceType']) },
        { label: 'Check-in', value: (row) => pick(row, ['CheckInAt']) }
      ])}`;
    const serviceFormGrid = panelEl.querySelector(':scope > .church-service-recording');
    mountWorkspaceTabs('services', [
      { key: 'occurrences', label: 'Service occurrences', icon: '\u{1F4C5}', count: (data.occurrences || []).length, nodes: [panelEl.querySelector('[data-service-workspace="occurrences"]'), workspaceTableNodes('Service Occurrences')] },
      { key: 'totals', label: 'Attendance totals', icon: '\u03A3', count: (data.occurrences || []).filter((row) => clean(row.AttendanceCount) !== '').length, nodes: [panelEl.querySelector('[data-service-workspace="totals"]'), workspaceTableNodes('Attendance Summary')] },
      { key: 'checkin', label: 'Individual check-in', icon: '\u2713', count: (data.attendance || []).length, nodes: [panelEl.querySelector('[data-service-workspace="checkin"]'), workspaceTableNodes('Recent Attendance')] }
    ]);
    if (serviceFormGrid && !serviceFormGrid.children.length) serviceFormGrid.remove();
    const occurrenceFormElement = document.getElementById('churchOccurrenceForm');
    occurrenceFormElement?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('button[type="submit"]');
      const status = form.querySelector('[data-service-form-status]');
      const payload = Object.fromEntries(new FormData(form).entries());
      payload.OccurrenceId = `OCC-${clean(payload.Date).replace(/-/g, '')}-${newIdempotencyKey().slice(0, 8).toUpperCase()}`;
      setButtonLoading(button, true, 'Saving...', 'Save occurrence');
      try {
        const result = await churchServiceAction('saveOccurrence', payload);
        await loadChurchServices();
        setStatus(dashboardStatus, result.message, 'ok');
      } catch (error) {
        setStatus(status, error.message || String(error), 'bad');
        if (button.isConnected) setButtonLoading(button, false, 'Saving...', 'Save occurrence');
      }
    });
    const totalForm = document.getElementById('churchAttendanceTotalForm');
    const attendanceReport = document.getElementById('churchAttendanceBreakdownReport');
    const occurrenceById = new Map(occurrences.map((row) => [clean(pick(row, ['OccurrenceId', '__id'])), row]));
    const attendanceDraft = () => {
      if (!totalForm) return null;
      const source = occurrenceById.get(clean(totalForm.elements.OccurrenceId.value)) || {};
      return {
        ...source,
        ...Object.fromEntries(churchAttendanceBreakdownFields.map(([key]) => [key, totalForm.elements[key].value])),
        AttendanceCount: totalForm.elements.AttendanceCount.value
      };
    };
    const attendanceValue = (name) => clean(totalForm?.elements[name]?.value) === '' ? null : Number(totalForm.elements[name].value);
    const setCalculatedAttendanceValue = (name, value) => {
      if (!totalForm || value === null || !Number.isFinite(value) || value < 0) return false;
      totalForm.elements[name].value = String(value);
      return true;
    };
    const validateAttendanceBreakdown = (changedName = '') => {
      if (!totalForm) return;
      totalForm.elements.AdultCount.setCustomValidity('');
      totalForm.elements.MaleCount.setCustomValidity('');
      totalForm.elements.FemaleCount.setCustomValidity('');
      let adults = attendanceValue('AdultCount');
      let male = attendanceValue('MaleCount');
      let female = attendanceValue('FemaleCount');
      let impossibleMessage = '';
      if (changedName === 'AdultCount' && adults !== null) {
        if (male !== null) {
          if (!setCalculatedAttendanceValue('FemaleCount', adults - male)) impossibleMessage = 'Male attendance cannot exceed adult attendance.';
        } else if (female !== null && !setCalculatedAttendanceValue('MaleCount', adults - female)) {
          impossibleMessage = 'Female attendance cannot exceed adult attendance.';
        }
      } else if (changedName === 'MaleCount' && male !== null) {
        if (female !== null) setCalculatedAttendanceValue('AdultCount', male + female);
        else if (adults !== null && !setCalculatedAttendanceValue('FemaleCount', adults - male)) impossibleMessage = 'Male attendance cannot exceed adult attendance.';
      } else if (changedName === 'FemaleCount' && female !== null) {
        if (male !== null) setCalculatedAttendanceValue('AdultCount', male + female);
        else if (adults !== null && !setCalculatedAttendanceValue('MaleCount', adults - female)) impossibleMessage = 'Female attendance cannot exceed adult attendance.';
      }
      adults = attendanceValue('AdultCount');
      male = attendanceValue('MaleCount');
      female = attendanceValue('FemaleCount');
      const children = attendanceValue('ChildrenCount');
      const total = children === null || adults === null ? null : children + adults;
      totalForm.elements.AttendanceCount.value = total === null ? '' : String(total);
      const genderMessage = impossibleMessage || (adults !== null && male !== null && female !== null && male + female !== adults
        ? 'Male and female attendance must add up to adult attendance.'
        : '');
      totalForm.elements.AdultCount.setCustomValidity(genderMessage);
      const savedTotal = total ?? 0;
      const firstTimers = attendanceValue('FirstTimerCount');
      const newConverts = attendanceValue('NewConvertCount');
      totalForm.elements.FirstTimerCount.setCustomValidity(firstTimers !== null && firstTimers > savedTotal ? 'First-timers cannot exceed total attendance.' : '');
      totalForm.elements.NewConvertCount.setCustomValidity(newConverts !== null && newConverts > savedTotal ? 'New converts cannot exceed total attendance.' : '');
      renderChurchAttendanceBreakdown(attendanceReport, attendanceDraft());
    };
    const loadAttendanceBreakdown = () => {
      if (!totalForm) return;
      const occurrence = occurrenceById.get(clean(totalForm.elements.OccurrenceId.value));
      churchAttendanceBreakdownFields.forEach(([key]) => {
        const value = occurrence ? churchAttendanceNumber(occurrence, key) : null;
        totalForm.elements[key].value = value === null ? '' : String(value);
      });
      const total = occurrence
        ? churchAttendanceNumber(occurrence, 'AttendanceCount') ?? churchAttendanceNumber(occurrence, 'TotalAttendance')
        : null;
      totalForm.elements.AttendanceCount.value = total === null ? '' : String(total);
      totalForm.elements.AdultCount.setCustomValidity('');
      totalForm.elements.MaleCount.setCustomValidity('');
      totalForm.elements.FemaleCount.setCustomValidity('');
      totalForm.elements.FirstTimerCount.setCustomValidity('');
      totalForm.elements.NewConvertCount.setCustomValidity('');
      renderChurchAttendanceBreakdown(attendanceReport, occurrence || null);
    };
    totalForm?.elements.OccurrenceId.addEventListener('change', loadAttendanceBreakdown);
    churchAttendanceBreakdownFields.forEach(([key]) => totalForm?.elements[key].addEventListener('input', () => validateAttendanceBreakdown(key)));
    if (totalForm && occurrences.length) {
      totalForm.elements.OccurrenceId.value = clean(pick(occurrences[0], ['OccurrenceId', '__id']));
      loadAttendanceBreakdown();
    } else {
      renderChurchAttendanceBreakdown(attendanceReport, null);
    }
    totalForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('button[type="submit"]');
      const status = form.querySelector('[data-service-form-status]');
      validateAttendanceBreakdown();
      if (!form.reportValidity()) return;
      const payload = Object.fromEntries(new FormData(form).entries());
      setButtonLoading(button, true, 'Saving...', 'Save attendance breakdown');
      try {
        const result = await churchServiceAction('recordAttendanceTotal', payload);
        await loadChurchServices();
        setStatus(dashboardStatus, result.message, 'ok');
      } catch (error) {
        setStatus(status, error.message || String(error), 'bad');
        if (button.isConnected) setButtonLoading(button, false, 'Saving...', 'Save attendance breakdown');
      }
    });
    const attendanceForm = document.getElementById('churchAttendanceForm');
    const syncAttendanceFields = () => {
      if (!attendanceForm) return;
      const isMember = attendanceForm.elements.AttendanceType.value === 'Member';
      attendanceForm.elements.MemberId.disabled = !isMember;
      attendanceForm.elements.MemberId.required = isMember;
      attendanceForm.elements.DisplayName.disabled = isMember;
      attendanceForm.elements.DisplayName.required = !isMember;
      attendanceForm.elements.FirstTimeVisitor.disabled = isMember;
    };
    attendanceForm?.elements.AttendanceType.addEventListener('change', syncAttendanceFields);
    syncAttendanceFields();
    attendanceForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('button[type="submit"]');
      const status = form.querySelector('[data-service-form-status]');
      const payload = Object.fromEntries(new FormData(form).entries());
      if (payload.AttendanceType === 'Visitor') {
        payload.MemberId = '';
        payload.VisitorReference = `VIS-${newIdempotencyKey()}`;
      } else {
        payload.DisplayName = '';
        payload.FirstTimeVisitor = 'NO';
      }
      setButtonLoading(button, true, 'Recording...', 'Record check-in');
      try {
        const result = await churchServiceAction('recordAttendance', payload);
        await loadChurchServices();
        setStatus(dashboardStatus, result.message, 'ok');
      } catch (error) {
        setStatus(status, error.message || String(error), 'bad');
        if (button.isConnected) setButtonLoading(button, false, 'Recording...', 'Record check-in');
      }
    });
    document.getElementById('refreshChurchServices')?.addEventListener('click', (event) => {
      runButtonAction(event.currentTarget, 'Refreshing...', loadChurchServices);
    });
  } catch (error) {
    if (activeSection === 'services') panelEl.innerHTML = `<p class="status bad">${escapeHtml(error.message || String(error))}</p>`;
  }
}

async function loadChurchFunds() {
  try {
    const response = await staffFetch('/api/staff-funds', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list', BranchId: currentUser?.branchId || 'main' })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.message || 'Could not load church funds.');
    if (activeSection !== 'funds') return;
    renderModuleSummary('funds', data);
    const capabilities = data.capabilities || {};
    const revenueAccounts = (data.chart || []).filter((row) => clean(row.Type).toLowerCase() === 'revenue');
    const givingTypeForm = capabilities.canManageGivingTypes ? `
      <section class="config-group" id="fundGivingTypeWorkspace">
        <header><strong>Giving types and individual income accounts</strong><small>Each giving source must point to a different Revenue account.</small></header>
        <form id="churchGivingTypeForm" class="workflow-form config-form">
          <input type="hidden" name="GivingTypeId">
          <div class="config-grid">
            <label>Giving type <input name="Name" placeholder="e.g. Prophet Offering" required></label>
            <label>Revenue account
              <select name="RevenueAccountCode" required>
                ${revenueAccounts.map((account) => `<option value="${escapeHtml(account.Code)}">${escapeHtml(account.Code)} - ${escapeHtml(account.Name)}</option>`).join('')}
              </select>
            </label>
            <label>Available online
              <select name="AllowOnline"><option value="YES">Yes</option><option value="NO">No</option></select>
            </label>
            <label>Status
              <select name="Active"><option value="YES">Active</option><option value="NO">Inactive</option></select>
            </label>
          </div>
          <label>Notes <input name="Notes" placeholder="Optional description"></label>
          <div class="config-dialog-actions">
            <p class="status" id="churchGivingTypeStatus"></p>
            <button type="reset" class="secondary">Clear</button>
            <button type="submit">Save giving type</button>
          </div>
        </form>
      </section>` : '';
    panelEl.innerHTML = `
      <div class="workflow-intro"><div><p class="eyebrow">Church finance setup</p><h2>Funds, Giving Types & Accounting Mappings</h2><p class="muted">Branch ${escapeHtml(data.branchId || 'main')} · ${data.funds.length} funds · ${(data.givingTypes || []).length} giving types · ${data.mappings.length} fund mappings</p></div><button type="button" id="refreshChurchFunds">Refresh</button></div>
      <p class="muted">Funds describe what money is reserved for. Giving types describe its source and post to their own Revenue accounts.</p>
      ${givingTypeForm}
      ${table('Giving Types & Income Accounts', data.givingTypes || [], [
        { label: 'Giving type', value: (row) => pick(row, ['Name']) },
        { label: 'Account', value: (row) => [pick(row, ['RevenueAccountCode']), pick(row, ['RevenueAccountName'])].filter(Boolean).join(' - ') },
        { label: 'Online', value: (row) => pick(row, ['AllowOnline']) },
        { label: 'Status', value: (row) => pick(row, ['Active']) },
        { label: 'Edit', render: (row) => capabilities.canManageGivingTypes
          ? `<button type="button" class="compact-icon-action compact-edit-action" data-edit-giving-type="${escapeHtml(pick(row, ['GivingTypeId', '__id']))}" aria-label="Edit ${escapeHtml(pick(row, ['Name']))}" title="Edit giving type"><span aria-hidden="true">&#9998;</span></button>`
          : '' }
      ])}
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
    mountWorkspaceTabs('funds', [
      { key: 'funds', label: 'Funds', icon: '\u{1F4B0}', count: data.funds.length, nodes: workspaceTableNodes('Funds') },
      { key: 'giving-types', label: 'Giving types', icon: '\u2192', count: (data.givingTypes || []).length, nodes: [panelEl.querySelector(':scope > p.muted'), document.getElementById('fundGivingTypeWorkspace'), workspaceTableNodes('Giving Types & Income Accounts')] },
      { key: 'mappings', label: 'Accounting mappings', icon: '\u21C4', count: data.mappings.length, nodes: workspaceTableNodes('Accounting Mappings') },
      { key: 'audit', label: 'Audit', icon: '\u2713', count: (data.audit || []).length, nodes: workspaceTableNodes('Recent Fund Audit') }
    ]);
    const givingTypeFormElement = document.getElementById('churchGivingTypeForm');
    givingTypeFormElement?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = givingTypeFormElement.querySelector('button[type="submit"]');
      const status = document.getElementById('churchGivingTypeStatus');
      const payload = Object.fromEntries(new FormData(givingTypeFormElement).entries());
      setButtonLoading(button, true, 'Saving...', 'Save giving type');
      try {
        const saved = await staffFetch('/api/staff-funds', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'saveGivingType',
            BranchId: currentUser?.branchId || 'main',
            ...payload
          })
        });
        const result = await saved.json();
        if (!saved.ok || !result.ok) throw new Error(result.message || 'Could not save giving type.');
        setStatus(status, result.message, 'ok');
        await loadChurchFunds();
      } catch (error) {
        setStatus(status, error.message || String(error), 'bad');
      } finally {
        setButtonLoading(button, false, 'Saving...', 'Save giving type');
      }
    });
    panelEl.querySelectorAll('[data-edit-giving-type]').forEach((button) => button.addEventListener('click', () => {
      const row = (data.givingTypes || []).find((item) =>
        clean(item.GivingTypeId || item.__id) === clean(button.dataset.editGivingType)
      );
      if (!row || !givingTypeFormElement) return;
      ['GivingTypeId', 'Name', 'RevenueAccountCode', 'AllowOnline', 'Active', 'Notes'].forEach((field) => {
        if (givingTypeFormElement.elements[field]) {
          givingTypeFormElement.elements[field].value = clean(row[field]);
        }
      });
      givingTypeFormElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      givingTypeFormElement.elements.Name?.focus();
    }));
    document.getElementById('refreshChurchFunds')?.addEventListener('click', (event) => {
      runButtonAction(event.currentTarget, 'Refreshing...', loadChurchFunds);
    });
  } catch (error) {
    if (activeSection === 'funds') panelEl.innerHTML = `<p class="status bad">${escapeHtml(error.message || String(error))}</p>`;
  }
}

async function doOfferingAction(action, offeringId, reason = '', idempotencyKey = '') {
  if (!offeringId) return;
  const requestKey = clean(idempotencyKey) || newIdempotencyKey();
  const response = await staffFetch('/api/staff-offerings', {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestKey },
    body: JSON.stringify({
      action,
      OfferingId: offeringId,
      BranchId: currentUser?.branchId || 'main',
      Reason: reason,
      idempotencyKey: requestKey
    })
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw receivedResponseError(data.message || 'Offering action failed.');
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
  const idempotencyKey = clean(payload.idempotencyKey) || newIdempotencyKey();
  const response = await staffFetch('/api/staff-offerings', {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({
      action,
      BranchId: currentUser?.branchId || 'main',
      ...payload,
      idempotencyKey
    })
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw receivedResponseError(data.message || 'Offering route action failed.');
  return data;
}
async function churchDonationRequest(action, payload = {}) {
  const idempotencyKey = clean(payload.idempotencyKey) || newIdempotencyKey();
  const response = await staffFetch('/api/staff-church-payments', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({
      action,
      BranchId: currentUser?.branchId || 'main',
      ...payload,
      idempotencyKey
    })
  });
  const data = await response.json().catch(() => ({ ok: false, message: genericOrganizationText('Church donation service did not return JSON.') }));
  if (!response.ok || !data.ok) {
    if (response.status === 401) {
      showLogin(data.message || 'Your staff session has expired.', 'bad');
    }
    throw receivedResponseError(genericOrganizationText(data.message || 'Church donation action failed.'));
  }
  return data;
}

async function initChurchDonationPayment(payload = {}) {
  const idempotencyKey = clean(payload.idempotencyKey) || newIdempotencyKey();
  const response = await staffFetch('/api/init-church-payment', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({
      ...payload,
      BranchId: currentUser?.branchId || 'main',
      idempotencyKey
    })
  });
  const data = await response.json().catch(() => ({ ok: false, message: genericOrganizationText('Church donation online-init service did not return JSON.') }));
  if (!response.ok || !data.ok) {
    if (response.status === 401) {
      showLogin(data.message || 'Your staff session has expired.', 'bad');
    }
    throw receivedResponseError(genericOrganizationText(data.message || 'Could not initialize online church donation payment.'));
  }
  return data;
}


function printChurchDonationReceipt(donation = {}, format = 'standard') {
  if (!donation || clean(donation.Status).toLowerCase() !== 'paid') {
    setStatus(document.getElementById('churchDonationStatus') || dashboardStatus, 'A receipt is available after the donation has been paid.', 'bad');
    return;
  }
  const posFormat = format === 'pos';
  const receiptWindow = window.open('', '_blank', posFormat ? 'width=430,height=820' : 'width=820,height=900');
  if (!receiptWindow) {
    setStatus(document.getElementById('churchDonationStatus') || dashboardStatus, 'Allow pop-ups to view and print this receipt.', 'bad');
    return;
  }
  receiptWindow.opener = null;
  const organisation = clean(donation.ChurchName || document.querySelector('[data-school-name]')?.textContent || staffBrand?.textContent) || 'Dynamax';
  const logoSource = clean(donation.ReceiptLogoSource || document.querySelector('.nav-logo')?.getAttribute('src') || 'images/Logo.png');
  const logo = logoSource ? new URL(logoSource, window.location.href).href : '';
  const currency = clean(donation.Currency || 'NGN').toUpperCase();
  let formattedAmount = money(donation.Amount || 0);
  try {
    formattedAmount = new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2
    }).format(Number(donation.Amount || 0));
  } catch {
    formattedAmount = `${currency} ${Number(donation.Amount || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  const baseCurrency = clean(donation.BaseCurrency || 'NGN').toUpperCase();
  const baseAmount = clean(donation.BaseAmount);
  if (currency !== baseCurrency) {
    formattedAmount = baseAmount
      ? `${formattedAmount} · ${moneyInCurrency(baseAmount, baseCurrency)} equivalent at 1 ${currency} = ${baseCurrency} ${donation.ExchangeRate}`
      : `${formattedAmount} · Awaiting ${baseCurrency} exchange rate`;
  }
  const receiptNo = clean(donation.ReceiptNo || donation.DonationId || donation.__id);
  const reference = clean(donation.Reference || donation.PaymentReference || donation.DonationId);
  const paidAt = clean(donation.PaidAt || donation.PaymentDate || donation.UpdatedAt || donation.Timestamp || donation.CreatedAt);
  const receiptDate = paidAt ? paidAt.replace('T', ' ').replace('Z', '').slice(0, 19) : '';
  const donorName = clean(donation.DonorName) || 'Anonymous donor';
  const paymentDescription = [donation.PaymentType || 'Donation', donation.PaymentMethod].filter(Boolean).join(' · ');
  if (posFormat) {
    receiptWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(receiptNo || 'POS donation receipt')}</title><style>
      @page{size:80mm auto;margin:3mm}*{box-sizing:border-box}body{width:80mm;margin:0 auto;background:#eee;color:#000;font:11px/1.35 Arial,sans-serif}.receipt{width:74mm;margin:8px auto;padding:4mm 3mm;background:#fff}.brand{text-align:center}.brand img{width:34px;height:34px;object-fit:contain}.brand h1{margin:4px 0 1px;font-size:15px}.brand p{margin:0;font-size:10px}.divider{margin:8px 0;border-top:1px dashed #000}.meta{display:grid;grid-template-columns:30mm 1fr;gap:3px}.meta span{font-weight:700}.meta strong{min-width:0;text-align:right;overflow-wrap:anywhere}.amount{margin:8px 0;padding:7px 0;border-top:2px solid #000;border-bottom:2px solid #000;text-align:center}.amount span,.amount strong{display:block}.amount strong{margin-top:2px;font-size:15px}.paid{text-align:center;font-weight:800}.footer{margin-top:9px;text-align:center;font-size:9px}.print{display:block;width:fit-content;margin:10px auto;padding:8px 12px;border:0;border-radius:5px;background:#1769e0;color:#fff;font-weight:700}@media print{body{width:80mm;background:#fff}.receipt{width:74mm;margin:0;padding:0}.print{display:none}}</style></head><body><button class="print" onclick="window.print()">Print POS receipt</button><main class="receipt"><header class="brand">${logo ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(organisation)} logo">` : ''}<h1>${escapeHtml(organisation)}</h1><p>Donation receipt</p></header><div class="divider"></div><section class="meta"><span>Donor</span><strong>${escapeHtml(donorName)}</strong><span>Gift type</span><strong>${escapeHtml(donation.PaymentType || 'Donation')}</strong><span>Payment</span><strong>${escapeHtml(donation.PaymentMethod || '')}</strong>${reference ? `<span>Reference</span><strong>${escapeHtml(reference)}</strong>` : ''}<span>Receipt</span><strong>${escapeHtml(receiptNo)}</strong>${receiptDate ? `<span>Date</span><strong>${escapeHtml(receiptDate)}</strong>` : ''}</section><div class="amount"><span>AMOUNT RECEIVED</span><strong>${escapeHtml(formattedAmount)}</strong></div><div class="paid">PAID</div><footer class="footer">Thank you for your generosity<br>Verified by Dynamax</footer></main></body></html>`);
    receiptWindow.document.close();
    return;
  }
  receiptWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(receiptNo || 'Donation receipt')}</title><style>
    @page{size:A5;margin:12mm}*{box-sizing:border-box}body{margin:0;background:#edf3f8;color:#17314b;font:13px/1.5 Arial,sans-serif}.receipt{position:relative;max-width:620px;min-height:760px;margin:18px auto;background:#fff;border-top:7px solid #d49a00;box-shadow:0 14px 35px #173b5820;overflow:hidden}.watermark{position:absolute;inset:23% 20%;width:60%;height:54%;object-fit:contain;opacity:.045}.brand,.content,.footer{position:relative}.brand{display:flex;align-items:center;gap:15px;padding:25px 28px;background:#164a78;color:#fff;border-bottom:4px solid #16a596}.brand img{width:62px;height:62px;padding:5px;border-radius:12px;background:#fff;object-fit:contain}.brand small{display:block;color:#95f2e6;font-weight:bold;letter-spacing:1.4px;text-transform:uppercase}.brand h1{margin:2px 0 0;font-size:21px}.content{padding:26px 28px}.acknowledgement{margin:0 0 18px;color:#36536e}.meta{width:100%;border-collapse:collapse}.meta th,.meta td{padding:10px 12px;border:1px solid #cfdeea;text-align:left}.meta th{width:37%;background:#e8f1fb;color:#164a78}.meta tr:nth-child(even) td{background:#eef9f7}.meta .amount-row th,.meta .amount-row td{background:#fff3cf;color:#08745f;font-size:16px}.paid{display:inline-block;padding:3px 10px;border-radius:999px;background:#dff5e9;color:#08745f;font-weight:bold}.thanks{margin:20px 0 0;padding:13px 15px;border-left:4px solid #16a596;background:#eef9f7;color:#28566a}.footer{padding:13px 28px;background:#164a78;color:#dbeafb;text-align:center}.print{position:fixed;top:10px;right:10px;padding:9px 13px;border:0;border-radius:7px;background:#1769e0;color:#fff;font-weight:bold;cursor:pointer}@media print{body{background:#fff}.receipt{min-height:auto;margin:0;box-shadow:none}.print{display:none}}</style></head><body><button class="print" onclick="window.print()">Print / Save as PDF</button><main class="receipt">${logo ? `<img class="watermark" src="${escapeHtml(logo)}" alt="">` : ''}<header class="brand">${logo ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(organisation)} logo">` : ''}<div><small>Official acknowledgement</small><h1>${escapeHtml(organisation)} donation receipt</h1></div></header><section class="content"><p class="acknowledgement">Dear ${escapeHtml(donorName)},<br>Thank you. Your gift has been received and recorded.</p><table class="meta"><tbody><tr><th>Donor</th><td>${escapeHtml(donorName)}</td></tr>${donation.DonorEmail ? `<tr><th>Email</th><td>${escapeHtml(donation.DonorEmail)}</td></tr>` : ''}<tr class="amount-row"><th>Amount</th><td><strong>${escapeHtml(formattedAmount)}</strong></td></tr><tr><th>Payment</th><td>${escapeHtml(paymentDescription)}</td></tr>${reference ? `<tr><th>Reference</th><td>${escapeHtml(reference)}</td></tr>` : ''}<tr><th>Receipt number</th><td>${escapeHtml(receiptNo)}</td></tr>${receiptDate ? `<tr><th>Payment date</th><td>${escapeHtml(receiptDate)}</td></tr>` : ''}<tr><th>Status</th><td><span class="paid">Paid</span></td></tr></tbody></table><p class="thanks">Thank you for your generosity. Please retain this receipt for your records.</p></section><footer class="footer">Verified donation receipt · Generated by Dynamax</footer></main></body></html>`);
  receiptWindow.document.close();
}

function showChurchGivingQr(data = {}) {
  const donation = data.donation || {};
  const generic = Boolean(data.generic);
  const qrWindow = window.open('', '_blank', 'width=620,height=780');
  if (!qrWindow) {
    setStatus(document.getElementById('churchDonationStatus') || dashboardStatus, 'Allow pop-ups to view and print the giving QR code.', 'bad');
    return;
  }
  qrWindow.opener = null;
  const organisation = clean(donation.ChurchName || document.querySelector('[data-school-name]')?.textContent || staffBrand?.textContent) || 'Dynamax';
  const donorName = clean(donation.DonorName) || 'Donor';
  const givingType = clean(donation.PaymentType) || 'Gift';
  const reference = clean(donation.Reference || donation.DonationId);
  qrWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(givingType)} payment QR</title><style>
    @page{size:A5;margin:12mm}*{box-sizing:border-box}body{margin:0;background:#edf3f8;color:#17314b;font:15px/1.5 Arial,sans-serif}.sheet{max-width:540px;margin:24px auto;padding:28px;border-top:7px solid #d49a00;border-radius:16px;background:#fff;box-shadow:0 14px 35px #173b5820;text-align:center}.eyebrow{margin:0;color:#087d68;font-size:12px;font-weight:bold;letter-spacing:1.3px;text-transform:uppercase}h1{margin:5px 0 4px;color:#164a78;font-size:25px}.amount{margin:0 0 18px;color:#36536e}.qr{width:min(330px,90%);margin:0 auto;padding:12px;border:1px solid #cbd9e7;border-radius:14px;background:#fff}.qr svg{display:block;width:100%;height:auto}.instruction{margin:18px auto 8px;max-width:390px}.reference{color:#637a90;font-size:12px}.actions{display:flex;justify-content:center;gap:8px;margin-top:20px}.actions button,.actions a{display:inline-flex;align-items:center;min-height:40px;padding:8px 14px;border:0;border-radius:8px;background:#1769e0;color:#fff;font-weight:bold;text-decoration:none;cursor:pointer}.actions a{background:#087d68}@media print{body{background:#fff}.sheet{margin:0;box-shadow:none}.actions{display:none}}</style></head><body><main class="sheet"><p class="eyebrow">${generic ? 'Reusable self-service giving' : 'Secure online giving'}</p><h1>${escapeHtml(organisation)}</h1><p class="amount">${generic ? 'Donations, tithes and offerings' : `${escapeHtml(givingType)} for ${escapeHtml(donorName)} &middot; ${escapeHtml(money(donation.Amount || 0))}`}</p><div class="qr">${data.qrSvg || ''}</div><p class="instruction">${generic ? 'Scan this reusable code to enter your details, choose a gift type and amount, then pay securely.' : 'Scan this code with a phone camera to open the secure payment page and complete the gift.'}</p>${reference ? `<p class="reference">Reference: ${escapeHtml(reference)}</p>` : ''}<div class="actions"><button type="button" onclick="window.print()">Print QR</button><a href="${escapeHtml(data.paymentLink)}" target="_blank" rel="noopener">${generic ? 'Open giving page' : 'Open payment page'}</a></div></main></body></html>`);
  qrWindow.document.close();
  if (!generic) {
    const amountLine = qrWindow.document.querySelector('.amount');
    if (amountLine) amountLine.textContent = `${givingType} for ${donorName} · ${moneyInCurrency(donation.Amount || 0, donation.TransactionCurrency || donation.Currency || 'NGN')}`;
  }
}

function donorContributionInsights(topDonors = [], registeredDonors = []) {
  const colors = ['#1769e0', '#159b7f', '#8055c7', '#ed8b18', '#d84a67', '#6f8092'];
  const ranked = topDonors
    .map((row) => ({ ...row, SettledNgnTotal: financialNumber(row.SettledNgnTotal) }))
    .filter((row) => row.SettledNgnTotal > 0);
  const total = ranked.reduce((sum, row) => sum + row.SettledNgnTotal, 0);
  const highlighted = ranked.slice(0, 5).map((row, index) => ({
    label: clean(row.DonorName || row.DisplayName) || 'Donor',
    value: row.SettledNgnTotal,
    gifts: Number(row.DonationCount || 0),
    color: colors[index]
  }));
  const remaining = ranked.slice(5);
  const remainingValue = remaining.reduce((sum, row) => sum + row.SettledNgnTotal, 0);
  if (remainingValue > 0) highlighted.push({
    label: 'Other top donors',
    value: remainingValue,
    gifts: remaining.reduce((sum, row) => sum + Number(row.DonationCount || 0), 0),
    color: colors[5]
  });
  let cursor = 0;
  const segments = highlighted.map((row) => {
    const start = cursor;
    cursor += total > 0 ? (row.value / total) * 100 : 0;
    return `${row.color} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
  });
  const chart = segments.length ? `conic-gradient(${segments.join(',')})` : 'conic-gradient(#dfe7ef 0 100%)';
  const giftCount = ranked.reduce((sum, row) => sum + Number(row.DonationCount || 0), 0);
  const leaderShare = total > 0 && ranked.length ? Math.round((ranked[0].SettledNgnTotal / total) * 100) : 0;
  return `
    <aside class="donor-insights-card">
      <header><div><small>Settled giving overview</small><h2>Top donor contribution</h2></div><span>${ranked.length} ranked</span></header>
      <div class="donor-contribution-visual">
        <div class="donor-contribution-chart" style="--donor-pie:${chart}" role="img" aria-label="Contribution share of the leading donors">
          <span><strong>${escapeHtml(money(total))}</strong><small>Top 10 total</small></span>
        </div>
        <div class="donor-contribution-legend">
          ${highlighted.length ? highlighted.map((row) => `<div><i style="--donor-color:${row.color}"></i><span><strong>${escapeHtml(row.label)}</strong><small>${escapeHtml(money(row.value))} · ${row.gifts} gift${row.gifts === 1 ? '' : 's'}</small></span><b>${total > 0 ? Math.round((row.value / total) * 100) : 0}%</b></div>`).join('') : '<p class="muted">Settled donor totals will appear here after giving is converted to NGN.</p>'}
        </div>
      </div>
      <div class="donor-insight-kpis">
        <div><strong>${registeredDonors.length}</strong><span>Registered donors</span></div>
        <div><strong>${giftCount}</strong><span>Top-donor gifts</span></div>
        <div><strong>${leaderShare}%</strong><span>Leader share</span></div>
      </div>
    </aside>`;
}

async function loadChurchDonations() {
  try {
    const methods = ['CASH', 'BANK TRANSFER', 'CHEQUE', 'POS', 'ONLINE', 'CARD', 'MOBILE MONEY'];
    const currencies = ['NGN', 'USD', 'GBP', 'EUR', 'KES', 'GHS'];
    const response = await staffFetch('/api/staff-church-payments', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list', BranchId: currentUser?.branchId || 'main' })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.message || 'Could not load church donations.');
    if (activeSection !== 'donations') return;
    renderModuleSummary('donations', data);

    const summary = data.summary || {};
    const capabilities = data.capabilities || {};
    const paymentTypes = (data.givingTypes || []).map((row) => clean(row.Name)).filter(Boolean);
    const byMethod = summary.byMethod || {};
    const givingSourceRows = Object.entries(summary.byType || {})
      .map(([Name, Amount]) => ({ Name, Amount: Number(Amount || 0) }))
      .sort((left, right) => right.Amount - left.Amount);
    const methodCards = Object.entries(byMethod)
      .sort((left, right) => clean(right[0]).localeCompare(clean(left[0])))
      .map(([method, value]) => `<div><small>${escapeHtml(method || 'Unknown')}</small><strong>${money(value)}</strong><span>Collected</span></div>`)
      .join('');
    const awaitingRateText = Number(summary.awaitingRate || 0)
      ? `${Number(summary.awaitingRate)} foreign-currency gift${Number(summary.awaitingRate) === 1 ? '' : 's'} awaiting an NGN rate`
      : 'All foreign-currency gifts converted';
    const donors = data.donors || [];
    const topDonors = data.topDonors || [];
    const foreignHoldings = data.foreignHoldings || [];
    const currencyMode = clean(data.settings?.ForeignCurrencyMode || 'PER_DONATION').toUpperCase();
    const awaitingForeignDonations = (data.donations || []).filter((row) => {
      const currency = clean(row.TransactionCurrency || row.Currency || 'NGN').toUpperCase();
      return currency !== 'NGN'
        && clean(row.ConversionStatus).toLowerCase() !== 'converted'
        && ['paid', 'completed'].includes(clean(row.Status || row.PaymentStatus).toLowerCase());
    });
    const awaitingCurrencies = [...new Set(awaitingForeignDonations.map((row) => clean(row.TransactionCurrency || row.Currency).toUpperCase()))];

    panelEl.innerHTML = `
      <div class="workflow-intro">
        <div>
          <p class="eyebrow">Giving counter</p>
          <h2>Church Donations</h2>
          <p class="muted">Branch ${escapeHtml(data.branchId || 'main')} � ${summary.count || 0} entries � ${summary.paid || 0} paid � ${summary.pending || 0} pending</p>
        </div>
        <span class="compact-row-actions"><button type="button" id="genericChurchGivingQr">▦ Generic Giving QR</button>${capabilities.canCollect ? '<button type="button" id="syncChurchDonationAccounting">Sync paid giving</button>' : ''}<button type="button" id="refreshChurchDonations">Refresh</button></span>
      </div>
      <div class="workflow-kpis">
        <div><small>NGN equivalent</small><strong>${money(summary.totalAmount || 0)}</strong><span>Converted records only</span></div>
        <div><small>Paid</small><strong>${money((summary.paid || 0) > 0 ? summary.paidAmount || summary.totalAmount : 0)}</strong><span>Recorded as paid</span></div>
        <div><small>Pending</small><strong>${money((summary.pending || 0) > 0 ? summary.pendingAmount || 0 : 0)}</strong><span>Awaiting settlement</span></div>
        <div><small>Exchange rates</small><strong>${escapeHtml(summary.awaitingRate || 0)}</strong><span>${escapeHtml(awaitingRateText)}</span></div>
      </div>
      ${methodCards ? `<div class="workflow-kpis">${methodCards}</div>` : ''}
      <div class="church-dashboard-grid giving-source-chart">
        ${verticalBars('Giving by source', givingSourceRows, 'Name', 'Amount', 'teal')}
      </div>
      <section class="config-group" id="donationGivingPanel">
        <header><strong>New donation entry</strong><small>Record offline and online payments, then optionally send confirmation and link.</small></header>
        <form id="churchDonationForm" class="workflow-form config-form">
          <div class="config-grid">
            <label>Registered donor
              <select name="DonorId" id="churchDonationDonorSelect">
                <option value="">Enter a new or occasional donor</option>
                ${donors.map((row) => `<option value="${escapeHtml(row.DonorId || row.__id)}">${escapeHtml(row.DisplayName)}${row.Email ? ` · ${escapeHtml(row.Email)}` : ''}</option>`).join('')}
              </select>
            </label>
            <label>Donor name <input name="DonorName" required></label>
            <label>Donor email <input name="DonorEmail" type="email" required></label>
            <label>Donor phone <input name="DonorPhone" type="tel" autocomplete="tel"></label>
            <label>Amount <input name="Amount" type="number" min="0.01" step="0.01" data-finance-input required></label>
            <label>Currency <select name="Currency">${currencies.map((currency) => `<option value="${escapeHtml(currency)}">${escapeHtml(currency)}</option>`).join('')}</select></label>
            <label id="churchDonationExchangeRateField">NGN per 1 foreign currency <input name="ExchangeRate" type="number" min="0.000001" step="0.000001" value="1" data-finance-input data-finance-decimals="6"><small data-exchange-rate-help>NGN donations use a rate of 1.</small></label>
            <label id="churchDonationExchangeRateDateField">Rate date <input name="ExchangeRateDate" type="date" value="${new Date().toISOString().slice(0, 10)}"></label>
            <input name="ExchangeRateSource" type="hidden" value="Manual staff rate">
            <label>Method <select name="PaymentMethod">${methods.map((method) => `<option value="${escapeHtml(method)}">${escapeHtml(method)}</option>`).join('')}</select></label>
            <label>Giving type <select name="PaymentType">${paymentTypes.map((paymentType) => `<option value="${escapeHtml(paymentType)}">${escapeHtml(paymentType)}</option>`).join('')}</select></label>
            <label>Receipt subject (after payment) <input name="ReceiptSubject" value="${escapeHtml(genericOrganizationText('Thank you for your donation'))}"></label>
            <label>Receipt message (after payment) <input name="ReceiptMessage" value="${escapeHtml(genericOrganizationText('Your gift was received.'))}"></label>
          </div>
          <label>Notes
            <textarea name="Notes" rows="2" placeholder="Optional notes for donation records."></textarea>
          </label>
          <label class="check-row config-switch" style="display:flex;align-items:center;justify-content:flex-start;gap:8px;"><input name="sendOnlineEmail" type="checkbox" checked style="flex:0 0 16px;width:16px;height:16px;min-height:16px;margin:0;padding:0;"><span>Send online payment link for this donation</span></label>
          <label class="check-row config-switch"><input name="SaveDonorProfileRequested" type="checkbox" value="yes" checked><span>Save or refresh this donor after payment is confirmed</span></label>
          <div class="config-dialog-actions">
            <p class="status" id="churchDonationStatus"></p>
            <button type="submit">Save donation</button>
          </div>
        </form>
      </section>
      <section class="config-group" id="donationDonorPanel">
        <header><strong>Donor register</strong><small>Reuse verified contact details and recognise consistent supporters without exposing this information publicly.</small></header>
        ${capabilities.canCollect ? `<form id="churchDonorForm" class="workflow-form config-form compact-management-form">
          <input name="DonorId" type="hidden">
          <div class="config-grid">
            <label>Name <input name="DisplayName" required></label>
            <label>Email <input name="Email" type="email"></label>
            <label>Phone <input name="Phone" type="tel"></label>
            <label>Notes <input name="Notes"></label>
          </div>
          <div class="config-dialog-actions"><p class="status" id="churchDonorStatus"></p><button type="submit">Save donor</button></div>
        </form>` : ''}
        <div class="donor-register-layout">
          ${donorContributionInsights(topDonors, donors)}
          <div class="donor-table-stack">
          <div class="management-table-block" style="min-width:0">${table('Top 10 donors', topDonors, [
            { label: 'Donor', value: (row) => row.DonorName },
            { label: 'Settled NGN total', value: (row) => money(row.SettledNgnTotal) },
            { label: 'Gifts', value: (row) => row.DonationCount }
          ])}</div>
          <div class="management-table-block" style="min-width:0">${table('Registered donors', donors, [
            { label: 'Name', value: (row) => row.DisplayName },
            { label: 'Email', value: (row) => row.Email },
            { label: 'Phone', value: (row) => row.Phone },
            { label: 'Action', render: (row) => capabilities.canCollect ? `<button type="button" class="table-action" data-edit-donor="${escapeHtml(row.DonorId || row.__id)}">Edit</button>` : '' }
          ])}</div>
          </div>
        </div>
      </section>
      <section class="config-group" id="donationCurrencyPanel">
        <header><strong>Foreign-currency giving</strong><small>Keep each currency separate until it is converted, or translate each gift immediately using a frozen rate.</small></header>
        ${capabilities.canCollect ? `<form id="churchCurrencyPolicyForm" class="inline-policy-form">
          <label><input type="radio" name="ForeignCurrencyMode" value="PER_DONATION" ${currencyMode === 'PER_DONATION' ? 'checked' : ''}> Translate each donation</label>
          <label><input type="radio" name="ForeignCurrencyMode" value="BATCH_SETTLEMENT" ${currencyMode === 'BATCH_SETTLEMENT' ? 'checked' : ''}> Hold and settle by currency</label>
          <button type="submit">Save policy</button>
        </form>` : ''}
        <p class="notice ${currencyMode === 'BATCH_SETTLEMENT' ? 'ok' : ''}">${currencyMode === 'BATCH_SETTLEMENT'
          ? 'Batch mode is active. Foreign gifts stay outside combined NGN income until the accountant records actual conversion proceeds.'
          : 'Per-donation mode is active. A frozen NGN rate is required when each foreign gift is recorded.'}</p>
        <div class="management-split">
          ${verticalBars('Foreign gifts by currency', foreignHoldings, 'Currency', 'PaidAmount', 'teal')}
          ${table('Currency holdings', foreignHoldings, [
            { label: 'Currency', value: (row) => row.Currency },
            { label: 'Paid gifts', value: (row) => moneyInCurrency(row.PaidAmount, row.Currency) },
            { label: 'Awaiting conversion', value: (row) => moneyInCurrency(row.AwaitingAmount, row.Currency) },
            { label: 'Count', value: (row) => row.DonationCount }
          ])}
        </div>
        ${currencyMode === 'BATCH_SETTLEMENT' && capabilities.canCollect ? `<form id="churchCurrencySettlementForm" class="workflow-form config-form">
          <h3>Record a completed currency conversion</h3>
          <p class="muted">Choose one currency. All outstanding gifts in that currency will be selected automatically; untick any gift you do not want to include. Enter the completed conversion rate and the system will calculate their NGN equivalent.</p>
          <div class="config-grid">
            <label>Currency <select name="Currency" id="churchSettlementCurrency" required><option value="">Choose currency</option>${awaitingCurrencies.map((currency) => `<option value="${escapeHtml(currency)}">${escapeHtml(currency)}</option>`).join('')}</select></label>
            <label>Conversion rate (NGN per unit) <input name="ExchangeRate" type="number" min="0.00000001" step="0.00000001" inputmode="decimal" placeholder="e.g. 1,600" data-finance-input data-finance-decimals="8" required></label>
            <label>Calculated NGN equivalent <input name="GrossNgnProceeds" type="number" min="0.01" step="0.01" data-finance-input data-finance-fixed="2" readonly required></label>
            <label>Conversion charge (NGN) <input name="ConversionFee" type="number" min="0" step="0.01" value="0" data-finance-input></label>
            <label>Settlement date <input name="SettlementDate" type="date" value="${new Date().toISOString().slice(0, 10)}" required></label>
            <label>Bank / bureau reference <input name="Reference"></label>
          </div>
          <p class="notice" id="churchSettlementCalculation">Select gifts and enter their completed conversion rate.</p>
          <div class="settlement-selection" id="churchSettlementDonations">
            ${awaitingForeignDonations.map((row) => {
              const id = clean(row.DonationId || row.__id);
              const currency = clean(row.TransactionCurrency || row.Currency).toUpperCase();
              return `<label data-settlement-currency="${escapeHtml(currency)}" data-settlement-amount="${escapeHtml(row.Amount)}"><input type="checkbox" name="DonationIds" value="${escapeHtml(id)}"><span><strong>${escapeHtml(row.DonorName || 'Donor')}</strong><small>${escapeHtml(moneyInCurrency(row.Amount, currency))} · ${escapeHtml(row.PaymentType || 'Donation')}</small></span></label>`;
            }).join('') || '<p class="muted">There are no paid foreign gifts awaiting conversion.</p>'}
          </div>
          <div class="config-dialog-actions"><p class="status" id="churchSettlementStatus"></p><button type="submit">Settle selected gifts</button></div>
        </form>` : ''}
        ${table('Recent currency settlements', data.settlements || [], [
          { label: 'Date', value: (row) => row.SettlementDate },
          { label: 'Currency', value: (row) => row.Currency },
          { label: 'Foreign amount', value: (row) => moneyInCurrency(row.ForeignAmount, row.Currency) },
          { label: 'Gross NGN', value: (row) => money(row.GrossNgnProceeds) },
          { label: 'Charges', value: (row) => money(row.ConversionFee) },
          { label: 'Rate', value: (row) => row.ExchangeRate },
          { label: 'Accounting', value: (row) => row.AccountingStatus }
        ])}
      </section>
      <section id="donationRecordsPanel">
      ${table('Donations', data.donations || [], [
        { label: 'Receipt', value: (row) => pick(row, ['ReceiptNo', '__id']) },
        { label: 'Donor', value: (row) => pick(row, ['DonorName']) },
        { label: 'Email', value: (row) => pick(row, ['DonorEmail']) },
        { label: 'Original amount', value: (row) => moneyInCurrency(pick(row, ['Amount']), pick(row, ['TransactionCurrency', 'Currency']) || 'NGN') },
        { label: 'NGN equivalent', value: (row) => {
          const currency = clean(pick(row, ['TransactionCurrency', 'Currency']) || 'NGN').toUpperCase();
          const baseText = clean(pick(row, ['BaseAmount']));
          const baseAmount = Number(baseText);
          if (currency !== 'NGN' && (!baseText || !Number.isFinite(baseAmount) || baseAmount <= 0)) return 'Awaiting rate';
          return money(currency === 'NGN' && !baseText ? pick(row, ['Amount']) : baseAmount);
        } },
        { label: 'Conversion', value: (row) => {
          const currency = clean(pick(row, ['TransactionCurrency', 'Currency']) || 'NGN').toUpperCase();
          return currency === 'NGN' ? 'Base currency' : (pick(row, ['ExchangeRate']) ? `1 ${currency} = NGN ${pick(row, ['ExchangeRate'])} · ${pick(row, ['ExchangeRateDate'])}` : 'Rate required');
        } },
        { label: 'Method', value: (row) => pick(row, ['PaymentMethod']) },
        { label: 'Type', value: (row) => pick(row, ['PaymentType']) },
        { label: 'Reference', value: (row) => pick(row, ['Reference', 'DonationId']) },
        { label: 'Status', value: (row) => pick(row, ['Status']) },
        {
          label: 'Actions',
          render: (row) => {
            const donationId = pick(row, ['DonationId', '__id']);
            const status = clean(pick(row, ['Status'])).toLowerCase();
            if (!donationId) return 'No id';
            const canSendReceipt = capabilities.canSendReceipt;
            const canCollect = capabilities.canCollect;
            const receiptSent = clean(pick(row, ['ReceiptStatus'])).toLowerCase() === 'sent'
              || Boolean(clean(pick(row, ['ReceiptSentAt'])));
            const paymentLinkSentAt = clean(pick(row, ['PaymentLinkSentAt']));
            const paymentLinkSentTo = clean(pick(row, ['PaymentLinkSentTo']));
            const paymentLinkSent = Boolean(paymentLinkSentAt || paymentLinkSentTo);
            const transactionCurrency = clean(pick(row, ['TransactionCurrency', 'Currency']) || 'NGN').toUpperCase();
            const converted = transactionCurrency === 'NGN' || Number(pick(row, ['BaseAmount'])) > 0;
            let stateAction = '';
            if (receiptSent) {
              stateAction = '<button type="button" class="table-action" disabled aria-disabled="true">Receipt sent</button>';
            } else if (status === 'paid' && canSendReceipt) {
              stateAction = `<button type="button" class="table-action" data-donation-action="sendreceipt" data-donation-id="${escapeHtml(donationId)}">Send receipt</button>`;
            } else if (status === 'pending' && paymentLinkSent) {
              const sentDetail = [paymentLinkSentTo, paymentLinkSentAt].filter(Boolean).join(' · ');
              stateAction = `<button type="button" class="table-action" disabled aria-disabled="true" title="${escapeHtml(sentDetail || 'Payment link sent')}">Payment link sent</button>`;
            } else if (status === 'pending' && canCollect) {
              stateAction = `<button type="button" class="table-action" data-donation-action="sendpayment" data-donation-id="${escapeHtml(donationId)}">Send payment link</button>`;
            }
            const printAction = status === 'paid'
              ? `<button type="button" class="compact-icon-action compact-print-action" data-print-donation="${escapeHtml(donationId)}" aria-label="Choose receipt format for ${escapeHtml(pick(row, ['ReceiptNo']) || donationId)}" title="Choose receipt format"><span aria-hidden="true">&#128424;&#65038;</span></button>`
              : '';
            const qrAction = status === 'pending' && clean(pick(row, ['PaymentLink']))
              ? `<button type="button" class="compact-icon-action" data-donation-qr="${escapeHtml(donationId)}" aria-label="Generate payment QR for ${escapeHtml(donationId)}" title="Generate payment QR"><span aria-hidden="true">&#9638;</span></button>`
              : '';
            const rateAction = !converted && canCollect
              ? `<button type="button" class="table-action" data-donation-rate="${escapeHtml(donationId)}" data-donation-currency="${escapeHtml(transactionCurrency)}">Set NGN rate</button>`
              : '';
            return stateAction || printAction || qrAction || rateAction
              ? `<span class="compact-row-actions">${rateAction}${stateAction}${qrAction}${printAction}</span>`
              : '';
          }
        }
      ])}
      ${table('Donation Audit', data.audit || [], [
        { label: 'Time', value: (row) => pick(row, ['Timestamp']) },
        { label: 'Action', value: (row) => pick(row, ['Action']) },
        { label: 'Receipt', value: (row) => pick(row, ['DonationId']) },
        { label: 'Actor', value: (row) => pick(row, ['Actor']) },
        { label: 'Details', value: (row) => pick(row, ['Details']) }
      ])}
      </section>
      ${directTransferVerificationWorkspace('churchDirectTransferVerification', 'Donation transfers awaiting verification')}`;
    mountWorkspaceTabs('donations', [
      { key: 'overview', label: 'Overview', icon: '\u25A6', nodes: [...panelEl.querySelectorAll(':scope > .workflow-kpis, :scope > .church-dashboard-grid')] },
      { key: 'record', label: 'Record donation', icon: '+', nodes: document.getElementById('donationGivingPanel') },
      { key: 'donors', label: 'Donor register', icon: '\u{1F465}', count: donors.length, nodes: document.getElementById('donationDonorPanel') },
      { key: 'currency', label: 'Foreign currency', icon: '\u00A4', count: foreignHoldings.length, nodes: document.getElementById('donationCurrencyPanel') },
      { key: 'records', label: 'Records & audit', icon: '\u{1F5C2}', count: (data.donations || []).length, nodes: document.getElementById('donationRecordsPanel') },
      { key: 'transfers', label: 'Transfer verification', icon: '\u{1F50E}', nodes: document.getElementById('churchDirectTransferVerification') }
    ]);
    loadDirectTransferVerification(['church-donation'], 'churchDirectTransferVerification');
    const form = document.getElementById('churchDonationForm');
    form?.elements.DonorId?.addEventListener('change', () => {
      const donor = donors.find((row) => clean(row.DonorId || row.__id) === clean(form.elements.DonorId.value));
      if (!donor) return;
      form.elements.DonorName.value = clean(donor.DisplayName);
      form.elements.DonorEmail.value = clean(donor.Email);
      form.elements.DonorPhone.value = clean(donor.Phone);
    });
    const donorForm = document.getElementById('churchDonorForm');
    donorForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = donorForm.querySelector('button[type="submit"]');
      const status = document.getElementById('churchDonorStatus');
      setButtonLoading(button, true, 'Saving...', 'Save donor');
      try {
        const saved = await churchDonationRequest('savedonor', Object.fromEntries(new FormData(donorForm).entries()));
        setStatus(status, saved.message, 'ok');
        await loadChurchDonations();
      } catch (error) {
        setStatus(status, error.message || String(error), 'bad');
      } finally {
        if (button.isConnected) setButtonLoading(button, false, 'Saving...', 'Save donor');
      }
    });
    panelEl.querySelectorAll('[data-edit-donor]').forEach((button) => button.addEventListener('click', () => {
      const donor = donors.find((row) => clean(row.DonorId || row.__id) === clean(button.dataset.editDonor));
      if (!donor || !donorForm) return;
      ['DonorId', 'DisplayName', 'Email', 'Phone', 'Notes'].forEach((field) => {
        if (donorForm.elements[field]) donorForm.elements[field].value = clean(donor[field]);
      });
      donorForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
      donorForm.elements.DisplayName?.focus();
    }));
    document.getElementById('churchCurrencyPolicyForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const policyForm = event.currentTarget;
      const button = policyForm.querySelector('button[type="submit"]');
      setButtonLoading(button, true, 'Saving...', 'Save policy');
      try {
        const saved = await churchDonationRequest('savecurrencysettings', Object.fromEntries(new FormData(policyForm).entries()));
        await loadChurchDonations();
        setStatus(document.getElementById('churchDonationStatus') || dashboardStatus, saved.message, 'ok');
      } catch (error) {
        setStatus(document.getElementById('churchDonationStatus') || dashboardStatus, error.message || String(error), 'bad');
      } finally {
        if (button.isConnected) setButtonLoading(button, false, 'Saving...', 'Save policy');
      }
    });
    const settlementForm = document.getElementById('churchCurrencySettlementForm');
    const settlementCurrency = document.getElementById('churchSettlementCurrency');
    const settlementCalculation = document.getElementById('churchSettlementCalculation');
    const syncSettlementCalculation = () => {
      if (!settlementForm) return;
      const currency = clean(settlementCurrency?.value).toUpperCase();
      const selectedLabels = [...settlementForm.querySelectorAll('[data-settlement-currency]')]
        .filter((label) => !label.hidden && label.querySelector('input[name="DonationIds"]')?.checked);
      const foreignTotal = selectedLabels.reduce((sum, label) => sum + Number(label.dataset.settlementAmount || 0), 0);
      const rate = financialNumber(settlementForm.elements.ExchangeRate?.value);
      const grossNgn = Math.round(((foreignTotal * rate) + Number.EPSILON) * 100) / 100;
      const conversionFee = financialNumber(settlementForm.elements.ConversionFee?.value);
      const grossInput = settlementForm.elements.GrossNgnProceeds;
      if (grossInput) setFinancialInputValue(grossInput, foreignTotal > 0 && rate > 0 ? grossNgn.toFixed(2) : '');
      if (!settlementCalculation) return;
      if (!currency) settlementCalculation.textContent = 'Choose a currency, select its gifts and enter the completed conversion rate.';
      else if (!foreignTotal) settlementCalculation.textContent = `Select one or more ${currency} gifts to calculate their NGN equivalent.`;
      else if (!(rate > 0)) settlementCalculation.textContent = `${moneyInCurrency(foreignTotal, currency)} selected. Enter the NGN conversion rate.`;
      else settlementCalculation.textContent = `${moneyInCurrency(foreignTotal, currency)} × NGN ${rate.toLocaleString(undefined, { maximumFractionDigits: 8 })} = ${money(grossNgn)} gross equivalent · ${money(Math.max(0, grossNgn - conversionFee))} after charges.`;
    };
    const filterSettlementRows = () => {
      const selected = clean(settlementCurrency?.value).toUpperCase();
      panelEl.querySelectorAll('[data-settlement-currency]').forEach((label) => {
        const matches = !selected || clean(label.dataset.settlementCurrency).toUpperCase() === selected;
        const checkbox = label.querySelector('input[name="DonationIds"]');
        label.hidden = !matches;
        if (checkbox) checkbox.checked = Boolean(selected && matches);
      });
      syncSettlementCalculation();
    };
    settlementCurrency?.addEventListener('change', filterSettlementRows);
    settlementForm?.elements.ExchangeRate?.addEventListener('input', syncSettlementCalculation);
    settlementForm?.elements.ConversionFee?.addEventListener('input', syncSettlementCalculation);
    settlementForm?.querySelectorAll('input[name="DonationIds"]').forEach((input) => input.addEventListener('change', syncSettlementCalculation));
    filterSettlementRows();
    settlementForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = settlementForm.querySelector('button[type="submit"]');
      const status = document.getElementById('churchSettlementStatus');
      const payload = Object.fromEntries(new FormData(settlementForm).entries());
      payload.DonationIds = new FormData(settlementForm).getAll('DonationIds');
      if (!payload.DonationIds.length) {
        setStatus(status, 'Select at least one donation from this currency.', 'bad');
        return;
      }
      if (!(financialNumber(payload.ExchangeRate) > 0) || !(financialNumber(payload.GrossNgnProceeds) > 0)) {
        setStatus(status, 'Enter the completed conversion rate to calculate the NGN equivalent.', 'bad');
        return;
      }
      setButtonLoading(button, true, 'Settling...', 'Settle selected gifts');
      try {
        const settled = await churchDonationRequest('settlecurrencybatch', payload);
        setStatus(status, settled.message, settled.accountingStatus === 'Posted' ? 'ok' : 'bad');
        await loadChurchDonations();
      } catch (error) {
        setStatus(status, error.message || String(error), 'bad');
      } finally {
        if (button.isConnected) setButtonLoading(button, false, 'Settling...', 'Settle selected gifts');
      }
    });
    const syncDonationConversionFields = () => {
      if (!form) return;
      const currency = clean(form.elements.Currency?.value || 'NGN').toUpperCase();
      const rateInput = form.elements.ExchangeRate;
      const dateInput = form.elements.ExchangeRateDate;
      const help = form.querySelector('[data-exchange-rate-help]');
      const foreign = currency !== 'NGN';
      const requiresRate = foreign && currencyMode !== 'BATCH_SETTLEMENT';
      if (rateInput) {
        const previousCurrency = clean(rateInput.dataset.currency);
        rateInput.disabled = !requiresRate;
        rateInput.required = requiresRate;
        if (!foreign) rateInput.value = '1';
        else if (rateInput.value === '1' || (previousCurrency && previousCurrency !== currency)) rateInput.value = '';
        rateInput.dataset.currency = currency;
      }
      if (dateInput) {
        dateInput.disabled = !requiresRate;
        dateInput.required = requiresRate;
        if (requiresRate && !dateInput.value) dateInput.value = new Date().toISOString().slice(0, 10);
      }
      if (help) help.textContent = foreign
        ? (requiresRate ? `Enter the NGN value of 1 ${currency}. This rate will be frozen for audit.` : `${currency} will remain unconverted until included in a settlement batch.`)
        : 'NGN donations use a rate of 1.';
    };
    form?.elements.Currency?.addEventListener('change', syncDonationConversionFields);
    form?.addEventListener('reset', () => setTimeout(syncDonationConversionFields, 0));
    syncDonationConversionFields();
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const status = document.getElementById('churchDonationStatus');
      const button = form.querySelector('button[type="submit"]');
      const payload = Object.fromEntries(new FormData(form).entries());
      const idempotencyKey = form.dataset.idempotencyKey || newIdempotencyKey();
      form.dataset.idempotencyKey = idempotencyKey;
      payload.idempotencyKey = idempotencyKey;
      payload.sendReceipt = 'yes';
      payload.Status = clean(payload.Status || '');
      setButtonLoading(button, true, 'Saving...', 'Save donation');
      try {
        const saved = await churchDonationRequest('save', payload);
        setStatus(status, saved.message, 'ok');
        if ((clean(payload.PaymentMethod).toUpperCase() === 'ONLINE') && form.elements.sendOnlineEmail.checked) {
          const paymentIdempotencyKey = form.dataset.paymentIdempotencyKey || newIdempotencyKey();
          form.dataset.paymentIdempotencyKey = paymentIdempotencyKey;
          await initChurchDonationPayment({
            ...(payload || {}),
            action: 'init',
            DonationId: payload.DonationId || saved.donation?.DonationId,
            Reference: saved.donation?.Reference || payload.Reference || '',
            idempotencyKey: paymentIdempotencyKey
          });
        }
        delete form.dataset.idempotencyKey;
        delete form.dataset.paymentIdempotencyKey;
        form.reset();
        await loadChurchDonations();
      } catch (error) {
        if (error?.responseReceived) {
          delete form.dataset.idempotencyKey;
          delete form.dataset.paymentIdempotencyKey;
        }
        setStatus(status, error.message || String(error), 'bad');
      } finally {
        setButtonLoading(button, false, 'Saving...', 'Save donation');
      }
    });
    form?.addEventListener('input', () => {
      if (!form.querySelector('button[type="submit"]')?.disabled) {
        delete form.dataset.idempotencyKey;
        delete form.dataset.paymentIdempotencyKey;
      }
    });

    panelEl.querySelectorAll('[data-print-donation]').forEach((button) => button.addEventListener('click', async () => {
      const donationId = clean(button.dataset.printDonation);
      const donation = (data.donations || []).find((item) => clean(item.DonationId || item.__id) === donationId);
      const format = await chooseReceiptPrintFormat();
      if (!format) return;
      printChurchDonationReceipt(donation, format);
    }));

    panelEl.querySelectorAll('[data-donation-rate]').forEach((button) => button.addEventListener('click', async () => {
      const donationId = clean(button.dataset.donationRate);
      const currency = clean(button.dataset.donationCurrency).toUpperCase();
      const row = (data.donations || []).find((item) => clean(item.DonationId || item.__id) === donationId);
      const entered = await window.DynamaxDialogs.prompt({ title: 'Set conversion rate', message: `Enter the NGN value of 1 ${currency}. The rate will be frozen for this donation.`, label: `NGN value of 1 ${currency}`, required: true, inputMode: 'decimal', confirmText: 'Save rate' });
      if (entered === null) return;
      const exchangeRate = Number(clean(entered).replace(/,/g, ''));
      if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
        setStatus(document.getElementById('churchDonationStatus') || dashboardStatus, 'Enter a valid exchange rate greater than zero.', 'bad');
        return;
      }
      const normalText = button.textContent;
      setButtonLoading(button, true, 'Saving rate...', normalText);
      try {
        const updated = await churchDonationRequest('setconversion', {
          DonationId: donationId,
          ExchangeRate: exchangeRate,
          ExchangeRateDate: clean(row?.PaidAt || row?.CreatedAt).slice(0, 10) || new Date().toISOString().slice(0, 10),
          ExchangeRateSource: 'Manual staff rate'
        });
        await loadChurchDonations();
        setStatus(
          document.getElementById('churchDonationStatus') || dashboardStatus,
          updated.message,
          updated.accountingStatus === 'Pending' ? 'bad' : 'ok'
        );
      } catch (error) {
        setStatus(document.getElementById('churchDonationStatus') || dashboardStatus, error.message || String(error), 'bad');
      } finally {
        if (button.isConnected) setButtonLoading(button, false, 'Saving rate...', normalText);
      }
    }));

    panelEl.querySelectorAll('[data-donation-qr]').forEach((button) => button.addEventListener('click', async () => {
      const donationId = clean(button.dataset.donationQr);
      if (!donationId) return;
      const normalText = button.textContent;
      setButtonLoading(button, true, '', normalText);
      try {
        const qr = await churchDonationRequest('paymentqr', { DonationId: donationId });
        showChurchGivingQr(qr);
      } catch (error) {
        setStatus(document.getElementById('churchDonationStatus') || dashboardStatus, error.message || String(error), 'bad');
      } finally {
        if (button.isConnected) setButtonLoading(button, false, '', normalText);
      }
    }));

    document.getElementById('genericChurchGivingQr')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const normalText = button.textContent;
      setButtonLoading(button, true, 'Generating…', normalText);
      try {
        const qr = await churchDonationRequest('genericqr');
        showChurchGivingQr(qr);
      } catch (error) {
        setStatus(document.getElementById('churchDonationStatus') || dashboardStatus, error.message || String(error), 'bad');
      } finally {
        if (button.isConnected) setButtonLoading(button, false, 'Generating…', normalText);
      }
    });

    document.getElementById('syncChurchDonationAccounting')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const normalText = button.textContent;
      setButtonLoading(button, true, 'Syncing...', normalText);
      try {
        const result = await churchDonationRequest('syncaccounting');
        await loadChurchDonations();
        setStatus(
          document.getElementById('churchDonationStatus') || dashboardStatus,
          result.message,
          result.failedCount ? 'bad' : 'ok'
        );
      } catch (error) {
        setStatus(document.getElementById('churchDonationStatus') || dashboardStatus, error.message || String(error), 'bad');
      } finally {
        if (button.isConnected) setButtonLoading(button, false, 'Syncing...', normalText);
      }
    });

    panelEl.querySelectorAll('[data-donation-action]').forEach((button) => button.addEventListener('click', async () => {
      const action = clean(button.dataset.donationAction);
      const donationId = clean(button.dataset.donationId);
      const row = (data.donations || []).find((item) => clean(item.DonationId || item.__id) === donationId);
      if (!donationId) return;
      const idempotencyKey = button.dataset.idempotencyKey || newIdempotencyKey();
      button.dataset.idempotencyKey = idempotencyKey;
      const normalText = button.textContent;
      setButtonLoading(button, true, `${action}...`, normalText);
      try {
        if (action === 'setstatus') {
          const status = clean(button.dataset.status);
          const updated = await churchDonationRequest('setstatus', {
            DonationId: donationId,
            Status: status,
            sendReceipt: button.dataset.sendReceipt || 'no',
            idempotencyKey
          });
          await loadChurchDonations();
          setStatus(document.getElementById('churchDonationStatus'), updated.message, 'ok');
          return;
        }
        if (action === 'sendreceipt') {
          const updated = await churchDonationRequest('sendreceipt', { DonationId: donationId, idempotencyKey });
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
            TransactionCurrency: row?.TransactionCurrency || row?.Currency || 'NGN',
            BaseCurrency: row?.BaseCurrency || 'NGN',
            BaseAmount: row?.BaseAmount,
            ExchangeRate: row?.ExchangeRate,
            ExchangeRateDate: row?.ExchangeRateDate,
            ExchangeRateSource: row?.ExchangeRateSource,
            PaymentMethod: 'ONLINE',
            PaymentType: row?.PaymentType || 'Donation',
            ReceiptNo: row?.ReceiptNo,
            ReceiptSubject: row?.ReceiptSubject || 'Payment link for your donation',
            ReceiptMessage: row?.ReceiptMessage || 'Click the link to complete your donation payment.',
            idempotencyKey
          };
          const initialized = await initChurchDonationPayment(payload);
          await loadChurchDonations();
          setStatus(document.getElementById('churchDonationStatus'), initialized.message, 'ok');
        }
      } catch (error) {
        if (error?.responseReceived) delete button.dataset.idempotencyKey;
        setStatus(document.getElementById('churchDonationStatus'), error.message || String(error), 'bad');
      } finally {
        setButtonLoading(button, false, `${action}...`, normalText);
      }
    }));

    document.getElementById('refreshChurchDonations')?.addEventListener('click', (event) => {
      runButtonAction(event.currentTarget, 'Refreshing...', loadChurchDonations);
    });
    applyGenericOrganizationVocabulary(panelEl);
  } catch (error) {
    if (activeSection === 'donations') panelEl.innerHTML = `<p class="status bad">${escapeHtml(error.message || String(error))}</p>`;
  }
}

async function staffAttendanceRequest(action, payload = {}) {
  const idempotencyKey = clean(payload.idempotencyKey) || newIdempotencyKey();
  const response = await staffFetch('/api/staff-attendance', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ action, BranchId: currentUser?.branchId || 'main', ...payload, idempotencyKey })
  });
  const data = await response.json().catch(() => ({ ok: false, message: 'Staff attendance service did not return JSON.' }));
  if (!response.ok || !data.ok) throw receivedResponseError(data.message || 'Staff attendance action failed.');
  return data;
}

function attendanceMinutesLabel(value) {
  const minutes = Math.max(0, Number(value || 0) || 0);
  if (!minutes) return '—';
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? `${hours}h${remainder ? ` ${remainder}m` : ''}` : `${remainder}m`;
}

function attendancePresenceStatusText(presenceCheck = {}) {
  if (presenceCheck.status === 'OVERDUE') return 'Confirmation overdue - this will be flagged for HR review.';
  if (presenceCheck.status === 'DUE') return 'A random presence confirmation is due now.';
  if (presenceCheck.status === 'UPCOMING' && presenceCheck.dueAt) {
    return `Next random confirmation: ${new Date(presenceCheck.dueAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  return 'No random presence confirmation is currently due.';
}

function updateAttendancePresenceCard(card, presenceCheck = {}) {
  if (!card) return;
  card.classList.toggle('is-overdue', presenceCheck.status === 'OVERDUE');
  card.classList.toggle('is-due', presenceCheck.status === 'DUE');
  const detail = card.querySelector('small');
  if (detail) detail.textContent = attendancePresenceStatusText(presenceCheck);
  const button = card.querySelector('#staffPresenceButton');
  if (button) button.disabled = !presenceCheck.canConfirm;
}

function attendanceReportDefaults() {
  const now = new Date();
  const localDate = (date) => {
    const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return adjusted.toISOString().slice(0, 10);
  };
  return {
    FromDate: localDate(new Date(now.getFullYear(), now.getMonth(), 1)),
    ToDate: localDate(now),
    Status: 'All',
    StaffSearch: '',
    SortBy: 'date',
    SortDirection: 'desc'
  };
}

function filteredAttendanceReportRows(rows = [], filters = {}) {
  const status = clean(filters.Status || 'All').toLowerCase();
  const search = clean(filters.StaffSearch).toLowerCase();
  const matchesStatus = (row) => {
    if (status === 'all') return true;
    if (status === 'late') return Number(row.LateMinutes || 0) > 0 || clean(row.AttendanceStatus).toLowerCase() === 'late';
    if (status === 'absent') return clean(row.AttendanceStatus).toLowerCase() === 'absent';
    if (status === 'overtime') return Number(row.OvertimeMinutes || 0) > 0;
    if (status === 'early') return Number(row.EarlyDepartureMinutes || 0) > 0;
    return clean(row.AttendanceStatus).toLowerCase() === status;
  };
  const valueFor = (row) => {
    if (filters.SortBy === 'staff') return clean(row.DisplayName || row.Username).toLowerCase();
    if (filters.SortBy === 'status') return clean(row.AttendanceStatus).toLowerCase();
    if (filters.SortBy === 'late') return Number(row.LateMinutes || 0);
    if (filters.SortBy === 'overtime') return Number(row.OvertimeMinutes || 0);
    return clean(row.Date);
  };
  const direction = clean(filters.SortDirection).toLowerCase() === 'asc' ? 1 : -1;
  return rows.filter((row) => matchesStatus(row)
    && (!search || lower([row.DisplayName, row.Username, row.Role].filter(Boolean).join(' ')).includes(search)))
    .sort((left, right) => {
      const a = valueFor(left);
      const b = valueFor(right);
      if (typeof a === 'number' && typeof b === 'number') return (a - b) * direction;
      const compared = String(a).localeCompare(String(b));
      return (compared || clean(left.DisplayName).localeCompare(clean(right.DisplayName))) * direction;
    });
}

function attendanceReportSummary(rows = []) {
  return {
    records: rows.length,
    late: rows.filter((row) => Number(row.LateMinutes || 0) > 0 || clean(row.AttendanceStatus).toLowerCase() === 'late').length,
    absent: rows.filter((row) => clean(row.AttendanceStatus).toLowerCase() === 'absent').length,
    overtime: rows.filter((row) => Number(row.OvertimeMinutes || 0) > 0).length
  };
}

function printStaffAttendanceReport(rows = [], filters = {}) {
  const printable = window.open('', '_blank', 'width=1100,height=760');
  if (!printable) {
    setStatus(dashboardStatus, 'Allow pop-ups to print the attendance report.', 'bad');
    return;
  }
  printable.opener = null;
  const organisation = clean(document.querySelector('[data-school-name]')?.textContent || staffBrand?.textContent) || 'Dynamax';
  const logo = clean(document.querySelector('.nav-logo')?.getAttribute('src') || 'images/Logo.png');
  const summary = attendanceReportSummary(rows);
  const statusLabel = clean(filters.Status || 'All') === 'All' ? 'All attendance records' : `${clean(filters.Status)} records`;
  const body = rows.length ? rows.map((row) => `<tr><td>${escapeHtml(row.Date)}</td><td>${escapeHtml(row.DisplayName || row.Username)}</td><td>${escapeHtml(row.AttendanceStatus)}</td><td>${escapeHtml(row.FirstClockIn ? new Date(row.FirstClockIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '')}</td><td>${escapeHtml(row.LastClockOut ? new Date(row.LastClockOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '')}</td><td>${escapeHtml(attendanceMinutesLabel(row.LateMinutes))}</td><td>${escapeHtml(attendanceMinutesLabel(row.EarlyDepartureMinutes))}</td><td>${escapeHtml(attendanceMinutesLabel(row.OvertimeMinutes))}</td><td>${escapeHtml(attendanceMinutesLabel(row.WorkMinutes))}</td></tr>`).join('') : '<tr><td colspan="9">No attendance records matched the selected filters.</td></tr>';
  printable.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(organisation)} attendance report</title><style>
    @page{size:A4 landscape;margin:10mm}*{box-sizing:border-box}body{margin:24px;color:#17314b;font:11px/1.4 Arial,sans-serif}.brand{display:flex;align-items:center;gap:12px;padding-bottom:12px;border-bottom:3px solid #0b8f76}.brand img{width:52px;height:52px;object-fit:contain}.brand h1{margin:0;color:#123f6d;font-size:20px}.brand p,.meta{margin:3px 0;color:#60758c}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:16px 0}.summary div{padding:10px;border:1px solid #d4e0eb;border-radius:7px}.summary span,.summary strong{display:block}.summary span{color:#60758c;font-size:9px;text-transform:uppercase}.summary strong{margin-top:3px;font-size:18px}table{width:100%;border-collapse:collapse}th,td{padding:7px;border:1px solid #d4e0eb;text-align:left;white-space:nowrap}th{background:#123f6d;color:#fff;font-size:9px;text-transform:uppercase}.footer{display:flex;justify-content:space-between;margin-top:12px;color:#60758c}.print{position:fixed;top:10px;right:10px;width:fit-content;padding:8px 13px;border:0;border-radius:6px;background:#1769e0;color:#fff;font-weight:bold;cursor:pointer}@media print{body{margin:0}.print{display:none}}</style></head><body><button class="print" onclick="window.print()">Print / Save as PDF</button><header class="brand">${logo ? `<img src="${escapeHtml(logo)}" alt="">` : ''}<div><h1>${escapeHtml(organisation)}</h1><p>Staff attendance report · ${escapeHtml(statusLabel)}</p><p class="meta">Period: ${escapeHtml(filters.FromDate)} to ${escapeHtml(filters.ToDate)}</p></div></header><section class="summary"><div><span>Matching records</span><strong>${summary.records}</strong></div><div><span>Late</span><strong>${summary.late}</strong></div><div><span>Absent</span><strong>${summary.absent}</strong></div><div><span>Overtime</span><strong>${summary.overtime}</strong></div></section><table><thead><tr><th>Date</th><th>Staff</th><th>Status</th><th>Clock in</th><th>Clock out</th><th>Late</th><th>Left early</th><th>Overtime</th><th>Worked</th></tr></thead><tbody>${body}</tbody></table><footer class="footer"><span>Prepared by ${escapeHtml(currentUser?.displayName || currentUser?.username || '')}</span><span>Generated ${escapeHtml(new Date().toLocaleString())}</span></footer></body></html>`);
  printable.document.close();
  printable.focus();
  window.setTimeout(() => printable.print(), 250);
}

function requestBrowserPosition(options) {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        Latitude: position.coords.latitude,
        Longitude: position.coords.longitude,
        Accuracy: position.coords.accuracy
      }),
      reject,
      options
    );
  });
}

function browserLocationError(errors = []) {
  const permissionError = errors.find((error) => Number(error?.code) === 1);
  if (permissionError) {
    return new Error('Location access is blocked. Allow precise location for this site in your browser settings, then make sure Location is turned on for the device.');
  }
  if (errors.some((error) => Number(error?.code) === 2)) {
    return new Error('Your device could not determine its location. Turn on Location and Google Location Accuracy (or the equivalent service), move near a window or outdoors, then try again.');
  }
  if (errors.some((error) => Number(error?.code) === 3)) {
    return new Error('Location took too long to respond. Turn on precise location and the device location-accuracy service, then try again.');
  }
  return new Error(errors.find((error) => clean(error?.message))?.message || 'The device could not provide its current location.');
}

async function browserPosition() {
  if (!navigator.geolocation) {
    throw new Error('This device does not provide browser location. Connect to the approved organisation network or use a supported device.');
  }
  if (window.isSecureContext === false) {
    throw new Error('Current location is available only on the secure HTTPS version of this site.');
  }
  let permission = null;
  try {
    if (navigator.permissions?.query) permission = await navigator.permissions.query({ name: 'geolocation' });
  } catch (_error) {
    permission = null;
  }
  if (permission?.state === 'denied') throw browserLocationError([{ code: 1 }]);

  const attempts = [
    { enableHighAccuracy: true, timeout: 30000, maximumAge: 15000 },
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 30000 }
  ];
  return new Promise((resolve, reject) => {
    let pending = attempts.length;
    let bestPosition = null;
    const errors = [];
    let completed = false;
    attempts.forEach((options) => {
      requestBrowserPosition(options).then((position) => {
        if (completed) return;
        pending -= 1;
        if (!bestPosition || Number(position.Accuracy) < Number(bestPosition.Accuracy)) bestPosition = position;
        if (Number(position.Accuracy) <= 150 || pending === 0) {
          completed = true;
          resolve(bestPosition);
        }
      }).catch((error) => {
        if (completed) return;
        errors.push(error);
        pending -= 1;
        if (pending > 0) return;
        completed = true;
        if (bestPosition) resolve(bestPosition);
        else reject(browserLocationError(errors));
      });
    });
  });
}

async function loadStaffAttendance() {
  try {
    const reportFilters = staffAttendanceReportFilters || attendanceReportDefaults();
    staffAttendanceReportFilters = reportFilters;
    const data = await staffAttendanceRequest('list', { FromDate: reportFilters.FromDate, ToDate: reportFilters.ToDate });
    if (activeSection !== 'staffAttendance') return;
    const sites = data.sites || [];
    const configuredSites = data.configuredSites || sites;
    const stateIn = data.state === 'CLOCKED_IN';
    const stateComplete = data.state === 'COMPLETED';
    const nextDirection = data.nextDirection || (stateIn ? 'OUT' : 'IN');
    const capabilities = data.capabilities || {};
    const policy = data.policy || {};
    const workDays = Array.isArray(policy.WorkDays) ? policy.WorkDays : [];
    const attendanceDays = [['MON', 'Monday'], ['TUE', 'Tuesday'], ['WED', 'Wednesday'], ['THU', 'Thursday'], ['FRI', 'Friday'], ['SAT', 'Saturday'], ['SUN', 'Sunday']];
    const daySchedules = policy.DaySchedules || {};
    const todaySchedule = data.todaySchedule || daySchedules[data.todayAttendanceDay] || {};
    const identityMode = clean(policy.IdentityVerification || 'NONE').toUpperCase();
    warmAttendanceIdentity(policy);
    const presenceCheck = data.presenceCheck || { enabled: false };
    const presenceStatusText = attendancePresenceStatusText(presenceCheck);
    const identityChoice = identityMode === 'PASSKEY'
      ? '<input id="staffAttendanceIdentityMethod" type="hidden" value="PASSKEY"><small>Unlock this device with its configured PIN, password or secure screen-lock method.</small>'
      : identityMode === 'FACE'
        ? '<input id="staffAttendanceIdentityMethod" type="hidden" value="FACE"><small>Live face recognition is required. Visual and spoken instructions will guide the capture.</small>'
        : '<input id="staffAttendanceIdentityMethod" type="hidden" value="NONE"><small>Location or approved network verification is required.</small>';
    const myDailyRecords = data.myDailyRecords || [];
    const latestDaily = myDailyRecords.find((row) => clean(row.Date) === clean(data.todayAttendanceDate)) || null;
    const scheduleActive = clean(policy.Active).toUpperCase() !== 'NO';
    const selectedOption = (value, expected) => clean(value).toUpperCase() === expected ? ' selected' : '';
    const attendanceReportRows = filteredAttendanceReportRows(data.recentDailyRecords || [], reportFilters);
    const reportSummary = attendanceReportSummary(attendanceReportRows);
    panelEl.innerHTML = `
      <div class="workflow-intro">
        <div><p class="eyebrow">People & ministry</p><h2>Staff attendance</h2><p class="muted">Verified clock-in/out with automatic lateness, absence, early-departure and overtime calculations.</p></div>
        <button type="button" id="refreshStaffAttendance">Refresh</button>
      </div>
      <div class="workflow-kpis">
        <div><small>Current state</small><strong>${stateComplete ? 'Completed' : stateIn ? 'Clocked in' : 'Clocked out'}</strong><span>${data.myEvents?.[0]?.Timestamp ? escapeHtml(new Date(data.myEvents[0].Timestamp).toLocaleString()) : 'No attendance event yet'}</span></div>
        <div><small>Today's status</small><strong>${escapeHtml(latestDaily?.AttendanceStatus || 'No record')}</strong><span>${latestDaily?.Date ? escapeHtml(latestDaily.Date) : scheduleActive ? 'Awaiting today’s clock-in' : 'Work-hours policy not enabled'}</span></div>
        <div><small>Late today</small><strong>${attendanceMinutesLabel(latestDaily?.LateMinutes)}</strong><span>${todaySchedule.ResumptionTime ? `Resumption ${escapeHtml(todaySchedule.ResumptionTime)} · ${Number(policy.GraceMinutes || 0)}m grace` : 'Not a configured work day'}</span></div>
        <div><small>Overtime today</small><strong>${attendanceMinutesLabel(latestDaily?.OvertimeMinutes)}</strong><span>${todaySchedule.ClosingTime ? `Closing ${escapeHtml(todaySchedule.ClosingTime)}` : 'Not a configured work day'}</span></div>
        <div><small>Approved locations</small><strong>${sites.length}</strong><span>Geofence or organisation network</span></div>
      </div>
      <section class="attendance-clock-card ${stateIn ? 'is-clocked-in' : ''}">
        <div><p class="eyebrow">My attendance</p><h3>${stateComplete ? 'Attendance completed for today' : stateIn ? 'Ready to clock out?' : 'Ready to clock in?'}</h3><p>${scheduleActive && todaySchedule.Enabled ? `Today: ${escapeHtml(todaySchedule.ResumptionTime)}-${escapeHtml(todaySchedule.ClosingTime)}. ` : ''}Your precise coordinates are used only to validate your distance and are not stored in the attendance record. The first successful clock-in and clock-out cannot be replaced by repeated attempts.</p></div>
        <div class="attendance-clock-controls">
          <label>Location <select id="staffAttendanceSite"><option value="">Choose location</option>${sites.map((site) => `<option value="${escapeHtml(site.SiteId || site.__id)}">${escapeHtml(site.Name)}</option>`).join('')}</select></label>
          ${identityChoice}
          <button type="button" id="staffClockButton" ${sites.length && !stateComplete ? '' : 'disabled'}>${stateComplete ? 'Completed' : nextDirection === 'IN' ? 'Clock in' : 'Clock out'}</button>
        </div>
        ${identityMode === 'PASSKEY' ? '<div class="attendance-security-actions"><button type="button" class="secondary" id="setupAttendancePasskey">Set up device unlock</button></div>' : identityMode === 'FACE' ? '<div class="attendance-security-actions"><button type="button" class="secondary" id="setupAttendancePasskey">Set up device unlock</button><button type="button" class="secondary" id="enrollAttendanceFace">Enroll or replace my face</button><button type="button" class="secondary danger" id="removeAttendanceFace">Remove face enrollment</button></div>' : ''}
        ${presenceCheck.enabled && stateIn ? `<div class="attendance-presence-check ${presenceCheck.status === 'OVERDUE' ? 'is-overdue' : presenceCheck.status === 'DUE' ? 'is-due' : ''}"><div><strong>Random presence confirmation</strong><small>${escapeHtml(presenceStatusText)}</small></div><button type="button" id="staffPresenceButton" ${presenceCheck.canConfirm ? '' : 'disabled'}>Confirm presence</button></div>` : ''}
        <p class="status" id="staffAttendanceStatus"></p>
      </section>
      ${table('My daily attendance', myDailyRecords, [
        { label: 'Date', value: (row) => row.Date },
        { label: 'Status', value: (row) => row.AttendanceStatus },
        { label: 'Clock in', value: (row) => row.FirstClockIn ? new Date(row.FirstClockIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '' },
        { label: 'Clock out', value: (row) => row.LastClockOut ? new Date(row.LastClockOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '' },
        { label: 'Late', value: (row) => attendanceMinutesLabel(row.LateMinutes) },
        { label: 'Left early', value: (row) => attendanceMinutesLabel(row.EarlyDepartureMinutes) },
        { label: 'Overtime', value: (row) => attendanceMinutesLabel(row.OvertimeMinutes) },
        { label: 'Worked', value: (row) => attendanceMinutesLabel(row.WorkMinutes) },
        { label: 'Presence checks', value: (row) => Number(row.PresenceCheckCount || 0) },
        { label: 'Missed checks', value: (row) => Number(row.MissedPresenceChecks || 0) }
      ])}
      ${table('My attendance history', data.myEvents || [], [
        { label: 'Time', value: (row) => row.Timestamp },
        { label: 'Action', value: (row) => row.Direction === 'CHECK' ? 'Presence check' : row.Direction === 'IN' ? 'Clock in' : 'Clock out' },
        { label: 'Status', value: (row) => row.AttendanceStatus },
        { label: 'Location', value: (row) => row.SiteName },
        { label: 'Verified by', value: (row) => row.VerificationMethod },
        { label: 'Distance', value: (row) => row.DistanceMetres === null || row.DistanceMetres === undefined ? '' : `${row.DistanceMetres} m` }
      ])}
      ${capabilities.canManage ? `<section class="config-group">
        <header><strong>Daily work hours</strong><small>After the configured closing time, active staff without a clock-in are marked absent automatically. Approved leave is recorded separately.</small></header>
        <form id="staffAttendancePolicyForm" class="workflow-form config-form">
          <input name="ResumptionTime" type="hidden" value="${escapeHtml(policy.ResumptionTime || '08:00')}">
          <input name="ClosingTime" type="hidden" value="${escapeHtml(policy.ClosingTime || '17:00')}">
          <nav class="attendance-settings-tabs" role="tablist" aria-label="Attendance policy settings">
            <button type="button" role="tab" id="attendancePolicyTabGeneral" aria-controls="attendancePolicyPanelGeneral" aria-selected="true" data-attendance-policy-tab="general">General</button>
            <button type="button" role="tab" id="attendancePolicyTabIdentity" aria-controls="attendancePolicyPanelIdentity" aria-selected="false" data-attendance-policy-tab="identity">Identity</button>
            <button type="button" role="tab" id="attendancePolicyTabPresence" aria-controls="attendancePolicyPanelPresence" aria-selected="false" data-attendance-policy-tab="presence">Presence</button>
            <button type="button" role="tab" id="attendancePolicyTabSchedule" aria-controls="attendancePolicyPanelSchedule" aria-selected="false" data-attendance-policy-tab="schedule">Weekly schedule</button>
          </nav>
          <section class="attendance-settings-panel" id="attendancePolicyPanelGeneral" role="tabpanel" aria-labelledby="attendancePolicyTabGeneral" data-attendance-policy-panel="general">
            <div class="config-grid">
              <label>Policy status <select name="Active"><option value="YES"${selectedOption(policy.Active, 'YES')}>Enabled</option><option value="NO"${selectedOption(policy.Active, 'NO')}>Disabled</option></select></label>
              <label>Grace period (minutes) <input name="GraceMinutes" type="number" min="0" max="180" value="${Number(policy.GraceMinutes ?? 15)}" required></label>
              <label>Clock-in opens before resumption (minutes) <input name="ClockInOpenMinutesBefore" type="number" min="0" max="360" value="${Number(policy.ClockInOpenMinutesBefore ?? 60)}" required></label>
              <label>Minimum overtime (minutes) <input name="OvertimeMinimumMinutes" type="number" min="0" max="240" value="${Number(policy.OvertimeMinimumMinutes ?? 15)}" required></label>
              <label>Time zone <input name="TimeZone" value="${escapeHtml(policy.TimeZone || 'Africa/Lagos')}" required></label>
            </div>
            <p class="attendance-settings-note">Clock-in attempts before the opening window are rejected and kept in the attendance security audit. The default is 60 minutes before each day's resumption time.</p>
            <label class="check-row config-switch"><input type="checkbox" name="AutoRecordAbsence" value="YES" ${clean(policy.AutoRecordAbsence).toUpperCase() !== 'NO' ? 'checked' : ''}><span>Automatically record absence after closing time when there is no clock-in</span></label>
          </section>
          <section class="attendance-settings-panel" id="attendancePolicyPanelIdentity" role="tabpanel" aria-labelledby="attendancePolicyTabIdentity" data-attendance-policy-panel="identity" hidden>
            <div class="config-grid"><label>Clock identity verification <select name="IdentityVerification"><option value="NONE"${selectedOption(identityMode, 'NONE')}>Location/network only</option><option value="PASSKEY"${selectedOption(identityMode, 'PASSKEY')}>Device unlock required</option><option value="FACE"${selectedOption(identityMode, 'FACE')}>Live face recognition required</option></select></label></div>
            <p class="attendance-settings-note"><strong>Device unlock</strong> uses the phone or computer PIN, password, fingerprint or built-in face unlock. <strong>Live face recognition</strong> uses the staff member's encrypted mathematical face template, requires a blink, and provides visual and spoken camera guidance.</p>
          </section>
          <section class="attendance-settings-panel" id="attendancePolicyPanelPresence" role="tabpanel" aria-labelledby="attendancePolicyTabPresence" data-attendance-policy-panel="presence" hidden>
            <div class="config-grid">
              <label>Continued-presence checks <select name="PresenceCheckMode" id="staffPresenceCheckMode"><option value="NONE"${selectedOption(policy.PresenceCheckMode, 'NONE')}>Disabled</option><option value="RANDOM"${selectedOption(policy.PresenceCheckMode, 'RANDOM')}>Random intervals</option></select></label>
              <label data-attendance-presence-setting>Minimum random interval (minutes) <input name="PresenceCheckMinimumMinutes" type="number" min="15" max="480" value="${Number(policy.PresenceCheckMinimumMinutes ?? 90)}" required></label>
              <label data-attendance-presence-setting>Maximum random interval (minutes) <input name="PresenceCheckMaximumMinutes" type="number" min="15" max="720" value="${Number(policy.PresenceCheckMaximumMinutes ?? 180)}" required></label>
              <label data-attendance-presence-setting>Confirmation grace period (minutes) <input name="PresenceCheckGraceMinutes" type="number" min="5" max="180" value="${Number(policy.PresenceCheckGraceMinutes ?? 20)}" required></label>
            </div>
            <p class="attendance-settings-note">Random checks require the staff member to verify identity and location again during the working day. Missed checks are flagged for HR review.</p>
          </section>
          <section class="attendance-settings-panel" id="attendancePolicyPanelSchedule" role="tabpanel" aria-labelledby="attendancePolicyTabSchedule" data-attendance-policy-panel="schedule" hidden>
            <fieldset class="attendance-week-schedule"><legend>Working days and times</legend><div class="attendance-week-schedule-head"><span>Day</span><span>Working</span><span>Resumption</span><span>Closing</span></div>${attendanceDays.map(([day, label]) => { const schedule = daySchedules[day] || { Enabled: workDays.includes(day), ResumptionTime: policy.ResumptionTime || '08:00', ClosingTime: policy.ClosingTime || '17:00' }; return `<div class="attendance-week-schedule-row"><strong>${label}</strong><label class="check-row"><input type="checkbox" name="Schedule_${day}_Enabled" ${schedule.Enabled ? 'checked' : ''}><span>Working</span></label><label class="attendance-day-time"><span>${label} resumption</span><input name="Schedule_${day}_ResumptionTime" type="time" value="${escapeHtml(schedule.ResumptionTime)}" required></label><label class="attendance-day-time"><span>${label} closing</span><input name="Schedule_${day}_ClosingTime" type="time" value="${escapeHtml(schedule.ClosingTime)}" required></label></div>`; }).join('')}</fieldset>
          </section>
          <div class="config-dialog-actions"><p class="status" id="staffAttendancePolicyStatus">${data.policyConfigured ? 'Current branch policy loaded.' : 'Save the policy to activate automatic calculations.'}</p><button type="submit">Save work hours</button></div>
        </form>
      </section>
      <section class="config-group">
        <header><strong>Attendance locations</strong><small>Geofence is recommended. The approved public network is a fallback; browsers cannot securely read a Wi-Fi name.</small></header>
        <form id="staffAttendanceSiteForm" class="workflow-form config-form">
          <input name="SiteId" type="hidden">
          <div class="config-grid">
            <label>Location name <input name="Name" required placeholder="Main church premises"></label>
            <label>Latitude <input name="Latitude" type="number" step="any" required></label>
            <label>Longitude <input name="Longitude" type="number" step="any" required></label>
            <label>Allowed radius (metres) <input name="RadiusMetres" type="number" min="20" max="5000" value="150" required></label>
            <label>Maximum GPS uncertainty (metres) <input name="MaxAccuracyMetres" type="number" min="10" max="2000" value="100" required></label>
            <label>Verification rule <select name="Policy"><option value="GEOFENCE_OR_NETWORK">Geofence or approved network</option><option value="GEOFENCE_ONLY">Geofence only</option><option value="NETWORK_ONLY">Approved network only</option></select></label>
            <label>Other approved public IPs <input name="AllowedPublicIps" placeholder="Comma-separated, optional"></label>
            <label>Status <select name="Active"><option value="YES">Active</option><option value="NO">Inactive</option></select></label>
          </div>
          <label class="check-row config-switch"><input type="checkbox" name="UseCurrentNetwork" value="yes"><span>Also approve the public network currently in use</span></label>
          <div class="config-dialog-actions"><p class="status" id="staffAttendanceSiteStatus"></p><button type="button" id="useAttendanceLocation">Use my current location</button><button type="submit">Save location</button></div>
        </form>
        ${table('Configured attendance locations', configuredSites, [
          { label: 'Location', value: (row) => row.Name },
          { label: 'Rule', value: (row) => clean(row.Policy).replaceAll('_', ' ').toLowerCase() },
          { label: 'Radius', value: (row) => `${row.RadiusMetres || 0} m` },
          { label: 'Networks', value: (row) => `${row.AllowedPublicIps?.length || 0} approved` },
          { label: 'Action', render: (row) => `<span class="compact-row-actions"><button type="button" class="compact-icon-action compact-edit-action" data-edit-attendance-site="${escapeHtml(row.SiteId || row.__id)}" title="Edit location" aria-label="Edit ${escapeHtml(row.Name || 'attendance location')}">&#9998;</button><button type="button" class="compact-icon-action compact-delete-action" data-delete-attendance-site="${escapeHtml(row.SiteId || row.__id)}" data-attendance-site-name="${escapeHtml(row.Name || 'attendance location')}" title="Delete location" aria-label="Delete ${escapeHtml(row.Name || 'attendance location')}">&#128465;&#65038;</button></span>` }
        ])}
      </section>
      <section class="config-group">
        <header><strong>Manual correction</strong><small>For an authorised exception only. Every correction keeps the reason and administrator in an audit trail.</small></header>
        <form id="staffAttendanceManualForm" class="inline-policy-form">
          ${hrPersonPicker('staffAttendanceManualUsername', 'Staff member', data.staffDirectory || [])}
          <input name="DisplayName" type="hidden">
          <label>Action <select name="Direction"><option value="IN">Clock in</option><option value="OUT">Clock out</option></select></label>
          <label>Time <input name="Timestamp" type="datetime-local" required></label>
          <label>Reason <input name="Reason" minlength="5" required></label>
          <button type="submit">Record correction</button>
        </form>
        <p class="status" id="staffAttendanceManualStatus"></p>
      </section>` : ''}
      ${capabilities.canReport ? `<section class="config-group attendance-report-workspace">
        <header><strong>HR attendance report</strong><small>Choose a period, isolate lateness or absence records, sort the list, then print or save it as PDF.</small></header>
        <form id="staffAttendanceReportForm" class="inline-policy-form attendance-report-filters">
          <label>From <input name="FromDate" type="date" value="${escapeHtml(reportFilters.FromDate)}" required></label>
          <label>To <input name="ToDate" type="date" value="${escapeHtml(reportFilters.ToDate)}" required></label>
          <label>Record type <select name="Status"><option value="All"${selectedOption(reportFilters.Status, 'ALL')}>All records</option><option value="Late"${selectedOption(reportFilters.Status, 'LATE')}>Lateness</option><option value="Absent"${selectedOption(reportFilters.Status, 'ABSENT')}>Absence</option><option value="Overtime"${selectedOption(reportFilters.Status, 'OVERTIME')}>Overtime</option><option value="Early"${selectedOption(reportFilters.Status, 'EARLY')}>Early departure</option><option value="Present"${selectedOption(reportFilters.Status, 'PRESENT')}>Present</option><option value="Approved leave"${selectedOption(reportFilters.Status, 'APPROVED LEAVE')}>Approved leave</option><option value="Incomplete"${selectedOption(reportFilters.Status, 'INCOMPLETE')}>Incomplete</option></select></label>
          <label>Find staff <input name="StaffSearch" value="${escapeHtml(reportFilters.StaffSearch)}" placeholder="Name or username"></label>
          <label>Sort by <select name="SortBy"><option value="date"${selectedOption(reportFilters.SortBy, 'DATE')}>Date</option><option value="staff"${selectedOption(reportFilters.SortBy, 'STAFF')}>Staff name</option><option value="status"${selectedOption(reportFilters.SortBy, 'STATUS')}>Status</option><option value="late"${selectedOption(reportFilters.SortBy, 'LATE')}>Late minutes</option><option value="overtime"${selectedOption(reportFilters.SortBy, 'OVERTIME')}>Overtime minutes</option></select></label>
          <label>Order <select name="SortDirection"><option value="desc"${selectedOption(reportFilters.SortDirection, 'DESC')}>Descending</option><option value="asc"${selectedOption(reportFilters.SortDirection, 'ASC')}>Ascending</option></select></label>
          <button type="submit">Apply filters</button><button type="button" id="printStaffAttendanceReport" ${attendanceReportRows.length ? '' : 'disabled'}>Print report</button>
        </form>
        <div class="workflow-kpis attendance-report-summary"><div><small>Matching records</small><strong>${reportSummary.records}</strong><span>Selected period and filters</span></div><div><small>Late</small><strong>${reportSummary.late}</strong><span>Beyond the grace period</span></div><div><small>Absent</small><strong>${reportSummary.absent}</strong><span>No clock-in after closing</span></div><div><small>Overtime</small><strong>${reportSummary.overtime}</strong><span>Beyond the overtime threshold</span></div></div>
        ${data.reportTruncated ? '<p class="status bad">The report reached the 5,000-record safety limit. Choose a shorter period before printing.</p>' : ''}
        ${table('Filtered attendance records', attendanceReportRows, [
          { label: 'Date', value: (row) => row.Date },
          { label: 'Staff', value: (row) => row.DisplayName || row.Username },
          { label: 'Status', value: (row) => row.AttendanceStatus },
          { label: 'Clock in', value: (row) => row.FirstClockIn ? new Date(row.FirstClockIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '' },
          { label: 'Clock out', value: (row) => row.LastClockOut ? new Date(row.LastClockOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '' },
          { label: 'Late', value: (row) => attendanceMinutesLabel(row.LateMinutes) },
          { label: 'Left early', value: (row) => attendanceMinutesLabel(row.EarlyDepartureMinutes) },
          { label: 'Overtime', value: (row) => attendanceMinutesLabel(row.OvertimeMinutes) },
          { label: 'Worked', value: (row) => attendanceMinutesLabel(row.WorkMinutes) },
          { label: 'Presence', value: (row) => row.PresenceStatus || '' },
          { label: 'Missed checks', value: (row) => Number(row.MissedPresenceChecks || 0) }
        ])}
      </section>` : ''}
      ${capabilities.canReport ? table('Recent staff attendance', data.recentEvents || [], [
        { label: 'Staff', value: (row) => row.DisplayName || row.Username },
        { label: 'Time', value: (row) => row.Timestamp },
        { label: 'Action', value: (row) => row.Direction === 'CHECK' ? 'Presence check' : row.Direction === 'IN' ? 'Clock in' : 'Clock out' },
        { label: 'Status', value: (row) => row.AttendanceStatus },
        { label: 'Location', value: (row) => row.SiteName },
        { label: 'Verification', value: (row) => row.VerificationMethod },
        { label: 'Correction', value: (row) => row.ManualOverride ? row.OverrideReason : '' }
      ]) : ''}`;

    const attendanceGroups = [...panelEl.querySelectorAll(':scope > .config-group')];
    mountWorkspaceTabs('staffAttendance', [
      { key: 'clock', label: 'Clock in / out', icon: '\u23F1', nodes: [panelEl.querySelector(':scope > .workflow-kpis'), panelEl.querySelector(':scope > .attendance-clock-card')] },
      { key: 'my-history', label: 'My history', icon: '\u{1F5C2}', count: myDailyRecords.length, nodes: [...workspaceTableNodes('My daily attendance'), ...workspaceTableNodes('My attendance history')] },
      { key: 'policy', label: 'Work hours', icon: '\u23F0', nodes: attendanceGroups.find((node) => /daily work hours/i.test(node.textContent)) },
      { key: 'locations', label: 'Locations', icon: '\u2316', count: configuredSites.length, nodes: attendanceGroups.find((node) => /attendance locations/i.test(node.textContent)) },
      { key: 'corrections', label: 'Corrections', icon: '\u270E', nodes: attendanceGroups.find((node) => /manual correction/i.test(node.textContent)) },
      { key: 'reports', label: 'Reports', icon: '\u03A3', count: attendanceReportRows.length, nodes: [attendanceGroups.find((node) => /HR attendance report/i.test(node.textContent)), ...workspaceTableNodes('Recent staff attendance')] }
    ]);
    document.getElementById('refreshStaffAttendance')?.addEventListener('click', (event) => runButtonAction(event.currentTarget, 'Refreshing...', loadStaffAttendance));
    const attendanceReportForm = document.getElementById('staffAttendanceReportForm');
    attendanceReportForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = attendanceReportForm.querySelector('button[type="submit"]');
      setButtonLoading(button, true, 'Applying...', 'Apply filters');
      try {
        staffAttendanceReportFilters = Object.fromEntries(new FormData(attendanceReportForm).entries());
        await loadStaffAttendance();
      } catch (error) {
        setStatus(dashboardStatus, error.message || String(error), 'bad');
      } finally {
        if (button.isConnected) setButtonLoading(button, false, 'Applying...', 'Apply filters');
      }
    });
    document.getElementById('printStaffAttendanceReport')?.addEventListener('click', () => printStaffAttendanceReport(attendanceReportRows, reportFilters));
    bindHrPersonPickers(panelEl);
    hrFormStaffNameSync(document.getElementById('staffAttendanceManualForm'), data.staffDirectory || []);
    const policyForm = document.getElementById('staffAttendancePolicyForm');
    const policyTabButtons = [...(policyForm?.querySelectorAll('[data-attendance-policy-tab]') || [])];
    const policyTabPanels = [...(policyForm?.querySelectorAll('[data-attendance-policy-panel]') || [])];
    const policyTabNames = policyTabButtons.map((button) => clean(button.dataset.attendancePolicyTab));
    const policyTabStorageKey = `dynamax:staff-attendance:policy-tab:${clean(data.branchId) || 'main'}`;
    const activatePolicyTab = (requestedTab, focus = false) => {
      const tab = policyTabNames.includes(clean(requestedTab)) ? clean(requestedTab) : 'general';
      policyTabButtons.forEach((button) => {
        const selected = clean(button.dataset.attendancePolicyTab) === tab;
        button.setAttribute('aria-selected', selected ? 'true' : 'false');
        button.tabIndex = selected ? 0 : -1;
        if (selected && focus) button.focus();
      });
      policyTabPanels.forEach((panel) => { panel.hidden = clean(panel.dataset.attendancePolicyPanel) !== tab; });
      try { window.localStorage.setItem(policyTabStorageKey, tab); } catch (_error) { /* Browser storage is optional. */ }
    };
    let savedPolicyTab = 'general';
    try { savedPolicyTab = window.localStorage.getItem(policyTabStorageKey) || 'general'; } catch (_error) { /* Browser storage is optional. */ }
    activatePolicyTab(savedPolicyTab);
    policyTabButtons.forEach((button, index) => {
      button.addEventListener('click', () => activatePolicyTab(button.dataset.attendancePolicyTab));
      button.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const nextIndex = event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? policyTabButtons.length - 1
            : (index + (event.key === 'ArrowRight' ? 1 : -1) + policyTabButtons.length) % policyTabButtons.length;
        activatePolicyTab(policyTabButtons[nextIndex].dataset.attendancePolicyTab, true);
      });
    });
    policyForm?.addEventListener('invalid', (event) => {
      const panel = event.target.closest('[data-attendance-policy-panel]');
      if (panel) activatePolicyTab(panel.dataset.attendancePolicyPanel);
    }, true);
    const presenceMode = policyForm?.querySelector('#staffPresenceCheckMode');
    const syncPresenceSettings = () => {
      const disabled = clean(presenceMode?.value).toUpperCase() !== 'RANDOM';
      policyForm?.querySelectorAll('[data-attendance-presence-setting]').forEach((label) => {
        label.classList.toggle('is-disabled', disabled);
        const input = label.querySelector('input');
        if (input) input.disabled = disabled;
      });
    };
    presenceMode?.addEventListener('change', syncPresenceSettings);
    syncPresenceSettings();
    policyForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = policyForm.querySelector('button[type="submit"]');
      const status = document.getElementById('staffAttendancePolicyStatus');
      setButtonLoading(button, true, 'Saving...', 'Save work hours');
      try {
        const formData = new FormData(policyForm);
        const payload = Object.fromEntries(formData.entries());
        payload.DaySchedules = Object.fromEntries(attendanceDays.map(([day]) => [day, {
          Enabled: formData.has(`Schedule_${day}_Enabled`),
          ResumptionTime: clean(formData.get(`Schedule_${day}_ResumptionTime`)),
          ClosingTime: clean(formData.get(`Schedule_${day}_ClosingTime`))
        }]));
        payload.WorkDays = attendanceDays.filter(([day]) => payload.DaySchedules[day].Enabled).map(([day]) => day);
        const firstWorkingSchedule = payload.WorkDays.length ? payload.DaySchedules[payload.WorkDays[0]] : null;
        if (firstWorkingSchedule) {
          payload.ResumptionTime = firstWorkingSchedule.ResumptionTime;
          payload.ClosingTime = firstWorkingSchedule.ClosingTime;
        }
        payload.AutoRecordAbsence = formData.has('AutoRecordAbsence') ? 'YES' : 'NO';
        const result = await staffAttendanceRequest('savepolicy', payload);
        await loadStaffAttendance();
        setStatus(document.getElementById('staffAttendancePolicyStatus') || dashboardStatus, result.message, 'ok');
      } catch (error) {
        setStatus(status, error.message || String(error), 'bad');
      } finally {
        if (button.isConnected) setButtonLoading(button, false, 'Saving...', 'Save work hours');
      }
    });
    document.getElementById('staffClockButton')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const status = document.getElementById('staffAttendanceStatus');
      const siteId = clean(document.getElementById('staffAttendanceSite')?.value);
      let clockRecorded = false;
      if (!siteId) {
        setStatus(status, 'Choose the attendance location first.', 'bad');
        return;
      }
      setButtonLoading(button, true, 'Verifying...', nextDirection === 'IN' ? 'Clock in' : 'Clock out');
      try {
        const { location, attendanceProof } = await attendanceVerificationEvidence(policy, siteId, nextDirection);
        const result = await staffAttendanceRequest('clock', {
          SiteId: siteId,
          Direction: nextDirection,
          Location: location,
          AttendanceProof: attendanceProof
        });
        clockRecorded = true;
        setStatus(status || dashboardStatus, result.message, 'ok');
        window.setTimeout(() => void loadStaffAttendance(), 0);
      } catch (error) {
        setStatus(status, error.message || String(error), 'bad');
      } finally {
        if (button.isConnected) {
          setButtonLoading(button, false, 'Verifying...', nextDirection === 'IN' ? 'Clock in' : 'Clock out');
          if (clockRecorded) button.disabled = true;
        }
      }
    });
    document.getElementById('staffPresenceButton')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const status = document.getElementById('staffAttendanceStatus');
      const siteId = clean(document.getElementById('staffAttendanceSite')?.value);
      let nextPresenceCheck = null;
      if (!siteId) {
        setStatus(status, 'Choose the attendance location before confirming your presence.', 'bad');
        return;
      }
      setButtonLoading(button, true, 'Confirming...', 'Confirm presence');
      try {
        const { location, attendanceProof } = await attendanceVerificationEvidence(policy, siteId, 'CHECK');
        const result = await staffAttendanceRequest('presence', {
          SiteId: siteId,
          Location: location,
          AttendanceProof: attendanceProof
        });
        nextPresenceCheck = result.presenceCheck || {};
        Object.assign(presenceCheck, nextPresenceCheck);
        if (latestDaily && result.daily) Object.assign(latestDaily, result.daily);
        updateAttendancePresenceCard(button.closest('.attendance-presence-check'), nextPresenceCheck);
        setStatus(status || dashboardStatus, result.message, 'ok');
      } catch (error) {
        setStatus(status, error.message || String(error), 'bad');
      } finally {
        if (button.isConnected) {
          setButtonLoading(button, false, 'Confirming...', 'Confirm presence');
          if (nextPresenceCheck) button.disabled = !nextPresenceCheck.canConfirm;
        }
      }
    });
    document.getElementById('setupAttendancePasskey')?.addEventListener('click', () => passkeySetupButton.click());
    document.getElementById('enrollAttendanceFace')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const status = document.getElementById('staffAttendanceStatus');
      setButtonLoading(button, true, 'Verifying...', 'Enroll or replace my face');
      try {
        const proof = await attendancePasskeyProof('SELF', 'ENROLL');
        const module = await attendanceFaceModule();
        const result = await module.captureStaffAttendanceFace({ mode: 'enroll', attendanceProof: proof });
        if (result) setStatus(status, result.message, 'ok');
      } catch (error) {
        setStatus(status, friendlyDeviceUnlockError(error), 'bad');
      } finally {
        if (button.isConnected) setButtonLoading(button, false, 'Verifying...', 'Enroll or replace my face');
      }
    });
    document.getElementById('removeAttendanceFace')?.addEventListener('click', async (event) => {
      const confirmed = await window.DynamaxDialogs.confirm({
        title: 'Remove attendance face',
        message: 'Remove your encrypted attendance face enrollment? Face clocking will remain unavailable until you enroll again.',
        tone: 'danger',
        confirmText: 'Remove enrollment'
      });
      if (!confirmed) return;
      const button = event.currentTarget;
      const status = document.getElementById('staffAttendanceStatus');
      setButtonLoading(button, true, 'Removing...', 'Remove face enrollment');
      try {
        const proof = await attendancePasskeyProof('SELF', 'REVOKE');
        const module = await attendanceFaceModule();
        const result = await module.revokeStaffAttendanceFace(proof);
        setStatus(status, result.message, 'ok');
      } catch (error) {
        setStatus(status, friendlyDeviceUnlockError(error), 'bad');
      } finally {
        if (button.isConnected) setButtonLoading(button, false, 'Removing...', 'Remove face enrollment');
      }
    });
    const siteForm = document.getElementById('staffAttendanceSiteForm');
    panelEl.querySelectorAll('[data-edit-attendance-site]').forEach((button) => button.addEventListener('click', () => {
      const site = configuredSites.find((row) => clean(row.SiteId || row.__id) === clean(button.dataset.editAttendanceSite));
      if (!site || !siteForm) return;
      ['SiteId', 'Name', 'Latitude', 'Longitude', 'RadiusMetres', 'MaxAccuracyMetres', 'Policy', 'Active'].forEach((field) => {
        if (siteForm.elements[field]) siteForm.elements[field].value = site[field] ?? '';
      });
      siteForm.elements.AllowedPublicIps.value = (site.AllowedPublicIps || []).join(', ');
      siteForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
      siteForm.elements.Name?.focus();
    }));
    panelEl.querySelectorAll('[data-delete-attendance-site]').forEach((button) => button.addEventListener('click', async () => {
      const siteId = clean(button.dataset.deleteAttendanceSite);
      const siteName = clean(button.dataset.attendanceSiteName) || 'this attendance location';
      if (!siteId || !await window.DynamaxDialogs.confirm({ title: 'Delete attendance location', message: `Delete ${siteName}? Existing attendance history will remain unchanged.`, tone: 'danger', confirmText: 'Delete location' })) return;
      button.disabled = true;
      try {
        const result = await staffAttendanceRequest('deletesite', { SiteId: siteId });
        await loadStaffAttendance();
        setStatus(document.getElementById('staffAttendanceSiteStatus') || dashboardStatus, result.message, 'ok');
      } catch (error) {
        button.disabled = false;
        setStatus(document.getElementById('staffAttendanceSiteStatus') || dashboardStatus, error.message || String(error), 'bad');
      }
    }));
    document.getElementById('useAttendanceLocation')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      setButtonLoading(button, true, 'Locating...', 'Use my current location');
      try {
        const position = await browserPosition();
        siteForm.elements.Latitude.value = position.Latitude.toFixed(7);
        siteForm.elements.Longitude.value = position.Longitude.toFixed(7);
        const accuracy = Math.round(position.Accuracy);
        const accurateEnough = accuracy <= Number(siteForm.elements.MaxAccuracyMetres?.value || 100);
        setStatus(document.getElementById('staffAttendanceSiteStatus'), accurateEnough
          ? `Location captured with about ${accuracy} m accuracy.`
          : `Coordinates loaded, but accuracy is only about ${accuracy} m. Move near a window or outdoors and try again before saving.`, accurateEnough ? 'ok' : 'bad');
      } catch (error) {
        setStatus(document.getElementById('staffAttendanceSiteStatus'), error.message || String(error), 'bad');
      } finally {
        setButtonLoading(button, false, 'Locating...', 'Use my current location');
      }
    });
    siteForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = siteForm.querySelector('button[type="submit"]');
      setButtonLoading(button, true, 'Saving...', 'Save location');
      try {
        const result = await staffAttendanceRequest('savesite', Object.fromEntries(new FormData(siteForm).entries()));
        await loadStaffAttendance();
        setStatus(document.getElementById('staffAttendanceSiteStatus') || dashboardStatus, result.message, 'ok');
      } catch (error) {
        setStatus(document.getElementById('staffAttendanceSiteStatus'), error.message || String(error), 'bad');
      } finally {
        if (button.isConnected) setButtonLoading(button, false, 'Saving...', 'Save location');
      }
    });
    const manualForm = document.getElementById('staffAttendanceManualForm');
    if (manualForm?.elements.Timestamp) {
      const localNow = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      manualForm.elements.Timestamp.value = localNow;
    }
    manualForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = manualForm.querySelector('button[type="submit"]');
      const status = document.getElementById('staffAttendanceManualStatus');
      setButtonLoading(button, true, 'Recording...', 'Record correction');
      try {
        const payload = Object.fromEntries(new FormData(manualForm).entries());
        payload.Timestamp = new Date(payload.Timestamp).toISOString();
        const result = await staffAttendanceRequest('manual', payload);
        await loadStaffAttendance();
        setStatus(document.getElementById('staffAttendanceManualStatus') || dashboardStatus, result.message, 'ok');
      } catch (error) {
        setStatus(status, error.message || String(error), 'bad');
      } finally {
        if (button.isConnected) setButtonLoading(button, false, 'Recording...', 'Record correction');
      }
    });
  } catch (error) {
    if (activeSection === 'staffAttendance') panelEl.innerHTML = `<p class="status bad">${escapeHtml(error.message || String(error))}</p>`;
  }
}

async function humanResourcesRequest(action, payload = {}) {
  const response = await staffFetch('/api/staff-hr', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, action })
  });
  const data = await response.json().catch(() => ({ ok: false, message: 'Human Resources did not return JSON.' }));
  if (!response.ok || !data.ok) throw new Error(data.message || 'Human Resources action failed.');
  return data;
}

function hrStaffOptions(directory = [], selected = '') {
  return `<option value="">Choose staff member</option>${directory.map((row) => {
    const username = clean(row.Username);
    const label = [row.DisplayName || username, username, row.EmployeeId, row.Department, row.Position || row.Role].filter(Boolean).join(' · ');
    const search = lower([label, row.WorkEmail, row.Phone].filter(Boolean).join(' '));
    return `<option value="${escapeHtml(username)}" data-person-search="${escapeHtml(search)}" ${lower(selected) === lower(username) ? 'selected' : ''}>${escapeHtml(label)}</option>`;
  }).join('')}`;
}

function hrPersonPicker(id, label, directory = [], options = {}) {
  const name = clean(options.name) || 'Username';
  const selected = clean(options.selected);
  const required = options.required === false ? '' : ' required';
  const prompt = clean(options.prompt) || `Search ${label.toLowerCase()}`;
  return `<div class="hr-person-picker" data-hr-person-picker>
    <label for="${escapeHtml(id)}Search">Find ${escapeHtml(label.toLowerCase())}
      <input id="${escapeHtml(id)}Search" type="search" data-hr-person-search placeholder="${escapeHtml(prompt)}" autocomplete="off">
    </label>
    <label for="${escapeHtml(id)}">${escapeHtml(label)}
      <select id="${escapeHtml(id)}" name="${escapeHtml(name)}" data-hr-person-select${required}>${hrStaffOptions(directory, selected)}</select>
    </label>
    <small data-hr-person-count>${directory.length} staff available</small>
  </div>`;
}

function bindHrPersonPickers(root = document) {
  root.querySelectorAll('[data-hr-person-picker]').forEach((picker) => {
    const search = picker.querySelector('[data-hr-person-search]');
    const select = picker.querySelector('[data-hr-person-select]');
    const count = picker.querySelector('[data-hr-person-count]');
    if (!search || !select) return;
    const source = [...select.options].map((option) => ({
      value: option.value,
      label: option.textContent,
      search: lower(option.dataset.personSearch || option.textContent)
    }));
    const staff = source.filter((option) => option.value);
    const render = () => {
      const query = lower(search.value);
      const previous = select.value;
      const matches = staff.filter((option) => !query || option.search.includes(query));
      select.replaceChildren(...source.filter((option) => !option.value || matches.includes(option)).map((item) => {
        const option = document.createElement('option');
        option.value = item.value;
        option.textContent = item.label;
        option.dataset.personSearch = item.search;
        return option;
      }));
      if (matches.some((option) => option.value === previous)) select.value = previous;
      else if (query && matches.length === 1) select.value = matches[0].value;
      else select.value = '';
      if (select.value !== previous) select.dispatchEvent(new Event('change', { bubbles: true }));
      if (count) count.textContent = query ? `${matches.length} matching staff` : `${staff.length} staff available`;
    };
    search.addEventListener('input', render);
    search.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      search.value = '';
      render();
      search.focus();
    });
    picker.closest('form')?.addEventListener('reset', () => setTimeout(() => {
      search.value = '';
      render();
    }, 0));
  });
}

function bindHrWorkspaceSearch(root = document) {
  const search = root.querySelector('#humanResourcesPeopleSearch');
  const count = root.querySelector('[data-hr-workspace-search-count]');
  if (!search) return;
  const rows = [...root.querySelectorAll('.hr-workspace-stack .admin-table tbody tr')]
    .filter((row) => !/no records found/i.test(clean(row.textContent)));
  const render = () => {
    const query = lower(search.value);
    let matches = 0;
    rows.forEach((row) => {
      const matched = !query || lower(row.textContent).includes(query);
      row.hidden = !matched;
      if (matched) matches += 1;
    });
    if (count) count.textContent = query ? `${matches} matching HR record${matches === 1 ? '' : 's'}` : 'Searches every HR register';
  };
  search.addEventListener('input', render);
  search.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    search.value = '';
    render();
  });
}

function hrRoleGuide() {
  const groups = [
    ['HR Director / HR Manager', 'Full employee-journey oversight from recruitment and compliance through exit.'],
    ['HR Business Partner', 'People strategy, employee welfare, workplace relations and full HR operations.'],
    ['HR Officer / HR Assistant', 'Employment records, contracts, qualifications, leave, attendance and HR coordination.'],
    ['Recruitment Officer', 'Vacancies, applications, interviews, checks, offers and selection.'],
    ['Learning & Development Officer', 'Training plans, completion and certificates.'],
    ['Employee Relations Officer', 'Welfare, grievances, workplace conduct, leave and employee exits.'],
    ['Performance Management Officer', 'Reviews, goals, ratings and development follow-up.'],
    ['Compensation & Benefits Officer', 'Salary-change, allowance, pension, bonus, deduction and benefit coordination.'],
    ['Payroll Officer', 'Reviews approved pay changes and completes payroll or final-pay processing.'],
    ['Health & Safety Officer', 'Safety obligations, workplace wellbeing and required compliance learning.'],
    ['Line Manager', 'Team schedules, attendance exceptions, leave decisions and performance reviews.']
  ];
  return `<section class="hr-role-guide"><header><div><p class="eyebrow">Access model</p><h2>HR roles and responsibilities</h2></div><span>Least-privilege access</span></header><div>${groups.map(([role, description]) => `<article><strong>${escapeHtml(role)}</strong><p>${escapeHtml(description)}</p></article>`).join('')}</div></section>`;
}

function hrFormStaffNameSync(form, directory) {
  const select = form?.elements.Username;
  if (!select || !form.elements.DisplayName) return;
  const sync = () => {
    const staff = directory.find((row) => lower(row.Username) === lower(select.value));
    form.elements.DisplayName.value = staff?.DisplayName || '';
  };
  select.addEventListener('change', sync);
  sync();
}

function bindHrForm(formId, action, loadingText, idleText) {
  const form = document.getElementById(formId);
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const status = form.querySelector('.status');
    setButtonLoading(button, true, loadingText, idleText);
    try {
      const result = await humanResourcesRequest(action, Object.fromEntries(new FormData(form).entries()));
      await loadHumanResources();
      setStatus(dashboardStatus, result.message, 'ok');
    } catch (error) {
      setStatus(status, error.message || String(error), 'bad');
    } finally {
      if (button.isConnected) setButtonLoading(button, false, loadingText, idleText);
    }
  });
}

function bindHrRecordEditors(selector, formId, rows, idFields, fields) {
  document.querySelectorAll(selector).forEach((button) => button.addEventListener('click', () => {
    const form = document.getElementById(formId);
    const requestedId = clean(button.dataset.hrRecordId || button.value);
    const record = rows.find((row) => idFields.some((field) => clean(row[field]) === requestedId));
    if (!form || !record) return;
    fields.forEach((field) => {
      if (form.elements[field]) form.elements[field].value = record[field] ?? '';
    });
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
}

function renderHumanResources(data) {
  humanResourcesData = data;
  const directory = data.directory || [];
  const leave = data.leave || [];
  const vacancies = data.vacancies || [];
  const candidates = data.candidates || [];
  const reviews = data.reviews || [];
  const training = data.training || [];
  const employmentHistory = data.employmentHistory || [];
  const compensation = data.compensation || [];
  const timeRecords = data.timeRecords || [];
  const employeeCases = data.employeeCases || [];
  const compliance = data.compliance || [];
  const exits = data.exits || [];
  const capabilities = data.capabilities || {};
  const username = clean(currentUser?.username);
  const vacancyOptions = `<option value="">Choose vacancy</option>${vacancies.map((row) => `<option value="${escapeHtml(row.VacancyId || row.__id)}">${escapeHtml([row.Title, row.Department, row.Status].filter(Boolean).join(' · '))}</option>`).join('')}`;
  const pendingLeave = leave.filter((row) => /pending/i.test(clean(row.Status))).length;
  const activeStaff = directory.filter((row) => !/inactive|suspended|terminated|exited/i.test(clean(row.Status)) && row.Active !== false).length;
  const openVacancies = vacancies.filter((row) => /open/i.test(clean(row.Status))).length;
  const pendingCompensation = compensation.filter((row) => /pending/i.test(clean(row.Status))).length;
  const openCases = employeeCases.filter((row) => !/resolved|closed/i.test(clean(row.Status))).length;
  const dueCompliance = compliance.filter((row) => /action required|overdue/i.test(clean(row.Status))).length;
  const activeExits = exits.filter((row) => !/completed|cancelled/i.test(clean(row.Status))).length;
  const peoplePanel = document.createElement('section');
  peoplePanel.className = 'hr-workspace-stack';
  peoplePanel.innerHTML = `${capabilities.canManagePeople ? `
    <section class="config-group hr-form-card"><header><strong>Employment record</strong><small>Link HR information to an existing staff login; passwords and credentials are never exposed here.</small></header>
      <form id="hrEmployeeForm" class="workflow-form config-form">
        <div class="config-grid">
          ${hrPersonPicker('hrEmployeeUsername', 'Staff member', directory)}
          <label>Employee ID <input name="EmployeeId" placeholder="EMP-001"></label>
          <label>Position <input name="Position" required></label>
          <label>Department <input name="Department" required></label>
          <label>Employment type <select name="EmploymentType"><option>Permanent</option><option>Contract</option><option>Part-time</option><option>Temporary</option><option>Volunteer</option></select></label>
          <label>Hire date <input name="HireDate" type="date"></label>
          ${hrPersonPicker('hrEmployeeManager', 'Line manager', directory, { name: 'ManagerUsername', required: false })}
          <label>Work email <input name="WorkEmail" type="email"></label>
          <label>Phone <input name="Phone" type="tel"></label>
          <label>Status <select name="Status"><option>Active</option><option>On leave</option><option>Suspended</option><option>Exited</option></select></label>
          <label class="config-grid-span">Emergency contact <input name="EmergencyContact"></label>
        </div>
        <input name="DisplayName" type="hidden">
        <div class="config-dialog-actions"><p class="status"></p><button type="submit">Save employment record</button></div>
      </form>
    </section>` : ''}
    ${table('Staff directory', directory, [
      { label: 'Employee ID', value: (row) => row.EmployeeId },
      { label: 'Staff', value: (row) => row.DisplayName || row.Username },
      { label: 'Position', value: (row) => row.Position || row.Role },
      { label: 'Department', value: (row) => row.Department },
      { label: 'Employment', value: (row) => row.EmploymentType },
      { label: 'Manager', value: (row) => row.ManagerUsername },
      { label: 'Status', value: (row) => row.Status || (row.Active === false ? 'Inactive' : 'Active') },
      ...(capabilities.canManagePeople ? [{ label: 'Action', render: (row) => `<button type="button" class="compact-icon-action compact-edit-action" data-edit-hr-employee="${escapeHtml(row.Username)}" aria-label="Edit ${escapeHtml(row.DisplayName || row.Username)}" title="Edit employment record"><span aria-hidden="true">&#9998;</span></button>` }] : [])
    ])}`;

  const recordsPanel = document.createElement('section');
  recordsPanel.className = 'hr-workspace-stack';
  recordsPanel.innerHTML = `${capabilities.canManageEmploymentHistory ? `
    <section class="config-group hr-form-card"><header><strong>Employment history and documents</strong><small>Register contracts, qualifications, promotions, transfers, awards and supporting document references.</small></header>
      <form id="hrHistoryForm" class="workflow-form config-form"><input name="HistoryId" type="hidden"><input name="DisplayName" type="hidden"><div class="config-grid">
        ${hrPersonPicker('hrHistoryUsername', 'Staff member', directory)}
        <label>Record type <select name="RecordType"><option>Contract</option><option>Qualification</option><option>Promotion</option><option>Transfer</option><option>Award</option><option>Employment document</option><option>Other</option></select></label>
        <label>Title <input name="Title" placeholder="e.g. B.Sc. certificate or promotion to manager" required></label>
        <label>Effective date <input name="EffectiveDate" type="date" required></label>
        <label>Expiry date <input name="ExpiryDate" type="date"></label>
        <label>Document reference <input name="DocumentReference" placeholder="File number or secure document reference"></label>
        <label class="config-grid-span">Notes <textarea name="Notes" rows="2"></textarea></label>
      </div><div class="config-dialog-actions"><p class="status"></p><button type="submit">Save employment history</button></div></form>
    </section>` : ''}
    ${table('Employment history and document register', employmentHistory, [
      { label: 'Staff', value: (row) => row.DisplayName || row.Username }, { label: 'Type', value: (row) => row.RecordType },
      { label: 'Title', value: (row) => row.Title }, { label: 'Effective', value: (row) => row.EffectiveDate },
      { label: 'Expires', value: (row) => row.ExpiryDate }, { label: 'Reference', value: (row) => row.DocumentReference },
      ...(capabilities.canManageEmploymentHistory ? [{ label: 'Action', render: (row) => `<button type="button" class="compact-icon-action compact-edit-action" data-edit-hr-history data-hr-record-id="${escapeHtml(row.HistoryId || row.__id)}" aria-label="Edit employment history"><span aria-hidden="true">&#9998;</span></button>` }] : [])
    ])}`;

  const leavePanel = document.createElement('section');
  leavePanel.className = 'hr-workspace-stack';
  leavePanel.innerHTML = `
    <section class="config-group hr-form-card"><header><strong>Request leave</strong><small>Staff may submit their own request. HR officers may submit one for another staff member.</small></header>
      <form id="hrLeaveForm" class="workflow-form config-form">
        <div class="config-grid">
          ${capabilities.canManageLeave ? hrPersonPicker('hrLeaveUsername', 'Staff member', directory, { selected: username }) : `<input name="Username" type="hidden" value="${escapeHtml(username)}">`}
          <input name="DisplayName" type="hidden" value="${escapeHtml(currentUser?.displayName || username)}">
          <label>Leave type <select name="LeaveType"><option>Annual leave</option><option>Sick leave</option><option>Maternity leave</option><option>Paternity leave</option><option>Compassionate leave</option><option>Study leave</option><option>Unpaid leave</option></select></label>
          <label>Start date <input name="StartDate" type="date" required></label>
          <label>End date <input name="EndDate" type="date" required></label>
          <label class="config-grid-span">Reason <textarea name="Reason" rows="2" required></textarea></label>
        </div>
        <div class="config-dialog-actions"><p class="status"></p><button type="submit">Submit leave request</button></div>
      </form>
    </section>
    ${table('Leave register', leave, [
      { label: 'Staff', value: (row) => row.DisplayName || row.Username },
      { label: 'Type', value: (row) => row.LeaveType },
      { label: 'From', value: (row) => row.StartDate },
      { label: 'To', value: (row) => row.EndDate },
      { label: 'Days', value: (row) => row.Days },
      { label: 'Status', value: (row) => row.Status },
      { label: 'Reviewed by', value: (row) => row.ReviewedBy },
      ...(capabilities.canApproveLeave ? [{ label: 'Action', render: (row) => /pending/i.test(clean(row.Status)) && lower(row.Username) !== lower(username) ? `<span class="table-action-group"><button type="button" class="table-action" data-hr-leave-decision="Approved" data-hr-leave-id="${escapeHtml(row.LeaveId || row.__id)}">Approve</button><button type="button" class="table-action danger" data-hr-leave-decision="Declined" data-hr-leave-id="${escapeHtml(row.LeaveId || row.__id)}">Decline</button></span>` : '' }] : [])
    ])}`;

  leavePanel.innerHTML += `${capabilities.canManageTime ? `
    <section class="config-group hr-form-card"><header><strong>Attendance, lateness and work schedules</strong><small>Record schedules, absence, lateness and authorised attendance corrections. Verified clock events remain available in Staff Attendance where enabled.</small></header>
      <form id="hrTimeForm" class="workflow-form config-form"><input name="TimeRecordId" type="hidden"><input name="DisplayName" type="hidden"><div class="config-grid">
        ${hrPersonPicker('hrTimeUsername', 'Staff member', directory)}
        <label>Record type <select name="RecordType"><option>Work schedule</option><option>Lateness</option><option>Absence</option><option>Attendance correction</option><option>Shift assignment</option></select></label>
        <label>Work date <input name="WorkDate" type="date" required></label>
        <label>Start time <input name="StartTime" type="time"></label><label>End time <input name="EndTime" type="time"></label>
        <label>Status <select name="Status"><option>Recorded</option><option>Excused</option><option>Unexcused</option><option>Resolved</option></select></label>
        <label class="config-grid-span">Reason or schedule note <textarea name="Reason" rows="2"></textarea></label>
      </div><div class="config-dialog-actions"><p class="status"></p><button type="submit">Save time record</button></div></form>
    </section>` : ''}
    ${table('Attendance and schedule register', timeRecords, [
      { label: 'Staff', value: (row) => row.DisplayName || row.Username }, { label: 'Type', value: (row) => row.RecordType },
      { label: 'Date', value: (row) => row.WorkDate }, { label: 'Start', value: (row) => row.StartTime },
      { label: 'End', value: (row) => row.EndTime }, { label: 'Status', value: (row) => row.Status }, { label: 'Reason', value: (row) => row.Reason },
      ...(capabilities.canManageTime ? [{ label: 'Action', render: (row) => `<button type="button" class="compact-icon-action compact-edit-action" data-edit-hr-time data-hr-record-id="${escapeHtml(row.TimeRecordId || row.__id)}" aria-label="Edit time record"><span aria-hidden="true">&#9998;</span></button>` }] : [])
    ])}`;

  const recruitmentPanel = document.createElement('section');
  recruitmentPanel.className = 'hr-workspace-stack';
  recruitmentPanel.innerHTML = `${capabilities.canManageRecruitment ? `
    <section class="config-group hr-form-card"><header><strong>Vacancy</strong><small>Create or update an approved staffing need.</small></header>
      <form id="hrVacancyForm" class="workflow-form config-form"><input name="VacancyId" type="hidden"><div class="config-grid">
        <label>Job title <input name="Title" required></label><label>Department <input name="Department" required></label>
        <label>Employment type <select name="EmploymentType"><option>Permanent</option><option>Contract</option><option>Part-time</option><option>Temporary</option></select></label>
        <label>Openings <input name="Openings" type="number" min="1" value="1" required></label>
        <label>Closing date <input name="ClosingDate" type="date"></label><label>Status <select name="Status"><option>Open</option><option>On hold</option><option>Closed</option><option>Filled</option></select></label>
        <label class="config-grid-span">Description <textarea name="Description" rows="2"></textarea></label>
      </div><div class="config-dialog-actions"><p class="status"></p><button type="submit">Save vacancy</button></div></form>
    </section>` : ''}
    ${table('Recruitment plan', vacancies, [
      { label: 'Role', value: (row) => row.Title }, { label: 'Department', value: (row) => row.Department },
      { label: 'Type', value: (row) => row.EmploymentType }, { label: 'Openings', value: (row) => row.Openings },
      { label: 'Closing', value: (row) => row.ClosingDate }, { label: 'Status', value: (row) => row.Status },
      ...(capabilities.canManageRecruitment ? [{ label: 'Action', render: (row) => `<button type="button" class="compact-icon-action compact-edit-action" data-edit-hr-vacancy="${escapeHtml(row.VacancyId || row.__id)}" aria-label="Edit ${escapeHtml(row.Title)}"><span aria-hidden="true">&#9998;</span></button>` }] : [])
    ])}`;

  recruitmentPanel.innerHTML += `${capabilities.canManageRecruitment ? vacancies.length ? `
    <section class="config-group hr-form-card"><header><strong>Candidate and interview pipeline</strong><small>Track applications, qualification checks, interviews, references, offers and selection decisions.</small></header>
      <form id="hrCandidateForm" class="workflow-form config-form"><input name="CandidateId" type="hidden"><div class="config-grid">
        <label>Vacancy <select name="VacancyId" required>${vacancyOptions}</select></label><label>Candidate name <input name="CandidateName" required></label>
        <label>Email <input name="Email" type="email"></label><label>Phone <input name="Phone" type="tel"></label>
        <label>Application date <input name="ApplicationDate" type="date"></label><label>Interview date <input name="InterviewDate" type="datetime-local"></label>
        <label>CV / application reference <input name="ApplicationReference" placeholder="Secure file or application reference"></label>
        <label>Qualification check <select name="QualificationCheck"><option>Pending</option><option>Verified</option><option>Failed</option><option>Not required</option></select></label>
        <label>Reference check <select name="ReferenceCheck"><option>Pending</option><option>Verified</option><option>Failed</option><option>Not required</option></select></label>
        <label>Status <select name="Status"><option>Applied</option><option>Screening</option><option>Interview</option><option>Offer</option><option>Selected</option><option>Rejected</option><option>Withdrawn</option></select></label>
        <label>Interview panel <input name="InterviewPanel"></label>
        <label class="config-grid-span">Qualification summary <textarea name="QualificationSummary" rows="2"></textarea></label>
        <label class="config-grid-span">Interview notes <textarea name="InterviewNotes" rows="2"></textarea></label>
      </div><div class="config-dialog-actions"><p class="status"></p><button type="submit">Save candidate</button></div></form>
    </section>` : '<p class="workspace-panel-note muted">Create a vacancy before adding candidates.</p>' : ''}
    ${table('Candidate pipeline', candidates, [
      { label: 'Candidate', value: (row) => row.CandidateName },
      { label: 'Vacancy', value: (row) => vacancies.find((item) => clean(item.VacancyId || item.__id) === clean(row.VacancyId))?.Title || row.VacancyId },
      { label: 'Applied', value: (row) => row.ApplicationDate }, { label: 'Application ref.', value: (row) => row.ApplicationReference }, { label: 'Interview', value: (row) => clean(row.InterviewDate).replace('T', ' ') },
      { label: 'Qualification', value: (row) => row.QualificationCheck }, { label: 'References', value: (row) => row.ReferenceCheck },
      { label: 'Status', value: (row) => row.Status },
      ...(capabilities.canManageRecruitment ? [{ label: 'Action', render: (row) => `<button type="button" class="compact-icon-action compact-edit-action" data-edit-hr-candidate data-hr-record-id="${escapeHtml(row.CandidateId || row.__id)}" aria-label="Edit candidate"><span aria-hidden="true">&#9998;</span></button>` }] : [])
    ])}`;

  const performancePanel = document.createElement('section');
  performancePanel.className = 'hr-workspace-stack';
  performancePanel.innerHTML = `${capabilities.canManagePerformance ? `
    <section class="config-group hr-form-card"><header><strong>Performance review</strong><small>Keep reviews factual, work-related and visible only to authorised HR roles and the employee.</small></header>
      <form id="hrReviewForm" class="workflow-form config-form"><input name="ReviewId" type="hidden"><input name="DisplayName" type="hidden"><div class="config-grid">
        ${hrPersonPicker('hrReviewUsername', 'Staff member', directory.filter((row) => lower(row.Username) !== lower(username)))}<label>Review period <input name="ReviewPeriod" placeholder="2026 Annual" required></label>
        <label>Rating <select name="Rating" required><option value="">Choose rating</option><option value="1">1 - Needs improvement</option><option value="2">2 - Developing</option><option value="3">3 - Meets expectations</option><option value="4">4 - Exceeds expectations</option><option value="5">5 - Outstanding</option></select></label>
        <label>Status <select name="Status"><option>Completed</option><option>Draft</option><option>Follow-up required</option></select></label>
        <label>Strengths <textarea name="Strengths" rows="2"></textarea></label><label>Development areas <textarea name="DevelopmentAreas" rows="2"></textarea></label>
        <label class="config-grid-span">Goals <textarea name="Goals" rows="2"></textarea></label>
      </div><div class="config-dialog-actions"><p class="status"></p><button type="submit">Save performance review</button></div></form>
    </section>` : ''}
    ${table('Performance history', reviews, [
      { label: 'Staff', value: (row) => row.DisplayName || row.Username }, { label: 'Period', value: (row) => row.ReviewPeriod },
      { label: 'Rating', value: (row) => row.Rating ? `${row.Rating} / 5` : '' }, { label: 'Status', value: (row) => row.Status },
      { label: 'Reviewed by', value: (row) => row.ReviewedBy }, { label: 'Date', value: (row) => clean(row.ReviewedAt).slice(0, 10) },
      ...(capabilities.canManagePerformance ? [{ label: 'Action', render: (row) => `<button type="button" class="compact-icon-action compact-edit-action" data-edit-hr-review data-hr-record-id="${escapeHtml(row.ReviewId || row.__id)}" aria-label="Edit performance review"><span aria-hidden="true">&#9998;</span></button>` }] : [])
    ])}`;

  const trainingPanel = document.createElement('section');
  trainingPanel.className = 'hr-workspace-stack';
  trainingPanel.innerHTML = `${capabilities.canManageTraining ? `
    <section class="config-group hr-form-card"><header><strong>Learning & development</strong><small>Plan training and keep completion or certificate references.</small></header>
      <form id="hrTrainingForm" class="workflow-form config-form"><input name="TrainingId" type="hidden"><input name="DisplayName" type="hidden"><div class="config-grid">
        ${hrPersonPicker('hrTrainingUsername', 'Staff member', directory)}<label>Course or programme <input name="Course" required></label>
        <label>Provider <input name="Provider"></label><label>Completion date <input name="CompletionDate" type="date"></label>
        <label>Status <select name="Status"><option>Planned</option><option>In progress</option><option>Completed</option><option>Cancelled</option></select></label>
        <label>Certificate reference <input name="CertificateReference"></label>
      </div><div class="config-dialog-actions"><p class="status"></p><button type="submit">Save training record</button></div></form>
    </section>` : ''}
    ${table('Training register', training, [
      { label: 'Staff', value: (row) => row.DisplayName || row.Username }, { label: 'Course', value: (row) => row.Course },
      { label: 'Provider', value: (row) => row.Provider }, { label: 'Status', value: (row) => row.Status },
      { label: 'Completion', value: (row) => row.CompletionDate }, { label: 'Certificate', value: (row) => row.CertificateReference },
      ...(capabilities.canManageTraining ? [{ label: 'Action', render: (row) => `<button type="button" class="compact-icon-action compact-edit-action" data-edit-hr-training data-hr-record-id="${escapeHtml(row.TrainingId || row.__id)}" aria-label="Edit training record"><span aria-hidden="true">&#9998;</span></button>` }] : [])
    ])}`;

  const compensationPanel = document.createElement('section');
  compensationPanel.className = 'hr-workspace-stack';
  compensationPanel.innerHTML = `<p class="workspace-panel-note muted">Human Resources coordinates and approves changes here. Payroll remains the authoritative workspace for salary calculations, statutory deductions and payment.</p>${capabilities.canManageCompensation ? `
    <section class="config-group hr-form-card"><header><strong>Pay and benefits coordination</strong><small>Submit salary, allowance, pension, bonus, deduction or benefit changes for independent review and payroll implementation.</small></header>
      <form id="hrCompensationForm" class="workflow-form config-form"><input name="CompensationId" type="hidden"><input name="DisplayName" type="hidden"><div class="config-grid">
        ${hrPersonPicker('hrCompensationUsername', 'Staff member', directory)}
        <label>Change type <select name="ChangeType"><option>Salary adjustment</option><option>Allowance</option><option>Bonus</option><option>Pension</option><option>Deduction</option><option>Benefit</option><option>Other</option></select></label>
        <label>Amount <input name="Amount" type="number" min="0" step="0.01" value="0" data-finance-input></label>
        <label>Currency <input name="Currency" value="NGN" maxlength="3"></label>
        <label>Effective date <input name="EffectiveDate" type="date" required></label>
        <label class="config-grid-span">Details <textarea name="Details" rows="2" placeholder="Explain the approved basis and payroll action required" required></textarea></label>
      </div><div class="config-dialog-actions"><p class="status"></p><button type="submit">Send for review</button></div></form>
    </section>` : ''}
    ${table('Pay and benefits change register', compensation, [
      { label: 'Staff', value: (row) => row.DisplayName || row.Username }, { label: 'Change', value: (row) => row.ChangeType },
      { label: 'Amount', value: (row) => moneyInCurrency(row.Amount, row.Currency || 'NGN') }, { label: 'Effective', value: (row) => row.EffectiveDate },
      { label: 'Status', value: (row) => row.Status }, { label: 'Reviewed by', value: (row) => row.ReviewedBy },
      ...(capabilities.canReviewCompensation || capabilities.canManageCompensation ? [{ label: 'Action', render: (row) => `<span class="table-action-group">${capabilities.canManageCompensation && /pending/i.test(clean(row.Status)) ? `<button type="button" class="compact-icon-action compact-edit-action" data-edit-hr-compensation data-hr-record-id="${escapeHtml(row.CompensationId || row.__id)}" aria-label="Edit pay or benefit change"><span aria-hidden="true">&#9998;</span></button>` : ''}${capabilities.canReviewCompensation && /pending/i.test(clean(row.Status)) ? `<button type="button" class="table-action" data-hr-compensation-decision="Approved" data-hr-compensation-id="${escapeHtml(row.CompensationId || row.__id)}">Approve</button><button type="button" class="table-action danger" data-hr-compensation-decision="Declined" data-hr-compensation-id="${escapeHtml(row.CompensationId || row.__id)}">Decline</button>` : capabilities.canReviewCompensation && /approved/i.test(clean(row.Status)) ? `<button type="button" class="table-action" data-hr-compensation-decision="Implemented" data-hr-compensation-id="${escapeHtml(row.CompensationId || row.__id)}">Mark implemented</button>` : ''}</span>` }] : [])
    ])}`;

  const relationsPanel = document.createElement('section');
  relationsPanel.className = 'hr-workspace-stack';
  relationsPanel.innerHTML = `${capabilities.canManageRelations || capabilities.canManageDiscipline ? `
    <section class="config-group hr-form-card"><header><strong>Employee welfare, relations and conduct</strong><small>Keep factual, confidential records of concerns, grievances, conflicts, misconduct and fair disciplinary action.</small></header>
      <form id="hrCaseForm" class="workflow-form config-form"><input name="CaseId" type="hidden"><input name="DisplayName" type="hidden"><div class="config-grid">
        ${hrPersonPicker('hrCaseUsername', 'Staff member', directory)}
        <label>Case type <select name="CaseType"><option>Welfare concern</option><option>Grievance</option><option>Workplace conflict</option>${capabilities.canManageDiscipline ? '<option>Misconduct</option><option>Disciplinary action</option>' : ''}<option>Health and safety</option><option>Other</option></select></label>
        <label>Case date <input name="OpenedDate" type="date" required></label>
        <label>Severity <select name="Severity"><option>Low</option><option selected>Moderate</option><option>High</option><option>Critical</option></select></label>
        <label>Status <select name="Status"><option>Open</option><option>Under review</option><option>Action required</option><option>Resolved</option><option>Closed</option></select></label>
        <label>Policy reference <input name="PolicyReference"></label>
        <label class="config-grid-span">Summary <textarea name="Summary" rows="3" required></textarea></label>
        <label class="config-grid-span">Action, warning, resolution or support provided <textarea name="ActionTaken" rows="3"></textarea></label>
      </div><div class="config-dialog-actions"><p class="status"></p><button type="submit">Save confidential case</button></div></form>
    </section>` : ''}
    ${table('Employee relations and conduct register', employeeCases, [
      { label: 'Staff', value: (row) => row.DisplayName || row.Username }, { label: 'Type', value: (row) => row.CaseType },
      { label: 'Date', value: (row) => row.OpenedDate }, { label: 'Severity', value: (row) => row.Severity },
      { label: 'Status', value: (row) => row.Status }, { label: 'Policy', value: (row) => row.PolicyReference },
      ...(capabilities.canManageRelations || capabilities.canManageDiscipline ? [{ label: 'Action', render: (row) => `<button type="button" class="compact-icon-action compact-edit-action" data-edit-hr-case data-hr-record-id="${escapeHtml(row.CaseId || row.__id)}" aria-label="Edit employee case"><span aria-hidden="true">&#9998;</span></button>` }] : [])
    ])}`;

  const compliancePanel = document.createElement('section');
  compliancePanel.className = 'hr-workspace-stack';
  compliancePanel.innerHTML = `${capabilities.canManageCompliance ? `
    <section class="config-group hr-form-card"><header><strong>Employment compliance register</strong><small>Track labour, pension, tax, safety, contract and workplace-policy obligations with evidence and owners.</small></header>
      <form id="hrComplianceForm" class="workflow-form config-form"><input name="ComplianceId" type="hidden"><div class="config-grid">
        <label>Category <select name="Category"><option>Labour law</option><option>Pension</option><option>Tax obligation</option><option>Health and safety</option><option>Employment contract</option><option>Workplace policy</option><option>Other</option></select></label>
        <label>Owner <input name="Owner" placeholder="Responsible officer"></label>
        <label>Due date <input name="DueDate" type="date"></label>
        <label>Status <select name="Status"><option>Not started</option><option>In progress</option><option>Compliant</option><option>Action required</option><option>Overdue</option></select></label>
        <label class="config-grid-span">Obligation <textarea name="Obligation" rows="2" required></textarea></label>
        <label>Evidence reference <input name="EvidenceReference"></label>
        <label>Notes <input name="Notes"></label>
      </div><div class="config-dialog-actions"><p class="status"></p><button type="submit">Save compliance item</button></div></form>
    </section>` : ''}
    ${table('Compliance register', compliance, [
      { label: 'Category', value: (row) => row.Category }, { label: 'Obligation', value: (row) => row.Obligation },
      { label: 'Owner', value: (row) => row.Owner }, { label: 'Due date', value: (row) => row.DueDate },
      { label: 'Status', value: (row) => row.Status }, { label: 'Evidence', value: (row) => row.EvidenceReference },
      ...(capabilities.canManageCompliance ? [{ label: 'Action', render: (row) => `<button type="button" class="compact-icon-action compact-edit-action" data-edit-hr-compliance data-hr-record-id="${escapeHtml(row.ComplianceId || row.__id)}" aria-label="Edit compliance item"><span aria-hidden="true">&#9998;</span></button>` }] : [])
    ])}`;

  const exitPanel = document.createElement('section');
  exitPanel.className = 'hr-workspace-stack';
  exitPanel.innerHTML = `${capabilities.canManageExit ? `
    <section class="config-group hr-form-card"><header><strong>Employee exit and clearance</strong><small>Coordinate notice, handover, clearance, final pay, exit interview and final documentation.</small></header>
      <form id="hrExitForm" class="workflow-form config-form"><input name="ExitId" type="hidden"><input name="DisplayName" type="hidden"><div class="config-grid">
        ${hrPersonPicker('hrExitUsername', 'Staff member', directory)}
        <label>Exit type <select name="ExitType"><option>Resignation</option><option>Retirement</option><option>Dismissal</option><option>End of contract</option><option>Redundancy</option><option>Death in service</option><option>Other</option></select></label>
        <label>Notice date <input name="NoticeDate" type="date"></label><label>Last working date <input name="LastWorkingDate" type="date" required></label>
        <label>Handover <select name="HandoverStatus"><option>Not started</option><option>In progress</option><option>Completed</option><option>Not applicable</option></select></label>
        <label>Clearance <select name="ClearanceStatus"><option>Not started</option><option>In progress</option><option>Cleared</option></select></label>
        <label>Final pay <select name="FinalPayStatus"><option>Pending</option><option>Sent to payroll</option><option>Paid</option><option>Not applicable</option></select></label>
        <label>Status <select name="Status"><option>Planned</option><option>In progress</option><option>Completed</option><option>Cancelled</option></select></label>
        <label class="config-grid-span">Final document reference <input name="FinalDocumentReference" placeholder="Clearance certificate, service letter or archive reference"></label>
        <label class="config-grid-span">Reason <textarea name="Reason" rows="2"></textarea></label>
        <label class="config-grid-span">Exit interview and final notes <textarea name="ExitInterviewNotes" rows="3"></textarea></label>
      </div><div class="config-dialog-actions"><p class="status"></p><button type="submit">Save exit record</button></div></form>
    </section>` : ''}
    ${table('Employee exit register', exits, [
      { label: 'Staff', value: (row) => row.DisplayName || row.Username }, { label: 'Exit type', value: (row) => row.ExitType },
      { label: 'Last day', value: (row) => row.LastWorkingDate }, { label: 'Handover', value: (row) => row.HandoverStatus },
      { label: 'Clearance', value: (row) => row.ClearanceStatus }, { label: 'Final pay', value: (row) => row.FinalPayStatus },
      { label: 'Final document', value: (row) => row.FinalDocumentReference }, { label: 'Status', value: (row) => row.Status },
      ...(capabilities.canManageExit ? [{ label: 'Action', render: (row) => {
        const completed = /completed/i.test(clean(row.Status));
        const staff = directory.find((item) => lower(item.Username) === lower(row.Username));
        if (completed && staff && yes(staff.Active)) {
          return `<button type="button" class="table-action danger" data-repair-hr-exit="${escapeHtml(row.ExitId || row.__id)}">Repair access</button>`;
        }
        if (completed) return '<span class="workflow-status status-rejected">Access disabled</span>';
        return `<button type="button" class="compact-icon-action compact-edit-action" data-edit-hr-exit data-hr-record-id="${escapeHtml(row.ExitId || row.__id)}" aria-label="Edit exit record"><span aria-hidden="true">&#9998;</span></button>`;
      } }] : [])
    ])}`;

  const overviewPanel = document.createElement('section');
  overviewPanel.className = 'hr-overview-panel';
  overviewPanel.innerHTML = `<div class="workflow-kpis hr-kpis">
    <div><small>Active staff</small><strong>${activeStaff}</strong><span>Employment records in view</span></div>
    <div><small>Pending leave</small><strong>${pendingLeave}</strong><span>Awaiting a decision</span></div>
    <div><small>Open vacancies</small><strong>${openVacancies}</strong><span>Approved staffing needs</span></div>
    <div><small>Candidates</small><strong>${candidates.length}</strong><span>Recruitment pipeline</span></div>
    <div><small>Pending pay changes</small><strong>${pendingCompensation}</strong><span>Awaiting independent review</span></div>
    <div><small>Open staff cases</small><strong>${openCases}</strong><span>Welfare or conduct follow-up</span></div>
    <div><small>Compliance actions</small><strong>${dueCompliance}</strong><span>Action required or overdue</span></div>
    <div><small>Active exits</small><strong>${activeExits}</strong><span>Clearance in progress</span></div>
  </div>${hrRoleGuide()}`;

  panelEl.innerHTML = `<div class="workflow-intro"><div><p class="eyebrow">People operations</p><h2>Human Resources</h2><p class="muted">Manage the employee journey from recruitment and employment records through wellbeing, development, compliance and exit.</p></div><div class="hr-workspace-actions"><label for="humanResourcesPeopleSearch">Find a person<input id="humanResourcesPeopleSearch" type="search" placeholder="Name, ID, email, phone or department" autocomplete="off"></label><small data-hr-workspace-search-count>Searches every HR register</small><button type="button" id="refreshHumanResources">Refresh</button></div></div><p id="humanResourcesStatus" class="status"></p>`;
  panelEl.append(overviewPanel, peoplePanel, recordsPanel, leavePanel);
  if (capabilities.canManageRecruitment || vacancies.length) panelEl.append(recruitmentPanel);
  panelEl.append(performancePanel, trainingPanel);
  if (capabilities.canManageCompensation || capabilities.canReviewCompensation || compensation.length) panelEl.append(compensationPanel);
  if (capabilities.canManageRelations || capabilities.canManageDiscipline || employeeCases.length) panelEl.append(relationsPanel);
  if (capabilities.canManageCompliance || compliance.length) panelEl.append(compliancePanel);
  if (capabilities.canManageExit || exits.length) panelEl.append(exitPanel);

  mountWorkspaceTabs('humanResources', [
    { key: 'overview', label: 'Overview', icon: '\u25A6', nodes: overviewPanel },
    { key: 'people', label: 'People', icon: '\u{1F465}', count: directory.length, nodes: peoplePanel },
    { key: 'records', label: 'Records', icon: '\u{1F5C2}', count: employmentHistory.length, nodes: recordsPanel },
    { key: 'leave', label: 'Time & leave', icon: '\u{1F334}', count: pendingLeave + timeRecords.length, nodes: leavePanel },
    { key: 'recruitment', label: 'Recruitment', icon: '\u{1F4CB}', count: openVacancies, nodes: capabilities.canManageRecruitment || vacancies.length ? recruitmentPanel : [] },
    { key: 'performance', label: 'Performance', icon: '\u2605', count: reviews.length, nodes: performancePanel },
    { key: 'training', label: 'Training', icon: '\u{1F393}', count: training.length, nodes: trainingPanel },
    { key: 'compensation', label: 'Pay & benefits', icon: '\u20A6', count: pendingCompensation, nodes: capabilities.canManageCompensation || capabilities.canReviewCompensation || compensation.length ? compensationPanel : [] },
    { key: 'relations', label: 'Relations & conduct', icon: '\u2696', count: openCases, nodes: capabilities.canManageRelations || capabilities.canManageDiscipline || employeeCases.length ? relationsPanel : [] },
    { key: 'compliance', label: 'Compliance', icon: '\u{1F6E1}', count: dueCompliance, nodes: capabilities.canManageCompliance || compliance.length ? compliancePanel : [] },
    { key: 'exit', label: 'Exit', icon: '\u21AA', count: activeExits, nodes: capabilities.canManageExit || exits.length ? exitPanel : [] }
  ]);
  renderModuleSummary('humanResources', data);

  document.getElementById('refreshHumanResources')?.addEventListener('click', (event) => runButtonAction(event.currentTarget, 'Refreshing...', loadHumanResources));
  bindHrWorkspaceSearch(panelEl);
  bindHrPersonPickers(panelEl);
  hrFormStaffNameSync(document.getElementById('hrEmployeeForm'), directory);
  hrFormStaffNameSync(document.getElementById('hrLeaveForm'), directory);
  hrFormStaffNameSync(document.getElementById('hrReviewForm'), directory);
  hrFormStaffNameSync(document.getElementById('hrTrainingForm'), directory);
  hrFormStaffNameSync(document.getElementById('hrHistoryForm'), directory);
  hrFormStaffNameSync(document.getElementById('hrTimeForm'), directory);
  hrFormStaffNameSync(document.getElementById('hrCompensationForm'), directory);
  hrFormStaffNameSync(document.getElementById('hrCaseForm'), directory);
  hrFormStaffNameSync(document.getElementById('hrExitForm'), directory);
  bindHrForm('hrEmployeeForm', 'saveemployee', 'Saving...', 'Save employment record');
  bindHrForm('hrLeaveForm', 'saveleave', 'Submitting...', 'Submit leave request');
  bindHrForm('hrVacancyForm', 'savevacancy', 'Saving...', 'Save vacancy');
  bindHrForm('hrReviewForm', 'savereview', 'Saving...', 'Save performance review');
  bindHrForm('hrTrainingForm', 'savetraining', 'Saving...', 'Save training record');
  bindHrForm('hrCandidateForm', 'savecandidate', 'Saving...', 'Save candidate');
  bindHrForm('hrHistoryForm', 'saveemploymenthistory', 'Saving...', 'Save employment history');
  bindHrForm('hrTimeForm', 'savetimerecord', 'Saving...', 'Save time record');
  bindHrForm('hrCompensationForm', 'savecompensation', 'Sending...', 'Send for review');
  bindHrForm('hrCaseForm', 'saveemployeecase', 'Saving...', 'Save confidential case');
  bindHrForm('hrComplianceForm', 'savecompliance', 'Saving...', 'Save compliance item');
  bindHrForm('hrExitForm', 'saveexit', 'Saving...', 'Save exit record');

  panelEl.querySelectorAll('[data-edit-hr-employee]').forEach((button) => button.addEventListener('click', () => {
    const form = document.getElementById('hrEmployeeForm');
    const record = directory.find((row) => lower(row.Username) === lower(button.dataset.editHrEmployee));
    if (!form || !record) return;
    ['Username', 'EmployeeId', 'Position', 'Department', 'EmploymentType', 'HireDate', 'ManagerUsername', 'WorkEmail', 'Phone', 'Status', 'EmergencyContact', 'DisplayName'].forEach((field) => {
      if (form.elements[field]) form.elements[field].value = record[field] ?? '';
    });
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  panelEl.querySelectorAll('[data-edit-hr-vacancy]').forEach((button) => button.addEventListener('click', () => {
    const form = document.getElementById('hrVacancyForm');
    const record = vacancies.find((row) => clean(row.VacancyId || row.__id) === clean(button.dataset.editHrVacancy));
    if (!form || !record) return;
    ['VacancyId', 'Title', 'Department', 'EmploymentType', 'Openings', 'ClosingDate', 'Status', 'Description'].forEach((field) => {
      if (form.elements[field]) form.elements[field].value = record[field] ?? '';
    });
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  bindHrRecordEditors('[data-edit-hr-candidate]', 'hrCandidateForm', candidates, ['CandidateId', '__id'], [
    'CandidateId', 'VacancyId', 'CandidateName', 'Email', 'Phone', 'ApplicationDate', 'ApplicationReference', 'QualificationSummary',
    'InterviewDate', 'InterviewPanel', 'InterviewNotes', 'QualificationCheck', 'ReferenceCheck', 'Status'
  ]);
  bindHrRecordEditors('[data-edit-hr-history]', 'hrHistoryForm', employmentHistory, ['HistoryId', '__id'], [
    'HistoryId', 'Username', 'DisplayName', 'RecordType', 'Title', 'EffectiveDate', 'ExpiryDate', 'DocumentReference', 'Notes'
  ]);
  bindHrRecordEditors('[data-edit-hr-time]', 'hrTimeForm', timeRecords, ['TimeRecordId', '__id'], [
    'TimeRecordId', 'Username', 'DisplayName', 'RecordType', 'WorkDate', 'StartTime', 'EndTime', 'Reason', 'Status'
  ]);
  bindHrRecordEditors('[data-edit-hr-review]', 'hrReviewForm', reviews, ['ReviewId', '__id'], [
    'ReviewId', 'Username', 'DisplayName', 'ReviewPeriod', 'Rating', 'Strengths', 'DevelopmentAreas', 'Goals', 'Status'
  ]);
  bindHrRecordEditors('[data-edit-hr-training]', 'hrTrainingForm', training, ['TrainingId', '__id'], [
    'TrainingId', 'Username', 'DisplayName', 'Course', 'Provider', 'CompletionDate', 'Status', 'CertificateReference'
  ]);
  bindHrRecordEditors('[data-edit-hr-compensation]', 'hrCompensationForm', compensation, ['CompensationId', '__id'], [
    'CompensationId', 'Username', 'DisplayName', 'ChangeType', 'Amount', 'Currency', 'EffectiveDate', 'Details'
  ]);
  bindHrRecordEditors('[data-edit-hr-case]', 'hrCaseForm', employeeCases, ['CaseId', '__id'], [
    'CaseId', 'Username', 'DisplayName', 'CaseType', 'OpenedDate', 'Severity', 'Summary', 'ActionTaken', 'PolicyReference', 'Status'
  ]);
  bindHrRecordEditors('[data-edit-hr-compliance]', 'hrComplianceForm', compliance, ['ComplianceId', '__id'], [
    'ComplianceId', 'Category', 'Obligation', 'Owner', 'DueDate', 'EvidenceReference', 'Notes', 'Status'
  ]);
  bindHrRecordEditors('[data-edit-hr-exit]', 'hrExitForm', exits, ['ExitId', '__id'], [
    'ExitId', 'Username', 'DisplayName', 'ExitType', 'NoticeDate', 'LastWorkingDate', 'Reason', 'HandoverStatus',
    'ClearanceStatus', 'FinalPayStatus', 'FinalDocumentReference', 'ExitInterviewNotes', 'Status'
  ]);
  panelEl.querySelectorAll('[data-repair-hr-exit]').forEach((button) => button.addEventListener('click', async () => {
    if (!await window.DynamaxDialogs.confirm({ title: 'Repair staff exit', message: 'Disable this dismissed staff account and repair the completed exit record now?', confirmText: 'Repair access' })) return;
    const normalText = clean(button.textContent) || 'Repair access';
    setButtonLoading(button, true, 'Repairing...', normalText);
    try {
      const result = await humanResourcesRequest('saveexit', { ExitId: button.dataset.repairHrExit, Status: 'Completed' });
      await loadHumanResources();
      setStatus(document.getElementById('humanResourcesStatus') || dashboardStatus, result.message, 'ok');
    } catch (error) {
      setStatus(document.getElementById('humanResourcesStatus') || dashboardStatus, error.message || String(error), 'bad');
      if (button.isConnected) setButtonLoading(button, false, 'Repairing...', normalText);
    }
  }));
  panelEl.querySelectorAll('[data-hr-leave-decision]').forEach((button) => button.addEventListener('click', async () => {
    const decision = button.dataset.hrLeaveDecision;
    const note = await window.DynamaxDialogs.prompt({ title: `${decision} leave request`, message: 'Review the request before recording this decision.', label: 'Decision note (optional)', confirmText: decision });
    if (note === null) return;
    setButtonLoading(button, true, `${decision}...`, decision);
    try {
      const result = await humanResourcesRequest('reviewleave', { LeaveId: button.dataset.hrLeaveId, Decision: decision, ReviewNotes: note });
      await loadHumanResources();
      setStatus(dashboardStatus, result.message, 'ok');
    } catch (error) {
      setStatus(document.getElementById('humanResourcesStatus') || dashboardStatus, error.message || String(error), 'bad');
      if (button.isConnected) setButtonLoading(button, false, `${decision}...`, decision);
    }
  }));
  panelEl.querySelectorAll('[data-hr-compensation-decision]').forEach((button) => button.addEventListener('click', async () => {
    const decision = button.dataset.hrCompensationDecision;
    const note = await window.DynamaxDialogs.prompt({ title: `${decision} pay or benefit change`, message: 'Review the change before recording this decision.', label: 'Decision note (optional)', confirmText: decision });
    if (note === null) return;
    setButtonLoading(button, true, `${decision}...`, decision === 'Implemented' ? 'Mark implemented' : decision);
    try {
      const result = await humanResourcesRequest('reviewcompensation', {
        CompensationId: button.dataset.hrCompensationId,
        Decision: decision,
        ReviewNotes: note
      });
      await loadHumanResources();
      setStatus(dashboardStatus, result.message, 'ok');
    } catch (error) {
      setStatus(document.getElementById('humanResourcesStatus') || dashboardStatus, error.message || String(error), 'bad');
      if (button.isConnected) setButtonLoading(button, false, `${decision}...`, decision === 'Implemented' ? 'Mark implemented' : decision);
    }
  }));
}

async function loadHumanResources() {
  if (activeSection !== 'humanResources') return;
  try {
    const data = await humanResourcesRequest('list');
    if (activeSection !== 'humanResources') return;
    renderHumanResources(data);
  } catch (error) {
    if (activeSection === 'humanResources') panelEl.innerHTML = `<p class="status bad">${escapeHtml(error.message || String(error))}</p>`;
  }
}

async function loadChurchOfferings() {
  try {
    const response = await staffFetch('/api/staff-offerings', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list', BranchId: currentUser?.branchId || 'main' })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.message || 'Could not load church offerings.');
    if (activeSection !== 'offerings') return;
    renderModuleSummary('offerings', data);
    const summary = data.summary || {};
    const offeringSourceRows = Object.entries(summary.byType || {})
      .map(([Name, Amount]) => ({ Name, Amount: Number(Amount || 0) }))
      .sort((left, right) => right.Amount - left.Amount);
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
      <div class="church-dashboard-grid giving-source-chart">
        ${verticalBars('Offering batches by giving type', offeringSourceRows, 'Name', 'Amount', 'gold')}
      </div>
      ${routeFormSection}
      ${routeTableSection}
      <p class="muted">Capture and reconciliation are managed in the desktop suite. Reconciliation locks the batch and prepares a journal preview; it still requires approval before posting to accounting.</p>
      ${table('Offering Batches', data.offerings || [], [
        { label: 'Date', value: (row) => pick(row, ['Date']) },
        { label: 'Batch', value: (row) => pick(row, ['BatchReference']) },
        { label: 'Service', value: (row) => pick(row, ['ServiceName', 'ServiceOccurrenceId']) },
        { label: 'Fund', value: (row) => pick(row, ['FundName', 'FundId']) },
        { label: 'Giving type', value: (row) => pick(row, ['GivingTypeName', 'GivingTypeId']) || 'Offering' },
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
              buttons.push(`<button type="button" class="table-action compact-icon-action compact-approve-action" data-offering-action="approvechurchoffering" data-offering-id="${escapeHtml(pick(row, ['OfferingId', '__id']))}" aria-label="Approve offering" title="Approve"><span aria-hidden="true">&#10003;</span></button>`);
              buttons.push(`<button type="button" class="table-action compact-icon-action compact-reject-action" data-offering-action="rejectchurchoffering" data-offering-id="${escapeHtml(pick(row, ['OfferingId', '__id']) )}" aria-label="Reject offering" title="Reject"><span aria-hidden="true">&#10005;</span></button>`);
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
    const offeringNotes = [...panelEl.querySelectorAll(':scope > p.muted')];
    mountWorkspaceTabs('offerings', [
      { key: 'overview', label: 'Overview', icon: '\u25A6', nodes: [...panelEl.querySelectorAll(':scope > .workflow-kpis, :scope > .church-dashboard-grid')] },
      { key: 'batches', label: 'Offering batches', icon: '\u{1F9FA}', count: (data.offerings || []).length, nodes: [offeringNotes.filter((node) => /capture and reconciliation/i.test(node.textContent)), workspaceTableNodes('Offering Batches')] },
      { key: 'routes', label: 'Approval routes', icon: '\u21C4', count: approvalRoutes.length, nodes: [[...panelEl.querySelectorAll(':scope > .config-group')], offeringNotes.filter((node) => !/capture and reconciliation/i.test(node.textContent))] },
      { key: 'audit', label: 'Audit', icon: '\u2713', count: (data.audit || []).length, nodes: workspaceTableNodes('Recent Offering Audit') }
    ]);
    panelEl.querySelectorAll('[data-offering-action]').forEach((button) => {
      button.addEventListener('click', async () => {
        if (button.disabled) return;
        const offeringId = button.getAttribute('data-offering-id');
        const action = button.getAttribute('data-offering-action');
        const actionLabel = {
          reconcile: 'reconcile',
          approvechurchoffering: 'approve',
          rejectchurchoffering: 'reject',
          postchurchoffering: 'post'
        }[action] || action;
        if (!offeringId) return;
        if ((actionLabel === 'approve' || actionLabel === 'reconcile' || actionLabel === 'post') && !await window.DynamaxDialogs.confirm({ title: `${actionLabel.charAt(0).toUpperCase()}${actionLabel.slice(1)} offering`, message: `Confirm ${actionLabel} for ${offeringId}?`, confirmText: actionLabel })) return;
        const reason = actionLabel === 'reject' ? await window.DynamaxDialogs.prompt({ title: 'Reject offering', message: `Reject ${offeringId}?`, label: 'Reason (optional)', tone: 'danger', confirmText: 'Reject offering' }) : '';
        if (actionLabel === 'reject' && reason === null) return;
        const idempotencyKey = button.dataset.idempotencyKey || newIdempotencyKey();
        button.dataset.idempotencyKey = idempotencyKey;
        const normalMarkup = button.innerHTML;
        setButtonLoading(button, true, '', clean(button.textContent));
        try {
          const data = await doOfferingAction(action, offeringId, reason, idempotencyKey);
          delete button.dataset.idempotencyKey;
          setStatus(dashboardStatus, data.message, 'ok');
          await loadChurchOfferings();
        } catch (error) {
          if (error?.responseReceived) delete button.dataset.idempotencyKey;
          setStatus(dashboardStatus, error.message || String(error), 'bad');
        } finally {
          if (button.isConnected) {
            setButtonLoading(button, false, '', '');
            button.innerHTML = normalMarkup;
          }
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
          if (!await window.DynamaxDialogs.confirm({ title: 'Deactivate approval route', message: `Deactivate route ${routeId}? It will not be used for new assignments.`, confirmText: 'Deactivate route' })) return;
          try {
            await runButtonAction(button, 'Deactivating...', async () => {
              const data = await doOfferingRouteAction('deactivateofferingroute', { RouteId: routeId });
              setStatus(dashboardStatus, data.message, 'ok');
              await loadChurchOfferings();
            });
          } catch (error) {
            setStatus(dashboardStatus, error.message || String(error), 'bad');
          }
          return;
        }
        if (routeAction === 'delete') {
          if (!await window.DynamaxDialogs.confirm({ title: 'Delete approval route', message: `Delete route ${routeId}?`, tone: 'danger', confirmText: 'Delete route' })) return;
          try {
            await runButtonAction(button, 'Deleting...', async () => {
              const data = await doOfferingRouteAction('deleteofferingroute', { RouteId: routeId });
              setStatus(dashboardStatus, data.message, 'ok');
              await loadChurchOfferings();
            });
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
    document.getElementById('refreshChurchOfferings')?.addEventListener('click', (event) => {
      runButtonAction(event.currentTarget, 'Refreshing...', loadChurchOfferings);
    });
  } catch (error) {
    if (activeSection === 'offerings') panelEl.innerHTML = `<p class="status bad">${escapeHtml(error.message || String(error))}</p>`;
  }
}

function compactMoney(value) {
  const numeric = Number(value || 0);
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    notation: Math.abs(numeric) >= 1000000 ? 'compact' : 'standard',
    maximumFractionDigits: Math.abs(numeric) >= 1000000 ? 1 : 0
  }).format(numeric);
}

function incomeOptionList(rows, valueKey, labelKey, selected, firstLabel) {
  return `<option value="">${escapeHtml(firstLabel)}</option>${(rows || []).map((row) => {
    const value = typeof row === 'object' ? row[valueKey] : row;
    const label = typeof row === 'object' ? row[labelKey] : row;
    return `<option value="${escapeHtml(value)}"${clean(value) === clean(selected) ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  }).join('')}`;
}

function renderIncomeBars(rows = []) {
  const maximum = Math.max(1, ...rows.map((row) => Math.abs(Number(row.value || 0))));
  if (!rows.some((row) => Math.abs(Number(row.value || 0)) > 0.005)) {
    return '<div class="income-empty-chart"><span aria-hidden="true">▥</span><p>No posted income was recorded for this period.</p></div>';
  }
  return `<div class="income-bar-chart" style="--income-buckets:${rows.length}" role="img" aria-label="Income over time">${rows.map((row) => {
    const numeric = Number(row.value || 0);
    const hasIncome = Math.abs(numeric) > 0.005;
    const height = hasIncome ? Math.max(3, Math.round(Math.abs(numeric) / maximum * 100)) : 0;
    return `<div class="income-bar-item${hasIncome ? '' : ' is-zero'}" title="${escapeHtml(row.label)}: ${escapeHtml(money(row.value))}">
      <strong${hasIncome ? '' : ' aria-hidden="true"'}>${hasIncome ? escapeHtml(compactMoney(row.value)) : ''}</strong>
      <div>${hasIncome ? `<i style="height:${height}%"></i>` : ''}</div>
      <small>${escapeHtml(row.label)}</small>
    </div>`;
  }).join('')}</div>`;
}

const incomeChartColours = ['#18c7a3', '#206de5', '#ffc94a', '#9167d8', '#ef775a', '#24a6b8', '#e64e72', '#829ab1'];

function renderIncomeDistribution(title, rows = []) {
  const total = rows.reduce((sum, row) => sum + Math.max(0, Number(row.value || 0)), 0);
  if (!total) {
    return `<article class="income-distribution-card"><h3>${escapeHtml(title)}</h3><div class="income-empty-chart compact"><p>No distribution data yet.</p></div></article>`;
  }
  let cursor = 0;
  const segments = rows.map((row, index) => {
    const start = cursor;
    cursor += Math.max(0, Number(row.value || 0)) / total * 100;
    return `${incomeChartColours[index % incomeChartColours.length]} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
  });
  return `<article class="income-distribution-card">
    <h3>${escapeHtml(title)}</h3>
    <div class="income-donut-layout">
      <div class="income-donut" style="--income-donut:${segments.join(',')}"><span><strong>${escapeHtml(compactMoney(total))}</strong><small>Total</small></span></div>
      <div class="income-legend">${rows.map((row, index) => `<div><i style="background:${incomeChartColours[index % incomeChartColours.length]}"></i><span>${escapeHtml(row.label)}</span><strong>${escapeHtml(money(row.value))}</strong></div>`).join('')}</div>
    </div>
  </article>`;
}

function renderIncomeAnalytics(data) {
  if (activeSection !== 'incomeAnalytics') return;
  incomeAnalyticsData = data;
  incomeAnalyticsFilter = { ...incomeAnalyticsFilter, ...(data.filter || {}) };
  renderModuleSummary('incomeAnalytics', data);
  const period = data.period || {};
  const options = data.options || {};
  const selectedBranch = data.filter?.branchId || incomeAnalyticsFilter.branchId || '';
  const selectedBranchLabel = availableBranches.find((branch) => branch.id === selectedBranch)?.name || selectedBranch || 'Current branch';
  const accountOptions = (options.accounts || []).map((row) => ({ ...row, label: `${row.code} - ${row.name}` }));
  const periodButtons = [
    ['daily', 'Daily'],
    ['weekly', 'Weekly'],
    ['monthly', 'Monthly'],
    ['quarterly', 'Quarterly']
  ].map(([key, label]) => `<button type="button" data-income-period="${key}" class="${period.mode === key ? 'active' : ''}">${label}</button>`).join('');
  const excludedCurrencyNotice = Number(data.summary?.excludedUnconvertedTransactions || 0)
    ? `<p class="status bad">${escapeHtml(data.summary.excludedUnconvertedTransactions)} posted foreign-currency journal${Number(data.summary.excludedUnconvertedTransactions) === 1 ? '' : 's'} excluded because no frozen NGN conversion is available.</p>`
    : '';
  const latestAvailableNotice = period.usedLatestAvailable
    ? `<p class="status">There is no posted income in the current month yet. Showing the latest month with posted income (${escapeHtml(period.dateFrom)} to ${escapeHtml(period.dateTo)}).</p>`
    : '';
  panelEl.innerHTML = `
    <div class="income-analytics" id="incomeAnalyticsReport">
      <div class="workflow-intro income-report-heading">
        <div><p class="eyebrow">Finance & accounting</p><h2>Income Analytics</h2><p class="muted">Posted revenue from the shared accounting ledger, without duplicate operational totals.</p></div>
        <div class="income-report-actions"><button type="button" class="secondary" id="incomeExportCsv">&#8681; CSV</button><button type="button" id="incomePrintReport">&#9113; Print / PDF</button></div>
      </div>
      <section class="income-filter-card" aria-label="Income report filters">
        <div class="income-period-switch">${periodButtons}</div>
        <form id="incomeAnalyticsFilter" class="income-filter-grid">
          <label>From<input type="date" name="dateFrom" value="${escapeHtml(period.dateFrom)}"></label>
          <label>To<input type="date" name="dateTo" value="${escapeHtml(period.dateTo)}"></label>
          <label>Branch<select aria-label="Current working branch" disabled><option>${escapeHtml(selectedBranchLabel)}</option></select><input type="hidden" name="branchId" value="${escapeHtml(selectedBranch)}"></label>
          <label>Department<select name="department">${incomeOptionList(options.departments, '', '', incomeAnalyticsFilter.department, 'All departments')}</select></label>
          <label>Income account<select name="accountCode">${incomeOptionList(accountOptions, 'code', 'label', incomeAnalyticsFilter.accountCode, 'All income accounts')}</select></label>
          <label>Payment route<select name="channel">${incomeOptionList(options.channels, '', '', incomeAnalyticsFilter.channel, 'All payment routes')}</select></label>
          <label>Income source<select name="source">${incomeOptionList(options.sources, '', '', incomeAnalyticsFilter.source, 'All income sources')}</select></label>
          <button type="submit">Apply filters</button>
        </form>
      </section>
      <div class="income-report-period"><span>${escapeHtml(period.dateFrom)} to ${escapeHtml(period.dateTo)}</span><strong>${escapeHtml(money(data.summary?.totalIncome))}</strong><small>${escapeHtml(data.summary?.transactionCount || 0)} transaction${Number(data.summary?.transactionCount) === 1 ? '' : 's'}</small></div>
      ${latestAvailableNotice}
      ${excludedCurrencyNotice}
      <section class="income-chart-card"><div class="income-card-heading"><div><p class="eyebrow">Income dynamics</p><h3>Income over time</h3></div><span>Hover or tap a bar for the exact value</span></div>${renderIncomeBars(data.timeline || [])}</section>
      <section class="income-distribution-grid">
        ${renderIncomeDistribution('Income by source', data.sources || [])}
        ${renderIncomeDistribution('Settlement route', data.channels || [])}
      </section>
      <section class="income-transactions">
        <div class="income-card-heading"><div><p class="eyebrow">Drill-down</p><h3>Income transactions</h3></div><span>${escapeHtml((data.transactions || []).length)} rows</span></div>
        ${table('', data.transactions || [], [
          { label: 'Date', value: (row) => row.date },
          { label: 'Reference', value: (row) => row.reference || row.journalNo },
          { label: 'Description', value: (row) => row.description },
          { label: 'Source', value: (row) => row.source },
          { label: 'Department', value: (row) => row.department },
          { label: 'Route', value: (row) => row.channel },
          { label: 'Income Account', value: (row) => row.accounts },
          { label: 'Original amount', value: (row) => row.transactionCurrency && row.transactionCurrency !== row.baseCurrency && row.originalAmount ? moneyInCurrency(row.originalAmount, row.transactionCurrency) : '—' },
          { label: 'Rate', value: (row) => row.transactionCurrency && row.transactionCurrency !== row.baseCurrency ? `1 ${row.transactionCurrency} = ${row.baseCurrency} ${row.exchangeRate} · ${row.exchangeRateDate}` : '—' },
          { label: 'Amount', value: (row) => money(row.amount) }
        ])}
      </section>
    </div>`;
  const incomeReport = document.getElementById('incomeAnalyticsReport');
  mountWorkspaceTabs('incomeAnalytics', [
    { key: 'overview', label: 'Overview & filters', icon: '\u25A6', nodes: [incomeReport?.querySelector(':scope > .income-filter-card'), incomeReport?.querySelector(':scope > .income-report-period'), [...(incomeReport?.querySelectorAll(':scope > p.status') || [])]] },
    { key: 'trends', label: 'Trends & sources', icon: '\u{1F4CA}', nodes: [incomeReport?.querySelector(':scope > .income-chart-card'), incomeReport?.querySelector(':scope > .income-distribution-grid')] },
    { key: 'transactions', label: 'Transactions', icon: '\u{1F5C2}', count: (data.transactions || []).length, nodes: incomeReport?.querySelector(':scope > .income-transactions') }
  ], { host: incomeReport, after: incomeReport?.querySelector(':scope > .workflow-intro') });
  bindIncomeAnalyticsEvents();
}

async function loadIncomeAnalytics(filter = incomeAnalyticsFilter) {
  try {
    const response = await staffFetch('/api/income-analytics', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(filter || {})
    });
    const data = await response.json().catch(() => ({ ok: false, message: 'Income analytics did not return JSON.' }));
    if (response.status === 401) { showLogin(data.message || 'Your staff session has expired.', 'bad'); return; }
    if (!response.ok || !data.ok) throw new Error(data.message || 'Income analytics could not be loaded.');
    renderIncomeAnalytics(data);
  } catch (error) {
    if (activeSection === 'incomeAnalytics') panelEl.innerHTML = `<p class="status bad">${escapeHtml(error.message || String(error))}</p>`;
  }
}

function csvCell(value) {
  let text = clean(value).replace(/"/g, '""');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text}"`;
}

function exportIncomeAnalyticsCsv() {
  const rows = incomeAnalyticsData?.transactions || [];
  const headings = ['Date', 'Reference', 'Description', 'Source', 'Department', 'Payment Route', 'Income Account', 'Original Amount', 'Original Currency', 'Exchange Rate', 'Rate Date', 'Rate Source', 'Base Currency', 'Base Amount'];
  const content = [headings, ...rows.map((row) => [
    row.date, row.reference || row.journalNo, row.description, row.source,
    row.department, row.channel, row.accounts, Number(row.originalAmount || 0).toFixed(2),
    row.transactionCurrency || 'NGN', Number(row.exchangeRate || 1), row.exchangeRateDate,
    row.exchangeRateSource, row.baseCurrency || 'NGN', Number(row.amount || 0).toFixed(2)
  ])].map((row) => row.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `income-report-${incomeAnalyticsData?.period?.dateFrom || 'from'}-${incomeAnalyticsData?.period?.dateTo || 'to'}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function bindIncomeAnalyticsEvents() {
  panelEl.querySelectorAll('[data-income-period]').forEach((button) => button.addEventListener('click', () => {
    incomeAnalyticsFilter = {
      period: button.dataset.incomePeriod,
      branchId: incomeAnalyticsFilter.branchId,
      department: incomeAnalyticsFilter.department,
      accountCode: incomeAnalyticsFilter.accountCode,
      channel: incomeAnalyticsFilter.channel,
      source: incomeAnalyticsFilter.source
    };
    panelEl.innerHTML = '<p class="muted">Updating income report...</p>';
    loadIncomeAnalytics(incomeAnalyticsFilter);
  }));
  document.getElementById('incomeAnalyticsFilter')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    incomeAnalyticsFilter = { ...values, period: 'custom' };
    panelEl.innerHTML = '<p class="muted">Applying income filters...</p>';
    loadIncomeAnalytics(incomeAnalyticsFilter);
  });
  document.getElementById('incomeExportCsv')?.addEventListener('click', exportIncomeAnalyticsCsv);
  document.getElementById('incomePrintReport')?.addEventListener('click', () => window.print());
}

const recordsDeskTypeLabels = {
  students: 'Students',
  applicants: 'Applicants',
  staff: 'Staff',
  members: 'Members',
  departments: 'Departments',
  donors: 'Donors'
};

const recordsDeskTypeIcons = {
  students: '\u{1F393}',
  applicants: '\u{1F4DD}',
  staff: '\u{1F9D1}',
  members: '\u{1F465}',
  departments: '\u{1F3E2}',
  donors: '\u{1F381}'
};

function inferredRecordsDeskTypes() {
  const allowed = new Set(currentUser?.allowedSections || []);
  const edition = resolveDashboardEdition(currentUser || {});
  const school = edition === 'school';
  return [
    school && ['students', 'accounts', 'clinic', 'tuckShop', 'studentConduct'].some((key) => allowed.has(key)) && 'students',
    school && allowed.has('admissions') && 'applicants',
    allowed.has('staffUsers') && 'staff',
    !school && allowed.has('members') && 'members',
    !school && ['members', 'funds', 'offerings'].some((key) => allowed.has(key)) && 'departments',
    !school && allowed.has('donations') && 'donors'
  ].filter(Boolean);
}

function recordsDeskFaceLookupAllowed() {
  return resolveDashboardEdition(currentUser || {}) === 'school' &&
    yes(currentUser?.biometricLookupEnabled) &&
    recordsDeskState.availableTypes.includes('students');
}

function preloadRecordsDeskFaceRecognition() {
  if (!recordsDeskFaceLookupAllowed() || recordsDeskFacePreloadPromise || recordsDeskFacePreloadScheduled) return;
  recordsDeskFacePreloadScheduled = true;
  const preload = () => {
    recordsDeskFacePreloadScheduled = false;
    recordsDeskFacePreloadPromise = import('./student-face-lookup.js?v=20260812-face-attendance-guidance')
      .then((module) => module.preloadFaceRecognitionModel())
      .catch(() => {
        recordsDeskFacePreloadPromise = null;
      });
  };
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(preload, { timeout: 2000 });
  } else {
    window.setTimeout(preload, 300);
  }
}

async function openRecordsDeskFaceLookup(options = {}) {
  try {
    const module = await import('./student-face-lookup.js?v=20260812-face-attendance-guidance');
    await module.openStudentFaceLookup(options);
  } catch (failure) {
    recordsDeskState.error = failure.message || String(failure);
    renderRecordsDesk();
  }
}

function recordsDeskResultKey(type, id, branchId = '') {
  return `${clean(type)}::${clean(id)}::${clean(branchId).toLowerCase()}`;
}

function renderRecordsDeskResult(record) {
  const selected = recordsDeskState.selectedKey === recordsDeskResultKey(record.type, record.id, record.branchId);
  const initials = clean(record.title).split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join('').toUpperCase() || '?';
  return `<button type="button" class="records-desk-result${selected ? ' selected' : ''}" data-record-type="${escapeHtml(record.type)}" data-record-id="${escapeHtml(record.id)}" data-record-branch="${escapeHtml(record.branchId || '')}" aria-pressed="${selected}">
    <span class="records-desk-result-avatar tone-${Math.abs(clean(record.id).split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)) % 5 + 1}">${escapeHtml(initials)}</span>
    <span class="records-desk-result-copy"><strong>${escapeHtml(record.title)}</strong><span>${escapeHtml(record.subtitle || record.id)}</span><small>${escapeHtml(recordsDeskTypeLabels[record.type] || record.type)} · ${escapeHtml(record.status || 'Active')}</small></span>
    <span class="records-desk-result-arrow" aria-hidden="true">›</span>
  </button>`;
}

function renderRecordsDeskMetric(metric) {
  const value = metric.format === 'money' ? money(metric.value) : clean(metric.value);
  return `<div><small>${escapeHtml(metric.label)}</small><strong>${escapeHtml(value || '0')}</strong></div>`;
}

function renderRecordsDeskDetail(detail) {
  if (recordsDeskState.loadingDetail) {
    return `<div class="records-desk-detail-state"><span class="records-desk-spinner" aria-hidden="true"></span><strong>Loading record details...</strong><small>Applying your role and branch permissions.</small></div>`;
  }
  if (!detail) {
    return `<div class="records-desk-detail-state">
      <span class="records-desk-empty-icon" aria-hidden="true">\u{1F5C2}</span>
      <strong>Select a record</strong>
      <small>The permitted profile, activity and quick links will appear here.</small>
    </div>`;
  }
  const initials = clean(detail.title).split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join('').toUpperCase() || '?';
  const sections = (detail.sections || []).map((section) => `<section class="records-desk-info-card">
    <h3>${escapeHtml(section.title)}</h3>
    <dl>${(section.items || []).map((entry) => `<div><dt>${escapeHtml(entry.label)}</dt><dd>${escapeHtml(entry.value || '—')}</dd></div>`).join('')}</dl>
  </section>`).join('');
  const activities = (detail.activities || []).map((group) => `<section class="records-desk-activity-card">
    <h3>${escapeHtml(group.title)}</h3>
    <div>${(group.rows || []).map((row) => `<article>
      <span><strong>${escapeHtml(row.title)}</strong><small>${escapeHtml(row.meta || row.status || '')}</small>${row.detail ? `<small>${escapeHtml(row.detail)}</small>` : ''}</span>
      ${row.amount === undefined ? '' : `<b>${escapeHtml(row.currency ? moneyInCurrency(row.amount, row.currency) : money(row.amount))}</b>`}
    </article>`).join('')}</div>
  </section>`).join('');
  const actions = (detail.actions || []).map((action, index) =>
    `<button type="button" data-record-action="${index}">${escapeHtml(action.label)}</button>`).join('');
  return `
    <button type="button" class="records-desk-mobile-back" id="recordsDeskBack"><span aria-hidden="true">‹</span> Back to results</button>
    <header class="records-desk-profile-header">
      <span class="records-desk-profile-avatar">${escapeHtml(initials)}</span>
      <div><small>${escapeHtml(recordsDeskTypeLabels[detail.type] || detail.type)}</small><h2>${escapeHtml(detail.title)}</h2><p>${escapeHtml(detail.subtitle || detail.id)}</p></div>
      <span class="records-desk-status">${escapeHtml(detail.status || 'Active')}</span>
    </header>
    ${(detail.metrics || []).length ? `<div class="records-desk-metrics">${detail.metrics.map(renderRecordsDeskMetric).join('')}</div>` : ''}
    ${actions ? `<nav class="records-desk-actions" aria-label="Record actions">${actions}</nav>` : ''}
    <div class="records-desk-detail-grid">${sections}${activities}</div>`;
}

function renderRecordsDesk() {
  const availableTypes = recordsDeskState.availableTypes.length
    ? recordsDeskState.availableTypes
    : inferredRecordsDeskTypes();
  recordsDeskState.availableTypes = availableTypes;
  if (recordsDeskState.type !== 'all' && !availableTypes.includes(recordsDeskState.type)) recordsDeskState.type = 'all';
  const typeButtons = [
    ['all', 'All records', '\u{1F5C2}'],
    ...availableTypes.map((type) => [type, recordsDeskTypeLabels[type] || type, recordsDeskTypeIcons[type] || '\u2022'])
  ];
  const resultMessage = recordsDeskState.error
    ? `<p class="status bad">${escapeHtml(recordsDeskState.error)}</p>`
    : !clean(recordsDeskState.query)
      ? '<p>Search by name, record number, email, phone or another permitted identifier.</p>'
      : clean(recordsDeskState.query).length < 3
        ? '<p>Enter at least three characters to begin.</p>'
        : recordsDeskState.results.length
          ? `<p>${escapeHtml(recordsDeskState.totalMatches)} matching record${recordsDeskState.totalMatches === 1 ? '' : 's'}${recordsDeskState.truncated ? ' · showing the first results' : ''}</p>`
          : '<p>No matching records found.</p>';
  const faceLookupButton = recordsDeskFaceLookupAllowed()
    ? '<button type="button" class="records-desk-face-action" id="recordsDeskFaceLookup"><span aria-hidden="true">📷</span><span>Face lookup</span></button>'
    : '';
  panelEl.innerHTML = `<section class="records-desk-shell${recordsDeskState.detail || recordsDeskState.loadingDetail ? ' detail-open' : ''}">
    <aside class="records-desk-filters">
      <div class="records-desk-heading"><span aria-hidden="true">\u{1F5C2}</span><div><small>Universal lookup</small><h2>Records Desk</h2></div></div>
      <form id="recordsDeskSearchForm" class="records-desk-search" role="search">
        <label for="recordsDeskSearch">Search permitted records</label>
        <div><span aria-hidden="true">\u{1F50D}</span><input id="recordsDeskSearch" name="query" type="search" minlength="3" maxlength="120" autocomplete="off" placeholder="Name, ID, phone, email..." value="${escapeHtml(recordsDeskState.query)}"><button type="submit">Search</button></div>
      </form>
      ${faceLookupButton}
      <nav class="records-desk-type-list" aria-label="Record type filters">
        ${typeButtons.map(([key, label, icon]) => `<button type="button" data-record-filter="${escapeHtml(key)}" class="${recordsDeskState.type === key ? 'active' : ''}" aria-pressed="${recordsDeskState.type === key}"><span aria-hidden="true">${escapeHtml(icon)}</span><span>${escapeHtml(label)}</span></button>`).join('')}
      </nav>
      <div class="records-desk-privacy"><span aria-hidden="true">\u{1F6E1}</span><p><strong>Permission protected</strong><small>Results and detail sections follow your role, branch and workspace access.</small></p></div>
    </aside>
    <section class="records-desk-results-pane" aria-live="polite">
      <header><div><small>Search results</small><h2>${escapeHtml(recordsDeskState.type === 'all' ? 'All permitted records' : recordsDeskTypeLabels[recordsDeskState.type])}</h2></div><span>${recordsDeskState.results.length}</span></header>
      <div class="records-desk-result-message" id="recordsDeskResultMessage">${resultMessage}</div>
      <div class="records-desk-results">${recordsDeskState.results.map(renderRecordsDeskResult).join('')}</div>
    </section>
    <article class="records-desk-detail-pane" aria-live="polite">${renderRecordsDeskDetail(recordsDeskState.detail)}</article>
  </section>`;
  bindRecordsDeskEvents();
  preloadRecordsDeskFaceRecognition();
  renderModuleSummary('recordsDesk', recordsDeskState);
}

async function recordsDeskApi(payload, signal) {
  const response = await staffFetch('/api/staff-records', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({ ok: false, message: 'The Records Desk did not return JSON.' }));
  if (response.status === 401) {
    showLogin(data.message || 'Your staff session has expired.', 'bad');
    throw new Error(data.message || 'Your staff session has expired.');
  }
  if (!response.ok || !data.ok) throw new Error(data.message || 'The Records Desk request could not be completed.');
  return data;
}

async function searchRecordsDesk({ keepFocus = false } = {}) {
  const query = clean(recordsDeskState.query);
  recordsDeskAbortController?.abort();
  recordsDeskAbortController = null;
  if (query.length < 3) {
    recordsDeskRequest += 1;
    recordsDeskState.results = [];
    recordsDeskState.totalMatches = 0;
    recordsDeskState.error = '';
    recordsDeskState.detail = null;
    recordsDeskState.selectedKey = '';
    recordsDeskState.selectedBranchId = '';
    renderRecordsDesk();
    return;
  }
  const requestId = ++recordsDeskRequest;
  const controller = new AbortController();
  recordsDeskAbortController = controller;
  recordsDeskState.loading = true;
  recordsDeskState.error = '';
  const message = document.getElementById('recordsDeskResultMessage');
  if (message) message.innerHTML = '<p><span class="records-desk-spinner" aria-hidden="true"></span> Searching permitted records...</p>';
  try {
    const data = await recordsDeskApi({
      action: 'search',
      query,
      type: recordsDeskState.type === 'all' ? '' : recordsDeskState.type,
      limit: 30
    }, controller.signal);
    if (requestId !== recordsDeskRequest || activeSection !== 'recordsDesk') return;
    recordsDeskState.availableTypes = data.availableTypes || recordsDeskState.availableTypes;
    recordsDeskState.results = data.results || [];
    recordsDeskState.totalMatches = Number(data.totalMatches || 0);
    recordsDeskState.truncated = Boolean(data.truncated);
    if (recordsDeskState.selectedKey && !recordsDeskState.results.some((row) => recordsDeskResultKey(row.type, row.id, row.branchId) === recordsDeskState.selectedKey)) {
      recordsDeskState.selectedKey = '';
      recordsDeskState.selectedBranchId = '';
      recordsDeskState.detail = null;
    }
  } catch (failure) {
    if (failure?.name === 'AbortError') return;
    if (requestId !== recordsDeskRequest || activeSection !== 'recordsDesk') return;
    recordsDeskState.results = [];
    recordsDeskState.totalMatches = 0;
    recordsDeskState.error = failure.message || String(failure);
  } finally {
    if (recordsDeskAbortController === controller) recordsDeskAbortController = null;
    if (requestId === recordsDeskRequest && activeSection === 'recordsDesk') {
      recordsDeskState.loading = false;
      renderRecordsDesk();
      if (keepFocus) {
        const input = document.getElementById('recordsDeskSearch');
        input?.focus();
        input?.setSelectionRange(input.value.length, input.value.length);
      }
    }
  }
}

async function loadRecordsDeskDetail(type, id, branchId = '') {
  recordsDeskState.selectedKey = recordsDeskResultKey(type, id, branchId);
  recordsDeskState.selectedBranchId = branchId;
  recordsDeskState.detail = null;
  recordsDeskState.loadingDetail = true;
  recordsDeskState.error = '';
  renderRecordsDesk();
  const requestId = ++recordsDeskRequest;
  try {
    const data = await recordsDeskApi({ action: 'detail', type, id, branchId });
    if (requestId !== recordsDeskRequest || activeSection !== 'recordsDesk') return;
    recordsDeskState.availableTypes = data.availableTypes || recordsDeskState.availableTypes;
    recordsDeskState.detail = data.detail || null;
  } catch (failure) {
    if (requestId !== recordsDeskRequest || activeSection !== 'recordsDesk') return;
    recordsDeskState.selectedKey = '';
    recordsDeskState.selectedBranchId = '';
    recordsDeskState.error = failure.message || String(failure);
  } finally {
    if (requestId === recordsDeskRequest && activeSection === 'recordsDesk') {
      recordsDeskState.loadingDetail = false;
      renderRecordsDesk();
    }
  }
}

function openRecordsDeskAction(action) {
  if (action?.id === 'student-face-enroll') {
    openRecordsDeskFaceLookup({
      mode: 'enroll',
      student: {
        id: clean(action.context?.AccountRef || recordsDeskState.detail?.id),
        title: clean(action.context?.StudentName || recordsDeskState.detail?.title),
        branchId: clean(action.context?.BranchId || recordsDeskState.detail?.branchId),
        schoolSection: clean(action.context?.SchoolSection || recordsDeskState.detail?.schoolSection)
      },
      onEnrollmentChange: () => loadRecordsDeskDetail(
        recordsDeskState.detail?.type,
        recordsDeskState.detail?.id,
        recordsDeskState.detail?.branchId
      )
    });
    return;
  }
  if (!action?.targetSection || !activeTabs.some(([key]) => key === action.targetSection)) return;
  const handoff = {
    source: 'recordsDesk',
    targetSection: action.targetSection,
    recordType: recordsDeskState.detail?.type,
    recordId: recordsDeskState.detail?.id,
    context: action.context || {},
    createdAt: new Date().toISOString()
  };
  recordsDeskHandoffContext = handoff;
  try {
    sessionStorage.setItem('dynamaxRecordsDeskContext', JSON.stringify(handoff));
  } catch (_error) {
    // A module hand-off still works when private browsing blocks session storage.
  }
  selectSection(action.targetSection);
}

function takeRecordsDeskHandoff(targetSection) {
  let handoff = recordsDeskHandoffContext;
  if (!handoff) {
    try {
      handoff = JSON.parse(sessionStorage.getItem('dynamaxRecordsDeskContext') || 'null');
    } catch (_error) {
      handoff = null;
    }
  }
  const createdAt = Date.parse(handoff?.createdAt || '');
  const fresh = Number.isFinite(createdAt) && Date.now() - createdAt < 15 * 60 * 1000;
  if (!fresh || handoff?.source !== 'recordsDesk') {
    recordsDeskHandoffContext = null;
    try { sessionStorage.removeItem('dynamaxRecordsDeskContext'); } catch (_error) { /* Ignore private storage. */ }
    return null;
  }
  if (handoff.targetSection !== targetSection) return null;
  recordsDeskHandoffContext = null;
  try { sessionStorage.removeItem('dynamaxRecordsDeskContext'); } catch (_error) { /* Ignore private storage. */ }
  return handoff;
}

function recordsDeskHandoffReference(handoff) {
  return clean(
    handoff?.context?.AccountRef ||
    handoff?.context?.ApplicationReference ||
    handoff?.context?.Username ||
    handoff?.context?.MemberId ||
    handoff?.context?.DepartmentId ||
    handoff?.recordId
  );
}

function recordsDeskReferenceKey(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function recordsDeskRowMatches(row, reference, fields) {
  const wanted = recordsDeskReferenceKey(reference);
  return Boolean(wanted && fields.some((field) => recordsDeskReferenceKey(row?.[field]) === wanted));
}

function recordsDeskHandoffBanner(handoff, reference) {
  if (!handoff || !reference) return '';
  return `<div class="records-desk-handoff"><span aria-hidden="true">\u{1F5C2}</span><p><strong>Selected from Records Desk</strong><small>Showing the workflow for ${escapeHtml(reference)}.</small></p></div>`;
}

function bindRecordsDeskEvents() {
  const searchForm = document.getElementById('recordsDeskSearchForm');
  const searchInput = document.getElementById('recordsDeskSearch');
  searchForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    recordsDeskState.query = clean(searchInput?.value);
    window.clearTimeout(recordsDeskSearchTimer);
    searchRecordsDesk({ keepFocus: true });
  });
  searchInput?.addEventListener('input', (event) => {
    recordsDeskState.query = event.currentTarget.value;
    window.clearTimeout(recordsDeskSearchTimer);
    if (clean(recordsDeskState.query).length < 3) {
      recordsDeskAbortController?.abort();
      recordsDeskAbortController = null;
      recordsDeskRequest += 1;
      recordsDeskState.results = [];
      recordsDeskState.totalMatches = 0;
      recordsDeskState.detail = null;
      recordsDeskState.selectedKey = '';
      recordsDeskState.selectedBranchId = '';
      const results = panelEl.querySelector('.records-desk-results');
      if (results) results.innerHTML = '';
      const message = document.getElementById('recordsDeskResultMessage');
      if (message) message.innerHTML = `<p>${clean(recordsDeskState.query) ? 'Enter at least three characters to begin.' : 'Search by name, record number, email, phone or another permitted identifier.'}</p>`;
      renderModuleSummary('recordsDesk', recordsDeskState);
      return;
    }
    recordsDeskSearchTimer = window.setTimeout(() => searchRecordsDesk({ keepFocus: true }), 450);
  });
  document.getElementById('recordsDeskFaceLookup')?.addEventListener('click', () => {
    openRecordsDeskFaceLookup({
      mode: 'lookup',
      onMatch: (match) => loadRecordsDeskDetail('students', match.id, match.branchId)
    });
  });
  panelEl.querySelectorAll('[data-record-filter]').forEach((button) => button.addEventListener('click', () => {
    recordsDeskState.type = button.dataset.recordFilter;
    recordsDeskState.selectedKey = '';
    recordsDeskState.selectedBranchId = '';
    recordsDeskState.detail = null;
    renderRecordsDesk();
    if (clean(recordsDeskState.query).length >= 3) searchRecordsDesk({ keepFocus: true });
  }));
  panelEl.querySelectorAll('.records-desk-result').forEach((button) => button.addEventListener('click', () => {
    loadRecordsDeskDetail(button.dataset.recordType, button.dataset.recordId, button.dataset.recordBranch);
  }));
  document.getElementById('recordsDeskBack')?.addEventListener('click', () => {
    recordsDeskState.selectedKey = '';
    recordsDeskState.selectedBranchId = '';
    recordsDeskState.detail = null;
    recordsDeskState.loadingDetail = false;
    renderRecordsDesk();
  });
  panelEl.querySelectorAll('[data-record-action]').forEach((button) => button.addEventListener('click', () => {
    openRecordsDeskAction(recordsDeskState.detail?.actions?.[Number(button.dataset.recordAction)]);
  }));
}

async function executiveOfficeRequest(action, payload = {}) {
  const response = await staffFetch('/api/staff-correspondence', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload })
  });
  const data = await response.json().catch(() => ({ ok: false, message: 'The executive correspondence service did not return JSON.' }));
  if (response.status === 401) {
    showLogin(data.message || 'Your staff session has expired.', 'bad');
    throw new Error(data.message || 'Your staff session has expired.');
  }
  if (!response.ok || !data.ok) throw new Error(data.message || 'The executive correspondence request failed.');
  return data;
}

function executiveDirectoryTypes() {
  const friendlyLabels = { student: 'Students', staff: 'Staff', class: 'Classes', member: 'Members', department: 'Departments' };
  const supplied = executiveAvailableDirectoryTypes.map((entry) => {
    if (typeof entry === 'string') return { id: entry, label: friendlyLabels[entry] || executiveKindLabel(entry) };
    const id = clean(entry.id || entry.type || entry.key);
    return { id, label: clean(entry.label || entry.name || friendlyLabels[id] || id) };
  }).filter((entry) => entry.id);
  if (supplied.length) return supplied;
  const faith = document.documentElement.dataset.edition === 'church';
  return faith
    ? [{ id: 'member', label: 'Members' }, { id: 'department', label: 'Departments' }, { id: 'staff', label: 'Staff' }]
    : [{ id: 'student', label: 'Students' }, { id: 'staff', label: 'Staff' }, { id: 'class', label: 'Classes' }];
}

function executiveRecordId(row = {}) {
  return clean(pick(row, [
    'id', 'Id', 'recordId', 'RecordId', 'AdmissionNo', 'AccountRef', 'Username',
    'MemberId', 'DepartmentId', 'ClassId', 'ClassName', '__id'
  ]));
}

function executiveRecordName(row = {}) {
  return clean(pick(row, [
    'name', 'Name', 'displayName', 'DisplayName', 'StudentName', 'ApplicantName',
    'MemberName', 'DepartmentName', 'ClassName', 'Username'
  ])) || executiveRecordId(row) || 'Unnamed record';
}

function executiveRecordEmail(row = {}) {
  return clean(pick(row, ['email', 'Email', 'ParentEmail', 'WorkEmail', 'OfficialEmail']));
}

function executiveRecordType(row = {}) {
  return clean(pick(row, ['type', 'Type', 'recordType', 'RecordType'])) || executiveDirectoryType;
}

function executiveRecordMeta(row = {}) {
  const supplied = clean(pick(row, ['subtitle', 'Subtitle']));
  if (supplied) return supplied;
  return [
    pick(row, ['AdmissionNo', 'AccountRef', 'MemberId', 'Username', 'DepartmentId']),
    pick(row, ['ClassName', 'Class', 'Department', 'Position', 'Role']),
    pick(row, ['Phone', 'ParentPhone', 'Status'])
  ].map(clean).filter(Boolean).join(' · ');
}

function executiveClassRows() {
  return (executiveOfficeData?.classes || []).map((row) => {
    if (typeof row === 'string') return { type: 'class', ClassName: row, id: row, name: row };
    return { type: 'class', ...row };
  });
}

function executiveCorrespondenceRows() {
  return executiveOfficeData?.correspondence || executiveOfficeData?.records || [];
}

function executiveTemplateRows() {
  return executiveOfficeData?.templates || [];
}

function executiveCorrespondenceId(row = {}) {
  return clean(pick(row, ['correspondenceId', 'CorrespondenceId', 'id', 'Id', '__id']));
}

function executiveCorrespondenceStatus(row = {}) {
  return clean(pick(row, ['status', 'Status'])) || 'Draft';
}

function executiveCorrespondenceKind(row = {}) {
  return clean(pick(row, ['kind', 'Kind', 'documentType', 'DocumentType'])) || 'official-letter';
}

function executiveKindLabel(value) {
  const normalized = clean(value).replace(/[_-]+/g, ' ');
  return normalized.replace(/\b\w/g, (letter) => letter.toUpperCase()) || 'Official Letter';
}

function executiveKindOptions() {
  const supplied = executiveOfficeData?.kinds || [];
  const rows = supplied.map((entry) => {
    if (typeof entry === 'string') return { id: entry, label: executiveKindLabel(entry) };
    return { id: clean(entry.id || entry.key || entry.value), label: clean(entry.label || entry.name || executiveKindLabel(entry.id)) };
  }).filter((entry) => entry.id);
  if (rows.length) return rows;
  const standard = [
    ['official-letter', 'Official Letter'],
    ['recommendation', 'Recommendation Letter'],
    ['attestation', 'Attestation / Confirmation'],
    ['external-agency', 'Ministry / Agency Letter']
  ];
  if (document.documentElement.dataset.edition !== 'church') standard.splice(1, 0, ['transfer-certificate', 'Transfer Certificate']);
  return standard.map(([id, label]) => ({ id, label }));
}

function executiveTemplateId(row = {}) {
  return clean(pick(row, ['templateId', 'TemplateId', 'id', 'Id', '__id']));
}

function executiveTemplateName(row = {}) {
  return clean(pick(row, ['name', 'Name', 'templateName', 'TemplateName', 'title', 'Title'])) || executiveKindLabel(executiveCorrespondenceKind(row));
}

function executiveTemplateToken(value) {
  const token = clean(typeof value === 'string' ? value : value?.token || value?.id);
  if (!token) return '';
  return token.startsWith('{{') ? token : `{{${token}}}`;
}

function executiveDraftToken(draft = {}, key = '') {
  const values = pick(draft, ['TokenValues', 'tokenValues']) || {};
  return clean(values?.[key] || executiveSelectedRecipient?.tokenValues?.[key]);
}

function executiveEditableTemplateBody(row = {}) {
  const body = clean(pick(row, ['bodyTemplate', 'BodyTemplate', 'body', 'Body', 'bodyText', 'BodyText']));
  const letterBody = executiveDraftToken(row, 'LETTER_BODY');
  return body.replace(/\{\{LETTER_BODY\}\}/gi, letterBody && letterBody !== body ? letterBody : '');
}

function executiveComposerTokens() {
  return (executiveOfficeData?.tokens || []).filter((token) => executiveTemplateToken(token) !== '{{LETTER_BODY}}');
}

function executiveMetricCharts() {
  const selected = new Set(executiveSelectedMetricIds());
  return executiveMetricCatalog()
    .filter((metric) => selected.has(metric.id) && Array.isArray(metric.series) && metric.series.length)
    .map((metric, index) => {
      const rows = metric.series.map((point) => {
        if (typeof point === 'number') return { Label: '', Value: point };
        return {
          Label: clean(point.label || point.name || point.period || point.category || point.x),
          Value: Number(point.value ?? point.total ?? point.count ?? point.y ?? 0)
        };
      });
      return verticalBars(metric.label, rows, 'Label', 'Value', ['blue', 'emerald', 'purple', 'gold', 'coral'][index % 5]);
    });
}

function renderExecutiveOverview() {
  const charts = executiveMetricCharts();
  const records = executiveCorrespondenceRows();
  const recent = records.slice(0, 5);
  const canManageStaff = currentUser?.role === 'Super Admin' && activeTabs.some(([key]) => key === 'staffUsers');
  return `
    <section class="executive-overview-grid">
      <article class="executive-hero-card">
        <div><small>Selected intelligence</small><h3>Your executive summary</h3><p>Choose only the approved statistics and charts that matter to your office. The server limits the available choices to information this account may access.</p></div>
        <button type="button" class="compact-action" data-executive-metrics>Configure summary</button>
      </article>
      <article class="executive-quick-card">
        <small>Official communication</small><h3>Prepare correspondence</h3><p>Issue branded letters, certificates and external communications with a traceable reference.</p>
        <button type="button" data-executive-open="compose">Compose document</button>
      </article>
      <article class="executive-quick-card">
        <small>People and structure</small><h3>Search the directory</h3><p>Find a permitted student, member, staff account, class or department without changing its source record.</p>
        <div class="compact-row-actions"><button type="button" class="secondary" data-executive-open="directory">Open directory</button>${canManageStaff ? '<button type="button" data-executive-manage-staff>Manage staff accounts</button>' : ''}</div>
      </article>
    </section>
    <section class="department-chart-grid executive-chart-grid">
      ${charts.length ? charts.join('') : `<article class="department-chart-card executive-empty-chart"><span aria-hidden="true">&#128202;</span><h3>No chart selected</h3><p class="muted">Use “Configure summary” to add any available graphical summaries.</p></article>`}
    </section>
    <section class="executive-recent">
      <div class="department-panel-heading"><div><small>Correspondence register</small><h3>Recent activity</h3></div><button type="button" class="secondary compact-action" data-executive-open="register">View all</button></div>
      ${recent.length ? `<div class="executive-register-list">${recent.map(executiveRegisterRow).join('')}</div>` : '<p class="muted">No official correspondence has been recorded yet.</p>'}
    </section>
    <dialog id="executiveMetricsDialog" class="workflow-dialog executive-metrics-dialog">
      <div class="workflow-dialog-header"><div><small>Executive dashboard</small><h2>Choose summary cards and charts</h2></div><button type="button" data-close-executive-metrics aria-label="Close">&times;</button></div>
      <form id="executiveMetricsForm" class="workflow-form">
        <p class="muted">Selections are drawn only from the information this account is authorised to view.</p>
        <div class="executive-metric-picker">${executiveMetricCatalog().map((metric) => `<label class="check-row"><input type="checkbox" name="metricId" value="${escapeHtml(metric.id)}"${executiveSelectedMetricIds().includes(metric.id) ? ' checked' : ''}><span><strong>${escapeHtml(metric.label)}</strong><small>${escapeHtml(metric.note || (metric.series?.length ? 'Includes a chart' : 'Summary card'))}</small></span></label>`).join('') || '<p class="muted">No configurable metrics are available for this account yet.</p>'}</div>
        <div class="executive-form-actions"><button type="submit">Save dashboard</button><p id="executiveMetricsStatus" class="status"></p></div>
      </form>
    </dialog>`;
}

function renderExecutiveDirectory() {
  const types = executiveDirectoryTypes();
  if (!executiveDirectoryType || !types.some((type) => type.id === executiveDirectoryType)) executiveDirectoryType = types[0]?.id || '';
  const classMode = /class/i.test(executiveDirectoryType);
  const rows = classMode && !executiveDirectoryQuery ? executiveClassRows() : executiveDirectoryResults;
  return `
    <section class="executive-directory-layout">
      <aside class="executive-directory-filters">
        <small>Read-only directory</small><h3>Find a record</h3>
        <div class="executive-directory-types">${types.map((type) => `<button type="button" class="${type.id === executiveDirectoryType ? 'active' : ''}" data-executive-directory-type="${escapeHtml(type.id)}"><span aria-hidden="true">${escapeHtml(tabIcons[type.id] || '\u{1F465}')}</span>${escapeHtml(type.label)}</button>`).join('')}</div>
        <p><span aria-hidden="true">&#128737;</span> Directory access follows your edition, branch and assigned school-section permissions.</p>
      </aside>
      <div class="executive-directory-main">
        <form id="executiveDirectorySearch" class="executive-directory-search" role="search">
          <label>Search ${escapeHtml(types.find((type) => type.id === executiveDirectoryType)?.label || 'directory')}
            <span><input name="query" value="${escapeHtml(executiveDirectoryQuery)}" placeholder="Name, ID, email, phone or class"><button type="submit">Search</button></span>
          </label>
        </form>
        <p id="executiveDirectoryStatus" class="status"></p>
        <div class="executive-directory-results">
          ${rows.length ? rows.map((row) => `
            <article class="executive-directory-record">
              <span class="executive-record-avatar">${escapeHtml(executiveRecordName(row).split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase())}</span>
              <div><strong>${escapeHtml(executiveRecordName(row))}</strong><small>${escapeHtml(executiveRecordMeta(row) || executiveRecordId(row))}</small>${executiveRecordEmail(row) ? `<a href="mailto:${escapeHtml(executiveRecordEmail(row))}">${escapeHtml(executiveRecordEmail(row))}</a>` : ''}</div>
              <button type="button" class="secondary compact-action" data-executive-recipient="${escapeHtml(executiveRecordId(row))}">Write</button>
            </article>`).join('') : `<div class="executive-directory-empty"><span aria-hidden="true">&#128269;</span><p>${executiveDirectoryQuery ? 'No permitted records matched this search.' : 'Search to display permitted records here.'}</p></div>`}
        </div>
      </div>
    </section>`;
}

function renderExecutiveTemplates() {
  const templates = executiveTemplateRows();
  return `
    <div class="department-panel-heading"><div><small>Reusable communication</small><h3>Template library</h3></div><p>Start from an approved template, then personalise its recipient and message.</p></div>
    <div class="executive-template-grid">
      ${templates.length ? templates.map((row) => `
        <article class="executive-template-card">
          <span aria-hidden="true">${escapeHtml(tabIcons.executiveOffice)}</span>
          <small>${escapeHtml(executiveKindLabel(executiveCorrespondenceKind(row)))}</small>
          <h3>${escapeHtml(executiveTemplateName(row))}</h3>
          <p>${escapeHtml(clean(pick(row, ['subjectTemplate', 'SubjectTemplate', 'subject', 'Subject'])) || clean(pick(row, ['bodyTemplate', 'BodyTemplate', 'body', 'Body'])).slice(0, 120) || 'Reusable official correspondence')}</p>
          <button type="button" data-use-executive-template="${escapeHtml(executiveTemplateId(row))}">Use template</button>
        </article>`).join('') : '<div class="executive-directory-empty"><span aria-hidden="true">&#128196;</span><p>No saved template yet. Compose a document and save it as a template.</p></div>'}
    </div>
    <aside class="executive-token-guide"><strong>Available merge fields</strong><p>${executiveComposerTokens().map((token) => `<code>${escapeHtml(executiveTemplateToken(token))}</code>`).join(' ') || '<span class="muted">Merge fields will be supplied by the server for your edition.</span>'}</p></aside>`;
}

function executiveSelectedRecipientMarkup() {
  if (!executiveSelectedRecipient) return '<p class="muted">No directory record selected. Choose one from the Directory or use an external recipient.</p>';
  return `<div class="executive-selected-recipient"><span aria-hidden="true">&#10003;</span><div><strong>${escapeHtml(executiveRecordName(executiveSelectedRecipient))}</strong><small>${escapeHtml(executiveRecordMeta(executiveSelectedRecipient))}</small></div><button type="button" class="secondary compact-icon-action" data-clear-executive-recipient aria-label="Remove selected recipient">&times;</button></div>`;
}

function renderExecutiveComposer(draft = null) {
  const templateId = clean(pick(draft || {}, ['templateId', 'TemplateId']));
  const selectedId = executiveRecordId(executiveSelectedRecipient || {});
  const selectedType = executiveRecordType(executiveSelectedRecipient || {});
  return `
    <div class="department-panel-heading"><div><small>Official correspondence</small><h3>Compose document</h3></div><p>Draft freely; issuing or sending requires your current password and creates an auditable record.</p></div>
    <form id="executiveComposerForm" class="workflow-form executive-composer">
      <input type="hidden" name="correspondenceId" value="${escapeHtml(executiveCorrespondenceId(draft || {}))}">
      <input type="hidden" name="recipientId" value="${escapeHtml(selectedId || pick(draft || {}, ['recipientId', 'RecipientId']))}">
      <input type="hidden" name="recipientType" value="${escapeHtml(selectedType || pick(draft || {}, ['recipientType', 'RecipientType']))}">
      <section class="executive-compose-card">
        <header><span>01</span><div><strong>Document</strong><small>Choose a document type and optional template.</small></div></header>
        <div class="executive-compose-grid">
          <label>Document type<select name="kind" required>${executiveKindOptions().map((entry) => `<option value="${escapeHtml(entry.id)}"${entry.id === executiveCorrespondenceKind(draft || {}) ? ' selected' : ''}>${escapeHtml(entry.label)}</option>`).join('')}</select></label>
          <label>Template<select name="templateId"><option value="">Start without a template</option>${executiveTemplateRows().map((row) => `<option value="${escapeHtml(executiveTemplateId(row))}"${executiveTemplateId(row) === templateId ? ' selected' : ''}>${escapeHtml(executiveTemplateName(row))}</option>`).join('')}</select></label>
          <label>Template name <input name="templateName" value="${escapeHtml(executiveTemplateName(draft || {}) === executiveKindLabel(executiveCorrespondenceKind(draft || {})) ? '' : executiveTemplateName(draft || {}))}" placeholder="Only needed when saving as a template"></label>
        </div>
      </section>
      <section class="executive-compose-card">
        <header><span>02</span><div><strong>Recipient</strong><small>Select a permitted directory record or address an external organisation.</small></div></header>
        <div class="executive-recipient-mode">
          <label class="check-row"><input type="radio" name="recipientMode" value="directory"${selectedId ? ' checked' : ''}> Directory recipient</label>
          <label class="check-row"><input type="radio" name="recipientMode" value="external"${selectedId ? '' : ' checked'}> External / manual recipient</label>
        </div>
        <div data-executive-directory-recipient>${executiveSelectedRecipientMarkup()}<label class="executive-directory-email">Delivery email <input type="email" name="directoryRecipientEmail" value="${escapeHtml(executiveRecordEmail(executiveSelectedRecipient || {}) || pick(draft || {}, ['recipientEmail', 'RecipientEmail']))}" placeholder="Email used when this document is sent"></label><button type="button" class="secondary compact-action" data-executive-open="directory">Search directory</button></div>
        <div class="executive-compose-grid" data-executive-external-recipient>
          <label>Recipient name <input name="recipientName" value="${escapeHtml(pick(draft || {}, ['recipientName', 'RecipientName']))}"></label>
          <label>Organisation / ministry <input name="recipientOrganisation" value="${escapeHtml(pick(draft || {}, ['recipientOrganisation', 'RecipientOrganisation']))}"></label>
          <label>Email <input type="email" name="recipientEmail" value="${escapeHtml(pick(draft || {}, ['recipientEmail', 'RecipientEmail']))}"></label>
          <label class="executive-span-two">Postal address<textarea name="recipientAddress" rows="2">${escapeHtml(pick(draft || {}, ['recipientAddress', 'RecipientAddress']))}</textarea></label>
        </div>
      </section>
      <section class="executive-compose-card">
        <header><span>03</span><div><strong>Message</strong><small>Use the available merge fields where a template should insert official data.</small></div></header>
        <label>Subject <input name="subject" required value="${escapeHtml(pick(draft || {}, ['subjectTemplate', 'SubjectTemplate', 'subject', 'Subject']))}" placeholder="Subject of the official communication"></label>
        <label>Letter body <textarea name="body" rows="12" required placeholder="Write the official communication here.">${escapeHtml(executiveEditableTemplateBody(draft || {}))}</textarea></label>
        <div class="executive-token-strip">${executiveComposerTokens().map((token) => `<button type="button" class="secondary" data-insert-executive-token="${escapeHtml(executiveTemplateToken(token))}">${escapeHtml(executiveTemplateToken(token))}</button>`).join('')}</div>
      </section>
      <section class="executive-compose-card executive-transfer-fields" data-executive-transfer-fields hidden>
        <header><span>TC</span><div><strong>Transfer certificate details</strong><small>These fields supplement the selected student's official record.</small></div></header>
        <div class="executive-compose-grid">
          <label>Date admitted <input type="date" name="admissionDate" value="${escapeHtml(pick(draft || {}, ['admissionDate', 'AdmissionDate']) || executiveDraftToken(draft || {}, 'ADMISSION_DATE'))}"></label>
          <label>Date leaving <input type="date" name="leavingDate" value="${escapeHtml(pick(draft || {}, ['leavingDate', 'LeavingDate']) || executiveDraftToken(draft || {}, 'LEAVING_DATE'))}"></label>
          <label>Last class attended <input name="lastClass" value="${escapeHtml(pick(draft || {}, ['lastClass', 'LastClass']) || executiveDraftToken(draft || {}, 'CLASS'))}"></label>
          <label>Conduct <input name="conduct" value="${escapeHtml(pick(draft || {}, ['conduct', 'Conduct']) || executiveDraftToken(draft || {}, 'CONDUCT'))}"></label>
          <label class="executive-span-two">Reason for leaving <input name="reasonForLeaving" value="${escapeHtml(pick(draft || {}, ['reasonForLeaving', 'ReasonForLeaving']) || executiveDraftToken(draft || {}, 'REASON'))}"></label>
          <label class="executive-span-two">Transferring to <input name="transferTo" value="${escapeHtml(pick(draft || {}, ['transferTo', 'TransferTo']) || executiveDraftToken(draft || {}, 'DESTINATION'))}"></label>
        </div>
      </section>
      <section class="executive-compose-card executive-authorization-card">
        <header><span>04</span><div><strong>Issue and delivery</strong><small>Your saved signature and stamp remain optional for each document.</small></div></header>
        <div class="executive-endorsement-row">
          <label class="check-row"><input type="checkbox" name="applySignature"${yes(pick(draft || {}, ['applySignature', 'ApplySignature', 'SignatureApplied'])) || yes(executiveOfficeData?.approvalProfile?.ApplySignatureOnApproval) ? ' checked' : ''}> Apply my signature</label>
          <label class="check-row"><input type="checkbox" name="applyStamp"${yes(pick(draft || {}, ['applyStamp', 'ApplyStamp', 'StampApplied'])) || yes(executiveOfficeData?.approvalProfile?.ApplyStampOnApproval) ? ' checked' : ''}> Apply official stamp</label>
        </div>
        <label class="executive-password-confirm">Current password <input type="password" name="approvalPassword" autocomplete="current-password"><small>Required only when issuing or sending.</small></label>
        <div class="executive-form-actions">
          <button type="submit" class="secondary" data-correspondence-action="saveDraft">Save draft</button>
          <button type="button" class="secondary" data-save-executive-template>Save as template</button>
          <button type="button" class="secondary" data-preview-executive>Print preview</button>
          <button type="submit" data-correspondence-action="issue">Issue document</button>
          <button type="submit" data-correspondence-action="send">Issue &amp; send</button>
        </div>
        <p id="executiveComposerStatus" class="status" aria-live="polite"></p>
      </section>
    </form>`;
}

function executiveRegisterRow(row) {
  const id = executiveCorrespondenceId(row);
  const status = executiveCorrespondenceStatus(row);
  const recipient = clean(pick(row, ['recipientName', 'RecipientName', 'recipientOrganisation', 'RecipientOrganisation'])) || 'Not specified';
  const date = clean(pick(row, ['sentAt', 'SentAt', 'issuedAt', 'IssuedAt', 'updatedAt', 'UpdatedAt', 'createdAt', 'CreatedAt']));
  return `<article class="executive-register-row">
    <div class="executive-reference"><strong>${escapeHtml(pick(row, ['reference', 'Reference']) || id)}</strong><small>${escapeHtml(executiveKindLabel(executiveCorrespondenceKind(row)))}</small></div>
    <div><strong>${escapeHtml(pick(row, ['subject', 'Subject']) || 'Untitled correspondence')}</strong><small>${escapeHtml(recipient)}</small></div>
    <time>${escapeHtml(date ? date.slice(0, 10) : '')}</time>
    <span class="workflow-status status-${escapeHtml(status.toLowerCase().replace(/[^a-z]+/g, '-'))}">${escapeHtml(status)}</span>
    <div class="compact-row-actions">
      ${/draft/i.test(status) ? `<button type="button" class="compact-icon-action compact-edit-action" data-edit-executive="${escapeHtml(id)}" aria-label="Edit draft" title="Edit draft">&#9998;</button>` : ''}
      ${/^issued$/i.test(status) ? `<button type="button" class="compact-icon-action executive-send-action" data-send-executive="${escapeHtml(id)}" aria-label="Send issued document" title="Send issued document"><span aria-hidden="true">&#9993;</span></button>` : ''}
      <button type="button" class="compact-icon-action executive-print-action" data-print-executive="${escapeHtml(id)}" aria-label="View and print" title="View and print"><span aria-hidden="true">&#128424;&#65038;</span></button>
    </div>
  </article>`;
}

function executiveSendDialogMarkup() {
  return `<dialog id="executiveSendDialog" class="workflow-dialog executive-send-dialog">
    <div class="workflow-dialog-header"><div><small>Secure delivery</small><h2>Send issued document</h2></div><button type="button" data-close-executive-send aria-label="Close">&times;</button></div>
    <form id="executiveSendForm" class="workflow-form">
      <input type="hidden" name="correspondenceId">
      <label>Recipient email <input type="email" name="recipientEmail" required></label>
      <label>Current password <input type="password" name="approvalPassword" autocomplete="current-password" required></label>
      <div class="executive-form-actions"><button type="submit">Send document</button><p id="executiveSendStatus" class="status"></p></div>
    </form>
  </dialog>`;
}

function renderExecutiveRegister() {
  const records = executiveCorrespondenceRows();
  return `
    <div class="department-panel-heading"><div><small>Audit trail</small><h3>Correspondence register</h3></div><p>Every saved, issued and sent document remains traceable by its official reference and status.</p></div>
    <div class="executive-register-toolbar"><span>${records.length.toLocaleString()} record${records.length === 1 ? '' : 's'}</span><button type="button" data-executive-open="compose">New correspondence</button></div>
    <div class="executive-register-list">${records.length ? records.map(executiveRegisterRow).join('') : '<p class="muted">No correspondence has been recorded yet.</p>'}</div>`;
}

function renderExecutiveOffice(draft = null) {
  if (activeSection !== 'executiveOffice' || !executiveOfficeData) return;
  const tabs = [
    ['overview', '\u{1F4CA}', 'Overview'],
    ['directory', '\u{1F50D}', 'Directory'],
    ['templates', '\u{1F4C4}', 'Templates'],
    ['compose', '\u270E', 'Compose'],
    ['register', '\u{1F5C2}', 'Register']
  ];
  const body = executiveOfficeTab === 'directory' ? renderExecutiveDirectory()
    : executiveOfficeTab === 'templates' ? renderExecutiveTemplates()
      : executiveOfficeTab === 'compose' ? renderExecutiveComposer(draft)
        : executiveOfficeTab === 'register' ? renderExecutiveRegister()
          : renderExecutiveOverview();
  panelEl.innerHTML = `
    <div class="workflow-intro executive-office-intro">
      <div><p class="eyebrow">Leadership and official communication</p><h2>${escapeHtml(executiveOfficeTitle())}</h2><p class="muted">Authorised insight, directories, branded documents and a complete correspondence history.</p></div>
      <button type="button" class="compact-action secondary" id="refreshExecutiveOffice" aria-label="Refresh executive office">&#8635; Refresh</button>
    </div>
    <nav class="executive-workspace-tabs" aria-label="${escapeHtml(executiveOfficeTitle())} sections">${tabs.map(([key, icon, label]) => `<button type="button" data-executive-tab="${key}" class="${executiveOfficeTab === key ? 'active' : ''}" aria-selected="${executiveOfficeTab === key}"><span aria-hidden="true">${icon}</span>${label}</button>`).join('')}</nav>
    <div class="executive-workspace-panel">${body}</div>
    ${executiveSendDialogMarkup()}`;
  bindExecutiveOfficeEvents();
}

function switchExecutiveOfficeTab(tab, draft = null) {
  if (!['overview', 'directory', 'templates', 'compose', 'register'].includes(tab)) return;
  executiveOfficeTab = tab;
  try { window.localStorage.setItem(workspaceViewStorageKey('executiveOffice'), tab); } catch (_error) { /* optional */ }
  const url = new URL(window.location.href);
  url.searchParams.set('section', 'executiveOffice');
  url.searchParams.set('view', tab);
  window.history.replaceState(window.history.state, '', url);
  renderExecutiveOffice(draft);
  panelEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function executiveComposerPayload(form) {
  const payload = Object.fromEntries(new FormData(form).entries());
  payload.applySignature = form.elements.applySignature.checked;
  payload.applyStamp = form.elements.applyStamp.checked;
  payload.SubjectTemplate = payload.subject;
  payload.BodyTemplate = payload.body;
  payload.Name = payload.templateName;
  payload.Kind = payload.kind;
  payload.TokenValues = {
    ...(executiveSelectedRecipient?.tokenValues || {}),
    SUBJECT: payload.subject,
    LETTER_BODY: '',
    ADMISSION_DATE: payload.admissionDate,
    LEAVING_DATE: payload.leavingDate,
    CLASS: payload.lastClass,
    REASON: payload.reasonForLeaving,
    CONDUCT: payload.conduct,
    DESTINATION: payload.transferTo
  };
  if (payload.recipientMode === 'directory' && executiveSelectedRecipient) {
    payload.recipientId = executiveRecordId(executiveSelectedRecipient);
    payload.recipientType = executiveRecordType(executiveSelectedRecipient);
    payload.recipientName = executiveRecordName(executiveSelectedRecipient);
    payload.recipientEmail = clean(payload.directoryRecipientEmail) || executiveRecordEmail(executiveSelectedRecipient);
    payload.recipientOrganisation = clean(pick(executiveSelectedRecipient, ['Organisation', 'Organization', 'DepartmentName']));
    payload.recipientAddress = clean(pick(executiveSelectedRecipient, ['address', 'Address', 'PostalAddress', 'ResidentialAddress']));
  } else if (payload.recipientMode === 'external') {
    payload.recipientType = 'custom';
    payload.recipientId = '';
  }
  return payload;
}

function safeExecutiveImage(value) {
  const source = clean(value);
  return /^(?:https?:\/\/|data:image\/(?:png|jpeg|webp);base64,|\/|images\/)/i.test(source) ? source : '';
}

function openExecutivePrint(record = {}, printable = {}, targetWindow = null) {
  const printableWindow = targetWindow || window.open('', '_blank', 'width=960,height=760');
  if (!printableWindow) throw new Error('Allow pop-ups to view and print this document.');
  printableWindow.opener = null;
  printableWindow.document.open();
  if (clean(printable.html)) {
    const printControl = '<button class="executive-print-control" type="button" onclick="window.print()">Print / Save as PDF</button>';
    const printStyle = '<style>.executive-print-control{position:fixed;z-index:20;top:12px;right:12px;width:auto;padding:10px 14px;border:0;border-radius:7px;background:#1769e0;color:#fff;font:bold 12px Arial;cursor:pointer}@media print{.executive-print-control{display:none}}</style>';
    const brandedHtml = String(printable.html)
      .replace('</head>', `${printStyle}</head>`)
      .replace('</body>', `${printControl}</body>`);
    printableWindow.document.write(brandedHtml);
    printableWindow.document.close();
    return;
  }
  const organisation = clean(document.querySelector('[data-school-name]')?.textContent) || 'Dynamax';
  const reference = clean(printable.reference || pick(record, ['reference', 'Reference', 'correspondenceId', 'CorrespondenceId'])) || 'PREVIEW';
  const subject = clean(printable.title || pick(record, ['subject', 'Subject'])) || 'Official correspondence';
  const recipient = clean(pick(record, ['recipientName', 'RecipientName', 'recipientOrganisation', 'RecipientOrganisation']));
  const body = clean(printable.text || pick(record, ['body', 'Body', 'bodyText', 'BodyText']));
  const status = executiveCorrespondenceStatus(record);
  const logo = safeExecutiveImage(document.querySelector('.nav-logo')?.getAttribute('src') || 'images/Logo.png');
  const signature = yes(pick(record, ['applySignature', 'ApplySignature']))
    ? safeExecutiveImage(pick(record, ['signatureUrl', 'SignatureUrl']) || executiveOfficeData?.approvalProfile?.SignatureDataUrl)
    : '';
  const stamp = yes(pick(record, ['applyStamp', 'ApplyStamp']))
    ? safeExecutiveImage(pick(record, ['stampUrl', 'StampUrl']) || executiveOfficeData?.approvalProfile?.StampDataUrl)
    : '';
  const filename = clean(printable.filename || `${reference}.pdf`);
  printableWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(filename)}</title><style>
    @page{size:A4;margin:18mm}*{box-sizing:border-box}body{margin:0;color:#18324d;font:15px/1.65 Georgia,serif}.sheet{position:relative;min-height:250mm;padding:10mm;border:1px solid #c9d8e7;background:#fff;overflow:hidden}.watermark{position:absolute;inset:25% 25%;width:50%;height:50%;object-fit:contain;opacity:.045}.letterhead{position:relative;display:flex;align-items:center;gap:16px;padding:0 0 17px;border-bottom:4px solid #0c8b78}.letterhead img{width:68px;height:68px;object-fit:contain}.letterhead h1{margin:0;color:#123f6d;font:700 25px/1.2 Arial,sans-serif}.letterhead p{margin:4px 0 0;color:#61758a;font:12px Arial,sans-serif}.meta{display:flex;justify-content:space-between;gap:20px;margin:22px 0;color:#587087;font:12px Arial,sans-serif}.subject{margin:24px 0 18px;color:#123f6d;font:700 19px Arial,sans-serif}.recipient{margin-bottom:18px}.body{position:relative;min-height:330px;white-space:pre-wrap}.endorsements{display:flex;gap:50px;margin-top:40px}.endorsement{min-width:210px;padding-top:8px;border-top:1px solid #8499ad;font:12px Arial,sans-serif}.endorsement img{display:block;max-width:150px;max-height:70px;object-fit:contain;margin:-65px 0 4px}.footer{position:absolute;right:10mm;bottom:8mm;left:10mm;display:flex;justify-content:space-between;border-top:1px solid #d6e1ec;padding-top:8px;color:#71869a;font:10px Arial,sans-serif}.print{position:fixed;top:12px;right:12px;padding:10px 14px;border:0;border-radius:7px;background:#1769e0;color:white;font:bold 12px Arial;cursor:pointer}@media print{.print{display:none}.sheet{border:0;padding:0;min-height:auto}}</style></head><body><button class="print" onclick="window.print()">Print / Save as PDF</button><main class="sheet">${logo ? `<img class="watermark" src="${escapeHtml(logo)}" alt="">` : ''}<header class="letterhead">${logo ? `<img src="${escapeHtml(logo)}" alt="">` : ''}<div><h1>${escapeHtml(organisation)}</h1><p>${escapeHtml(executiveOfficeTitle())} · Official communication</p></div></header><div class="meta"><span>Reference: <strong>${escapeHtml(reference)}</strong></span><span>Status: <strong>${escapeHtml(status)}</strong></span></div>${recipient ? `<div class="recipient">To:<br><strong>${escapeHtml(recipient)}</strong></div>` : ''}<h2 class="subject">${escapeHtml(subject)}</h2><div class="body">${escapeHtml(body)}</div><div class="endorsements">${signature ? `<div class="endorsement"><img src="${escapeHtml(signature)}" alt=""><strong>${escapeHtml(currentUser?.displayName || currentUser?.username || '')}</strong><br>${escapeHtml(currentUser?.role || '')}</div>` : ''}${stamp ? `<div class="endorsement"><img src="${escapeHtml(stamp)}" alt="Official stamp"><strong>Official stamp</strong></div>` : ''}</div><footer class="footer"><span>Generated by Dynamax</span><span>${escapeHtml(new Date().toLocaleString())}</span></footer></main></body></html>`);
  printableWindow.document.close();
}

function updateExecutiveComposerVisibility() {
  const form = document.getElementById('executiveComposerForm');
  if (!form) return;
  const external = form.elements.recipientMode.value === 'external';
  form.querySelector('[data-executive-directory-recipient]').hidden = external;
  form.querySelector('[data-executive-external-recipient]').hidden = !external;
  form.querySelector('[data-executive-transfer-fields]').hidden = form.elements.kind.value !== 'transfer-certificate';
}

function openExecutiveSendDialog(correspondenceId) {
  const id = clean(correspondenceId);
  const row = executiveCorrespondenceRows().find((item) => executiveCorrespondenceId(item) === id);
  const dialog = document.getElementById('executiveSendDialog');
  const form = document.getElementById('executiveSendForm');
  if (!row || !dialog || !form) {
    setStatus(dashboardStatus, 'The email form could not be opened. Refresh this workspace and try again.', 'bad');
    return;
  }
  form.reset();
  form.elements.correspondenceId.value = executiveCorrespondenceId(row);
  form.elements.recipientEmail.value = clean(pick(row, ['RecipientEmail', 'recipientEmail']));
  setStatus(document.getElementById('executiveSendStatus'), '');
  if (typeof dialog.showModal === 'function') {
    if (!dialog.open) dialog.showModal();
  } else {
    dialog.setAttribute('open', '');
  }
  window.requestAnimationFrame(() => form.elements.recipientEmail.focus());
}

async function searchExecutiveDirectory() {
  const status = document.getElementById('executiveDirectoryStatus');
  setStatus(status, 'Searching permitted records...');
  try {
    const data = await executiveOfficeRequest('search', { query: executiveDirectoryQuery, type: executiveDirectoryType });
    executiveDirectoryResults = data.results || [];
    executiveAvailableDirectoryTypes = data.availableTypes || executiveAvailableDirectoryTypes;
    if (activeSection === 'executiveOffice' && executiveOfficeTab === 'directory') {
      renderExecutiveOffice();
      setStatus(document.getElementById('executiveDirectoryStatus'), `${executiveDirectoryResults.length} permitted record${executiveDirectoryResults.length === 1 ? '' : 's'} found.`, 'ok');
    }
  } catch (error) {
    setStatus(status, error.message || String(error), 'bad');
  }
}

function bindExecutiveOfficeEvents() {
  document.getElementById('refreshExecutiveOffice')?.addEventListener('click', (event) => {
    runButtonAction(event.currentTarget, 'Refreshing...', loadExecutiveOffice);
  });
  panelEl.querySelectorAll('[data-executive-tab]').forEach((button) => button.addEventListener('click', () => switchExecutiveOfficeTab(button.dataset.executiveTab)));
  panelEl.querySelectorAll('[data-executive-open]').forEach((button) => button.addEventListener('click', () => {
    if (button.dataset.executiveOpen === 'compose') executiveSelectedRecipient = null;
    switchExecutiveOfficeTab(button.dataset.executiveOpen);
  }));
  panelEl.querySelector('[data-executive-manage-staff]')?.addEventListener('click', () => selectSection('staffUsers'));
  document.querySelector('[data-executive-metrics]')?.addEventListener('click', () => document.getElementById('executiveMetricsDialog')?.showModal());
  document.querySelector('[data-close-executive-metrics]')?.addEventListener('click', () => document.getElementById('executiveMetricsDialog')?.close());
  document.getElementById('executiveMetricsForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const metricIds = Array.from(form.querySelectorAll('[name="metricId"]:checked')).map((input) => input.value);
    setButtonLoading(button, true, 'Saving...', 'Save dashboard');
    try {
      const data = await executiveOfficeRequest('savePreferences', { metricIds });
      executiveOfficeData = { ...executiveOfficeData, ...data, metricPreferences: data.metricPreferences || { metricIds } };
      renderModuleSummary('executiveOffice', executiveOfficeData);
      renderExecutiveOffice();
    } catch (error) {
      setStatus(document.getElementById('executiveMetricsStatus'), error.message || String(error), 'bad');
      setButtonLoading(button, false, 'Saving...', 'Save dashboard');
    }
  });
  document.getElementById('executiveDirectorySearch')?.addEventListener('submit', (event) => {
    event.preventDefault();
    executiveDirectoryQuery = clean(new FormData(event.currentTarget).get('query'));
    searchExecutiveDirectory();
  });
  panelEl.querySelectorAll('[data-executive-directory-type]').forEach((button) => button.addEventListener('click', () => {
    executiveDirectoryType = button.dataset.executiveDirectoryType;
    executiveDirectoryQuery = '';
    executiveDirectoryResults = [];
    renderExecutiveOffice();
  }));
  panelEl.querySelectorAll('[data-executive-recipient]').forEach((button) => button.addEventListener('click', () => {
    const rows = /class/i.test(executiveDirectoryType) && !executiveDirectoryQuery ? executiveClassRows() : executiveDirectoryResults;
    executiveSelectedRecipient = rows.find((row) => executiveRecordId(row) === button.dataset.executiveRecipient) || null;
    switchExecutiveOfficeTab('compose');
  }));
  panelEl.querySelectorAll('[data-use-executive-template]').forEach((button) => button.addEventListener('click', () => {
    const template = executiveTemplateRows().find((row) => executiveTemplateId(row) === button.dataset.useExecutiveTemplate);
    executiveSelectedRecipient = null;
    switchExecutiveOfficeTab('compose', template || null);
  }));
  panelEl.querySelectorAll('[data-edit-executive]').forEach((button) => button.addEventListener('click', () => {
    const draft = executiveCorrespondenceRows().find((row) => executiveCorrespondenceId(row) === button.dataset.editExecutive);
    executiveSelectedRecipient = draft && clean(pick(draft, ['RecipientType', 'recipientType'])) !== 'custom'
      ? {
        id: pick(draft, ['RecipientId', 'recipientId']),
        type: pick(draft, ['RecipientType', 'recipientType']),
        name: pick(draft, ['RecipientName', 'recipientName']),
        email: pick(draft, ['RecipientEmail', 'recipientEmail']),
        address: pick(draft, ['RecipientAddress', 'recipientAddress']),
        tokenValues: pick(draft, ['TokenValues', 'tokenValues']) || {}
      }
      : null;
    switchExecutiveOfficeTab('compose', draft || null);
  }));
  panelEl.querySelectorAll('[data-print-executive]').forEach((button) => button.addEventListener('click', async () => {
    const original = button.innerHTML;
    const printableWindow = window.open('', '_blank', 'width=960,height=760');
    if (!printableWindow) {
      await window.DynamaxDialogs.alert({ title: 'Pop-up blocked', message: 'Allow pop-ups to view and print this document.', confirmText: 'Close' });
      return;
    }
    printableWindow.document.write('<p style="font:14px Arial;padding:24px">Preparing official document...</p>');
    setButtonLoading(button, true, '', '');
    try {
      const data = await executiveOfficeRequest('document', { correspondenceId: button.dataset.printExecutive });
      openExecutivePrint(data.correspondence || {}, data.printable || {}, printableWindow);
    } catch (error) {
      printableWindow.close();
      await window.DynamaxDialogs.alert({ title: 'Document could not be opened', message: error.message || String(error), tone: 'danger', confirmText: 'Close' });
    } finally {
      setButtonLoading(button, false, '', '');
      button.innerHTML = original;
    }
  }));
  panelEl.querySelectorAll('[data-send-executive]').forEach((button) => button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openExecutiveSendDialog(button.dataset.sendExecutive);
  }));
  document.querySelector('[data-close-executive-send]')?.addEventListener('click', () => document.getElementById('executiveSendDialog')?.close());
  document.getElementById('executiveSendForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const status = document.getElementById('executiveSendStatus');
    setButtonLoading(button, true, 'Sending...', 'Send document');
    try {
      const data = await executiveOfficeRequest('send', Object.fromEntries(new FormData(form).entries()));
      const refreshed = await executiveOfficeRequest('bootstrap');
      executiveOfficeData = refreshed;
      renderModuleSummary('executiveOffice', refreshed);
      renderExecutiveOffice();
      setStatus(dashboardStatus, data.message || 'Official correspondence sent.', 'ok');
    } catch (error) {
      setStatus(status, error.message || String(error), 'bad');
      setButtonLoading(button, false, 'Sending...', 'Send document');
    }
  });
  const composer = document.getElementById('executiveComposerForm');
  composer?.querySelectorAll('[name="recipientMode"]').forEach((input) => input.addEventListener('change', updateExecutiveComposerVisibility));
  composer?.elements.kind?.addEventListener('change', updateExecutiveComposerVisibility);
  composer?.elements.templateId?.addEventListener('change', () => {
    const template = executiveTemplateRows().find((row) => executiveTemplateId(row) === composer.elements.templateId.value);
    if (!template) return;
    composer.elements.kind.value = executiveCorrespondenceKind(template);
    composer.elements.subject.value = pick(template, ['subjectTemplate', 'SubjectTemplate', 'subject', 'Subject']);
    composer.elements.body.value = executiveEditableTemplateBody(template);
    updateExecutiveComposerVisibility();
  });
  composer?.querySelector('[data-clear-executive-recipient]')?.addEventListener('click', () => {
    executiveSelectedRecipient = null;
    renderExecutiveOffice();
  });
  composer?.querySelectorAll('[data-insert-executive-token]').forEach((button) => button.addEventListener('click', () => {
    const textarea = composer.elements.body;
    const token = button.dataset.insertExecutiveToken;
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? start;
    textarea.setRangeText(token, start, end, 'end');
    textarea.focus();
  }));
  composer?.querySelector('[data-preview-executive]')?.addEventListener('click', () => {
    try { openExecutivePrint(executiveComposerPayload(composer)); } catch (error) { setStatus(document.getElementById('executiveComposerStatus'), error.message || String(error), 'bad'); }
  });
  composer?.querySelector('[data-save-executive-template]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const payload = executiveComposerPayload(composer);
    delete payload.approvalPassword;
    const selectedTemplate = executiveTemplateRows().find((row) => executiveTemplateId(row) === clean(payload.templateId));
    if (selectedTemplate?.BuiltIn) {
      payload.templateId = '';
      payload.TemplateId = '';
    }
    if (!clean(payload.templateName)) {
      setStatus(document.getElementById('executiveComposerStatus'), 'Enter a template name before saving this reusable document.', 'bad');
      composer.elements.templateName.focus();
      return;
    }
    setButtonLoading(button, true, 'Saving...', 'Save as template');
    try {
      const data = await executiveOfficeRequest('saveTemplate', payload);
      executiveOfficeData.templates = [data.template, ...executiveTemplateRows().filter((row) => executiveTemplateId(row) !== executiveTemplateId(data.template))];
      setStatus(document.getElementById('executiveComposerStatus'), data.message || 'Template saved.', 'ok');
    } catch (error) {
      setStatus(document.getElementById('executiveComposerStatus'), error.message || String(error), 'bad');
    } finally {
      setButtonLoading(button, false, 'Saving...', 'Save as template');
    }
  });
  composer?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (composer.dataset.submitting === 'true') return;
    const action = event.submitter?.dataset.correspondenceAction || 'saveDraft';
    const payload = executiveComposerPayload(composer);
    const status = document.getElementById('executiveComposerStatus');
    if (['issue', 'send'].includes(action) && !clean(payload.approvalPassword)) {
      setStatus(status, 'Enter your current password to issue or send this official document.', 'bad');
      composer.elements.approvalPassword.focus();
      return;
    }
    if (action === 'send' && !clean(payload.recipientEmail)) {
      setStatus(status, 'A recipient email address is required before this document can be sent.', 'bad');
      return;
    }
    const button = event.submitter;
    if (!button || button.disabled) return;
    const normalText = button.textContent;
    const actionButtons = [...composer.querySelectorAll('button[type="submit"], [data-save-executive-template]')];
    const disabledStates = new Map(actionButtons.map((item) => [item, item.disabled]));
    composer.dataset.submitting = 'true';
    actionButtons.forEach((item) => { item.disabled = true; });
    setButtonLoading(button, true, action === 'saveDraft' ? 'Saving...' : action === 'send' ? 'Sending...' : 'Issuing...', normalText);
    try {
      let data;
      if (action === 'saveDraft') {
        const draftPayload = { ...payload };
        delete draftPayload.approvalPassword;
        data = await executiveOfficeRequest(action, draftPayload);
      } else {
        const draftPayload = { ...payload };
        delete draftPayload.approvalPassword;
        const saved = await executiveOfficeRequest('saveDraft', draftPayload);
        payload.correspondenceId = executiveCorrespondenceId(saved.correspondence);
        data = await executiveOfficeRequest(action, payload);
      }
      composer.elements.approvalPassword.value = '';
      setStatus(status, data.message || (action === 'saveDraft' ? 'Draft saved.' : action === 'send' ? 'Document issued and sent.' : 'Document issued.'), 'ok');
      const refreshed = await executiveOfficeRequest('bootstrap');
      executiveOfficeData = refreshed;
      renderModuleSummary('executiveOffice', refreshed);
      executiveSelectedRecipient = null;
      switchExecutiveOfficeTab('register');
    } catch (error) {
      setStatus(status, error.message || String(error), 'bad');
    } finally {
      delete composer.dataset.submitting;
      if (button.isConnected) setButtonLoading(button, false, '', normalText);
      disabledStates.forEach((wasDisabled, item) => {
        if (item.isConnected && item !== button) item.disabled = wasDisabled;
      });
    }
  });
  updateExecutiveComposerVisibility();
}

async function loadExecutiveOffice() {
  if (activeSection !== 'executiveOffice') return;
  try {
    const data = await executiveOfficeRequest('bootstrap');
    if (activeSection !== 'executiveOffice') return;
    executiveOfficeData = data;
    executiveAvailableDirectoryTypes = data.availableTypes || executiveAvailableDirectoryTypes;
    executiveOfficeTab = savedWorkspaceView('executiveOffice', [
      { key: 'overview', label: 'Overview' },
      { key: 'directory', label: 'Directory' },
      { key: 'templates', label: 'Templates' },
      { key: 'compose', label: 'Compose' },
      { key: 'register', label: 'Register' }
    ]) || executiveOfficeTab;
    renderModuleSummary('executiveOffice', data);
    renderExecutiveOffice();
  } catch (error) {
    if (activeSection === 'executiveOffice') panelEl.innerHTML = `<p class="status bad">${escapeHtml(error.message || String(error))}</p>`;
  }
}

async function studentConductRequest(action = 'list', payload = {}) {
  const response = await staffFetch('/api/staff-conduct', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload })
  });
  const data = await response.json().catch(() => ({
    ok: false,
    message: 'The Student Conduct & Discipline Committee service did not return JSON.'
  }));
  if (!response.ok || !data.ok) {
    throw new Error(data.message || 'The student conduct request could not be completed.');
  }
  return data;
}

function studentConductForm(data, selected = {}) {
  const option = (value, selectedValue, label = value) =>
    `<option value="${escapeHtml(value)}"${clean(value) === clean(selectedValue) ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  const students = data.students || [];
  return `
    <form id="studentConductForm" class="student-conduct-form">
      <input type="hidden" name="CaseId" value="${escapeHtml(selected.CaseId || '')}">
      <label>Student
        <select id="studentConductStudent" name="StudentRef" required>
          <option value="">${students.length ? 'Choose student' : 'No students available'}</option>
          ${students.map((row) => option(
            row.StudentRef,
            selected.StudentRef,
            `${row.StudentName} · ${row.StudentRef}${row.ClassName ? ` · ${row.ClassName}` : ''}`
          )).join('')}
        </select>
      </label>
      <label>Incident date <input type="date" name="IncidentDate" value="${escapeHtml(selected.IncidentDate || new Date().toISOString().slice(0, 10))}" required></label>
      <label>Category <select name="Category" required><option value="">Choose category</option>${(data.categories || []).map((value) => option(value, selected.Category)).join('')}</select></label>
      <label>Severity <select name="Severity">${['Low', 'Moderate', 'High', 'Critical'].map((value) => option(value, selected.Severity || 'Moderate')).join('')}</select></label>
      <label class="conduct-span-2">Incident summary <input name="Summary" maxlength="240" value="${escapeHtml(selected.Summary || '')}" required></label>
      <label class="conduct-span-2">Detailed account <textarea name="Details" rows="3">${escapeHtml(selected.Details || '')}</textarea></label>
      <label>Immediate action <textarea name="ImmediateAction" rows="2">${escapeHtml(selected.ImmediateAction || '')}</textarea></label>
      <label>Sanction or corrective measure <textarea name="Sanction" rows="2">${escapeHtml(selected.Sanction || '')}</textarea></label>
      <label>Hearing date <input type="date" name="HearingDate" value="${escapeHtml(selected.HearingDate || '')}"></label>
      <label>Assigned officer <input name="AssignedTo" value="${escapeHtml(selected.AssignedTo || '')}"></label>
      <label>Status <select name="Status">${(data.statuses || []).map((value) => option(value, selected.Status || 'Open')).join('')}</select></label>
      <label class="checkbox-line conduct-parent-notified"><input type="checkbox" name="ParentNotified"${selected.ParentNotified ? ' checked' : ''}> Parent or guardian notified</label>
      <label class="conduct-span-2">Resolution and follow-up <textarea name="Resolution" rows="3">${escapeHtml(selected.Resolution || '')}</textarea></label>
      <div class="conduct-span-2 student-conduct-actions">
        <button type="submit">${selected.CaseId ? 'Update case' : 'Record case'}</button>
        ${selected.CaseId ? '<button type="button" class="secondary" id="cancelStudentConductEdit">Cancel edit</button>' : ''}
      </div>
      <p id="studentConductStatus" class="status conduct-span-2"></p>
    </form>`;
}

function studentConductClosedCaseView(selected = {}) {
  const field = (label, value) => `<article class="workflow-record"><div class="workflow-record-heading"><strong>${escapeHtml(label)}</strong></div><p>${escapeHtml(clean(value) || 'Not recorded')}</p></article>`;
  return `
    <div class="workflow-record-list" aria-label="Closed conduct case details">
      <p class="status ok">This case is closed and read-only. Its recorded details cannot be changed.</p>
      ${field('Student', [selected.StudentName, selected.StudentRef].filter(Boolean).join(' Â· '))}
      ${field('Incident', [selected.IncidentDate, selected.Category, selected.Severity].filter(Boolean).join(' Â· '))}
      ${field('Summary', selected.Summary)}
      ${field('Detailed account', selected.Details)}
      ${field('Immediate action', selected.ImmediateAction)}
      ${field('Sanction or corrective measure', selected.Sanction)}
      ${field('Hearing and assignment', [selected.HearingDate, selected.AssignedTo].filter(Boolean).join(' Â· '))}
      ${field('Parent or guardian notified', selected.ParentNotified ? 'Yes' : 'No')}
      ${field('Resolution and follow-up', selected.Resolution)}
      <div class="student-conduct-actions"><button type="button" class="secondary" id="cancelStudentConductEdit">Close view</button></div>
    </div>`;
}

function bindStudentConductStudentSearch(data) {
  const search = document.getElementById('studentConductStudentSearch');
  const searchButton = document.getElementById('studentConductStudentSearchButton');
  const select = document.getElementById('studentConductStudent');
  const feedback = document.getElementById('studentConductStudentSearchStatus');
  if (!search || !searchButton || !select || !feedback) return;
  const students = (data.students || []).map((row) => ({
    ref: clean(row.StudentRef),
    name: clean(row.StudentName),
    className: clean(row.ClassName),
    searchText: lower([row.StudentName, row.StudentRef, row.ClassName].filter(Boolean).join(' '))
  })).filter((row) => row.ref);
  search.disabled = !students.length;
  searchButton.disabled = !students.length;

  const update = ({ chooseSingle = false } = {}) => {
    const query = lower(search.value);
    const selectedRef = clean(select.value);
    const matching = query
      ? students.filter((row) => row.searchText.includes(query))
      : students;
    const visible = [...matching];
    const selectedStudent = students.find((row) => row.ref === selectedRef);
    if (selectedStudent && !visible.some((row) => row.ref === selectedRef)) visible.unshift(selectedStudent);

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = students.length
      ? (matching.length ? 'Choose student' : 'No matching student')
      : 'No students available';
    select.replaceChildren(placeholder);
    visible.forEach((row) => {
      const optionElement = document.createElement('option');
      optionElement.value = row.ref;
      optionElement.textContent = [row.name, row.ref, row.className].filter(Boolean).join(' · ');
      select.append(optionElement);
    });
    const matchedRef = chooseSingle && query && matching.length === 1
      ? matching[0].ref
      : selectedRef;
    select.value = visible.some((row) => row.ref === matchedRef) ? matchedRef : '';
    feedback.textContent = query
      ? (chooseSingle && matching.length === 1
          ? `Selected ${matching[0].name}`
          : `${matching.length} matching student${matching.length === 1 ? '' : 's'}`)
      : `${students.length} student${students.length === 1 ? '' : 's'} available`;
    if (chooseSingle && matching.length > 1) select.focus();
  };

  const runSearch = () => update({ chooseSingle: true });
  search.addEventListener('input', () => update());
  searchButton.addEventListener('click', runSearch);
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      runSearch();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      select.focus();
    }
  });
  update();
}

function renderStudentConduct(selected = {}) {
  if (activeSection !== 'studentConduct' || !studentConductData) return;
  const data = studentConductData;
  const summary = data.summary || {};
  const selectedClosed = lower(selected.Status) === 'closed';
  panelEl.innerHTML = `
    <div class="workflow-intro">
      <div><p class="eyebrow">Student welfare and accountability</p><h2>Student Conduct & Discipline Committee</h2>
      <p class="muted">Record incidents, hearings, corrective measures, parent notifications and final resolutions in one protected register.</p></div>
      <button type="button" id="refreshStudentConduct" class="compact-action">↻ Refresh</button>
    </div>
    <div class="metric-cards student-conduct-summary">
      <div><small>Total cases</small><strong>${escapeHtml(summary.Total || 0)}</strong></div>
      <div><small>Open</small><strong>${escapeHtml(summary.Open || 0)}</strong></div>
      <div><small>Under review</small><strong>${escapeHtml(summary.UnderReview || 0)}</strong></div>
      <div><small>High priority</small><strong>${escapeHtml(summary.HighPriority || 0)}</strong></div>
      <div><small>Resolved</small><strong>${escapeHtml(summary.Resolved || 0)}</strong></div>
    </div>
    <div class="student-conduct-layout">
      <section class="student-conduct-card">
        <p class="eyebrow">${selectedClosed ? 'Closed committee case' : (selected.CaseId ? 'Update committee case' : 'New committee case')}</p>
        <div class="student-conduct-card-heading">
          <h3>${selected.CaseId ? escapeHtml(selected.CaseId) : 'Record an incident'}</h3>
          ${selectedClosed ? '' : `<div class="student-conduct-student-search">
            <label for="studentConductStudentSearch">Find student</label>
            <div class="student-conduct-student-search-controls">
              <input id="studentConductStudentSearch" type="search" placeholder="Name, admission no. or class" autocomplete="off">
              <button type="button" id="studentConductStudentSearchButton">Search</button>
            </div>
            <small id="studentConductStudentSearchStatus" aria-live="polite"></small>
          </div>`}
        </div>
        ${selectedClosed ? studentConductClosedCaseView(selected) : studentConductForm(data, selected)}
      </section>
      <section class="student-conduct-card conduct-register">
        ${table('Conduct case register', data.cases || [], [
          { label: 'Case', value: (row) => row.CaseId },
          { label: 'Date', value: (row) => row.IncidentDate },
          { label: 'Student', value: (row) => `${row.StudentName} · ${row.StudentRef}` },
          { label: 'Category', value: (row) => row.Category },
          { label: 'Severity', value: (row) => row.Severity },
          { label: 'Status', value: (row) => row.Status },
          { label: 'Actions', render: (row) => `
            <span class="table-icon-actions">
              ${lower(row.Status) === 'closed'
                ? `<button type="button" class="compact-icon-action" data-view-conduct="${escapeHtml(row.CaseId)}" aria-label="View closed case ${escapeHtml(row.CaseId)}" title="Closed case · View only">&#128274;</button>`
                : `<button type="button" class="compact-icon-action compact-edit-action" data-edit-conduct="${escapeHtml(row.CaseId)}" aria-label="Edit ${escapeHtml(row.CaseId)}" title="Edit case">&#9998;</button>`}
              ${data.permissions?.canDelete ? `<button type="button" class="compact-icon-action compact-delete-action" data-delete-conduct="${escapeHtml(row.CaseId)}" aria-label="Delete ${escapeHtml(row.CaseId)}" title="Delete case">&#10005;</button>` : ''}
            </span>` }
        ])}
      </section>
    </div>`;
  const conductLayout = panelEl.querySelector(':scope > .student-conduct-layout');
  const conductCards = [...(conductLayout?.children || [])];
  const conductTabs = mountWorkspaceTabs('studentConduct', [
    { key: 'overview', label: 'Overview', icon: '\u25A6', nodes: panelEl.querySelector(':scope > .student-conduct-summary') },
    { key: 'case', label: selected.CaseId ? (selectedClosed ? 'View case' : 'Edit case') : 'New case', icon: selectedClosed ? '\u{1F512}' : '+', nodes: conductCards[0] },
    { key: 'register', label: 'Case register', icon: '\u{1F5C2}', count: (data.cases || []).length, nodes: conductCards[1] }
  ]);
  if (conductLayout && !conductLayout.children.length) conductLayout.remove();
  document.getElementById('refreshStudentConduct')?.addEventListener('click', (event) => {
    runButtonAction(event.currentTarget, 'Refreshing...', loadStudentConduct);
  });
  bindStudentConductStudentSearch(data);
  document.getElementById('cancelStudentConductEdit')?.addEventListener('click', () => {
    conductTabs?.activate('register');
    renderStudentConduct();
  });
  panelEl.querySelectorAll('[data-edit-conduct]').forEach((button) => button.addEventListener('click', () => {
    const row = (data.cases || []).find((item) => clean(item.CaseId) === clean(button.dataset.editConduct));
    if (row) { conductTabs?.activate('case'); renderStudentConduct(row); }
  }));
  panelEl.querySelectorAll('[data-view-conduct]').forEach((button) => button.addEventListener('click', () => {
    const row = (data.cases || []).find((item) => clean(item.CaseId) === clean(button.dataset.viewConduct));
    if (row) { conductTabs?.activate('case'); renderStudentConduct(row); }
  }));
  panelEl.querySelectorAll('[data-delete-conduct]').forEach((button) => button.addEventListener('click', async () => {
    if (!await window.DynamaxDialogs.confirm({ title: 'Delete conduct case', message: 'Delete this conduct case? The deletion will be audited.', tone: 'danger', confirmText: 'Delete case' })) return;
    try {
      await runButtonAction(button, 'Deleting...', async () => {
        await studentConductRequest('delete', { CaseId: button.dataset.deleteConduct });
        await loadStudentConduct();
      });
    } catch (error) {
      setStatus(document.getElementById('studentConductStatus'), error.message || String(error), 'bad');
    }
  }));
  document.getElementById('studentConductForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = event.submitter;
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.ParentNotified = form.elements.ParentNotified.checked;
    setButtonLoading(submit, true, 'Saving...', selected.CaseId ? 'Update case' : 'Record case');
    try {
      const result = await studentConductRequest('save', payload);
      setStatus(document.getElementById('studentConductStatus'), result.message, 'ok');
      await loadStudentConduct();
    } catch (error) {
      setStatus(document.getElementById('studentConductStatus'), error.message || String(error), 'bad');
      setButtonLoading(submit, false, '', selected.CaseId ? 'Update case' : 'Record case');
    }
  });
}

async function loadStudentConduct() {
  if (activeSection !== 'studentConduct') return;
  try {
    const handoff = takeRecordsDeskHandoff('studentConduct');
    const reference = recordsDeskHandoffReference(handoff);
    const data = await studentConductRequest('list');
    if (activeSection !== 'studentConduct') return;
    studentConductData = data;
    renderModuleSummary('studentConduct', data);
    renderStudentConduct(reference ? { StudentRef: reference } : {});
  } catch (error) {
    if (activeSection === 'studentConduct') {
      panelEl.innerHTML = `<p class="status bad">${escapeHtml(error.message || String(error))}</p>`;
    }
  }
}

function schoolInsightChartCards(charts = {}) {
  const groups = [
    ['Students by Gender', charts.studentGender || [], false],
    ['New Intake / Returning', charts.studentCategory || [], false],
    ['Fee Balance by Class', charts.classBalances || [], true],
    ['Fee Position', charts.paymentPosition || [], true]
  ];
  return groups.map(([title, rows, currency]) => {
    const max = Math.max(1, ...rows.map((row) => Number(row.value || 0)));
    const bars = rows.length
      ? rows.map((row) => `<div class="chart-row"><span title="${escapeHtml(row.label)}">${escapeHtml(row.label)}${row.secondary ? `<small>${escapeHtml(row.secondary)}</small>` : ''}</span><i><b style="width:${Math.max(2, Math.round(Number(row.value || 0) / max * 100))}%"></b></i><strong>${currency ? money(row.value) : escapeHtml(row.value)}</strong></div>`).join('')
      : '<p class="muted">No data yet.</p>';
    return `<article><h3>${escapeHtml(title)}</h3>${bars}</article>`;
  }).join('');
}

function renderSchoolInsights() {
  const insights = dashboardData?.departments?.schoolInsights || {};
  const defaulters = insights.defaulters || [];
  const branchName = availableBranches.find((branch) => clean(branch.id).toLowerCase() === clean(selectedBranchId).toLowerCase())?.name
    || (clean(selectedBranchId) && selectedBranchId !== 'all' ? selectedBranchId : 'All permitted branches');
  panelEl.innerHTML = `
    <div class="workflow-ledger-heading">
      <div><p class="eyebrow">School operations</p><h2>School Insights</h2><p class="muted">Enrolment and fee-payment information for ${escapeHtml(branchName)}. Figures load only when this workspace is opened.</p></div>
      <button type="button" id="refreshSchoolInsights" class="school-insights-refresh" aria-label="Refresh School Insights" title="Refresh School Insights">
        <span class="school-insights-refresh-icon" aria-hidden="true">&#8635;</span>
        <span class="school-insights-refresh-label">Refresh</span>
      </button>
    </div>
    <section class="dashboard-charts" aria-label="School enrolment and fee charts">${schoolInsightChartCards(dashboardData?.charts || {})}</section>
    ${table('Top 10 Fee-Payment Defaulters', defaulters, [
      { label: 'Student', value: (row) => pick(row, ['DisplayName', 'AccountRef']) },
      { label: 'Admission / Account No.', value: (row) => pick(row, ['AdmissionNo', 'AccountRef']) },
      { label: 'Class', value: (row) => pick(row, ['ClassName']) || 'Unspecified' },
      { label: 'Expected', render: (row) => money(row.TotalDebit) },
      { label: 'Paid', render: (row) => money(row.TotalCredit) },
      { label: 'Outstanding', render: (row) => `<strong>${escapeHtml(money(row.OutstandingBalance))}</strong>` },
      { label: 'Last Payment', value: (row) => pick(row, ['LastPaymentAt']) || 'No payment recorded' }
    ])}`;
  document.getElementById('refreshSchoolInsights')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const label = button.querySelector('.school-insights-refresh-label');
    button.disabled = true;
    button.classList.add('is-loading');
    button.setAttribute('aria-busy', 'true');
    if (label) label.textContent = 'Refreshing...';
    try {
      await loadDashboard({ mode: 'section', section: 'schoolInsights', merge: true });
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        button.classList.remove('is-loading');
        button.removeAttribute('aria-busy');
        if (label) label.textContent = 'Refresh';
      }
    }
  });
}

function renderSection(active) {
  if (!dashboardData) return;
  panelEl.classList.toggle('school-store-panel', active === 'bookstore' || active === 'uniformStore' || active === 'organizationStore');
  if (active === 'overview') {
    panelEl.innerHTML = '';
    return;
  }
  const departments = dashboardData.departments || {};
  if (legacyDashboardSections.has(active) && !Object.hasOwn(departments, active)) {
    panelEl.innerHTML = `<p class="muted">Loading ${escapeHtml(staffTabLabel(active, active))} records...</p>`;
    if (!dashboardSectionRequests.has(active)) {
      const request = loadDashboard({ mode: 'section', section: active, merge: true })
        .finally(() => dashboardSectionRequests.delete(active));
      dashboardSectionRequests.set(active, request);
    }
    return;
  }
  if (active === 'schoolInsights') {
    renderSchoolInsights();
  } else if (active === 'recordsDesk') {
    renderRecordsDesk();
  } else if (active === 'executiveOffice') {
    panelEl.innerHTML = `<div class="executive-loading"><span class="records-desk-spinner" aria-hidden="true"></span><strong>Opening ${escapeHtml(executiveOfficeTitle())}...</strong><small>Loading authorised metrics, directories, templates and correspondence.</small></div>`;
    loadExecutiveOffice();
  } else if (active === 'dataBackup') {
    renderDataBackup();
  } else if (active === 'securityAudit') {
    panelEl.innerHTML = '<p class="muted">Loading the aggregated security audit log...</p>';
    loadSecurityAudit();
  } else if (active === 'staffUsers') {
    panelEl.innerHTML = '<p class="muted">Loading staff accounts...</p>';
    loadStaffUsers();
  } else if (active === 'humanResources') {
    panelEl.innerHTML = '<p class="muted">Loading Human Resources...</p>';
    loadHumanResources();
  } else if (active === 'studentConduct') {
    panelEl.innerHTML = '<p class="muted">Loading Student Conduct & Discipline Committee cases...</p>';
    loadStudentConduct();
  } else if (active === 'payroll') {
    panelEl.innerHTML = '<p class="muted">Loading your payroll history...</p>';
    loadMyPayroll();
  } else if (active === 'financeRequests') {
    panelEl.innerHTML = '<p class="muted">Loading bills and requisitions...</p>';
    loadFinanceWorkflow();
  } else if (active === 'incomeAnalytics') {
    panelEl.innerHTML = '<p class="muted">Loading posted income analytics...</p>';
    loadIncomeAnalytics();
  } else if (active === 'admissions') {
    const handoff = takeRecordsDeskHandoff('admissions');
    const reference = recordsDeskHandoffReference(handoff);
    const admissions = reference
      ? (departments.admissions || []).filter((row) => recordsDeskRowMatches(
        row,
        reference,
        ['ApplicationReference', 'ApplicationID', 'AdmissionNo', '__id']
      ))
      : departments.admissions || [];
    panelEl.innerHTML = recordsDeskHandoffBanner(handoff, reference) + table('Admissions', admissions, [
      { label: 'Reference', value: (row) => pick(row, ['ApplicationReference', 'ApplicationID', '__id']) },
      { label: 'Name', value: (row) => pick(row, ['ApplicantName', 'Name']) },
      { label: 'Class', value: (row) => pick(row, ['ClassApplyingFor', 'ClassAppliedFor']) },
      { label: 'Status', value: (row) => pick(row, ['Status', 'ResultStatus']) },
      { label: 'Uploaded Documents', render: renderAdmissionDocuments }
    ]);
    bindDocumentDeleteEvents();
  } else if (active === 'formPurchases') {
    panelEl.innerHTML = admissionFormPurchasesWorkspace(departments.formPurchases || []);
    bindAdmissionFormPurchaseQr();
    loadDirectTransferVerification(['admission-form'], 'admissionDirectTransferVerification');
  } else if (active === 'students') {
    const students = departments.students || [];
    const handoff = takeRecordsDeskHandoff('students');
    const reference = recordsDeskHandoffReference(handoff);
    panelEl.innerHTML = recordsDeskHandoffBanner(handoff, reference) + table('Students', students, [
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
    if (reference) {
      const student = students.find((row) => recordsDeskRowMatches(
        row,
        reference,
        ['AdmissionNo', 'AccountRef', 'ApplicationReference', '__id']
      ));
      if (student) openStudentEditor(student);
      else setStatus(dashboardStatus, `The selected student ${reference} is no longer in your permitted register.`, 'bad');
    }
  } else if (active === 'members') {
    panelEl.innerHTML = '<p class="muted">Loading departments, members and programs...</p>';
    loadOrganizationDepartments();
  } else if (active === 'services') {
    panelEl.innerHTML = '<p class="muted">Loading church services and attendance...</p>';
    loadChurchServices();
  } else if (active === 'staffAttendance') {
    panelEl.innerHTML = '<p class="muted">Loading staff attendance...</p>';
    loadStaffAttendance();
  } else if (active === 'funds') {
    panelEl.innerHTML = '<p class="muted">Loading church funds and accounting mappings...</p>';
    loadChurchFunds();
  } else if (active === 'donations') {
    panelEl.innerHTML = '<p class="muted">Loading church donation records...</p>';
    loadChurchDonations();
  } else if (active === 'offerings') {
    panelEl.innerHTML = '<p class="muted">Loading church offering batches...</p>';
    loadChurchOfferings();
  } else if (active === 'bookstore' || active === 'uniformStore' || active === 'organizationStore') {
    panelEl.innerHTML = '<p class="muted">Loading store catalog...</p>';
    loadStaffStore(active);
  } else if (active === 'accounts') {
    const accounts = departments.accounts || {};
    const handoff = takeRecordsDeskHandoff('accounts');
    const reference = recordsDeskHandoffReference(handoff);
    const matchesAccount = (row) => !reference || recordsDeskRowMatches(
      row,
      reference,
      ['AccountRef', 'AdmissionNo', 'ApplicationReference']
    );
    const payments = (accounts.payments || []).filter(matchesAccount);
    const invoices = (accounts.invoices || []).filter(matchesAccount);
    panelEl.innerHTML = `<div class="workflow-intro"><div><p class="eyebrow">Student finance</p><h2>Accounts</h2><p class="muted">Payments and invoices from the shared accounting records.</p></div></div>` + recordsDeskHandoffBanner(handoff, reference) + table('Payments', payments, [
      { label: 'Date', value: (row) => pick(row, ['PaidAt', 'Date']) },
      { label: 'Account', value: (row) => pick(row, ['AccountRef', 'AdmissionNo']) },
      { label: 'Fee', value: (row) => pick(row, ['FeeName', 'FeeCode']) },
      { label: 'Amount', value: (row) => money(pick(row, ['Amount'])) },
      { label: 'Reference', value: (row) => pick(row, ['Reference']) }
    ]) + table('Invoices', invoices, [
      { label: 'Date', value: (row) => pick(row, ['Date', 'CreatedAt']) },
      { label: 'Account', value: (row) => pick(row, ['AccountRef']) },
      { label: 'Fee', value: (row) => pick(row, ['FeeName', 'FeeCode']) },
      { label: 'Debit', value: (row) => money(pick(row, ['Debit', 'Amount'])) },
      { label: 'Status', value: (row) => pick(row, ['Status']) }
    ]) + directTransferVerificationWorkspace('schoolDirectTransferVerification', 'School-payment transfers awaiting verification');
    mountWorkspaceTabs('accounts', [
      { key: 'payments', label: 'Payments', icon: '\u2713', count: payments.length, nodes: [panelEl.querySelector(':scope > .records-desk-handoff'), workspaceTableNodes('Payments')] },
      { key: 'invoices', label: 'Invoices', icon: '\u{1F9FE}', count: invoices.length, nodes: workspaceTableNodes('Invoices') },
      { key: 'transfers', label: 'Transfer verification', icon: '\u{1F50E}', nodes: document.getElementById('schoolDirectTransferVerification') }
    ]);
    loadDirectTransferVerification(['school-payment'], 'schoolDirectTransferVerification');
  } else if (active === 'clinic' || active === 'kitchen' || active === 'restaurant' || active === 'tuckShop') {
    panelEl.innerHTML = '<p class="muted">Loading department operations...</p>';
    loadDepartmentOperations(active);
  } else {
    panelEl.innerHTML = '<p class="muted">No dashboard section is available for this role yet.</p>';
  }
}

function bindDocumentDeleteEvents() {
  bindProtectedFileEvents(panelEl);
  panelEl.querySelectorAll('[data-delete-document]').forEach((button) => button.addEventListener('click', async () => {
    const applicationReference = button.dataset.applicationReference;
    const scopePath = button.dataset.applicationScope || '';
    const documentType = button.dataset.deleteDocument;
    if (!await window.DynamaxDialogs.confirm({ title: 'Delete uploaded document', message: 'The file will be moved to Google Drive trash.', tone: 'danger', confirmText: 'Delete document' })) return;
    const normalMarkup = button.innerHTML;
    setButtonLoading(button, true, '', '');
    try {
      const response = await staffFetch('/api/staff-document', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', applicationReference, scopePath, documentType })
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
    const response = await staffFetch('/api/staff-payroll', { credentials: 'same-origin', cache: 'no-store' });
    const data = await response.json().catch(() => ({ ok: false, message: 'Payroll service did not return JSON.' }));
    if (response.status === 401) { showLogin(data.message || 'Your staff session has expired.', 'bad'); return; }
    if (!response.ok || !data.ok) throw new Error(data.message || 'Payroll history could not be loaded.');
    const items = data.items || [];
    if (activeSection !== 'payroll') return;
    renderModuleSummary('payroll', items);
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
        { label: 'Payslip', render: (row) => `<button type="button" class="payslip-download" data-protected-file="${escapeHtml(`/api/staff-payroll?action=payslip&itemId=${encodeURIComponent(row.ItemId)}`)}" data-file-mode="download" data-file-name="${escapeHtml(`payslip-${row.ItemId || row.Month || 'staff'}.pdf`)}">Download PDF</button>` }
      ])}
      <dialog id="taxBreakdownDialog" class="workflow-dialog tax-breakdown-dialog"><div id="taxBreakdownContent"></div><form method="dialog" class="tax-breakdown-close"><button type="submit">Close</button></form></dialog>`;
    bindProtectedFileEvents(panelEl);
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

async function financeRequest(action, payload = {}, options = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const approvalProof = clean(options.approvalProof);
  const isMutation = !['list', 'document'].includes(clean(action));
  const idempotencyKey = isMutation ? (clean(payload.idempotencyKey) || newIdempotencyKey()) : '';
  if (approvalProof) headers.set('X-DIGC-Approval-Proof', approvalProof);
  if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey);
  const response = await staffFetch('/api/finance-workflow', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers,
    body: JSON.stringify({ action, ...payload, ...(idempotencyKey ? { idempotencyKey } : {}) })
  });
  const data = await response.json().catch(() => ({ ok: false, message: 'Finance workflow did not return JSON.' }));
  if (response.status === 401) {
    showLogin(data.message || 'Your staff session has expired.', 'bad');
    throw new Error(data.message || 'Your staff session has expired.');
  }
  if (!response.ok || !data.ok) throw receivedResponseError(data.message || 'Finance workflow request failed.');
  return data;
}

function openFinanceDecision(button) {
  const action = button.dataset.workflowAction;
  const decision = button.dataset.decision || '';
  const secureDecision = decision === 'Approved' || action === 'accountsReview';
  const posting = action === 'accountsReview';
  const profile = financeData?.approvalProfile || {};
  pendingFinanceDecision = {
    button,
    action,
    decision,
    recordType: button.dataset.recordType,
    recordId: button.dataset.recordId,
    idempotencyKey: newIdempotencyKey()
  };
  financeDecisionBiometricVerified = false;
  financeDecisionApprovalProof = '';
  financeDecisionForm.reset();
  document.getElementById('financeDecisionTitle').textContent = decision === 'Rejected'
    ? 'Reject Document'
    : posting ? 'Accounts Review / Posting' : 'Approve Document';
  document.getElementById('financeDecisionRecord').textContent = button.dataset.recordId;
  document.getElementById('financeEndorsementOptions').hidden = !secureDecision;
  document.getElementById('financeDecisionVerification').hidden = !secureDecision;
  const signatureInput = financeDecisionForm.elements.applySignature;
  const stampInput = financeDecisionForm.elements.applyStamp;
  signatureInput.disabled = !profile.HasSignature;
  stampInput.disabled = !profile.HasStamp;
  signatureInput.checked = Boolean(profile.HasSignature && profile[posting ? 'ApplySignatureOnPosting' : 'ApplySignatureOnApproval']);
  stampInput.checked = Boolean(profile.HasStamp && profile[posting ? 'ApplyStampOnPosting' : 'ApplyStampOnApproval']);
  signatureInput.closest('label').title = profile.HasSignature ? '' : 'Save a signature in User Settings first';
  stampInput.closest('label').title = profile.HasStamp ? '' : 'Save a stamp in User Settings first';
  const biometricButton = document.getElementById('financeDecisionBiometric');
  biometricButton.hidden = !secureDecision || !passkeysSupported();
  biometricButton.classList.remove('is-verified');
  biometricButton.innerHTML = '<span aria-hidden="true">◉</span> Verify with biometric';
  setStatus(document.getElementById('financeDecisionVerificationStatus'), '');
  setStatus(document.getElementById('financeDecisionStatus'), '');
  document.getElementById('financeDecisionSubmit').textContent = decision === 'Rejected' ? 'Reject Document' : 'Confirm Decision';
  financeDecisionDialog.showModal();
}

async function verifyFinanceDecisionBiometric() {
  const button = document.getElementById('financeDecisionBiometric');
  setButtonLoading(button, true, 'Checking your device...', 'Verify with biometric');
  setStatus(document.getElementById('financeDecisionVerificationStatus'), 'Follow your device prompt...');
  try {
    const started = await passkeyRequest('approval-options', {
      recordId: pendingFinanceDecision?.recordId,
      recordType: pendingFinanceDecision?.recordType,
      decisionAction: pendingFinanceDecision?.action === 'accountsReview' ? 'accountsReview' : 'review:Approved'
    });
    const credential = await getPasskeyCredential(started.options);
    if (!credential) throw new Error('No biometric credential was returned.');
    const completed = await passkeyRequest('approval-verify', {
      ceremonyId: started.ceremonyId,
      credential: credentialToJSON(credential)
    });
    financeDecisionApprovalProof = clean(completed.approvalProof);
    if (!financeDecisionApprovalProof) throw new Error('Biometric verification did not return an approval proof.');
    financeDecisionBiometricVerified = true;
    button.disabled = false;
    button.classList.remove('is-loading');
    button.classList.add('is-verified');
    button.removeAttribute('aria-busy');
    button.innerHTML = '<span aria-hidden="true">✓</span> Biometric verified';
    setStatus(document.getElementById('financeDecisionVerificationStatus'), completed.message, 'ok');
  } catch (error) {
    financeDecisionBiometricVerified = false;
    financeDecisionApprovalProof = '';
    setStatus(document.getElementById('financeDecisionVerificationStatus'), friendlyPasskeyError(error), 'bad');
    setButtonLoading(button, false, 'Checking your device...', 'Verify with biometric');
  }
}

async function submitFinanceDecision(event) {
  event.preventDefault();
  if (!pendingFinanceDecision) return;
  const context = pendingFinanceDecision;
  const secureDecision = context.decision === 'Approved' || context.action === 'accountsReview';
  const password = financeDecisionForm.elements.approvalPassword.value;
  if (secureDecision && !password && !financeDecisionBiometricVerified) {
    setStatus(document.getElementById('financeDecisionVerificationStatus'), 'Enter your current password or verify with biometric.', 'bad');
    return;
  }
  const submitButton = document.getElementById('financeDecisionSubmit');
  setButtonLoading(submitButton, true, 'Saving...', 'Confirm Decision');
  try {
    const data = await financeRequest(context.action, {
      recordType: context.recordType,
      recordId: context.recordId,
      decision: context.decision,
      notes: financeDecisionForm.elements.notes.value,
      approvalPassword: password,
      applySignature: financeDecisionForm.elements.applySignature.checked,
      applyStamp: financeDecisionForm.elements.applyStamp.checked,
      idempotencyKey: context.idempotencyKey
    }, { approvalProof: financeDecisionApprovalProof });
    financeDecisionDialog.close();
    pendingFinanceDecision = null;
    financeDecisionBiometricVerified = false;
    financeDecisionApprovalProof = '';
    setStatus(document.getElementById('financeWorkflowStatus'), data.message, 'ok');
    await loadFinanceWorkflow();
  } catch (error) {
    if (error?.responseReceived) context.idempotencyKey = newIdempotencyKey();
    if (secureDecision && !password) {
      financeDecisionBiometricVerified = false;
      financeDecisionApprovalProof = '';
    }
    setStatus(document.getElementById('financeDecisionStatus'), error.message || String(error), 'bad');
  } finally {
    setButtonLoading(submitButton, false, 'Saving...', context.decision === 'Rejected' ? 'Reject Document' : 'Confirm Decision');
  }
}

function materialItemsTable(items, grandTotal = null) {
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
  const total = grandTotal === null
    ? items.reduce((sum, item) => sum + Number(item.Total ?? (Number(item.Quantity || item.quantity || 0) * Number(item.UnitPrice || item.unitPrice || 0))), 0)
    : Number(grandTotal || 0);
  return `
    <div class="admin-table-wrap material-submission-table">
      <table class="admin-table">
        <thead><tr><th>S/No.</th><th>Item</th><th>Specification</th><th>Quantity</th><th>Unit Price</th><th>Total</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr class="material-grand-total-row"><th colspan="5">Grand Total</th><th>${escapeHtml(money(total))}</th></tr></tfoot>
      </table>
    </div>
  `;
}

function financeRecordRow(record, type, capabilities) {
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
  const administrativelyApproved = Boolean(clean(record.AdminReviewedAt));
  let actions = `<button type="button" class="compact-icon-action compact-print-action" data-print-finance-record="${escapeHtml(id)}" data-record-type="${type}" aria-label="View and print ${escapeHtml(id)}" title="View and print"><span aria-hidden="true">&#128424;&#65038;</span></button>`;
  if (type === 'requisition' && capabilities.canAdminOverride) {
    if (administrativelyApproved) {
      actions += `<button type="button" class="compact-icon-action compact-edit-action" disabled aria-label="Editing locked after administrative approval for ${escapeHtml(id)}" title="Editing locked after administrative approval"><span aria-hidden="true">&#9998;</span></button>`;
    } else if (!['paid', 'posted', 'processed', 'voided', 'cancelled', 'canceled'].includes(clean(status).toLowerCase())) {
      actions += `<button type="button" class="compact-icon-action compact-edit-action" data-edit-requisition="${escapeHtml(id)}" aria-label="Edit and resubmit ${escapeHtml(id)}" title="Edit and resubmit"><span aria-hidden="true">&#9998;</span></button>`;
    }
  }
  if (capabilities.canApprove && clean(status).toLowerCase() === 'submitted') {
    actions += `<button type="button" class="compact-icon-action compact-approve-action" data-workflow-action="review" data-decision="Approved" data-record-type="${type}" data-record-id="${escapeHtml(id)}" aria-label="Approve ${escapeHtml(id)}" title="Approve"><span aria-hidden="true">&#10003;</span></button>`;
    actions += `<button type="button" class="compact-icon-action compact-reject-action" data-workflow-action="review" data-decision="Rejected" data-record-type="${type}" data-record-id="${escapeHtml(id)}" aria-label="Reject ${escapeHtml(id)}" title="Reject"><span aria-hidden="true">&#10005;</span></button>`;
  }
  if (capabilities.canAdminOverride && clean(status).toLowerCase() === 'approved' && !record.AdminReviewedAt) {
    actions += `<button type="button" class="compact-icon-action compact-approve-action" data-workflow-action="review" data-decision="Approved" data-record-type="${type}" data-record-id="${escapeHtml(id)}" aria-label="Administratively approve ${escapeHtml(id)}" title="Administrative approval"><span aria-hidden="true">&#10003;</span></button>`;
    actions += `<button type="button" class="compact-icon-action compact-reject-action" data-workflow-action="review" data-decision="Rejected" data-record-type="${type}" data-record-id="${escapeHtml(id)}" aria-label="Administratively reject ${escapeHtml(id)}" title="Administrative rejection"><span aria-hidden="true">&#10005;</span></button>`;
  }
  if (capabilities.canAccountsReview && clean(status).toLowerCase() === 'approved' && !accountsReviewed) {
    actions += `<button type="button" class="compact-icon-action compact-approve-action" data-workflow-action="accountsReview" data-record-type="${type}" data-record-id="${escapeHtml(id)}" aria-label="Mark ${escapeHtml(id)} as accounts reviewed" title="Mark Accounts Reviewed"><span aria-hidden="true">&#10003;</span></button>`;
  }
  return `
    <tr>
      <td>${escapeHtml(id)}</td>
      <td>${escapeHtml(title)}</td>
      <td>${escapeHtml(description || '-')}</td>
      <td>${escapeHtml(money(record.Amount))}</td>
      <td>${escapeHtml(record.Department || '-')}</td>
      <td>${escapeHtml(record.Date || '-')}</td>
      <td>${escapeHtml(type === 'bill' ? (record.DueDate || '-') : (record.Vendor || '-'))}</td>
      <td><span class="workflow-status status-${escapeHtml(clean(status).toLowerCase().replace(/\s+/g, '-'))}">${escapeHtml(status)}</span></td>
      <td><div class="finance-row-actions">${actions}</div></td>
    </tr>
  `;
}

function financeRecordsSection(title, records, type, capabilities) {
  return `
    <section class="workflow-list-section">
      <h2>${escapeHtml(title)} <small>(${records.length})</small></h2>
      <div class="admin-table-wrap finance-record-table-wrap">
        <table class="admin-table finance-record-table">
          <thead><tr><th>Reference</th><th>Request</th><th>Description</th><th>Amount</th><th>Department</th><th>Date</th><th>${type === 'bill' ? 'Due Date' : 'Vendor'}</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>${records.length ? records.map((record) => financeRecordRow(record, type, capabilities)).join('') : '<tr><td colspan="9">No records found.</td></tr>'}</tbody>
        </table>
      </div>
    </section>
  `;
}

function approvalEndorsementBlock(title, officer, timestamp, endorsement) {
  if (!officer) return '';
  const signature = clean(endorsement?.SignatureDataUrl);
  const stamp = clean(endorsement?.StampDataUrl);
  return `<section class="approval-block"><div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(officer)}</span><small>${escapeHtml(timestamp || '')}</small></div>
    ${signature || stamp ? `<div class="approval-images">${signature ? `<figure><img src="${escapeHtml(signature)}" alt="Signature"><figcaption>Signature</figcaption></figure>` : ''}${stamp ? `<figure><img src="${escapeHtml(stamp)}" alt="Official stamp"><figcaption>Official stamp</figcaption></figure>` : ''}</div>` : ''}</section>`;
}

function openFinanceRecordPrint(record, type, endorsements = {}, printableWindow = null) {
  if (!record) return;
  const id = pick(record, type === 'bill' ? ['BillNo', '__id'] : ['ExpenseNo', '__id']);
  const isMaterial = type === 'requisition' && clean(record.RequisitionType).toLowerCase() === 'material';
  const heading = isMaterial ? 'Material Requisition' : type === 'bill' ? 'Supplier Bill' : 'Expense Requisition';
  const materialTable = isMaterial ? materialItemsTable(record.MaterialItems || record.Items, record.Amount) : '';
  const printable = printableWindow || window.open('', '_blank', 'width=900,height=720');
  if (!printable) {
    setStatus(document.getElementById('financeWorkflowStatus'), 'Allow pop-ups to view and print this request.', 'bad');
    return;
  }
  printable.opener = null;
  printable.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(heading)} ${escapeHtml(id)}</title><style>
    body{margin:32px;color:#102a43;font:13px Arial,sans-serif}h1{margin:0 0 4px;font-size:22px}.muted{color:#627d98}.summary{width:100%;margin:20px 0;border-collapse:collapse}.summary th,.summary td,.admin-table th,.admin-table td{padding:8px;border:1px solid #cbd7e5;text-align:left;vertical-align:top}.summary th,.admin-table th{background:#edf3f8;font-size:10px;text-transform:uppercase}.admin-table{width:100%;border-collapse:collapse}.admin-table-wrap{margin:14px 0}.material-grand-total-row th{border-top:2px solid #102a43;background:#e3edf6;font-size:12px}.material-grand-total-row th:first-child{text-align:right}.print-action{margin:0 0 20px;padding:8px 14px;border:0;border-radius:6px;background:#102a43;color:#fff}.notes{padding:10px;border-left:3px solid #19a7a0;background:#f5f8fb}.approval-block{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin-top:16px;padding:12px;border:1px solid #cbd7e5;border-radius:7px}.approval-block strong,.approval-block span,.approval-block small{display:block}.approval-block span{margin-top:4px}.approval-block small{margin-top:3px;color:#627d98}.approval-images{display:flex;align-items:flex-end;gap:18px}.approval-images figure{margin:0;text-align:center}.approval-images img{display:block;max-width:150px;max-height:70px;object-fit:contain}.approval-images figcaption{margin-top:3px;color:#627d98;font-size:9px;text-transform:uppercase}@media print{.print-action{display:none}body{margin:12mm}.approval-block{break-inside:avoid}}
  </style></head><body><button class="print-action" onclick="window.print()">Print</button><h1>${escapeHtml(heading)}</h1><p class="muted">${escapeHtml(id)} · ${escapeHtml(record.Status || 'Submitted')}</p>
  <table class="summary"><tbody>
    ${isMaterial
      ? `<tr><th>Description</th><td colspan="3">${escapeHtml(record.Description || '-')}</td></tr>`
      : `<tr><th>Description</th><td>${escapeHtml(record.Description || '-')}</td><th>Amount</th><td>${escapeHtml(money(record.Amount))}</td></tr>`}
    <tr><th>Department</th><td>${escapeHtml(record.Department || '-')}</td><th>Date</th><td>${escapeHtml(record.Date || '-')}</td></tr>
    <tr><th>${type === 'bill' ? 'Due Date' : 'Vendor'}</th><td>${escapeHtml(type === 'bill' ? (record.DueDate || '-') : (record.Vendor || '-'))}</td><th>Requested By</th><td>${escapeHtml(record.RequestedBy || record.CreatedBy || '-')}</td></tr>
    <tr><th>Approved By</th><td>${escapeHtml(record.ApprovedBy || '-')}</td><th>Approved At</th><td>${escapeHtml(record.ApprovedAt || '-')}</td></tr>
  </tbody></table>${materialTable}${record.Notes ? `<p class="notes"><strong>Notes:</strong> ${escapeHtml(record.Notes)}</p>` : ''}${record.ReviewNotes ? `<p class="notes"><strong>Review:</strong> ${escapeHtml(record.ReviewNotes)}</p>` : ''}
  ${approvalEndorsementBlock('Approved by', record.ApprovedBy, record.ApprovedAt, endorsements.approval)}
  ${approvalEndorsementBlock('Administrative approval', record.AdminReviewedBy, record.AdminReviewedAt, endorsements.admin)}
  ${approvalEndorsementBlock('Accounts review / posting', record.AccountsReviewedBy, record.AccountsReviewedAt, endorsements.accounts)}
  </body></html>`);
  printable.document.close();
  printable.focus();
  window.setTimeout(() => printable.print(), 250);
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
          <input name="recordId" type="hidden"><input name="recordVersion" type="hidden">
          <h3 data-requisition-form-heading>Expense Requisition</h3>
          <label>Description <span class="required">*</span><textarea name="description" rows="3" required></textarea></label>
          <label>Amount <span class="required">*</span><input name="amount" type="number" min="1" step="0.01" inputmode="decimal" data-finance-input required></label>
          <label>Preferred vendor<input name="vendor"></label>
          <label>Required date <span class="required">*</span><input name="date" type="date" required></label>
          <label>Reference<input name="reference"></label>
          <label>Supporting document URL<input name="attachmentUrl" type="url"></label>
          <label>Notes<textarea name="notes" rows="2"></textarea></label>
          <button type="submit" data-create-label="Submit Requisition">Submit Requisition</button>
          <p class="status" data-form-status></p>
        </form>
      </dialog>
      <dialog id="materialRequisitionDialog" class="workflow-dialog material-requisition-dialog">
        <div class="workflow-dialog-header"><div><small>${escapeHtml(department)}</small><h2>New Material Requisition</h2></div><button type="button" data-close-dialog aria-label="Close">&times;</button></div>
        <form id="materialRequisitionForm" class="workflow-form">
          <input name="recordId" type="hidden"><input name="recordVersion" type="hidden">
          <h3 data-requisition-form-heading>Material Items</h3>
          <label>Description <span class="required">*</span><textarea name="description" rows="2" required placeholder="State the purpose of this material request"></textarea></label>
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
                  <td><input data-material-field="unitPrice" aria-label="Unit price 1" type="number" min="0.01" step="0.01" inputmode="decimal" data-finance-input required></td>
                  <td><output data-material-line-total>₦0.00</output></td>
                </tr>
              </tbody>
              <tfoot><tr class="material-grand-total-row"><th colspan="5">Grand Total</th><th><output data-material-grand-total>₦0.00</output></th></tr></tfoot>
            </table>
          </div>
          <div class="material-entry-actions"><button type="button" data-add-material-item>+ Add Item</button></div>
          <label>Preferred vendor<input name="vendor"></label>
          <label>Required date <span class="required">*</span><input name="date" type="date" required></label>
          <label>Reference<input name="reference"></label>
          <label>Supporting document URL<input name="attachmentUrl" type="url"></label>
          <label>Notes<textarea name="notes" rows="2"></textarea></label>
          <button type="submit" data-create-label="Submit Material Requisition">Submit Material Requisition</button>
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
          <label>Amount <span class="required">*</span><input name="amount" type="number" min="1" step="0.01" inputmode="decimal" data-finance-input required></label>
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
        ${capabilities.canSubmit ? '<button type="button" data-open-dialog="requisitionDialog" title="New Requisition">+ Request</button><button type="button" class="workflow-secondary-action" data-open-dialog="materialRequisitionDialog" title="Material Requisition">+ Materials</button><button type="button" class="workflow-secondary-action" data-open-dialog="supplierBillDialog" title="Supplier Bill">+ Invoice</button>' : ''}
        <button type="button" class="workflow-icon-action finance-workflow-refresh" id="refreshFinanceWorkflow" aria-label="Refresh requests" title="Refresh"><span aria-hidden="true">&#8635;</span></button>
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
  const financeLists = [...panelEl.querySelectorAll(':scope > .workflow-list-section')];
  mountWorkspaceTabs('financeRequests', [
    { key: 'overview', label: 'Overview', icon: '\u25A6', nodes: [[...panelEl.querySelectorAll(':scope > p.status')], panelEl.querySelector(':scope > .workflow-kpis'), panelEl.querySelector(':scope > .workflow-ledger-heading')] },
    { key: 'requisitions', label: 'Requisitions', icon: '\u{1F4CB}', count: requisitions.length, nodes: financeLists[0] },
    { key: 'bills', label: 'Supplier bills', icon: '\u{1F9FE}', count: bills.length, nodes: financeLists[1] }
  ]);
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
      <td><input data-material-field="unitPrice" aria-label="Unit price ${index}" type="number" min="0.01" step="0.01" inputmode="decimal" data-finance-input required></td>
      <td><output data-material-line-total>₦0.00</output></td>
    </tr>
  `;
}

function materialRequisitionItems(form) {
  return [...form.querySelectorAll('[data-material-row]')].map((row) => ({
    item: clean(row.querySelector('[data-material-field="item"]')?.value),
    specification: clean(row.querySelector('[data-material-field="specification"]')?.value),
    quantity: Number(row.querySelector('[data-material-field="quantity"]')?.value || 0),
    unitPrice: financialNumber(row.querySelector('[data-material-field="unitPrice"]')?.value)
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
    const unitPrice = financialNumber(row.querySelector('[data-material-field="unitPrice"]').value);
    const lineTotal = Math.round((quantity * unitPrice + Number.EPSILON) * 100) / 100;
    grandTotal += lineTotal;
    row.querySelector('[data-material-line-total]').textContent = money(lineTotal);
  });
  form.querySelector('[data-material-grand-total]').textContent = money(grandTotal);
}

function resetRequisitionEditor(form) {
  if (!form) return;
  form.reset();
  form.elements.recordId.value = '';
  form.elements.recordVersion.value = '';
  const isMaterial = form.id === 'materialRequisitionForm';
  const heading = form.querySelector('[data-requisition-form-heading]');
  const submitButton = form.querySelector('button[type="submit"]');
  if (heading) heading.textContent = isMaterial ? 'Material Items' : 'Expense Requisition';
  if (submitButton) submitButton.textContent = submitButton.dataset.createLabel ||
    (isMaterial ? 'Submit Material Requisition' : 'Submit Requisition');
  setStatus(form.querySelector('[data-form-status]'), '');
  if (isMaterial) {
    const itemsBody = form.querySelector('[data-material-items]');
    itemsBody.innerHTML = materialEntryRow(1);
    updateMaterialRequisitionTable(form);
  }
  delete form.dataset.idempotencyKey;
}

function setRequisitionEditorValue(form, name, value) {
  const input = form?.elements?.[name];
  if (!input) return;
  if (input.matches('[data-finance-input]')) setFinancialInputValue(input, value);
  else input.value = clean(value);
}

function openRequisitionEditor(record) {
  if (!record) return;
  const isMaterial = clean(record.RequisitionType).toLowerCase() === 'material';
  const form = document.getElementById(isMaterial ? 'materialRequisitionForm' : 'requisitionForm');
  const dialog = form?.closest('dialog');
  if (!form || !dialog) return;
  resetRequisitionEditor(form);
  const id = pick(record, ['ExpenseNo', '__id']);
  setRequisitionEditorValue(form, 'recordId', id);
  setRequisitionEditorValue(form, 'recordVersion', record.__updateTime);
  setRequisitionEditorValue(form, 'description', record.Description);
  setRequisitionEditorValue(form, 'vendor', record.Vendor);
  setRequisitionEditorValue(form, 'date', clean(record.Date).slice(0, 10));
  setRequisitionEditorValue(form, 'reference', record.Reference);
  setRequisitionEditorValue(form, 'attachmentUrl', record.AttachmentUrl);
  setRequisitionEditorValue(form, 'notes', record.Notes);
  if (isMaterial) {
    const items = Array.isArray(record.MaterialItems) && record.MaterialItems.length
      ? record.MaterialItems
      : [{}];
    const itemsBody = form.querySelector('[data-material-items]');
    itemsBody.innerHTML = items.map((item, index) => materialEntryRow(index + 1)).join('');
    items.forEach((item, index) => {
      const row = itemsBody.querySelectorAll('[data-material-row]')[index];
      row.querySelector('[data-material-field="item"]').value = clean(item.Item ?? item.item);
      row.querySelector('[data-material-field="specification"]').value = clean(item.Specification ?? item.specification);
      row.querySelector('[data-material-field="quantity"]').value = Number(item.Quantity ?? item.quantity ?? 0) || '';
      setFinancialInputValue(row.querySelector('[data-material-field="unitPrice"]'), Number(item.UnitPrice ?? item.unitPrice ?? 0) || '');
    });
    updateMaterialRequisitionTable(form);
  } else {
    setRequisitionEditorValue(form, 'amount', record.Amount);
  }
  const revision = Number(record.RevisionNumber || 1);
  const heading = form.querySelector('[data-requisition-form-heading]');
  const submitButton = form.querySelector('button[type="submit"]');
  if (heading) heading.textContent = `Edit and resubmit ${id}`;
  if (submitButton) submitButton.textContent = 'Resubmit Requisition';
  setStatus(
    form.querySelector('[data-form-status]'),
    `Editing revision ${revision}. Resubmission archives this revision and resets approval and Accounts review.`
  );
  dialog.showModal();
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
    const idempotencyKey = form.dataset.idempotencyKey || newIdempotencyKey();
    form.dataset.idempotencyKey = idempotencyKey;
    const payload = { ...formPayload(form), items: materialRequisitionItems(form), idempotencyKey };
    const resubmitting = Boolean(clean(payload.recordId));
    const buttonLabel = resubmitting ? 'Resubmit Requisition' : 'Submit Material Requisition';
    setButtonLoading(button, true, 'Submitting...', buttonLabel);
    setStatus(status, 'Saving to database...');
    try {
      if (resubmitting) await financeRequest('resubmitRequisition', payload);
      else await financeRequest('submitMaterialRequisition', payload);
      delete form.dataset.idempotencyKey;
      setStatus(status, resubmitting ? 'Requisition edited and resubmitted.' : 'Material requisition submitted.', 'ok');
      await loadFinanceWorkflow();
    } catch (error) {
      if (error?.responseReceived) delete form.dataset.idempotencyKey;
      setStatus(status, error.message || String(error), 'bad');
    } finally {
      setButtonLoading(button, false, 'Submitting...', buttonLabel);
    }
  });
  form.addEventListener('input', () => {
    if (!form.querySelector('button[type="submit"]')?.disabled) delete form.dataset.idempotencyKey;
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
    const initiallyResubmitting = action === 'submitRequisition' && clean(form.elements.recordId?.value);
    button.dataset.normalText = initiallyResubmitting
      ? 'Resubmit Requisition'
      : action === 'submitBill' ? 'Submit Supplier Bill' : 'Submit Requisition';
    setButtonLoading(button, true, 'Submitting...', button.dataset.normalText);
    setStatus(status, 'Saving to database...');
    try {
      const idempotencyKey = form.dataset.idempotencyKey || newIdempotencyKey();
      form.dataset.idempotencyKey = idempotencyKey;
      const payload = { ...formPayload(form), idempotencyKey };
      const effectiveAction = action === 'submitRequisition' && clean(payload.recordId)
        ? 'resubmitRequisition'
        : action;
      await financeRequest(effectiveAction, payload);
      delete form.dataset.idempotencyKey;
      form.reset();
      setStatus(status, effectiveAction === 'resubmitRequisition' ? 'Requisition edited and resubmitted.' : successText, 'ok');
      await loadFinanceWorkflow();
    } catch (error) {
      if (error?.responseReceived) delete form.dataset.idempotencyKey;
      setStatus(status, error.message || String(error), 'bad');
    } finally {
      setButtonLoading(button, false, 'Submitting...', button.dataset.normalText);
    }
  });
  form.addEventListener('input', () => {
    if (!form.querySelector('button[type="submit"]')?.disabled) delete form.dataset.idempotencyKey;
  });
}

function bindFinanceWorkflowEvents() {
  document.getElementById('refreshFinanceWorkflow')?.addEventListener('click', (event) => {
    runButtonAction(event.currentTarget, 'Refreshing...', loadFinanceWorkflow);
  });
  panelEl.querySelectorAll('[data-open-dialog]').forEach((button) => {
    button.addEventListener('click', () => {
      const dialog = document.getElementById(button.dataset.openDialog);
      if (['requisitionDialog', 'materialRequisitionDialog'].includes(button.dataset.openDialog)) {
        resetRequisitionEditor(dialog?.querySelector('form'));
      }
      dialog?.showModal();
    });
  });
  panelEl.querySelectorAll('[data-close-dialog]').forEach((button) => {
    button.addEventListener('click', () => button.closest('dialog')?.close());
  });
  bindSubmissionForm('requisitionForm', 'submitRequisition', 'Requisition submitted.');
  bindMaterialRequisitionForm();
  bindSubmissionForm('supplierBillForm', 'submitBill', 'Supplier bill submitted.');
  panelEl.querySelectorAll('[data-print-finance-record]').forEach((button) => {
    button.addEventListener('click', async () => {
      const type = button.dataset.recordType;
      const printable = window.open('', '_blank', 'width=900,height=720');
      if (!printable) {
        setStatus(document.getElementById('financeWorkflowStatus'), 'Allow pop-ups to view and print this request.', 'bad');
        return;
      }
      printable.document.write('<p style="font:14px Arial;padding:24px">Loading document...</p>');
      try {
        const data = await financeRequest('document', {
          recordType: type,
          recordId: button.dataset.printFinanceRecord
        });
        openFinanceRecordPrint(data.record, type, data.endorsements || {}, printable);
      } catch (error) {
        printable.close();
        setStatus(document.getElementById('financeWorkflowStatus'), error.message || String(error), 'bad');
      }
    });
  });
  panelEl.querySelectorAll('[data-workflow-action]').forEach((button) => {
    button.addEventListener('click', () => openFinanceDecision(button));
  });
  panelEl.querySelectorAll('[data-edit-requisition]').forEach((button) => {
    button.addEventListener('click', () => {
      const record = (financeData?.requisitions || []).find((row) =>
        clean(pick(row, ['ExpenseNo', '__id'])) === clean(button.dataset.editRequisition));
      openRequisitionEditor(record);
    });
  });
}

async function loadFinanceWorkflow() {
  if (activeSection !== 'financeRequests') return;
  try {
    financeData = await financeRequest('list');
    renderModuleSummary('financeRequests', financeData);
    renderFinanceWorkflow();
  } catch (error) {
    if (activeSection === 'financeRequests') panelEl.innerHTML = `<p class="status bad">${escapeHtml(error.message || String(error))}</p>`;
  }
}

async function dataBackupRequest(action, payload = {}) {
  const response = await staffFetch('/api/data-backup', {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload })
  });
  const data = await response.json().catch(() => ({ ok: false, message: 'Backup service did not return JSON.' }));
  if (response.status === 401) showLogin(data.message || 'Your staff session has expired.', 'bad');
  if (!response.ok || !data.ok) throw new Error(data.message || 'Backup or restore failed.');
  return data;
}

function setDataBackupStatus(message = '', tone = '') {
  const status = document.getElementById('dataBackupStatus');
  if (!status) return;
  status.textContent = message;
  status.className = `status${tone ? ` ${tone}` : ''}`;
}

function dataBackupProgress(label, current, total) {
  const progress = document.getElementById('dataBackupProgress');
  const bar = document.getElementById('dataBackupProgressBar');
  if (!progress || !bar) return;
  progress.hidden = false;
  const percent = total > 0 ? Math.min(100, Math.round(current / total * 100)) : 0;
  bar.style.width = `${percent}%`;
  progress.querySelector('span').textContent = `${label} ${current.toLocaleString()} of ${total.toLocaleString()}`;
}

function hideDataBackupProgress() {
  const progress = document.getElementById('dataBackupProgress');
  if (progress) progress.hidden = true;
}

function base64FromBytes(bytes) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

function bytesFromBase64(value) {
  const binary = atob(String(value || ''));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function deriveBackupEncryptionKey(password, salt, iterations = 250000) {
  const material = await window.crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return window.crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, material, {
    name: 'AES-GCM', length: 256
  }, false, ['encrypt', 'decrypt']);
}

async function encryptOrganizationBackup(payload, password) {
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const iterations = 250000;
  const key = await deriveBackupEncryptionKey(password, salt, iterations);
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = new Uint8Array(await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded));
  return {
    format: 'dynamax-encrypted-backup',
    envelopeVersion: 1,
    createdAt: payload.createdAt,
    workspaceId: payload.workspaceId,
    edition: payload.edition,
    encryption: {
      algorithm: 'AES-GCM',
      keyDerivation: 'PBKDF2-SHA256',
      iterations,
      salt: base64FromBytes(salt),
      iv: base64FromBytes(iv)
    },
    ciphertext: base64FromBytes(ciphertext)
  };
}

async function decryptOrganizationBackup(envelope, password) {
  if (clean(envelope?.format) === 'dynamax-organization-backup') return envelope;
  if (clean(envelope?.format) !== 'dynamax-encrypted-backup') throw new Error('This is not a Dynamax backup file.');
  try {
    const salt = bytesFromBase64(envelope.encryption?.salt);
    const iv = bytesFromBase64(envelope.encryption?.iv);
    const ciphertext = bytesFromBase64(envelope.ciphertext);
    const key = await deriveBackupEncryptionKey(password, salt, Number(envelope.encryption?.iterations || 250000));
    const plaintext = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch (_error) {
    throw new Error('The backup password is incorrect, or the file has been altered.');
  }
}

function downloadBackupFile(envelope, suffix = 'backup') {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const workspace = clean(envelope.workspaceId || 'organisation').replace(/[^a-z0-9._-]+/gi, '-');
  const url = URL.createObjectURL(new Blob([JSON.stringify(envelope)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${workspace}-${suffix}-${stamp}.dynamax-backup.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function collectOrganizationBackup(progressLabel = 'Backing up') {
  const collections = {};
  let cursor = 0;
  let pageToken = '';
  let total = 0;
  let identity = null;
  let createdAt = '';
  for (let part = 0; part < 10000; part += 1) {
    const data = await dataBackupRequest('export', { cursor, pageToken });
    identity ||= data.identity || null;
    createdAt ||= data.exportedAt || new Date().toISOString();
    Object.entries(data.collections || {}).forEach(([path, rows]) => {
      if (!Array.isArray(rows)) throw new Error(`Backup data for ${path} is invalid.`);
      if (!collections[path]) collections[path] = [];
      collections[path].push(...rows);
    });
    const meta = data.backup || {};
    total = Number(meta.totalCollections || total || Object.keys(collections).length);
    const completed = meta.complete ? total : Number(meta.nextCursor ?? cursor);
    dataBackupProgress(progressLabel, Math.min(completed, total), total);
    if (meta.complete === true) {
      return {
        format: 'dynamax-organization-backup',
        formatVersion: Number(meta.version || 3),
        createdAt,
        workspaceId: clean(identity?.workspaceId),
        edition: clean(identity?.edition),
        collections
      };
    }
    const nextCursor = Number(meta.nextCursor);
    const nextPageToken = clean(meta.nextPageToken);
    if (!Number.isFinite(nextCursor) || nextCursor < cursor || (nextCursor === cursor && !nextPageToken)) {
      throw new Error('The backup service did not provide a valid continuation.');
    }
    if (nextCursor === cursor && nextPageToken === pageToken) throw new Error('The backup service repeated the same continuation.');
    cursor = nextCursor;
    pageToken = nextPageToken;
  }
  throw new Error('The backup exceeded the safe continuation limit.');
}

function backupDocumentCount(payload) {
  return Object.values(payload?.collections || {}).reduce((sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0);
}

function renderSelectedBackupSummary() {
  const summary = document.getElementById('selectedBackupSummary');
  if (!summary) return;
  if (!dataBackupState.envelope) {
    summary.hidden = true;
    summary.innerHTML = '';
    return;
  }
  const envelope = dataBackupState.envelope;
  summary.hidden = false;
  summary.innerHTML = `<strong>${escapeHtml(dataBackupState.fileName || 'Selected backup')}</strong><span>Created ${escapeHtml(securityAuditDateTime(envelope.createdAt) || 'date unavailable')}</span><span>${escapeHtml(envelope.workspaceId || 'Workspace identity is encrypted')}</span><small>Enter the backup password below to verify its contents before restore.</small>`;
}

function chunkRestoreRows(rows, maxRows = 100, maxBytes = 5 * 1024 * 1024) {
  const chunks = [];
  let current = [];
  let bytes = 0;
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const rowBytes = new TextEncoder().encode(JSON.stringify(row)).length;
    if (current.length && (current.length >= maxRows || bytes + rowBytes > maxBytes)) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(row);
    bytes += rowBytes;
  });
  if (current.length) chunks.push(current);
  return chunks;
}

async function restoreOrganizationBackup(payload, password) {
  const entries = Object.entries(payload.collections || {});
  if (!entries.length) throw new Error('The selected backup contains no collections.');
  setDataBackupStatus('Creating the mandatory pre-restore safety backup...');
  const safetyPayload = await collectOrganizationBackup('Safety backup');
  const safetyEnvelope = await encryptOrganizationBackup(safetyPayload, password);
  downloadBackupFile(safetyEnvelope, 'pre-restore-safety-backup');
  const prepared = await dataBackupRequest('prepare-restore', {
    manifest: {
      format: payload.format,
      formatVersion: payload.formatVersion,
      createdAt: payload.createdAt,
      workspaceId: payload.workspaceId,
      edition: payload.edition
    },
    collectionPaths: entries.map(([path]) => path),
    safetyBackupCreated: true
  });
  let collectionIndex = 0;
  for (const [collectionPath, rows] of entries) {
    collectionIndex += 1;
    setDataBackupStatus(`Restoring ${collectionPath} (${collectionIndex} of ${entries.length})...`);
    dataBackupProgress('Restoring collections', collectionIndex - 1, entries.length);
    for (let clearPass = 0; clearPass < 10000; clearPass += 1) {
      const cleared = await dataBackupRequest('clear-collection', { jobId: prepared.jobId, collectionPath });
      if (!cleared.more) break;
      if (clearPass === 9999) throw new Error(`Could not finish clearing ${collectionPath}.`);
    }
    for (const documents of chunkRestoreRows(rows)) {
      await dataBackupRequest('write-collection', { jobId: prepared.jobId, collectionPath, documents });
    }
    dataBackupProgress('Restoring collections', collectionIndex, entries.length);
  }
  return dataBackupRequest('complete-restore', { jobId: prepared.jobId });
}

function renderDataBackup() {
  if (clean(currentUser?.role) !== 'Super Admin') {
    panelEl.innerHTML = '<p class="status bad">Only a Super Administrator can access Backup &amp; Restore.</p>';
    return;
  }
  panelEl.innerHTML = `
    <section class="data-backup-workspace">
      <div class="workflow-intro data-backup-heading">
        <div><p class="eyebrow">Data protection</p><h2>Backup &amp; Restore</h2><p class="muted">Download an encrypted copy of the organisation database or return operational records to a previous backup.</p></div>
        <span class="data-backup-admin-badge">Super Administrator only</span>
      </div>
      <div class="data-backup-warning"><strong>Keep backup files and passwords secure.</strong><span>They contain personal and financial records. Uploaded Google Drive documents remain in Drive; their database records and links are backed up.</span></div>
      <div class="data-backup-grid">
        <article class="data-backup-card">
          <span class="data-backup-card-icon" aria-hidden="true">&#8681;</span>
          <div><p class="eyebrow">Create recovery point</p><h3>Download encrypted backup</h3><p>Captures every current operational collection, branch and school section. Temporary request locks are excluded.</p></div>
          <label>Backup password <input id="newBackupPassword" type="password" minlength="10" autocomplete="new-password" placeholder="At least 10 characters"></label>
          <label>Confirm password <input id="confirmBackupPassword" type="password" minlength="10" autocomplete="new-password" placeholder="Repeat the password"></label>
          <button type="button" id="downloadDataBackup">Download backup</button>
        </article>
        <article class="data-backup-card data-backup-restore-card">
          <span class="data-backup-card-icon" aria-hidden="true">&#8634;</span>
          <div><p class="eyebrow">Disaster recovery</p><h3>Restore a previous backup</h3><p>Replaces records in the selected backup collections. A fresh encrypted safety backup downloads automatically before changes begin.</p></div>
          <label class="data-backup-file-label">Backup file <input id="restoreBackupFile" type="file" accept=".json,.dynamax-backup.json,application/json"></label>
          <div id="selectedBackupSummary" class="selected-backup-summary" hidden></div>
          <label>Backup password <input id="restoreBackupPassword" type="password" minlength="10" autocomplete="current-password" placeholder="Password used for this backup"></label>
          <button type="button" id="restoreDataBackup" class="danger" disabled>Restore selected backup</button>
        </article>
      </div>
      <div id="dataBackupProgress" class="data-backup-progress" hidden><i><b id="dataBackupProgressBar"></b></i><span></span></div>
      <p id="dataBackupStatus" class="status" role="status" aria-live="polite"></p>
      <aside class="data-backup-notes"><strong>Recovery safeguards</strong><ul><li>The backup must match this workspace and organisation edition.</li><li>The currently signed-in Super Administrator account and deployment/subscription identity are preserved.</li><li>Restore activity is written to the Security Audit Log.</li></ul></aside>
    </section>`;
  renderModuleSummary('dataBackup', true);
  renderSelectedBackupSummary();
  document.getElementById('downloadDataBackup')?.addEventListener('click', async (event) => {
    const password = document.getElementById('newBackupPassword').value;
    const confirmation = document.getElementById('confirmBackupPassword').value;
    if (password.length < 10) return setDataBackupStatus('Use a backup password of at least 10 characters.', 'bad');
    if (password !== confirmation) return setDataBackupStatus('The backup passwords do not match.', 'bad');
    const button = event.currentTarget;
    setButtonLoading(button, true, 'Preparing...', 'Download backup');
    dataBackupState.busy = true;
    try {
      setDataBackupStatus('Collecting organisation records...');
      const payload = await collectOrganizationBackup();
      setDataBackupStatus('Encrypting the backup on this device...');
      const envelope = await encryptOrganizationBackup(payload, password);
      downloadBackupFile(envelope);
      setDataBackupStatus(`Backup downloaded: ${Object.keys(payload.collections).length.toLocaleString()} collections and ${backupDocumentCount(payload).toLocaleString()} records.`, 'good');
    } catch (error) {
      setDataBackupStatus(error.message || String(error), 'bad');
    } finally {
      dataBackupState.busy = false;
      hideDataBackupProgress();
      if (button.isConnected) setButtonLoading(button, false, 'Preparing...', 'Download backup');
    }
  });
  document.getElementById('restoreBackupFile')?.addEventListener('change', async (event) => {
    dataBackupState.envelope = null;
    dataBackupState.fileName = '';
    const button = document.getElementById('restoreDataBackup');
    button.disabled = true;
    const file = event.target.files?.[0];
    if (!file) return renderSelectedBackupSummary();
    try {
      if (file.size > 250 * 1024 * 1024) throw new Error('This backup file exceeds the 250 MB browser restore limit. Use the desktop recovery tool for larger archives.');
      const envelope = JSON.parse(await file.text());
      if (!['dynamax-encrypted-backup', 'dynamax-organization-backup'].includes(clean(envelope.format))) throw new Error('This is not a Dynamax backup file.');
      dataBackupState.envelope = envelope;
      dataBackupState.fileName = file.name;
      button.disabled = false;
      setDataBackupStatus('Backup file selected. Enter its password to verify and restore it.');
    } catch (error) {
      setDataBackupStatus(error.message || String(error), 'bad');
    }
    renderSelectedBackupSummary();
  });
  document.getElementById('restoreDataBackup')?.addEventListener('click', async (event) => {
    const password = document.getElementById('restoreBackupPassword').value;
    if (password.length < 10) return setDataBackupStatus('Enter the backup password of at least 10 characters.', 'bad');
    const confirmation = await window.DynamaxDialogs.prompt({
      title: 'Restore organisation data',
      message: 'This replaces current records with the selected recovery point. A safety backup will download first. Type RESTORE to continue.',
      label: 'Confirmation', placeholder: 'RESTORE', required: true, maxLength: 20,
      tone: 'danger', confirmText: 'Continue to restore'
    });
    if (clean(confirmation).toUpperCase() !== 'RESTORE') {
      if (confirmation !== null) setDataBackupStatus('Restore cancelled because the confirmation text did not match.', 'bad');
      return;
    }
    const button = event.currentTarget;
    setButtonLoading(button, true, 'Restoring...', 'Restore selected backup');
    dataBackupState.busy = true;
    try {
      setDataBackupStatus('Decrypting and verifying the selected backup...');
      const payload = await decryptOrganizationBackup(dataBackupState.envelope, password);
      const result = await restoreOrganizationBackup(payload, password);
      setDataBackupStatus(result.message || 'Organisation data restored successfully.', 'good');
      await window.DynamaxDialogs.alert({ title: 'Restore completed', message: 'The organisation database has been restored. Reload the portal to use the restored records.', confirmText: 'Reload portal' });
      window.location.reload();
    } catch (error) {
      setDataBackupStatus(`${error.message || String(error)} The downloaded safety backup can be used to recover the state from before this attempt.`, 'bad');
    } finally {
      dataBackupState.busy = false;
      hideDataBackupProgress();
      if (button.isConnected) setButtonLoading(button, false, 'Restoring...', 'Restore selected backup');
    }
  });
}

async function securityAuditRequest(action = 'list', payload = {}) {
  const response = await staffFetch('/api/security-audit', {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload })
  });
  const data = await response.json().catch(() => ({ ok: false, message: 'Security audit did not return JSON.' }));
  if (response.status === 401) showLogin(data.message || 'Your staff session has expired.', 'bad');
  if (!response.ok || !data.ok) throw new Error(data.message || 'Security audit action failed.');
  return data;
}

function securityAuditDefaultDate(daysAgo = 30) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

function securityAuditOption(value, selected = '') {
  return `<option value="${escapeHtml(value)}"${clean(value) === clean(selected) ? ' selected' : ''}>${escapeHtml(value)}</option>`;
}

function securityAuditFilteredRows() {
  const filters = securityAuditData.filters || {};
  const search = lower(filters.search);
  return (securityAuditData.rows || []).filter((row) => {
    const user = lower(filters.user);
    const userMatch = !user || [row.ActorUsername, row.Actor, row.Subject].some((value) => lower(value) === user);
    const searchMatch = !search || [
      row.Action, row.Module, row.Actor, row.ActorUsername, row.Subject, row.ActorRole,
      row.EntityType, row.EntityId, row.BranchId, row.SourcePlatform, row.Details, row.Route
    ].some((value) => lower(value).includes(search));
    return (!filters.action || clean(row.Action) === clean(filters.action))
      && userMatch
      && (!filters.module || clean(row.Module) === clean(filters.module))
      && (!filters.outcome || clean(row.Outcome) === clean(filters.outcome))
      && (!filters.source || clean(row.SourcePlatform) === clean(filters.source))
      && (!filters.branchId || clean(row.BranchId) === clean(filters.branchId))
      && searchMatch;
  });
}

function securityAuditDateTime(value) {
  if (!clean(value)) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? clean(value) : parsed.toLocaleString();
}

function securityAuditDetail(row) {
  const entity = [clean(row.EntityType), clean(row.EntityId)].filter(Boolean).join(' / ');
  const details = [entity, clean(row.Details), clean(row.Route)].filter(Boolean);
  return details.length ? details.join(' | ') : '—';
}

function securityAuditRowsHtml(rows) {
  return rows.length ? rows.map((row) => `
    <tr>
      <td>${escapeHtml(securityAuditDateTime(row.Timestamp))}</td>
      <td><strong>${escapeHtml(row.Action || 'Platform action')}</strong></td>
      <td>${escapeHtml(row.Module || 'Platform operations')}</td>
      <td><strong>${escapeHtml(row.Actor || row.ActorUsername || 'System')}</strong>${row.ActorUsername && row.ActorUsername !== row.Actor ? `<small>${escapeHtml(row.ActorUsername)}</small>` : ''}${row.ActorRole ? `<small>${escapeHtml(row.ActorRole)}</small>` : ''}</td>
      <td>${escapeHtml(row.Subject || '—')}</td>
      <td><span class="security-audit-outcome is-${escapeHtml(lower(row.Outcome || 'success'))}">${escapeHtml(row.Outcome || 'Success')}</span></td>
      <td>${escapeHtml(row.BranchId || 'main')}</td>
      <td>${escapeHtml(row.SourcePlatform || 'Web')}</td>
      <td title="${escapeHtml(securityAuditDetail(row))}">${escapeHtml(securityAuditDetail(row))}</td>
    </tr>`).join('') : '<tr><td colspan="9">No audit actions match the selected filters.</td></tr>';
}

function updateSecurityAuditTable() {
  if (activeSection !== 'securityAudit') return;
  const rows = securityAuditFilteredRows();
  const body = panelEl.querySelector('[data-security-audit-rows]');
  const count = panelEl.querySelector('[data-security-audit-count]');
  if (body) body.innerHTML = securityAuditRowsHtml(rows);
  if (count) {
    count.textContent = `${rows.length.toLocaleString()} matching action${rows.length === 1 ? '' : 's'}${securityAuditData.truncated ? ' (source result limit reached)' : ''}`;
  }
  renderModuleSummary('securityAudit', { rows });
}

function renderSecurityAudit() {
  if (activeSection !== 'securityAudit') return;
  const facets = securityAuditData.facets || {};
  const filters = securityAuditData.filters || {};
  const rows = securityAuditFilteredRows();
  panelEl.innerHTML = `
    <section class="security-audit-workspace">
      <div class="workflow-intro security-audit-heading">
        <div><p class="eyebrow">Governance &amp; accountability</p><h2>Aggregated Security Audit Log</h2><p class="muted">A read-only record of authenticated web and desktop activity, sign-in attempts, approvals and operational changes.</p></div>
        <div class="security-audit-actions"><button type="button" id="refreshSecurityAudit" class="secondary">Refresh</button><button type="button" id="printSecurityAudit">Print filtered log</button></div>
      </div>
      <div class="security-audit-print-heading">
        <strong>${escapeHtml(clean(document.querySelector('[data-school-name]')?.textContent) || 'Organisation')}</strong>
        <span>Security Audit Report · ${escapeHtml(securityAuditData.fromDate)} to ${escapeHtml(securityAuditData.toDate)}</span>
      </div>
      <form id="securityAuditFilters" class="security-audit-filters">
        <label>From<input type="date" name="fromDate" value="${escapeHtml(securityAuditData.fromDate)}" required></label>
        <label>To<input type="date" name="toDate" value="${escapeHtml(securityAuditData.toDate)}" required></label>
        <label>Action<select name="action"><option value="">All actions</option>${(facets.actions || []).map((value) => securityAuditOption(value, filters.action)).join('')}</select></label>
        <label>User<select name="user"><option value="">All users</option>${(facets.users || []).map((value) => securityAuditOption(value, filters.user)).join('')}</select></label>
        <label>Module<select name="module"><option value="">All modules</option>${(facets.modules || []).map((value) => securityAuditOption(value, filters.module)).join('')}</select></label>
        <label>Outcome<select name="outcome"><option value="">All outcomes</option>${(facets.outcomes || []).map((value) => securityAuditOption(value, filters.outcome)).join('')}</select></label>
        <label>Source<select name="source"><option value="">All sources</option>${(facets.sources || []).map((value) => securityAuditOption(value, filters.source)).join('')}</select></label>
        <label>Branch<select name="branchId"><option value="">All permitted branches</option>${(facets.branches || []).map((value) => securityAuditOption(value, filters.branchId)).join('')}</select></label>
        <label class="security-audit-search">Search<input type="search" name="search" value="${escapeHtml(filters.search)}" placeholder="Action, person, reference or details"></label>
        <div class="security-audit-filter-actions"><button type="submit">Apply dates</button><button type="button" id="resetSecurityAuditFilters" class="secondary">Clear filters</button></div>
      </form>
      ${(securityAuditData.warnings || []).length ? `<p class="status bad security-audit-warning"><strong>Incomplete audit result:</strong> ${escapeHtml(securityAuditData.warnings.join(' '))}</p>` : ''}
      <div class="security-audit-result-bar"><strong data-security-audit-count>${rows.length.toLocaleString()} matching action${rows.length === 1 ? '' : 's'}</strong><span>Audit records are immutable from this page. Sensitive passwords, PINs and tokens are never captured.</span></div>
      <div class="admin-table-wrap security-audit-table-wrap">
        <table class="admin-table security-audit-table">
          <thead><tr><th>Date &amp; time</th><th>Action</th><th>Module</th><th>User</th><th>Subject</th><th>Outcome</th><th>Branch</th><th>Source</th><th>Details</th></tr></thead>
          <tbody data-security-audit-rows>${securityAuditRowsHtml(rows)}</tbody>
        </table>
      </div>
    </section>`;
  const form = document.getElementById('securityAuditFilters');
  form?.querySelectorAll('select').forEach((select) => {
    select.addEventListener('change', () => {
      securityAuditData.filters[select.name] = select.value;
      updateSecurityAuditTable();
    });
  });
  form?.querySelector('[name="search"]')?.addEventListener('input', (event) => {
    securityAuditData.filters.search = event.currentTarget.value;
    updateSecurityAuditTable();
  });
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = new FormData(form);
    securityAuditData.fromDate = clean(values.get('fromDate'));
    securityAuditData.toDate = clean(values.get('toDate'));
    await loadSecurityAudit(true);
  });
  document.getElementById('resetSecurityAuditFilters')?.addEventListener('click', () => {
    securityAuditData.filters = { action: '', user: '', module: '', outcome: '', source: '', branchId: '', search: '' };
    renderSecurityAudit();
  });
  document.getElementById('refreshSecurityAudit')?.addEventListener('click', (event) => {
    runButtonAction(event.currentTarget, 'Refreshing...', () => loadSecurityAudit(true));
  });
  document.getElementById('printSecurityAudit')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    if (!securityAuditFilteredRows().length) return;
    setButtonLoading(button, true, 'Preparing...', 'Print filtered log');
    try {
      await securityAuditRequest('print', {
        ...securityAuditData.filters,
        actionFilter: securityAuditData.filters.action,
        fromDate: securityAuditData.fromDate,
        toDate: securityAuditData.toDate
      });
      document.body.classList.add('security-audit-print');
      window.addEventListener('afterprint', () => document.body.classList.remove('security-audit-print'), { once: true });
      window.print();
    } catch (error) {
      setStatus(dashboardStatus, error.message || String(error), 'bad');
    } finally {
      if (button.isConnected) setButtonLoading(button, false, 'Preparing...', 'Print filtered log');
    }
  });
  renderModuleSummary('securityAudit', { rows });
}

async function loadSecurityAudit(preserveDates = false) {
  if (activeSection !== 'securityAudit') return;
  if (!preserveDates || !securityAuditData.fromDate || !securityAuditData.toDate) {
    securityAuditData.fromDate = securityAuditData.fromDate || securityAuditDefaultDate(30);
    securityAuditData.toDate = securityAuditData.toDate || new Date().toISOString().slice(0, 10);
  }
  try {
    const data = await securityAuditRequest('list', {
      fromDate: securityAuditData.fromDate,
      toDate: securityAuditData.toDate,
      limit: 1500
    });
    securityAuditData = {
      ...securityAuditData,
      rows: data.rows || [],
      facets: data.facets || {},
      warnings: data.warnings || [],
      fromDate: data.fromDate || securityAuditData.fromDate,
      toDate: data.toDate || securityAuditData.toDate,
      totalMatches: Number(data.totalMatches || 0),
      truncated: data.truncated === true
    };
    renderSecurityAudit();
  } catch (error) {
    if (activeSection === 'securityAudit') panelEl.innerHTML = `<p class="status bad">${escapeHtml(error.message || String(error))}</p>`;
  }
}

async function staffUserRequest(action, payload = {}) {
  const response = await staffFetch('/api/staff-users', {
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

function staffMfaAccount(username = '') {
  const key = clean(username).toLowerCase();
  return (staffMfaAdminData?.accounts || []).find((account) => clean(account.username).toLowerCase() === key) || null;
}

function staffMfaAccountLabel(username = '') {
  const account = staffMfaAccount(username);
  if (!account) return 'Two-factor not enrolled';
  const methods = [];
  if (account.totpActive) methods.push('Authenticator');
  if (Number(account.passkeyCount || 0) > 0) methods.push(`${Number(account.passkeyCount)} passkey${Number(account.passkeyCount) === 1 ? '' : 's'}`);
  if (!methods.length) return 'Two-factor not enrolled';
  return `${methods.join(' + ')} • ${Number(account.recoveryCodesRemaining || 0)} recovery code${Number(account.recoveryCodesRemaining || 0) === 1 ? '' : 's'}`;
}

function updateMfaPolicyEditor() {
  const mode = document.getElementById('staffMfaPolicyMode');
  if (!mode) return;
  const policy = staffMfaAdminData?.policy || {};
  const roleGroup = document.getElementById('staffMfaPolicyRoles');
  const grace = document.getElementById('staffMfaPolicyGrace');
  const requiredMode = ['REQUIRED_ROLES', 'REQUIRED_ALL'].includes(mode.value);
  if (roleGroup) roleGroup.hidden = mode.value !== 'REQUIRED_ROLES';
  if (grace) grace.disabled = !requiredMode;
  const timing = document.getElementById('staffMfaPolicyTiming');
  if (timing) {
    timing.textContent = policy.EnforceFrom && requiredMode
      ? `Current enforcement begins ${new Date(policy.EnforceFrom).toLocaleString()}. Saving a changed required policy starts a new grace period.`
      : requiredMode
        ? 'Saving this policy starts the selected grace period.'
        : 'Existing enrolled staff remain protected when the policy is optional. Disabled mode bypasses two-factor sign-in.';
  }
}

function renderStaffUsers() {
  if (activeSection !== 'staffUsers') return;
  const activeUsers = staffUsersData.filter((user) => yes(user.Active)).length;
  const admins = staffUsersData.filter((user) => user.Role === 'Super Admin' && yes(user.Active)).length;
  const schoolEdition = resolveDashboardEdition(currentUser || {}) === 'school';
  const availableRoles = Object.keys(staffRoleAccessData?.roles || {}).length
    ? Object.keys(staffRoleAccessData.roles)
    : staffRolesForEdition();
  const permissionTabs = webTabsForEdition();
  const policyRoles = staffRoleAccessData?.roles || {};
  const policyModules = Array.isArray(staffRoleAccessData?.modules) && staffRoleAccessData.modules.length
    ? staffRoleAccessData.modules
    : permissionTabs.map(([key, label]) => ({ key, label }));
  if (!availableRoles.includes(staffRoleAccessSelectedRole)) staffRoleAccessSelectedRole = availableRoles[0] || '';
  const policyScope = clean(staffRoleAccessData?.scope || 'global');
  const mfaPolicy = staffMfaAdminData?.policy || { Mode: 'OPTIONAL', RequiredRoles: [], GraceDays: 7, EnforceFrom: '' };
  const mfaPolicyRoles = new Set(mfaPolicy.RequiredRoles || []);
  const resettableStaff = staffUsersData.filter((user) => clean(user.Username).toLowerCase() !== clean(currentUser?.username).toLowerCase());
  const canManageMfaPolicy = clean(currentUser?.role) === 'Super Admin';
  panelEl.innerHTML = `
    <div class="workflow-intro">
      <div><p class="eyebrow">Identity & access</p><h2>Staff & Permissions</h2><p class="muted">Shared database accounts for desktop and web access</p></div>
      <div class="workflow-primary-actions"><button type="button" id="newStaffUser">+ New Staff Account</button><button type="button" id="uploadStaffCsv">Upload Staff CSV</button><button type="button" class="workflow-icon-action" id="staffCsvTemplate">CSV Template</button><button type="button" class="workflow-icon-action" id="refreshStaffUsers">Refresh</button><input type="file" id="staffCsvFile" accept=".csv,text/csv" hidden></div>
    </div>
    <p id="staffUsersStatus" class="status"></p>
    <div class="workflow-kpis staff-user-kpis">
      <div><small>Total Accounts</small><strong>${staffUsersData.length}</strong><span>Database staff users</span></div>
      <div><small>Active</small><strong>${activeUsers}</strong><span>Can sign in</span></div>
      <div><small>Super Admins</small><strong>${admins}</strong><span>Active administrators</span></div>
      <div><small>Disabled</small><strong>${staffUsersData.length - activeUsers}</strong><span>Access blocked</span></div>
    </div>
    <div class="staff-user-list">
      ${staffUsersData.length ? staffUsersData.map((user) => `
        <article class="staff-user-row">
          <div class="staff-user-avatar">${escapeHtml((user.DisplayName || user.Username || 'U').split(/\s+/).slice(0,2).map((part) => part[0]).join('').toUpperCase())}</div>
          <div class="staff-user-copy"><strong>${escapeHtml(user.DisplayName || user.LoginUsername || user.Username)}</strong><span>@${escapeHtml(user.LoginUsername || user.Username)} • ${escapeHtml(user.Role)}</span><small>${escapeHtml(user.Department || 'No department')} • ${escapeHtml(user.BranchId || 'All branches')}${schoolEdition ? ` / ${escapeHtml(user.SchoolSectionAccess || 'All sections')}` : ''}${yes(user.MustChangePassword) ? ' • Password change required' : ''}</small><small class="staff-mfa-account-state">${escapeHtml(staffMfaAccountLabel(user.Username))}</small></div>
          <span class="workflow-status ${yes(user.Active) ? 'status-approved' : 'status-rejected'}">${yes(user.Active) ? 'Active' : 'Disabled'}</span>
          <div class="staff-user-actions"><button type="button" class="compact-icon-action compact-edit-action" data-edit-user="${escapeHtml(user.Username)}" aria-label="Edit ${escapeHtml(user.DisplayName || user.Username)}" title="Edit staff account"><span aria-hidden="true">&#9998;</span></button><button type="button" class="compact-icon-action compact-delete-action" data-delete-user="${escapeHtml(user.Username)}" aria-label="Delete ${escapeHtml(user.DisplayName || user.Username)}" title="Delete staff account"><span aria-hidden="true">&#128465;&#65038;</span></button></div>
        </article>
      `).join('') : '<p class="muted">No database staff accounts found. Create the first shared staff account.</p>'}
    </div>
    <section class="role-access-settings">
      <div class="role-access-heading"><div><p class="eyebrow">Role access</p><h2>Role module access</h2><p class="muted">Choose the tabs each role receives by default. Individual staff overrides remain available in each staff account.</p></div><span class="role-access-scope">${policyScope === 'global' ? 'All branches' : `Branch: ${escapeHtml(policyScope)}`}</span></div>
      <div class="role-access-editor">
        <label class="role-access-role">Staff role<select id="roleAccessRole">${availableRoles.map((role) => `<option value="${escapeHtml(role)}"${role === staffRoleAccessSelectedRole ? ' selected' : ''}>${escapeHtml(role)}</option>`).join('')}</select></label>
        <p class="role-access-source" id="roleAccessSource"></p>
        <div class="config-option-list config-option-grid role-access-modules" id="roleAccessModules">
          ${policyModules.map(({ key, label }) => `<label class="check-row"><input type="checkbox" name="RoleModuleOption" value="${escapeHtml(key)}"> ${escapeHtml(label)}</label>`).join('')}
        </div>
        <div class="role-access-actions"><p class="status" id="roleAccessStatus"></p><button type="button" class="secondary" id="resetRoleAccess">Use inherited default</button><button type="button" id="saveRoleAccess">Save role access</button></div>
      </div>
    </section>
    <section class="staff-mfa-policy-settings">
      <div class="role-access-heading"><div><p class="eyebrow">Sign-in protection</p><h2>Two-factor authentication policy</h2><p class="muted">Control who must complete a second security check after entering a password. Staff may always enrol voluntarily unless protection is disabled.</p></div><span class="role-access-scope">Organisation-wide</span></div>
      ${!canManageMfaPolicy ? '<p class="status">Only a Super Administrator can change organisation-wide two-factor policy or reset another staff member’s security methods.</p>' : staffMfaAdminData?.error ? `<p class="status bad">${escapeHtml(staffMfaAdminData.error)}</p>` : `
      <div class="staff-mfa-policy-editor">
        <div class="config-grid staff-mfa-policy-controls">
          <label>Enforcement mode<select id="staffMfaPolicyMode">
            <option value="DISABLED"${mfaPolicy.Mode === 'DISABLED' ? ' selected' : ''}>Disabled</option>
            <option value="OPTIONAL"${mfaPolicy.Mode === 'OPTIONAL' ? ' selected' : ''}>Optional</option>
            <option value="REQUIRED_ROLES"${mfaPolicy.Mode === 'REQUIRED_ROLES' ? ' selected' : ''}>Required for selected roles</option>
            <option value="REQUIRED_ALL"${mfaPolicy.Mode === 'REQUIRED_ALL' ? ' selected' : ''}>Required for all staff</option>
          </select></label>
          <label>Grace period (days)<input id="staffMfaPolicyGrace" type="number" min="0" max="30" step="1" value="${Number(mfaPolicy.GraceDays ?? 7)}"><small>0 enforces immediately; maximum 30 days.</small></label>
        </div>
        <div class="config-option-list config-option-grid staff-mfa-policy-roles" id="staffMfaPolicyRoles"${mfaPolicy.Mode === 'REQUIRED_ROLES' ? '' : ' hidden'}>
          <strong>Roles that require two-factor authentication</strong>
          ${availableRoles.map((role) => `<label class="check-row"><input type="checkbox" name="StaffMfaRequiredRole" value="${escapeHtml(role)}"${mfaPolicyRoles.has(role) ? ' checked' : ''}> ${escapeHtml(role)}</label>`).join('')}
        </div>
        <p class="muted staff-mfa-policy-timing" id="staffMfaPolicyTiming"></p>
        <div class="role-access-actions"><p class="status" id="staffMfaPolicyStatus"></p><button type="button" id="saveStaffMfaPolicy">Save two-factor policy</button></div>
      </div>
      <div class="staff-mfa-admin-reset">
        <div><strong>Account recovery reset</strong><p class="muted">Use only after verifying the staff member's identity. This revokes every passkey, authenticator secret and unused recovery code for the selected account.</p></div>
        <div class="staff-mfa-reset-form">
          <label>Staff account<select id="staffMfaResetUser"><option value="">Choose staff account</option>${resettableStaff.map((user) => `<option value="${escapeHtml(user.Username)}">${escapeHtml(user.DisplayName || user.Username)} (@${escapeHtml(user.LoginUsername || user.Username)})</option>`).join('')}</select></label>
          <label>Your current password<input id="staffMfaResetPassword" type="password" autocomplete="current-password"></label>
          <button type="button" class="danger" id="resetStaffMfa">Reset two-factor methods</button>
        </div>
        <p class="status" id="staffMfaResetStatus"></p>
      </div>`}
    </section>
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
          <label>Role <select name="Role" required>${availableRoles.map((role) => `<option>${role}</option>`).join('')}</select></label>
          <label>Department<input name="Department" placeholder="Required for Department User"></label>
          <label>Branch ID<input name="BranchId" placeholder="Blank allows all branches"></label>
          ${schoolEdition ? '<label>School section<select name="SchoolSectionAccess"><option>All</option><option>Primary</option><option>Secondary</option></select></label>' : ''}
        </div></section>
        <section class="config-group"><header><strong>Finance approval</strong><small>Approval is blocked unless explicitly enabled by an administrator.</small></header><div class="config-grid">
          <label class="check-row config-switch"><input name="ApprovalEnabled" type="checkbox"> Allow this user to approve finance documents</label>
          <label>Maximum approval amount<input name="ApprovalMaxAmount" type="number" min="0" step="0.01" value="0" data-finance-input><small>Zero blocks approval. Super Admin is unrestricted.</small></label>
        </div><div class="approval-account-list config-option-list"><strong>Accounts this user may approve directly from</strong>${staffApprovalAccounts.length ? staffApprovalAccounts.map((account) => `<label class="check-row"><input type="checkbox" name="ApprovalAccountOption" value="${escapeHtml(account.Code)}"> ${escapeHtml(account.Code)} - ${escapeHtml(account.Name || '')}</label>`).join('') : '<small>Create active Chart of Accounts entries in the desktop Finance tab first.</small>'}</div></section>
        <section class="config-group"><header><strong>Web companion access</strong><small>Optional user-specific override. Leave all clear to inherit the module access saved for the selected role.</small></header><div class="approval-account-list config-option-list config-option-grid">${permissionTabs.map(([key, label]) => `<label class="check-row"><input type="checkbox" name="TabAccessOption" value="${escapeHtml(key)}"> ${escapeHtml(label)}</label>`).join('')}</div></section>
        <section class="config-group"><header><strong>Security</strong><small>Password and account-state controls.</small></header><div class="config-grid">
          <label>New or reset password<input name="Password" type="password" minlength="6" autocomplete="new-password"><small>Required for a new account. Leave blank when editing unless resetting it.</small></label>
          <div class="config-toggle-stack"><label class="check-row"><input name="Active" type="checkbox" checked> Account active</label><label class="check-row"><input name="MustChangePassword" type="checkbox" checked> Require password change at next sign-in</label>${schoolEdition ? '<label class="check-row sensitive-access-toggle"><input name="BiometricLookupEnabled" type="checkbox"> Allow student face lookup</label>' : ''}</div>
        </div></section>
        <div class="config-dialog-actions"><p class="status" data-user-form-status></p><div class="config-dialog-action-buttons"><a class="subscription-plans-link" data-subscription-plans-link href="register-organization.html#plans" target="_blank" rel="noopener" hidden>View Dynamax plans</a><button type="submit">Save staff account</button></div></div>
      </form>
    </dialog>
  `;
  mountWorkspaceTabs('staffUsers', [
    { key: 'overview', label: 'Overview', icon: '\u25A6', nodes: [document.getElementById('staffUsersStatus'), panelEl.querySelector(':scope > .workflow-kpis')] },
    { key: 'accounts', label: 'Staff accounts', icon: '\u{1F465}', count: staffUsersData.length, nodes: panelEl.querySelector(':scope > .staff-user-list') },
    { key: 'roleAccess', label: 'Role access', icon: '\u{1F511}', nodes: panelEl.querySelector(':scope > .role-access-settings') },
    { key: 'mfaPolicy', label: 'Two-factor policy', icon: '\u{1F6E1}', nodes: panelEl.querySelector(':scope > .staff-mfa-policy-settings') },
    { key: 'security', label: 'Security activity', icon: '\u{1F6E1}', count: staffAuditData.length, nodes: panelEl.querySelector(':scope > .staff-security-activity') }
  ]);
  bindStaffUserEvents();
  renderRoleAccessEditor(staffRoleAccessSelectedRole, policyRoles);
  updateMfaPolicyEditor();
}

function renderRoleAccessEditor(role = staffRoleAccessSelectedRole, roles = staffRoleAccessData?.roles || {}) {
  const selector = document.getElementById('roleAccessRole');
  if (!selector) return;
  staffRoleAccessSelectedRole = role || selector.value;
  selector.value = staffRoleAccessSelectedRole;
  const policy = roles[staffRoleAccessSelectedRole] || { modules: [], source: 'default', locallyConfigured: false };
  const allowed = new Set(policy.modules || []);
  document.querySelectorAll('[name="RoleModuleOption"]').forEach((input) => { input.checked = allowed.has(input.value); });
  const source = document.getElementById('roleAccessSource');
  if (source) {
    source.textContent = policy.source === 'default'
      ? 'Using the safe system starting policy until you save this role.'
      : policy.locallyConfigured
        ? `Saved specifically for ${policy.source === 'global' ? 'all branches' : `branch ${policy.source}`}.`
        : 'Inheriting the organisation-wide role policy.';
  }
  const reset = document.getElementById('resetRoleAccess');
  if (reset) reset.disabled = !policy.locallyConfigured;
}

function openStaffUserDialog(username = '') {
  const dialog = document.getElementById('staffUserDialog');
  const form = document.getElementById('staffUserForm');
  const user = staffUsersData.find((row) => row.Username.toLowerCase() === username.toLowerCase());
  form.reset();
  setStatus(form.querySelector('[data-user-form-status]'), '');
  const plansLink = form.querySelector('[data-subscription-plans-link]');
  if (plansLink) plansLink.hidden = true;
  form.elements.Username.readOnly = Boolean(user);
  document.getElementById('staffUserDialogTitle').textContent = user ? 'Manage Staff Account' : 'New Staff Account';
  if (user) {
    form.elements.Username.value = user.Username;
    form.elements.DisplayName.value = user.DisplayName || user.Username;
    form.elements.Role.value = user.Role;
    form.elements.Department.value = user.Department || '';
    form.elements.BranchId.value = user.BranchId || '';
    if (form.elements.SchoolSectionAccess) {
      form.elements.SchoolSectionAccess.value = user.SchoolSectionAccess || 'All';
    }
    form.elements.ApprovalEnabled.checked = yes(user.ApprovalEnabled);
    setFinancialInputValue(form.elements.ApprovalMaxAmount, user.ApprovalMaxAmount || 0);
    const allowedAccounts = new Set(user.ApprovalAccounts || []);
    form.querySelectorAll('[name="ApprovalAccountOption"]').forEach((input) => { input.checked = allowedAccounts.has(input.value); });
    const allowedTabs = new Set(user.TabAccess || []);
    form.querySelectorAll('[name="TabAccessOption"]').forEach((input) => { input.checked = allowedTabs.has(input.value); });
    form.elements.Active.checked = yes(user.Active);
    form.elements.MustChangePassword.checked = yes(user.MustChangePassword);
    if (form.elements.BiometricLookupEnabled) {
      form.elements.BiometricLookupEnabled.checked = yes(user.BiometricLookupEnabled);
    }
  } else {
    form.elements.Active.checked = true;
    form.elements.MustChangePassword.checked = true;
    form.elements.ApprovalEnabled.checked = false;
    if (form.elements.BiometricLookupEnabled) form.elements.BiometricLookupEnabled.checked = false;
  }
  dialog.showModal();
}

function bindStaffUserEvents() {
  document.getElementById('newStaffUser')?.addEventListener('click', () => openStaffUserDialog());
  document.getElementById('refreshStaffUsers')?.addEventListener('click', (event) => {
    runButtonAction(event.currentTarget, 'Refreshing...', loadStaffUsers);
  });
  document.getElementById('uploadStaffCsv')?.addEventListener('click', () => document.getElementById('staffCsvFile').click());
  document.getElementById('staffCsvTemplate')?.addEventListener('click', downloadStaffCsvTemplate);
  document.getElementById('staffCsvFile')?.addEventListener('change', importStaffCsv);
  document.getElementById('roleAccessRole')?.addEventListener('change', (event) => {
    renderRoleAccessEditor(event.currentTarget.value);
    setStatus(document.getElementById('roleAccessStatus'), '');
  });
  document.getElementById('saveRoleAccess')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const modules = Array.from(document.querySelectorAll('[name="RoleModuleOption"]:checked')).map((input) => input.value);
    setButtonLoading(button, true, 'Saving...', 'Save role access');
    try {
      const data = await staffUserRequest('save-role-access', { Role: staffRoleAccessSelectedRole, Modules: modules });
      staffRoleAccessData = data.roleAccess;
      renderRoleAccessEditor(staffRoleAccessSelectedRole);
      setStatus(document.getElementById('roleAccessStatus'), data.message, 'ok');
    } catch (error) {
      setStatus(document.getElementById('roleAccessStatus'), error.message || String(error), 'bad');
    } finally {
      setButtonLoading(button, false, 'Saving...', 'Save role access');
    }
  });
  document.getElementById('resetRoleAccess')?.addEventListener('click', async (event) => {
    if (!await window.DynamaxDialogs.confirm({ title: 'Reset role policy', message: `Remove the saved ${staffRoleAccessSelectedRole} policy for this scope and use its inherited default?`, tone: 'danger', confirmText: 'Use inherited default' })) return;
    const button = event.currentTarget;
    setButtonLoading(button, true, 'Resetting...', 'Use inherited default');
    try {
      const data = await staffUserRequest('reset-role-access', { Role: staffRoleAccessSelectedRole });
      staffRoleAccessData = data.roleAccess;
      renderRoleAccessEditor(staffRoleAccessSelectedRole);
      setStatus(document.getElementById('roleAccessStatus'), data.message, 'ok');
    } catch (error) {
      setStatus(document.getElementById('roleAccessStatus'), error.message || String(error), 'bad');
    } finally {
      setButtonLoading(button, false, 'Resetting...', 'Use inherited default');
      renderRoleAccessEditor(staffRoleAccessSelectedRole);
    }
  });
  document.getElementById('staffMfaPolicyMode')?.addEventListener('change', updateMfaPolicyEditor);
  document.getElementById('saveStaffMfaPolicy')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const mode = document.getElementById('staffMfaPolicyMode').value;
    const graceDays = Number(document.getElementById('staffMfaPolicyGrace').value || 0);
    const requiredRoles = Array.from(document.querySelectorAll('[name="StaffMfaRequiredRole"]:checked')).map((input) => input.value);
    setButtonLoading(button, true, 'Saving...', 'Save two-factor policy');
    try {
      const data = await mfaRequest('save-policy', { mode, graceDays, requiredRoles });
      staffMfaAdminData = { ...(staffMfaAdminData || {}), policy: data.policy };
      updateMfaPolicyEditor();
      setStatus(document.getElementById('staffMfaPolicyStatus'), data.message, 'ok');
    } catch (error) {
      setStatus(document.getElementById('staffMfaPolicyStatus'), error.message || String(error), 'bad');
    } finally {
      setButtonLoading(button, false, 'Saving...', 'Save two-factor policy');
    }
  });
  document.getElementById('resetStaffMfa')?.addEventListener('click', async (event) => {
    const targetUsername = clean(document.getElementById('staffMfaResetUser')?.value);
    const currentPassword = document.getElementById('staffMfaResetPassword')?.value || '';
    const targetUser = staffUsersData.find((user) => clean(user.Username).toLowerCase() === targetUsername.toLowerCase());
    if (!targetUsername) {
      setStatus(document.getElementById('staffMfaResetStatus'), 'Choose the staff account to reset.', 'bad');
      return;
    }
    if (!currentPassword) {
      setStatus(document.getElementById('staffMfaResetStatus'), 'Enter your current administrator password.', 'bad');
      return;
    }
    if (!await window.DynamaxDialogs.confirm({
      title: 'Reset two-factor authentication',
      message: `Revoke every two-factor method and recovery code for ${targetUser?.DisplayName || targetUsername}? The staff member will need to enrol again when policy requires it.`,
      tone: 'danger',
      confirmText: 'Reset security methods'
    })) return;
    const button = event.currentTarget;
    setButtonLoading(button, true, 'Resetting...', 'Reset two-factor methods');
    try {
      const data = await mfaRequest('admin-reset', { targetUsername, currentPassword });
      staffMfaAdminData = await mfaRequest('admin-status');
      renderStaffUsers();
      setStatus(document.getElementById('staffMfaResetStatus'), data.message, 'ok');
    } catch (error) {
      setStatus(document.getElementById('staffMfaResetStatus'), error.message || String(error), 'bad');
      if (button.isConnected) setButtonLoading(button, false, 'Resetting...', 'Reset two-factor methods');
    }
  });
  document.querySelector('[data-close-user-dialog]')?.addEventListener('click', () => document.getElementById('staffUserDialog').close());
  panelEl.querySelectorAll('[data-edit-user]').forEach((button) => button.addEventListener('click', () => openStaffUserDialog(button.dataset.editUser)));
  panelEl.querySelectorAll('[data-delete-user]').forEach((button) => button.addEventListener('click', async () => {
    const username = button.dataset.deleteUser;
    if (!await window.DynamaxDialogs.confirm({ title: 'Delete staff account', message: `Delete staff account ${username}? This cannot be undone.`, tone: 'danger', confirmText: 'Delete account' })) return;
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
    const plansLink = form.querySelector('[data-subscription-plans-link]');
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.Active = form.elements.Active.checked;
    payload.MustChangePassword = form.elements.MustChangePassword.checked;
    payload.ApprovalEnabled = form.elements.ApprovalEnabled.checked;
    if (form.elements.BiometricLookupEnabled) {
      payload.BiometricLookupEnabled = form.elements.BiometricLookupEnabled.checked;
    }
    payload.ApprovalAccounts = Array.from(form.querySelectorAll('[name="ApprovalAccountOption"]:checked')).map((input) => input.value);
    payload.TabAccess = Array.from(form.querySelectorAll('[name="TabAccessOption"]:checked')).map((input) => input.value);
    if (plansLink) plansLink.hidden = true;
    setButtonLoading(button, true, 'Saving...', 'Save Staff Account');
    try {
      const data = await staffUserRequest('save', payload);
      document.getElementById('staffUserDialog').close();
      await loadStaffUsers();
      setStatus(document.getElementById('staffUsersStatus'), data.message, 'ok');
    } catch (error) {
      const message = error.message || String(error);
      setStatus(status, message, 'bad');
      if (plansLink) plansLink.hidden = !/subscription allows|upgrade the plan/i.test(message);
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

function downloadCsvFile(fileName, content) {
  const url = URL.createObjectURL(new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

async function importOrganizationCsv(event, options, status) {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file) return;
  const button = document.getElementById(options.buttonId);
  const normalText = clean(button?.textContent) || 'Import';
  if (button?.disabled) {
    input.value = '';
    return;
  }
  if (button) setButtonLoading(button, true, options.loadingText || 'Importing...', normalText);
  try {
    const rows = parseCsv(await file.text());
    if (!rows.length) throw new Error('The CSV has no data rows. Download the template and try again.');
    if (rows.length > 499) throw new Error('Import a maximum of 499 records at a time.');
    setStatus(status, `${options.loadingText || 'Importing...'} (${rows.length} records)`);
    const result = await organizationDepartmentAction(options.action, { [options.payloadKey]: rows });
    setStatus(status, result.message || `${rows.length} record(s) imported.`, 'good');
    await loadOrganizationDepartments();
  } catch (error) {
    setStatus(status, error.message || String(error), 'bad');
  } finally {
    input.value = '';
    if (button?.isConnected) setButtonLoading(button, false, options.loadingText || 'Importing...', normalText);
  }
}

function downloadStaffCsvTemplate() {
  const schoolEdition = resolveDashboardEdition(currentUser || {}) === 'school';
  const content = schoolEdition
    ? 'Username,DisplayName,Role,Department,BranchId,SchoolSectionAccess,Password,Active,MustChangePassword,ApprovalEnabled,ApprovalMaxAmount,ApprovalAccounts,BiometricLookupEnabled,TabAccess\nexample.user,Example User,Front Desk,Administration,main,All,ChangeMe123,YES,YES,NO,0,"6010,6090",NO,"admissions,students"\n'
    : 'Username,DisplayName,Role,Department,BranchId,Password,Active,MustChangePassword,ApprovalEnabled,ApprovalMaxAmount,ApprovalAccounts,TabAccess\nexample.user,Example User,Church Administrator,Administration,main,ChangeMe123,YES,YES,NO,0,"6010,6090","members,services,offerings"\n';
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv' }));
  const link = document.createElement('a'); link.href = url; link.download = 'staff_upload_template.csv'; link.click(); URL.revokeObjectURL(url);
}

async function importStaffCsv(event) {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file) return;
  if (input.dataset.importing === 'true') {
    input.value = '';
    return;
  }
  const button = document.getElementById('uploadStaffCsv');
  const normalText = clean(button?.textContent) || 'Upload Staff CSV';
  input.dataset.importing = 'true';
  if (button) setButtonLoading(button, true, 'Importing staff...', normalText);
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
    delete input.dataset.importing;
    input.value = '';
    if (button?.isConnected) setButtonLoading(button, false, 'Importing staff...', normalText);
  }
}

async function loadStaffUsers() {
  if (activeSection !== 'staffUsers') return;
  try {
    const [data, mfaAdministration] = await Promise.all([
      staffUserRequest('list'),
      clean(currentUser?.role) === 'Super Admin'
        ? mfaRequest('admin-status').catch((error) => ({ policy: null, accounts: [], error: error.message || String(error) }))
        : Promise.resolve(null)
    ]);
    staffUsersData = data.users || [];
    staffAuditData = data.audit || [];
    staffApprovalAccounts = data.approvalAccounts || [];
    staffRoleAccessData = data.roleAccess || null;
    staffMfaAdminData = mfaAdministration;
    renderModuleSummary('staffUsers', staffUsersData);
    renderStaffUsers();
    const handoff = takeRecordsDeskHandoff('staffUsers');
    const username = recordsDeskHandoffReference(handoff);
    if (username) openStaffUserDialog(username);
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
    const username = document.getElementById('staffUsername').value.trim();
    const { response, data } = await sessionRequest('POST', {
      action: 'login',
      username,
      password: document.getElementById('staffPassword').value
    });
    if (!response.ok || !data.ok) throw new Error(data.message || 'Could not sign in.');
    if (data.mfaRequired) {
      document.getElementById('staffPassword').value = '';
      setStatus(loginStatus, 'Password verified. Complete two-factor authentication.');
      await openMfaLogin(data, username);
      return;
    }
    if (!data.authenticated || !data.user) throw new Error('Sign-in did not return an authenticated staff account.');
    loginForm.reset();
    setStatus(loginStatus, '');
    await continueAfterAuthentication(await confirmFreshStaffSession(data.user, clean(data.sessionToken)));
    if (clean(data.mfaEnrollmentDueAt)) {
      setStatus(
        dashboardStatus,
        `Two-factor authentication will become required on ${new Date(data.mfaEnrollmentDueAt).toLocaleString()}. Open Account & settings, then Two-factor security to enrol now.`
      );
    }
  } catch (error) {
    setStatus(loginStatus, error.message || String(error), 'bad');
  } finally {
    setButtonLoading(loginButton, false, 'Signing in...', 'Sign In');
  }
});

document.getElementById('staffMfaLoginPasskey').addEventListener('click', verifyMfaLoginWithPasskey);
document.getElementById('staffMfaLoginTotp').addEventListener('click', () => selectMfaLoginMethod('totp'));
document.getElementById('staffMfaLoginRecovery').addEventListener('click', () => selectMfaLoginMethod('recovery'));
document.getElementById('staffMfaLoginCodeForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!pendingMfaLogin?.ticket || !pendingMfaLogin.method) return;
  const button = document.getElementById('staffMfaLoginVerify');
  const status = document.getElementById('staffMfaLoginStatus');
  setButtonLoading(button, true, 'Verifying...', 'Verify and sign in');
  try {
    const completed = await mfaRequest('verify-login', {
      mfaTicket: pendingMfaLogin.ticket,
      method: pendingMfaLogin.method,
      code: document.getElementById('staffMfaLoginCode').value
    });
    await finishMfaClientLogin(completed);
  } catch (error) {
    setStatus(status, error.message || String(error), 'bad');
    document.getElementById('staffMfaLoginCode').select();
  } finally {
    setButtonLoading(button, false, 'Verifying...', 'Verify and sign in');
  }
});
document.getElementById('staffMfaLoginSetupForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!pendingMfaLogin?.ticket) return;
  const button = document.getElementById('staffMfaLoginSetupVerify');
  const status = document.getElementById('staffMfaLoginStatus');
  setButtonLoading(button, true, 'Enabling...', 'Finish setup and sign in');
  try {
    const completed = await mfaRequest('confirm-totp-setup', {
      mfaTicket: pendingMfaLogin.ticket,
      code: document.getElementById('staffMfaLoginSetupCode').value
    });
    pendingMfaCompletedLogin = completed;
    document.getElementById('staffMfaLoginSetup').hidden = true;
    showRecoveryCodes(completed.recoveryCodes, 'staffMfaLoginRecoveryCodeList', 'staffMfaLoginRecoveryCodes');
    setStatus(status, 'Authenticator enabled. Save the recovery codes before opening your workspace.', 'ok');
  } catch (error) {
    setStatus(status, error.message || String(error), 'bad');
    document.getElementById('staffMfaLoginSetupCode').select();
  } finally {
    setButtonLoading(button, false, 'Enabling...', 'Finish setup and sign in');
  }
});
document.getElementById('staffMfaLoginContinue').addEventListener('click', async () => {
  if (!pendingMfaCompletedLogin) return;
  try {
    await finishMfaClientLogin(pendingMfaCompletedLogin);
  } catch (error) {
    setStatus(document.getElementById('staffMfaLoginStatus'), error.message || String(error), 'bad');
  }
});
document.getElementById('staffMfaLoginDownloadRecovery').addEventListener('click', () => recoveryCodeDownload());
document.getElementById('staffMfaLoginCancel').addEventListener('click', async () => {
  if (pendingMfaCompletedLogin) await sessionRequest('POST', { action: 'logout' }).catch(() => null);
  pendingMfaLogin = null;
  pendingMfaCompletedLogin = null;
  latestRecoveryCodes = [];
  mfaLoginDialog.close();
  setStatus(loginStatus, 'Two-factor sign-in cancelled. Enter your password to start again.');
  document.getElementById('staffPassword').focus();
});
mfaLoginDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  document.getElementById('staffMfaLoginCancel').click();
});

mfaSettingsButton.addEventListener('click', openStaffMfaSettings);
document.getElementById('staffMfaClose').addEventListener('click', () => mfaDialog.close());
document.getElementById('staffMfaSetupTotp').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const restingText = button.textContent;
  const status = document.getElementById('staffMfaStatus');
  setButtonLoading(button, true, 'Preparing...', restingText);
  try {
    const data = await mfaRequest('setup-totp');
    document.getElementById('staffMfaSetupPanel').hidden = false;
    document.getElementById('staffMfaQr').innerHTML = data.setup.qrSvg;
    document.getElementById('staffMfaSecret').textContent = data.setup.secret;
    document.getElementById('staffMfaSetupCode').value = '';
    setStatus(status, data.message, 'ok');
    document.getElementById('staffMfaSetupCode').focus();
  } catch (error) {
    setStatus(status, error.message || String(error), 'bad');
  } finally {
    setButtonLoading(button, false, 'Preparing...', restingText);
  }
});
document.getElementById('staffMfaSetupForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = document.getElementById('staffMfaSetupVerify');
  const status = document.getElementById('staffMfaStatus');
  setButtonLoading(button, true, 'Verifying...', 'Verify and enable');
  try {
    const data = await mfaRequest('confirm-totp-setup', {
      currentPassword: form.elements.currentPassword.value,
      code: document.getElementById('staffMfaSetupCode').value
    });
    form.reset();
    document.getElementById('staffMfaSetupPanel').hidden = true;
    showRecoveryCodes(data.recoveryCodes, 'staffMfaRecoveryCodeList', 'staffMfaRecoveryCodes');
    staffMfaData = await mfaRequest('status');
    renderStaffMfaSummary();
    setStatus(status, data.message, 'ok');
  } catch (error) {
    setStatus(status, error.message || String(error), 'bad');
    document.getElementById('staffMfaSetupCode').select();
  } finally {
    setButtonLoading(button, false, 'Verifying...', 'Verify and enable');
  }
});
document.getElementById('staffMfaDownloadRecovery').addEventListener('click', () => recoveryCodeDownload());
document.getElementById('staffMfaAddPasskey').addEventListener('click', () => {
  mfaDialog.close();
  passkeySetupButton.click();
});
document.getElementById('staffMfaRecoveryForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const status = document.getElementById('staffMfaStatus');
  setButtonLoading(button, true, 'Generating...', 'Generate new codes');
  try {
    const data = await mfaRequest('regenerate-recovery', {
      currentPassword: form.elements.currentPassword.value,
      code: form.elements.code.value
    });
    form.reset();
    showRecoveryCodes(data.recoveryCodes, 'staffMfaRecoveryCodeList', 'staffMfaRecoveryCodes');
    staffMfaData = await mfaRequest('status');
    renderStaffMfaSummary();
    setStatus(status, data.message, 'ok');
  } catch (error) {
    setStatus(status, error.message || String(error), 'bad');
  } finally {
    setButtonLoading(button, false, 'Generating...', 'Generate new codes');
  }
});
document.getElementById('staffMfaDisableForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!await window.DynamaxDialogs.confirm({
    title: 'Remove authenticator app',
    message: 'Remove authenticator codes and invalidate every saved recovery code for this account?',
    tone: 'danger',
    confirmText: 'Remove authenticator'
  })) return;
  const button = form.querySelector('button[type="submit"]');
  const status = document.getElementById('staffMfaStatus');
  setButtonLoading(button, true, 'Removing...', 'Remove authenticator');
  try {
    const data = await mfaRequest('disable-totp', {
      currentPassword: form.elements.currentPassword.value,
      code: form.elements.code.value
    });
    form.reset();
    showRecoveryCodes([], 'staffMfaRecoveryCodeList', 'staffMfaRecoveryCodes');
    staffMfaData = await mfaRequest('status');
    renderStaffMfaSummary();
    setStatus(status, data.message, 'ok');
  } catch (error) {
    setStatus(status, error.message || String(error), 'bad');
  } finally {
    setButtonLoading(button, false, 'Removing...', 'Remove authenticator');
  }
});

passkeyLoginButton.addEventListener('click', async () => {
  if (passkeyLoginButton.disabled) return;
  setButtonLoading(passkeyLoginButton, true, 'Checking your device...', 'Sign in with biometrics');
  setStatus(loginStatus, 'Follow your device prompt to sign in...');
  try {
    const started = await passkeyRequest('authentication-options', {
      username: document.getElementById('staffUsername').value.trim()
    });
    const credential = await getPasskeyCredential(started.options, 'optional');
    if (!credential) throw new Error('No biometric credential was returned.');
    const completed = await passkeyRequest('authentication-verify', {
      ceremonyId: started.ceremonyId,
      credential: credentialToJSON(credential)
    });
    const sessionToken = clean(completed.sessionToken);
    if (!sessionToken) throw new Error('Biometric sign-in did not return a staff session.');
    await continueAfterAuthentication(await confirmFreshStaffSession(completed.user, sessionToken));
  } catch (error) {
    staffBearerToken = '';
    setStatus(loginStatus, friendlyPasskeyError(error), 'bad');
  } finally {
    setButtonLoading(passkeyLoginButton, false, 'Checking your device...', 'Sign in with biometrics');
  }
});

passkeySetupButton.addEventListener('click', async () => {
  if (passkeySetupButton.disabled) return;
  const originalText = passkeySetupButton.textContent.trim();
  setButtonLoading(passkeySetupButton, true, 'Opening device security...', originalText);
  setStatus(dashboardStatus, 'Follow your device prompt to register biometric sign-in...');
  try {
    const started = await passkeyRequest('registration-options');
    const credential = await navigator.credentials.create({
      publicKey: registrationOptionsFromJSON(started.options)
    });
    if (!credential) throw new Error('No biometric credential was created.');
    const completed = await passkeyRequest('registration-verify', {
      ceremonyId: started.ceremonyId,
      credential: credentialToJSON(credential)
    });
    setStatus(dashboardStatus, completed.message, 'ok');
    await refreshPasskeyControls();
  } catch (error) {
    setStatus(dashboardStatus, friendlyPasskeyError(error), 'bad');
  } finally {
    setButtonLoading(passkeySetupButton, false, 'Opening device security...', originalText);
  }
});

approvalSettingsButton.addEventListener('click', openApprovalSettings);
subscriptionButton.addEventListener('click', openStaffSubscription);
document.getElementById('staffProfileSubscriptionOpen').addEventListener('click', () => {
  staffProfileDialog.close();
  openStaffSubscription();
});
document.getElementById('staffSubscriptionClose').addEventListener('click', () => subscriptionDialog.close());
subscriptionDialog.addEventListener('click', (event) => {
  const cycleButton = event.target.closest('[data-subscription-cycle]');
  if (cycleButton) {
    subscriptionCycle = cycleButton.dataset.subscriptionCycle;
    renderStaffSubscription();
    return;
  }
  const upgradeButton = event.target.closest('[data-upgrade-plan]');
  if (upgradeButton && !upgradeButton.disabled) startSubscriptionUpgrade(upgradeButton.dataset.upgradePlan, upgradeButton);
});
document.getElementById('staffApprovalSettingsClose').addEventListener('click', () => approvalSettingsDialog.close());
document.getElementById('removeStaffSignature').addEventListener('click', () => {
  approvalAssetState.signature = '';
  document.getElementById('staffSignatureFile').value = '';
  renderApprovalAssetPreview('signature');
});
document.getElementById('removeStaffStamp').addEventListener('click', () => {
  approvalAssetState.stamp = '';
  document.getElementById('staffStampFile').value = '';
  renderApprovalAssetPreview('stamp');
});
[['staffSignatureFile', 'signature'], ['staffStampFile', 'stamp']].forEach(([inputId, kind]) => {
  document.getElementById(inputId).addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      approvalAssetState[kind] = await approvalImageDataUrl(file);
      renderApprovalAssetPreview(kind);
      setStatus(document.getElementById('staffApprovalSettingsStatus'), `${kind === 'signature' ? 'Signature' : 'Stamp'} ready to save.`, 'ok');
    } catch (error) {
      event.target.value = '';
      setStatus(document.getElementById('staffApprovalSettingsStatus'), error.message || String(error), 'bad');
    }
  });
});
approvalSettingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = document.getElementById('staffApprovalSettingsSave');
  setButtonLoading(button, true, 'Saving...', 'Save user settings');
  try {
    const data = await approvalProfileRequest('POST', {
      SignatureDataUrl: approvalAssetState.signature,
      StampDataUrl: approvalAssetState.stamp,
      ApplySignatureOnApproval: approvalSettingsForm.elements.ApplySignatureOnApproval.checked,
      ApplyStampOnApproval: approvalSettingsForm.elements.ApplyStampOnApproval.checked,
      ApplySignatureOnPosting: approvalSettingsForm.elements.ApplySignatureOnPosting.checked,
      ApplyStampOnPosting: approvalSettingsForm.elements.ApplyStampOnPosting.checked
    });
    approvalProfile = data.profile;
    if (financeData) {
      financeData.approvalProfile = { ...approvalProfile };
      delete financeData.approvalProfile.SignatureDataUrl;
      delete financeData.approvalProfile.StampDataUrl;
    }
    setStatus(document.getElementById('staffApprovalSettingsStatus'), data.message, 'ok');
  } catch (error) {
    setStatus(document.getElementById('staffApprovalSettingsStatus'), error.message || String(error), 'bad');
  } finally {
    setButtonLoading(button, false, 'Saving...', 'Save user settings');
  }
});

document.getElementById('financeDecisionClose').addEventListener('click', () => {
  financeDecisionDialog.close();
  pendingFinanceDecision = null;
  financeDecisionBiometricVerified = false;
  financeDecisionApprovalProof = '';
  financeDecisionForm.reset();
});
document.getElementById('financeDecisionBiometric').addEventListener('click', verifyFinanceDecisionBiometric);
financeDecisionForm.addEventListener('submit', submitFinanceDecision);

profileTrigger.addEventListener('click', openStaffProfile);
document.getElementById('staffProfileClose').addEventListener('click', () => staffProfileDialog.close());
document.getElementById('staffProfilePhotoRemove').addEventListener('click', () => {
  profilePhotoState = '';
  document.getElementById('staffProfilePhotoFile').value = '';
  renderProfilePhoto('', document.getElementById('staffProfileDisplayName').value || currentUser?.displayName);
  setStatus(document.getElementById('staffProfileStatus'), 'Profile picture will be removed when you save.');
});
document.getElementById('staffProfilePhotoFile').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    profilePhotoState = await profilePhotoDataUrl(file);
    renderProfilePhoto(profilePhotoState, document.getElementById('staffProfileDisplayName').value || currentUser?.displayName);
    setStatus(document.getElementById('staffProfileStatus'), 'Profile picture ready to save.', 'ok');
  } catch (error) {
    event.target.value = '';
    setStatus(document.getElementById('staffProfileStatus'), error.message || String(error), 'bad');
  }
});
staffProfileForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = document.getElementById('staffProfileSave');
  const displayName = clean(document.getElementById('staffProfileDisplayName').value);
  setButtonLoading(button, true, 'Saving...', 'Save profile');
  try {
    const { response, data } = await sessionRequest('POST', {
      action: 'updateProfile',
      displayName,
      profilePhotoDataUrl: profilePhotoState
    });
    if (!response.ok || !data.ok) throw new Error(data.message || 'Profile could not be updated.');
    showDashboard(data.user);
    staffProfileDialog.close();
    setStatus(dashboardStatus, data.message, 'ok');
  } catch (error) {
    setStatus(document.getElementById('staffProfileStatus'), error.message || String(error), 'bad');
  } finally {
    setButtonLoading(button, false, 'Saving...', 'Save profile');
  }
});

document.getElementById('staffLoginDetailsForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = document.getElementById('staffLoginDetailsSave');
  const status = document.getElementById('staffLoginDetailsStatus');
  const loginUsername = clean(document.getElementById('staffProfileLoginUsername').value);
  const currentPassword = document.getElementById('staffProfileCurrentPassword').value;
  const newPassword = document.getElementById('staffProfileNewPassword').value;
  const confirmPassword = document.getElementById('staffProfileConfirmPassword').value;
  if (newPassword !== confirmPassword) {
    setStatus(status, 'New passwords do not match.', 'bad');
    return;
  }
  setButtonLoading(button, true, 'Updating...', 'Update login details');
  setStatus(status, 'Verifying your current password...');
  try {
    const { response, data } = await sessionRequest('POST', {
      action: 'updateLoginDetails',
      loginUsername,
      currentPassword,
      newPassword,
      confirmPassword
    });
    if (!response.ok || !data.ok) throw new Error(data.message || 'Login details could not be updated.');
    form.elements.currentPassword.value = '';
    form.elements.newPassword.value = '';
    form.elements.confirmPassword.value = '';
    showDashboard(data.user);
    setStatus(status, data.message, 'ok');
  } catch (error) {
    setStatus(status, error.message || String(error), 'bad');
  } finally {
    setButtonLoading(button, false, 'Updating...', 'Update login details');
  }
});

async function signOutFromPortal(button) {
  button.disabled = true;
  staffBearerToken = '';
  try {
    await sessionRequest('POST', { action: 'logout' });
  } finally {
    staffBearerToken = '';
    button.disabled = false;
    window.location.replace('index.html');
  }
}

async function switchUserFromPortal() {
  const buttons = [switchUserButton, sidebarSwitchUserButton, passwordSwitchUserButton].filter(Boolean);
  staffBearerToken = '';
  buttons.forEach((button) => {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  });
  try {
    const { response, data } = await sessionRequest('POST', { action: 'logout' });
    if (!response.ok || !data.ok) throw new Error(data.message || 'Could not end the current staff session.');
    showLogin('Signed out. Sign in with another staff account.', 'ok');
    document.getElementById('staffUsername').focus();
  } catch (error) {
    setStatus(dashboardStatus, error.message || String(error), 'bad');
  } finally {
    staffBearerToken = '';
    buttons.forEach((button) => {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    });
  }
}

signOutButton.addEventListener('click', () => signOutFromPortal(signOutButton));
sidebarSignOutButton.addEventListener('click', () => signOutFromPortal(sidebarSignOutButton));
switchUserButton.addEventListener('click', switchUserFromPortal);
sidebarSwitchUserButton.addEventListener('click', switchUserFromPortal);
passwordSwitchUserButton.addEventListener('click', switchUserFromPortal);
staffAccountMenuPanel.addEventListener('click', (event) => {
  if (event.target.closest('button')) staffAccountMenu.open = false;
});
document.addEventListener('pointerdown', (event) => {
  if (staffAccountMenu.open && !staffAccountMenu.contains(event.target)) staffAccountMenu.open = false;
});

staffBrand.addEventListener('click', (event) => {
  const mobileDashboard = window.matchMedia('(max-width:680px)').matches
    && currentUser
    && !dashboardEl.hidden;
  if (!mobileDashboard || !event.target.closest('.nav-logo')) return;
  event.preventDefault();
  if (!headerRefreshButton.disabled) loadDashboard();
});
headerRefreshButton.addEventListener('click', loadDashboard);
themeToggleButton.addEventListener('click', toggleStaffTheme);
sidebarThemeToggleButton.addEventListener('click', toggleStaffTheme);
branchSelector.addEventListener('change', () => switchStaffBranch(branchSelector.value));
window.addEventListener('storage', (event) => {
  if (event.key !== 'dynamax:settings-revision' || !currentUser || dashboardEl.hidden) return;
  void refreshStaffSiteProfile();
});
paymentSettingsButton.addEventListener('click', () => {
  window.location.assign(paymentSettingsUrl());
});
new MutationObserver(updateStaffThemeToggle).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['data-theme']
});
updateStaffThemeToggle();
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
  if (button && !button.disabled) selectSection(button.dataset.module);
});
moduleCloseButton.addEventListener('click', () => moduleDialog.close());
moduleDialog.addEventListener('click', (event) => { if (event.target === moduleDialog) moduleDialog.close(); });
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  staffAccountMenu.open = false;
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
  setStatus(passwordStatus, 'Updating your database staff account...');
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
  staffBearerToken = '';
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
    const activationParams = new URLSearchParams(window.location.search);
    if (activationParams.get('activated') === '1') {
      showLogin('Administrator account created. Sign in with the username and password you just created.', 'good');
      document.getElementById('staffUsername').value = activationParams.get('username') || '';
      document.getElementById('staffPassword').focus();
      window.history.replaceState({}, document.title, window.location.pathname);
    } else {
      showLogin(data.message || '', data.message ? 'bad' : '');
    }
  }
}());
