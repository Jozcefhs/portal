import { getDocument, queryCollection, queryCollectionPages } from './firestore.js';
import { canonicalSchoolBranchId, schoolSectionFor } from './school-scope.js';
import { feeDueDate, invoiceIsDue } from './account-credit.js';

const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const referenceKey = value => lower(value).replace(/[^a-z0-9]/g, '');
const identityReferenceKey = value => lower(value).split(/[^a-z0-9]+/).filter(Boolean).join('|');
const money = value => Math.round(Number(value || 0) * 100) / 100;
const accountReferences = row => [row.AccountRef, row.AdmissionNo, row.ApplicationReference,
  ...(Array.isArray(row.LinkedReferences) ? row.LinkedReferences : [])].map(clean).filter(Boolean);
const fail = message => Object.assign(new Error(message), { status: 409, code: 'SCHOOL_FEE_CREDIT_SCOPE' });

// Call only with the server-resolved learner/intent identity. A display admission
// number alone is never enough to choose a branch or an account summary.
export function schoolFeeCreditScope(identity = {}) {
  const path = clean(identity.ScopePath || identity.StudentScopePath || identity.AccountScopePath || identity.__scopePath || identity.scopePath);
  const parsed = /^schoolBranches\/([^/]+)\/sections\/(primary|secondary)\/students$/i.exec(path);
  const rawBranch = clean(identity.BranchId || identity.branchId || parsed?.[1]);
  const rawSection = lower(identity.SchoolSection || identity.schoolSectionAccess || parsed?.[2]);
  const accountRef = clean(identity.AccountRef || identity.accountRef || identity.AdmissionNo);
  const studentDocumentId = clean(identity.StudentDocumentId || identity.studentDocumentId
    || (identity.SchoolFeeCreditManaged !== true ? identity.__id : ''));
  if (!rawBranch || !['primary', 'secondary'].includes(rawSection) || !referenceKey(accountRef)) {
    throw fail('The school-fee credit needs a verified learner, branch and school section.');
  }
  const branchId = canonicalSchoolBranchId(rawBranch);
  if ((path && !parsed && !(path === 'students' && branchId === 'main'))
    || (parsed && (canonicalSchoolBranchId(parsed[1]) !== branchId || lower(parsed[2]) !== rawSection))) {
    throw fail('The learner record path does not match the school-fee credit branch and section.');
  }
  const references = [...new Map([accountRef, ...accountReferences(identity),
    ...(Array.isArray(identity.references) ? identity.references : [])]
    .map(clean).filter(Boolean).map(value => [identityReferenceKey(value), value])).values()];
  if (references.length > 4 || references.some(value => !referenceKey(value) || value.length > 160)) {
    throw fail('The learner account references cannot be verified for school-fee credit.');
  }
  if (studentDocumentId.includes('/')) throw fail('The learner document identity is invalid.');
  return { branchId, schoolSectionAccess: rawSection, accountRef, references, scopePath: path, studentDocumentId,
    legacySectionVerified: identity.legacySectionVerified === true };
}

export function schoolFeeCreditSummaryId(accountRef, scope) {
  const verified = schoolFeeCreditScope({ ...scope, accountRef });
  // Hex preserves the complete normalised reference without separator collisions
  // or truncation. These IDs are distinct from legacy admission-only summaries.
  const encoded = [...new TextEncoder().encode(identityReferenceKey(accountRef))]
    .map(value => value.toString(16).padStart(2, '0')).join('');
  return `SFCR-${verified.branchId}-${verified.schoolSectionAccess}-${encoded}`;
}

export function schoolFeeCreditRowMatchesScope(row, scope) {
  if (!row) return false;
  const path = /^schoolBranches\/([^/]+)\/sections\/(primary|secondary)\//i.exec(clean(row.__scopePath));
  const branch = canonicalSchoolBranchId(path?.[1] || row.BranchId || row.branchId || 'main');
  if (branch !== scope.branchId) return false;
  if (path && clean(row.BranchId || row.branchId)
    && canonicalSchoolBranchId(row.BranchId || row.branchId) !== branch) throw fail('A financial record has conflicting branch ownership.');
  const explicitSection = lower(row.SchoolSection || row.schoolSection);
  if (explicitSection && !['primary', 'secondary'].includes(explicitSection)) throw fail('A financial record has an invalid school section.');
  if (path && explicitSection && lower(path[2]) !== explicitSection) throw fail('A financial record has conflicting school-section ownership.');
  const section = lower(path?.[2]) || (explicitSection || row.ClassName || row.ClassApplyingFor ? schoolSectionFor(row) : '');
  if (section && section !== scope.schoolSectionAccess) return false;
  if (!section && !scope.legacySectionVerified) {
    throw Object.assign(fail('A legacy financial record has no school section. Verify this account is unique within its branch before using its credit.'),
      { code: 'SCHOOL_FEE_CREDIT_SECTION_REQUIRED' });
  }
  const references = accountReferences(row);
  if (!references.length) throw fail('A financial record has no learner account reference.');
  if (references.some(value => !scope.references.some(allowed => identityReferenceKey(allowed) === identityReferenceKey(value)))) {
    throw fail('A financial record has conflicting learner account references.');
  }
  const recordPath = clean(row.StudentScopePath || row.AccountScopePath);
  if (recordPath && scope.scopePath && recordPath !== scope.scopePath) throw fail('A financial record belongs to another learner profile.');
  if (row.StudentDocumentId && scope.studentDocumentId && clean(row.StudentDocumentId) !== scope.studentDocumentId) throw fail('A financial record belongs to another learner document.');
  return true;
}

