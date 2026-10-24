import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import * as guards from '../functions/lib/procurement-inventory-guard.js';
import { handleProductImport } from '../functions/lib/vendor-product-import.js';

const clean = value => String(value ?? '').trim();
const root = new URL('../', import.meta.url);
const backendSource = await readFile(new URL('functions/api/backend.js', root), 'utf8');
const actualMoneyNumber = vm.runInNewContext(`${backendSource.slice(backendSource.indexOf('function asMoneyNumber('), backendSource.indexOf('function formatNairaAmount('))}\nasMoneyNumber`);
const managed = { ProcurementManaged: 'YES', ProcurementItemId: 'CENTRAL-1' };
function fixture() {
  const docs = new Map(); let version = 0;
  const read = (collection, id) => docs.has(`${collection}/${id}`) ? structuredClone({ ...docs.get(`${collection}/${id}`), __id: id, __updateTime: docs.get(`${collection}/${id}`).__updateTime || 'v0' }) : null;
  const api = {
    getDocument: async (_env, collection, id) => read(collection, id),
    listCollection: async (_env, collection) => [...docs.keys()].filter(key => key.startsWith(`${collection}/`)).map(key => read(collection, key.slice(collection.length + 1))),
    batchCommitDocuments: async (_env, writes) => {
      for (const write of writes) {
        const old = read(write.collectionPath, write.documentId);
        if ((write.exists === false && old) || (write.exists === true && !old) || (write.updateTime && write.updateTime !== old?.__updateTime)) throw Object.assign(new Error('Concurrent version conflict'), { status: 409 });
      }
      for (const write of writes) {
        const key = `${write.collectionPath}/${write.documentId}`;
        if (write.operation === 'delete') docs.delete(key);
        else docs.set(key, { ...(write.updateMask ? docs.get(key) : {}), ...structuredClone(write.data), __updateTime: `v${++version}` });
      }
    }
  };
  api.queryCollection = async (env, c, { filters = [] } = {}) => (await api.listCollection(env, c)).filter(row => filters.every(({ field, value }) => row[field] === value));
  api.batchUpsertDocuments = api.batchCommitDocuments;
  api.upsertDocument = (env, collectionPath, documentId, data) => api.batchCommitDocuments(env, [{ collectionPath, documentId, data }]);
  async function load(file, extra = {}, slice = null) {
    const context = { ...api, ...guards, crypto: globalThis.crypto, Response, URL, TextEncoder, console,
      loadProcurementInventoryControl: (env, scope) => guards.loadProcurementInventoryControl(env, scope, api.getDocument),
      schoolSectionFor: row => clean(row.SchoolSection || 'Secondary').toLowerCase(), clean,
      ...extra
    };
    let source = await readFile(new URL(file, root), 'utf8');
    if (slice) source = source.slice(source.indexOf(slice[0]), source.indexOf(slice[1]));
    context.listBranchCollection = context.listCollection;
  vm.createContext(context);
    vm.runInContext(source.replace(/^import[\s\S]*?from '[^']+';\r?\n/gm, '').replace(/^export /gm, ''), context, { filename: file });
    return context;
  }
  return { docs, read, api, load };
}

test('managed stock always protects quantity, unit, identity and ownership while vendor stock stays separate', () => {
  const item = { ...managed, ItemName: 'Rice', ItemCode: 'RICE', Unit: 'kg', Quantity: 10, BranchId: 'main' };
  for (const next of [{ Quantity: 15 }, { Quantity: 5 }, { VendorId: 'VINCENT' }, { OwnershipType: 'Vendor' }, { Unit: 'bag' }, { ProcurementItemId: '' }, { ItemCode: 'NEW' }, { BranchId: 'other' }]) {
    assert.throws(() => guards.assertProcurementInventoryEdit(item, { ...item, ...next }), error => error.code === 'PROCUREMENT_STOCK_CONTROLLED');
  }
  guards.assertProcurementInventoryEdit(item, { ...item, ItemName: 'Rice updated', Notes: 'Note', Price: 150 });
  assert.throws(() => guards.assertProcurementInventoryMovement(item, 'IN'), /Procurement/);
  guards.assertProcurementInventoryMovement(item, 'OUT');
  assert.throws(() => guards.assertProcurementInventoryDeletion(item), /cannot be deleted/);
  const vendor = { VendorId: 'VINCENT', OwnershipType: 'Vendor', ItemName: 'Rice', Quantity: 10 };
  guards.assertProcurementInventoryEdit(vendor, { ...vendor, Quantity: 20 }, { controlled: true });
  guards.assertProcurementInventoryMovement(vendor, 'IN', { controlled: true });
  guards.assertProcurementInventoryEdit({}, { ...vendor, Quantity: 20 }, { controlled: true });
  assert.throws(() => guards.assertProcurementInventoryEdit(vendor, { VendorId: '', OwnershipType: 'School', Quantity: 20 }, { controlled: true }), /remain separate/);
  assert.throws(() => guards.guardProcurementImportRow(item, item), /preserved/);
  guards.assertProcurementInventoryMovement({ OwnerType: 'Vendor', ItemName: 'Legacy vendor product' }, 'IN', { controlled: true });
  assert.throws(() => guards.guardProcurementImportRow({ __id: 'RICE', ItemName: 'Rice', Quantity: 10 }, { ItemName: 'Rice' }, { controlled: true }), /preserved/);
  guards.guardProcurementImportRow(vendor, { ...vendor, Quantity: 20 }, { controlled: true });
  assert.equal(guards.procurementMovementBalance({ ...item, Quantity: 0.3 }, 'OUT', 0.1), 0.2);
  assert.throws(() => guards.procurementMovementBalance(item, 'OUT', 0.0001), /three decimal/);
});

for (const edition of ['school', 'faith', 'organization']) {
  test(`${edition}: branch policy blocks department direct receipts / quantity resets, while usage deducts exact stock`, async () => {
    const f = fixture(), api = await f.load('functions/api/staff-departments.js');
    f.docs.set(`procurementSettings/${edition}--main`, { Enabled: true });
    const user = { branchId: 'main', edition, schoolSectionAccess: 'All', username: 'nurse' };
    assert.equal(await guards.loadProcurementInventoryControl({}, user, f.api.getDocument), true);
    assert.equal(await guards.loadProcurementInventoryControl({}, { ...user, branchId: 'other' }, f.api.getDocument), false);
    for (const section of ['clinic', 'kitchen', 'restaurant', 'tuckShop']) {
      const collection = `${section}Inventory`, id = `main-Primary-${section}`;
      f.docs.set(`${collection}/${id}`, { ...managed, ItemName: 'Supply', Unit: 'pcs', Quantity: 10, BranchId: 'main', SchoolSection: 'Primary', OrganisationEdition: edition });
      const body = { InventoryId: id, ItemName: 'Supply', Unit: 'pcs', Quantity: 20 };
      await assert.rejects(api.saveInventory({}, section, body, user), /controlled by Procurement/);
      await assert.rejects(api.recordMovement({}, section, { ...body, MovementType: 'IN', Quantity: 2 }, user), /Direct Stock in/);
      await api.saveInventory({}, section, { ...body, Quantity: 10, Notes: 'Metadata only' }, user);
      await api.recordMovement({}, section, { ...body, MovementType: 'OUT', Quantity: 3 }, user);
      assert.equal(f.read(collection, id).Quantity, 7);
      assert.equal(f.read(collection, id).SchoolSection, 'Primary');
      assert.equal(f.read(collection, id).ProcurementItemId, 'CENTRAL-1');
      assert.equal((await f.api.listCollection({}, `${section}Movements`)).length, 1);
      await assert.rejects(api.recordMovement({}, section, { ...body, MovementType: 'OUT', Quantity: 8 }, user), /Only 7/);
      await assert.rejects(api.saveInventory({}, section, { ItemName: 'New supply', Quantity: 5 }, user), /controlled by Procurement/);
      await api.saveInventory({}, section, { ItemName: 'New supply', Quantity: 0 }, user);
    }
  });

  test(`${edition}: unmanaged vendor stock remains editable and receivable under central procurement control`, async () => {
    const f = fixture(), api = await f.load('functions/api/staff-departments.js');
    f.docs.set(`procurementSettings/${edition}--main`, { Enabled: true });
    f.docs.set('tuckShopInventory/vendor', { ItemName: 'Vendor rice', Quantity: 5, VendorId: 'VINCENT', OwnershipType: 'Vendor', BranchId: 'main', SchoolSection: 'Secondary', OrganisationEdition: edition });
    const user = { branchId: 'main', edition, schoolSectionAccess: 'All' }, body = { InventoryId: 'vendor', ItemName: 'Vendor rice', Quantity: 8 };
    await api.saveInventory({}, 'tuckShop', body, user);
    await api.recordMovement({}, 'tuckShop', { ...body, MovementType: 'IN', Quantity: 2 }, user);
    assert.equal(f.read('tuckShopInventory', 'vendor').Quantity, 10);
    assert.equal(f.read('tuckShopInventory', 'vendor').VendorId, 'VINCENT');
  });

  test(`${edition}: branch policy rejects batch ownership conversion and independent organisation opening stock`, async () => {
    const f = fixture(), section = edition === 'school' ? 'tuckShop' : 'organizationStore', collection = edition === 'school' ? 'tuckShopInventory' : 'storeItems';
    const scope = { OrganisationEdition: edition, BranchId: 'main', SchoolSection: 'All', ScopeKey: `${edition}--main` };
    f.docs.set(`procurementSettings/${edition}--main`, { Enabled: true });
    f.docs.set(`${collection}/org`, { ItemName: 'Rice', ItemCode: 'RICE', Quantity: 10, BranchId: 'main', SchoolSection: 'Secondary', OrganisationEdition: edition });
    const vendor = { VendorId: 'V1', Name: 'Vincent', Active: 'YES', SchoolSection: 'Secondary' };
    const deps = { requireOperator: () => {}, vendors: async () => [vendor], get: f.api.getDocument, query: f.api.queryCollection };
    const body = { action: 'previewProductImport', Mode: 'assign', Rows: [{ InventoryId: 'org', Owner: 'V1', Store: section, RowNumber: 2 }] };
    const preview = await handleProductImport({}, {}, scope, body, deps);
    assert.equal(preview.valid, false);
    assert.match(preview.rows[0].Errors.join(' '), /cannot be reassigned to a vendor/);
    const created = await handleProductImport({}, {}, scope, { ...body, Mode: 'create', Rows: [{ ItemName: 'New', ItemCode: 'NEW', Quantity: 4, Price: 100, Owner: 'Organisation', Store: section, SchoolSection: 'Secondary' }] }, deps);
    assert.equal(created.valid, false);
    assert.match(created.rows[0].Errors.join(' '), /controlled by Procurement/);
    const vendorPreview = await handleProductImport({}, {}, scope, { ...body, Mode: 'create', Rows: [{ ItemName: 'New', ItemCode: 'NEW', Quantity: 4, Price: 100, Owner: 'V1', Store: section, SchoolSection: 'Secondary' }] }, deps);
    assert.equal(vendorPreview.valid, true);
    f.docs.set(`${collection}/vendor`, { ...f.read(collection, 'org'), VendorId: 'V1', OwnershipType: 'Vendor' });
    const conversion = await handleProductImport({}, {}, scope, { ...body, Rows: [{ InventoryId: 'vendor', Owner: 'Organisation', Store: section, RowNumber: 2 }] }, deps);
    assert.equal(conversion.valid, false);
    assert.match(conversion.rows[0].Errors.join(' '), /remain separate/);
  });
}

test('stock usage concurrent with metadata edit never loses a decrement or its audit record', async () => {
  const f = fixture(), api = await f.load('functions/api/staff-departments.js');
  f.docs.set('clinicInventory/supply', { ...managed, ItemName: 'Supply', Unit: 'pcs', Quantity: 10, BranchId: 'main', SchoolSection: 'Secondary', OrganisationEdition: 'school' });
  const user = { branchId: 'main', edition: 'school', schoolSectionAccess: 'All' }, body = { InventoryId: 'supply', ItemName: 'Supply', Unit: 'pcs' };
  const result = await Promise.allSettled([
    api.recordMovement({}, 'clinic', { ...body, MovementType: 'OUT', Quantity: 4 }, user),
    api.saveInventory({}, 'clinic', { ...body, Quantity: 10, Notes: 'Metadata update' }, user)
  ]);
  assert.equal(result.filter(row => row.status === 'fulfilled').length, 1);
  const movements = await f.api.listCollection({}, 'clinicMovements');
  assert.equal(f.read('clinicInventory', 'supply').Quantity, movements.length ? 6 : 10);
});

test('category maintenance cannot overwrite a sale or Procurement receipt captured after its initial read', async () => {
  const f = fixture();
  f.docs.set('storeItems/book', { ...managed, StoreType: 'Bookstore', ItemName: 'Book', Category: 'Textbooks', Quantity: 10 });
  let interleaved = false;
  const api = await f.load('functions/lib/store-categories.js', {
    batchUpsertDocuments: async (env, writes) => {
      const inventoryWrites = writes.filter(write => write.collectionPath === 'storeItems');
      if (inventoryWrites.length) {
        assert.ok(inventoryWrites.every(write => Array.isArray(write.updateMask) && !Object.hasOwn(write.data, 'Quantity')));
        f.docs.get('storeItems/book').Quantity = 7;
        interleaved = true;
      }
      await f.api.batchCommitDocuments(env, writes);
    }
  });
  await api.ensureStoreCategories({});
  assert.equal(interleaved, true);
  assert.equal(f.read('storeItems', 'book').Quantity, 7);
  assert.equal(f.read('storeItems', 'book').ProcurementItemId, 'CENTRAL-1');
});

test('desktop inventory cannot replace, receive or delete Procurement stock', async () => {
  const f = fixture();
  const api = await f.load('functions/api/backend.js', {
    sameText: (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase(), asMoneyNumber: actualMoneyNumber,
    safeDocumentId: value => clean(value).replace(/\s+/g, '_'), nowIso: () => new Date().toISOString(),
    normalizeInventory: value => value, ledgerDocumentId: prefix => `${prefix}-${crypto.randomUUID()}`,
    desktopSchoolOperationsActor: async () => ({ edition: 'school' })
  }, ['function desktopInventoryScope(', 'async function updateStudentBillingCategory(']);
  const item = { ...managed, ItemName: 'Rice', Unit: 'kg', Quantity: 10, BranchId: 'main', SchoolSection: 'Secondary', OrganisationEdition: 'school' };
  f.docs.set('kitchenInventory/rice', item);
  const body = { UserBranchId: 'main', UserSchoolSectionAccess: 'Secondary', InventoryId: 'rice', ItemName: 'Rice', Unit: 'kg', Quantity: 15 };
  await assert.rejects(api.saveInventoryItem({}, body, 'kitchenInventory', { category: 'Food', unit: 'kg' }), /Procurement/);
  await assert.rejects(api.recordStockMovement({}, { ...body, MovementType: 'IN', Quantity: 1 }, 'kitchenInventory', 'kitchenMovements', {}), /Procurement/);
  await assert.rejects(api.deleteInventoryItem({}, body, 'kitchenInventory', 'Kitchen'), /cannot be deleted/);
  await api.recordStockMovement({}, { ...body, MovementType: 'OUT', Quantity: 2 }, 'kitchenInventory', 'kitchenMovements', { prefix: 'TEST' });
  assert.equal(f.read('kitchenInventory', 'rice').Quantity, 8);
  f.docs.set('kitchenInventory/rice', { ...item, Quantity: 0.3 });
  await api.recordStockMovement({}, { ...body, MovementType: 'OUT', Quantity: 0.1 }, 'kitchenInventory', 'kitchenMovements', { prefix: 'TEST' });
  assert.equal(f.read('kitchenInventory', 'rice').Quantity, 0.2);
  assert.equal(actualMoneyNumber(0.125), 0.13, 'fixture uses the real currency rounding rather than a Number() stand-in');
  f.docs.set('kitchenInventory/rice', { ...item, Quantity: 1 });
  await api.recordStockMovement({}, { ...body, MovementType: 'OUT', Quantity: 0.125 }, 'kitchenInventory', 'kitchenMovements', { prefix: 'TEST' });
  assert.equal(f.read('kitchenInventory', 'rice').Quantity, 0.875);
  await api.saveInventoryItem({}, { ...body, Quantity: undefined }, 'kitchenInventory', { category: 'Food', unit: 'kg' });
  assert.equal(f.read('kitchenInventory', 'rice').Quantity, 0.875);
  await api.saveInventoryItem({}, { ...body, Quantity: undefined, Unit: undefined }, 'kitchenInventory', { category: 'Food', unit: 'pcs' });
  assert.equal(f.read('kitchenInventory', 'rice').Unit, 'kg');
  assert.equal(f.read('kitchenInventory', 'rice').Quantity, 0.875);
});

test('desktop inventory display retains three-decimal stock without altering currency rounding', async () => {
  const f = fixture(), api = await f.load('functions/api/backend.js', {
    asMoneyNumber: actualMoneyNumber, pick: (row, names) => names.map(name => row[name]).find(value => value !== undefined) ?? '', toDisplayDate: value => value
  }, ['function normalizeInventory(', 'export function requireBackendSecret(']);
  assert.equal(api.normalizeInventory({ Quantity: 0.125, ReorderLevel: 0.375 }).Quantity, 0.125);
  assert.equal(api.normalizeInventory({ Quantity: 0.125, ReorderLevel: 0.375 }).ReorderLevel, 0.375);
  assert.equal(actualMoneyNumber(0.125), 0.13);
});

for (const section of ['tuckShop', 'organizationStore', 'restaurant']) {
  test(`${section}: a whole-unit sale preserves the fractional Procurement remainder and actual stock ID`, async () => {
    const f = fixture(), api = await f.load('functions/lib/organization-commerce.js', {
      findInventoryItem: (rows, _section, reference) => rows.find(row => row.__id === reference),
      configFor: () => ({ inventory: 'stock' }), error: (message, status) => Object.assign(new Error(message), { status }),
      withoutMetadata: row => Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('__')))
    }, ['function inventoryWrites(', 'function movementWrites(']);
    const item = { ...managed, __id: 'café%20stock', __updateTime: 'version-1', ItemName: 'Fractional supply', Quantity: 2.125 };
    const [write] = api.inventoryWrites(section, [{ InventoryDocumentId: item.__id, ItemName: item.ItemName, Quantity: 1 }], [item], '2026-10-11');
    assert.equal(write.data.Quantity, 1.125);
    assert.equal(write.documentId, item.__id);
    assert.equal(write.literalDocumentId, true);
    assert.equal(write.updateTime, item.__updateTime);
  });
}

