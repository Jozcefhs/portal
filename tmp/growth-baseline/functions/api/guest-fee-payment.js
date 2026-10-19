import { requireFirestoreEnv } from '../lib/firestore.js';
import {
  issueGuestFeePaymentOtp,
  verifyGuestFeePaymentOtp
} from '../lib/guest-fee-payment.js';
import {
  consumeRequestAllowance,
  readJsonBody,
  tooManyRequests,
  verifyTurnstile
} from '../lib/request-security.js';

const clean = (value) => String(value ?? '').trim();

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    requireFirestoreEnv(env);
    const body = await readJsonBody(request, { maxBytes: 32 * 1024 });
    const action = clean(body.action).toLowerCase();
    if (action === 'requestotp') {
      await verifyTurnstile(env, request, body, 'guest_fee_otp_request');
      const allowance = await consumeRequestAllowance(env, request, {
        scope: 'guest-fee-otp-request', maximum: 5, windowSeconds: 15 * 60
      });
      if (!allowance.allowed) return tooManyRequests('Too many OTP requests. Please wait before trying again.', allowance.retryAfter);
      const result = await issueGuestFeePaymentOtp(env, body.admissionNumber || body.AdmissionNo);
      return Response.json({
        ok: true,
        message: `A payment OTP was sent to ${result.maskedParentEmail}. Ask the parent to forward it only if they approve this payment.`,
        ...result
      }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (action === 'verifyotp') {
      await verifyTurnstile(env, request, body, 'guest_fee_otp_verify');
      const allowance = await consumeRequestAllowance(env, request, {
        scope: 'guest-fee-otp-verify', maximum: 15, windowSeconds: 15 * 60
      });
      if (!allowance.allowed) return tooManyRequests('Too many OTP attempts. Please wait before trying again.', allowance.retryAfter);
      const result = await verifyGuestFeePaymentOtp(env, body.challengeId, body.otp);
      return Response.json({
        ok: true,
        message: 'Parent approval confirmed. You may now select and pay a fee.',
        guestPaymentToken: result.token,
        admissionNo: result.admissionNo,
        maskedParentEmail: result.maskedParentEmail,
        expiresAt: result.expiresAt,
        expiresInMinutes: result.expiresInMinutes
      }, { headers: { 'Cache-Control': 'no-store' } });
    }
    return Response.json({ ok: false, message: 'Unknown guest fee-payment action.' }, {
      status: 400,
      headers: { 'Cache-Control': 'no-store' }
    });
  } catch (error) {
    return Response.json({
      ok: false,
      code: clean(error?.code),
      message: error?.message || String(error)
    }, {
      status: Number(error?.status || 500),
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}
