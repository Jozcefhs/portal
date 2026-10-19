import test from 'node:test';
import assert from 'node:assert/strict';
import { handleProcurementAction, PROCUREMENT_COLLECTIONS as C } from '../functions/lib/procurement.js';
import { units, linesFor, scopeFor, inventoryAllowed } from '../functions/lib/procurement-rules.js';
import { featureFlagsForPlan } from '../functions/lib/organization-config.js';

const copy = value => value === undefined ? undefined : structuredClone(value);
function fixture(edition = 'school') {
  const store = new Map(), commits = []; let serial = 0, conflict = false, loseResponse = false;
  const department = edition === 'school' ? 'clinic' : 'organizationStore';
  const collection = edition === 'school' ? 'clinicInventory' : 'storeItems';
  const section = edition === 'school' ? 'Secondary' : 'All';
  const scope = { ScopeKey: `${edition}--main`, BranchId: 'main', OrganisationEdition: edition };
  const common = { edition, branchId: 'main', schoolSectionAccess: 'All', subscriptionActive: true, featureFlags: featureFlagsForPlan(edition, 'Professional') };
  const manager = { ...common, username: 'buyer', displayName: 'Procurement Officer', role: 'Procurement Officer', allowedSections: ['procurement'] };
  const approver = { ...common, username: 'accounts', role: 'Accounts Officer', approvalEnabled: true, approvalMaxAmount: 1000000, allowedSections: ['procurement', department] };
  const receiver = { ...common, username: 'department', role: 'Department User', allowedSections: ['procurement', department] };
  const admin = { ...common, username: 'owner', role: 'Super Admin', allowedSections: ['procurement', department] };
  function put(collection, documentId, data) {
    const row = { ...copy(data), __id: documentId, __updateTime: `version-${++serial}`, __name: `${collection}/${documentId}` };
    store.set(`${collection}/${documentId}`, row); return copy(row);
  }
  const get = (collection, id) => copy(store.get(`${collection}/${id}`)) || null;
  const list = collection => [...store.entries()].filter(([key]) => key.startsWith(`${collection}/`)).map(([, value]) => copy(value));
  const deps = {
    get: async (_env, collection, id) => get(collection, id),
    getMany: async (_env, collection, ids) => ids.map(id => get(collection, id)),
    query: async (_env, collection, options) => {
      let rows = list(collection).filter(row => (options.filters || []).every(filter => filter.op === 'in' ? filter.value.includes(row[filter.field]) : row[filter.field] === filter.value));
      if (options.orderBy) rows.sort((a, b) => {
        for (const order of options.orderBy) {
          const field = order.field === '__name__' ? '__name' : order.field;
          const comparison = String(a[field] || '').localeCompare(String(b[field] || '')) * (order.direction === 'DESCENDING' ? -1 : 1);
          if (comparison) return comparison;
        }
        return 0;
      });
      if (options.startAfterName) rows = rows.slice(rows.findIndex(row => row.__name === options.startAfterName) + 1);
      return options.limit ? rows.slice(0, options.limit) : rows;
    },
    commit: async (_env, writes) => {
      if (conflict) throw Object.assign(new Error('Concurrent stock write'), { status: 409 });
      const keys = new Set();
      for (const write of writes) {
        const key = `${write.collectionPath}/${write.documentId}`, current = store.get(key);
        assert.ok(!keys.has(key), `One atomic write per document: ${key}`); keys.add(key);
        if ((write.exists === false && current) || (write.updateTime && current?.__updateTime !== write.updateTime)) throw Object.assign(new Error('Precondition failed'), { status: 409 });
      }
      commits.push(copy(writes));
      writes.forEach(write => put(write.collectionPath, write.documentId, write.updateMask ? { ...get(write.collectionPath, write.documentId), ...write.data } : write.data));
      if (loseResponse) { loseResponse = false; throw new Error('Upstream response lost after commit'); }
    }
  };
  const run = (body, user = manager) => handleProcurementAction({}, user, { RequestId: crypto.randomUUID(), ...body }, deps);
  const command = (action, body = {}, user) => run({ action, ...body }, user);
  const target = (InventoryId = 'department-item', changes = {}) => put(collection, InventoryId, { ...scope, SchoolSection: section,
    ItemName: 'Medical supply', Unit: 'pcs', StoreType: edition === 'school' ? undefined : 'Organisation Store', ItemCode: InventoryId,
    Quantity: 7, WalletPinHash: 'never-return-this', ...changes });
  target();
  async function item(name = 'Medical supply', extra = {}) {
    const result = await command('saveitem', { ItemName: name, ItemCode: name, Unit: 'pcs', ReorderLevel: 5, ...extra }); return result.ItemId;
  }
  async function purchase(ItemId, amount = 100, extra = {}) {
    const result = await command('createpurchase', { SupplierName: 'Supplier', Reference: crypto.randomUUID(), Notes: 'Restocking authorised stock', Lines: [{ ItemId, Quantity: amount, UnitCost: 2.25 }], ...extra });
    await command('reviewpurchase', { PurchaseId: result.PurchaseId, ExpectedRevision: 1, Decision: 'APPROVED', Notes: 'Budget and supplier checked' }, approver);
    return result.PurchaseId;
  }
  async function receivePurchase(PurchaseId, ItemId, amount, extra = {}) {
    return command('receivepurchase', { PurchaseId, ExpectedRevision: get(C.purchases, PurchaseId).Revision, DeliveryReference: crypto.randomUUID(),
      Notes: 'Counted physically received stock', Lines: [{ ItemId, Quantity: amount }], ...extra });
  }
  async function stocked(amount = 100) { const ItemId = await item(), PurchaseId = await purchase(ItemId, amount); await receivePurchase(PurchaseId, ItemId, amount); return ItemId; }
  async function requisition(ItemId, amount = 20, extra = {}) {
    const result = await command('request', { Department: department, SchoolSection: section, Notes: 'Replenish department', Lines: [{ ItemId, InventoryId: 'department-item', Quantity: amount }], ...extra }, receiver);
    await command('reviewrequest', { RequisitionId: result.RequisitionId, ExpectedRevision: 1, Decision: 'APPROVED', Notes: 'Checked department need' });
    return result.RequisitionId;
  }
  async function issue(RequisitionId, ItemId, amount, extra = {}) {
    return command('issue', { RequisitionId, ExpectedRevision: get(C.requests, RequisitionId).Revision, Notes: 'Dispatched to department', Lines: [{ ItemId, Quantity: amount }], ...extra });
  }
  async function receive(TransferId, ItemId, amount, extra = {}, user = receiver) {
    return command('confirmreceipt', { TransferId, ExpectedRevision: get(C.transfers, TransferId).Revision, Notes: 'Department physically counted delivery', Lines: amount ? [{ ItemId, Quantity: amount }] : [], ...extra }, user);
  }
  return { store, commits, deps, run, command, get, put, list, target, manager, approver, receiver, admin, department, collection, section, scope,
    item, purchase, receivePurchase, stocked, requisition, issue, receive, setConflict: value => conflict = value, loseResponse: () => loseResponse = true };
}

function largeSelection(f, count = 110) {
  return Array.from({ length: count }, (_, i) => {
    const ItemId = `bulk-${i}`, InventoryId = `target-${i}`, ItemName = `Supply ${i}`;
    f.put(C.items, ItemId, { ...f.scope, ItemId, ItemName, Unit: 'pcs', Quantity: 10, Revision: 1, OwnershipType: 'Organisation' });
    f.target(InventoryId, { ItemName, ProcurementItemId: ItemId, Price: i + 20 });
    return { ItemId, InventoryId, Quantity: i % 3 + 1.125, UnitCost: i + 0.25 };
  });
}
function largeRequest(f, Lines) {
  return { action: 'request', RequestId: crypto.randomUUID(), Department: f.department, SchoolSection: f.section, Notes: 'All selected supplies',
    Lines: Lines.map(({ ItemId, InventoryId, Quantity }) => ({ ItemId, InventoryId, Quantity })) };
}

