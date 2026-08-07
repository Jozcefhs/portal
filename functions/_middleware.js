import { loadDeploymentIdentity, requiredDeploymentIdentity } from './lib/deployment-identity.js';

const LOW_READ_IDENTITY_PATHS = new Set([
  '/api/staff-session',
  '/api/staff-passkey',
  '/api/admin'
]);

const PLATFORM_SUBSCRIPTION_PROXY_PATHS = new Set([
  '/api/plan-catalog',
  '/api/register-organization',
  '/api/verify-subscription-payment',
  '/api/paystack-subscription-webhook'
]);

const SUBSCRIPTION_RECOVERY_PATHS = new Set([
  '/api/admin',
  '/api/staff-session',
  '/api/staff-passkey',
  '/api/plan-catalog',
  '/api/register-organization',
  '/api/pricing-book-pdf',
  '/api/verify-subscription-payment',
  '/api/paystack-subscription-webhook',
  '/api/web-logo'
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

function subscriptionGateExempt(pathname, method) {
  if (SUBSCRIPTION_RECOVERY_PATHS.has(pathname)) return true;
  return pathname === '/api/settings' && ['GET', 'HEAD'].includes(String(method || 'GET').toUpperCase());
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

async function handleRequest(context, identityLoader) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const isApi = url.pathname === '/api' || url.pathname.startsWith('/api/');
  const hasLocalBackend = Boolean(String(env.FIREBASE_PROJECT_ID || '').trim());
  if (!isApi) return next();

  const started = Date.now();
  const requestId = String(request.headers.get('CF-Ray') || crypto.randomUUID()).slice(0, 96);
  let response;
  let failure = null;
  let proxied = false;
  try {
    if (hasLocalBackend) {
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
          : await next();
    } else {
      const proxyAllowed = enabled(env.ALLOW_CANONICAL_API_PROXY);
      const configuredOrigin = String(env.CANONICAL_PORTAL_URL || '').trim();
      if (!proxyAllowed || !configuredOrigin) {
        response = unavailableResponse(requestId);
      } else if (!canonicalProxyPathAllowed(env, url.pathname)) {
        response = unavailableResponse(requestId, 'This API route is not available on the public Dynamax deployment.');
      } else {
        let configuredUrl = null;
        try {
          configuredUrl = new URL(configuredOrigin);
        } catch (_error) {
          // Handled by the explicit fail-closed branch below.
        }
        if (!configuredUrl || configuredUrl.protocol !== 'https:' || configuredUrl.origin === url.origin) {
          response = unavailableResponse(requestId, 'The configured canonical API proxy is invalid.');
        } else {
          const target = new URL(`${url.pathname}${url.search}`, configuredUrl.origin);
          const headers = new Headers(request.headers);
          headers.set('X-Dynamax-Portal', url.hostname);
          headers.set('X-Request-Id', requestId);
          headers.delete('host');
          proxied = true;
          response = await fetch(new Request(target, {
            method: request.method,
            headers,
            body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
            redirect: 'manual'
          }));
        }
      }
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
