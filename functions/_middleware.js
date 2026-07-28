const CANONICAL_API_ORIGIN = 'https://digc-suite.pages.dev';

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const isApi = url.pathname === '/api' || url.pathname.startsWith('/api/');
  const hasLocalBackend = Boolean(String(env.FIREBASE_PROJECT_ID || '').trim());
  if (!isApi) return next();

  const started = Date.now();
  const requestId = String(request.headers.get('CF-Ray') || crypto.randomUUID()).slice(0, 96);
  let response;
  let failure = null;
  try {
    if (hasLocalBackend) {
      response = await next();
    } else {
      const configuredOrigin = String(env.CANONICAL_PORTAL_URL || CANONICAL_API_ORIGIN).trim();
      const target = new URL(`${url.pathname}${url.search}`, configuredOrigin);
      if (target.origin === url.origin) {
        response = Response.json({ ok: false, message: 'The API backend is not configured for this deployment.' }, {
          status: 503,
          headers: { 'Cache-Control': 'no-store', 'X-Request-Id': requestId }
        });
      } else {
        const headers = new Headers(request.headers);
        headers.set('X-Dynamax-Portal', url.hostname);
        headers.set('X-Request-Id', requestId);
        headers.delete('host');
        response = await fetch(new Request(target, {
          method: request.method,
          headers,
          body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
          redirect: 'manual'
        }));
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
      proxied: !hasLocalBackend
    }));
  }
}
