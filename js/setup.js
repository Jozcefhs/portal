const setupLoginForm = document.getElementById('setupLoginForm');
const setupForm = document.getElementById('setupForm');
const setupLoginStatus = document.getElementById('setupLoginStatus');
const setupStatus = document.getElementById('setupStatus');
const saveSetupButton = document.getElementById('saveSetupButton');
const settingsScopeField = document.getElementById('settingsScope');
const settingsBranchField = document.getElementById('settingsBranch');
const settingsScopeSummary = document.getElementById('settingsScopeSummary');
const settingsSaveScopeLabel = document.getElementById('settingsSaveScopeLabel');
const resetBranchSettingsButton = document.getElementById('resetBranchSettings');
const paystackConnectionPanel = document.getElementById('paystackConnectionPanel');
const paystackSecretKeyField = document.getElementById('paystackSecretKey');
const confirmPaystackReplacement = document.getElementById('confirmPaystackReplacement');
const connectPaystackButton = document.getElementById('connectPaystackButton');
const paystackConnectionStatus = document.getElementById('paystackConnectionStatus');
const emailProviderPanel = document.getElementById('emailProviderPanel');
const connectGoogleEmailButton = document.getElementById('connectGoogleEmail');
const useBrevoEmailButton = document.getElementById('useBrevoEmail');
const testEmailProviderButton = document.getElementById('testEmailProvider');
const emailProviderTestRecipient = document.getElementById('emailProviderTestRecipient');
const emailProviderStatus = document.getElementById('emailProviderStatus');
const academicPolicySection = document.getElementById('academic-policy-settings');
const academicPolicyIssues = document.getElementById('academicPolicyIssues');
const academicPolicyScopeMode = document.getElementById('academicPolicyScopeMode');
const academicPolicyInheritanceMode = document.getElementById('academicPolicyInheritanceMode');
const academicPolicyInheritanceHelp = document.getElementById('academicPolicyInheritanceHelp');
const activateAcademicPolicyButton = document.getElementById('activateAcademicPolicyButton');
const inheritAcademicPolicyButton = document.getElementById('inheritAcademicPolicyButton');
const tutorialSettingsSection = document.getElementById('tutorial-settings');
const tutorialLinksList = document.getElementById('tutorialLinksList');
const requestedSettingsParams = new URLSearchParams(window.location.search);
const requestedSettingsBranch = (requestedSettingsParams.get('branch') || '').trim();
const requestedSettingsScope = requestedSettingsParams.get('scope') === 'branch' && requestedSettingsBranch
  ? 'branch'
  : 'organisation';
const requestedEmailConnection = String(
  requestedSettingsParams.get('emailConnection') || requestedSettingsParams.get('emailStatus') || ''
).trim().toLowerCase();
const requestedEmailMessage = String(
  requestedSettingsParams.get('emailMessage') || requestedSettingsParams.get('emailCode') || ''
).trim().slice(0, 240);
let unlockedPassword = '';
let webLogoDataUrl = '';
let webLogoChanged = false;
let activeSettingsEdition = 'school';
let loadedAcademicPolicyView = null;
let activeSettingsAccess = { scope: requestedSettingsScope, branchId: requestedSettingsBranch, scopeLocked: false };
let paystackConnectionMode = 'not-configured';
let paystackSelfServiceAvailable = false;
let activeEmailProvider = 'brevo';
let emailProviderConnectionReady = false;
let emailProviderSelfServiceAvailable = false;
let emailConnectionCallbackHandled = false;
let loadedTutorialLinks = {};
const organisationOnlyControlIds = [
  'organisationEdition', 'nameFormat', 'webLogoFile', 'removeWebLogo',
  'googleDocumentsUrl', 'subscriptionPlan', 'userLimit', 'tutorialChannelUrl'
];

const tutorialModuleCatalogue = Object.freeze([
  { key: 'overview', storageKey: 'Overview', label: 'Dashboard', editions: ['school', 'faith', 'organization'] },
  { key: 'recordsDesk', storageKey: 'Records Desk', label: 'Records Desk', organizationLabel: 'Records Centre', editions: ['school', 'faith', 'organization'] },
  { key: 'executiveOffice', storageKey: 'Executive Office', label: 'Executive Office', editions: ['school', 'faith', 'organization'] },
  { key: 'admissions', storageKey: 'Applications', label: 'Admissions', editions: ['school'] },
  { key: 'formPurchases', storageKey: 'Admission Form Sale', label: 'Form Purchases', editions: ['school'] },
  { key: 'students', storageKey: 'Students', label: 'Students', editions: ['school'] },
  { key: 'academics', storageKey: 'Academic Management', label: 'Academic Management', editions: ['school'] },
  { key: 'studentConduct', storageKey: 'Student Conduct & Discipline', label: 'Student Conduct & Discipline', editions: ['school'] },
  { key: 'humanResources', storageKey: 'Human Resources', label: 'Human Resources', editions: ['school', 'faith', 'organization'] },
  { key: 'members', storageKey: 'Departments & Members', label: 'Departments & Members', organizationLabel: 'Departments & Personnel', editions: ['faith', 'organization'] },
  { key: 'services', storageKey: 'Services & Attendance', label: 'Services & Attendance', organizationLabel: 'Meetings & Attendance', editions: ['faith', 'organization'] },
  { key: 'staffAttendance', storageKey: 'Staff Attendance', label: 'Staff Attendance', editions: ['school', 'faith', 'organization'] },
  { key: 'funds', storageKey: 'Funds & Mappings', label: 'Funds & Mappings', organizationLabel: 'Budgets & Account Mappings', editions: ['faith', 'organization'] },
  { key: 'offerings', storageKey: 'Offerings', label: 'Offerings', organizationLabel: 'Income & Receipts', editions: ['faith', 'organization'] },
  { key: 'donations', storageKey: 'Donations', label: 'Donations', organizationLabel: 'Grants & Contributions', editions: ['faith', 'organization'] },
  { key: 'accounts', storageKey: 'Accounts', label: 'Accounts', editions: ['school'] },
  { key: 'incomeAnalytics', storageKey: 'Income Analytics', label: 'Income Analytics', organizationLabel: 'Revenue Analytics', editions: ['school', 'faith', 'organization'] },
  { key: 'financeRequests', storageKey: 'Finance & Accounting', label: 'Finance Requests & Imprest', editions: ['school', 'faith', 'organization'] },
  { key: 'payroll', storageKey: 'Payroll', label: 'Payroll', editions: ['school', 'faith', 'organization'] },
  { key: 'clinic', storageKey: 'Clinic', label: 'Clinic', editions: ['school'] },
  { key: 'kitchen', storageKey: 'Kitchen', label: 'Kitchen', editions: ['school'] },
  { key: 'tuckShop', storageKey: 'Tuck Shop', label: 'Tuck Shop', editions: ['school'] },
  { key: 'bookstore', storageKey: 'Bookstore', label: 'Bookstore', editions: ['school'] },
  { key: 'uniformStore', storageKey: 'Uniform Store', label: 'Uniform Store', editions: ['school'] },
  { key: 'organizationStore', storageKey: 'Organisation Store', label: 'Organisation Store', editions: ['faith', 'organization'] },
  { key: 'restaurant', storageKey: 'Restaurant', label: 'Restaurant', organizationLabel: 'Catering Operations', editions: ['faith', 'organization'] },
  { key: 'hotel', storageKey: 'Hotel Services', label: 'Hotel Services', editions: ['faith', 'organization'] },
  { key: 'dataBackup', storageKey: 'Backup & Restore', label: 'Backup & Restore', editions: ['school', 'faith', 'organization'] },
  { key: 'securityAudit', storageKey: 'Logs', label: 'Security Audit Log', editions: ['school', 'faith', 'organization'] },
  { key: 'staffUsers', storageKey: 'Settings', label: 'Staff & Permissions', organizationLabel: 'Users & Permissions', editions: ['school', 'faith', 'organization'] }
]);

const settingsTerminology = {
  school: {
    'settings-description': 'Manage your school identity, documents and portal experience.',
    'unlock-title': 'Unlock school settings',
    'sidebar-title': 'School settings',
    'profile-eyebrow': 'School profile',
    'name-label': 'School name',
    'code-label': 'School code',
    'email-label': 'School email',
    'phone-label': 'School phone',
    'address-label': 'School address',
    'name-format-label': 'Student and applicant name format',
    'documents-description': 'Set the default signatory and optional school-document alternatives.',
    'default-signatory-help': 'Used when a document-specific name is blank.',
    'web-logo-label': 'School web logo',
    'signatory-name': 'Example: Principal name',
    'signatory-title': 'Example: Principal',
    'portal-notice': 'Example: Admission into JSS 1 closes on Friday.'
  },
  faith: {
    'settings-description': 'Manage your church identity, documents and public portal experience.',
    'unlock-title': 'Unlock church settings',
    'sidebar-title': 'Church settings',
    'profile-eyebrow': 'Church profile',
    'name-label': 'Church name',
    'code-label': 'Church code',
    'email-label': 'Church email',
    'phone-label': 'Church phone',
    'address-label': 'Church address',
    'name-format-label': 'Member and personnel name format',
    'documents-description': 'Set the default signatory used on church documents and correspondence.',
    'default-signatory-help': 'Used as the standard signatory on generated church documents.',
    'web-logo-label': 'Church web logo',
    'signatory-name': 'Example: Senior Pastor name',
    'signatory-title': 'Example: Senior Pastor',
    'portal-notice': 'Example: Sunday service begins at 8:00 a.m.'
  },
  organization: {
    'settings-description': 'Manage your organisation identity, documents and public portal experience.',
    'unlock-title': 'Unlock organisation settings',
    'sidebar-title': 'Organisation settings',
    'profile-eyebrow': 'Organisation profile',
    'name-label': 'Organisation name',
    'code-label': 'Organisation code',
    'email-label': 'Organisation email',
    'phone-label': 'Organisation phone',
    'address-label': 'Organisation address',
    'name-format-label': 'Personnel and contact name format',
    'documents-description': 'Set the default signatory used on organisation documents and correspondence.',
    'default-signatory-help': 'Used as the standard signatory on generated organisation documents.',
    'web-logo-label': 'Organisation web logo',
    'signatory-name': 'Example: Director name',
    'signatory-title': 'Example: Director',
    'portal-notice': 'Example: Add an important public announcement.'
  }
};

