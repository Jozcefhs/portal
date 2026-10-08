import { requireFirestoreEnv } from '../lib/firestore.js';
import { readJsonBody } from '../lib/request-security.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { handleVendorSettlementAction } from '../lib/vendor-settlements.js';

export async function onRequestPost({ request, env }) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  try {
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    const body = await readJsonBody(request, { maxBytes: 64 * 1024 });
    return new Response(JSON.stringify(await handleVendorSettlementAction(env, user, body)), { headers });
  } catch (error) {
    const status = Number(error.status || 500);
    return new Response(JSON.stringify({ ok: false, message: status >= 500
      ? 'Vendor settlements could not be loaded. Please retry or contact support.' : error.message,
      code: error.code || 'VENDOR_SETTLEMENT_ERROR' }), { status, headers });
  }
}
