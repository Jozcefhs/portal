import { loadDeploymentIdentity } from '../lib/deployment-identity.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { readJsonBody } from '../lib/request-security.js';

const clean = (value) => String(value ?? '').trim();
const enabled = (value) => ['1', 'true', 'yes', 'on'].includes(clean(value).toLowerCase());

function centralOrigin(env) {
  let origin;
  try { origin = new URL(clean(env.CANONICAL_PORTAL_URL)); } catch (_error) { origin = null; }
  if (!enabled(env.ALLOW_CANONICAL_API_PROXY)
      || clean(env.CANONICAL_API_PROXY_SCOPE).toLowerCase() !== 'platform-subscriptions'
      || !origin || origin.protocol !== 'https:') {
    const error = new Error('The Dynamax subscription service is not configured for this deployment.');
    error.status = 503;
    throw error;
  }
  return origin.origin;
}

async function requireSubscriptionAdmin(env, request) {
  const user = await requireStaffSession(env, request);
  if (clean(user.role || user.Role) !== 'Super Admin') {
    const error = new Error('Only the Super Admin can change the organisation subscription.');
    error.status = 403;
    throw error;
  }
  return user;
}

async function centralJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const error = new Error(data.message || 'The Dynamax subscription service could not complete the request.');
    error.status = response.status || 503;
    throw error;
  }
  return data;
}

export async function onRequestGet({ request, env }) {
  try {
    await requireSubscriptionAdmin(env, request);
    const identity = await loadDeploymentIdentity(env);
    const origin = centralOrigin(env);
    const headers = { Accept: 'application/json', 'X-Dynamax-Workspace': identity.workspaceId };
    const [catalog, policy] = await Promise.all([
      fetch(new URL('/api/plan-catalog', origin), { headers }).then(centralJson),
      fetch(new URL('/api/subscription-policy', origin), { headers }).then(centralJson)
    ]);
    return Response.json({ ok: true, catalog: catalog.catalog, policy: policy.policy, edition: identity.edition }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, message: error.message || String(error) }, { status: error.status || 500, headers: { 'Cache-Control': 'no-store' } });
  }
}

export async function onRequestPost({ request, env }) {
  try {
    await requireSubscriptionAdmin(env, request);
    const identity = await loadDeploymentIdentity(env);
    const body = await readJsonBody(request, { maxBytes: 700 * 1024 });
    const response = await fetch(new URL('/api/subscription-checkout', centralOrigin(env)), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Dynamax-Workspace': identity.workspaceId },
      body: JSON.stringify({
        workspaceId: identity.workspaceId,
        plan: clean(body.plan),
        billingCycle: clean(body.billingCycle),
        idempotencyKey: clean(body.idempotencyKey),
        paymentMethod: clean(body.paymentMethod),
        bankReference: clean(body.bankReference),
        proofDataUrl: clean(body.proofDataUrl),
        proofFileName: clean(body.proofFileName)
      })
    });
    return Response.json(await centralJson(response), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, message: error.message || String(error) }, { status: error.status || 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
