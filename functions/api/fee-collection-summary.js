import { requireFirestoreEnv } from '../lib/firestore.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { readJsonBody } from '../lib/request-security.js';
import { getFeeCollectionSummaryPage } from '../lib/fee-collection-summary.js';

export async function onRequestPost({ env, request }) {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    const body = await readJsonBody(request, { maxBytes: 16 * 1024 });
    return Response.json(await getFeeCollectionSummaryPage(env, user, body), { headers });
  } catch (error) {
    const status = Number(error.status || 500);
    return Response.json({ ok: false, message: status >= 500
      ? 'The complete fee summary could not be loaded. Try again; no partial totals have been shown.' : error.message }, { status, headers });
  }
}
