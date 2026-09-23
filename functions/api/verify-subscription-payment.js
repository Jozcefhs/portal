import { getDocument, patchDocumentFields, patchDocumentFieldsIfCurrent, upsertDocument } from '../lib/firestore.js';
import { readJsonBody } from '../lib/request-security.js';
import { syncRegistrationSubscriptionToWorkspace } from '../lib/subscription-workspace-sync.js';
import { requirePlatformFirestoreEnv } from '../lib/platform-firestore.js';
import { reserveTenantProjectSlot } from '../lib/tenant-project-pool.js';
import { issueTenantActivation } from '../lib/tenant-activation.js';
import {
  paidSubscriptionRecoveryFields,
  paystackPaidThroughAt
} from '../lib/paid-subscription-lifecycle.js';
import { freeTrialWindow } from '../lib/subscription-plans.js';
import { recordTrialUseTombstone } from '../lib/tenant-trial-lifecycle.js';
import {
  buildSubscriptionReceipt,
  deliverSubscriptionReceiptEmail,
  publicSubscriptionReceipt,
  subscriptionReceiptUrl
} from '../lib/subscription-receipt.js';

const clean = (value) => String(value ?? '').trim();
const safeId = (value) => clean(value).replace(/[\/\\?#\[\]]/g, '-').replace(/\s+/g, '_').slice(0, 140);
const PAYSTACK_SUBSCRIPTION_URL = 'https://api.paystack.co/subscription';
const PAYSTACK_REFUND_URL = 'https://api.paystack.co/refund';

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

export function verifiedPaystackCardFields(transaction = {}, verifiedAt = new Date().toISOString()) {
  const authorization = transaction.authorization && typeof transaction.authorization === 'object'
    ? transaction.authorization
    : {};
  const channel = clean(transaction.channel || authorization.channel).toLowerCase();
  if (channel !== 'card' || !clean(authorization.authorization_code)) {
    const error = new Error('A successful bank-card transaction is required before a tenant project can be assigned.');
    error.status = 409;
    error.code = 'TENANT_CARD_VERIFICATION_REQUIRED';
    throw error;
  }
  return {
    CardVerificationStatus: 'Verified',
    CardVerifiedAt: clean(verifiedAt) || new Date().toISOString(),
    CardVerificationProvider: 'Paystack',
    CardVerificationChannel: 'card',
    CardVerificationSignature: clean(authorization.signature),
    CardVerificationBrand: clean(authorization.brand),
    CardVerificationLast4: clean(authorization.last4),
    CardVerificationExpMonth: clean(authorization.exp_month),
    CardVerificationExpYear: clean(authorization.exp_year),
    CardVerificationBank: clean(authorization.bank),
    CardVerificationCountryCode: clean(authorization.country_code),
    CardVerificationReusable: authorization.reusable === true
  };
}

export async function requestPaystackCardVerificationRefund(env, reference, amount, currency, fetchImpl = fetch) {
  if (!clean(env.PAYSTACK_SECRET_KEY)) throw new Error('Paystack refund credentials are not configured.');
  const response = await fetchImpl(PAYSTACK_REFUND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transaction: clean(reference),
      amount: Math.round(Number(amount || 0) * 100),
      currency: clean(currency).toUpperCase()
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.status === false) throw new Error(data.message || 'Paystack could not start the automatic verification refund.');
  return {
    status: clean(data.data?.status || 'Refund Requested'),
    refundId: clean(data.data?.id),
    reference: clean(data.data?.transaction?.reference || reference)
  };
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

export async function createScheduledPaystackSubscription(env, options = {}, fetchImpl = fetch) {
  const customer = clean(options.customerCode);
  const plan = clean(options.planCode);
  const authorization = clean(options.authorizationCode);
  const startMilliseconds = Date.parse(clean(options.startDate));
  if (!clean(env.PAYSTACK_SECRET_KEY) || !customer || !plan || !authorization || !Number.isFinite(startMilliseconds)) {
    throw new Error('The future Paystack renewal could not be scheduled because its payment authorization or renewal details are incomplete.');
  }
  const response = await fetchImpl(PAYSTACK_SUBSCRIPTION_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customer,
      plan,
      authorization,
      start_date: new Date(startMilliseconds).toISOString()
    })
  });
  const data = await response.json().catch(() => ({}));
  const subscriptionCode = clean(data.data?.subscription_code);
  if (!response.ok || data.status === false || !subscriptionCode) {
    throw new Error(data.message || 'Paystack could not schedule the new recurring Flex price.');
  }
  return {
    subscriptionCode,
    emailToken: clean(data.data?.email_token),
    startDate: new Date(startMilliseconds).toISOString()
  };
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
  const preservedPaidThroughAt = clean(intent.PreservePaidThroughAt);
  const preservePaidPeriod = intent.PaymentAdjustment?.Type === 'FlexProration'
    && Number.isFinite(Date.parse(preservedPaidThroughAt));
  const preservedPeriodExpired = preservePaidPeriod
    && Date.parse(preservedPaidThroughAt) <= Date.parse(paidAt);
  const recoveryFields = preservePaidPeriod ? {
    SubscriptionStatus: preservedPeriodExpired ? 'Payment Grace' : 'Active',
    PaymentStatus: 'Paid',
    LifecycleStage: preservedPeriodExpired ? 'Payment Grace' : 'Active',
    PaidAt: clean(registration.PaidAt || registration.LastSuccessfulPaymentAt),
    LastSuccessfulPaymentAt: clean(registration.LastSuccessfulPaymentAt || registration.PaidAt),
    PaidThroughAt: preservedPaidThroughAt,
    RenewalDueAt: preservedPaidThroughAt,
    LastUpgradePaymentAt: paidAt,
    GracePeriodStartedAt: '',
    GracePeriodEndsAt: '',
    DataRetentionEndsAt: '',
    ExpiredPaidThroughAt: ''
  } : paidSubscriptionRecoveryFields({
    paidAt,
    billingCycle: clean(intent.BillingCycle),
    providerPaidThroughAt: clean(options.providerPaidThroughAt)
  });
  const providerFields = options.providerFields && typeof options.providerFields === 'object'
    ? options.providerFields
    : {};
  const receipt = buildSubscriptionReceipt(intent, registration, {
    reference,
    registrationReference,
    provider,
    paidAt,
    providerFields,
    issuedAt: updatedAt
  });
  const updatedRegistration = {
    ...withoutFirestoreMetadata(registration),
    Plan: clean(intent.Plan),
    BillingCycle: clean(intent.BillingCycle),
    UserLimit: Math.max(1, Number(intent.UserLimit || registration.UserLimit || 5) || 5),
    FeatureEntitlements: intent.FeatureEntitlements || registration.FeatureEntitlements || [],
    PriceSnapshot: intent.PriceSnapshot || registration.PriceSnapshot || null,
    PlanCatalogRevision: clean(intent.PlanCatalogRevision || registration.PlanCatalogRevision),
    Price: Number(intent.FullCycleAmount || intent.Amount || 0),
    Currency: clean(intent.Currency || 'NGN'),
    ...recoveryFields,
    Status: 'Payment Confirmed',
    SubscriptionPaymentProvider: provider,
    SubscriptionPaymentReference: reference,
    LastSubscriptionReceiptNo: receipt.ReceiptNo,
    LastSubscriptionReceiptReference: reference,
    LastSubscriptionReceiptAt: receipt.IssuedAt,
    PreviousPaystackSubscriptionCode: clean(intent.PreviousPaystackSubscriptionCode),
    PendingPlan: '',
    PendingBillingCycle: '',
    PendingPrice: 0,
    PendingChargeAmount: 0,
    PendingUserLimit: 0,
    PendingFeatureEntitlements: [],
    PendingPriceSnapshot: null,
    PendingPaystackPlanCode: '',
    PendingPaystackReference: '',
    PendingAuthorizationUrl: '',
    PendingPaymentMethod: '',
    PendingDirectTransferReference: '',
    AutoRenewalEnabled: paystack && Boolean(clean(providerFields.PaystackSubscriptionCode)),
    ...(paystack ? {
      PaystackReference: reference,
      PaystackPlanCode: clean(intent.PaystackPlanCode),
      PaystackCustomerCode: clean(providerFields.PaystackCustomerCode),
      PaystackSubscriptionCode: clean(providerFields.PaystackSubscriptionCode),
      PaystackSubscriptionEmailToken: clean(providerFields.PaystackSubscriptionEmailToken),
      PaystackSubscriptionStartsAt: clean(providerFields.PaystackSubscriptionStartsAt),
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
    patchDocumentFields(platformEnv, 'subscriptionPayments', reference, {
      Status: 'Paid',
      PaymentMethod: provider,
      PaidAt: paidAt,
      ReceiptNo: receipt.ReceiptNo,
      Receipt: receipt,
      ...providerFields,
      UpdatedAt: updatedAt
    }),
    upsertDocument(platformEnv, 'tenantRegistrations', registrationReference, updatedRegistration),
    upsertDocument(platformEnv, 'subscriptionReceipts', reference, receipt)
  ]);
  await syncRegistrationSubscriptionToWorkspace(env, updatedRegistration);
  let receiptDelivery = { sent: false, status: 'Failed' };
  try {
    receiptDelivery = await deliverSubscriptionReceiptEmail(env, platformEnv, reference, receipt);
  } catch (error) {
    console.error(JSON.stringify({
      event: 'subscription_receipt_email_failed',
      reference,
      registrationReference,
      message: clean(error.message || error).slice(0, 300)
    }));
  }
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
    receipt: publicSubscriptionReceipt(receipt),
    receiptUrl: subscriptionReceiptUrl(env, receipt),
    receiptEmailStatus: clean(receiptDelivery.status),
    receiptEmailSent: receiptDelivery.sent === true,
    updatedRegistration,
    ...activation
  };
}

