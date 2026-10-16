import { listCollectionPage, queryCollection } from './firestore.js';
import { feeCollectionScope } from './fee-collection-summary.js';
import { loadBranchFinancePage } from './finance-branch-reads.js';
import { recordBranchId } from './branch-scope.js';
import { feeBranchId } from './fee-branch-scope.js';

const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const pick = (row, key) => row[key] ?? row[key[0].toLowerCase() + key.slice(1)];
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const club = row => lower(pick(row, 'FeeCategory')) === 'club' || /^CLUB[_-]/i.test(clean(pick(row, 'FeeCode')));
function visible(row, scope, catalogue = false) {
  const branch = catalogue ? feeBranchId(row) : recordBranchId(row);
  const section = lower(pick(row, 'SchoolSection'));
  return (scope.branchId === 'all' || branch === scope.branchId)
    && (scope.schoolSection === 'all' || section === scope.schoolSection || (catalogue && (!section || section === 'all')));
}
function confirmed(row) {
  return ['paid', 'completed', 'success', 'successful', 'settled'].includes(lower(pick(row, 'Status') || 'Paid'))
    && ['', 'completed'].includes(lower(pick(row, 'ProcessingStatus')));
}
function cents(value) {
  const text = clean(value ?? 0).replace(/,/g, '');
  const amount = /^\d+(\.\d+)?$/.test(text) ? Math.round(Number(text) * 100) : NaN;
  if (!Number.isSafeInteger(amount) || amount < 0) {
    fail('A club receipt has an invalid payment or correction amount. Accounts review is required.', 409);
  }
  return amount;
}

export function clubMemberReceipts(documents, scope, catalogue = []) {
  const warnings = { missingIdentity: 0, missingPeriod: 0, unfinished: 0 };
  const rows = [];
  for (const row of documents) {
    if (!visible(row, scope)) continue;
    const code = clean(pick(row, 'FeeCode'));
    const definitions = catalogue.filter(fee => visible(fee, { ...scope, branchId: recordBranchId(row) }, true)
      && lower(pick(fee, 'FeeCode')) === lower(code) && club(fee));
    if (!club(row) && !definitions.length) continue;
    if (!confirmed(row)) { warnings.unfinished++; continue; }
    const amount = cents(pick(row, 'Amount'));
    const correction = cents(pick(row, 'CorrectionTotal') || 0);
    if (correction > amount) {
      fail('A club receipt has an invalid payment or correction amount. Accounts review is required.', 409);
    }
    if (amount - correction <= 0) continue;
    const currency = clean(pick(row, 'Currency') || 'NGN').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) fail('A club receipt has an invalid currency. Accounts review is required.', 409);
    const session = clean(pick(row, 'AcademicSession')), term = clean(pick(row, 'Term'));
    if (scope.academicSession && lower(session) !== lower(scope.academicSession)) continue;
    if (scope.term && lower(term) !== lower(scope.term)) continue;
    const student = clean(pick(row, 'AdmissionNo') || pick(row, 'AccountRef'));
    if (!student) { warnings.missingIdentity++; continue; }
    if (!session || !term) warnings.missingPeriod++;
    rows.push({ id: row.__id || clean(pick(row, 'Reference') || pick(row, 'PaymentId')),
      student, name: clean(pick(row, 'DisplayName') || pick(row, 'StudentName')) || 'Name not recorded',
      className: clean(pick(row, 'ClassName')) || 'Not recorded', code,
      club: clean(pick(row, 'FeeName') || definitions[0]?.FeeName || code) || 'Unnamed club',
      session, term, branch: recordBranchId(row), section: lower(pick(row, 'SchoolSection')),
      paidCents: amount - correction, currency,
      paidAt: clean(pick(row, 'PaidAt') || pick(row, 'Date')) });
  }
  return { rows, warnings };
}

export async function getClubMembersPage(env, user, body = {}, io = { list: listCollectionPage, query: queryCollection }) {
  const { dateFrom, dateTo, ...access } = feeCollectionScope(user, { ...body, dateFrom: '1900-01-01', dateTo: '9999-12-31' });
  if (access.edition !== 'school') fail('Club membership is available in the school edition.', 403);
  const scope = { ...access, academicSession: clean(body.academicSession), term: clean(body.term) };
  if (scope.academicSession.length > 80 || scope.term.length > 80) fail('Invalid academic period.');
  const pageToken = clean(body.pageToken), readTime = clean(body.readTime) || new Date().toISOString();
  const age = Date.now() - Date.parse(readTime);
  if (pageToken.length > 8192 || (!body.readTime && pageToken) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(readTime)
    || !Number.isFinite(age) || age < -5000 || age > 50 * 60 * 1000) fail('The register snapshot expired or is missing. Load it again.');
  const page = await loadBranchFinancePage(env, 'payments', scope.branchId, { pageToken, readTime, pageSize: 250 },
    { listCollectionPage: io.list, queryCollection: io.query });
  // Historical receipts sometimes lack a category. Resolve those codes against
  // the catalogue at the same snapshot, without retrieving student profiles.
  const codes = [...new Set(page.documents.filter(row => visible(row, scope) && confirmed(row) && !club(row)
    && !clean(pick(row, 'FeeCategory'))).map(row => clean(pick(row, 'FeeCode'))).filter(Boolean))];
  const catalogue = [];
  for (let offset = 0; offset < codes.length; offset += 20) {
    const codeFilter = { field: 'FeeCode', op: 'in', value: codes.slice(offset, offset + 20) };
    const filters = ['main', 'all'].includes(scope.branchId) ? [[codeFilter]]
      : ['BranchId', 'branchId'].map(field => [codeFilter, { field, op: '==', value: scope.branchId }]);
    for (const filter of filters) {
      const fees = await io.query(env, 'feeItems', { filters: filter, filterJoin: 'AND', limit: 1001, readTime });
      if (fees.length >= 1001) fail('The club catalogue is too large to verify safely. Accounts review is required.', 409);
      catalogue.push(...fees);
    }
  }
  return { ok: true, ...clubMemberReceipts(page.documents, scope, catalogue), scope, readTime,
    scanned: page.documents.length, next: page.nextPageToken ? { pageToken: page.nextPageToken } : null, complete: !page.nextPageToken };
}
