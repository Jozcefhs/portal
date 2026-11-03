import { requireStaffSession } from '../lib/staff-auth.js';
import { academicWebActor } from '../lib/academic-management.js';
import { readJsonBody } from '../lib/request-security.js';
import { localCbtAnswerCopies } from '../lib/local-cbt-answer-copies.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    const origin = request.headers.get('Origin');
    if (origin && origin !== new URL(request.url).origin) throw Object.assign(new Error('Open answer review from the school portal.'), { status: 403 });
    const user = academicWebActor(await requireStaffSession(env, request));
    const body = await readJsonBody(request, { maxBytes: 4096 });
    if (!['list', 'review'].includes(body.action)) throw Object.assign(new Error('Choose an answer review action.'), { status: 400 });
    const result = await localCbtAnswerCopies(env, user)[body.action](body);
    if (context.data) context.data.securityAuditHandled = true; // Read-only list / preview.
    return Response.json(result, { headers });
  } catch (error) {
    return Response.json({ ok: false, message: error.message || 'Saved answers could not be loaded.' }, { status: error.status || 500, headers });
  }
}
