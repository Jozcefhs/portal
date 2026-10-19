import { publicPlatformPaymentMethods } from '../lib/platform-direct-bank-transfer.js';

export async function onRequestGet({ env }) {
  try {
    const methods = await publicPlatformPaymentMethods(env);
    return Response.json({ ok: true, methods }, {
      headers: { 'Cache-Control': 'public, max-age=30', 'X-Content-Type-Options': 'nosniff' }
    });
  } catch (error) {
    return Response.json({ ok: false, message: error.message || String(error) }, {
      status: error.status || 500,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}