for (const edition of ['school', 'faith', 'organization']) {
  test(`${edition}: 110-item purchases and requests keep one approval total, preserve stock and safely retry every posting`, async () => {
    const f = fixture(edition), selection = largeSelection(f), reads = [], baseRead = f.deps.getMany;
    f.deps.getMany = async (...args) => { reads.push([args[1], args[2].length]); return baseRead(...args); };
    const initialTargets = f.list(f.collection), originalCentral = f.list(C.items);
    const purchaseBody = { action: 'createpurchase', RequestId: 'bulk-purchase-key', SupplierName: 'Bulk supplier', Reference: 'BULK-1', Notes: 'One approval',
      Lines: selection.map(({ ItemId, Quantity, UnitCost }) => ({ ItemId, Quantity, UnitCost })) };
    f.loseResponse(); const { PurchaseId } = await f.run(purchaseBody);
    assert.equal((await f.run(purchaseBody)).replayed, true);
    assert.equal(f.list(C.purchases).length, 1); assert.equal(f.get(C.purchases, PurchaseId).Lines.length, 110);
    const total = selection.reduce((sum, line) => sum + Math.round(line.Quantity * line.UnitCost * 100), 0) / 100;
    assert.equal(f.get(C.purchases, PurchaseId).TotalAmount, total);
    assert.deepEqual(f.list(C.items), originalCentral); assert.deepEqual(f.list(f.collection), initialTargets);
    const review = { PurchaseId, ExpectedRevision: 1, Decision: 'APPROVED', Notes: 'Review whole purchase' };
    await assert.rejects(f.command('reviewpurchase', review, { ...f.approver, approvalMaxAmount: total - 0.01 }), /approval limit/);
    await f.command('reviewpurchase', review, f.approver);
    const receipt = { action: 'receivepurchase', RequestId: 'bulk-receipt-key', PurchaseId, ExpectedRevision: 2, DeliveryReference: 'BULK-DELIVERY-1', Notes: 'Counted all items',
      Lines: selection.map(({ ItemId, Quantity }) => ({ ItemId, Quantity })) };
    f.loseResponse(); await f.run(receipt); assert.equal((await f.run(receipt)).replayed, true);
    assert.equal(f.get(C.purchases, PurchaseId).Status, 'RECEIVED');
    selection.forEach(line => assert.equal(f.get(C.items, line.ItemId).Quantity, 10 + line.Quantity));
    const requestBody = largeRequest(f, selection);
    f.loseResponse(); const { RequisitionId } = await f.run(requestBody, f.receiver);
    assert.equal((await f.run(requestBody, f.receiver)).replayed, true);
    assert.equal(f.list(C.requests).length, 1); assert.equal(f.get(C.requests, RequisitionId).Lines.length, 110);
    assert.deepEqual(f.list(f.collection), initialTargets, 'submitting a request never rewrites inventory or prices');
    await f.command('reviewrequest', { RequisitionId, ExpectedRevision: 1, Decision: 'APPROVED', Notes: 'Approved all supplies' });
    const dispatch = { action: 'issue', RequestId: 'bulk-dispatch-key', RequisitionId, ExpectedRevision: 2, Notes: 'Dispatch selected supplies', Lines: receipt.Lines };
    f.loseResponse(); const { TransferId } = await f.run(dispatch); assert.equal((await f.run(dispatch)).replayed, true);
    assert.equal(f.list(C.transfers).length, 1);
    selection.forEach(line => { assert.equal(f.get(C.items, line.ItemId).Quantity, 10); assert.equal(f.get(f.collection, line.InventoryId).Quantity, 7); });
    const delivery = { action: 'confirmreceipt', RequestId: 'bulk-confirm-key', TransferId, ExpectedRevision: 1, Notes: 'Physically counted', Lines: receipt.Lines };
    f.loseResponse(); await f.run(delivery, f.receiver); assert.equal((await f.run(delivery, f.receiver)).replayed, true);
    assert.equal(f.get(C.transfers, TransferId).Status, 'RECEIVED');
    selection.forEach((line, i) => {
      assert.equal(f.get(C.items, line.ItemId).Quantity, 10);
      assert.equal(f.get(f.collection, line.InventoryId).Quantity, 7 + line.Quantity);
      assert.equal(f.get(f.collection, line.InventoryId).Price, i + 20);
    });
    assert.ok(reads.length >= 8); assert.ok(reads.every(([, count]) => count === 110));
    assert.ok(f.commits.every(writes => writes.length <= 500));
  });
}

test('large selections fail atomically for duplicate, missing, wrong-scope, vendor or mismatched destination items', async () => {
  const f = fixture(), selection = largeSelection(f), body = largeRequest(f, selection), original = copy([...f.store.entries()]);
  await assert.rejects(f.run({ ...body, Lines: [...body.Lines, body.Lines[0]] }, f.receiver), /once/);
  for (const change of [{ ItemId: 'missing' }, { InventoryId: 'missing' }, { InventoryId: selection[0].InventoryId }])
    await assert.rejects(f.run({ ...body, Lines: body.Lines.map((line, i) => i === 109 ? { ...line, ...change } : line) }, f.receiver));
  assert.deepEqual([...f.store.entries()], original);
  for (const changes of [{ BranchId: 'other' }, { OrganisationEdition: 'faith' }, { VendorId: 'vendor' }]) {
    const row = f.get(C.items, selection[109].ItemId);
    f.put(C.items, row.ItemId, { ...row, ...changes });
    await assert.rejects(f.run(body, f.receiver));
    f.put(C.items, row.ItemId, row);
  }
  assert.equal(f.commits.length, 0);
});

test('a concurrent change on the last item cannot partially post a large receipt', async () => {
  const f = fixture(), selection = largeSelection(f);
  const PurchaseId = await f.purchase(selection[0].ItemId, 1, { Lines: selection });
  const baseRead = f.deps.getMany;
  f.deps.getMany = async (...args) => {
    const records = await baseRead(...args), row = records.at(-1);
    f.put(C.items, row.ItemId, { ...row, Quantity: 99 }); return records;
  };
  const before = f.commits.length;
  await assert.rejects(f.receivePurchase(PurchaseId, selection[0].ItemId, 1, { Lines: selection }), /Nothing was partially posted/);
  assert.equal(f.commits.length, before); assert.equal(f.get(C.purchases, PurchaseId).Status, 'APPROVED');
  selection.slice(0, -1).forEach(line => assert.equal(f.get(C.items, line.ItemId).Quantity, 10));
  assert.equal(f.get(C.items, selection.at(-1).ItemId).Quantity, 99);
});

test('600-item requests save as one document without inventory writes; oversized dispatch is atomic and can be fulfilled in parts', async () => {
  const f = fixture(), selection = largeSelection(f, 600), original = f.list(f.collection);
  const { RequisitionId } = await f.run(largeRequest(f, selection), f.receiver);
  assert.equal(f.commits.length, 1); assert.equal(f.commits[0].length, 3);
  assert.equal(f.get(C.requests, RequisitionId).Lines.length, 600); assert.deepEqual(f.list(f.collection), original);
  await f.command('reviewrequest', { RequisitionId, ExpectedRevision: 1, Decision: 'APPROVED', Notes: 'Approved' });
  const before = f.commits.length;
  await assert.rejects(f.issue(RequisitionId, selection[0].ItemId, 1, { Lines: selection }), error => error.code === 'PROCUREMENT_POSTING_TOO_LARGE');
  assert.equal(f.commits.length, before); assert.equal(f.list(C.transfers).length, 0);
  selection.forEach(line => assert.equal(f.get(C.items, line.ItemId).Quantity, 10));
  for (let offset = 0; offset < selection.length; offset += 200) {
    const Lines = selection.slice(offset, offset + 200);
    const { TransferId } = await f.issue(RequisitionId, Lines[0].ItemId, 1, { Lines });
    await f.receive(TransferId, Lines[0].ItemId, 1, { Lines });
  }
  assert.equal(f.get(C.requests, RequisitionId).Status, 'ISSUED');
  selection.forEach(line => { assert.equal(f.get(C.items, line.ItemId).Quantity, 10 - line.Quantity); assert.equal(f.get(f.collection, line.InventoryId).Quantity, 7 + line.Quantity); });
});

test('an oversized document fails clearly before any request or stock writes', async () => {
  const f = fixture(), selection = largeSelection(f, 1100);
  for (const line of selection) {
    for (const [collection, id] of [[C.items, line.ItemId], [f.collection, line.InventoryId]])
      f.put(collection, id, { ...f.get(collection, id), ItemName: '界'.repeat(160) });
  }
  await assert.rejects(f.run(largeRequest(f, selection), f.receiver), error => error.code === 'PROCUREMENT_DOCUMENT_TOO_LARGE');
  assert.equal(f.commits.length, 0); assert.equal(f.list(C.requests).length, 0);
});

test('quantities validate positive integer thousandths without coercing unsafe inputs', () => {
  assert.equal(units('1.125'), 1125); assert.equal(units(0, 'Qty', true), 0);
  for (const value of [-1, '1e3', '1,000', '', '  ', false, null, Infinity, NaN, '0.0001', '1000000001', 0]) assert.throws(() => units(value), undefined, String(value));
  assert.throws(() => linesFor([{ ItemId: 'one', Quantity: 1 }, { ItemId: 'one', Quantity: 2 }]), /once/);
  assert.equal(linesFor(Array.from({ length: 110 }, (_, i) => ({ ItemId: `id${i}`, Quantity: 1 }))).length, 110);
  for (const rows of [[], null, [null], [false], [[]]]) assert.throws(() => linesFor(rows));
  assert.throws(() => linesFor([{ ItemId: '../invalid', Quantity: 1 }]), /valid/);
});

