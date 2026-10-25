import { listCollection, queryCollectionPages } from './firestore.js';
import { listBranchCollection } from './branch-reads.js';

export function historyDateRange(input = {}) {
  const fromDate = String(input.fromDate || '').trim();
  const toDate = String(input.toDate || '').trim();
  const valid = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!valid(fromDate) || !valid(toDate) || fromDate > toDate) {
    throw Object.assign(new Error('Choose valid From and To dates before loading history.'), { status: 400 });
  }
  return { fromDate, toDate };
}

export function historyQueryOptions(range, field = 'CreatedAt') {
  const { fromDate, toDate } = historyDateRange(range);
  return { filters: [{ field, op: '>=', value: fromDate }, { field, op: '<=', value: `${toDate}\uf8ff` }],
    cursorField: field, pageSize: 250, maxRows: 10000 };
}

// The date-mode envelope is sent by the web history workspace. Older desktop
// clients and internal operations retain their existing record contracts.
// No selected dates means NO history query, not an unbounded fallback.
export async function loadDatedHistory(env, collection, body = {}, field = 'CreatedAt', branchId, overrides = {}) {
  const db = { listCollection, listBranchCollection, queryCollectionPages, ...overrides };
  if (!Object.hasOwn(body, 'HistoryDateRange')) {
    return branchId === undefined ? db.listCollection(env, collection) : db.listBranchCollection(env, collection, branchId);
  }
  const range = body.HistoryDateRange || {};
  if (!range.fromDate && !range.toDate) return [];
  const options = historyQueryOptions(range, field);
  return branchId === undefined ? db.queryCollectionPages(env, collection, options)
    : db.listBranchCollection(env, collection, branchId, options);
}
