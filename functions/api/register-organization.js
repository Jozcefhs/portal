import { createDocumentIfAbsent, getDocument, queryCollection, upsertDocument } from '../lib/firestore.js';
import { normalizeOrganizationEdition } from '../lib/organization-config.js';
import { loadDeploymentIdentity } from '../lib/deployment-identity.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import {
  freeTrialWindow,
  normalizeBillingCycle,
  normalizeSubscriptionPlan,
  normalizeSubscriptionPlanCatalog,
  subscriptionPaystackPlanCode,
  subscriptionAccessState,
  subscriptionFlexQuote,
  subscriptionPlanEntitlements,
  subscriptionPlanPrice
} from '../lib/subscription-plans.js';
import {
  beginIdempotentRequest,
  completeIdempotentRequest,
  failIdempotentRequest,
  readJsonBody,
  verifyTurnstile
} from '../lib/request-security.js';
import { syncRegistrationSubscriptionToWorkspace } from '../lib/subscription-workspace-sync.js';
import { requirePlatformFirestoreEnv } from '../lib/platform-firestore.js';
import { reserveTenantProjectSlot } from '../lib/tenant-project-pool.js';
import { issueTenantActivation } from '../lib/tenant-activation.js';
import { issueRegistrationOnboarding } from '../lib/registration-onboarding.js';
import {
  findTrialUseTombstone,
  recordTrialUseTombstone,
  tenantTrialFingerprint
} from '../lib/tenant-trial-lifecycle.js';
import {
  platformTransferEvidence,
  publicPlatformPaymentMethods
} from '../lib/platform-direct-bank-transfer.js';

const clean = (value) => String(value ?? '').trim();
const PAYSTACK_INITIALIZE_URL = 'https://api.paystack.co/transaction/initialize';
const PAYSTACK_PLAN_URL = 'https://api.paystack.co/plan';

function normalizeSubscriptionPaymentMethod(value) {
  const method = clean(value || 'paystack').toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (['paystack', 'online', 'card', 'ussd', 'bank', 'paywithbank'].includes(method)) return 'paystack';
  if (['directbanktransfer', 'directtransfer', 'manualtransfer', 'transfer'].includes(method)) return 'direct_bank_transfer';
  const error = new Error('Choose Pay online or Direct bank transfer.');
  error.status = 400;
  throw error;
}

function comparable(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

async function authenticatedWorkspaceBinding(env, request, organizationName) {
  const credentialHeader = `${request.headers.get('Cookie') || ''} ${request.headers.get('Authorization') || ''}`;
  if (!/__Host-digc_staff_session=|school_staff_session=|Bearer\s+/i.test(credentialHeader)) return null;
  try {
    const user = await requireStaffSession(env, request);
    if (clean(user.role || user.Role) !== 'Super Admin') return null;
    const identity = await loadDeploymentIdentity(env);
    if (comparable(identity.organisationName) !== comparable(organizationName)) return null;
    return { WorkspaceId: identity.workspaceId };
  } catch (_error) {
    return null;
  }
}

function withoutFirestoreMetadata(document = {}) {
  const value = { ...document };
  delete value.__id;
  delete value.__name;
  delete value.__createTime;
  delete value.__updateTime;
  return value;
}

async function supersedePendingSubscriptionPayment(platformEnv, paymentReference, replacementReference) {
  const reference = clean(paymentReference);
  if (!reference || reference === clean(replacementReference)) return;
  const payment = await getDocument(platformEnv, 'subscriptionPayments', reference).catch(() => null);
  if (!payment || !['initializing', 'awaiting payment', 'awaiting verification'].includes(clean(payment.Status).toLowerCase())) return;
  await upsertDocument(platformEnv, 'subscriptionPayments', reference, {
    ...withoutFirestoreMetadata(payment),
    Status: 'Superseded',
    SupersededBy: clean(replacementReference),
    UpdatedAt: new Date().toISOString()
  });
}

async function loadPlanCatalog(platformEnv) {
  const saved = await getDocument(platformEnv, 'settings', 'dynamaxPlanCatalog');
  return normalizeSubscriptionPlanCatalog(saved || {});
}

function subscriptionSelection(catalog, plan, edition, billingCycle, flexModules = [], flexUserLimit = 0) {
  if (plan === 'Flex') return subscriptionFlexQuote(catalog, edition, flexModules, flexUserLimit, billingCycle);
  return {
    Plan: plan,
    Edition: clean(edition),
    BillingCycle: billingCycle,
    Currency: catalog.Currency,
    Amount: subscriptionPlanPrice(catalog, plan, billingCycle),
    UserLimit: catalog.Plans[plan].UserLimit,
    FeatureEntitlements: subscriptionPlanEntitlements(plan, edition, catalog),
    PriceSnapshot: {
      Type: 'Fixed',
      CatalogRevision: catalog.PolicyRevision,
      CatalogUpdatedAt: catalog.UpdatedAt,
      Currency: catalog.Currency,
      BillingCycle: billingCycle,
      TotalAmount: subscriptionPlanPrice(catalog, plan, billingCycle)
    }
  };
}

async function sha256(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(clean(value)));
  return [...new Uint8Array(bytes)].map((part) => part.toString(16).padStart(2, '0')).join('');
}

