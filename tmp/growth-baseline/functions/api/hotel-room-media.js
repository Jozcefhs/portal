import { requireFirestoreEnv } from '../lib/firestore.js';
import { hotelRoomMediaResponse } from '../lib/hotel-self-service.js';

export async function onRequestGet({ env, request }) {
  try {
    requireFirestoreEnv(env);
    return await hotelRoomMediaResponse(env, request);
  } catch (error) {
    return Response.json({ ok: false, message: error.status < 500 ? error.message : 'Room media is unavailable.' }, { status: error.status || 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
