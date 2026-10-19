import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { handleProcurementAction, PROCUREMENT_COLLECTIONS as C } from '../functions/lib/procurement.js';
import { featureFlagsForPlan } from '../functions/lib/organization-config.js';
import { parseProcurementItemCsv, normalizeProcurementImportRow, PROCUREMENT_IMPORT_LIMITS, PROCUREMENT_IMPORT_COLUMNS } from '../js/procurement-item-import.js';
import { readProcurementJsonBody, procurementItemId } from '../functions/lib/procurement-item-import.js';

const copy = value => value === undefined ? undefined : structuredClone(value);
function fixture(edition = 'school') {
  const store = new Map(), commits = []; let serial = 0, loseResponse = false, beforeCommit, commitBarrier;
  const scope = { ScopeKey: `${edition}--main`, BranchId: 'main', OrganisationEdition: edition };
  const department = edition === 'school' ? 'clinic' : 'organizationStore', section = edition === 'school' ? 'Secondary' : 'All';
  const collection = edition === 'school' ? 'clinicInventory' : 'storeItems';
  const user = { username: 'buyer', role: 'Procurement Officer', edition, branchId: 'main', schoolSectionAccess: 'All',
    allowedSections: ['procurement'], subscriptionActive: true, featureFlags: featureFlagsForPlan(edition, 'Professional') };
  const get = (collection, id) => copy(store.get(`${collection}/${id}`)) || null;
  const list = collection => [...store].filter(([key]) => key.startsWith(`${collection}/`)).map(([, row]) => copy(row));
  const put = (collection, id, row) => { store.set(`${collection}/${id}`, { ...copy(row), __id: id, __updateTime: `version-${++serial}` }); return get(collection, id); };
  const deps = {
    get: async (_env, collection, id) => get(collection, id),
    query: async (_env, collection, options) => list(collection).filter(row => (options.filters || []).every(filter => row[filter.field] === filter.value)),
    commit: async (_env, writes) => {
      if (commitBarrier) await commitBarrier();
      if (beforeCommit) { const fn = beforeCommit; beforeCommit = null; await fn(); }
      const keys = new Set();
      for (const row of writes) {
        const path = `${row.collectionPath}/${row.documentId}`, existing = store.get(path);
        assert.ok(!keys.has(path), `Duplicate atomic write: ${path}`); keys.add(path);
        if ((row.exists === false && existing) || (row.updateTime && existing?.__updateTime !== row.updateTime))
          throw Object.assign(new Error('Precondition conflict'), { status: 409 });
      }
      commits.push(copy(writes)); writes.forEach(row => put(row.collectionPath, row.documentId, row.data));
      if (loseResponse) { loseResponse = false; throw new Error('Response lost'); }
    }
  };
  const run = (body, acting = user) => handleProcurementAction({}, acting, body, deps);
  const fields = (Rows = [{ ItemName: 'Bandages', Unit: 'pcs', ItemCode: 'BAND', Category: 'Medical Supply', ReorderLevel: 3, Price: 5, Notes: '' }]) => ({
    ImportMode: 'department', Department: department, SchoolSection: section, Rows });
  const preview = (body, acting) => run({ action: 'previewitemimport', ...body }, acting);
  const importBody = (body, reviewed) => ({ action: 'importitems', ...body, RequestId: crypto.randomUUID(), PreviewFingerprint: reviewed.PreviewFingerprint });
  const save = async body => { const reviewed = await preview(body); return run(importBody(body, reviewed)); };
  return { get, put, list, store, commits, user, scope, department, section, collection, run, fields, preview, importBody, save,
    loseResponse: () => { loseResponse = true; }, beforeCommit: fn => { beforeCommit = fn; },
    raceCommits: () => { let count = 0, release; const wait = new Promise(resolve => { release = resolve; });
      commitBarrier = async () => { if (++count === 2) release(); await wait; }; } };
}

test('CSV parser supports BOM, CRLF, quoted commas and escaped quotes with accurate line numbers', () => {
  const rows = parseProcurementItemCsv('\uFEFFItemName,Unit,ItemCode,Category,ReorderLevel,Price,Notes\r\n"Pads, large",pcs,PAD,Medical,3.125,12.50,"First line\nSecond ""quoted"" line"\r\n', 'department');
  assert.equal(rows.length, 1); assert.equal(rows[0].ItemName, 'Pads, large'); assert.equal(rows[0].RowNumber, 2);
  assert.equal(rows[0].Notes, 'First line\nSecond "quoted" line');
  const normalized = normalizeProcurementImportRow(rows[0], 'department');
  assert.deepEqual(normalized.errors, []); assert.equal(normalized.row.Price, 12.5); assert.equal(normalized.row.ReorderLevel, 3.125);
});

