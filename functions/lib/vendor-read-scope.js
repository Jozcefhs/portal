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

// Every settlement writer records PaymentStatus. Keep all actionable requests
// visible immediately; paid/rejected/cancelled records are explicit history.
export async function readVendorRequests(env, scope, vendorIds = null, period = null, overrides = {}) {
  const read = overrides.queryCollectionPages || queryCollectionPages;
  const statuses = period ? ['Paid', 'Rejected', 'Cancelled'] : ['Awaiting approval', 'Awaiting payment', 'Part-paid', 'Unpaid'];
  const filters = [{ field: 'ScopeKey', op: '==', value: scope.ScopeKey }, { field: 'PaymentStatus', op: 'in', value: statuses }];
  if (period) filters.push({ field: 'RequestedAt', op: '>=', value: period.from }, { field: 'RequestedAt', op: '<=', value: `${period.to}\uffff` });
  const ids = vendorIds === null ? null : [...new Set(vendorIds.filter(Boolean))];
  const groups = ids === null ? [null] : Array.from({ length: Math.ceil(ids.length / 7) }, (_, index) => ids.slice(index * 7, index * 7 + 7));
  const rows = [];
  try {
    for (const group of groups) rows.push(...await read(env, 'vendorSettlementRequests', {
      filters: group ? [...filters, { field: 'VendorId', op: 'in', value: group }] : filters,
      pageSize: 100, maxRows: 10000, ...(period ? { cursorField: 'RequestedAt' } : {})
    }));
  } catch (error) {
    if (error.upstreamCode === 'FAILED_PRECONDITION' || /requires? an? index|index.*building/i.test(error.message || '')) {
      throw Object.assign(new Error('The vendor request index is not ready. Retry after setup completes; no entire-history fallback was requested.'), { status: 409, code: 'VENDOR_REQUEST_INDEX_NOT_READY' });
    }
    throw error;
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