test('department changes preserve literal legacy IDs and fractional Procurement stock', async () => {
  const f = fixture(), literalId = 'rice%20legacy stock', commit = f.api.batchCommitDocuments;
  const api = await f.load('functions/api/staff-departments.js', {
    batchCommitDocuments: async (env, writes, options) => {
      assert.equal(options.literalDocumentIds, true);
      assert.equal(writes[0].documentId, literalId);
      return commit(env, writes);
    }
  });
  const user = { branchId: 'main', edition: 'school', schoolSectionAccess: 'Secondary', username: 'kitchen' };
  f.docs.set(`kitchenInventory/${literalId}`, { ...managed, ItemName: 'Rice', Unit: 'bag', Quantity: 0.3, BranchId: 'main', SchoolSection: 'Secondary', OrganisationEdition: 'school' });
  await api.saveInventory({}, 'kitchen', { InventoryId: literalId, ItemName: 'Rice', Notes: 'Metadata only' }, user);
  await api.recordMovement({}, 'kitchen', { InventoryId: literalId, ItemName: 'Rice', MovementType: 'OUT', Quantity: 0.1 }, user);
  assert.equal(f.read('kitchenInventory', literalId).Quantity, 0.2);
  assert.equal(f.read('kitchenInventory', literalId).Unit, 'bag');
  assert.equal((await f.api.listCollection({}, 'kitchenInventory')).length, 1);
});

