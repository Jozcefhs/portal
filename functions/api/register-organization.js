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

const clean = (value) => String(value ?? '').trim();
const PAYSTACK_INITIALIZE_URL = 'https://api.paystack.co/transaction/initialize';

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

async function loadPlanCatalog(platformEnv) {
  const saved = await getDocument(platformEnv, 'settings', 'dynamaxPlanCatalog');
  return normalizeSubscriptionPlanCatalog(saved || {});
}

export async function initializeSubscriptionCheckout({ request, env, platformEnv, registration, catalog, plan, billingCycle, preserveActivePlan = false }) {
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
    await syncRegistrationSubscriptionToWorkspace(env, activatedRegistration);
    return {
      trialActive: true,
      trialStartedAt: trial.TrialStartedAt,
      trialEndsAt: trial.TrialEndsAt,
      trialDaysRemaining: 7,
      amount: 0
    };
  }
  const amount = subscriptionPlanPrice(catalog, plan, billingCycle);
  if (!(amount > 0)) {
    await upsertDocument(platformEnv, 'tenantRegistrations', clean(registration.Reference || registration.__id), {
      ...withoutFirestoreMetadata(registration),
      Plan: plan,
      BillingCycle: billingCycle,
      Price: 0,
      Currency: catalog.Currency,
      UserLimit: planEntry.UserLimit,
      FeatureEntitlements: subscriptionPlanEntitlements(plan, clean(registration.Edition), catalog),
      PlanCatalogRevision: catalog.PolicyRevision,
      PaymentStatus: 'Pending Plan Confirmation',
      Status: 'Pending Activation',
      UpdatedAt: new Date().toISOString()
    });
    return null;
  }
  const planCode = subscriptionPaystackPlanCode(catalog, plan, billingCycle);
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
  if (clean(registration.Plan) === plan
    && clean(registration.BillingCycle) === billingCycle
    && clean(registration.AuthorizationUrl)
    && clean(registration.PaymentStatus).toLowerCase() !== 'paid') {
    return {
      authorizationUrl: clean(registration.AuthorizationUrl),
      paymentReference: clean(registration.PaystackReference),
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
    edition: clean(registration.Edition)
  };
  await upsertDocument(platformEnv, 'subscriptionPayments', reference, {
    Reference: reference,
    RegistrationReference: metadata.registrationReference,
    Email: clean(registration.Email).toLowerCase(),
    Plan: plan,
    BillingCycle: billingCycle,
    Amount: amount,
    Currency: catalog.Currency,
    PaystackPlanCode: planCode,
    UserLimit: planEntry.UserLimit,
    FeatureEntitlements: subscriptionPlanEntitlements(plan, clean(registration.Edition), catalog),
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
      plan: planCode,
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
  await Promise.all([
    upsertDocument(platformEnv, 'subscriptionPayments', reference, {
      Reference: reference,
      RegistrationReference: metadata.registrationReference,
      Email: clean(registration.Email).toLowerCase(),
      Plan: plan,
      BillingCycle: billingCycle,
      Amount: amount,
      Currency: catalog.Currency,
      PaystackPlanCode: planCode,
      UserLimit: planEntry.UserLimit,
      FeatureEntitlements: subscriptionPlanEntitlements(plan, clean(registration.Edition), catalog),
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
      PendingPrice: amount,
      PendingPaystackPlanCode: planCode,
      PendingPaystackReference: reference,
      PendingAuthorizationUrl: authorizationUrl,
      UpdatedAt: new Date().toISOString()
    } : {
      ...withoutFirestoreMetadata(registration),
      Plan: plan,
      BillingCycle: billingCycle,
      Price: amount,
      Currency: catalog.Currency,
      UserLimit: planEntry.UserLimit,
      FeatureEntitlements: subscriptionPlanEntitlements(plan, clean(registration.Edition), catalog),
      PlanCatalogRevision: catalog.PolicyRevision,
      PaystackPlanCode: planCode,
      PaystackReference: reference,
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
    const body = await readJsonBody(request, { maxBytes: 96 * 1024 });
    const name = clean(body.OrganisationName);
    const email = clean(body.Email).toLowerCase();
    const plan = normalizeSubscriptionPlan(body.Plan);
    const billingCycle = normalizeBillingCycle(body.BillingCycle);
    const catalog = await loadPlanCatalog(platformEnv);
    const edition = normalizeOrganizationEdition(body.Edition);
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
      return Response.json(idempotency.response, {
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
      !['rejected', 'cancelled'].includes(clean(row.Status).toLowerCase()));
    // A rejected/cancelled registration must not erase trial history. The same
    // organisation and contact email can never reset the server-issued clock.
    const existing = plan === 'Free' ? (priorTrial || currentRegistration) : currentRegistration;
    if (existing) {
      const checkout = await initializeSubscriptionCheckout({
        request,
        env,
        platformEnv,
        registration: { ...existing, ...(workspaceBinding || {}) },
        catalog,
        plan,
        billingCycle
      });
      const result = {
        ok: true,
        reference: clean(existing.Reference || existing.__id),
        message: checkout?.trialActive
          ? `Your 7-day full-access trial is active until ${new Date(checkout.trialEndsAt).toLocaleString('en-NG')}.`
          : checkout?.trialReserved
          ? 'Your free trial is reserved. Its 7-day clock will begin when your workspace is activated.'
          : checkout
          ? 'Registration found. Continue to Paystack to confirm the selected subscription.'
          : 'This organisation registration has already been received.',
        ...(checkout || {})
      };
      await completeIdempotentRequest(platformEnv, idempotency, result, 200);
      return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
    }
    const reference = `DMX-${Date.now()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    const created = await createDocumentIfAbsent(platformEnv, 'tenantRegistrations', reference, {
      Reference: reference, OrganisationName: name,
      Edition: edition,
      ContactName: clean(body.ContactName), Email: email, Phone: clean(body.Phone), Country: clean(body.Country),
      Plan: plan,
      BillingCycle: billingCycle,
      UserLimit: catalog.Plans[plan].UserLimit,
      FeatureEntitlements: subscriptionPlanEntitlements(plan, edition, catalog),
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
    const registration = { ...created.document, Reference: reference };
    const checkout = await initializeSubscriptionCheckout({ request, env, platformEnv, registration, catalog, plan, billingCycle });
    const result = {
      ok: true,
      reference,
      message: checkout
        ? checkout.trialActive
          ? `Your 7-day full-access trial is active until ${new Date(checkout.trialEndsAt).toLocaleString('en-NG')}.`
          : checkout.trialReserved
          ? 'Registration received. Your free trial is reserved, and its 7-day clock will begin when your workspace is activated.'
          : 'Registration received. Continue to Paystack to activate the selected subscription.'
        : 'Registration received. Your Dynamax workspace will be activated after plan confirmation.',
      ...(checkout || {})
    };
    await completeIdempotentRequest(platformEnv, idempotency, result, 200);
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (idempotency?.owner && platformEnv) await failIdempotentRequest(platformEnv, idempotency, error);
    return Response.json({ ok: false, message: error.message || String(error) }, {
      status: error.status || 500,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}
