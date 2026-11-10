import test from 'node:test';
import assert from 'node:assert/strict';
import { schoolFeeCreditScope, schoolFeeCreditSummaryId, schoolFeeCreditRowMatchesScope,
  readSchoolFeeCreditHistory, verifySchoolFeeCreditLegacySection, schoolFeeCreditQueueFields,
  schoolFeeCreditSummaryWrite, schoolFeeCreditSummaryChanged, listSchoolFeeCreditCandidates,
  readManagedSchoolFeeCreditSummary, filterSchoolFeeCreditRows
} from '../functions/lib/school-fee-credit-scope.js';
import { calculateDueSchoolFeeCreditAllocations, calculateAccountFinancialSummary,
  isSchoolFeeInvoice } from '../functions/api/backend.js';
import { buildStructuredQuery } from '../functions/lib/firestore.js';

const identity = { AccountRef: 'DCA/26/001', AdmissionNo: 'DCA/26/001', BranchId: 'area-1-primary',
  SchoolSection: 'primary', ScopePath: 'schoolBranches/area-1-primary/sections/primary/students', StudentDocumentId: 'DCA-26-001' };
const scope = schoolFeeCreditScope(identity);
const row = (extra = {}) => ({ AccountRef: identity.AccountRef, BranchId: identity.BranchId, SchoolSection: 'primary', ...extra });
const summary = (extra = {}) => row({ SchoolFeeCreditManaged: true, __id: schoolFeeCreditSummaryId(scope.accountRef, scope),
  __updateTime: 'v1', AccountScopePath: scope.scopePath, StudentDocumentId: scope.studentDocumentId, ...extra });

test('summary identities separate the same admission across branches and sections without alias duplicates', () => {
  const id = schoolFeeCreditSummaryId(identity.AccountRef, scope);
  assert.notEqual(id, schoolFeeCreditSummaryId(identity.AccountRef, { ...scope, branchId: 'main', scopePath: '' }));
  assert.notEqual(id, schoolFeeCreditSummaryId(identity.AccountRef, { ...scope, schoolSectionAccess: 'secondary', scopePath: '' }));
  assert.equal(id, schoolFeeCreditSummaryId('dca-26-001', scope));
  assert.notEqual(id, schoolFeeCreditSummaryId('DCA/260/01', scope));
  assert.notEqual(id, 'DCA-26-001');
  assert.equal(schoolFeeCreditScope(summary()).scopePath, scope.scopePath);
  assert.equal(schoolFeeCreditScope(summary()).studentDocumentId, scope.studentDocumentId);
  assert.throws(() => schoolFeeCreditScope({ AccountRef: identity.AccountRef }), /verified learner/);
  assert.throws(() => schoolFeeCreditScope({ ...identity, BranchId: 'main' }), /does not match/);
});

test('row filtering excludes other branches/sections and fails closed on ambiguous own-account evidence', () => {
  assert.equal(schoolFeeCreditRowMatchesScope(row(), scope), true);
  assert.equal(schoolFeeCreditRowMatchesScope(row({ BranchId: 'main' }), scope), false);
  assert.equal(schoolFeeCreditRowMatchesScope(row({ SchoolSection: 'secondary' }), scope), false);
  assert.equal(schoolFeeCreditRowMatchesScope({ AccountRef: identity.AccountRef }, scope), false);
  assert.equal(schoolFeeCreditRowMatchesScope(row({ SchoolSection: '', ClassName: 'Nursery 2' }), scope), true);
  assert.throws(() => schoolFeeCreditRowMatchesScope(row({ SchoolSection: '' }), scope), { code: 'SCHOOL_FEE_CREDIT_SECTION_REQUIRED' });
  assert.throws(() => schoolFeeCreditRowMatchesScope(row({ ApplicationReference: 'OTHER' }), scope), /conflicting learner/);
  assert.throws(() => schoolFeeCreditRowMatchesScope(row({ AccountRef: 'DCA/260/01' }), scope), /conflicting learner/);
  assert.throws(() => schoolFeeCreditRowMatchesScope(row({ StudentDocumentId: 'OTHER' }), scope), /another learner document/);
});

