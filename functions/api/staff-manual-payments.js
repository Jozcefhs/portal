import { requireFirestoreEnv } from '../lib/firestore.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { readJsonBody } from '../lib/request-security.js';
import { handleWebManualPayment } from '../lib/web-manual-payments.js';

export async function onRequestPost(context) {
  const { request, env } = context, headers = { 'Cache-Control': 'no-store' };
  try {
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    const body = await readJsonBody(request, { maxBytes: 16 * 1024 });
    context.data ||= {};
    context.data.securityAuditActor = user;
    const result = await handleWebManualPayment(env, user, body);
    if (body.action === 'post') {
      context.data.securityAuditAction = result.code === 'WALLET_DUPLICATE_REVIEW_REQUIRED' ? 'Review possible duplicate wallet top-up'
        : result.duplicate ? 'Check previously recorded manual payment' : 'Record manual payment';
    }
    return Response.json(result, { headers });
  } catch (error) {
    const status = Number(error.status || 500);
    return Response.json({ ok: false, message: status >= 500
      ? 'The payment service could not confirm completion. Keep this form open and retry the same payment reference before starting another.'
      : error.message }, { status, headers });
  }
}

export function onRequestGet() {
  return Response.json({ ok: false, message: 'Manual payments require an authenticated POST request.' },
    { status: 405, headers: { 'Cache-Control': 'no-store', Allow: 'POST' } });
}
