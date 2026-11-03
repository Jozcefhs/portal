import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { normalizeBillingDiscount, applyTotalBillingDiscount, billingFeesWithPostedAmounts, billingDiscountId,
  selectBillingDiscount, loadBillingDiscount, loadBillingDiscounts, handleBillingDiscounts } from '../functions/lib/billing-category-discounts.js';
import { applyBillingCategoryOverrides, feeMatchesApplication, isSchoolFeeInvoice, buildStudentBillingPreview,
  studentBillingReconciliationPlan, getAccountsOverview, resolveStudentEnrollmentCategory, sameFinancialPeriod } from '../functions/api/backend.js';
import { feeBranchId } from '../functions/lib/fee-branch-scope.js';
import { assertManualPaymentScope, scopedPaymentWriteCondition } from '../functions/lib/manual-payment-scope.js';
import { isFullScholarship } from '../functions/lib/full-scholarship.js';
import { enforceDesktopDeviceActionScope } from '../functions/api/backend.js';

const clean = v => String(v ?? '').trim(), lower = v => clean(v).toLowerCase();
const period = { BranchId: 'main', AcademicSession: '2026/2027', Term: 'First Term' };
const account = { ...period, AccountRef: 'TEST/25/001', AdmissionNo: 'TEST/25/001', ClassName: 'Grade 7', SchoolSection: 'secondary',
  StudentType: 'Day Student', BillingCategory: 'School Staff Child', EnrollmentCategory: 'Returning', ProfileCompletionStatus: 'Complete' };
const rule = { Name: account.BillingCategory, BranchId: 'main', DiscountType: 'Percentage', DiscountValue: 10, recordVersion: 'v1' };
const fee = (FeeCode, Amount, extra = {}) => ({ ...period, __id: FeeCode, __updateTime: 'f1', FeeCode, FeeName: FeeCode, Amount,
  FeeCategory: 'School Fee', BillingCategory: 'All', ClassName: 'All', StudentType: 'All', Gender: 'All', Active: 'YES', PayableOnline: 'YES', ...extra });
const fees = [fee('TUITION', 100000), fee('BOOKS', 30000), fee('EXAM', 20000)];
const discounted = (items = fees, changes = {}, owner = account) => applyBillingCategoryOverrides(items, { ...owner, BillingDiscount: { ...rule, ...changes } });

for (const category of ['School Staff Child', 'Church Staff Child', 'Sibling Discount', 'Partial Scholarship', 'Sponsored']) {
  test(`${category} receives a total percentage discount without modifying fee rules`, () => {
    const before = JSON.stringify(fees);
    const result = discounted(fees, { Name: category }, { ...account, BillingCategory: category });
    assert.deepEqual(result.map(row => row.Amount), [90000, 27000, 18000]);
    assert.equal(result.reduce((sum, row) => sum + row.BillingDiscount.Amount, 0), 15000);
    assert.equal(JSON.stringify(fees), before);
  });
}

