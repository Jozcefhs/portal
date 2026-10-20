import { batchCommitLiteralDocuments, createDocumentIfAbsent, getDocument, queryCollection } from './firestore.js';

const clean = value => String(value ?? '').trim();
const fail = (message, status = 409) => Object.assign(new Error(message), { status });
export const REVENUE_SYNC_STAGES = ['invoices', 'payments', 'invoiceCredits', 'ledger', 'forms'];
const stateCollection = 'accountingRevenueSyncRuns';
const publicState = run => ({
  ok: true, complete: run.Status === 'Complete', runId: run.RunId, step: run.Step,
  stage: run.Targets[run.Stage]?.stage || 'complete', processed: run.Processed, created: run.Changes,
  message: run.Status === 'Complete' ? 'Revenue subledgers synchronized.' : 'Revenue synchronization is in progress; no complete result is available yet.'
});
const withoutMetadata = row => Object.fromEntries(Object.entries(row || {}).filter(([key]) => !key.startsWith('__')));

// One request only: share repeated dependency reads and bound database fan-out.
// Never retain financial records across requests or tenants.
export function revenueSyncReader(database, concurrency = 5) {
  const cache = new Map(), waiting = [];
  let active = 0, reads = 0;
  const run = async work => {
    if (active >= concurrency) await new Promise(resolve => waiting.push(resolve));
    else active++;
    try { return await work(); }
    finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
  const db = {};
  for (const method of ['getDocument', 'queryCollection', 'listCollection']) {
    db[method] = (env, ...args) => {
      const key = JSON.stringify([method, ...args]);
      if (!cache.has(key)) {
        reads++;
        cache.set(key, run(() => database[method](env, ...args)));
      }
      return cache.get(key);
    };
  }
  return { db, get reads() { return reads; } };
}

// Financial changes and the cursor advance are committed together. A lost
// response, retry or competing worker cannot post a row twice or skip a row.
export async function continueRevenueSync(env, body, scope, hooks, overrides = {}) {
  if (body.SyncVersion !== 1) throw fail('Revenue synchronization now uses resumable batches. Update the desktop app before synchronizing.', 426);
  if (!scope.actor) throw fail('Sign in again before synchronizing revenue.', 403);
  const db = { getDocument, createDocumentIfAbsent, queryCollection, batchCommitLiteralDocuments, ...overrides };
  const keyBytes = new TextEncoder().encode(JSON.stringify([scope.edition, scope.branchId, scope.actor]));
  const digest = await crypto.subtle.digest('SHA-256', keyBytes);
  const key = `SYNC-${Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')}`;
  let run = await db.getDocument(env, stateCollection, key);
  if (run && (run.Actor !== scope.actor || run.BranchId !== scope.branchId || run.Edition !== scope.edition)) throw fail('This synchronization belongs to a different account or branch.', 403);
  if (!body.RunId) {
    if (!run || run.Status === 'Complete') {
      const targets = await hooks.prepare();
      const next = { RunId: crypto.randomUUID(), Actor: scope.actor, BranchId: scope.branchId, Edition: scope.edition,
        Status: 'Running', Targets: targets, Stage: 0, Cursor: '', Step: 0, Processed: 0, Changes: 0,
        PageSize: 50, StartedAt: new Date().toISOString() };
      if (run) {
        if (!run.__updateTime) throw fail('The synchronization checkpoint has no database version. Reload and retry.', 428);
        await db.batchCommitLiteralDocuments(env, [{ collectionPath: stateCollection, documentId: key,
          data: next, updateTime: run.__updateTime }]);
      }
      else await db.createDocumentIfAbsent(env, stateCollection, key, next);
      run = await db.getDocument(env, stateCollection, key);
    }
    return publicState(run);
  }
  if (!run || body.RunId !== run.RunId) throw fail('This synchronization run is no longer current. Start or resume synchronization again.');
  if (!Number.isInteger(body.Step) || body.Step < 0 || body.Step > run.Step) throw fail('The synchronization checkpoint is invalid.');
  if (body.Step < run.Step || run.Status === 'Complete') return publicState(run);
  if (!run.__updateTime) throw fail('The synchronization checkpoint has no database version. Reload and retry.', 428);
  const target = run.Targets[run.Stage];
  if (!target || !REVENUE_SYNC_STAGES.includes(target.stage) && target.stage !== 'donations') throw fail('The synchronization stage is invalid.');
  // Upgrade unfinished one-row runs too; their cursor and identity stay intact.
  const limit = 50;
  const rows = await db.queryCollection(env, target.collection, {
    orderBy: [{ field: '__name__' }], limit,
    ...(run.Cursor ? { startAfterName: run.Cursor } : {})
  });
  if (rows.length > limit) throw fail('The source page exceeded its synchronization bound.');
  const seen = new Set();
  for (const row of rows) {
    if (!row.__id || !row.__name || row.__name === run.Cursor || seen.has(row.__name)) throw fail('The synchronization source cursor stalled.');
    seen.add(row.__name);
  }
  const prepared = hooks.preparePage ? await hooks.preparePage(target, rows, scope) : null;
  const writes = new Map();
  let checked = 0;
  let changed = 0;
  let expensive = 0;
  const started = Date.now();
  let cursor = run.Cursor;
  for (const raw of rows) {
    // Query results are not trusted to grant write access. The scope is checked
    // again by the planner against the current source and related records.
    let plan = { writes: [] };
    if (scope.branchId === 'all' || clean(raw.BranchId || raw.branchId || target.branchId || 'main').toLowerCase() === scope.branchId) {
      try {
        plan = await hooks.planRow(target, raw, scope, prepared);
      } catch (error) {
        error.message = `Revenue synchronization paused at ${target.stage} record ${raw.__id}: ${error.message}. Completed batches are saved; this checkpoint was not advanced.`;
        throw error;
      }
    }
    for (const write of plan.writes || []) {
      const writeKey = `${write.collectionPath}/${write.documentId}`;
      if (writes.has(writeKey)) throw fail('Two source records proposed the same accounting write. Finance review is required.');
      if (write.updateTime === undefined && write.exists !== false) throw fail('An accounting write lacks a concurrency precondition.');
      writes.set(writeKey, { ...write, ...(write.data ? { data: withoutMetadata(write.data) } : {}) });
    }
    changed += plan.changes || 0;
    if (plan.expensive) expensive++;
    checked++;
    cursor = raw.__name;
    // Stop after a changing source: later rows must see that committed change.
    // Read-only checks can share the request, bounded by work and wall time.
    if (writes.size || expensive >= 2 || (prepared?.reader?.reads || 0) >= 24 ||
        Date.now() - started >= 10_000) break;
  }
  const exhausted = checked === rows.length && rows.length < limit;
  const next = { ...withoutMetadata(run), Step: run.Step + 1, Processed: run.Processed + checked,
    Changes: run.Changes + changed, Cursor: cursor, UpdatedAt: new Date().toISOString(),
    PageSize: 50 };
  if (exhausted) Object.assign(next, { Stage: run.Stage + 1, Cursor: '', PageSize: 50 });
  if (next.Stage === run.Targets.length) Object.assign(next, { Status: 'Complete', CompletedAt: next.UpdatedAt });
  writes.set(`${stateCollection}/${key}`, { collectionPath: stateCollection, documentId: key,
    data: next, updateTime: run.__updateTime });
  await db.batchCommitLiteralDocuments(env, [...writes.values()]);
  return publicState(next);
}

export function revenueSyncWrite(collectionPath, documentId, data, current = null) {
  const version = clean(current?.__updateTime);
  if (current && !version) throw fail('An existing financial record has no database version. Reload and retry.', 428);
  return { collectionPath, documentId, data, ...(current ? { updateTime: version } : { exists: false }) };
}
