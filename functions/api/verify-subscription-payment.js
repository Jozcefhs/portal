import { getDocument, requireFirestoreEnv, upsertDocument } from '../lib/firestore.js';
import { readJsonBody } from '../lib/request-security.js';
import { syncRegistrationSubscriptionToWorkspace } from '../lib/subscription-workspace-sync.js';

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

export async function recordVerifiedSubscriptionPayment(env, transaction, requestedRegistrationReference = '') {
  requireFirestoreEnv(env);
  const reference = safeId(transaction.reference);
  const intent = await getDocument(env, 'subscriptionPayments', reference);
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
  const registration = await getDocument(env, 'tenantRegistrations', registrationReference);
  if (!registration) {
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
  const updatedAt = new Date().toISOString();
  const updatedRegistration = {
    ...withoutFirestoreMetadata(registration),
    Plan: clean(intent.Plan),
    BillingCycle: clean(intent.BillingCycle),
    UserLimit: Number(registration.UserLimit || 0),
    Price: Number(intent.Amount || 0),
    Currency: clean(intent.Currency || transaction.currency || 'NGN'),
    PaymentStatus: 'Paid',
    SubscriptionStatus: 'Active',
    Status: 'Payment Confirmed',
    PaystackReference: reference,
    PaystackPlanCode: clean(intent.PaystackPlanCode),
    PaystackCustomerCode: customerCode,
    PaystackSubscriptionCode: subscriptionCode,
    PaidAt: paidAt,
    UpdatedAt: updatedAt
  };
  await Promise.all([
    upsertDocument(env, 'subscriptionPayments', reference, {
      ...withoutFirestoreMetadata(intent),
      Status: 'Paid',
      PaidAt: paidAt,
      PaystackTransactionId: clean(transaction.id),
      PaystackCustomerCode: customerCode,
      PaystackSubscriptionCode: subscriptionCode,
      UpdatedAt: updatedAt
    }),
    upsertDocument(env, 'tenantRegistrations', registrationReference, updatedRegistration)
  ]);
  await syncRegistrationSubscriptionToWorkspace(env, updatedRegistration);
  return {
    registrationReference,
    plan: clean(intent.Plan),
    billingCycle: clean(intent.BillingCycle),
    amount: Number(intent.Amount || 0),
    currency: clean(intent.Currency || transaction.currency || 'NGN')
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
      message: 'Subscription payment confirmed. Your organisation is ready for activation.',
      ...result
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, message: error.message || String(error) }, {
      status: error.status || 500,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}
