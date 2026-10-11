import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SUBSCRIPTION_MODULE_CATALOG_VERSION,
  defaultSubscriptionPlanCatalog,
  migrateSubscriptionModuleEntitlements,
  normalizeSubscriptionPlanCatalog,
  publicSubscriptionPlanCatalog,
  subscriptionFlexQuote,
  subscriptionModulesForEdition
} from '../functions/lib/subscription-plans.js';
import { filterSectionsForFeatures, organizationProfileDocument, resolveOrganizationConfig } from '../functions/lib/organization-config.js';
import { invalidatePlanPolicyCache, refreshOrganizationPlanPolicy } from '../functions/lib/plan-policy-sync.js';

const editions = ['school', 'faith', 'organization'];
const recentKeys = ['vendorSettlements', 'externalAudit'];

test('recent finance modules have approved editable prices and dependencies across editions', () => {
  assert.equal(SUBSCRIPTION_MODULE_CATALOG_VERSION, 11);
  for (const edition of editions) {
    const modules = subscriptionModulesForEdition(edition);
    const vendor = modules.find((row) => row.Key === 'vendorSettlements');
    const audit = modules.find((row) => row.Key === 'externalAudit');
    assert.equal(vendor.SuggestedMonthlyAmountUSD, 4);
    assert.equal(vendor.SuggestedYearlyAmountUSD, 40);
    assert.deepEqual(vendor.Requires, ['accounting', 'approvals']);
    assert.equal(audit.SuggestedMonthlyAmountUSD, 3);
    assert.equal(audit.SuggestedYearlyAmountUSD, 30);
    assert.deepEqual(audit.Requires, ['accounting']);
    assert.equal(audit.Surface, 'Web companion');
    for (const key of ['homework', 'androidCbt', 'timetableGeneration', 'boardingOfferings']) {
      assert.equal(modules.some((row) => row.Key === key), false, `${key} stays bundled`);
    }
    const defaults = defaultSubscriptionPlanCatalog();
    assert.ok(recentKeys.every((key) => defaults.Plans.Standard.EntitlementsByEdition[edition].includes(key)));
    assert.ok(recentKeys.every((key) => !defaults.Plans.Starter.EntitlementsByEdition[edition].includes(key)));
    assert.equal(defaults.Plans.Flex.ModulePricesByEdition[edition].vendorSettlements.MonthlyAmount, 5400);
  }
});

test('v10 migration uses configured exchange rate and preserves custom prices including explicit zero', () => {
  for (const currency of ['USD', 'NGN']) {
    const source = { ModuleCatalogVersion: 10, Currency: currency, UsdToNgnRate: 1600,
      Plans: { Standard: { MonthlyAmount: 9876, YearlyAmount: 98760 }, Flex: {
        ModulePricesByEdition: { school: {
          accounting: { MonthlyAmount: 123, YearlyAmount: 456 },
          vendorSettlements: { MonthlyAmount: 0, YearlyAmount: 71 },
          externalAudit: { MonthlyAmount: 2 }
        } }
      } } };
    const before = structuredClone(source);
    const migrated = normalizeSubscriptionPlanCatalog(source);
    const multiplier = currency === 'USD' ? 1 : 1600;
    for (const edition of ['faith', 'organization']) {
      assert.deepEqual(migrated.Plans.Flex.ModulePricesByEdition[edition].vendorSettlements,
        { MonthlyAmount: 4 * multiplier, YearlyAmount: 40 * multiplier });
      assert.deepEqual(migrated.Plans.Flex.ModulePricesByEdition[edition].externalAudit,
        { MonthlyAmount: 3 * multiplier, YearlyAmount: 30 * multiplier });
    }
    assert.deepEqual(migrated.Plans.Flex.ModulePricesByEdition.school.accounting, { MonthlyAmount: 123, YearlyAmount: 456 });
    assert.deepEqual(migrated.Plans.Flex.ModulePricesByEdition.school.vendorSettlements, { MonthlyAmount: 0, YearlyAmount: 71 });
    assert.deepEqual(migrated.Plans.Flex.ModulePricesByEdition.school.externalAudit, { MonthlyAmount: 2, YearlyAmount: 30 * multiplier });
    assert.equal(migrated.Plans.Standard.MonthlyAmount, 9876);
    assert.equal(migrated.Plans.Standard.YearlyAmount, 98760);
    assert.deepEqual(normalizeSubscriptionPlanCatalog(migrated), migrated, 'migration is idempotent');
    assert.deepEqual(source, before, 'normalization does not mutate saved input');
  }
});

