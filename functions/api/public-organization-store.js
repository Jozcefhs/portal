import { requireFirestoreEnv } from '../lib/firestore.js';
import { requiredDeploymentIdentity } from '../lib/deployment-identity.js';
import {
  initializeOnlineOrganizationCommerceSale,
  listPublicOrganizationStoreItems
} from '../lib/organization-commerce.js';
import {
  beginIdempotentRequest,
  completeIdempotentRequest,
  consumeRequestAllowance,
  failIdempotentRequest,
  readJsonBody,
  tooManyRequests,
  verifyTurnstile
} from '../lib/request-security.js';

const clean = (value) => String(value ?? '').trim();

function publicBranch(value) {
  const branch = clean(value).toLowerCase() || 'main';
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(branch)) {
    const error = new Error('The store branch address is invalid.');
    error.status = 400;
    throw error;
  }
  return branch;
}

function requirePublicStoreEdition(identity = {}) {
  if (!['faith', 'organization'].includes(clean(identity.edition).toLowerCase())) {
    const error = new Error('The public organisation store is not available on this deployment.');
    error.status = 404;
    throw error;
  }
}

function responseHeaders(cacheControl = 'no-store') {
  return {
    'Cache-Control': cacheControl,
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff'
  };
}

export async function onRequestGet(context) {
  try {
    const { request, env } = context;
    requireFirestoreEnv(env);
    const identity = requiredDeploymentIdentity(env);
    requirePublicStoreEdition(identity);
    const url = new URL(request.url);
    const branchId = publicBranch(url.searchParams.get('branch'));
    const items = await listPublicOrganizationStoreItems(env, branchId, identity.edition);
    return Response.json({ ok: true, branchId, currency: 'NGN', items }, {
      headers: responseHeaders('public, max-age=30')
    });
  } catch (error) {
    return Response.json({ ok: false, message: error.message || String(error) }, {
      status: error.status || 500,
      headers: responseHeaders()
    });
  }
}

export async function onRequestPost(context) {
  let idempotency = null;
  try {
    const { request, env } = context;
    requireFirestoreEnv(env);
    const identity = requiredDeploymentIdentity(env);
    requirePublicStoreEdition(identity);
    const body = await readJsonBody(request, { maxBytes: 64 * 1024 });
    if (clean(body.CompanyWebsite)) {
      const error = new Error('The store checkout could not be submitted.');
      error.status = 400;
      throw error;
    }
    await verifyTurnstile(env, request, body, 'organization_store');
    const allowance = await consumeRequestAllowance(env, request, {
      scope: 'public-organization-store',
      maximum: 10,
      windowSeconds: 15 * 60
    });
    if (!allowance.allowed) {
      return tooManyRequests('Too many store checkout requests. Please wait and try again.', allowance.retryAfter);
    }
    const branchId = publicBranch(body.BranchId || body.branchId);
    const customerEmail = clean(body.CustomerEmail || body.customerEmail).toLowerCase();
    idempotency = await beginIdempotentRequest(env, request, body, {
      scope: 'public-organization-store',
      actor: customerEmail,
      ttlMinutes: 2 * 24 * 60
    });
    if (!idempotency.enabled) {
      const error = new Error('A secure request identifier is required. Refresh the page and try again.');
      error.status = 400;
      throw error;
    }
    if (idempotency.replay) {
      return Response.json(idempotency.response, {
        status: idempotency.status || (idempotency.response?.ok === false ? 409 : 200),
        headers: { ...responseHeaders(), 'Idempotency-Replayed': 'true' }
      });
    }
    const user = {
      branchId,
      edition: identity.edition,
      username: 'public-organisation-store',
      displayName: 'Public organisation store'
    };
    const result = await initializeOnlineOrganizationCommerceSale(
      env,
      request,
      'organizationStore',
      { ...body, BranchId: branchId, PaymentMethod: 'Paystack Online', CheckoutSource: 'Public Store' },
      user,
      typeof context.waitUntil === 'function'
        ? { waitUntil: (task) => context.waitUntil(task) }
        : {}
    );
    await completeIdempotentRequest(env, idempotency, result, 200);
    return Response.json(result, { headers: responseHeaders() });
  } catch (error) {
    if (idempotency?.owner) await failIdempotentRequest(context.env, idempotency, error);
    return Response.json({ ok: false, message: error.message || String(error) }, {
      status: error.status || 500,
      headers: responseHeaders()
    });
  }
}
