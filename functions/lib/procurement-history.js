import { queryCollection, getDocument } from './firestore.js';
import { clean, plain, fail, id, sameScope, visibleRecord, sectionFor } from './procurement-rules.js';

export const PROCUREMENT_PAGE_SIZE = 100;
export const PROCUREMENT_RECORDS = Object.freeze({
  requests: { collection: 'procurementRequests', key: 'RequisitionId', active: ['PENDING', 'APPROVED', 'PARTIALLY_ISSUED'] },
  purchases: { collection: 'procurementPurchases', key: 'PurchaseId', active: ['PENDING', 'APPROVED', 'PARTIALLY_RECEIVED'] },
  transfers: { collection: 'procurementTransfers', key: 'TransferId', active: ['IN_TRANSIT', 'PARTIALLY_RECEIVED', 'DISCREPANCY'] }
});
const SUMMARY_FIELDS = ['ScopeKey', 'BranchId', 'OrganisationEdition', 'SchoolSection', 'Department', 'RequisitionId',
  'PurchaseId', 'TransferId', 'CreatedAt', 'CreatedBy', 'CreatedByUsername', 'UpdatedAt', 'UpdatedBy', 'Revision',
  'Status', 'Lines', 'Notes', 'NeededBy', 'RequestedBy', 'SupplierName', 'Reference', 'FinanceReference', 'TotalAmount',
  'ReviewedAt', 'ReviewedBy', 'ReviewNotes', 'OverrideReason'];

function access(user, scope, cap, body) {
  const kind = clean(body.Kind), config = PROCUREMENT_RECORDS[kind];
  if (!Object.hasOwn(PROCUREMENT_RECORDS, kind)) fail('Choose a Procurement record type.');
  if (kind === 'purchases' && !cap.canManage && !cap.canApprove) fail('Purchase records are not available to this account.', 403);
  const schoolSection = sectionFor(user, scope, body.SchoolSection);
  const viewUser = { ...user, schoolSectionAccess: schoolSection };
  const visible = row => kind === 'purchases' ? sameScope(row, scope) : visibleRecord(row, viewUser, scope, cap);
  return { kind, config, schoolSection, visible };
}

export async function procurementRecordPage(env, user, scope, cap, body, dependencies = {}) {
  const query = dependencies.page || dependencies.query || queryCollection;
  const get = dependencies.get || getDocument;
  const { kind, config, schoolSection, visible } = access(user, scope, cap, body);
  const mode = clean(body.Mode || 'active');
  if (!['active', 'history'].includes(mode)) fail('Choose active work or all record history.');
  if (body.Cursor != null && (typeof body.Cursor !== 'object' || Array.isArray(body.Cursor))) fail('The history cursor is invalid. Refresh the records.');
  const filters = [
    { field: 'ScopeKey', op: '==', value: scope.ScopeKey },
    { field: 'BranchId', op: '==', value: scope.BranchId },
    { field: 'OrganisationEdition', op: '==', value: scope.OrganisationEdition }
  ];
  if (kind !== 'purchases') {
    if (!cap.departments.length) return { rows: [], paging: { mode, hasMore: false, nextCursor: null } };
    if (scope.OrganisationEdition === 'school') filters.push({ field: 'SchoolSection', op: '==', value: schoolSection });
    filters.push({ field: 'Department', op: 'in', value: cap.departments });
  }
  if (mode === 'active') filters.push({ field: 'Status', op: 'in', value: config.active });
  let anchor;
  if (body.Cursor) {
    anchor = await get(env, config.collection, id(body.Cursor.Id, 'history cursor'));
    if (!visible(anchor) || !clean(anchor?.CreatedAt) || !clean(anchor?.__name)) fail('This history cursor is no longer available in the selected scope. Refresh the records.', 409);
  }
  const rows = await query(env, config.collection, {
    filters, select: SUMMARY_FIELDS,
    orderBy: [{ field: 'CreatedAt', direction: 'DESCENDING' }, { field: '__name__', direction: 'DESCENDING' }],
    limit: PROCUREMENT_PAGE_SIZE + 1,
    ...(anchor ? { startAfterName: anchor.__name, startAfterFieldValue: anchor.CreatedAt } : {})
  });
  // The complete authorization scope is part of the indexed query, not a
  // post-pagination filter. A corrupt/out-of-scope query result fails closed.
  if (rows.some(row => !visible(row) || (kind !== 'purchases' && row.SchoolSection !== schoolSection)
    || (mode === 'active' && !config.active.includes(row.Status)))) fail('These Procurement records need a scope review. No partial history was shown.', 409);
  const page = rows.slice(0, PROCUREMENT_PAGE_SIZE), last = page.at(-1), hasMore = rows.length > PROCUREMENT_PAGE_SIZE;
  return { rows: page.map(row => plain(Object.fromEntries(Object.entries(row).filter(([key]) => SUMMARY_FIELDS.includes(key))))),
    paging: { mode, hasMore, nextCursor: hasMore && last ? { Id: id(last.__id || last[config.key], 'history cursor') } : null } };
}

export async function procurementRecordDetail(env, user, scope, cap, body, dependencies = {}) {
  const { config, visible } = access(user, scope, cap, body);
  const row = await (dependencies.get || getDocument)(env, config.collection, id(body.RecordId));
  if (!visible(row)) fail('This Procurement record is not available in the selected scope.', 404);
  return plain(row);
}
