import { requireStaffSession } from '../lib/staff-auth.js';
import { readJsonBody } from '../lib/request-security.js';
import { handleSchoolFeePaymentPlans } from '../lib/school-fee-payment-plans.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const user = await requireStaffSession(env, request);
    const body = await readJsonBody(request, { maxBytes: 8192 });
    const result = await handleSchoolFeePaymentPlans(env, user, body);
    if (context.data) {
      context.data.securityAuditActor = user;
      context.data.securityAuditHandled = true;
      if (body.action === 'list' || result.changed === false) context.data.securityAuditNoChange = true;
    }
    return Response.json(result, { headers });
  } catch (error) {
    return Response.json({ ok: false, message: Number(error.status || 500) >= 500
      ? 'The part-payment plan could not be confirmed. Reload its settings before retrying.' : error.message },
    { status: Number(error.status || 500), headers });
  }
}
