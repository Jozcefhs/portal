import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onlineCollectionsPage, onlineCollectionsFilters } from '../functions/lib/online-collections-page.js';
import { buildGatewayCollectionsReport } from '../functions/api/backend.js';
import { prepareSecurityAudit, shouldPersistSecurityAudit } from '../functions/lib/security-audit.js';

const env = { FIREBASE_PROJECT_ID: 'test-payments', FIREBASE_PRIVATE_KEY: 'fixture-only' };
const actor = { UserUsername: 'accounts', UserRole: 'Accounts Officer', UserBranchId: 'main', BranchId: 'main' };
const makePayment = (id, extra = {}) => ({ __name: `projects/test-payments/databases/(default)/documents/payments/${id}`,
  PaymentId: id, Reference: id, Gateway: 'Paystack', PaidAt: '2026-11-02T12:00:00Z', BranchId: 'main',
  Amount: 1000, GrossAmount: 1020, GatewayFee: 20, NetAmount: 1000, Status: 'Paid', ...extra });
const charge = { Reference: 'p1', Date: '2026-11-02', GrossCollection: 1020, Amount: 20, NetSettlement: 1000, Source: 'Wallet Topup' };
function fixture(rows = {}) {
  const calls = [];
  return { calls, queryCollection: async (_env, collection, options) => { calls.push({ collection, ...options }); return rows[collection] || []; } };
}
const page = (body, db, settings = env) => onlineCollectionsPage(settings, body, buildGatewayCollectionsReport, db);

test('opening without dates reads only two limited payment indexes and deduplicates totals', async () => {
  const db = fixture({ payments: [makePayment('p1'), makePayment('free', { GrossAmount: 500, Amount: 500, NetAmount: 500, GatewayFee: 0 })], paymentGatewayCharges: [charge] });
  const result = await page(actor, db);
  assert.equal(result.ok, true);
  assert.equal(result.gatewayReport.onlineTransactions.length, 2);
  assert.equal(result.gatewayReport.summary.GrossCollections, 1520);
  assert.equal(result.gatewayReport.summary.PaystackCharges, 20);
  assert.equal(result.gatewayReport.summary.NetSettlements, 1500);
  assert.equal(result.nextPageToken, '');
  assert.equal(result.totalsScope, 'loaded-records');
  assert.equal(db.calls.length, 2);
  assert.deepEqual(db.calls.map(c => c.collection), ['payments', 'paymentGatewayCharges']);
  for (const call of db.calls) {
    assert.equal(call.limit, 51);
    assert.equal(call.readTime, result.readTime);
    assert.deepEqual(call.orderBy.map(order => order.direction), ['DESCENDING', 'DESCENDING']);
    assert.equal(call.orderBy[1].field, '__name__');
  }
});

test('optional dates are validated before reads; other finance filters do not hide online payments', async () => {
  assert.deepEqual(onlineCollectionsFilters({ AcademicSession: '2025/2026', Term: 'First Term', Department: 'Clinic' }), { DateFrom: '', DateTo: '' });
  assert.deepEqual(onlineCollectionsFilters({ FinancialYear: '2026' }), { DateFrom: '2026-01-01', DateTo: '2026-12-31' });
  for (const filter of [{ DateFrom: '2026-01-01' }, { DateFrom: '2026-02-30', DateTo: '2026-03-01' }, { FinancialYear: 'no' }]) {
    const db = fixture();
    await assert.rejects(page({ ...actor, ...filter }, db), { status: 400 });
    assert.equal(db.calls.length, 0);
  }
  const db = fixture();
  await page({ ...actor, DateFrom: '2026-10-01', DateTo: '2026-11-03' }, db);
  for (const call of db.calls) assert.deepEqual(call.filters.slice(-2).map(f => f.value), ['2026-10-01', '2026-11-03\uf8ff']);
});

