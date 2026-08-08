import {
  batchCommitDocuments,
  createDocumentIfAbsent,
  getDocument,
  patchDocumentFields,
  patchDocumentFieldsIfCurrent
} from './firestore.js';

export const TENANT_ACTIVATION_COLLECTION = 'tenantActivations';
export const TENANT_ACTIVATION_TTL_HOURS = 48;
export const TENANT_ACTIVATION_CLAIM_MINUTES = 10;

const encoder = new TextEncoder();
const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();

function withoutFirestoreMetadata(document = {}) {
  const value = { ...document };
  delete value.__id;
  delete value.__name;
  delete value.__createTime;
  delete value.__updateTime;
  return value;
}

function bytesToBase64Url(value) {
  let binary = '';
  new Uint8Array(value).forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function secureEqual(left, right) {
  const a = encoder.encode(String(left || ''));
  const b = encoder.encode(String(right || ''));
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) difference |= (a[index] || 0) ^ (b[index] || 0);
  return difference === 0;
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value));
}

function activationError(message, status = 400, code = 'TENANT_ACTIVATION_INVALID') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function portalDetails(value) {
  let url;
  try { url = new URL(clean(value)); } catch (_error) { url = null; }
  if (!url || url.protocol !== 'https:' || url.username || url.password) {
    throw activationError('The assigned organisation portal URL is invalid.', 503, 'TENANT_PORTAL_INVALID');
  }
  return { origin: url.origin, hostname: lower(url.hostname) };
}

function activeRegistration(registration = {}) {
  const statuses = [registration.Status, registration.SubscriptionStatus, registration.PaymentStatus].map(lower);
  return statuses.some((status) => [
    'active', 'paid', 'payment confirmed', 'trial active', 'trialing', 'free trial'
  ].includes(status));
}

function publicActivationRegistration(registration = {}) {
  return {
    registrationReference: clean(registration.Reference || registration.__id),
    workspaceId: clean(registration.WorkspaceId),
    portalUrl: clean(registration.PortalUrl),
    organisationName: clean(registration.OrganisationName),
    contactName: clean(registration.ContactName),
    email: lower(registration.Email),
    phone: clean(registration.Phone),
    country: clean(registration.Country),
    edition: clean(registration.Edition),
    plan: clean(registration.Plan),
    billingCycle: clean(registration.BillingCycle),
    userLimit: Math.max(1, Number(registration.UserLimit || 5) || 5),
    planEntitlements: registration.FeatureEntitlements ?? registration.PlanEntitlements ?? null,
    planCatalogRevision: clean(registration.PlanCatalogRevision),
    subscriptionStatus: clean(registration.SubscriptionStatus),
    trialStartedAt: clean(registration.TrialStartedAt),
    trialEndsAt: clean(registration.TrialEndsAt)
  };
}

export async function hashTenantActivationToken(token) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(String(token || '')));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function tenantActivationUrl(portalUrl, activationId, token) {
  const url = new URL('/activate-account.html', portalDetails(portalUrl).origin);
  url.hash = new URLSearchParams({ activation: clean(activationId), token: clean(token) }).toString();
  return url.href;
}

async function sendPlatformActivationEmail(env, registration, activationUrl) {
  const apiKey = clean(env.BREVO_API_KEY);
  const senderEmail = clean(env.DYNAMAX_SENDER_EMAIL || env.BREVO_SENDER_EMAIL);
  const senderName = clean(env.DYNAMAX_SENDER_NAME || env.BREVO_SENDER_NAME || 'Dynamax');
  if (!apiKey || !validEmail(senderEmail)) {
    return { sent: false, status: 'Email service not configured' };
  }
  const recipient = lower(registration.Email);
  if (!validEmail(recipient)) return { sent: false, status: 'Recipient email is invalid' };
  const organisation = clean(registration.OrganisationName) || 'your organisation';
  const contact = clean(registration.ContactName) || 'Administrator';
  const escapeHtml = (value) => clean(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { accept: 'application/json', 'api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      sender: { name: senderName, email: senderEmail },
      to: [{ name: contact, email: recipient }],
      subject: `Activate your ${organisation} Dynamax administrator account`,
      textContent: `Hello ${contact},\n\nYour Dynamax workspace for ${organisation} is ready. Create the first Super Administrator account using this secure link:\n${activationUrl}\n\nThe link expires in ${TENANT_ACTIVATION_TTL_HOURS} hours and can be used only once. If you did not register this organisation, ignore this message.`,
      htmlContent: `<p>Hello ${escapeHtml(contact)},</p><p>Your Dynamax workspace for <strong>${escapeHtml(organisation)}</strong> is ready.</p><p><a href="${escapeHtml(activationUrl)}" style="display:inline-block;padding:11px 16px;border-radius:8px;background:#126fe8;color:#fff;text-decoration:none;font-weight:700">Create administrator account</a></p><p>This secure link expires in ${TENANT_ACTIVATION_TTL_HOURS} hours and can be used only once.</p><p>If you did not register this organisation, ignore this message.</p>`
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      sent: false,
      status: clean(data.message || `Email provider rejected the message (${response.status}).`).slice(0, 240)
    };
  }
  return { sent: true, status: 'Sent', providerMessageId: clean(data.messageId) };
}

