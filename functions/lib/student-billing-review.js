import { getDocument, listCollectionForReport, queryCollectionPages } from './firestore.js';
import { schoolCollectionPaths, querySchoolCollection } from './school-scope.js';
import { selectStudentBillingProfiles, studentBillingIdentity, studentProfileValue } from './student-billing-profile.js';
import { withStudentDisplayName } from './student-display-name.js';
import { financialRowMatchesAccount, studentBillingReconciliationPlan } from '../api/backend.js';

const clean = (value) => String(value ?? '').trim();
const fields = ['AccountRef', 'AdmissionNo', 'ApplicationReference', 'accountRef', 'admissionNo', 'applicationReference'];
export const BILLING_REVIEW_BATCH_SIZE = 10;
const dependencies = { getDocument, listCollectionForReport, queryCollectionPages, schoolCollectionPaths,
  querySchoolCollection, studentBillingReconciliationPlan };
function fail(message, status = 409) { const error = new Error(message); error.status = status; throw error; }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
const scopeFor = (user) => ({ branchId: user.branchId, schoolSectionAccess: user.schoolSectionAccess });
function permitted(row, user) {
  const identity = studentBillingIdentity(row), section = clean(user.schoolSectionAccess).toLowerCase();
  return identity.branch === clean(user.branchId).toLowerCase() &&
    (!['primary', 'secondary'].includes(section) || identity.section === section);
}
function referenceFor(row) { return studentProfileValue(row, 'AdmissionNo', ['admissionNo', 'AccountRef', 'accountRef', '__id']); }
async function configuration(env, user, deps) {
  const [schoolProfile, allFees] = await Promise.all([
    deps.getDocument(env, 'settings', 'schoolProfile'), deps.listCollectionForReport(env, 'feeItems')
  ]);
  const feeItems = allFees.filter((row) => !clean(row.BranchId) || clean(row.BranchId).toLowerCase() === clean(user.branchId).toLowerCase());
  const signature = JSON.stringify(stable([scopeFor(user), schoolProfile,
    [...feeItems].sort((a, b) => clean(a.__name || a.__id).localeCompare(clean(b.__name || b.__id)))]));
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(signature));
  return { schoolProfile, feeItems, configurationToken: [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('') };
}

// Read the authorized roster once. Financial data is fetched only for each
// small batch below, never by downloading the school's entire invoice history.
export async function studentBillingReviewRoster(env, user, overrides = {}) {
  const deps = { ...dependencies, ...overrides };
  const paths = await deps.schoolCollectionPaths(env, 'students', scopeFor(user));
  const [groups, config] = await Promise.all([
    Promise.all(paths.map(async (path) => (await deps.listCollectionForReport(env, path)).map((row) => ({ ...row, __scopePath: path })))),
    configuration(env, user, deps)
  ]);
  const students = selectStudentBillingProfiles(groups.flat()).filter((row) => permitted(row, user));
  const counts = new Map();
  for (const row of students) { const ref = studentBillingIdentity(row).reference; counts.set(ref, (counts.get(ref) || 0) + 1); }
  const rows = [], pendingProfiles = [];
  let incomplete = 0;
  for (const raw of students) {
    const student = withStudentDisplayName(raw, config.schoolProfile), AccountRef = referenceFor(student);
    if (clean(student.ProfileCompletionStatus).toLowerCase() !== 'complete') { incomplete += 1; continue; }
    if (counts.get(studentBillingIdentity(student).reference) !== 1) {
      rows.push({ profile: { AccountRef, DisplayName: student.DisplayName }, ready: false,
        reason: 'Ambiguous admission number across school sections.', difference: 0 });
    } else pendingProfiles.push({ AccountRef, revision: clean(student.__updateTime) });
  }
  pendingProfiles.sort((a, b) => a.AccountRef.localeCompare(b.AccountRef));
  return { ok: true, readOnly: true, total: students.length, incomplete, matched: 0,
    ready: 0, review: rows.length, rows, pendingProfiles, configurationToken: config.configurationToken };
}