test('department template includes opening quantity instead of price; older optional prices still work', () => {
  assert.deepEqual(PROCUREMENT_IMPORT_COLUMNS.department, ['ItemName', 'Unit', 'ItemCode', 'Category', 'ReorderLevel', 'QuantityAvailable', 'Notes']);
  const [row] = parseProcurementItemCsv(`${PROCUREMENT_IMPORT_COLUMNS.department.join(',')}\nSoap,pcs,SOAP,General Item,5,20,Opening stock`, 'department');
  const normalized = normalizeProcurementImportRow(row, 'department');
  assert.deepEqual(normalized.errors, []); assert.equal(normalized.row.QuantityAvailable, 20); assert.equal(normalized.row.Price, null);
  for (const QuantityAvailable of [undefined, '', 0, '0', 20, '2.125', 1000000000]) {
    const result = normalizeProcurementImportRow({ ItemName: 'Soap', Unit: 'pcs', QuantityAvailable }, 'department');
    assert.deepEqual(result.errors, []); assert.equal(result.row.QuantityAvailable, Number(QuantityAvailable || 0));
  }
  for (const Price of ['', undefined, '0', '12.50']) {
    const result = normalizeProcurementImportRow({ ItemName: 'Soap', Unit: 'pcs', Price }, 'department');
    assert.deepEqual(result.errors, []); assert.equal(result.row.Price, Price ? Number(Price) : null);
  }
  const central = parseProcurementItemCsv('ItemName,Unit,QuantityAvailable\nSoap,pcs,20', 'central');
  assert.equal(normalizeProcurementImportRow(central[0], 'central').row.QuantityAvailable, 20);
  assert.throws(() => parseProcurementItemCsv('ItemName,Unit,Price\nSoap,pcs,20', 'central'), /Unknown/);
});

for (const ImportMode of ['central', 'department']) test(`${ImportMode}: invalid opening quantities are rejected without partial inventory writes`, async () => {
  for (const QuantityAvailable of [-1, '1e3', '1,000', '.1', '0.0001', 1000000001, Infinity, NaN, false, [], {}]) {
    const f = fixture(), body = { ...f.fields([{ ItemName: 'Soap', Unit: 'pcs', QuantityAvailable }]), ImportMode };
    const p = await f.preview(body);
    assert.equal(p.canImport, false, String(QuantityAvailable)); assert.match(p.rows[0].errors.join(' '), /QuantityAvailable/);
    await assert.rejects(f.run(f.importBody(body, p))); assert.equal(f.store.size, 0);
  }
});

test('CSV parser and shared row validation fail closed on forged stock/ownership, bad shapes and oversize input', () => {
  for (const csv of ['ItemName,Unit,Quantity\nX,pcs,50', 'ItemName,Unit,VendorId\nX,pcs,vendor', 'ItemName,Unit,unit\nX,pcs,pcs',
    'ItemName\nX', 'ItemName,Unit\n"X,pcs', 'ItemName,Unit\n"X"junk,pcs', 'ItemName,Unit\nX,pcs,extra'])
    assert.throws(() => parseProcurementItemCsv(csv, 'central'));
  assert.throws(() => parseProcurementItemCsv(`ItemName,Unit\n${Array.from({ length: 51 }, (_, i) => `Item${i},pcs`).join('\n')}`, 'central'), /50/);
  assert.throws(() => parseProcurementItemCsv('X'.repeat(PROCUREMENT_IMPORT_LIMITS.bytes + 1), 'central'), /64 KB/);
  for (const extra of [{ Quantity: 0 }, { VendorId: '' }, { BranchId: 'other' }, { ItemName: {} }, { Unit: [] }, { ReorderLevel: false },
    { ReorderLevel: -1 }, { ReorderLevel: '1e3' }, { ReorderLevel: '1,000' }, { ReorderLevel: '.1' }, { ReorderLevel: '0.0001' },
    { ReorderLevel: 1000000001 }, { ItemName: 'x\u0000y' }, { ItemName: 'x\ny' }, { Price: '1.001' }]) {
    assert.ok(normalizeProcurementImportRow({ ItemName: 'X', Unit: 'pcs', ...extra }, 'department').errors.length, JSON.stringify(extra));
  }
});

