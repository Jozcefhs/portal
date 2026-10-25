import { requireStaffSession } from '../lib/staff-auth.js';
import { readJsonBody } from '../lib/request-security.js';
import { handleRevenueAccountNames } from '../lib/revenue-account-names.js';

export async function onRequestPost({ env, request }) {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const user = await requireStaffSession(env, request);
    const body = await readJsonBody(request, { maxBytes: 8192 });
    return Response.json(await handleRevenueAccountNames(env, user, body), { headers });
  } catch (error) {
    const status = Number(error.status || 500);
    return Response.json({ ok: false, message: status >= 500
      ? 'The account rename could not be confirmed. Reload accounts to check the current name before retrying.' : error.message }, { status, headers });
  }
}
