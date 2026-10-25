import { assignedStaffBranches, selectAssignedStaffBranch } from './staff-branch-access.js';

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
    const mode = lower(row?.SchoolSectionMode || row?.schoolSectionMode);
    return id ? { id, name: name || id,
      ...(['primary', 'secondary', 'mixed'].includes(mode) ? { schoolSectionMode: mode } : {}) } : null;
  }).filter(Boolean);
  return branches.length ? branches : [{ id: 'main', name: 'Main Branch' }];
}

export function staffAssignmentActor(user = {}, environmentAdminUsername = '') {
  const isEnvironmentAdmin = clean(user.role || user.Role) === 'Super Admin'
    && lower(user.username || user.Username) === lower(environmentAdminUsername);
  if (!isEnvironmentAdmin) return user;
  return {
    ...user,
    assignedBranchId: '',
    assignedBranchIds: [],
    branchAccess: 'all',
    canSwitchBranches: true
  };
}

export function applyStaffBranchContext(user = {}, requestedBranch = '', structure = {}) {
  const branches = configuredStaffBranches(structure);
  const assignedIds = assignedStaffBranches(user);
  const assignedBranchId = assignedIds?.[0] || '';
  if (assignedIds !== null) {
    const requested = lower(requestedBranch);
    if (requested && requested !== 'all' && !assignedIds.includes(requested)) {
      const error = new Error(assignedIds.length === 1 ? 'This staff account is assigned to one branch and cannot switch to another branch.' : 'This staff account cannot switch outside its assigned branches.');
      error.status = 403;
      throw error;
    }
    const selected = selectAssignedStaffBranch(user, requested);
    if (structure.Branches?.length && !branches.some(branch => lower(branch.id) === selected)) {
      throw Object.assign(new Error('The assigned branch is no longer configured. Contact an administrator.'), {status:403});
    }
    return {
      ...user,
      assignedBranchId,
      assignedBranchIds: assignedIds,
      branchAccess: 'selected',
      activeBranchId: selected,
      canSwitchBranches: assignedIds.length > 1,
      branchId: selected
    };
  }

  const requested = lower(requestedBranch);
  if (!requested || requested === 'all') {
    return {
      ...user,
      assignedBranchId: '',
      assignedBranchIds: [],
      branchAccess: 'all',
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
    assignedBranchIds: [],
    branchAccess: 'all',
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
