import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getAccountsOverview, loadAccountsWalletLedger } from '../functions/api/backend.js';
import { loadBranchFinanceRows } from '../functions/lib/finance-branch-reads.js';
import { listBranchCollection } from '../functions/lib/branch-reads.js';
import { buildStructuredQuery } from '../functions/lib/firestore.js';

const identity = { AccountRef: 'TEST/25/0018', AdmissionNo: 'TEST/25/0018', BranchId: 'main',
  SchoolSection: 'secondary', ClassName: 'Grade 8', AcademicSession: '2026/2027', Term: 'First Term' };
const wallet = (id, credit = 0, debit = 0, extra = {}) => ({ ...identity, __id: id, LedgerNo: id,
  Date: '2026-10-20', EntryType: credit ? 'Wallet Deposit' : 'Wallet Purchase', FeeCategory: 'Wallet',
  Credit: credit, Debit: debit, Reference: id, ...extra });
function fixture() {
  const school = { ...identity, FeeCode: 'TUITION', FeeCategory: 'School Fee' };
  return { schoolProfile: { CurrentAcademicSession: identity.AcademicSession, CurrentTerm: identity.Term },
    students: [{ ...identity, DisplayName: 'Synthetic student', Enrolled: 'YES' }],
    accounts: [{ ...identity, WalletBalance: 900 }], applications: [], feeItems: [], billingCategories: [],
    accountSummaries: [{ ...identity, WalletBalance: 900, CreditBalance: 205720 }], billingCategoryDiscounts: [],
    invoices: [{ ...school, InvoiceId: 'INV-SCHOOL', Amount: 600000, Credit: 600000 }],
    payments: [{ ...school, Reference: 'PAY-SCHOOL', Amount: 805720, Status: 'Paid' }],
    ledger: [{ ...school, LedgerNo: 'LED-SCHOOL', Reference: 'PAY-SCHOOL', Credit: 805720, Debit: 0 }], walletLedger: [] };
}
async function overview(data, scope = { BranchId: 'main', UserSchoolSectionAccess: 'secondary' }) {
  const before = structuredClone(data);
  const result = await getAccountsOverview({}, data, scope);
  assert.deepEqual(data, before, 'a display refresh must not alter source records');
  return result;
}
const studentAccount = result => result.accounts.find(row => row.AccountRef === identity.AccountRef);
const schoolTotals = row => Object.fromEntries(['TotalDebit', 'TotalCredit', 'TotalReceipts', 'Balance',
  'OutstandingBalance', 'SchoolFeeOutstanding', 'ExcessCredit'].map(key => [key, row[key]]));

test('missing-period card refund offsets its original purchase, with no cached balance added', async () => {
  const data = fixture();
  const baseline = schoolTotals(studentAccount(await overview(data)));
  const depositsAndPurchases = [wallet('TOPUP', 6000), wallet('FOOD1', 0, 1600), wallet('CARD', 0, 3500),
    wallet('FOOD2', 0, 1300), wallet('FOOD3', 0, 2000), wallet('FOOD4', 0, 1100)];
  const refund = wallet('REFUND-CARD', 3500, 0, { EntryType: 'Wallet Refund', Reference: 'CARD-BATCH' });
  delete refund.AcademicSession; delete refund.Term;
  data.ledger.push(...depositsAndPurchases);
  data.walletLedger = [...depositsAndPurchases, refund];
  const result = await overview(data);
  assert.equal(studentAccount(result).WalletBalance, 0);
  assert.deepEqual(schoolTotals(studentAccount(result)), baseline);
  assert.equal(result.ledger.filter(row => row.FeeCategory === 'Wallet').length, 7,
    'the current-period and lifetime queries must not duplicate transactions');
  assert.equal(result.ledger.find(row => row.LedgerNo === refund.LedgerNo).AcademicSession, undefined);
});

