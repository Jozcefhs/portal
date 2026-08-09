import { loadDeploymentIdentity, requiredDeploymentIdentity } from './lib/deployment-identity.js';
import { hasPlatformFirestoreConfiguration } from './lib/platform-firestore.js';

const LOW_READ_IDENTITY_PATHS = new Set([
  '/api/staff-session',
  '/api/staff-passkey',
  '/api/admin'
]);

const PLATFORM_SUBSCRIPTION_PROXY_PATHS = new Set([
  '/api/plan-catalog',
  '/api/platform-payment-methods',
  '/api/platform-payment-settings',
  '/api/tenant-project-pool',
  '/api/subscription-policy',
  '/api/subscription-checkout',
  '/api/pricing-book-pdf',
  '/api/register-organization',
  '/api/registration-status',
  '/api/tenant-activation',
  '/api/verify-subscription-payment',
  '/api/paystack-subscription-webhook'
]);

const SUBSCRIPTION_RECOVERY_PATHS = new Set([
  '/api/admin',
  '/api/staff-session',
  '/api/staff-passkey',
  '/api/plan-catalog',
  '/api/platform-payment-methods',
  '/api/platform-payment-settings',
  '/api/tenant-project-pool',
  '/api/subscription-policy',
  '/api/subscription-checkout',
  '/api/staff-subscription',
  '/api/register-organization',
  '/api/registration-status',
  '/api/tenant-activation',
  '/api/complete-tenant-activation',
  '/api/pricing-book-pdf',
  '/api/verify-subscription-payment',
  '/api/paystack-subscription-webhook',
  '/api/web-logo'
]);

const TENANT_BOOTSTRAP_PATHS = new Set([
  '/api/complete-tenant-activation'
]);

function enabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function unavailableResponse(requestId, message = 'The API backend is not configured for this deployment.') {
  return Response.json({ ok: false, message }, {
    status: 503,
    headers: { 'Cache-Control': 'no-store', 'X-Request-Id': requestId }
  });
}

function canonicalProxyPathAllowed(env, pathname) {
  const scope = String(env.CANONICAL_API_PROXY_SCOPE || '').trim().toLowerCase();
  if (!scope) return true;
  if (scope !== 'platform-subscriptions') return false;
  const normalizedPath = String(pathname || '').replace(/\/+$/, '') || '/';
  return PLATFORM_SUBSCRIPTION_PROXY_PATHS.has(normalizedPath);
}

function identityUnavailableResponse(requestId, error) {
  const code = String(error?.code || '');
  const upstreamCode = String(error?.upstreamCode || '');
  const resourceLimitFailure = code === 'FIRESTORE_QUOTA_EXHAUSTED'
    || upstreamCode === 'RESOURCE_EXHAUSTED'
    || /quota|resource exhausted/i.test(String(error?.message || ''));
  const message = resourceLimitFailure
    ? `The database temporarily refused this request because a resource limit was reached. This is not necessarily the daily read quota. Reference: ${requestId}`
    : code.startsWith('DEPLOYMENT_')
    ? String(error?.message || 'The deployment identity is invalid.')
    : 'The deployment identity could not be verified.';
  return unavailableResponse(requestId, message);
}

function subscriptionRequiredResponse(requestId, identity = {}) {
  return Response.json({
    ok: false,
    code: 'SUBSCRIPTION_REQUIRED',
    message: String(identity.subscriptionMessage || 'This subscription is not active. Choose a paid subscription to continue.'),
    subscriptionPlan: String(identity.subscriptionPlan || ''),
    subscriptionState: String(identity.subscriptionState || 'inactive'),
    trialEndsAt: String(identity.trialEndsAt || '')
  }, {
    status: 402,
    headers: { 'Cache-Control': 'no-store', 'X-Request-Id': requestId }
  });
}

function subscriptionReadOnlyResponse(requestId, identity = {}) {
  return Response.json({
    ok: false,
    code: 'SUBSCRIPTION_READ_ONLY',
    message: String(identity.subscriptionMessage || 'This subscription is in its payment grace period. Renew it to make operational changes.'),
    subscriptionPlan: String(identity.subscriptionPlan || ''),
    subscriptionState: String(identity.subscriptionState || 'payment_grace'),
    gracePeriodEndsAt: String(identity.gracePeriodEndsAt || '')
  }, {
    status: 402,
    headers: { 'Cache-Control': 'no-store', 'X-Request-Id': requestId }
  });
}

function subscriptionGateExempt(pathname, method) {
  if (SUBSCRIPTION_RECOVERY_PATHS.has(pathname)) return true;
  return pathname === '/api/settings' && ['GET', 'HEAD'].includes(String(method || 'GET').toUpperCase());
}

const READ_ONLY_POST_ACTIONS = new Set([
  'detail', 'get', 'getchildactivity', 'getchildpayable', 'getdashboard',
  'getnotifications', 'history', 'init', 'inspect', 'list', 'load', 'preview',
  'refresh', 'report', 'search', 'shell', 'status', 'summary', 'view'
]);

async function subscriptionReadOnlyRequestAllowed(request, pathname) {
  const method = String(request.method || 'GET').toUpperCase();
  if (subscriptionGateExempt(pathname, method) || ['GET', 'HEAD', 'OPTIONS'].includes(method)) return true;
  if (method !== 'POST' || !String(request.headers.get('Content-Type') || '').toLowerCase().includes('application/json')) return false;
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > 64 * 1024) return false;
  const body = await request.clone().json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const action = String(body.action || body.mode || body.operation || '').trim().toLowerCase();
  return READ_ONLY_POST_ACTIONS.has(action);
}

