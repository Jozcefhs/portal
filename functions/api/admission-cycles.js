import { requireFirestoreEnv } from '../lib/firestore.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { readJsonBody } from '../lib/request-security.js';
import { createAdmissionCycleService, publicAdmissionPreview } from '../lib/admission-cycle.js';

export async function onRequestPost({ request, env }) {
  try {
    requireFirestoreEnv(env);
    const origin = request.headers.get('Origin');
    if (origin && origin !== new URL(request.url).origin) throw Object.assign(new Error('Cross-site admission-cycle requests are not allowed.'), { status: 403 });
    const user = await requireStaffSession(env, request);
    const body = await readJsonBody(request, { maxBytes: 16 * 1024 });
    const service = createAdmissionCycleService(env, user);
    const actions = { state: 'state', policy: 'savePolicy', preview: 'preview', close: 'close',
      cleanup: 'cleanup', backups: 'backups', download: 'download' };
    const action = Object.hasOwn(actions, body.action) ? actions[body.action] : '';
    if (!action) throw Object.assign(new Error('Choose a valid admission-cycle action.'), { status: 400 });
    const result = await service[action](body);
    if (result instanceof Response) return result;
    return Response.json(action === 'preview' ? publicAdmissionPreview(result) : result,
      { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return Response.json({ ok: false, message: error?.message || 'The admission cycle operation did not complete.' },
      { status: Number(error?.status || 500), headers: { 'Cache-Control': 'private, no-store' } });
  }
}
