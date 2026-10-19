import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handleProcurementAction } from '../functions/lib/procurement.js';
import { PROCUREMENT_RECORDS, PROCUREMENT_PAGE_SIZE } from '../functions/lib/procurement-history.js';
import { buildStructuredQuery } from '../functions/lib/firestore.js';

function fixture(edition = 'school') {
  const rows = new Map(), calls = [], scope = { BranchId: 'main', OrganisationEdition: edition, ScopeKey: `${edition}--main` };
  const department = edition === 'school' ? 'clinic' : 'organizationStore', section = edition === 'school' ? 'Secondary' : 'All';
  const user = { username: 'buyer', role: 'Procurement Officer', allowedSections: ['procurement'], edition, branchId: 'main', schoolSectionAccess: 'All', subscriptionActive: true };
  const put = (kind, value = {}) => {
    const config = PROCUREMENT_RECORDS[kind], recordId = value[config.key] || `${kind}-${rows.size}`;
    const row = { ...scope, SchoolSection: section, Department: department, [config.key]: recordId,
      CreatedAt: '2026-10-01T10:00:00.000Z', Status: config.active[0], Revision: 1,
      Lines: [{ ItemId: 'item', ItemName: 'Rice', Quantity: 1 }], Receipts: [{ Notes: 'Full detail evidence' }], ...value,
      __id: recordId, __name: `projects/project/databases/(default)/documents/${config.collection}/${recordId}`, __updateTime: 'v1' };
    rows.set(`${config.collection}/${recordId}`, row); return row;
  };
  const get = async (_env, collection, recordId) => rows.get(`${collection}/${recordId}`) || null;
  const query = async (_env, collection, options = {}) => {
    calls.push({ collection, options });
    let matches = [...rows.entries()].filter(([key]) => key.startsWith(`${collection}/`)).map(([, row]) => row)
      .filter(row => (options.filters || []).every(filter => filter.op === 'in' ? filter.value.includes(row[filter.field]) : row[filter.field] === filter.value));
    if (options.orderBy) matches.sort((a, b) => {
      for (const order of options.orderBy) {
        const field = order.field === '__name__' ? '__name' : order.field;
        const diff = String(a[field] || '').localeCompare(String(b[field] || '')) * (order.direction === 'DESCENDING' ? -1 : 1);
        if (diff) return diff;
      }
      return 0;
    });
    if (options.startAfterName) {
      const anchor = await get(null, collection, options.startAfterName.split('/').at(-1));
      assert.ok(anchor); assert.equal(options.startAfterFieldValue, anchor.CreatedAt);
      matches = matches.filter(row => row.CreatedAt < anchor.CreatedAt || (row.CreatedAt === anchor.CreatedAt && row.__name < anchor.__name));
    }
    if (options.limit) matches = matches.slice(0, options.limit);
    else if (matches.length > (options.maxRows || Infinity)) throw Object.assign(new Error('Unbounded report'), { status: 413 });
    return matches.map(row => options.select ? Object.fromEntries(Object.entries(row).filter(([key]) => key.startsWith('__') || options.select.includes(key))) : structuredClone(row));
  };
  const deps = { get, query, commit: async () => { throw new Error('A read must not write records'); } };
  const run = (body, actor = user) => handleProcurementAction({}, actor, { SchoolSection: section, ...body }, deps);
  return { rows, calls, scope, user, department, section, put, run, deps };
}

for (const edition of ['school', 'faith', 'organization']) {
  test(`${edition}: over 5,000 closed records do not hide old active work or break the dashboard`, async () => {
    const f = fixture(edition);
    for (const [kind, config] of Object.entries(PROCUREMENT_RECORDS)) {
      for (let index = 0; index < 5002; index++) f.put(kind, { [config.key]: `old-${String(index).padStart(5, '0')}`, Status: kind === 'requests' ? 'REJECTED' : 'RECEIVED' });
      f.put(kind, { [config.key]: 'still-active', CreatedAt: '2018-01-01T00:00:00.000Z', Status: config.active[0] });
    }
    const result = await f.run({ action: 'list' });
    if (edition === 'organization') {
      assert.equal(result.departments.find(row => row.Key === 'organizationStore')?.Name, 'Inventory & Sales');
      assert.equal(result.departments.find(row => row.Key === 'restaurant')?.Name, 'Catering Operations');
    }
    for (const kind of Object.keys(PROCUREMENT_RECORDS)) {
      assert.equal(result[kind].length, 1); assert.equal(result[kind][0][PROCUREMENT_RECORDS[kind].key], 'still-active');
      assert.equal(result.paging[kind].hasMore, false); assert.equal(result[kind][0].Receipts, undefined);
    }
    const history = await f.run({ action: 'records', Kind: 'requests', Mode: 'history' });
    assert.equal(history.records.length, PROCUREMENT_PAGE_SIZE); assert.equal(history.paging.hasMore, true);
    assert.ok(f.calls.filter(call => call.collection.startsWith('procurement') && call.collection !== 'procurementItems').every(call => call.options.limit === PROCUREMENT_PAGE_SIZE + 1));
  });
}

