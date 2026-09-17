import { getDocument } from '../lib/firestore.js';

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

export async function emailProviderReadiness(env = {}) {
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

export async function onRequestGet({ env }) {
  return Response.json({ ok: true, ...(await emailProviderReadiness(env)) }, {
    headers: { 'Cache-Control': 'no-store' }
  });
}
