import {
  batchCommitDocuments,
  createDocumentIfAbsent,
  getDocument,
  listCollection,
  patchDocumentFieldsIfCurrent,
  queryCollection,
  upsertDocument
} from './firestore.js';
import { escapeEmailHtml, sendConfiguredEmail } from './email-service.js';
import { normalizeOrganizationEdition } from './organization-config.js';

export const TENANT_RETIREMENT_REQUEST_COLLECTION = 'tenantRetirementRequests';
export const TENANT_TRIAL_TOMBSTONE_COLLECTION = 'tenantTrialTombstones';
export const TENANT_LIFECYCLE_EMAIL_COLLECTION = 'tenantLifecycleEmailDeliveries';
export const TRIAL_DATA_RETENTION_DAYS = 30;
const RETIREMENT_LEASE_MINUTES = 90;
const MAX_RETIREMENT_ATTEMPTS = 3;

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

export function publicTenantRetirementRequest(request = {}) {
  return {
    Reference: clean(request.Reference || request.__id),
    RegistrationReference: clean(request.RegistrationReference),
    ProjectSlotId: clean(request.ProjectSlotId),
    Edition: normalizeOrganizationEdition(request.Edition),
    FirebaseProjectId: clean(request.FirebaseProjectId),
    CloudflareProject: clean(request.CloudflareProject),
    Status: clean(request.Status || 'Pending'),
    Attempts: Math.max(0, Number(request.Attempts || 0)),
    RequestedAt: clean(request.RequestedAt),
    StartedAt: clean(request.StartedAt),
    CompletedAt: clean(request.CompletedAt),
    NextAttemptAt: clean(request.NextAttemptAt),
    LastError: clean(request.LastError)
  };
}

function timestampMilliseconds(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const seconds = Number(value.seconds ?? value._seconds);
    if (Number.isFinite(seconds)) return (seconds * 1000) + Math.floor(Number(value.nanoseconds ?? value._nanoseconds ?? 0) / 1000000);
  }
  const parsed = Date.parse(clean(value));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function isoDate(value) {
  const milliseconds = timestampMilliseconds(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : '';
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lower(value));
}

function safeReference(value, fallback = '') {
  return lower(value)
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 120) || fallback;
}

function changedFields(document = {}, fields = {}) {
  return Object.fromEntries(Object.entries(fields).filter(([key, value]) => {
    if (Array.isArray(value) || (value && typeof value === 'object')) {
      return JSON.stringify(document[key] ?? null) !== JSON.stringify(value);
    }
    return clean(document[key]) !== clean(value);
  }));
}