for (const edition of ['school', 'faith', 'organization']) {
  test(`${edition}: purchase -> central -> transit -> confirmed existing department stock is conserved`, async () => {
    const f = fixture(edition), ItemId = await f.stocked(), RequisitionId = await f.requisition(ItemId);
    assert.equal(f.get(f.collection, 'department-item').Quantity, 7);
    const { TransferId } = await f.issue(RequisitionId, ItemId, 20);
    assert.equal(f.get(C.items, ItemId).Quantity, 80); assert.equal(f.get(f.collection, 'department-item').Quantity, 7);
    assert.equal(f.get(C.transfers, TransferId).Status, 'IN_TRANSIT');
    await f.receive(TransferId, ItemId, 12);
    assert.equal(f.get(f.collection, 'department-item').Quantity, 19); assert.equal(f.get(C.items, ItemId).Quantity, 80);
    assert.equal(f.get(C.transfers, TransferId).Status, 'PARTIALLY_RECEIVED');
    await f.receive(TransferId, ItemId, 8);
    assert.equal(f.get(f.collection, 'department-item').Quantity, 27); assert.equal(f.get(C.transfers, TransferId).Status, 'RECEIVED');
    assert.equal(f.get(f.collection, 'department-item').ProcurementItemId, ItemId);
    const result = await f.command('list', {}, f.receiver);
    assert.equal(result.purchases.length, 0); assert.equal(result.departmentInventory.length, 1);
    assert.doesNotMatch(JSON.stringify(result), /never-return-this/);
    assert.ok(f.commits.every(writes => writes.some(write => write.collectionPath === C.operations) && writes.some(write => write.collectionPath === C.movements)));
    await assert.rejects(f.receive(TransferId, ItemId, 1), /outstanding stock/);
  });
}

test('role, module, read-only, branch, edition and explicit assignment boundaries fail closed', async () => {
  const f = fixture();
  for (const change of [{ role: 'Vendor User' }, { role: 'External Auditor' }, { allowedSections: [] }, { branchId: 'all' }, { branchId: '' }, { username: '' }, { branchId: '../other' }])
    await assert.rejects(f.command('list', {}, { ...f.manager, ...change }), error => error.status === 403);
  await assert.rejects(f.command('saveitem', { ItemName: 'Item', Unit: 'pcs' }, f.receiver), /role/);
  await assert.rejects(f.command('saveitem', { ItemName: 'Item', Unit: 'pcs' }, { ...f.manager, subscriptionReadOnly: true }), /read-only/);
  assert.equal((await f.command('list', {}, { ...f.manager, subscriptionReadOnly: true })).readOnly, true);
  assert.equal(f.commits.length, 0);
});

test('central catalogue starts at zero, duplicate name/code rejected and unit is immutable', async () => {
  const f = fixture(), ItemId = await f.item();
  assert.equal(f.get(C.items, ItemId).Quantity, 0);
  await assert.rejects(f.item(), /already exists/);
  await assert.rejects(f.item('Vendor item', { VendorId: 'vendor' }), /Vendor stock|vendor stock/);
  await assert.rejects(f.item('Opening stock', { Quantity: 10 }), /starts at zero/);
  await assert.rejects(f.command('saveitem', { ItemId, ItemName: 'Changed', Unit: 'kg', ExpectedRevision: 1 }), /unit cannot change/);
  await f.command('saveitem', { ItemId, ItemName: 'Renamed', Unit: 'pcs', ExpectedRevision: 1 });
  assert.equal(f.get(C.items, ItemId).ItemName, 'Renamed');
});

for (const edition of ['school', 'faith', 'organization']) {
  test(`${edition}: central item assigns multiple departments atomically at zero stock and retries never duplicate them`, async () => {
    const f = fixture(edition), departments = edition === 'school' ? ['clinic', 'tuckShop', 'bookstore', 'uniformStore'] : ['organizationStore', 'restaurant'];
    const fields = { ItemName: 'Shared supply', ItemCode: 'SHARED', Unit: 'pcs', ReorderLevel: 4, SchoolSection: f.section, AssignedDepartments: departments };
    const body = { action: 'saveitem', RequestId: 'assignment-create-1', ...fields };
    const result = await f.run(body), ItemId = result.ItemId;
    assert.equal(result.DepartmentAssignments.Created, departments.length);
    assert.equal(f.get(C.items, ItemId).Quantity, 0);
    assert.deepEqual(f.get(C.items, ItemId).AssignedDepartmentsBySection[f.section], [...departments].sort());
    assert.equal(f.commits.length, 1);
    const assigned = f.commits[0].filter(write => write.data.ProcurementItemId === ItemId);
    assert.equal(assigned.length, departments.length);
    for (const write of assigned) { assert.equal(write.data.Quantity, 0); assert.equal(write.data.Price, 0); assert.equal(write.exists, false); }
    assert.equal((await f.run(body)).replayed, true); assert.equal(f.commits.length, 1);
    const again = await f.command('saveitem', { ...fields, ItemId, ExpectedRevision: 1 });
    assert.equal(again.DepartmentAssignments.Created, 0); assert.equal(again.DepartmentAssignments.Reused, departments.length);
    assert.ok(f.list(C.movements).every(row => row.Lines.length === 0), 'assignment never moves stock');
    assert.deepEqual(f.list(C.movements).at(-1).DepartmentAssignments, again.DepartmentAssignments);
  });
}

test('assignments reuse legacy items without resetting quantities, prices or other details', async () => {
  const f = fixture(), ItemId = await f.stocked(30);
  f.target('department-item', { Price: 175.50, Notes: 'Keep notes', Active: 'NO', BranchId: undefined, OrganisationEdition: undefined });
  const before = f.get(f.collection, 'department-item');
  const result = await f.command('saveitem', { ItemId, ExpectedRevision: f.get(C.items, ItemId).Revision, ItemName: 'Medical supply', ItemCode: 'Medical supply', Unit: 'pcs',
    SchoolSection: 'Secondary', AssignedDepartments: ['clinic', 'kitchen'] });
  assert.equal(result.DepartmentAssignments.Created, 1); assert.equal(result.DepartmentAssignments.Reused, 1);
  const after = f.get(f.collection, 'department-item');
  for (const field of ['Quantity', 'Price', 'Notes', 'Active', 'ItemName', 'ItemCode', 'WalletPinHash']) assert.equal(after[field], before[field], field);
  assert.equal(after.ProcurementItemId, ItemId); assert.equal(after.BranchId, 'main');
  assert.equal(f.get(C.items, ItemId).Quantity, 30);
  assert.equal(f.list(f.collection).length, 1);
  assert.ok((await f.command('list')).departmentInventory.some(row => row.InventoryId === 'department-item'));
});

test('assignment recognizes case and whitespace variants of existing branch inventory', async () => {
  const f = fixture(), ItemId = await f.item(); f.target('department-item', { ItemName: '  MEDICAL   supply ' });
  const result = await f.command('saveitem', { ItemId, ExpectedRevision: 1, ItemName: 'Medical supply', Unit: 'pcs', SchoolSection: 'Secondary', AssignedDepartments: ['clinic'] });
  assert.equal(result.DepartmentAssignments.Created, 0); assert.equal(result.DepartmentAssignments.Reused, 1);
  assert.equal(f.list(f.collection).length, 1);
});

test('editing selections preserves other school sections and unticked department stock and history', async () => {
  const f = fixture(), ItemId = await f.item('New item', { SchoolSection: 'Primary', AssignedDepartments: ['clinic'] });
  await f.command('saveitem', { ItemId, ExpectedRevision: 1, ItemName: 'New item', ItemCode: 'New item', Unit: 'pcs', SchoolSection: 'Secondary', AssignedDepartments: ['kitchen'] });
  const targets = new Map([...f.list('clinicInventory'), ...f.list('kitchenInventory')].map(row => [row.__name, row]));
  await f.command('saveitem', { ItemId, ExpectedRevision: 2, ItemName: 'New item', ItemCode: 'New item', Unit: 'pcs', SchoolSection: 'Secondary', AssignedDepartments: [] });
  assert.deepEqual(f.get(C.items, ItemId).AssignedDepartmentsBySection, { Primary: ['clinic'], Secondary: [] });
  for (const row of [...f.list('clinicInventory'), ...f.list('kitchenInventory')]) assert.deepEqual(row, targets.get(row.__name));
  await f.command('saveitem', { ItemId, ExpectedRevision: 3, ItemName: 'Renamed item', ItemCode: 'New item', Unit: 'pcs' });
  assert.deepEqual(f.get(C.items, ItemId).AssignedDepartmentsBySection, { Primary: ['clinic'], Secondary: [] }, 'old clients preserve assignments');
});