test('wallet carries prior sessions and terms even when a newer application exists; school totals stay period-bound', async () => {
  const data = fixture();
  const baseline = schoolTotals(studentAccount(await overview(data)));
  data.students[0].ApplicationReference = 'APP-CURRENT';
  data.applications.push({ ...identity, ApplicationReference: 'APP-CURRENT', CreatedAt: '2026-09-01', Enrolled: 'YES' });
  data.walletLedger.push(wallet('OLD-DEPOSIT', 5000, 0, { AcademicSession: '2025/2026', Term: 'Third Term', Date: '2026-07-01' }),
    wallet('OLD-SPEND', 0, 1200, { AcademicSession: '2025/2026', Term: 'Third Term', Date: '2026-07-02' }),
    wallet('OTHER-TERM', 0, 300, { Term: 'Second Term' }),
    wallet('BLANK-REFUND', 100, 0, { AcademicSession: '', Term: '', EntryType: 'Wallet Refund' }));
  data.ledger.push({ ...identity, LedgerNo: 'OLD-FEES', FeeCategory: 'School Fee', Credit: 90000,
    AcademicSession: '2025/2026', Date: '2026-07-01' },
  { ...identity, LedgerNo: 'OTHER-TERM-FEE', FeeCategory: 'School Fee', Credit: 80000, Term: 'Second Term' });
  const result = await overview(data);
  assert.equal(studentAccount(result).WalletBalance, 3600);
  assert.deepEqual(schoolTotals(studentAccount(result)), baseline);
});

test('wallet totals use raw ledger amounts and preserve separate refunds sharing a batch reference', async () => {
  const data = fixture();
  data.payments.push({ ...identity, Reference: 'BATCH', FeeCategory: 'Wallet', Amount: 9000, Status: 'Paid' });
  data.walletLedger.push(wallet('REFUND-1', 125, 0, { Reference: 'BATCH', EntryType: 'Wallet Refund' }),
    wallet('REFUND-2', 75, 0, { Reference: 'BATCH', EntryType: 'Wallet Refund' }),
    wallet('CORRECTION', 0, 50, { Reference: 'BATCH', EntryType: 'Wallet Correction Debit' }));
  const result = await overview(data);
  assert.equal(studentAccount(result).WalletBalance, 150);
  assert.deepEqual(result.ledger.filter(row => row.FeeCategory === 'Wallet').map(row => row.Credit), [125, 75, 0]);
});

test('wallet totals reject other branch, section, account and reused application identities', async () => {
  const data = fixture();
  data.students[0].ApplicationReference = 'SHARED-APP';
  data.walletLedger.push(wallet('OWN', 100), wallet('WRONG-BRANCH', 1000, 0, { BranchId: 'north' }),
    wallet('WRONG-SECTION', 2000, 0, { SchoolSection: 'primary', ClassName: 'Primary 4' }),
    wallet('WRONG-ACCOUNT', 3000, 0, { AccountRef: 'OTHER', AdmissionNo: 'OTHER', ApplicationReference: 'SHARED-APP' }));
  const result = await overview(data);
  assert.equal(studentAccount(result).WalletBalance, 100);
  assert.ok(result.ledger.filter(row => row.FeeCategory === 'Wallet')
    .every(row => row.BranchId === 'main' && row.SchoolSection === 'secondary'));
  const allSections = await overview(data, { BranchId: 'main', UserSchoolSectionAccess: 'All' });
  assert.equal(studentAccount(allSections).WalletBalance, 100, 'same reference in another section is not this wallet');
});

test('legacy wallet rows without explicit section retain the shared class-based section rules', async () => {
  for (const [section, className] of [['primary', 'Primary 4'], ['secondary', 'Grade 8']]) {
    const data = fixture();
    data.students[0].SchoolSection = section; data.students[0].ClassName = className;
    data.accounts = [];
    data.walletLedger.push(wallet('LEGACY', 100, 0, { ClassName: className }));
    delete data.walletLedger[0].SchoolSection;
    assert.equal(studentAccount(await overview(data, { BranchId: 'main', UserSchoolSectionAccess: section })).WalletBalance, 100);
  }
});

test('fully preloaded snapshots use their lifetime ledger and ignore stale wallet summaries even at zero', async () => {
  const data = fixture();
  delete data.walletLedger;
  data.ledger.push(wallet('PREVIOUS', 1000, 0, { AcademicSession: '2025/2026' }), wallet('CURRENT', 0, 1000));
  const result = await overview(data);
  assert.equal(studentAccount(result).WalletBalance, 0);
  data.ledger = data.ledger.filter(row => row.FeeCategory !== 'Wallet');
  assert.equal(studentAccount(await overview(data)).WalletBalance, 0);
});

