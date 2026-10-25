import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { readVendorRows, readVendorInventory } from '../functions/lib/vendor-read-scope.js';
import { branchCollectionPage, createSnapshotBranchPlanner } from '../functions/lib/branch-reads.js';
import { loadBranchFinancePage } from '../functions/lib/finance-branch-reads.js';

const strip = source => source.replace(/^import[\s\S]*?from '[^']+';\r?\n/gm, '').replace(/export /g, '');
const matches = (row, filters = []) => filters.every(f => f.op === 'in' ? f.value.includes(row[f.field]) : row[f.field] === f.value);

for (const edition of ['school', 'faith', 'organization']) {
  test(`${edition}: vendor bootstrap reads only linked owners and retains every saved field`, async () => {
    const scope = { BranchId: 'main', ScopeKey: `${edition}--main` };
    const records = Array.from({ length: 600 }, (_, i) => ({ __id: `${i}`, ...scope,
      VendorId: i < 3 ? 'mine' : 'other', Quantity: i, Amount: i * 100, History: [{ Status: 'Paid' }], OriginalScore: 0 }));
    const before = structuredClone(records), requests = [];
    const db = {
      listBranchCollection: async (_env, collection, branch, options = {}) => {
        assert.equal(branch, 'main'); requests.push({ collection, options });
        return records.filter(row => row.BranchId === branch && matches(row, options.filters));
      },
      queryCollectionPages: async (_env, collection, options) => {
        requests.push({ collection, options }); return records.filter(row => matches(row, options.filters));
      }
    };
    const inventory = await readVendorInventory({}, 'stock', 'main', ['mine', 'mine'], db);
    const balances = await readVendorRows({}, 'vendorBalances', scope, ['mine'], db);
    assert.deepEqual(inventory, records.slice(0, 3)); assert.deepEqual(balances, records.slice(0, 3));
    assert.equal(requests.length, 2); assert.deepEqual(records, before);
    requests.length = 0;
    assert.deepEqual(await readVendorInventory({}, 'stock', 'main', [], db), []);
    assert.deepEqual(await readVendorRows({}, 'vendorBalances', scope, [], db), []);
    assert.equal(requests.length, 0, 'an unlinked vendor must not scan all stock or balances');
    assert.deepEqual(await readVendorInventory({}, 'stock', 'main', null, db), records, 'management retains its complete branch stock');
  });
}

test('large linked-owner lists use bounded disjoint queries and failures never become empty successes', async () => {
  const ids = Array.from({ length: 65 }, (_, i) => `v${i}`), calls = [];
  const read = async (_env, _collection, options) => {
    const owners = options.filters.find(f => f.field === 'VendorId').value;
    calls.push(owners); assert.ok(owners.length <= 30); return owners.map(VendorId => ({ VendorId }));
  };
  const rows = await readVendorRows({}, 'requests', { ScopeKey: 'faith--north' }, [...ids, 'v0'], { queryCollectionPages: read });
  assert.equal(calls.length, 3); assert.deepEqual(rows.map(row => row.VendorId), ids);
  await assert.rejects(readVendorInventory({}, 'stock', 'main', ['v1'], {
    listBranchCollection: async () => { throw new Error('index unavailable'); }
  }), /index unavailable/);
});

test('vendor POS resolves its authorised owners once per bootstrap and keeps private data out', async () => {
  const salesSource = strip(await readFile(new URL('../functions/lib/vendor-sales.js', import.meta.url), 'utf8'));
  const accessSource = strip(await readFile(new URL('../functions/lib/vendor-sales-access.js', import.meta.url), 'utf8'));
  const rules = await import('../functions/lib/vendor-settlement-rules.js');
  const user = { role: 'Vendor User', username: 'seller', branchId: 'main', edition: 'faith', allowedSections: ['vendorSettlements', 'organizationStore'] };
  const owner = { ...rules.settlementScope(user), VendorId: 'mine', LoginUsername: 'seller', Name: 'Owned store' };
  let ownerReads = 0;
  const access = runInNewContext(`${accessSource}\n({linkedSalesVendors,restrictVendorInventoryRows})`, { ...rules,
    queryCollectionPages: async () => { ownerReads++; return [owner]; } });
  const handle = runInNewContext(`${salesSource}\nhandleVendorSalesAction`, { ...rules, ...access,
    COMMERCE_CONFIG: { organizationStore: { inventory: 'storeItems' } },
    readVendorInventory: async (_env, collection, branch, ids) => {
      assert.equal(collection, 'storeItems'); assert.equal(branch, 'main'); assert.equal(ids.join(), 'mine');
      return [{ ...owner, StoreType: 'Organisation Store', ItemName: 'Item', Quantity: 7, Price: 50, BankAccountNumber: 'secret' }];
    }, getDocument: async () => ({ Enabled: true, AccountingConfirmed: true })
  });
  const result = await handle({}, user, { action: 'salesBootstrap', Section: 'organizationStore', VendorId: 'attacker' });
  assert.equal(ownerReads, 1); assert.equal(result.products.length, 1); assert.equal(result.products[0].Quantity, 7);
  assert.doesNotMatch(JSON.stringify(result), /secret|BankAccountNumber/);
});

