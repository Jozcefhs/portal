import { countCollection, listCollection, listCollectionForReport, listCollectionPage, queryCollection, queryCollectionPages } from './firestore.js';
import { getSchoolStructure } from './school-scope.js';

const defaults = { countCollection, listCollection, listCollectionForReport, listCollectionPage, queryCollection, queryCollectionPages, getSchoolStructure };
const clean = value => String(value ?? '').trim().toLowerCase();

// Legacy documents can lack a branch field (Firestore equality cannot find
// missing fields). Prove index coverage at the SAME snapshot before narrowing
// the read. This costs scalar index counts, not a scan of document bodies. Never
// cache that proof: older clients can still write an untagged record later.
export async function branchReadPlan(env, collection, branchId, options = {}, overrides = {}) {
  const db = { ...defaults, ...overrides };
  const branch = clean(branchId);
  if (!branch || branch === 'all') return { mode: 'legacy', readTime: options.readTime };
  const total = await db.countCollection(env, collection, { readTime: options.readTime });
  if (!total.count) return { mode: 'empty', readTime: total.readTime, total: 0 };
  const structure = await db.getSchoolStructure(env);
  const known = [...new Set(['main', branch, ...(structure.Branches || []).map(row => row.Id)])];
  for (const field of ['BranchId']) {
    let covered = 0;
    for (let offset = 0; offset < known.length; offset += 30) {
      const result = await db.countCollection(env, collection, { readTime: total.readTime,
        filters: [{ field, op: 'in', value: known.slice(offset, offset + 30) }] });
      covered += result.count;
    }
    if (covered === total.count) return { mode: 'indexed', readTime: total.readTime, total: total.count, field,
      values: [branch] };
  }
  return { mode: 'legacy', readTime: total.readTime, total: total.count };
}

function queryOptions(plan, options) {
  return { ...options, readTime: plan.readTime, filterJoin: 'AND',
    filters: [{ field: plan.field, op: 'in', value: plan.values }, ...(options.filters || [])] };
}

// Callers retain their existing authorization and legacy-row predicates.
// This helper narrows the database read; it does not grant access to records.
export async function listBranchCollection(env, collection, branchId, options = {}, overrides = {}) {
  const db = { ...defaults, ...overrides };
  if (String(options.filterJoin || 'AND').toUpperCase() !== 'AND') throw new Error('Branch reads require conjunctive filters.');
  const plan = await branchReadPlan(env, collection, branchId, options, db);
  if (plan.mode === 'empty') return [];
  // Some existing screens normalise legacy labels (case/whitespace). An exact
  // module filter is safe only when the whole field uses canonical labels.
  // Otherwise retain the branch query and let the existing predicate decide.
  const filters = [...(options.filters || [])];
  for (const filter of options.compatibleFilters || []) {
    if (!Number.isSafeInteger(plan.total)) {
      const total = await db.countCollection(env, collection, { readTime: plan.readTime });
      plan.total = total.count; plan.readTime = total.readTime;
    }
    const knownValues = [...new Set(filter.knownValues)];
    if (!knownValues.includes(filter.value) || knownValues.length > 30) throw new Error('Invalid compatible module filter.');
    const covered = await db.countCollection(env, collection, { readTime: plan.readTime,
      filters: [{ field: filter.field, op: 'in', value: knownValues }] });
    if (covered.count === plan.total) filters.push({ field: filter.field, op: '==', value: filter.value });
  }
  options = { ...options, filters };
  if (plan.mode === 'indexed') return db.queryCollectionPages(env, collection,
    queryOptions(plan, { maxRows: 100000, ...options }));
  if (options.filters?.length) return db.queryCollectionPages(env, collection, { maxRows: 100000, ...options, readTime: plan.readTime });
  if (options.report) return db.listCollectionForReport(env, collection, { ...options, readTime: plan.readTime });
  return db.listCollection(env, collection, plan.readTime ? { query: `readTime=${encodeURIComponent(plan.readTime)}` } : undefined);
}

export async function branchCollectionPage(env, collection, branchId, options = {}, overrides = {}) {
  const db = { ...defaults, ...overrides };
  const branch = clean(branchId), readTime = options.readTime || new Date().toISOString();
  const pageSize = Math.max(1, Math.min(1000, Number(options.pageSize) || 100));
  let cursor;
  if (options.pageToken) {
    try { cursor = JSON.parse(options.pageToken); } catch { /* rejected below */ }
    if (cursor?.v !== 1 || cursor.branch !== branch || cursor.collection !== collection || cursor.readTime !== readTime
      || !['indexed', 'legacy'].includes(cursor.mode) || typeof cursor.last !== 'string' || !cursor.last) {
      throw Object.assign(new Error('This page belongs to another branch or snapshot. Refresh the workspace.'), { status: 400 });
    }
  }
  const plan = await (overrides.branchReadPlan || branchReadPlan)(env, collection, branch, { ...options, readTime }, db);
  if (plan.mode === 'empty') return { documents: [], nextPageToken: '' };
  if (cursor && cursor.mode !== plan.mode) throw new Error('The branch read plan changed. Refresh the workspace.');
  let documents, next;
  if (plan.mode === 'legacy') {
    const result = await db.listCollectionPage(env, collection, { pageSize, pageToken: cursor?.last || '',
      query: `readTime=${encodeURIComponent(readTime)}` });
    documents = result.documents; next = result.nextPageToken;
  } else {
    if (cursor && !cursor.last.includes(`/documents/${collection}/`)) throw Object.assign(new Error('Invalid branch page cursor.'), { status: 400 });
    const rows = await db.queryCollection(env, collection, queryOptions(plan, {
      orderBy: [{ field: '__name__' }], limit: pageSize + 1,
      ...(cursor ? { startAfterName: cursor.last } : {})
    }));
    documents = rows.slice(0, pageSize); next = rows.length > pageSize ? documents.at(-1).__name : '';
    if (rows.length > pageSize && !next) throw new Error('The branch page cursor is missing.');
  }
  return { documents, nextPageToken: next ? JSON.stringify({ v: 1, branch, collection, readTime, mode: plan.mode, last: next }) : '' };
}