for (const edition of ['school', 'faith', 'organization']) {
  test(`${edition}: department CSV previews without writes and atomically creates linked zero-stock records`, async () => {
    const f = fixture(edition), body = f.fields(), reviewed = await f.preview(body);
    assert.equal(reviewed.canImport, true); assert.equal(f.store.size, 0);
    assert.deepEqual(reviewed.summary, { total: 1, ready: 1, skipped: 0, errors: 0, newCentral: 1, newDepartment: 1 });
    await f.run(f.importBody(body, reviewed));
    assert.equal(f.commits.length, 1); assert.equal(f.commits[0].length, 6);
    const central = f.list(C.items)[0], destination = f.list(f.collection)[0];
    assert.equal(central.Quantity, 0); assert.equal(destination.Quantity, 0); assert.equal(destination.Price, 5);
    assert.equal(destination.ProcurementItemId, central.ItemId); assert.equal(destination.ProcurementManaged, 'YES');
    assert.equal(destination.SchoolSection, f.section); assert.equal(destination.OwnershipType, 'Organisation');
    assert.equal(destination.OrganisationEdition, edition); assert.equal(destination.BranchId, 'main');
    assert.deepEqual(f.list(C.movements)[0].Lines, []);
    const audit = f.list(C.movements)[0];
    assert.deepEqual(audit.ImportedItems, [{ RowNumber: 2, ItemId: central.ItemId, InventoryId: destination.__id, Department: f.department, SchoolSection: f.section, OpeningQuantity: 0 }]);
    assert.equal(central.ImportOperationId, audit.__id); assert.equal(destination.ImportOperationId, audit.__id);
    assert.equal(f.list(C.purchases).length, 0); assert.equal(f.list(C.transfers).length, 0);
  });

  test(`${edition}: new department opening stock is audited without central stock, purchases or prices`, async () => {
    const f = fixture(edition), body = f.fields([{ ItemName: 'Soap', Unit: 'pcs', ItemCode: 'SOAP', QuantityAvailable: 25.125 }]);
    const p = await f.preview(body);
    assert.equal(p.canImport, true); assert.equal(p.rows[0].QuantityAvailable, 25.125); assert.equal(p.rows[0].OpeningQuantity, 25.125);
    assert.equal(f.store.size, 0);
    const result = await f.run(f.importBody(body, p));
    const central = f.list(C.items)[0], destination = f.list(f.collection)[0], audit = f.list(C.movements)[0];
    assert.equal(central.Quantity, 0); assert.equal(destination.Quantity, 25.125); assert.equal(destination.Price, 0);
    assert.equal(destination.ImportOperationId, audit.__id); assert.equal(audit.Department, f.department); assert.equal(audit.SchoolSection, f.section);
    assert.deepEqual(audit.Lines, [{ Collection: f.collection, InventoryId: destination.__id, ItemId: central.ItemId,
      ItemName: 'Soap', Unit: 'pcs', Department: f.department, SchoolSection: f.section,
      Quantity: 25.125, Direction: 'IN', Before: 0, After: 25.125, Source: 'OpeningBalance', RowNumber: 2 }]);
    assert.equal(result.importedItems[0].OpeningQuantity, 25.125); assert.match(result.message, /opening quantities/);
    assert.equal(f.list(C.purchases).length, 0); assert.equal(f.list(C.transfers).length, 0);
    if (edition === 'school') {
      const stockIn = f.list('clinicMovements'); assert.equal(stockIn.length, 1);
      assert.equal(stockIn[0].Quantity, 25.125); assert.equal(stockIn[0].Type, 'IN'); assert.equal(stockIn[0].MovementType, 'IN');
      assert.equal(stockIn[0].PostingKind, 'OpeningBalance'); assert.equal(stockIn[0].ImportOperationId, audit.__id);
      assert.equal(stockIn[0].Before, 0); assert.equal(stockIn[0].After, 25.125);
    }
    const snapshot = copy([...f.store]);
    const duplicate = await f.preview(body);
    assert.equal(duplicate.summary.skipped, 1); assert.equal(duplicate.rows[0].OpeningQuantity, 0);
    await assert.rejects(f.run(f.importBody(body, duplicate)));
    assert.deepEqual([...f.store], snapshot);
  });
}

test('opening quantities use the correct department inventory and movement collections', async () => {
  for (const [Department, collection, movements] of [
    ['kitchen', 'kitchenInventory', 'kitchenMovements'], ['tuckShop', 'tuckShopInventory', 'tuckShopMovements'],
    ['bookstore', 'storeItems'], ['uniformStore', 'storeItems'], ['organizationStore', 'storeItems'],
    ['restaurant', 'restaurantInventory', 'restaurantMovements']
  ]) {
    const f = fixture(['restaurant', 'organizationStore'].includes(Department) ? 'organization' : 'school');
    await f.save({ ...f.fields([{ ItemName: 'Item', ItemCode: 'ITEM', Unit: 'pcs', QuantityAvailable: 12 }]), Department });
    const item = f.list(collection)[0]; assert.equal(item.Quantity, 12); assert.equal(item.Price, 0);
    assert.equal(f.list(C.movements)[0].Lines[0].InventoryId, item.__id);
    if (movements) {
      const stockIn = f.list(movements); assert.equal(stockIn.length, 1);
      assert.equal(stockIn[0].InventoryId, item.__id); assert.equal(stockIn[0].Quantity, 12);
    }
    assert.equal(f.commits.length, 1);
  }
});

test('omitted price and opening quantity never overwrite existing prices or balances', async () => {
  const f = fixture();
  const original = f.put(f.collection, 'legacy', { ...f.scope, SchoolSection: f.section, ItemName: 'Soap', Unit: 'pcs',
    ItemCode: 'SOAP', Category: 'General Item', ReorderLevel: 0, Price: 125, Quantity: 77, Notes: '' });
  const body = f.fields([
    { ItemName: 'Soap', ItemCode: 'SOAP', Unit: 'pcs', QuantityAvailable: 100 },
    { ItemName: 'Pads', ItemCode: 'PADS', Unit: 'pcs', QuantityAvailable: 10 }
  ]);
  const p = await f.preview(body);
  assert.equal(p.canImport, true); assert.equal(p.summary.skipped, 1); assert.equal(p.rows[0].OpeningQuantity, 0);
  assert.match(p.rows[0].message, /not added or applied again/);
  await f.run(f.importBody(body, p)); assert.deepEqual(f.get(f.collection, 'legacy'), original);
  const audit = f.list(C.movements)[0]; assert.equal(audit.Lines.length, 1); assert.equal(audit.Lines[0].ItemName, 'Pads');
});