test('Main finance pages skip other branches, retain zero values and reject switched cursors', async () => {
  const snapshot = '2026-10-25T01:00:00.000Z';
  const records = [1, 2, 3, 4].map(i => ({ __name: `projects/p/databases/(default)/documents/payments/${i}`,
    BranchId: i === 2 ? 'north' : 'main', Amount: i === 1 ? 0 : i, History: ['preserve'] }));
  const before = structuredClone(records), calls = [];
  const db = {
    branchReadPlan: async () => ({ mode: 'indexed', field: 'BranchId', values: ['main'], readTime: snapshot }),
    queryCollection: async (_env, _collection, options) => {
      calls.push(options); return records.filter(row => matches(row, options.filters)
        && (!options.startAfterName || row.__name > options.startAfterName)).slice(0, options.limit);
    }
  };
  const deps = { branchCollectionPage: (...args) => branchCollectionPage(...args, db) };
  const options = { readTime: snapshot, pageSize: 2 };
  const first = await loadBranchFinancePage({}, 'payments', 'main', options, deps);
  const second = await loadBranchFinancePage({}, 'payments', 'main', { ...options, pageToken: first.nextPageToken }, deps);
  assert.deepEqual([...first.documents, ...second.documents], records.filter(row => row.BranchId === 'main'));
  assert.equal(first.documents[0].Amount, 0); assert.equal(second.nextPageToken, ''); assert.deepEqual(records, before);
  assert.equal(calls.length, 2);
  await assert.rejects(loadBranchFinancePage({}, 'invoices', 'main', { ...options, pageToken: first.nextPageToken }, deps), /another branch or snapshot/);
  await assert.rejects(loadBranchFinancePage({}, 'payments', 'main', { ...options, readTime: 'other', pageToken: first.nextPageToken }, deps), /another branch or snapshot/);
});

test('legacy finance pages keep untagged records and finish pre-deployment cursors', async () => {
  const records = [{ __id: 'old', Amount: 0 }, { __id: 'main', BranchId: 'main', Amount: 20 }];
  const db = {
    branchReadPlan: async () => ({ mode: 'legacy', readTime: 'snapshot' }),
    listCollectionPage: async (_env, _collection, options) => {
      assert.equal(options.query, 'readTime=snapshot');
      return { documents: options.pageToken ? records.slice(1) : records.slice(0, 1), nextPageToken: options.pageToken ? '' : 'opaque-old-token' };
    }
  };
  const deps = { ...db, branchCollectionPage: (...args) => branchCollectionPage(...args, db) };
  const first = await loadBranchFinancePage({}, 'payments', 'main', { readTime: 'snapshot' }, deps);
  const next = await loadBranchFinancePage({}, 'payments', 'main', { readTime: 'snapshot', pageToken: first.nextPageToken }, deps);
  assert.deepEqual([...first.documents, ...next.documents], records);
  const old = await loadBranchFinancePage({}, 'payments', 'main', { readTime: 'snapshot', pageToken: 'opaque-old-token' }, deps);
  assert.deepEqual(old.documents, records.slice(1));
});