function logIdentityFailure({ requestId, pathname, env, error }) {
  const code = String(error?.code || '').slice(0, 120);
  const upstreamCode = String(error?.upstreamCode || '').slice(0, 120);
  const firestoreDiagnostic = code.startsWith('FIRESTORE_') || Boolean(upstreamCode);
  console.error(JSON.stringify({
    event: 'api_identity_error',
    requestId,
    route: pathname,
    firebaseProjectId: String(env?.FIREBASE_PROJECT_ID || '').trim().slice(0, 120),
    status: Number(error?.status || 503),
    code,
    upstreamCode,
    message: firestoreDiagnostic ? String(error?.message || '').slice(0, 500) : ''
  }));
}

async function proxyApiRequest({ request, env, url, requestId }) {
  const proxyAllowed = enabled(env.ALLOW_CANONICAL_API_PROXY);
  const configuredOrigin = String(env.CANONICAL_PORTAL_URL || '').trim();
  if (!proxyAllowed || !configuredOrigin) {
    return { response: unavailableResponse(requestId) };
  }
  if (!canonicalProxyPathAllowed(env, url.pathname)) {
    return {
      response: unavailableResponse(requestId, 'This API route is not available on the public Dynamax deployment.')
    };
  }
  let configuredUrl = null;
  try {
    configuredUrl = new URL(configuredOrigin);
  } catch (_error) {
    // Handled by the explicit fail-closed branch below.
  }
  if (!configuredUrl || configuredUrl.protocol !== 'https:' || configuredUrl.origin === url.origin) {
    return { response: unavailableResponse(requestId, 'The configured canonical API proxy is invalid.') };
  }
  const target = new URL(`${url.pathname}${url.search}`, configuredUrl.origin);
  const headers = new Headers(request.headers);
  headers.set('X-Dynamax-Portal', url.hostname);
  headers.set('X-Request-Id', requestId);
  headers.delete('host');
  const forwardedRequest = new Request(target, request);
  return {
    proxied: true,
    response: await fetch(new Request(forwardedRequest, {
      headers,
      redirect: 'manual'
    }))
  };
}

async function handleRequest(context, identityLoader) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const isApi = url.pathname === '/api' || url.pathname.startsWith('/api/');
  const hasLocalBackend = Boolean(String(env.FIREBASE_PROJECT_ID || '').trim());
  const platformPath = PLATFORM_SUBSCRIPTION_PROXY_PATHS.has(url.pathname.replace(/\/+$/, '') || '/');
  const hasPlatformBackend = hasPlatformFirestoreConfiguration(env);
  if (!isApi) return next();

  const started = Date.now();
  const requestId = String(request.headers.get('CF-Ray') || crypto.randomUUID()).slice(0, 96);
  let response;
  let failure = null;
  let proxied = false;
  try {
    if (platformPath && hasPlatformBackend) {
      // The central Dynamax deployment serves subscriber and plan data without
      // consulting or exposing any organisation's operational database.
      response = await next();
    } else if (platformPath || !hasLocalBackend) {
      const proxyResult = await proxyApiRequest({ request, env, url, requestId });
      response = proxyResult.response;
      proxied = Boolean(proxyResult.proxied);
    } else if (TENANT_BOOTSTRAP_PATHS.has(url.pathname)) {
      // First-account activation verifies a central one-time token and writes
      // only to the assigned local tenant. It must work before a profile or
      // staff session exists, so it supplies its own stricter authorization.
      response = await next();
    } else {
      let identityFailure = null;
      let identity = null;
      try {
        identity = await identityLoader(env);
      } catch (error) {
        identityFailure = error;
        logIdentityFailure({ requestId, pathname: url.pathname, env, error });
      }
      response = identityFailure
        ? identityUnavailableResponse(requestId, identityFailure)
        : identity?.subscriptionActive === false && !subscriptionGateExempt(url.pathname, request.method)
          ? subscriptionRequiredResponse(requestId, identity)
          : identity?.subscriptionReadOnly === true
            && !(await subscriptionReadOnlyRequestAllowed(request, url.pathname))
            ? subscriptionReadOnlyResponse(requestId, identity)
            : await next();
    }
    const responseHeaders = new Headers(response.headers);
    if (!responseHeaders.has('Cache-Control')) responseHeaders.set('Cache-Control', 'no-store');
    responseHeaders.set('X-Request-Id', requestId);
    responseHeaders.set('X-Content-Type-Options', 'nosniff');
    responseHeaders.append('Server-Timing', `app;dur=${Date.now() - started}`);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders
    });
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    console.log(JSON.stringify({
      event: 'api_request',
      requestId,
      method: request.method,
      route: url.pathname,
      status: response?.status || Number(failure?.status || 500),
      durationMs: Date.now() - started,
      colo: String(request.cf?.colo || ''),
      proxied
    }));
  }
}

export async function onRequestWithIdentityLoader(context, identityLoader) {
  return handleRequest(context, identityLoader);
}

export async function onRequest(context) {
  const pathname = new URL(context.request.url).pathname;
  const identityLoader = LOW_READ_IDENTITY_PATHS.has(pathname)
    ? async (env) => requiredDeploymentIdentity(env)
    : loadDeploymentIdentity;
  return handleRequest(context, identityLoader);
}
