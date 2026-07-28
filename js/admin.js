const loginCard = document.getElementById('staffLoginCard');
const loginForm = document.getElementById('staffLoginForm');
const loginButton = document.getElementById('staffLoginButton');
const passkeyLoginButton = document.getElementById('staffPasskeyLogin');
const passkeySetupButton = document.getElementById('staffPasskeySetup');
const approvalSettingsButton = document.getElementById('staffApprovalSettings');
const approvalSettingsDialog = document.getElementById('staffApprovalSettingsDialog');
const approvalSettingsForm = document.getElementById('staffApprovalSettingsForm');
const financeDecisionDialog = document.getElementById('financeDecisionDialog');
const financeDecisionForm = document.getElementById('financeDecisionForm');
const loginStatus = document.getElementById('staffLoginStatus');
const dashboardEl = document.getElementById('staffDashboard');
const dashboardStatus = document.getElementById('staffDashboardStatus');
const staffBrand = document.getElementById('staffBrand');
const identityEl = document.getElementById('staffIdentity');
const displayNameEl = document.getElementById('staffDisplayName');
const roleEl = document.getElementById('staffRole');
const welcomeTitle = document.getElementById('staffWelcomeTitle');
const signOutButton = document.getElementById('staffSignOut');
const switchUserButton = document.getElementById('staffSwitchUser');
const sidebarSignOutButton = document.getElementById('staffSidebarSignOut');
const sidebarSwitchUserButton = document.getElementById('staffSidebarSwitchUser');
const passwordSwitchUserButton = document.getElementById('staffPasswordSwitchUser');
const headerRefreshButton = document.getElementById('staffHeaderRefresh');
const themeToggleButton = document.getElementById('staffThemeToggle');
const themeToggleIcon = document.getElementById('staffThemeToggleIcon');
const sidebarThemeToggleButton = document.getElementById('staffSidebarThemeToggle');
const sidebarThemeToggleIcon = document.getElementById('staffSidebarThemeToggleIcon');
const summaryEl = document.getElementById('adminSummary');
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
const mobileNav = document.getElementById('staffMobileNav');
const moduleDialog = document.getElementById('staffModuleDialog');
const moduleGrid = document.getElementById('staffModuleGrid');
const moduleCloseButton = document.getElementById('staffModuleClose');
const requestedWorkspace = new URLSearchParams(window.location.search).get('workspace')?.trim().toLowerCase() || '';

let currentUser = null;
let dashboardData = null;
let activeSection = '';
let financeData = null;
let staffUsersData = [];
let staffAuditData = [];
let staffApprovalAccounts = [];
let activeTabs = [];
let approvalProfile = null;
let approvalAssetState = { signature: '', stamp: '' };
let pendingFinanceDecision = null;
let financeDecisionBiometricVerified = false;
let financeDecisionApprovalProof = '';
let profilePhotoState = '';
let staffBearerToken = '';
let staffSessionAbortController = new AbortController();
let passkeyStatusRequest = null;
let organizationDepartmentWorkspaceTab = 'overview';
let organizationDashboardChartsRequest = 0;
let incomeAnalyticsData = null;
let incomeAnalyticsFilter = { period: 'monthly' };
let recordsDeskRequest = 0;
let recordsDeskSearchTimer = 0;
let recordsDeskAbortController = null;
let recordsDeskHandoffContext = null;
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
  ['members', 'Departments & Members'],
  ['services', 'Services & Attendance'],
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
  ['staffUsers', 'Staff & Permissions']
];

const tabIcons = {
  overview: '\u2302',
  recordsDesk: '\u{1F5C2}',
  executiveOffice: '\u{1F4E8}',
  admissions: '\u{1F4DD}',
  formPurchases: '\u{1F9FE}',
  students: '\u{1F465}',
  studentConduct: '\u2696',
  members: '\u{1F465}',
  services: '\u{1F4C5}',
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
  staffUsers: '\u2699'
};

function clean(value) {
  return String(value ?? '').trim();
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
  if (staffBearerToken) {
    const requestUrl = new URL(typeof input === 'string' ? input : input.url, window.location.href);
    if (requestUrl.origin === window.location.origin && requestUrl.pathname.startsWith('/api/')) {
      const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
      headers.set('Authorization', `Bearer ${staffBearerToken}`);
      options.headers = headers;
    }
  }
  return window.fetch(input, options);
}

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

function friendlyPasskeyError(error) {
  if (error?.name === 'NotAllowedError') return 'Biometric verification was cancelled or timed out.';
  if (error?.name === 'InvalidStateError') return 'This device is already registered for biometric sign-in.';
  if (error?.name === 'SecurityError') return 'Biometric sign-in requires a secure HTTPS connection.';
  if (retryableCredentialManagerError(error)) return 'Your device credential manager could not open. Please try again or use your password.';
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
  profilePhotoState = clean(currentUser.profilePhotoUrl);
  document.getElementById('staffProfileDisplayName').value = currentUser.displayName || currentUser.username || '';
  renderProfilePhoto(profilePhotoState, currentUser.displayName || currentUser.username);
  setStatus(document.getElementById('staffProfileStatus'), '');
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
  currentUser = null;
  dashboardData = null;
  financeData = null;
  staffUsersData = [];
  staffAuditData = [];
  staffApprovalAccounts = [];
  approvalProfile = null;
  approvalAssetState = { signature: '', stamp: '' };
  pendingFinanceDecision = null;
  financeDecisionBiometricVerified = false;
  financeDecisionApprovalProof = '';
  profilePhotoState = '';
  incomeAnalyticsData = null;
  incomeAnalyticsFilter = { period: 'monthly' };
  organizationDepartmentWorkspaceTab = 'overview';
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
  renderProfilePhoto('', 'Staff');
  delete document.documentElement.dataset.edition;
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
  return key === 'executiveOffice' ? executiveOfficeTitle() : fallback;
}

function showDashboard(user, options = {}) {
  currentUser = user;
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
    : (isOrganisationOperations
      ? 'Monitor departments, meetings, offerings, programs and organisational activity.'
      : 'Monitor records, requests and departmental activity.');
  welcomeTitle.textContent = `Welcome, ${displayName}`;
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
  if (options.refreshPasskeys !== false) refreshPasskeyControls();
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
  staffBearerToken = '';
  const delays = [120, 300, 700, 1200];
  let lastMessage = '';
  for (const delay of delays) {
    await new Promise((resolve) => window.setTimeout(resolve, delay));
    const { response, data } = await sessionRequest();
    if (response.ok && data.authenticated && data.user) return data.user;
    lastMessage = data.message || lastMessage;
  }
  const memoryToken = clean(fallbackToken);
  if (memoryToken) {
    staffBearerToken = memoryToken;
    const { response, data } = await sessionRequest();
    if (response.ok && data.authenticated && data.user) return data.user;
    staffBearerToken = '';
    lastMessage = data.message || lastMessage;
  }
  throw new Error(lastMessage || `Your identity was verified, but this browser did not retain the new session for ${fallbackUser?.displayName || fallbackUser?.username || 'this account'}.`);
}

