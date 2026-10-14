import { requireFirestoreEnv } from '../lib/firestore.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { readJsonBody } from '../lib/request-security.js';
import { handleManualPaymentCorrection } from '../lib/manual-payment-corrections.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const headers = { 'Cache-Control': 'no-store' };
  try {
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    const body = await readJsonBody(request, { maxBytes: 16 * 1024 });
    const result = await handleManualPaymentCorrection(env, user, body);
    context.data ||= {};
    context.data.securityAuditActor = user;
    if (body.action === 'post' && result.ok) {
      context.data.securityAuditHandled = !result.replayed;
      if (result.replayed) {
        context.data.securityAuditAction = 'Check previously posted manual payment correction';
        context.data.securityAuditSummary = 'The earlier correction was found. This retry did not change any balance again.';
      }
    }
    return Response.json(result, { headers });
  } catch (error) {
    const status = Number(error.status || 500);
    return Response.json({ ok: false, message: status >= 500
      ? 'The correction could not be confirmed. Retry the same correction to check its status before starting another.' : error.message }, { status, headers });
  }
}
