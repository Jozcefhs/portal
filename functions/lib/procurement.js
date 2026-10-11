import { getDocument, queryCollectionPages, batchCommitLiteralDocuments } from './firestore.js';
import { schoolSectionFor } from './school-scope.js';
import { procurementRecordPage, procurementRecordDetail } from './procurement-history.js';
import { DEPARTMENTS, clean, lower, plain, fail, actor, vendorOwned, scopeFor, capabilitiesFor, schoolSectionsFor, sectionFor,
  sameScope, visibleRecord, inventoryAllowed, id, units, unitCost, quantity, linesFor, version, requireCapability, separatedActor } from './procurement-rules.js';

export const PROCUREMENT_COLLECTIONS = Object.freeze({ items: 'procurementItems', requests: 'procurementRequests', purchases: 'procurementPurchases',
  transfers: 'procurementTransfers', movements: 'procurementMovements', operations: 'procurementOperations', settings: 'procurementSettings' });
const defaults = { get: getDocument, query: queryCollectionPages, commit: batchCommitLiteralDocuments };
const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
async function hash(value) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
function text(value, label, required = true, length = 2000) {
  const result = clean(value);
  if (result.length > length || (required && !result)) fail(`${label} is required and must be at most ${length} characters.`);
  return result;
}
function write(collectionPath, documentId, data, previous) {
  if (previous && !clean(previous.__updateTime)) fail('Refresh this record before saving.', 409);
  return { collectionPath, documentId, data: plain(data), ...(previous ? { updateTime: previous.__updateTime } : { exists: false }) };
}
const stockUnits = row => {
  const saved = Number(row.Quantity ?? 0), rounded = Math.round(saved * 1000) / 1000;
  // Old stock-out code may have persisted 0.3 - 0.1 as 0.19999999999999998.
  // Accept only binary floating-point residue, not genuinely finer stock units.
  if (!Number.isFinite(saved) || Math.abs(saved - rounded) > 0.0000001) fail('Saved stock quantity needs review; supported precision is three decimal places.', 409);
  return units(rounded, 'Saved stock quantity', true);
};
const tally = (row, field) => units(row[field] ?? 0, field, true);
const totalCost = lines => {
  const cents = lines.reduce((sum, line) => sum + Math.round(units(line.Quantity) * Math.round(line.UnitCost * 100) / 1000), 0);
  if (!Number.isSafeInteger(cents) || cents > 100000000000000) fail('The purchase total exceeds the permitted amount.');
  return cents / 100;
};
function publicInventory(row, department, scope) {
  const config = DEPARTMENTS[department];
  // Inventory metadata only: never forward arbitrary fields from older import records.
  return { InventoryId: row.__id, Department: department, SchoolSection: scope.OrganisationEdition === 'school'
    ? (schoolSectionFor(row) === 'primary' ? 'Primary' : 'Secondary') : 'All', ItemName: row.ItemName, ItemCode: row.ItemCode || '',
    Unit: row.Unit || config.Unit, Quantity: row.Quantity || 0, ReorderLevel: row.ReorderLevel || 0,
    ProcurementManaged: row.ProcurementManaged || '', ProcurementItemId: row.ProcurementItemId || '' };
}

