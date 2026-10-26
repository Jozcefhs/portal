import { requireStaffSession } from '../lib/staff-auth.js';
import { academicWebActor } from '../lib/academic-management.js';
import { readJsonBody } from '../lib/request-security.js';
import { createPortalCbtService } from '../lib/portal-cbt.js';

export async function onRequestPost({ request, env }) {
  try {
    const origin = request.headers.get('Origin');
    if (origin && origin !== new URL(request.url).origin) throw Object.assign(new Error('Cross-site exam requests are not allowed.'), { status: 403 });
    const user = academicWebActor(await requireStaffSession(env, request));
    const body = await readJsonBody(request, { maxBytes: 48 * 1024 * 1024 });
    if (!['state', 'options', 'assessment', 'uploadOptions', 'uploadedTests', 'useUploadedTest', 'updateSchedule', 'create', 'details', 'enroll', 'schedule', 'cards', 'paperPage', 'review', 'approve', 'post'].includes(body.action)) throw Object.assign(new Error('Choose a valid examination action.'), { status: 400 });
    const result = await createPortalCbtService(env, user)[body.action](body);
    return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return Response.json({ ok: false, message: error.message || 'The examination operation did not complete.' }, { status: Number(error.status || 500), headers: { 'Cache-Control': 'private, no-store' } });
  }
}
