import { getDocument, upsertDocument } from '../lib/firestore.js';
import { readJsonBody } from '../lib/request-security.js';
import { syncRegistrationSubscriptionToWorkspace } from '../lib/subscription-workspace-sync.js';
import { requirePlatformFirestoreEnv } from '../lib/platform-firestore.js';
import { reserveTenantProjectSlot } from '../lib/tenant-project-pool.js';
import { issueTenantActivation } from '../lib/tenant-activation.js';
import {
  paidSubscriptionRecoveryFields,
  paystackPaidThroughAt
} from '../lib/paid-subscription-lifecycle.js';

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

function metadataFromTransaction(transaction = {}) {
  const metadata = transaction.metadata;
  if (!metadata) return {};
  if (typeof metadata === 'object') return metadata;
  try { return JSON.parse(metadata); } catch (_error) { return {}; }
}

export async function verifySubscriptionTransaction(env, reference) {
  if (!clean(env.PAYSTACK_SECRET_KEY)) {
    const error = new Error('Online subscription payment verification is not configured.');
    error.status = 503;
    throw error;
  }
  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.status === false || clean(data.data?.status).toLowerCase() !== 'success') {
    const error = new Error(data.message || 'The subscription payment has not been confirmed.');
    error.status = 400;
    throw error;
  }
  return data.data;
}

