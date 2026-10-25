import { readJsonBody, consumeRequestAllowance } from '../lib/request-security.js';
import { createPortalCbtService, cbtHash } from '../lib/portal-cbt.js';

const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const cookieName = '__Host-dynamax-exam';
function sessionCookie(request) {
  return (request.headers.get('Cookie') || '').split(';').map(value => value.trim()).find(value => value.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) || '';
}
export async function onRequestPost({ request, env }) {
  try {
    const url = new URL(request.url);
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw Object.assign(new Error('Use the school HTTPS examination address.'), { status: 400 });
    if (request.headers.get('Origin') !== url.origin) throw Object.assign(new Error('Open the examination from its school portal.'), { status: 403 });
    const body = await readJsonBody(request, { maxBytes: 150000 });
    const service = createPortalCbtService(env);
    if (body.action === 'login') {
      // Per-IP and reference limits allow a shared school connection while
      // preventing repeated guessing of one candidate's credentials.
      const reference = await cbtHash(`${body.TestId}|${String(body.Reference || '').trim().toLowerCase()}`);
      const allowance = await consumeRequestAllowance(env, request, { scope: `exam-login-${reference.slice(0, 32)}`, maximum: 12, windowSeconds: 600 });
      if (!allowance.allowed) return Response.json({ ok: false, message: 'Too many sign-in attempts. Wait before trying again.' }, { status: 429, headers: { ...headers, 'Retry-After': String(allowance.retryAfter) } });
      const { session, ...result } = await service.login(body, sessionCookie(request));
      return Response.json(result, { headers: { ...headers, 'Set-Cookie': `${cookieName}=${session}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400` } });
    }
    if (!['session', 'start', 'save', 'submit'].includes(body.action)) throw Object.assign(new Error('Choose a valid examination action.'), { status: 400 });
    return Response.json(await service.candidateAction(body, sessionCookie(request)), { headers });
  } catch (error) {
    return Response.json({ ok: false, message: error.message || 'The exam could not confirm this request. Your saved answers remain available.' }, { status: Number(error.status || 500), headers });
  }
}