function normalizeSettingsEdition(value) {
  const edition = String(value || '').trim().toLowerCase();
  if (['faith', 'church', 'religious'].includes(edition)) return 'faith';
  if (['organization', 'organisation', 'other'].includes(edition)) return 'organization';
  return 'school';
}

function parseTutorialLinks(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return { ...value };
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function tutorialModulesForEdition(edition = activeSettingsEdition) {
  return tutorialModuleCatalogue.filter((module) => module.editions.includes(edition));
}

function renderTutorialLinks(links = loadedTutorialLinks) {
  if (!tutorialLinksList) return;
  loadedTutorialLinks = parseTutorialLinks(links);
  tutorialLinksList.replaceChildren(...tutorialModulesForEdition().map((module, index) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'tutorial-settings-item';
    const label = document.createElement('label');
    const title = document.createElement('span');
    title.textContent = activeSettingsEdition === 'organization' && module.organizationLabel
      ? module.organizationLabel
      : module.label;
    const input = document.createElement('input');
    input.id = `tutorialModuleUrl${index}`;
    input.type = 'url';
    input.inputMode = 'url';
    input.autocomplete = 'url';
    input.spellcheck = false;
    input.placeholder = 'https://youtu.be/...';
    input.dataset.tutorialStorageKey = module.storageKey;
    input.dataset.tutorialSection = module.key;
    input.value = String(loadedTutorialLinks[module.storageKey] || loadedTutorialLinks[module.key] || '').trim();
    label.htmlFor = input.id;
    label.append(title, input);
    const openLink = document.createElement('a');
    openLink.href = input.value || '#';
    openLink.target = '_blank';
    openLink.rel = 'noopener noreferrer';
    openLink.title = `Open ${title.textContent} tutorial`;
    openLink.setAttribute('aria-label', openLink.title);
    openLink.textContent = '\u25B6';
    openLink.hidden = !input.value;
    input.addEventListener('input', () => {
      const value = input.value.trim();
      openLink.href = value || '#';
      openLink.hidden = !value;
    });
    wrapper.append(label, openLink);
    return wrapper;
  }));
}

function tutorialLinksFromForm() {
  if (!tutorialLinksList) return {};
  return Object.fromEntries([...tutorialLinksList.querySelectorAll('[data-tutorial-storage-key]')]
    .map((input) => [input.dataset.tutorialStorageKey, input.value.trim()])
    .filter(([, url]) => url));
}

function applyEditionTerminology(profile = {}) {
  const edition = normalizeSettingsEdition(profile.OrganisationEdition);
  activeSettingsEdition = edition;
  const copy = settingsTerminology[edition];
  document.querySelectorAll('[data-edition-copy]').forEach((node) => {
    const value = copy[node.dataset.editionCopy];
    if (value) node.textContent = value;
  });
  document.querySelectorAll('[data-edition-placeholder]').forEach((node) => {
    const value = copy[node.dataset.editionPlaceholder];
    if (value) node.placeholder = value;
  });
  document.querySelectorAll('[data-school-settings-only]').forEach((node) => {
    node.hidden = edition !== 'school';
  });
  const editionField = document.getElementById('organisationEdition');
  if (editionField) {
    const labels = { school: 'School', faith: 'Church', organization: 'Other organisation' };
    editionField.innerHTML = `<option value="${edition}">${labels[edition]}</option>`;
    editionField.value = edition;
    editionField.disabled = true;
  }
  const visibleLinks = [...document.querySelectorAll('.settings-nav-link:not([hidden])')];
  visibleLinks.forEach((link, index) => {
    const number = link.querySelector(':scope > span');
    if (number) number.textContent = String(index + 1).padStart(2, '0');
  });
  const activeLink = document.querySelector('.settings-nav-link.active');
  if (activeLink?.hidden) {
    activeLink.classList.remove('active');
    visibleLinks[0]?.classList.add('active');
  }
  renderTutorialLinks(loadedTutorialLinks);
}

function setStatus(message, type) {
  setupStatus.textContent = message || '';
  setupStatus.className = 'status ' + (type || '');
}

function setLoginStatus(message, type) {
  setupLoginStatus.textContent = message || '';
  setupLoginStatus.className = 'status ' + (type || '');
}

function paystackConfigured() {
  return paystackConnectionMode !== 'not-configured';
}

function setPaystackConnectionStatus(message, type = '') {
  if (!paystackConnectionStatus) return;
  paystackConnectionStatus.textContent = message || '';
  paystackConnectionStatus.className = `status paystack-connection-status ${type}`.trim();
}

function updatePaystackConnectionUI(profile = {}) {
  paystackConnectionMode = String(profile.PaystackConnectionMode || paystackConnectionMode || 'not-configured').trim().toLowerCase();
  paystackSelfServiceAvailable = profile.PaystackSelfServiceAvailable === true;
  const configured = paystackConfigured();
  const modeLabel = paystackConnectionMode === 'live'
    ? 'Live payments connected'
    : paystackConnectionMode === 'test'
      ? 'Test payments connected'
      : configured ? 'Payment credential connected' : 'No Paystack account connected';
  const state = document.getElementById('paystackConnectionState');
  const badge = document.getElementById('paystackConnectionBadge');
  const confirmation = document.getElementById('paystackReplaceConfirmation');
  const webhook = document.getElementById('paystackWebhookUrl');
  if (state) state.textContent = modeLabel;
  if (badge) {
    badge.textContent = configured ? `${paystackConnectionMode} mode` : 'Not connected';
    badge.classList.toggle('is-connected', configured);
    badge.classList.toggle('is-live', paystackConnectionMode === 'live');
  }
  if (confirmation) confirmation.hidden = !configured;
  if (confirmPaystackReplacement && !configured) confirmPaystackReplacement.checked = false;
  if (connectPaystackButton) connectPaystackButton.textContent = configured ? 'Replace Paystack account' : 'Connect Paystack';
  if (webhook) webhook.textContent = `${window.location.origin}/api/paystack-webhook`;
  if (!paystackSelfServiceAvailable) {
    setPaystackConnectionStatus('This tenant still needs the one-time secure onboarding upgrade before it can connect Paystack.', 'bad');
  } else if (!configured) {
    setPaystackConnectionStatus('Paste a Paystack secret key to validate and connect this organisation.');
  } else {
    setPaystackConnectionStatus('The secret remains encrypted in Cloudflare and is never displayed here.', 'ok');
  }
}

function setEmailProviderStatus(message, type = '') {
  if (!emailProviderStatus) return;
  emailProviderStatus.textContent = message || '';
  emailProviderStatus.className = `status email-provider-status ${type}`.trim();
}

function updateEmailProviderUI(profile = {}) {
  const configuredProvider = String(profile.EmailProvider || activeEmailProvider || 'brevo').trim().toLowerCase();
  activeEmailProvider = ['brevo', 'gmail'].includes(configuredProvider) ? configuredProvider : 'unsupported';
  emailProviderConnectionReady = profile.EmailProviderConnectionReady === true;
  emailProviderSelfServiceAvailable = profile.EmailProviderSelfServiceAvailable === true;
  const connectedEmail = String(profile.GmailConnectedEmail || '').trim();
  const isGoogle = activeEmailProvider === 'gmail';
  const isUnsupported = activeEmailProvider === 'unsupported';
  const state = document.getElementById('emailProviderState');
  const account = document.getElementById('emailProviderAccount');
  const badge = document.getElementById('emailProviderBadge');
  if (state) state.textContent = isGoogle
    ? 'Google Workspace / Gmail'
    : isUnsupported ? 'Unsupported provider configuration' : 'Brevo';
  if (account) {
    account.textContent = isUnsupported
      ? 'Online email is disabled until the deployment provider is corrected.'
      : isGoogle
      ? connectedEmail ? `Connected mailbox: ${connectedEmail}` : 'No connected Google mailbox reported.'
      : emailProviderConnectionReady
        ? 'The existing encrypted Brevo credential is active.'
        : 'Brevo is selected but its secure credential is not ready.';
  }
  if (badge) {
    badge.textContent = emailProviderConnectionReady ? 'Ready' : 'Setup required';
    badge.classList.toggle('is-ready', emailProviderConnectionReady);
    badge.classList.toggle('is-google', isGoogle);
  }
  if (connectGoogleEmailButton) {
    connectGoogleEmailButton.textContent = isGoogle ? 'Reconnect Google account' : 'Connect Google account';
  }
  if (useBrevoEmailButton) useBrevoEmailButton.hidden = !isGoogle && !isUnsupported;
  if (emailProviderTestRecipient && !emailProviderTestRecipient.value) {
    emailProviderTestRecipient.value = String(profile.SchoolEmail || '').trim();
  }
  if (isUnsupported) {
    setEmailProviderStatus('The deployed EMAIL_PROVIDER value is unsupported. Choose Brevo or reconnect Google before sending email.', 'bad');
  } else if (!emailProviderSelfServiceAvailable) {
    setEmailProviderStatus(emailProviderConnectionReady
      ? 'Email delivery is ready. Provider changes require the secure self-service deployment upgrade.'
      : 'Secure email-provider self-service is not available for this deployment.', emailProviderConnectionReady ? '' : 'bad');
  } else if (emailProviderConnectionReady) {
    setEmailProviderStatus(`${isGoogle ? 'Google' : 'Brevo'} email delivery is ready.`, 'ok');
  } else {
    setEmailProviderStatus(isGoogle
      ? 'Reconnect the Google account to complete email delivery setup.'
      : 'Connect Google, or ask the platform administrator to configure Brevo.', 'bad');
  }
}

