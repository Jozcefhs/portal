import { requireFirestoreEnv } from '../lib/firestore.js';
import { consumeRequestAllowance, readJsonBody, tooManyRequests } from '../lib/request-security.js';
import { guestHotelCollection } from '../lib/hotel-self-service.js';

export async function onRequestPost({ env, request }) {
  try {
    requireFirestoreEnv(env);
    const allowance = await consumeRequestAllowance(env, request, { scope: 'hotel-guest-code', maximum: 30, windowSeconds: 900 });
    if (!allowance.allowed) return tooManyRequests('Too many requests. Please wait before trying again.', allowance.retryAfter);
    const body = await readJsonBody(request, { maxBytes: 4096 });
    return Response.json(await guestHotelCollection(env, body), { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  } catch (error) {
    return Response.json({ ok: false, message: error.status < 500 ? error.message : 'Key collection is temporarily unavailable. Contact reception.' }, { status: error.status || 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
