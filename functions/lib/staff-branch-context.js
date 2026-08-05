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