export async function studentBillingReviewBatch(env, user, body, overrides = {}) {
  const profiles = body.Profiles;
  if (!Array.isArray(profiles) || !profiles.length || profiles.length > BILLING_REVIEW_BATCH_SIZE ||
      profiles.some((row) => !clean(row?.AccountRef) || clean(row.AccountRef).length > 140 || typeof row.revision !== 'string') ||
      new Set(profiles.map((row) => clean(row.AccountRef).toLowerCase())).size !== profiles.length) {
    fail('Choose up to ten distinct student profiles for this read-only review.', 400);
  }
  const deps = { ...dependencies, ...overrides }, references = profiles.map((row) => clean(row.AccountRef));
  const limit = BILLING_REVIEW_BATCH_SIZE * 2 + 1;
  const [groups, config] = await Promise.all([
    Promise.all(['AdmissionNo', 'admissionNo', 'AccountRef', 'accountRef'].map((field) =>
      deps.querySchoolCollection(env, 'students', { scope: scopeFor(user), filters: [{ field, op: 'in', value: references }], limit }))),
    configuration(env, user, deps)
  ]);
  if (body.ConfigurationToken !== config.configurationToken) fail('Fee settings or the school period changed during the review. Run a fresh review; no financial records changed.');
  // A bounded profile query must not silently hide a duplicate identity.
  if (groups.some((group) => {
    const counts = new Map();
    for (const row of group) { const path = clean(row.__scopePath); counts.set(path, (counts.get(path) || 0) + 1); }
    return [...counts.values()].some((count) => count >= limit);
  })) fail('Too many copies of a student profile were found. Resolve the duplicate records before reviewing billing.');
  const candidates = selectStudentBillingProfiles(groups.flat()).filter((row) => permitted(row, user));
  const students = profiles.map((expected) => {
    const matches = candidates.filter((row) => studentBillingIdentity(row).reference === clean(expected.AccountRef).toLowerCase());
    if (matches.length !== 1 || clean(matches[0].__updateTime) !== expected.revision ||
        clean(matches[0].ProfileCompletionStatus).toLowerCase() !== 'complete') {
      fail('A student profile changed or became ambiguous during the review. Run a fresh review; no financial records changed.');
    }
    const student = withStudentDisplayName(matches[0], config.schoolProfile), identity = studentBillingIdentity(student);
    return { ...student, AccountRef: referenceFor(student), AdmissionNo: referenceFor(student), BranchId: identity.branch, SchoolSection: identity.section,
      ApplicationReference: clean(student.applicationReference || student.ApplicationReference) };
  });
  const financialReferences = [...new Set(students.flatMap((row) =>
    [row.AccountRef, row.AdmissionNo, row.ApplicationReference, row.ApplicationID, row.AdmissionNumber]).map(clean).filter(Boolean))];
  const financialGroups = { invoices: [], accountSummaries: [] };
  // Separate indexed IN queries avoid multiplying OR disjunctions. Await each
  // pair to bound concurrent Firestore reads, and retain pagination safety caps.
  for (let offset = 0; offset < financialReferences.length; offset += 10) {
    const values = financialReferences.slice(offset, offset + 10);
    for (const field of fields) {
      await Promise.all(Object.keys(financialGroups).map(async (collection) => {
        const rows = await deps.queryCollectionPages(env, collection, {
          filters: [{ field, op: 'in', value: values }], pageSize: 250, maxRows: 2000
        });
        financialGroups[collection].push(...rows);
      }));
    }
  }
  for (const collection of Object.keys(financialGroups)) {
    financialGroups[collection] = [...new Map(financialGroups[collection].map((row) => [row.__name || row.__id || JSON.stringify(row), row])).values()];
  }
  let matched = 0;
  const rows = [];
  for (const student of students) {
    const matches = (row) => financialRowMatchesAccount({ ...row, AccountRef: row.AccountRef || row.accountRef,
      AdmissionNo: row.AdmissionNo || row.admissionNo, ApplicationReference: row.ApplicationReference || row.applicationReference }, student) &&
      clean(row.BranchId || 'main').toLowerCase() === student.BranchId &&
      (!clean(row.SchoolSection || row.schoolSection) || clean(row.SchoolSection || row.schoolSection).toLowerCase() === student.SchoolSection);
    const plan = await deps.studentBillingReconciliationPlan(student, { ...config,
      invoices: financialGroups.invoices.filter(matches), accountSummaries: financialGroups.accountSummaries.filter(matches), payments: [], ledger: [] });
    if (plan.rows.every((row) => Math.abs(row.difference) < 0.005 && row.invoiceIds.length <= 1)) matched += 1;
    else rows.push(plan);
  }
  return { ok: true, readOnly: true, checked: profiles.length, matched, rows,
    ready: rows.filter((row) => row.ready).length, review: rows.filter((row) => !row.ready).length };
}