test('reassigning after a central rename reuses its linked department record', async () => {
  const f = fixture(), ItemId = await f.item('Original', { SchoolSection: 'Secondary', AssignedDepartments: ['clinic'] });
  const result = await f.command('saveitem', { ItemId, ExpectedRevision: 1, ItemName: 'Renamed', ItemCode: 'NEW', Unit: 'pcs', SchoolSection: 'Secondary', AssignedDepartments: ['clinic'] });
  assert.equal(result.DepartmentAssignments.Created, 0); assert.equal(result.DepartmentAssignments.Reused, 1);
  assert.equal(f.list(f.collection).filter(row => row.ProcurementItemId === ItemId).length, 1);
});

test('ambiguous, vendor-owned, incompatible or differently linked department items fail atomically', async () => {
  for (const changes of [{ Unit: 'kg' }, { VendorId: 'vendor' }, { OwnerType: 'Vendor' }, { ProcurementItemId: 'another' }]) {
    const f = fixture(), ItemId = await f.item(); f.target('department-item', changes);
    const before = copy([...f.store]), commits = f.commits.length;
    await assert.rejects(f.command('saveitem', { ItemId, ExpectedRevision: 1, ItemName: 'Medical supply', Unit: 'pcs', SchoolSection: 'Secondary', AssignedDepartments: ['kitchen', 'clinic'] }), /conflicts|different/);
    assert.deepEqual([...f.store], before); assert.equal(f.commits.length, commits);
  }
  const f = fixture(), ItemId = await f.item(); f.target('another-existing-item');
  await assert.rejects(f.command('saveitem', { ItemId, ExpectedRevision: 1, ItemName: 'Medical supply', Unit: 'pcs', SchoolSection: 'Secondary', AssignedDepartments: ['clinic'] }), /more than one/);
  assert.equal(f.get(C.items, ItemId).Revision, 1);
});

test('department assignment enforces role, feature, edition, branch, section and store-code boundaries', async () => {
  const f = fixture(), fields = { ItemName: 'Shared', ItemCode: 'SH', Unit: 'pcs', SchoolSection: 'Secondary', AssignedDepartments: ['clinic'] };
  await assert.rejects(f.command('saveitem', fields, f.receiver), /role/);
  await assert.rejects(f.command('saveitem', fields, { ...f.manager, subscriptionReadOnly: true }), /read-only/);
  for (const AssignedDepartments of [null, 'clinic', ['unknown'], ['organizationStore'], [{}], Array(8).fill('clinic')])
    await assert.rejects(f.command('saveitem', { ...fields, AssignedDepartments }), /enabled departments/);
  await assert.rejects(f.command('saveitem', fields, { ...f.manager, schoolSectionAccess: 'Primary' }), /school section/);
  await assert.rejects(f.command('saveitem', { ...fields, AssignedDepartments: ['bookstore'], ItemCode: '' }), /item code/);
  await assert.rejects(f.command('saveitem', fields, { ...f.manager, featureFlags: featureFlagsForPlan('school', 'Standard') }), /enabled departments/);
  f.target('other-branch', { ItemName: 'Shared', BranchId: 'other' }); f.target('other-section', { ItemName: 'Shared', SchoolSection: 'Primary' });
  f.target('other-edition', { ItemName: 'Shared', OrganisationEdition: 'faith' });
  const result = await f.command('saveitem', fields);
  assert.equal(result.DepartmentAssignments.Created, 1);
  assert.equal(f.get(f.collection, 'other-branch').Quantity, 7); assert.equal(f.get(f.collection, 'other-section').Quantity, 7);
});

test('assignment conflicts roll back all writes and a lost response safely replays', async () => {
  const f = fixture(), fields = { ItemName: 'Atomic item', ItemCode: 'ATM', Unit: 'pcs', SchoolSection: 'Secondary', AssignedDepartments: ['clinic', 'kitchen'] };
  f.setConflict(true); const before = copy([...f.store]);
  await assert.rejects(f.command('saveitem', fields), /Nothing was partially posted/); assert.deepEqual([...f.store], before);
  f.setConflict(false); f.loseResponse(); const body = { action: 'saveitem', RequestId: 'assignment-lost-reply', ...fields };
  const result = await f.run(body); assert.equal(result.replayed, true); assert.equal(f.commits.length, 1);
  assert.equal((await f.run(body)).replayed, true); assert.equal(f.commits.length, 1);
  await assert.rejects(f.command('saveitem', { ...fields, ItemId: result.ItemId, ExpectedRevision: 0 }), /has changed/);
});

test('concurrent department stock changes cannot be overwritten by assignment', async () => {
  const f = fixture(), ItemId = await f.item(), commit = f.deps.commit;
  f.deps.commit = async (...args) => {
    f.target('department-item', { Quantity: 19 });
    return commit(...args);
  };
  await assert.rejects(f.command('saveitem', { ItemId, ExpectedRevision: 1, ItemName: 'Medical supply', Unit: 'pcs', SchoolSection: 'Secondary', AssignedDepartments: ['clinic', 'kitchen'] }), /Nothing was partially posted/);
  assert.equal(f.get(f.collection, 'department-item').Quantity, 19);
  assert.equal(f.get(C.items, ItemId).Revision, 1); assert.equal(f.list('kitchenInventory').length, 0);
});

test('competing central items cannot create duplicate department identities', async () => {
  const f = fixture(), first = await f.item('Shared new', { ItemCode: 'A' }), second = await f.item('Shared new', { ItemCode: 'B' });
  const results = await Promise.allSettled([first, second].map((ItemId, i) => f.command('saveitem', { ItemId, ExpectedRevision: 1,
    ItemName: 'Shared new', ItemCode: i ? 'B' : 'A', Unit: 'pcs', SchoolSection: 'Secondary', AssignedDepartments: ['clinic'] })));
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(f.list(f.collection).filter(row => row.ItemName === 'Shared new').length, 1);
  assert.deepEqual([first, second].map(ItemId => f.get(C.items, ItemId).Revision).sort(), [1, 2]);
});

test('saving visible departments does not remove assignments for disabled modules', async () => {
  const f = fixture(), ItemId = await f.item();
  f.put(C.items, ItemId, { ...f.get(C.items, ItemId), AssignedDepartmentsBySection: { Secondary: ['kitchen'] } });
  await f.command('saveitem', { ItemId, ExpectedRevision: 1, ItemName: 'Medical supply', Unit: 'pcs', SchoolSection: 'Secondary', AssignedDepartments: [] },
    { ...f.manager, featureFlags: featureFlagsForPlan('school', 'Standard') });
  assert.deepEqual(f.get(C.items, ItemId).AssignedDepartmentsBySection.Secondary, ['kitchen']);
});

for (const edition of ['school', 'faith', 'organization']) {
  test(`${edition}: bulk assignments add multiple items to multiple departments without altering stock or existing assignments`, async () => {
    const f = fixture(edition), first = await f.item('First', { ItemCode: 'FIRST' }), second = await f.item('Second', { ItemCode: 'SECOND' });
    f.target('department-item', { ItemName: 'First', ItemCode: 'FIRST', Quantity: 37, Price: 800, Notes: 'Keep' });
    f.put(C.items, first, { ...f.get(C.items, first), Quantity: 24, AssignedDepartmentsBySection: { [f.section]: ['unavailable-legacy-department'], Primary: ['clinic'] } });
    const departments = edition === 'school' ? ['clinic', 'kitchen'] : ['organizationStore', 'restaurant'];
    const payload = { Items: [first, second].map(ItemId => ({ ItemId, ExpectedRevision: 1 })), AssignedDepartments: departments, SchoolSection: f.section };
    const beforeCommits = f.commits.length, result = await f.command('assignitems', payload);
    assert.equal(f.commits.length, beforeCommits + 1); assert.deepEqual(result.summary, { Items: 2, Created: 3, Reused: 1 });
    assert.equal(f.get(C.items, first).Quantity, 24); assert.equal(f.get(C.items, second).Quantity, 0);
    assert.equal(f.get(f.collection, 'department-item').Quantity, 37); assert.equal(f.get(f.collection, 'department-item').Price, 800);
    assert.ok(f.get(C.items, first).AssignedDepartmentsBySection[f.section].includes('unavailable-legacy-department'));
    for (const write of f.commits.at(-1).filter(row => row.data.ProcurementItemId && row.exists === false)) assert.equal(write.data.Quantity, 0);
    assert.deepEqual(f.list(C.movements).at(-1).ItemAssignments, result.ItemAssignments);
    assert.deepEqual(f.list(C.movements).at(-1).Lines, []);
    const again = await f.command('assignitems', { ...payload, Items: [first, second].map(ItemId => ({ ItemId, ExpectedRevision: 2 })) });
    assert.deepEqual(again.summary, { Items: 2, Created: 0, Reused: 4 });
    assert.equal(f.get(f.collection, 'department-item').Quantity, 37);
  });
}

