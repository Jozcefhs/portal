import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { listBranchCollection, branchCollectionPage } from '../functions/lib/branch-reads.js';

const snapshot = '2026-10-24T10:00:00.000Z';
const noRead = async () => { throw new Error('Unexpected full collection read'); };
function fixture(input, branches = ['main', 'north']) {
  const rows = structuredClone(input).map((row, i) => ({ __id: String(i), __name: `projects/test/databases/(default)/documents/items/${i}`, ...row }));
  const calls = [];
  const matches = (row, filters = []) => filters.every(f => f.op === 'in' ? f.value.includes(row[f.field]) : row[f.field] === f.value);
  const db = {
    getSchoolStructure: async () => ({ Branches: branches.map(Id => ({ Id })) }),
    countCollection: async (_env, collection, options) => {
      calls.push({ kind: 'count', collection, options });
      if (options.filters) assert.equal(options.readTime, snapshot);
      return { count: rows.filter(row => matches(row, options.filters)).length, readTime: snapshot };
    },
    queryCollectionPages: async (_env, collection, options) => {
      assert.equal(options.readTime, snapshot); calls.push({ kind: 'query', collection, options });
      return rows.filter(row => matches(row, options.filters));
    },
    queryCollection: async (_env, collection, options) => {
      assert.equal(options.readTime, snapshot); calls.push({ kind: 'page', collection, options });
      return rows.filter(row => matches(row, options.filters) && (!options.startAfterName || row.__name > options.startAfterName)).slice(0, options.limit);
    },
    listCollection: noRead, listCollectionPage: noRead
  };
  return { db, calls, rows };
}

for (const edition of ['school', 'faith', 'organization']) {
  test(`${edition}: Main and other branches fetch only their own documents, without writes`, async () => {
    const f = fixture(Array.from({ length: 300 }, (_, i) => ({ BranchId: i < 20 ? 'main' : 'north', Score: i % 100, Answers: ['A'], Edition: edition })));
    const original = structuredClone(f.rows);
    for (const branch of ['main', 'north']) {
      const rows = await listBranchCollection({ edition }, 'items', branch, {}, f.db);
      assert.equal(rows.length, branch === 'main' ? 20 : 280);
      assert.ok(rows.every(row => row.BranchId === branch));
    }
    assert.equal(f.calls.filter(call => call.kind === 'count').length, 4);
    assert.deepEqual(f.rows, original);
  });
}

test('missing, blank, null, mixed aliases and noncanonical branch tags retain legacy compatibility', async () => {
  for (const legacy of [{}, { BranchId: '' }, { BranchId: null }, { BranchId: 'North' }, { BranchId: '', branchId: 'north' }, { branchId: 'north' }]) {
    const f = fixture([{ BranchId: 'main' }, { BranchId: 'north' }, legacy]);
    let reads = 0;
    f.db.listCollection = async (_env, collection, options) => {
      assert.equal(new URLSearchParams(options.query).get('readTime'), snapshot); reads++; return f.rows;
    };
    assert.deepEqual(await listBranchCollection({}, 'items', 'north', {}, f.db), f.rows);
    assert.equal(reads, 1);
    assert.equal(f.calls.filter(call => call.kind === 'query').length, 0);
  }
});

test('coverage is checked anew after an old client adds an untagged record', async () => {
  const f = fixture([{ BranchId: 'main' }]);
  await listBranchCollection({}, 'items', 'main', {}, f.db);
  f.rows.push({ __id: 'legacy', Score: 0 });
  f.db.listCollection = async () => f.rows;
  const result = await listBranchCollection({}, 'items', 'main', {}, f.db);
  assert.equal(result.length, 2); assert.equal(result[1].Score, 0);
});

test('module filters apply inside Firestore, including the legacy compatibility path', async () => {
  for (const legacy of [false, true]) {
    const f = fixture([{ BranchId: 'main', StoreType: 'Bookstore' }, { BranchId: 'main', StoreType: 'Uniform Store' },
      { ...(legacy ? {} : { BranchId: 'main' }), StoreType: 'Bookstore' }]);
    const result = await listBranchCollection({}, 'items', 'main', { filters: [{ field: 'StoreType', op: '==', value: 'Bookstore' }] }, f.db);
    assert.equal(result.length, 2);
    const query = f.calls.find(call => call.kind === 'query');
    assert.ok(query.options.filters.some(filter => filter.field === 'StoreType' && filter.value === 'Bookstore'));
  }
});

