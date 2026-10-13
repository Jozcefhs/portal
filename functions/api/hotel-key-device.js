import { requireFirestoreEnv } from '../lib/firestore.js';
import { consumeRequestAllowance, readJsonBody, tooManyRequests } from '../lib/request-security.js';
import { authenticateHotelDevice, redeemHotelKey, confirmHotelKey } from '../lib/hotel-self-service.js';

export async function onRequestPost({ env, request }) {
  try {
    requireFirestoreEnv(env);
    const allowance = await consumeRequestAllowance(env, request, { scope: 'hotel-key-device', maximum: 120, windowSeconds: 60 });
    if (!allowance.allowed) return tooManyRequests('Too many device requests.', allowance.retryAfter);
    const body = await readJsonBody(request, { maxBytes: 4096 });
    const device = await authenticateHotelDevice(env, request, body.DeviceId);
    const result = body.Action === 'redeem' ? await redeemHotelKey(env, device, body)
      : body.Action === 'confirm' ? await confirmHotelKey(env, device, body)
      : { ok: false, message: 'Use redeem or confirm.' };
    return Response.json(result, { status: result.ok ? 200 : 400, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, message: error.status < 500 ? error.message : 'Device service unavailable. Do not actuate; contact reception.' }, { status: error.status || 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
