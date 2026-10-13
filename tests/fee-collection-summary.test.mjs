import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { feeCollectionDate, feeCollectionScope, summarizeFeeCollectionRows, getFeeCollectionSummaryPage } from '../functions/lib/fee-collection-summary.js';

const user = { username: 'finance', assignedRole: 'Accounts Officer', allowedSections: ['accounts'], branchId: 'main', schoolSectionAccess: 'All', edition: 'school' };
const period = { dateFrom: '2026-10-01', dateTo: '2026-10-31' };
const scope = feeCollectionScope(user, period);
const payment = { __id: 'P1', Reference: 'P1', BranchId: 'main', SchoolSection: 'secondary', FeeCode: 'TUITION', FeeName: 'Tuition',
  FeeCategory: 'School Fee', Currency: 'NGN', Amount: 14000, GrossAmount: 14000, GatewayFee: 0, PaidAt: '2026-10-10T12:00:00Z', Status: 'Paid', ProcessingStatus: 'Completed' };
const uiContext = vm.createContext({ Intl, Map, Set, JSON });
vm.runInContext(readFileSync(new URL('../js/fee-collection-summary.js', import.meta.url), 'utf8'), uiContext);
const ui = uiContext.DynamaxFeeCollectionSummary;

test('period validation and Lagos midnight boundaries', () => {
  assert.equal(feeCollectionDate('2026-09-30T23:30:00Z'), '2026-10-01');
  assert.equal(feeCollectionDate('2026-10-31T23:00:00Z'), '2026-11-01');
  assert.equal(feeCollectionDate('2026-10-31T23:00:00'), '2026-10-31');
  assert.equal(feeCollectionDate('2026-10-31 23:00:00'), '2026-10-31');
  assert.equal(feeCollectionDate('2026-10-31T99:00:00'), '');
  assert.equal(feeCollectionDate('2026-02-30'), '');
  assert.throws(() => feeCollectionScope(user, { ...period, dateTo: '2026-09-01' }), /valid/);
  assert.throws(() => feeCollectionScope(user, { ...period, dateFrom: '2026-10-01T00:00:00Z' }), /valid/);
});
test('authoritative finance role, module and branch access enforced across editions', () => {
  for (const edition of ['school', 'faith', 'organization']) {
    assert.equal(feeCollectionScope({ ...user, edition, allowedSections: ['incomeAnalytics'] }, period).edition, edition);
  }
  for (const actor of [{ ...user, username: '' }, { ...user, assignedRole: 'Teacher' }, { ...user, allowedSections: [] }]) {
    assert.throws(() => feeCollectionScope(actor, period), error => error.status === 403);
  }
  assert.throws(() => feeCollectionScope(user, { ...period, branchId: 'other' }), error => error.status === 403);
});
test('only completed, dated, in-scope fee receipts count; wallet deposits do not', () => {
  const result = summarizeFeeCollectionRows('payments', [payment,
    { ...payment, BranchId: 'other' }, { ...payment, Status: 'Rejected' }, { ...payment, Status: 'Pending' },
    { ...payment, ProcessingStatus: 'Started' }, { ...payment, PaidAt: '2026-11-01' },
    { ...payment, PaidAt: '' }, { ...payment, FeeCode: 'WALLET_TOPUP', FeeCategory: 'Wallet' }], scope);
  assert.equal(result.rows[0].receipts, 1);
  assert.equal(result.rows[0].grossCents, 1400000);
  assert.deepEqual(result.warnings, { undated: 1, unfinished: 1, walletsExcluded: 1 });
  const restricted = { ...scope, schoolSection: 'primary' };
  assert.deepEqual(summarizeFeeCollectionRows('payments', [payment, { ...payment, SchoolSection: '' }], restricted).rows, []);
});
test('catalogue retains zero components; currencies stay separate; combined receipts are not invented allocations', () => {
  const catalogue = summarizeFeeCollectionRows('feeItems', [{ FeeCode: 'ZERO', FeeName: 'Unused' }], scope);
  assert.equal(catalogue.rows[0].grossCents, 0);
  const result = summarizeFeeCollectionRows('payments', [payment, { ...payment, Currency: 'USD' },
    { ...payment, FeeCode: 'SCHOOL_FEES_TOTAL', FeeItems: [{ FeeCode: 'BOW', Amount: 999999 }] }], scope);
  assert.equal(result.rows.length, 3);
  assert.equal(result.rows.some(row => row.code === 'BOW'), false);
  assert.equal(summarizeFeeCollectionRows('payments', [{ ...payment, Status: undefined }], scope).rows[0].receipts, 1);
});
test('malformed financial figures fail instead of silently producing incorrect totals', () => {
  for (const change of [{ Amount: 'broken' }, { GrossAmount: -10 }, { GrossAmount: 1e20 }, { Currency: '<NGN>' }, { GatewayFee: 15000 }]) {
    assert.throws(() => summarizeFeeCollectionRows('payments', [{ ...payment, ...change }], scope), error => error.status === 409);
  }
});
function fixture() {
  const calls = [];
  const io = {
    list: async (_env, collection, options) => {
      calls.push({ collection, ...options });
      if (collection === 'feeItems') return { documents: [{ FeeCode: 'TUITION', FeeName: 'Tuition' }, { FeeCode: 'ZERO', FeeName: 'No receipts' }], nextPageToken: '' };
      if (collection === 'payments') return options.pageToken ? { documents: [{ ...payment, Currency: 'USD', GrossAmount: 100, Amount: 100 }], nextPageToken: '' }
        : { documents: [{ ...payment, CorrectionTotal: 4000 }], nextPageToken: 'p2' };
      return { documents: [{ Reference: 'P1', OriginalPaymentId: 'P1', Amount: 4000, RecordedAt: '2026-10-13', BranchId: 'main', SchoolSection: 'secondary' }], nextPageToken: '' };
    },
    query: async (_env, collection, options) => { calls.push({ collection, ...options }); return [payment]; }
  };
  return { io, calls };
}
test('all pages use one snapshot; corrections counted once on correction date; currency totals and exports agree', async () => {
  const { io, calls } = fixture();
  const report = await ui.loadReport(body => getFeeCollectionSummaryPage({}, user, body, io), period);
  const ngn = report.totals.find(row => row.currency === 'NGN');
  assert.equal(ngn.grossCents, 1400000);
  assert.equal(ngn.correctionCents, 400000);
  assert.equal(report.totals.find(row => row.currency === 'USD').grossCents, 10000);
  assert.equal(report.rows.find(row => row.code === 'ZERO').receipts, 0);
  assert.ok(calls.filter(call => call.query).every(call => call.query === `readTime=${encodeURIComponent(report.readTime)}`));
  assert.ok(calls.filter(call => call.readTime).every(call => call.readTime === report.readTime));
  assert.match(ui.csv(report), /10,000.00/);
  assert.match(ui.printHtml(report), /10,000.00/);
});
test('correction of an older receipt appears only in the correction period', async () => {
  const { io } = fixture();
  io.query = async () => [{ ...payment, PaidAt: '2026-09-01' }];
  const page = await getFeeCollectionSummaryPage({}, user, { ...period, collection: 'manualPaymentCorrections', readTime: new Date().toISOString() }, io);
  assert.equal(page.rows[0].correctionCents, 400000);
  assert.equal(page.rows[0].grossCents, 0);
});
test('unverifiable corrections, expired snapshots and arbitrary collections fail closed', async () => {
  const { io } = fixture();
  io.query = async () => [];
  await assert.rejects(getFeeCollectionSummaryPage({}, user, { ...period, collection: 'manualPaymentCorrections', readTime: new Date().toISOString() }, io), /verified/);
  await assert.rejects(getFeeCollectionSummaryPage({}, user, { ...period, readTime: '2020-01-01T00:00:00.000Z' }, io), /expired/);
  await assert.rejects(getFeeCollectionSummaryPage({}, user, { ...period, collection: 'staffUsers' }, io), /collection/);
});
test('failed pages, repeated cursors and scope changes cannot return partial totals', async () => {
  const { io } = fixture();
  await assert.rejects(ui.loadReport(async body => { if (body.collection === 'payments') throw Error('Offline'); return getFeeCollectionSummaryPage({}, user, body, io); }, period), /Offline/);
  const page = await getFeeCollectionSummaryPage({}, user, period, io);
  await assert.rejects(ui.loadReport(async () => page, period), /repeated/);
  let count = 0;
  await assert.rejects(ui.loadReport(async body => { const result = await getFeeCollectionSummaryPage({}, user, body, io); if (count++) result.scope.branchId = 'other'; return result; }, period), /scope/);
});
test('CSV neutralizes formulas and print output escapes HTML', async () => {
  const { io } = fixture();
  const report = await ui.loadReport(body => getFeeCollectionSummaryPage({}, user, body, io), period);
  report.rows[0].name = '=HYPERLINK("bad")'; report.rows[0].code = '<script>alert(1)</script>';
  assert.match(ui.csv(report), /'=HYPERLINK/);
  assert.ok(!ui.printHtml(report).includes('<script>'));
  assert.match(ui.printHtml(report), /&lt;script&gt;/);
});
test('web and desktop register authenticated, shared reporting for all editions', () => {
  const admin = readFileSync(new URL('../js/admin.js', import.meta.url), 'utf8');
  assert.equal((admin.match(/key: 'feeSummary'/g) || []).length, 2);
  const backend = readFileSync(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
  assert.match(backend, /VERIFIED_ACTOR_ACTIONS = new Set\(\[[^\]]*'getFeeCollectionSummary'/);
  assert.match(backend, /BRANCH_BOUND_DEVICE_ACTIONS = new Set\(\[[^\]]*'getFeeCollectionSummary'/);
  assert.match(backend, /case 'getFeeCollectionSummary'/);
  const endpoint = readFileSync(new URL('../functions/api/fee-collection-summary.js', import.meta.url), 'utf8');
  assert.match(endpoint, /requireStaffSession/); assert.match(endpoint, /no-store/);
});
