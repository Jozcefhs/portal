import { requireFirestoreEnv } from '../lib/firestore.js';
import { initChurchDonationPayment } from '../lib/church-payments.js';
import { handleChurchDonationAction } from '../lib/church-payments.js';
import { requireStaffSession } from '../lib/staff-auth.js';

function clean(value) {
  return String(value ?? '').trim();
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    if (!(user.allowedSections || []).includes('donations')) {
      const error = new Error('This staff account is not allowed to manage church donations.');
      error.status = 403;
      throw error;
    }

    const body = await request.json().catch(() => ({}));
    const action = clean(body.Action || body.action || '').toLowerCase();

    if (['init', 'initchurchpayment', 'initdonation', 'initpayment', 'sendpaystack'].includes(action)) {
      return Response.json(await initChurchDonationPayment(env, user, body, new URL(request.url).origin), {
        headers: { 'Cache-Control': 'no-store' }
      });
    }

    return Response.json(await handleChurchDonationAction(env, user, body), {
      headers: { 'Cache-Control': 'no-store' }
    });
  } catch (error) {
    return Response.json(
      { ok: false, message: error.message || String(error) },
      { status: error.status || 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}