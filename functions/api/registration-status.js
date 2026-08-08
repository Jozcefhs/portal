import { requirePlatformFirestoreEnv } from '../lib/platform-firestore.js';
import { consumeRequestAllowance, readJsonBody } from '../lib/request-security.js';
import { inspectRegistrationOnboarding } from '../lib/registration-onboarding.js';
import { issueTenantActivation } from '../lib/tenant-activation.js';

const clean = (value) => String(value ?? '').trim();

function statusMessage(registration, activation = {}) {
  if (activation.alreadyActivated) return 'Your administrator account is ready. Redirecting you to sign in.';
  if (activation.issued) return 'Your isolated workspace is ready. Redirecting you to create the first administrator account.';
  if (!clean(registration.WorkspaceId)) {
    return 'Your registration is secure. Dynamax is preparing an isolated workspace for your organisation.';
  }
  return 'Your workspace has been assigned and its administrator access is being prepared.';
}

export async function onRequestPost({ request, env }) {
  try {
    const platformEnv = requirePlatformFirestoreEnv(env);
    const allowance = await consumeRequestAllowance(platformEnv, request, {
      scope: 'registration-status',
      maximum: 90,
      windowSeconds: 60 * 60
    });
    if (!allowance.allowed) {
      return Response.json({ ok: false, message: 'Too many status checks. Please wait before trying again.' }, {
        status: 429,
        headers: { 'Cache-Control': 'no-store', 'Retry-After': String(allowance.retryAfter) }
      });
    }
    const body = await readJsonBody(request, { maxBytes: 16 * 1024 });
    const registration = await inspectRegistrationOnboarding(platformEnv, body.reference, body.token);
    const activation = clean(registration.WorkspaceId) && clean(registration.PortalUrl)
      ? await issueTenantActivation(platformEnv, registration, env)
      : { issued: false, reason: 'workspace-not-ready' };
    const destinationUrl = clean(activation.activationUrl || activation.loginUrl);
    return Response.json({
      ok: true,
      reference: clean(registration.Reference || registration.__id),
      organisationName: clean(registration.OrganisationName),
      edition: clean(registration.Edition),
      plan: clean(registration.Plan),
      status: clean(registration.Status || registration.SubscriptionStatus),
      provisioningStatus: clean(registration.ProvisioningStatus),
      workspaceReady: Boolean(clean(registration.WorkspaceId) && clean(registration.PortalUrl)),
      ready: Boolean(destinationUrl),
      destinationUrl,
      activationExpiresAt: clean(activation.expiresAt),
      message: statusMessage(registration, activation),
      retryAfterSeconds: destinationUrl ? 0 : 60
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, code: clean(error.code), message: error.message || String(error) }, {
      status: error.status || 500,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}
