import { requiredDeploymentIdentity } from '../lib/deployment-identity.js';
import { requireFirestoreEnv } from '../lib/firestore.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { readJsonBody } from '../lib/request-security.js';
import { handleTeacherHomework } from '../lib/teacher-homework.js';

export async function onRequestPost({ env, request }) {
  try {
    if (requiredDeploymentIdentity(env).edition !== 'school') return Response.json({ ok: false, message: 'Homework is available only in the School edition.' }, { status: 404 });
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    const input = await readJsonBody(request, { maxBytes: 16 * 1024 });
    return Response.json(await handleTeacherHomework(env, user, input), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return Response.json({ ok: false, message: error?.status && Number(error.status) < 500 ? error.message : 'Homework could not be processed. Please retry.' }, {
      status: Number(error?.status || 500), headers: { 'Cache-Control': 'private, no-store' }
    });
  }
}
