import { canonicalSchoolBranchId, schoolSectionFor } from './school-scope.js';

const clean = (value) => String(value ?? '').trim();

// Profile editors save PascalCase fields. An obsolete import alias must not
// override a saved value (including a deliberate clearing of the field).
export function studentProfileValue(row, field, aliases = [], fallback = '') {
  if (Object.hasOwn(row || {}, field)) return clean(row[field]) || fallback;
  for (const alias of aliases) {
    if (clean(row?.[alias])) return clean(row[alias]);
  }
  return fallback;
}

export function studentBillingIdentity(row) {
  const path = clean(row.__scopePath);
  const scoped = /^schoolBranches\/([^/]+)\/sections\/(primary|secondary)\/students$/i.exec(path);
  const reference = studentProfileValue(row, 'AdmissionNo', ['admissionNo', 'AccountRef', 'accountRef', '__id']).toLowerCase();
  const branch = canonicalSchoolBranchId(scoped?.[1] || row.BranchId || row.branchId);
  const section = scoped?.[2]?.toLowerCase() || schoolSectionFor({
    ...row, ClassName: studentProfileValue(row, 'ClassName', ['className', 'ClassAdmitted', 'classAdmitted'])
  });
  return { reference, branch, section, key: JSON.stringify([branch, section, reference]) };
}

function rank(row) {
  const completed = clean(row.ProfileCompletionStatus || row.profileCompletionStatus).toLowerCase() === 'complete';
  const updated = Date.parse(row.UpdatedAt || row.updatedAt || row.ParentOnboardingProfileCompletedAt || '') || 0;
  const scoped = /^schoolBranches\//i.test(clean(row.__scopePath));
  return [Number(completed), updated, Number(scoped), clean(row.__scopePath), clean(row.__id)];
}

function isPreferred(candidate, current) {
  const left = rank(candidate), right = rank(current);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return false;
}

export function selectStudentBillingProfiles(rows = []) {
  const selected = new Map();
  for (const row of rows) {
    const identity = studentBillingIdentity(row);
    if (!identity.reference) continue;
    const current = selected.get(identity.key);
    if (!current || isPreferred(row, current)) selected.set(identity.key, row);
  }
  return [...selected.values()];
}

export function selectStudentBillingProfile(rows = [], requestedScope = {}) {
  const rawBranch = clean(requestedScope?.branchId || requestedScope?.BranchId);
  const branch = rawBranch && rawBranch.toLowerCase() !== 'all' ? canonicalSchoolBranchId(rawBranch) : '';
  const section = clean(requestedScope?.schoolSectionAccess || requestedScope?.SchoolSectionAccess || requestedScope?.section).toLowerCase();
  const selected = selectStudentBillingProfiles(rows).filter((row) => {
    const identity = studentBillingIdentity(row);
    return (!branch || identity.branch === branch) && (!['primary', 'secondary'].includes(section) || identity.section === section);
  });
  if (selected.length > 1) {
    const error = new Error('This student reference is ambiguous across school scopes. Select the branch and section before billing.');
    error.status = 409;
    throw error;
  }
  return selected[0] || null;
}
