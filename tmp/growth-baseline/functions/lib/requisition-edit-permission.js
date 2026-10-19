const clean = (value) => String(value ?? '').trim();
const enabled = (value) => ['yes', 'true', '1', 'on', 'enabled'].includes(clean(value).toLowerCase());

export function requisitionEditRole(user = {}) {
  return clean(user.assignedRole || user.AssignedRole || user.UserAssignedRole || user.role || user.Role || user.UserRole);
}

export function isRequisitionEditAdministrator(user = {}) {
  // Director has the same administrator authority as Super Admin throughout the platform.
  return ['Super Admin', 'Director'].includes(requisitionEditRole(user));
}

export function requisitionEditEligible(user = {}) {
  return isRequisitionEditAdministrator(user)
    || ['Accounts Officer', 'Admin', 'Management'].includes(requisitionEditRole(user))
    || enabled(user.ApprovalEnabled ?? user.approvalEnabled);
}

export function requisitionEditGrant(value, user = {}) {
  return enabled(value) && requisitionEditEligible(user);
}

export function canEditRequisitions(user = {}) {
  return isRequisitionEditAdministrator(user)
    || requisitionEditGrant(user.RequisitionEditEnabled ?? user.requisitionEditEnabled ?? user.UserRequisitionEditEnabled, user);
}

export function assertRequisitionEditPermission(user = {}) {
  if (canEditRequisitions(user)) return;
  const error = new Error('Super Admin has not granted you permission to edit and resubmit requisitions.');
  error.status = 403;
  error.code = 'REQUISITION_EDIT_PERMISSION_REQUIRED';
  throw error;
}

export function requisitionEditPermissionAuditWrite(before = {}, after = {}, actor = {}) {
  const granted = canEditRequisitions(after);
  if (canEditRequisitions(before) === granted) return null;
  const id = `REQ-EDIT-${crypto.randomUUID()}`;
  return {
    collectionPath: 'staffSecurityAudit', documentId: id,
    data: {
      AuditId: id, Timestamp: new Date().toISOString(),
      Action: granted ? 'GRANT REQUISITION EDIT ACCESS' : 'REVOKE REQUISITION EDIT ACCESS',
      Username: clean(after.Username || after.username),
      Actor: clean(actor.displayName || actor.username), ActorUsername: clean(actor.username),
      BranchId: clean(after.BranchId || actor.branchId) || 'main',
      SourcePlatform: clean(actor.sourcePlatform) || 'Web',
      Details: `Officer: ${clean(after.DisplayName || after.Username)}; role: ${requisitionEditRole(after)}; `
        + (granted && isRequisitionEditAdministrator(after)
          ? 'administrator requisition-edit authority'
          : `individual requisition-edit permission ${granted ? 'granted' : 'revoked'}`)
    }
  };
}