test('component category override precedes one total fixed discount', () => {
  const rules = [...fees, fee('TUITION', 50000, { BillingCategory: 'School Staff Child' })];
  const result = discounted(rules, { DiscountType: 'Fixed amount', DiscountValue: 20000 });
  assert.equal(result.length, 3);
  assert.deepEqual(result.map(row => row.Amount), [40000, 24000, 16000]);
  assert.deepEqual(discounted(result, { DiscountType: 'Fixed amount', DiscountValue: 20000 }), result, 'recalculation must not compound');
});
test('fractional kobo allocation is exact, deterministic and capped at the fee total', () => {
  const tiny = [fee('A', .01), fee('B', .01), fee('C', .01)];
  assert.deepEqual(discounted(tiny, { DiscountValue: 50 }).map(row => row.Amount), [0, 0, .01]);
  assert.deepEqual(discounted(tiny, { DiscountType: 'Fixed amount', DiscountValue: .02 }).map(row => row.Amount), [0, 0, .01]);
  assert.equal(discounted(tiny, { DiscountType: 'Fixed amount', DiscountValue: 999 }).reduce((a,b) => a + b.Amount, 0), 0);
  const reversed = discounted([...tiny].reverse(), { DiscountValue: 50 });
  assert.equal(reversed.find(row => row.FeeCode === 'C').Amount, .01);
});
test('wallet, acceptance, optional, store and other-branch items are excluded', () => {
  const excluded = [fee('WALLET_TOPUP', 1000, { FeeCategory: 'Wallet' }), fee('ACCEPTANCE_FEE', 1000),
    fee('CLUB_FEE', 1000), fee('STORE_BOOK', 1000), fee('FOREIGN', 1000, { BranchId: 'annex' })];
  const result = discounted([...fees, ...excluded]);
  for (const row of excluded) assert.deepEqual(result.find(item => item.FeeCode === row.FeeCode), row);
  assert.equal(result[0].Amount, 90000);
});
test('fixed discount applies once per matching term and never crosses branches/categories', () => {
  const result = discounted([...fees, fee('NEXT', 10000, { Term: 'Second Term' })], { DiscountType: 'Fixed amount', DiscountValue: 1000 });
  assert.equal(result.reduce((sum, row) => sum + row.Amount, 0), 158000);
  assert.deepEqual(discounted(fees, { BranchId: 'annex' }), fees);
  assert.deepEqual(discounted(fees, { Name: 'Church Staff Child' }), fees);
});
test('full scholarship continues to charge only explicitly assigned exceptions', () => {
  const owner = { ...account, BillingCategory: 'Full Scholarship' };
  const matching = [...fees, fee('EXCEPTION', 1000, { BillingCategory: 'Full Scholarship' })].filter(row => feeMatchesApplication(row, owner));
  assert.deepEqual(discounted(matching, { Name: 'Full Scholarship', DiscountValue: 100 }, owner).map(row => row.Amount), [1000]);
  assert.throws(() => normalizeBillingDiscount({ ...rule, Name: 'Full Scholarship' }), /explicitly assigned/);
});
for (const changes of [{ DiscountType: 'Bogus' }, { DiscountValue: -1 }, { DiscountValue: 101 }, { DiscountValue: '1.001' }, { DiscountValue: Infinity }, { Name: 'All' }]) {
  test(`invalid configuration fails: ${JSON.stringify(changes)}`, () => assert.throws(() => normalizeBillingDiscount({ ...rule, ...changes })));
}
test('None removes future total discounts without creating a negative or hidden amount', () => {
  assert.deepEqual(discounted(fees, { DiscountType: 'None' }), fees);
  assert.equal(normalizeBillingDiscount({ ...rule, DiscountType: 'None' }).DiscountValue, 0);
});
test('posted invoice amounts remain authoritative in checkout after configuration changes', () => {
  const quote = discounted();
  const invoices = fees.map(row => ({ ...row, Debit: row.Amount, Credit: 1000, Status: 'Part Paid' }));
  const before = JSON.stringify(invoices);
  assert.deepEqual(billingFeesWithPostedAmounts(quote, account, invoices).map(row => row.Amount), [100000, 30000, 20000]);
  const previous = quote.map(row => ({ ...row, Debit: row.Amount, Status: 'Unpaid' }));
  assert.deepEqual(billingFeesWithPostedAmounts(fees, account, previous).map(row => row.Amount), [90000, 27000, 18000]);
  assert.equal(JSON.stringify(invoices), before);
  assert.throws(() => billingFeesWithPostedAmounts(quote, account, [invoices[0], invoices[0]]), /Multiple invoices/);
});