test('opening stock remains idempotent through lost responses and simultaneous retries', async () => {
  const f = fixture(), body = f.fields([{ ItemName: 'Soap', Unit: 'pcs', QuantityAvailable: 100 }]);
  const p = await f.preview(body), command = f.importBody(body, p);
  f.loseResponse(); assert.equal((await f.run(command)).replayed, true);
  await Promise.all([f.run(command), f.run(command)]);
  assert.equal(f.commits.length, 1); assert.equal(f.list(f.collection)[0].Quantity, 100); assert.equal(f.list('clinicMovements').length, 1);
  await assert.rejects(f.run({ ...command, Rows: [{ ...body.Rows[0], QuantityAvailable: 200 }] }), /different entries/);
  const fresh = fixture(), review = await fresh.preview(body), same = fresh.importBody(body, review);
  const racing = await Promise.all([fresh.run(same), fresh.run(same)]);
  assert.equal(fresh.commits.length, 1); assert.equal(racing.filter(row => row.replayed).length, 1);
  assert.equal(fresh.list(fresh.collection)[0].Quantity, 100); assert.equal(fresh.list('clinicMovements').length, 1);
});

test('changed or conflicting duplicate opening quantities require a new valid preview', async () => {
  const f = fixture(), row = { ItemName: 'Soap', Unit: 'pcs', QuantityAvailable: 10 }, body = f.fields([row]);
  const p = await f.preview(body);
  await assert.rejects(f.run(f.importBody(f.fields([{ ...row, QuantityAvailable: 20 }]), p)), /preview/);
  const conflicting = f.fields([row, { ...row, QuantityAvailable: 20 }]), invalid = await f.preview(conflicting);
  assert.equal(invalid.canImport, false); await assert.rejects(f.run(f.importBody(conflicting, invalid))); assert.equal(f.store.size, 0);
  const identical = f.fields([row, { ...row }]), reviewed = await f.preview(identical);
  assert.equal(reviewed.summary.skipped, 1); await f.run(f.importBody(identical, reviewed));
  assert.equal(f.list(f.collection)[0].Quantity, 10); assert.equal(f.list('clinicMovements').length, 1);
});

test('maximum opening-stock import and all its movement records commit atomically', async () => {
  const f = fixture(), body = f.fields(Array.from({ length: 50 }, (_, i) => ({ ItemName: `Item ${i}`, Unit: 'pcs', QuantityAvailable: i + 1 })));
  await f.save(body); assert.equal(f.commits.length, 1); assert.equal(f.commits[0].length, 252);
  assert.equal(f.list('clinicMovements').length, 50); assert.equal(f.list(C.movements)[0].Lines.length, 50);
  const fresh = fixture(), invalid = fresh.fields([...body.Rows.slice(0, 49), { ItemName: 'Invalid', Unit: 'pcs', QuantityAvailable: -1 }]);
  const p = await fresh.preview(invalid); assert.equal(p.canImport, false);
  await assert.rejects(fresh.run(fresh.importBody(invalid, p))); assert.equal(fresh.store.size, 0);
});

test('central-only upload retains existing single-item IDs and never creates department or financial records', async () => {
  const f = fixture(), body = { ImportMode: 'central', Rows: [{ ItemName: 'Soap', Unit: 'pcs', ItemCode: 'SOAP' }] };
  const id = await procurementItemId(f.scope, body.Rows[0]);
  await f.save(body); assert.equal(f.get(C.items, id).Quantity, 0); assert.equal(f.store.size, 4);
  const duplicate = await f.preview(body);
  assert.equal(duplicate.canImport, false); assert.equal(duplicate.summary.skipped, 1);
  assert.equal(duplicate.summary.newCentral, 0);
});

test('central template includes QuantityAvailable and older files default to zero', () => {
  assert.deepEqual(PROCUREMENT_IMPORT_COLUMNS.central, ['ItemName', 'Unit', 'ItemCode', 'Category', 'ReorderLevel', 'QuantityAvailable']);
  for (const csv of ['ItemName,Unit\nSoap,pcs', 'ItemName,Unit,QuantityAvailable\nSoap,pcs,']) {
    const normalized = normalizeProcurementImportRow(parseProcurementItemCsv(csv, 'central')[0], 'central');
    assert.deepEqual(normalized.errors, []); assert.equal(normalized.row.QuantityAvailable, 0);
  }
});

