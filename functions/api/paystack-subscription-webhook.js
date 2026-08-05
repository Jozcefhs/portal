import { getDocument, queryCollection, requireFirestoreEnv, upsertDocument } from '../lib/firestore.js';
import { secureTextEqual } from '../lib/backend-security.js';
import { recordVerifiedSubscriptionPayment } from './verify-subscription-payment.js';

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

async function registrationForSubscription(env, data = {}) {
  const subscriptionCode = clean(data.subscription_code || data.subscription?.subscription_code);
  if (subscriptionCode) {
    const rows = await queryCollection(env, 'tenantRegistrations', {
      filters: [{ field: 'PaystackSubscriptionCode', op: '==', value: subscriptionCode }],
      limit: 2
    }).catch(() => []);
    if (rows[0]) return rows[0];
  }
  const email = clean(data.customer?.email).toLowerCase();
  if (!email) return null;
  const planCode = clean(data.plan?.plan_code || data.subscription?.plan?.plan_code);
  const rows = await queryCollection(env, 'tenantRegistrations', {
    filters: [{ field: 'Email', op: '==', value: email }],
    limit: 10
  }).catch(() => []);
  return rows.find((row) => !planCode || clean(row.PaystackPlanCode) === planCode) || null;
}

async function updateSubscriptionStatus(env, event, data) {
  const registration = await registrationForSubscription(env, data);
  if (!registration) return false;
  const subscriptionCode = clean(data.subscription_code || data.subscription?.subscription_code || registration.PaystackSubscriptionCode);
  const normalizedEvent = clean(event).toLowerCase();
  const status = normalizedEvent === 'subscription.disable'
    ? 'Cancelled'
    : normalizedEvent === 'invoice.payment_failed'
      ? 'Payment Failed'
      : clean(data.status || data.subscription?.status || 'Active');
  const active = ['active', 'success', 'complete'].includes(status.toLowerCase());
  await upsertDocument(env, 'tenantRegistrations', registration.__id, {
    ...withoutFirestoreMetadata(registration),
    PaystackSubscriptionCode: subscriptionCode,
    PaystackCustomerCode: clean(data.customer?.customer_code || registration.PaystackCustomerCode),
    SubscriptionStatus: active ? 'Active' : status,
    PaymentStatus: normalizedEvent === 'invoice.payment_failed' ? 'Payment Failed' : clean(registration.PaymentStatus || 'Paid'),
    LastSubscriptionEvent: event,
    LastSubscriptionEventAt: new Date().toISOString(),
    UpdatedAt: new Date().toISOString()
  });
  return true;
}

export async function onRequestPost({ request, env }) {
  try {
    requireFirestoreEnv(env);
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
      const intent = await getDocument(env, 'subscriptionPayments', clean(data.reference)).catch(() => null);
      if (intent) await recordVerifiedSubscriptionPayment(env, data).catch(() => null);
    }
    if (['subscription.create', 'subscription.disable', 'invoice.create', 'invoice.update', 'invoice.payment_failed'].includes(eventName)) {
      await updateSubscriptionStatus(env, eventName, data);
    }
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, message: error.message || String(error) }, {
      status: error.status || 400,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}
