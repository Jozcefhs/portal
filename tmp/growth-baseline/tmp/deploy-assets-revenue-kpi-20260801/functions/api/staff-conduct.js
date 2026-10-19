import { requireFirestoreEnv } from '../lib/firestore.js';
import { readJsonBody } from '../lib/request-security.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { handleStudentConductAction } from '../lib/student-conduct.js';

export async function onRequestPost({ request, env }) {
  try {
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    const body = await readJsonBody(request, { maxBytes: 160 * 1024 });
    const result = await handleStudentConductAction(env, user, body);
    return Response.json(result, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }
    });
  } catch (failure) {
    return Response.json({ ok: false, message: failure.message || String(failure) }, {
      status: failure.status || 500,
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }
    });
  }
}