function handleEmailConnectionCallback() {
  if (!requestedEmailConnection || emailConnectionCallbackHandled) return;
  emailConnectionCallbackHandled = true;
  const succeeded = ['connected', 'success', 'ready'].includes(requestedEmailConnection);
  const message = requestedEmailMessage || (succeeded
    ? 'Google email connected successfully.'
    : 'Google email could not be connected. Please try again.');
  setEmailProviderStatus(message, succeeded ? 'ok' : 'bad');
  setStatus(message, succeeded ? 'ok' : 'bad');
  const cleanUrl = new URL(window.location.href);
  ['emailConnection', 'emailMessage', 'emailProvider', 'emailStatus', 'emailCode'].forEach((key) => cleanUrl.searchParams.delete(key));
  cleanUrl.hash = 'document-settings';
  window.history.replaceState({}, '', cleanUrl);
}

async function requestEmailProviderAction(action, extra = {}) {
  const response = await fetch('/api/email-provider-connection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action,
      password: unlockedPassword,
      SettingsScope: 'organisation',
      ...extra
    })
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw new Error(data?.message || 'The email-provider request could not be completed.');
  return data;
}

function announceSettingsChange() {
  try {
    [...Array(sessionStorage.length).keys()]
      .map((index) => sessionStorage.key(index))
      .filter((key) => key && key.startsWith('dynamax-public-api:settings'))
      .forEach((key) => sessionStorage.removeItem(key));
  } catch (_error) {
    // Storage may be unavailable in private browsing; the server save still succeeds.
  }
  try {
    localStorage.setItem('dynamax:settings-revision', `${Date.now()}`);
  } catch (_error) {
    // Cross-tab refresh is an enhancement; navigation and manual refresh also reload settings.
  }
}

function setField(id, value) {
  const node = document.getElementById(id);
  if (node) node.value = value || '';
}

function policyField(id) {
  return document.getElementById(id);
}

