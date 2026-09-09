import { secureTextEqual } from './backend-security.js';
import { readStaffSession, requireStaffSession } from './staff-auth.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();

export function resolveSetupSettingsAccess(actor = {}, requestedScope = '', requestedBranchId = '') {
  const assignedBranchId = actor.source === 'staff-session'
    ? clean(actor.assignedBranchId || actor.branchId || actor.BranchId)
    : '';
  const requested = lower(requestedScope);
  if (!['', 'organisation', 'organization', 'branch'].includes(requested)) {
    const error = new Error('Choose organisation defaults or selected branch overrides.');
    error.status = 400;
    throw error;
  }
  if (assignedBranchId) {
    const requestedBranch = clean(requestedBranchId);
    if (requestedBranch && lower(requestedBranch) !== lower(assignedBranchId)) {
      const error = new Error('This administrator is assigned to one branch and cannot change another branch or the organisation defaults.');
      error.status = 403;
      throw error;
    }
    return {
      scope: 'branch',
      branchId: assignedBranchId,
      scopeLocked: true
    };
  }
  return {
    scope: requested === 'branch' ? 'branch' : 'organisation',
    branchId: requested === 'branch' ? clean(requestedBranchId) : '',
    scopeLocked: false
  };
}

export async function requireSetupAdministrator(env, request, password = '') {
  const session = await readStaffSession(env, request).catch(() => null);
  if (session) {
    const staff = await requireStaffSession(env, request);
    if (clean(staff.role || staff.Role) !== 'Super Admin') {
      const error = new Error('Only a Super Administrator can open organisation or branch settings.');
      error.status = 403;
      throw error;
    }
    return { ...staff, source: 'staff-session' };
  }
  const expected = clean(env.ADMIN_WEB_PASSWORD);
  if (expected && secureTextEqual(password, expected)) {
    return {
      username: clean(env.ADMIN_WEB_USERNAME) || 'admin',
      displayName: clean(env.ADMIN_WEB_DISPLAY_NAME) || 'Setup Administrator',
      role: 'Super Admin',
      source: 'setup-password'
    };
  }
  if (!expected) {
    const error = new Error('Setup login is not configured. Add ADMIN_WEB_PASSWORD in Cloudflare.');
    error.status = 503;
    throw error;
  }
  const error = new Error('Invalid setup password or Super Administrator session.');
  error.status = 401;
  throw error;
}