test('legacy finance access migrates, but v11 explicit exclusions and empty plans remain excluded', () => {
  for (const edition of editions) {
    assert.deepEqual(migrateSubscriptionModuleEntitlements(edition, [], 0), []);
    const legacy = migrateSubscriptionModuleEntitlements(edition, ['accounting', 'approvals'], 10);
    assert.ok(recentKeys.every((key) => legacy.includes(key)));
    assert.deepEqual(migrateSubscriptionModuleEntitlements(edition, ['accounting'], 10), ['accounting', 'externalAudit']);
    assert.deepEqual(migrateSubscriptionModuleEntitlements(edition, ['accounting', 'approvals'], 11), ['approvals', 'accounting']);
    for (const version of [10, 11]) {
      const organization = resolveOrganizationConfig({ organizationProfile: {
        Edition: edition, Plan: 'Flex', PlanEntitlements: ['accounting', 'approvals'], PlanModuleCatalogVersion: version
      } });
      assert.equal(organization.FeatureFlags.vendorSettlements, version < 11);
      assert.equal(organization.FeatureFlags.externalAudit, version < 11);
      assert.deepEqual(filterSectionsForFeatures(recentKeys, organization.FeatureFlags), version < 11 ? recentKeys : []);
      assert.equal(organization.PlanModuleCatalogVersion, 11);
      const saved = organizationProfileDocument(organization);
      assert.equal(saved.PlanModuleCatalogVersion, 11);
      assert.deepEqual(resolveOrganizationConfig({ organizationProfile: saved }).PlanEntitlements, organization.PlanEntitlements);
    }
    const disabled = resolveOrganizationConfig({ organizationProfile: {
      Edition: edition, Plan: 'Standard', DisabledFeatureEntitlements: ['accounting']
    } });
    assert.equal(disabled.FeatureFlags.vendorSettlements, false);
    assert.equal(disabled.FeatureFlags.externalAudit, false);
  }
});

test('earlier library and communication migrations still work before recent finance module migration', () => {
  const oldSchoolKeys = subscriptionModulesForEdition('school').map((row) => row.Key)
    .filter((key) => ![...recentKeys, 'library'].includes(key));
  const library = normalizeSubscriptionPlanCatalog({ ModuleCatalogVersion: 9,
    Plans: { Professional: { EntitlementsByEdition: { school: oldSchoolKeys } } } });
  assert.ok(library.Plans.Professional.EntitlementsByEdition.school.includes('library'));
  const oldFaithKeys = subscriptionModulesForEdition('faith').map((row) => row.Key)
    .filter((key) => ![...recentKeys, 'bulkCommunication'].includes(key));
  const communication = normalizeSubscriptionPlanCatalog({ ModuleCatalogVersion: 8,
    Plans: { Enterprise: { EntitlementsByEdition: { faith: oldFaithKeys } } } });
  assert.ok(communication.Plans.Enterprise.EntitlementsByEdition.faith.includes('bulkCommunication'));
});

test('new Flex quotations charge common dependencies once and do not add unselected modules', () => {
  const catalog = normalizeSubscriptionPlanCatalog({ ModuleCatalogVersion: 10, Currency: 'USD', Plans: { Flex: {
    Active: true, ModulePricesByEdition: { school: {
      approvals: { MonthlyAmount: 3, YearlyAmount: 30 }, accounting: { MonthlyAmount: 5, YearlyAmount: 50 }
    } }
  } } });
  const quote = subscriptionFlexQuote(catalog, 'school', recentKeys, 1);
  assert.deepEqual(quote.FeatureEntitlements, ['approvals', 'accounting', 'vendorSettlements', 'externalAudit']);
  assert.equal(quote.Amount, 15);
  assert.equal(quote.PriceSnapshot.ModuleCatalogVersion, 11);
  assert.equal(subscriptionFlexQuote(catalog, 'school', recentKeys, 1, 'yearly').Amount, 150);
  const accountingOnly = subscriptionFlexQuote(catalog, 'school', ['accounting'], 1);
  assert.deepEqual(accountingOnly.FeatureEntitlements, ['accounting']);
  assert.equal(accountingOnly.Amount, 5);
  assert.ok(publicSubscriptionPlanCatalog(catalog).ModuleCatalog.school.some((row) => row.Key === 'vendorSettlements'));
});

test('policy refresh grandfathers legacy Flex access without repricing its paid snapshot', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const version of [10, 11]) {
      invalidatePlanPolicyCache();
      const snapshot = { Type: 'Flex', ModuleCatalogVersion: version, TotalAmount: 1234, Modules: [{ Key: 'accounting', Amount: 1234 }] };
      const registration = { Plan: 'Flex', Edition: 'school', FeatureEntitlements: ['accounting', 'approvals'],
        Price: 1234, Currency: 'NGN', PriceSnapshot: snapshot, SubscriptionStatus: 'Active' };
      globalThis.fetch = async (url) => String(url).endsWith('/api/plan-catalog')
        ? Response.json({ ok: true, catalog: {} }) : Response.json({ ok: true, policy: registration });
      const refreshed = await refreshOrganizationPlanPolicy({ ALLOW_CANONICAL_API_PROXY: 'true',
        CANONICAL_PORTAL_URL: 'https://recent-module-test.example', CANONICAL_API_PROXY_SCOPE: 'platform-subscriptions' },
      { WorkspaceId: 'recent-module-test', Edition: 'school' });
      assert.equal(refreshed.PlanModuleCatalogVersion, 11);
      assert.equal(refreshed.PlanEntitlements.includes('vendorSettlements'), version < 11);
      assert.equal(refreshed.PlanEntitlements.includes('externalAudit'), version < 11);
      assert.equal(refreshed.SubscriptionPrice, 1234);
      assert.deepEqual(refreshed.SubscriptionPriceSnapshot, snapshot);
    }
  } finally {
    globalThis.fetch = originalFetch;
    invalidatePlanPolicyCache();
  }
});
