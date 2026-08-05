import { createDocumentIfAbsent, getDocument, queryCollection, requireFirestoreEnv, upsertDocument } from '../lib/firestore.js';
import { normalizeOrganizationEdition } from '../lib/organization-config.js';
import {
  normalizeBillingCycle,
  normalizeSubscriptionPlan,
  normalizeSubscriptionPlanCatalog,
  subscriptionPaystackPlanCode,
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

const clean = (value) => String(value ?? '').trim();
const PAYSTACK_INITIALIZE_URL = 'https://api.paystack.co/transaction/initialize';

function withoutFirestoreMetadata(document = {}) {
  const value = { ...document };
  delete value.__id;
  delete value.__name;
  delete value.__createTime;
  delete value.__updateTime;
  return value;
}

async function loadPlanCatalog(env) {
  const saved = await getDocument(env, 'settings', 'dynamaxPlanCatalog').catch(() => null);
  return normalizeSubscriptionPlanCatalog(saved || {});
}

async function initializeSubscriptionCheckout({ request, env, registration, catalog, plan, billingCycle }) {
  const planEntry = catalog.Plans[plan];
  if (!planEntry.Active) {
    const error = new Error(`${plan} registration is not currently available.`);
    error.status = 409;
    throw error;
  }
  const amount = subscriptionPlanPrice(catalog, plan, billingCycle);
  if (!(amount > 0)) {
    await upsertDocument(env, 'tenantRegistrations', clean(registration.Reference || registration.__id), {
      ...withoutFirestoreMetadata(registration),
      Plan: plan,
      BillingCycle: billingCycle,
      Price: 0,
      Currency: catalog.Currency,
      UserLimit: planEntry.UserLimit,
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
  await upsertDocument(env, 'subscriptionPayments', reference, {
    Reference: reference,
    RegistrationReference: metadata.registrationReference,
    Email: clean(registration.Email).toLowerCase(),
    Plan: plan,
    BillingCycle: billingCycle,
    Amount: amount,
    Currency: catalog.Currency,
    PaystackPlanCode: planCode,
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
    await upsertDocument(env, 'subscriptionPayments', reference, {
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
    upsertDocument(env, 'subscriptionPayments', reference, {
      Reference: reference,
      RegistrationReference: metadata.registrationReference,
      Email: clean(registration.Email).toLowerCase(),
      Plan: plan,
      BillingCycle: billingCycle,
      Amount: amount,
      Currency: catalog.Currency,
      PaystackPlanCode: planCode,
      PaystackAccessCode: clean(data.data.access_code),
      AuthorizationUrl: authorizationUrl,
      Status: 'Awaiting Payment',
      CreatedAt: new Date().toISOString(),
      UpdatedAt: new Date().toISOString()
    }),
    upsertDocument(env, 'tenantRegistrations', metadata.registrationReference, {
      ...withoutFirestoreMetadata(registration),
      Plan: plan,
      BillingCycle: billingCycle,
      Price: amount,
      Currency: catalog.Currency,
      UserLimit: planEntry.UserLimit,
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
  try {
    requireFirestoreEnv(env);
    const body = await readJsonBody(request, { maxBytes: 96 * 1024 });
    const name = clean(body.OrganisationName);
    const email = clean(body.Email).toLowerCase();
    const plan = normalizeSubscriptionPlan(body.Plan);
    const billingCycle = normalizeBillingCycle(body.BillingCycle);
    const catalog = await loadPlanCatalog(env);
    const edition = normalizeOrganizationEdition(body.Edition);
    if (!name || !clean(body.ContactName) || !validEmail(email) || !clean(body.Phone) || !clean(body.Country)) {
      const error = new Error('Organisation, contact name, valid email, phone and country are required.');
      error.status = 400; throw error;
    }
    if (clean(body.Consent).toUpperCase() !== 'YES') {
      const error = new Error('Authorisation confirmation is required.'); error.status = 400; throw error;
    }
    await verifyTurnstile(env, request, body, 'register_organization');
    const {
      turnstileToken: _turnstileToken,
      turnstileAction: _turnstileAction,
      idempotencyKey: _idempotencyKey,
      ...idempotencyPayload
    } = body;
    idempotency = await beginIdempotentRequest(env, request, body, {
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
    const existing = (await queryCollection(env, 'tenantRegistrations', {
      filters: [{ field: 'Email', op: '==', value: email }],
      limit: 5
    }).catch(() => []))
      .find((row) => clean(row.OrganisationName).toLowerCase() === name.toLowerCase()
        && !['rejected', 'cancelled'].includes(clean(row.Status).toLowerCase()));
    if (existing) {
      const checkout = await initializeSubscriptionCheckout({
        request, env, registration: existing, catalog, plan, billingCycle
      });
      const result = {
        ok: true,
        reference: clean(existing.Reference || existing.__id),
        message: checkout
          ? 'Registration found. Continue to Paystack to confirm the selected subscription.'
          : 'This organisation registration has already been received.',
        ...(checkout || {})
      };
      await completeIdempotentRequest(env, idempotency, result, 200);
      return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
    }
    const reference = `DMX-${Date.now()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    const created = await createDocumentIfAbsent(env, 'tenantRegistrations', reference, {
      Reference: reference, OrganisationName: name,
      Edition: edition,
      ContactName: clean(body.ContactName), Email: email, Phone: clean(body.Phone), Country: clean(body.Country),
      Plan: plan,
      BillingCycle: billingCycle,
      UserLimit: catalog.Plans[plan].UserLimit,
      FeatureEntitlements: subscriptionPlanEntitlements(plan, edition),
      PaymentStatus: 'Pending',
      Status: 'Pending Activation', CreatedAt: new Date().toISOString(), Source: 'Dynamax public registration'
    });
    if (!created.created) {
      const error = new Error('Could not reserve a unique registration reference. Please try again.');
      error.status = 409;
      throw error;
    }
    const registration = { ...created.document, Reference: reference };
    const checkout = await initializeSubscriptionCheckout({ request, env, registration, catalog, plan, billingCycle });
    const result = {
      ok: true,
      reference,
      message: checkout
        ? 'Registration received. Continue to Paystack to activate the selected subscription.'
        : 'Registration received. Your Dynamax workspace will be activated after plan confirmation.',
      ...(checkout || {})
    };
    await completeIdempotentRequest(env, idempotency, result, 200);
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (idempotency?.owner) await failIdempotentRequest(env, idempotency, error);
    return Response.json({ ok: false, message: error.message || String(error) }, {
      status: error.status || 500,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}
