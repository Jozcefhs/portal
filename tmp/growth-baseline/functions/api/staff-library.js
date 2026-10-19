import { requireFirestoreEnv } from '../lib/firestore.js';
import { readJsonBody } from '../lib/request-security.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { handleSchoolLibraryAction } from '../lib/school-library.js';

export async function onRequestPost({ request, env }) {
  try {
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    const body = await readJsonBody(request, { maxBytes: 32 * 1024 });
    const result = await handleSchoolLibraryAction(env, user, body);
    return Response.json(result, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }
    });
  } catch (error) {
    return Response.json({ ok: false, message: error.message || String(error) }, {
      status: error.status || 500,
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }
    });
  }
}
