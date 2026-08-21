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
const academicPolicySection = document.getElementById('academic-policy-settings');
const academicPolicyIssues = document.getElementById('academicPolicyIssues');
const activateAcademicPolicyButton = document.getElementById('activateAcademicPolicyButton');
const inheritAcademicPolicyButton = document.getElementById('inheritAcademicPolicyButton');
const requestedSettingsParams = new URLSearchParams(window.location.search);
const requestedSettingsBranch = (requestedSettingsParams.get('branch') || '').trim();
const requestedSettingsScope = requestedSettingsParams.get('scope') === 'branch' && requestedSettingsBranch
  ? 'branch'
  : 'organisation';
let unlockedPassword = '';
let webLogoDataUrl = '';
let webLogoChanged = false;
let activeSettingsEdition = 'school';
let loadedAcademicPolicyView = null;
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
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'academic-remove-row';
  remove.setAttribute('aria-label', `Remove assessment component ${index + 1}`);
  remove.textContent = '×';
  remove.addEventListener('click', () => row.remove());
  row.append(name, maximum, weight, source, required, remove);
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
}

function renderAcademicPolicy(policy = {}) {
  const result = policy.ResultAccess || {};
  const clearance = result.FinancialClearance || {};
  const position = policy.Position || {};
  const assessment = policy.Assessment || {};
  const cumulative = policy.Cumulative || {};
  const promotion = policy.Promotion || {};
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
  renderAcademicComponents(assessment.Components || []);
  renderAcademicGradeBands(assessment.GradeBands || []);
  renderAcademicCumulativeTerms(cumulative.Terms || []);
  setField('academicMissingTermMode', cumulative.MissingTermMode || 'block');
  setField('academicMissingSubjectMode', cumulative.MissingSubjectMode || 'block');
  policyField('academicIncludeTransferredResults').checked = cumulative.IncludeTransferredResults !== false;
  setField('academicPromotionMode', promotion.Mode || 'unconfigured');
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
    const [name, maximum, weight, source, required] = row.children;
    return {
      Id: row.dataset.policyId,
      Name: name.value,
      MaximumScore: Number(maximum.value || 0),
      WeightPercentage: Number(weight.value || 0),
      SourceMode: source.value,
      Required: required.checked,
      Order: index + 1
    };
  });
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
    Cumulative: {
      Terms: cumulativeTerms,
      MissingTermMode: policyField('academicMissingTermMode').value,
      MissingSubjectMode: policyField('academicMissingSubjectMode').value,
      IncludeTransferredResults: policyField('academicIncludeTransferredResults').checked
    },
    Promotion: {
      Mode: policyField('academicPromotionMode').value,
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
  const active = Boolean(view.ActiveRevisionId);
  policyField('academicPolicyStateTitle').textContent = hasDraft && view.DraftRevisionId !== view.ActiveRevisionId
    ? 'Draft saved; activation pending'
    : active
      ? 'Active academic policy'
      : 'No active academic policy';
  policyField('academicPolicyStateSummary').textContent = message || (hasDraft
    ? `${view.Period?.Session || ''} / ${view.Period?.Term || ''} · ${view.Scope?.Type || 'organisation'} scope`
    : 'Complete and save a draft before activation.');
  renderAcademicPolicyIssues(view.ActivationIssues || [], hasDraft);
  activateAcademicPolicyButton.disabled = !view.CanActivate;
  inheritAcademicPolicyButton.hidden = settingsScopeField.value !== 'branch';
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
    SubscriptionPlan: data.get('SubscriptionPlan'),
    UserLimit: data.get('UserLimit'),
    OnlinePaymentEnabled: data.get('OnlinePaymentEnabled'),
    DirectBankTransferEnabled: data.get('DirectBankTransferEnabled'),
    PaymentBankName: data.get('PaymentBankName'),
    PaymentAccountName: data.get('PaymentAccountName'),
    PaymentAccountNumber: data.get('PaymentAccountNumber'),
    PaymentBankCurrency: data.get('PaymentBankCurrency'),
    PaymentTransferInstructions: data.get('PaymentTransferInstructions'),
    CurrentAcademicSession: data.get('CurrentAcademicSession'),
    CurrentTerm: data.get('CurrentTerm')
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
  const storageStatus = document.getElementById('r2StorageStatus');
  if (storageStatus) {
    storageStatus.textContent = profile.DocumentStorageConfigured
      ? 'Connected — Cloudflare R2 is ready.'
      : 'Not connected — bind the deployment bucket as DYNAMAX_DOCUMENTS.';
  }
  setField('subscriptionPlan', profile.SubscriptionPlan || 'Starter');
  setField('userLimit', profile.UserLimit || 5);
  setField('onlinePaymentEnabled', profile.OnlinePaymentEnabled || 'YES');
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

document.getElementById('subscriptionPlan')?.addEventListener('change', alignPlanUserLimit);

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
    applyProfile(data.profile || {});
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

if ('IntersectionObserver' in window) {
  const sectionObserver = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    settingsNavLinks.forEach((link) => link.classList.toggle('active', link.getAttribute('href') === `#${visible.target.id}`));
  }, { rootMargin: '-15% 0px -65% 0px', threshold: [0, .2, .5] });
  document.querySelectorAll('.settings-section').forEach((section) => sectionObserver.observe(section));
}

// Public pages can read the school profile, but setup editing stays locked until password entry.
