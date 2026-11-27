import { getDocument, createDocumentIfAbsent } from '../lib/firestore.js';
import { requirePlatformFirestoreEnv } from '../lib/platform-firestore.js';
import { readJsonBody } from '../lib/request-security.js';
import { assertFreshTenantControlRequest, tenantControlSecretHash, verifyTenantControlRequest } from '../lib/tenant-control-plane.js';
import { assertTenantProjectAssignment } from '../lib/tenant-project-pool.js';
import { activeTenantControlRecord } from '../lib/tenant-email-provider.js';
import { escapeEmailHtml, sendConfiguredEmail } from '../lib/email-service.js';

const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const denied = () => Object.assign(new Error('Owner recovery unavailable.'), { status: 403 });

export async function registeredOwnerRecovery(env, details, signature) {
  if (!['issue-owner-recovery', 'check-owner-recovery'].includes(details.action)
      || !/^ACT-[0-9]+-[A-Z0-9-]+$/.test(details.activationId)
      || !/^[a-z0-9-]+\.pages\.dev$/.test(details.portalHost) || !signature) throw denied();
  assertFreshTenantControlRequest(details);
  const platform = requirePlatformFirestoreEnv(env);
  const activation = await getDocument(platform, 'tenantActivations', details.activationId);
  const portalUrl = 'https://' + details.portalHost;
  if (!activation || activation.Status !== 'Used' || !activation.UsedAt
      || activation.ActivationId !== details.activationId || activation.WorkspaceId !== details.workspaceId
      || activation.PortalUrl !== portalUrl || !activation.RegistrationReference) throw denied();
  const registration = await getDocument(platform, 'tenantRegistrations', activation.RegistrationReference);
  if (!registration || registration.Reference !== activation.RegistrationReference
      || registration.AdminActivatedAt !== activation.UsedAt || registration.AdminUsername !== details.founderUsername
      || registration.WorkspaceId !== details.workspaceId || registration.Edition !== details.edition
      || registration.PortalUrl !== portalUrl || registration.CloudflareProject + '.pages.dev' !== details.portalHost
      || !activeTenantControlRecord(registration)
      || !await verifyTenantControlRequest(registration.TenantControlPublicKey, details, signature)) throw denied();
  await assertTenantProjectAssignment(platform, registration.CloudflareProject, {
    workspaceId: details.workspaceId, registrationReference: registration.Reference });
  const email = String(registration.Email || '').trim().toLowerCase();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) || email.length > 254) throw denied();
  const binding = await tenantControlSecretHash(JSON.stringify([details.workspaceId, details.edition,
    registration.Reference, details.activationId, registration.AdminUsername, email]));
  const receipt = await createDocumentIfAbsent(platform, 'tenantControlRequests', details.requestId, {
    Action: details.action, WorkspaceId: details.workspaceId, IssuedAt: details.issuedAt,
    ExpiresAt: new Date(Date.now() + 86400000).toISOString() });
  if (!receipt.created) throw denied();
  if (details.action === 'check-owner-recovery') return { binding, email };
  const code = Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, '0')).join('');
  const sender = env.DYNAMAX_SENDER_EMAIL || env.BREVO_SENDER_EMAIL;
  if (!sender || !env.BREVO_API_KEY) throw new Error('Owner recovery delivery unavailable.');
  const introduction = 'A password reset was requested for the original administrator of ' + details.portalHost + '.';
  const instructions = 'Enter the code only on that portal within 15 minutes. If you did not request this reset, ignore this email.';
  await sendConfiguredEmail(env, { toEmail: email, subject: 'Verify ownership for administrator recovery',
    textContent: introduction + '\n\nYour one-time code is:\n' + code + '\n\n' + instructions,
    htmlContent: '<p>' + escapeEmailHtml(introduction) + '</p><p>Your one-time code is:</p><p><strong>' +
      escapeEmailHtml(code) + '</strong></p><p>' + instructions + '</p>',
    providerOverride: 'brevo', senderOverride: { email: sender, name: env.DYNAMAX_SENDER_NAME || 'Dynamax' } });
  return { binding, codeHash: await tenantControlSecretHash(code) };
}

export async function onRequestPost({ request, env }) {
  try {
    const signature = request.headers.get('X-Dynamax-Tenant-Signature');
    if (!signature) throw denied();
    const details = await readJsonBody(request, { maxBytes: 4096 });
    return reply({ ok: true, ...await registeredOwnerRecovery(env, details, signature) });
  } catch (error) {
    return reply({ ok: false, message: 'Owner recovery could not be confirmed.' }, error.status === 403 ? 403 : 503);
  }
}
