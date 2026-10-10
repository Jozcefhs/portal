import { normalizeProductRow, PRODUCT_IMPORT_LIMITS } from '../../js/vendor-product-import.js';
import { clean, lower, plain, fail, amount, cents } from './vendor-settlement-rules.js';

const collections = Object.freeze({ tuckShop: 'tuckShopInventory', organizationStore: 'storeItems', restaurant: 'restaurantInventory' });
const storeNames = new Map([['tuckshop', 'tuckShop'], ['tuck shop', 'tuckShop'], ['organizationstore', 'organizationStore'],
  ['organisation store', 'organizationStore'], ['organization store', 'organizationStore'], ['restaurant', 'restaurant']]);
export async function productDigest(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))].map(n => n.toString(16).padStart(2, '0')).join('');
}
function inScope(item, scope) {
  return lower(item.BranchId || 'main') === scope.BranchId && (!item.OrganisationEdition || item.OrganisationEdition === scope.OrganisationEdition)
    && (scope.OrganisationEdition !== 'school' || lower(scope.SchoolSection) === 'all' || lower(item.SchoolSection || 'Secondary') === lower(scope.SchoolSection));
}
function input(body) {
  if (!['assign', 'create'].includes(body.Mode)) fail('Choose an import mode.');
  if (!Array.isArray(body.Rows) || !body.Rows.length || body.Rows.length > PRODUCT_IMPORT_LIMITS.batch) fail('Send between 1 and 20 product rows per batch.', 413);
  if (new TextEncoder().encode(JSON.stringify(body.Rows)).length > 60 * 1024) fail('Product batch exceeds 60 KB. Shorten the CSV values.', 413);
  return body.Rows.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('Each product row must be an object.');
    return normalizeProductRow({ ...raw, RowNumber: raw.RowNumber || index + 2 }, body.Mode);
  });
}

