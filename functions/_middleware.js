import { loadDeploymentIdentity, requiredDeploymentIdentity } from './lib/deployment-identity.js';

const LOW_READ_IDENTITY_PATHS = new Set([
  '/api/staff-session',
  '/api/staff-passkey',
  '/api/admin'
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

function identityUnavailableResponse(requestId, error) {
  const code = String(error?.code || '');
  const upstreamCode = String(error?.upstreamCode || '');
  const quotaFailure = code === 'FIRESTORE_QUOTA_EXHAUSTED'
    || upstreamCode === 'RESOURCE_EXHAUSTED'
    || /quota|resource exhausted/i.test(String(error?.message || ''));
  const message = quotaFailure
    ? 'The daily database read quota is currently exhausted. Firebase usage reporting can be delayed; access will resume after the daily quota resets or billing is enabled.'
    : code.startsWith('DEPLOYMENT_')
    ? String(error?.message || 'The deployment identity is invalid.')
    : 'The deployment identity could not be verified.';
  return unavailableResponse(requestId, message);
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
      try {
        await identityLoader(env);
      } catch (error) {
        identityFailure = error;
      }
      response = identityFailure
        ? identityUnavailableResponse(requestId, identityFailure)
        : await next();
    } else {
      const proxyAllowed = enabled(env.ALLOW_CANONICAL_API_PROXY);
      const configuredOrigin = String(env.CANONICAL_PORTAL_URL || '').trim();
      if (!proxyAllowed || !configuredOrigin) {
        response = unavailableResponse(requestId);
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
