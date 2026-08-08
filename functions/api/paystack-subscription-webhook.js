import { getDocument, queryCollection, upsertDocument } from '../lib/firestore.js';
import { secureTextEqual } from '../lib/backend-security.js';
import { disablePaystackSubscription, recordVerifiedSubscriptionPayment } from './verify-subscription-payment.js';
import { syncRegistrationSubscriptionToWorkspace } from '../lib/subscription-workspace-sync.js';
import { requirePlatformFirestoreEnv } from '../lib/platform-firestore.js';
import {
  paidLifecycleWindow,
  paidSubscriptionPeriodEnd,
  paidSubscriptionRecoveryFields,
  paystackPaidThroughAt
} from '../lib/paid-subscription-lifecycle.js';

const MAX_WEBHOOK_BYTES = 512 * 1024;
const clean = (value) => String(value ?? '').trim();

async function readBoundedBody(request) {
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > MAX_WEBHOOK_BYTES) {
    const error = new Error('Webhook payload is too large.');
    error.status = 413;
    throw error;
  }
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_WEBHOOK_BYTES) {
      await reader.cancel();
      const error = new Error('Webhook payload is too large.');
      error.status = 413;
      throw error;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  chunks.forEach((chunk) => { bytes.set(chunk, offset); offset += chunk.byteLength; });
  return bytes;
}

function hex(buffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function validPaystackWebhookSignature(secret, bytes, suppliedSignature) {
  if (!clean(secret) || !clean(suppliedSignature)) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(clean(secret)),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign']
  );
  const expected = hex(await crypto.subtle.sign('HMAC', key, bytes));
  return secureTextEqual(expected.toLowerCase(), clean(suppliedSignature).toLowerCase());
}

function withoutFirestoreMetadata(document = {}) {
  const value = { ...document };
  delete value.__id;
  delete value.__name;
  delete value.__createTime;
  delete value.__updateTime;
  return value;
}

async function registrationForSubscription(platformEnv, data = {}) {
  const subscriptionCode = clean(data.subscription_code || data.subscription?.subscription_code);
  if (subscriptionCode) {
    const rows = await queryCollection(platformEnv, 'tenantRegistrations', {
      filters: [{ field: 'PaystackSubscriptionCode', op: '==', value: subscriptionCode }],
      limit: 2
    }).catch(() => []);
    if (rows[0]) return rows[0];
  }
  const email = clean(data.customer?.email).toLowerCase();
  if (!email) return null;
  const planCode = clean(data.plan?.plan_code || data.subscription?.plan?.plan_code);
  const rows = await queryCollection(platformEnv, 'tenantRegistrations', {
    filters: [{ field: 'Email', op: '==', value: email }],
    limit: 10
  }).catch(() => []);
  return rows.find((row) => !planCode || clean(row.PaystackPlanCode) === planCode) || null;
}