async function plan(env, scope, body, deps, inputs, context) {
  const vendors = context?.vendors || await deps.vendors(env, scope);
  const allowed = scope.OrganisationEdition === 'school' ? ['tuckShop'] : ['organizationStore', 'restaurant'];
  const rows = [], writes = [], seen = new Set();
  // Exact code lookups are bounded; never scan an entire inventory for a CSV.
  const legacy = new Map();
  if (body.Mode === 'create') for (const section of allowed) {
    const codes = [...new Set(inputs.filter(value => !value.errors.length).map(value => value.row.ItemCode))];
    if (codes.length) legacy.set(section, (await deps.query(env, collections[section], { filters: [{ field: 'ItemCode', op: 'in', value: codes }], pageSize: 100, maxRows: 1000 })).filter(item => inScope(item, scope)));
  }
  for (const value of inputs) {
    const row = value.row, errors = [...value.errors];
    const section = row.Store ? storeNames.get(lower(row.Store)) : allowed[0];
    if (!allowed.includes(section)) errors.push('Store is not available in this edition.');
    let vendor = null;
    if (row.Owner && !['organisation', 'organization', 'school'].includes(lower(row.Owner))) {
      const byId = vendors.filter(item => lower(item.VendorId) === lower(row.Owner));
      const matches = byId.length ? byId : vendors.filter(item => lower(item.Name) === lower(row.Owner));
      if (matches.length !== 1) errors.push(matches.length ? 'Owner name is ambiguous; use the Vendor ID.' : 'Owner was not found in your branch / section. Register the vendor first.');
      else { vendor = matches[0]; if (vendor.Active === 'NO') errors.push('Owner is inactive.'); }
    }
    let previous = null, inventoryId = body.Mode === 'assign' ? row.InventoryId : '';
    let schoolSection = scope.OrganisationEdition === 'school' ? (row.SchoolSection || vendor?.SchoolSection || (lower(scope.SchoolSection) === 'all' ? 'Secondary' : scope.SchoolSection)) : 'All';
    if (body.Mode === 'assign' && allowed.includes(section) && row.InventoryId && row.InventoryId.length <= 240 && !/[\\/]/.test(row.InventoryId)) {
      previous = await deps.get(env, collections[section], inventoryId);
      if (!previous || !inScope(previous, scope)) {
        previous = null; // Never return another branch / edition / section's product details in an error preview.
        errors.push('Existing product was not found in your branch / section.');
      }
      else {
        if (!clean(previous.__updateTime)) errors.push('Product version is missing. Refresh the inventory before assigning ownership.');
        schoolSection = scope.OrganisationEdition === 'school' ? previous.SchoolSection || 'Secondary' : 'All';
        if (row.ItemCode && lower(row.ItemCode) !== lower(previous.ItemCode || inventoryId)) errors.push('ItemCode does not match this existing stock record.');
        if (row.ItemName && row.ItemName !== clean(previous.ItemName)) errors.push('ItemName changed. Download a fresh existing-products list.');
        if (row.SchoolSection && lower(row.SchoolSection) !== lower(schoolSection)) errors.push('Ownership assignment cannot move a product to another school section.');
      }
    }
    if (scope.OrganisationEdition === 'school') {
      if (!['primary', 'secondary'].includes(lower(schoolSection))) errors.push('SchoolSection must be Primary or Secondary.');
      else schoolSection = lower(schoolSection) === 'primary' ? 'Primary' : 'Secondary';
      if (lower(scope.SchoolSection) !== 'all' && lower(schoolSection) !== lower(scope.SchoolSection)) errors.push('Product is outside your school section.');
      if (vendor && lower(vendor.SchoolSection) !== lower(schoolSection)) errors.push('Product and owner must belong to the same school section.');
    }
    if (!errors.length && body.Mode === 'create') {
      inventoryId = `SKU-${await productDigest([scope.ScopeKey, schoolSection, section, vendor?.VendorId || '', row.ItemCode])}`;
      previous = await deps.get(env, collections[section], inventoryId);
      const matches = (legacy.get(section) || []).filter(item => lower(item.ItemCode) === lower(row.ItemCode)
        && clean(item.VendorId) === (vendor?.VendorId || '') && lower(item.SchoolSection || (scope.OrganisationEdition === 'school' ? 'Secondary' : 'All')) === lower(schoolSection));
      if (matches.length > 1) errors.push('More than one existing product has this code and owner. Review ownership individually.');
      else if (!previous && matches.length) { previous = matches[0]; inventoryId = previous.__id; }
      if (previous && !inScope(previous, scope)) { previous = null; errors.push('Existing stock reference conflicts with this product.'); }
      if (previous && (clean(previous.VendorId) !== (vendor?.VendorId || '') || lower(previous.ItemCode) !== lower(row.ItemCode))) errors.push('Existing stock reference conflicts with this product.');
      if (previous && clean(previous.ItemName) !== row.ItemName) errors.push('This item code already belongs to another product name.');
    }
    if (inventoryId && section) {
      const key = `${section}/${inventoryId}`;
      if (seen.has(key)) errors.push('Duplicate product in this batch.');
      seen.add(key);
    }
    const oldOwner = clean(previous?.VendorId), newOwner = vendor?.VendorId || '';
    const status = errors.length ? 'Error' : body.Mode === 'assign' ? (oldOwner === newOwner ? 'Unchanged' : 'Assign owner') : previous ? 'Skip existing' : 'Create';
    const output = { RowNumber: row.RowNumber, InventoryId: inventoryId, Section: section || row.Store, ItemCode: previous?.ItemCode || row.ItemCode,
      ItemName: previous?.ItemName || row.ItemName, VendorId: newOwner, Owner: vendor?.Name || (['organisation','organization','school'].includes(lower(row.Owner)) ? 'Organisation' : row.Owner),
      CurrentOwner: vendors.find(item => item.VendorId === oldOwner)?.Name || oldOwner || 'Organisation',
      Quantity: previous?.Quantity ?? row.Quantity, Price: previous?.Price ?? previous?.SalePrice ?? row.Price,
      SchoolSection: schoolSection, Status: status, Errors: errors,
      RecordVersion: previous?.__updateTime || '', VendorVersion: vendor?.__updateTime || '' };
    rows.push(output);
    if (status === 'Assign owner') writes.push({ section, inventoryId, previous, data: { ...plain(previous), VendorId: newOwner, OwnershipType: vendor ? 'Vendor' : 'School' } });
    if (status === 'Create') writes.push({ section, inventoryId, previous: null, data: { BranchId: scope.BranchId, OrganisationEdition: scope.OrganisationEdition,
      SchoolSection: schoolSection, ItemCode: row.ItemCode, ItemName: row.ItemName, Quantity: row.Quantity, Price: amount(cents(row.Price)), SalePrice: amount(cents(row.Price)),
      Category: row.Category, Unit: row.Unit, Active: row.Active, VendorId: newOwner, OwnershipType: vendor ? 'Vendor' : 'School',
      StoreType: section === 'organizationStore' ? 'Organisation Store' : '' } });
  }
  return { rows, writes, PreviewDigest: await productDigest({ scope, Mode: body.Mode, rows, ...(context ? {ProductPolicy:context.policy} : {}) }), valid: rows.every(row => !row.Errors.length) };
}