function policyNumber(id, fallback = null) {
  const value = policyField(id)?.value?.trim();
  if (value === '' || value === undefined) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function policyList(id) {
  const seen = new Set();
  return String(policyField(id)?.value || '').split(',').map((item) => item.trim()).filter((item) => {
    const key = item.toLowerCase();
    if (!item || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function createPolicySelect(options, value, label) {
  const select = document.createElement('select');
  select.setAttribute('aria-label', label);
  options.forEach(([optionValue, optionLabel]) => {
    const option = document.createElement('option');
    option.value = optionValue;
    option.textContent = optionLabel;
    select.appendChild(option);
  });
  select.value = value || options[0][0];
  return select;
}

function createPolicyInput(type, value, label, attributes = {}) {
  const input = document.createElement('input');
  input.type = type;
  input.value = value ?? '';
  input.setAttribute('aria-label', label);
  Object.entries(attributes).forEach(([key, attributeValue]) => input.setAttribute(key, attributeValue));
  return input;
}

function createAcademicComponentRow(component = {}, index = 0) {
  const row = document.createElement('div');
  row.className = 'academic-policy-row academic-component-grid';
  row.dataset.policyId = component.Id || '';
  const name = createPolicyInput('text', component.Name, 'Assessment component name');
  const maximum = createPolicyInput('number', component.MaximumScore, 'Maximum score', { min: '0', step: '0.01' });
  const weight = createPolicyInput('number', component.WeightPercentage, 'Weight percentage', { min: '0', max: '100', step: '0.01' });
  const source = createPolicySelect([
    ['any', 'Any approved source'],
    ['manual', 'Manual scorebook'],
    ['spreadsheet', 'Spreadsheet import'],
    ['built-in-cbt', 'Built-in CBT'],
    ['external-cbt', 'External CBT']
  ], component.SourceMode || 'any', 'Allowed score source');
  const required = createPolicyInput('checkbox', '', 'Required assessment component');
  required.checked = component.Required !== false;
  const split = createPolicyInput('checkbox', '', 'Separate this component into Objective (A) and Theory (B) scorebook fields');
  split.checked = component.ScoreEntryMode === 'objective-theory';
  const configuredMaximum = Number(component.MaximumScore || 0);
  const objective = createPolicyInput(
    'number',
    component.ObjectiveMaximumScore ?? (split.checked ? configuredMaximum / 2 : configuredMaximum),
    'Objective (A) maximum score',
    { min: '0', step: '0.01' }
  );
  const theory = createPolicyInput(
    'number',
    component.TheoryMaximumScore ?? (split.checked ? configuredMaximum / 2 : 0),
    'Theory (B) maximum score',
    { min: '0', step: '0.01' }
  );
  const midTerm = createPolicyInput('checkbox', '', 'Include in mid-term result');
  midTerm.checked = Boolean(component.MidTermIncluded);
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'academic-remove-row';
  remove.setAttribute('aria-label', `Remove assessment component ${index + 1}`);
  remove.textContent = '×';
  remove.addEventListener('click', () => row.remove());
  const syncSplitFields = () => {
    const enabled = split.checked;
    objective.disabled = !enabled;
    theory.disabled = !enabled;
    maximum.readOnly = enabled;
    source.disabled = enabled;
    if (enabled) {
      source.value = 'built-in-cbt';
      if (Number(objective.value || 0) <= 0 || Number(theory.value || 0) <= 0) {
        const current = Number(maximum.value || 0);
        const a = current > 0 ? Math.floor(current / 2) : 0;
        objective.value = a;
        theory.value = Math.max(0, current - a);
      }
      maximum.value = Number(objective.value || 0) + Number(theory.value || 0);
    }
  };
  split.addEventListener('change', syncSplitFields);
  objective.addEventListener('input', syncSplitFields);
  theory.addEventListener('input', syncSplitFields);
  row.append(name, maximum, weight, source, split, objective, theory, required, midTerm, remove);
  syncSplitFields();
  return row;
}

function createAcademicGradeRow(band = {}, index = 0) {
  const row = document.createElement('div');
  row.className = 'academic-policy-row academic-grade-grid';
  row.dataset.policyId = band.Id || '';
  const grade = createPolicyInput('text', band.Grade, 'Grade');
  const minimum = createPolicyInput('number', band.MinimumPercentage, 'Minimum percentage', { min: '0', max: '100', step: '0.01' });
  const maximum = createPolicyInput('number', band.MaximumPercentage, 'Maximum percentage', { min: '0', max: '100', step: '0.01' });
  const point = createPolicyInput('number', band.GradePoint, 'Grade point', { min: '0', step: '0.01' });
  const classification = createPolicySelect([['pass', 'Pass'], ['fail', 'Fail']], band.Classification || 'pass', 'Pass or fail classification');
  const remark = createPolicyInput('text', band.Remark, 'Grade remark');
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'academic-remove-row';
  remove.setAttribute('aria-label', `Remove grade band ${index + 1}`);
  remove.textContent = '×';
  remove.addEventListener('click', () => row.remove());
  row.append(grade, minimum, maximum, point, classification, remark, remove);
  return row;
}

function createAcademicCumulativeTermRow(term = {}, index = 0) {
  const row = document.createElement('div');
  row.className = 'academic-policy-row academic-cumulative-grid';
  row.dataset.policyId = term.Id || '';
  const name = createPolicyInput('text', term.TermName, 'Academic term name', { placeholder: 'First Term' });
  const weight = createPolicyInput('number', term.WeightPercentage, 'Cumulative weight percentage', { min: '0', max: '100', step: '0.01' });
  const required = createPolicyInput('checkbox', '', 'Required for cumulative result');
  required.checked = term.Required !== false;
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'academic-remove-row';
  remove.setAttribute('aria-label', `Remove cumulative term ${index + 1}`);
  remove.textContent = '×';
  remove.addEventListener('click', () => row.remove());
  row.append(name, weight, required, remove);
  return row;
}

function renderAcademicComponents(components = []) {
  const container = policyField('academicComponents');
  container.replaceChildren(...components.map(createAcademicComponentRow));
}

function renderAcademicGradeBands(bands = []) {
  const container = policyField('academicGradeBands');
  container.replaceChildren(...bands.map(createAcademicGradeRow));
}

function renderAcademicCumulativeTerms(terms = []) {
  const container = policyField('academicCumulativeTerms');
  container.replaceChildren(...terms.map(createAcademicCumulativeTermRow));
}

function updateAcademicPolicyConditionalFields() {
  const feeMode = policyField('academicFeeClearanceMode')?.value || 'unconfigured';
  document.querySelectorAll('[data-fee-policy-field]').forEach((field) => {
    field.hidden = field.dataset.feePolicyField !== feeMode;
  });
  const promotionMode = policyField('academicPromotionMode')?.value || 'unconfigured';
  document.querySelectorAll('[data-promotion-policy-field]').forEach((group) => {
    const active = group.dataset.promotionPolicyField === promotionMode;
    group.hidden = !active;
    group.querySelectorAll('input, select, textarea, button').forEach((field) => { field.disabled = !active; });
  });
  document.querySelectorAll('[data-promotion-shared-fields]').forEach((group) => {
    const active = ['criteria', 'division-rules'].includes(promotionMode);
    group.hidden = !active;
    group.querySelectorAll('input, select, textarea').forEach((field) => { field.disabled = !active; });
  });
  const probationResitPass = policyField('academicProbationResitPassPercentage');
  if (probationResitPass) {
    probationResitPass.disabled = !['criteria', 'division-rules'].includes(promotionMode)
      || policyField('academicProbationResitEnabled')?.value !== 'YES';
  }
}

function renderAcademicPolicy(policy = {}) {
  const result = policy.ResultAccess || {};
  const clearance = result.FinancialClearance || {};
  const position = policy.Position || {};
  const assessment = policy.Assessment || {};
  const midTerm = policy.MidTerm || {};
  const cumulative = policy.Cumulative || {};
  const promotion = policy.Promotion || {};
  const probationResit = promotion.ProbationResit || {};
  const juniorPromotion = promotion.JuniorSecondary || {};
  const seniorPromotion = promotion.SeniorSecondary || {};
  setField('academicResultVisibility', result.VisibilityMode || 'unconfigured');
  setField('academicFeeClearanceMode', clearance.Mode || 'unconfigured');
  setField('academicMinimumPaidPercentage', clearance.MinimumPaidPercentage ?? 100);
  setField('academicMaximumOutstanding', clearance.MaximumOutstanding ?? 0);
  setField('academicFeeCategoryIds', (clearance.FeeCategoryIds || []).join(', '));
  policyField('academicRecognizeScholarships').checked = clearance.RecognizeScholarships !== false;
  policyField('academicRecognizePaymentPlans').checked = clearance.RecognizePaymentPlans !== false;
  policyField('academicAllowManualExemptions').checked = clearance.AllowManualExemptions !== false;
  setField('academicPositionMode', position.Mode || 'unconfigured');
  setField('academicTieMode', position.TieMode || 'competition');
  setField('academicMinimumAssessedSubjects', position.MinimumAssessedSubjects || 1);
  const midTermIds = new Set(midTerm.ComponentIds || []);
  renderAcademicComponents((assessment.Components || []).map((component) => ({
    ...component,
    MidTermIncluded: midTermIds.has(component.Id)
  })));
  policyField('academicMidTermEnabled').checked = midTerm.Enabled === true;
  renderAcademicGradeBands(assessment.GradeBands || []);
  renderAcademicCumulativeTerms(cumulative.Terms || []);
  setField('academicMissingTermMode', cumulative.MissingTermMode || 'block');
  setField('academicMissingSubjectMode', cumulative.MissingSubjectMode || 'block');
  policyField('academicIncludeTransferredResults').checked = cumulative.IncludeTransferredResults !== false;
  setField('academicPromotionMode', promotion.Mode || 'unconfigured');
  setField('academicProbationResitEnabled', probationResit.Enabled === true ? 'YES' : 'NO');
  setField('academicProbationResitPassPercentage', probationResit.PassPercentage ?? 50);
  setField('academicMinimumOverallAverage', promotion.MinimumOverallAverage ?? '');
  setField('academicRequiredCoreSubjects', (promotion.RequiredCoreSubjectIds || []).join(', '));
  setField('academicMaximumFailedSubjects', promotion.MaximumFailedSubjects ?? '');
  setField('academicMinimumAttendance', promotion.MinimumAttendancePercentage ?? '');
  setField('academicRequireAllTerms', promotion.RequireAllTerms === false ? 'NO' : 'YES');
  setField('academicManualReviewMinimum', promotion.ManualReviewMinimum ?? '');
  setField('academicManualReviewMaximum', promotion.ManualReviewMaximum ?? '');
  setField('academicJuniorPromotedMinimum', juniorPromotion.PromotedMinimumAverage ?? '');
  setField('academicJuniorProbationMinimum', juniorPromotion.ProbationMinimumAverage ?? '');
  setField('academicSeniorCreditMinimum', seniorPromotion.CreditMinimumPercentage ?? '');
  setField('academicSeniorCoreSubjectCount', seniorPromotion.ExpectedCoreSubjectCount ?? '');
  setField('academicSeniorPromotedCredits', seniorPromotion.PromotedMinimumCredits ?? '');
  setField('academicSeniorPromotedRequiredSubjects', (seniorPromotion.PromotedRequiredSubjectIds || []).join(', '));
  setField('academicSeniorPromotedRequiredMode', seniorPromotion.PromotedRequiredSubjectMode || 'all');
  setField('academicSeniorProbationCredits', seniorPromotion.ProbationCreditCount ?? '');
  setField('academicSeniorProbationCreditMode', seniorPromotion.ProbationCreditCountMode || 'exactly');
  setField('academicSeniorProbationRequiredSubjects', (seniorPromotion.ProbationRequiredSubjectIds || []).join(', '));
  setField('academicSeniorProbationRequiredMode', seniorPromotion.ProbationRequiredSubjectMode || 'any');
  updateAcademicPolicyConditionalFields();
}

function academicPolicyFromForm() {
  const components = [...policyField('academicComponents').children].map((row, index) => {
    const [name, maximum, weight, source, split, objective, theory, required] = row.children;
    return {
      Id: row.dataset.policyId,
      Name: name.value,
      MaximumScore: Number(maximum.value || 0),
      WeightPercentage: Number(weight.value || 0),
      SourceMode: source.value,
      ScoreEntryMode: split.checked ? 'objective-theory' : 'single',
      ObjectiveMaximumScore: split.checked ? Number(objective.value || 0) : Number(maximum.value || 0),
      TheoryMaximumScore: split.checked ? Number(theory.value || 0) : 0,
      Required: required.checked,
      Order: index + 1
    };
  });
  const midTermComponentIds = [...policyField('academicComponents').children]
    .filter((row) => row.children[8]?.checked)
    .map((row, index) => row.dataset.policyId || components[index]?.Id || String(components[index]?.Name || '')
      .trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80))
    .filter(Boolean);
  const gradeBands = [...policyField('academicGradeBands').children].map((row, index) => {
    const [grade, minimum, maximum, point, classification, remark] = row.children;
    return {
      Id: row.dataset.policyId,
      Grade: grade.value,
      MinimumPercentage: Number(minimum.value || 0),
      MaximumPercentage: Number(maximum.value || 0),
      GradePoint: Number(point.value || 0),
      Classification: classification.value,
      Remark: remark.value,
      Order: index + 1
    };
  });
  const cumulativeTerms = [...policyField('academicCumulativeTerms').children].map((row, index) => {
    const [name, weight, required] = row.children;
    return {
      Id: row.dataset.policyId,
      TermName: name.value,
      WeightPercentage: Number(weight.value || 0),
      Required: required.checked,
      Order: index + 1
    };
  });
  return {
    ResultAccess: {
      VisibilityMode: policyField('academicResultVisibility').value,
      FinancialClearance: {
        Mode: policyField('academicFeeClearanceMode').value,
        MinimumPaidPercentage: policyNumber('academicMinimumPaidPercentage', 100),
        MaximumOutstanding: policyNumber('academicMaximumOutstanding', 0),
        FeeCategoryIds: policyList('academicFeeCategoryIds'),
        RecognizeScholarships: policyField('academicRecognizeScholarships').checked,
        RecognizePaymentPlans: policyField('academicRecognizePaymentPlans').checked,
        AllowManualExemptions: policyField('academicAllowManualExemptions').checked
      }
    },
    Position: {
      Mode: policyField('academicPositionMode').value,
      TieMode: policyField('academicTieMode').value,
      MinimumAssessedSubjects: policyNumber('academicMinimumAssessedSubjects', 1)
    },
    Assessment: { Components: components, GradeBands: gradeBands },
    MidTerm: {
      Enabled: policyField('academicMidTermEnabled').checked,
      ComponentIds: midTermComponentIds
    },
    Cumulative: {
      Terms: cumulativeTerms,
      MissingTermMode: policyField('academicMissingTermMode').value,
      MissingSubjectMode: policyField('academicMissingSubjectMode').value,
      IncludeTransferredResults: policyField('academicIncludeTransferredResults').checked
    },
    Promotion: {
      Mode: policyField('academicPromotionMode').value,
      ProbationResit: {
        Enabled: policyField('academicProbationResitEnabled').value === 'YES',
        PassPercentage: policyNumber('academicProbationResitPassPercentage', 50)
      },
      MinimumOverallAverage: policyNumber('academicMinimumOverallAverage'),
      RequiredCoreSubjectIds: policyList('academicRequiredCoreSubjects'),
      MaximumFailedSubjects: policyNumber('academicMaximumFailedSubjects'),
      MinimumAttendancePercentage: policyNumber('academicMinimumAttendance'),
      RequireAllTerms: policyField('academicRequireAllTerms').value === 'YES',
      ManualReviewMinimum: policyNumber('academicManualReviewMinimum'),
      ManualReviewMaximum: policyNumber('academicManualReviewMaximum'),
      JuniorSecondary: {
        PromotedMinimumAverage: policyNumber('academicJuniorPromotedMinimum'),
        ProbationMinimumAverage: policyNumber('academicJuniorProbationMinimum')
      },
      SeniorSecondary: {
        CreditMinimumPercentage: policyNumber('academicSeniorCreditMinimum'),
        ExpectedCoreSubjectCount: policyNumber('academicSeniorCoreSubjectCount'),
        PromotedMinimumCredits: policyNumber('academicSeniorPromotedCredits'),
        PromotedRequiredSubjectIds: policyList('academicSeniorPromotedRequiredSubjects'),
        PromotedRequiredSubjectMode: policyField('academicSeniorPromotedRequiredMode').value,
        ProbationCreditCount: policyNumber('academicSeniorProbationCredits'),
        ProbationCreditCountMode: policyField('academicSeniorProbationCreditMode').value,
        ProbationRequiredSubjectIds: policyList('academicSeniorProbationRequiredSubjects'),
        ProbationRequiredSubjectMode: policyField('academicSeniorProbationRequiredMode').value
      }
    }
  };
}

function renderAcademicPolicyIssues(issues = [], hasDraft = false) {
  const validation = academicPolicyIssues.closest('.academic-policy-validation');
  academicPolicyIssues.replaceChildren();
  if (!issues.length && hasDraft) {
    const item = document.createElement('li');
    item.textContent = 'The draft is complete and ready for activation.';
    academicPolicyIssues.appendChild(item);
    validation.classList.add('ready');
    return;
  }
  validation.classList.remove('ready');
  const messages = issues.length
    ? issues.map((issue) => issue.message)
    : ['Save a draft to validate this policy.'];
  messages.forEach((message) => {
    const item = document.createElement('li');
    item.textContent = message;
    academicPolicyIssues.appendChild(item);
  });
}

function renderAcademicPolicyView(view = {}, message = '') {
  loadedAcademicPolicyView = view;
  renderAcademicPolicy(view.Policy || {});
  const hasDraft = Boolean(view.DraftRevisionId);
  const branchMode = settingsScopeField.value === 'branch';
  const active = Boolean(view.ActiveRevisionId);
  const effectiveActive = active || (Array.isArray(view.Sources) && view.Sources.length > 0);
  const inheritanceMode = branchMode && view.InheritanceMode === 'independent' ? 'independent' : 'inherit';
  if (academicPolicyScopeMode) academicPolicyScopeMode.hidden = !branchMode;
  if (academicPolicyInheritanceMode) academicPolicyInheritanceMode.value = inheritanceMode;
  if (academicPolicyInheritanceHelp) {
    academicPolicyInheritanceHelp.textContent = inheritanceMode === 'independent'
      ? 'Independent mode is active for this draft or policy. Its complete academic rules and test components are isolated from later organisation changes.'
      : 'Organisation policy changes continue to flow into this branch except where an activated branch override differs.';
  }
  policyField('academicPolicyStateTitle').textContent = hasDraft && view.DraftRevisionId !== view.ActiveRevisionId
    ? 'Draft saved; activation pending'
    : branchMode && !active && effectiveActive
      ? 'Inheriting organisation academic policy'
      : active
        ? branchMode ? 'Active branch academic policy' : 'Active academic policy'
        : 'No active academic policy';
  const sourceSummary = branchMode
    ? inheritanceMode === 'independent'
      ? 'This branch is isolated from organisation academic-policy and test-component changes.'
      : 'This branch currently follows the organisation policy plus any activated branch differences.'
    : '';
  const stateSummary = message || (hasDraft
    ? `${view.Period?.Session || ''} / ${view.Period?.Term || ''} · ${view.Scope?.Type || 'organisation'} scope`
    : 'Complete and save a draft before activation.');
  policyField('academicPolicyStateSummary').textContent = [stateSummary, sourceSummary].filter(Boolean).join(' ');
  renderAcademicPolicyIssues(view.ActivationIssues || [], hasDraft);
  activateAcademicPolicyButton.disabled = !view.CanActivate;
  inheritAcademicPolicyButton.hidden = !branchMode;
}

function academicPolicyRequestBody(action, extra = {}) {
  const session = policyField('academicPolicySession').value.trim();
  const term = policyField('academicPolicyTerm').value.trim();
  if (!session || !term) throw new Error('Enter the academic session and term before loading or saving a policy.');
  return {
    action,
    password: unlockedPassword,
    SettingsScope: settingsScopeField.value,
    BranchId: settingsScopeField.value === 'branch' ? settingsBranchField.value : '',
    InheritanceMode: settingsScopeField.value === 'branch'
      ? academicPolicyInheritanceMode?.value || 'inherit'
      : 'independent',
    Session: session,
    Term: term,
    ...extra
  };
}

async function requestAcademicPolicy(action, extra = {}) {
  if (activeSettingsEdition !== 'school') return null;
  const response = await fetch('/api/academic-policy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(academicPolicyRequestBody(action, extra))
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    const error = new Error(data.message || 'Academic policy request failed.');
    error.issues = data.issues || [];
    throw error;
  }
  applySettingsAccess(data.settingsAccess);
  renderAcademicPolicyView(data.view || {}, data.message);
  return data.view || {};
}

async function loadAcademicPolicy({ silent = false } = {}) {
  if (!unlockedPassword || activeSettingsEdition !== 'school') return null;
  const session = policyField('academicPolicySession')?.value.trim();
  const term = policyField('academicPolicyTerm')?.value.trim();
  if (!session || !term) {
    loadedAcademicPolicyView = null;
    policyField('academicPolicyStateTitle').textContent = 'Academic period required';
    policyField('academicPolicyStateSummary').textContent = 'Enter a session and term, then load the policy.';
    activateAcademicPolicyButton.disabled = true;
    return null;
  }
  try {
    return await requestAcademicPolicy('load');
  } catch (error) {
    if (!silent) throw error;
    loadedAcademicPolicyView = null;
    policyField('academicPolicyStateTitle').textContent = 'Policy could not be loaded';
    policyField('academicPolicyStateSummary').textContent = error.message;
    activateAcademicPolicyButton.disabled = true;
    return null;
  }
}

function revealRequestedSettingsSection() {
  const sectionId = requestedEmailConnection ? 'document-settings' : window.location.hash.slice(1);
  const section = sectionId ? document.getElementById(sectionId) : null;
  if (!section || section.hidden) return;
  document.querySelectorAll('.settings-nav-link').forEach((link) => {
    link.classList.toggle('active', link.getAttribute('href') === `#${sectionId}`);
  });
  window.requestAnimationFrame(() => section.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

function profileFromForm() {
  const data = new FormData(setupForm);
  const senderProfile = activeSettingsEdition === 'school'
    ? {
        BrevoSenderName: document.getElementById('senderName').value,
        BrevoSenderEmail: document.getElementById('senderEmail').value,
        BrevoReplyToName: document.getElementById('replyToName').value,
        BrevoReplyToEmail: document.getElementById('replyToEmail').value,
        ExecutiveSenderName: document.getElementById('executiveSenderName').value,
        ExecutiveSenderEmail: document.getElementById('executiveSenderEmail').value,
        ExecutiveReplyToName: document.getElementById('executiveReplyToName').value,
        ExecutiveReplyToEmail: document.getElementById('executiveReplyToEmail').value
      }
    : {
        OrganisationSenderName: document.getElementById('senderName').value,
        OrganisationSenderEmail: document.getElementById('senderEmail').value,
        OrganisationReplyToName: document.getElementById('replyToName').value,
        OrganisationReplyToEmail: document.getElementById('replyToEmail').value,
        OrganisationExecutiveSenderName: document.getElementById('executiveSenderName').value,
        OrganisationExecutiveSenderEmail: document.getElementById('executiveSenderEmail').value,
        OrganisationExecutiveReplyToName: document.getElementById('executiveReplyToName').value,
        OrganisationExecutiveReplyToEmail: document.getElementById('executiveReplyToEmail').value
      };
  const profile = {
    SchoolName: data.get('SchoolName'),
    SchoolCode: data.get('SchoolCode'),
    SchoolAddress: data.get('SchoolAddress'),
    SchoolEmail: data.get('SchoolEmail'),
    SchoolPhone: data.get('SchoolPhone'),
    SchoolSignatoryName: data.get('SchoolSignatoryName'),
    SchoolSignatoryTitle: data.get('SchoolSignatoryTitle'),
    ResultSignatoryName: data.get('ResultSignatoryName'),
    ResultSignatoryTitle: data.get('ResultSignatoryTitle'),
    OfferSignatoryName: data.get('OfferSignatoryName'),
    OfferSignatoryTitle: data.get('OfferSignatoryTitle'),
    AdmissionSignatoryName: data.get('AdmissionSignatoryName'),
    AdmissionSignatoryTitle: data.get('AdmissionSignatoryTitle'),
    EmailGreetingTemplate: data.get('EmailGreetingTemplate'),
    NameFormat: data.get('NameFormat'),
    PortalHeadline: data.get('PortalHeadline'),
    PortalSubheading: data.get('PortalSubheading'),
    PortalNotice: data.get('PortalNotice'),
    TutorialLinks: tutorialLinksFromForm(),
    TutorialChannelUrl: data.get('TutorialChannelUrl'),
    ResultDisplayMode: data.get('ResultDisplayMode'),
    ShowResultsOnline: data.get('ShowResultsOnline'),
    OrganisationEdition: document.getElementById('organisationEdition').value,
    OnlinePaymentEnabled: data.get('OnlinePaymentEnabled'),
    DirectBankTransferEnabled: data.get('DirectBankTransferEnabled'),
    PaymentBankName: data.get('PaymentBankName'),
    PaymentAccountName: data.get('PaymentAccountName'),
    PaymentAccountNumber: data.get('PaymentAccountNumber'),
    PaymentBankCurrency: data.get('PaymentBankCurrency'),
    PaymentTransferInstructions: data.get('PaymentTransferInstructions'),
    CurrentAcademicSession: data.get('CurrentAcademicSession'),
    CurrentTerm: data.get('CurrentTerm'),
    ...senderProfile
  };
  if (settingsScopeField.value === 'branch') {
    profile.PaystackSubaccountCode = data.get('PaystackSubaccountCode');
  }
  if (webLogoChanged) profile.WebLogoDataUrl = webLogoDataUrl;
  return profile;
}

function populateBranchOptions(profile = {}) {
  const current = settingsBranchField.value;
  const branches = Array.isArray(profile.AvailableBranches) ? profile.AvailableBranches : [];
  settingsBranchField.innerHTML = '';
  branches.forEach((branch) => {
    const option = document.createElement('option');
    option.value = String(branch.Id || '').trim();
    option.textContent = String(branch.Name || branch.Id || '').trim();
    if (option.value) settingsBranchField.appendChild(option);
  });
  const preferred = profile.EffectiveBranchId || current || profile.ActiveBranchId;
  if (preferred && [...settingsBranchField.options].some((option) => option.value === preferred)) {
    settingsBranchField.value = preferred;
  }
}

function applySettingsAccess(access = null) {
  if (!access || typeof access !== 'object') return;
  activeSettingsAccess = {
    scope: access.scope === 'branch' ? 'branch' : 'organisation',
    branchId: String(access.branchId || '').trim(),
    scopeLocked: access.scopeLocked === true
  };
  settingsScopeField.value = activeSettingsAccess.scope;
  if (activeSettingsAccess.branchId) {
    let option = [...settingsBranchField.options].find((row) => row.value === activeSettingsAccess.branchId);
    if (!option) {
      option = document.createElement('option');
      option.value = activeSettingsAccess.branchId;
      option.textContent = activeSettingsAccess.branchId;
      settingsBranchField.appendChild(option);
    }
    settingsBranchField.value = activeSettingsAccess.branchId;
  }
}

function applyProfile(profile = {}, settingsAccess = null) {
  populateBranchOptions(profile);
  applySettingsAccess(settingsAccess);
  setField('schoolName', profile.SchoolName);
  setField('schoolCode', profile.SchoolCode || 'DCA');
  setField('schoolAddress', profile.SchoolAddress);
  setField('organisationEdition', profile.OrganisationEdition || 'school');
  setField('schoolEmail', profile.SchoolEmail);
  setField('schoolPhone', profile.SchoolPhone);
  setField('schoolSignatoryName', profile.SchoolSignatoryName);
  setField('schoolSignatoryTitle', profile.SchoolSignatoryTitle);
  setField('resultSignatoryName', profile.ResultSignatoryName);
  setField('resultSignatoryTitle', profile.ResultSignatoryTitle);
  setField('offerSignatoryName', profile.OfferSignatoryName);
  setField('offerSignatoryTitle', profile.OfferSignatoryTitle);
  setField('admissionSignatoryName', profile.AdmissionSignatoryName);
  setField('admissionSignatoryTitle', profile.AdmissionSignatoryTitle);
  setField('emailGreetingTemplate', profile.EmailGreetingTemplate || 'Dear Parent/Guardian,');
  const schoolSender = normalizeSettingsEdition(profile.OrganisationEdition) === 'school';
  setField('senderName', schoolSender ? profile.BrevoSenderName : profile.OrganisationSenderName);
  setField('senderEmail', schoolSender ? profile.BrevoSenderEmail : profile.OrganisationSenderEmail);
  setField('replyToName', schoolSender ? profile.BrevoReplyToName : profile.OrganisationReplyToName);
  setField('replyToEmail', schoolSender ? profile.BrevoReplyToEmail : profile.OrganisationReplyToEmail);
  setField('executiveSenderName', schoolSender ? profile.ExecutiveSenderName : profile.OrganisationExecutiveSenderName);
  setField('executiveSenderEmail', schoolSender ? profile.ExecutiveSenderEmail : profile.OrganisationExecutiveSenderEmail);
  setField('executiveReplyToName', schoolSender ? profile.ExecutiveReplyToName : profile.OrganisationExecutiveReplyToName);
  setField('executiveReplyToEmail', schoolSender ? profile.ExecutiveReplyToEmail : profile.OrganisationExecutiveReplyToEmail);
  updateEmailProviderUI(profile);
  setField('nameFormat', profile.NameFormat || 'Surname, first name, middle name');
  setField('portalHeadline', profile.PortalHeadline);
  setField('portalSubheading', profile.PortalSubheading);
  setField('portalNotice', profile.PortalNotice);
  loadedTutorialLinks = parseTutorialLinks(profile.TutorialLinks);
  setField('tutorialChannelUrl', profile.TutorialChannelUrl);
  webLogoDataUrl = '';
  webLogoChanged = false;
  document.getElementById('webLogoPreview').src = profile.WebLogoUrl || 'images/Logo.png';
  setField('resultDisplayMode', profile.ResultDisplayMode || 'subjects');
  setField('showResultsOnline', profile.ShowResultsOnline || 'NO');
  const storageStatus = document.getElementById('r2StorageStatus');
  if (storageStatus) {
    storageStatus.textContent = profile.DocumentStorageConfigured
      ? 'Connected — Cloudflare R2 is ready.'
      : 'Not connected — bind the deployment bucket as DYNAMAX_DOCUMENTS.';
  }
  setField('subscriptionPlan', profile.SubscriptionPlan || 'Starter');
  setField('userLimit', profile.UserLimit || 5);
  setField('onlinePaymentEnabled', profile.OnlinePaymentEnabled || 'YES');
  updatePaystackConnectionUI(profile);
  setField('paystackSubaccountCode', profile.PaystackSubaccountCode);
  setField('directBankTransferEnabled', profile.DirectBankTransferEnabled || 'NO');
  setField('paymentBankName', profile.PaymentBankName);
  setField('paymentAccountName', profile.PaymentAccountName);
  setField('paymentAccountNumber', profile.PaymentAccountNumber);
  setField('paymentBankCurrency', profile.PaymentBankCurrency || 'NGN');
  setField('paymentTransferInstructions', profile.PaymentTransferInstructions);
  setField('academicPolicySession', profile.CurrentAcademicSession);
  setField('academicPolicyTerm', profile.CurrentTerm || 'First Term');
  applyEditionTerminology(profile);
  updateSettingsScopeUI(profile);
}

function updateSettingsScopeUI(profile = {}) {
  const scopeLocked = activeSettingsAccess.scopeLocked === true;
  if (scopeLocked) {
    settingsScopeField.value = 'branch';
    if (activeSettingsAccess.branchId) settingsBranchField.value = activeSettingsAccess.branchId;
  }
  const branchMode = settingsScopeField.value === 'branch';
  if (academicPolicyScopeMode) academicPolicyScopeMode.hidden = !branchMode;
  settingsScopeField.disabled = scopeLocked;
  settingsBranchField.disabled = !branchMode || scopeLocked;
  resetBranchSettingsButton.hidden = !branchMode;
  const branchName = settingsBranchField.selectedOptions[0]?.textContent || 'Selected branch';
  const overrideCount = Array.isArray(profile.BranchOverrideFields) ? profile.BranchOverrideFields.length : 0;
  settingsScopeSummary.textContent = branchMode
    ? scopeLocked
      ? `Branch administrator access is locked to ${branchName}. You may change its ${overrideCount} current override${overrideCount === 1 ? '' : 's'} and other branch-level fields; organisation settings remain locked.`
      : `${branchName} currently overrides ${overrideCount} field${overrideCount === 1 ? '' : 's'}; every other value is inherited automatically.`
    : 'Edit the defaults inherited automatically by every branch.';
  settingsSaveScopeLabel.textContent = branchMode ? `${branchName} overrides` : 'Organisation settings';
  organisationOnlyControlIds.forEach((id) => {
    const control = document.getElementById(id);
    if (!control) return;
    control.disabled = branchMode || id === 'organisationEdition';
    control.closest('.settings-section, .settings-field, .settings-logo-card')?.classList.toggle('settings-scope-locked', branchMode);
  });
  tutorialSettingsSection?.classList.toggle('settings-scope-locked', branchMode);
  tutorialSettingsSection?.querySelectorAll('input').forEach((control) => {
    control.disabled = branchMode;
  });
  const paystackSubaccountCode = document.getElementById('paystackSubaccountCode');
  const paystackSubaccountField = document.getElementById('paystackSubaccountField');
  const paystackSubaccountHelp = document.getElementById('paystackSubaccountHelp');
  if (paystackSubaccountCode) paystackSubaccountCode.disabled = !branchMode;
  paystackSubaccountField?.classList.toggle('settings-scope-locked', !branchMode);
  if (paystackSubaccountHelp) {
    paystackSubaccountHelp.textContent = branchMode
      ? 'Payments for this branch settle to this Paystack subaccount, and the branch bears the Paystack fee. Leave blank to use the organisation Paystack account.'
      : 'Select a branch override to configure its Paystack subaccount. The organisation payment gateway remains protected in Cloudflare.';
  }
  const connectionLocked = branchMode || !paystackSelfServiceAvailable;
  [paystackSecretKeyField, confirmPaystackReplacement, connectPaystackButton].forEach((control) => {
    if (control) control.disabled = connectionLocked;
  });
  paystackConnectionPanel?.classList.toggle('settings-scope-locked', branchMode);
  const providerChangeLocked = branchMode || !emailProviderSelfServiceAvailable;
  [connectGoogleEmailButton, useBrevoEmailButton].forEach((control) => {
    if (control) control.disabled = providerChangeLocked;
  });
  if (emailProviderTestRecipient) emailProviderTestRecipient.disabled = branchMode || !emailProviderConnectionReady;
  if (testEmailProviderButton) testEmailProviderButton.disabled = branchMode || !emailProviderConnectionReady;
  emailProviderPanel?.classList.toggle('settings-scope-locked', branchMode);
  const emailProviderScopeHelp = document.getElementById('emailProviderScopeHelp');
  if (emailProviderScopeHelp) {
    emailProviderScopeHelp.textContent = branchMode
      ? `${branchName} inherits the organisation email provider. Only its sender and reply-to identities below can be overridden here.`
      : 'Every branch uses this provider while retaining its own sender and reply-to identities.';
  }
  if (branchMode) {
    webLogoDataUrl = '';
    webLogoChanged = false;
  }
}

async function loadProfile(password = '', { scope = settingsScopeField.value, branchId = settingsBranchField.value } = {}) {
  try {
    const response = password
      ? await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'load',
            password,
            SettingsScope: scope,
            BranchId: scope === 'branch' ? branchId : ''
          })
        })
      : await fetch('/api/settings');
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.message || 'Could not load setup.');
    applyProfile(data.profile || {}, data.settingsAccess);
    if (password && activeSettingsEdition === 'school') await loadAcademicPolicy({ silent: true });
    return data.profile || {};
  } catch (error) {
    setStatus(error.message, 'bad');
    throw error;
  }
}

setupLoginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter || setupLoginForm.querySelector('button[type="submit"]');
  if (!window.DynamaxActionFeedback.begin(button, 'Unlocking settings...')) return;
  try {
    setLoginStatus('Checking password...', '');
    unlockedPassword = document.getElementById('setupPassword').value;
    settingsScopeField.value = requestedSettingsScope;
    await loadProfile(unlockedPassword, {
      scope: requestedSettingsScope,
      branchId: requestedSettingsBranch
    });
    setupLoginForm.hidden = true;
    setupForm.hidden = false;
    setStatus('Settings loaded and ready to edit.', 'ok');
    handleEmailConnectionCallback();
    revealRequestedSettingsSection();
  } catch (error) {
    unlockedPassword = '';
    setLoginStatus(error.message, 'bad');
  } finally {
    if (button?.isConnected) window.DynamaxActionFeedback.end(button);
  }
});

