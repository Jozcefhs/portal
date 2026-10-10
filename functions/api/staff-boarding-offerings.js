import { requireFirestoreEnv } from '../lib/firestore.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { readJsonBody } from '../lib/request-security.js';
import { handleBoardingOfferings } from '../lib/boarding-offerings.js';

export async function onRequestPost({ request, env }) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  try {
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    const body = await readJsonBody(request, { maxBytes: 256 * 1024 });
    return new Response(JSON.stringify(await handleBoardingOfferings(env, user, body)), { headers });
  } catch (error) {
    const status = Number(error.status || 500);
    return new Response(JSON.stringify({ ok: false, message: status >= 500
      ? 'Boarding offerings could not be processed. Reload the service to check completed deductions before retrying.' : error.message }), { status, headers });
  }
}