for (const edition of ['school', 'faith', 'organization']) test(`${edition}: central opening stock is created once with an atomic audit and no department changes`, async () => {
  const f = fixture(edition), body = { ImportMode: 'central', Rows: [{ ItemName: 'Soap', Unit: 'pcs', ItemCode: 'SOAP', QuantityAvailable: 25.125 }] };
  const department = f.put(f.collection, 'existing-department', { ...f.scope, SchoolSection: f.section, ItemName: 'Soap', Quantity: 10 });
  const p = await f.preview(body);
  assert.equal(f.commits.length, 0); assert.equal(p.canImport, true); assert.equal(p.rows[0].OpeningQuantity, 25.125);
  const result = await f.run(f.importBody(body, p)), item = f.list(C.items)[0], audit = f.list(C.movements)[0];
  assert.equal(f.commits.length, 1); assert.equal(f.commits[0].length, 4); assert.equal(item.Quantity, 25.125);
  assert.equal(item.BranchId, 'main'); assert.equal(item.OrganisationEdition, edition); assert.equal(item.ImportOperationId, audit.__id);
  assert.deepEqual(audit.Lines, [{ Collection: C.items, InventoryId: item.ItemId, ItemId: item.ItemId, ItemName: 'Soap', Unit: 'pcs',
    Quantity: 25.125, Direction: 'IN', Before: 0, After: 25.125, Source: 'OpeningBalance', RowNumber: 2 }]);
  assert.deepEqual(audit.ImportedItems, [{ RowNumber: 2, ItemId: item.ItemId, OpeningQuantity: 25.125 }]);
  assert.match(result.message, /new central items received the opening quantities/); assert.match(result.message, /Department stock remains unchanged/);
  assert.deepEqual(f.get(f.collection, 'existing-department'), department);
  assert.equal(f.list(C.purchases).length, 0); assert.equal(f.list(C.transfers).length, 0); assert.equal(f.list('clinicMovements').length, 0);
  // Even after stock has been consumed, neither the original file nor a changed
  // opening quantity can reset/top up an existing central item on a fresh upload.
  f.put(C.items, item.ItemId, { ...item, Quantity: 7 });
  for (const QuantityAvailable of [25.125, 50, 0]) {
    const repeated = { ...body, Rows: [{ ...body.Rows[0], QuantityAvailable }] }, preview = await f.preview(repeated);
    assert.equal(preview.canImport, false); assert.equal(preview.rows[0].status, 'skip'); assert.equal(preview.rows[0].OpeningQuantity, 0);
    assert.match(preview.rows[0].message, /not added or applied again/);
    await assert.rejects(f.run(f.importBody(repeated, preview))); assert.equal(f.get(C.items, item.ItemId).Quantity, 7);
  }
  assert.equal(f.commits.length, 1); assert.equal(f.list(C.movements).length, 1);
});

test('mixed central re-upload skips existing stock and creates only genuinely new items', async () => {
  const f = fixture(), row = { ItemName: 'Soap', Unit: 'pcs', QuantityAvailable: 20 };
  await f.save({ ImportMode: 'central', Rows: [row] }); const existing = f.list(C.items)[0];
  const body = { ImportMode: 'central', Rows: [{ ...row, QuantityAvailable: 99 }, { ItemName: 'Pads', Unit: 'pcs', QuantityAvailable: 12 }] };
  const p = await f.preview(body); assert.equal(p.canImport, true); assert.equal(p.summary.skipped, 1); assert.equal(p.summary.newCentral, 1);
  await f.run(f.importBody(body, p)); assert.deepEqual(f.get(C.items, existing.ItemId), existing);
  assert.equal(f.list(C.items).find(item => item.ItemName === 'Pads').Quantity, 12);
  assert.equal(f.list(C.movements).at(-1).Lines.length, 1); assert.equal(f.list(C.movements).at(-1).Lines[0].ItemName, 'Pads');
});