test('branch isolation retains legacy Main charges and rejects unauthorized branch requests', async () => {
  const result = await page(actor, fixture({ payments: [makePayment('main'), makePayment('other', { BranchId: 'west' })], paymentGatewayCharges: [charge] }));
  assert.deepEqual(result.gatewayReport.onlineTransactions.map(row => row.Reference).sort(), ['main', 'p1']);
  const db = fixture();
  await assert.rejects(page({ ...actor, BranchId: 'west' }, db), { status: 403 });
  assert.equal(db.calls.length, 0);
  await page({ ...actor, BranchId: 'west', UserBranchId: 'west' }, db);
  assert.ok(db.calls.every(c => c.filters.some(f => f.field === 'BranchId' && f.value === 'west')));
  const all = await page({ ...actor, UserBranchId: '', BranchId: 'all' }, fixture({ payments: [makePayment('main'), makePayment('other', { BranchId: 'west' })] }));
  assert.equal(all.gatewayReport.onlineTransactions.length, 2);
});

test('Load more uses an encrypted branch-bound cursor and never rereads a completed source', async () => {
  const db = fixture({ payments: Array.from({ length: 51 }, (_, i) => makePayment(`p${i}`)) });
  const first = await page(actor, db);
  assert.equal(first.gatewayReport.onlineTransactions.length, 50);
  assert.ok(first.nextPageToken);
  assert.ok(!first.nextPageToken.includes('payments'));
  const secondDb = fixture({ payments: [makePayment('p50')] });
  const second = await page({ ...actor, PageToken: first.nextPageToken }, secondDb);
  assert.equal(second.readTime, first.readTime);
  assert.equal(secondDb.calls.length, 1);
  assert.equal(secondDb.calls[0].startAfterName, makePayment('p49').__name);
  assert.equal(secondDb.calls[0].startAfterFieldValue, makePayment('p49').PaidAt);
  assert.equal(second.nextPageToken, '');
  for (const [body, settings] of [
    [{ ...actor, UserUsername: 'someone' }, env],
    [{ ...actor, UserBranchId: '', BranchId: 'all' }, env],
    [{ ...actor, DateFrom: '2026-01-01', DateTo: '2026-12-31' }, env],
    [actor, { ...env, FIREBASE_PROJECT_ID: 'another' }]
  ]) {
    const rejected = fixture();
    await assert.rejects(page({ ...body, PageToken: first.nextPageToken }, rejected, settings), { status: 400 });
    assert.equal(rejected.calls.length, 0);
  }
  const rejected = fixture();
  await assert.rejects(page({ ...actor, PageToken: 'corrupt' }, rejected), { status: 400 });
  assert.equal(rejected.calls.length, 0);
  const now = Date.now;
  try {
    Date.now = () => now() + 51 * 60000;
    await assert.rejects(page({ ...actor, PageToken: first.nextPageToken }, rejected), { status: 400 });
  } finally { Date.now = now; }
  assert.equal(rejected.calls.length, 0);
});

test('a failed source fails the page instead of presenting partial financial totals', async () => {
  await assert.rejects(page(actor, { queryCollection: async (_env, collection) => {
    if (collection === 'paymentGatewayCharges') throw Error('Database unavailable');
    return [makePayment('p1')];
  } }), /Database unavailable/);
});

test('automatic reads create no duplicate business audit entries; access denials stay auditable', async () => {
  const prepared = await prepareSecurityAudit(new Request('https://example.test/api/backend', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'getOnlineCollections' })
  }), '/api/backend');
  assert.equal(shouldPersistSecurityAudit(prepared, null, 200), false);
  assert.equal(shouldPersistSecurityAudit(prepared, null, 403), true);
});

test('route verifies identity and accounting access; every edition includes its paging indexes', () => {
  const source = readFileSync(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
  assert.match(source, /VERIFIED_ACTOR_ACTIONS[\s\S]*?'getOnlineCollections'/);
  assert.match(source, /case 'getOnlineCollections':\s*requireAccountingRole\(body, \['Super Admin', 'Accounts Officer', 'Management'\]\);\s*return onlineCollectionsPage/);
  for (const edition of ['school', 'church', 'organization']) {
    const indexes = JSON.parse(readFileSync(new URL(`../firestore.${edition}.indexes.json`, import.meta.url))).indexes;
    for (const [collection, fields] of [['payments', ['Gateway', 'PaidAt']], ['payments', ['BranchId', 'Gateway', 'PaidAt']], ['paymentGatewayCharges', ['BranchId', 'Date']]]) {
      assert.ok(indexes.some(index => index.collectionGroup === collection && JSON.stringify(index.fields.map(f => f.fieldPath)) === JSON.stringify(fields)), `${edition}: ${collection} ${fields}`);
    }
  }
});
