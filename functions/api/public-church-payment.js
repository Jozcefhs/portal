import { requireFirestoreEnv } from '../lib/firestore.js';
import { initPublicChurchDonationPayment } from '../lib/church-payments.js';
import {
  beginIdempotentRequest,
  completeIdempotentRequest,
  consumeRequestAllowance,
  failIdempotentRequest,
  readJsonBody,
  tooManyRequests,
  verifyTurnstile
} from '../lib/request-security.js';

function clean(value) {
  return String(value ?? '').trim();
}

export async function onRequestPost(context) {
  let idempotency = null;
  try {
    const { request, env } = context;
    requireFirestoreEnv(env);
    const body = await readJsonBody(request, { maxBytes: 32 * 1024 });
    await verifyTurnstile(env, request, body, 'church_giving');
    const allowance = await consumeRequestAllowance(env, request, {
      scope: 'public-church-giving',
      maximum: 10,
      windowSeconds: 15 * 60
    });
    if (!allowance.allowed) return tooManyRequests('Too many giving requests. Please wait and try again.', allowance.retryAfter);
    idempotency = await beginIdempotentRequest(env, request, body, {
      scope: 'public-church-giving',
      actor: clean(body.DonorEmail || body.donorEmail).toLowerCase(),
      ttlMinutes: 2 * 24 * 60
    });
    if (!idempotency.enabled) {
      const error = new Error('A secure request identifier is required. Refresh the page and try again.');
      error.status = 400;
      throw error;
    }
    if (idempotency.replay) {
      return Response.json(idempotency.response, {
        status: idempotency.status || (idempotency.response?.ok === false ? 409 : 200),
        headers: { 'Cache-Control': 'no-store', 'Idempotency-Replayed': 'true' }
      });
    }
    const result = await initPublicChurchDonationPayment(env, body, new URL(request.url).origin);
    await completeIdempotentRequest(env, idempotency, result, 200);
    return Response.json(result, {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
        'X-Content-Type-Options': 'nosniff'
      }
    });
  } catch (error) {
    if (idempotency?.owner) await failIdempotentRequest(context.env, idempotency, error);
    return Response.json({ ok: false, message: error.message || String(error) }, {
      status: error.status || 500,
      headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
    });
  }
}
