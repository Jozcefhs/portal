import { requireFirestoreEnv } from '../lib/firestore.js';
import {
  getPublicHotelAvailability,
  initPublicHotelReservationPayment
} from '../lib/hotel-services.js';
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

function json(data, status = 200, cacheControl = 'no-store') {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': cacheControl,
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

export async function onRequestGet(context) {
  try {
    const { request, env } = context;
    requireFirestoreEnv(env);
    const url = new URL(request.url);
    const result = await getPublicHotelAvailability(env, {
      BranchId: url.searchParams.get('branch'),
      ArrivalDate: url.searchParams.get('arrival'),
      DepartureDate: url.searchParams.get('departure')
    });
    return json(result, 200, 'public, max-age=30');
  } catch (error) {
    return json({ ok: false, message: error.message || String(error) }, error.status || 500);
  }
}

export async function onRequestPost(context) {
  let idempotency = null;
  try {
    const { request, env } = context;
    requireFirestoreEnv(env);
    const body = await readJsonBody(request, { maxBytes: 256 * 1024 });
    await verifyTurnstile(env, request, body, 'hotel_booking');
    const allowance = await consumeRequestAllowance(env, request, {
      scope: 'public-hotel-booking',
      maximum: 8,
      windowSeconds: 15 * 60
    });
    if (!allowance.allowed) return tooManyRequests('Too many booking attempts. Please wait and try again.', allowance.retryAfter);
    idempotency = await beginIdempotentRequest(env, request, body, {
      scope: 'public-hotel-booking',
      actor: clean(body.GuestEmail || body.guestEmail).toLowerCase(),
      ttlMinutes: 2 * 24 * 60
    });
    if (!idempotency.enabled) {
      const error = new Error('A secure booking request identifier is required. Refresh the page and try again.');
      error.status = 400;
      throw error;
    }
    if (idempotency.replay) {
      return json(idempotency.response, idempotency.status || (idempotency.response?.ok === false ? 409 : 200));
    }
    const result = await initPublicHotelReservationPayment(env, body, new URL(request.url).origin);
    await completeIdempotentRequest(env, idempotency, result, 200);
    return json(result);
  } catch (error) {
    if (idempotency?.owner) await failIdempotentRequest(context.env, idempotency, error);
    return json({ ok: false, message: error.message || String(error) }, error.status || 500);
  }
}
