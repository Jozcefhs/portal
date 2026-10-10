import { clean, lower, plain, fail, cents, amount, visible } from './vendor-settlement-rules.js';
import { productDigest } from './vendor-product-import.js';

export const PRODUCT_CHANGES = 'vendorProductChanges';
const inventories = { tuckShop:'tuckShopInventory', organizationStore:'storeItems', restaurant:'restaurantInventory' };
const movements = { tuckShop:'tuckShopMovements', organizationStore:'organizationCommerceMovements', restaurant:'restaurantMovements' };
const role = user => clean(user.assignedRole || user.UserAssignedRole || user.role || user.Role);
export const productPolicy = settings => Object.fromEntries(['RequireNewApproval','RequireEditApproval','RequireStockApproval']
  .map(key => [key, settings?.ProductPolicy?.[key] !== false]));
const sectionAllowed = (scope, section) => (scope.OrganisationEdition === 'school' ? ['tuckShop'] : ['organizationStore','restaurant']).includes(section);
const stockInScope = (row, scope) => row && lower(row.BranchId || 'main') === scope.BranchId
  && (!row.OrganisationEdition || row.OrganisationEdition === scope.OrganisationEdition)
  && (scope.OrganisationEdition !== 'school' || lower(scope.SchoolSection) === 'all' || lower(row.SchoolSection || 'Secondary') === lower(scope.SchoolSection));
const active = row => !['no','false','0','inactive','disabled'].includes(lower(row.Active ?? 'YES'));
const stockId = value => { const id = clean(value); if (!id || id.length > 240 || /[\\/]/.test(id)) fail('Choose a valid stock reference.'); return id; };
const detailKeys = ['ItemName','Price','Category','Unit','Active'];
const details = row => Object.fromEntries(detailKeys.map(key => [key, key === 'Price' ? Number(row.Price ?? row.SalePrice) : clean(row[key])]));
const count = value => { const n = Number(value); if (!Number.isSafeInteger(n) || n < 0) fail('Stock must be a non-negative whole number.'); return n; };

export async function vendorProductContext(env, user, scope, deps) {
  const vendors = (await deps.vendors(env, scope)).filter(row => lower(row.LoginUsername) === lower(user.username) && active(row));
  if (role(user) !== 'Vendor User' || !vendors.length) fail('No active vendor is linked to your account in this branch / section.',403);
  return { vendors, policy:productPolicy(await deps.settings(env, scope)) };
}
function chooseVendor(context, value) {
  const matches = value ? context.vendors.filter(row => lower(row.VendorId) === lower(value) || lower(row.Name) === lower(value)) : context.vendors;
  if (matches.length !== 1) fail('Choose one of your linked vendor accounts. Ownership cannot be transferred here.',403);
  return matches[0];
}
async function ownStock(env, scope, section, inventoryId, vendor, deps) {
  if (!sectionAllowed(scope, section)) fail('Choose a store available in this edition.');
  const row = await deps.get(env, inventories[section], stockId(inventoryId));
  if (!stockInScope(row, scope) || clean(row.VendorId) !== vendor.VendorId
    || (scope.OrganisationEdition === 'school' && lower(row.SchoolSection || 'Secondary') !== lower(vendor.SchoolSection)))
    fail('This product is not available to your vendor account.',403);
  return row;
}
function version(body, row) {
  if (!clean(row.__updateTime) || body.RecordVersion !== row.__updateTime) fail('This product changed. Refresh before saving.',409);
}
function needsApproval(kind, policy) {
  return policy[kind === 'Create' ? 'RequireNewApproval' : kind === 'Delivery' ? 'RequireStockApproval' : 'RequireEditApproval'];
}
function proposal(scope, user, item, kind, data, previous = null, reference = '', notes = '') {
  return { ...scope, SchoolSection:data.SchoolSection || previous?.SchoolSection || 'All',
    ChangeId:`VPROD-${crypto.randomUUID()}`, VendorId:data.VendorId || previous?.VendorId,
    InventoryId:item.inventoryId, Section:item.section, Kind:kind, Data:data,
    BaseDetails:previous ? details(previous) : null, Reference:reference, Notes:notes,
    RequestedBy:clean(user.username), RequestedAt:new Date().toISOString(), Status:'Pending' };
}
async function applyChange(env, user, scope, change, vendor, deps) {
  const section = change.Section, inventoryId = stockId(change.InventoryId);
  if (!sectionAllowed(scope,section)) fail('Choose a store available in this edition.');
  let previous = null, item;
  if (change.Kind === 'Create') {
    if (change.Data.VendorId !== vendor.VendorId || !stockInScope(change.Data,scope)
      || (scope.OrganisationEdition === 'school' && lower(change.Data.SchoolSection) !== lower(vendor.SchoolSection)))
      fail('This product request no longer matches the linked vendor / section.',409);
    if (await deps.get(env, inventories[section], inventoryId)) fail('This product already exists. Refresh before adding it again.',409);
    item = { ...change.Data };
  } else {
    previous = await ownStock(env, scope, section, inventoryId, vendor, deps);
    if (change.Kind === 'Edit' && JSON.stringify(details(previous)) !== JSON.stringify(change.BaseDetails))
      fail('Product details changed since submission. Reject this request and ask for a fresh change.',409);
    // Merge fresh stock, never a quantity captured before intervening sales.
    item = change.Kind === 'Edit' ? { ...plain(previous), ...change.Data } : { ...plain(previous), Quantity:count(Number(previous.Quantity) + change.Data.Quantity) };
  }
  const timestamp = new Date().toISOString();
  item.UpdatedAt = timestamp; item.UpdatedBy = clean(user.displayName || user.username);
  const writes = [deps.write(inventories[section], inventoryId, item, previous)];
  const delivered = change.Kind === 'Create' ? item.Quantity : change.Kind === 'Delivery' ? change.Data.Quantity : 0;
  if (delivered) writes.push(deps.write(movements[section], change.ChangeId, { ...scope, SchoolSection:item.SchoolSection,
    MovementNo:change.ChangeId, InventoryId:inventoryId, VendorId:item.VendorId, ItemCode:item.ItemCode, ItemName:item.ItemName,
    Date:timestamp, MovementType:'IN', Quantity:delivered, QuantityBefore:Number(previous?.Quantity || 0), QuantityAfter:item.Quantity,
    UnitPrice:item.Price ?? item.SalePrice, Reference:change.Reference, Reason:change.Notes || 'Vendor opening stock', RecordedBy:item.UpdatedBy }));
  return writes;
}

