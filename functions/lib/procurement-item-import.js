import { PROCUREMENT_IMPORT_LIMITS, normalizeProcurementImportRow, procurementImportKey as key } from '../../js/procurement-item-import.js';
import { DEPARTMENTS, clean, lower, plain, fail, actor, vendorOwned, sameScope, inventoryAllowed, sectionFor, requireCapability } from './procurement-rules.js';

export async function procurementItemId(scope, row) {
  return `ITEM-${(await digest(`${scope.ScopeKey}|${lower(row.ItemCode || row.ItemName)}|${lower(row.Unit)}`)).slice(0, 32)}`;
}
export function procurementDestinationId(scope, config, schoolSection, row) {
  return (config.StoreType ? `${config.StoreType}-${row.ItemCode}-${scope.BranchId}-${schoolSection}` : `${scope.BranchId}-${schoolSection}-${row.ItemName}`)
    .replace(/[\/\\?#\[\]]/g, '-').replace(/\s+/g, '_').slice(0, 140);
}
async function digest(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
const identity = row => `${key(row.ItemCode || row.ItemName)}|${key(row.Unit)}`;
const centralValues = row => ({ ItemName: key(row.ItemName), ItemCode: key(row.ItemCode), Unit: key(row.Unit),
  Category: key(row.Category || 'General Item'), ReorderLevel: Number(row.ReorderLevel || 0) });
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const signature = row => JSON.stringify(Object.fromEntries(Object.entries(row).filter(([name]) => name !== 'RowNumber')));
const inInventoryScope = (row, Department, user, scope) => inventoryAllowed({ ...row, VendorId: '', OwnershipType: 'Organisation', OwnerType: 'Organisation' }, Department, user, scope);

// Normalized uniqueness claims share the existing protected/audited operations
// collection. Literal stock IDs stay backward compatible while case, whitespace
// and Unicode variants compete on the same exists:false precondition.
export async function procurementIdentityClaim(scope, kind, row, Department = '', SchoolSection = '') {
  const Identity = kind === 'central' ? identity(row) : key(DEPARTMENTS[Department].StoreType ? row.ItemCode : row.ItemName);
  const documentId = `ITEM-IDENTITY-${await digest(JSON.stringify([scope.ScopeKey, kind, Department, SchoolSection, Identity]))}`;
  return { documentId, data: { ...scope, Action: 'item-identity', Kind: kind, Department, SchoolSection, Identity,
    ItemId: row.ItemId, ...(row.InventoryId ? { InventoryId: row.InventoryId } : {}) } };
}

export async function readProcurementJsonBody(request) {
  const maxBytes = PROCUREMENT_IMPORT_LIMITS.requestBytes;
  if (Number(request.headers.get('Content-Length') || 0) > maxBytes) fail('The Procurement request exceeds 256 KB.', 413, 'REQUEST_TOO_LARGE');
  if (!request.body) return {};
  const reader = request.body.getReader(), chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) { await reader.cancel(); fail('The Procurement request exceeds 256 KB.', 413, 'REQUEST_TOO_LARGE'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail('The Procurement request is not valid JSON.', 400, 'INVALID_JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('The Procurement request must be a JSON object.', 400, 'INVALID_JSON');
  return value;
}

// A bounded all-or-nothing plan. Reads performed here are repeated on import;
// the caller commits this plan and its replay/audit records atomically.
export async function planProcurementItemImport(env, user, body, scope, cap, db) {
  requireCapability(cap, 'canManage');
  const mode = body.ImportMode;
  if (!['central', 'department'].includes(mode)) fail('Choose Central stock or Department balances.');
  if (!Array.isArray(body.Rows) || !body.Rows.length || body.Rows.length > PROCUREMENT_IMPORT_LIMITS.rows) fail('Choose between 1 and 50 item rows.');
  if (new TextEncoder().encode(JSON.stringify(body.Rows)).length > PROCUREMENT_IMPORT_LIMITS.requestBytes - 4096) fail('The item batch is too large. Use a smaller CSV.', 413);
  const Department = mode === 'department' ? clean(body.Department) : '', config = DEPARTMENTS[Department];
  if (mode === 'department' && !cap.departments.includes(Department)) fail('Choose an enabled receiving department.', 403);
  const SchoolSection = mode === 'department' ? sectionFor(user, scope, body.SchoolSection) : '';
  const viewUser = { ...user, schoolSectionAccess: SchoolSection };
  const catalog = (await db.query(env, 'procurementItems', { filters: [{ field: 'ScopeKey', op: '==', value: scope.ScopeKey }], pageSize: 250, maxRows: 5000 })).filter(row => sameScope(row, scope));
  const branchInventory = mode === 'department' ? (await db.query(env, config.Collection, { filters: [{ field: 'BranchId', op: '==', value: scope.BranchId }], pageSize: 250, maxRows: 5000 }))
    .filter(row => inInventoryScope(row, Department, viewUser, scope)) : [];
  const normalizedRows = body.Rows.map(raw => normalizeProcurementImportRow(raw, mode));
  // Keep network concurrency bounded, but do not serialize hundreds of remote
  // lookups for a 50-row CSV. Caches are request-local and never cross tenants.
  const gets = new Map(), queries = new Map();
  const get = (collection, recordId) => {
    const path = `${collection}/${recordId}`;
    if (!gets.has(path)) gets.set(path, db.get(env, collection, recordId));
    return gets.get(path);
  };
  const matchingLegacy = (field, value) => {
    const queryKey = JSON.stringify([field, value]);
    if (!queries.has(queryKey)) queries.set(queryKey, db.query(env, config.Collection, { filters: [{ field, op: '==', value }], pageSize: 100, maxRows: 100 }));
    return queries.get(queryKey);
  };
  let nextPrefetch = 0;
  const prefetch = async () => {
    while (nextPrefetch < normalizedRows.length) {
      const { row, errors } = normalizedRows[nextPrefetch++];
      if (errors.length || (config?.StoreType && !row.ItemCode)) continue;
      const proposedId = await procurementItemId(scope, row), direct = await get('procurementItems', proposedId);
      const existing = direct || catalog.find(item => identity(item) === identity(row));
      const ItemId = existing?.ItemId || existing?.__id || proposedId;
      const centralClaim = await procurementIdentityClaim(scope, 'central', { ...row, ItemId });
      const pending = [get('procurementOperations', centralClaim.documentId)];
      if (mode === 'department') {
        const target = { ...row, ItemName: existing?.ItemName || row.ItemName, ItemCode: row.ItemCode || existing?.ItemCode || '' };
        const InventoryId = procurementDestinationId(scope, config, SchoolSection, target), field = config.StoreType ? 'ItemCode' : 'ItemName';
        const claim = await procurementIdentityClaim(scope, 'department', { ...row, ItemId, InventoryId }, Department, SchoolSection);
        pending.push(get(config.Collection, InventoryId), matchingLegacy(field, target[field]), get('procurementOperations', claim.documentId));
      }
      await Promise.all(pending);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, normalizedRows.length) }, prefetch));
  const rows = [], planned = new Map(), seen = new Map(), targets = new Map(), snapshots = [], centralStaged = new Set(), openingMovements = [];
  const add = (collectionPath, documentId, data, previous = null) => {
    const path = `${collectionPath}/${documentId}`;
    if (planned.has(path)) return;
    if (previous && !clean(previous.__updateTime)) fail('Refresh the existing central item before importing.', 409);
    planned.set(path, { collectionPath, documentId, data, previous });
  };
  for (let index = 0; index < body.Rows.length; index++) {
    const normalized = normalizedRows[index], row = normalized.row;
    row.RowNumber ||= index + 2;
    const report = { RowNumber: row.RowNumber, ItemName: row.ItemName, ItemCode: row.ItemCode, Unit: row.Unit,
      status: 'ready', errors: [...normalized.errors], centralAction: 'none',
      QuantityAvailable: row.QuantityAvailable, OpeningQuantity: 0 };
    rows.push(report);
    if (report.errors.length) { report.status = 'error'; continue; }
    try {
      if (config?.StoreType && !row.ItemCode) fail('ItemCode is required for this department.');
      const duplicateKey = mode === 'central' ? identity(row) : key(config.StoreType ? row.ItemCode : row.ItemName);
      if (seen.has(duplicateKey)) {
        const prior = seen.get(duplicateKey);
        if (!equal(prior.values, signature(row))) fail(`Conflicting duplicate of CSV row ${prior.number}.`);
        report.status = 'skip'; report.message = `Duplicate of CSV row ${prior.number}; not imported again.`; continue;
      }
      seen.set(duplicateKey, { values: signature(row), number: row.RowNumber });
      const proposedId = await procurementItemId(scope, row);
      const direct = await get('procurementItems', proposedId);
      const candidates = new Map(catalog.filter(item => identity(item) === identity(row)).map(item => [item.ItemId || item.__id, item]));
      if (direct) candidates.set(direct.ItemId || direct.__id || proposedId, direct);
      if (candidates.size > 1) fail('More than one central item matches. Review existing catalogue duplicates before importing.');
      const existing = [...candidates.values()][0];
      if (existing && (!sameScope(existing, scope) || vendorOwned(existing))) fail('This item conflicts with existing or vendor-owned central stock; no ownership is changed.');
      if (existing && !equal(centralValues(existing), centralValues(row))) fail('An existing central item has different details. Edit or review that item separately; imports never overwrite it.');
      const ItemId = existing?.ItemId || existing?.__id || proposedId;
      report.ItemId = ItemId;
      const pendingCentral = planned.get(`procurementItems/${ItemId}`);
      if (pendingCentral && !equal(centralValues(pendingCentral.data), centralValues(row))) fail('Two uploaded rows use the same central item code and unit with conflicting details.');
      if (mode === 'central' && existing) {
        report.status = 'skip'; report.message = 'Matching central item already exists; its stock and details are unchanged. QuantityAvailable is not added or applied again.';
        snapshots.push({ ItemId, version: existing.__updateTime }); continue;
      }
      let InventoryId = '';
      if (mode === 'department') {
        const targetRow = { ...row, ItemName: existing?.ItemName || row.ItemName, ItemCode: row.ItemCode || existing?.ItemCode || '' };
        InventoryId = procurementDestinationId(scope, config, SchoolSection, targetRow);
        report.InventoryId = InventoryId;
        if (targets.has(InventoryId)) fail(`This item produces the same inventory ID as row ${targets.get(InventoryId)}. Use distinct item names or codes.`);
        targets.set(InventoryId, row.RowNumber);
        const directInventory = await get(config.Collection, InventoryId);
        const identityField = config.StoreType ? 'ItemCode' : 'ItemName';
        // Legacy main-branch records may have no BranchId. Match those explicitly
        // without scanning other branches or adopting an existing stock balance.
        const legacy = await matchingLegacy(identityField, targetRow[identityField]);
        const matches = new Map([...branchInventory, ...legacy].filter(item => inInventoryScope(item, Department, viewUser, scope)
          && key(item[identityField]) === key(targetRow[identityField])).map(item => [item.__id, item]));
        if (directInventory) matches.set(directInventory.__id || InventoryId, directInventory);
        if (matches.size > 1) fail('More than one department record matches. Review the existing inventory instead of duplicating it.');
        const target = [...matches.values()][0];
        if (target) {
          if (!inInventoryScope(target, Department, viewUser, scope) || vendorOwned(target)) fail('This item conflicts with another scope or vendor-owned stock. No ownership is changed.');
          const details = item => ({ ...centralValues({ ...item, Unit: item.Unit || config.Unit }),
            ...(row.Price !== null ? { Price: Number(item.Price || 0) } : {}), Notes: clean(item.Notes) });
          if (!equal(details(target), details(row)) || (clean(target.ProcurementItemId) && target.ProcurementItemId !== ItemId))
            fail('An existing department item has different details. Find or review that record; imports never overwrite or relink it.');
          report.status = 'skip'; report.InventoryId = target.__id; report.message = 'Matching department item already exists; its stock, price and ownership are unchanged. QuantityAvailable is not added or applied again.';
          snapshots.push({ InventoryId: target.__id, version: target.__updateTime }); continue;
        }
      }
      report.centralAction = existing || centralStaged.has(ItemId) ? 'reuse' : 'create';
      const claims = [];
      if (!existing && !centralStaged.has(ItemId)) claims.push(await procurementIdentityClaim(scope, 'central', { ...row, ItemId }));
      if (mode === 'department') claims.push(await procurementIdentityClaim(scope, 'department', { ...row, ItemId, InventoryId }, Department, SchoolSection));
      for (const claim of claims) {
        if (await get('procurementOperations', claim.documentId)) fail('This item identity has already been registered. Refresh and review the existing catalogue or department record.', 409);
      }
      if (existing) {
        // Compare-and-swap an identical snapshot only when a new destination
        // references it. Prevent concurrent renaming/vendor reassignment.
        add('procurementItems', ItemId, plain(existing), existing);
        snapshots.push({ ItemId, version: existing.__updateTime });
      } else if (!centralStaged.has(ItemId)) {
        add('procurementItems', ItemId, { ItemId, ItemName: row.ItemName, ItemCode: row.ItemCode, Unit: row.Unit,
          Category: row.Category, ReorderLevel: row.ReorderLevel, Quantity: mode === 'central' ? row.QuantityAvailable : 0, OwnershipType: 'Organisation' });
        centralStaged.add(ItemId);
      }
      if (mode === 'department') add(config.Collection, InventoryId, { ...scope, SchoolSection, ItemName: existing?.ItemName || row.ItemName,
        Unit: existing?.Unit || row.Unit, ItemCode: row.ItemCode, ...(config.StoreType ? { StoreType: config.StoreType } : {}),
        Category: row.Category || 'General Item', ReorderLevel: row.ReorderLevel, Quantity: row.QuantityAvailable, Price: row.Price ?? 0, Notes: row.Notes,
        Active: 'YES', ProcurementManaged: 'YES', ProcurementItemId: ItemId, OwnershipType: 'Organisation' });
      for (const claim of claims) add('procurementOperations', claim.documentId, claim.data);
      report.OpeningQuantity = row.QuantityAvailable;
      if (row.QuantityAvailable > 0) openingMovements.push({
        Collection: mode === 'central' ? 'procurementItems' : config.Collection,
        InventoryId: mode === 'central' ? ItemId : InventoryId, ItemId,
        ItemName: existing?.ItemName || row.ItemName, Unit: existing?.Unit || row.Unit,
        ...(mode === 'department' ? { Department, SchoolSection } : {}),
        Quantity: row.QuantityAvailable, Direction: 'IN', Before: 0, After: row.QuantityAvailable,
        Source: 'OpeningBalance', RowNumber: row.RowNumber });
    } catch (error) {
      if (Number(error.status || 500) >= 500) throw error;
      report.status = 'error'; report.errors.push(error.message);
    }
  }
  const summary = { total: rows.length, ready: rows.filter(row => row.status === 'ready').length,
    skipped: rows.filter(row => row.status === 'skip').length, errors: rows.filter(row => row.status === 'error').length,
    newCentral: [...planned.values()].filter(row => row.collectionPath === 'procurementItems' && !row.previous).length,
    newDepartment: [...planned.values()].filter(row => row.collectionPath !== 'procurementItems' && row.collectionPath !== 'procurementOperations').length };
  const writes = [...planned.values()];
  const PreviewFingerprint = await digest(JSON.stringify({ scope, mode, Department, SchoolSection, rows, snapshots,
    writes: writes.map(({ collectionPath, documentId, data, previous }) => ({ collectionPath, documentId, data, updateTime: previous?.__updateTime || '' })) }));
  return { preview: { ok: true, canImport: summary.ready > 0 && summary.errors === 0, rows, summary, PreviewFingerprint }, writes, openingMovements, mode, Department, SchoolSection };
}

export function procurementImportWrites(plan, base, user, operationId) {
  return plan.writes.map(write => ({ ...write, data: write.previous ? write.data : ['procurementItems', 'procurementOperations'].includes(write.collectionPath)
    ? { ...base, ...write.data, ImportOperationId: operationId } : { ...write.data, ImportOperationId: operationId,
      LastUpdated: base.CreatedAt, UpdatedAt: base.CreatedAt, UpdatedBy: actor(user) } }));
}