function accountQuery(scope) {
  return { filters: scope.references.flatMap(value => [
    { field: 'AccountRefNormalized', op: '==', value: referenceKey(value) },
    ...['AccountRef', 'AdmissionNo', 'ApplicationReference'].map(field => ({ field, op: '==', value }))
  ]), filterJoin: 'OR', pageSize: 500, maxRows: 20000 };
}

export async function readManagedSchoolFeeCreditSummary(env, identity, dependencies = {}, options = {}) {
  const db = { getDocument, ...dependencies };
  const scope = schoolFeeCreditScope(identity);
  const summaryId = schoolFeeCreditSummaryId(scope.accountRef, scope);
  const summary = Object.hasOwn(options, 'summary') ? options.summary
    : Array.isArray(options.summaries) ? options.summaries.find(row => clean(row.__id) === summaryId
      || clean(row.__name).endsWith(`/accountSummaries/${summaryId}`)) || null
      : await db.getDocument(env, 'accountSummaries', summaryId);
  if (summary && (!schoolFeeCreditRowMatchesScope(summary, scope) || summary.SchoolFeeCreditManaged !== true)) {
    throw fail('The school-fee credit summary belongs to another account or is not managed by this workflow.');
  }
  return { scope, summary: summary || null, summaryId };
}

export async function filterSchoolFeeCreditRows(env, scope, rows, dependencies = {}) {
  let verified = schoolFeeCreditScope(scope);
  try { return { rows: rows.filter(row => schoolFeeCreditRowMatchesScope(row, verified)), scope: verified }; }
  catch (error) {
    if (error.code !== 'SCHOOL_FEE_CREDIT_SECTION_REQUIRED') throw error;
    verified = await verifySchoolFeeCreditLegacySection(env, verified, dependencies);
    return { rows: rows.filter(row => schoolFeeCreditRowMatchesScope(row, verified)), scope: verified };
  }
}

export async function readSchoolFeeCreditHistory(env, scope, dependencies = {}, options = {}) {
  const db = { getDocument, queryCollectionPages, ...dependencies };
  let verified = schoolFeeCreditScope(scope);
  const collections = ['invoices', 'ledger', ...(options.payments ? ['payments'] : [])];
  const summaryId = schoolFeeCreditSummaryId(verified.accountRef, verified);
  const loaded = await Promise.all([
    ...collections.map(collection => db.queryCollectionPages(env, collection, accountQuery(verified))),
    Object.hasOwn(options, 'summary') ? Promise.resolve(options.summary) : db.getDocument(env, 'accountSummaries', summaryId)
  ]);
  const summary = loaded.pop();
  if (summary && (!schoolFeeCreditRowMatchesScope(summary, verified) || summary.SchoolFeeCreditManaged !== true)) {
    throw fail('The school-fee credit summary belongs to another account or is not managed by this workflow.');
  }
  const filtered = () => Object.fromEntries(collections.map((collection, index) => [collection,
    [...new Map(loaded[index].filter(row => schoolFeeCreditRowMatchesScope(row, verified))
      .map(row => [clean(row.__name || row.__id) || JSON.stringify(row), row])).values()]]));
  let history;
  try { history = filtered(); }
  catch (error) {
    if (error.code !== 'SCHOOL_FEE_CREDIT_SECTION_REQUIRED') throw error;
    verified = await verifySchoolFeeCreditLegacySection(env, verified, db);
    history = filtered();
  }
  return { ...history, summary, summaryId, scope: verified };
}

// Missing legacy section metadata can only be adopted after this bounded lookup
// proves that the reference identifies one learner profile in the whole branch.
// No organisation-wide student scan or foreign branch reads are needed.
export async function verifySchoolFeeCreditLegacySection(env, scope, dependencies = {}) {
  const db = { queryCollectionPages, ...dependencies };
  const paths = ['primary', 'secondary'].map(section => `schoolBranches/${scope.branchId}/sections/${section}/students`);
  if (scope.branchId === 'main') paths.push('students');
  const rows = (await Promise.all(paths.map(async path => (await db.queryCollectionPages(env, path, accountQuery(scope)))
    .map(row => ({ ...row, __scopePath: path }))))).flat();
  const found = new Map();
  for (const row of rows) {
    const path = /^schoolBranches\/([^/]+)\/sections\/(primary|secondary)\/students$/.exec(row.__scopePath);
    const branch = canonicalSchoolBranchId(path?.[1] || row.BranchId || 'main');
    if (branch !== scope.branchId) continue;
    if (path && row.BranchId && canonicalSchoolBranchId(row.BranchId) !== branch) throw fail('The learner profile has conflicting branch ownership.');
    const section = path?.[2] || schoolSectionFor(row);
    if (section !== scope.schoolSectionAccess) throw fail('This learner reference is shared across school sections; legacy credit needs finance review.');
    if (!schoolFeeCreditRowMatchesScope(row, { ...scope, legacySectionVerified: true })) throw fail('The learner profile does not match the verified credit account.');
    found.set(`${row.__scopePath}/${row.__id}`, row);
  }
  if (found.size !== 1 || (scope.scopePath && [...found.values()][0].__scopePath !== scope.scopePath)
    || (scope.studentDocumentId && clean([...found.values()][0].__id) !== scope.studentDocumentId)) {
    throw fail('This legacy learner account is missing or ambiguous; its credit has not been adopted.');
  }
  return { ...scope, legacySectionVerified: true };
}

