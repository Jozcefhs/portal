import { batchUpsertDocuments, getDocument, listCollection, upsertDocument } from '../lib/firestore.js';
import { requirePlatformFirestoreEnv } from '../lib/platform-firestore.js';
import { requirePlatformAdmin } from '../lib/platform-admin.js';
import { loadPlatformPaymentSettings } from '../lib/platform-direct-bank-transfer.js';
import { readJsonBody } from '../lib/request-security.js';
import {
  SUBSCRIPTION_PLAN_NAMES,
  normalizeSubscriptionPlanCatalog,
  publicSubscriptionPlanCatalog,
  subscriptionPlanEntitlements
} from '../lib/subscription-plans.js';

const PLAN_DOCUMENT_ID = 'dynamaxPlanCatalog';
const PAYSTACK_PLAN_URL = 'https://api.paystack.co/plan';
const clean = (value) => String(value ?? '').trim();

async function loadCatalog(env) {
  const platformEnv = requirePlatformFirestoreEnv(env);
  const saved = await getDocument(platformEnv, 'settings', PLAN_DOCUMENT_ID);
  return normalizeSubscriptionPlanCatalog(saved || {});
}

function mergeCatalog(existing, incoming) {
  const source = incoming && typeof incoming === 'object' && !Array.isArray(incoming) ? incoming : {};
  const incomingPlans = source.Plans && typeof source.Plans === 'object' && !Array.isArray(source.Plans)
    ? source.Plans
    : {};
  const catalog = normalizeSubscriptionPlanCatalog({
    ...existing,
    ...source,
    Plans: Object.fromEntries(SUBSCRIPTION_PLAN_NAMES.map((name) => [
      name,
      { ...existing.Plans[name], ...(incomingPlans[name] || {}) }
    ]))
  });
  if (catalog.Currency !== existing.Currency) {
    SUBSCRIPTION_PLAN_NAMES.forEach((name) => {
      catalog.Plans[name].PaystackMonthlyPlanCode = '';
      catalog.Plans[name].PaystackYearlyPlanCode = '';
    });
  }
  return catalog;
}

function withoutFirestoreMetadata(document = {}) {
  const value = { ...document };
  delete value.__id;
  delete value.__name;
  delete value.__createTime;
  delete value.__updateTime;
  return value;
}

async function updateSubscriberEntitlements(platformEnv, catalog) {
  const registrations = await listCollection(platformEnv, 'tenantRegistrations').catch(() => []);
  const writes = registrations
    .filter((registration) => clean(registration.__id || registration.Reference))
    .map((registration) => ({
      collectionPath: 'tenantRegistrations',
      documentId: clean(registration.__id || registration.Reference),
      data: {
        ...withoutFirestoreMetadata(registration),
        FeatureEntitlements: clean(registration.Plan) === 'Flex' && Array.isArray(registration.FeatureEntitlements)
          ? [...registration.FeatureEntitlements]
          : subscriptionPlanEntitlements(registration.Plan, registration.Edition, catalog),
        PlanCatalogRevision: catalog.PolicyRevision,
        EntitlementsUpdatedAt: catalog.UpdatedAt,
        UpdatedAt: new Date().toISOString()
      }
    }));
  for (let index = 0; index < writes.length; index += 450) {
    await batchUpsertDocuments(platformEnv, writes.slice(index, index + 450));
  }
  return writes.length;
}

export function paystackPlanPayload(name, cycle, amount, currency, updateExistingSubscriptions = false) {
  const yearly = cycle === 'yearly';
  return {
    name: `Dynamax ${name} - ${yearly ? 'Yearly' : 'Monthly'}`,
    amount: Math.round(Number(amount || 0) * 100),
    interval: yearly ? 'annually' : 'monthly',
    currency: clean(currency).toUpperCase() || 'NGN',
    description: `${name} subscription billed ${yearly ? 'yearly' : 'monthly'}`,
    send_invoices: true,
    send_sms: false,
    update_existing_subscriptions: Boolean(updateExistingSubscriptions)
  };
}

export function paystackPlanNeedsSync(existingPlan = {}, nextPlan = {}, cycle = 'monthly', currencyChanged = false) {
  const yearly = cycle === 'yearly';
  const amountKey = yearly ? 'YearlyAmount' : 'MonthlyAmount';
  const codeKey = yearly ? 'PaystackYearlyPlanCode' : 'PaystackMonthlyPlanCode';
  const nextAmount = Number(nextPlan[amountKey] || 0);
  if (!(nextAmount > 0)) return false;
  return Boolean(
    currencyChanged
    || Number(existingPlan[amountKey] || 0) !== nextAmount
    || !clean(nextPlan[codeKey])
  );
}