test('legacy history continues through opaque cursors without hiding untagged records', async () => {
  const f = fixture([{}, {}, {}]);
  f.db.listCollectionPage = async (_env, collection, options) => {
    assert.equal(new URLSearchParams(options.query).get('readTime'), snapshot);
    const start = Number(options.pageToken || 0), end = Math.min(start + options.pageSize, f.rows.length);
    return { documents: f.rows.slice(start, end), nextPageToken: end < f.rows.length ? String(end) : '' };
  };
  const first = await branchCollectionPage({}, 'items', 'main', { pageSize: 2, readTime: snapshot }, f.db);
  const second = await branchCollectionPage({}, 'items', 'main', { pageSize: 2, readTime: snapshot, pageToken: first.nextPageToken }, f.db);
  assert.equal(first.documents.length + second.documents.length, 3); assert.equal(second.nextPageToken, '');
});

test('empty collections and failed coverage queries never return misleading partial data', async () => {
  const f = fixture([]);
  assert.deepEqual(await listBranchCollection({}, 'items', 'main', {}, f.db), []);
  assert.equal(f.calls.length, 1);
  await assert.rejects(listBranchCollection({}, 'items', 'main', {}, { ...f.db, countCollection: async () => { throw new Error('Offline'); } }), /Offline/);
  await assert.rejects(listBranchCollection({}, 'items', 'main', { filterJoin: 'OR' }, f.db), /conjunctive/);
});

test('coverage supports organisations with more than 30 branches without dropping records', async () => {
  const branches = Array.from({ length: 65 }, (_, i) => `branch-${i}`);
  const f = fixture(branches.map(BranchId => ({ BranchId })), branches);
  const result = await listBranchCollection({}, 'items', 'branch-55', {}, f.db);
  assert.equal(result.length, 1); assert.equal(result[0].BranchId, 'branch-55');
  assert.ok(f.calls.filter(c => c.options.filters).every(c => c.options.filters[0].value.length <= 30));
});

test('history pagination is branch-bound, complete and pinned to one snapshot', async () => {
  const f = fixture([{ BranchId: 'north' }, { BranchId: 'main' }, { BranchId: 'north' }, { BranchId: 'north' }]);
  const first = await branchCollectionPage({}, 'items', 'north', { pageSize: 2, readTime: snapshot }, f.db);
  assert.equal(first.documents.length, 2); assert.ok(first.nextPageToken);
  const second = await branchCollectionPage({}, 'items', 'north', { pageSize: 2, readTime: snapshot, pageToken: first.nextPageToken }, f.db);
  assert.equal(second.documents.length, 1); assert.equal(second.nextPageToken, '');
  assert.equal(new Set([...first.documents, ...second.documents].map(row => row.__id)).size, 3);
  for (const [collection, branch, readTime] of [['items', 'main', snapshot], ['payments', 'north', snapshot], ['items', 'north', '2026-10-24T09:00:00.000Z']]) {
    await assert.rejects(branchCollectionPage({}, collection, branch, { readTime, pageToken: first.nextPageToken }, f.db), { status: 400 });
  }
});

test('focused academic counters perform no extra reads and distinguish unloaded from zero', async () => {
  const source = await readFile(new URL('../functions/lib/academic-management.js', import.meta.url), 'utf8');
  const context = vm.createContext({ queryCollection: noRead, listCollection: noRead, ACADEMIC_SUMMARY_STATE_KEYS: ['classes', 'studentMemberships'],
    academicManagementSummary: () => ({ Classes: 0, StudentMemberships: 900 }) });
  vm.runInContext(source.match(/async function loadAcademicManagementSummary[\s\S]*?\n}/)[0], context);
  const result = await context.loadAcademicManagementSummary({}, {}, {}, ['classes']);
  assert.equal(result.Classes, 0); assert.equal(result.StudentMemberships, '—');
});

test('viewing store categories preserves legacy labels and performs no repair writes', async () => {
  const source = await readFile(new URL('../functions/lib/store-categories.js', import.meta.url), 'utf8');
  const context = vm.createContext({
    listCollection: async (_env, path) => { assert.equal(path, 'storeCategories'); return [{ __id: 'one', Name: 'Books' }, { __id: 'alias', Name: 'Book' }]; },
    listBranchCollection: async (_env, path, branch) => { assert.equal(path, 'storeItems'); assert.equal(branch, 'north'); return [{ __id: 'item', Category: 'Books', StoreType: 'Bookstore' }]; },
    batchUpsertDocuments: async () => { throw new Error('Viewing must not write'); }
  });
  vm.runInContext(source.replace(/^import[^;]+;\r?\n/gm, '').replace(/^export /gm, ''), context);
  const result = await context.ensureStoreCategories({}, { readOnly: true, branchId: 'north' });
  assert.equal(result.categories.length, 1); assert.equal(result.items.length, 1);
});
