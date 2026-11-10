import { getDocument } from '../lib/firestore.js';
import { resolveBranchEmailEnvironment } from '../lib/branch-email-provider.js';

const clean = (value) => String(value ?? '').trim();

function validRequestedAt(value) {
  const text = clean(value);
  return Number.isFinite(Date.parse(text)) ? text : '';
}

async function brevoReady(env) {
  if (clean(env.BREVO_API_KEY)) return true;
  const legacy = await getDocument(env, 'settings', 'brevo').catch(() => null);
  return Boolean(clean(legacy?.BrevoApiKey));
}

export async function emailProviderReadiness(env = {}, branchId = '') {
  if (branchId) {
    try {
      const scope = await resolveBranchEmailEnvironment(env, branchId);
      const effective = await emailProviderReadiness(scope.env);
      return { ...effective, provider: scope.provider, requestedAt: scope.requestedAt, branchId: scope.branchId };
    } catch { return { provider: 'unsupported', ready: false, requestedAt: '', branchId: String(branchId).trim().toLowerCase() }; }
  }
  const configured = clean(env.EMAIL_PROVIDER).toLowerCase();
  const provider = configured || 'brevo';
  if (!['brevo', 'gmail'].includes(provider)) {
    return {
      provider: 'unsupported',
      ready: false,
      requestedAt: validRequestedAt(env.EMAIL_PROVIDER_DEPLOYMENT_REQUESTED_AT)
    };
  }
  const ready = provider === 'gmail'
    ? Boolean(
        clean(env.GMAIL_OAUTH_CLIENT_ID)
        && clean(env.GMAIL_OAUTH_CLIENT_SECRET)
        && clean(env.GMAIL_REFRESH_TOKEN)
        && clean(env.GMAIL_CONNECTED_EMAIL)
      )
    : await brevoReady(env);
  return {
    provider,
    ready,
    requestedAt: validRequestedAt(env.EMAIL_PROVIDER_DEPLOYMENT_REQUESTED_AT)
  };
}

export async function onRequestGet({ env, request }) {
  const branchId = request ? new URL(request.url).searchParams.get('branchId') || '' : '';
  return Response.json({ ok: true, ...(await emailProviderReadiness(env, branchId)) }, {
    headers: { 'Cache-Control': 'no-store' }
  });
}
