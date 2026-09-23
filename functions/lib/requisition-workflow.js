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
    role: 'Management',
    nextStatus: REQUISITION_STATUS.MANAGEMENT_AUTHORIZED,
    event: 'Authorized',
    stage: 'management',
    verb: 'authorize'
  }),
  [REQUISITION_STATUS.MANAGEMENT_AUTHORIZED]: Object.freeze({
    role: 'Super Admin',
    nextStatus: REQUISITION_STATUS.APPROVED,
    event: 'Approved',
    stage: 'admin',
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
  if (status === 'approved' && !clean(record.AdminReviewedAt)) {
    // Records approved under the previous workflow still require the new
    // administrative approval before Accounts may post or pay them.
    return REQUISITION_STATUS.MANAGEMENT_AUTHORIZED;
  }
  return ({
    draft: REQUISITION_STATUS.DRAFT,
    submitted: REQUISITION_STATUS.SUBMITTED,
    confirmed: REQUISITION_STATUS.ACCOUNTS_CONFIRMED,
    'accounts confirmed': REQUISITION_STATUS.ACCOUNTS_CONFIRMED,
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
  const role = clean(user.role || user.Role || user.UserRole);
  return {
    canConfirmRequisitions: role === 'Accounts Officer',
    canAuthorizeRequisitions: role === 'Management',
    canApproveRequisitions: role === 'Super Admin',
    canPostRequisitions: role === 'Accounts Officer'
  };
}

export function requisitionPendingTransition(record = {}) {
  return TRANSITIONS[requisitionWorkflowStatus(record)] || null;
}

export function assertRequisitionTransition(record = {}, userRole = '', requestedStatus = '') {
  const currentStatus = requisitionWorkflowStatus(record);
  const transition = TRANSITIONS[currentStatus];
  const role = clean(userRole);
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
  if (role !== transition.role) {
    const err = new Error(`Only ${transition.role} can ${transition.verb} a requisition at the ${currentStatus} stage.`);
    err.status = 403;
    err.code = 'REQUISITION_STAGE_ROLE_REQUIRED';
    throw err;
  }
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