test('active and full history pagination preserve same-timestamp records without duplicates or skipped rows', async () => {
  const f = fixture();
  for (let index = 0; index < 205; index++) f.put('requests', { RequisitionId: `REQ-${String(index).padStart(4, '0')}` });
  for (const mode of ['active', 'history']) {
    const found = new Set(); let cursor = null, count = 0;
    do {
      const page = await f.run({ action: 'records', Kind: 'requests', Mode: mode, ...(cursor ? { Cursor: cursor } : {}) });
      count++;
      for (const row of page.records) { assert.ok(!found.has(row.RequisitionId)); found.add(row.RequisitionId); }
      cursor = page.paging.nextCursor;
      assert.equal(page.paging.hasMore, Boolean(cursor));
    } while (cursor);
    assert.equal(found.size, 205); assert.equal(count, 3);
  }
});

test('authorization is applied in server filters before pagination and hasMore determination', async () => {
  const f = fixture(), receiver = { ...f.user, role: 'Clinic User', allowedSections: ['procurement', 'clinic'], schoolSectionAccess: 'Secondary' };
  for (let index = 0; index < 150; index++) {
    f.put('requests', { RequisitionId: `other-dept-${index}`, Department: 'kitchen' });
    f.put('requests', { RequisitionId: `other-section-${index}`, SchoolSection: 'Primary' });
    f.put('requests', { RequisitionId: `other-branch-${index}`, BranchId: 'branch2', ScopeKey: 'school--branch2' });
    f.put('requests', { RequisitionId: `other-edition-${index}`, OrganisationEdition: 'faith', ScopeKey: 'faith--main' });
  }
  f.put('requests', { RequisitionId: 'visible' });
  const result = await f.run({ action: 'records', Kind: 'requests' }, receiver);
  assert.deepEqual(result.records.map(row => row.RequisitionId), ['visible']); assert.equal(result.paging.hasMore, false);
  assert.ok(f.calls.at(-1).options.filters.some(filter => filter.field === 'Department' && filter.value.length === 1 && filter.value[0] === 'clinic'));
  await assert.rejects(f.run({ action: 'records', Kind: 'purchases' }, receiver), error => error.status === 403);
  await assert.rejects(f.run({ action: 'recorddetail', Kind: 'requests', RecordId: 'other-section-0' }, receiver), error => error.status === 404);
  await assert.rejects(f.run({ action: 'records', Kind: 'requests', Cursor: { Id: 'other-dept-0', ScopeKey: f.scope.ScopeKey } }, receiver), error => error.status === 409);
});

test('read-only history and lazy receipt detail do not write and cursors cannot inject arbitrary database paths', async () => {
  const f = fixture(); f.put('purchases', { PurchaseId: 'PUR-1' });
  const viewer = { ...f.user, subscriptionActive: false, subscriptionReadOnly: true };
  const page = await f.run({ action: 'records', Kind: 'purchases' }, viewer);
  assert.equal(page.records[0].Receipts, undefined);
  const detail = await f.run({ action: 'recorddetail', Kind: 'purchases', RecordId: 'PUR-1' }, viewer);
  assert.equal(detail.record.Receipts[0].Notes, 'Full detail evidence');
  assert.equal(detail.record.__name, undefined);
  for (const Cursor of ['forged', [], { Id: '../other' }, { name: 'projects/other/database/path' }]) await assert.rejects(f.run({ action: 'records', Kind: 'purchases', Cursor }));
  await assert.rejects(f.run({ action: 'records', Kind: '__proto__' }), /record type/);
  await assert.rejects(f.run({ action: 'records', Kind: 'purchases', Mode: 'unbounded' }), /active work/);
});

test('cursor is revalidated but can continue after its active record moves to a completed status', async () => {
  const f = fixture();
  for (let index = 0; index < 101; index++) f.put('transfers', { TransferId: `TRF-${String(index).padStart(4, '0')}` });
  const page = await f.run({ action: 'records', Kind: 'transfers' });
  f.rows.get(`procurementTransfers/${page.paging.nextCursor.Id}`).Status = 'RECEIVED';
  const next = await f.run({ action: 'records', Kind: 'transfers', Cursor: page.paging.nextCursor });
  assert.equal(next.records.length, 1); assert.equal(next.paging.hasMore, false);
});

test('every edition declares the required indexed, bounded active/history query shape', async () => {
  for (const edition of ['school', 'church', 'organization']) {
    const f = fixture(edition === 'church' ? 'faith' : edition);
    for (const kind of Object.keys(PROCUREMENT_RECORDS)) for (const Mode of ['active', 'history']) await f.run({ action: 'records', Kind: kind, Mode });
    const indexes = JSON.parse(await readFile(new URL(`../firestore.${edition}.indexes.json`, import.meta.url), 'utf8')).indexes;
    for (const call of f.calls) {
      const expected = [...call.options.filters.map(filter => ({ fieldPath: filter.field, order: 'ASCENDING' })), { fieldPath: 'CreatedAt', order: 'DESCENDING' }];
      assert.ok(indexes.some(index => index.collectionGroup === call.collection && JSON.stringify(index.fields) === JSON.stringify(expected)), `${edition} ${call.collection} query index`);
      const { structuredQuery } = buildStructuredQuery(call.collection, call.options);
      assert.equal(structuredQuery.limit, PROCUREMENT_PAGE_SIZE + 1);
      assert.deepEqual(structuredQuery.orderBy.map(row => row.field.fieldPath), ['CreatedAt', '__name__']);
      assert.ok(!structuredQuery.select.fields.some(field => field.fieldPath === 'Receipts'));
    }
  }
});