test('bulk assignment validates item limits, duplicates, revisions, departments and role before any commit', async () => {
  const f = fixture(), ItemId = await f.item(), fields = { Items: [{ ItemId, ExpectedRevision: 1 }], AssignedDepartments: ['clinic'], SchoolSection: 'Secondary' };
  const cases = [{ Items: [] }, { Items: null }, { Items: [null] }, { Items: Array(21).fill(fields.Items[0]) },
    { Items: [fields.Items[0], fields.Items[0]] }, { Items: [{ ItemId, ExpectedRevision: 0 }] },
    { AssignedDepartments: [] }, { AssignedDepartments: ['organizationStore'] }, { AssignedDepartments: 'clinic' }];
  const before = copy([...f.store]);
  for (const change of cases) await assert.rejects(f.command('assignitems', { ...fields, ...change }));
  await assert.rejects(f.command('assignitems', fields, f.receiver), /role/);
  await assert.rejects(f.command('assignitems', fields, { ...f.manager, subscriptionReadOnly: true }), /read-only/);
  await assert.rejects(f.command('assignitems', fields, { ...f.manager, schoolSectionAccess: 'Primary' }), /school section/);
  await assert.rejects(f.command('assignitems', fields, { ...f.manager, branchId: 'other' }), /branch/);
  assert.deepEqual([...f.store], before);
});

test('a bad item stops the whole bulk assignment and concurrent stock edits cannot be overwritten', async () => {
  const f = fixture(), first = await f.item('Clean'), second = await f.item();
  f.target('department-item', { VendorId: 'vendor' }); const before = copy([...f.store]);
  const payload = { Items: [first, second].map(ItemId => ({ ItemId, ExpectedRevision: 1 })), AssignedDepartments: ['clinic', 'kitchen'], SchoolSection: 'Secondary' };
  await assert.rejects(f.command('assignitems', payload), /Medical supply:.*vendor/); assert.deepEqual([...f.store], before);
  f.target('department-item'); const commit = f.deps.commit;
  f.deps.commit = async (...args) => { f.target('department-item', { Quantity: 19 }); return commit(...args); };
  await assert.rejects(f.command('assignitems', payload), /Nothing was partially posted/);
  assert.equal(f.get(f.collection, 'department-item').Quantity, 19); assert.equal(f.list('kitchenInventory').length, 0);
  assert.equal(f.get(C.items, first).Revision, 1); assert.equal(f.get(C.items, second).Revision, 1);
});

test('two selected central items cannot claim one department record even inside the same bulk save', async () => {
  const f = fixture(), first = await f.item('Same name', { ItemCode: 'A' }), second = await f.item('Same name', { ItemCode: 'B' });
  const before = copy([...f.store]);
  await assert.rejects(f.command('assignitems', { Items: [first, second].map(ItemId => ({ ItemId, ExpectedRevision: 1 })),
    AssignedDepartments: ['clinic'], SchoolSection: 'Secondary' }), /same department record or identity/);
  assert.deepEqual([...f.store], before);
});

test('bulk assignment retries and simultaneous repeats share one atomic result', async () => {
  const f = fixture(), ItemId = await f.item('Bulk retry'), body = { action: 'assignitems', RequestId: 'bulk-assignment-retry',
    Items: [{ ItemId, ExpectedRevision: 1 }], AssignedDepartments: ['clinic', 'kitchen'], SchoolSection: 'Secondary' };
  const commits = f.commits.length; f.loseResponse(); const result = await f.run(body);
  assert.equal(result.replayed, true); assert.equal(f.commits.length, commits + 1);
  const [a, b] = await Promise.all([f.run(body), f.run(body)]); assert.equal(a.replayed, true); assert.equal(b.replayed, true);
  assert.equal(f.commits.length, commits + 1);
  await assert.rejects(f.run({ ...body, AssignedDepartments: ['kitchen'] }), /different entries/);
});

test('a 20-item assignment shares branch inventory reads and commits once', async () => {
  const f = fixture(), ids = []; for (let i = 0; i < 20; i++) ids.push(await f.item(`Bulk ${i}`));
  let branchReads = 0; const query = f.deps.query;
  f.deps.query = async (...args) => { if (args[2].filters.some(filter => filter.field === 'BranchId')) branchReads++; return query(...args); };
  const result = await f.command('assignitems', { Items: ids.map(ItemId => ({ ItemId, ExpectedRevision: 1 })), AssignedDepartments: ['clinic', 'kitchen'], SchoolSection: 'Secondary' });
  assert.deepEqual(result.summary, { Items: 20, Created: 40, Reused: 0 }); assert.equal(branchReads, 2);
  assert.ok(f.commits.at(-1).length < 450);
});

for (const edition of ['school', 'faith', 'organization']) {
  test(`${edition}: assigning 47 items in resumable batches preserves stock and prices across retries and repeated selection`, async () => {
    const f = fixture(edition), ids = [], departments = edition === 'school' ? ['clinic', 'kitchen'] : ['organizationStore', 'restaurant'];
    for (let i = 0; i < 47; i++) {
      const ItemId = await f.item(`Bulk ${i}`, { ItemCode: `B${i}` }); ids.push(ItemId);
      f.put(C.items, ItemId, { ...f.get(C.items, ItemId), Quantity: i + 1 });
      if (i % 2 === 0) f.target(`existing-${i}`, { ItemName: `Bulk ${i}`, ItemCode: `B${i}`, Quantity: i + 2.5, Price: i + 100, Notes: 'Preserve original' });
    }
    const batches = [0, 20, 40].map(offset => ({ action: 'assignitems', RequestId: `large-selection-${offset}`, SchoolSection: f.section,
      AssignedDepartments: departments, Items: ids.slice(offset, offset + 20).map(ItemId => ({ ItemId, ExpectedRevision: 1 })) }));
    await f.run(batches[0]); f.loseResponse(); await f.run(batches[1]);
    const commits = f.commits.length;
    assert.equal((await f.run(batches[1])).replayed, true); assert.equal(f.commits.length, commits);
    await f.run(batches[2]);
    const assigned = () => [...f.list(f.collection), ...f.list(edition === 'school' ? 'kitchenInventory' : 'restaurantInventory')]
      .filter(row => ids.includes(row.ProcurementItemId));
    const before = assigned().map(row => [row.__name, row.Quantity, row.Price]);
    assert.equal(before.length, 94); assert.equal(new Set(before.map(row => row[0])).size, 94);
    for (let i = 0; i < ids.length; i++) {
      assert.equal(f.get(C.items, ids[i]).Quantity, i + 1);
      const targets = assigned().filter(row => row.ProcurementItemId === ids[i]);
      assert.equal(targets.length, 2);
      if (i % 2 === 0) {
        const existing = f.get(f.collection, `existing-${i}`);
        assert.equal(existing.Quantity, i + 2.5); assert.equal(existing.Price, i + 100); assert.equal(existing.Notes, 'Preserve original');
      }
      assert.ok(targets.filter(row => !row.__id.startsWith('existing-')).every(row => row.Quantity === 0 && row.Price === 0));
    }
    for (const batch of batches) {
      const again = await f.command('assignitems', { ...batch, RequestId: crypto.randomUUID(), Items: batch.Items.map(row => ({ ...row, ExpectedRevision: 2 })) });
      assert.equal(again.summary.Created, 0); assert.equal(again.summary.Reused, batch.Items.length * 2);
    }
    assert.deepEqual(assigned().map(row => [row.__name, row.Quantity, row.Price]), before);
    assert.ok(f.list(C.movements).filter(row => row.Action === 'assignitems').every(row => row.Lines.length === 0));
  });
}

test('vendor ownership cannot enter through list, request destination, or central tampering', async () => {
  const f = fixture(), ItemId = await f.item();
  for (const change of [{ VendorId: 'vendor1' }, { OwnershipType: 'Vendor' }, { OwnerType: 'Vendor' }]) {
    f.target('vendor-stock', change);
    const result = await f.command('list'); assert.equal(result.departmentInventory.length, 1);
    await assert.rejects(f.command('request', { Department: f.department, SchoolSection: f.section, Notes: 'Test', Lines: [{ ItemId, InventoryId: 'vendor-stock', Quantity: 2 }] }, f.receiver), /vendor stock/);
  }
  f.put(C.items, ItemId, { ...f.get(C.items, ItemId), VendorId: 'tampered' });
  await assert.rejects(f.purchase(ItemId), /Vendor-owned/);
});