async function flexPaystackPlanCode(env, platformEnv, selection) {
  if (!clean(env.PAYSTACK_SECRET_KEY)) {
    const error = new Error('Online subscription payment is not configured yet.');
    error.status = 503;
    throw error;
  }
  const signature = await sha256(JSON.stringify({
    currency: selection.Currency,
    billingCycle: selection.BillingCycle,
    amount: selection.Amount,
    userLimit: selection.UserLimit,
    modules: selection.FeatureEntitlements
  }));
  const documentId = `flex-${signature.slice(0, 48)}`;
  const saved = await getDocument(platformEnv, 'subscriptionFlexPaystackPlans', documentId).catch(() => null);
  if (clean(saved?.PaystackPlanCode)) return clean(saved.PaystackPlanCode);
  const yearly = selection.BillingCycle === 'yearly';
  const response = await fetch(PAYSTACK_PLAN_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Dynamax Flex ${signature.slice(0, 8).toUpperCase()} - ${yearly ? 'Yearly' : 'Monthly'}`,
      amount: Math.round(Number(selection.Amount || 0) * 100),
      interval: yearly ? 'annually' : 'monthly',
      currency: clean(selection.Currency).toUpperCase() || 'NGN',
      description: `Flex subscription: ${selection.FeatureEntitlements.length} modules, ${selection.UserLimit} active users`,
      send_invoices: true,
      send_sms: false
    })
  });
  const data = await response.json().catch(() => ({}));
  const planCode = clean(data.data?.plan_code);
  if (!response.ok || data.status === false || !planCode) {
    const error = new Error(data.message || 'Paystack could not create the selected Flex subscription price.');
    error.status = 502;
    throw error;
  }
  await upsertDocument(platformEnv, 'subscriptionFlexPaystackPlans', documentId, {
    Signature: signature,
    PaystackPlanCode: planCode,
    PriceSnapshot: selection.PriceSnapshot,
    CreatedAt: new Date().toISOString()
  });
  return planCode;
}

async function activationResponse(env, platformEnv, registrationReference) {
  const registration = await getDocument(platformEnv, 'tenantRegistrations', clean(registrationReference));
  if (!registration) return {};
  try {
    const activation = await issueTenantActivation(platformEnv, registration, env);
    if (activation.issued) {
      return {
        activationUrl: activation.activationUrl,
        activationExpiresAt: activation.expiresAt,
        activationEmailSent: activation.emailSent,
        activationEmailStatus: activation.emailStatus
      };
    }
    if (activation.alreadyActivated) return { loginUrl: activation.loginUrl, administratorActivated: true };
    return {};
  } catch (error) {
    console.error(JSON.stringify({
      event: 'tenant_activation_issue_failed',
      registrationReference: clean(registrationReference),
      message: clean(error.message || error).slice(0, 300)
    }));
    return { activationPending: true };
  }
}

async function onboardingResponse(request, platformEnv, registrationReference, activation = {}) {
  if (clean(activation.activationUrl || activation.loginUrl)) return {};
  try {
    return await issueRegistrationOnboarding(platformEnv, registrationReference, request.url);
  } catch (error) {
    console.error(JSON.stringify({
      event: 'registration_onboarding_link_failed',
      registrationReference: clean(registrationReference),
      message: clean(error.message || error).slice(0, 300)
    }));
    return {};
  }
}

export async function initializeSubscriptionCheckout({
  request,
  env,
  platformEnv,
  registration,
  catalog,
  plan,
  billingCycle,
  preserveActivePlan = false,
  paymentMethod = 'paystack',
  paymentEvidence = {},
  flexModules = [],
  flexUserLimit = 0,
  paymentAdjustment = null
}) {
  const planEntry = catalog.Plans[plan];
  if (!planEntry.Active) {
    const error = new Error(`${plan} registration is not currently available.`);
    error.status = 409;
    throw error;
  }
  if (plan === 'Free') {
    const registrationReference = clean(registration.Reference || registration.__id);
    const priorTrialStartedAt = clean(registration.TrialStartedAt);
    if (clean(registration.PaymentStatus).toLowerCase() === 'paid'
      || (clean(registration.Status).toLowerCase() === 'active' && clean(registration.Plan) !== 'Free')) {
      const error = new Error('The free trial is available only before an organisation activates a paid subscription.');
      error.status = 409;
      throw error;
    }
    if (priorTrialStartedAt) {
      const access = subscriptionAccessState({
        Plan: 'Free',
        SubscriptionStatus: registration.SubscriptionStatus,
        TrialStartedAt: priorTrialStartedAt,
        TrialEndsAt: registration.TrialEndsAt
      });
      if (!access.SubscriptionActive) {
        const error = new Error('This organisation has already used its 7-day free trial. Choose a paid subscription to continue.');
        error.status = 409;
        throw error;
      }
      const currentRegistration = {
        ...withoutFirestoreMetadata(registration),
        WorkspaceId: clean(registration.WorkspaceId),
        FeatureEntitlements: subscriptionPlanEntitlements('Free', clean(registration.Edition), catalog),
        PlanCatalogRevision: catalog.PolicyRevision,
        UpdatedAt: new Date().toISOString()
      };
      await upsertDocument(platformEnv, 'tenantRegistrations', registrationReference, currentRegistration);
      await recordTrialUseTombstone(platformEnv, currentRegistration).catch(() => null);
      await syncRegistrationSubscriptionToWorkspace(env, currentRegistration);
      return {
        trialActive: true,
        trialStartedAt: access.TrialStartedAt,
        trialEndsAt: access.TrialEndsAt,
        trialDaysRemaining: access.TrialDaysRemaining,
        amount: 0
      };
    }
    if (!clean(registration.WorkspaceId)) {
      const reservedAt = clean(registration.TrialReservedAt) || new Date().toISOString();
      await upsertDocument(platformEnv, 'tenantRegistrations', registrationReference, {
        ...withoutFirestoreMetadata(registration),
        Plan: 'Free',
        BillingCycle: 'monthly',
        Price: 0,
        Currency: catalog.Currency,
        UserLimit: planEntry.UserLimit,
        FeatureEntitlements: subscriptionPlanEntitlements('Free', clean(registration.Edition), catalog),
        PlanCatalogRevision: catalog.PolicyRevision,
        PaymentStatus: 'Not Required',
        SubscriptionStatus: 'Pending Trial Activation',
        Status: 'Pending Trial Activation',
        TrialReservedAt: reservedAt,
        UpdatedAt: new Date().toISOString()
      });
      return { trialReserved: true, trialActive: false, amount: 0 };
    }
    const trial = freeTrialWindow();
    const activatedRegistration = {
      ...withoutFirestoreMetadata(registration),
      Plan: 'Free',
      BillingCycle: 'monthly',
      Price: 0,
      Currency: catalog.Currency,
      UserLimit: planEntry.UserLimit,
      FeatureEntitlements: subscriptionPlanEntitlements('Free', clean(registration.Edition), catalog),
      PlanCatalogRevision: catalog.PolicyRevision,
      PaymentStatus: 'Not Required',
      SubscriptionStatus: 'Trialing',
      Status: 'Trial Active',
      ...trial,
      UpdatedAt: new Date().toISOString()
    };
    await upsertDocument(platformEnv, 'tenantRegistrations', registrationReference, activatedRegistration);
    await recordTrialUseTombstone(platformEnv, activatedRegistration).catch(() => null);
    await syncRegistrationSubscriptionToWorkspace(env, activatedRegistration);
    return {
      trialActive: true,
      trialStartedAt: trial.TrialStartedAt,
      trialEndsAt: trial.TrialEndsAt,
      trialDaysRemaining: 7,
      amount: 0
    };
  }
  if (['retiring', 'retired'].includes(clean(registration.LifecycleStage).toLowerCase())) {
    const error = new Error('This workspace has reached permanent retirement and can no longer be upgraded. Register a new paid workspace or contact Dynamax support.');
    error.status = 410;
    error.code = 'TENANT_RETIREMENT_STARTED';
    throw error;
  }
  const selection = subscriptionSelection(catalog, plan, clean(registration.Edition), billingCycle, flexModules, flexUserLimit);
  const fullCycleAmount = Number(selection.Amount || 0);
  const adjustment = paymentAdjustment?.Type === 'FlexProration' ? { ...paymentAdjustment } : null;
  if (adjustment && (!preserveActivePlan || plan !== 'Flex'
      || Math.abs(Number(adjustment.FullCycleAmount || 0) - fullCycleAmount) > 0.01
      || !(Number(adjustment.ChargeAmount || 0) > 0))) {
    const error = new Error('The Flex upgrade price adjustment is invalid.');
    error.status = 409;
    throw error;
  }
  const amount = adjustment ? Number(adjustment.ChargeAmount) : fullCycleAmount;
  const selectedUserLimit = selection.UserLimit;
  const selectedEntitlements = selection.FeatureEntitlements;
  const priceSnapshot = adjustment
    ? { ...selection.PriceSnapshot, LastUpgradeCharge: adjustment }
    : selection.PriceSnapshot;
  if (!(amount > 0)) {
    await upsertDocument(platformEnv, 'tenantRegistrations', clean(registration.Reference || registration.__id), {
      ...withoutFirestoreMetadata(registration),
      Plan: plan,
      BillingCycle: billingCycle,
      Price: 0,
      Currency: catalog.Currency,
      UserLimit: selectedUserLimit,
      FeatureEntitlements: selectedEntitlements,
      PriceSnapshot: priceSnapshot,
      PlanCatalogRevision: catalog.PolicyRevision,
      PaymentStatus: 'Pending Plan Confirmation',
      Status: 'Pending Activation',
      UpdatedAt: new Date().toISOString()
    });
    return null;
  }
  const selectedPaymentMethod = normalizeSubscriptionPaymentMethod(paymentMethod);
  if (adjustment && selectedPaymentMethod === 'direct_bank_transfer') {
    const error = new Error('Prorated Flex upgrades must be paid online by card so the new recurring price can begin on the existing renewal date.');
    error.status = 409;
    throw error;
  }
  const availableMethods = await publicPlatformPaymentMethods(env);
  if (selectedPaymentMethod === 'direct_bank_transfer') {
    const directTransfer = availableMethods.directTransfer || {};
    if (!directTransfer.enabled) {
      const error = new Error('Dynamax direct bank transfer is not configured yet.');
      error.status = 503;
      throw error;
    }
    if (clean(directTransfer.currency).toUpperCase() !== clean(catalog.Currency).toUpperCase()) {
      const error = new Error(`Dynamax direct transfer is available in ${directTransfer.currency}, not ${catalog.Currency}.`);
      error.status = 409;
      throw error;
    }
    const reusableReference = clean(registration.PendingDirectTransferReference)
      || (!preserveActivePlan ? clean(registration.DirectTransferReference) : '');
    if (clean(registration.PendingPlan || registration.Plan) === plan
      && clean(registration.PendingBillingCycle || registration.BillingCycle) === billingCycle
      && Number(registration.PendingPrice || registration.Price) === Number(amount)
      && JSON.stringify(registration.PendingFeatureEntitlements || registration.FeatureEntitlements || []) === JSON.stringify(selectedEntitlements)
      && reusableReference) {
      const prior = await getDocument(platformEnv, 'subscriptionPayments', reusableReference);
      if (prior && ['awaiting verification', 'approval processing'].includes(clean(prior.Status).toLowerCase())) {
        return {
          directTransfer: true,
          paymentMethod: 'Direct Bank Transfer',
          paymentReference: reusableReference,
          status: clean(prior.Status),
          amount,
          bankDetails: directTransfer
        };
      }
    }
    const evidence = platformTransferEvidence(paymentEvidence);
    const reference = `DMX-TRF-${Date.now()}-${crypto.randomUUID().slice(0, 10).toUpperCase()}`;
    const now = new Date().toISOString();
    await upsertDocument(platformEnv, 'subscriptionPayments', reference, {
      Reference: reference,
      RegistrationReference: clean(registration.Reference || registration.__id),
      OrganisationName: clean(registration.OrganisationName),
      Email: clean(registration.Email).toLowerCase(),
      Plan: plan,
      BillingCycle: billingCycle,
      Amount: amount,
      Currency: catalog.Currency,
      UserLimit: selectedUserLimit,
      FeatureEntitlements: selectedEntitlements,
      PriceSnapshot: priceSnapshot,
      PlanCatalogRevision: catalog.PolicyRevision,
      PreviousPaystackSubscriptionCode: clean(registration.PaystackSubscriptionCode),
      PaymentMethod: 'Direct Bank Transfer',
      PreserveActivePlan: Boolean(preserveActivePlan),
      ...evidence,
      BankName: clean(directTransfer.bankName),
      AccountName: clean(directTransfer.accountName),
      AccountNumber: clean(directTransfer.accountNumber),
      Status: 'Awaiting Verification',
      CreatedAt: now,
      UpdatedAt: now
    });
    const priorReferences = preserveActivePlan
      ? [registration.PendingDirectTransferReference, registration.PendingPaystackReference]
      : [registration.DirectTransferReference, clean(registration.PaymentStatus).toLowerCase() === 'paid' ? '' : registration.PaystackReference];
    await Promise.all(priorReferences.map((priorReference) =>
      supersedePendingSubscriptionPayment(platformEnv, priorReference, reference)));
    await upsertDocument(platformEnv, 'tenantRegistrations', clean(registration.Reference || registration.__id), preserveActivePlan ? {
      ...withoutFirestoreMetadata(registration),
      PendingPlan: plan,
      PendingBillingCycle: billingCycle,
      PendingPrice: amount,
      PendingUserLimit: selectedUserLimit,
      PendingFeatureEntitlements: selectedEntitlements,
      PendingPriceSnapshot: priceSnapshot,
      PendingPaymentMethod: 'Direct Bank Transfer',
      PendingDirectTransferReference: reference,
      PendingPaystackPlanCode: '',
      PendingPaystackReference: '',
      PendingAuthorizationUrl: '',
      UpdatedAt: now
    } : {
      ...withoutFirestoreMetadata(registration),
      Plan: plan,
      BillingCycle: billingCycle,
      Price: amount,
      Currency: catalog.Currency,
      UserLimit: selectedUserLimit,
      FeatureEntitlements: selectedEntitlements,
      PriceSnapshot: priceSnapshot,
      PlanCatalogRevision: catalog.PolicyRevision,
      DirectTransferReference: reference,
      PaystackPlanCode: '',
      PaystackReference: '',
      AuthorizationUrl: '',
      PaymentStatus: 'Awaiting Verification',
      Status: 'Awaiting Payment Verification',
      UpdatedAt: now
    });
    return {
      directTransfer: true,
      paymentMethod: 'Direct Bank Transfer',
      paymentReference: reference,
      status: 'Awaiting Verification',
      amount,
      bankDetails: directTransfer
    };
  }
  if (!availableMethods.online?.enabled) {
    const error = new Error('Dynamax online subscription payment is currently disabled. Choose direct bank transfer instead.');
    error.status = 503;
    throw error;
  }
  const planCode = plan === 'Flex'
    ? await flexPaystackPlanCode(env, platformEnv, selection)
    : subscriptionPaystackPlanCode(catalog, plan, billingCycle);
  if (!planCode) {
    const error = new Error(`${plan} ${billingCycle} pricing has not been synchronized with Paystack yet.`);
    error.status = 503;
    throw error;
  }
  if (!clean(env.PAYSTACK_SECRET_KEY)) {
    const error = new Error('Online subscription payment is not configured yet.');
    error.status = 503;
    throw error;
  }
  const reusableAuthorizationUrl = clean(registration.PendingAuthorizationUrl)
    || (!clean(registration.WorkspaceId) ? clean(registration.AuthorizationUrl) : '');
  const reusableReference = clean(registration.PendingPaystackReference || registration.PaystackReference);
  if (clean(preserveActivePlan ? registration.PendingPlan || registration.Plan : registration.Plan) === plan
    && clean(preserveActivePlan ? registration.PendingBillingCycle || registration.BillingCycle : registration.BillingCycle) === billingCycle
    && Number(preserveActivePlan ? registration.PendingChargeAmount || registration.PendingPrice : registration.Price) === Number(amount)
    && JSON.stringify(preserveActivePlan ? registration.PendingFeatureEntitlements || [] : registration.FeatureEntitlements || []) === JSON.stringify(selectedEntitlements)
    && reusableAuthorizationUrl
    && reusableReference
    && clean(registration.PaymentStatus).toLowerCase() !== 'paid') {
    return {
      authorizationUrl: reusableAuthorizationUrl,
      paymentReference: reusableReference,
      amount
    };
  }
  const reference = `DMX-SUB-${Date.now()}-${crypto.randomUUID().slice(0, 10)}`;
  const callbackUrl = new URL('/subscription-payment.html', new URL(request.url).origin);
  callbackUrl.searchParams.set('registration', clean(registration.Reference || registration.__id));
  const metadata = {
    paymentType: 'dynamaxSubscription',
    registrationReference: clean(registration.Reference || registration.__id),
    organisationName: clean(registration.OrganisationName),
    plan,
    billingCycle,
    expectedAmount: amount,
    fullCycleAmount,
    changeType: adjustment?.Type || '',
    edition: clean(registration.Edition)
  };
  await upsertDocument(platformEnv, 'subscriptionPayments', reference, {
    Reference: reference,
    RegistrationReference: metadata.registrationReference,
    Email: clean(registration.Email).toLowerCase(),
    Plan: plan,
    BillingCycle: billingCycle,
    Amount: amount,
    FullCycleAmount: fullCycleAmount,
    Currency: catalog.Currency,
    PaystackPlanCode: planCode,
    UserLimit: selectedUserLimit,
    FeatureEntitlements: selectedEntitlements,
    PriceSnapshot: priceSnapshot,
    PaymentAdjustment: adjustment,
    PreservePaidThroughAt: clean(adjustment?.PaidThroughAt),
    PlanCatalogRevision: catalog.PolicyRevision,
    PreviousPaystackSubscriptionCode: clean(registration.PaystackSubscriptionCode),
    Status: 'Initializing',
    CreatedAt: new Date().toISOString(),
    UpdatedAt: new Date().toISOString()
  });
  const paystackResponse = await fetch(PAYSTACK_INITIALIZE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: clean(registration.Email).toLowerCase(),
      amount: String(Math.round(amount * 100)),
      currency: catalog.Currency,
      reference,
      ...(adjustment ? { channels: ['card'] } : { plan: planCode }),
      callback_url: callbackUrl.href,
      metadata: JSON.stringify(metadata)
    })
  });
  const data = await paystackResponse.json().catch(() => ({}));
  if (!paystackResponse.ok || data.status === false || !clean(data.data?.authorization_url)) {
    await upsertDocument(platformEnv, 'subscriptionPayments', reference, {
      Reference: reference,
      RegistrationReference: metadata.registrationReference,
      Email: clean(registration.Email).toLowerCase(),
      Plan: plan,
      BillingCycle: billingCycle,
      Amount: amount,
      FullCycleAmount: fullCycleAmount,
      Currency: catalog.Currency,
      PaystackPlanCode: planCode,
      Status: 'Initialization Failed',
      LastError: clean(data.message || 'Paystack did not return a checkout link.').slice(0, 500),
      CreatedAt: new Date().toISOString(),
      UpdatedAt: new Date().toISOString()
    });
    const error = new Error(data.message || 'Paystack could not start the subscription payment.');
    error.status = 502;
    throw error;
  }
  const authorizationUrl = clean(data.data.authorization_url);
  const priorReferences = preserveActivePlan
    ? [registration.PendingDirectTransferReference, registration.PendingPaystackReference]
    : [registration.DirectTransferReference, clean(registration.PaymentStatus).toLowerCase() === 'paid' ? '' : registration.PaystackReference];
  await Promise.all(priorReferences.map((priorReference) =>
    supersedePendingSubscriptionPayment(platformEnv, priorReference, reference)));
  await Promise.all([
    upsertDocument(platformEnv, 'subscriptionPayments', reference, {
      Reference: reference,
      RegistrationReference: metadata.registrationReference,
      Email: clean(registration.Email).toLowerCase(),
      Plan: plan,
      BillingCycle: billingCycle,
      Amount: amount,
      FullCycleAmount: fullCycleAmount,
      Currency: catalog.Currency,
      PaystackPlanCode: planCode,
      UserLimit: selectedUserLimit,
      FeatureEntitlements: selectedEntitlements,
      PriceSnapshot: priceSnapshot,
      PaymentAdjustment: adjustment,
      PreservePaidThroughAt: clean(adjustment?.PaidThroughAt),
      PlanCatalogRevision: catalog.PolicyRevision,
      PreviousPaystackSubscriptionCode: clean(registration.PaystackSubscriptionCode),
      PaystackAccessCode: clean(data.data.access_code),
      AuthorizationUrl: authorizationUrl,
      Status: 'Awaiting Payment',
      CreatedAt: new Date().toISOString(),
      UpdatedAt: new Date().toISOString()
    }),
    upsertDocument(platformEnv, 'tenantRegistrations', metadata.registrationReference, preserveActivePlan ? {
      ...withoutFirestoreMetadata(registration),
      PendingPlan: plan,
      PendingBillingCycle: billingCycle,
      PendingPrice: fullCycleAmount,
      PendingChargeAmount: amount,
      PendingUserLimit: selectedUserLimit,
      PendingFeatureEntitlements: selectedEntitlements,
      PendingPriceSnapshot: priceSnapshot,
      PendingPaystackPlanCode: planCode,
      PendingPaystackReference: reference,
      PendingAuthorizationUrl: authorizationUrl,
      PendingPaymentMethod: 'Paystack',
      PendingDirectTransferReference: '',
      UpdatedAt: new Date().toISOString()
    } : {
      ...withoutFirestoreMetadata(registration),
      Plan: plan,
      BillingCycle: billingCycle,
      Price: amount,
      Currency: catalog.Currency,
      UserLimit: selectedUserLimit,
      FeatureEntitlements: selectedEntitlements,
      PriceSnapshot: priceSnapshot,
      PlanCatalogRevision: catalog.PolicyRevision,
      PaystackPlanCode: planCode,
      PaystackReference: reference,
      DirectTransferReference: '',
      AuthorizationUrl: authorizationUrl,
      PaymentStatus: 'Awaiting Payment',
      Status: 'Awaiting Payment',
      UpdatedAt: new Date().toISOString()
    })
  ]);
  return { authorizationUrl, paymentReference: reference, amount };
}

function validEmail(value) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean(value).toLowerCase());
}

export async function onRequestPost({ request, env }) {
  let idempotency = null;
  let platformEnv = null;
  try {
    platformEnv = requirePlatformFirestoreEnv(env);
    const body = await readJsonBody(request, { maxBytes: 700 * 1024 });
    const name = clean(body.OrganisationName);
    const email = clean(body.Email).toLowerCase();
    const plan = normalizeSubscriptionPlan(body.Plan);
    const billingCycle = normalizeBillingCycle(body.BillingCycle);
    const catalog = await loadPlanCatalog(platformEnv);
    const edition = normalizeOrganizationEdition(body.Edition);
    const requestedFlexModules = Array.isArray(body.FlexModules) ? body.FlexModules : [];
    const requestedFlexUserLimit = Number(body.FlexUserLimit || 0);
    const requestedSelection = subscriptionSelection(
      catalog,
      plan,
      edition,
      billingCycle,
      requestedFlexModules,
      requestedFlexUserLimit
    );
    if (!name || !clean(body.ContactName) || !validEmail(email) || !clean(body.Phone) || !clean(body.Country)) {
      const error = new Error('Organisation, contact name, valid email, phone and country are required.');
      error.status = 400; throw error;
    }
    if (clean(body.Consent).toUpperCase() !== 'YES') {
      const error = new Error('Authorisation confirmation is required.'); error.status = 400; throw error;
    }
    await verifyTurnstile(env, request, body, 'register_organization');
    const workspaceBinding = await authenticatedWorkspaceBinding(env, request, name);
    const {
      turnstileToken: _turnstileToken,
      turnstileAction: _turnstileAction,
      idempotencyKey: _idempotencyKey,
      ...idempotencyPayload
    } = body;
    idempotency = await beginIdempotentRequest(platformEnv, request, body, {
      scope: 'register-organization',
      actor: email,
      ttlMinutes: 30 * 24 * 60,
      fingerprintPayload: idempotencyPayload
    });
    if (idempotency.replay) {
      const activation = idempotency.response?.reference
        ? await activationResponse(env, platformEnv, idempotency.response.reference)
        : {};
      const onboarding = idempotency.response?.reference
        ? await onboardingResponse(request, platformEnv, idempotency.response.reference, activation)
        : {};
      return Response.json({ ...idempotency.response, ...activation, ...onboarding }, {
        status: idempotency.status || (idempotency.response?.ok === false ? 409 : 200),
        headers: { 'Cache-Control': 'no-store', 'Idempotency-Replayed': 'true' }
      });
    }
    const matchingRegistrations = (await queryCollection(platformEnv, 'tenantRegistrations', {
      filters: [{ field: 'Email', op: '==', value: email }],
      limit: 50
    }).catch(() => []))
      .filter((row) => clean(row.OrganisationName).toLowerCase() === name.toLowerCase());
    const priorTrial = matchingRegistrations.find((row) => clean(row.TrialStartedAt));
    const currentRegistration = matchingRegistrations.find((row) =>
      !['rejected', 'cancelled', 'retired', 'terminated', 'deleted'].includes(clean(row.Status).toLowerCase()));
    const trialFingerprint = await tenantTrialFingerprint(name, email);
    const trialTombstone = plan === 'Free'
      ? await findTrialUseTombstone(platformEnv, name, email)
      : null;
    if (plan === 'Free' && trialTombstone && !priorTrial && !currentRegistration) {
      const error = new Error('This organisation has already used its 7-day free trial. Choose a paid subscription to continue.');
      error.status = 409;
      throw error;
    }
    // A retired or rejected registration must not erase trial history. The same
    // organisation and contact email can never reset the server-issued clock.
    const existing = plan === 'Free' ? (priorTrial || currentRegistration) : currentRegistration;
    if (existing) {
      const boundRegistration = { ...existing, TrialFingerprint: clean(existing.TrialFingerprint) || trialFingerprint, ...(workspaceBinding || {}) };
      const assignment = plan === 'Free' && !clean(boundRegistration.WorkspaceId)
        ? await reserveTenantProjectSlot(platformEnv, boundRegistration)
        : { registration: boundRegistration, assigned: Boolean(clean(boundRegistration.WorkspaceId)) };
      const assignedRegistration = assignment.registration;
      const checkout = await initializeSubscriptionCheckout({
        request,
        env,
        platformEnv,
        registration: assignedRegistration,
        catalog,
        plan,
        billingCycle,
        paymentMethod: body.PaymentMethod,
        paymentEvidence: body,
        flexModules: requestedFlexModules,
        flexUserLimit: requestedFlexUserLimit
      });
      const result = {
        ok: true,
        reference: clean(existing.Reference || existing.__id),
        workspaceId: clean(assignedRegistration.WorkspaceId),
        portalUrl: clean(assignedRegistration.PortalUrl),
        workspacePending: !clean(assignedRegistration.WorkspaceId),
        message: checkout?.trialActive
          ? `Your 7-day full-access trial is active until ${new Date(checkout.trialEndsAt).toLocaleString('en-NG')}.`
          : checkout?.trialReserved
          ? 'Your free trial is reserved. Its 7-day clock will begin when your workspace is activated.'
          : checkout
          ? checkout.directTransfer
            ? 'Registration found. Your direct bank transfer is awaiting Dynamax verification.'
            : 'Registration found. Continue to Paystack to confirm the selected subscription.'
          : 'This organisation registration has already been received.',
        ...(checkout || {})
      };
      await completeIdempotentRequest(platformEnv, idempotency, result, 200);
      const activation = await activationResponse(env, platformEnv, result.reference);
      const onboarding = await onboardingResponse(request, platformEnv, result.reference, activation);
      return Response.json({ ...result, ...activation, ...onboarding }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const reference = `DMX-${Date.now()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    const created = await createDocumentIfAbsent(platformEnv, 'tenantRegistrations', reference, {
      Reference: reference, OrganisationName: name,
      Edition: edition,
      ContactName: clean(body.ContactName), Email: email, Phone: clean(body.Phone), Country: clean(body.Country),
      TrialFingerprint: trialFingerprint,
      Plan: plan,
      BillingCycle: billingCycle,
      UserLimit: requestedSelection.UserLimit,
      FeatureEntitlements: requestedSelection.FeatureEntitlements,
      PriceSnapshot: requestedSelection.PriceSnapshot,
      PlanCatalogRevision: catalog.PolicyRevision,
      ...(workspaceBinding || {}),
      PaymentStatus: 'Pending',
      Status: 'Pending Activation', CreatedAt: new Date().toISOString(), Source: 'Dynamax public registration'
    });
    if (!created.created) {
      const error = new Error('Could not reserve a unique registration reference. Please try again.');
      error.status = 409;
      throw error;
    }
    const savedRegistration = { ...created.document, Reference: reference };
    const assignment = plan === 'Free'
      ? await reserveTenantProjectSlot(platformEnv, savedRegistration)
      : { registration: savedRegistration, assigned: false };
    const registration = assignment.registration;
    const checkout = await initializeSubscriptionCheckout({
      request,
      env,
      platformEnv,
      registration,
      catalog,
      plan,
      billingCycle,
      paymentMethod: body.PaymentMethod,
      paymentEvidence: body,
      flexModules: requestedFlexModules,
      flexUserLimit: requestedFlexUserLimit
    });
    const result = {
      ok: true,
      reference,
      workspaceId: clean(registration.WorkspaceId),
      portalUrl: clean(registration.PortalUrl),
      workspacePending: !clean(registration.WorkspaceId),
      message: checkout
        ? checkout.trialActive
          ? `Your 7-day full-access trial is active until ${new Date(checkout.trialEndsAt).toLocaleString('en-NG')}.`
          : checkout.trialReserved
          ? 'Registration received. Your free trial is reserved, and its 7-day clock will begin when your workspace is activated.'
          : checkout.directTransfer
            ? 'Registration received. Your direct bank transfer is awaiting Dynamax verification.'
            : 'Registration received. Continue to Paystack to activate the selected subscription.'
        : 'Registration received. Your Dynamax workspace will be activated after plan confirmation.',
      ...(checkout || {})
    };
    await completeIdempotentRequest(platformEnv, idempotency, result, 200);
    const activation = await activationResponse(env, platformEnv, reference);
    const onboarding = await onboardingResponse(request, platformEnv, reference, activation);
    return Response.json({ ...result, ...activation, ...onboarding }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (idempotency?.owner && platformEnv) await failIdempotentRequest(platformEnv, idempotency, error);
    return Response.json({ ok: false, message: error.message || String(error) }, {
      status: error.status || 500,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}