async function loadDashboard() {
  setDashboardRefreshLoading(true);
  setStatus(dashboardStatus, 'Loading permitted database records...');
  try {
    const response = await staffFetch('/api/admin', {
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
    showDashboard(currentUser, { refreshPasskeys: false });
    const allowed = data.allowedSections || currentUser.allowedSections || [];
    const workspaceSections = ['overview', ...allowed];
    if (!activeSection || !workspaceSections.includes(activeSection)) activeSection = 'overview';
    renderTabs(allowed);
    renderWorkspace(activeSection);
    renderSection(activeSection);
    setStatus(dashboardStatus, 'Dashboard updated.', 'ok');
  } catch (error) {
    setStatus(dashboardStatus, error.message || String(error), 'bad');
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
      ${verticalBars('Attendance by department', departmentSummary, 'Name', 'Attendance', 'blue')}
      ${verticalBars('Offerings by department', departmentSummary, 'Name', 'Offerings', 'gold')}
      ${verticalBars('Home churches by area / zone', areaSummary, 'AreaZone', 'HomeChurches', 'emerald')}
      ${verticalBars('Weekly home-church attendance by area / zone', areaSummary, 'AreaZone', 'Attendance', 'purple')}
      ${verticalBars('Program participants by country', countrySummary, 'Country', 'Participants', 'coral')}`;
  } catch (error) {
    if (requestId !== organizationDashboardChartsRequest
      || activeSection !== 'overview'
      || document.documentElement.dataset.edition !== 'church') return;
    dashboardChartsEl.hidden = false;
    dashboardChartsEl.innerHTML = `<article class="department-chart-card dashboard-chart-loading"><h3>Department recordings</h3><p class="status bad">${escapeHtml(error.message || String(error))}</p></article>`;
  }
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
      <span>${escapeHtml(card.label || '')}</span>
      ${card.note ? `<small>${escapeHtml(card.note)}</small>` : ''}
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
  if (active === 'executiveOffice' && liveData) {
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
  const tabs = [['overview', 'Dashboard'], ...tabConfig.filter(([key]) => allowed.includes(key))];
  activeTabs = tabs;
  tabsEl.innerHTML = tabs.map(([key, label]) => {
    label = staffTabLabel(key, label);
    const selected = key === activeSection ? ' selected' : '';
    return `<button type="button" class="child-card${selected}" data-tab="${escapeHtml(key)}" aria-selected="${key === activeSection}"><span class="staff-tab-icon" aria-hidden="true">${escapeHtml(tabIcons[key] || '•')}</span><span>${escapeHtml(label)}</span></button>`;
  }).join('');
  tabsEl.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => selectSection(button.dataset.tab, tabs.map(([key]) => key)));
  });
  renderMobileNavigation(tabs);
}

function renderWorkspace(active) {
  const overview = active === 'overview';
  welcomeEl.hidden = !overview;
  dashboardStatus.hidden = !overview;
  panelEl.hidden = overview;
  staffMainContent.classList.toggle('module-view-active', !overview);
  renderModuleSummary(active);
  renderDashboardCharts(dashboardData?.charts || {});
}

function selectSection(key, allowed = activeTabs.map(([tabKey]) => tabKey)) {
  if (!allowed.includes(key)) return;
  activeSection = key;
  renderTabs(allowed);
  renderWorkspace(activeSection);
  renderSection(activeSection);
  setSidebarOpen(false);
  if (moduleDialog.open) moduleDialog.close();
  (activeSection === 'overview' ? staffMainContent : panelEl).scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderMobileNavigation(tabs) {
  if (!tabs.length) {
    mobileNav.innerHTML = '';
    moduleGrid.innerHTML = '';
    return;
  }
  const findTab = (...keys) => tabs.find(([key]) => keys.includes(key));
  const homeTab = findTab('overview') || tabs[0];
  const peopleTab = findTab('recordsDesk', 'members', 'students', 'services', 'admissions') || homeTab;
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
  moduleGrid.innerHTML = tabs.map(([key, label], index) => `<button type="button" data-module="${escapeHtml(key)}" class="module-tone-${index % 6}${key === activeSection ? ' selected' : ''}"><span>${escapeHtml(tabIcons[key] || '•')}</span><strong>${escapeHtml(staffTabLabel(key, label))}</strong></button>`).join('');
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
  const uploaded = admissionDocuments.map(([key, label]) => {
    const item = uploadedDocument(row, key);
    return item ? { ...item, label } : null;
  }).filter(Boolean);
  if (!uploaded.length) return '<span class="muted">None uploaded</span>';
  const links = uploaded.map((item) => {
    const query = `applicationReference=${encodeURIComponent(reference)}&documentType=${encodeURIComponent(item.key)}`;
    const canDelete = ['Super Admin', 'Admissions Officer'].includes(clean(currentUser?.role));
    const fileName = item.fileName || `${reference}-${item.key}`;
    return `<div class="document-action-row"><span>${escapeHtml(item.label)}</span><button type="button" class="payslip-download document-file-action" data-protected-file="${escapeHtml(`/api/staff-document?${query}&mode=view`)}" data-file-mode="view" data-file-name="${escapeHtml(fileName)}">View</button><button type="button" class="payslip-download document-file-action" data-protected-file="${escapeHtml(`/api/staff-document?${query}&mode=download`)}" data-file-mode="download" data-file-name="${escapeHtml(fileName)}">Download</button>${canDelete ? `<button type="button" class="document-delete compact-icon-action compact-delete-action" data-delete-document="${escapeHtml(item.key)}" data-application-reference="${escapeHtml(reference)}" aria-label="Delete ${escapeHtml(item.label)}" title="Delete document"><span aria-hidden="true">&#128465;&#65038;</span></button>` : ''}</div>`;
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
  return `
    <aside class="commerce-receipt-preview" aria-live="polite">
      <div><small>Payment recorded</small><strong>${escapeHtml(sale.SaleNo || 'Sale')}</strong><span>${escapeHtml(sale.CustomerName || 'Walk-in customer')} &middot; ${money(sale.Amount || sale.GrossAmount)}</span></div>
      <div class="inline-action-group">
        <button type="button" class="compact-icon-action" data-commerce-print="${escapeHtml(sale.SaleNo || '')}" title="View and print receipt" aria-label="View and print receipt">&#128424;</button>
      </div>
      ${items.length ? `<small>${escapeHtml(items.map((item) => `${item.ItemName} x ${item.Quantity}`).join(', '))}</small>` : ''}
    </aside>`;
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
        <span class="workspace-feature-icon" aria-hidden="true">&#128722;</span>
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
            <div class="config-actionbar"><p class="status" data-commerce-status></p><button type="submit" id="commerceCheckoutButton" ${cartEntries.length ? '' : 'disabled'}>${draft.PaymentMethod === 'Paystack Online' ? 'Pay with Paystack' : 'Complete sale'}</button></div>
          </form>
        </section>
      </div>
      <details class="commerce-sales-history" ${recentSales.length ? '' : 'open'}>
        <summary>Recent sales <span>${recentSales.length}</span></summary>
        <div class="table-wrap"><table><thead><tr><th>Date</th><th>Receipt</th><th>Customer</th><th>Payment</th><th>Amount</th><th>Print</th></tr></thead><tbody>
          ${recentSales.length ? recentSales.map((row) => `<tr><td>${escapeHtml(clean(row.PaidAt || row.SaleDate || row.CreatedAt).replace('T', ' ').slice(0, 19))}</td><td>${escapeHtml(row.SaleNo)}</td><td>${escapeHtml(row.CustomerName || 'Walk-in customer')}</td><td>${escapeHtml(row.PaymentMethod)}<br>${commerceSaleStatus(row)}</td><td>${money(row.Amount || row.GrossAmount)}</td><td><button type="button" class="compact-icon-action" data-commerce-print="${escapeHtml(row.SaleNo)}" aria-label="Print receipt ${escapeHtml(row.SaleNo)}" title="Print receipt" ${clean(row.PaymentStatus || row.Status).toLowerCase() === 'paid' ? '' : 'disabled'}>&#128424;</button></td></tr>`).join('') : '<tr><td colspan="6">No sales recorded yet.</td></tr>'}
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

function printOrganizationCommerceReceipt(sale = {}) {
  if (!sale || clean(sale.PaymentStatus || sale.Status).toLowerCase() !== 'paid') return;
  const receiptWindow = window.open('', '_blank', 'width=820,height=900');
  if (!receiptWindow) {
    setStatus(dashboardStatus, 'Allow pop-ups to view and print this receipt.', 'bad');
    return;
  }
  receiptWindow.opener = null;
  const organisation = clean(document.querySelector('[data-school-name]')?.textContent || staffBrand?.textContent) || 'Dynamax';
  const logo = clean(document.querySelector('.nav-logo')?.getAttribute('src') || 'images/Logo.png');
  const items = Array.isArray(sale.Items) ? sale.Items : [];
  receiptWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(sale.SaleNo || 'Receipt')}</title><style>
    @page{size:A5;margin:12mm}*{box-sizing:border-box}body{margin:0;background:#eef4f8;color:#18324d;font:13px/1.45 Arial,sans-serif}.receipt{position:relative;max-width:620px;min-height:760px;margin:18px auto;padding:28px;border-top:7px solid #0c8b78;background:#fff;box-shadow:0 14px 35px #173b5820;overflow:hidden}.watermark{position:absolute;inset:25% 22%;width:56%;height:50%;object-fit:contain;opacity:.045}.brand,.meta,.total,.footer{position:relative}.brand{display:flex;align-items:center;gap:14px;padding-bottom:18px;border-bottom:2px solid #164d7a}.brand img{width:58px;height:58px;object-fit:contain}.brand h1{margin:0;color:#123f6d;font-size:21px}.brand p{margin:3px 0;color:#60758c}.meta{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:18px 0;padding:13px;background:#eaf4ff}.meta strong,.meta span{display:block}.meta span{font-size:11px;color:#60758c}table{position:relative;width:100%;border-collapse:collapse;margin:18px 0}th,td{padding:9px;border-bottom:1px solid #d8e4ee;text-align:left}th{background:#123f6d;color:white;font-size:10px;text-transform:uppercase}.number{text-align:right}.total{display:flex;justify-content:flex-end;gap:20px;padding:13px;background:#e5f7f1;color:#08725c;font-size:18px}.footer{margin-top:28px;padding-top:12px;border-top:1px solid #d8e4ee;color:#60758c;text-align:center}.print{position:fixed;top:10px;right:10px;padding:9px 13px;border:0;border-radius:7px;background:#1769e0;color:#fff;font-weight:bold;cursor:pointer}@media print{body{background:#fff}.receipt{min-height:auto;margin:0;padding:0;box-shadow:none}.print{display:none}}</style></head><body><button class="print" onclick="window.print()">Print / Save as PDF</button><main class="receipt">${logo ? `<img class="watermark" src="${escapeHtml(logo)}" alt="">` : ''}<header class="brand">${logo ? `<img src="${escapeHtml(logo)}" alt="">` : ''}<div><h1>${escapeHtml(organisation)}</h1><p>${escapeHtml(sale.Department || 'Sales')} payment receipt</p></div></header><section class="meta"><div><span>Receipt number</span><strong>${escapeHtml(sale.SaleNo)}</strong></div><div><span>Date</span><strong>${escapeHtml(clean(sale.PaidAt || sale.SaleDate).replace('T', ' ').slice(0, 19))}</strong></div><div><span>Customer</span><strong>${escapeHtml(sale.CustomerName || 'Walk-in customer')}</strong></div><div><span>Payment</span><strong>${escapeHtml(sale.PaymentMethod || '')}</strong></div>${sale.PaymentReference ? `<div><span>Reference</span><strong>${escapeHtml(sale.PaymentReference)}</strong></div>` : ''}</section><table><thead><tr><th>Item</th><th class="number">Qty</th><th class="number">Price</th><th class="number">Total</th></tr></thead><tbody>${items.map((item) => `<tr><td>${escapeHtml(item.ItemName || item.ItemCode)}</td><td class="number">${escapeHtml(item.Quantity)}</td><td class="number">${money(item.UnitPrice)}</td><td class="number">${money(item.Amount)}</td></tr>`).join('')}</tbody></table><div class="total"><span>Grand total</span><strong>${money(sale.Amount || sale.GrossAmount)}</strong></div><footer class="footer">Payment received with thanks &middot; Generated by Dynamax</footer></main></body></html>`);
  receiptWindow.document.close();
}

function bindOrganizationCommerceWorkspace(section, data = {}) {
  const workspace = document.getElementById('organizationCommercePOS');
  if (!workspace) return;
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
    if (checkoutButton) checkoutButton.textContent = value === 'Paystack Online' ? 'Pay with Paystack' : 'Complete sale';
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
    setButtonLoading(checkoutButton, true, payload.PaymentMethod === 'Paystack Online' ? 'Opening Paystack...' : 'Recording sale...', checkoutButton.textContent);
    try {
      const response = await staffFetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': payload.SaleRequestId },
        body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw receivedResponseError(result.message || 'Could not record this sale.');
      const authorizationUrl = clean(result.AuthorizationUrl || result.authorizationUrl || result.sale?.AuthorizationUrl);
      organizationCommerceLastSale[section] = result.sale || null;
      setStatus(status, result.message || 'Sale recorded.', 'ok');
      if (authorizationUrl) {
        window.location.assign(authorizationUrl);
        return;
      }
      commerceCart(section).clear();
      organizationCommerceSaleRequestIds[section] = '';
      organizationCommerceCustomerDraft[section] = { CustomerName: '', CustomerEmail: '', CustomerPhone: '', PaymentMethod: 'Cash', PaymentReference: '' };
      if (section === 'organizationStore') await loadStaffStore(section);
      else await loadDepartmentOperations(section);
    } catch (error) {
      setStatus(status, error.message || String(error), 'bad');
    } finally {
      setButtonLoading(checkoutButton, false, '', organizationCommerceCustomerDraft[section].PaymentMethod === 'Paystack Online' ? 'Pay with Paystack' : 'Complete sale');
    }
  });
  workspace.querySelectorAll('[data-commerce-print]').forEach((button) => button.addEventListener('click', () => {
    printOrganizationCommerceReceipt(organizationCommerceReceiptSale(section, data, button.dataset.commercePrint));
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
    <section class="config-card">
      <header class="config-card-heading"><div><small>Inventory setup</small><h3>Add or update an item</h3><p>Define how this product appears to ${storeAudience}.</p></div></header>
    <form id="staffStoreItemForm" class="workflow-form workflow-form-grid config-form">
      <label>Item code<input name="ItemCode" required></label><label>Item name<input name="ItemName" required></label>
      <label>Category<input name="Category" list="storeCategoryOptions" autocomplete="off" required><datalist id="storeCategoryOptions">${activeCategories.map((row) => `<option value="${escapeHtml(row.Name)}"></option>`).join('')}</datalist></label><label>Variant / size<input name="Size"></label>
      ${organisationStore ? '' : '<label>Gender<select name="Gender"><option>All</option><option>Male</option><option>Female</option></select></label><label>Class<input name="ClassName" value="All"></label>'}
      <label>Price<input name="Price" type="number" min="0" step="0.01" required></label><label>Stock quantity<input name="Quantity" type="number" min="0" step="1" required></label>
      <div class="config-actionbar"><label class="check-row"><input name="Active" type="checkbox" checked> ${organisationStore ? 'Available for sale' : 'Available to parents'}</label><p class="status" data-store-status></p><button type="submit">Save item</button></div>
    </form>
    </section>
    <details class="workflow-card config-details"><summary><span>Category management<small>Add, rename or deactivate reusable product categories.</small></span></summary>
      <form id="storeCategoryForm" class="workflow-form workflow-form-grid config-form"><input type="hidden" name="CategoryId"><label>Category name<input name="Name" required></label><label>Available in<select name="AppliesTo"><option value="${label}">${label}</option>${organisationStore ? '' : '<option value="Bookstore,Uniform Store">Both stores</option>'}</select></label><div class="config-actionbar"><label class="check-row"><input name="Active" type="checkbox" checked> Category active</label><p class="status" data-category-status></p><button type="submit">Save category</button></div></form>
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
      <article class="workflow-record store-order-record"><div class="workflow-record-heading"><div><strong>${escapeHtml(order.DisplayName || order.CustomerName || order.AccountRef || 'Customer')}</strong><small>${escapeHtml(order.OrderNo)}</small></div></div>
      <p>${money(order.Amount)} &middot; ${escapeHtml(order.PaidAt || order.CreatedAt || '')}</p>
      <button type="button" class="store-order-status ${collected ? 'is-collected' : ''}" data-store-order="${escapeHtml(order.OrderNo)}" data-store-status="${escapeHtml(nextStatus)}" aria-label="${escapeHtml(statusLabel)} for ${escapeHtml(order.DisplayName || order.AccountRef)}" ${collected ? 'disabled' : ''}>${escapeHtml(statusLabel)}</button></article>`;
    }).join('') : '<p class="muted">No paid orders yet.</p>'}</div>`;
  if (organisationStore) bindOrganizationCommerceWorkspace(section, store);
  document.getElementById('staffStoreItemForm')?.addEventListener('submit', async (event) => {
    event.preventDefault(); const form = event.currentTarget; const status = form.querySelector('[data-store-status]');
    const payload = Object.fromEntries(new FormData(form).entries()); payload.Active = form.elements.Active.checked;
    const match = activeCategories.find((row) => clean(row.Name).toLowerCase() === clean(payload.Category).toLowerCase());
    if (!match && !window.confirm(`Create "${payload.Category}" as a new ${label} category?`)) return;
    payload.CategoryId = match?.CategoryId || ''; payload.CreateCategoryIfMissing = !match;
    try {
      const response = await staffFetch('/api/staff-stores', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'saveItem', section, ...payload }) });
      const data = await response.json(); if (!response.ok || !data.ok) throw new Error(data.message || 'Could not save store item.');
      setStatus(status, data.message, 'ok'); await loadStaffStore(section);
    } catch (error) { setStatus(status, error.message || String(error), 'bad'); }
  });
  const categoryForm = document.getElementById('storeCategoryForm');
  categoryForm?.addEventListener('submit', async (event) => {
    event.preventDefault(); const form = event.currentTarget; const status = form.querySelector('[data-category-status]'); const payload = Object.fromEntries(new FormData(form).entries()); payload.Active = form.elements.Active.checked ? 'YES' : 'NO';
    try { const response = await staffFetch('/api/staff-stores', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'saveCategory', section, ...payload }) }); const data = await response.json(); if (!response.ok || !data.ok) throw new Error(data.message || 'Could not save category.'); setStatus(status, data.message, 'ok'); await loadStaffStore(section); } catch (error) { setStatus(status, error.message || String(error), 'bad'); }
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
      ? window.prompt(organisationStore
        ? 'Enter the order number or customer collection reference.'
        : "Scan or enter the student's card ID, admission number, or parent verification code.")
      : '';
    if (button.dataset.storeStatus === 'Collected' && !clean(collectionReference)) return;
    button.disabled = true;
    try {
      const response = await staffFetch('/api/staff-stores', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'updateOrder', section, OrderNo: button.dataset.storeOrder, Status: button.dataset.storeStatus, CollectionReference: collectionReference }) });
      const data = await response.json(); if (!response.ok || !data.ok) throw new Error(data.message || 'Could not update order.'); await loadStaffStore(section);
    } catch (error) { setStatus(dashboardStatus, error.message || String(error), 'bad'); button.disabled = false; }
  }));
}