export async function tenantTrialFingerprint(organisationName, email) {
  const source = `${lower(organisationName).replace(/[^a-z0-9]+/g, '')}|${lower(email)}`;
  if (source === '|') return '';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function trialLifecycleWindow(registration = {}, now = Date.now()) {
  const plan = lower(registration.Plan || registration.SubscriptionPlan);
  const trialEndsMs = timestampMilliseconds(registration.TrialEndsAt);
  const nowMs = timestampMilliseconds(now);
  if (plan !== 'free' || !Number.isFinite(trialEndsMs) || !Number.isFinite(nowMs)) {
    return { applicable: false, stage: 'not_applicable', trialEndsAt: '', retentionEndsAt: '', remainingDays: 0 };
  }
  const savedRetentionMs = timestampMilliseconds(registration.DataRetentionEndsAt);
  const retentionEndsMs = Number.isFinite(savedRetentionMs)
    ? savedRetentionMs
    : trialEndsMs + (TRIAL_DATA_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const remainingDays = Math.max(0, Math.ceil((retentionEndsMs - nowMs) / (24 * 60 * 60 * 1000)));
  return {
    applicable: true,
    stage: nowMs < trialEndsMs ? 'trialing' : nowMs < retentionEndsMs ? 'suspended' : 'retirement_due',
    trialEndsAt: new Date(trialEndsMs).toISOString(),
    retentionEndsAt: new Date(retentionEndsMs).toISOString(),
    remainingDays
  };
}

export async function recordTrialUseTombstone(platformEnv, registration = {}, overrides = {}) {
  const fingerprint = clean(overrides.Fingerprint || registration.TrialFingerprint)
    || await tenantTrialFingerprint(registration.OrganisationName, registration.Email);
  if (!fingerprint) return null;
  const now = new Date().toISOString();
  const existing = await getDocument(platformEnv, TENANT_TRIAL_TOMBSTONE_COLLECTION, fingerprint).catch(() => null);
  const tombstone = {
    Fingerprint: fingerprint,
    RegistrationReference: clean(registration.Reference || registration.__id || existing?.RegistrationReference),
    Edition: normalizeOrganizationEdition(registration.Edition || existing?.Edition),
    TrialStartedAt: clean(registration.TrialStartedAt || existing?.TrialStartedAt),
    TrialEndsAt: clean(registration.TrialEndsAt || existing?.TrialEndsAt),
    FirstRecordedAt: clean(existing?.FirstRecordedAt) || now,
    LastRecordedAt: now,
    Status: clean(overrides.Status || existing?.Status || 'Trial Used'),
    RetiredAt: clean(overrides.RetiredAt || existing?.RetiredAt)
  };
  await upsertDocument(platformEnv, TENANT_TRIAL_TOMBSTONE_COLLECTION, fingerprint, tombstone);
  return tombstone;
}

export async function findTrialUseTombstone(platformEnv, organisationName, email) {
  const fingerprint = await tenantTrialFingerprint(organisationName, email);
  return fingerprint ? getDocument(platformEnv, TENANT_TRIAL_TOMBSTONE_COLLECTION, fingerprint).catch(() => null) : null;
}

function noticeForWindow(registration, window) {
  if (window.stage !== 'suspended') return '';
  if (window.remainingDays <= 1 && !clean(registration.DeletionWarning1DaySentAt)) return 'deletion-1-day';
  if (window.remainingDays <= 7 && !clean(registration.DeletionWarning7DaySentAt)) return 'deletion-7-day';
  if (!clean(registration.TrialExpiryNoticeSentAt)) return 'trial-expired';
  return '';
}

function noticeFields(notice, now) {
  if (notice === 'deletion-1-day') {
    return {
      TrialExpiryNoticeSentAt: now,
      DeletionWarning7DaySentAt: now,
      DeletionWarning1DaySentAt: now
    };
  }
  if (notice === 'deletion-7-day') {
    return { TrialExpiryNoticeSentAt: now, DeletionWarning7DaySentAt: now };
  }
  return notice === 'trial-expired' ? { TrialExpiryNoticeSentAt: now } : {};
}

function lifecycleEmail(registration, window, notice) {
  const organisation = clean(registration.OrganisationName) || 'your organisation';
  const portalUrl = clean(registration.PortalUrl);
  const billingUrl = portalUrl ? `${portalUrl.replace(/\/$/, '')}/admin.html#subscription` : '';
  const deletionDate = new Date(window.retentionEndsAt).toLocaleDateString('en-NG', {
    day: 'numeric', month: 'long', year: 'numeric'
  });
  const heading = notice === 'trial-expired'
    ? 'Your Dynamax free trial has ended'
    : notice === 'deletion-7-day'
      ? 'Your Dynamax workspace will be deleted in 7 days'
      : 'Final notice: your Dynamax workspace will be deleted within 24 hours';
  const detail = notice === 'trial-expired'
    ? `The 7-day free trial for ${organisation} has ended. Your operational modules are suspended, but your data will be retained until ${deletionDate}.`
    : `The suspended workspace for ${organisation} is scheduled for permanent deletion on ${deletionDate}. Upgrade before then to preserve the workspace and its records.`;
  const action = billingUrl ? ` Upgrade securely at ${billingUrl}.` : ' Sign in to your Dynamax account and choose a paid plan to retain the workspace.';
  return {
    subject: heading,
    textContent: `${heading}\n\n${detail}${action}\n\nAfter deletion, Dynamax operational records and access to linked document records cannot be recovered. Files held in an external storage account remain governed by that account owner.`,
    htmlContent: `<h2>${escapeEmailHtml(heading)}</h2><p>${escapeEmailHtml(detail)}</p><p>${escapeEmailHtml(action)}</p><p><strong>After deletion, Dynamax operational records and access to linked document records cannot be recovered.</strong> Files held in an external storage account remain governed by that account owner.</p>`
  };
}

async function deliverLifecycleNotice(platformEnv, registration, window, notice, emailSender) {
  const registrationReference = clean(registration.Reference || registration.__id);
  const deliveryId = `${safeReference(registrationReference, 'registration')}-${notice}`;
  const recipient = lower(registration.Email || registration.ContactEmail || registration.AdminEmail);
  const now = new Date().toISOString();
  const recipientHash = await tenantTrialFingerprint('', recipient);
  const created = await createDocumentIfAbsent(platformEnv, TENANT_LIFECYCLE_EMAIL_COLLECTION, deliveryId, {
    DeliveryId: deliveryId,
    RegistrationReference: registrationReference,
    Notice: notice,
    RecipientHash: recipientHash,
    Status: 'Sending',
    Attempt: 1,
    CreatedAt: now,
    UpdatedAt: now
  });
  let delivery = created.document || {};
  if (!created.created) {
    const status = lower(delivery.Status);
    if (status === 'sent') return { sent: true, sentAt: clean(delivery.SentAt || delivery.UpdatedAt) };
    if (['sending', 'uncertain'].includes(status)) return { sent: false, blocked: true };
    const updatedMs = timestampMilliseconds(delivery.UpdatedAt || delivery.CreatedAt);
    if (status !== 'failed' || (Number.isFinite(updatedMs) && updatedMs > Date.now() - (6 * 60 * 60 * 1000))) {
      return { sent: false, blocked: true };
    }
    try {
      delivery = await upsertDocument(platformEnv, TENANT_LIFECYCLE_EMAIL_COLLECTION, deliveryId, {
        ...withoutFirestoreMetadata(delivery),
        Status: 'Sending',
        Attempt: Math.max(1, Number(delivery.Attempt || 1)) + 1,
        LastError: '',
        UpdatedAt: now
      }, { updateTime: delivery.__updateTime });
    } catch (error) {
      if ([409, 412].includes(Number(error?.status))) return { sent: false, blocked: true };
      throw error;
    }
  }
  const message = lifecycleEmail(registration, window, notice);
  try {
    await emailSender(platformEnv, {
      toEmail: recipient,
      toName: clean(registration.ContactName || registration.OrganisationName),
      ...message
    });
    const sentAt = new Date().toISOString();
    await upsertDocument(platformEnv, TENANT_LIFECYCLE_EMAIL_COLLECTION, deliveryId, {
      ...withoutFirestoreMetadata(delivery),
      Status: 'Sent',
      SentAt: sentAt,
      LastError: '',
      UpdatedAt: sentAt
    }, { updateTime: delivery.__updateTime });
    return { sent: true, sentAt };
  } catch (error) {
    await upsertDocument(platformEnv, TENANT_LIFECYCLE_EMAIL_COLLECTION, deliveryId, {
      ...withoutFirestoreMetadata(delivery),
      Status: error?.deliveryUncertain ? 'Uncertain' : 'Failed',
      LastError: clean(error.message || error).slice(0, 500),
      UpdatedAt: new Date().toISOString()
    }, { updateTime: delivery.__updateTime }).catch(() => null);
    throw error;
  }
}

export async function queueTenantRetirementRequest(platformEnv, registration = {}) {
  const lifecycle = trialLifecycleWindow(registration);
  if (!lifecycle.applicable || lifecycle.stage !== 'retirement_due') {
    const error = new Error('Only a free-trial workspace whose retention period has ended can be retired.');
    error.status = 409;
    error.code = 'TENANT_RETIREMENT_NOT_DUE';
    throw error;
  }
  const registrationReference = clean(registration.Reference || registration.__id);
  const workspaceId = clean(registration.WorkspaceId || registration.FirebaseProjectId);
  const matchingSlots = !clean(registration.ProjectSlotId) && workspaceId
    ? await queryCollection(platformEnv, 'tenantProjectPool', {
        filters: [{ field: 'WorkspaceId', op: '==', value: workspaceId }],
        limit: 2
      }).catch(() => [])
    : [];
  const slot = matchingSlots[0] || {};
  const slotId = clean(registration.ProjectSlotId || slot.Id || slot.__id);
  const firebaseProjectId = clean(registration.FirebaseProjectId || workspaceId || slot.FirebaseProjectId);
  const cloudflareProject = clean(registration.CloudflareProject || slot.CloudflareProject || firebaseProjectId);
  if (!registrationReference || !slotId || !firebaseProjectId || !cloudflareProject) {
    const error = new Error('The expired trial does not contain a complete tenant project assignment.');
    error.status = 409;
    error.code = 'TENANT_RETIREMENT_ASSIGNMENT_INCOMPLETE';
    throw error;
  }
  const reference = `RET-${safeReference(registrationReference, crypto.randomUUID())}`;
  const now = new Date().toISOString();
  const request = {
    Reference: reference,
    RegistrationReference: registrationReference,
    ProjectSlotId: slotId,
    Edition: normalizeOrganizationEdition(registration.Edition),
    FirebaseProjectId: firebaseProjectId,
    CloudflareProject: cloudflareProject,
    WorkspaceId: clean(workspaceId || firebaseProjectId),
    Status: 'Pending',
    Attempts: 0,
    RequestedBy: 'Automatic expired-trial lifecycle',
    RequestedAt: now,
    UpdatedAt: now
  };
  const created = await createDocumentIfAbsent(platformEnv, TENANT_RETIREMENT_REQUEST_COLLECTION, reference, request);
  return created.document || request;
}

export async function processExpiredTrialLifecycle(platformEnv, runtimeEnv = {}, options = {}) {
  const now = isoDate(options.now || Date.now()) || new Date().toISOString();
  const nowMs = Date.parse(now);
  const dryRun = options.dryRun === true;
  const maximum = Math.min(5000, Math.max(1, Number(options.maximum || 5000) || 5000));
  const registrations = await queryCollection(platformEnv, 'tenantRegistrations', {
    filters: [{ field: 'Plan', op: '==', value: 'Free' }],
    limit: maximum
  });
  const summary = {
    inspected: registrations.length,
    trialing: 0,
    suspended: 0,
    noticesSent: 0,
    noticesFailed: 0,
    retirementQueued: 0,
    errors: []
  };

  for (const registration of registrations) {
    const reference = clean(registration.Reference || registration.__id);
    const window = trialLifecycleWindow(registration, nowMs);
    if (!window.applicable || window.stage === 'trialing') {
      summary.trialing += window.stage === 'trialing' ? 1 : 0;
      continue;
    }
    summary.suspended += 1;
    if (['retiring', 'retired'].includes(lower(registration.LifecycleStage))) continue;
    if (dryRun) {
      if (window.stage === 'retirement_due') summary.retirementQueued += 1;
      continue;
    }
    try {
      await recordTrialUseTombstone(platformEnv, registration, { Status: window.stage === 'retirement_due' ? 'Retirement Due' : 'Trial Expired' });
      const baseFields = changedFields(registration, {
        SubscriptionStatus: 'Trial Expired',
        Status: window.stage === 'retirement_due' ? 'Retirement Pending' : 'Trial Expired',
        LifecycleStage: window.stage === 'retirement_due' ? 'Retirement Queued' : 'Suspended',
        DataRetentionEndsAt: window.retentionEndsAt
      });
      const notice = noticeForWindow(registration, window);
      const recipient = lower(registration.Email || registration.ContactEmail || registration.AdminEmail);
      let noticeUpdate = {};
      if (notice && validEmail(recipient)) {
        try {
          const delivery = await deliverLifecycleNotice(
            platformEnv,
            registration,
            window,
            notice,
            options.emailSender || sendConfiguredEmail
          );
          if (delivery.sent) {
            noticeUpdate = noticeFields(notice, delivery.sentAt || now);
            summary.noticesSent += 1;
          }
        } catch (error) {
          summary.noticesFailed += 1;
          noticeUpdate = { LastLifecycleEmailError: clean(error.message || error).slice(0, 500) };
        }
      }
      let retirementUpdate = {};
      if (window.stage === 'retirement_due') {
        const retirement = await queueTenantRetirementRequest(platformEnv, registration);
        retirementUpdate = { RetirementRequestReference: clean(retirement.Reference || retirement.__id) };
        summary.retirementQueued += 1;
      }
      const actionFields = {
        ...baseFields,
        ...noticeUpdate,
        ...retirementUpdate
      };
      if (Object.keys(actionFields).length) {
        await patchDocumentFieldsIfCurrent(platformEnv, 'tenantRegistrations', reference, {
          ...actionFields,
          LastLifecycleProcessedAt: now,
          UpdatedAt: now
        }, registration);
      }
    } catch (error) {
      summary.errors.push({ reference, message: clean(error.message || error).slice(0, 300) });
    }
  }
  return summary;
}

function retryReady(request, nowMs) {
  const nextAttemptMs = timestampMilliseconds(request.NextAttemptAt);
  return !Number.isFinite(nextAttemptMs) || nextAttemptMs <= nowMs;
}

export async function claimNextTenantRetirementRequest(platformEnv, runnerId = '') {
  const nowMs = Date.now();
  const staleBefore = nowMs - (RETIREMENT_LEASE_MINUTES * 60 * 1000);
  const requests = (await listCollection(platformEnv, TENANT_RETIREMENT_REQUEST_COLLECTION, {
    pageSize: 250,
    maxPages: 4
  }))
    .filter((request) => (
      (lower(request.Status) === 'pending' && retryReady(request, nowMs))
      || (lower(request.Status) === 'retiring' && timestampMilliseconds(request.StartedAt) < staleBefore)
    ))
    .sort((left, right) => clean(left.RequestedAt).localeCompare(clean(right.RequestedAt)));

  for (const request of requests) {
    const registrationReference = clean(request.RegistrationReference);
    const registration = registrationReference
      ? await getDocument(platformEnv, 'tenantRegistrations', registrationReference)
      : null;
    if (!registration || lower(registration.Plan) !== 'free'
      || ['paid', 'active', 'payment confirmed'].includes(lower(registration.PaymentStatus))) {
      await patchDocumentFieldsIfCurrent(platformEnv, TENANT_RETIREMENT_REQUEST_COLLECTION, clean(request.__id || request.Reference), {
        Status: 'Cancelled',
        LastError: 'The subscriber upgraded or the registration is no longer eligible for retirement.',
        UpdatedAt: new Date().toISOString()
      }, request).catch(() => null);
      continue;
    }
    if (trialLifecycleWindow(registration).stage !== 'retirement_due') {
      await patchDocumentFieldsIfCurrent(platformEnv, TENANT_RETIREMENT_REQUEST_COLLECTION, clean(request.__id || request.Reference), {
        Status: 'Cancelled',
        LastError: 'The subscriber retention period has not ended.',
        UpdatedAt: new Date().toISOString()
      }, request).catch(() => null);
      continue;
    }
    if (clean(registration.PendingPlan) && clean(registration.PendingAuthorizationUrl)
      && !clean(request.CheckoutGraceGrantedAt)) {
      const now = new Date().toISOString();
      await patchDocumentFieldsIfCurrent(platformEnv, TENANT_RETIREMENT_REQUEST_COLLECTION, clean(request.__id || request.Reference), {
        Status: 'Pending',
        CheckoutGraceGrantedAt: now,
        NextAttemptAt: new Date(Date.now() + (24 * 60 * 60 * 1000)).toISOString(),
        UpdatedAt: now
      }, request).catch(() => null);
      continue;
    }
    const now = new Date().toISOString();
    const claimed = {
      ...withoutFirestoreMetadata(request),
      Status: 'Retiring',
      RunnerId: clean(runnerId),
      LeaseId: crypto.randomUUID(),
      StartedAt: now,
      Attempts: Math.max(0, Number(request.Attempts || 0)) + 1,
      UpdatedAt: now
    };
    try {
      await batchCommitDocuments(platformEnv, [
        {
          collectionPath: TENANT_RETIREMENT_REQUEST_COLLECTION,
          documentId: clean(request.__id || request.Reference),
          data: claimed,
          updateTime: request.__updateTime
        },
        {
          collectionPath: 'tenantRegistrations',
          documentId: registrationReference,
          data: {
            ...withoutFirestoreMetadata(registration),
            Status: 'Retirement In Progress',
            SubscriptionStatus: 'Trial Expired',
            LifecycleStage: 'Retiring',
            UpdatedAt: now
          },
          updateTime: registration.__updateTime
        }
      ]);
      return claimed;
    } catch (error) {
      if ([409, 412].includes(Number(error?.status)) || error?.code === 'FIRESTORE_WRITE_CONFLICT') continue;
      throw error;
    }
  }
  return null;
}

function sanitizedRetiredRegistration(registration = {}, request = {}, retiredAt = '') {
  return {
    Reference: clean(registration.Reference || registration.__id || request.RegistrationReference),
    TrialFingerprint: clean(registration.TrialFingerprint),
    Edition: normalizeOrganizationEdition(registration.Edition || request.Edition),
    Plan: 'Retired Free Trial',
    Status: 'Retired',
    SubscriptionStatus: 'Trial Expired',
    LifecycleStage: 'Retired',
    TrialStartedAt: clean(registration.TrialStartedAt),
    TrialEndsAt: clean(registration.TrialEndsAt),
    DataRetentionEndsAt: clean(registration.DataRetentionEndsAt),
    FirebaseProjectId: clean(request.FirebaseProjectId),
    CloudflareProject: clean(request.CloudflareProject),
    ProjectSlotId: clean(request.ProjectSlotId),
    RetiredAt: retiredAt,
    UpdatedAt: retiredAt
  };
}

export async function finishTenantRetirementRequest(platformEnv, result = {}) {
  const reference = clean(result.Reference || result.reference);
  if (!reference) {
    const error = new Error('The tenant retirement request reference is required.');
    error.status = 400;
    throw error;
  }
  const request = await getDocument(platformEnv, TENANT_RETIREMENT_REQUEST_COLLECTION, reference);
  if (!request) {
    const error = new Error('The tenant retirement request was not found.');
    error.status = 404;
    throw error;
  }
  if (lower(request.Status) === 'completed') return withoutFirestoreMetadata(request);
  if (clean(result.LeaseId || result.leaseId) && clean(result.LeaseId || result.leaseId) !== clean(request.LeaseId)) {
    const error = new Error('The tenant retirement lease no longer belongs to this runner.');
    error.status = 409;
    throw error;
  }
  const completed = lower(result.Status) === 'completed';
  const now = new Date().toISOString();
  if (!completed) {
    const attempts = Math.max(1, Number(request.Attempts || 1));
    const retry = attempts < MAX_RETIREMENT_ATTEMPTS;
    const failedRequest = {
      ...withoutFirestoreMetadata(request),
      Status: retry ? 'Pending' : 'Failed',
      NextAttemptAt: retry ? new Date(Date.now() + (6 * 60 * 60 * 1000)).toISOString() : '',
      LastError: clean(result.LastError || result.lastError || 'Tenant retirement failed.').slice(0, 1000),
      UpdatedAt: now
    };
    await upsertDocument(platformEnv, TENANT_RETIREMENT_REQUEST_COLLECTION, reference, failedRequest, {
      updateTime: request.__updateTime
    });
    return failedRequest;
  }

  const registrationReference = clean(request.RegistrationReference);
  const slotId = clean(request.ProjectSlotId);
  const [registration, slot, activations] = await Promise.all([
    registrationReference ? getDocument(platformEnv, 'tenantRegistrations', registrationReference) : null,
    slotId ? getDocument(platformEnv, 'tenantProjectPool', slotId) : null,
    registrationReference ? queryCollection(platformEnv, 'tenantActivations', {
      filters: [{ field: 'RegistrationReference', op: '==', value: registrationReference }],
      limit: 450
    }) : []
  ]);
  const fingerprint = clean(registration?.TrialFingerprint)
    || await tenantTrialFingerprint(registration?.OrganisationName, registration?.Email);
  const writes = [{
    collectionPath: TENANT_RETIREMENT_REQUEST_COLLECTION,
    documentId: reference,
    data: {
      ...withoutFirestoreMetadata(request),
      Status: 'Completed',
      CompletedAt: now,
      LastError: '',
      UpdatedAt: now
    },
    updateTime: request.__updateTime
  }];
  if (registration) {
    writes.push({
      collectionPath: 'tenantRegistrations',
      documentId: registrationReference,
      data: sanitizedRetiredRegistration({ ...registration, TrialFingerprint: fingerprint }, request, now),
      updateTime: registration.__updateTime
    });
  }
  if (slot) {
    writes.push({
      collectionPath: 'tenantProjectPool',
      documentId: slotId,
      data: {
        ...withoutFirestoreMetadata(slot),
        Status: 'Retired',
        RetiredAt: now,
        LastError: '',
        UpdatedAt: now
      },
      updateTime: slot.__updateTime
    });
  }
  for (const activation of activations) {
    writes.push({
      collectionPath: 'tenantActivations',
      documentId: clean(activation.__id || activation.ActivationId),
      operation: 'delete',
      updateTime: activation.__updateTime
    });
  }
  await batchCommitDocuments(platformEnv, writes);
  if (registration) {
    await recordTrialUseTombstone(platformEnv, { ...registration, TrialFingerprint: fingerprint }, {
      Status: 'Retired',
      RetiredAt: now
    }).catch(() => null);
  }
  return { ...withoutFirestoreMetadata(request), Status: 'Completed', CompletedAt: now, UpdatedAt: now };
}
