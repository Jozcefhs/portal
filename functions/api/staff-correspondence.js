import { requireFirestoreEnv } from '../lib/firestore.js';
import {
  requireStaffSession,
  verifyStaffApprovalPassword
} from '../lib/staff-auth.js';
import { handleExecutiveOfficeAction } from '../lib/executive-correspondence.js';
import { readJsonBody } from '../lib/request-security.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();

function response(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }
  });
}

export async function onRequestPost({ request, env }) {
  try {
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    const body = await readJsonBody(request, { maxBytes: 2 * 1024 * 1024 });
    const action = lower(body.action || body.Action || 'bootstrap');
    let authorization = null;
    if (['issue', 'send'].includes(action)) {
      const password = clean(body.approvalPassword || body.ApprovalPassword);
      if (!password || !(await verifyStaffApprovalPassword(env, user.username, password))) {
        const error = new Error('Confirm this official action with your current password.');
        error.status = 403;
        throw error;
      }
      authorization = { method: 'Password', sourcePlatform: 'Web Executive Office' };
    }
    const data = await handleExecutiveOfficeAction(env, user, body, {
      authorization,
      sourcePlatform: 'Web Executive Office'
    });
    return response(data);
  } catch (error) {
    return response({ ok: false, message: error.message || String(error) }, error.status || 500);
  }
}

export async function onRequestGet() {
  return response({
    ok: false,
    message: 'Executive Office actions require an authenticated POST request.'
  }, 405);
}
