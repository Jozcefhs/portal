const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const fail = (message, status = 403) => { throw Object.assign(new Error(message), { status }); };

// null means organisation-wide. An explicitly selected but empty list grants
// no branch access; legacy records continue to use their single BranchId.
export function assignedStaffBranches(user = {}) {
  const mode = lower(user.BranchAccess ?? user.branchAccess);
  const values = user.assignedBranchIds ?? user.BranchIds ?? user.branchIds;
  if (mode === 'all') return null;
  if (Array.isArray(values)) return [...new Set(values.map(lower).filter(id => id && id !== 'all'))];
  if (mode === 'selected') return [];
  const legacy = lower(user.assignedBranchId || (user.canSwitchBranches === true ? '' : user.BranchId || user.branchId));
  return legacy && legacy !== 'all' ? [legacy] : null;
}

export function staffBranchAccessFields(user = {}) {
  const ids = assignedStaffBranches(user);
  return { BranchAccess: ids === null ? 'all' : 'selected', BranchIds: ids || [], BranchId: ids?.[0] || '' };
}

export function staffAccountVisibleInBranch(row = {}, actor = {}) {
  const active = lower(actor.branchId || actor.BranchId);
  const ids = assignedStaffBranches(row);
  return !active || active === 'all' || ids === null || ids.includes(active);
}

export function assertStaffScopeManageable(actor = {}, target = {}) {
  const allowed = assignedStaffBranches(actor), current = assignedStaffBranches(target);
  if (allowed !== null && (current === null || current.some(id => !allowed.includes(id)))) {
    fail('This staff account has branch access outside your assigned branches. An organisation-wide administrator must manage it.');
  }
}

export function resolveStaffBranchAssignment(actor, input, existing, structure = {}) {
  const configured = (structure.Branches || []).map(row => ({
    id: clean(typeof row === 'string' ? row : row.Id || row.id),
  })).filter(row => row.id);
  if (!configured.length) configured.push({ id: 'main' });
  const allowed = assignedStaffBranches(actor);
  if (existing) assertStaffScopeManageable(actor, existing);
  const explicit = Object.hasOwn(input, 'BranchIds') || Object.hasOwn(input, 'BranchAccess');
  let ids;
  if (explicit) {
    if (input.BranchAccess === 'all') ids = null;
    else {
      if (!Array.isArray(input.BranchIds)) fail('Choose one or more assigned branches.', 400);
      ids = [...new Set(input.BranchIds.map(lower))];
      if (!ids.length || ids.some(id => !id || id === 'all')) fail('Choose one or more assigned branches.', 400);
    }
  } else if (lower(input.BranchId || input.branchId) === 'all') ids = null;
  else if (clean(input.BranchId || input.branchId)) {
    const requested = lower(input.BranchId || input.branchId);
    // An older client editing a multi-branch account must not erase its list.
    ids = existing && Array.isArray(existing.BranchIds) && requested === lower(existing.BranchId)
      ? assignedStaffBranches(existing) : [requested];
  } else ids = existing ? assignedStaffBranches(existing)
    : [lower(actor.activeBranchId || actor.branchId || structure.ActiveBranchId || configured[0].id)];
  if (ids !== null && ids.some(id => !configured.some(row => lower(row.id) === id))) fail('Choose branches configured for this organisation.', 400);
  if (allowed !== null && (ids === null || ids.some(id => !allowed.includes(id)))) fail('You cannot assign staff access outside your assigned branches.');
  const canonical = ids?.map(id => configured.find(row => lower(row.id) === id).id) || [];
  return { BranchAccess: ids === null ? 'all' : 'selected', BranchIds: canonical, BranchId: canonical[0] || '' };
}

export function selectAssignedStaffBranch(user, requested = '') {
  const ids = assignedStaffBranches(user);
  if (ids === null) return null;
  if (!ids.length) fail('No branches are assigned to this staff account. Contact an administrator.');
  const wanted = lower(requested);
  if (wanted && wanted !== 'all' && !ids.includes(wanted)) fail('This staff account is restricted to its assigned branches.');
  return wanted && wanted !== 'all' ? wanted : ids[0];
}
