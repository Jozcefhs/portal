import { normalizeOrganizationEdition, filterSectionsForFeatures } from './organization-config.js';
import { schoolSectionFor } from './school-scope.js';

export const clean = value => String(value ?? '').trim();
export const lower = value => clean(value).toLowerCase();
export const plain = row => Object.fromEntries(Object.entries(row || {}).filter(([key]) => !key.startsWith('__')));
export function fail(message, status = 400, code = 'PROCUREMENT_INVALID') { throw Object.assign(new Error(message), { status, code }); }
export const role = user => clean(user.assignedRole || user.UserAssignedRole || user.role || user.Role);
export const actor = user => lower(user.username);
export const vendorOwned = row => !!clean(row?.VendorId) || lower(row?.OwnershipType || row?.OwnerType) === 'vendor';
export const DEPARTMENTS = Object.freeze({
  clinic: { Name: 'Clinic', Collection: 'clinicInventory', Movements: 'clinicMovements', Unit: 'pcs' },
  kitchen: { Name: 'Kitchen', Collection: 'kitchenInventory', Movements: 'kitchenMovements', Unit: 'kg' },
  tuckShop: { Name: 'Tuck Shop', Collection: 'tuckShopInventory', Movements: 'tuckShopMovements', Unit: 'pcs' },
  bookstore: { Name: 'Books & Supplies', Collection: 'storeItems', StoreType: 'Bookstore', Unit: 'pcs' },
  uniformStore: { Name: 'Clothing & Supplies', Collection: 'storeItems', StoreType: 'Uniform Store', Unit: 'pcs' },
  organizationStore: { Name: 'Organisation Store', Collection: 'storeItems', StoreType: 'Organisation Store', Unit: 'pcs' },
  restaurant: { Name: 'Restaurant', Collection: 'restaurantInventory', Movements: 'restaurantMovements', Unit: 'pcs' }
});
const managers = new Set(['Super Admin', 'Director', 'Admin', 'Management', 'Procurement Officer', 'Church Administrator', 'Executive Director', 'Organisation Administrator', 'Operations Manager']);
const approvers = new Set(['Super Admin', 'Director', 'Accounts Officer', 'Treasurer', 'Church Administrator', 'Executive Director', 'Organisation Administrator']);
export function scopeFor(user) {
  if (!actor(user) || ['Vendor User', 'External Auditor', 'Auditor'].includes(role(user)) || !(user.allowedSections || []).includes('procurement')) fail('Procurement is not available for this account.', 403);
  const BranchId = lower(user.branchId || user.BranchId);
  if (!/^[a-z0-9._-]{1,80}$/.test(BranchId) || ['all', 'global'].includes(BranchId)) fail('Select a single working branch before opening Procurement.', 403);
  const OrganisationEdition = normalizeOrganizationEdition(user.edition || user.OrganisationEdition || 'school');
  return { BranchId, OrganisationEdition, ScopeKey: `${OrganisationEdition}--${BranchId}` };
}
export function capabilitiesFor(user, scope) {
  const canManage = managers.has(role(user));
  const approvalDisabled = user.approvalEnabled === false || ['no', 'false', '0'].includes(lower(user.ApprovalEnabled));
  const approvalGranted = user.approvalEnabled === true || ['yes', 'true', '1', 'on'].includes(lower(user.ApprovalEnabled));
  const canApprove = approvers.has(role(user)) && (role(user) === 'Super Admin' || (approvalGranted && !approvalDisabled));
  const supported = scope.OrganisationEdition === 'school' ? ['clinic', 'kitchen', 'tuckShop', 'bookstore', 'uniformStore', 'restaurant'] : ['organizationStore', 'restaurant'];
  const enabled = filterSectionsForFeatures(supported, user.featureFlags);
  const receiveDepartments = enabled.filter(key => (user.allowedSections || []).includes(key));
  const branchWide = scope.OrganisationEdition !== 'school' || lower(user.schoolSectionAccess || user.SchoolSectionAccess || 'all') === 'all';
  return { canManage, canApprove, canReviewRequests: canManage, canConfigure: canApprove && branchWide,
    canOverride: role(user) === 'Super Admin', canRequest: canManage || receiveDepartments.length > 0,
    canReceive: receiveDepartments.length > 0, departments: canManage || canApprove ? enabled : receiveDepartments, receiveDepartments };
}
export function schoolSectionsFor(user, scope) {
  if (scope.OrganisationEdition !== 'school') return ['All'];
  const restricted = lower(user.schoolSectionAccess || user.SchoolSectionAccess || 'all');
  return restricted === 'all' ? ['Primary', 'Secondary'] : [schoolSectionFor({ SchoolSection: restricted }) === 'primary' ? 'Primary' : 'Secondary'];
}
export function sectionFor(user, scope, value) {
  const sections = schoolSectionsFor(user, scope), requested = clean(value) || (sections.length === 1 ? sections[0] : '');
  const match = sections.find(section => lower(section) === lower(requested));
  if (!match) fail('Choose a school section assigned to your account.', 403);
  return match;
}
export function sameScope(row, scope) { return !!row && row.ScopeKey === scope.ScopeKey && lower(row.BranchId) === scope.BranchId && row.OrganisationEdition === scope.OrganisationEdition; }
export function visibleRecord(row, user, scope, cap) {
  return sameScope(row, scope) && (!row.Department || cap.departments.includes(row.Department)) && (!row.SchoolSection || schoolSectionsFor(user, scope).some(section => lower(section) === lower(row.SchoolSection)));
}
export function inventoryAllowed(row, department, user, scope) {
  const config = DEPARTMENTS[department];
  if (!row || !config || vendorOwned(row) || lower(row.BranchId || 'main') !== scope.BranchId) return false;
  const edition = clean(row.OrganisationEdition || row.OrganizationEdition);
  if (edition ? normalizeOrganizationEdition(edition) !== scope.OrganisationEdition : scope.OrganisationEdition !== 'school') return false;
  if (config.StoreType && row.StoreType !== config.StoreType) return false;
  return scope.OrganisationEdition !== 'school' || schoolSectionsFor(user, scope).some(section => lower(section) === schoolSectionFor(row));
}
export function id(value, label = 'record') {
  const result = clean(value);
  if (!result || result.length > 160 || /[\/\\?#\[\]\u0000-\u001f]/.test(result) || result === '.' || result === '..') fail(`Choose a valid ${label}.`);
  return result;
}
// Integer thousandths keep repeated fractional issues and receipts exact.
export function units(value, label = 'Quantity', zero = false) {
  const text = clean(value);
  if (!/^\d+(?:\.\d{1,3})?$/.test(text)) fail(`${label} must be a number with at most three decimal places.`);
  const result = Math.round(Number(text) * 1000);
  if (!Number.isSafeInteger(result) || result > 1000000000000 || (zero ? result < 0 : result <= 0)) fail(`${label} must be ${zero ? 'zero or ' : ''}positive and no greater than 1,000,000,000.`);
  return result;
}
export const quantity = value => value / 1000;
export function unitCost(value) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(clean(value))) fail('Unit cost must be a non-negative amount with at most two decimal places.');
  const result = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(result) || result > 100000000000) fail('Unit cost is too large.');
  return result;
}
export function linesFor(value, { costs = false, empty = false } = {}) {
  if (!Array.isArray(value) || value.length > 20 || (!empty && !value.length)) fail('Choose between 1 and 20 distinct items.');
  const seen = new Set();
  return value.map(line => {
    const ItemId = id(line.ItemId, 'central item');
    if (seen.has(ItemId)) fail('Choose each central item only once.');
    seen.add(ItemId);
    return { ItemId, Quantity: quantity(units(line.Quantity)), ...(line.InventoryId ? { InventoryId: id(line.InventoryId, 'department stock record') } : {}),
      ...(costs ? { UnitCost: unitCost(line.UnitCost) / 100 } : {}) };
  });
}
export function version(body, row) {
  if (!Number.isInteger(body.ExpectedRevision) || body.ExpectedRevision !== row.Revision) fail('This record has changed. Refresh and review it before saving.', 409, 'PROCUREMENT_CHANGED');
}
export function requireCapability(cap, name) { if (!cap[name]) fail('Your role cannot perform this Procurement action.', 403); }
export function separatedActor(user, cap, row, body, message) {
  if (lower(row.CreatedByUsername) !== actor(user)) return '';
  if (!cap.canOverride || clean(body.OverrideReason).length < 8) fail(`${message} A different authorised staff member must confirm it, or a Super Admin must give an explicit override reason.`, 403);
  return clean(body.OverrideReason).slice(0, 2000);
}