export async function issueTenantActivation(platformEnv, registration = {}, deliveryEnv = platformEnv) {
  const reference = clean(registration.Reference || registration.__id);
  if (!reference || !clean(registration.WorkspaceId) || !clean(registration.PortalUrl)) {
    return { issued: false, reason: 'workspace-not-ready' };
  }
  if (!activeRegistration(registration)) return { issued: false, reason: 'subscription-not-active' };
  if (clean(registration.AdminActivatedAt)) {
    return {
      issued: false,
      alreadyActivated: true,
      loginUrl: new URL('/admin.html', portalDetails(registration.PortalUrl).origin).href
    };
  }

  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = bytesToBase64Url(tokenBytes);
  const tokenHash = await hashTenantActivationToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TENANT_ACTIVATION_TTL_HOURS * 60 * 60 * 1000);
  let activationId = '';
  let created = null;
  for (let attempt = 0; attempt < 3 && !created?.created; attempt += 1) {
    activationId = `ACT-${Date.now()}-${crypto.randomUUID().slice(0, 10).toUpperCase()}`;
    created = await createDocumentIfAbsent(platformEnv, TENANT_ACTIVATION_COLLECTION, activationId, {
      ActivationId: activationId,
      RegistrationReference: reference,
      WorkspaceId: clean(registration.WorkspaceId),
      PortalUrl: clean(registration.PortalUrl),
      TokenHash: tokenHash,
      Status: 'Pending',
      ExpiresAt: expiresAt.toISOString(),
      CreatedAt: now.toISOString(),
      UpdatedAt: now.toISOString(),
      EmailStatus: 'Pending'
    });
  }
  if (!created?.created) throw activationError('A secure activation link could not be created. Try again.', 503, 'TENANT_ACTIVATION_CREATE_FAILED');

  const activationUrl = tenantActivationUrl(registration.PortalUrl, activationId, token);
  let delivery = { sent: false, status: 'Email delivery was not attempted' };
  const recentEmailAt = Date.parse(clean(registration.ActivationEmailSentAt));
  if (Number.isFinite(recentEmailAt) && recentEmailAt > Date.now() - 5 * 60 * 1000) {
    delivery = { sent: false, status: 'Activation email was sent recently; duplicate delivery skipped' };
  } else {
    try {
      delivery = await sendPlatformActivationEmail(deliveryEnv, registration, activationUrl);
    } catch (error) {
      delivery = { sent: false, status: clean(error.message || error).slice(0, 240) };
    }
  }
  const emailSentAt = delivery.sent ? new Date().toISOString() : clean(registration.ActivationEmailSentAt);
  await Promise.all([
    patchDocumentFields(platformEnv, TENANT_ACTIVATION_COLLECTION, activationId, {
      EmailStatus: delivery.status,
      EmailSentAt: emailSentAt,
      EmailProviderMessageId: clean(delivery.providerMessageId),
      UpdatedAt: new Date().toISOString()
    }).catch(() => null),
    patchDocumentFields(platformEnv, 'tenantRegistrations', reference, {
      ActivationStatus: 'Awaiting first administrator',
      LastActivationIssuedAt: now.toISOString(),
      ActivationEmailStatus: delivery.status,
      ActivationEmailSentAt: emailSentAt,
      UpdatedAt: new Date().toISOString()
    }).catch(() => null)
  ]);
  return { issued: true, activationId, activationUrl, expiresAt: expiresAt.toISOString(), emailSent: delivery.sent, emailStatus: delivery.status };
}