test('department destination must match exact branch, edition, section, store type, unit and central link', async () => {
  const f = fixture(), ItemId = await f.item();
  for (const changes of [{ BranchId: 'another' }, { OrganisationEdition: 'faith' }, { SchoolSection: 'Primary' }, { Unit: 'kg' }, { ProcurementItemId: 'another-central' }]) {
    f.target('wrong', changes);
    await assert.rejects(f.command('request', { Department: f.department, SchoolSection: f.section, Notes: 'Test', Lines: [{ ItemId, InventoryId: 'wrong', Quantity: 2 }] }, f.receiver));
  }
  const nonSchool = fixture('organization'), central = await nonSchool.item(); nonSchool.target('wrong', { StoreType: 'Bookstore' });
  await assert.rejects(nonSchool.command('request', { Department: nonSchool.department, SchoolSection: 'All', Notes: 'Test', Lines: [{ ItemId: central, InventoryId: 'wrong', Quantity: 2 }] }, nonSchool.receiver));
  assert.equal(inventoryAllowed({ BranchId: 'main', Quantity: 1 }, 'organizationStore', nonSchool.receiver, nonSchool.scope), false);
});

test('section selector filters department balances and restricted section cannot request outside it', async () => {
  const f = fixture(), ItemId = await f.item(); f.target('primary-item', { SchoolSection: 'Primary' });
  const primary = await f.command('list', { SchoolSection: 'Primary' }); assert.equal(primary.schoolSection, 'Primary'); assert.deepEqual(primary.departmentInventory.map(row => row.InventoryId), ['primary-item']);
  const secondaryOnly = { ...f.receiver, schoolSectionAccess: 'Secondary' };
  await assert.rejects(f.command('list', { SchoolSection: 'Primary' }, secondaryOnly), /assigned/);
  await assert.rejects(f.command('request', { Department: f.department, SchoolSection: 'Primary', Lines: [{ ItemId, InventoryId: 'primary-item', Quantity: 2 }], Notes: 'Need stock' }, secondaryOnly), /assigned/);
});

test('purchase approvals are separate, limits enforced and explicit owner override audited', async () => {
  const f = fixture(), ItemId = await f.item();
  const { PurchaseId } = await f.command('createpurchase', { SupplierName: 'S', Reference: 'REF1', Notes: 'Request', Lines: [{ ItemId, Quantity: 10, UnitCost: 2 }] }, f.admin);
  const review = { PurchaseId, ExpectedRevision: 1, Decision: 'APPROVED', Notes: 'Checked' };
  await assert.rejects(f.command('reviewpurchase', review, f.manager), /role/);
  await assert.rejects(f.command('reviewpurchase', review, f.admin), /own purchase/);
  await assert.rejects(f.command('reviewpurchase', review, { ...f.approver, approvalMaxAmount: 10 }), /approval limit/);
  await f.command('reviewpurchase', { ...review, OverrideReason: 'Sole authorised owner; supplier invoice checked.' }, f.admin);
  assert.match(f.get(C.purchases, PurchaseId).OverrideReason, /Sole authorised/);
  await assert.rejects(f.command('reviewpurchase', { ...review, ExpectedRevision: 2 }, f.approver), /pending/);
});

test('purchase supplier/reference duplicate blocked; pending or rejected purchases cannot receive stock', async () => {
  const f = fixture(), ItemId = await f.item(), fields = { SupplierName: 'Supplier', Reference: 'REF', Notes: 'Request', Lines: [{ ItemId, Quantity: 10, UnitCost: 1 }] };
  const { PurchaseId } = await f.command('createpurchase', fields);
  await assert.rejects(f.command('createpurchase', { ...fields, SupplierName: 'supplier', Reference: 'ref' }), /already exists/);
  await assert.rejects(f.receivePurchase(PurchaseId, ItemId, 1), /Approve/);
  await f.command('reviewpurchase', { PurchaseId, ExpectedRevision: 1, Decision: 'REJECTED', Notes: 'Not required' }, f.approver);
  await assert.rejects(f.receivePurchase(PurchaseId, ItemId, 1), /Approve/);
  assert.equal(f.get(C.items, ItemId).Quantity, 0);
});

test('partial purchase receipts prevent excess, duplicate delivery references and unknown items', async () => {
  const f = fixture(), ItemId = await f.item(), PurchaseId = await f.purchase(ItemId, 10);
  await f.receivePurchase(PurchaseId, ItemId, 4, { DeliveryReference: 'DELIVERY1' });
  assert.equal(f.get(C.items, ItemId).Quantity, 4); assert.equal(f.get(C.purchases, PurchaseId).Status, 'PARTIALLY_RECEIVED');
  await assert.rejects(f.receivePurchase(PurchaseId, ItemId, 1, { DeliveryReference: 'delivery1' }), /already been received/);
  await assert.rejects(f.receivePurchase(PurchaseId, ItemId, 7), /outstanding/);
  await assert.rejects(f.receivePurchase(PurchaseId, 'unknown-item', 1), /not part/);
  await f.receivePurchase(PurchaseId, ItemId, 6); assert.equal(f.get(C.items, ItemId).Quantity, 10);
});

test('issue rejects stock shortage and unapproved/excess request; no partial writes on multi-line failure', async () => {
  const f = fixture(), ItemId = await f.stocked(5), RequisitionId = await f.requisition(ItemId, 10);
  const baseline = f.commits.length;
  await assert.rejects(f.issue(RequisitionId, ItemId, 6), /Insufficient/); assert.equal(f.commits.length, baseline);
  await assert.rejects(f.issue(RequisitionId, ItemId, 11), /exceeds/);
  assert.equal(f.get(C.items, ItemId).Quantity, 5);
  const { RequisitionId: pending } = await f.command('request', { Department: f.department, SchoolSection: f.section, Notes: 'Need stock', Lines: [{ ItemId, InventoryId: 'department-item', Quantity: 2 }] }, f.receiver);
  await assert.rejects(f.issue(pending, ItemId, 1), /Approve/);
});

test('receipt must be by assigned department, not dispatching officer, except audited superadmin override', async () => {
  const f = fixture(), ItemId = await f.stocked(), RequisitionId = await f.requisition(ItemId), { TransferId } = await f.issue(RequisitionId, ItemId, 20);
  await assert.rejects(f.receive(TransferId, ItemId, 1, {}, f.manager), /receiving department/);
  await assert.rejects(f.receive(TransferId, ItemId, 1, {}, { ...f.receiver, username: f.manager.username }), /issuing officer/);
  await assert.rejects(f.receive(TransferId, ItemId, 1, {}, { ...f.receiver, allowedSections: ['procurement', 'kitchen'] }), /not available/);
  await f.receive(TransferId, ItemId, 1, { OverrideReason: 'Owner independently counted the returned delivery.' }, { ...f.admin, username: f.manager.username });
  assert.ok(f.get(C.transfers, TransferId).Receipts[0].OverrideReason);
});

test('partial receipts/discrepancy/physical transit returns conserve stock and reopen unfulfilled request', async () => {
  const f = fixture(), ItemId = await f.stocked(100), RequisitionId = await f.requisition(ItemId, 20), { TransferId } = await f.issue(RequisitionId, ItemId, 20);
  await f.receive(TransferId, ItemId, 12);
  await f.receive(TransferId, ItemId, 0, { ReportDiscrepancy: true, Notes: 'Eight units not delivered yet.' });
  assert.equal(f.get(C.transfers, TransferId).Status, 'DISCREPANCY'); assert.equal(f.get(C.items, ItemId).Quantity, 80);
  await f.command('returntransfer', { TransferId, ExpectedRevision: f.get(C.transfers, TransferId).Revision, Notes: 'Eight sealed units physically returned to central stores.', Lines: [{ ItemId, Quantity: 8 }] });
  assert.equal(f.get(C.items, ItemId).Quantity, 88); assert.equal(f.get(f.collection, 'department-item').Quantity, 19);
  assert.equal(f.get(C.transfers, TransferId).Status, 'COMPLETED_WITH_RETURNS'); assert.equal(f.get(C.requests, RequisitionId).Status, 'PARTIALLY_ISSUED');
  const replacement = await f.issue(RequisitionId, ItemId, 8); await f.receive(replacement.TransferId, ItemId, 8);
  assert.equal(f.get(C.items, ItemId).Quantity, 80); assert.equal(f.get(f.collection, 'department-item').Quantity, 27);
});

test('fractional repeated receipts stay exact; department sales changes are preserved', async () => {
  const f = fixture(), ItemId = await f.stocked(1), RequisitionId = await f.requisition(ItemId, 0.3), { TransferId } = await f.issue(RequisitionId, ItemId, 0.3);
  await f.receive(TransferId, ItemId, 0.1);
  f.put(f.collection, 'department-item', { ...f.get(f.collection, 'department-item'), Quantity: 6.1 });
  await f.receive(TransferId, ItemId, 0.1); await f.receive(TransferId, ItemId, 0.1);
  assert.equal(f.get(f.collection, 'department-item').Quantity, 6.3); assert.equal(f.get(C.items, ItemId).Quantity, 0.7);
  assert.equal(f.get(C.transfers, TransferId).Status, 'RECEIVED');
});

