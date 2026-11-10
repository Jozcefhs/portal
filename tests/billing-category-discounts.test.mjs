import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { normalizeBillingDiscount, applyTotalBillingDiscount, billingFeesWithPostedAmounts, billingDiscountId,
  selectBillingDiscount, desktopBillingOverview, loadBillingDiscount, loadBillingDiscounts, handleBillingDiscounts } from '../functions/lib/billing-category-discounts.js';
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
const selectedRate = (id, changes = {}) => ({ RateId: id, DiscountType: 'Percentage', DiscountValue: 25,
  ClassScope: 'Selected', ClassNames: ['Grade 7'], TermScope: 'Selected', TermNames: ['First Term'], ...changes });

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

test('a staff-child price covering all classes replaces a matching class-specific textbook charge', async () => {
  const standard = fee('BOOKS_G7', 148060, { FeeName: 'Textbooks (All Subjects)', ClassName: 'Grade 7', EnrollmentCategory: 'Returning' });
  const special = fee('BOOKS_STAFF', 120065, { FeeName: standard.FeeName, BillingCategory: 'School Staff Child', ClassName: 'All', EnrollmentCategory: 'All', AcademicSession: 'All' });
  assert.deepEqual(applyBillingCategoryOverrides([standard, special], account).map(row => row.FeeCode), ['BOOKS_STAFF']);
  const preview = await buildStudentBillingPreview(account, { schoolProfile: {}, feeItems: [standard, special], invoices: [], payments: [], ledger: [], accountSummaries: [] });
  assert.equal(preview.expectedTotal, 120065); assert.equal(preview.rows.length, 1);
  assert.equal(preview.rows[0].code, 'BOOKS_STAFF');
});

test('all-section rates and category-specific section rates form one matching component', async () => {
  for (const SchoolSection of ['', 'All', '*']) {
    for (const [section, ClassName] of [['primary', 'Grade 3'], ['secondary', 'Grade 7']]) {
      const student = { ...account, ClassName, SchoolSection: section };
      const standard = fee('TUITION_STANDARD', 100000, { FeeName: 'Tuition', ClassName, SchoolSection });
      const special = fee('TUITION_STAFF', 60000, { FeeName: 'Tuition', BillingCategory: student.BillingCategory, SchoolSection: section });
      const data = { schoolProfile: {}, feeItems: [standard, special], invoices: [], payments: [], ledger: [], accountSummaries: [] };
      const before = JSON.stringify(data);
      const preview = await buildStudentBillingPreview(student, data);
      assert.equal(preview.expectedTotal, 60000, `${section}/${SchoolSection || 'legacy blank'}`);
      assert.deepEqual(preview.rows.map(row => row.code), ['TUITION_STAFF']);
      assert.deepEqual(applyBillingCategoryOverrides([special, standard], student).map(row => row.FeeCode), ['TUITION_STAFF']);
      assert.equal(JSON.stringify(data), before, 'preview must not mutate fee rules or recorded transactions');
    }
  }
});

test('effective section for legacy profiles uses the class before applying a total discount', () => {
  for (const [section, ClassName] of [['primary', 'Grade 3'], ['secondary', 'Grade 7']]) {
    const student = { ...account, ClassName, SchoolSection: '', BillingDiscount: rule };
    const standard = fee('TUITION_STANDARD', 100000, { FeeName: 'Tuition', ClassName, SchoolSection: 'All' });
    const special = fee('TUITION_STAFF', 60000, { FeeName: 'Tuition', BillingCategory: student.BillingCategory, SchoolSection: section });
    const result = applyBillingCategoryOverrides([standard, special], student);
    assert.deepEqual(result.map(row => row.FeeCode), ['TUITION_STAFF']);
    assert.equal(result[0].Amount, 54000);
    assert.equal(result[0].BillingDiscount.BaseTotal, 60000);
    assert.equal(result[0].BillingDiscount.TotalDiscount, 6000);
  }
});