document.getElementById('webLogoFile').addEventListener('change', async (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  try {
    webLogoDataUrl = await resizeLogo(file);
    webLogoChanged = true;
    document.getElementById('webLogoPreview').src = webLogoDataUrl;
    setStatus('Web logo selected. Save Setup to publish it.', 'ok');
  } catch (error) {
    event.target.value = '';
    setStatus(error.message, 'bad');
  }
});

document.getElementById('removeWebLogo').addEventListener('click', () => {
  webLogoDataUrl = '';
  webLogoChanged = true;
  document.getElementById('webLogoFile').value = '';
  document.getElementById('webLogoPreview').src = 'images/Logo.png';
  setStatus('Default web logo selected. Save Setup to publish it.', 'ok');
});

function resizeLogo(file) {
  if (!file.type.startsWith('image/')) return Promise.reject(new Error('Choose a PNG, JPG, or WebP image.'));
  return new Promise((resolve, reject) => {
    const image = new Image();
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The selected logo could not be read.'));
    reader.onload = () => { image.src = reader.result; };
    image.onerror = () => reject(new Error('The selected file is not a valid image.'));
    image.onload = () => {
      const scale = Math.min(1, 360 / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      const result = canvas.toDataURL('image/png');
      if (result.length > 750000) reject(new Error('The logo is still too large after resizing. Choose a simpler image.'));
      else resolve(result);
    };
    reader.readAsDataURL(file);
  });
}

setupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!window.DynamaxActionFeedback.begin(saveSetupButton, 'Saving changes...')) return;
  try {
    setStatus('Saving setup...', '');
    const response = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: unlockedPassword,
        SettingsScope: settingsScopeField.value,
        BranchId: settingsScopeField.value === 'branch' ? settingsBranchField.value : '',
        profile: profileFromForm()
      })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.message || 'Setup could not be saved.');
    applyProfile(data.profile || {}, data.settingsAccess);
    announceSettingsChange();
    setStatus(data.message || 'All changes saved.', 'ok');
  } catch (error) {
    setStatus(error.message, 'bad');
  } finally {
    window.DynamaxActionFeedback.end(saveSetupButton);
  }
});