export async function handleProductImport(env, user, scope, body, deps) {
  deps.requireOperator(user);
  const context = deps.productContext ? await deps.productContext(env,user,scope) : null;
  if (context) {
    if (body.Mode !== 'create') fail('Vendor users can upload new products only. Ownership transfers require school / organisation staff.',403);
    if (!Array.isArray(body.Rows)) fail('Choose a completed product CSV.');
    body = {...body,Rows:body.Rows.map(raw => {
      const owner = clean(raw?.Owner);
      const matches = owner ? context.vendors.filter(v => lower(v.VendorId) === lower(owner) || lower(v.Name) === lower(owner)) : context.vendors;
      if (matches.length !== 1) fail('Each product must belong to one of your linked vendor accounts. Organisation ownership and other owners are not permitted.',403);
      return {...raw,Owner:matches[0].VendorId};
    })};
  }
  const inputs = input(body);
  if (body.action === 'previewProductImport') {
    const preview = await plan(env, scope, body, deps, inputs, context);
    return { ok: true, rows: preview.rows, valid: preview.valid, PreviewDigest: preview.PreviewDigest,
      approvalRequired:context?.policy.RequireNewApproval === true,
      message:context?.policy.RequireNewApproval ? 'Preview only. New products require school / organisation approval before appearing in stock.' : 'Preview only. Assignment preserves stock, price and previous sales. New-product upload never overwrites existing stock.' };
  }
  if (body.Confirmed !== true || !clean(body.PreviewDigest)) fail('Preview and confirm the product ownership changes before importing.');
  const op = await deps.operation(env, scope, user, { ...body, ImportFingerprint: await productDigest({ Mode: body.Mode, rows: inputs }) }, 'importProducts');
  if (op.replay) return op.replay;
  const preview = await plan(env, scope, body, deps, inputs, context);
  if (!preview.valid) fail('Some product rows are invalid. Load a fresh preview before importing.');
  if (preview.PreviewDigest !== body.PreviewDigest) fail('Stock or owner details changed. Load a fresh preview; this batch has not been saved.', 409);
  const timestamp = new Date().toISOString();
  const prepared = context ? await deps.prepareProductWrites(env,user,scope,preview.writes,context) : null;
  const writes = prepared?.writes || preview.writes.map(item => deps.write(collections[item.section], item.inventoryId,
    { ...item.data, UpdatedAt: timestamp, UpdatedBy: clean(user.displayName || user.username) }, item.previous));
  const result = { ok: true, pending:prepared?.pending || 0, created: preview.rows.filter(row => row.Status === 'Create').length - (prepared?.pending || 0),
    assigned: preview.rows.filter(row => row.Status === 'Assign owner').length, skipped: preview.rows.filter(row => ['Unchanged', 'Skip existing'].includes(row.Status)).length,
    message: prepared?.pending ? 'Products submitted for school / organisation approval. Live stock and past sales are unchanged.' : 'Batch saved. Stock and previous sale ownership are preserved.' };
  await deps.commit(env, [...writes, deps.audit(scope, user, 'VENDOR PRODUCTS IMPORTED', body.RequestId,
    JSON.stringify({ Mode: body.Mode, Created: result.created, Pending: result.pending, Assigned: result.assigned, Skipped: result.skipped,
      Products: preview.rows.filter(row => ['Assign owner', 'Create'].includes(row.Status)).map(row => ({ InventoryId: row.InventoryId, Store: row.Section, PreviousOwner: row.CurrentOwner, Owner: row.Owner, VendorId: row.VendorId })) }), `${scope.ScopeKey}--${body.RequestId}`), deps.operationWrite(op, result)]);
  return result;
}
