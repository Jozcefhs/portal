import { queryCollectionPages } from './firestore.js';
import { clean, lower, fail, settlementScope, visible } from './vendor-settlement-rules.js';

export const isVendorSeller = user => clean(user.assignedRole || user.UserAssignedRole || user.role || user.Role) === 'Vendor User';
export const vendorStoreSections = edition => edition === 'school' ? ['tuckShop'] : ['organizationStore', 'restaurant'];
export const vendorPosEnabled = row => !['no', 'false', '0', 'disabled'].includes(lower(row.PosEnabled ?? true));

export async function linkedSalesVendors(env, user, section) {
  const scope = settlementScope(user);
  if (!isVendorSeller(user) || !clean(user.username) || !(user.allowedSections || []).includes('vendorSettlements')
    || !vendorStoreSections(scope.OrganisationEdition).includes(section) || !(user.allowedSections || []).includes(section)) {
    fail('This vendor point of sale is not assigned to your account.', 403);
  }
  const rows = await queryCollectionPages(env, 'commerceVendors', {
    filters: [{ field: 'ScopeKey', op: '==', value: scope.ScopeKey }], pageSize: 250, maxRows: 10000
  });
  return rows.filter(row => visible(row, scope) && lower(row.LoginUsername) === lower(user.username)
    && row.Active !== 'NO' && vendorPosEnabled(row));
}

export async function restrictVendorInventory(env, user, section, rows) {
  if (!isVendorSeller(user)) return rows;
  const vendors = await linkedSalesVendors(env, user, section);
  return rows.filter(row => vendors.some(v => v.VendorId === row.VendorId
    && (settlementScope(user).OrganisationEdition !== 'school'
      || lower(v.SchoolSection) === lower(row.SchoolSection || 'Secondary'))));
}

export async function assertVendorSaleReplay(env, user, section, sale, digest) {
  if (!isVendorSeller(user)) return;
  const scope = settlementScope(user), vendors = await linkedSalesVendors(env, user, section);
  if (sale.OrganisationEdition !== scope.OrganisationEdition || lower(sale.BranchId) !== scope.BranchId
    || lower(sale.RecordedByUsername) !== lower(user.username) || sale.SaleType !== section
    || !(sale.Items || []).length || sale.Items.some(item => !vendors.some(v => v.VendorId === item.VendorId
      && (scope.OrganisationEdition !== 'school' || lower(v.SchoolSection) === lower(item.SchoolSection || 'Secondary'))))) {
    fail('This sale reference is not available to your vendor account.', 403);
  }
  if (!digest || sale.VendorCheckoutDigest !== digest) fail('This checkout reference was already used for a different cart or payment. Refresh and review the receipt.',409);
}
