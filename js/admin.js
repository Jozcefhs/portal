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
const sidebarSignOutButton = document.getElementById('staffSidebarSignOut');
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
let organizationDepartmentWorkspaceTab = 'overview';
let organizationDashboardChartsRequest = 0;

const tabConfig = [
  ['admissions', 'Admissions'],
  ['formPurchases', 'Form Purchases'],
  ['students', 'Students'],
  ['members', 'Departments & Members'],
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
  overview: '\u2302',
  admissions: '\u{1F4DD}',
  formPurchases: '\u{1F9FE}',
  students: '\u{1F465}',
  members: '\u{1F465}',
  services: '\u{1F4C5}',
  funds: '\u{1F4B0}',
  offerings: '\u{1F9FA}',
  donations: '\u{1F381}',
  accounts: '\u{1F9EE}',
  financeRequests: '\u{1F4CB}',
  payroll: '\u{1F4B3}',
  clinic: '\u2695',
  kitchen: '\u{1F37D}',
  tuckShop: '\u{1F6D2}',
  bookstore: '\u{1F4DA}',
  uniformStore: '\u{1F455}',
  staffUsers: '\u2699'
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
  passkeySetupButton.innerHTML = '<span aria-hidden="true">◉</span> Set up biometric sign-in';
  try {
    const status = await passkeyRequest('status');
    if (status.registered > 0) {
      passkeySetupButton.classList.add('is-registered');
      passkeySetupButton.innerHTML = '<span aria-hidden="true">✓</span> Add another biometric device';
    }
  } catch (_error) {
    // Dashboard access remains available if the optional status check fails.
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

function showLogin(message = '', type = '') {
  setSidebarOpen(false);
  staffBearerToken = '';
  currentUser = null;
  dashboardData = null;
  activeSection = '';
  activeTabs = [];
  dashboardEl.hidden = true;
  identityEl.hidden = true;
  approvalSettingsButton.hidden = true;
  mobileNav.hidden = true;
  if (moduleDialog.open) moduleDialog.close();
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

function showDashboard(user) {
  currentUser = user;
  const displayName = user.displayName || user.username || 'Staff';
  const dashboardEdition = resolveDashboardEdition(user);
  const isFaith = ['church', 'faith'].includes(dashboardEdition);
  const isGenericOrganization = dashboardEdition === 'organization';
  const isOrganisationOperations = isFaith || isGenericOrganization;
  displayNameEl.textContent = displayName;
  roleEl.textContent = [user.role, user.department].filter(Boolean).join(' • ');
  renderProfilePhoto(user.profilePhotoUrl, displayName);
  sidebarEl.querySelector('.staff-sidebar-heading')?.setAttribute('data-initial', displayName.charAt(0).toUpperCase());
  editionLabel.textContent = isFaith ? 'Religious Organisation' : (isGenericOrganization ? 'Organisation Operations' : 'Staff Web Companion');
  workspaceTitle.textContent = isOrganisationOperations ? 'Organisation Operations' : 'Operations Centre';
  overviewLabel.textContent = isFaith ? 'Community overview' : 'Operations overview';
  welcomeCopy.textContent = isOrganisationOperations
    ? 'Monitor departments, meetings, offerings, programs and organisational activity.'
    : 'Monitor records, requests and departmental activity.';
  welcomeTitle.textContent = `Welcome, ${displayName}`;
  document.documentElement.dataset.edition = isOrganisationOperations ? 'church' : 'school';
  loginCard.hidden = true;
  identityEl.hidden = false;
  dashboardEl.hidden = false;
  mobileNav.hidden = false;
  approvalSettingsButton.hidden = !(
    user.role === 'Super Admin' ||
    user.role === 'Accounts Officer' ||
    user.approvalEnabled
  );
  refreshPasskeyControls();
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
    showDashboard(currentUser);
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
    ['Low Kitchen Stock', summary.lowKitchenStock]
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
  if (active === 'admissions') {
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
  } else if (active === 'clinic') {
    const data = liveData || departments.clinic || {};
    cards = [
      { icon, label: 'Clinic Records', value: (data.records || []).length },
      { icon: '\u{1F48A}', label: 'Inventory Items', value: (data.inventory || []).length },
      { icon: '\u26A0', label: 'Low Stock', value: (data.lowStock || []).length }
    ];
  } else if (active === 'kitchen') {
    const data = liveData || departments.kitchen || {};
    cards = [
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
  } else if ((active === 'bookstore' || active === 'uniformStore') && liveData) {
    const items = liveData.items || [];
    const orders = liveData.orders || [];
    cards = [
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
  const peopleTab = findTab('members', 'students', 'services', 'admissions') || homeTab;
  const financeTab = findTab('donations', 'offerings', 'funds', 'accounts', 'financeRequests') || homeTab;
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

function renderStaffStore(section, store) {
  const label = section === 'bookstore' ? 'Bookstore' : 'Uniform Store';
  const categories = store.categories || [];
  const activeCategories = categories.filter((row) => clean(row.Active || 'YES') !== 'NO');
  renderModuleSummary(section, store);
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
      ? window.prompt("Scan or enter the student's card ID, admission number, or parent verification code.")
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
  const labels = { clinic: 'Clinic', kitchen: 'Kitchen', tuckShop: 'Tuck Shop' };
  const descriptions = {
    clinic: 'Record student visits, maintain medical supplies, and track every stock receipt or issue.',
    kitchen: 'Maintain food and kitchen supplies and track every stock receipt or issue.',
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
    ${['clinic', 'kitchen'].includes(section) ? `
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
        <label>Item name<input name="ItemName" required></label><label>Category<input name="Category" value="${section === 'clinic' ? 'Medical Supply' : section === 'kitchen' ? 'Foodstuff' : 'General Item'}"></label>
        <label>Unit<input name="Unit" value="${section === 'kitchen' ? 'kg' : 'pcs'}" required></label><label>Opening/current quantity<input name="Quantity" type="number" min="0" step="0.01" value="0" required></label>
        <label>Reorder level<input name="ReorderLevel" type="number" min="0" step="0.01" value="0"></label><label>Notes<input name="Notes"></label>
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
    ${table(`${label} Inventory`, inventory, [...inventoryColumns(), { label: 'Edit', render: renderInventoryActions }])}
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
    ['ItemName', 'Category', 'Unit', 'Quantity', 'ReorderLevel', 'Notes'].forEach((key) => { if (form.elements[key]) form.elements[key].value = row[key] ?? ''; });
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

async function doOfferingAction(action, offeringId, reason = '') {
  if (!offeringId) return;
  const response = await staffFetch('/api/staff-offerings', {
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
  const response = await staffFetch('/api/staff-offerings', {
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
  const response = await staffFetch('/api/staff-church-payments', {
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
  const response = await staffFetch('/api/init-church-payment', {
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
            if (!donationId) return 'No id';
            const canSendReceipt = capabilities.canSendReceipt;
            const canCollect = capabilities.canCollect;
            const receiptSent = clean(pick(row, ['ReceiptStatus'])).toLowerCase() === 'sent'
              || Boolean(clean(pick(row, ['ReceiptSentAt'])));
            if (receiptSent) {
              return '<button type="button" class="table-action" disabled aria-disabled="true">Receipt sent</button>';
            }
            if (status === 'paid' && canSendReceipt) {
              return `<button type="button" class="table-action" data-donation-action="sendreceipt" data-donation-id="${escapeHtml(donationId)}">Send receipt</button>`;
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
  if (active === 'overview') {
    panelEl.innerHTML = '';
    return;
  }
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
  } else if (active === 'clinic' || active === 'kitchen' || active === 'tuckShop') {
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
  if (approvalProof) headers.set('X-DIGC-Approval-Proof', approvalProof);
  const response = await staffFetch('/api/finance-workflow', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers,
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
    recordId: button.dataset.recordId
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
      applyStamp: financeDecisionForm.elements.applyStamp.checked
    }, { approvalProof: financeDecisionApprovalProof });
    financeDecisionDialog.close();
    pendingFinanceDecision = null;
    financeDecisionBiometricVerified = false;
    financeDecisionApprovalProof = '';
    setStatus(document.getElementById('financeWorkflowStatus'), data.message, 'ok');
    await loadFinanceWorkflow();
  } catch (error) {
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
    const payload = { ...formPayload(form), items: materialRequisitionItems(form) };
    setButtonLoading(button, true, 'Submitting...', 'Submit Material Requisition');
    setStatus(status, 'Saving to database...');
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
    setStatus(status, 'Saving to database...');
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
    renderModuleSummary('staffUsers', staffUsersData);
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
    const started = await passkeyRequest('authentication-options');
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
  try {
    await sessionRequest('POST', { action: 'logout' });
  } finally {
    staffBearerToken = '';
    button.disabled = false;
    window.location.replace('index.html');
  }
}

signOutButton.addEventListener('click', () => signOutFromPortal(signOutButton));
sidebarSignOutButton.addEventListener('click', () => signOutFromPortal(sidebarSignOutButton));

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
