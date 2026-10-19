import { requireFirestoreEnv } from '../lib/firestore.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { readJsonBody } from '../lib/request-security.js';
import { getClubMembersPage } from '../lib/club-members.js';

export async function onRequestPost({ env, request }) {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    const body = await readJsonBody(request, { maxBytes: 16 * 1024 });
    return Response.json(await getClubMembersPage(env, user, body), { headers });
  } catch (error) {
    const status = Number(error.status || 500);
    return Response.json({ ok: false, message: status >= 500 ? 'The complete club register could not be loaded. Try again.' : error.message }, { status, headers });
  }
}
