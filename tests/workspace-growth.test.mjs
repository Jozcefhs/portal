import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { collectWorkspaceCollectionPages } from '../functions/lib/firestore.js';
import { loadWorkspaceHistoryPage } from '../functions/lib/workspace-history.js';

for (const collection of ['tuckShopMovements', 'clinicRecords', 'clinicMovements', 'kitchenMovements', 'restaurantMovements',
  'storeOrders', 'organizationCommerceSales', 'hrLeaveRequests', 'hrLifecycleRecords', 'payrollItems', 'staffUsers',
  'accountingExpenses', 'accountingSupplierBills', 'libraryLoans', 'church/main/members', 'hotelReservations']) {
  test(`${collection}: complete reads traverse more than five pages without losing records`, async () => {
    let calls = 0;
    const rows = await collectWorkspaceCollectionPages(async token => {
      assert.equal(token, calls ? `page-${calls}` : '');
      const offset = calls++ * 1000;
      return { documents: Array.from({ length: 1000 }, (_, i) => ({ __id: `${offset + i}`, Amount: 1 })),
        nextPageToken: calls < 7 ? `page-${calls}` : '' };
    }, collection);
    assert.equal(calls, 7);
    assert.equal(rows.length, 7000);
    assert.equal(new Set(rows.map(row => row.__id)).size, 7000);
    assert.equal(rows.reduce((sum, row) => sum + row.Amount, 0), 7000);
  });
}

test('complete reads fail closed on memory, row, explicit page, upstream and cursor failures', async () => {
  for (const options of [{ maxBytes: 1 }, { maxRows: 1 }, { maxPages: 1 }]) {
    let count = 0;
    await assert.rejects(collectWorkspaceCollectionPages(async () => ({ documents: [{ __id: String(++count) }, { __id: '2' }], nextPageToken: `next-${count}` }), 'history', options),
      { code: 'FIRESTORE_PAGINATION_REQUIRED' });
  }
  await assert.rejects(collectWorkspaceCollectionPages(async () => ({ documents: [], nextPageToken: 'same' }), 'history'), /repeated page token/);
  await assert.rejects(collectWorkspaceCollectionPages(async token => {
    if (token) throw new Error('network failure');
    return { documents: [{ Amount: 2 }], nextPageToken: 'next' };
  }, 'history'), /network failure/);
  await assert.rejects(collectWorkspaceCollectionPages(async () => ({}), 'history'), /Incomplete database page/);
  await assert.rejects(collectWorkspaceCollectionPages(async token => ({ documents: [{ __id: 'same-record' }], nextPageToken: token ? '' : 'next' }), 'history'), /repeated a record/);
});

test('listCollection pins a snapshot and preserves explicit single-page calls', async () => {
  const source = await readFile(new URL('../functions/lib/firestore.js', import.meta.url), 'utf8');
  const calls = [];
  const context = { URLSearchParams, TextEncoder,
    MAX_COMPLETE_LIST_BYTES: 16 * 1024 * 1024, MAX_COMPLETE_LIST_ROWS: 100000,
    clean: value => String(value ?? '').trim(), listOptions: value => typeof value === 'string' ? { query: value } : value || {},
    listCollectionPage: async (_env, _path, options) => {
      calls.push(options);
      return { documents: [{ __id: String(calls.length) }], nextPageToken: calls.length % 2 ? 'second' : '' };
    } };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('export async function listCollection('), source.indexOf('// Financial reports retain'))
    .replaceAll('export ', ''), context);
  assert.equal((await context.listCollection({}, 'history')).length, 2);
  const first = new URLSearchParams(calls[0].query), second = new URLSearchParams(calls[1].query);
  assert.ok(first.get('readTime'));
  assert.equal(first.get('readTime'), second.get('readTime'));
  await context.listCollection({}, 'history', { singlePage: true, pageSize: 7 });
  assert.equal(calls.length, 3);
  assert.equal(calls[2].pageSize, 7);
});

