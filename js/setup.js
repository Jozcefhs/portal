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
const requestedSettingsParams = new URLSearchParams(window.location.search);
const requestedSettingsBranch = (requestedSettingsParams.get('branch') || '').trim();
const requestedSettingsScope = requestedSettingsParams.get('scope') === 'branch' && requestedSettingsBranch
  ? 'branch'
  : 'organisation';
let unlockedPassword = '';
let webLogoDataUrl = '';
let webLogoChanged = false;
const fixedPlanUserLimits = { Free: 5, Starter: 5, Standard: 20, Professional: 50 };
const organisationOnlyControlIds = [
  'organisationEdition', 'nameFormat', 'webLogoFile', 'removeWebLogo',
  'productKeyMode', 'googleDocumentsUrl', 'subscriptionPlan', 'userLimit'
];

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

function applyEditionTerminology(profile = {}) {
  const edition = normalizeSettingsEdition(profile.OrganisationEdition);
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
}

function alignPlanUserLimit() {
  const planField = document.getElementById('subscriptionPlan');
  const limitField = document.getElementById('userLimit');
  if (!planField || !limitField) return;
  const fixedLimit = fixedPlanUserLimits[planField.value];
  limitField.readOnly = Boolean(fixedLimit);
  if (fixedLimit) limitField.value = fixedLimit;
}

function setStatus(message, type) {
  setupStatus.textContent = message || '';
  setupStatus.className = 'status ' + (type || '');
}

function setLoginStatus(message, type) {
  setupLoginStatus.textContent = message || '';
  setupLoginStatus.className = 'status ' + (type || '');
}

function setField(id, value) {
  const node = document.getElementById(id);
  if (node) node.value = value || '';
}

function revealRequestedSettingsSection() {
  const sectionId = window.location.hash.slice(1);
  const section = sectionId ? document.getElementById(sectionId) : null;
  if (!section || section.hidden) return;
  document.querySelectorAll('.settings-nav-link').forEach((link) => {
    link.classList.toggle('active', link.getAttribute('href') === `#${sectionId}`);
  });
  window.requestAnimationFrame(() => section.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

function profileFromForm() {
  const data = new FormData(setupForm);
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
    ResultDisplayMode: data.get('ResultDisplayMode'),
    ShowResultsOnline: data.get('ShowResultsOnline'),
    ProductKeyMode: data.get('ProductKeyMode'),
    OrganisationEdition: document.getElementById('organisationEdition').value,
    GoogleDocumentsUrl: data.get('GoogleDocumentsUrl'),
    SubscriptionPlan: data.get('SubscriptionPlan'),
    UserLimit: data.get('UserLimit'),
    OnlinePaymentEnabled: data.get('OnlinePaymentEnabled'),
    DirectBankTransferEnabled: data.get('DirectBankTransferEnabled'),
    PaymentBankName: data.get('PaymentBankName'),
    PaymentAccountName: data.get('PaymentAccountName'),
    PaymentAccountNumber: data.get('PaymentAccountNumber'),
    PaymentBankCurrency: data.get('PaymentBankCurrency'),
    PaymentTransferInstructions: data.get('PaymentTransferInstructions')
  };
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

function applyProfile(profile = {}) {
  populateBranchOptions(profile);
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
  setField('nameFormat', profile.NameFormat || 'Surname, first name, middle name');
  setField('portalHeadline', profile.PortalHeadline);
  setField('portalSubheading', profile.PortalSubheading);
  setField('portalNotice', profile.PortalNotice);
  webLogoDataUrl = '';
  webLogoChanged = false;
  document.getElementById('webLogoPreview').src = profile.WebLogoUrl || 'images/Logo.png';
  setField('resultDisplayMode', profile.ResultDisplayMode || 'subjects');
  setField('showResultsOnline', profile.ShowResultsOnline || 'NO');
  setField('productKeyMode', profile.ProductKeyMode || 'off');
  setField('googleDocumentsUrl', profile.GoogleDocumentsUrl);
  setField('subscriptionPlan', profile.SubscriptionPlan || 'Starter');
  setField('userLimit', profile.UserLimit || 5);
  setField('onlinePaymentEnabled', profile.OnlinePaymentEnabled || 'YES');
  setField('directBankTransferEnabled', profile.DirectBankTransferEnabled || 'NO');
  setField('paymentBankName', profile.PaymentBankName);
  setField('paymentAccountName', profile.PaymentAccountName);
  setField('paymentAccountNumber', profile.PaymentAccountNumber);
  setField('paymentBankCurrency', profile.PaymentBankCurrency || 'NGN');
  setField('paymentTransferInstructions', profile.PaymentTransferInstructions);
  applyEditionTerminology(profile);
  updateSettingsScopeUI(profile);
  alignPlanUserLimit();
}

function updateSettingsScopeUI(profile = {}) {
  const branchMode = settingsScopeField.value === 'branch';
  settingsBranchField.disabled = !branchMode;
  resetBranchSettingsButton.hidden = !branchMode;
  const branchName = settingsBranchField.selectedOptions[0]?.textContent || 'Selected branch';
  const overrideCount = Array.isArray(profile.BranchOverrideFields) ? profile.BranchOverrideFields.length : 0;
  settingsScopeSummary.textContent = branchMode
    ? `${branchName} currently overrides ${overrideCount} field${overrideCount === 1 ? '' : 's'}; every other value is inherited automatically.`
    : 'Edit the defaults inherited automatically by every branch.';
  settingsSaveScopeLabel.textContent = branchMode ? `${branchName} overrides` : 'Organisation settings';
  organisationOnlyControlIds.forEach((id) => {
    const control = document.getElementById(id);
    if (!control) return;
    control.disabled = branchMode || id === 'organisationEdition';
    control.closest('.settings-section, .settings-field, .settings-logo-card')?.classList.toggle('settings-scope-locked', branchMode);
  });
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
    applyProfile(data.profile || {});
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
    applyProfile(data.profile || {});
    setStatus(data.message || 'All changes saved.', 'ok');
  } catch (error) {
    setStatus(error.message, 'bad');
  } finally {
    window.DynamaxActionFeedback.end(saveSetupButton);
  }
});

setupForm.addEventListener('input', () => {
  setStatus('You have unsaved changes.', '');
});

document.getElementById('subscriptionPlan')?.addEventListener('change', alignPlanUserLimit);

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
  if (!window.confirm(`Reset ${branchName} so every setting inherits the organisation defaults?`)) return;
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
    applyProfile(data.profile || {});
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

if ('IntersectionObserver' in window) {
  const sectionObserver = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    settingsNavLinks.forEach((link) => link.classList.toggle('active', link.getAttribute('href') === `#${visible.target.id}`));
  }, { rootMargin: '-15% 0px -65% 0px', threshold: [0, .2, .5] });
  document.querySelectorAll('.settings-section').forEach((section) => sectionObserver.observe(section));
}

// Public pages can read the school profile, but setup editing stays locked until password entry.
