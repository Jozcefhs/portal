import { requireFirestoreEnv } from '../lib/firestore.js';
import { handleHotelAction } from '../lib/hotel-services.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { readJsonBody } from '../lib/request-security.js';

function response(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' }
  });
}

export async function onRequestGet(context) {
  try {
    const { request, env } = context;
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    if (!(user.allowedSections || []).includes('hotel')) {
      const error = new Error('This staff account is not allowed to use Hotel Services.');
      error.status = 403;
      throw error;
    }
    return response(await handleHotelAction(env, user, { action: 'list' }));
  } catch (error) {
    return response({ ok: false, message: error.message || String(error) }, error.status || 500);
  }
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    if (!(user.allowedSections || []).includes('hotel')) {
      const error = new Error('This staff account is not allowed to use Hotel Services.');
      error.status = 403;
      throw error;
    }
    if (user.subscriptionReadOnly) {
      const error = new Error('The subscription is read-only. Renew it before changing hotel records.');
      error.status = 403;
      throw error;
    }
    const body = await readJsonBody(request, { maxBytes: 256 * 1024 });
    return response(await handleHotelAction(env, user, body));
  } catch (error) {
    return response({ ok: false, message: error.message || String(error) }, error.status || 500);
  }
}
