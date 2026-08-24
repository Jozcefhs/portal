import { requireFirestoreEnv } from '../lib/firestore.js';
import { readStaffAttendanceProof, readStaffSession, requireStaffSession } from '../lib/staff-auth.js';
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
    const body = await readJsonBody(context.request, { maxBytes: 128 * 1024 });
    const action = clean(body.action || body.Action || 'list').toLowerCase();
    const user = action === 'presencequick'
      ? await readStaffSession(context.env, context.request)
      : await requireStaffSession(context.env, context.request);
    if (!user) {
      const error = new Error('Your staff session has expired. Please sign in again.');
      error.status = 401;
      throw error;
    }
    const personalClockingActions = new Set(['quick', 'presencequick', 'clock', 'presence']);
    if (!personalClockingActions.has(action) && !(user.allowedSections || []).includes('staffAttendance')) {
      return Response.json({ ok: false, message: 'Staff attendance administration is not available to this account.' }, { status: 403 });
    }
    if (action === 'savesite' && ['yes', 'true', '1', 'on'].includes(clean(body.UseCurrentNetwork).toLowerCase())) {
      body.AllowedPublicIps = [
        ...new Set([
          ...clean(body.AllowedPublicIps).split(/[\s,]+/).filter(Boolean),
          requestIp(context.request)
        ].filter(Boolean))
      ];
    }
    if (!['list', 'quick', 'presencequick', 'storagestatus'].includes(action)) {
      idempotency = await beginIdempotentRequest(context.env, context.request, body, {
        scope: `staff-attendance-${action}`,
        actor: user.username,
        ttlMinutes: 30 * 24 * 60
      });
      if (idempotency.replay) {
        return Response.json(idempotency.response, { status: idempotency.status || 200, headers: { 'Cache-Control': 'no-store' } });
      }
    }
    const proofDirection = action === 'presence' ? 'CHECK' : clean(body.Direction).toUpperCase();
    const identityProof = ['clock', 'presence'].includes(action)
      ? await readStaffAttendanceProof(context.env, body.AttendanceProof, user.username, {
        siteId: body.SiteId,
        direction: proofDirection
      })
      : null;
    const result = await handleStaffAttendanceAction(context.env, user, body, {
      clientIp: requestIp(context.request),
      identityProof
    });
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
