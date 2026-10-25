import { listBranchCollection } from './branch-reads.js';
import { queryCollectionPages } from './firestore.js';

// A null owner list means the authorised management view. An empty list means
// no linked vendors: never turn it into an unrestricted inventory/history read.
export async function readVendorRows(env, collection, scope, vendorIds = null, overrides = {}) {
  const read = overrides.queryCollectionPages || queryCollectionPages;
  const filters = [{ field: 'ScopeKey', op: '==', value: scope.ScopeKey }];
  if (vendorIds === null) return read(env, collection, { filters, pageSize: 250, maxRows: 10000 });
  const ids = [...new Set(vendorIds.filter(Boolean))], rows = [];
  for (let offset = 0; offset < ids.length; offset += 30) {
    rows.push(...await read(env, collection, { filters: [...filters,
      { field: 'VendorId', op: 'in', value: ids.slice(offset, offset + 30) }], pageSize: 250, maxRows: 10000 }));
  }
  return rows;
}

export async function readVendorInventory(env, collection, branchId, vendorIds = null, overrides = {}) {
  const read = overrides.listBranchCollection || listBranchCollection;
  if (vendorIds === null) return read(env, collection, branchId);
  const ids = [...new Set(vendorIds.filter(Boolean))], rows = [];
  for (let offset = 0; offset < ids.length; offset += 30) {
    // VendorId matching was already exact in the access check. Keep the
    // branch helper's snapshot coverage proof for legacy untagged products.
    rows.push(...await read(env, collection, branchId, {
      filters: [{ field: 'VendorId', op: 'in', value: ids.slice(offset, offset + 30) }]
    }));
  }
  return rows;
}