test('managed-summary lookup reuses known snapshot and filtering complete rows requires no database read', async () => {
  const deps = { getDocument: async () => { throw new Error('unexpected read'); }, queryCollectionPages: async () => { throw new Error('unexpected history'); } };
  const loaded = await readManagedSchoolFeeCreditSummary({}, identity, deps, { summary: summary() });
  assert.equal(loaded.summaryId, schoolFeeCreditSummaryId(scope.accountRef, scope));
  const filtered = await filterSchoolFeeCreditRows({}, loaded.scope, [row({ __id: 'own' }), row({ BranchId: 'main' })], deps);
  assert.deepEqual(filtered.rows.map(item => item.__id), ['own']);
  const absent = await readManagedSchoolFeeCreditSummary({}, identity, deps, { summary: null });
  assert.equal(absent.summary, null);
});

test('history reads only requested account slices and never adopts the legacy admission-only summary', async () => {
  const calls = [];
  const data = { invoices: [row({ __id: 'own' }), row({ __id: 'foreign', BranchId: 'main' })], ledger: [row({ __id: 'receipt' })] };
  const h = await readSchoolFeeCreditHistory({}, scope, {
    queryCollectionPages: async (_env, collection, query) => {
      calls.push(collection); assert.equal(query.filterJoin, 'OR'); assert.equal(query.maxRows, 20000);
      assert.ok(query.filters.every(filter => ['DCA/26/001', 'dca26001'].includes(filter.value)));
      return data[collection];
    },
    getDocument: async (_env, collection, id) => { calls.push(collection); assert.equal(id, schoolFeeCreditSummaryId(scope.accountRef, scope)); return summary(); }
  });
  assert.deepEqual(calls.sort(), ['accountSummaries', 'invoices', 'ledger']);
  assert.deepEqual(h.invoices.map(item => item.__id), ['own']);
  assert.equal(h.ledger.length, 1); assert.equal(h.payments, undefined);
});

test('supplied summary snapshot avoids a repeated lookup; missing legacy section is verified once without reloading finance', async () => {
  const calls = [];
  const h = await readSchoolFeeCreditHistory({}, scope, {
    getDocument: async () => { throw new Error('unexpected summary read'); },
    queryCollectionPages: async (_env, collection) => {
      calls.push(collection);
      if (collection === 'ledger') return [row({ SchoolSection: '', __id: 'receipt', Credit: 50 })];
      if (collection === 'invoices') return [];
      if (collection === scope.scopePath) return [{ ...identity, __id: identity.StudentDocumentId }];
      return [];
    }
  }, { summary: null });
  assert.equal(h.scope.legacySectionVerified, true);
  assert.equal(h.ledger.length, 1);
  assert.equal(calls.filter(value => value === 'ledger').length, 1);
  assert.equal(calls.filter(value => value === 'invoices').length, 1);
  assert.equal(calls.length, 4);
  assert.ok(calls.every(value => !value.includes('/main/')));
});

test('legacy section verification rejects duplicate profiles and preserves every record', async () => {
  const input = [{ ...identity, __id: identity.StudentDocumentId }, { ...identity, __id: 'another' }];
  const original = structuredClone(input);
  await assert.rejects(verifySchoolFeeCreditLegacySection({}, scope, {
    queryCollectionPages: async (_env, path) => path === scope.scopePath ? input : []
  }), /ambiguous/);
  assert.deepEqual(input, original);
  await assert.rejects(verifySchoolFeeCreditLegacySection({}, scope, {
    queryCollectionPages: async (_env, path) => path.endsWith('/secondary/students')
      ? [{ ...identity, SchoolSection: 'secondary', __id: 'secondary-student' }] : []
  }), /shared across school sections/);
});

test('fresh scoped summary is create-only, updates carry a revision, and foreign summary cannot be overwritten', () => {
  const fresh = schoolFeeCreditSummaryWrite(scope, { CreditBalance: 20, BranchId: 'forged' }, null);
  assert.equal(fresh.exists, false); assert.equal(fresh.data.BranchId, scope.branchId);
  assert.equal(fresh.data.StudentDocumentId, identity.StudentDocumentId);
  const update = schoolFeeCreditSummaryWrite(scope, { CreditBalance: 15 }, summary());
  assert.equal(update.updateTime, 'v1'); assert.equal(update.exists, undefined);
  assert.throws(() => schoolFeeCreditSummaryWrite(scope, {}, summary({ BranchId: 'main' })), /verified revision/);
  assert.throws(() => schoolFeeCreditSummaryWrite(scope, {}, summary({ __updateTime: '' })), /verified revision/);
});

