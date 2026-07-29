import { requireFirestoreEnv } from '../lib/firestore.js';
import { initChurchDonationPayment } from '../lib/church-payments.js';
import { requireStaffSession } from '../lib/staff-auth.js';

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
    return Response.json(await initChurchDonationPayment(env, user, body, new URL(request.url).origin), {
      headers: { 'Cache-Control': 'no-store' }
    });
  } catch (error) {
    return Response.json(
      { ok: false, message: error.message || String(error) },
      { status: error.status || 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}