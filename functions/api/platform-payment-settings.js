import {
  createDocumentIfAbsent,
  getDocument,
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

async function loadResponse(platformEnv) {
  const saved = await getDocument(platformEnv, 'settings', PLATFORM_PAYMENT_SETTINGS_DOCUMENT).catch(() => null);
  return {
    settings: normalizePlatformPaymentSettings(saved || {}),
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
  if (clean(payment.Status).toLowerCase() === 'paid' && decision === 'approve') {
    return { message: 'This subscription transfer was already approved.', payment: publicPlatformTransferRecord(payment) };
  }
  if (clean(payment.Status).toLowerCase() !== 'awaiting verification') {
    const error = new Error(`This transfer is already ${clean(payment.Status) || 'closed'} and cannot be changed.`);
    error.status = 409;
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
    return {
      message: warning || 'The bank transfer was approved and the selected subscription is now active.',
      warning,
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
      return Response.json({ ok: true, ...(await loadResponse(platformEnv)) }, { headers: { 'Cache-Control': 'no-store' } });
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
        ...(await loadResponse(platformEnv))
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
      return Response.json({ ok: true, ...decision, ...(await loadResponse(platformEnv)) }, {
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
