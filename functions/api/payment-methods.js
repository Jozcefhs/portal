import { publicPaymentMethods } from '../lib/direct-bank-transfer.js';
import { requireFirestoreEnv } from '../lib/firestore.js';

const clean = (value) => String(value ?? '').trim();

export async function onRequestGet(context) {
  try {
    requireFirestoreEnv(context.env);
    const url = new URL(context.request.url);
    const branchId = clean(url.searchParams.get('branch') || 'main').toLowerCase();
    const methods = await publicPaymentMethods(context.env, branchId);
    return Response.json({ ok: true, methods }, { headers: { 'Cache-Control': 'public, max-age=30', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) {
    return Response.json({ ok: false, message: error.message || String(error) }, { status: error.status || 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
