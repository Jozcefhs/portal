import { procurementImportKey as key } from '../../js/procurement-item-import.js';
import { procurementDestinationId, procurementIdentityClaim } from './procurement-item-import.js';
import { DEPARTMENTS, clean, plain, fail, inventoryAllowed, vendorOwned, sectionFor } from './procurement-rules.js';

// Plan only: the caller commits these records with the central item's revision,
// audit entry and replay result. Nothing here moves or resets existing stock.
export async function planDepartmentAssignments(env, user, scope, cap, body, item, previous, db, now) {
  if (!Array.isArray(body.AssignedDepartments) || body.AssignedDepartments.length > Object.keys(DEPARTMENTS).length
    || body.AssignedDepartments.some(value => typeof value !== 'string' || !cap.departments.includes(value)))
    fail('Choose only enabled departments available to your account.', 403);
  const Departments = [...new Set(body.AssignedDepartments)].sort();
  const SchoolSection = sectionFor(user, scope, body.SchoolSection);
  const viewUser = { ...user, schoolSectionAccess: SchoolSection }, writes = new Map(), records = [];
  const queries = new Map();
  const query = (collection, field, value) => {
    const cacheKey = JSON.stringify([collection, field, value]);
    if (!queries.has(cacheKey)) queries.set(cacheKey, db.query(env, collection, {
      filters: [{ field, op: '==', value }], pageSize: 250, maxRows: field === 'BranchId' ? 5000 : 1000
    }));
    return queries.get(cacheKey);
  };
  const add = (collectionPath, documentId, data, previous = null) => writes.set(`${collectionPath}/${documentId}`, { collectionPath, documentId, data, previous });
  const inScope = (row, department) => row && inventoryAllowed({ ...row, VendorId: '', OwnershipType: 'Organisation', OwnerType: 'Organisation' }, department, viewUser, scope);
  const names = new Set([item.ItemName, previous?.ItemName].filter(Boolean).map(key));
  const codes = new Set([item.ItemCode, previous?.ItemCode].filter(Boolean).map(key));
  for (const Department of Departments) {
    const config = DEPARTMENTS[Department], label = config.Name;
    if (config.StoreType && !clean(item.ItemCode)) fail(`Enter an item code before assigning to ${label}.`);
    const proposedId = procurementDestinationId(scope, config, SchoolSection, item);
    const lookups = [query(config.Collection, 'BranchId', scope.BranchId), query(config.Collection, 'ProcurementItemId', item.ItemId)];
    // Exact legacy lookups include older main-branch records with no BranchId.
    for (const value of new Set([item.ItemName, previous?.ItemName].filter(Boolean))) lookups.push(query(config.Collection, 'ItemName', value));
    for (const value of new Set([item.ItemCode, previous?.ItemCode].filter(Boolean))) lookups.push(query(config.Collection, 'ItemCode', value));
    const [direct, groups] = await Promise.all([db.get(env, config.Collection, proposedId), Promise.all(lookups)]);
    const matches = new Map(groups.flat().filter(row => inScope(row, Department)
      && (row.ProcurementItemId === item.ItemId || names.has(key(row.ItemName)) || (key(row.ItemCode) && codes.has(key(row.ItemCode)))))
      .map(row => [row.__id, row]));
    if (direct) matches.set(direct.__id || proposedId, direct);
    if (matches.size > 1) fail(`${label}: more than one existing item matches. Review those records before assigning; no items were saved.`, 409);
    const target = [...matches.values()][0];
    if (target && (!inScope(target, Department) || vendorOwned(target)))
      fail(`${label}: the item conflicts with another scope or vendor-owned stock. No stock or ownership was changed.`, 409);
    if (target && (key(target.Unit || config.Unit) !== key(item.Unit)
      || (clean(target.ProcurementItemId) && target.ProcurementItemId !== item.ItemId)))
      fail(`${label}: the existing item has a different stock unit or central link. Review it first; no duplicate was created.`, 409);
    const InventoryId = target?.__id || proposedId;
    // Reserve both identities if an existing linked record has an older name/code.
    // The same claims are used by single-item creation and CSV imports.
    for (const identity of [item, ...(target && key(config.StoreType ? target.ItemCode : target.ItemName) ? [target] : [])]) {
      const claim = await procurementIdentityClaim(scope, 'department', { ...identity, ItemId: item.ItemId, InventoryId }, Department, SchoolSection);
      if (writes.has(`procurementOperations/${claim.documentId}`)) continue;
      const existingClaim = await db.get(env, 'procurementOperations', claim.documentId);
      if (existingClaim) {
        if (existingClaim.ItemId !== item.ItemId || existingClaim.InventoryId !== InventoryId)
          fail(`${label}: this item identity is already registered to another record. Refresh and review it first.`, 409);
      } else add('procurementOperations', claim.documentId, { ...claim.data, CreatedAt: now, CreatedByUsername: clean(user.username).toLowerCase() });
    }
    if (target) {
      // Preserve quantities, prices, names, notes and ownership exactly. The
      // version precondition also protects against a concurrent sale/receipt.
      add(config.Collection, InventoryId, { ...plain(target), ...scope, SchoolSection, ProcurementManaged: 'YES', ProcurementItemId: item.ItemId }, target);
    } else {
      add(config.Collection, InventoryId, { ...scope, SchoolSection, ItemName: item.ItemName, ItemCode: item.ItemCode, Unit: item.Unit,
        ...(config.StoreType ? { StoreType: config.StoreType } : {}), Category: item.Category || 'General Item',
        Quantity: 0, Price: 0, ReorderLevel: item.ReorderLevel || 0, Active: 'YES', Notes: '',
        LastUpdated: now, UpdatedAt: now, UpdatedBy: clean(user.username).toLowerCase(),
        ProcurementManaged: 'YES', ProcurementItemId: item.ItemId, OwnershipType: 'Organisation' });
    }
    records.push({ Department, InventoryId, Action: target ? 'reused' : 'created', StockUnchanged: true });
  }
  const before = previous?.AssignedDepartmentsBySection?.[SchoolSection] || [];
  const configured = [...new Set([...before.filter(value => DEPARTMENTS[value] && !cap.departments.includes(value)), ...Departments])].sort();
  // Do not remove records when unticked: historical links and remaining stock
  // must remain usable. This selection provisions destinations, not permissions.
  const assignments = { ...(previous?.AssignedDepartmentsBySection || {}), [SchoolSection]: configured };
  return { writes: [...writes.values()], assignments, summary: { SchoolSection, Before: before, Departments: configured, Records: records,
    Created: records.filter(row => row.Action === 'created').length, Reused: records.filter(row => row.Action === 'reused').length } };
}