export async function handleProcurementAction(env, user, body = {}, dependencies = {}) {
  const db = { ...defaults, ...dependencies }, scope = scopeFor(user), cap = capabilitiesFor(user, scope);
  const action = lower(body.action || 'list'), C = PROCUREMENT_COLLECTIONS;
  const readOnly = user.subscriptionActive === false || user.subscriptionReadOnly === true;
  if (!['list', 'lookupinventory', 'records', 'recorddetail'].includes(action) && readOnly) fail('This workspace is read-only. Stock and Procurement records cannot be changed.', 403);
  const now = new Date().toISOString();
  const base = { ...scope, CreatedAt: now, CreatedBy: clean(user.displayName || user.username), CreatedByUsername: actor(user), Revision: 1 };
  const next = row => ({ ...plain(row), Revision: Number(row.Revision || 0) + 1, UpdatedAt: now, UpdatedBy: actor(user) });
  async function scoped(collection, recordId, departmental = false) {
    const row = await db.get(env, collection, id(recordId));
    if (!(departmental ? visibleRecord(row, user, scope, cap) : sameScope(row, scope))) fail('This record is not available in your branch, edition or department.', 404);
    return row;
  }
  async function central(itemId) {
    const row = await scoped(C.items, itemId);
    if (vendorOwned(row)) fail('Vendor-owned stock cannot enter Procurement.', 409);
    return row;
  }
  async function inventory(department, inventoryId, schoolSection, centralItem = null) {
    if (!cap.departments.includes(department)) fail('This department is not assigned or enabled.', 403);
    const config = DEPARTMENTS[department], row = await db.get(env, config.Collection, id(inventoryId, 'department stock record'));
    if (!inventoryAllowed(row, department, user, scope)) fail('Choose organisation-owned stock in this branch and department; vendor stock is kept separate.', 403);
    if (scope.OrganisationEdition === 'school' && schoolSectionFor(row) !== lower(schoolSection)) fail('The department stock belongs to another school section.', 403);
    if (centralItem && lower(row.Unit || config.Unit) !== lower(centralItem.Unit)) fail('Central and department stock units must match. Use separate catalogue items for different units.');
    if (centralItem && clean(row.ProcurementItemId) && row.ProcurementItemId !== centralItem.ItemId) fail('This department stock is already linked to another central item.', 409);
    return row;
  }
  async function rows(collection) {
    return (await db.query(env, collection, { filters: [{ field: 'ScopeKey', op: '==', value: scope.ScopeKey }], pageSize: 250, maxRows: 5000 }))
      .filter(row => sameScope(row, scope));
  }
  const receiptAllowed = row => cap.receiveDepartments.includes(row.Department) && visibleRecord(row, user, scope, cap);
  const receiveFlags = values => values.map(row => ({ ...row, CanReceive: receiptAllowed(row) }));
  if (action === 'records') {
    const page = await procurementRecordPage(env, user, scope, cap, body, dependencies);
    return { ok: true, kind: body.Kind, records: body.Kind === 'transfers' ? receiveFlags(page.rows) : page.rows, paging: page.paging };
  }
  if (action === 'recorddetail') {
    return { ok: true, record: await procurementRecordDetail(env, user, scope, cap, body, dependencies) };
  }
  if (action === 'lookupinventory') {
    const Department = clean(body.Department), SchoolSection = sectionFor(user, scope, body.SchoolSection);
    if (!cap.departments.includes(Department)) fail('This department is not assigned or enabled.', 403);
    const config = DEPARTMENTS[Department], InventoryId = clean(body.InventoryId);
    // Explicit lookup retains access to genuinely old, unscoped school inventory
    // without making every branch scan every other branch on each dashboard load.
    const found = InventoryId ? [await db.get(env, config.Collection, id(InventoryId, 'inventory record'))]
      : await db.query(env, config.Collection, { filters: [{ field: 'ItemName', op: '==', value: text(body.ItemName, 'Exact item name', true, 160) }], pageSize: 100, maxRows: 100 });
    const departmentInventory = found.filter(row => inventoryAllowed(row, Department, { ...user, schoolSectionAccess: SchoolSection }, scope)).map(row => publicInventory(row, Department, scope));
    if (!departmentInventory.length) fail('No organisation-owned item matches in this department and school section. Check the exact name or inventory ID.', 404);
    return { ok: true, departmentInventory, message: 'Existing inventory found. No stock or ownership was changed.' };
  }
  if (action === 'list') {
    const schoolSection = sectionFor(user, scope, body.SchoolSection || schoolSectionsFor(user, scope).at(-1));
    const viewUser = { ...user, schoolSectionAccess: schoolSection };
    const collections = [...new Set(cap.departments.map(key => DEPARTMENTS[key].Collection))];
    const emptyPage = { rows: [], paging: { mode: 'active', hasMore: false, nextCursor: null } };
    const recordPage = Kind => procurementRecordPage(env, user, scope, cap, { Kind, Mode: 'active', SchoolSection: schoolSection }, dependencies);
    const [items, requests, purchases, transfers, settings, groups] = await Promise.all([
      rows(C.items), recordPage('requests'), cap.canManage || cap.canApprove ? recordPage('purchases') : emptyPage, recordPage('transfers'),
      db.get(env, C.settings, scope.ScopeKey),
      Promise.all(collections.map(async collection => [collection, await db.query(env, collection, { filters: [{ field: 'BranchId', op: '==', value: scope.BranchId }], pageSize: 250, maxRows: 5000 })]))
    ]);
    const inventories = new Map(groups);
    const departmentInventory = cap.departments.flatMap(department => (inventories.get(DEPARTMENTS[department].Collection) || [])
      .filter(row => inventoryAllowed(row, department, viewUser, scope)).map(row => publicInventory(row, department, scope)));
    return { ok: true, scope, schoolSection, readOnly, capabilities: cap, schoolSections: schoolSectionsFor(user, scope),
      departments: cap.departments.map(Key => ({ Key, Name: scope.OrganisationEdition === 'organization'
        ? ({ organizationStore: 'Inventory & Sales', restaurant: 'Catering Operations' }[Key] || DEPARTMENTS[Key].Name)
        : DEPARTMENTS[Key].Name })), departmentInventory,
      settings: settings ? plain(settings) : { ...scope, Enabled: false, Revision: 0 },
      items: items.filter(row => !vendorOwned(row)).map(plain).sort((a, b) => a.ItemName.localeCompare(b.ItemName)),
      requests: requests.rows, purchases: purchases.rows, transfers: receiveFlags(transfers.rows),
      paging: { requests: requests.paging, purchases: purchases.paging, transfers: transfers.paging } };
  }
  const actions = new Set(['settings', 'saveitem', 'savedestination', 'request', 'reviewrequest', 'createpurchase', 'reviewpurchase', 'receivepurchase', 'issue', 'confirmreceipt', 'returntransfer']);
  if (!actions.has(action)) fail('Unknown Procurement action.');
  const requestId = id(body.RequestId, 'operation reference');
  if (requestId.length < 8) fail('The operation reference is too short.');
  const operationId = await hash(`${scope.ScopeKey}|${actor(user)}|${requestId}`);
  const fingerprint = await hash(JSON.stringify(sorted({ ...body, RequestId: undefined })));
  async function replay() {
    const saved = await db.get(env, C.operations, operationId);
    if (!saved) return null;
    if (saved.Fingerprint !== fingerprint || saved.Action !== action) fail('This operation reference was already used for different entries. Refresh before proceeding.', 409);
    return { ...saved.Result, replayed: true };
  }
  const previousResult = await replay();
  if (previousResult) return previousResult;
  const writes = [], movements = [];
  const result = { ok: true, message: 'Procurement records updated.' };
  function stage(collection, documentId, data, previous) { writes.push(write(collection, documentId, data, previous)); }
  function stockChange(collection, documentId, row, delta, extra = {}) {
    const before = stockUnits(row), after = before + delta;
    if (after < 0) fail(`Insufficient stock for ${row.ItemName || documentId}. Refresh and reduce the quantity.`, 409);
    if (!Number.isSafeInteger(after) || after > 1000000000000) fail('The resulting stock balance is too large.');
    const data = { ...plain(row), ...extra, Quantity: quantity(after), UpdatedAt: now, LastUpdated: now, UpdatedBy: actor(user) };
    stage(collection, documentId, data, row);
    movements.push({ Collection: collection, InventoryId: documentId, ItemName: row.ItemName, Unit: row.Unit || 'pcs',
      Quantity: quantity(Math.abs(delta)), Direction: delta < 0 ? 'OUT' : 'IN', Before: quantity(before), After: quantity(after) });
  }
  function checkLines(record, submitted) {
    return submitted.map(line => {
      const saved = record.Lines.find(item => item.ItemId === line.ItemId);
      if (!saved) fail('The selected item is not part of this document.');
      return { ...line, saved };
    });
  }
  try {
  if (action === 'settings') {
    requireCapability(cap, 'canConfigure');
    if (typeof body.Enabled !== 'boolean' || body.ConfirmExistingBalances !== true) fail('Review existing department balances and explicitly confirm the Procurement control change.');
    const existing = await db.get(env, C.settings, scope.ScopeKey);
    version(body, existing || { Revision: 0 });
    const Notes = text(body.Notes, 'Reason for changing Procurement control');
    stage(C.settings, scope.ScopeKey, { ...(existing ? next(existing) : base), Enabled: body.Enabled, Notes,
      ExistingBalancesPreserved: true, UpdatedAt: now, UpdatedBy: actor(user) }, existing);
    result.message = body.Enabled ? 'Procurement control enabled. Existing balances are unchanged; future organisation-owned replenishment must use Procurement.'
      : 'Branch-wide Procurement control disabled. Individually linked Procurement stock remains protected.';
  } else if (action === 'saveitem') {
    requireCapability(cap, 'canManage');
    const ItemName = text(body.ItemName, 'Item name', true, 160), Unit = text(body.Unit, 'Stock unit', true, 40), ItemCode = text(body.ItemCode, 'Item code', false, 80);
    const ItemId = clean(body.ItemId) || `ITEM-${(await hash(`${scope.ScopeKey}|${lower(ItemCode || ItemName)}|${lower(Unit)}`)).slice(0, 32)}`;
    const existing = clean(body.ItemId) ? await central(ItemId) : await db.get(env, C.items, ItemId);
    if (existing && !body.ItemId) fail('This central catalogue item already exists. Edit it instead of adding a duplicate.', 409);
    if (existing) { version(body, existing); if (lower(existing.Unit) !== lower(Unit)) fail('A central item’s stock unit cannot change. Create a separate item for the new unit.'); }
    if (vendorOwned(body) || (body.Quantity !== undefined && Number(body.Quantity) !== 0)) fail('Central stock starts at zero. Use approved purchase receipts; vendor stock is not supported.');
    stage(C.items, ItemId, { ...(existing ? next(existing) : base), ItemId, ItemName, ItemCode, Unit,
      Category: text(body.Category, 'Category', false, 100), ReorderLevel: quantity(units(body.ReorderLevel ?? 0, 'Reorder level', true)),
      Quantity: existing?.Quantity || 0, OwnershipType: 'Organisation' }, existing);
    result.ItemId = ItemId;
  } else if (action === 'savedestination') {
    requireCapability(cap, 'canManage');
    const Department = clean(body.Department), SchoolSection = sectionFor(user, scope, body.SchoolSection);
    if (!cap.departments.includes(Department)) fail('Choose an enabled receiving department.', 403);
    const item = await central(body.ItemId), config = DEPARTMENTS[Department];
    const ItemCode = text(body.ItemCode || item.ItemCode, 'Department item code', !!config.StoreType, 80);
    const inventoryId = (config.StoreType ? `${config.StoreType}-${ItemCode}-${scope.BranchId}-${SchoolSection}` : `${scope.BranchId}-${SchoolSection}-${item.ItemName}`)
      .replace(/[\/\\?#\[\]]/g, '-').replace(/\s+/g, '_').slice(0, 140);
    if (await db.get(env, config.Collection, inventoryId)) fail('This department item already exists. Select its existing stock record when requesting supplies.', 409);
    const matching = await db.query(env, config.Collection, { filters: [{ field: config.StoreType ? 'ItemCode' : 'ItemName', op: '==', value: config.StoreType ? ItemCode : item.ItemName }], pageSize: 100, maxRows: 100 });
    if (matching.some(row => inventoryAllowed(row, Department, { ...user, schoolSectionAccess: SchoolSection }, scope))) {
      fail('A matching department item already exists, including legacy inventory. Find and select that existing record; do not duplicate its balance.', 409);
    }
    const Price = unitCost(body.Price ?? 0) / 100;
    stage(config.Collection, inventoryId, { ...scope, SchoolSection, ItemName: item.ItemName, Unit: item.Unit, ItemCode,
      ...(config.StoreType ? { StoreType: config.StoreType } : {}), Category: item.Category || 'General Item', Quantity: 0, Price,
      ReorderLevel: item.ReorderLevel || 0, Active: 'YES', LastUpdated: now, UpdatedAt: now, UpdatedBy: actor(user),
      ProcurementManaged: 'YES', ProcurementItemId: item.ItemId, OwnershipType: 'Organisation', Notes: text(body.Notes, 'Notes', false) }, null);
    result.InventoryId = inventoryId;
    result.message = 'Department item created at zero stock. Request supplies and confirm its delivery to receive stock.';
  } else if (action === 'request') {
    requireCapability(cap, 'canRequest');
    const Department = clean(body.Department), SchoolSection = sectionFor(user, scope, body.SchoolSection);
    if (!cap.departments.includes(Department) || (!cap.canManage && !cap.receiveDepartments.includes(Department))) fail('You cannot request supplies for this department.', 403);
    const submitted = linesFor(body.Lines), Lines = [], targets = new Set();
    for (const line of submitted) {
      const item = await central(line.ItemId), target = await inventory(Department, line.InventoryId, SchoolSection, item);
      if (targets.has(target.__id)) fail('Choose each department inventory record only once.');
      targets.add(target.__id);
      Lines.push({ ...line, InventoryId: target.__id, DepartmentItemName: target.ItemName, ItemName: item.ItemName, Unit: item.Unit, IssuedQuantity: 0, ReceivedQuantity: 0 });
      // A pending/rejected request must not permanently adopt a mistaken mapping.
      // Check its snapshot now; revalidate and lock the approved link at dispatch.
      stage(DEPARTMENTS[Department].Collection, target.__id, plain(target), target);
    }
    const RequisitionId = `REQ-${crypto.randomUUID()}`;
    const NeededBy = text(body.NeededBy, 'Needed-by date', false, 10);
    if (NeededBy && (!/^\d{4}-\d{2}-\d{2}$/.test(NeededBy) || !Number.isFinite(Date.parse(NeededBy)))) fail('Choose a valid needed-by date.');
    stage(C.requests, RequisitionId, { ...base, RequisitionId, Department, SchoolSection, Lines, Status: 'PENDING', NeededBy,
      Notes: text(body.Notes, 'Supply request reason'), RequestedBy: base.CreatedBy }, null);
    result.RequisitionId = RequisitionId;
  } else if (action === 'createpurchase') {
    requireCapability(cap, 'canManage');
    const submitted = linesFor(body.Lines, { costs: true }), Lines = [];
    for (const line of submitted) { const item = await central(line.ItemId); Lines.push({ ItemId: line.ItemId, Quantity: line.Quantity, UnitCost: line.UnitCost, ItemName: item.ItemName, Unit: item.Unit, ReceivedQuantity: 0 }); }
    const SupplierName = text(body.SupplierName, 'Supplier name', true, 160), Reference = text(body.Reference, 'Supplier / purchase reference', true, 160);
    const PurchaseId = `PUR-${(await hash(`${scope.ScopeKey}|${lower(SupplierName)}|${lower(Reference)}`)).slice(0, 40)}`;
    if (await db.get(env, C.purchases, PurchaseId)) fail('A purchase with this supplier and reference already exists. Open that record instead.', 409);
    stage(C.purchases, PurchaseId, { ...base, PurchaseId, SupplierName, Reference, Lines, TotalAmount: totalCost(Lines), Status: 'PENDING',
      FinanceReference: text(body.FinanceReference, 'Finance reference', false, 160), Notes: text(body.Notes, 'Purchase reason') }, null);
    result.PurchaseId = PurchaseId;
  } else if (action === 'reviewrequest' || action === 'reviewpurchase') {
    const purchase = action === 'reviewpurchase';
    requireCapability(cap, purchase ? 'canApprove' : 'canReviewRequests');
    const collection = purchase ? C.purchases : C.requests, recordId = purchase ? body.PurchaseId : body.RequisitionId;
    const row = await scoped(collection, recordId, !purchase); version(body, row);
    if (row.Status !== 'PENDING') fail('Only pending records can be reviewed.', 409);
    const Decision = clean(body.Decision);
    if (!['APPROVED', 'REJECTED'].includes(Decision)) fail('Choose Approve or Reject.');
    const OverrideReason = purchase && Decision === 'APPROVED' ? separatedActor(user, cap, row, body, 'A purchase creator cannot approve their own purchase.') : '';
    if (purchase && Decision === 'APPROVED' && !cap.canOverride) {
      const maximum = Number(user.approvalMaxAmount ?? user.ApprovalMaxAmount);
      if (!Number.isFinite(maximum) || maximum <= 0 || row.TotalAmount > maximum) fail('This purchase exceeds your approval limit. A positive approval limit must be configured for your account.', 403);
    }
    stage(collection, recordId, { ...next(row), Status: Decision, ReviewedAt: now, ReviewedBy: actor(user), ReviewNotes: text(body.Notes, 'Review notes'), OverrideReason }, row);
    result[purchase ? 'PurchaseId' : 'RequisitionId'] = recordId;
  } else if (action === 'receivepurchase') {
    requireCapability(cap, 'canManage');
    const row = await scoped(C.purchases, body.PurchaseId); version(body, row);
    if (!['APPROVED', 'PARTIALLY_RECEIVED'].includes(row.Status)) fail('Approve the purchase before receiving stock.', 409);
    const DeliveryReference = text(body.DeliveryReference, 'Supplier delivery reference', true, 160);
    const deliveryId = `DEL-${await hash(`${scope.ScopeKey}|${row.PurchaseId}|${lower(DeliveryReference)}`)}`;
    if (await db.get(env, C.operations, deliveryId)) fail('This supplier delivery reference has already been received for this purchase.', 409);
    const Lines = row.Lines.map(line => ({ ...line }));
    for (const line of checkLines(row, linesFor(body.Lines))) {
      const incoming = units(line.Quantity), outstanding = units(line.saved.Quantity) - tally(line.saved, 'ReceivedQuantity');
      if (incoming > outstanding) fail('Received quantity exceeds the outstanding approved purchase.', 409);
      const item = await central(line.ItemId);
      stockChange(C.items, item.ItemId, item, incoming, { Revision: item.Revision + 1 });
      Lines.find(saved => saved.ItemId === line.ItemId).ReceivedQuantity = quantity(tally(line.saved, 'ReceivedQuantity') + incoming);
    }
    const receipt = { CreatedAt: now, ReceivedBy: actor(user), DeliveryReference, Lines: linesFor(body.Lines), Notes: text(body.Notes, 'Receipt notes') };
    if ((row.Receipts || []).length >= 100) fail('This purchase has reached its receipt limit. Close outstanding quantities with support before adding more.', 409);
    stage(C.purchases, row.PurchaseId, { ...next(row), Lines, Status: Lines.every(line => tally(line, 'ReceivedQuantity') === units(line.Quantity)) ? 'RECEIVED' : 'PARTIALLY_RECEIVED', Receipts: [...(row.Receipts || []), receipt] }, row);
    stage(C.operations, deliveryId, { ...base, Action: 'supplier-delivery', PurchaseId: row.PurchaseId, DeliveryReference }, null);
    result.PurchaseId = row.PurchaseId;
  } else if (action === 'issue') {
    requireCapability(cap, 'canManage');
    const row = await scoped(C.requests, body.RequisitionId, true); version(body, row);
    if (!['APPROVED', 'PARTIALLY_ISSUED'].includes(row.Status)) fail('Approve this supply request before issuing stock.', 409);
    const Lines = row.Lines.map(line => ({ ...line })), transferLines = [];
    for (const line of checkLines(row, linesFor(body.Lines))) {
      const outgoing = units(line.Quantity), outstanding = units(line.saved.Quantity) - tally(line.saved, 'IssuedQuantity');
      if (outgoing > outstanding) fail('Issued quantity exceeds the unissued approved request.', 409);
      const item = await central(line.ItemId);
      const target = await inventory(row.Department, line.saved.InventoryId, row.SchoolSection, item);
      // Adopt this approved link without changing its balance during dispatch.
      stage(DEPARTMENTS[row.Department].Collection, target.__id, { ...plain(target), ...scope, SchoolSection: row.SchoolSection,
        Unit: target.Unit || DEPARTMENTS[row.Department].Unit, ProcurementManaged: 'YES', ProcurementItemId: item.ItemId }, target);
      stockChange(C.items, item.ItemId, item, -outgoing, { Revision: item.Revision + 1 });
      Lines.find(saved => saved.ItemId === line.ItemId).IssuedQuantity = quantity(tally(line.saved, 'IssuedQuantity') + outgoing);
      transferLines.push({ ItemId: line.ItemId, InventoryId: line.saved.InventoryId, DepartmentItemName: target.ItemName,
        ItemName: item.ItemName, Unit: item.Unit, Quantity: line.Quantity, ReceivedQuantity: 0, ReturnedQuantity: 0 });
    }
    const TransferId = `TRF-${crypto.randomUUID()}`;
    stage(C.transfers, TransferId, { ...base, TransferId, RequisitionId: row.RequisitionId, Department: row.Department, SchoolSection: row.SchoolSection,
      Lines: transferLines, Status: 'IN_TRANSIT', Notes: text(body.Notes, 'Dispatch notes'), Receipts: [] }, null);
    stage(C.requests, row.RequisitionId, { ...next(row), Lines, Status: Lines.every(line => tally(line, 'IssuedQuantity') === units(line.Quantity)) ? 'ISSUED' : 'PARTIALLY_ISSUED' }, row);
    result.TransferId = TransferId;
  } else if (action === 'confirmreceipt' || action === 'returntransfer') {
    const returning = action === 'returntransfer';
    const row = await scoped(C.transfers, body.TransferId, true); version(body, row);
    if (!['IN_TRANSIT', 'PARTIALLY_RECEIVED', 'DISCREPANCY'].includes(row.Status)) fail('This transfer has no outstanding stock.', 409);
    if (returning) requireCapability(cap, 'canManage');
    else if (!receiptAllowed(row)) fail('Only staff assigned to the receiving department may confirm this delivery.', 403);
    const OverrideReason = returning ? '' : separatedActor(user, cap, row, body, 'The issuing officer cannot confirm their own delivery.');
    const Notes = text(body.Notes, returning ? 'Physical return reason' : 'Receipt / discrepancy notes');
    const discrepancy = !returning && body.ReportDiscrepancy === true;
    const submitted = linesFor(body.Lines, { empty: discrepancy });
    const Lines = row.Lines.map(line => ({ ...line }));
    const requisition = await scoped(C.requests, row.RequisitionId, true), requestLines = requisition.Lines.map(line => ({ ...line }));
    for (const line of checkLines(row, submitted)) {
      const amount = units(line.Quantity), outstanding = units(line.saved.Quantity) - tally(line.saved, 'ReceivedQuantity') - tally(line.saved, 'ReturnedQuantity');
      if (amount > outstanding) fail('The quantity exceeds the outstanding delivery. Already received stock cannot be received or returned again.', 409);
      const item = await central(line.ItemId), dest = Lines.find(saved => saved.ItemId === line.ItemId), reqLine = requestLines.find(saved => saved.ItemId === line.ItemId);
      if (!reqLine) fail('The source request is inconsistent. No stock was changed.', 409);
      if (returning) {
        stockChange(C.items, item.ItemId, item, amount, { Revision: item.Revision + 1 });
        dest.ReturnedQuantity = quantity(tally(dest, 'ReturnedQuantity') + amount);
        reqLine.IssuedQuantity = quantity(tally(reqLine, 'IssuedQuantity') - amount);
        if (reqLine.IssuedQuantity < 0) fail('The returned quantity exceeds this request’s issued stock.', 409);
      } else {
        const target = await inventory(row.Department, line.saved.InventoryId, row.SchoolSection, item), config = DEPARTMENTS[row.Department];
        stockChange(config.Collection, target.__id, target, amount, { ...scope, SchoolSection: row.SchoolSection, Unit: target.Unit || config.Unit,
          ProcurementManaged: 'YES', ProcurementItemId: item.ItemId });
        dest.ReceivedQuantity = quantity(tally(dest, 'ReceivedQuantity') + amount);
        reqLine.ReceivedQuantity = quantity(tally(reqLine, 'ReceivedQuantity') + amount);
        if (config.Movements) stage(config.Movements, `PROC-${operationId}-${line.ItemId}`, { ...scope, SchoolSection: row.SchoolSection,
          Date: now, Timestamp: now, ItemName: target.ItemName, InventoryId: target.__id, Type: 'IN', MovementType: 'IN', MovementNo: `PROC-${operationId}-${line.ItemId}`,
          Quantity: line.Quantity, Unit: target.Unit || config.Unit, Reason: `Procurement receipt ${row.TransferId}: ${Notes}`,
          Notes: `Procurement receipt ${row.TransferId}: ${Notes}`, RecordedBy: base.CreatedBy, Source: 'Procurement', TransferId: row.TransferId }, null);
      }
    }
    const complete = Lines.every(line => tally(line, 'ReceivedQuantity') + tally(line, 'ReturnedQuantity') === units(line.Quantity));
    const anyReceived = Lines.some(line => tally(line, 'ReceivedQuantity') > 0), anyReturned = Lines.some(line => tally(line, 'ReturnedQuantity') > 0);
    const Status = complete ? (anyReturned ? (anyReceived ? 'COMPLETED_WITH_RETURNS' : 'RETURNED') : 'RECEIVED')
      : discrepancy ? 'DISCREPANCY' : anyReceived ? 'PARTIALLY_RECEIVED' : 'IN_TRANSIT';
    if ((row.Receipts || []).length >= 100) fail('This transfer has reached its receipt limit. Contact support before adding more.', 409);
    const receipt = { CreatedAt: now, ReceivedBy: actor(user), Kind: returning ? 'RETURN' : 'RECEIPT', Notes, Lines: submitted, ReportDiscrepancy: discrepancy, OverrideReason };
    stage(C.transfers, row.TransferId, { ...next(row), Lines, Status, Receipts: [...(row.Receipts || []), receipt] }, row);
    stage(C.requests, requisition.RequisitionId, { ...next(requisition), Lines: requestLines,
      Status: requestLines.every(line => tally(line, 'IssuedQuantity') === units(line.Quantity)) ? 'ISSUED' : requestLines.some(line => tally(line, 'IssuedQuantity') > 0) ? 'PARTIALLY_ISSUED' : 'APPROVED' }, requisition);
    result.TransferId = row.TransferId;
  }
  // Stock, workflow state, audit and the replay result are committed together.
  // A timeout after commit can be retried with the same RequestId without moving stock twice.
  stage(C.movements, operationId, { ...base, Action: action, RequestId: requestId, Lines: movements, EntityId: result.TransferId || result.PurchaseId || result.RequisitionId || result.InventoryId || result.ItemId || scope.ScopeKey,
    Notes: clean(body.Notes), OverrideReason: clean(body.OverrideReason) }, null);
  stage(C.operations, operationId, { ...base, Action: action, Fingerprint: fingerprint, Result: result }, null);
  await db.commit(env, writes);
  return result;
  }
  catch (error) {
    // Covers both concurrent retries and an upstream response lost after a successful commit.
    const saved = await replay().catch(() => null);
    if (saved) return saved;
    if ([409, 412].includes(Number(error.status)) && !clean(error.code).startsWith('PROCUREMENT_')) fail('Stock or a Procurement record changed. Nothing was partially posted. Refresh and review before retrying.', 409, 'PROCUREMENT_WRITE_CONFLICT');
    throw error;
  }
}
