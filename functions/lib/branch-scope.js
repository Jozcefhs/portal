const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();

export function normalizedBranchId(value, fallback = '') {
  const branchId = lower(value);
  if (!branchId || branchId === 'all') return lower(fallback);
  return branchId;
}

export function actorBranchScope(user = {}) {
  return normalizedBranchId(user.branchId || user.BranchId);
}

export function recordBranchId(row = {}, fallback = 'main') {
  return normalizedBranchId(row.BranchId || row.branchId, fallback);
}

export function branchRecordVisible(row = {}, user = {}, options = {}) {
  const assigned = actorBranchScope(user);
  if (!assigned) return true;
  const inferred = normalizedBranchId(options.inferredBranchId);
  return recordBranchId(row, inferred || options.fallback || 'main') === assigned;
}

export function enforceActorBranch(user = {}, requested = '', existing = '', fallback = 'main') {
  const assigned = actorBranchScope(user);
  const wanted = normalizedBranchId(requested);
  const stored = normalizedBranchId(existing);
  if (assigned && wanted && wanted !== assigned) {
    const error = new Error('This staff account is restricted to another branch.');
    error.status = 403;
    throw error;
  }
  if (assigned && stored && stored !== assigned) {
    const error = new Error('This record belongs to another branch.');
    error.status = 403;
    throw error;
  }
  return assigned || wanted || stored || normalizedBranchId(fallback, 'main');
}

export function resolveRequestedBranch(user = {}, requested = '', options = {}) {
  const assigned = actorBranchScope(user);
  const wantedRaw = lower(requested);
  const wanted = normalizedBranchId(requested);
  if (assigned) {
    if (wanted && wanted !== assigned) {
      const error = new Error('This staff account is restricted to another branch.');
      error.status = 403;
      throw error;
    }
    return assigned;
  }
  if (options.allowAll && (!wantedRaw || wantedRaw === 'all')) return 'all';
  return wanted || normalizedBranchId(options.fallback || 'main', 'main');
}