export async function recordVerifiedCardVerification(env, transaction, requestedRegistrationReference = '') {
  const platformEnv = requirePlatformFirestoreEnv(env);
  const reference = safeId(transaction.reference);
  let intent = await getDocument(platformEnv, 'subscriptionPayments', reference);
  if (!intent || clean(intent.PaymentPurpose).toLowerCase() !== 'card verification') {
    const error = new Error('The saved card-verification request was not found.');
    error.status = 409;
    throw error;
  }
  const metadata = metadataFromTransaction(transaction);
  if (clean(metadata.paymentType).toLowerCase() !== 'dynamaxcardverification') {
    const error = new Error('This transaction is not a Dynamax card verification.');
    error.status = 409;
    throw error;
  }
  const registrationReference = clean(
    metadata.registrationReference || intent.RegistrationReference || requestedRegistrationReference
  );
  if (!registrationReference || (clean(requestedRegistrationReference)
      && clean(requestedRegistrationReference).toLowerCase() !== registrationReference.toLowerCase())) {
    const error = new Error('The card verification belongs to a different organisation registration.');
    error.status = 409;
    throw error;
  }
  const savedRegistration = await getDocument(platformEnv, 'tenantRegistrations', registrationReference);
  if (!savedRegistration) {
    const error = new Error('The organisation registration for this card verification was not found.');
    error.status = 409;
    throw error;
  }
  if (clean(intent.Plan).toLowerCase() !== 'free' || clean(metadata.plan).toLowerCase() !== 'free') {
    const error = new Error('The card verification does not match the saved free-trial request.');
    error.status = 409;
    throw error;
  }
  const paidAmount = Number(transaction.requested_amount || transaction.amount || 0) / 100;
  if (Math.abs(Number(intent.Amount || 0) - paidAmount) > 0.01
      || clean(intent.Currency).toUpperCase() !== clean(transaction.currency || intent.Currency).toUpperCase()) {
    const error = new Error('The verified card transaction does not match the saved verification amount.');
    error.status = 409;
    throw error;
  }
  const paidAt = clean(transaction.paid_at || transaction.paidAt) || new Date().toISOString();
  const cardFields = verifiedPaystackCardFields(transaction, paidAt);
  const alreadyRefundedOrRequested = ['refund requested', 'pending', 'processing', 'processed', 'refunded']
    .includes(clean(intent.CardVerificationRefundStatus).toLowerCase());
  let ownsRefundRequest = false;
  if (!alreadyRefundedOrRequested) {
    try {
      await patchDocumentFieldsIfCurrent(platformEnv, 'subscriptionPayments', reference, {
        Status: 'Processing Card Verification',
        CardVerificationProcessingAt: new Date().toISOString(),
        UpdatedAt: new Date().toISOString()
      }, intent);
      ownsRefundRequest = true;
    } catch (error) {
      if (error?.code !== 'FIRESTORE_WRITE_CONFLICT') throw error;
      intent = await getDocument(platformEnv, 'subscriptionPayments', reference) || intent;
    }
  }
  const now = new Date().toISOString();
  const pendingRegistration = {
    ...withoutFirestoreMetadata(savedRegistration),
    Plan: 'Free',
    BillingCycle: 'monthly',
    Price: 0,
    Currency: clean(intent.Currency || 'NGN'),
    UserLimit: Math.max(1, Number(intent.UserLimit || savedRegistration.UserLimit || 5) || 5),
    FeatureEntitlements: intent.FeatureEntitlements || savedRegistration.FeatureEntitlements || [],
    PlanCatalogRevision: clean(intent.PlanCatalogRevision || savedRegistration.PlanCatalogRevision),
    ...cardFields,
    CardVerificationReference: reference,
    CardVerificationAuthorizationUrl: '',
    PaymentStatus: 'Free Trial',
    SubscriptionStatus: clean(savedRegistration.TrialStartedAt) ? clean(savedRegistration.SubscriptionStatus || 'Trialing') : 'Pending Trial Activation',
    Status: clean(savedRegistration.TrialStartedAt) ? clean(savedRegistration.Status || 'Trial Active') : 'Pending Trial Activation',
    TrialReservedAt: clean(savedRegistration.TrialReservedAt) || now,
    UpdatedAt: now
  };
  await Promise.all([
    upsertDocument(platformEnv, 'tenantRegistrations', registrationReference, pendingRegistration),
    patchDocumentFields(platformEnv, 'subscriptionPayments', reference, {
      Status: 'Card Verified',
      PaymentMethod: 'Paystack Card Verification',
      PaidAt: paidAt,
      ...cardFields,
      UpdatedAt: now
    })
  ]);

  let refundStatus = clean(intent.CardVerificationRefundStatus);
  let refundWarning = '';
  if (ownsRefundRequest) {
    try {
      const refund = await requestPaystackCardVerificationRefund(
        env,
        reference,
        intent.Amount,
        intent.Currency
      );
      refundStatus = clean(refund.status || 'Refund Requested');
      await patchDocumentFields(platformEnv, 'subscriptionPayments', reference, {
        CardVerificationRefundStatus: refundStatus,
        CardVerificationRefundId: refund.refundId,
        CardVerificationRefundRequestedAt: new Date().toISOString(),
        UpdatedAt: new Date().toISOString()
      });
    } catch (error) {
      refundStatus = 'Refund Failed';
      refundWarning = 'Your card was verified, but the automatic verification-charge refund needs Dynamax support attention.';
      await patchDocumentFields(platformEnv, 'subscriptionPayments', reference, {
        CardVerificationRefundStatus: refundStatus,
        CardVerificationRefundError: clean(error.message || error).slice(0, 500),
        UpdatedAt: new Date().toISOString()
      }).catch(() => null);
    }
  }

  const assignment = clean(pendingRegistration.WorkspaceId)
    ? { assigned: true, registration: pendingRegistration }
    : await reserveTenantProjectSlot(platformEnv, pendingRegistration);
  let updatedRegistration = assignment.registration;
  if (assignment.assigned && !clean(updatedRegistration.TrialStartedAt)) {
    const trial = freeTrialWindow();
    updatedRegistration = {
      ...withoutFirestoreMetadata(updatedRegistration),
      PaymentStatus: 'Free Trial',
      SubscriptionStatus: 'Trialing',
      Status: 'Trial Active',
      LifecycleStage: 'Trialing',
      ProvisioningStatus: 'Ready',
      ...trial,
      UpdatedAt: new Date().toISOString()
    };
    await upsertDocument(platformEnv, 'tenantRegistrations', registrationReference, updatedRegistration);
    await recordTrialUseTombstone(platformEnv, updatedRegistration).catch(() => null);
    await syncRegistrationSubscriptionToWorkspace(env, updatedRegistration);
  }
  let activation = {};
  if (assignment.assigned && clean(updatedRegistration.WorkspaceId)) {
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
    } catch (_error) {
      activation = { activationPending: true };
    }
  }
  return {
    registrationReference,
    plan: 'Free',
    billingCycle: 'monthly',
    amount: 0,
    currency: clean(intent.Currency || 'NGN'),
    cardVerification: true,
    cardVerified: true,
    verificationCharge: Number(intent.Amount || 0),
    refundStatus: refundStatus || 'Processing',
    workspaceId: clean(updatedRegistration.WorkspaceId),
    portalUrl: clean(updatedRegistration.PortalUrl),
    workspacePending: !clean(updatedRegistration.WorkspaceId),
    trialStartedAt: clean(updatedRegistration.TrialStartedAt),
    trialEndsAt: clean(updatedRegistration.TrialEndsAt),
    warning: refundWarning,
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
  if (clean(metadata.paymentType).toLowerCase() === 'dynamaxcardverification') {
    return recordVerifiedCardVerification(env, transaction, requestedRegistrationReference);
  }
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
  const cardFields = verifiedPaystackCardFields(
    transaction,
    clean(transaction.paid_at || transaction.paidAt) || new Date().toISOString()
  );
  const cardVerifiedRegistration = {
    ...withoutFirestoreMetadata(savedRegistration),
    ...cardFields,
    CardVerificationReference: reference,
    UpdatedAt: new Date().toISOString()
  };
  await upsertDocument(platformEnv, 'tenantRegistrations', registrationReference, cardVerifiedRegistration);
  const customerCode = clean(transaction.customer?.customer_code);
  let subscriptionCode = clean(transaction.subscription_code || transaction.subscription?.subscription_code);
  let subscriptionEmailToken = '';
  let subscriptionStartsAt = '';
  let recurringScheduleWarning = '';
  const paidAt = clean(transaction.paid_at || transaction.paidAt) || new Date().toISOString();
  if (intent.PaymentAdjustment?.Type === 'FlexProration') {
    try {
      const scheduled = await createScheduledPaystackSubscription(env, {
        customerCode,
        planCode: intent.PaystackPlanCode,
        authorizationCode: transaction.authorization?.authorization_code,
        startDate: intent.PreservePaidThroughAt
      });
      subscriptionCode = scheduled.subscriptionCode;
      subscriptionEmailToken = scheduled.emailToken;
      subscriptionStartsAt = scheduled.startDate;
    } catch (error) {
      subscriptionCode = clean(savedRegistration.PaystackSubscriptionCode);
      recurringScheduleWarning = 'Your prorated Flex upgrade is active, but the new recurring price could not be scheduled automatically. Dynamax support must update it before your next renewal date.';
      intent.RecurringPlanScheduleError = clean(error.message || error).slice(0, 500);
    }
  }
  const result = await activateSavedSubscriptionPayment(env, {
    platformEnv,
    reference,
    intent,
    savedRegistration: cardVerifiedRegistration,
    registrationReference,
    provider: 'Paystack',
    paidAt,
    providerPaidThroughAt: paystackPaidThroughAt(transaction),
    providerFields: {
      PaystackTransactionId: clean(transaction.id),
      PaystackCustomerCode: customerCode,
      PaystackSubscriptionCode: subscriptionCode,
      PaystackSubscriptionEmailToken: subscriptionEmailToken,
      PaystackSubscriptionStartsAt: subscriptionStartsAt,
      RecurringPlanScheduleError: clean(intent.RecurringPlanScheduleError),
      ...cardFields
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
    warning: [recurringScheduleWarning, previousSubscriptionWarning].filter(Boolean).join(' '),
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
      message: result.warning || (result.cardVerification
        ? result.workspacePending
          ? 'Your bank card is verified and the verification refund has been requested. Your isolated trial workspace is being prepared.'
          : 'Your bank card is verified, the verification refund has been requested, and your isolated trial workspace is ready.'
        : result.workspacePending
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
