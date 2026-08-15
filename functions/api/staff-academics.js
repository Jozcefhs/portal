import { requiredDeploymentIdentity } from '../lib/deployment-identity.js';
import { requireFirestoreEnv } from '../lib/firestore.js';
import { handleAcademicManagementAction } from '../lib/academic-management.js';
import { finishRequestMetric, startRequestMetric } from '../lib/request-metrics.js';
import { readJsonBody } from '../lib/request-security.js';
import { requireStaffSession } from '../lib/staff-auth.js';

const clean = (value) => String(value ?? '').trim();

export async function onRequestPost(context) {
  const metric = startRequestMetric(context.request, '/api/staff-academics');
  let action = 'bootstrap';
  try {
    const { request, env } = context;
    const deployment = requiredDeploymentIdentity(env);
    if (deployment.edition !== 'school') {
      const error = new Error('Academic Management is available only in the School edition.');
      error.status = 404;
      throw error;
    }
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    const body = await readJsonBody(request, { maxBytes: 768 * 1024 });
    action = clean(body.action || body.Action || 'bootstrap');
    const data = await handleAcademicManagementAction(env, user, body);
    finishRequestMetric(metric, { status: 200, action: `staff-academics-${action}` });
    return Response.json(data, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    finishRequestMetric(metric, { status, action: `staff-academics-${action}`, outcome: error?.code || 'error' });
    return Response.json({
      ok: false,
      message: clean(error?.message) || 'Academic Management could not complete this request.',
      ...(error?.code ? { code: error.code } : {})
    }, {
      status,
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }
    });
  }
}
