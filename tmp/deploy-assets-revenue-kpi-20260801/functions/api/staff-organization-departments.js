import { requireFirestoreEnv } from '../lib/firestore.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { handleOrganizationDepartmentAction } from '../lib/organization-departments.js';
import { loadDeploymentIdentity } from '../lib/deployment-identity.js';
import { assertOrganizationDepartmentWorkspaceAccess } from '../lib/organization-department-gate.js';
import { readJsonBody } from '../lib/request-security.js';

export async function onRequestPost({ request, env }) {
  try {
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    const deploymentIdentity = await loadDeploymentIdentity(env);
    assertOrganizationDepartmentWorkspaceAccess(deploymentIdentity, user);
    const body = await readJsonBody(request, { maxBytes: 512 * 1024 });
    return Response.json(await handleOrganizationDepartmentAction(env, user, body), {
      headers: { 'Cache-Control': 'no-store' }
    });
  } catch (error) {
    return Response.json({
      ok: false,
      message: error.message || String(error),
      ...(error.code ? { code: error.code } : {})
    }, {
      status: error.status || 500,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}
