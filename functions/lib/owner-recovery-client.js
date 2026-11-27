import { signTenantControlRequest } from './tenant-control-plane.js';
import { assignedStaffBranches } from './staff-branch-access.js';

export function matchesFirstAdministrator(row, first) {
  // The local completion marker is best effort; the registry must confirm a consumed activation in either case.
  return Boolean(first?.ActivationId && ['Created', 'Completed'].includes(first.Status) && first.Username
    && row?.ActivationId === first.ActivationId && row.Username === first.Username
    && row.Role === 'Super Admin' && assignedStaffBranches(row) === null
    && !String(row.RecoveryEmail || '').trim());
}

export async function contactOwnerRegistry(env, identity, first, action) {
  const central = new URL('/api/tenant-owner-recovery', env.CANONICAL_PORTAL_URL);
  const portal = new URL(env.PUBLIC_PORTAL_URL);
  if (central.protocol !== 'https:' || portal.protocol !== 'https:' || central.origin === portal.origin) {
    throw new Error('Owner recovery registry is unavailable.');
  }
  const details = { action, workspaceId: identity.workspaceId, edition: identity.edition, portalHost: portal.hostname,
    activationId: first.ActivationId, founderUsername: first.Username, requestId: crypto.randomUUID(),
    issuedAt: new Date().toISOString() };
  const signature = await signTenantControlRequest(env.TENANT_CONTROL_PLANE_PRIVATE_KEY, details);
  const response = await fetch(central, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(25000),
    headers: { 'Content-Type': 'application/json', 'X-Dynamax-Tenant-Signature': signature },
    body: JSON.stringify(details) });
  if (!response.ok) throw new Error('The registered owner could not be confirmed.');
  const result = await response.json();
  if (result.ok !== true || !/^[a-f0-9]{64}$/.test(result.binding)) throw new Error('Owner binding unavailable.');
  return result;
}
