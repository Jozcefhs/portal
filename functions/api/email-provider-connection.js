import { requiredDeploymentIdentity } from '../lib/deployment-identity.js';
import { sendConfiguredEmail } from '../lib/email-service.js';
import { getDocument } from '../lib/firestore.js';
import { readJsonBody } from '../lib/request-security.js';
import { requireSetupAdministrator, resolveSetupSettingsAccess } from '../lib/setup-auth.js';
import { signTenantControlRequest } from '../lib/tenant-control-plane.js';
import { assertConfiguredProfileBranch } from '../lib/branch-profile-settings.js';
import { emailProviderBranchId, resolveBranchEmailEnvironment } from '../lib/branch-email-provider.js';
import { emailProviderReadiness } from './email-provider-readiness.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();

function centralEndpoint(env, request) {
  let central;
  try { central = new URL(clean(env.CANONICAL_PORTAL_URL)); } catch (_error) { central = null; }
  const local = new URL(request.url);
  if (!central || central.protocol !== 'https:' || central.origin === local.origin) {
    const error = new Error('Secure email-provider onboarding is not configured for this tenant.');
    error.status = 503;
    error.code = 'EMAIL_PROVIDER_ONBOARDING_NOT_CONFIGURED';
    throw error;
  }
  return new URL('/api/tenant-email-provider', central.origin);
}

function assertSameOrigin(request) {
  const origin = clean(request.headers.get('Origin'));
  if (origin && origin !== new URL(request.url).origin) {
    const error = new Error('Cross-site email configuration requests are not allowed.');
    error.status = 403;
    throw error;
  }
}

async function emailSettingsAccess(env, actor, body) {
  const access = resolveSetupSettingsAccess(
    actor,
    body.SettingsScope || body.settingsScope,
    body.BranchId || body.branchId
  );
  if (access.scope === 'branch') await assertConfiguredProfileBranch(env, emailProviderBranchId(access.branchId));
  return access;
}

function tenantControlDetails(env, request, action) {
  const identity = requiredDeploymentIdentity(env);
  const privateKey = clean(env.TENANT_CONTROL_PLANE_PRIVATE_KEY);
  if (!privateKey) {
    const error = new Error('Secure email onboarding has not been enabled for this tenant yet. Contact Dynamax support to complete the one-time security upgrade.');
    error.status = 503;
    error.code = 'TENANT_CONTROL_KEY_NOT_CONFIGURED';
    throw error;
  }
  return {
    privateKey,
    details: {
      action,
      workspaceId: identity.workspaceId,
      portalHost: new URL(request.url).hostname,
      requestId: crypto.randomUUID(),
      issuedAt: new Date().toISOString()
    }
  };
}

async function postTenantControlRequest(env, request, action, access, extra = {}) {
  const { privateKey, details } = tenantControlDetails(env, request, action);
  if (access.scope === 'branch') Object.assign(details, { settingsScope: 'branch', branchId: emailProviderBranchId(access.branchId), ...extra });
  const signature = await signTenantControlRequest(privateKey, details);
  const response = await fetch(centralEndpoint(env, request), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Dynamax-Portal': details.portalHost,
      'X-Dynamax-Tenant-Signature': signature
    },
    body: JSON.stringify(details)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    const error = new Error(data?.message || 'The Dynamax email control plane did not accept this request.');
    error.status = response.status || 502;
    error.code = clean(data?.code);
    throw error;
  }
  return data;
}

async function sendTestEmail(env, body, actor, access) {
  const recipientEmail = lower(body.recipientEmail || body.toEmail || body.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
    const error = new Error('Enter a valid recipient email address for the test.');
    error.status = 400;
    throw error;
  }
  await sendConfiguredEmail(env, {
    branchId: access.scope === 'branch' ? access.branchId : '',
    toEmail: recipientEmail,
    toName: clean(actor.displayName || actor.username) || recipientEmail,
    subject: 'Dynamax email provider test',
    textContent: 'This one-time message confirms that your organisation email provider is connected to Dynamax.',
    htmlContent: '<p>This one-time message confirms that your organisation email provider is connected to Dynamax.</p>'
  });
  const effective = await resolveBranchEmailEnvironment(env, access.scope === 'branch' ? access.branchId : '');
  const configuredProvider = lower(effective.env.EMAIL_PROVIDER);
  const provider = !configuredProvider
    ? 'brevo'
    : ['brevo', 'gmail'].includes(configuredProvider)
      ? configuredProvider
      : 'unsupported';
  return Response.json({
    ok: true,
    provider,
    message: `A single test email was accepted for delivery to ${recipientEmail}.`
  }, { headers: { 'Cache-Control': 'no-store' } });
}

async function brevoConfigured(env) {
  if (clean(env.BREVO_API_KEY)) return true;
  const legacy = await getDocument(env, 'settings', 'brevo').catch(() => null);
  return Boolean(clean(legacy?.BrevoApiKey));
}

export async function onRequestPost({ request, env }) {
  try {
    assertSameOrigin(request);
    const body = await readJsonBody(request, { maxBytes: 8 * 1024 });
    const actor = await requireSetupAdministrator(env, request, body.password);
    const access = await emailSettingsAccess(env, actor, body);
    const action = lower(body.action);
    if (action === 'test') return await sendTestEmail(env, body, actor, access);
    if (action === 'connect-google') {
      const data = await postTenantControlRequest(env, request, 'start-google-email', access);
      return Response.json({
        ok: true,
        authorizationUrl: clean(data.authorizationUrl),
        expiresAt: clean(data.expiresAt),
        message: clean(data.message) || 'Continue to Google to approve send-only email access.'
      }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (action === 'inherit-email') {
      if (access.scope !== 'branch') throw Object.assign(new Error('Only a branch can inherit the organisation email provider.'), { status: 400 });
      if (!(await emailProviderReadiness(env)).ready) throw Object.assign(new Error('Configure the organisation email provider before this branch inherits it. Its current connection has not changed.'), { status: 409 });
      const data = await postTenantControlRequest(env, request, action, access);
      return Response.json({ ...data, ok: true }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (['use-brevo', 'disconnect-google'].includes(action)) {
      const branchMode = access.scope === 'branch';
      const brevoApiKey = clean(body.brevoApiKey);
      if (branchMode && (!brevoApiKey || brevoApiKey.length > 4096)) {
        throw Object.assign(new Error('Enter this branch’s Brevo API key to connect its independent account.'), { status: 400 });
      }
      if (!branchMode && !await brevoConfigured(env)) {
        const error = new Error('Brevo cannot be selected because this tenant has no Brevo API credential. Connect Brevo before removing the working Google provider.');
        error.status = 409;
        error.code = 'BREVO_EMAIL_NOT_CONFIGURED';
        throw error;
      }
      const data = await postTenantControlRequest(env, request, 'use-brevo', access, branchMode ? { brevoApiKey } : {});
      return Response.json({
        ok: true,
        provider: 'brevo',
        deploymentQueued: data.deploymentQueued === true,
        stagingUnconfirmed: data.stagingUnconfirmed === true,
        message: clean(data.message) || 'Brevo was selected for this organisation.'
      }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const error = new Error('Choose Connect Google, Use Brevo, or Send test email.');
    error.status = 400;
    throw error;
  } catch (error) {
    return Response.json({ ok: false, code: clean(error.code), message: error.message || String(error) }, {
      status: error.status || 500,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}