for (const [edition, section, storeType] of [['school', 'bookstore', 'Bookstore'], ['school', 'uniformStore', 'Uniform Store'], ['faith', 'organizationStore', 'Organisation Store'], ['organization', 'organizationStore', 'Organisation Store']]) {
  test(`${edition} ${storeType}: editor retains Procurement balance and exact identity`, async () => {
    const f = fixture(), user = { username: 'store', branchId: 'main', edition, schoolSectionAccess: 'All', allowedSections: [section] };
    const api = await f.load('functions/api/staff-stores.js', {
      requireFirestoreEnv: () => {}, requireStaffSession: async () => user, readJsonBody: request => request.json(),
      resolveStoreCategory: async () => ({ CategoryId: 'CAT', Name: 'General' }), canonicalConfiguredClass: value => value
    });
    f.docs.set('storeItems/scoped', { ...managed, ItemCode: 'SUPPLY', ItemName: 'Supply', Quantity: 10, StoreType: storeType, BranchId: 'main', SchoolSection: 'Secondary', OrganisationEdition: edition });
    const call = data => api.onRequestPost({ env: {}, request: new Request('https://example.invalid', { method: 'POST', body: JSON.stringify({ section, action: 'saveitem', ItemId: 'scoped', ItemCode: 'SUPPLY', ItemName: 'Supply', Price: 100, ...data }) }) });
    assert.equal((await call({ Quantity: 15 })).status, 409);
    assert.equal((await call({ Quantity: 10, ItemCode: 'DIFFERENT' })).status, 409);
    assert.equal((await call({ Quantity: 10 })).status, 200);
    assert.equal(f.read('storeItems', 'scoped').Quantity, 10);
    assert.equal(f.read('storeItems', 'scoped').ProcurementItemId, 'CENTRAL-1');
    assert.equal((await f.api.listCollection({}, 'storeItems')).length, 1);
    f.docs.set('storeItems/scoped', { ...f.read('storeItems', 'scoped'), Quantity: 0.5 });
    assert.equal((await call({})).status, 200);
    assert.equal((await call({ Quantity: 0.5 })).status, 200);
    assert.equal(f.read('storeItems', 'scoped').Quantity, 0.5);
  });
}