export function schoolFeeCreditQueueFields(remaining, invoices = [], today, isSchoolFeeInvoice = () => true) {
  if (!Number.isFinite(Number(remaining)) || Number(remaining) < 0) throw fail('The remaining school-fee credit amount is invalid.');
  const pending = Math.max(0, money(remaining));
  const future = invoices.filter(row => isSchoolFeeInvoice(row)
    && money(row.Debit || row.Amount) > money(row.Credit) && !invoiceIsDue(row, today))
    .map(row => feeDueDate(row.DueDate)).filter(Boolean).sort();
  return { SchoolFeeCreditManaged: true, PendingSchoolFeeCredit: pending,
    NextSchoolFeeCreditDueDate: pending > 0 ? future[0] || '' : '' };
}

export function schoolFeeCreditSummaryWrite(scope, data, prior) {
  const verified = schoolFeeCreditScope(scope);
  if (prior && (!schoolFeeCreditRowMatchesScope(prior, verified) || prior.SchoolFeeCreditManaged !== true || !clean(prior.__updateTime))) {
    throw fail('The school-fee credit summary changed or has no verified revision. Reload before posting.');
  }
  return { collectionPath: 'accountSummaries', documentId: schoolFeeCreditSummaryId(verified.accountRef, verified),
    ...(prior ? { updateTime: prior.__updateTime } : { exists: false }),
    data: { ...data, AccountRef: verified.accountRef, AccountRefNormalized: referenceKey(verified.accountRef),
      BranchId: verified.branchId, SchoolSection: verified.schoolSectionAccess, AccountScopePath: verified.scopePath,
      StudentDocumentId: verified.studentDocumentId,
      LinkedReferences: verified.references.filter(value => identityReferenceKey(value) !== identityReferenceKey(verified.accountRef)),
      SchoolFeeCreditManaged: true } };
}

export function schoolFeeCreditSummaryChanged(prior, next) {
  if (!prior) return true;
  const fields = ['TotalDebit', 'TotalCredit', 'AccountCreditDebits', 'OutstandingBalance', 'CreditBalance',
    'WalletBalance', 'PendingSchoolFeeCredit'];
  return fields.some(field => money(prior[field]) !== money(next[field]))
    || clean(prior.NextSchoolFeeCreditDueDate) !== clean(next.NextSchoolFeeCreditDueDate)
    || Boolean(prior.SchoolFeeCreditReviewRequired) !== Boolean(next.SchoolFeeCreditReviewRequired)
    || clean(prior.SchoolFeeCreditReviewReason) !== clean(next.SchoolFeeCreditReviewReason);
}

// The caller persists/resumes nextCursor (or completes this bounded cycle).
// Pending balance is used rather than CreditBalance, which can be zero while
// due invoices still need their persisted allocation. Accounts without a future
// invoice remain eligible for the invoice-creation hook, without creating bills.
export async function listSchoolFeeCreditCandidates(env, options = {}, dependencies = {}) {
  const db = { queryCollection, ...dependencies };
  const limit = Math.max(1, Math.min(250, Math.floor(Number(options.limit) || 100)));
  const rows = await db.queryCollection(env, 'accountSummaries', {
    // This field is introduced only by the managed workflow. A single-field
    // indexed query also works before any composite-index rollout; still verify
    // the marker on every returned document before processing it.
    filters: [{ field: 'PendingSchoolFeeCredit', op: '>', value: 0 }],
    orderBy: [{ field: 'PendingSchoolFeeCredit' }, { field: '__name__' }], limit,
    ...(options.startAfterName ? { startAfterName: options.startAfterName, startAfterFieldValue: Number(options.startAfterFieldValue) } : {})
  });
  const last = rows.at(-1);
  if (rows.length === limit && (!clean(last?.__name) || !Number.isFinite(Number(last?.PendingSchoolFeeCredit)))) {
    throw fail('The school-fee credit queue could not be paginated safely.');
  }
  return { accounts: rows.filter(row => row.SchoolFeeCreditManaged === true), inspected: rows.length, done: rows.length < limit,
    nextCursor: rows.length === limit ? { startAfterName: last.__name, startAfterFieldValue: Number(last.PendingSchoolFeeCredit) } : null };
}
