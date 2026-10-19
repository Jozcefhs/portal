import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  SUBSCRIPTION_MODULE_CATALOG_VERSION,
  migrateSubscriptionModuleEntitlements,
  normalizeSubscriptionPlanCatalog,
  subscriptionFlexQuote,
  subscriptionPlanEntitlements,
  subscriptionPlanPrice
} from '../functions/lib/subscription-plans.js';
import { organizationProfileDocument, resolveOrganizationConfig } from '../functions/lib/organization-config.js';
import { publicPolicy } from '../functions/api/subscription-policy.js';
import { subscriptionIntentModuleCatalogVersion } from '../functions/api/verify-subscription-payment.js';

const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const source = async path => readFile(new URL(`../functions/${path}`, import.meta.url), 'utf8');
const [registrationSource, catalogSource, activationSource, completionSource, paymentSource] = await Promise.all([
  source('api/register-organization.js'), source('api/plan-catalog.js'), source('lib/tenant-activation.js'),
  source('api/complete-tenant-activation.js'), source('api/verify-subscription-payment.js')
]);

// Execute the production functions with isolated persistence/provider adapters.
// This fixture never connects to a tenant, payment provider or email service.
function isolatedFunction(text, name, start, next, bindings = {}) {
  const first = text.indexOf(start), last = text.indexOf(next, first + start.length);
  assert.ok(first >= 0 && last > first, `Function boundaries for ${name}`);
  const definition = text.slice(first, last).replace(/^export /, '');
  return new Function(...Object.keys(bindings), `${definition}\nreturn ${name};`)(...Object.values(bindings));
}

const withoutFirestoreMetadata = isolatedFunction(catalogSource, 'withoutFirestoreMetadata',
  'function withoutFirestoreMetadata(', 'async function updateSubscriberEntitlements(');

test('fixed and Flex selections identify the catalogue that produced their explicit entitlements', () => {
  const select = isolatedFunction(registrationSource, 'subscriptionSelection', 'function subscriptionSelection(',
    'async function sha256(', { clean, SUBSCRIPTION_MODULE_CATALOG_VERSION, subscriptionFlexQuote,
      subscriptionPlanEntitlements, subscriptionPlanPrice });
  const catalog = normalizeSubscriptionPlanCatalog({ ModuleCatalogVersion: 11, Currency: 'USD', Plans: {
    Standard: { EntitlementsByEdition: { school: ['accounting', 'approvals'] } },
    Flex: { Active: true }
  } });
  for (const plan of ['Standard', 'Flex']) {
    const selection = select(catalog, plan, 'school', 'monthly', ['accounting', 'approvals'], 5);
    assert.equal(selection.PriceSnapshot.ModuleCatalogVersion, SUBSCRIPTION_MODULE_CATALOG_VERSION);
    assert.ok(!selection.FeatureEntitlements.includes('vendorSettlements'));
    assert.ok(!selection.FeatureEntitlements.includes('externalAudit'));
  }
});

test('catalogue save migrates legacy Flex access once without touching paid price snapshots', async () => {
  const paidSnapshot = { ModuleCatalogVersion: 10, TotalAmount: 123, Modules: [{ Key: 'accounting', Amount: 123 }] };
  const registrations = [
    { Reference: 'legacy', Plan: 'Flex', Edition: 'school', FeatureEntitlements: ['accounting', 'approvals'], PriceSnapshot: paidSnapshot },
    { Reference: 'modern', Plan: 'Flex', Edition: 'faith', FeatureEntitlements: ['accounting', 'approvals'], PlanModuleCatalogVersion: 11, PriceSnapshot: paidSnapshot },
    { Reference: 'quoted', Plan: 'Flex', Edition: 'organization', FeatureEntitlements: ['accounting', 'approvals'], PriceSnapshot: { ...paidSnapshot, ModuleCatalogVersion: 11 } },
    { Reference: 'empty', Plan: 'Flex', Edition: 'school', FeatureEntitlements: [], PriceSnapshot: paidSnapshot },
    { Reference: 'standard', Plan: 'Standard', Edition: 'school', PriceSnapshot: paidSnapshot }
  ];
  const original = structuredClone(registrations), writes = [];
  const update = isolatedFunction(catalogSource, 'updateSubscriberEntitlements', 'async function updateSubscriberEntitlements(',
    'export function paystackPlanPayload(', { clean, withoutFirestoreMetadata, SUBSCRIPTION_MODULE_CATALOG_VERSION,
      migrateSubscriptionModuleEntitlements, subscriptionPlanEntitlements,
      listCollection: async () => registrations,
      batchUpsertDocuments: async (_env, batch) => writes.push(...structuredClone(batch)) });
  assert.equal(await update({}, normalizeSubscriptionPlanCatalog()), registrations.length);
  for (const write of writes) {
    assert.equal(write.data.PlanModuleCatalogVersion, SUBSCRIPTION_MODULE_CATALOG_VERSION);
    assert.deepEqual(write.data.PriceSnapshot, registrations.find(row => row.Reference === write.documentId).PriceSnapshot);
    const shouldInclude = ['legacy', 'standard'].includes(write.documentId);
    assert.equal(write.data.FeatureEntitlements.includes('vendorSettlements'), shouldInclude);
    assert.equal(write.data.FeatureEntitlements.includes('externalAudit'), shouldInclude);
  }
  assert.deepEqual(registrations, original);
});

