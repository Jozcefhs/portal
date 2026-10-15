import { requireStaffSession } from '../lib/staff-auth.js';
import { readJsonBody } from '../lib/request-security.js';
import { handleApprovalSettings } from '../lib/approval-settings.js';

export async function onRequestPost({ env, request }) {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const user = await requireStaffSession(env, request);
    const body = await readJsonBody(request, { maxBytes: 8192 });
    return Response.json(await handleApprovalSettings(env, user, body), { headers });
  } catch (error) {
    const status = Number(error.status || 500);
    return Response.json({ ok: false, message: status >= 500 ? 'Approval settings could not be processed. Reload and try again.' : error.message }, { status, headers });
  }
}
