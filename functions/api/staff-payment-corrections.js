import { requireFirestoreEnv } from '../lib/firestore.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { readJsonBody } from '../lib/request-security.js';
import { handleManualPaymentCorrection } from '../lib/manual-payment-corrections.js';

export async function onRequestPost({ request, env }) {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    const body = await readJsonBody(request, { maxBytes: 16 * 1024 });
    return Response.json(await handleManualPaymentCorrection(env, user, body), { headers });
  } catch (error) {
    const status = Number(error.status || 500);
    return Response.json({ ok: false, message: status >= 500
      ? 'The correction could not be confirmed. Retry the same correction to check its status before starting another.' : error.message }, { status, headers });
  }
}