test('bounded loaders use a single point read or a small branch query', async () => {
  let reads = 0;
  const id = await billingDiscountId('main', ' School   STAFF child ');
  assert.equal(id, await billingDiscountId('main', 'school staff child'));
  assert.notEqual(id, await billingDiscountId('annex', 'school staff child'));
  const loaded = await loadBillingDiscount({}, account, { getDocument: async (_env, collection, key) => {
    reads++; assert.equal(collection, 'billingCategoryDiscounts'); assert.equal(key, id); return { ...rule, __updateTime: 'v1' };
  } });
  assert.equal(reads, 1); assert.equal(loaded.recordVersion, 'v1');
  await loadBillingDiscounts({}, 'main', { queryCollection: async (_env, collection, query) => {
    assert.equal(collection, 'billingCategoryDiscounts'); assert.equal(query.limit, 501);
    assert.deepEqual(query.filters, [{ field: 'BranchId', op: '==', value: 'main' }]); return [];
  } });
  assert.equal(selectBillingDiscount([rule], { ...account, BranchId: 'annex' }), null);
});
function settings() {
  let saved = null; const commits = [], reads = [];
  const deps = { getDocument: async (...args) => { reads.push(args.slice(1)); return saved; },
    queryCollection: async () => saved ? [saved] : [], listCollection: async () => [],
    batchCommitLiteralDocuments: async (_env, writes) => {
      assert.equal(writes.length, 2); assert.equal(writes[0].collectionPath, 'billingCategoryDiscounts');
      assert.equal(writes[1].collectionPath, 'accountingAudit');
      if (saved) assert.equal(writes[0].updateTime, saved.__updateTime); else assert.equal(writes[0].exists, false);
      commits.push(structuredClone(writes)); saved = { ...writes[0].data, __updateTime: `v${commits.length}` };
      return { writeResults: [{ updateTime: saved.__updateTime }, { updateTime: saved.__updateTime }] };
    } };
  const user = { username: 'finance', role: 'Accounts Officer', branchId: 'main', BranchIds: ['main'], allowedSections: ['accounts'] };
  return { deps, user, commits, reads };
}
test('save is atomic, optimistic and repeat-safe with one audit per actual change', async () => {
  const h = settings(), body = { ...rule, recordVersion: '', action: 'save' };
  const created = await handleBillingDiscounts({}, h.user, body, h.deps);
  assert.equal(created.rule.recordVersion, 'v1');
  const retry = await handleBillingDiscounts({}, h.user, body, h.deps);
  assert.equal(retry.changed, false); assert.equal(h.commits.length, 1);
  await assert.rejects(handleBillingDiscounts({}, h.user, { ...body, DiscountValue: 20 }, h.deps), /Reload/);
  await handleBillingDiscounts({}, h.user, { ...body, DiscountValue: 20, recordVersion: 'v1' }, h.deps);
  assert.equal(h.commits.length, 2);
  const list = await handleBillingDiscounts({}, h.user, { action: 'list' }, h.deps);
  for (const name of ['Church Staff Child', 'School Staff Child', 'Sibling Discount']) assert.ok(list.categories.includes(name));
  assert.equal(h.commits.length, 2, 'opening the settings is read-only');
});
test('unauthorised roles, branches, devices and read-only subscriptions cannot save', async () => {
  const h = settings(), body = { ...rule, action: 'save' };
  for (const user of [{ ...h.user, role: 'Subject Teacher' }, { ...h.user, allowedSections: [] },
    { ...h.user, BranchIds: ['annex'] }, { ...h.user, deviceBranchId: 'annex' }, { ...h.user, subscriptionReadOnly: true }]) {
    await assert.rejects(handleBillingDiscounts({}, user, body, h.deps));
  }
  assert.equal(h.commits.length, 0); assert.equal(h.reads.length, 0);
  for (const action of ['getBillingDiscountSettings', 'saveBillingDiscountSettings'])
    assert.doesNotThrow(() => enforceDesktopDeviceActionScope({ type: 'device', branchId: 'main' }, action, {}));
});