test('central opening quantities are protected against drift, duplicate rows, lost responses and racing uploads', async () => {
  const f = fixture(), row = { ItemName: 'Soap', Unit: 'pcs', QuantityAvailable: 20 }, body = { ImportMode: 'central', Rows: [row] };
  const p = await f.preview(body);
  await assert.rejects(f.run(f.importBody({ ...body, Rows: [{ ...row, QuantityAvailable: 40 }] }, p)), /preview/);
  const conflict = { ...body, Rows: [row, { ...row, QuantityAvailable: 40 }] }, invalid = await f.preview(conflict);
  assert.equal(invalid.canImport, false); await assert.rejects(f.run(f.importBody(conflict, invalid))); assert.equal(f.store.size, 0);
  const duplicate = { ...body, Rows: [row, { ...row }] }, reviewed = await f.preview(duplicate), command = f.importBody(duplicate, reviewed);
  assert.equal(reviewed.summary.skipped, 1);
  f.loseResponse(); assert.equal((await f.run(command)).replayed, true);
  await Promise.all([f.run(command), f.run(command)]);
  assert.equal(f.commits.length, 1); assert.equal(f.list(C.items)[0].Quantity, 20); assert.equal(f.list(C.movements)[0].Lines.length, 1);
  // Distinct request IDs from the same initial preview still compete on the
  // same exists:false item and identity claim, not just a replay key.
  const race = fixture(), preview = await race.preview(body); race.raceCommits();
  const results = await Promise.allSettled([race.run(race.importBody(body, preview)), race.run(race.importBody(body, preview))]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(race.commits.length, 1); assert.equal(race.list(C.items)[0].Quantity, 20); assert.equal(race.list(C.movements).length, 1);
});

test('central opening-stock imports retain vendor, scope and permission restrictions', async () => {
  const row = { ItemName: 'Soap', Unit: 'pcs', QuantityAvailable: 20 }, body = { ImportMode: 'central', Rows: [row] };
  for (const changes of [{ VendorId: 'vendor' }, { OwnershipType: 'Vendor' }, { OwnerType: 'Vendor' }, { BranchId: 'other' }, { OrganisationEdition: 'faith' }]) {
    const f = fixture(), id = await procurementItemId(f.scope, row);
    f.put(C.items, id, { ...f.scope, ...row, ItemId: id, Quantity: 33, ...changes });
    const snapshot = copy([...f.store]), p = await f.preview(body);
    assert.equal(p.canImport, false); await assert.rejects(f.run(f.importBody(body, p))); assert.deepEqual([...f.store], snapshot);
  }
  const f = fixture();
  for (const changes of [{ role: 'Vendor User' }, { role: 'Accounts Officer' }, { allowedSections: [] }, { branchId: 'all' }, { subscriptionReadOnly: true }])
    await assert.rejects(f.preview(body, { ...f.user, ...changes }), error => error.status === 403);
  assert.equal(f.store.size, 0);
});

test('maximum central opening-stock batch commits quantities and audit together; invalid rows save nothing', async () => {
  const f = fixture(), body = { ImportMode: 'central', Rows: Array.from({ length: 50 }, (_, i) => ({ ItemName: `Item ${i}`, Unit: 'pcs', QuantityAvailable: i + 1 })) };
  await f.save(body); assert.equal(f.commits.length, 1); assert.equal(f.commits[0].length, 102);
  assert.equal(f.list(C.items).length, 50); assert.equal(f.list(C.movements)[0].Lines.length, 50);
  const fresh = fixture(), invalid = { ...body, Rows: [...body.Rows.slice(0, 49), { ItemName: 'Invalid', Unit: 'pcs', QuantityAvailable: -1 }] };
  const p = await fresh.preview(invalid); assert.equal(p.canImport, false);
  await assert.rejects(fresh.run(fresh.importBody(invalid, p))); assert.equal(fresh.store.size, 0);
});

test('matching existing catalogues and legacy department items skip without changing any balance or adoption', async () => {
  const f = fixture(), body = f.fields(); await f.save(body);
  const item = f.list(C.items)[0], dest = f.list(f.collection)[0];
  f.put(C.items, item.ItemId, { ...item, Quantity: 28 });
  f.put(f.collection, dest.__id, { ...dest, Quantity: 14 });
  const snapshot = copy([...f.store]), result = await f.preview(body);
  assert.equal(result.summary.skipped, 1); assert.equal(result.summary.newCentral, 0);
  assert.deepEqual([...f.store], snapshot);
  const legacy = fixture();
  legacy.put(legacy.collection, 'old-id', { ItemName: 'Bandages', ItemCode: 'BAND', Category: 'Medical Supply', Unit: 'pcs',
    ReorderLevel: 3, Price: 5, Quantity: 9, SchoolSection: 'Secondary' });
  const legacyPreview = await legacy.preview(legacy.fields());
  assert.equal(legacyPreview.summary.skipped, 1); assert.equal(legacyPreview.summary.newCentral, 0);
  assert.equal(legacy.list(C.items).length, 0); assert.equal(legacy.get(legacy.collection, 'old-id').ProcurementManaged, undefined);
});

test('identical duplicate file rows skip once; conflicting duplicate fields and sanitized IDs block the whole batch', async () => {
  const f = fixture(), rows = f.fields().Rows, same = f.fields([rows[0], { ...rows[0] }]);
  const reviewed = await f.preview(same);
  assert.equal(reviewed.summary.ready, 1); assert.equal(reviewed.summary.skipped, 1); await f.run(f.importBody(same, reviewed));
  for (const entries of [
    [{ ItemName: 'X', Unit: 'pcs' }, { ItemName: 'X', Unit: 'kg' }],
    [{ ItemName: 'A/B', Unit: 'pcs' }, { ItemName: 'A\\B', Unit: 'pcs' }],
    [{ ItemName: 'X', ItemCode: 'ONE', Unit: 'pcs' }, { ItemName: 'Y', ItemCode: 'ONE', Unit: 'pcs' }]
  ]) {
    const fresh = fixture(), body = fresh.fields(entries), p = await fresh.preview(body);
    assert.equal(p.canImport, false); assert.equal(p.summary.errors, 1);
    await assert.rejects(fresh.run(fresh.importBody(body, p)), /No items were imported/); assert.equal(fresh.store.size, 0);
  }
});

test('existing central metadata conflicts and vendor ownership never get overwritten or adopted', async () => {
  for (const changes of [{ ItemName: 'Different name' }, { Category: 'Other' }, { ReorderLevel: 8 }, { VendorId: 'vincent' }, { OwnershipType: 'Vendor' }]) {
    const f = fixture(), body = f.fields(), central = { ...body.Rows[0] }; delete central.Price; delete central.Notes;
    await f.save({ ImportMode: 'central', Rows: [central] });
    const item = f.list(C.items)[0]; f.put(C.items, item.ItemId, { ...item, Quantity: 33, ...changes });
    const snapshot = copy([...f.store]), p = await f.preview(body);
    assert.equal(p.summary.errors, 1, JSON.stringify(changes));
    await assert.rejects(f.run(f.importBody(body, p))); assert.deepEqual([...f.store], snapshot);
  }
});

test('department matching catches case-only names, vendor duplicates and conflicting details without relinking', async () => {
  for (const changes of [{ Price: 8 }, { VendorId: 'vincent' }, { ProcurementItemId: 'another' }]) {
    const f = fixture(), body = f.fields();
    f.put(f.collection, 'legacy-id', { ...f.scope, SchoolSection: f.section, ...body.Rows[0], ItemName: 'BANDAGES', Quantity: 99, ...changes });
    const p = await f.preview(body); assert.equal(p.summary.errors, 1);
    await assert.rejects(f.run(f.importBody(body, p))); assert.equal(f.list(C.items).length, 0); assert.equal(f.get(f.collection, 'legacy-id').Quantity, 99);
  }
});

test('matching existing central item is reused with a CAS guard, not changed by the import', async () => {
  const f = fixture(), body = f.fields(); body.Rows[0].QuantityAvailable = 12;
  const central = { ...body.Rows[0] }; delete central.Price; delete central.Notes; delete central.QuantityAvailable;
  await f.save({ ImportMode: 'central', Rows: [central] });
  const item = f.list(C.items)[0]; f.put(C.items, item.ItemId, { ...item, Quantity: 77 });
  const before = f.get(C.items, item.ItemId), p = await f.preview(body);
  assert.equal(p.summary.newCentral, 0); assert.equal(p.rows[0].centralAction, 'reuse');
  await f.run(f.importBody(body, p));
  const after = f.get(C.items, item.ItemId); delete before.__updateTime; delete after.__updateTime;
  assert.deepEqual(after, before);
  assert.equal(f.list(f.collection)[0].Quantity, 12);
  assert.ok(f.commits.at(-1).find(row => row.collectionPath === C.items).updateTime);
});

test('role, module, edition, feature, school section and read-only restrictions apply to preview and import', async () => {
  const f = fixture(), body = f.fields(), p = await f.preview(body);
  for (const change of [{ role: 'Vendor User' }, { role: 'Department User' }, { role: 'Accounts Officer' }, { allowedSections: [] },
    { branchId: 'all' }, { subscriptionReadOnly: true }, { subscriptionActive: false }, { schoolSectionAccess: 'Primary' },
    { featureFlags: featureFlagsForPlan('school', 'Flex', {}, ['procurement'], 12) }]) {
    for (const request of [{ action: 'previewitemimport', ...body }, f.importBody(body, p)])
      await assert.rejects(f.run(request, { ...f.user, ...change }), error => error.status === 403, JSON.stringify(change));
  }
  const other = fixture('faith'); await assert.rejects(other.preview({ ...other.fields(), Department: 'clinic' }), /enabled/);
  assert.equal(f.store.size, 0);
});

test('forged row scope, ownership and stock fields cause row errors and no writes', async () => {
  for (const values of [{ Quantity: 50 }, { OwnershipType: 'Vendor' }, { VendorId: 'v' }, { BranchId: 'other' }, { SchoolSection: 'Primary' }, { ProcurementItemId: 'existing' }]) {
    const f = fixture(), body = f.fields([{ ...f.fields().Rows[0], ...values }]), p = await f.preview(body);
    assert.equal(p.canImport, false); assert.match(p.rows[0].errors.join(' '), /Unsupported columns/);
    await assert.rejects(f.run(f.importBody(body, p))); assert.equal(f.store.size, 0);
  }
});

test('preview is mandatory and drift, changed rows or concurrent central edits block the entire import', async () => {
  const f = fixture(), body = f.fields(), p = await f.preview(body);
  await assert.rejects(f.run({ action: 'importitems', ...body, RequestId: crypto.randomUUID() }), /preview/);
  await assert.rejects(f.run(f.importBody(f.fields([{ ...body.Rows[0], Price: 6 }]), p)), /preview/);
  const central = { ...body.Rows[0] }; delete central.Price; delete central.Notes;
  await f.save({ ImportMode: 'central', Rows: [central] });
  await assert.rejects(f.run(f.importBody(body, p)), /preview/);
  const reviewed = await f.preview(body), existing = f.list(C.items)[0];
  f.beforeCommit(() => f.put(C.items, existing.ItemId, { ...existing, VendorId: 'changed-after-read' }));
  await assert.rejects(f.run(f.importBody(body, reviewed)), /Nothing was partially posted/);
  assert.equal(f.list(f.collection).length, 0);
});

test('unknown outcome and concurrent retries return the same committed result without duplicate items', async () => {
  const f = fixture(), body = f.fields(), p = await f.preview(body), command = f.importBody(body, p);
  f.loseResponse(); const saved = await f.run(command);
  assert.equal(saved.replayed, true); assert.equal(f.commits.length, 1);
  const results = await Promise.all([f.run(command), f.run(command)]);
  assert.ok(results.every(row => row.replayed)); assert.equal(f.commits.length, 1);
  await assert.rejects(f.run({ ...command, Rows: [{ ...body.Rows[0], Price: 100 }] }), /different entries/);
  const fresh = fixture(), input = fresh.fields(), preview = await fresh.preview(input), same = fresh.importBody(input, preview);
  const racing = await Promise.all([fresh.run(same), fresh.run(same)]);
  assert.equal(fresh.commits.length, 1); assert.equal(racing.filter(row => row.replayed).length, 1);
});

test('maximum batch is one bounded atomic commit and invalid last row never partially creates earlier rows', async () => {
  const f = fixture(), body = f.fields(Array.from({ length: 50 }, (_, index) => ({ ItemName: `Item ${index}`, Unit: 'pcs' })));
  await f.save(body); assert.equal(f.commits.length, 1); assert.equal(f.commits[0].length, 202);
  const fresh = fixture(), invalid = fresh.fields([...body.Rows.slice(0, 49), { ItemName: 'Invalid', Unit: '' }]);
  const p = await fresh.preview(invalid); assert.equal(p.summary.errors, 1); assert.equal(p.canImport, false);
  await assert.rejects(fresh.run(fresh.importBody(invalid, p))); assert.equal(fresh.store.size, 0);
  await assert.rejects(fresh.preview(fresh.fields([...body.Rows, body.Rows[0]])), /50/);
});

test('normalized uniqueness claims serialize competing department and central imports built from the same snapshot', async () => {
  for (const mode of ['department', 'central']) {
    const f = fixture();
    const bodies = mode === 'department'
      ? [f.fields([{ ItemName: 'Saline', Unit: 'pcs', ItemCode: 'SAL-1' }]), f.fields([{ ItemName: 'saline', Unit: 'pcs', ItemCode: 'SAL-2' }])]
      : [{ ImportMode: 'central', Rows: [{ ItemName: 'ＡＢＣ', Unit: 'pcs' }] }, { ImportMode: 'central', Rows: [{ ItemName: 'ABC', Unit: 'pcs' }] }];
    const previews = await Promise.all(bodies.map(body => f.preview(body)));
    assert.ok(previews.every(row => row.canImport)); f.raceCommits();
    const results = await Promise.allSettled(bodies.map((body, index) => f.run(f.importBody(body, previews[index]))));
    assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
    assert.equal(results.filter(row => row.status === 'rejected').length, 1); assert.equal(f.commits.length, 1);
    assert.equal(f.list(C.items).length, 1); assert.equal(f.list(f.collection).length, mode === 'department' ? 1 : 0);
  }
});

test('manual destination creation and batch variants share one normalized identity reservation', async () => {
  const f = fixture();
  const saved = await f.run({ action: 'saveitem', ItemName: 'Saline', ItemCode: 'SAL-1', Unit: 'pcs', RequestId: crypto.randomUUID() });
  const body = f.fields([{ ItemName: 'saline', Unit: 'pcs', ItemCode: 'SAL-2' }]), p = await f.preview(body);
  f.raceCommits();
  const results = await Promise.allSettled([
    f.run({ action: 'savedestination', ItemId: saved.ItemId, Department: f.department, SchoolSection: f.section, RequestId: crypto.randomUUID() }),
    f.run(f.importBody(body, p))
  ]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(results.filter(row => row.status === 'rejected').length, 1); assert.equal(f.list(f.collection).length, 1);
});

test('manual central creation competes with a normalized batch variant without duplicate stock records', async () => {
  const f = fixture(), body = { ImportMode: 'central', Rows: [{ ItemName: 'ＡＢＣ', Unit: 'pcs' }] }, p = await f.preview(body);
  f.raceCommits();
  const results = await Promise.allSettled([
    f.run({ action: 'saveitem', ItemName: 'ABC', Unit: 'pcs', RequestId: crypto.randomUUID() }), f.run(f.importBody(body, p))
  ]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1); assert.equal(f.list(C.items).length, 1);
});

test('literal route uses streamed bounded JSON and rejects missing or deceptive content lengths', async () => {
  const source = await readFile(new URL('../functions/api/staff-procurement.js', import.meta.url), 'utf8');
  assert.match(source, /readProcurementJsonBody\(request\)/); assert.doesNotMatch(source, /request\.(?:json|text)\(/);
  assert.deepEqual(await readProcurementJsonBody(new Request('https://example.test', { method: 'POST', body: '{"action":"list"}' })), { action: 'list' });
  for (const data of ['null', '[]', '"string"', '{bad-json']) await assert.rejects(readProcurementJsonBody(new Request('https://example.test', { method: 'POST', body: data })), error => error.status === 400);
  let cancelled = false;
  const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(65536)); }, cancel() { cancelled = true; } });
  await assert.rejects(readProcurementJsonBody({ headers: new Headers({ 'Content-Length': '2' }), body }), error => error.status === 413);
  assert.equal(cancelled, true);
  await assert.rejects(readProcurementJsonBody({ headers: new Headers({ 'Content-Length': '999999' }), body: null }), error => error.status === 413);
});
