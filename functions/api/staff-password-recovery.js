import { requireFirestoreEnv } from '../lib/firestore.js';
import { consumeRequestAllowance, readJsonBody } from '../lib/request-security.js';
import { requestStaffPasswordRecovery, resetStaffPassword, RECOVERY_REQUEST_MESSAGE } from '../lib/staff-password-recovery.js';

const reply = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });

export async function onRequestPost(context) {
  try {
    const { env, request } = context;
    const origin = request.headers.get('Origin');
    if ((origin && origin !== new URL(request.url).origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
      return reply({ ok: false, message: 'Open password recovery from your organisation’s staff sign-in page.' }, 403);
    }
    if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
      return reply({ ok: false, message: 'A JSON request is required.' }, 415);
    }
    requireFirestoreEnv(env);
    const body = await readJsonBody(request, { maxBytes: 4096 });
    const action = String(body.action || 'request');
    if (!['request', 'reset'].includes(action)) return reply({ ok: false, message: 'Unsupported recovery action.' }, 400);
    const allowance = await consumeRequestAllowance(env, request, { scope: `staff-password-recovery-${action}`, maximum: action === 'request' ? 8 : 20, windowSeconds: 900 });
    if (!allowance.allowed) return reply({ ok: false, message: 'Too many recovery attempts. Please wait 15 minutes before trying again.' }, 429);
    if (action === 'request') {
      const username = typeof body.username === 'string' ? body.username.trim() : '';
      if (!username || username.length > 160) return reply({ ok: false, message: 'Enter your staff login username.' }, 400);
      context.waitUntil(requestStaffPasswordRecovery(env, username).catch(() => {
        // Never log codes, passwords, email addresses or provider response bodies.
        console.error(JSON.stringify({ event: 'staff_password_recovery_delivery_failed' }));
      }));
      return reply({ ok: true, message: RECOVERY_REQUEST_MESSAGE });
    }
    await resetStaffPassword(env, body.code, body.password);
    return reply({ ok: true, message: 'Password reset. Sign in with your new password. Your normal two-factor checks still apply.' });
  } catch (error) {
    const status = [400, 413, 429].includes(Number(error.status)) ? Number(error.status) : 503;
    return reply({ ok: false, message: status === 400 ? error.message : status === 429
      ? 'Too many recovery attempts. Please wait 15 minutes before trying again.'
      : 'Recovery could not be confirmed. If you submitted a reset, try signing in with the new password first. Otherwise try again later or contact your administrator.' }, status);
  }
}
