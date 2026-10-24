import { getDocuments } from './firestore.js';
import { clean, lower, settlementScope, visible } from './vendor-settlement-rules.js';

// Existing vendors keep shared selling until management explicitly disables it.
export const organisationSalesEnabled = vendor => !['no', 'false', '0', 'disabled'].includes(lower(vendor?.OrganisationSalesEnabled ?? true));

// Decorate only the already branch-scoped inventory. One read per distinct owner,
// no full vendor catalogue and no bank/contact information in store responses.
export async function withVendorStorePolicy(env, user, inventory) {
  const ids = [...new Set(inventory.map(row => clean(row.VendorId)).filter(Boolean))];
  if (!ids.length) return inventory;
  const scope = settlementScope(user);
  const records = await getDocuments(env, 'commerceVendors', ids);
  const vendors = new Map(ids.map((id, index) => [id, records[index]]));
  return inventory.map(row => {
    if (!clean(row.VendorId)) return row;
    const vendor = vendors.get(clean(row.VendorId));
    const allowed = vendor && visible(vendor, scope) && (scope.OrganisationEdition !== 'school'
      || lower(vendor.SchoolSection) === lower(row.SchoolSection || 'Secondary'));
    return { ...row, VendorName: allowed ? clean(vendor.Name) : '',
      OrganisationSalesEnabled: Boolean(allowed && organisationSalesEnabled(vendor)) };
  });
}