test('same operation retries replay saved result even after revision changes or lost response', async () => {
  const f = fixture(), ItemId = await f.item(), PurchaseId = await f.purchase(ItemId, 10), body = { action: 'receivepurchase', RequestId: 'durable-request-1',
    PurchaseId, ExpectedRevision: 2, DeliveryReference: 'same-delivery', Notes: 'Counted', Lines: [{ ItemId, Quantity: 5 }] };
  f.loseResponse(); const first = await f.run(body); assert.equal(first.replayed, true);
  const after = f.commits.length; const second = await f.run(body); assert.equal(second.replayed, true);
  assert.equal(f.commits.length, after); assert.equal(f.get(C.items, ItemId).Quantity, 5);
  await assert.rejects(f.run({ ...body, Lines: [{ ItemId, Quantity: 6 }] }), /different entries/);
});

test('concurrent requests for one operation are idempotent and different competing stock operations conflict safely', async () => {
  const f = fixture(), ItemId = await f.item(), PurchaseId = await f.purchase(ItemId, 10), body = { action: 'receivepurchase', RequestId: 'concurrent-key-1',
    PurchaseId, ExpectedRevision: 2, DeliveryReference: 'delivery-1', Notes: 'Counted', Lines: [{ ItemId, Quantity: 5 }] };
  const results = await Promise.all([f.run(body), f.run(body)]); assert.ok(results.some(result => result.replayed));
  assert.equal(f.get(C.items, ItemId).Quantity, 5);
  const RequisitionId = await f.requisition(ItemId, 5); f.setConflict(true); const before = f.commits.length;
  await assert.rejects(f.issue(RequisitionId, ItemId, 5), /Nothing was partially/);
  assert.equal(f.commits.length, before); assert.equal(f.get(C.items, ItemId).Quantity, 5); assert.equal(f.list(C.transfers).length, 0);
});

test('configuration is reviewed, versioned, restricted and never migrates or rewrites existing stock', async () => {
  const f = fixture(), before = f.get(f.collection, 'department-item');
  const fields = { Enabled: true, ConfirmExistingBalances: true, ExpectedRevision: 0, Notes: 'Reviewed starting balances and configured receiving departments.' };
  await assert.rejects(f.command('settings', fields), /role/);
  await assert.rejects(f.command('settings', { ...fields, ConfirmExistingBalances: false }, f.approver), /explicitly confirm/);
  await f.command('settings', fields, f.approver);
  assert.equal(f.get(C.settings, f.scope.ScopeKey).Enabled, true); assert.deepEqual(f.get(f.collection, 'department-item'), before);
  await assert.rejects(f.command('settings', { ...fields, Enabled: false }, f.approver), /changed/);
  await f.command('settings', { ...fields, Enabled: false, ExpectedRevision: 1 }, f.approver);
  assert.equal(f.get(C.settings, f.scope.ScopeKey).Enabled, false); assert.deepEqual(f.get(f.collection, 'department-item'), before);
});

function competeAtCommit(f) {
  const original = f.deps.commit;
  let count = 0, release;
  const barrier = new Promise(resolve => { release = resolve; });
  f.deps.commit = async (...args) => {
    count += 1;
    if (count <= 2) { if (count === 2) release(); await barrier; }
    return original(...args);
  };
}

test('two distinct approved requests competing for central stock cannot oversell or create a losing transfer', async () => {
  const f = fixture(), ItemId = await f.stocked(10);
  f.target('second-destination');
  const first = await f.requisition(ItemId, 7);
  const second = await f.requisition(ItemId, 7, { Lines: [{ ItemId, InventoryId: 'second-destination', Quantity: 7 }] });
  competeAtCommit(f);
  const outcomes = await Promise.allSettled([f.issue(first, ItemId, 7), f.issue(second, ItemId, 7)]);
  assert.equal(outcomes.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(row => row.status === 'rejected' && row.reason.code === 'PROCUREMENT_WRITE_CONFLICT').length, 1);
  assert.equal(f.get(C.items, ItemId).Quantity, 3);
  assert.equal(f.list(C.transfers).length, 1);
  assert.equal(f.get(f.collection, 'department-item').Quantity, 7);
  assert.equal(f.get(f.collection, 'second-destination').Quantity, 7);
  const requests = [f.get(C.requests, first), f.get(C.requests, second)];
  assert.deepEqual(requests.map(row => row.Lines[0].IssuedQuantity).sort(), [0, 7]);
  const losing = requests.find(row => row.Lines[0].IssuedQuantity === 0);
  await assert.rejects(f.issue(losing.RequisitionId, ItemId, 7), /Insufficient stock/);
});

