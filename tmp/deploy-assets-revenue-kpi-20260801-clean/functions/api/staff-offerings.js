import { requireFirestoreEnv } from '../lib/firestore.js';
import { handleChurchOfferingAction } from '../lib/church-offerings.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import {
  beginIdempotentRequest,
  completeIdempotentRequest,
  failIdempotentRequest,
  readJsonBody
} from '../lib/request-security.js';

export async function onRequestPost(context) {
  let idempotency = null;
  try {
    const { request, env } = context;
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    if (!(user.allowedSections || []).includes('offerings')) {
      const error = new Error('This staff account is not allowed to access church offerings.');
      error.status = 403;
      throw error;
    }
    const body = await readJsonBody(request, { maxBytes: 512 * 1024 });
    const action = String(body.Action || body.action || 'list').trim().toLowerCase();
    const isMutation = !['list', 'getchurchofferings'].includes(action);
    if (isMutation) {
      idempotency = await beginIdempotentRequest(env, request, body, {
        scope: `church-offering-${action || 'mutation'}`,
        actor: user.username,
        ttlMinutes: 30 * 24 * 60
      });
      if (idempotency.replay) {
        return Response.json(idempotency.response, {
          status: idempotency.status || (idempotency.response?.ok === false ? 409 : 200),
          headers: { 'Cache-Control': 'no-store', 'Idempotency-Replayed': 'true' }
        });
      }
    }
    const result = await handleChurchOfferingAction(env, user, body);
    if (isMutation) await completeIdempotentRequest(env, idempotency, result, 200);
    return Response.json(result, {
      headers: { 'Cache-Control': 'no-store' }
    });
  } catch (error) {
    if (idempotency?.owner) await failIdempotentRequest(context.env, idempotency, error);
    return Response.json({ ok: false, message: error.message || String(error) }, {
      status: error.status || 500,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}
