import { requireFirestoreEnv } from '../lib/firestore.js';
import { readJsonBody } from '../lib/request-security.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { handleProcurementAction } from '../lib/procurement.js';

export async function onRequestPost({ request, env }) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  try {
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    const body = await readJsonBody(request, { maxBytes: 64 * 1024 });
    return new Response(JSON.stringify(await handleProcurementAction(env, user, body)), { headers });
  } catch (error) {
    const status = Number(error.status || 500);
    return new Response(JSON.stringify({ ok: false, message: status >= 500 ? 'Procurement could not be completed. Retry the same entries or refresh to check the records.' : error.message,
      code: error.code || 'PROCUREMENT_ERROR' }), { status, headers });
  }
}
