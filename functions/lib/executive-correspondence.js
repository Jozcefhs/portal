import {
  createDocumentIfAbsent,
  deleteDocument,
  getDocument,
  listCollection,
  upsertDocument
} from './firestore.js';
import { CHURCH_COLLECTIONS, churchCollectionPath } from './church-foundation.js';
import { resolveOrganizationConfig } from './organization-config.js';
import { listSchoolCollection, safeScopeId, schoolSectionFor } from './school-scope.js';
import { escapeEmailHtml, sendConfiguredEmail } from './email-service.js';
import { loadStaffApprovalProfile, publicStaffApprovalProfile } from './staff-approval-profile.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const nowIso = () => new Date().toISOString();
const active = (value) => value === undefined ||
  !['no', 'false', '0', 'inactive', 'disabled'].includes(lower(value));
const safeId = (value) => clean(value)
  .replace(/[\/\\?#\[\]]/g, '-')
  .replace(/\s+/g, '_')
  .slice(0, 140);

const CORRESPONDENCE_COLLECTION = 'executiveCorrespondence';
const TEMPLATE_COLLECTION = 'executiveCorrespondenceTemplates';
const ENDORSEMENT_COLLECTION = 'executiveCorrespondenceEndorsements';
const SNAPSHOT_COLLECTION = 'executiveCorrespondenceSnapshots';
const TRANSITION_COLLECTION = 'executiveCorrespondenceTransitions';
const AUDIT_COLLECTION = 'executiveCorrespondenceAudit';
const PREFERENCE_COLLECTION = 'executiveMetricPreferences';

export const EXECUTIVE_CORRESPONDENCE_KINDS = Object.freeze([
  Object.freeze({ id: 'official-letter', label: 'Official letter', editions: ['school', 'faith', 'church', 'organization'] }),
  Object.freeze({ id: 'transfer-certificate', label: 'Transfer certificate', editions: ['school'] }),
  Object.freeze({ id: 'recommendation', label: 'Recommendation letter', editions: ['school', 'faith', 'church', 'organization'] }),
  Object.freeze({ id: 'attestation', label: 'Attestation or confirmation', editions: ['school', 'faith', 'church', 'organization'] }),
  Object.freeze({ id: 'external-agency', label: 'Ministry or agency correspondence', editions: ['school', 'faith', 'church', 'organization'] })
]);

export const EXECUTIVE_TEMPLATE_TOKENS = Object.freeze([
  'ORGANISATION_NAME', 'ORGANISATION_CODE', 'ORGANISATION_ADDRESS', 'ORGANISATION_EMAIL',
  'ORGANISATION_PHONE', 'RECIPIENT_NAME', 'RECIPIENT_TITLE', 'RECIPIENT_ORGANISATION',
  'RECIPIENT_ADDRESS', 'SUBJECT', 'DATE', 'REFERENCE', 'SIGNATORY_NAME', 'SIGNATORY_TITLE',
  'STUDENT_NAME', 'ADMISSION_NO', 'CLASS', 'ADMISSION_DATE', 'LEAVING_DATE', 'DESTINATION',
  'REASON', 'CONDUCT', 'ACADEMIC_SESSION', 'MEMBER_NAME', 'MEMBER_ID', 'DEPARTMENT', 'POSITION'
]);

const TOKEN_SET = new Set(EXECUTIVE_TEMPLATE_TOKENS);
const EXECUTIVE_ROLES = new Set(['Principal', 'Senior Pastor']);

const BUILT_IN_TEMPLATES = Object.freeze([
  Object.freeze({
    TemplateId: 'builtin-official-letter',
    Name: 'Official letter',
    Kind: 'official-letter',
    SubjectTemplate: '{{SUBJECT}}',
    BodyTemplate: 'Dear {{RECIPIENT_NAME}},\n\n[Write the official message here.]\n\nYours faithfully,\n{{SIGNATORY_NAME}}\n{{SIGNATORY_TITLE}}',
    Editions: ['school', 'faith', 'church', 'organization']
  }),
  Object.freeze({
    TemplateId: 'builtin-transfer-certificate',
    Name: 'Transfer certificate',
    Kind: 'transfer-certificate',
    SubjectTemplate: 'Transfer Certificate - {{STUDENT_NAME}}',
    BodyTemplate: 'This is to certify that {{STUDENT_NAME}}, admission number {{ADMISSION_NO}}, was a bona fide student of {{ORGANISATION_NAME}} in {{CLASS}}.\n\nThe student attended this school from {{ADMISSION_DATE}} to {{LEAVING_DATE}}. Reason for leaving: {{REASON}}.\n\nConduct: {{CONDUCT}}.\n\nThis certificate is issued upon request for official purposes.',
    Editions: ['school']
  }),
  Object.freeze({
    TemplateId: 'builtin-recommendation',
    Name: 'Recommendation letter',
    Kind: 'recommendation',
    SubjectTemplate: 'Recommendation for {{RECIPIENT_NAME}}',
    BodyTemplate: 'To whom it may concern,\n\n[Write the recommendation here.]\n\nThis recommendation is issued by {{ORGANISATION_NAME}} for official use.\n\nYours faithfully,\n{{SIGNATORY_NAME}}\n{{SIGNATORY_TITLE}}',
    Editions: ['school', 'faith', 'church', 'organization']
  }),
  Object.freeze({
    TemplateId: 'builtin-external-agency',
    Name: 'Ministry or agency letter',
    Kind: 'external-agency',
    SubjectTemplate: '{{SUBJECT}}',
    BodyTemplate: 'The {{RECIPIENT_TITLE}}\n{{RECIPIENT_ORGANISATION}}\n{{RECIPIENT_ADDRESS}}\n\nDear Sir/Madam,\n\n[Write the official message here.]\n\nYours faithfully,\n{{SIGNATORY_NAME}}\n{{SIGNATORY_TITLE}}',
    Editions: ['school', 'faith', 'church', 'organization']
  })
]);

function inputError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function canonicalExecutiveRole(value) {
  const role = lower(value);
  if (role === 'principal') return 'Principal';
  if (['senior pastor', 'head minister', 'senior minister'].includes(role)) return 'Senior Pastor';
  if (role === 'super admin') return 'Super Admin';
  return clean(value);
}

export function executiveOfficeCapabilities(user = {}, editionValue = '') {
  const edition = lower(editionValue || user.edition || user.OrganisationEdition) || 'school';
  const role = canonicalExecutiveRole(user.role || user.Role);
  const allowed = new Set((user.allowedSections || user.AllowedSections || []).map(clean).filter(Boolean));
  const sectionAllowed = !allowed.size || allowed.has('executiveOffice');
  const editionAllowed = role === 'Super Admin' ||
    (role === 'Principal' && edition === 'school') ||
    (role === 'Senior Pastor' && ['faith', 'church', 'organization'].includes(edition));
  const enabled = sectionAllowed && editionAllowed;
  const school = edition === 'school';
  return {
    enabled,
    role,
    edition,
    canSearchStudents: enabled && school,
    canSearchStaff: enabled,
    canSearchClasses: enabled && school,
    canSearchMembers: enabled && !school,
    canSearchDepartments: enabled && !school,
    canManageTemplates: enabled,
    canDraft: enabled,
    canIssue: enabled,
    canSend: enabled,
    canConfigureDashboard: enabled
  };
}

function assertExecutiveAccess(user, edition) {
  const capabilities = executiveOfficeCapabilities(user, edition);
  if (!capabilities.enabled) {
    throw inputError('This account is not permitted to use the Executive Office for this organisation edition.', 403);
  }
  return capabilities;
}

function requestedScope(user = {}, body = {}, edition = 'school') {
  const assignedBranch = lower(user.branchId || user.BranchId);
  const requestedBranch = lower(body.branchId || body.BranchId);
  if (assignedBranch && requestedBranch && assignedBranch !== requestedBranch) {
    throw inputError('This account is restricted to another branch.', 403);
  }
  const branchId = safeScopeId(assignedBranch || requestedBranch || 'main');
  let schoolSection = '';
  if (edition === 'school') {
    const assignedSection = lower(user.schoolSectionAccess || user.SchoolSectionAccess || 'All');
    const requestedSection = lower(body.schoolSection || body.SchoolSection);
    if (assignedSection !== 'all' && requestedSection && assignedSection !== requestedSection) {
      throw inputError('This account is restricted to another school section.', 403);
    }
    schoolSection = assignedSection !== 'all'
      ? assignedSection
      : (['primary', 'secondary'].includes(requestedSection) ? requestedSection : 'all');
  }
  return { edition, branchId, schoolSection };
}

function rowInScope(row, scope) {
  if (lower(row.Edition || row.OrganisationEdition) !== scope.edition) return false;
  if (lower(row.BranchId || 'main') !== scope.branchId) return false;
  if (scope.edition !== 'school' || scope.schoolSection === 'all') return true;
  return lower(row.SchoolSection || 'all') === scope.schoolSection;
}

function visibleSchoolRow(row, scope) {
  if (lower(row.BranchId || 'main') !== scope.branchId) return false;
  return scope.schoolSection === 'all' || schoolSectionFor(row) === scope.schoolSection;
}

function visibleStaffRow(row, scope) {
  if (lower(row.BranchId || 'main') !== scope.branchId) return false;
  if (scope.edition !== 'school' || scope.schoolSection === 'all') return true;
  const section = lower(row.SchoolSectionAccess || row.SchoolSection || 'All');
  return section === 'all' || section === scope.schoolSection;
}

function boundText(value, maximum = 500) {
  return clean(value).replace(/\u0000/g, '').slice(0, maximum);
}

function normalizeEmail(value) {
  const email = lower(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function normalizeTokenValues(input = {}) {
  const values = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const result = {};
  Object.entries(values).forEach(([key, value]) => {
    const normalizedKey = clean(key).toUpperCase().replace(/[^A-Z0-9_]/g, '');
    if (TOKEN_SET.has(normalizedKey)) {
      result[normalizedKey] = boundText(value, 1200);
    }
  });
  return result;
}

function unknownTemplateTokens(value) {
  const unknown = new Set();
  String(value || '').replace(/\{\{([A-Z0-9_]+)\}\}/gi, (_match, key) => {
    const normalized = clean(key).toUpperCase();
    if (!TOKEN_SET.has(normalized)) unknown.add(normalized);
    return '';
  });
  return [...unknown];
}

function validateTemplateText(value, label, maximum) {
  const text = boundText(value, maximum);
  const unknown = unknownTemplateTokens(text);
  if (unknown.length) throw inputError(`${label} contains unsupported token${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}.`);
  return text;
}

export function renderTokenTemplate(template, tokenValues = {}) {
  const normalized = normalizeTokenValues(tokenValues);
  return String(template || '').replace(/\{\{([A-Z0-9_]+)\}\}/gi, (_match, key) => normalized[clean(key).toUpperCase()] || '');
}

function normalizeKind(value, edition) {
  const kind = lower(value) || 'official-letter';
  const definition = EXECUTIVE_CORRESPONDENCE_KINDS.find((item) => item.id === kind && item.editions.includes(edition));
  if (!definition) throw inputError('Choose an official correspondence type available for this organisation.');
  return definition.id;
}

function publicTemplate(row = {}) {
  return {
    TemplateId: clean(row.TemplateId || row.__id),
    Name: clean(row.Name),
    Kind: clean(row.Kind),
    SubjectTemplate: clean(row.SubjectTemplate),
    BodyTemplate: clean(row.BodyTemplate),
    BuiltIn: Boolean(row.BuiltIn),
    UpdatedAt: clean(row.UpdatedAt)
  };
}

function publicCorrespondence(row = {}, includeBody = true) {
  const result = {
    CorrespondenceId: clean(row.CorrespondenceId || row.__id),
    Reference: clean(row.Reference),
    Kind: clean(row.Kind),
    Subject: clean(row.Subject),
    RecipientType: clean(row.RecipientType),
    RecipientId: clean(row.RecipientId),
    RecipientName: clean(row.RecipientName),
    RecipientTitle: clean(row.RecipientTitle),
    RecipientOrganisation: clean(row.RecipientOrganisation),
    RecipientEmail: clean(row.RecipientEmail),
    RecipientAddress: clean(row.RecipientAddress),
    Status: clean(row.Status || 'Draft'),
    BranchId: clean(row.BranchId),
    SchoolSection: clean(row.SchoolSection),
    TemplateId: clean(row.TemplateId),
    TokenValues: normalizeTokenValues(row.TokenValues),
    SignatureApplied: Boolean(row.SignatureApplied),
    StampApplied: Boolean(row.StampApplied),
    ApplySignature: Boolean(row.SignatureApplied),
    ApplyStamp: Boolean(row.StampApplied),
    CreatedAt: clean(row.CreatedAt),
    CreatedBy: clean(row.CreatedBy),
    UpdatedAt: clean(row.UpdatedAt),
    UpdatedBy: clean(row.UpdatedBy),
    IssuedAt: clean(row.IssuedAt),
    IssuedBy: clean(row.IssuedBy),
    SentAt: clean(row.SentAt),
    SentBy: clean(row.SentBy),
    DeliveryStatus: clean(row.DeliveryStatus)
  };
  if (includeBody) {
    result.SubjectTemplate = clean(row.SubjectTemplate);
    result.BodyTemplate = clean(row.BodyTemplate);
  }
  return result;
}

export function normalizeCorrespondenceDraft(input = {}, context = {}) {
  const edition = lower(context.edition || input.Edition) || 'school';
  const existing = context.existing || {};
  const now = clean(context.now) || nowIso();
  const id = clean(input.CorrespondenceId || input.correspondenceId || existing.CorrespondenceId || existing.__id)
    || `COR-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const kind = normalizeKind(input.Kind || input.kind || existing.Kind, edition);
  const subjectTemplate = validateTemplateText(
    input.SubjectTemplate ?? input.subjectTemplate ?? input.Subject ?? input.subject ?? existing.SubjectTemplate ?? existing.Subject,
    'Subject',
    500
  );
  const bodyTemplate = validateTemplateText(
    input.BodyTemplate ?? input.bodyTemplate ?? input.Body ?? input.body ?? existing.BodyTemplate,
    'Letter body',
    15000
  );
  if (!subjectTemplate) throw inputError('A subject is required.');
  if (!bodyTemplate) throw inputError('The official letter body is required.');
  const flatTokenValues = {
    ADMISSION_DATE: input.AdmissionDate ?? input.admissionDate,
    LEAVING_DATE: input.LeavingDate ?? input.leavingDate,
    CLASS: input.LastClass ?? input.lastClass ?? input.ClassName ?? input.className,
    REASON: input.ReasonForLeaving ?? input.reasonForLeaving ?? input.Reason ?? input.reason,
    CONDUCT: input.Conduct ?? input.conduct,
    DESTINATION: input.TransferTo ?? input.transferTo ?? input.Destination ?? input.destination,
    LETTER_BODY: input.LetterBody ?? input.letterBody
  };
  const tokenValues = {
    ...normalizeTokenValues(existing.TokenValues),
    ...normalizeTokenValues(flatTokenValues),
    ...normalizeTokenValues(input.TokenValues || input.tokenValues)
  };
  const recipientTypeInput = lower(input.RecipientType || input.recipientType || existing.RecipientType || 'custom');
  const recipientType = ({
    students: 'student',
    staffusers: 'staff',
    classes: 'class',
    members: 'member',
    departments: 'department'
  })[recipientTypeInput] || recipientTypeInput;
  const recipientId = boundText(input.RecipientId ?? input.recipientId ?? existing.RecipientId, 200);
  const recipientName = boundText(input.RecipientName ?? input.recipientName ?? existing.RecipientName, 240);
  if (!recipientName) throw inputError('A recipient name is required.');
  if (kind === 'transfer-certificate' && (recipientType !== 'student' || !recipientId)) {
    throw inputError('A transfer certificate must be linked to an enrolled student.');
  }
  return {
    CorrespondenceId: id,
    Edition: edition,
    BranchId: clean(context.branchId || existing.BranchId || 'main'),
    SchoolSection: edition === 'school' ? clean(context.schoolSection || existing.SchoolSection || 'all') : '',
    Kind: kind,
    TemplateId: boundText(input.TemplateId ?? input.templateId ?? existing.TemplateId, 140),
    SubjectTemplate: subjectTemplate,
    BodyTemplate: bodyTemplate,
    RecipientType: recipientType,
    RecipientId: recipientId,
    RecipientName: recipientName,
    RecipientTitle: boundText(input.RecipientTitle ?? input.recipientTitle ?? existing.RecipientTitle, 240),
    RecipientOrganisation: boundText(
      input.RecipientOrganisation ?? input.recipientOrganisation ??
      input.RecipientOrganization ?? input.recipientOrganization ??
      existing.RecipientOrganisation,
      300
    ),
    RecipientEmail: normalizeEmail(input.RecipientEmail ?? input.recipientEmail ?? existing.RecipientEmail),
    RecipientAddress: boundText(input.RecipientAddress ?? input.recipientAddress ?? existing.RecipientAddress, 1200),
    TokenValues: tokenValues,
    Status: 'Draft',
    CreatedAt: clean(existing.CreatedAt) || now,
    CreatedBy: clean(existing.CreatedBy) || clean(context.actor),
    CreatedByUsername: clean(existing.CreatedByUsername) || clean(context.username),
    UpdatedAt: now,
    UpdatedBy: clean(context.actor),
    UpdatedByUsername: clean(context.username)
  };
}

export function normalizeTemplate(input, context) {
  const existing = context.existing || {};
  const id = clean(existing.TemplateId || existing.__id)
    || `TPL-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const name = boundText(input.Name || input.name || input.TemplateName || input.templateName || existing.Name, 160);
  if (!name) throw inputError('A template name is required.');
  const kind = normalizeKind(input.Kind || input.kind || existing.Kind, context.edition);
  const subjectTemplate = validateTemplateText(
    input.SubjectTemplate ?? input.subjectTemplate ?? input.Subject ?? input.subject ?? existing.SubjectTemplate,
    'Template subject',
    500
  );
  const bodyTemplate = validateTemplateText(
    input.BodyTemplate ?? input.bodyTemplate ?? input.Body ?? input.body ?? input.BodyText ?? input.bodyText ?? existing.BodyTemplate,
    'Template body',
    15000
  );
  if (!subjectTemplate || !bodyTemplate) throw inputError('Template subject and body are required.');
  const now = nowIso();
  return {
    TemplateId: id,
    Edition: context.edition,
    BranchId: context.branchId,
    SchoolSection: context.schoolSection,
    Name: name,
    Kind: kind,
    SubjectTemplate: subjectTemplate,
    BodyTemplate: bodyTemplate,
    BuiltIn: false,
    CreatedAt: clean(existing.CreatedAt) || now,
    CreatedBy: clean(existing.CreatedBy) || context.actor,
    UpdatedAt: now,
    UpdatedBy: context.actor
  };
}

export function validateTemplateWriteTarget(requestedIdValue, existing, scope) {
  const requestedId = clean(requestedIdValue);
  if (!requestedId) return null;
  if (lower(requestedId).startsWith('builtin-')) {
    throw inputError('Built-in templates cannot be overwritten. Save this as a new custom template.', 409);
  }
  if (!existing) throw inputError('The selected custom template was not found.', 404);
  if (!rowInScope(existing, scope)) {
    throw inputError('This template belongs to another branch or section.', 403);
  }
  return existing;
}

function builtInTemplates(edition) {
  return BUILT_IN_TEMPLATES
    .filter((item) => item.Editions.includes(edition))
    .map((item) => publicTemplate({ ...item, BuiltIn: true }));
}

function availableKinds(edition) {
  return EXECUTIVE_CORRESPONDENCE_KINDS.filter((item) => item.editions.includes(edition));
}

function metricDefinitions(edition) {
  if (edition === 'school') {
    return [
      { id: 'studentTotal', label: 'Students', format: 'number' },
      { id: 'activeStudents', label: 'Active students', format: 'number' },
      { id: 'studentByClass', label: 'Students by class', format: 'bar' },
      { id: 'staffTotal', label: 'Staff', format: 'number' },
      { id: 'activeStaff', label: 'Active staff', format: 'number' },
      { id: 'staffByDepartment', label: 'Staff by department', format: 'bar' },
      { id: 'classTotal', label: 'Classes', format: 'number' },
      { id: 'correspondenceByStatus', label: 'Correspondence by status', format: 'bar' },
      { id: 'issuedCorrespondence', label: 'Issued correspondence', format: 'number' },
      { id: 'transferCertificates', label: 'Transfer certificates', format: 'number' }
    ];
  }
  return [
    { id: 'memberTotal', label: 'Members', format: 'number' },
    { id: 'activeMembers', label: 'Active members', format: 'number' },
    { id: 'membersByDepartment', label: 'Members by department', format: 'bar' },
    { id: 'staffTotal', label: 'Staff', format: 'number' },
    { id: 'activeStaff', label: 'Active staff', format: 'number' },
    { id: 'staffByDepartment', label: 'Staff by department', format: 'bar' },
    { id: 'departmentTotal', label: 'Departments', format: 'number' },
    { id: 'attendanceByDepartment', label: 'Attendance by department', format: 'bar' },
    { id: 'programParticipants', label: 'Program participants', format: 'number' },
    { id: 'correspondenceByStatus', label: 'Correspondence by status', format: 'bar' },
    { id: 'issuedCorrespondence', label: 'Issued correspondence', format: 'number' }
  ];
}

export function normalizeExecutiveMetricPreferences(input, edition = 'school') {
  const allowed = new Set(metricDefinitions(edition).map((item) => item.id));
  const supplied = Array.isArray(input) ? input : [];
  const selected = [...new Set(supplied.map(clean).filter((item) => allowed.has(item)))].slice(0, 8);
  if (selected.length) return selected;
  return edition === 'school'
    ? ['studentTotal', 'staffTotal', 'classTotal', 'issuedCorrespondence']
    : ['memberTotal', 'departmentTotal', 'staffTotal', 'issuedCorrespondence'];
}

function countSeries(rows, labelFor) {
  const values = new Map();
  rows.forEach((row) => {
    const label = boundText(labelFor(row) || 'Unassigned', 100) || 'Unassigned';
    values.set(label, (values.get(label) || 0) + 1);
  });
  return [...values.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label))
    .slice(0, 20);
}

function metricResult(definition, value = 0, series = []) {
  return {
    id: definition.id,
    label: definition.label,
    value: Number(value || 0),
    format: definition.format,
    series: Array.isArray(series) ? series : []
  };
}

export function absolutePublicAssetUrl(env = {}, value = '') {
  const publicPortalUrl = clean(
    env.PUBLIC_PORTAL_URL ||
    env.CANONICAL_PORTAL_URL ||
    env.PORTAL_BASE_URL ||
    env.PUBLIC_BASE_URL ||
    'https://digc-suite.pages.dev'
  ).replace(/\/+$/, '');
  const source = clean(value) || '/images/Logo.png';
  if (/^https:\/\//i.test(source)) return source;
  if (/^http:\/\//i.test(source)) return source.replace(/^http:/i, 'https:');
  return `${publicPortalUrl}/${source.replace(/^\/+/, '')}`;
}

async function loadIdentity(env) {
  const [organizationProfile, schoolProfile, documentBranding, webBranding] = await Promise.all([
    getDocument(env, 'settings', 'organisationProfile').catch(() => ({})),
    getDocument(env, 'settings', 'schoolProfile').catch(() => ({})),
    getDocument(env, 'settings', 'documentBranding').catch(() => ({})),
    getDocument(env, 'settings', 'webBranding').catch(() => ({}))
  ]);
  const organization = resolveOrganizationConfig({ env, organizationProfile, legacyProfile: schoolProfile });
  const logoDataUrl = clean(documentBranding?.DocumentLogoDataUrl || webBranding?.WebLogoDataUrl);
  const configuredLogo = logoDataUrl ? '/api/web-logo' : clean(organizationProfile?.BrandLogoUrl);
  return {
    ...organization,
    Address: clean(schoolProfile?.SchoolAddress || organizationProfile?.Address),
    Email: clean(schoolProfile?.SchoolEmail || organizationProfile?.Email),
    Phone: clean(schoolProfile?.SchoolPhone || organizationProfile?.Phone),
    CurrentAcademicSession: clean(schoolProfile?.CurrentAcademicSession),
    LogoDataUrl: logoDataUrl,
    LogoUrl: absolutePublicAssetUrl(env, configuredLogo)
  };
}

async function loadCustomTemplates(env, scope) {
  return (await listCollection(env, TEMPLATE_COLLECTION))
    .filter((row) => rowInScope(row, scope))
    .sort((a, b) => clean(b.UpdatedAt).localeCompare(clean(a.UpdatedAt)));
}

async function loadScopedCorrespondence(env, scope) {
  return (await listCollection(env, CORRESPONDENCE_COLLECTION))
    .filter((row) => rowInScope(row, scope))
    .sort((a, b) => clean(b.UpdatedAt || b.CreatedAt).localeCompare(clean(a.UpdatedAt || a.CreatedAt)));
}

function preferenceId(user, scope) {
  return safeId([
    lower(user.username || user.Username),
    scope.edition,
    scope.branchId,
    scope.schoolSection || 'all'
  ].join('__'));
}

async function loadMetricPreferences(env, user, scope) {
  const row = await getDocument(env, PREFERENCE_COLLECTION, preferenceId(user, scope)).catch(() => null);
  return normalizeExecutiveMetricPreferences(row?.MetricIds, scope.edition);
}

async function saveMetricPreferences(env, user, scope, input) {
  const metricIds = normalizeExecutiveMetricPreferences(input, scope.edition);
  await upsertDocument(env, PREFERENCE_COLLECTION, preferenceId(user, scope), {
    Username: clean(user.username || user.Username),
    Edition: scope.edition,
    BranchId: scope.branchId,
    SchoolSection: scope.schoolSection,
    MetricIds: metricIds,
    UpdatedAt: nowIso()
  });
  return metricIds;
}

async function metricData(env, scope, selectedIds, correspondenceRows = null) {
  const selected = new Set(selectedIds);
  const needStaff = ['staffTotal', 'activeStaff', 'staffByDepartment'].some((id) => selected.has(id));
  const staff = needStaff
    ? (await listCollection(env, 'staffUsers')).filter((row) => visibleStaffRow(row, scope))
    : [];
  const correspondence = correspondenceRows || await loadScopedCorrespondence(env, scope);
  let students = [];
  let classes = [];
  let members = [];
  let departments = [];
  let assignments = [];
  let attendance = [];
  let registrations = [];
  if (scope.edition === 'school') {
    if (['studentTotal', 'activeStudents', 'studentByClass'].some((id) => selected.has(id))) {
      students = (await listSchoolCollection(env, 'students', {
        branchId: scope.branchId,
        schoolSectionAccess: scope.schoolSection
      })).filter((row) => visibleSchoolRow(row, scope));
    }
    if (selected.has('classTotal')) classes = await listCollection(env, 'settings/academics/classes');
  } else {
    const path = (collection) => churchCollectionPath(collection, scope.branchId);
    const loads = await Promise.all([
      ['memberTotal', 'activeMembers', 'membersByDepartment'].some((id) => selected.has(id))
        ? listCollection(env, path(CHURCH_COLLECTIONS.members)) : [],
      selected.has('departmentTotal') || selected.has('membersByDepartment') || selected.has('attendanceByDepartment')
        ? listCollection(env, path(CHURCH_COLLECTIONS.departments)) : [],
      selected.has('membersByDepartment')
        ? listCollection(env, path(CHURCH_COLLECTIONS.departmentMembers)) : [],
      selected.has('attendanceByDepartment')
        ? listCollection(env, path(CHURCH_COLLECTIONS.departmentAttendance)) : [],
      selected.has('programParticipants')
        ? listCollection(env, path(CHURCH_COLLECTIONS.programRegistrations)) : []
    ]);
    [members, departments, assignments, attendance, registrations] = loads;
  }
  const definitions = new Map(metricDefinitions(scope.edition).map((item) => [item.id, item]));
  const results = [];
  selectedIds.forEach((id) => {
    const definition = definitions.get(id);
    if (!definition) return;
    if (id === 'studentTotal') results.push(metricResult(definition, students.length));
    else if (id === 'activeStudents') results.push(metricResult(definition, students.filter((row) => active(row.Status)).length));
    else if (id === 'studentByClass') results.push(metricResult(definition, students.length, countSeries(students, (row) => row.ClassName || row.Class)));
    else if (id === 'staffTotal') results.push(metricResult(definition, staff.length));
    else if (id === 'activeStaff') results.push(metricResult(definition, staff.filter((row) => active(row.Active)).length));
    else if (id === 'staffByDepartment') results.push(metricResult(definition, staff.length, countSeries(staff, (row) => row.Department)));
    else if (id === 'classTotal') results.push(metricResult(definition, classes.filter((row) => active(row.Active)).length));
    else if (id === 'memberTotal') results.push(metricResult(definition, members.length));
    else if (id === 'activeMembers') results.push(metricResult(definition, members.filter((row) => active(row.Status || row.MembershipStatus)).length));
    else if (id === 'departmentTotal') results.push(metricResult(definition, departments.filter((row) => active(row.Active)).length));
    else if (id === 'membersByDepartment') {
      const names = new Map(departments.map((row) => [clean(row.DepartmentId || row.__id), clean(row.Name || row.DepartmentName)]));
      results.push(metricResult(definition, assignments.length, countSeries(assignments, (row) => names.get(clean(row.DepartmentId)) || row.DepartmentName)));
    } else if (id === 'attendanceByDepartment') {
      const names = new Map(departments.map((row) => [clean(row.DepartmentId || row.__id), clean(row.Name || row.DepartmentName)]));
      results.push(metricResult(definition, attendance.length, countSeries(attendance, (row) => names.get(clean(row.DepartmentId)) || row.DepartmentName)));
    } else if (id === 'programParticipants') results.push(metricResult(definition, registrations.length));
    else if (id === 'issuedCorrespondence') results.push(metricResult(definition, correspondence.filter((row) => ['issued', 'sent'].includes(lower(row.Status))).length));
    else if (id === 'transferCertificates') results.push(metricResult(definition, correspondence.filter((row) => row.Kind === 'transfer-certificate' && ['issued', 'sent'].includes(lower(row.Status))).length));
    else if (id === 'correspondenceByStatus') results.push(metricResult(definition, correspondence.length, countSeries(correspondence, (row) => row.Status || 'Draft')));
  });
  return results;
}

function searchText(row) {
  return Object.values(row).map(clean).join(' ').toLowerCase();
}

function searchResult(type, id, name, subtitle, email, address, row, tokenValues = {}) {
  return {
    id: clean(id),
    type,
    name: clean(name) || clean(id),
    subtitle: clean(subtitle),
    email: normalizeEmail(email),
    address: boundText(address, 1000),
    branchId: lower(row?.BranchId || 'main') || 'main',
    schoolSection: clean(row?.SchoolSection || row?.SchoolSectionAccess),
    tokenValues: normalizeTokenValues(tokenValues)
  };
}

function requestedSearchTypes(body, capabilities) {
  const available = [
    capabilities.canSearchStudents && 'student',
    capabilities.canSearchStaff && 'staff',
    capabilities.canSearchClasses && 'class',
    capabilities.canSearchMembers && 'member',
    capabilities.canSearchDepartments && 'department'
  ].filter(Boolean);
  const requested = lower(body.type || body.targetType);
  return { available, selected: requested ? available.filter((type) => type === requested) : available };
}

async function searchDirectory(env, body, capabilities, scope) {
  const query = lower(body.query || body.search).replace(/\s+/g, ' ').slice(0, 120);
  if (query.length < 2) throw inputError('Enter at least two characters to search the Executive Office directory.');
  const terms = query.split(' ').filter(Boolean);
  const { available, selected } = requestedSearchTypes(body, capabilities);
  if (!selected.length) throw inputError('Choose a directory type available to this executive account.', 403);
  const groups = await Promise.all(selected.map(async (type) => {
    if (type === 'student') {
      return (await listSchoolCollection(env, 'students', {
        branchId: scope.branchId,
        schoolSectionAccess: scope.schoolSection
      }))
        .filter((row) => visibleSchoolRow(row, scope))
        .map((row) => searchResult(
          type,
          row.AdmissionNo || row.AccountRef || row.__id,
          row.DisplayName || row.StudentName || row.ApplicantName,
          [row.AdmissionNo || row.AccountRef, row.ClassName, row.ClassArm].map(clean).filter(Boolean).join(' · '),
          row.ParentEmail || row.VerificationEmail,
          row.ParentAddress || row.Address,
          row,
          {
            RECIPIENT_NAME: row.DisplayName || row.StudentName || row.ApplicantName,
            STUDENT_NAME: row.DisplayName || row.StudentName || row.ApplicantName,
            ADMISSION_NO: row.AdmissionNo || row.AccountRef,
            CLASS: [row.ClassName, row.ClassArm].map(clean).filter(Boolean).join(' '),
            ADMISSION_DATE: row.AdmissionDate,
            ACADEMIC_SESSION: row.AcademicSession
          }
        ));
    }
    if (type === 'staff') {
      return (await listCollection(env, 'staffUsers'))
        .filter((row) => visibleStaffRow(row, scope))
        .map((row) => searchResult(
          type,
          row.Username || row.__id,
          row.DisplayName || row.Username || row.__id,
          [row.Role, row.Department, row.Position].map(clean).filter(Boolean).join(' · '),
          row.Email || row.StaffEmail,
          row.Address,
          row,
          { RECIPIENT_NAME: row.DisplayName, RECIPIENT_TITLE: row.Position || row.Role, DEPARTMENT: row.Department, POSITION: row.Position }
        ));
    }
    if (type === 'class') {
      return (await listCollection(env, 'settings/academics/classes'))
        .filter((row) => active(row.Active))
        .map((row) => searchResult(
          type,
          row.__id || row.ClassName,
          row.ClassName || row.__id,
          clean(row.Arms) ? `Arms: ${clean(row.Arms)}` : 'School class',
          '',
          '',
          { BranchId: scope.branchId, SchoolSection: scope.schoolSection },
          { CLASS: row.ClassName || row.__id }
        ));
    }
    const path = (collection) => churchCollectionPath(collection, scope.branchId);
    if (type === 'member') {
      return (await listCollection(env, path(CHURCH_COLLECTIONS.members))).map((row) => searchResult(
        type,
        row.MemberId || row.__id,
        row.DisplayName || [row.FirstName, row.Surname].map(clean).filter(Boolean).join(' '),
        [row.MemberId, row.Ministry, row.Phone].map(clean).filter(Boolean).join(' · '),
        row.Email,
        row.Address,
        { ...row, BranchId: scope.branchId },
        { RECIPIENT_NAME: row.DisplayName, MEMBER_NAME: row.DisplayName, MEMBER_ID: row.MemberId || row.__id, DEPARTMENT: row.Ministry }
      ));
    }
    return (await listCollection(env, path(CHURCH_COLLECTIONS.departments))).map((row) => searchResult(
      type,
      row.DepartmentId || row.__id,
      row.Name || row.DepartmentName,
      [row.DepartmentType, row.AreaZone].map(clean).filter(Boolean).join(' · '),
      row.Email,
      row.Address,
      { ...row, BranchId: scope.branchId },
      { RECIPIENT_NAME: row.Name || row.DepartmentName, DEPARTMENT: row.Name || row.DepartmentName }
    ));
  }));
  const results = groups.flat()
    .filter((row) => row.id && terms.every((term) => searchText(row).includes(term)))
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, 40);
  return { query, availableTypes: available, results };
}

async function authoritativeRecipientTokens(env, correspondence, scope) {
  const type = lower(correspondence.RecipientType);
  const id = lower(correspondence.RecipientId);
  if (!id || !['student', 'staff', 'member', 'department', 'class'].includes(type)) return {};
  const capabilities = {
    canSearchStudents: scope.edition === 'school',
    canSearchStaff: true,
    canSearchClasses: scope.edition === 'school',
    canSearchMembers: scope.edition !== 'school',
    canSearchDepartments: scope.edition !== 'school'
  };
  const rows = (await searchDirectory(env, { query: correspondence.RecipientId, type }, capabilities, scope)).results;
  const exact = rows.find((row) => lower(row.id) === id);
  if (!exact) throw inputError('The linked recipient is no longer available in this branch or section.', 404);
  const authoritativeTokens = Object.fromEntries(
    Object.entries(exact.tokenValues || {}).filter(([, value]) => clean(value))
  );
  return {
    ...authoritativeTokens,
    RECIPIENT_NAME: exact.name,
    ...(clean(exact.address) ? { RECIPIENT_ADDRESS: exact.address } : {})
  };
}

async function loadCorrespondence(env, id, scope) {
  const row = await getDocument(env, CORRESPONDENCE_COLLECTION, safeId(id)).catch(() => null);
  if (!row || !rowInScope(row, scope)) throw inputError('The selected correspondence was not found in your permitted scope.', 404);
  return row;
}

export function buildIssuanceSnapshot(identity = {}, correspondence = {}) {
  return {
    SnapshotVersion: 1,
    CorrespondenceId: clean(correspondence.CorrespondenceId || correspondence.__id),
    IssuedAt: clean(correspondence.IssuedAt),
    Identity: {
      Name: clean(identity.Name),
      Code: clean(identity.Code),
      Edition: lower(identity.Edition),
      Address: clean(identity.Address),
      Email: clean(identity.Email),
      Phone: clean(identity.Phone),
      CurrentAcademicSession: clean(identity.CurrentAcademicSession),
      LogoDataUrl: clean(identity.LogoDataUrl),
      LogoUrl: clean(identity.LogoUrl)
    },
    Recipient: {
      RecipientType: clean(correspondence.RecipientType),
      RecipientId: clean(correspondence.RecipientId),
      RecipientName: clean(correspondence.RecipientName),
      RecipientTitle: clean(correspondence.RecipientTitle),
      RecipientOrganisation: clean(correspondence.RecipientOrganisation),
      RecipientEmail: clean(correspondence.RecipientEmail),
      RecipientAddress: clean(correspondence.RecipientAddress)
    },
    TokenValues: normalizeTokenValues(correspondence.TokenValues)
  };
}

async function loadIssuanceSnapshot(env, correspondence) {
  const id = clean(correspondence.CorrespondenceId || correspondence.__id);
  if (!id) return null;
  return getDocument(env, SNAPSHOT_COLLECTION, safeId(id)).catch(() => null);
}

async function loadBrandingContext(env, identity, correspondence, user, issuanceSnapshot = null) {
  const immutable = ['issued', 'sent'].includes(lower(correspondence.Status));
  const snapshotIdentity = immutable && issuanceSnapshot?.Identity ? issuanceSnapshot.Identity : null;
  const snapshotRecipient = immutable && issuanceSnapshot?.Recipient ? issuanceSnapshot.Recipient : null;
  const effectiveIdentity = snapshotIdentity
    ? { ...identity, ...snapshotIdentity }
    : identity;
  const effectiveCorrespondence = snapshotRecipient
    ? { ...correspondence, ...snapshotRecipient }
    : correspondence;
  // Draft previews may follow current directory data. Issued documents must never
  // be re-hydrated from mutable student, staff, member, class or department rows.
  const authoritative = immutable
    ? {}
    : await authoritativeRecipientTokens(env, correspondence, {
      edition: identity.Edition,
      branchId: correspondence.BranchId,
      schoolSection: correspondence.SchoolSection || ''
    });
  const issuedAt = clean(correspondence.IssuedAt || nowIso());
  const savedTokens = normalizeTokenValues(
    immutable && issuanceSnapshot?.TokenValues
      ? issuanceSnapshot.TokenValues
      : correspondence.TokenValues
  );
  const tokenValues = {
    ...savedTokens,
    ...authoritative,
    ORGANISATION_NAME: effectiveIdentity.Name,
    ORGANISATION_CODE: effectiveIdentity.Code,
    ORGANISATION_ADDRESS: effectiveIdentity.Address,
    ORGANISATION_EMAIL: effectiveIdentity.Email,
    ORGANISATION_PHONE: effectiveIdentity.Phone,
    RECIPIENT_NAME: authoritative.RECIPIENT_NAME || effectiveCorrespondence.RecipientName,
    RECIPIENT_TITLE: effectiveCorrespondence.RecipientTitle,
    RECIPIENT_ORGANISATION: effectiveCorrespondence.RecipientOrganisation,
    RECIPIENT_ADDRESS: authoritative.RECIPIENT_ADDRESS || effectiveCorrespondence.RecipientAddress,
    SUBJECT: savedTokens.SUBJECT || correspondence.Subject || correspondence.SubjectTemplate,
    DATE: issuedAt.slice(0, 10),
    REFERENCE: correspondence.Reference,
    SIGNATORY_NAME: correspondence.IssuedBy || clean(user.displayName || user.username),
    SIGNATORY_TITLE: correspondence.IssuerTitle || canonicalExecutiveRole(user.role),
    ACADEMIC_SESSION: savedTokens.ACADEMIC_SESSION || effectiveIdentity.CurrentAcademicSession
  };
  const subject = renderTokenTemplate(correspondence.SubjectTemplate || correspondence.Subject, tokenValues);
  return {
    identity: effectiveIdentity,
    correspondence: effectiveCorrespondence,
    tokenValues: { ...tokenValues, SUBJECT: subject },
    subject,
    body: renderTokenTemplate(correspondence.BodyTemplate, { ...tokenValues, SUBJECT: subject })
  };
}

function imageTag(source, alt, className) {
  const url = clean(source);
  if (!url || (!/^data:image\/(?:png|jpe?g|webp);base64,/i.test(url) && !/^https?:\/\//i.test(url) && !url.startsWith('/'))) return '';
  return `<img class="${className}" src="${escapeEmailHtml(url)}" alt="${escapeEmailHtml(alt)}">`;
}

function cssImageUrl(source) {
  const url = clean(source);
  if (!url || (!/^data:image\/(?:png|jpe?g|webp);base64,/i.test(url) && !/^https?:\/\//i.test(url) && !url.startsWith('/'))) return '';
  return `url("${url.replace(/["\\\r\n<>]/g, (character) => encodeURIComponent(character))}")`;
}

function dataImageAttachment(source, filename) {
  const match = clean(source).match(/^data:image\/(png|jpe?g|webp);base64,([a-z0-9+/=\s]+)$/i);
  if (!match) return null;
  const extension = /^jpe?g$/i.test(match[1]) ? 'jpg' : match[1].toLowerCase();
  return {
    name: `${filename}.${extension}`,
    content: match[2].replace(/\s+/g, '')
  };
}

export function buildPrintableCorrespondence(correspondence, identity, rendered, endorsement = {}) {
  const reference = clean(correspondence.Reference || correspondence.CorrespondenceId);
  const documentTypeTitle = correspondence.Kind === 'transfer-certificate' ? 'Transfer Certificate' : 'Official Correspondence';
  const paragraphs = String(rendered.body || '').split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.split(/\n/).map(escapeEmailHtml).join('<br>')}</p>`).join('');
  const logoSource = identity.LogoUrl || identity.LogoDataUrl;
  const publicLogoSource = /^https:\/\//i.test(clean(identity.LogoUrl)) ? clean(identity.LogoUrl) : '';
  const logo = imageTag(logoSource, identity.Name, 'brand-logo');
  const emailLogo = imageTag(publicLogoSource, identity.Name, 'brand-logo');
  const watermarkImage = cssImageUrl(logoSource);
  const watermarkStyle = watermarkImage
    ? `background-image:linear-gradient(rgba(255,255,255,.93),rgba(255,255,255,.93)),${watermarkImage};background-position:center 55%;background-repeat:no-repeat;background-size:360px auto;`
    : '';
  const signature = correspondence.SignatureApplied
    ? imageTag(endorsement.SignatureDataUrl, 'Signature', 'signature-image')
    : '';
  const stamp = correspondence.StampApplied
    ? imageTag(endorsement.StampDataUrl, 'Official stamp', 'stamp-image')
    : '';
  const emailAttachments = [
    correspondence.SignatureApplied
      ? dataImageAttachment(endorsement.SignatureDataUrl, `${safeId(reference || 'official-document')}-signature`)
      : null,
    correspondence.StampApplied
      ? dataImageAttachment(endorsement.StampDataUrl, `${safeId(reference || 'official-document')}-stamp`)
      : null
  ].filter(Boolean);
  const attachmentLabels = [
    correspondence.SignatureApplied && dataImageAttachment(endorsement.SignatureDataUrl, 'signature') ? 'Digitally signed' : '',
    correspondence.StampApplied && dataImageAttachment(endorsement.StampDataUrl, 'stamp') ? 'Official stamp applied' : ''
  ].filter(Boolean);
  const attachmentNotice = attachmentLabels.length
    ? `<div class="attachment-note">${escapeEmailHtml(attachmentLabels.join(' · '))}<br><small>The applied endorsement image${emailAttachments.length === 1 ? ' is' : 's are'} attached to this email.</small></div>`
    : '';
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeEmailHtml(rendered.subject)}</title>
<style>
@page{size:A4;margin:16mm}*{box-sizing:border-box}body{margin:0;background:#eef3f8;color:#15283f;font:16px/1.62 Arial,sans-serif}.document{position:relative;max-width:760px;margin:22px auto;background:#fff;border:1px solid #cbd9e7;box-shadow:0 14px 40px rgba(17,42,70,.12);overflow:hidden}.accent{height:7px;background:linear-gradient(90deg,#0b4a78,#0d9488,#d39a18)}header{display:flex;align-items:center;gap:18px;padding:21px 30px 18px;border-bottom:2px solid #194f7d}.brand-logo{display:block;width:72px;height:72px;object-fit:contain}.identity h1{margin:0 0 3px;color:#123f68;font-size:24px;line-height:1.2}.identity div{color:#587086;font-size:14px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:8px 28px;padding:13px 30px;background:#eef6ff}.meta b{color:#173f65}.content{position:relative;z-index:1;padding:30px 40px 34px;${watermarkStyle}}.recipient{white-space:pre-line;margin-bottom:24px}.subject{margin:0 0 25px;text-align:center;text-transform:uppercase;text-decoration:underline;font-size:20px;line-height:1.35}.content p{margin:0 0 17px}.endorsement{display:flex;align-items:flex-end;justify-content:space-between;gap:26px;margin-top:48px}.signature-image{display:block;max-width:190px;max-height:72px;object-fit:contain;margin-bottom:5px}.stamp-image{display:block;max-width:120px;max-height:95px;object-fit:contain}.signatory{min-width:260px;border-top:1px solid #536b84;padding-top:8px}.attachment-note{margin-bottom:10px;padding:9px 12px;border-left:4px solid #0d9488;background:#eef9f7;color:#17485a;font-weight:700}.attachment-note small{font-weight:400}.footer{padding:12px 30px;background:#123f68;color:#fff;font-size:12px}@media print{body{background:#fff}.document{margin:0;min-height:250mm;border:0;box-shadow:none}}
</style></head><body><article class="document"><div class="accent"></div><header>${logo}<div class="identity"><h1>${escapeEmailHtml(identity.Name)}</h1><div>${escapeEmailHtml(identity.Address)}</div><div>${escapeEmailHtml([identity.Email, identity.Phone].filter(Boolean).join(' · '))}</div></div></header><section class="meta"><div><b>Reference:</b> ${escapeEmailHtml(reference)}</div><div><b>Date:</b> ${escapeEmailHtml(clean(correspondence.IssuedAt || correspondence.UpdatedAt).slice(0, 10))}</div></section><main class="content"><div class="recipient">${escapeEmailHtml([
    correspondence.RecipientTitle,
    correspondence.RecipientName,
    correspondence.RecipientOrganisation,
    correspondence.RecipientAddress
  ].map(clean).filter(Boolean).join('\n'))}</div><h2 class="subject">${escapeEmailHtml(rendered.subject)}</h2>${paragraphs}<div class="endorsement"><div class="signatory">${signature}<strong>${escapeEmailHtml(correspondence.IssuedBy)}</strong><br>${escapeEmailHtml(correspondence.IssuerTitle)}</div>${stamp}</div></main><footer class="footer">Official document · ${escapeEmailHtml(reference)} · ${escapeEmailHtml(identity.Name)}</footer></article></body></html>`;
  let emailHtml = html;
  if (logo !== emailLogo) emailHtml = emailHtml.replace(logo, emailLogo);
  if (!publicLogoSource && watermarkStyle) emailHtml = emailHtml.replace(watermarkStyle, '');
  if (signature && clean(endorsement.SignatureDataUrl).startsWith('data:')) {
    emailHtml = emailHtml.replace(signature, attachmentNotice);
  } else if (attachmentNotice) {
    emailHtml = emailHtml.replace('<div class="signatory">', `<div class="signatory">${attachmentNotice}`);
  }
  if (stamp && clean(endorsement.StampDataUrl).startsWith('data:')) emailHtml = emailHtml.replace(stamp, '');
  const text = [
    identity.Name,
    identity.Address,
    `Reference: ${reference}`,
    `Date: ${clean(correspondence.IssuedAt || correspondence.UpdatedAt).slice(0, 10)}`,
    '',
    correspondence.RecipientName,
    correspondence.RecipientOrganisation,
    correspondence.RecipientAddress,
    '',
    rendered.subject.toUpperCase(),
    '',
    rendered.body,
    '',
    correspondence.IssuedBy,
    correspondence.IssuerTitle
  ].map(clean).join('\n');
  return {
    title: rendered.subject,
    documentTypeTitle,
    subject: rendered.subject,
    reference,
    filename: `${safeId(reference || title)}.html`,
    text: rendered.body,
    fullText: text,
    html,
    emailHtml,
    emailAttachments
  };
}

async function printableFor(env, user, identity, correspondence) {
  const id = safeId(correspondence.CorrespondenceId || correspondence.__id);
  const [endorsement, issuanceSnapshot] = await Promise.all([
    getDocument(env, ENDORSEMENT_COLLECTION, id).catch(() => ({})),
    loadIssuanceSnapshot(env, correspondence)
  ]);
  const rendered = await loadBrandingContext(env, identity, correspondence, user, issuanceSnapshot);
  return buildPrintableCorrespondence(
    rendered.correspondence,
    rendered.identity,
    rendered,
    endorsement || {}
  );
}

async function writeAudit(env, user, scope, action, details = {}) {
  const auditId = `EXE-AUD-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  await upsertDocument(env, AUDIT_COLLECTION, safeId(auditId), {
    AuditId: auditId,
    Timestamp: nowIso(),
    Action: clean(action).toUpperCase(),
    CorrespondenceId: clean(details.CorrespondenceId),
    TemplateId: clean(details.TemplateId),
    SearchType: clean(details.SearchType),
    ResultCount: Math.max(0, Number(details.ResultCount || 0) || 0),
    Actor: clean(user.displayName || user.DisplayName || user.username || user.Username),
    ActorUsername: clean(user.username || user.Username),
    ActorRole: canonicalExecutiveRole(user.role || user.Role),
    Edition: scope.edition,
    BranchId: scope.branchId,
    SchoolSection: scope.schoolSection,
    AuthMethod: clean(details.AuthMethod),
    DeliveryStatus: clean(details.DeliveryStatus),
    SourcePlatform: clean(details.SourcePlatform || 'Web Executive Office')
  });
}

async function saveDraft(env, user, body, scope) {
  const requestedId = clean(body.CorrespondenceId || body.correspondenceId);
  const existing = requestedId ? await loadCorrespondence(env, requestedId, scope) : null;
  if (existing && lower(existing.Status) !== 'draft') {
    throw inputError('Issued correspondence is immutable. Create a new draft to make changes.', 409);
  }
  const draft = normalizeCorrespondenceDraft(body, {
    existing,
    edition: scope.edition,
    branchId: scope.branchId,
    schoolSection: scope.schoolSection,
    actor: clean(user.displayName || user.username),
    username: clean(user.username)
  });
  await upsertDocument(env, CORRESPONDENCE_COLLECTION, safeId(draft.CorrespondenceId), draft);
  await writeAudit(env, user, scope, existing ? 'UPDATE DRAFT' : 'CREATE DRAFT', {
    CorrespondenceId: draft.CorrespondenceId
  });
  return draft;
}

function referencePrefix(identity, kind) {
  return `${clean(identity.Code) || 'ORG'}-${kind === 'transfer-certificate' ? 'TC' : 'COR'}`;
}

async function acquireTransition(env, correspondenceId, action, user) {
  const transitionId = safeId(`${lower(action)}-${correspondenceId}`);
  const created = await createDocumentIfAbsent(env, TRANSITION_COLLECTION, transitionId, {
    TransitionId: transitionId,
    CorrespondenceId: clean(correspondenceId),
    Action: clean(action).toUpperCase(),
    Status: 'Processing',
    StartedAt: nowIso(),
    StartedBy: clean(user.displayName || user.username),
    StartedByUsername: clean(user.username)
  });
  return {
    acquired: created.created,
    transitionId,
    document: created.document || {}
  };
}

async function completeTransition(env, transition, values = {}) {
  await upsertDocument(env, TRANSITION_COLLECTION, transition.transitionId, {
    ...(transition.document || {}),
    ...values,
    TransitionId: transition.transitionId,
    Status: 'Completed',
    CompletedAt: clean(values.CompletedAt) || nowIso()
  });
}

async function abandonTransition(env, transition) {
  if (!transition?.acquired || !transition.transitionId) return;
  await deleteDocument(env, TRANSITION_COLLECTION, transition.transitionId).catch(() => {});
}

async function issueCorrespondence(env, user, body, scope, identity, authorization) {
  if (!authorization?.method) throw inputError('Confirm issuance with your current password.', 403);
  const requestedId = clean(body.CorrespondenceId || body.correspondenceId);
  let existing = requestedId
    ? await loadCorrespondence(env, requestedId, scope)
    : await saveDraft(env, user, body, scope);
  const includesDraftContent = [
    'SubjectTemplate', 'subjectTemplate', 'Subject', 'subject',
    'BodyTemplate', 'bodyTemplate', 'Body', 'body'
  ].some((key) => Object.prototype.hasOwnProperty.call(body, key));
  if (requestedId && lower(existing.Status) === 'draft' && includesDraftContent) {
    existing = await saveDraft(env, user, body, scope);
  }
  if (!['draft', 'issued', 'sent'].includes(lower(existing.Status))) {
    throw inputError('Only a draft can be issued.', 409);
  }
  if (['issued', 'sent'].includes(lower(existing.Status))) {
    return {
      correspondence: existing,
      printable: await printableFor(env, user, identity, existing),
      alreadyIssued: true
    };
  }
  const transition = await acquireTransition(env, existing.CorrespondenceId || existing.__id, 'issue', user);
  if (!transition.acquired) {
    const latest = await loadCorrespondence(env, existing.CorrespondenceId || existing.__id, scope);
    if (['issued', 'sent'].includes(lower(latest.Status))) {
      return {
        correspondence: latest,
        printable: await printableFor(env, user, identity, latest),
        alreadyIssued: true
      };
    }
    throw inputError('This correspondence is already being issued. Refresh before trying again.', 409);
  }
  try {
    const actor = clean(user.displayName || user.username);
    const role = canonicalExecutiveRole(user.role);
    const profile = await loadStaffApprovalProfile(env, user.username).catch(() => null);
    const applySignature = body.applySignature === true;
    const applyStamp = body.applyStamp === true;
    if (applySignature && !clean(profile?.SignatureDataUrl)) throw inputError('Save your signature in User settings before applying it.');
    if (applyStamp && !clean(profile?.StampDataUrl)) throw inputError('Save your stamp in User settings before applying it.');
    if (existing.Kind === 'transfer-certificate' &&
        (lower(existing.RecipientType) !== 'student' || !clean(existing.RecipientId))) {
      throw inputError('A transfer certificate must be linked to an enrolled student.');
    }
    const issuedAt = nowIso();
    const reference = clean(existing.Reference) ||
      `${referencePrefix(identity, existing.Kind)}-${issuedAt.slice(0, 10).replace(/-/g, '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    // This performs the scoped exact lookup. For transfer certificates it is
    // mandatory, so caller-supplied token text can never impersonate a student.
    const authoritative = await authoritativeRecipientTokens(env, existing, scope);
    const tokenValues = { ...normalizeTokenValues(existing.TokenValues), ...authoritative };
    if (existing.Kind === 'transfer-certificate' &&
        (!clean(tokenValues.STUDENT_NAME) || !clean(tokenValues.ADMISSION_NO) || !clean(tokenValues.CLASS))) {
      throw inputError('The selected student record must include a name, admission number and class before a transfer certificate can be issued.');
    }
    const issued = {
      ...existing,
      Reference: reference,
      TokenValues: tokenValues,
      RecipientName: authoritative.RECIPIENT_NAME || existing.RecipientName,
      RecipientAddress: authoritative.RECIPIENT_ADDRESS || existing.RecipientAddress,
      Status: 'Issued',
      Subject: '',
      IssuedAt: issuedAt,
      IssuedBy: actor,
      IssuedByUsername: clean(user.username),
      IssuerTitle: role,
      SignatureApplied: applySignature,
      StampApplied: applyStamp,
      UpdatedAt: issuedAt,
      UpdatedBy: actor,
      AuthorizationMethod: authorization.method
    };
    delete issued.__id;
    delete issued.__name;
    const issuanceSnapshot = buildIssuanceSnapshot(identity, issued);
    const rendered = await loadBrandingContext(env, identity, issued, user, issuanceSnapshot);
    issued.Subject = rendered.subject;
    issuanceSnapshot.TokenValues = { ...issuanceSnapshot.TokenValues, SUBJECT: rendered.subject };
    // Persist the immutable identity and recipient snapshot first. An orphaned
    // snapshot is recoverable; an issued record without its snapshot is not.
    await upsertDocument(env, SNAPSHOT_COLLECTION, safeId(issued.CorrespondenceId), issuanceSnapshot);
    await upsertDocument(env, CORRESPONDENCE_COLLECTION, safeId(issued.CorrespondenceId), issued);
    await upsertDocument(env, ENDORSEMENT_COLLECTION, safeId(issued.CorrespondenceId), {
      CorrespondenceId: issued.CorrespondenceId,
      IssuedByUsername: clean(user.username),
      SignatureDataUrl: applySignature ? clean(profile.SignatureDataUrl) : '',
      StampDataUrl: applyStamp ? clean(profile.StampDataUrl) : '',
      AppliedAt: issuedAt
    });
    await writeAudit(env, user, scope, 'ISSUE', {
      CorrespondenceId: issued.CorrespondenceId,
      AuthMethod: authorization.method,
      SourcePlatform: authorization.sourcePlatform
    });
    await completeTransition(env, transition, {
      CorrespondenceId: issued.CorrespondenceId,
      Reference: issued.Reference,
      CompletedAt: issuedAt
    });
    return {
      correspondence: issued,
      printable: buildPrintableCorrespondence(
        rendered.correspondence,
        rendered.identity,
        rendered,
        {
          SignatureDataUrl: applySignature ? clean(profile.SignatureDataUrl) : '',
          StampDataUrl: applyStamp ? clean(profile.StampDataUrl) : ''
        }
      )
    };
  } catch (error) {
    await abandonTransition(env, transition);
    throw error;
  }
}

async function sendCorrespondence(env, user, body, scope, identity, authorization) {
  if (!authorization?.method) throw inputError('Confirm sending with your current password.', 403);
  const requestedId = clean(body.CorrespondenceId || body.correspondenceId);
  let existing = requestedId
    ? await loadCorrespondence(env, requestedId, scope)
    : await saveDraft(env, user, body, scope);
  if (lower(existing.Status) === 'draft') {
    existing = (await issueCorrespondence(env, user, {
      ...body,
      CorrespondenceId: existing.CorrespondenceId || existing.__id
    }, scope, identity, authorization)).correspondence;
  }
  if (lower(existing.Status) === 'sent') {
    return {
      correspondence: existing,
      printable: await printableFor(env, user, identity, existing),
      alreadySent: true
    };
  }
  if (!['issued', 'sent'].includes(lower(existing.Status))) {
    throw inputError('Only issued correspondence can be sent.', 409);
  }
  const recipientEmail = normalizeEmail(body.RecipientEmail || body.recipientEmail || existing.RecipientEmail);
  if (!recipientEmail) throw inputError('A valid recipient email address is required.');
  const transition = await acquireTransition(env, existing.CorrespondenceId || existing.__id, 'send', user);
  if (!transition.acquired) {
    const latest = await loadCorrespondence(env, existing.CorrespondenceId || existing.__id, scope);
    if (lower(latest.Status) === 'sent') {
      return {
        correspondence: latest,
        printable: await printableFor(env, user, identity, latest),
        alreadySent: true
      };
    }
    if (lower(transition.document.Status) === 'completed') {
      const sentAt = clean(transition.document.SentAt || transition.document.CompletedAt) || nowIso();
      const repaired = {
        ...latest,
        RecipientEmail: clean(transition.document.RecipientEmail) || recipientEmail,
        Status: 'Sent',
        DeliveryStatus: 'Sent',
        SentAt: sentAt,
        SentBy: clean(transition.document.SentBy),
        SentByUsername: clean(transition.document.SentByUsername),
        UpdatedAt: sentAt
      };
      delete repaired.__id;
      delete repaired.__name;
      await upsertDocument(env, CORRESPONDENCE_COLLECTION, safeId(repaired.CorrespondenceId), repaired);
      return {
        correspondence: repaired,
        printable: await printableFor(env, user, identity, repaired),
        alreadySent: true
      };
    }
    throw inputError('This correspondence is already being sent. Refresh before trying again.', 409);
  }
  const printable = await printableFor(env, user, identity, existing);
  try {
    await sendConfiguredEmail(env, {
      toEmail: recipientEmail,
      toName: existing.RecipientName,
      subject: printable.subject,
      textContent: printable.fullText || printable.text,
      htmlContent: printable.emailHtml || printable.html,
      attachments: printable.emailAttachments
    });
  } catch (error) {
    const failedAt = nowIso();
    const failed = {
      ...existing,
      RecipientEmail: recipientEmail,
      DeliveryStatus: 'Failed',
      LastDeliveryAttemptAt: failedAt,
      UpdatedAt: failedAt
    };
    delete failed.__id;
    delete failed.__name;
    await upsertDocument(env, CORRESPONDENCE_COLLECTION, safeId(failed.CorrespondenceId), failed);
    await writeAudit(env, user, scope, 'SEND FAILED', {
      CorrespondenceId: failed.CorrespondenceId,
      AuthMethod: authorization.method,
      DeliveryStatus: 'Failed',
      SourcePlatform: authorization.sourcePlatform
    });
    await abandonTransition(env, transition);
    throw error;
  }
  const sentAt = nowIso();
  const sent = {
    ...existing,
    RecipientEmail: recipientEmail,
    Status: 'Sent',
    DeliveryStatus: 'Sent',
    SentAt: sentAt,
    SentBy: clean(user.displayName || user.username),
    SentByUsername: clean(user.username),
    UpdatedAt: sentAt,
    UpdatedBy: clean(user.displayName || user.username),
    AuthorizationMethod: authorization.method
  };
  delete sent.__id;
  delete sent.__name;
  // Record provider acceptance before updating the main row. If the following
  // write is interrupted, a retry repairs the row without sending a second email.
  await completeTransition(env, transition, {
    CorrespondenceId: sent.CorrespondenceId,
    RecipientEmail: recipientEmail,
    SentAt: sentAt,
    SentBy: sent.SentBy,
    SentByUsername: sent.SentByUsername,
    CompletedAt: sentAt
  });
  await upsertDocument(env, CORRESPONDENCE_COLLECTION, safeId(sent.CorrespondenceId), sent);
  await writeAudit(env, user, scope, 'SEND', {
    CorrespondenceId: sent.CorrespondenceId,
    AuthMethod: authorization.method,
    DeliveryStatus: 'Sent',
    SourcePlatform: authorization.sourcePlatform
  });
  return { correspondence: sent, printable };
}

async function bootstrap(env, user, scope, capabilities, identity) {
  const [customTemplates, correspondence, classes, metricIds, approvalProfile] = await Promise.all([
    loadCustomTemplates(env, scope),
    loadScopedCorrespondence(env, scope),
    scope.edition === 'school' ? listCollection(env, 'settings/academics/classes') : [],
    loadMetricPreferences(env, user, scope),
    loadStaffApprovalProfile(env, user.username).catch(() => null)
  ]);
  const availableTypes = requestedSearchTypes({}, capabilities).available;
  return {
    ok: true,
    message: 'Executive Office loaded.',
    edition: scope.edition,
    scope,
    capabilities,
    identity: {
      Name: identity.Name,
      Code: identity.Code,
      Address: identity.Address,
      Email: identity.Email,
      Phone: identity.Phone,
      HasLogo: Boolean(identity.LogoDataUrl || identity.LogoUrl)
    },
    kinds: availableKinds(scope.edition),
    availableTypes,
    tokens: EXECUTIVE_TEMPLATE_TOKENS,
    templates: [...builtInTemplates(scope.edition), ...customTemplates.map(publicTemplate)],
    correspondence: correspondence.slice(0, 150).map((row) => publicCorrespondence(row, true)),
    classes: classes.filter((row) => active(row.Active)).map((row) => ({
      id: clean(row.__id || row.ClassName),
      name: clean(row.ClassName || row.__id),
      arms: clean(row.Arms)
    })),
    approvalProfile: publicStaffApprovalProfile(approvalProfile || {}),
    metricPreferences: metricIds,
    availableMetrics: metricDefinitions(scope.edition),
    metrics: await metricData(env, scope, metricIds, correspondence)
  };
}

export async function handleExecutiveOfficeAction(env, user, body = {}, options = {}) {
  const identity = await loadIdentity(env);
  if (identity.FeatureFlags?.executiveOffice === false) {
    throw inputError('The Executive Office feature is disabled for this subscription.', 403);
  }
  const capabilities = assertExecutiveAccess(user, identity.Edition);
  const scope = requestedScope(user, body, identity.Edition);
  const action = lower(body.action || body.Action || 'bootstrap');
  if (action === 'bootstrap') return bootstrap(env, user, scope, capabilities, identity);
  if (action === 'search') {
    const directory = await searchDirectory(env, body, capabilities, scope);
    await writeAudit(env, user, scope, 'DIRECTORY SEARCH', {
      SearchType: clean(body.type || body.targetType || directory.availableTypes.join(',')),
      ResultCount: directory.results.length,
      SourcePlatform: options.sourcePlatform
    });
    return { ok: true, message: `${directory.results.length} matching record${directory.results.length === 1 ? '' : 's'} found.`, ...directory };
  }
  if (action === 'list') {
    const [templates, correspondence] = await Promise.all([
      loadCustomTemplates(env, scope),
      loadScopedCorrespondence(env, scope)
    ]);
    return {
      ok: true,
      message: 'Executive correspondence loaded.',
      templates: [...builtInTemplates(scope.edition), ...templates.map(publicTemplate)],
      correspondence: correspondence.slice(0, 150).map((row) => publicCorrespondence(row, true))
    };
  }
  if (action === 'savedraft') {
    const draft = await saveDraft(env, user, body, scope);
    return { ok: true, message: 'Official correspondence draft saved.', correspondence: publicCorrespondence(draft) };
  }
  if (action === 'savetemplate') {
    const requestedId = clean(body.TemplateId || body.templateId);
    let existing = null;
    if (requestedId && !lower(requestedId).startsWith('builtin-')) {
      existing = await getDocument(env, TEMPLATE_COLLECTION, safeId(requestedId)).catch(() => null);
    }
    existing = validateTemplateWriteTarget(requestedId, existing, scope);
    const template = normalizeTemplate(body, {
      existing, edition: scope.edition, branchId: scope.branchId,
      schoolSection: scope.schoolSection, actor: clean(user.displayName || user.username)
    });
    await upsertDocument(env, TEMPLATE_COLLECTION, safeId(template.TemplateId), template);
    await writeAudit(env, user, scope, existing ? 'UPDATE TEMPLATE' : 'CREATE TEMPLATE', {
      TemplateId: template.TemplateId,
      SourcePlatform: options.sourcePlatform
    });
    return { ok: true, message: 'Official correspondence template saved.', template: publicTemplate(template) };
  }
  if (action === 'document') {
    const correspondence = await loadCorrespondence(env, body.CorrespondenceId || body.correspondenceId, scope);
    const printable = await printableFor(env, user, identity, correspondence);
    await writeAudit(env, user, scope, 'VIEW DOCUMENT', {
      CorrespondenceId: correspondence.CorrespondenceId || correspondence.__id,
      SourcePlatform: options.sourcePlatform
    });
    return { ok: true, message: 'Printable official document prepared.', correspondence: publicCorrespondence(correspondence), printable };
  }
  if (action === 'issue') {
    const result = await issueCorrespondence(env, user, body, scope, identity, options.authorization);
    return {
      ok: true,
      message: result.alreadyIssued
        ? 'Official correspondence was already issued; the existing document was returned.'
        : 'Official correspondence issued.',
      alreadyIssued: Boolean(result.alreadyIssued),
      correspondence: publicCorrespondence(result.correspondence),
      printable: result.printable
    };
  }
  if (action === 'send') {
    const result = await sendCorrespondence(env, user, body, scope, identity, options.authorization);
    return {
      ok: true,
      message: result.alreadySent
        ? 'Official correspondence was already sent; no duplicate email was sent.'
        : 'Official correspondence sent.',
      alreadySent: Boolean(result.alreadySent),
      correspondence: publicCorrespondence(result.correspondence),
      printable: result.printable
    };
  }
  if (action === 'savepreferences') {
    const metricIds = await saveMetricPreferences(env, user, scope, body.metricIds || body.MetricIds);
    await writeAudit(env, user, scope, 'SAVE DASHBOARD PREFERENCES', {
      ResultCount: metricIds.length,
      SourcePlatform: options.sourcePlatform
    });
    return {
      ok: true,
      message: 'Executive dashboard preferences saved.',
      metricPreferences: metricIds,
      availableMetrics: metricDefinitions(scope.edition),
      metrics: await metricData(env, scope, metricIds)
    };
  }
  throw inputError('Choose a valid Executive Office action.');
}