test('library searches and checkout directories read only the selected borrower type', async () => {
  const source = strip(await readFile(new URL('../functions/lib/school-library.js', import.meta.url), 'utf8'));
  const calls = [], staff = [{ BranchId: 'north', Username: 'local' }, { Username: 'shared' }, { BranchId: 'south', Username: 'other' }];
  const directory = runInNewContext(`${source}\nreaderDirectory`, {
    safeScopeId: value => String(value).toLowerCase(),
    listSchoolCollection: async (_env, collection, scope) => { calls.push({ collection, scope }); return [{ Score: 0 }]; },
    listBranchCollection: async (_env, collection, branch) => { calls.push({ collection, branch }); return staff; }
  });
  const students = await directory({}, 'north', 'Student');
  assert.equal(calls.length, 1); assert.equal(calls[0].collection, 'students'); assert.equal(students.staff.length, 0);
  const employees = await directory({}, 'north', 'Staff');
  assert.equal(calls.length, 2); assert.equal(calls[1].collection, 'staffUsers'); assert.equal(employees.students.length, 0);
  assert.equal(employees.staff.map(row => row.Username).join(), 'local,shared');
});

test('Tuck Shop passes branch and section to reads and preserves existing inventory', async () => {
  const source = strip(await readFile(new URL('../functions/lib/school-tuck-shop.js', import.meta.url), 'utf8'));
  const rows = [{ BranchId: 'north', SchoolSection: 'primary', Quantity: 9, OrganisationEdition: 'school' }];
  const before = structuredClone(rows), requests = [];
  const api = runInNewContext(`${source}\n({scopedStudents,getTuckShopCatalog})`, {
    schoolSectionFor: row => row.SchoolSection,
    listSchoolCollection: async (_env, collection, scope) => { requests.push({ collection, scope }); return rows; },
    listBranchCollection: async (_env, collection, branch) => { requests.push({ collection, branch }); return rows; }
  });
  await api.scopedStudents({}, { branchId: 'north', schoolSectionAccess: 'primary' });
  const result = await api.getTuckShopCatalog({}, { branchId: 'north' });
  assert.equal(requests[0].scope.schoolSectionAccess, 'primary'); assert.equal(requests[1].branch, 'north');
  assert.equal(result.inventory[0].Quantity, 9); assert.deepEqual(rows, before);
});

test('pagination reuses only immutable snapshot proofs, isolated by project, credentials, branch and collection', async () => {
  let reads = 0, now = 0;
  const plan = createSnapshotBranchPlanner({ maxEntries: 2, maxAgeMs: 100, now: () => now });
  const env = { FIREBASE_PROJECT_ID: 'school', FIREBASE_CLIENT_EMAIL: 'reader@example.test' };
  const options = { readTime: '2026-10-25T01:00:00.000Z' };
  const db = { countCollection: async (_env, _collection, opts) => { reads++; return { count: 5, readTime: opts.readTime }; },
    getSchoolStructure: async () => ({ Branches: [{ Id: 'main' }, { Id: 'north' }] }) };
  const first = await plan(env, 'payments', 'main', options, db);
  first.values.push('tampered');
  const second = await plan(env, 'payments', 'main', options, db);
  assert.equal(reads, 2, 'one total and one canonical-coverage count for all pages');
  assert.deepEqual(second.values, ['main'], 'a caller cannot mutate the cached plan');
  for (const [runtime, collection, branch, opts] of [
    [{ ...env, FIREBASE_PROJECT_ID: 'faith' }, 'payments', 'main', options],
    [{ ...env, FIREBASE_CLIENT_EMAIL: 'other@example.test' }, 'payments', 'main', options],
    [env, 'payments', 'north', options], [env, 'invoices', 'main', options],
    [env, 'payments', 'main', { readTime: '2026-10-25T01:01:00.000Z' }]
  ]) {
    const before = reads; await plan(runtime, collection, branch, opts, db); assert.equal(reads, before + 2);
  }
  const before = reads; await plan(env, 'payments', 'main', options, db);
  assert.equal(reads, before + 2, 'old entries are evicted at the bound');
  now = 101; await plan(env, 'payments', 'main', options, db); assert.equal(reads, before + 4, 'expired plans are reproved');
  await assert.rejects(plan(env, 'failed', 'main', options, { ...db, countCollection: async () => { throw new Error('unavailable'); } }), /unavailable/);
  const recovered = await plan(env, 'failed', 'main', options, db); assert.equal(recovered.mode, 'indexed');
});
