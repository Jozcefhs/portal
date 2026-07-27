const CANONICAL_API_ORIGIN = 'https://digc-suite.pages.dev';

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const isApi = url.pathname === '/api' || url.pathname.startsWith('/api/');
  const hasLocalBackend = Boolean(String(env.FIREBASE_PROJECT_ID || '').trim());
  if (!isApi || hasLocalBackend) return next();

  const target = new URL(`${url.pathname}${url.search}`, CANONICAL_API_ORIGIN);
  const headers = new Headers(request.headers);
  headers.set('X-Dynamax-Portal', url.hostname);
  headers.delete('host');
  return fetch(new Request(target, {
    method: request.method,
    headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    redirect: 'manual'
  }));
}