async function updateSubscriptionStatus(env, platformEnv, event, data) {
  const registration = await registrationForSubscription(platformEnv, data);
  if (!registration) return false;
  if (['retiring', 'retired'].includes(clean(registration.LifecycleStage).toLowerCase())) {
    console.warn(JSON.stringify({
      event: 'subscription_event_after_tenant_retirement',
      registrationReference: clean(registration.Reference || registration.__id),
      paystackEvent: clean(event)
    }));
    return false;
  }
  const subscriptionCode = clean(data.subscription_code || data.subscription?.subscription_code || registration.PaystackSubscriptionCode);
  const normalizedEvent = clean(event).toLowerCase();
  const providerStatus = clean(data.status || data.subscription?.status).toLowerCase();
  const successful = ['active', 'success', 'complete', 'completed'].includes(providerStatus)
    && ['subscription.create', 'invoice.update'].includes(normalizedEvent);
  const eventAt = new Date().toISOString();
  let lifecycleFields = {};
  if (successful) {
    const paidAt = clean(data.paid_at || data.paidAt || data.paid_date) || eventAt;
    lifecycleFields = {
      ...paidSubscriptionRecoveryFields({
        paidAt,
        billingCycle: registration.BillingCycle,
        providerPaidThroughAt: paystackPaidThroughAt(data)
      }),
      Status: 'Payment Confirmed',
      AutoRenewalEnabled: true
    };
  } else if (normalizedEvent === 'invoice.payment_failed') {
    const paidThroughAt = clean(registration.PaidThroughAt || registration.RenewalDueAt) || eventAt;
    const window = paidLifecycleWindow({ ...registration, PaidThroughAt: paidThroughAt }, eventAt);
    lifecycleFields = {
      SubscriptionStatus: 'Payment Grace',
      PaymentStatus: 'Payment Failed',
      Status: 'Payment Grace',
      LifecycleStage: 'Payment Grace',
      PaidThroughAt: paidThroughAt,
      RenewalDueAt: paidThroughAt,
      ExpiredPaidThroughAt: paidThroughAt,
      GracePeriodStartedAt: paidThroughAt,
      GracePeriodEndsAt: window.graceEndsAt,
      DataRetentionEndsAt: window.retentionEndsAt,
      PaymentGraceNoticeSentAt: ''
    };
  } else if (normalizedEvent === 'subscription.disable') {
    const paidThroughAt = clean(registration.PaidThroughAt || registration.RenewalDueAt)
      || paidSubscriptionPeriodEnd({
        paidAt: registration.LastSuccessfulPaymentAt || registration.PaidAt || eventAt,
        billingCycle: registration.BillingCycle,
        providerPaidThroughAt: paystackPaidThroughAt(data)
      })
      || eventAt;
    lifecycleFields = {
      SubscriptionStatus: 'Non-renewing',
      Status: 'Active Until Period End',
      AutoRenewalEnabled: false,
      PaidThroughAt: paidThroughAt,
      RenewalDueAt: paidThroughAt
    };
  }
  const updatedRegistration = {
    ...withoutFirestoreMetadata(registration),
    PaystackSubscriptionCode: subscriptionCode,
    PaystackCustomerCode: clean(data.customer?.customer_code || registration.PaystackCustomerCode),
    ...lifecycleFields,
    LastSubscriptionEvent: event,
    LastSubscriptionEventAt: eventAt,
    UpdatedAt: eventAt
  };
  await upsertDocument(platformEnv, 'tenantRegistrations', registration.__id, updatedRegistration);
  await syncRegistrationSubscriptionToWorkspace(env, updatedRegistration);
  const previousCode = clean(registration.PreviousPaystackSubscriptionCode);
  if (normalizedEvent === 'subscription.create' && previousCode && previousCode !== subscriptionCode) {
    try {
      await disablePaystackSubscription(env, previousCode);
      await upsertDocument(platformEnv, 'tenantRegistrations', registration.__id, {
        ...updatedRegistration,
        PreviousSubscriptionDisabledAt: new Date().toISOString(),
        PreviousSubscriptionDisableError: ''
      });
    } catch (error) {
      await upsertDocument(platformEnv, 'tenantRegistrations', registration.__id, {
        ...updatedRegistration,
        PreviousSubscriptionDisableError: clean(error.message || error).slice(0, 500)
      });
    }
  }
  return true;
}

export async function onRequestPost({ request, env }) {
  try {
    const platformEnv = requirePlatformFirestoreEnv(env);
    if (!clean(env.PAYSTACK_SECRET_KEY)) {
      return Response.json({ ok: false, message: 'Paystack webhook verification is not configured.' }, { status: 503 });
    }
    const bytes = await readBoundedBody(request);
    const verified = await validPaystackWebhookSignature(
      env.PAYSTACK_SECRET_KEY,
      bytes,
      request.headers.get('x-paystack-signature')
    );
    if (!verified) return Response.json({ ok: false, message: 'Invalid Paystack signature.' }, { status: 401 });
    const event = JSON.parse(new TextDecoder().decode(bytes) || '{}');
    const eventName = clean(event.event).toLowerCase();
    const data = event.data || {};
    if (eventName === 'charge.success' && clean(data.reference)) {
      const intent = await getDocument(platformEnv, 'subscriptionPayments', clean(data.reference)).catch(() => null);
      if (intent) await recordVerifiedSubscriptionPayment(env, data).catch(() => null);
    }
    if (['subscription.create', 'subscription.disable', 'invoice.create', 'invoice.update', 'invoice.payment_failed'].includes(eventName)) {
      await updateSubscriptionStatus(env, platformEnv, eventName, data);
    }
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, message: error.message || String(error) }, {
      status: error.status || 400,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}
