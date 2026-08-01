import { requireFirestoreEnv } from '../lib/firestore.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import {
  loadStaffApprovalProfile,
  publicStaffApprovalProfile,
  saveStaffApprovalProfile
} from '../lib/staff-approval-profile.js';
import { readJsonBody } from '../lib/request-security.js';

function response(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function onRequestGet({ request, env }) {
  try {
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    const profile = await loadStaffApprovalProfile(env, user.username);
    return response({ ok: true, profile: publicStaffApprovalProfile(profile || {}) });
  } catch (error) {
    return response({ ok: false, message: error.message || String(error) }, error.status || 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    const body = await readJsonBody(request, { maxBytes: 1024 * 1024 });
    const profile = await saveStaffApprovalProfile(env, user, body);
    return response({ ok: true, message: 'Approval signature and stamp settings saved.', profile });
  } catch (error) {
    return response({ ok: false, message: error.message || String(error) }, error.status || 500);
  }
}