async function syncPaystackPlan(env, { name, cycle, amount, currency, planCode, updateExistingSubscriptions }) {
  if (!(Number(amount) > 0)) return clean(planCode);
  if (!clean(env.PAYSTACK_SECRET_KEY)) {
    const error = new Error('Add PAYSTACK_SECRET_KEY in Cloudflare before enabling paid plan prices.');
    error.status = 503;
    throw error;
  }
  const payload = paystackPlanPayload(name, cycle, amount, currency, updateExistingSubscriptions);
  const existingCode = clean(planCode);
  if (!existingCode) delete payload.update_existing_subscriptions;
  const response = await fetch(existingCode ? `${PAYSTACK_PLAN_URL}/${encodeURIComponent(existingCode)}` : PAYSTACK_PLAN_URL, {
    method: existingCode ? 'PUT' : 'POST',
    headers: {
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.status === false) {
    const error = new Error(data.message || `Paystack could not ${existingCode ? 'update' : 'create'} the ${name} ${cycle} plan.`);
    error.status = 502;
    throw error;
  }
  const resolvedCode = existingCode || clean(data.data?.plan_code);
  if (!resolvedCode) {
    const error = new Error(`Paystack did not return a plan code for ${name} ${cycle}.`);
    error.status = 502;
    throw error;
  }
  return resolvedCode;
}

export async function onRequestGet({ env }) {
  try {
    const catalog = await loadCatalog(env);
    return Response.json({ ok: true, catalog: publicSubscriptionPlanCatalog(catalog) }, {
      headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' }
    });
  } catch (error) {
    return Response.json({ ok: false, message: error.message || String(error) }, {
      status: error.status || 500,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const platformEnv = requirePlatformFirestoreEnv(env);
    const body = await readJsonBody(request, { maxBytes: 128 * 1024 });
    requirePlatformAdmin(env, body.password);
    const existing = await loadCatalog(env);
    if (clean(body.action).toLowerCase() === 'load') {
      return Response.json({ ok: true, catalog: publicSubscriptionPlanCatalog(existing) }, {
        headers: { 'Cache-Control': 'no-store' }
      });
    }
    const catalog = mergeCatalog(existing, body.catalog);
    const currencyChanged = catalog.Currency !== existing.Currency;
    catalog.PolicyRevision = crypto.randomUUID();
    catalog.UpdatedAt = new Date().toISOString();
    catalog.UpdatedBy = 'Dynamax pricing administration';
    const updateExistingSubscriptions = body.updateExistingSubscriptions === true;
    const paymentSettings = await loadPlatformPaymentSettings(env);
    const paystackEnabled = paymentSettings.OnlinePaymentEnabled !== 'NO';
    let synchronizedPaystackPlans = 0;
    for (const name of SUBSCRIPTION_PLAN_NAMES) {
      const plan = catalog.Plans[name];
      const existingPlan = existing.Plans[name] || {};
      // Flex prices are resolved from the subscriber's selected modules and
      // active-user allowance. Exact recurring plans are created at checkout.
      if (name === 'Flex') continue;
      if (paystackEnabled && paystackPlanNeedsSync(existingPlan, plan, 'monthly', currencyChanged)) {
        plan.PaystackMonthlyPlanCode = await syncPaystackPlan(env, {
          name,
          cycle: 'monthly',
          amount: plan.MonthlyAmount,
          currency: catalog.Currency,
          planCode: plan.PaystackMonthlyPlanCode,
          updateExistingSubscriptions
        });
        synchronizedPaystackPlans += 1;
        // Persist every newly returned code before the next provider call. If
        // a later Paystack request fails, retrying cannot create duplicates.
        await upsertDocument(platformEnv, 'settings', PLAN_DOCUMENT_ID, {
          ...catalog,
          UpdatedAt: new Date().toISOString(),
          UpdatedBy: 'Dynamax pricing administration'
        });
      }
      if (paystackEnabled && paystackPlanNeedsSync(existingPlan, plan, 'yearly', currencyChanged)) {
        plan.PaystackYearlyPlanCode = await syncPaystackPlan(env, {
          name,
          cycle: 'yearly',
          amount: plan.YearlyAmount,
          currency: catalog.Currency,
          planCode: plan.PaystackYearlyPlanCode,
          updateExistingSubscriptions
        });
        synchronizedPaystackPlans += 1;
        await upsertDocument(platformEnv, 'settings', PLAN_DOCUMENT_ID, {
          ...catalog,
          UpdatedAt: new Date().toISOString(),
          UpdatedBy: 'Dynamax pricing administration'
        });
      }
    }
    await upsertDocument(platformEnv, 'settings', PLAN_DOCUMENT_ID, catalog);
    const updatedSubscribers = await updateSubscriberEntitlements(platformEnv, catalog);
    return Response.json({
      ok: true,
      message: `Plan pricing and module access saved; ${updatedSubscribers} subscriber record${updatedSubscribers === 1 ? '' : 's'} refreshed. ${!paystackEnabled ? 'Online payment synchronization is disabled in Dynamax payment settings.' : synchronizedPaystackPlans ? `${synchronizedPaystackPlans} Paystack price plan${synchronizedPaystackPlans === 1 ? '' : 's'} synchronized.` : 'No Paystack price change was required.'}`,
      catalog: publicSubscriptionPlanCatalog(catalog)
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, message: error.message || String(error) }, {
      status: error.status || 500,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}
