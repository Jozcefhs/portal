import {
  createDocumentIfAbsent,
  getDocument,
  patchDocumentFields,
  queryCollection,
  updateDocumentIfCurrent,
  upsertDocument
} from '../lib/firestore.js';
import { requirePlatformAdmin } from '../lib/platform-admin.js';
import { requirePlatformFirestoreEnv } from '../lib/platform-firestore.js';
import {
  PLATFORM_PAYMENT_SETTINGS_DOCUMENT,
  normalizePlatformPaymentSettings,
  platformBankReferenceHash,
  publicPlatformTransferRecord,
  validatePlatformPaymentSettings
} from '../lib/platform-direct-bank-transfer.js';
import { readJsonBody } from '../lib/request-security.js';
import { paystackSecretMode } from '../lib/paystack-environment.js';
import { issueTenantActivation } from '../lib/tenant-activation.js';
import { reserveTenantProjectSlot } from '../lib/tenant-project-pool.js';
import {
  activateSavedSubscriptionPayment,
  disablePaystackSubscription
} from './verify-subscription-payment.js';

const clean = (value) => String(value ?? '').trim();
const safeId = (value) => clean(value).replace(/[\/\\?#\[\]]/g, '-').replace(/\s+/g, '_').slice(0, 140);

function withoutFirestoreMetadata(document = {}) {
  const value = { ...document };
  delete value.__id;
  delete value.__name;
  delete value.__createTime;
  delete value.__updateTime;
  return value;
}

async function loadTransferQueue(platformEnv) {
  const rows = await queryCollection(platformEnv, 'subscriptionPayments', {
    filters: [{ field: 'PaymentMethod', op: '==', value: 'Direct Bank Transfer' }],
    limit: 250
  }).catch(() => []);
  return rows
    .sort((left, right) => clean(right.CreatedAt).localeCompare(clean(left.CreatedAt)))
    .map(publicPlatformTransferRecord);
}

async function loadResponse(env, platformEnv) {
  const saved = await getDocument(platformEnv, 'settings', PLATFORM_PAYMENT_SETTINGS_DOCUMENT).catch(() => null);
  return {
    settings: normalizePlatformPaymentSettings(saved || {}),
    paystackEnvironment: paystackSecretMode(env.PAYSTACK_SECRET_KEY),
    transfers: await loadTransferQueue(platformEnv)
  };
}

async function clearRejectedPendingRegistration(platformEnv, payment, notes) {
  const registrationReference = clean(payment.RegistrationReference);
  const registration = registrationReference
    ? await getDocument(platformEnv, 'tenantRegistrations', registrationReference)
    : null;
  if (!registration) return;
  const reference = clean(payment.Reference || payment.__id);
  const pendingMatches = clean(registration.PendingDirectTransferReference) === reference;
  const directMatches = clean(registration.DirectTransferReference) === reference;
  if (!pendingMatches && !directMatches && clean(registration.PaymentStatus).toLowerCase() === 'paid') return;
  const preserveActivePlan = payment.PreserveActivePlan === true;
  await upsertDocument(platformEnv, 'tenantRegistrations', registrationReference, preserveActivePlan ? {
    ...withoutFirestoreMetadata(registration),
    PendingPlan: '',
    PendingBillingCycle: '',
    PendingPrice: 0,
    PendingPaymentMethod: '',
    PendingDirectTransferReference: '',
    PendingAuthorizationUrl: '',
    LastPaymentReviewNotes: notes,
    UpdatedAt: new Date().toISOString()
  } : {
    ...withoutFirestoreMetadata(registration),
    PaymentStatus: 'Rejected',
    Status: 'Payment Rejected',
    DirectTransferReference: '',
    LastPaymentReviewNotes: notes,
    UpdatedAt: new Date().toISOString()
  });
}

function onboardingFields(result = {}) {
  return {
    WorkspacePending: result.workspacePending === true,
    WorkspaceId: clean(result.workspaceId),
    PortalUrl: clean(result.portalUrl),
    ProvisioningStatus: clean(result.provisioningStatus),
    ActivationStatus: result.administratorActivated
      ? 'Administrator active'
      : result.activationUrl
        ? 'Activation link issued'
        : result.workspacePending
          ? 'Waiting for workspace'
          : result.activationPending
            ? 'Activation pending'
            : '',
    AdministratorActivated: result.administratorActivated === true
  };
}

function onboardingMessage(result = {}) {
  if (result.administratorActivated) return 'The subscription is active and the organisation administrator account is ready.';
  if (result.activationUrl && result.activationEmailSent) {
    return 'The subscription is active. The administrator activation link was issued and emailed to the subscriber.';
  }
  if (result.activationUrl) {
    return 'The subscription is active and the administrator activation link is ready. Open or copy it now because email delivery was not confirmed.';
  }
  if (result.workspacePending) {
    return 'The payment is confirmed and the subscription is active. No ready workspace is available yet, so isolated workspace provisioning has been queued.';
  }
  return 'The payment is confirmed and the subscription is active. Administrator activation is still being prepared.';
}

async function saveOnboardingFields(platformEnv, reference, result = {}) {
  const fields = onboardingFields(result);
  await patchDocumentFields(platformEnv, 'subscriptionPayments', reference, {
    ...fields,
    UpdatedAt: new Date().toISOString()
  }).catch(() => null);
  return fields;
}

async function resumeApprovedTransferOnboarding(env, platformEnv, reference, payment, savedRegistration = null) {
  let registration = savedRegistration || await getDocument(
    platformEnv,
    'tenantRegistrations',
    clean(payment.RegistrationReference)
  );
  if (!registration) {
    const error = new Error('The subscriber registration for this approved transfer was not found.');
    error.status = 409;
    throw error;
  }
  if (!clean(registration.WorkspaceId)) {
    const assignment = await reserveTenantProjectSlot(platformEnv, registration);
    registration = assignment.registration;
  }
  let result = {
    workspacePending: !clean(registration.WorkspaceId),
    workspaceId: clean(registration.WorkspaceId),
    portalUrl: clean(registration.PortalUrl),
    provisioningStatus: clean(registration.ProvisioningStatus)
  };
  if (!result.workspacePending) {
    try {
      const activation = await issueTenantActivation(platformEnv, registration, env);
      result = {
        ...result,
        activationUrl: clean(activation.activationUrl),
        activationExpiresAt: clean(activation.expiresAt),
        activationEmailSent: activation.emailSent === true,
        activationEmailStatus: clean(activation.emailStatus),
        administratorActivated: activation.alreadyActivated === true,
        loginUrl: clean(activation.loginUrl),
        activationPending: !activation.issued && !activation.alreadyActivated
      };
    } catch (error) {
      result.activationPending = true;
      result.activationError = clean(error.message || error).slice(0, 300);
    }
  }
  const fields = await saveOnboardingFields(platformEnv, reference, result);
  return { ...result, ...fields, message: onboardingMessage(result) };
}

async function decideTransfer(env, platformEnv, body) {
  const reference = safeId(body.reference);
  const decision = clean(body.decision).toLowerCase();
  const notes = clean(body.notes).slice(0, 500);
  if (!reference || !['approve', 'reject'].includes(decision)) {
    const error = new Error('Choose a valid subscription transfer and approve or reject it.');
    error.status = 400;
    throw error;
  }
  const payment = await getDocument(platformEnv, 'subscriptionPayments', reference);
  if (!payment || clean(payment.PaymentMethod) !== 'Direct Bank Transfer') {
    const error = new Error('The direct subscription transfer was not found.');
    error.status = 404;
    throw error;
  }
  const registrationReference = clean(payment.RegistrationReference);
  const registration = registrationReference
    ? await getDocument(platformEnv, 'tenantRegistrations', registrationReference)
    : null;
  if (!registration) {
    const error = new Error('The subscriber registration for this transfer was not found.');
    error.status = 409;
    throw error;
  }
  if (clean(payment.Status).toLowerCase() === 'paid' && decision === 'approve') {
    const onboarding = await resumeApprovedTransferOnboarding(
      env, platformEnv, reference, payment, registration
    );
    return {
      message: onboarding.message,
      payment: publicPlatformTransferRecord({ ...payment, ...onboarding }),
      onboarding
    };
  }
  if (clean(payment.Status).toLowerCase() !== 'awaiting verification') {
    const error = new Error(`This transfer is already ${clean(payment.Status) || 'closed'} and cannot be changed.`);
    error.status = 409;
    throw error;
  }
  const currentTransferReference = payment.PreserveActivePlan === true
    ? clean(registration.PendingDirectTransferReference)
    : clean(registration.DirectTransferReference);
  if (currentTransferReference !== reference) {
    await upsertDocument(platformEnv, 'subscriptionPayments', reference, {
      ...withoutFirestoreMetadata(payment),
      Status: 'Superseded',
      ReviewNotes: 'A newer subscription payment request replaced this transfer.',
      UpdatedAt: new Date().toISOString()
    });
    const error = new Error('This transfer was replaced by a newer subscription request and cannot be approved.');
    error.status = 409;
    throw error;
  }
  const reviewedAt = new Date().toISOString();
  if (decision === 'reject') {
    await updateDocumentIfCurrent(platformEnv, 'subscriptionPayments', reference, {
      ...withoutFirestoreMetadata(payment),
      Status: 'Rejected',
      ReviewNotes: notes,
      ReviewedAt: reviewedAt,
      ReviewedBy: 'Dynamax administration',
      UpdatedAt: reviewedAt
    }, payment);
    await clearRejectedPendingRegistration(platformEnv, payment, notes);
    return { message: 'The subscription transfer was rejected. No plan was activated.' };
  }

  await updateDocumentIfCurrent(platformEnv, 'subscriptionPayments', reference, {
    ...withoutFirestoreMetadata(payment),
    Status: 'Approval Processing',
    ReviewNotes: notes,
    ReviewedAt: reviewedAt,
    ReviewedBy: 'Dynamax administration',
    UpdatedAt: reviewedAt
  }, payment);
  try {
    const claimId = await platformBankReferenceHash(payment.BankReference);
    const claim = await createDocumentIfAbsent(platformEnv, 'verifiedSubscriptionBankReferences', claimId, {
      BankReferenceHash: claimId,
      PaymentReference: reference,
      RegistrationReference: clean(payment.RegistrationReference),
      CreatedAt: reviewedAt
    });
    if (!claim.created && clean(claim.document?.PaymentReference) !== reference) {
      const error = new Error('This bank transaction reference has already been approved for another subscription.');
      error.status = 409;
      throw error;
    }
    const result = await activateSavedSubscriptionPayment(env, {
      platformEnv,
      reference,
      intent: { ...payment, Status: 'Approval Processing' },
      savedRegistration: registration,
      registrationReference,
      provider: 'Direct Bank Transfer',
      paidAt: reviewedAt,
      providerFields: {
        BankReference: clean(payment.BankReference),
        ReviewNotes: notes,
        ReviewedAt: reviewedAt,
        ReviewedBy: 'Dynamax administration'
      }
    });
    const previousSubscriptionCode = clean(payment.PreviousPaystackSubscriptionCode);
    let warning = '';
    if (previousSubscriptionCode) {
      try {
        await disablePaystackSubscription(env, previousSubscriptionCode);
        result.updatedRegistration.PreviousSubscriptionDisabledAt = new Date().toISOString();
      } catch (error) {
        warning = 'The manual subscription is active, but the previous Paystack recurring subscription could not be cancelled automatically.';
        result.updatedRegistration.PreviousSubscriptionDisableError = clean(error.message || error).slice(0, 500);
      }
      await upsertDocument(platformEnv, 'tenantRegistrations', registrationReference, result.updatedRegistration);
    }
    const onboarding = {
      workspacePending: result.workspacePending === true,
      workspaceId: clean(result.workspaceId),
      portalUrl: clean(result.portalUrl),
      provisioningStatus: clean(result.updatedRegistration?.ProvisioningStatus),
      activationUrl: clean(result.activationUrl),
      activationExpiresAt: clean(result.activationExpiresAt),
      activationEmailSent: result.activationEmailSent === true,
      activationEmailStatus: clean(result.activationEmailStatus),
      administratorActivated: result.administratorActivated === true,
      loginUrl: clean(result.loginUrl),
      activationPending: result.activationPending === true
    };
    await saveOnboardingFields(platformEnv, reference, onboarding);
    return {
      message: warning || onboardingMessage(onboarding),
      warning,
      onboarding,
      result: { ...result, updatedRegistration: undefined }
    };
  } catch (error) {
    await upsertDocument(platformEnv, 'subscriptionPayments', reference, {
      ...withoutFirestoreMetadata(payment),
      Status: 'Awaiting Verification',
      LastError: clean(error.message || error).slice(0, 500),
      UpdatedAt: new Date().toISOString()
    }).catch(() => null);
    throw error;
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const platformEnv = requirePlatformFirestoreEnv(env);
    const body = await readJsonBody(request, { maxBytes: 700 * 1024 });
    requirePlatformAdmin(env, body.password);
    const action = clean(body.action || 'load').toLowerCase();
    if (action === 'load') {
      return Response.json({ ok: true, ...(await loadResponse(env, platformEnv)) }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (action === 'save') {
      const settings = validatePlatformPaymentSettings(body.settings || {});
      await upsertDocument(platformEnv, 'settings', PLATFORM_PAYMENT_SETTINGS_DOCUMENT, {
        ...settings,
        UpdatedAt: new Date().toISOString(),
        UpdatedBy: 'Dynamax administration'
      });
      return Response.json({
        ok: true,
        message: 'Dynamax subscription payment methods saved.',
        ...(await loadResponse(env, platformEnv))
      }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (action === 'proof') {
      const payment = await getDocument(platformEnv, 'subscriptionPayments', safeId(body.reference));
      if (!payment || clean(payment.PaymentMethod) !== 'Direct Bank Transfer' || !clean(payment.ProofDataUrl)) {
        const error = new Error('No payment proof is available for this transfer.');
        error.status = 404;
        throw error;
      }
      return Response.json({ ok: true, proofDataUrl: clean(payment.ProofDataUrl), fileName: clean(payment.ProofFileName) }, {
        headers: { 'Cache-Control': 'no-store' }
      });
    }
    if (action === 'decision') {
      const decision = await decideTransfer(env, platformEnv, body);
      return Response.json({ ok: true, ...decision, ...(await loadResponse(env, platformEnv)) }, {
        headers: { 'Cache-Control': 'no-store' }
      });
    }
    const error = new Error('Unsupported Dynamax payment administration action.');
    error.status = 400;
    throw error;
  } catch (error) {
    return Response.json({ ok: false, message: error.message || String(error) }, {
      status: error.status || 500,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}