test('unchanged balance/date snapshots do not require writes just to update a timestamp', () => {
  assert.equal(schoolFeeCreditSummaryChanged({ CreditBalance: 10, UpdatedAt: 'old' }, { CreditBalance: 10, UpdatedAt: 'new' }), false);
  assert.equal(schoolFeeCreditSummaryChanged({ PendingSchoolFeeCredit: 10 }, { PendingSchoolFeeCredit: 5 }), true);
  assert.equal(schoolFeeCreditSummaryChanged({ NextSchoolFeeCreditDueDate: '' }, { NextSchoolFeeCreditDueDate: '2027-01-10' }), true);
});

test('advance covers due bills first, keeps future credit separate from wallet, and a repeated allocation is empty', () => {
  const invoices = [row({ InvoiceId: 'due', FeeCategory: 'School Fee', Debit: 50, Credit: 0, DueDate: '2026-11-01' }),
    row({ InvoiceId: 'future', FeeCategory: 'School Fee', Debit: 100, Credit: 0, DueDate: '2027-01-10' })];
  const ledger = [row({ FeeCode: 'SCHOOL_FEES_ADVANCE', FeeCategory: 'School Fee', Credit: 80 }),
    row({ FeeCode: 'WALLET_TOPUP', FeeCategory: 'Wallet', Credit: 25 })];
  const first = calculateDueSchoolFeeCreditAllocations(invoices, ledger, '2026-11-10');
  assert.equal(first.allocations.length, 1); assert.equal(first.allocations[0].invoice.InvoiceId, 'due');
  assert.equal(first.allocations[0].applied, 50); assert.equal(first.remaining, 30);
  const updated = [{ ...invoices[0], Credit: 50 }, invoices[1]];
  const repeat = calculateDueSchoolFeeCreditAllocations(updated, ledger, '2026-11-10');
  assert.equal(repeat.allocations.length, 0); assert.equal(repeat.remaining, 30);
  assert.equal(calculateAccountFinancialSummary(updated, ledger).WalletBalance, 25);
  assert.deepEqual(schoolFeeCreditQueueFields(30, updated, '2026-11-10', isSchoolFeeInvoice), {
    SchoolFeeCreditManaged: true, PendingSchoolFeeCredit: 30, NextSchoolFeeCreditDueDate: '2027-01-10' });
  assert.equal(calculateDueSchoolFeeCreditAllocations(updated, ledger, '2027-01-10').allocations[0].applied, 30);
  assert.throws(() => schoolFeeCreditQueueFields(Infinity), /invalid/);
});

test('queue includes unallocated credit even when displayed credit is zero and advances past unmatched pages', async () => {
  const calls = [];
  const first = { __name: 'projects/test/databases/(default)/documents/accountSummaries/one', PendingSchoolFeeCredit: 10 };
  const second = summary({ __name: 'projects/test/databases/(default)/documents/accountSummaries/two', PendingSchoolFeeCredit: 20, CreditBalance: 0 });
  const queryCollection = async (_env, collection, options) => {
    calls.push(options); assert.equal(collection, 'accountSummaries');
    assert.equal(options.filters.length, 1); assert.equal(options.filters[0].field, 'PendingSchoolFeeCredit');
    // The real query builder must support this cursor without a composite filter.
    assert.ok(buildStructuredQuery(collection, options).structuredQuery);
    return options.startAfterName ? [second] : [first];
  };
  const page1 = await listSchoolFeeCreditCandidates({}, { limit: 1 }, { queryCollection });
  assert.equal(page1.accounts.length, 0); assert.equal(page1.done, false); assert.equal(page1.inspected, 1);
  const page2 = await listSchoolFeeCreditCandidates({}, { limit: 1, ...page1.nextCursor }, { queryCollection });
  assert.equal(page2.accounts[0].CreditBalance, 0);
  assert.equal(calls[1].startAfterName, first.__name); assert.equal(calls[1].startAfterFieldValue, 10);
});