setupForm.addEventListener('input', (event) => {
  if (academicPolicySection?.contains(event.target)) return;
  setStatus('You have unsaved changes.', '');
});

connectPaystackButton?.addEventListener('click', async () => {
  const secret = String(paystackSecretKeyField?.value || '').trim();
  if (!secret) {
    setPaystackConnectionStatus('Paste the Paystack secret key first.', 'bad');
    paystackSecretKeyField?.focus();
    return;
  }
  if (paystackConfigured() && !confirmPaystackReplacement?.checked) {
    setPaystackConnectionStatus('Confirm the replacement after reconciling payments created with the current account.', 'bad');
    return;
  }
  if (!window.DynamaxActionFeedback.begin(connectPaystackButton, 'Validating and connecting…')) return;
  try {
    setPaystackConnectionStatus('Validating the key with Paystack and installing the encrypted Cloudflare secret…');
    const response = await fetch('/api/paystack-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: unlockedPassword,
        SettingsScope: 'organisation',
        paystackSecretKey: secret,
        confirmReplacement: confirmPaystackReplacement?.checked === true
      })
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) throw new Error(data?.message || 'Paystack could not be connected.');
    paystackConnectionMode = String(data.mode || 'configured').trim().toLowerCase();
    if (confirmPaystackReplacement) confirmPaystackReplacement.checked = false;
    updatePaystackConnectionUI({ PaystackConnectionMode: paystackConnectionMode, PaystackSelfServiceAvailable: true });
    setPaystackConnectionStatus(`${data.message} Add the webhook URL shown above in Paystack API Keys & Webhooks.`, 'ok');
    setStatus('Paystack connection saved securely. The payment deployment is updating.', 'ok');
  } catch (error) {
    setPaystackConnectionStatus(error.message, 'bad');
  } finally {
    if (paystackSecretKeyField) paystackSecretKeyField.value = '';
    window.DynamaxActionFeedback.end(connectPaystackButton);
  }
});