// Also used by the existing CSV importer: one approval and stock/audit contract.
export async function prepareVendorProductWrites(env, user, scope, items, context, deps) {
  const writes = []; let pending = 0;
  for (const item of items) {
    const vendor = chooseVendor(context, item.data.VendorId);
    const change = proposal(scope, user, item, 'Create', item.data);
    if (needsApproval('Create', context.policy)) { writes.push(deps.write(PRODUCT_CHANGES,change.ChangeId,change)); pending++; }
    else writes.push(...await applyChange(env,user,scope,change,vendor,deps));
  }
  return { writes, pending };
}

export async function handleVendorProductAction(env, user, scope, body, deps) {
  const action = body.action;
  if (action === 'saveProductPolicy') {
    deps.requireManagement(user);
    if (scope.OrganisationEdition === 'school' && lower(scope.SchoolSection) !== 'all') fail('Only a branch-wide manager can change product approval controls.',403);
    const original = await deps.get(env,'settings',`vendor-settlement-${scope.ScopeKey}`);
    if (original) version(body, original);
    const policy = {};
    for (const key of ['RequireNewApproval','RequireEditApproval','RequireStockApproval']) {
      if (typeof body[key] !== 'boolean') fail('Choose an approval setting for each type of product change.');
      policy[key] = body[key];
    }
    await deps.commit(env,[deps.write('settings',`vendor-settlement-${scope.ScopeKey}`,{...plain(original),...scope,ProductPolicy:policy},original),
      deps.audit(scope,user,'VENDOR PRODUCT APPROVAL POLICY CHANGED',scope.ScopeKey,JSON.stringify(policy))]);
    return {ok:true,message:'Product approval controls saved. Settlement rules and existing requests are unchanged.'};
  }
  if (action === 'reviewProductChange') {
    deps.requireManagement(user);
    const change = await deps.get(env,PRODUCT_CHANGES,stockId(body.ChangeId));
    if (!change || !visible(change,scope)) fail('This product request is unavailable.',404);
    const op = await deps.operation(env,scope,user,{...body,ProductFingerprint:await productDigest([body.ChangeId,body.Decision,clean(body.Notes)])},action);
    if (op.replay) return op.replay;
    version(body,change);
    if (change.Status !== 'Pending' || !['Approved','Rejected'].includes(body.Decision)) fail('Choose an outstanding product request and approve or reject it.',409);
    const writes = [];
    if (body.Decision === 'Approved') {
      const vendor = (await deps.vendors(env,scope)).find(row => row.VendorId === change.VendorId && active(row)
        && lower(row.LoginUsername) === lower(change.RequestedBy));
      if (!vendor) fail('The submitting vendor is no longer active or linked. Reject this request and obtain a fresh submission.',409);
      writes.push(...await applyChange(env,user,scope,change,vendor,deps));
    }
    const result = {ok:true,message:`Product request ${lower(body.Decision)}. No sales or financial postings were changed.`};
    await deps.commit(env,[...writes,deps.write(PRODUCT_CHANGES,change.ChangeId,{...plain(change),Status:body.Decision,
      ReviewedBy:clean(user.username),ReviewedAt:new Date().toISOString(),ReviewNotes:clean(body.Notes).slice(0,2000)},change),
      deps.audit(scope,user,'VENDOR PRODUCT REQUEST REVIEWED',change.ChangeId,`${body.Decision}; ${change.InventoryId}; ${clean(body.Notes).slice(0,2000)}`),deps.operationWrite(op,result)]);
    return result;
  }
  const context = await vendorProductContext(env,user,scope,deps);
  const vendor = chooseVendor(context,body.VendorId);
  const section = clean(body.Section || (scope.OrganisationEdition === 'school' ? 'tuckShop' : 'organizationStore'));
  if (!sectionAllowed(scope,section)) fail('Choose a store available in this edition.');
  const inventoryId = stockId(body.InventoryId);
  const submitted = Object.fromEntries(['ItemName','Price','Category','Unit','Active','Quantity','Reference','Notes'].map(key => [key,clean(body[key])]));
  const op = await deps.operation(env,scope,user,{VendorId:vendor.VendorId,RequestId:body.RequestId,
    ProductFingerprint:await productDigest({section,inventoryId,submitted,editing:!!body.RecordVersion})},action);
  if (op.replay) return op.replay;
  let previous = null, kind = 'Create', data;
  if (body.RecordVersion || action === 'recordProductDelivery') previous = await ownStock(env,scope,section,inventoryId,vendor,deps);
  else if (await deps.get(env,inventories[section],inventoryId)) fail('Use the current version to edit an existing product.',409);
  if (previous) version(body,previous);
  if (action === 'recordProductDelivery') {
    const quantity = count(body.Quantity);
    if (!quantity || !clean(body.Reference) || !clean(body.Notes)) fail('Enter the delivered quantity, delivery reference and notes.');
    kind = 'Delivery'; data = {Quantity:quantity};
  } else {
    const price = Number(body.Price), name = clean(body.ItemName);
    if (!name || name.length > 160 || !Number.isFinite(price) || cents(price) <= 0 || amount(cents(price)) !== price)
      fail('Enter an item name (up to 160 characters) and a positive price with at most two decimal places.');
    const category = clean(body.Category || 'General Item'), unit = clean(body.Unit || 'pcs');
    if (category.length > 120 || unit.length > 40 || !['YES','NO'].includes(body.Active || 'YES')) fail('Check category, unit and active status.');
    data = {ItemName:name,Price:price,SalePrice:price,Category:category,Unit:unit,Active:body.Active || 'YES'};
    if (previous) {
      kind = 'Edit';
      if (body.Quantity !== undefined && Number(body.Quantity) !== Number(previous.Quantity)) fail('Record a stock delivery instead of overwriting remaining stock.');
    } else data = {...data,BranchId:scope.BranchId,OrganisationEdition:scope.OrganisationEdition,
      SchoolSection:scope.OrganisationEdition === 'school' ? vendor.SchoolSection : 'All',VendorId:vendor.VendorId,OwnershipType:'Vendor',
      Quantity:count(body.Quantity ?? 0),ItemCode:inventoryId,StoreType:section === 'organizationStore' ? 'Organisation Store' : ''};
  }
  if (clean(body.Reference).length > 200 || clean(body.Notes).length > 2000) fail('Shorten the delivery reference or notes.');
  const change = proposal(scope,user,{section,inventoryId},kind,data,previous,clean(body.Reference),clean(body.Notes));
  const pending = needsApproval(kind,context.policy);
  const writes = pending ? [deps.write(PRODUCT_CHANGES,change.ChangeId,change)] : await applyChange(env,user,scope,change,vendor,deps);
  const result = {ok:true,pending,InventoryId:inventoryId,ChangeId:change.ChangeId,
    message:pending ? 'Submitted for school / organisation approval. Live stock and prices are unchanged.' : 'Product update saved. Past sales are unchanged.'};
  await deps.commit(env,[...writes,deps.audit(scope,user,pending ? 'VENDOR PRODUCT CHANGE SUBMITTED' : 'VENDOR PRODUCT CHANGE APPLIED',change.ChangeId,
    JSON.stringify({Kind:kind,VendorId:vendor.VendorId,InventoryId:inventoryId,Data:data,Reference:change.Reference,Notes:change.Notes})),deps.operationWrite(op,result)]);
  return result;
}