test('desktop store edits resolve scoped identities, never duplicate an item into the legacy name-only ID', async () => {
  const f = fixture();
  const common = { sameText: (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase(), asMoneyNumber: actualMoneyNumber,
    yesNo: value => clean(value).toUpperCase() === 'NO' ? 'NO' : 'YES',
    safeDocumentId: value => clean(value).replace(/\s+/g, '_'), nowIso: () => new Date().toISOString(),
    desktopSchoolOperationsActor: async () => ({ edition: 'school' }), categoryApplies: () => true,
    configuredClassNames: async () => [], canonicalConfiguredClass: value => value,
    resolveStoreCategory: async () => ({ CategoryId: 'CAT', Name: 'General' })
  };
  const inventory = await f.load('functions/api/backend.js', common, ['function desktopInventoryScope(', 'async function updateStudentBillingCategory(']);
  const api = await f.load('functions/api/backend.js', { ...common, desktopInventoryScope: inventory.desktopInventoryScope, inventoryConditionalWrite: inventory.inventoryConditionalWrite }, ['async function getStoreOverview(', 'async function saveStoreCategoryAction(']);
  f.docs.set('storeItems/scoped', { ...managed, ItemName: 'Book', ItemCode: 'BOOK', StoreType: 'Bookstore', Quantity: 10, BranchId: 'main', SchoolSection: 'Secondary', OrganisationEdition: 'school' });
  f.docs.set('storeItems/other', { ItemName: 'Book', ItemCode: 'BOOK', StoreType: 'Bookstore', Quantity: 30, BranchId: 'other', SchoolSection: 'Secondary', OrganisationEdition: 'school' });
  const body = { UserBranchId: 'main', UserSchoolSectionAccess: 'Secondary', ItemName: 'Book', ItemCode: 'BOOK', StoreType: 'Bookstore', Quantity: 10 };
  await api.saveStoreItem({}, body);
  assert.equal(f.read('storeItems', 'scoped').Quantity, 10);
  assert.equal(f.read('storeItems', 'other').Quantity, 30);
  assert.equal(f.read('storeItems', 'Bookstore-BOOK'), null);
  await assert.rejects(api.saveStoreItem({}, { ...body, Quantity: 15 }), /Procurement/);
  await assert.rejects(api.saveStoreItem({}, { ...body, ItemId: 'other' }), /outside/);
});

test('generic inventory import cannot remove Procurement links or duplicate managed legacy-name stock', async () => {
  const f = fixture(), api = await f.load('functions/api/import-firestore.js', {
    requireFirestoreEnv: () => {}, verifyDesktopCredential: async () => ({ type: 'device' }),
    startRequestMetric: () => ({}), finishRequestMetric: () => {}, readJsonBody: request => request.json(),
    requiredDeploymentIdentity: () => ({ edition: 'school' })
  });
  f.docs.set('clinicInventory/Rice', { ...managed, ItemName: 'Rice', Unit: 'kg', Quantity: 10, BranchId: 'main', SchoolSection: 'Secondary', OrganisationEdition: 'school' });
  const call = row => api.onRequestPost({ env: {}, request: new Request('https://example.invalid', { method: 'POST', body: JSON.stringify({ collection: 'clinicInventory', rows: [row] }) }) });
  const response = await call({ ItemName: 'Rice', Quantity: 10 });
  assert.equal(response.status, 207);
  assert.equal((await response.json()).imported, 0);
  assert.equal(f.read('clinicInventory', 'Rice').ProcurementItemId, 'CENTRAL-1');
  f.docs.delete('clinicInventory/Rice');
  f.docs.set('clinicInventory/main-Secondary-Rice', { ...managed, ItemName: 'Rice', Unit: 'kg', Quantity: 10, BranchId: 'main', SchoolSection: 'Secondary', OrganisationEdition: 'school' });
  assert.equal((await (await call({ ItemName: 'Rice', Quantity: 20 })).json()).imported, 0);
  assert.equal(f.read('clinicInventory', 'Rice'), null);
  f.docs.set('procurementSettings/school--main', { Enabled: true });
  assert.equal((await (await call({ ItemName: 'New item', Quantity: 20 })).json()).imported, 0);
});

test('generic clinic imports preserve reviewed dispensing records and cannot fabricate stock usage', async () => {
  const f = fixture(), api = await f.load('functions/api/import-firestore.js', {
    requireFirestoreEnv: () => {}, verifyDesktopCredential: async () => ({ type: 'device' }),
    startRequestMetric: () => ({}), finishRequestMetric: () => {}, readJsonBody: request => request.json()
  });
  const call = row => api.onRequestPost({ env: {}, request: new Request('https://example.invalid', { method: 'POST', body: JSON.stringify({ collection: 'clinicRecords', rows: [row] }) }) });
  for (const fields of [{ DispensedItems: [{ InventoryId: 'medicine', Quantity: 3 }] }, { DispensedItems: [] }, { Revision: 1 }, { StockReturnedOnCancellation: true }]) {
    assert.equal((await (await call({ RecordId: 'new-visit', ...fields })).json()).imported, 0);
    assert.equal(f.read('clinicRecords', 'new-visit'), null);
    f.docs.set('clinicRecords/reviewed-visit', { RecordId: 'reviewed-visit', Complaint: 'Reviewed', ...fields });
    assert.equal((await (await call({ RecordId: 'reviewed-visit', Complaint: 'Overwrite' })).json()).imported, 0);
    assert.equal(f.read('clinicRecords', 'reviewed-visit').Complaint, 'Reviewed');
  }
  assert.equal((await (await call({ RecordId: 'historic-visit', Complaint: 'Historical text only', Treatment: 'Historic note' })).json()).imported, 1);
  assert.equal((await (await call({ RecordId: 'historic-visit', Complaint: 'Updated historical note' })).json()).imported, 1);
  assert.equal(f.read('clinicRecords', 'historic-visit').Complaint, 'Updated historical note');
});
