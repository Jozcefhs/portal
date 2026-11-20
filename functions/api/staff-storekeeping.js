import { requireStaffSession } from '../lib/staff-auth.js';
import { requireFirestoreEnv } from '../lib/firestore.js';
import { readProcurementJsonBody } from '../lib/procurement-item-import.js';
import { handleStorekeeping } from '../lib/storekeeping.js';

export async function onRequestPost({ request, env }) {
  const headers = { 'Content-Type':'application/json', 'Cache-Control':'no-store' };
  try {
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env,request);
    const result = await handleStorekeeping(env,user,await readProcurementJsonBody(request));
    return Response.json({ ...result,ok:true },{ headers });
  } catch (error) {
    const status = Number(error.status) || 500;
    return Response.json({ ok:false, message:status >= 500 ? 'Could not confirm this operation. Retry with the same handover reference.' : error.message },{ status,headers });
  }
}