async function loadStaffStore(section) {
  try { const response = await staffFetch('/api/staff-stores', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'list', section }) }); const data = await response.json(); if (!response.ok || !data.ok) throw new Error(data.message || 'Could not load school store.'); renderStaffStore(section, data); } catch (error) { panelEl.innerHTML = `<p class="status bad">${escapeHtml(error.message || String(error))}</p>`; }
}

async function submitDepartmentAction(section, action, form) {
  const status = form.querySelector('[data-department-status]');
  const button = form.querySelector('button[type="submit"]');
  const payload = Object.fromEntries(new FormData(form).entries());
  if (form.elements.Active?.type === 'checkbox') payload.Active = form.elements.Active.checked ? 'YES' : 'NO';
  setButtonLoading(button, true, 'Saving...', button.textContent);
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
    setButtonLoading(button, false, 'Saving...', button.dataset.normalText || 'Save');
  }
}

async function requestDepartmentAction(section, action, payload = {}) {
  const response = await staffFetch('/api/staff-departments', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, section, ...payload })
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.message || 'Could not complete the department action.');
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
    button.disabled = true;
    button.textContent = 'Waiting for card...';
    setStatus(status, 'Allow NFC access if prompted, then hold the student card near this device.', 'ok');
    const reader = new NDEFReader();
    reader.addEventListener('readingerror', () => {
      setStatus(status, 'This card could not be read. Confirm it is an NDEF-compatible card or enter its card ID manually.', 'bad');
    }, { once: true });
    reader.addEventListener('reading', (event) => {
      const cardId = walletCardIdFromNfc(event);
      controller.abort();
      button.disabled = false;
      button.textContent = normalText;
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
    button.disabled = false;
    button.textContent = normalText;
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
        <label>Purchase amount<input name="Amount" type="number" min="0.01" step="0.01" required placeholder="0.00"></label>
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
        <label>Reorder level<input name="ReorderLevel" type="number" min="0" step="0.01" value="0"></label>${section === 'restaurant' ? '<label>Selling price<input name="SalePrice" type="number" min="0" step="0.01" value="0" required></label>' : ''}<label>Notes<input name="Notes"></label>
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
  document.getElementById('refreshDepartmentOperations')?.addEventListener('click', () => loadDepartmentOperations(section));
  panelEl.querySelectorAll('[data-department-jump]').forEach((button) => button.addEventListener('click', () => {
    panelEl.querySelectorAll('[data-department-jump]').forEach((item) => item.classList.toggle('active', item === button));
    document.getElementById(button.dataset.departmentJump)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  document.getElementById('clinicRecordForm')?.addEventListener('submit', (event) => { event.preventDefault(); submitDepartmentAction(section, 'saveClinicRecord', event.currentTarget); });
  document.getElementById('walletLookupForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget; const status = form.querySelector('[data-department-status]');
    try { await requestDepartmentAction(section, 'lookupWallet', Object.fromEntries(new FormData(form).entries())); }
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
    try { await requestDepartmentAction(section, 'recordWalletPurchase', Object.fromEntries(new FormData(form).entries())); }
    catch (error) { setStatus(status, error.message || String(error), 'bad'); }
  });
  document.getElementById('prepareClinicReport')?.addEventListener('click', async () => {
    const form = document.getElementById('clinicReportForm'); const status = form.querySelector('[data-department-status]');
    try { await requestDepartmentAction(section, 'prepareClinicReport', Object.fromEntries(new FormData(form).entries())); }
    catch (error) { setStatus(status, error.message || String(error), 'bad'); }
  });
  document.getElementById('clinicReportForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget; const status = form.querySelector('[data-department-status]');
    try { await requestDepartmentAction(section, 'sendClinicReport', Object.fromEntries(new FormData(form).entries())); }
    catch (error) { setStatus(status, error.message || String(error), 'bad'); }
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
    try { await requestDepartmentAction(section, 'sendMarketList', payload); }
    catch (error) { setStatus(status, error.message || String(error), 'bad'); }
  });
  document.getElementById('departmentInventoryForm')?.addEventListener('submit', (event) => { event.preventDefault(); submitDepartmentAction(section, 'saveItem', event.currentTarget); });
  document.getElementById('departmentMovementForm')?.addEventListener('submit', (event) => { event.preventDefault(); submitDepartmentAction(section, 'recordMovement', event.currentTarget); });
  panelEl.querySelectorAll('[data-edit-inventory]').forEach((button) => button.addEventListener('click', () => {
    const row = inventory.find((item) => clean(item.ItemName) === button.dataset.editInventory);
    const form = document.getElementById('departmentInventoryForm');
    if (!row || !form) return;
    ['ItemName', 'Category', 'Unit', 'Quantity', 'ReorderLevel', 'SalePrice', 'Notes'].forEach((key) => { if (form.elements[key]) form.elements[key].value = row[key] ?? (key === 'SalePrice' ? row.Price : ''); });
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
    document.getElementById('refreshChurchMembers')?.addEventListener('click', loadChurchMembership);
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
  return Object.fromEntries(new FormData(form).entries());
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
  const meetings = data.departmentMeetings || [];
  const offerings = data.departmentOfferings || [];
  const programs = data.specialPrograms || [];
  const departmentSummary = data.summaries?.departments || [];
  const areaSummary = data.summaries?.homeChurchAreas || [];
  const countrySummary = data.summaries?.participantsByCountry || [];
  const departmentCards = departmentSummary.map((row, index) => `
    <article class="module-stat tone-${(index % 5) + 1}">
      <strong>${escapeHtml(row.Name)}</strong>
      <span>${escapeHtml(row.Members)} members · ${escapeHtml(row.Meetings)} meetings</span>
      <small>${escapeHtml(row.Attendance)} attendance · ${money(row.Offerings)} offerings</small>
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
        <label class="inline-check"><input type="checkbox" name="Active" value="YES" checked> Active</label>
        <button type="submit">Save department</button>
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
        <input name="Amount" type="number" min="0.01" step="0.01" placeholder="Amount" required>
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
      { label: 'Type', value: (row) => row.DepartmentType },
      { label: 'Area / zone', value: (row) => row.AreaZone },
      { label: 'Status', value: (row) => row.Active },
      { label: 'Actions', render: (row) => `<button class="compact-icon-action compact-delete-action" data-delete-department="${escapeHtml(row.DepartmentId || row.__id)}" title="Delete department" aria-label="Delete ${escapeHtml(row.Name)}">✕</button>` }
    ])}
    ${table('Department members and positions', data.departmentMembers || [], [
      { label: 'Department', value: (row) => row.DepartmentName || row.DepartmentId },
      { label: 'Member', value: (row) => row.DisplayName || row.MemberId },
      { label: 'Position', value: (row) => row.PositionName || row.PositionId },
      { label: 'Status', value: (row) => row.Status }
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
  const memberOptions = `<option value="">Choose member</option>${members.map((row) => `<option value="${escapeHtml(row.MemberId || row.__id)}">${escapeHtml(row.DisplayName || row.MemberId)}</option>`).join('')}`;
  const meetingOptions = `<option value="">Choose meeting</option>${meetings.map((row) => `<option value="${escapeHtml(row.MeetingId)}">${escapeHtml(`${row.Date || ''} · ${row.Title || row.MeetingId}`)}</option>`).join('')}`;
  const positionOptions = `<option value="">No position</option>${positions.map((row) => `<option value="${escapeHtml(row.PositionId)}">${escapeHtml(row.Name)}</option>`).join('')}`;
  const programOptions = `<option value="">Choose program</option>${programs.map((row) => `<option value="${escapeHtml(row.ProgramId)}">${escapeHtml(row.Name)}</option>`).join('')}`;
  const departmentCards = departmentSummary.map((row, index) => `
    <article class="module-stat tone-${(index % 5) + 1}">
      <strong>${escapeHtml(row.Name)}</strong>
      <span>${escapeHtml(row.Members)} members · ${escapeHtml(row.Meetings)} meetings</span>
      <small>${escapeHtml(row.Attendance)} attendance · ${money(row.Offerings)} offerings</small>
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
      <div class="department-form-grid department-two-column-grid">
        <form id="organizationDepartmentEditor" class="workflow-card compact-form department-editor-card" data-department-action="saveDepartment">
          <h3>Create or edit department</h3>
          <input name="DepartmentId" placeholder="Department ID" required><input name="Name" placeholder="Department name" required>
          <select name="DepartmentType"><option>Department</option><option>Home Church</option><option>Home Cell</option><option>Foreign Desk</option></select>
          <input name="AreaZone" placeholder="Area / zone"><input name="Description" placeholder="Description">
          <label class="inline-check"><input type="checkbox" name="Active" value="YES" checked> Active</label>
          <button type="submit">Save department</button>
        </form>
        <aside class="workflow-card department-guidance-card"><span aria-hidden="true">⌂</span><div><h3>Structure guidance</h3><p>Use departments for ministry teams, Home Church or Home Cell for area-based groups, and Foreign Desk for international visitors.</p><ul><li>Give every record a stable Department ID.</li><li>Add an area or zone for home churches.</li><li>Deactivate records that should remain in history.</li></ul></div></aside>
      </div>
      ${table('Department register', departments, [
        { label: 'Department', value: (row) => row.Name },
        { label: 'Type', value: (row) => row.DepartmentType },
        { label: 'Area / zone', value: (row) => row.AreaZone },
        { label: 'Status', value: (row) => row.Active },
        { label: 'Actions', render: (row) => `<span class="compact-row-actions"><button class="compact-icon-action" data-edit-department="${escapeHtml(row.DepartmentId || row.__id)}" title="Edit department" aria-label="Edit ${escapeHtml(row.Name)}">✎</button><button class="compact-icon-action compact-delete-action" data-delete-department="${escapeHtml(row.DepartmentId || row.__id)}" title="Delete department" aria-label="Delete ${escapeHtml(row.Name)}">✕</button></span>` }
      ])}
    </section>

    <section class="organization-workspace-panel" data-organization-workspace-panel="members"${panelState('members')}>
      <div class="department-panel-heading"><div><small>People and responsibilities</small><h3>Members & Positions</h3></div><p>Define positions and assign registered members to department responsibilities.</p></div>
      <div class="department-form-grid department-two-column-grid">
        <form class="workflow-card compact-form" data-department-action="savePosition"><h3>Create a position</h3><select name="DepartmentId" required>${departmentOptions(departments)}</select><input name="PositionId" placeholder="Position ID" required><input name="Name" placeholder="Position name" required><button type="submit">Save position</button></form>
        <form class="workflow-card compact-form" data-department-action="saveDepartmentMember"><h3>Assign a member</h3><select name="DepartmentId" required>${departmentOptions(departments)}</select><select name="MemberId" required>${memberOptions}</select><select name="PositionId">${positionOptions}</select><button type="submit">Assign member</button></form>
      </div>
      ${table('Department members and positions', departmentMembers, [
        { label: 'Department', value: (row) => row.DepartmentName || row.DepartmentId },
        { label: 'Member', value: (row) => row.DisplayName || row.MemberId },
        { label: 'Position', value: (row) => row.PositionName || row.PositionId },
        { label: 'Status', value: (row) => row.Status }
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
        { label: 'Type', value: (row) => row.MemberId ? 'Member' : 'Visitor' }, { label: 'Recorded at', value: (row) => row.RecordedAt || row.CreatedAt }
      ])}
    </section>

    <section class="organization-workspace-panel" data-organization-workspace-panel="offerings"${panelState('offerings')}>
      <div class="department-panel-heading"><div><small>Department finance</small><h3>Offerings & Remittance</h3></div><p>Submit meeting offerings and track their remittance to Accounts.</p></div>
      <div class="department-form-grid department-single-form-grid">
        <form class="workflow-card compact-form" data-department-action="saveOffering"><h3>Submit departmental offering</h3><select name="DepartmentId" required>${departmentOptions(departments)}</select><select name="MeetingId"><option value="">No linked meeting</option>${meetings.map((row) => `<option value="${escapeHtml(row.MeetingId)}">${escapeHtml(row.Title || row.MeetingId)}</option>`).join('')}</select><input name="OfferingId" value="DOF-${Date.now()}" required><input name="Date" type="date" required><input name="Amount" type="number" min="0.01" step="0.01" placeholder="Amount" required><select name="PaymentMethod"><option>Cash</option><option>Online</option><option>Transfer</option><option>Card</option></select><input name="PaymentReference" placeholder="Payment / remittance reference"><button type="submit">Submit offering</button></form>
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
    panelEl.innerHTML = organizedDepartmentWorkspace(data);
    const status = document.getElementById('organizationDepartmentStatus');
    document.getElementById('refreshOrganizationDepartments')?.addEventListener('click', loadOrganizationDepartments);
    panelEl.querySelectorAll('[data-organization-workspace-tab]').forEach((button) => button.addEventListener('click', () => {
      setOrganizationDepartmentWorkspaceTab(button.dataset.organizationWorkspaceTab);
    }));
    setOrganizationDepartmentWorkspaceTab(organizationDepartmentWorkspaceTab);
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
        ['DepartmentId', 'Name', 'DepartmentType', 'AreaZone', 'Description'].forEach((field) => {
          if (form.elements[field]) form.elements[field].value = clean(department[field]);
        });
        form.elements.Active.checked = !['no', 'false', '0', 'inactive'].includes(lower(department.Active || 'YES'));
        form.elements.Name.focus();
      }
    } else if (selectedMemberId) {
      setOrganizationDepartmentWorkspaceTab('members');
      panelEl.querySelectorAll('select[name="MemberId"]').forEach((select) => {
        const option = [...select.options].find((item) =>
          recordsDeskReferenceKey(item.value) === recordsDeskReferenceKey(selectedMemberId));
        if (option) select.value = option.value;
      });
    }
    panelEl.querySelectorAll('[data-department-action]').forEach((form) => form.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        setStatus(status, 'Saving...');
        const result = await organizationDepartmentAction(form.dataset.departmentAction, departmentFormPayload(form));
        setStatus(status, result.message || 'Saved.', 'good');
        await loadOrganizationDepartments();
      } catch (error) { setStatus(status, error.message || String(error), 'bad'); }
    }));
    panelEl.querySelectorAll('[data-edit-department]').forEach((button) => button.addEventListener('click', () => {
      const department = (data.departments || []).find((row) => clean(row.DepartmentId || row.__id) === clean(button.dataset.editDepartment));
      const form = document.getElementById('organizationDepartmentEditor');
      if (!department || !form) return;
      setOrganizationDepartmentWorkspaceTab('departments');
      ['DepartmentId', 'Name', 'DepartmentType', 'AreaZone', 'Description'].forEach((field) => {
        if (form.elements[field]) form.elements[field].value = clean(department[field]);
      });
      form.elements.Active.checked = !['no', 'false', '0', 'inactive'].includes(lower(department.Active || 'YES'));
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      form.elements.Name.focus();
    }));
    panelEl.querySelectorAll('[data-delete-department]').forEach((button) => button.addEventListener('click', async () => {
      if (!window.confirm('Delete this department? Departments with members or meetings cannot be deleted.')) return;
      try { await organizationDepartmentAction('deleteDepartment', { DepartmentId: button.dataset.deleteDepartment }); await loadOrganizationDepartments(); }
      catch (error) { setStatus(status, error.message || String(error), 'bad'); }
    }));
    panelEl.querySelectorAll('[data-mark-offering-paid]').forEach((button) => button.addEventListener('click', async () => {
      const reference = window.prompt('Enter the remittance reference:');
      if (reference === null) return;
      try { await organizationDepartmentAction('markOfferingPaid', { OfferingId: button.dataset.markOfferingPaid, RemittanceReference: reference }); await loadOrganizationDepartments(); }
      catch (error) { setStatus(status, error.message || String(error), 'bad'); }
    }));
  } catch (error) {
    if (activeSection === 'members') panelEl.innerHTML = `<p class="status bad">${escapeHtml(error.message || String(error))}</p>`;
  }
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
    const response = await staffFetch('/api/staff-funds', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list', BranchId: currentUser?.branchId || 'main' })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.message || 'Could not load church funds.');
    if (activeSection !== 'funds') return;
    renderModuleSummary('funds', data);
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
  const data = await response.json().catch(() => ({ ok: false, message: 'Church donation service did not return JSON.' }));
  if (!response.ok || !data.ok) {
    if (response.status === 401) {
      showLogin(data.message || 'Your staff session has expired.', 'bad');
    }
    throw receivedResponseError(data.message || 'Church donation action failed.');
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
  const data = await response.json().catch(() => ({ ok: false, message: 'Church donation online-init service did not return JSON.' }));
  if (!response.ok || !data.ok) {
    if (response.status === 401) {
      showLogin(data.message || 'Your staff session has expired.', 'bad');
    }
    throw receivedResponseError(data.message || 'Could not initialize online church donation payment.');
  }
  return data;
}


async function loadChurchDonations() {
  try {
    const methods = ['CASH', 'BANK TRANSFER', 'CHEQUE', 'POS', 'ONLINE', 'CARD', 'MOBILE MONEY'];
    const currencies = ['NGN', 'USD', 'GBP', 'EUR', 'KES', 'GHS'];
    const paymentTypes = ['Donation', 'Tithe', 'Offering', 'Seed', 'Building Fund', 'Other'];
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
            <label>Receipt subject (after payment) <input name="ReceiptSubject" value="Thank you for your donation"></label>
            <label>Receipt message (after payment) <input name="ReceiptMessage" value="Your gift was received."></label>
          </div>
          <label>Notes
            <textarea name="Notes" rows="2" placeholder="Optional notes for donation records."></textarea>
          </label>
          <label class="check-row config-switch" style="display:flex;align-items:center;justify-content:flex-start;gap:8px;"><input name="sendOnlineEmail" type="checkbox" checked style="flex:0 0 16px;width:16px;height:16px;min-height:16px;margin:0;padding:0;"><span>Send online payment link for this donation</span></label>
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
            if (!donationId) return 'No id';
            const canSendReceipt = capabilities.canSendReceipt;
            const canCollect = capabilities.canCollect;
            const receiptSent = clean(pick(row, ['ReceiptStatus'])).toLowerCase() === 'sent'
              || Boolean(clean(pick(row, ['ReceiptSentAt'])));
            const paymentLinkSentAt = clean(pick(row, ['PaymentLinkSentAt']));
            const paymentLinkSentTo = clean(pick(row, ['PaymentLinkSentTo']));
            const paymentLinkSent = Boolean(paymentLinkSentAt || paymentLinkSentTo);
            if (receiptSent) {
              return '<button type="button" class="table-action" disabled aria-disabled="true">Receipt sent</button>';
            }
            if (status === 'paid' && canSendReceipt) {
              return `<button type="button" class="table-action" data-donation-action="sendreceipt" data-donation-id="${escapeHtml(donationId)}">Send receipt</button>`;
            }
            if (status === 'pending' && paymentLinkSent) {
              const sentDetail = [paymentLinkSentTo, paymentLinkSentAt].filter(Boolean).join(' · ');
              return `<button type="button" class="table-action" disabled aria-disabled="true" title="${escapeHtml(sentDetail || 'Payment link sent')}">Payment link sent</button>`;
            }
            if (status === 'pending' && canCollect) {
              return `<button type="button" class="table-action" data-donation-action="sendpayment" data-donation-id="${escapeHtml(donationId)}">Send payment link</button>`;
            }
            return '';
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

    document.getElementById('refreshChurchDonations')?.addEventListener('click', loadChurchDonations);
  } catch (error) {
    if (activeSection === 'donations') panelEl.innerHTML = `<p class="status bad">${escapeHtml(error.message || String(error))}</p>`;
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
        const idempotencyKey = button.dataset.idempotencyKey || newIdempotencyKey();
        button.dataset.idempotencyKey = idempotencyKey;
        const normalMarkup = button.innerHTML;
        button.disabled = true;
        try {
          const data = await doOfferingAction(action, offeringId, reason, idempotencyKey);
          delete button.dataset.idempotencyKey;
          setStatus(dashboardStatus, data.message, 'ok');
          await loadChurchOfferings();
        } catch (error) {
          if (error?.responseReceived) delete button.dataset.idempotencyKey;
          setStatus(dashboardStatus, error.message || String(error), 'bad');
        } finally {
          button.disabled = false;
          button.innerHTML = normalMarkup;
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
  return `<div class="income-bar-chart" role="img" aria-label="Income over time">${rows.map((row) => {
    const height = Math.max(3, Math.round(Math.abs(Number(row.value || 0)) / maximum * 100));
    return `<div class="income-bar-item" title="${escapeHtml(row.label)}: ${escapeHtml(money(row.value))}">
      <strong>${escapeHtml(compactMoney(row.value))}</strong>
      <div><i style="height:${height}%"></i></div>
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
  const accountOptions = (options.accounts || []).map((row) => ({ ...row, label: `${row.code} - ${row.name}` }));
  const periodButtons = [
    ['daily', 'Daily'],
    ['weekly', 'Weekly'],
    ['monthly', 'Monthly'],
    ['quarterly', 'Quarterly']
  ].map(([key, label]) => `<button type="button" data-income-period="${key}" class="${period.mode === key ? 'active' : ''}">${label}</button>`).join('');
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
          <label>Branch<select name="branchId">${incomeOptionList(options.branches, '', '', selectedBranch, 'All branches')}</select></label>
          <label>Department<select name="department">${incomeOptionList(options.departments, '', '', incomeAnalyticsFilter.department, 'All departments')}</select></label>
          <label>Income account<select name="accountCode">${incomeOptionList(accountOptions, 'code', 'label', incomeAnalyticsFilter.accountCode, 'All income accounts')}</select></label>
          <label>Payment route<select name="channel">${incomeOptionList(options.channels, '', '', incomeAnalyticsFilter.channel, 'All payment routes')}</select></label>
          <label>Income source<select name="source">${incomeOptionList(options.sources, '', '', incomeAnalyticsFilter.source, 'All income sources')}</select></label>
          <button type="submit">Apply filters</button>
        </form>
      </section>
      <div class="income-report-period"><span>${escapeHtml(period.dateFrom)} to ${escapeHtml(period.dateTo)}</span><strong>${escapeHtml(money(data.summary?.totalIncome))}</strong><small>${escapeHtml(data.summary?.transactionCount || 0)} transaction${Number(data.summary?.transactionCount) === 1 ? '' : 's'}</small></div>
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
          { label: 'Amount', value: (row) => money(row.amount) }
        ])}
      </section>
    </div>`;
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
  const headings = ['Date', 'Reference', 'Description', 'Source', 'Department', 'Payment Route', 'Income Account', 'Amount'];
  const content = [headings, ...rows.map((row) => [
    row.date, row.reference || row.journalNo, row.description, row.source,
    row.department, row.channel, row.accounts, Number(row.amount || 0).toFixed(2)
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
  departments: 'Departments'
};

const recordsDeskTypeIcons = {
  students: '\u{1F393}',
  applicants: '\u{1F4DD}',
  staff: '\u{1F9D1}',
  members: '\u{1F465}',
  departments: '\u{1F3E2}'
};

function inferredRecordsDeskTypes() {
  const allowed = new Set(currentUser?.allowedSections || []);
  const edition = resolveDashboardEdition(currentUser || {});
  const school = edition === 'school';
  return [
    school && ['students', 'accounts', 'clinic', 'tuckShop'].some((key) => allowed.has(key)) && 'students',
    school && allowed.has('admissions') && 'applicants',
    allowed.has('staffUsers') && 'staff',
    !school && allowed.has('members') && 'members',
    !school && ['members', 'funds', 'offerings'].some((key) => allowed.has(key)) && 'departments'
  ].filter(Boolean);
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
      <span><strong>${escapeHtml(row.title)}</strong><small>${escapeHtml(row.meta || row.status || '')}</small></span>
      ${row.amount === undefined ? '' : `<b>${escapeHtml(money(row.amount))}</b>`}
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
  panelEl.innerHTML = `<section class="records-desk-shell${recordsDeskState.detail || recordsDeskState.loadingDetail ? ' detail-open' : ''}">
    <aside class="records-desk-filters">
      <div class="records-desk-heading"><span aria-hidden="true">\u{1F5C2}</span><div><small>Universal lookup</small><h2>Records Desk</h2></div></div>
      <form id="recordsDeskSearchForm" class="records-desk-search" role="search">
        <label for="recordsDeskSearch">Search permitted records</label>
        <div><span aria-hidden="true">\u{1F50D}</span><input id="recordsDeskSearch" name="query" type="search" minlength="3" maxlength="120" autocomplete="off" placeholder="Name, ID, phone, email..." value="${escapeHtml(recordsDeskState.query)}"><button type="submit">Search</button></div>
      </form>
      <nav class="records-desk-type-list" aria-label="Record type filters">
        ${typeButtons.map(([key, label, icon]) => `<button type="button" data-record-filter="${escapeHtml(key)}" class="${recordsDeskState.type === key ? 'active' : ''}" aria-pressed="${recordsDeskState.type === key}"><span aria-hidden="true">${escapeHtml(icon)}</span><span>${escapeHtml(label)}</span></button>`).join('')}
      </nav>
      <div class="records-desk-privacy"><span aria-hidden="true">\u{1F6E1}</span><p><strong>Permission protected</strong><small>Results and detail sections follow your role, branch and school-section access.</small></p></div>
    </aside>
    <section class="records-desk-results-pane" aria-live="polite">
      <header><div><small>Search results</small><h2>${escapeHtml(recordsDeskState.type === 'all' ? 'All permitted records' : recordsDeskTypeLabels[recordsDeskState.type])}</h2></div><span>${recordsDeskState.results.length}</span></header>
      <div class="records-desk-result-message" id="recordsDeskResultMessage">${resultMessage}</div>
      <div class="records-desk-results">${recordsDeskState.results.map(renderRecordsDeskResult).join('')}</div>
    </section>
    <article class="records-desk-detail-pane" aria-live="polite">${renderRecordsDeskDetail(recordsDeskState.detail)}</article>
  </section>`;
  bindRecordsDeskEvents();
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
        <button type="button" class="secondary" data-executive-open="directory">Open directory</button>
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
  document.getElementById('refreshExecutiveOffice')?.addEventListener('click', loadExecutiveOffice);
  panelEl.querySelectorAll('[data-executive-tab]').forEach((button) => button.addEventListener('click', () => switchExecutiveOfficeTab(button.dataset.executiveTab)));
  panelEl.querySelectorAll('[data-executive-open]').forEach((button) => button.addEventListener('click', () => {
    if (button.dataset.executiveOpen === 'compose') executiveSelectedRecipient = null;
    switchExecutiveOfficeTab(button.dataset.executiveOpen);
  }));
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
      window.alert('Allow pop-ups to view and print this document.');
      return;
    }
    printableWindow.document.write('<p style="font:14px Arial;padding:24px">Preparing official document...</p>');
    setButtonLoading(button, true, '', '');
    try {
      const data = await executiveOfficeRequest('document', { correspondenceId: button.dataset.printExecutive });
      openExecutivePrint(data.correspondence || {}, data.printable || {}, printableWindow);
    } catch (error) {
      printableWindow.close();
      window.alert(error.message || String(error));
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
    const normalText = button.textContent;
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
      setButtonLoading(button, false, '', normalText);
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
  return `
    <form id="studentConductForm" class="student-conduct-form">
      <input type="hidden" name="CaseId" value="${escapeHtml(selected.CaseId || '')}">
      <label>Student
        <select name="StudentRef" required>
          <option value="">Choose student</option>
          ${(data.students || []).map((row) => option(
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

function renderStudentConduct(selected = {}) {
  if (activeSection !== 'studentConduct' || !studentConductData) return;
  const data = studentConductData;
  const summary = data.summary || {};
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
        <p class="eyebrow">${selected.CaseId ? 'Update committee case' : 'New committee case'}</p>
        <h3>${selected.CaseId ? escapeHtml(selected.CaseId) : 'Record an incident'}</h3>
        ${studentConductForm(data, selected)}
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
              <button type="button" class="compact-icon-action compact-edit-action" data-edit-conduct="${escapeHtml(row.CaseId)}" aria-label="Edit ${escapeHtml(row.CaseId)}" title="Edit case">&#9998;</button>
              ${data.permissions?.canDelete ? `<button type="button" class="compact-icon-action compact-delete-action" data-delete-conduct="${escapeHtml(row.CaseId)}" aria-label="Delete ${escapeHtml(row.CaseId)}" title="Delete case">&#10005;</button>` : ''}
            </span>` }
        ])}
      </section>
    </div>`;
  document.getElementById('refreshStudentConduct')?.addEventListener('click', loadStudentConduct);
  document.getElementById('cancelStudentConductEdit')?.addEventListener('click', () => renderStudentConduct());
  panelEl.querySelectorAll('[data-edit-conduct]').forEach((button) => button.addEventListener('click', () => {
    const row = (data.cases || []).find((item) => clean(item.CaseId) === clean(button.dataset.editConduct));
    if (row) renderStudentConduct(row);
  }));
  panelEl.querySelectorAll('[data-delete-conduct]').forEach((button) => button.addEventListener('click', async () => {
    if (!window.confirm('Delete this conduct case? The deletion will be audited.')) return;
    try {
      await studentConductRequest('delete', { CaseId: button.dataset.deleteConduct });
      await loadStudentConduct();
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
    const data = await studentConductRequest('list');
    if (activeSection !== 'studentConduct') return;
    studentConductData = data;
    renderModuleSummary('studentConduct', data);
    renderStudentConduct();
  } catch (error) {
    if (activeSection === 'studentConduct') {
      panelEl.innerHTML = `<p class="status bad">${escapeHtml(error.message || String(error))}</p>`;
    }
  }
}

function renderSection(active) {
  if (!dashboardData) return;
  panelEl.classList.toggle('school-store-panel', active === 'bookstore' || active === 'uniformStore' || active === 'organizationStore');
  if (active === 'overview') {
    panelEl.innerHTML = '';
    return;
  }
  const departments = dashboardData.departments || {};
  if (active === 'recordsDesk') {
    renderRecordsDesk();
  } else if (active === 'executiveOffice') {
    panelEl.innerHTML = `<div class="executive-loading"><span class="records-desk-spinner" aria-hidden="true"></span><strong>Opening ${escapeHtml(executiveOfficeTitle())}...</strong><small>Loading authorised metrics, directories, templates and correspondence.</small></div>`;
    loadExecutiveOffice();
  } else if (active === 'staffUsers') {
    panelEl.innerHTML = '<p class="muted">Loading staff accounts...</p>';
    loadStaffUsers();
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
    panelEl.innerHTML = table('Admission Form Purchases', departments.formPurchases || [], [
      { label: 'Receipt', value: (row) => pick(row, ['ReceiptNo', '__id']) },
      { label: 'Applicant', value: (row) => pick(row, ['ApplicantName']) },
      { label: 'Email', value: (row) => pick(row, ['Email']) },
      { label: 'Class', value: (row) => pick(row, ['ClassApplyingFor']) },
      { label: 'Amount', value: (row) => money(pick(row, ['AmountPaid', 'Amount'])) }
    ]);
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
    panelEl.innerHTML = recordsDeskHandoffBanner(handoff, reference) + table('Payments', payments, [
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
    ]);
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
    const documentType = button.dataset.deleteDocument;
    if (!window.confirm('Delete this uploaded document? The file will be moved to Google Drive trash.')) return;
    const normalMarkup = button.innerHTML;
    setButtonLoading(button, true, '', '');
    try {
      const response = await staffFetch('/api/staff-document', {
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
  let actions = `<button type="button" class="compact-icon-action compact-print-action" data-print-finance-record="${escapeHtml(id)}" data-record-type="${type}" aria-label="View and print ${escapeHtml(id)}" title="View and print"><span aria-hidden="true">&#128424;&#65038;</span></button>`;
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
                  <td><input data-material-field="unitPrice" aria-label="Unit price 1" type="number" min="0.01" step="0.01" inputmode="decimal" required></td>
                  <td><output data-material-line-total>₦0.00</output></td>
                </tr>
              </tbody>
              <tfoot><tr class="material-grand-total-row"><th colspan="5">Grand Total</th><th><output data-material-grand-total>₦0.00</output></th></tr></tfoot>
            </table>
          </div>
          <div class="material-entry-actions"><button type="button" data-add-material-item>+ Add Item</button></div>
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
    <div class="workflow-ledger-heading"><div><h2>Recent Transactions</h2><p class="muted">Requisitions and bills synchronized with desktop accounting</p></div>${capabilities.canSubmit ? '<button type="button" class="finance-new-request" data-open-dialog="requisitionDialog">+ New Requisition</button>' : ''}</div>
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
    const idempotencyKey = form.dataset.idempotencyKey || newIdempotencyKey();
    form.dataset.idempotencyKey = idempotencyKey;
    const payload = { ...formPayload(form), items: materialRequisitionItems(form), idempotencyKey };
    setButtonLoading(button, true, 'Submitting...', 'Submit Material Requisition');
    setStatus(status, 'Saving to database...');
    try {
      await financeRequest('submitMaterialRequisition', payload);
      delete form.dataset.idempotencyKey;
      setStatus(status, 'Material requisition submitted.', 'ok');
      await loadFinanceWorkflow();
    } catch (error) {
      if (error?.responseReceived) delete form.dataset.idempotencyKey;
      setStatus(status, error.message || String(error), 'bad');
    } finally {
      setButtonLoading(button, false, 'Submitting...', 'Submit Material Requisition');
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
    setButtonLoading(button, true, 'Submitting...', button.dataset.normalText || button.textContent);
    if (!button.dataset.normalText) button.dataset.normalText = action === 'submitBill' ? 'Submit Supplier Bill' : 'Submit Requisition';
    setStatus(status, 'Saving to database...');
    try {
      const idempotencyKey = form.dataset.idempotencyKey || newIdempotencyKey();
      form.dataset.idempotencyKey = idempotencyKey;
      await financeRequest(action, { ...formPayload(form), idempotencyKey });
      delete form.dataset.idempotencyKey;
      form.reset();
      setStatus(status, successText, 'ok');
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

function renderStaffUsers() {
  if (activeSection !== 'staffUsers') return;
  const activeUsers = staffUsersData.filter((user) => yes(user.Active)).length;
  const admins = staffUsersData.filter((user) => user.Role === 'Super Admin' && yes(user.Active)).length;
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
          <div class="staff-user-copy"><strong>${escapeHtml(user.DisplayName || user.Username)}</strong><span>@${escapeHtml(user.Username)} • ${escapeHtml(user.Role)}</span><small>${escapeHtml(user.Department || 'No department')} • ${escapeHtml(user.BranchId || 'All branches')} / ${escapeHtml(user.SchoolSectionAccess || 'All sections')}${yes(user.MustChangePassword) ? ' • Password change required' : ''}</small></div>
          <span class="workflow-status ${yes(user.Active) ? 'status-approved' : 'status-rejected'}">${yes(user.Active) ? 'Active' : 'Disabled'}</span>
          <div class="staff-user-actions"><button type="button" class="compact-icon-action compact-edit-action" data-edit-user="${escapeHtml(user.Username)}" aria-label="Edit ${escapeHtml(user.DisplayName || user.Username)}" title="Edit staff account"><span aria-hidden="true">&#9998;</span></button><button type="button" class="compact-icon-action compact-delete-action" data-delete-user="${escapeHtml(user.Username)}" aria-label="Delete ${escapeHtml(user.DisplayName || user.Username)}" title="Delete staff account"><span aria-hidden="true">&#128465;&#65038;</span></button></div>
        </article>
      `).join('') : '<p class="muted">No database staff accounts found. Create the first shared staff account.</p>'}
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
          <label>Role <select name="Role" required>${['Super Admin','Principal','Senior Pastor','Head Minister','Admissions Officer','Student Welfare Officer','Accounts Officer','Management','Department User','Tuck Shop User','Clinic User','Kitchen User','Store User','Restaurant User','Front Desk','Pastor','Church Administrator','Membership Officer','Treasurer','Auditor'].map((role) => `<option>${role}</option>`).join('')}</select></label>
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
    const { response, data } = await sessionRequest('POST', {
      action: 'login',
      username: document.getElementById('staffUsername').value.trim(),
      password: document.getElementById('staffPassword').value
    });
    if (!response.ok || !data.ok) throw new Error(data.message || 'Could not sign in.');
    loginForm.reset();
    setStatus(loginStatus, '');
    await continueAfterAuthentication(await confirmFreshStaffSession(data.user, clean(data.sessionToken)));
  } catch (error) {
    setStatus(loginStatus, error.message || String(error), 'bad');
  } finally {
    setButtonLoading(loginButton, false, 'Signing in...', 'Sign In');
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
    passkeySetupButton.disabled = false;
    passkeySetupButton.classList.remove('is-loading');
    passkeySetupButton.removeAttribute('aria-busy');
  }
});

approvalSettingsButton.addEventListener('click', openApprovalSettings);
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
    showLogin();
  }
}());