document.getElementById('copyPaystackWebhook')?.addEventListener('click', async () => {
  const value = document.getElementById('paystackWebhookUrl')?.textContent || '';
  try {
    await navigator.clipboard.writeText(value);
    setPaystackConnectionStatus('Webhook URL copied.', 'ok');
  } catch (_error) {
    setPaystackConnectionStatus('Copy the webhook URL manually from the field above.', 'bad');
  }
});

connectGoogleEmailButton?.addEventListener('click', async () => {
  if (!emailProviderSelfServiceAvailable) {
    setEmailProviderStatus('This deployment still needs the secure provider self-service upgrade.', 'bad');
    return;
  }
  if (!window.DynamaxActionFeedback.begin(connectGoogleEmailButton, 'Preparing Google sign-in…')) return;
  let navigating = false;
  try {
    setEmailProviderStatus('Preparing a secure Google OAuth connection…');
    const data = await requestEmailProviderAction('connect-google');
    const authorizationUrl = new URL(String(data.authorizationUrl || ''));
    if (authorizationUrl.protocol !== 'https:' || authorizationUrl.hostname !== 'accounts.google.com') {
      throw new Error('The email service returned an invalid Google authorisation address.');
    }
    window.location.assign(authorizationUrl.href);
    navigating = true;
  } catch (error) {
    setEmailProviderStatus(error.message, 'bad');
  } finally {
    if (!navigating && connectGoogleEmailButton.isConnected) window.DynamaxActionFeedback.end(connectGoogleEmailButton);
  }
});

