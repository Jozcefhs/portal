import { requireStaffSession } from '../lib/staff-auth.js';
import { readJsonBody } from '../lib/request-security.js';
import { handleTerminalPayments } from '../lib/paystack-terminals.js';

export async function onRequestPost({ env, request, data }) {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const user = await requireStaffSession(env, request);
    const body = await readJsonBody(request, { maxBytes: 8192 });
    const result = await handleTerminalPayments(env, user, body);
    // Checks/replays are not new financial actions. Posted payments carry an
    // atomic accounting audit; denied actions still reach security middleware.
    if (data && ['settings', 'get', 'history', 'verify'].includes(body.action)) data.securityAuditHandled = true;
    return Response.json(result, { headers });
  } catch (error) {
    const status = Number(error.status || 500);
    return Response.json({ ok: false, message: status >= 500
      ? 'This operation could not be confirmed. Resume this payment and check its status before starting another charge.' : error.message }, { status, headers });
  }
}