const user = { username: 'cashier', role: 'Staff', branchId: 'main', schoolSectionAccess: 'Secondary', edition: 'school' };
const env = { FIREBASE_PROJECT_ID: 'test-project' };
const config = { key: 'tuckShop:movements', collection: 'tuckShopMovements', visible: row => row.BranchId === 'main' };

test('history traverses all 6200 records in bounded requests, including legacy undated rows', async () => {
  const source = Array.from({ length: 6200 }, (_, i) => ({ __id: `movement-${i}`, BranchId: i % 2 ? 'other' : 'main' }));
  let calls = 0, cursor = null;
  const found = [];
  const db = { listCollectionPage: async (_env, collection, options) => {
    calls++;
    assert.equal(collection, config.collection);
    assert.equal(new URLSearchParams(options.query).get('orderBy'), '__name__ desc');
    assert.ok(options.pageSize <= 100);
    const start = Number(options.pageToken || 0), end = Math.min(start + options.pageSize, source.length);
    return { documents: source.slice(start, end), nextPageToken: end < source.length ? String(end) : '' };
  } };
  do {
    const before = calls;
    const page = await loadWorkspaceHistoryPage(env, user, config, cursor, db);
    assert.ok(calls - before <= 4);
    assert.ok(page.rows.length <= 100);
    found.push(...page.rows);
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(found.length, 3100);
  assert.equal(new Set(found.map(row => row.__id)).size, 3100);
  assert.ok(found.every(row => row.BranchId === 'main'));
});

test('filtered empty history pages continue and cursor is bound to user, edition, branch, collection and snapshot', async () => {
  let count = 0;
  const db = { listCollectionPage: async () => ({ documents: [{ BranchId: 'other' }], nextPageToken: String(++count) }) };
  const page = await loadWorkspaceHistoryPage(env, user, config, null, db);
  assert.equal(count, 4);
  assert.equal(page.rows.length, 0);
  assert.ok(page.nextCursor);
  for (const modified of [{ branchId: 'other' }, { username: 'other' }, { schoolSectionAccess: 'Primary' }, { edition: 'faith' }, { role: 'Vendor User' }]) {
    await assert.rejects(loadWorkspaceHistoryPage(env, { ...user, ...modified }, config, page.nextCursor, db), { status: 400 });
  }
  await assert.rejects(loadWorkspaceHistoryPage({ FIREBASE_PROJECT_ID: 'other' }, user, config, page.nextCursor, db), { status: 400 });
  await assert.rejects(loadWorkspaceHistoryPage(env, user, { ...config, collection: 'clinicRecords' }, page.nextCursor, db), { status: 400 });
  await assert.rejects(loadWorkspaceHistoryPage(env, user, config, { ...page.nextCursor, readTime: '2000-01-01' }, db), { status: 400 });
  assert.equal(count, 4, 'invalid cursors rejected before database access');
});

test('history rejects malformed responses and stalled cursors', async () => {
  await assert.rejects(loadWorkspaceHistoryPage(env, user, config, null, { listCollectionPage: async () => ({}) }), /incomplete page/);
  await assert.rejects(loadWorkspaceHistoryPage(env, user, config, null, { listCollectionPage: async () => ({ documents: [], nextPageToken: 'same' }) }), /could not advance/);
});

test('operational module bootstrap performs no redundant history scans in every edition', async () => {
  const source = await readFile(new URL('../functions/api/admin.js', import.meta.url), 'utf8');
  const sections = ['clinic', 'kitchen', 'restaurant', 'tuckShop', 'bookstore', 'uniformStore', 'organizationStore'];
  for (const edition of ['school', 'faith', 'organization']) {
    const context = { Response, requireFirestoreEnv: () => {},
      requireStaffSession: async () => ({ ...user, edition, allowedSections: sections }),
      readJsonBody: async request => request,
      listCollection: () => { throw new Error('Unexpected full collection read'); },
      listCollectionForReport: () => { throw new Error('Unexpected report scan'); } };
    vm.createContext(context);
    vm.runInContext(source.replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/^export /gm, ''), context);
    for (const section of sections) {
      const response = await context.onRequestPost({ env: {}, request: { section } });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.summaryDeferred, true);
      assert.deepEqual(result.departments, { [section]: {} });
    }
    assert.equal((await context.onRequestPost({ env: {}, request: { section: 'unassigned' } })).status, 403);
  }
});

