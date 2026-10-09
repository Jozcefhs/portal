import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { getAccountSnapshot, getAccountsOverview, financialRowMatchesAccount, enforceDesktopDeviceActionScope } from '../functions/api/backend.js';

const source = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const student = { AdmissionNo: 'DCA/26/001', AccountRef: 'DCA/26/001', DisplayName: 'Test Student',
  ClassName: 'Grade 7', BranchId: 'main', SchoolSection: 'secondary', AcademicSession: '2026/2027',
  Term: 'First Term', ApplicationReference: 'APP-1', EnrollmentCategory: 'Returning' };
const data = { schoolProfile: { CurrentAcademicSession: '2026/2027', CurrentTerm: 'First Term' },
  feeItems: [], invoices: [{ InvoiceId: 'INV-1', AccountRef: student.AccountRef, AcademicSession: '2026/2027',
    Term: 'First Term', FeeCode: 'TUITION', FeeCategory: 'School Fee', Amount: 100, Credit: 100 }],
  payments: [], ledger: [{ AccountRef: student.AccountRef, FeeCategory: 'Wallet', EntryType: 'Wallet Top-up', Credit: 2000 },
    { AccountRef: student.AccountRef, Reference: 'PAY-1', FeeCategory: 'School Fee', EntryType: 'Payment', Credit: 100,
      AcademicSession: '2026/2027', Term: 'First Term' }],
  accountSummaries: [] };

function snapshotHandler(overrides = {}) {
  const calls = [];
  const fn = source.slice(source.indexOf('export async function getAccountSnapshot'),
    source.indexOf('export async function getStudentBillingPreview')).replace('export ', '');
  return { calls, handler: vm.runInNewContext(`(${fn})`, {
    clean, lower, sameText: (a, b) => lower(a) === lower(b), sameReferenceIdentity: (a, b) => lower(a) === lower(b),
    referenceIdentityKey: lower, timestampMs: value => Date.parse(value || '') || 0,
    canonicalSchoolBranchId: value => lower(value || 'main'),
    safeDocumentId: value => clean(value).replaceAll('/', '-'),
    requestedStudentScope: body => ({ branchId: body.UserBranchId || body.BranchId,
      schoolSectionAccess: body.UserSchoolSectionAccess || body.SchoolSection }),
    identityRecordBranch: row => lower(row.BranchId || 'main'),
    identityRecordSection: row => lower(row.SchoolSection || 'secondary'),
    requireAccountingRole: () => {},
    findStudentByAccountRef: async (_env, ref, scope) => {
      calls.push({ operation: 'student', ref, scope });
      return student;
    },
    querySchoolCollection: async (_env, collection, options) => { calls.push({ operation: collection, options }); return []; },
    getStudentBillingData: async (_env, identity, options) => { calls.push({ operation: 'finance', identity, options }); return data; },
    getDocument: async (_env, collection, id) => { calls.push({ operation: collection, id }); return null; },
    getAccountsOverview, ...overrides
  }) };
}

test('targeted snapshot uses the existing overview calculation without querying the entire school', async () => {
  const { handler, calls } = snapshotHandler();
  const result = await handler({}, { AccountRef: student.AccountRef, BranchId: 'main', UserSchoolSectionAccess: 'All', SchoolSection: 'secondary' });
  const overview = await getAccountsOverview({}, { ...data, students: [student], applications: [], accounts: [], billingCategories: [] }, { BranchId: 'main' });
  assert.deepEqual(JSON.parse(JSON.stringify(result.accounts)), overview.accounts);
  assert.equal(result.accounts[0].Balance, 0);
  assert.equal(result.accounts[0].WalletBalance, 2000);
  assert.equal(result.readOnly, true);
  assert.equal(result.requestedAccountRef, student.AccountRef);
  assert.ok(calls.every(call => !['payments', 'invoices', 'ledger', 'students'].includes(call.operation)));
  assert.equal(calls.find(call => call.operation === 'student').scope.schoolSectionAccess, 'secondary');
  assert.equal(calls.find(call => call.operation === 'finance').options.includeLinkedApplication, true);
});

test('posted section cannot broaden authoritative staff section access', async () => {
  const { handler, calls } = snapshotHandler();
  await handler({}, { AccountRef: student.AccountRef, BranchId: 'annex', UserBranchId: 'main',
    UserSchoolSectionAccess: 'secondary', SchoolSection: 'primary' });
  assert.equal(calls.find(call => call.operation === 'student').scope.branchId, 'main');
  assert.equal(calls.find(call => call.operation === 'student').scope.schoolSectionAccess, 'secondary');
});

test('targeted finance refresh retains the current student card, not a stale accounting card', async () => {
  const { handler } = snapshotHandler({
    findStudentByAccountRef: async () => ({ ...student,
      WalletCardId: '0371312330', WalletCardStatus: 'Blocked', WalletPinHash: 'not-for-account-search'
    }),
    getDocument: async () => ({ AccountRef: student.AccountRef, BranchId: 'main', SchoolSection: 'secondary',
      WalletCardId: 'OLD-CARD', walletCardId: 'OLDER-CARD', WalletCardStatus: 'Active'
    })
  });
  const result = await handler({}, { AccountRef: student.AccountRef, BranchId: 'main', SchoolSection: 'secondary' });
  assert.equal(result.accounts[0].WalletCardId, '0371312330');
  assert.equal(result.accounts[0].WalletCardStatus, 'Blocked');
  assert.equal(result.accounts[0].walletCardId, undefined);
  assert.equal(result.accounts[0].WalletPinHash, undefined);
  assert.equal(result.accounts[0].WalletBalance, 2000);
  assert.equal(result.readOnly, true);
});

