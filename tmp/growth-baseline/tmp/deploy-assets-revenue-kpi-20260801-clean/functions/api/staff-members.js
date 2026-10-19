import { requireFirestoreEnv } from '../lib/firestore.js';
import { handleChurchMembershipAction } from '../lib/church-membership.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { readJsonBody } from '../lib/request-security.js';

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    if (!(user.allowedSections || []).includes('members')) {
      const error = new Error('This staff account is not allowed to manage church members.');
      error.status = 403;
      throw error;
    }
    const body = await readJsonBody(request, { maxBytes: 2 * 1024 * 1024 });
    return Response.json(await handleChurchMembershipAction(env, user, body), {
      headers: { 'Cache-Control': 'no-store' }
    });
  } catch (error) {
    return Response.json({ ok: false, message: error.message || String(error) }, {
      status: error.status || 500,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}
