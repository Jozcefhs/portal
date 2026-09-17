import {
  batchCommitDocuments,
  createDocumentIfAbsent,
  getDocument,
  patchDocumentFields,
  patchDocumentFieldsIfCurrent
} from './firestore.js';
import { sendConfiguredEmail } from './email-service.js';

export const TENANT_ACTIVATION_COLLECTION = 'tenantActivations';
export const TENANT_ACTIVATION_TTL_HOURS = 48;
export const TENANT_ACTIVATION_CLAIM_MINUTES = 10;
export const TENANT_ACTIVATION_EMAIL_CLAIM_MINUTES = 10;

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

function timestamp(value) {
  const parsed = Date.parse(clean(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function activationEmailDeliveryDecision(registration = {}, now = Date.now()) {
  const state = lower(registration.ActivationEmailDeliveryStatus);
  const activationExpiresAt = timestamp(registration.ActivationEmailActivationExpiresAt);
  const activationStillUsable = activationExpiresAt ? activationExpiresAt > now : true;
  if (clean(registration.AdminActivatedAt)) {
    return { shouldSend: false, status: 'Completed', reason: 'The administrator account is already active.' };
  }
  if (state === 'sent' && activationStillUsable) {
    return { shouldSend: false, status: 'Sent', reason: 'Activation email was already sent; duplicate delivery skipped.' };
  }
  if (state === 'uncertain' && activationStillUsable) {
    return {
      shouldSend: false,
      status: 'Uncertain',
      reason: clean(registration.ActivationEmailMessage)
        || 'The previous email outcome is uncertain; automatic resend is suppressed to prevent a duplicate.'
    };
  }
  if (state === 'sending' && activationStillUsable) {
    const startedAt = timestamp(registration.ActivationEmailDeliveryStartedAt);
    const stale = !startedAt || startedAt <= now - TENANT_ACTIVATION_EMAIL_CLAIM_MINUTES * 60 * 1000;
    return stale
      ? {
          shouldSend: false,
          status: 'Uncertain',
          markUncertain: true,
          reason: 'The previous activation email attempt did not reach a durable provider result; automatic resend is suppressed.'
        }
      : {
          shouldSend: false,
          status: 'Sending',
          reason: 'Another request is already delivering the activation email.'
        };
  }
  if (state === 'failed' && registration.ActivationEmailRetrySafe === false && activationStillUsable) {
    return {
      shouldSend: false,
      status: 'Uncertain',
      markUncertain: true,
      reason: clean(registration.ActivationEmailMessage)
        || 'The previous provider outcome is not safe to retry automatically.'
    };
  }
  const legacySentAt = timestamp(registration.ActivationEmailSentAt);
  const legacyStillUsable = legacySentAt
    && legacySentAt + TENANT_ACTIVATION_TTL_HOURS * 60 * 60 * 1000 > now;
  if (!state && legacyStillUsable) {
    return { shouldSend: false, status: 'Sent', reason: 'Activation email was already sent; duplicate delivery skipped.' };
  }
  return { shouldSend: true, status: 'Pending', reason: '' };
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
    return {
      sent: false,
      status: 'Failed',
      message: 'Email service not configured',
      provider: 'brevo',
      retrySafe: true,
      deliveryUncertain: false
    };
  }
  const recipient = lower(registration.Email);
  if (!validEmail(recipient)) {
    return {
      sent: false,
      status: 'Failed',
      message: 'Recipient email is invalid',
      provider: 'brevo',
      retrySafe: true,
      deliveryUncertain: false
    };
  }
  const organisation = clean(registration.OrganisationName) || 'your organisation';
  const contact = clean(registration.ContactName) || 'Administrator';
  const escapeHtml = (value) => clean(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
  const delivery = await sendConfiguredEmail(env, {
    toEmail: recipient,
    toName: contact,
    subject: `Activate your ${organisation} Dynamax administrator account`,
    textContent: `Hello ${contact},\n\nYour Dynamax workspace for ${organisation} is ready. Create the first Super Administrator account using this secure link:\n${activationUrl}\n\nThe link expires in ${TENANT_ACTIVATION_TTL_HOURS} hours and can be used only once. If you did not register this organisation, ignore this message.`,
    htmlContent: `<p>Hello ${escapeHtml(contact)},</p><p>Your Dynamax workspace for <strong>${escapeHtml(organisation)}</strong> is ready.</p><p><a href="${escapeHtml(activationUrl)}" style="display:inline-block;padding:11px 16px;border-radius:8px;background:#126fe8;color:#fff;text-decoration:none;font-weight:700">Create administrator account</a></p><p>This secure link expires in ${TENANT_ACTIVATION_TTL_HOURS} hours and can be used only once.</p><p>If you did not register this organisation, ignore this message.</p>`,
    providerOverride: 'brevo',
    senderOverride: { email: senderEmail, name: senderName }
  });
  return {
    sent: true,
    status: 'Sent',
    provider: delivery.provider,
    providerMessageId: clean(delivery.providerMessageId),
    message: 'Sent',
    retrySafe: false,
    deliveryUncertain: false
  };
}

async function claimActivationEmailDelivery(platformEnv, reference, activationId, activationExpiresAt) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await getDocument(platformEnv, 'tenantRegistrations', reference);
    if (!current) {
      throw activationError('The organisation registration could not be found.', 404, 'TENANT_REGISTRATION_NOT_FOUND');
    }
    const decision = activationEmailDeliveryDecision(current);
    if (!decision.shouldSend) {
      if (decision.markUncertain) {
        try {
          const updated = await patchDocumentFieldsIfCurrent(platformEnv, 'tenantRegistrations', reference, {
            ActivationEmailDeliveryStatus: 'Uncertain',
            ActivationEmailStatus: 'Uncertain',
            ActivationEmailDeliveryUncertain: true,
            ActivationEmailRetrySafe: false,
            ActivationEmailMessage: decision.reason,
            ActivationEmailDeliveryCompletedAt: new Date().toISOString(),
            UpdatedAt: new Date().toISOString()
          }, current);
          return { claimed: false, decision, registration: updated };
        } catch (error) {
          if (error?.code === 'FIRESTORE_WRITE_CONFLICT') continue;
          throw error;
        }
      }
      return { claimed: false, decision, registration: current };
    }
    const attemptId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    try {
      const updated = await patchDocumentFieldsIfCurrent(platformEnv, 'tenantRegistrations', reference, {
        ActivationStatus: 'Awaiting first administrator',
        LastActivationIssuedAt: startedAt,
        ActivationEmailDeliveryStatus: 'Sending',
        ActivationEmailStatus: 'Sending',
        ActivationEmailDeliveryAttemptId: attemptId,
        ActivationEmailDeliveryStartedAt: startedAt,
        ActivationEmailDeliveryCompletedAt: '',
        ActivationEmailActivationId: activationId,
        ActivationEmailActivationExpiresAt: activationExpiresAt,
        ActivationEmailDeliveryUncertain: false,
        ActivationEmailRetrySafe: false,
        ActivationEmailMessage: 'Activation email delivery is in progress.',
        ActivationEmailProviderMessageId: '',
        UpdatedAt: startedAt
      }, current);
      return { claimed: true, attemptId, startedAt, registration: updated };
    } catch (error) {
      if (error?.code === 'FIRESTORE_WRITE_CONFLICT') continue;
      throw error;
    }
  }
  return {
    claimed: false,
    decision: {
      shouldSend: false,
      status: 'Sending',
      reason: 'Another request is already preparing the activation email.'
    }
  };
}

async function finishActivationEmailDelivery(platformEnv, reference, attemptId, delivery = {}) {
  const finalStatus = delivery.sent
    ? 'Sent'
    : (delivery.deliveryUncertain === true || delivery.retrySafe === false ? 'Uncertain' : 'Failed');
  const completedAt = new Date().toISOString();
  const message = clean(delivery.message || delivery.status)
    || (finalStatus === 'Uncertain'
      ? 'The provider did not confirm whether it accepted the activation email.'
      : finalStatus);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await getDocument(platformEnv, 'tenantRegistrations', reference);
    if (!current || clean(current.ActivationEmailDeliveryAttemptId) !== clean(attemptId)) {
      return { updated: false, status: finalStatus, message, registration: current };
    }
    const fields = {
      ActivationStatus: 'Awaiting first administrator',
      ActivationEmailDeliveryStatus: finalStatus,
      ActivationEmailStatus: finalStatus,
      ActivationEmailDeliveryUncertain: finalStatus === 'Uncertain',
      ActivationEmailRetrySafe: finalStatus === 'Failed' && delivery.retrySafe === true,
      ActivationEmailMessage: message.slice(0, 240),
      ActivationEmailProvider: clean(delivery.provider),
      ActivationEmailProviderMessageId: clean(delivery.providerMessageId),
      ActivationEmailDeliveryCompletedAt: completedAt,
      ...(delivery.sent ? { ActivationEmailSentAt: completedAt } : {}),
      UpdatedAt: completedAt
    };
    try {
      const updated = await patchDocumentFieldsIfCurrent(
        platformEnv,
        'tenantRegistrations',
        reference,
        fields,
        current
      );
      return { updated: true, status: finalStatus, message, completedAt, registration: updated };
    } catch (error) {
      if (error?.code === 'FIRESTORE_WRITE_CONFLICT') continue;
      throw error;
    }
  }
  return { updated: false, status: finalStatus, message };
}

