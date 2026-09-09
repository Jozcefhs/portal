function clean(value) {
  return String(value ?? '').trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

export function configuredStaffBranches(structure = {}) {
  const rows = Array.isArray(structure.Branches) ? structure.Branches : [];
  const branches = rows.map((row) => {
    const id = clean(typeof row === 'string' ? row : row?.Id || row?.id || row?.Name || row?.name);
    const name = clean(typeof row === 'string' ? row : row?.Name || row?.name || id);
    return id ? { id, name: name || id } : null;
  }).filter(Boolean);
  return branches.length ? branches : [{ id: 'main', name: 'Main Branch' }];
}

export function applyStaffBranchContext(user = {}, requestedBranch = '', structure = {}) {
  const branches = configuredStaffBranches(structure);
  const assignedBranchId = clean(user.assignedBranchId || user.BranchId || user.branchId);
  if (assignedBranchId) {
    const requested = lower(requestedBranch);
    if (requested && requested !== 'all' && requested !== lower(assignedBranchId)) {
      const error = new Error('This staff account is assigned to one branch and cannot switch to another branch.');
      error.status = 403;
      throw error;
    }
    return {
      ...user,
      assignedBranchId,
      activeBranchId: assignedBranchId,
      canSwitchBranches: false,
      branchId: assignedBranchId
    };
  }

  const requested = lower(requestedBranch);
  if (!requested || requested === 'all') {
    return {
      ...user,
      assignedBranchId: '',
      activeBranchId: 'all',
      canSwitchBranches: true,
      branchId: ''
    };
  }

  const selected = branches.find((branch) => lower(branch.id) === requested);
  if (!selected) {
    const error = new Error('The selected branch is not configured for this organisation.');
    error.status = 403;
    throw error;
  }
  return {
    ...user,
    assignedBranchId: '',
    activeBranchId: selected.id,
    canSwitchBranches: true,
    branchId: selected.id
  };
}

export function resolveStaffAssignmentBranch(
  user = {}, requestedBranch = '', existingBranch = '', structure = {}, fallback = 'main'
) {
  const branches = configuredStaffBranches(structure);
  const assignedBranchId = clean(
    user.assignedBranchId || (user.canSwitchBranches === true ? '' : user.BranchId || user.branchId)
  );
  if (assignedBranchId) {
    const requested = lower(requestedBranch);
    const stored = lower(existingBranch);
    if (requested && requested !== 'all' && requested !== lower(assignedBranchId)) {
      const error = new Error('This administrator is assigned to one branch and cannot register staff in another branch.');
      error.status = 403;
      throw error;
    }
    if (stored && stored !== lower(assignedBranchId)) {
      const error = new Error('This staff account belongs to another branch.');
      error.status = 403;
      throw error;
    }
    return assignedBranchId;
  }

  const requested = clean(requestedBranch);
  if (lower(requested) === 'all') return '';
  const preferred = requested || clean(existingBranch)
    || (lower(user.activeBranchId || user.branchId) === 'all' ? '' : clean(user.activeBranchId || user.branchId))
    || clean(structure.ActiveBranchId)
    || branches[0]?.id
    || fallback;
  const selected = branches.find((branch) => lower(branch.id) === lower(preferred));
  if (!selected) {
    const error = new Error('Choose a branch configured for this organisation.');
    error.status = 400;
    throw error;
  }
  return selected.id;
}