export async function disablePaystackSubscription(env, subscriptionCode, fetchImpl = fetch) {
  const code = clean(subscriptionCode);
  if (!code) return { disabled: false, skipped: true };
  const headers = { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' };
  const detailResponse = await fetchImpl(`https://api.paystack.co/subscription/${encodeURIComponent(code)}`, { headers });
  const detail = await detailResponse.json().catch(() => ({}));
  const token = clean(detail.data?.email_token);
  if (!detailResponse.ok || detail.status === false || !token) throw new Error(detail.message || 'The previous Paystack subscription could not be loaded for cancellation.');
  const response = await fetchImpl('https://api.paystack.co/subscription/disable', {
    method: 'POST', headers, body: JSON.stringify({ code, token })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.status === false) throw new Error(data.message || 'The previous Paystack subscription could not be disabled.');
  return { disabled: true };
}

export async function activateSavedSubscriptionPayment(env, options = {}) {
  const platformEnv = options.platformEnv || requirePlatformFirestoreEnv(env);
  const reference = safeId(options.reference);
  const intent = options.intent || await getDocument(platformEnv, 'subscriptionPayments', reference);
  const registrationReference = clean(options.registrationReference || intent?.RegistrationReference);
  const savedRegistration = options.savedRegistration
    || await getDocument(platformEnv, 'tenantRegistrations', registrationReference);
  if (!reference || !intent) {
    const error = new Error('The saved subscription payment request was not found.');
    error.status = 409;
    throw error;
  }
  if (!registrationReference || !savedRegistration) {
    const error = new Error('The organisation registration for this payment was not found.');
    error.status = 409;
    throw error;
  }
  if (['retiring', 'retired'].includes(clean(savedRegistration.LifecycleStage).toLowerCase())) {
    await upsertDocument(platformEnv, 'subscriptionPayments', reference, {
      ...withoutFirestoreMetadata(intent),
      Status: 'Paid After Retirement Deadline',
      LastError: 'Payment arrived after permanent tenant retirement began. Manual support review and refund may be required.',
      UpdatedAt: new Date().toISOString()
    }).catch(() => null);
    const error = new Error('This workspace has already entered permanent retirement. Contact Dynamax support so the payment can be reviewed.');
    error.status = 410;
    error.code = 'PAYMENT_AFTER_TENANT_RETIREMENT';
    throw error;
  }
  const assignment = clean(savedRegistration.WorkspaceId)
    ? { assigned: true, registration: savedRegistration }
    : await reserveTenantProjectSlot(platformEnv, savedRegistration);
  const registration = assignment.registration;
  const provider = clean(options.provider || 'Paystack');
  const paystack = provider.toLowerCase() === 'paystack';
  const paidAt = clean(options.paidAt) || new Date().toISOString();
  const updatedAt = new Date().toISOString();
  const recoveryFields = paidSubscriptionRecoveryFields({
    paidAt,
    billingCycle: clean(intent.BillingCycle),
    providerPaidThroughAt: clean(options.providerPaidThroughAt)
  });
  const providerFields = options.providerFields && typeof options.providerFields === 'object'
    ? options.providerFields
    : {};
  const updatedRegistration = {
    ...withoutFirestoreMetadata(registration),
    Plan: clean(intent.Plan),
    BillingCycle: clean(intent.BillingCycle),
    UserLimit: Math.max(1, Number(intent.UserLimit || registration.UserLimit || 5) || 5),
    FeatureEntitlements: intent.FeatureEntitlements || registration.FeatureEntitlements || [],
    PlanCatalogRevision: clean(intent.PlanCatalogRevision || registration.PlanCatalogRevision),
    Price: Number(intent.Amount || 0),
    Currency: clean(intent.Currency || 'NGN'),
    ...recoveryFields,
    Status: 'Payment Confirmed',
    SubscriptionPaymentProvider: provider,
    SubscriptionPaymentReference: reference,
    PreviousPaystackSubscriptionCode: clean(intent.PreviousPaystackSubscriptionCode),
    PendingPlan: '',
    PendingBillingCycle: '',
    PendingPrice: 0,
    PendingPaystackPlanCode: '',
    PendingPaystackReference: '',
    PendingAuthorizationUrl: '',
    PendingPaymentMethod: '',
    PendingDirectTransferReference: '',
    AutoRenewalEnabled: paystack,
    ...(paystack ? {
      PaystackReference: reference,
      PaystackPlanCode: clean(intent.PaystackPlanCode),
      PaystackCustomerCode: clean(providerFields.PaystackCustomerCode),
      PaystackSubscriptionCode: clean(providerFields.PaystackSubscriptionCode),
      DirectTransferReference: ''
    } : {
      DirectTransferReference: reference,
      PaystackPlanCode: '',
      PaystackCustomerCode: '',
      PaystackSubscriptionCode: ''
    }),
    UpdatedAt: updatedAt
  };
  await Promise.all([
    upsertDocument(platformEnv, 'subscriptionPayments', reference, {
      ...withoutFirestoreMetadata(intent),
      Status: 'Paid',
      PaymentMethod: provider,
      PaidAt: paidAt,
      ...providerFields,
      UpdatedAt: updatedAt
    }),
    upsertDocument(platformEnv, 'tenantRegistrations', registrationReference, updatedRegistration)
  ]);
  await syncRegistrationSubscriptionToWorkspace(env, updatedRegistration);
  let activation = {};
  if (clean(updatedRegistration.WorkspaceId)) {
    try {
      const issued = await issueTenantActivation(platformEnv, updatedRegistration, env);
      activation = issued.issued ? {
        activationUrl: issued.activationUrl,
        activationExpiresAt: issued.expiresAt,
        activationEmailSent: issued.emailSent,
        activationEmailStatus: issued.emailStatus
      } : issued.alreadyActivated ? {
        administratorActivated: true,
        loginUrl: issued.loginUrl
      } : {};
    } catch (error) {
      console.error(JSON.stringify({
        event: 'tenant_activation_issue_failed',
        registrationReference,
        message: clean(error.message || error).slice(0, 300)
      }));
      activation = { activationPending: true };
    }
  }
  return {
    registrationReference,
    plan: clean(intent.Plan),
    billingCycle: clean(intent.BillingCycle),
    amount: Number(intent.Amount || 0),
    currency: clean(intent.Currency || 'NGN'),
    workspaceId: clean(updatedRegistration.WorkspaceId),
    portalUrl: clean(updatedRegistration.PortalUrl),
    workspacePending: !clean(updatedRegistration.WorkspaceId),
    updatedRegistration,
    ...activation
  };
}

export async function recordVerifiedSubscriptionPayment(env, transaction, requestedRegistrationReference = '') {
  const platformEnv = requirePlatformFirestoreEnv(env);
  const reference = safeId(transaction.reference);
  const intent = await getDocument(platformEnv, 'subscriptionPayments', reference);
  if (!intent) {
    const error = new Error('The saved subscription payment request was not found.');
    error.status = 409;
    throw error;
  }
  const metadata = metadataFromTransaction(transaction);
  if (clean(metadata.paymentType).toLowerCase() !== 'dynamaxsubscription') {
    const error = new Error('This transaction is not a Dynamax subscription payment.');
    error.status = 409;
    throw error;
  }
  const registrationReference = clean(
    metadata.registrationReference || intent.RegistrationReference || requestedRegistrationReference
  );
  if (!registrationReference || (clean(requestedRegistrationReference)
    && clean(requestedRegistrationReference).toLowerCase() !== registrationReference.toLowerCase())) {
    const error = new Error('The payment belongs to a different organisation registration.');
    error.status = 409;
    throw error;
  }
  const savedRegistration = await getDocument(platformEnv, 'tenantRegistrations', registrationReference);
  if (!savedRegistration) {
    const error = new Error('The organisation registration for this payment was not found.');
    error.status = 409;
    throw error;
  }
  const paidAmount = Number(transaction.requested_amount || transaction.amount || 0) / 100;
  if (Math.abs(Number(intent.Amount || 0) - paidAmount) > 0.01) {
    const error = new Error('The verified amount does not match the selected subscription price.');
    error.status = 409;
    throw error;
  }
  if (clean(intent.Plan).toLowerCase() !== clean(metadata.plan).toLowerCase()
    || clean(intent.BillingCycle).toLowerCase() !== clean(metadata.billingCycle).toLowerCase()) {
    const error = new Error('The verified Paystack plan does not match the selected subscription.');
    error.status = 409;
    throw error;
  }
  const customerCode = clean(transaction.customer?.customer_code);
  const subscriptionCode = clean(transaction.subscription_code || transaction.subscription?.subscription_code);
  const paidAt = clean(transaction.paid_at || transaction.paidAt) || new Date().toISOString();
  const result = await activateSavedSubscriptionPayment(env, {
    platformEnv,
    reference,
    intent,
    savedRegistration,
    registrationReference,
    provider: 'Paystack',
    paidAt,
    providerPaidThroughAt: paystackPaidThroughAt(transaction),
    providerFields: {
      PaystackTransactionId: clean(transaction.id),
      PaystackCustomerCode: customerCode,
      PaystackSubscriptionCode: subscriptionCode
    }
  });
  const updatedRegistration = result.updatedRegistration;
  const previousSubscriptionCode = clean(intent.PreviousPaystackSubscriptionCode);
  let previousSubscriptionWarning = '';
  if (previousSubscriptionCode && subscriptionCode && previousSubscriptionCode !== subscriptionCode) {
    try {
      await disablePaystackSubscription(env, previousSubscriptionCode);
      updatedRegistration.PreviousSubscriptionDisabledAt = new Date().toISOString();
      await upsertDocument(platformEnv, 'tenantRegistrations', registrationReference, updatedRegistration);
    } catch (error) {
      previousSubscriptionWarning = 'Your new plan is active, but the previous recurring Paystack subscription could not be cancelled automatically. Please contact Dynamax support immediately.';
      await upsertDocument(platformEnv, 'tenantRegistrations', registrationReference, {
        ...updatedRegistration,
        PreviousSubscriptionDisableError: clean(error.message || error).slice(0, 500)
      });
    }
  }
  return {
    ...result,
    updatedRegistration: undefined,
    warning: previousSubscriptionWarning,
  };
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await readJsonBody(request, { maxBytes: 64 * 1024 });
    const reference = safeId(body.reference);
    if (!reference) {
      const error = new Error('Paystack payment reference is required.');
      error.status = 400;
      throw error;
    }
    const transaction = await verifySubscriptionTransaction(env, reference);
    const result = await recordVerifiedSubscriptionPayment(env, transaction, body.registrationReference);
    return Response.json({
      ok: true,
      message: result.warning || (result.workspacePending
        ? 'Subscription payment confirmed. Your plan is active and a project is being prepared for your organisation.'
        : 'Subscription payment confirmed. Your selected plan and organisation workspace are now active.'),
      ...result
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, message: error.message || String(error) }, {
      status: error.status || 500,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}