test('unresolved identity fails before any financial reads', async () => {
  const { handler, calls } = snapshotHandler({ findStudentByAccountRef: async () => null });
  await assert.rejects(handler({}, { AccountRef: student.AccountRef, BranchId: 'main' }), error => error.status === 404);
  assert.equal(calls.filter(call => call.operation === 'finance').length, 0);
});

test('legacy and scoped application copies are deduplicated, not rejected as different accounts', async () => {
  const app = { ApplicationReference: 'APP-1', AdmissionNo: student.AdmissionNo,
    BranchId: 'main', SchoolSection: 'secondary', UpdatedAt: '2026-10-06T00:00:00Z' };
  const { handler } = snapshotHandler({ querySchoolCollection: async () => [
    { ...app, __scopePath: 'applications' },
    { ...app, __scopePath: 'schoolBranches/main/sections/secondary/applications' }
  ] });
  const result = await handler({}, { AccountRef: student.AccountRef, BranchId: 'main', SchoolSection: 'secondary' });
  assert.equal(result.accounts.length, 1);
  assert.equal(result.accounts[0].AccountRef, student.AccountRef);
});

test('resolved identity is independently checked against authorized scope before finance reads', async () => {
  const { handler, calls } = snapshotHandler({ findStudentByAccountRef: async () => ({ ...student, BranchId: 'annex' }) });
  await assert.rejects(handler({}, { AccountRef: student.AccountRef, UserBranchId: 'main' }), error => error.status === 404);
  assert.equal(calls.filter(call => call.operation === 'finance').length, 0);
});

test('snapshot endpoint rejects non-finance roles before touching Firestore', async () => {
  await assert.rejects(getAccountSnapshot({}, { AccountRef: student.AccountRef, UserRole: 'Subject Teacher' }), error => error.status === 403);
  await assert.rejects(getAccountSnapshot({}, { UserRole: 'Accounts Officer' }), error => error.status === 400);
  assert.doesNotThrow(() => enforceDesktopDeviceActionScope({ type: 'device', branchId: 'main' }, 'getAccountSnapshot', {}));
  const actorActions = source.slice(source.indexOf('const VERIFIED_ACTOR_ACTIONS'), source.indexOf('const BRANCH_BOUND_DEVICE_ACTIONS'));
  assert.match(actorActions, /'getAccountSnapshot'/);
  assert.match(source, /case 'getAccountSnapshot':\s+return getAccountSnapshot\(env, body\)/);
});

function billingLoader(failCollection = '') {
  const calls = [];
  const fn = source.slice(source.indexOf('export async function getStudentBillingData'), source.indexOf('// A read-only, bounded replacement')).replace('export ', '');
  const rows = [
    { __id: 'ours', AccountRef: student.AccountRef, BranchId: 'main', SchoolSection: 'secondary' },
    { __id: 'other-branch', AccountRef: student.AccountRef, BranchId: 'annex' },
    { __id: 'other-section', AccountRef: student.AccountRef, SchoolSection: 'primary' },
    { __id: 'sibling', AccountRef: 'DCA/26/002', ApplicationReference: 'APP-1' },
    { __id: 'linked', AccountRef: 'APP-1' },
    { __id: 'linked-sibling', AccountRef: 'APP-1', AdmissionNo: 'DCA/26/002' }
  ];
  return { calls, loader: vm.runInNewContext(`(${fn})`, {
    clean, sameText: (a, b) => lower(a) === lower(b), sameReferenceIdentity: (a, b) => Boolean(a && b && lower(a) === lower(b)),
    normalizeStudent: row => row,
    accountRefsFrom: row => [row.AccountRef, row.AdmissionNo, row.ApplicationReference],
    canonicalSchoolBranchId: value => lower(value || 'main'), financialRowMatchesAccount,
    queryCollectionPages: async (_env, collection, options) => {
      calls.push({ collection, options });
      if (collection === failCollection) throw new Error('Read failed; no partial result');
      return rows;
    },
    getDocument: async () => data.schoolProfile,
    listCollection: async (_env, collection) => {
      assert.equal(collection, 'feeItems', 'no full-school financial collection scans');
      return [];
    }
  }) };
}

test('one-account reads are filtered, paginated, deduplicated and isolated by identity, branch and section', async () => {
  const { loader, calls } = billingLoader();
  const result = await loader({}, student, { includeLinkedApplication: true, section: 'secondary' });
  assert.deepEqual(Array.from(result.invoices, row => row.__id), ['ours', 'linked']);
  assert.equal(calls.length, 8); // Four collections, two distinct identity references.
  for (const call of calls) {
    assert.equal(call.options.filterJoin, 'OR');
    assert.equal(call.options.pageSize, 250);
    assert.equal(call.options.maxRows, 2000);
    assert.ok(call.options.filters.every(filter => filter.op === '==' && [student.AccountRef, 'APP-1'].includes(filter.value)));
  }
});

test('failed bounded query fails the snapshot, never returns partial totals', async () => {
  const { loader } = billingLoader('invoices');
  await assert.rejects(loader({}, student, { includeLinkedApplication: true, section: 'secondary' }), /no partial result/);
});