useBrevoEmailButton?.addEventListener('click', async () => {
  if (!await window.DynamaxDialogs.confirm({
    title: 'Use Brevo for email delivery',
    message: 'Disconnect Google as the active provider and return this organisation to its existing Brevo configuration?',
    confirmText: 'Use Brevo'
  })) return;
  if (!window.DynamaxActionFeedback.begin(useBrevoEmailButton, 'Switching provider…')) return;
  let deploymentQueued = false;
  try {
    setEmailProviderStatus('Requesting the secure provider change…');
    const data = await requestEmailProviderAction('use-brevo');
    const state = document.getElementById('emailProviderState');
    const badge = document.getElementById('emailProviderBadge');
    if (state) state.textContent = 'Switching to Brevo';
    if (badge) {
      badge.textContent = 'Updating';
      badge.classList.remove('is-ready', 'is-google');
    }
    deploymentQueued = true;
    setEmailProviderStatus(data.message || 'The switch to Brevo is being applied securely.', 'ok');
    setStatus('Email-provider update submitted. Reload after the deployment finishes to verify the active provider.', 'ok');
  } catch (error) {
    setEmailProviderStatus(error.message, 'bad');
  } finally {
    if (useBrevoEmailButton.isConnected) window.DynamaxActionFeedback.end(useBrevoEmailButton);
    if (deploymentQueued) {
      [connectGoogleEmailButton, useBrevoEmailButton, testEmailProviderButton, emailProviderTestRecipient].forEach((control) => {
        if (control) control.disabled = true;
      });
    }
  }
});

testEmailProviderButton?.addEventListener('click', async () => {
  const recipientEmail = String(emailProviderTestRecipient?.value || '').trim();
  if (!recipientEmail || !emailProviderTestRecipient.checkValidity()) {
    emailProviderTestRecipient?.reportValidity();
    setEmailProviderStatus('Enter a valid recipient email address for the test.', 'bad');
    return;
  }
  if (!window.DynamaxActionFeedback.begin(testEmailProviderButton, 'Sending test email…')) return;
  try {
    setEmailProviderStatus(`Sending a test through ${activeEmailProvider === 'gmail' ? 'Google' : 'Brevo'}…`);
    const data = await requestEmailProviderAction('test', { recipientEmail });
    setEmailProviderStatus(data.message || `Test email sent to ${recipientEmail}.`, 'ok');
  } catch (error) {
    setEmailProviderStatus(error.message, 'bad');
  } finally {
    if (testEmailProviderButton.isConnected) window.DynamaxActionFeedback.end(testEmailProviderButton);
  }
});

policyField('addAcademicComponent')?.addEventListener('click', () => {
  policyField('academicComponents').appendChild(createAcademicComponentRow({}, policyField('academicComponents').children.length));
});

policyField('addAcademicGradeBand')?.addEventListener('click', () => {
  policyField('academicGradeBands').appendChild(createAcademicGradeRow({}, policyField('academicGradeBands').children.length));
});

policyField('addAcademicCumulativeTerm')?.addEventListener('click', () => {
  policyField('academicCumulativeTerms').appendChild(createAcademicCumulativeTermRow({}, policyField('academicCumulativeTerms').children.length));
});

policyField('academicFeeClearanceMode')?.addEventListener('change', updateAcademicPolicyConditionalFields);
policyField('academicPromotionMode')?.addEventListener('change', updateAcademicPolicyConditionalFields);
policyField('academicProbationResitEnabled')?.addEventListener('change', updateAcademicPolicyConditionalFields);
academicPolicyInheritanceMode?.addEventListener('change', () => {
  if (academicPolicyInheritanceHelp) {
    academicPolicyInheritanceHelp.textContent = academicPolicyInheritanceMode.value === 'independent'
      ? 'Save and activate the draft to isolate this branch’s complete academic policy and test components from organisation changes.'
      : 'Save and activate the draft to keep only this branch’s differences while inheriting every other organisation rule.';
  }
  setStatus('The branch academic-policy source has changed. Save the policy draft, then activate it.', '');
});

policyField('loadAcademicPolicyButton')?.addEventListener('click', async (event) => {
  const button = event.currentTarget;
  if (!window.DynamaxActionFeedback.begin(button, 'Loading policy...')) return;
  try {
    await loadAcademicPolicy();
    setStatus('Academic policy loaded for the selected period.', 'ok');
  } catch (error) {
    setStatus(error.message, 'bad');
  } finally {
    window.DynamaxActionFeedback.end(button);
  }
});

policyField('saveAcademicPolicyButton')?.addEventListener('click', async (event) => {
  const button = event.currentTarget;
  if (!window.DynamaxActionFeedback.begin(button, 'Saving draft...')) return;
  try {
    await requestAcademicPolicy('saveDraft', { policy: academicPolicyFromForm() });
    setStatus('Academic policy draft saved. It is not active until validation passes and you activate it.', 'ok');
  } catch (error) {
    renderAcademicPolicyIssues(error.issues || [], false);
    setStatus(error.message, 'bad');
  } finally {
    window.DynamaxActionFeedback.end(button);
  }
});

activateAcademicPolicyButton?.addEventListener('click', async (event) => {
  const button = event.currentTarget;
  if (!await window.DynamaxDialogs.confirm({
    title: 'Activate academic policy',
    message: 'Activate this policy for the selected scope, session and term? New academic records will use this effective policy.',
    confirmText: 'Activate policy'
  })) return;
  if (!window.DynamaxActionFeedback.begin(button, 'Activating...')) return;
  try {
    await requestAcademicPolicy('activate');
    announceSettingsChange();
    setStatus('Academic policy activated successfully.', 'ok');
  } catch (error) {
    renderAcademicPolicyIssues(error.issues || [], Boolean(loadedAcademicPolicyView?.DraftRevisionId));
    setStatus(error.message, 'bad');
  } finally {
    window.DynamaxActionFeedback.end(button);
  }
});

inheritAcademicPolicyButton?.addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const branchName = settingsBranchField.selectedOptions[0]?.textContent || 'this branch';
  if (!await window.DynamaxDialogs.confirm({
    title: 'Use organisation academic policy',
    message: `Remove the active and draft academic-policy overrides for ${branchName} in this session and term?`,
    tone: 'danger',
    confirmText: 'Use organisation policy'
  })) return;
  if (!window.DynamaxActionFeedback.begin(button, 'Resetting policy...')) return;
  try {
    await requestAcademicPolicy('inherit');
    announceSettingsChange();
    setStatus(`${branchName} now inherits the organisation academic policy for this period.`, 'ok');
  } catch (error) {
    setStatus(error.message, 'bad');
  } finally {
    window.DynamaxActionFeedback.end(button);
  }
});

async function reloadSelectedSettingsScope() {
  if (!unlockedPassword) return;
  try {
    setStatus('Loading the selected settings scope...', '');
    await loadProfile(unlockedPassword);
    setStatus(settingsScopeField.value === 'branch'
      ? 'Branch-effective settings loaded. Change only the values this branch needs to override.'
      : 'Organisation defaults loaded.', 'ok');
  } catch (error) {
    setStatus(error.message, 'bad');
  }
}

settingsScopeField?.addEventListener('change', reloadSelectedSettingsScope);
settingsBranchField?.addEventListener('change', reloadSelectedSettingsScope);

resetBranchSettingsButton?.addEventListener('click', async () => {
  const branchName = settingsBranchField.selectedOptions[0]?.textContent || 'this branch';
  if (!await window.DynamaxDialogs.confirm({ title: 'Reset branch settings', message: `Reset ${branchName} so every setting inherits the organisation defaults?`, tone: 'danger', confirmText: 'Reset branch' })) return;
  if (!window.DynamaxActionFeedback.begin(resetBranchSettingsButton, 'Resetting...')) return;
  try {
    const response = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'resetBranchOverrides',
        password: unlockedPassword,
        SettingsScope: 'branch',
        BranchId: settingsBranchField.value
      })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.message || 'Branch overrides could not be reset.');
    applyProfile(data.profile || {}, data.settingsAccess);
    announceSettingsChange();
    setStatus(data.message, 'ok');
  } catch (error) {
    setStatus(error.message, 'bad');
  } finally {
    window.DynamaxActionFeedback.end(resetBranchSettingsButton);
  }
});

const settingsNavLinks = [...document.querySelectorAll('.settings-nav-link')];
settingsNavLinks.forEach((link) => link.addEventListener('click', () => {
  settingsNavLinks.forEach((item) => item.classList.toggle('active', item === link));
}));

if (requestedEmailConnection) {
  const succeeded = ['connected', 'success', 'ready'].includes(requestedEmailConnection);
  const message = requestedEmailMessage || (succeeded
    ? 'Google email connection completed.'
    : 'Google email connection was not completed.');
  setLoginStatus(`${message} Unlock settings to review email delivery.`, succeeded ? 'ok' : 'bad');
}

if ('IntersectionObserver' in window) {
  const sectionObserver = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    settingsNavLinks.forEach((link) => link.classList.toggle('active', link.getAttribute('href') === `#${visible.target.id}`));
  }, { rootMargin: '-15% 0px -65% 0px', threshold: [0, .2, .5] });
  document.querySelectorAll('.settings-section').forEach((section) => sectionObserver.observe(section));
}

// Public pages can read the school profile, but setup editing stays locked until password entry.
