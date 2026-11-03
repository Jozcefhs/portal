import { requireStaffSession } from '../lib/staff-auth.js';
import { readJsonBody } from '../lib/request-security.js';
import { handleBillingDiscounts } from '../lib/billing-category-discounts.js';

export async function onRequestPost({ env, request }) {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const user = await requireStaffSession(env, request);
    const body = await readJsonBody(request, { maxBytes: 8192 });
    return Response.json(await handleBillingDiscounts(env, user, body), { headers });
  } catch (error) {
    return Response.json({ ok: false, message: Number(error.status || 500) >= 500
      ? 'The discount could not be confirmed. Reload its settings before retrying.' : error.message },
    { status: Number(error.status || 500), headers });
  }
}
