import { getDocument, queryCollection } from '../lib/firestore.js';
import { requirePlatformFirestoreEnv } from '../lib/platform-firestore.js';
import {
  beginIdempotentRequest,
  completeIdempotentRequest,
  consumeRequestAllowance,
  failIdempotentRequest,
  readJsonBody
} from '../lib/request-security.js';
import { normalizeBillingCycle, normalizeSubscriptionPlan, normalizeSubscriptionPlanCatalog } from '../lib/subscription-plans.js';
import { subscriptionChangeDecision } from '../lib/subscription-upgrade.js';
import { initializeSubscriptionCheckout } from './register-organization.js';

const clean = (value) => String(value ?? '').trim();

export async function onRequestPost({ request, env }) {
  let platformEnv = null;
  let idempotency = null;
  try {
    platformEnv = requirePlatformFirestoreEnv(env);
    const allowance = await consumeRequestAllowance(platformEnv, request, { scope: 'subscription-checkout', maximum: 10, windowSeconds: 60 * 60 });
    if (!allowance.allowed) {
      const error = new Error('Too many subscription checkout attempts. Please try again later.');
      error.status = 429;
      throw error;
    }
    const body = await readJsonBody(request, { maxBytes: 700 * 1024 });
    const workspaceId = clean(body.workspaceId || request.headers.get('X-Dynamax-Workspace')).toLowerCase();
    if (!workspaceId) { const error = new Error('Workspace is required.'); error.status = 400; throw error; }
    idempotency = await beginIdempotentRequest(platformEnv, request, body, {
      scope: 'subscription-checkout', actor: workspaceId, ttlMinutes: 24 * 60,
      fingerprintPayload: {
        workspaceId,
        plan: clean(body.plan),
        billingCycle: clean(body.billingCycle),
        paymentMethod: clean(body.paymentMethod),
        bankReference: clean(body.bankReference)
      }
    });
    if (idempotency.replay) {
      return Response.json(idempotency.response, {
        status: idempotency.status || 200,
        headers: { 'Cache-Control': 'no-store', 'Idempotency-Replayed': 'true' }
      });
    }
    const rows = await queryCollection(platformEnv, 'tenantRegistrations', {
      filters: [{ field: 'WorkspaceId', op: '==', value: workspaceId }], limit: 20
    });
    const registration = rows
      .filter((row) => !['rejected', 'cancelled'].includes(clean(row.Status).toLowerCase()))
      .sort((left, right) => clean(right.UpdatedAt || right.CreatedAt).localeCompare(clean(left.UpdatedAt || left.CreatedAt)))[0];
    if (!registration) { const error = new Error('No active subscription record was found.'); error.status = 404; throw error; }
    const plan = normalizeSubscriptionPlan(body.plan);
    const billingCycle = normalizeBillingCycle(body.billingCycle);
    const renewalRequired = /payment grace|payment failed|past due|suspended|expired/i.test(
      `${clean(registration.SubscriptionStatus)} ${clean(registration.LifecycleStage)}`
    );
    const decision = subscriptionChangeDecision(
      registration.Plan,
      registration.BillingCycle,
      plan,
      billingCycle,
      { allowRenewal: renewalRequired }
    );
    if (!decision.allowed) { const error = new Error(decision.reason); error.status = 409; throw error; }
    const catalog = normalizeSubscriptionPlanCatalog(await getDocument(platformEnv, 'settings', 'dynamaxPlanCatalog') || {});
    const checkout = await initializeSubscriptionCheckout({
      request,
      env,
      platformEnv,
      registration,
      catalog,
      plan,
      billingCycle,
      preserveActivePlan: true,
      paymentMethod: body.paymentMethod,
      paymentEvidence: body
    });
    if (!checkout?.authorizationUrl && !checkout?.directTransfer) {
      const error = new Error('This subscription change does not have an available payment route.');
      error.status = 409;
      throw error;
    }
    const result = { ok: true, ...checkout, plan, billingCycle, currency: catalog.Currency };
    await completeIdempotentRequest(platformEnv, idempotency, result, 200);
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (idempotency?.owner && platformEnv) await failIdempotentRequest(platformEnv, idempotency, error);
    return Response.json({ ok: false, message: error.message || String(error) }, { status: error.status || 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
