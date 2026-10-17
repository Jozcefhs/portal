function clean(value) {
  return String(value ?? '').trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

export const REQUISITION_STATUS = Object.freeze({
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  ACCOUNTS_CONFIRMED: 'Accounts Confirmed',
  ADMIN_REVIEWED: 'Admin Reviewed',
  MANAGEMENT_AUTHORIZED: 'Management Authorized',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  POSTED: 'Posted'
});

const TRANSITIONS = Object.freeze({
  [REQUISITION_STATUS.SUBMITTED]: Object.freeze({
    role: 'Accounts Officer',
    nextStatus: REQUISITION_STATUS.ACCOUNTS_CONFIRMED,
    event: 'Confirmed',
    stage: 'accounts',
    verb: 'confirm'
  }),
  [REQUISITION_STATUS.ACCOUNTS_CONFIRMED]: Object.freeze({
    role: 'Admin',
    nextStatus: REQUISITION_STATUS.ADMIN_REVIEWED,
    event: 'Reviewed',
    stage: 'admin-review',
    verb: 'review'
  }),
  [REQUISITION_STATUS.ADMIN_REVIEWED]: Object.freeze({
    role: 'Director or Super Admin',
    roles: ['Director', 'Super Admin'],
    nextStatus: REQUISITION_STATUS.APPROVED,
    event: 'Approved',
    stage: 'director',
    verb: 'approve'
  }),
  [REQUISITION_STATUS.MANAGEMENT_AUTHORIZED]: Object.freeze({
    role: 'Director or Super Admin',
    roles: ['Director', 'Super Admin'],
    nextStatus: REQUISITION_STATUS.APPROVED,
    event: 'Approved',
    stage: 'director',
    verb: 'approve'
  }),
  [REQUISITION_STATUS.APPROVED]: Object.freeze({
    role: 'Accounts Officer',
    nextStatus: REQUISITION_STATUS.POSTED,
    event: 'Posted',
    stage: 'posting',
    verb: 'post and pay'
  })
});

export function requisitionWorkflowStatus(record = {}) {
  const status = lower(record.Status);
  if (status === 'approved' && !record.ApprovalFlow && !clean(record.AdminReviewedAt)) {
    // Records approved under the previous workflow still require the new
    // administrative approval before Accounts may post or pay them.
    return REQUISITION_STATUS.MANAGEMENT_AUTHORIZED;
  }
  return ({
    draft: REQUISITION_STATUS.DRAFT,
    submitted: REQUISITION_STATUS.SUBMITTED,
    confirmed: REQUISITION_STATUS.ACCOUNTS_CONFIRMED,
    'accounts confirmed': REQUISITION_STATUS.ACCOUNTS_CONFIRMED,
    'admin reviewed': REQUISITION_STATUS.ADMIN_REVIEWED,
    authorized: REQUISITION_STATUS.MANAGEMENT_AUTHORIZED,
    authorised: REQUISITION_STATUS.MANAGEMENT_AUTHORIZED,
    'management authorized': REQUISITION_STATUS.MANAGEMENT_AUTHORIZED,
    'management authorised': REQUISITION_STATUS.MANAGEMENT_AUTHORIZED,
    approved: REQUISITION_STATUS.APPROVED,
    rejected: REQUISITION_STATUS.REJECTED,
    posted: REQUISITION_STATUS.POSTED,
    paid: REQUISITION_STATUS.POSTED,
    processed: REQUISITION_STATUS.POSTED
  })[status] || clean(record.Status);
}

export function requisitionCapabilities(user = {}) {
  const role = clean(user.assignedRole || user.AssignedRole || user.role || user.Role || user.UserRole);
  return {
    canConfirmRequisitions: role === 'Accounts Officer',
    canReviewRequisitions: role === 'Admin',
    canApproveRequisitions: ['Director', 'Super Admin'].includes(role) || hasPrincipalApprovalGrant(user),
    canPostRequisitions: role === 'Accounts Officer'
  };
}

// This is an approval grant, not accounting or payment-posting authority.
// Callers supply the server-resolved staff identity, never request-body grants.
export function hasPrincipalApprovalGrant(user = {}) {
  return clean(user.assignedRole || user.AssignedRole || user.role || user.Role) === 'Principal'
    && user.approvalEnabled === true;
}

export function assertPrincipalApprovalScope(user, record) {
  const value = record.SettlementId ? Number(record.AmountCents) / 100 : Number(record.Amount);
  const maximum = Number(user.approvalMaxAmount);
  const accounts = Array.isArray(user.approvalAccounts) ? user.approvalAccounts.map(lower) : [];
  const required = record.SettlementId
    ? [record.PayableAccount, ...(record.Allocations || []).map(row => row.PayableAccount || record.PayableAccount)]
    : [record.ExpenseAccount];
  if (!hasPrincipalApprovalGrant(user) || !Number.isFinite(value) || value <= 0
      || !Number.isFinite(maximum) || maximum <= 0 || value > maximum) {
    throw Object.assign(new Error('This request exceeds your financial document approval amount limit.'), { status: 403 });
  }
  if (required.some(code => !clean(code) || !accounts.includes(lower(code)))) {
    throw Object.assign(new Error('This request uses an account code outside your financial document approval permission.'), { status: 403 });
  }
}

export function requisitionPendingTransition(record = {}) {
  const status = requisitionWorkflowStatus(record);
  if (!record.ApprovalFlow || !['Submitted', 'Accounts Confirmed', 'Admin Reviewed', 'Management Authorized'].includes(status)) {
    return TRANSITIONS[status] || null;
  }
  const stages = validateApprovalStages(record.ApprovalFlow.Stages);
  const completed = { Submitted: -1, 'Accounts Confirmed': 0, 'Admin Reviewed': 1, 'Management Authorized': 1 }[status];
  const stage = APPROVAL_STAGES.find((s, index) => index > completed && stages.includes(s.id));
  if (!stage) throw Object.assign(new Error('The saved approval path does not match this request. Contact an administrator.'), { status: 409 });
  const original = Object.values(TRANSITIONS).find(t => t.stage === stage.id);
  const final = stages.at(-1) === stage.id;
  return { ...original, nextStatus: final ? 'Approved' : original.nextStatus,
    event: final ? 'Approved' : original.event };
}

export const APPROVAL_STAGES = Object.freeze([
  { id: 'accounts', label: 'Accounts confirmation' },
  { id: 'admin-review', label: 'Admin review' },
  { id: 'director', label: 'Final approval (Director / Super Admin / authorised Principal)' }
]);

export function validateApprovalStages(stages) {
  const ordered = APPROVAL_STAGES.map(s => s.id);
  if (!Array.isArray(stages) || !stages.length || stages.some(s => !ordered.includes(s)) || new Set(stages).size !== stages.length) {
    throw Object.assign(new Error('Select at least one valid approval stage for each request type.'), { status: 400 });
  }
  return ordered.filter(s => stages.includes(s));
}

export function approvalFlowLabel(record = {}) {
  const stages = record.ApprovalFlow ? validateApprovalStages(record.ApprovalFlow.Stages) : APPROVAL_STAGES.map(s => s.id);
  return [...APPROVAL_STAGES.filter(s => stages.includes(s.id)).map(s => s.label), 'Accounts records payment'].join(' → ');
}

export function withApprovalRoute(record) {
  const pending = requisitionPendingTransition(record);
  return { ...record, PendingApproval: pending?.stage === 'director'
    ? { ...pending, role: 'Director, Super Admin or authorised Principal' } : pending, ApprovalFlowLabel: approvalFlowLabel(record) };
}

export function assertRequisitionTransition(record = {}, userRole = '', requestedStatus = '') {
  const currentStatus = requisitionWorkflowStatus(record);
  const transition = requisitionPendingTransition(record);
  const user = typeof userRole === 'object' && userRole !== null ? userRole : { role: userRole };
  const role = clean(user.assignedRole || user.role);
  const nextStatus = requisitionWorkflowStatus({
    Status: requestedStatus,
    AdminReviewedAt: lower(requestedStatus) === 'approved' ? 'pending' : ''
  });

  if (!transition) {
    const err = new Error(`A requisition in ${currentStatus || 'an unknown state'} cannot be advanced.`);
    err.status = 409;
    err.code = 'REQUISITION_STAGE_COMPLETE';
    throw err;
  }
  const delegated = transition.stage === 'director' && hasPrincipalApprovalGrant(user);
  if (!(transition.roles || [transition.role]).includes(role) && !delegated) {
    const err = new Error(`Only ${transition.role} can ${transition.verb} a requisition at the ${currentStatus} stage.`);
    err.status = 403;
    err.code = 'REQUISITION_STAGE_ROLE_REQUIRED';
    throw err;
  }
  if (delegated) assertPrincipalApprovalScope(user, record);
  if (nextStatus === REQUISITION_STATUS.REJECTED) {
    if (currentStatus === REQUISITION_STATUS.APPROVED) {
      const err = new Error('An approved requisition must be posted and paid by Accounts; it can no longer be rejected in this workflow.');
      err.status = 409;
      err.code = 'REQUISITION_ALREADY_APPROVED';
      throw err;
    }
    return { ...transition, currentStatus, nextStatus, event: 'Rejected' };
  }
  if (nextStatus !== transition.nextStatus) {
    const err = new Error(`${currentStatus} must move to ${transition.nextStatus}; requisition stages cannot be skipped or reordered.`);
    err.status = 409;
    err.code = 'REQUISITION_STAGE_ORDER_REQUIRED';
    throw err;
  }
  return { ...transition, currentStatus, nextStatus };
}