test('category overrides keep separate branches, periods, currencies and different named components distinct', () => {
  const original = fee('BOOKS_G7', 148060, { FeeName: 'Textbooks', ClassName: 'Grade 7' });
  const special = fee('BOOKS_STAFF', 120065, { FeeName: 'Textbooks', BillingCategory: 'School Staff Child' });
  for (const change of [{BranchId:'area-1-primary'}, {SchoolSection:'primary'}, {Term:'Second Term'}, {AcademicSession:'2025/2026'}, {Currency:'USD'}, {FeeName:'Cambridge Textbooks'}]) {
    assert.equal(applyBillingCategoryOverrides([original, {...special,...change}], account).length, 2);
  }
  const sameRank = {...special, FeeCode:'OTHER_STAFF'};
  assert.equal(applyBillingCategoryOverrides([original,special,sameRank],account).length,2,'ambiguous category prices remain visible for review');
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
test('one scoped rate replaces the default for each matching class and fee period', () => {
  const amounts = (owner, policy) => discounted(items, policy, owner).map(row => row.Amount);
  const items = [fee('A', 1000, { Term: 'All' }), fee('B', 1000, { Term: '  first  TERM ' }), fee('C', 1000, { Term: 'Second Term' }),
    fee('D', 1000, { Term: 'Third Term' })];
  const policy = { Rates: [
    selectedRate('first', { DiscountType: 'Fixed amount', DiscountValue: 201 }),
    selectedRate('second', { TermNames: ['Second Term'], DiscountValue: 50 }),
    selectedRate('third', { TermNames: ['Third Term'], DiscountType: 'None', DiscountValue: 0 }),
    selectedRate('other-class', { ClassNames: ['Primary 1'], TermScope: 'All', TermNames: [] })
  ] };
  assert.deepEqual(amounts({ ...account, ClassName: ' grade  7 ' }, policy), [899.5, 899.5, 500, 1000]);
  assert.deepEqual(amounts({ ...account, ClassName: 'Primary 1' }, policy), [750, 750, 750, 750]);
  assert.deepEqual(amounts({ ...account, ClassName: 'Grade 8' }, policy), [900, 900, 900, 900]);
  assert.deepEqual(amounts({ ...account, Term: '*' }, policy), [900, 799, 500, 1000]);
  assert.deepEqual(amounts({ ...account, ClassName: '', ClassApplyingFor: 'Grade 7' }, policy), [900, 900, 900, 900]);
  assert.equal(discounted(items, policy)[0].BillingDiscount.RateId, 'first');
  assert.throws(() => discounted(items, { Rates: [selectedRate('a'), selectedRate('b')] }), /Overlapping/);
});

test('re-quoting uses original amounts after changing class, term, category or removing the policy', () => {
  const policy = { DiscountType: 'None', DiscountValue: 0, Rates: [selectedRate('creche', { ClassNames: ['Crèche'] })] };
  const pupil = { ...account, ClassName: 'Crèche' }, items = [fee('A', 1500, { Term: 'All' })];
  const quote = discounted(items, policy, pupil);
  assert.equal(quote[0].Amount, 1125);
  for (const changes of [{ ClassName: 'Playgroup' }, { ClassName: '' }, { Term: 'Third Term' }, { BillingCategory: 'Regular' }]) {
    assert.deepEqual(discounted(quote, policy, { ...pupil, ...changes }), items);
  }
  assert.deepEqual(applyBillingCategoryOverrides(quote, pupil), items);
  const posted = quote.map(row => ({ ...row, Debit: row.Amount, Status: 'Part Paid', Credit: 125 }));
  const before = JSON.stringify(posted);
  const checkout = billingFeesWithPostedAmounts(items, { ...pupil, ClassName: 'Playgroup' }, posted);
  assert.equal(checkout[0].Amount, 1125);
  assert.equal(checkout[0].BillingDiscount.RateId, 'creche');
  assert.equal(JSON.stringify(posted), before);
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
function settings(initial = null) {
  let saved = initial; const commits = [], reads = [], optionReads = [];
  const classes = ['Grade 7', 'Grade 8', 'Playgroup', 'Crèche'];
  const deps = { getDocument: async (...args) => { reads.push(args.slice(1)); return saved; },
    queryCollection: async (_env, path, { filters }) => {
      if (path === 'billingCategoryDiscounts') return saved ? [saved] : [];
      assert.equal(path, 'academicTerms'); optionReads.push(path);
      assert.deepEqual(filters, [{ field: 'BranchId', op: '==', value: 'main' }]);
      return [{ Name: 'Summer Term', BranchId: 'main', Status: 'Planned' }, { Name: 'Archive', BranchId: 'main', Status: 'Closed' },
        { Name: 'Foreign', BranchId: 'annex', Status: 'Active' }];
    }, listCollection: async () => [],
    getSchoolClasses: async (_env, options) => {
      optionReads.push('classes');
      assert.deepEqual(options, { BranchId: 'main', IncludeAcademicClasses: true });
      return { classes: [...classes.map(ClassName => ({ ClassName, Active: 'YES' })), { ClassName: 'Retired', Active: 'NO' }] };
    },
    batchCommitLiteralDocuments: async (_env, writes) => {
      assert.equal(writes.length, 2); assert.equal(writes[0].collectionPath, 'billingCategoryDiscounts');
      assert.equal(writes[1].collectionPath, 'accountingAudit');
      if (saved) assert.equal(writes[0].updateTime, saved.__updateTime); else assert.equal(writes[0].exists, false);
      commits.push(structuredClone(writes)); saved = { ...writes[0].data, __updateTime: `v${commits.length}` };
      return { writeResults: [{ updateTime: saved.__updateTime }, { updateTime: saved.__updateTime }] };
    } };
  const user = { username: 'finance', role: 'Accounts Officer', branchId: 'main', BranchIds: ['main'], allowedSections: ['accounts'] };
  return { deps, user, commits, reads, classes, optionReads };
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
test('editor catalogues are opt-in; legacy rules read as the default without any writes', async () => {
  const h = settings({ ...rule, __updateTime: 'v0' });
  const list = IncludeOptions => handleBillingDiscounts({}, h.user, { action: 'list', IncludeOptions }, h.deps);
  const lookup = await list(false);
  assert.equal(lookup.scopedRatesVersion, 1); assert.deepEqual(lookup.rules[0].Rates, []);
  assert.equal(lookup.rules[0].DiscountValue, 10); assert.ok(!Object.hasOwn(lookup, 'classes')); assert.deepEqual(h.optionReads, []);
  const editor = await list(true);
  assert.deepEqual(editor.classes, h.classes);
  assert.deepEqual(editor.terms, ['First Term', 'Second Term', 'Third Term', 'Summer Term']);
  assert.deepEqual(h.optionReads.sort(), ['academicTerms', 'classes']); assert.equal(h.commits.length, 0);
});
test('legacy desktop fee lookup blocks only policies that can change its estimate; account previews get their actual rate', async () => {
  const legacy = settings({ ...rule, __updateTime: 'v1' });
  const lookup = (h, options = {}) => handleBillingDiscounts({}, h.user, { action: 'list', ...options }, { ...h.deps, desktopClient: true });
  assert.equal((await lookup(legacy)).rules[0].DiscountValue, 10);
  const policy = { ...rule, Rates: [selectedRate('g7')] }, scoped = settings(policy);
  await assert.rejects(lookup(scoped), /Update the desktop app/);
  assert.equal((await lookup(scoped, { ScopedRatesVersion: 1 })).rules[0].Rates.length, 1);
  assert.equal((await handleBillingDiscounts({}, scoped.user, { action: 'list', IncludeOptions: true }, scoped.deps)).rules[0].Rates.length, 1);
  const exempt = settings({ ...rule, Rates: [selectedRate('excluded', { DiscountType: 'None', DiscountValue: 0 })] });
  await assert.rejects(lookup(exempt), /Update the desktop app/);
  const sameAmounts = settings({ ...rule, Rates: [selectedRate('same', { DiscountValue: 10 })] });
  assert.equal((await lookup(sameAmounts)).rules.length, 1);
  const overview = { accounts: [{ ...account, BillingDiscount: policy }, { ...account, Term: 'Second Term', BillingDiscount: policy }] };
  assert.deepEqual(desktopBillingOverview(overview).accounts.map(row => row.BillingDiscount.DiscountValue), [25, 10]);
  assert.equal(desktopBillingOverview(overview, 1), overview);
  assert.equal(overview.accounts[0].BillingDiscount.DiscountValue, 10);
});

test('rate edits and deletion preserve the default and other rates, reject overlaps, and retry without a second audit', async () => {
  const h = settings({ ...rule, __updateTime: 'v0' });
  const save = (fields, recordVersion) => handleBillingDiscounts({}, h.user, { action: 'save', Name: rule.Name, recordVersion, ...fields }, h.deps);
  const first = selectedRate('A', { ClassNames: ['Grade 8', 'Grade 7', 'Grade 8'] });
  const second = selectedRate('B', { TermNames: ['Summer Term'] });
  const created = await save(first, 'v0');
  assert.equal(created.rule.DiscountValue, 10);
  assert.deepEqual(created.rule.Rates[0].ClassNames, ['Grade 7', 'Grade 8']);
  assert.equal((await save({ ...first, ClassNames: ['Grade 7', 'Grade 8'] }, 'v0')).changed, false);
  await assert.rejects(save(second, 'v0'), /Reload/);
  await save(second, 'v1');
  await assert.rejects(save(selectedRate('C', { TermScope: 'All', TermNames: [] }), 'v2'), /overlaps/);
  await assert.rejects(save(selectedRate('C', { ClassScope: 'All', ClassNames: [] }), 'v2'), /overlaps/);
  for (const changes of [{ ClassNames: [] }, { TermNames: [] }, { ClassNames: ['*'] }, { TermNames: ['All'] },
    { ClassNames: ['Retired'] }, { TermNames: ['Foreign'] }, { ClassScope: 'All', ClassNames: [], TermScope: 'All', TermNames: [] }]) {
    await assert.rejects(save(selectedRate('C', changes), 'v2'));
  }
  // A legacy client's default-rate change keeps scoped rates intact.
  const updated = await save({ DiscountType: 'Percentage', DiscountValue: 5 }, 'v2');
  assert.equal(updated.rule.Rates.length, 2); assert.equal(updated.rule.DiscountValue, 5);
  h.classes.splice(h.classes.indexOf('Grade 8'), 1);
  const retained = await save({ RateId: 'A', DiscountType: 'Fixed amount', DiscountValue: 100 }, 'v3');
  assert.deepEqual(retained.rule.Rates[0].ClassNames, ['Grade 7', 'Grade 8']);
  assert.deepEqual(retained.rule.Rates[0].TermNames, ['First Term']);
  const trimmed = await save({ ...first, ClassNames: ['Grade 7'] }, 'v4');
  assert.deepEqual(trimmed.rule.Rates[0].ClassNames, ['Grade 7']);
  await assert.rejects(save(first, 'v5'), /available in this branch/);
  await assert.rejects(save({ RateId: 'A', RemoveRate: true }, 'v4'), /Reload/);
  const removed = await save({ RateId: 'A', RemoveRate: true }, 'v5');
  assert.deepEqual(removed.rule.Rates.map(rate => rate.RateId), ['B']); assert.equal(removed.rule.DiscountValue, 5);
  assert.equal((await save({ RateId: 'A', RemoveRate: true }, 'v5')).changed, false);
  assert.equal(h.commits.length, 6); assert.equal(h.commits[5][1].data.Before.Rates.length, 2);
  assert.equal(h.commits[5][1].data.After.Rates.length, 1);
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
test('preview and missing-charge review use the rate for this class and term without changing posted transactions', async () => {
  const policy = { ...rule, Rates: [selectedRate('first'), selectedRate('second', { TermNames: ['Second Term'], DiscountValue: 40 })] };
  const termFees = fees.map(item => ({ ...item, Term: 'All' }));
  for (const [ClassName, Term, expected, tuition] of [
    ['Grade 7', 'First Term', 112500, 75000], ['Grade 7', 'Second Term', 90000, 60000], ['Grade 8', 'First Term', 135000, 90000]
  ]) {
    const pupil = { ...account, ClassName, Term };
    const data = { ...period, feeItems: termFees, billingCategoryDiscounts: [policy], payments: [], accountSummaries: [], ledger: [],
      invoices: [{ ...period, ClassName: 'Grade 7', Term, AccountRef: pupil.AccountRef, InvoiceId: 'OLD', FeeCode: 'TUITION',
        Debit: 100000, Credit: 5000, FeeCategory: 'School Fee' }] };
    const before = JSON.stringify(data);
    const preview = await buildStudentBillingPreview(pupil, data);
    assert.equal(preview.expectedTotal, expected);
    const plan = await studentBillingReconciliationPlan(pupil, data);
    assert.equal(plan.conflicts.length, 1); assert.equal(plan.postingTotal, expected - tuition);
    assert.equal(JSON.stringify(data), before);
  }
  const noBase = { ...policy, DiscountType: 'None', DiscountValue: 0 };
  const missing = await buildStudentBillingPreview({ ...account, ClassName: '' }, {
    feeItems: termFees, billingCategoryDiscounts: [noBase],
    invoices: [{ ...period, ClassName: 'Grade 7', AccountRef: account.AccountRef, InvoiceId: 'HIST', FeeCode: 'TUITION', Debit: 100000 }]
  });
  assert.equal(missing.expectedTotal, 150000); assert.equal(missing.profile.ClassName, '');
});

const backend = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
test('opening or repeating discount settings does not generate another audit event', async () => {
  const endpoint = await readFile(new URL('../functions/api/billing-discounts.js', import.meta.url), 'utf8');
  assert.match(endpoint, /body.action === 'list' \|\| result.changed === false.*securityAuditNoChange = true/);
  assert.match(backend, /action === 'getBillingDiscountSettings' \|\| action === 'saveBillingDiscountSettings' && data.changed === false.*securityAuditNoChange = true/);
});
test('invoice retry reuses discounted bills and refuses changed discounts without writes', async () => {
  const block = backend.slice(backend.indexOf('async function generateSchoolFeeInvoicesForAccount('), backend.indexOf('function ledgerDocumentId('));
  let policy = rule, catalogue = fees, feeReads = 0, policyReads = 0, counter = 0; const invoices = new Map(), writes = [];
  const run = vm.runInNewContext(`(${block})`, {
    clean, lower, normalizeMatchText: lower, sameText: (a,b) => lower(a) === lower(b), sameFinancialPeriod,
    assertManualPaymentScope, scopedPaymentWriteCondition, isFullScholarship, resolveStudentEnrollmentCategory,
    normalizeFeeItem: row => row, normalizeInvoice: row => row, asMoneyNumber: v => Number(v) || 0,
    yesNo: v => lower(v) === 'yes' ? 'YES' : 'NO', applyBillingCategoryOverrides, feeMatchesApplication, isSchoolFeeInvoice,
    isWalletFee: () => false, feeBranchId, loadBillingDiscount: async () => { policyReads++; return policy; },
    loadBranchFinanceRows: async () => { feeReads++; return catalogue; },
    queryAccountRows: async (_env, _collection, ref) => [...invoices.values()].filter(invoice => invoice.AccountRef === ref),
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
  policy = rule; catalogue = [...fees, fees[0]];
  await assert.rejects(run({}, body, account.AccountRef), /Multiple fee rules/);
  assert.equal(writes.length, 3);
  catalogue = fees;
  invoices.set('LEGACY-DUPLICATE', { ...invoices.values().next().value, InvoiceId: 'LEGACY-DUPLICATE' });
  await assert.rejects(run({}, body, account.AccountRef), /Multiple existing invoices/);
  assert.equal(writes.length, 3); assert.equal(invoices.size, 4, 'existing duplicate records are preserved for review');
  // A single policy read serves the whole generation batch regardless of whose
  // class and term are encountered first. The selected rate belongs to each bill.
  policy = { ...rule, DiscountType: 'None', DiscountValue: 0, Rates: [selectedRate('g7-first'),
    selectedRate('g7-second', { TermNames: ['Second Term'], DiscountValue: 50 })] };
  catalogue = fees.map(item => ({ ...item, Term: 'All' }));
  const learners = [['Grade 8', 'First Term', 150000], ['Grade 7', 'First Term', 112500],
    ['Grade 7', 'Second Term', 75000], ['', 'First Term', 150000]];
  for (const order of [learners, [...learners].reverse()]) {
    const shared = new Map(), readsBefore = policyReads;
    for (const [ClassName, Term, expected] of order) {
      const ref = `TEST/25/BATCH-${counter}`;
      const pupil = { ...account, AdmissionNo: ref, AccountRef: ref, ClassName, Term };
      await run({}, { ...body, ResolvedStudent: pupil }, ref, null, shared);
      const bills = [...invoices.values()].filter(item => item.AccountRef === ref);
      assert.equal(bills.reduce((sum, invoice) => sum + invoice.Debit, 0), expected);
    }
    assert.equal(policyReads, readsBefore + 1);
  }
});
