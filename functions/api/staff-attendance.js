import { requireFirestoreEnv } from '../lib/firestore.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { handleStaffAttendanceAction } from '../lib/staff-time-attendance.js';
import {
  beginIdempotentRequest,
  completeIdempotentRequest,
  failIdempotentRequest,
  readJsonBody
} from '../lib/request-security.js';

const clean = (value) => String(value ?? '').trim();

function requestIp(request) {
  return clean(request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')).split(',')[0];
}

export async function onRequestPost(context) {
  let idempotency = null;
  try {
    requireFirestoreEnv(context.env);
    const user = await requireStaffSession(context.env, context.request);
    if (!(user.allowedSections || []).includes('staffAttendance')) {
      return Response.json({ ok: false, message: 'Staff attendance is not available to this account.' }, { status: 403 });
    }
    const body = await readJsonBody(context.request, { maxBytes: 128 * 1024 });
    const action = clean(body.action || body.Action || 'list').toLowerCase();
    if (action === 'savesite' && ['yes', 'true', '1', 'on'].includes(clean(body.UseCurrentNetwork).toLowerCase())) {
      body.AllowedPublicIps = [
        ...new Set([
          ...clean(body.AllowedPublicIps).split(/[\s,]+/).filter(Boolean),
          requestIp(context.request)
        ].filter(Boolean))
      ];
    }
    if (action !== 'list') {
      idempotency = await beginIdempotentRequest(context.env, context.request, body, {
        scope: `church-staff-attendance-${action}`,
        actor: user.username,
        ttlMinutes: 30 * 24 * 60
      });
      if (idempotency.replay) {
        return Response.json(idempotency.response, { status: idempotency.status || 200, headers: { 'Cache-Control': 'no-store' } });
      }
    }
    const result = await handleStaffAttendanceAction(context.env, user, body, { clientIp: requestIp(context.request) });
    if (idempotency) await completeIdempotentRequest(context.env, idempotency, result, 200);
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (idempotency?.owner) await failIdempotentRequest(context.env, idempotency, error);
    return Response.json({ ok: false, message: error.message || String(error) }, {
      status: error.status || 500,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}