test('policy and activation carry the marker into tenant settings without reinterpreting current exclusions', () => {
  const claimFor = isolatedFunction(activationSource, 'publicActivationRegistration', 'function publicActivationRegistration(',
    'export async function hashTenantActivationToken(', { clean, lower });
  const createProfile = isolatedFunction(completionSource, 'organizationProfile', 'function organizationProfile(',
    'async function createFirstAdministrator(', { clean, lower, withoutFirestoreMetadata, organisationCode: () => 'FIXTURE' });
  for (const [metadata, expectedVersion, expectedAccess] of [
    [{ PlanModuleCatalogVersion: 11, PriceSnapshot: { ModuleCatalogVersion: 10, TotalAmount: 8 } }, 11, false],
    [{ PriceSnapshot: { ModuleCatalogVersion: 11, TotalAmount: 8 } }, 11, false],
    [{ PriceSnapshot: { ModuleCatalogVersion: 10, TotalAmount: 8 } }, 10, true],
    [{}, 0, true]
  ]) {
    const registration = { Edition: 'school', Plan: 'Flex', FeatureEntitlements: ['accounting', 'approvals'], ...metadata };
    assert.equal(publicPolicy(registration).PlanModuleCatalogVersion, expectedVersion);
    const profile = createProfile(claimFor(registration), { workspaceId: 'fixture', edition: 'school' });
    assert.equal(profile.PlanModuleCatalogVersion, expectedVersion);
    assert.deepEqual(profile.SubscriptionPriceSnapshot, registration.PriceSnapshot ?? null);
    const saved = organizationProfileDocument(profile);
    const restarted = resolveOrganizationConfig({ organizationProfile: saved });
    assert.equal(restarted.FeatureFlags.vendorSettlements, expectedAccess);
    assert.equal(restarted.FeatureFlags.externalAudit, expectedAccess);
    assert.deepEqual(saved.SubscriptionPriceSnapshot, registration.PriceSnapshot ?? null);
  }
});

test('payment activation replaces the previous plan marker with the paid selection marker', async () => {
  const writes = [], synchronized = [];
  const activate = isolatedFunction(paymentSource, 'activateSavedSubscriptionPayment', 'export async function activateSavedSubscriptionPayment(',
    'export async function recordVerifiedCardVerification(', {
      clean, safeId: clean, withoutFirestoreMetadata, subscriptionIntentModuleCatalogVersion,
      paidSubscriptionRecoveryFields: () => ({ SubscriptionStatus: 'Active' }),
      buildSubscriptionReceipt: () => ({ ReceiptNo: 'FIXTURE-1', IssuedAt: '2026-10-11T00:00:00.000Z' }),
      patchDocumentFields: async () => {},
      upsertDocument: async (_env, collection, id, data) => writes.push({ collection, id, data: structuredClone(data) }),
      syncRegistrationSubscriptionToWorkspace: async (_env, registration) => synchronized.push(structuredClone(registration)),
      deliverSubscriptionReceiptEmail: async () => ({ sent: false, status: 'Fixture' }),
      issueTenantActivation: async () => ({ alreadyActivated: true }),
      publicSubscriptionReceipt: value => value, subscriptionReceiptUrl: () => '/fixture-receipt'
    });
  for (const [intentMetadata, previousVersion, expectedVersion] of [
    [{ PriceSnapshot: { ModuleCatalogVersion: 11, TotalAmount: 8 } }, 10, 11],
    [{ PlanModuleCatalogVersion: 11, PriceSnapshot: { ModuleCatalogVersion: 10, TotalAmount: 8 } }, 10, 11],
    [{ PriceSnapshot: { ModuleCatalogVersion: 10, TotalAmount: 8 } }, 11, 10],
    [{}, 11, 0]
  ]) {
    const intent = { Plan: 'Flex', BillingCycle: 'monthly', FeatureEntitlements: ['accounting', 'approvals'], Amount: 8, ...intentMetadata };
    const savedRegistration = { WorkspaceId: 'fixture', PlanModuleCatalogVersion: previousVersion, PriceSnapshot: { TotalAmount: 5 } };
    const result = await activate({}, { platformEnv: {}, reference: 'fixture-payment', registrationReference: 'fixture-registration', intent, savedRegistration });
    assert.equal(result.updatedRegistration.PlanModuleCatalogVersion, expectedVersion);
    assert.equal(synchronized.at(-1).PlanModuleCatalogVersion, expectedVersion);
    assert.equal(writes.findLast(write => write.collection === 'tenantRegistrations').data.PlanModuleCatalogVersion, expectedVersion);
    assert.deepEqual(result.updatedRegistration.PriceSnapshot, intent.PriceSnapshot || savedRegistration.PriceSnapshot);
    assert.equal(savedRegistration.PlanModuleCatalogVersion, previousVersion);
  }
});

test('settings and desktop transport preserve server metadata rather than accept editable plan markers', async () => {
  const [backend, settings] = await Promise.all([source('api/backend.js'), source('api/settings.js')]);
  assert.match(backend, /PlanModuleCatalogVersion: existingOrganization\?\.PlanModuleCatalogVersion/);
  assert.match(backend, /SubscriptionPriceSnapshot: existingOrganization\?\.SubscriptionPriceSnapshot/);
  assert.match(backend, /PlanModuleCatalogVersion: organization\.PlanModuleCatalogVersion/);
  assert.match(settings, /PlanModuleCatalogVersion: existing\.PlanModuleCatalogVersion/);
  assert.match(settings, /SubscriptionPriceSnapshot: existing\.SubscriptionPriceSnapshot/);
  assert.match(settings, /profile\.PlanModuleCatalogVersion = organization\.PlanModuleCatalogVersion/);
  assert.doesNotMatch(backend, /PlanModuleCatalogVersion:\s*body\./);
  assert.doesNotMatch(settings, /PlanModuleCatalogVersion:\s*incoming\./);
});
