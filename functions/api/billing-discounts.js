import { requireStaffSession } from '../lib/staff-auth.js';
import { readJsonBody } from '../lib/request-security.js';
import { handleBillingDiscounts } from '../lib/billing-category-discounts.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const user = await requireStaffSession(env, request);
    const body = await readJsonBody(request, { maxBytes: 8192 });
    const result = await handleBillingDiscounts(env, user, body);
    if (context.data) {
      context.data.securityAuditActor = user;
      if (body.action === 'list' || result.changed === false) context.data.securityAuditNoChange = true;
    }
    return Response.json(result, { headers });
  } catch (error) {
    return Response.json({ ok: false, message: Number(error.status || 500) >= 500
      ? 'The discount could not be confirmed. Reload its settings before retrying.' : error.message },
    { status: Number(error.status || 500), headers });
  }
}
