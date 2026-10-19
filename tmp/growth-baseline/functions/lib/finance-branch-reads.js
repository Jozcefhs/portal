import { listCollection, listCollectionForReport, listCollectionPage, queryCollection, queryCollectionPages } from './firestore.js';
import { accountingRowsForBranch } from './accounting-branch-scope.js';
import { canonicalSchoolBranchId } from './school-scope.js';

const dependencies = { listCollection, listCollectionForReport, listCollectionPage, queryCollection, queryCollectionPages };
const branchKey = value => String(value || 'all').toLowerCase() === 'all' ? 'all' : canonicalSchoolBranchId(value);
const scopedQuery = branch => ({ filters: ['BranchId', 'branchId'].map(field => ({ field, op: '==', value: branch })), filterJoin: 'OR' });

// Main must still include legacy records without BranchId. Other branches can
// use indexed reads and must never fall back to scanning the Main catalogue.
export async function loadBranchFinanceRows(env, collection, branchId, options = {}, overrides = {}) {
  const db = { ...dependencies, ...overrides }, branch = branchKey(branchId);
  let rows;
  if (branch === 'main' || branch === 'all') {
    rows = options.filters
      ? await db.queryCollectionPages(env, collection, options)
      : options.report ? await db.listCollectionForReport(env, collection, options)
        : await db.listCollection(env, collection, options.readTime ? { query: `readTime=${encodeURIComponent(options.readTime)}` } : undefined);
  } else if (options.filters?.length) {
    const groups = await Promise.all(['BranchId', 'branchId'].map(field => db.queryCollectionPages(env, collection, {
      ...options, filters: [{ field, op: '==', value: branch }, ...options.filters], filterJoin: 'AND'
    })));
    rows = [...new Map(groups.flat().map(row => [row.__name || row.__id, row])).values()];
  } else {
    rows = await db.queryCollectionPages(env, collection, { pageSize: 500, maxRows: 40000, ...options, ...scopedQuery(branch) });
  }
  return accountingRowsForBranch(rows, branch);
}

// Keep snapshot pagination, but page over only the selected branch's index.
// Bind cursors to branch, collection and snapshot so a workspace switch cannot
// accidentally continue another branch's report.
export async function loadBranchFinancePage(env, collection, branchId, options = {}, overrides = {}) {
  const db = { ...dependencies, ...overrides }, branch = branchKey(branchId);
  const { readTime = '', pageToken = '', pageSize = 500 } = options;
  if (branch === 'main' || branch === 'all') {
    return db.listCollectionPage(env, collection, { pageSize, pageToken, query: `readTime=${encodeURIComponent(readTime)}` });
  }
  let startAfterName = '';
  if (pageToken) {
    let cursor;
    try { cursor = JSON.parse(pageToken); } catch { /* rejected below */ }
    if (cursor?.version !== 1 || cursor.branch !== branch || cursor.collection !== collection || cursor.readTime !== readTime
      || typeof cursor.last !== 'string' || !cursor.last.includes(`/documents/${collection}/`)) {
      const error = new Error('This finance page belongs to a different branch or snapshot. Refresh the report.'); error.status = 400; throw error;
    }
    startAfterName = cursor.last;
  }
  const rows = await db.queryCollection(env, collection, { ...scopedQuery(branch), readTime,
    orderBy: [{ field: '__name__' }], limit: pageSize + 1, ...(startAfterName ? { startAfterName } : {}) });
  const documents = rows.slice(0, pageSize);
  const nextPageToken = rows.length > pageSize ? JSON.stringify({ version: 1, branch, collection, readTime, last: documents.at(-1).__name }) : '';
  return { documents, nextPageToken };
}
