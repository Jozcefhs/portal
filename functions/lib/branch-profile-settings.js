import { deleteDocument, getDocument, upsertDocument } from './firestore.js';
import { getSchoolStructure, safeScopeId } from './school-scope.js';

const clean = (value) => String(value ?? '').trim();

export const BRANCH_PROFILE_OVERRIDE_COLLECTION = 'branchProfileOverrides';

// Only presentation, communication and branch-operating fields may diverge.
// Infrastructure, credentials, branding, subscription and organisation identity
// remain organisation-wide by design.
export const BRANCH_PROFILE_OVERRIDE_FIELDS = Object.freeze([
  'SchoolName',
  'SchoolCode',
  'SchoolAddress',
  'SchoolPhone',
  'SchoolEmail',
  'SchoolSignatoryName',
  'SchoolSignatoryTitle',
  'ResultSignatoryName',
  'ResultSignatoryTitle',
  'OfferSignatoryName',
  'OfferSignatoryTitle',
  'AdmissionSignatoryName',
  'AdmissionSignatoryTitle',
  'EmailGreetingTemplate',
  'PortalHeadline',
  'PortalSubheading',
  'PortalNotice',
  'CurrentAcademicSession',
  'CurrentTerm',
  'DeclarationStatement',
  'ResultDisplayMode',
  'ShowResultsOnline',
  'OnlinePaymentEnabled',
  'DirectBankTransferEnabled',
  'PaymentBankName',
  'PaymentAccountName',
  'PaymentAccountNumber',
  'PaymentBankCurrency',
  'PaymentTransferInstructions'
]);

const FIELD_SET = new Set(BRANCH_PROFILE_OVERRIDE_FIELDS);

function profileObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizedValue(field, value) {
  if (field === 'OnlinePaymentEnabled' || field === 'DirectBankTransferEnabled') {
    return ['YES', 'NO'].includes(clean(value).toUpperCase()) ? clean(value).toUpperCase() : 'NO';
  }
  if (field === 'ShowResultsOnline') {
    return ['YES', 'NO'].includes(clean(value).toUpperCase()) ? clean(value).toUpperCase() : 'NO';
  }
  if (field === 'ResultDisplayMode') {
    const normalized = clean(value).toLowerCase();
    return ['subjects', 'percentage'].includes(normalized) ? normalized : 'subjects';
  }
  return clean(value);
}

export function branchProfileDefaults(profile = {}) {
  const source = profileObject(profile);
  return Object.fromEntries(BRANCH_PROFILE_OVERRIDE_FIELDS.map((field) => [
    field,
    normalizedValue(field, source[field])
  ]));
}

export function deriveBranchProfileOverrides(defaultProfile = {}, submittedProfile = {}) {
  const defaults = branchProfileDefaults(defaultProfile);
  const values = {};
  BRANCH_PROFILE_OVERRIDE_FIELDS.forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(submittedProfile, field)) return;
    const submitted = normalizedValue(field, submittedProfile[field]);
    if (submitted !== defaults[field]) values[field] = submitted;
  });
  return values;
}

function overrideValues(document = {}) {
  const rawValues = document?.Values && typeof document.Values === 'object' ? document.Values : {};
  const declaredFields = Array.isArray(document?.OverrideFields)
    ? document.OverrideFields.filter((field) => FIELD_SET.has(field))
    : Object.keys(rawValues).filter((field) => FIELD_SET.has(field));
  return Object.fromEntries(declaredFields
    .filter((field) => Object.prototype.hasOwnProperty.call(rawValues, field))
    .map((field) => [field, normalizedValue(field, rawValues[field])]));
}

export function applyBranchProfileOverrides(defaultProfile = {}, document = null, branchId = '') {
  const defaults = profileObject(defaultProfile);
  const normalizedBranchId = clean(branchId) ? safeScopeId(branchId) : '';
  const values = normalizedBranchId ? overrideValues(document || {}) : {};
  const fields = Object.keys(values);
  return {
    ...defaults,
    ...values,
    SettingsScope: normalizedBranchId ? 'branch' : 'organisation',
    EffectiveBranchId: normalizedBranchId,
    BranchOverrideFields: fields,
    BranchOverrideValues: values,
    OrganisationDefaults: branchProfileDefaults(defaults)
  };
}

export async function assertConfiguredProfileBranch(env, branchId) {
  const normalizedBranchId = clean(branchId) ? safeScopeId(branchId) : '';
  if (!normalizedBranchId) {
    const error = new Error('Select a branch before editing branch settings.');
    error.status = 400;
    throw error;
  }
  const structure = await getSchoolStructure(env);
  const branch = (structure.Branches || []).find((row) => safeScopeId(row.Id || row.Name) === normalizedBranchId);
  if (!branch) {
    const error = new Error('The selected branch is not configured for this organisation.');
    error.status = 404;
    throw error;
  }
  return { id: normalizedBranchId, name: clean(branch.Name || branch.Id), structure };
}

export async function loadBranchProfileOverride(env, branchId) {
  const normalizedBranchId = clean(branchId) ? safeScopeId(branchId) : '';
  if (!normalizedBranchId) return null;
  return getDocument(env, BRANCH_PROFILE_OVERRIDE_COLLECTION, normalizedBranchId).catch(() => null);
}

export async function effectiveBranchProfile(env, defaultProfile = {}, branchId = '') {
  const normalizedBranchId = clean(branchId) ? safeScopeId(branchId) : '';
  if (!normalizedBranchId) return applyBranchProfileOverrides(defaultProfile);
  const document = await loadBranchProfileOverride(env, normalizedBranchId);
  return applyBranchProfileOverrides(defaultProfile, document, normalizedBranchId);
}

export async function saveBranchProfileOverrides(env, {
  branchId,
  defaultProfile = {},
  submittedProfile = {},
  updatedBy = 'Administrator'
} = {}) {
  const branch = await assertConfiguredProfileBranch(env, branchId);
  const values = deriveBranchProfileOverrides(defaultProfile, submittedProfile);
  const fields = Object.keys(values);
  if (!fields.length) {
    const existing = await loadBranchProfileOverride(env, branch.id);
    if (existing) await deleteDocument(env, BRANCH_PROFILE_OVERRIDE_COLLECTION, branch.id);
    return { branch, values: {}, fields: [], deleted: Boolean(existing) };
  }
  await upsertDocument(env, BRANCH_PROFILE_OVERRIDE_COLLECTION, branch.id, {
    BranchId: branch.id,
    BranchName: branch.name,
    OverrideFields: fields,
    Values: values,
    UpdatedAt: new Date().toISOString(),
    UpdatedBy: clean(updatedBy) || 'Administrator'
  });
  return { branch, values, fields, deleted: false };
}

export async function resetBranchProfileOverrides(env, branchId) {
  const branch = await assertConfiguredProfileBranch(env, branchId);
  const existing = await loadBranchProfileOverride(env, branch.id);
  if (existing) await deleteDocument(env, BRANCH_PROFILE_OVERRIDE_COLLECTION, branch.id);
  return { branch, deleted: Boolean(existing) };
}
