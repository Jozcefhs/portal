// fullAccessModules is resolved from saved role/account grants by staff-auth.
// Menu access alone never grants management rights (e.g. My Payroll or teachers).
export function hasFullModuleAccess(user = {}, module) {
  return user.subscriptionActive !== false
    && Array.isArray(user.allowedSections) && Array.isArray(user.fullAccessModules)
    && (Array.isArray(module) ? module : [module]).some(key => user.allowedSections.includes(key) && user.fullAccessModules.includes(key));
}

// Use only for permission decisions. Keep the real role on the actor for audit,
// branch/section boundaries, identities and approval separation checks.
export function modulePermissionRole(user = {}, module) {
  return hasFullModuleAccess(user, module) ? 'Super Admin'
    : String(user.assignedRole || user.AssignedRole || user.role || user.Role || user.UserRole || '').trim();
}