test('different department receipts compete safely on one balance and a reviewed retry credits only the remaining delivery', async () => {
  const f = fixture(), ItemId = await f.stocked(10);
  const first = await f.requisition(ItemId, 3), second = await f.requisition(ItemId, 3);
  const a = await f.issue(first, ItemId, 3), b = await f.issue(second, ItemId, 3);
  competeAtCommit(f);
  const outcomes = await Promise.allSettled([f.receive(a.TransferId, ItemId, 3), f.receive(b.TransferId, ItemId, 3)]);
  assert.equal(outcomes.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(f.get(f.collection, 'department-item').Quantity, 10);
  const loser = [a, b][outcomes.findIndex(row => row.status === 'rejected')];
  assert.equal(f.get(C.transfers, loser.TransferId).Receipts.length, 0);
  await f.receive(loser.TransferId, ItemId, 3);
  assert.equal(f.get(f.collection, 'department-item').Quantity, 13);
  assert.equal(f.get(C.items, ItemId).Quantity, 4);
  assert.equal(f.list(C.transfers).filter(row => row.Status === 'RECEIVED').length, 2);
});

test('different supplier deliveries cannot overwrite each other on one central item', async () => {
  const f = fixture(), ItemId = await f.item(), first = await f.purchase(ItemId, 4), second = await f.purchase(ItemId, 6);
  competeAtCommit(f);
  const outcomes = await Promise.allSettled([f.receivePurchase(first, ItemId, 4), f.receivePurchase(second, ItemId, 6)]);
  assert.equal(outcomes.filter(row => row.status === 'fulfilled').length, 1);
  const losingIndex = outcomes.findIndex(row => row.status === 'rejected');
  assert.equal(f.get(C.items, ItemId).Quantity, losingIndex === 0 ? 6 : 4);
  const loser = [first, second][losingIndex];
  assert.equal(f.get(C.purchases, loser).Receipts, undefined);
  await f.receivePurchase(loser, ItemId, losingIndex === 0 ? 4 : 6);
  assert.equal(f.get(C.items, ItemId).Quantity, 10);
  assert.equal(f.list(C.purchases).filter(row => row.Status === 'RECEIVED').length, 2);
});

test('central and workflow record lookups reject forged cross-branch and cross-edition IDs', async () => {
  const f = fixture(), ItemId = await f.item();
  for (const changes of [{ BranchId: 'foreign' }, { OrganisationEdition: 'organization' }, { ScopeKey: 'faith--main' }]) {
    const original = f.get(C.items, ItemId); f.put(C.items, ItemId, { ...original, ...changes });
    await assert.rejects(f.purchase(ItemId), /not available/); f.put(C.items, ItemId, original);
  }
});

for (const edition of ['school', 'faith', 'organization']) test(`${edition}: procurement officer can register zero-stock department destination without changing existing stock`, async () => {
  const f = fixture(edition), ItemId = await f.item('New supply');
  const fields = { Department: f.department, SchoolSection: f.section, ItemId, ItemCode: 'NEW', Price: 12.5 };
  await assert.rejects(f.command('savedestination', fields, f.receiver), /role/);
  const { InventoryId } = await f.command('savedestination', fields);
  assert.equal(f.get(f.collection, InventoryId).Quantity, 0); assert.equal(f.get(f.collection, InventoryId).ProcurementItemId, ItemId);
  assert.equal(f.get(f.collection, InventoryId).Price, 12.5); assert.equal(f.get(f.collection, 'department-item').Quantity, 7);
  await assert.rejects(f.command('savedestination', fields), /already exists/);
  const request = await f.command('request', { Department: f.department, SchoolSection: f.section, Notes: 'Need new supplies', Lines: [{ ItemId, InventoryId, Quantity: 1 }] }, f.receiver);
  assert.ok(request.RequisitionId);
});

test('multi-line issue never deducts an available first item when another item has insufficient stock', async () => {
  const f = fixture(), first = await f.stocked(10), second = await f.item('Second supply'); f.target('second-destination', { ItemName: 'Second supply' });
  const { RequisitionId } = await f.command('request', { Department: f.department, SchoolSection: f.section, Notes: 'Need both supplies', Lines: [
    { ItemId: first, InventoryId: 'department-item', Quantity: 3 }, { ItemId: second, InventoryId: 'second-destination', Quantity: 3 }
  ] }, f.receiver);
  await f.command('reviewrequest', { RequisitionId, ExpectedRevision: 1, Decision: 'APPROVED', Notes: 'Approved need' });
  const before = f.commits.length;
  await assert.rejects(f.command('issue', { RequisitionId, ExpectedRevision: 2, Notes: 'Deliver both', Lines: [{ ItemId: first, Quantity: 3 }, { ItemId: second, Quantity: 3 }] }), /Insufficient/);
  assert.equal(f.commits.length, before); assert.equal(f.get(C.items, first).Quantity, 10); assert.equal(f.get(C.items, second).Quantity, 0);
  assert.equal(f.get(C.requests, RequisitionId).Status, 'APPROVED'); assert.equal(f.list(C.transfers).length, 0);
});

test('legacy binary floating stock residue does not block a valid receipt; finer stock precision does', async () => {
  const f = fixture(), ItemId = await f.stocked(), RequisitionId = await f.requisition(ItemId, 1), { TransferId } = await f.issue(RequisitionId, ItemId, 1);
  f.put(f.collection, 'department-item', { ...f.get(f.collection, 'department-item'), Quantity: 0.3 - 0.1 });
  await f.receive(TransferId, ItemId, 0.1); assert.equal(f.get(f.collection, 'department-item').Quantity, 0.3);
  f.put(f.collection, 'department-item', { ...f.get(f.collection, 'department-item'), Quantity: 0.0001 });
  await assert.rejects(f.receive(TransferId, ItemId, 0.1), /precision/);
});

test('school-section restricted approver cannot enable branch-wide procurement controls', async () => {
  const f = fixture();
  await assert.rejects(f.command('settings', { Enabled: true, ConfirmExistingBalances: true, ExpectedRevision: 0, Notes: 'Enable controls' },
    { ...f.approver, schoolSectionAccess: 'Primary' }), /role/);
  assert.equal(f.commits.length, 0);
});

test('a rejected request never permanently links department stock to a mistaken central item', async () => {
  const f = fixture(), wrong = await f.item('Wrong supply'), correct = await f.item('Correct supply');
  const { RequisitionId } = await f.command('request', { Department: f.department, SchoolSection: f.section, Notes: 'Mistaken selection',
    Lines: [{ ItemId: wrong, InventoryId: 'department-item', Quantity: 2 }] }, f.receiver);
  assert.equal(f.get(f.collection, 'department-item').ProcurementItemId, undefined);
  assert.equal(f.get(C.requests, RequisitionId).Lines[0].DepartmentItemName, 'Medical supply');
  await f.command('reviewrequest', { RequisitionId, ExpectedRevision: 1, Decision: 'REJECTED', Notes: 'Selected the wrong central item' });
  const valid = await f.requisition(correct, 2), PurchaseId = await f.purchase(correct, 2); await f.receivePurchase(PurchaseId, correct, 2);
  await f.issue(valid, correct, 2); assert.equal(f.get(f.collection, 'department-item').ProcurementItemId, correct);
});

test('ownership changed after requesting supplies prevents dispatch without moving any central stock', async () => {
  const f = fixture(), ItemId = await f.stocked(), RequisitionId = await f.requisition(ItemId);
  f.target('department-item', { VendorId: 'new-vendor' }); const before = f.commits.length;
  await assert.rejects(f.issue(RequisitionId, ItemId, 20), /vendor stock/);
  assert.equal(f.commits.length, before); assert.equal(f.get(C.items, ItemId).Quantity, 100);
});

test('normal inventory reads are branch-indexed; older unscoped stock is explicitly found without rewriting its balance', async () => {
  const f = fixture(), queries = [], originalQuery = f.deps.query;
  f.deps.query = async (env, collection, options) => { queries.push({ collection, options }); return originalQuery(env, collection, options); };
  f.target('unscoped-old', { BranchId: undefined, OrganisationEdition: undefined, ItemName: 'Legacy supply', Quantity: 32 });
  f.target('other-branch', { BranchId: 'other', ItemName: 'Legacy supply' });
  f.target('other-section', { SchoolSection: 'Primary', ItemName: 'Legacy supply' });
  const listed = await f.command('list'); assert.ok(!listed.departmentInventory.some(row => row.InventoryId === 'unscoped-old'));
  assert.ok(queries.filter(query => query.collection === f.collection).every(query => query.options.filters.some(filter => filter.field === 'BranchId' && filter.value === 'main')));
  const result = await f.command('lookupinventory', { Department: f.department, SchoolSection: 'Secondary', ItemName: 'Legacy supply' }, f.receiver);
  assert.deepEqual(result.departmentInventory.map(row => row.InventoryId), ['unscoped-old']); assert.equal(f.commits.length, 0);
  const ItemId = await f.item('Legacy supply');
  await assert.rejects(f.command('savedestination', { ItemId, Department: f.department, SchoolSection: 'Secondary' }), /legacy inventory/);
  const PurchaseId = await f.purchase(ItemId, 2); await f.receivePurchase(PurchaseId, ItemId, 2);
  const RequisitionId = await f.requisition(ItemId, 2, { Lines: [{ ItemId, Quantity: 2, InventoryId: 'unscoped-old' }] });
  await f.issue(RequisitionId, ItemId, 2);
  assert.equal(f.get(f.collection, 'unscoped-old').Quantity, 32); assert.equal(f.get(f.collection, 'unscoped-old').BranchId, 'main');
  assert.ok((await f.command('list')).departmentInventory.some(row => row.InventoryId === 'unscoped-old'));
});

test('legacy stock lookup is read-only, sanitised and never bypasses vendor, branch or department permissions', async () => {
  const f = fixture();
  const result = await f.command('lookupinventory', { Department: f.department, SchoolSection: f.section, InventoryId: 'department-item' }, { ...f.receiver, subscriptionReadOnly: true });
  assert.equal(result.departmentInventory.length, 1); assert.doesNotMatch(JSON.stringify(result), /never-return-this/); assert.equal(f.commits.length, 0);
  await assert.rejects(f.command('lookupinventory', { Department: 'kitchen', SchoolSection: f.section, InventoryId: 'department-item' }, f.receiver), /not assigned/);
  for (const change of [{ VendorId: 'vendor' }, { BranchId: 'another' }]) {
    f.target('unavailable', change);
    await assert.rejects(f.command('lookupinventory', { Department: f.department, SchoolSection: f.section, InventoryId: 'unavailable' }, f.receiver), /No organisation-owned/);
  }
});

test('explicitly disabled approval grants cannot approve purchases or change branch control', async () => {
  const f = fixture(), ItemId = await f.item();
  const { PurchaseId } = await f.command('createpurchase', { SupplierName: 'S', Reference: 'GRANT', Notes: 'Need stock', Lines: [{ ItemId, Quantity: 1, UnitCost: 1 }] });
  for (const flags of [{ approvalEnabled: false }, { ApprovalEnabled: 'NO' }, { approvalEnabled: undefined }, { approvalEnabled: 'false' }]) {
    const disabled = { ...f.approver, ...flags };
    assert.equal((await f.command('list', {}, disabled)).capabilities.canApprove, false);
    await assert.rejects(f.command('reviewpurchase', { PurchaseId, ExpectedRevision: 1, Decision: 'APPROVED', Notes: 'Approve' }, disabled), /role/);
    await assert.rejects(f.command('settings', { Enabled: true, ExpectedRevision: 0, ConfirmExistingBalances: true, Notes: 'Enable' }, disabled), /role/);
  }
  await f.command('reviewpurchase', { PurchaseId, ExpectedRevision: 1, Decision: 'APPROVED', Notes: 'Owner approval' }, { ...f.admin, approvalEnabled: false });
  assert.equal(f.get(C.purchases, PurchaseId).Status, 'APPROVED');
});

test('purchase approval fails closed for missing, zero, negative or invalid account limits', async () => {
  const f = fixture(), ItemId = await f.item();
  const { PurchaseId } = await f.command('createpurchase', { SupplierName: 'S', Reference: 'LIMITS', Notes: 'Need stock', Lines: [{ ItemId, Quantity: 10, UnitCost: 2 }] });
  const review = { PurchaseId, ExpectedRevision: 1, Decision: 'APPROVED', Notes: 'Checked purchase' };
  for (const approvalMaxAmount of [undefined, null, '', 0, -1, NaN, Infinity, 'invalid', 19.99]) {
    await assert.rejects(f.command('reviewpurchase', review, { ...f.approver, approvalMaxAmount }), /approval limit/);
    assert.equal(f.get(C.purchases, PurchaseId).Status, 'PENDING');
  }
  await f.command('reviewpurchase', review, { ...f.approver, approvalMaxAmount: 20 });
  assert.equal(f.get(C.purchases, PurchaseId).Status, 'APPROVED');
});