function matches(row, filter) {
  if (filter.filters) return filter.filterJoin === 'OR'
    ? filter.filters.some(child => matches(row, child)) : filter.filters.every(child => matches(row, child));
  if (!Object.hasOwn(row, filter.field)) return false;
  return filter.op === 'in' ? filter.value.includes(row[filter.field]) : row[filter.field] === filter.value;
}
function queryHarness(rows) {
  const requests = [];
  const noScan = async () => { throw new Error('A whole-ledger scan is forbidden'); };
  const select = options => rows.filter(row => (options.filters || []).every(filter => matches(row, filter)));
  const db = { listCollection: noScan, listCollectionForReport: noScan,
    getSchoolStructure: async () => ({ Branches: [{ Id: 'main' }, { Id: 'north' }] }),
    countCollection: async (_env, _collection, options) => ({ count: select(options).length, readTime: options.readTime }),
    queryCollectionPages: async (_env, collection, options) => {
      assert.equal(collection, 'ledger'); assert.equal(options.readTime, '2026-11-04T14:00:00.000Z');
      requests.push({ options, raw: buildStructuredQuery(collection, options).structuredQuery });
      return select(options);
    } };
  return { requests, read: (env, collection, branch, options) => loadBranchFinanceRows(env, collection, branch, options, {
    ...db, listBranchCollection: (env, collection, branch, options) => listBranchCollection(env, collection, branch, options, db)
  }) };
}

test('one indexed branch query unions all wallet selectors without period filters or repeated document reads', async () => {
  const rows = [wallet('NORMAL', 10), wallet('MISSING-PERIOD', 20), wallet('CODE-ONLY', 30, 0, { FeeCode: 'WALLET_TOPUP' }),
    wallet('TYPE-ONLY', 40), wallet('ALIASED', 50), wallet('OTHER-BRANCH', 500, 0, { BranchId: 'north' }),
    { ...identity, __id: 'SCHOOL', FeeCategory: 'School Fee', Credit: 5000 }];
  delete rows[1].AcademicSession; delete rows[1].Term;
  delete rows[2].FeeCategory; delete rows[2].EntryType;
  delete rows[3].FeeCategory;
  delete rows[4].FeeCategory; delete rows[4].EntryType; rows[4].feeCategory = 'wallet';
  const h = queryHarness(rows);
  const result = await loadAccountsWalletLedger({}, 'main', '2026-11-04T14:00:00.000Z', { loadBranchFinanceRows: h.read });
  assert.deepEqual(result.map(row => row.__id), rows.slice(0, 5).map(row => row.__id));
  assert.equal(h.requests.length, 1);
  const { raw, options } = h.requests[0];
  assert.equal(raw.where.compositeFilter.op, 'AND');
  assert.equal(raw.where.compositeFilter.filters[0].fieldFilter.field.fieldPath, 'BranchId');
  const group = raw.where.compositeFilter.filters[1].compositeFilter;
  assert.equal(group.op, 'OR');
  assert.ok(group.filters.every(filter => ['FeeCategory', 'feeCategory', 'FeeCode', 'feeCode', 'EntryType', 'entryType']
    .includes(filter.fieldFilter.field.fieldPath)));
  assert.ok(group.filters.reduce((sum, filter) => sum + filter.fieldFilter.value.arrayValue.values.length, 0) <= 30);
  assert.equal(options.pageSize, 500); assert.equal(options.maxRows, 40000);
});

test('legacy Main branch coverage retains untagged refunds while non-main branches remain isolated', async () => {
  const rows = [wallet('LEGACY-MAIN', 100), wallet('NORTH', 200, 0, { BranchId: 'north' }),
    { ...identity, __id: 'OTHER-FEES', FeeCategory: 'School Fee', Credit: 9000 }];
  delete rows[0].BranchId; delete rows[0].AcademicSession; delete rows[0].Term;
  const h = queryHarness(rows);
  assert.deepEqual((await loadAccountsWalletLedger({}, 'main', '2026-11-04T14:00:00.000Z', { loadBranchFinanceRows: h.read }))
    .map(row => row.__id), ['LEGACY-MAIN']);
  assert.deepEqual((await loadAccountsWalletLedger({}, 'north', '2026-11-04T14:00:00.000Z', { loadBranchFinanceRows: h.read }))
    .map(row => row.__id), ['NORTH']);
  assert.ok(h.requests.every(({ options }) => options.filters.some(filter => filter.filterJoin === 'OR')));
  for (const { raw } of h.requests.slice(1)) assert.equal(raw.where.compositeFilter.op, 'AND');
});

test('live overview merges its wallet query at the same snapshot and preloaded account reads do not expand scope', async () => {
  const source = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
  const fn = source.slice(source.indexOf('export async function getAccountsOverview'), source.indexOf('async function saveBillingCategory'));
  assert.match(fn, /readTime: financeReadTime/);
  assert.match(fn, /provided\('ledger'\) \? Promise\.resolve\(\[\]\) : loadAccountsWalletLedger\(env, branchId, financeReadTime\)/);
  assert.match(fn, /mergeAccountsLedgerRows\(loadedLedger, loadedWalletLedger\)/);
});