export async function issueTenantActivation(platformEnv, registration = {}, deliveryEnv = platformEnv) {
  const reference = clean(registration.Reference || registration.__id);
  if (!reference) return { issued: false, reason: 'workspace-not-ready' };
  const authoritativeRegistration = await getDocument(platformEnv, 'tenantRegistrations', reference);
  if (!authoritativeRegistration
      || !clean(authoritativeRegistration.WorkspaceId)
      || !clean(authoritativeRegistration.PortalUrl)) {
    return { issued: false, reason: 'workspace-not-ready' };
  }
  registration = authoritativeRegistration;
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
  const emailClaim = await claimActivationEmailDelivery(
    platformEnv,
    reference,
    activationId,
    expiresAt.toISOString()
  );
  if (!emailClaim.claimed) {
    const decision = emailClaim.decision || {
      status: 'Sending',
      reason: 'Another request is already preparing the activation email.'
    };
    await patchDocumentFields(platformEnv, TENANT_ACTIVATION_COLLECTION, activationId, {
      EmailStatus: decision.status,
      EmailDeliverySuppressed: true,
      EmailDeliveryUncertain: decision.status === 'Uncertain',
      EmailRetrySafe: false,
      EmailMessage: clean(decision.reason).slice(0, 240),
      UpdatedAt: new Date().toISOString()
    }).catch(() => null);
    if (decision.status === 'Completed') {
      return {
        issued: false,
        alreadyActivated: true,
        loginUrl: new URL('/admin.html', portalDetails(registration.PortalUrl).origin).href
      };
    }
    return {
      issued: true,
      activationId,
      activationUrl,
      expiresAt: expiresAt.toISOString(),
      emailSent: false,
      emailStatus: decision.status,
      emailMessage: clean(decision.reason),
      emailDeliverySuppressed: true,
      emailDeliveryUncertain: decision.status === 'Uncertain'
    };
  }
  await patchDocumentFields(platformEnv, TENANT_ACTIVATION_COLLECTION, activationId, {
    EmailStatus: 'Sending',
    EmailAttemptId: emailClaim.attemptId,
    EmailDeliveryStartedAt: emailClaim.startedAt,
    EmailDeliveryUncertain: false,
    EmailRetrySafe: false,
    UpdatedAt: emailClaim.startedAt
  }).catch(() => null);

  let delivery;
  try {
    delivery = await sendPlatformActivationEmail(deliveryEnv, emailClaim.registration || registration, activationUrl);
  } catch (error) {
    const deliveryUncertain = error?.deliveryUncertain === true || error?.retrySafe !== true;
    delivery = {
      sent: false,
      status: deliveryUncertain ? 'Uncertain' : 'Failed',
      message: clean(error?.message || error).slice(0, 240),
      provider: clean(error?.provider),
      providerMessageId: clean(error?.providerMessageId),
      retrySafe: !deliveryUncertain && error?.retrySafe === true,
      deliveryUncertain
    };
  }
  const completed = await finishActivationEmailDelivery(
    platformEnv,
    reference,
    emailClaim.attemptId,
    delivery
  );
  const finalStatus = completed.status || (delivery.sent ? 'Sent' : 'Uncertain');
  const deliveryUncertain = finalStatus === 'Uncertain';
  await patchDocumentFields(platformEnv, TENANT_ACTIVATION_COLLECTION, activationId, {
    EmailStatus: finalStatus,
    EmailSentAt: delivery.sent ? clean(completed.completedAt) : '',
    EmailProvider: clean(delivery.provider),
    EmailProviderMessageId: clean(delivery.providerMessageId),
    EmailDeliveryUncertain: deliveryUncertain,
    EmailRetrySafe: finalStatus === 'Failed' && delivery.retrySafe === true,
    EmailMessage: clean(completed.message || delivery.message).slice(0, 240),
    EmailDeliveryCompletedAt: clean(completed.completedAt),
    UpdatedAt: clean(completed.completedAt) || new Date().toISOString()
  }).catch(() => null);
  return {
    issued: true,
    activationId,
    activationUrl,
    expiresAt: expiresAt.toISOString(),
    emailSent: delivery.sent === true && finalStatus === 'Sent',
    emailStatus: finalStatus,
    emailMessage: clean(completed.message || delivery.message),
    emailDeliveryUncertain: deliveryUncertain,
    emailRetrySafe: finalStatus === 'Failed' && delivery.retrySafe === true
  };
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
