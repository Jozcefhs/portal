import { requireFirestoreEnv } from '../lib/firestore.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { handleOrganizationDepartmentAction } from '../lib/organization-departments.js';

export async function onRequestPost({ request, env }) {
  try {
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    const body = await request.json().catch(() => ({}));
    return Response.json(await handleOrganizationDepartmentAction(env, user, body), {
      headers: { 'Cache-Control': 'no-store' }
    });
  } catch (error) {
    return Response.json({ ok: false, message: error.message || String(error) }, {
      status: error.status || 500,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}