test('department list and continuation endpoints apply scope and return bounded public rows', async () => {
  const source = await readFile(new URL('../functions/api/staff-departments.js', import.meta.url), 'utf8');
  const actor = { ...user, allowedSections: ['clinic', 'kitchen', 'restaurant', 'tuckShop'] };
  const calls = [];
  const context = { Response, requireFirestoreEnv: () => {}, requireStaffSession: async () => actor,
    readJsonBody: async request => request, schoolSectionFor: row => String(row.SchoolSection || 'Secondary').toLowerCase(),
    listCollection: async (_env, collection) => {
      assert.match(collection, /Inventory$/);
      return [{ __id: 'item', BranchId: 'main', SchoolSection: 'Secondary' }];
    },
    loadProcurementInventoryControl: async () => false,
    listOrganizationCommerceSalesPage: async () => ({ rows: [], nextCursor: null }),
    loadWorkspaceHistoryPage: (e, u, config, cursor) => loadWorkspaceHistoryPage(e, u, config, cursor, {
      listCollectionPage: async (_env, collection, options) => {
        calls.push(collection);
        const offset = Number(options.pageToken || 0);
        return { documents: [
          { __id: String(offset), BranchId: 'main', SchoolSection: 'Secondary', EntryType: 'Wallet Purchase', WalletPinHash: 'secret', PasswordHash: 'secret' },
          { __id: `other-${offset}`, BranchId: 'other', SchoolSection: 'Secondary', EntryType: 'Wallet Purchase' }
        ], nextPageToken: String(offset + 2) };
      }
    }) };
  vm.createContext(context);
  vm.runInContext(source.replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/^export /gm, ''), context);
  const response = await context.onRequestPost({ env, request: { section: 'tuckShop', action: 'list' } });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.movements.length, 4);
  assert.equal(result.purchases.length, 4);
  assert.equal(result.movements[0].WalletPinHash, undefined);
  assert.equal(result.movements[0].PasswordHash, undefined);
  assert.ok(result.historyPaging.movements);
  const next = await context.onRequestPost({ env, request: { section: 'tuckShop', action: 'list', historyKind: 'movements', cursor: result.historyPaging.movements } });
  assert.equal(next.status, 200);
  assert.equal((await next.json()).rows[0].__id, '8');
  assert.equal((await context.onRequestPost({ env, request: { section: 'tuckShop', action: 'list', historyKind: 'staffUsers' } })).status, 400);
  assert.equal((await context.onRequestPost({ env, request: { section: 'unassigned', action: 'list' } })).status, 403);
  assert.deepEqual(new Set(calls), new Set(['tuckShopMovements', 'ledger']));
});

test('department and commerce startup use bounded history; complete-data consumers keep their contract', async () => {
  const departments = await readFile(new URL('../functions/api/staff-departments.js', import.meta.url), 'utf8');
  const loader = departments.slice(departments.indexOf('async function loadDepartment('), departments.indexOf('async function saveInventory('));
  assert.doesNotMatch(loader, /listCollection\(env, (?:config\.movements|'clinicRecords'|'ledger')/);
  assert.match(loader, /historyPaging:/);
  const commerce = await readFile(new URL('../functions/lib/organization-commerce.js', import.meta.url), 'utf8');
  assert.match(commerce, /listOrganizationCommerceSalesPage[\s\S]*?loadWorkspaceHistoryPage/);
  const admin = await readFile(new URL('../functions/api/admin.js', import.meta.url), 'utf8');
  assert.match(admin, /dedicated endpoints[\s\S]*?summaryDeferred: true/);
  const ui = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
  assert.match(ui, /Browse all history/);
  assert.match(ui, /historyKind: select\.value, cursor: cursors\[target\]/);
  assert.match(ui, /Loaded history only; use Finance for complete totals/);
  assert.match(ui, /dialog\.addEventListener\('close', \(\) => \{ generation \+= 1; dialog\.remove\(\); \}\)/);
});