async function validActivation(platformEnv, { activationId, token, portalHost, allowUsed = false } = {}) {
  const id = clean(activationId);
  if (!id || !clean(token)) throw activationError('The activation link is incomplete.', 400, 'TENANT_ACTIVATION_INCOMPLETE');
  const activation = await getDocument(platformEnv, TENANT_ACTIVATION_COLLECTION, id);
  if (!activation || !secureEqual(await hashTenantActivationToken(token), clean(activation.TokenHash))) {
    throw activationError('This activation link is invalid.', 404, 'TENANT_ACTIVATION_NOT_FOUND');
  }
  if (Date.parse(clean(activation.ExpiresAt)) <= Date.now()) {
    throw activationError('This activation link has expired. Repeat the organisation registration to receive a new link.', 410, 'TENANT_ACTIVATION_EXPIRED');
  }
  if (!allowUsed && lower(activation.Status) === 'used') {
    throw activationError('This activation link has already been used. Sign in with the administrator account.', 409, 'TENANT_ACTIVATION_USED');
  }
  const registration = await getDocument(platformEnv, 'tenantRegistrations', clean(activation.RegistrationReference));
  if (!registration || clean(registration.WorkspaceId) !== clean(activation.WorkspaceId)) {
    throw activationError('The activation link is no longer attached to this workspace.', 409, 'TENANT_ACTIVATION_WORKSPACE_CHANGED');
  }
  if (clean(registration.AdminActivatedAt) && lower(activation.Status) !== 'used') {
    throw activationError('The first administrator has already been created. Sign in to the organisation portal.', 409, 'TENANT_ADMIN_ALREADY_ACTIVATED');
  }
  const expectedPortal = portalDetails(registration.PortalUrl);
  if (!clean(portalHost) || lower(portalHost) !== expectedPortal.hostname) {
    throw activationError('Open this activation link from the assigned organisation portal.', 409, 'TENANT_ACTIVATION_PORTAL_MISMATCH');
  }
  if (!activeRegistration(registration)) {
    throw activationError('The organisation subscription is not active yet.', 402, 'TENANT_ACTIVATION_SUBSCRIPTION_REQUIRED');
  }
  return { activation, registration };
}

export async function inspectTenantActivation(platformEnv, details = {}) {
  const { activation, registration } = await validActivation(platformEnv, details);
  return {
    activationId: clean(activation.ActivationId || activation.__id),
    expiresAt: clean(activation.ExpiresAt),
    ...publicActivationRegistration(registration)
  };
}

export async function claimTenantActivation(platformEnv, details = {}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { activation, registration } = await validActivation(platformEnv, details);
    const claimedUntil = Date.parse(clean(activation.ClaimExpiresAt));
    if (lower(activation.Status) === 'claimed' && claimedUntil > Date.now() && clean(activation.ClaimId)) {
      return { claimId: clean(activation.ClaimId), claimExpiresAt: clean(activation.ClaimExpiresAt), ...publicActivationRegistration(registration) };
    }
    const claimId = crypto.randomUUID();
    const claimExpiresAt = new Date(Date.now() + TENANT_ACTIVATION_CLAIM_MINUTES * 60 * 1000).toISOString();
    try {
      await patchDocumentFieldsIfCurrent(platformEnv, TENANT_ACTIVATION_COLLECTION, clean(activation.__id), {
        Status: 'Claimed', ClaimId: claimId, ClaimExpiresAt: claimExpiresAt, UpdatedAt: new Date().toISOString()
      }, activation);
      return { claimId, claimExpiresAt, ...publicActivationRegistration(registration) };
    } catch (error) {
      if (error?.code === 'FIRESTORE_WRITE_CONFLICT') continue;
      throw error;
    }
  }
  throw activationError('The activation link is being used in another request. Try again.', 409, 'TENANT_ACTIVATION_BUSY');
}

export async function releaseTenantActivationClaim(platformEnv, details = {}) {
  const { activation } = await validActivation(platformEnv, details);
  if (lower(activation.Status) !== 'claimed' || clean(activation.ClaimId) !== clean(details.claimId)) return false;
  await patchDocumentFieldsIfCurrent(platformEnv, TENANT_ACTIVATION_COLLECTION, clean(activation.__id), {
    Status: 'Pending', ClaimId: '', ClaimExpiresAt: '', UpdatedAt: new Date().toISOString()
  }, activation);
  return true;
}

export async function completeTenantActivation(platformEnv, details = {}) {
  const { activation, registration } = await validActivation(platformEnv, { ...details, allowUsed: true });
  if (lower(activation.Status) === 'used' && clean(registration.AdminActivatedAt)) {
    return { completed: true, alreadyCompleted: true, ...publicActivationRegistration(registration) };
  }
  if (lower(activation.Status) !== 'claimed' || clean(activation.ClaimId) !== clean(details.claimId)
      || Date.parse(clean(activation.ClaimExpiresAt)) <= Date.now()) {
    throw activationError('The activation claim expired. Reload the link and try again.', 409, 'TENANT_ACTIVATION_CLAIM_EXPIRED');
  }
  const completedAt = new Date().toISOString();
  await batchCommitDocuments(platformEnv, [
    {
      collectionPath: TENANT_ACTIVATION_COLLECTION,
      documentId: clean(activation.__id),
      data: { ...withoutFirestoreMetadata(activation), Status: 'Used', UsedAt: completedAt, UpdatedAt: completedAt },
      updateTime: activation.__updateTime
    },
    {
      collectionPath: 'tenantRegistrations',
      documentId: clean(registration.__id || registration.Reference),
      data: {
        ...withoutFirestoreMetadata(registration),
        ActivationStatus: 'Administrator activated',
        AdminActivatedAt: completedAt,
        AdminUsername: clean(details.username),
        UpdatedAt: completedAt
      },
      updateTime: registration.__updateTime
    }
  ]);
  return { completed: true, completedAt, ...publicActivationRegistration(registration) };
}
