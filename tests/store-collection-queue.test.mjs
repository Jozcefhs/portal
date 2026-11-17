import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { historyDateRange, loadDatedHistory } from '../functions/lib/history-date-range.js';

const source = (await readFile(new URL('../functions/api/staff-stores.js', import.meta.url), 'utf8'))
  .replace(/^import[\s\S]*?from '[^']+';\r?\n/gm, '').replace(/^export /gm, '');
const user = { username: 'store-clerk', branchId: 'main', schoolSectionAccess: 'Secondary',
  edition: 'school', allowedSections: ['uniformStore', 'bookstore', 'organizationStore'] };
const order = (id, extra = {}) => ({ __id: id, OrderNo: id, BranchId: 'main', SchoolSection: 'Secondary',
  StoreType: 'Uniform Store', Status: 'Paid - Awaiting Collection', CreatedAt: '2026-09-01', ...extra });
const matches = (row, { field, op, value }) => op === 'in' ? value.includes(row[field])
  : op === '>=' ? row[field] >= value : op === '<=' ? row[field] <= value : row[field] === value;

function harness(rows, staff = user) {
  const reads = [];
  const list = async (_env, collection, branch, options) => {
    assert.equal(collection, 'storeOrders');
    assert.equal(branch, staff.branchId);
    assert.ok(options.filters?.length, 'never read all order history');
    reads.push(structuredClone(options));
    // Deliberately emulate legacy branch coverage: the endpoint must still enforce scope.
    return rows.filter(row => options.filters.every(filter => matches(row, filter)));
  };
  const rejectWrite = () => { throw new Error('Opening a collection queue must not write'); };
  const context = vm.createContext({ Response, console,
    requireFirestoreEnv() {}, requireStaffSession: async () => staff,
    readJsonBody: request => request.json(), historyDateRange,
    listBranchCollection: list,
    loadDatedHistory: (env, collection, body, field, branch) => loadDatedHistory(env, collection, body, field, branch, { listBranchCollection: list }),
    ensureStoreCategories: async () => ({ categories: [], items: [] }),
    loadProcurementInventoryControl: async () => false,
    withVendorStorePolicy: async (_env, _user, items) => items,
    listOrganizationCommerceSales: async () => [],
    categoryApplies: () => true,
    schoolSectionFor: row => String(row.SchoolSection || 'Secondary').toLowerCase(),
    upsertDocument: rejectWrite, batchCommitDocuments: rejectWrite
  });
  vm.runInContext(source, context);
  return { reads, async request(body = {}) {
    const response = await context.onRequestPost({ env: {}, request: new Request('https://example.test/api/staff-stores', {
      method: 'POST', body: JSON.stringify({ action: 'list', section: 'uniformStore', ...body })
    }) });
    return { status: response.status, ...await response.json() };
  } };
}

test('opening a school store shows old and new paid orders without reading completed history or writing', async () => {
  const h = harness([order('old'), order('ready', { Status: 'Ready for Collection' }),
    order('collected', { Status: 'Collected' }), order('unpaid', { Status: 'Pending' })]);
  const result = await h.request();
  assert.equal(result.status, 200);
  assert.deepEqual(result.orders.map(row => row.OrderNo), ['old', 'ready']);
  assert.equal(h.reads.length, 1);
  assert.equal(h.reads[0].maxRows, 10000);
  assert.ok(h.reads[0].filters.some(filter => filter.field === 'Status' && filter.op === 'in'));
});

test('date selection retains pending work outside that period and includes completed history once', async () => {
  const h = harness([order('old'), order('current', { CreatedAt: '2026-11-17' }),
    order('collected', { Status: 'Collected', CreatedAt: '2026-11-17' }),
    order('old-collected', { Status: 'Collected' })]);
  const result = await h.request({ HistoryDateRange: { fromDate: '2026-11-17', toDate: '2026-11-17' } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.orders.map(row => row.OrderNo).sort(), ['collected', 'current', 'old']);
  assert.equal(h.reads.length, 2);
});

test('current work respects branch, section, store and edition boundaries even with legacy reads', async () => {
  const h = harness([order('own'), order('other-branch', { BranchId: 'area-1-primary' }),
    order('other-section', { SchoolSection: 'Primary' }), order('books', { StoreType: 'Bookstore' }),
    order('other-edition', { OrganisationEdition: 'hospital' })]);
  assert.deepEqual((await h.request()).orders.map(row => row.OrderNo), ['own']);
});

test('Bookstore and Organisation Store use the same status-bounded collection queue', async () => {
  for (const [section, StoreType] of [['bookstore', 'Bookstore'], ['organizationStore', 'Organisation Store']]) {
    const h = harness([order('own', { StoreType }), order('uniform')]);
    assert.deepEqual((await h.request({ section })).orders.map(row => row.OrderNo), ['own']);
    assert.equal(h.reads.length, 1);
  }
});

test('history-only requests remain date gated and never silently load the current queue', async () => {
  const h = harness([order('pending'), order('collected', { Status: 'Collected' })]);
  assert.deepEqual((await h.request({ historyKind: 'orders' })).rows, []);
  assert.equal(h.reads.length, 0);
  const result = await h.request({ historyKind: 'orders', HistoryDateRange: { fromDate: '2026-09-01', toDate: '2026-09-01' } });
  assert.equal(result.rows.length, 2);
  assert.equal(h.reads.length, 1);
});

test('invalid dates and denied module access do not read orders', async () => {
  const h = harness([]);
  assert.equal((await h.request({ HistoryDateRange: { fromDate: '2026-11-17' } })).status, 400);
  assert.equal(h.reads.length, 0);
  const denied = harness([], { ...user, allowedSections: [] });
  assert.equal((await denied.request()).status, 403);
  assert.equal(denied.reads.length, 0);
});

test('collection queue follows the assigned branch for every branch', async () => {
  const h = harness([order('main'), order('area-1', { BranchId: 'area-1-primary' })], { ...user, branchId: 'area-1-primary' });
  assert.deepEqual((await h.request()).orders.map(row => row.OrderNo), ['area-1']);
});