test('account overview and billing review share discounted totals; posted records stay unchanged', async () => {
  const data = { schoolProfile: {}, accounts: [], students: [account], applications: [], payments: [], invoices: [], ledger: [],
    feeItems: fees, billingCategories: [], billingCategoryDiscounts: [rule], accountSummaries: [] };
  const overview = await getAccountsOverview({}, data, { BranchId: 'main' });
  assert.equal(overview.accounts[0].BillingDiscount.DiscountValue, 10);
  const preview = await buildStudentBillingPreview(account, data);
  assert.equal(preview.expectedTotal, 135000);
  assert.deepEqual(preview.rows.map(row => row.expected).sort((a,b) => a-b), [18000, 27000, 90000]);
  const billed = { ...data, invoices: [{ ...period, AccountRef: account.AccountRef, FeeCode: 'TUITION', InvoiceId: 'OLD', Debit: 100000, Amount: 100000, Credit: 5000, FeeCategory: 'School Fee' }] };
  const before = JSON.stringify(billed);
  const plan = await studentBillingReconciliationPlan(account, billed);
  assert.equal(plan.conflicts.length, 1); assert.equal(plan.postingTotal, 45000);
  assert.equal(JSON.stringify(billed), before);
});

const backend = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
test('invoice retry reuses discounted bills and refuses changed discounts without writes', async () => {
  const block = backend.slice(backend.indexOf('async function generateSchoolFeeInvoicesForAccount('), backend.indexOf('function ledgerDocumentId('));
  let policy = rule, feeReads = 0, policyReads = 0, counter = 0; const invoices = new Map(), writes = [];
  const run = vm.runInNewContext(`(${block})`, {
    clean, lower, normalizeMatchText: lower, sameText: (a,b) => lower(a) === lower(b), sameFinancialPeriod,
    assertManualPaymentScope, scopedPaymentWriteCondition, isFullScholarship, resolveStudentEnrollmentCategory,
    normalizeFeeItem: row => row, normalizeInvoice: row => row, asMoneyNumber: v => Number(v) || 0,
    yesNo: v => lower(v) === 'yes' ? 'YES' : 'NO', applyBillingCategoryOverrides, feeMatchesApplication, isSchoolFeeInvoice,
    isWalletFee: () => false, feeBranchId, loadBillingDiscount: async () => { policyReads++; return policy; },
    loadBranchFinanceRows: async () => { feeReads++; return fees; }, queryAccountRows: async () => [...invoices.values()],
    resolvedPeriodValue: (v,fallback) => !v || lower(v) === 'all' ? fallback : v, normalizeReferenceText: lower,
    ledgerDocumentId: () => `NEW-${++counter}`, schoolSectionFor: row => row.SchoolSection,
    invoiceReminderFields: () => ({}), nowIso: () => '2026-11-03T00:00:00Z', feeDueDate: v => v, safeDocumentId: v => v,
    batchUpsertDocuments: async (_env, batch) => { writes.push(...batch); for (const item of batch) invoices.set(item.documentId, item.data); },
    applyDueSchoolFeeCreditsForAccount: async () => {}
  });
  const cache = new Map(), body = { ResolvedStudent: account, NotificationSettings: {} };
  const created = await run({}, body, account.AccountRef, null, cache);
  assert.equal(created.created, 3); assert.equal([...invoices.values()].reduce((n,row) => n+row.Debit, 0), 135000);
  const before = JSON.stringify([...invoices]);
  const again = await run({}, body, account.AccountRef, null, cache);
  assert.equal(again.created, 0); assert.equal(writes.length, 3); assert.equal(invoices.size, 3);
  assert.equal(feeReads, 1); assert.equal(policyReads, 1);
  policy = { ...rule, DiscountValue: 20 };
  await assert.rejects(run({}, body, account.AccountRef), /posted invoices/);
  assert.equal(JSON.stringify([...invoices]), before); assert.equal(writes.length, 3);
});
