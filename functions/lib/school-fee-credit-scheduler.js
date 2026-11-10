const clean = value => String(value ?? '').trim();
const STATE = 'schoolFeeCreditScheduler';
const strip = row => Object.fromEntries(Object.entries(row || {}).filter(([key]) => !key.startsWith('__')));
const cursor = (row, field) => ({ startAfterName: clean(row.__name), startAfterFieldValue: Number(row[field]) });
const identity = (row, kind) => ({ id: clean(row.__id || row.__name?.split('/').at(-1)), kind });

// The notification endpoint calls one bounded page. Its daily caller continues
// while hasMore is true. A completed date is a watermark, so retries need only
// one state read and never rescan all accounts or rewrite timestamps.
export async function runSchoolFeeCreditSchedule(env, options, deps) {
  const today = clean(options.today) || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error('A valid school-fee credit processing date is required.');
  const limit = Math.max(1, Math.min(100, Math.floor(Number(options.limit) || 25)));
  const prior = await deps.getDocument(env, 'settings', STATE);
  if (prior && !clean(prior.__updateTime)) throw new Error('The credit scheduler checkpoint has no verified revision.');
  if (prior?.CompletedDate === today && prior.Phase === 'complete') {
    return { ok: true, date: today, inspected: 0, creditedAccounts: 0, creditedInvoices: 0, failed: 0, hasMore: false, skipped: true };
  }
  const state = prior?.CycleDate === today ? strip(prior) : {
    CycleDate: today, Phase: 'managed', ManagedCursor: null, LegacyCursor: null, RetryCandidates: [], CompletedDate: ''
  };
  const kind = state.Phase;
  let page, done, nextCursor;
  if (kind === 'managed') {
    const loaded = await deps.listSchoolFeeCreditCandidates(env, { limit, ...(state.ManagedCursor || {}) });
    page = loaded.accounts; done = loaded.done; nextCursor = loaded.nextCursor;
  } else if (kind === 'legacy') {
    page = await deps.queryCollection(env, 'accountSummaries', {
      filters: [{ field: 'CreditBalance', op: '>', value: 0 }],
      orderBy: [{ field: 'CreditBalance' }, { field: '__name__' }], limit, ...(state.LegacyCursor || {})
    });
    done = page.length < limit; nextCursor = done ? null : cursor(page.at(-1), 'CreditBalance');
  } else {
    page = await Promise.all((state.RetryCandidates || []).slice(0, limit).map(async entry => ({
      entry, row: await deps.getDocument(env, 'accountSummaries', entry.id)
    })));
    done = page.length >= (state.RetryCandidates || []).length;
  }
  const result = { ok: true, date: today, inspected: 0, creditedAccounts: 0, creditedInvoices: 0,
    held: 0, deferred: 0, failed: 0, failures: [], hasMore: true };
  const retry = kind === 'retry' ? state.RetryCandidates.slice(page.length) : [...(state.RetryCandidates || [])];
  const started = Date.now();
  let last = null;
  for (let index = 0; index < page.length; index += 1) {
    if (index && Date.now() - started > 10_000 && kind !== 'retry') { done = false; nextCursor = cursor(last,
      kind === 'managed' ? 'PendingSchoolFeeCredit' : 'CreditBalance'); break; }
    const row = kind === 'retry' ? page[index].row : page[index];
    const entry = kind === 'retry' ? page[index].entry : identity(row, kind);
    last = row; result.inspected++;
    if (!row) continue;
    try {
      let applied;
      if (row.SchoolFeeCreditManaged === true) {
        if (entry.kind === 'legacy') continue;
        if (row.SchoolFeeCreditReviewRequired === true) { result.held++; continue; }
        const dueDate = clean(row.NextSchoolFeeCreditDueDate);
        if (!dueDate || dueDate > today || Number(row.PendingSchoolFeeCredit) <= 0) { result.deferred++; continue; }
        applied = await deps.applyManagedSchoolFeeCreditForAccount(env, row, { today, summary: row });
      } else {
        applied = await deps.applyLegacySchoolFeeCreditCandidate(env, row, { today });
      }
      if (applied?.held) result.held++;
      if (applied?.deferred) result.deferred++;
      if (applied?.allocations?.length) { result.creditedAccounts++; result.creditedInvoices += applied.allocations.length; }
    } catch (error) {
      retry.push(entry); result.failed++;
      result.failures.push({ accountRef: clean(row.AccountRef), branchId: clean(row.BranchId), message: clean(error?.message || error) });
    }
  }
  state.RetryCandidates = [...new Map(retry.map(entry => [`${entry.kind}:${entry.id}`, entry])).values()];
  if (kind === 'managed') { state.ManagedCursor = nextCursor; state.Phase = done ? 'legacy' : 'managed'; }
  else if (kind === 'legacy') { state.LegacyCursor = nextCursor; state.Phase = done ? (state.RetryCandidates.length ? 'retry' : 'complete') : 'legacy'; }
  else state.Phase = state.RetryCandidates.length ? 'retry' : 'complete';
  if (state.Phase === 'complete') state.CompletedDate = today;
  if (['managed','legacy'].includes(state.Phase)) {
    const next = state.Phase === 'managed' ? state.ManagedCursor : state.LegacyCursor;
    if (next && (!next.startAfterName || !Number.isFinite(next.startAfterFieldValue))) throw new Error('The credit queue cursor is invalid.');
  }
  result.hasMore = state.Phase !== 'complete';
  // Retryable account failures do not stop unrelated queue pages. A failed
  // retry reports failure to the caller, with the retry list retained.
  result.ok = kind !== 'retry' || result.failed === 0;
  result.failures = result.failures.slice(0, 10);
  if (JSON.stringify(strip(prior)) !== JSON.stringify(state)) await deps.batchCommitDocuments(env, [{
    collectionPath: 'settings', documentId: STATE, ...(prior ? { updateTime: prior.__updateTime } : { exists: false }),
    data: state
  }]);
  return result;
}
