import {
  enforceActorBranch,
  recordBranchId,
  resolveRequestedBranch
} from './branch-scope.js';

const clean = (value) => String(value ?? '').trim();

export function accountingActor(body = {}) {
  return { branchId: clean(body.UserBranchId || body.userBranchId) };
}

export function accountingRequestBranch(body = {}) {
  return resolveRequestedBranch(
    accountingActor(body),
    body.BranchId || body.branchId,
    { allowAll: true, fallback: 'main' }
  );
}

export function accountingRowsForBranch(rows = [], branchId = 'main') {
  const wanted = clean(branchId).toLowerCase();
  if (!wanted || wanted === 'all') return [...rows];
  return rows.filter((row) => recordBranchId(row) === wanted);
}

export function accountingWriteBranch(body = {}, existing = {}) {
  const existingBranch = Object.keys(existing || {}).length
    ? (existing.BranchId || existing.branchId || 'main')
    : '';
  return enforceActorBranch(
    accountingActor(body),
    body.BranchId || body.branchId || body.CostCentre || body.costCentre,
    existingBranch,
    'main'
  );
}

export function withAccountingBranch(payload = {}, body = {}, existing = {}) {
  return {
    ...payload,
    BranchId: accountingWriteBranch(body, existing)
  };
}
