import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { featureFlagsForEdition, featureFlagsForPlan, filterSectionsForFeatures, resolveOrganizationConfig, staffRoleAllowedForEdition } from '../functions/lib/organization-config.js';
import { capabilitiesFor, scopeFor } from '../functions/lib/procurement-rules.js';
import { defaultModulesForRole, modulesForEdition, rolesForEdition, withRequiredRoleModules } from '../functions/lib/role-module-access.js';
import { allowedSectionsFor } from '../functions/lib/staff-auth.js';
import { SUBSCRIPTION_MODULE_CATALOG_VERSION, migrateSubscriptionModuleEntitlements, normalizeSubscriptionPlanCatalog, subscriptionFlexQuote, subscriptionModulesForEdition } from '../functions/lib/subscription-plans.js';
import { invalidatePlanPolicyCache, refreshOrganizationPlanPolicy } from '../functions/lib/plan-policy-sync.js';
import { isOrganizationResetProtectedPath, sanitizeBackupDocument } from '../functions/lib/organization-backup.js';

const editions = ['school', 'faith', 'organization'];

test('Procurement Officer and Procurement workspace are available in every edition', () => {
  for (const edition of editions) {
    const featureFlags = featureFlagsForEdition(edition);
    assert.equal(staffRoleAllowedForEdition('Procurement Officer', edition), true);
    assert.ok(rolesForEdition(edition).includes('Procurement Officer'));
    assert.ok(modulesForEdition(edition, featureFlags).some(({ key }) => key === 'procurement'));
    const modules = defaultModulesForRole('Procurement Officer', { edition, featureFlags });
    assert.ok(modules.includes('procurement'));
    assert.ok(!modules.includes('organizationStore'), 'purchasing does not grant independent store inventory editing');
    assert.ok(allowedSectionsFor({ role: 'Procurement Officer' }, featureFlags, { edition }).includes('procurement'));
  }
});

test('departmental and management defaults expose procurement without overriding explicit role grants', () => {
  for (const edition of editions) {
    const featureFlags = featureFlagsForEdition(edition);
    for (const role of ['Super Admin', 'Director', 'Admin', 'Management', 'Accounts Officer', 'Department User']) {
      assert.ok(defaultModulesForRole(role, { edition, featureFlags }).includes('procurement'), `${edition}: ${role}`);
    }
    assert.ok(!withRequiredRoleModules('Department User', [], edition, featureFlags).includes('procurement'));
  }
  for (const role of ['Clinic User', 'Kitchen User', 'Librarian', 'Tuck Shop User']) {
    assert.ok(defaultModulesForRole(role, { edition: 'school' }).includes('procurement'), role);
  }
  for (const edition of ['faith', 'organization']) {
    for (const role of ['Store User', 'Restaurant User', 'Hotel User']) {
      assert.ok(defaultModulesForRole(role, { edition }).includes('procurement'), `${edition}: ${role}`);
    }
  }
});

test('vendor users and external auditors cannot acquire Procurement through custom grants', () => {
  for (const edition of editions) {
    const featureFlags = featureFlagsForEdition(edition);
    for (const role of ['Vendor User', 'External Auditor']) {
      assert.ok(!defaultModulesForRole(role, { edition, featureFlags }).includes('procurement'));
      assert.ok(!withRequiredRoleModules(role, ['procurement'], edition, featureFlags).includes('procurement'));
      assert.ok(!allowedSectionsFor({ role, TabAccess: ['procurement'] }, featureFlags, { edition }).includes('procurement'));
    }
  }
});

test('Procurement has a dedicated tutorial field in each edition', async () => {
  const context = { window: {} };
  vm.runInNewContext(await readFile(new URL('../js/tutorial-module-catalogue.js', import.meta.url), 'utf8'), context);
  const entries = context.window.DynamaxTutorialModuleCatalogue.filter(({ key }) => key === 'procurement');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].storageKey, 'Procurement');
  assert.deepEqual(Array.from(entries[0].editions), editions);
});

test('real plan and role gates expose only entitled procurement destinations across all editions', () => {
  for (const edition of editions) {
    const expected = edition === 'school' ? ['clinic', 'kitchen', 'tuckShop', 'bookstore', 'uniformStore'] : ['organizationStore', 'restaurant'];
    const featureFlags = featureFlagsForPlan(edition, 'Professional');
    const user = { username: 'fixture', role: 'Super Admin', branchId: 'main', edition, featureFlags,
      allowedSections: defaultModulesForRole('Super Admin', { edition, featureFlags }) };
    const capabilities = capabilitiesFor(user, scopeFor(user));
    assert.deepEqual(capabilities.departments, expected, edition);
    assert.deepEqual(capabilities.receiveDepartments, expected, edition);
    for (const plan of ['Standard', 'Flex']) {
      const flags = featureFlagsForPlan(edition, plan, {}, plan === 'Flex' ? ['procurement'] : null, 12);
      const limited = { ...user, featureFlags: flags, allowedSections: defaultModulesForRole('Super Admin', { edition, featureFlags: flags }) };
      assert.deepEqual(capabilitiesFor(limited, scopeFor(limited)).departments, [], `${edition}: ${plan}`);
    }
  }
  const featureFlags = featureFlagsForPlan('organization', 'Flex', {}, ['procurement', 'retail'], 12);
  const user = { username: 'fixture', role: 'Store User', branchId: 'main', edition: 'organization', featureFlags,
    allowedSections: defaultModulesForRole('Store User', { edition: 'organization', featureFlags }) };
  assert.deepEqual(capabilitiesFor(user, scopeFor(user)).receiveDepartments, ['organizationStore']);
  const restricted = { ...user, allowedSections: ['procurement'] };
  assert.deepEqual(capabilitiesFor(restricted, scopeFor(restricted)).receiveDepartments, []);
});

test('Organization inventory catalogue migration preserves independent selections, configured prices and fixed prices', () => {
  const modules = subscriptionModulesForEdition('organization');
  assert.equal(modules.find(row => row.Key === 'retail').Label, 'Inventory & Sales');
  assert.equal(modules.find(row => row.Key === 'restaurant').Label, 'Catering Operations');
  const previousFull = modules.map(row => row.Key).filter(key => !['procurement', 'retail', 'restaurant'].includes(key));
  for (const Currency of ['NGN', 'USD']) {
    const factor = Currency === 'NGN' ? 1600 : 1;
    const saved = { ModuleCatalogVersion: 11, Currency, UsdToNgnRate: 1600, Plans: {
      Professional: { MonthlyAmount: 101, YearlyAmount: 999, EntitlementsByEdition: { organization: previousFull } },
      Enterprise: { EntitlementsByEdition: { organization: ['approvals', 'accounting'] } },
      Flex: { Active: true, EntitlementsByEdition: { organization: ['approvals'] }, ModulePricesByEdition: {
        faith: { retail: { MonthlyAmount: 17, YearlyAmount: 170 }, restaurant: { MonthlyAmount: 0, YearlyAmount: 0 } },
        organization: { restaurant: { MonthlyAmount: 0, YearlyAmount: 61 } }
      } }
    } };
    const original = structuredClone(saved), catalog = normalizeSubscriptionPlanCatalog(saved);
    assert.equal(catalog.Plans.Professional.MonthlyAmount, 101);
    assert.equal(catalog.Plans.Professional.YearlyAmount, 999);
    assert.ok(catalog.Plans.Professional.EntitlementsByEdition.organization.includes('retail'));
    assert.ok(catalog.Plans.Professional.EntitlementsByEdition.organization.includes('restaurant'));
    assert.ok(catalog.Plans.Professional.EntitlementsByEdition.organization.includes('procurement'));
    assert.ok(!catalog.Plans.Enterprise.EntitlementsByEdition.organization.includes('retail'));
    assert.ok(!catalog.Plans.Enterprise.EntitlementsByEdition.organization.includes('procurement'));
    assert.ok(!catalog.Plans.Flex.EntitlementsByEdition.organization.includes('retail'));
    assert.ok(!catalog.Plans.Flex.EntitlementsByEdition.organization.includes('procurement'));
    assert.deepEqual(catalog.Plans.Flex.ModulePricesByEdition.organization.retail, { MonthlyAmount: 4 * factor, YearlyAmount: 40 * factor });
    assert.deepEqual(catalog.Plans.Flex.ModulePricesByEdition.organization.restaurant, { MonthlyAmount: 0, YearlyAmount: 61 });
    assert.deepEqual(catalog.Plans.Flex.ModulePricesByEdition.faith, { ...catalog.Plans.Flex.ModulePricesByEdition.faith,
      retail: { MonthlyAmount: 17, YearlyAmount: 170 }, restaurant: { MonthlyAmount: 0, YearlyAmount: 0 } });
    const quote = subscriptionFlexQuote(catalog, 'organization', ['procurement'], 1, 'monthly');
    assert.deepEqual(quote.FeatureEntitlements, ['procurement']);
    assert.equal(quote.Amount, 5 * factor);
    assert.deepEqual(normalizeSubscriptionPlanCatalog(catalog), catalog);
    assert.deepEqual(saved, original);
  }
});

test('Procurement has its approved separate price and is not granted to existing approvals-only subscribers', () => {
  for (const edition of editions) {
    const modules = subscriptionModulesForEdition(edition);
    const procurement = modules.find(({ Key }) => Key === 'procurement');
    assert.equal(procurement.SuggestedMonthlyAmountUSD, 5);
    assert.equal(procurement.SuggestedYearlyAmountUSD, 50);
    assert.deepEqual(procurement.Requires, []);
    for (const [version, entitlements, expected] of [[10, ['approvals'], false], [11, ['approvals'], false], [12, ['approvals'], false], [12, ['procurement'], true], [11, [], false]]) {
      const config = resolveOrganizationConfig({ organizationProfile: {
        Edition: edition, Plan: 'Flex', PlanModuleCatalogVersion: version, PlanEntitlements: entitlements
      } });
      assert.deepEqual(filterSectionsForFeatures(['procurement'], config.FeatureFlags), expected ? ['procurement'] : []);
    }
  }
  const saved = { ModuleCatalogVersion: 11, Plans: {
    Standard: { MonthlyAmount: 13200, YearlyAmount: 145000 },
    Flex: { ModulePricesByEdition: { school: { approvals: { MonthlyAmount: 123, YearlyAmount: 456 } } } }
  } };
  const normalized = normalizeSubscriptionPlanCatalog(saved);
  assert.equal(normalized.ModuleCatalogVersion, SUBSCRIPTION_MODULE_CATALOG_VERSION);
  assert.equal(normalized.Plans.Standard.MonthlyAmount, 13200);
  assert.equal(normalized.Plans.Standard.YearlyAmount, 145000);
  assert.deepEqual(normalized.Plans.Flex.ModulePricesByEdition.school.approvals, { MonthlyAmount: 123, YearlyAmount: 456 });
});

test('Procurement price migration uses the configured currency rate and preserves edited prices including zero', () => {
  for (const Currency of ['USD', 'NGN']) {
    const saved = { ModuleCatalogVersion: 11, Currency, UsdToNgnRate: 1600, Plans: { Flex: { Active: true,
      ModulePricesByEdition: { school: { procurement: { MonthlyAmount: 0, YearlyAmount: 77 } } } } } };
    const original = structuredClone(saved), catalog = normalizeSubscriptionPlanCatalog(saved), factor = Currency === 'USD' ? 1 : 1600;
    assert.deepEqual(catalog.Plans.Flex.ModulePricesByEdition.school.procurement, { MonthlyAmount: 0, YearlyAmount: 77 });
    for (const edition of ['faith', 'organization']) {
      assert.deepEqual(catalog.Plans.Flex.ModulePricesByEdition[edition].procurement, { MonthlyAmount: 5 * factor, YearlyAmount: 50 * factor });
      for (const [cycle, amount] of [['monthly', 5 * factor], ['yearly', 50 * factor]]) {
        const quote = subscriptionFlexQuote(catalog, edition, ['procurement'], 1, cycle);
        assert.equal(quote.Amount, amount);
        assert.deepEqual(quote.FeatureEntitlements, ['procurement']);
        assert.equal(quote.PriceSnapshot.ModuleCatalogVersion, 12);
      }
      assert.ok(!subscriptionFlexQuote(catalog, edition, ['approvals'], 1).FeatureEntitlements.includes('procurement'));
    }
    assert.deepEqual(saved, original);
    assert.deepEqual(normalizeSubscriptionPlanCatalog(catalog), catalog);
  }
});

test('v12 policy refresh preserves existing Flex choices without adding Procurement or changing paid snapshots', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const version of [11, 12]) {
      invalidatePlanPolicyCache();
      const snapshot = { ModuleCatalogVersion: version, TotalAmount: 123, Modules: [{ Key: 'approvals', Amount: 123 }] };
      const registration = { Plan: 'Flex', Edition: 'school', FeatureEntitlements: ['approvals'],
        PlanModuleCatalogVersion: version, Price: 123, Currency: 'NGN', PriceSnapshot: snapshot, SubscriptionStatus: 'Active' };
      globalThis.fetch = async url => String(url).endsWith('/api/plan-catalog')
        ? Response.json({ ok: true, catalog: {} }) : Response.json({ ok: true, policy: registration });
      const refreshed = await refreshOrganizationPlanPolicy({ ALLOW_CANONICAL_API_PROXY: 'true',
        CANONICAL_PORTAL_URL: 'https://procurement-price.example', CANONICAL_API_PROXY_SCOPE: 'platform-subscriptions' },
      { WorkspaceId: 'procurement-price', Edition: 'school' });
      assert.equal(refreshed.PlanEntitlements.includes('procurement'), false);
      assert.deepEqual(refreshed.PlanEntitlements, ['approvals']);
      assert.equal(refreshed.SubscriptionPrice, 123);
      assert.deepEqual(refreshed.SubscriptionPriceSnapshot, snapshot);
      assert.equal(refreshed.PlanModuleCatalogVersion, 12);
    }
  } finally { globalThis.fetch = originalFetch; invalidatePlanPolicyCache(); }
});

test('policy refresh and payment synchronization preserve an explicitly zero subscription price', async () => {
  const workspaceSource = (await readFile(new URL('../functions/lib/subscription-workspace-sync.js', import.meta.url), 'utf8'))
    .replace(/^import .*;\r?\n/gm, '').replace('export async function', 'async function');
  const originalFetch = globalThis.fetch;
  try {
    for (const Price of [0, '0', 42, null, undefined]) {
      invalidatePlanPolicyCache();
      const expected = Price == null ? 123 : Number(Price);
      const snapshot = { ModuleCatalogVersion: 12, TotalAmount: expected, Modules: [{ Key: 'procurement', Amount: expected }] };
      const profile = { WorkspaceId: 'price-fixture', Edition: 'school', Plan: 'Flex', SubscriptionPrice: 123,
        PlanEntitlements: ['procurement'], PlanModuleCatalogVersion: 12, SubscriptionStatus: 'Active' };
      const registration = { WorkspaceId: 'price-fixture', Edition: 'school', Plan: 'Flex', Price, PriceSnapshot: snapshot,
        FeatureEntitlements: ['procurement'], PlanModuleCatalogVersion: 12, SubscriptionStatus: 'Active' };
      const original = structuredClone(registration), writes = [];
      const context = { getDocument: async () => profile,
        upsertDocument: async (_env, collection, id, data) => writes.push({ collection, id, data: structuredClone(data) }),
        invalidateDeploymentIdentityCache() {}, invalidateStaffAccessCache() {},
        SUBSCRIPTION_MODULE_CATALOG_VERSION, migrateSubscriptionModuleEntitlements };
      vm.runInNewContext(workspaceSource, context);
      assert.equal(await context.syncRegistrationSubscriptionToWorkspace({}, registration), true);
      assert.equal(writes[0].data.SubscriptionPrice, expected);
      assert.deepEqual(writes[0].data.SubscriptionPriceSnapshot, snapshot);
      globalThis.fetch = async url => String(url).endsWith('/api/plan-catalog')
        ? Response.json({ ok: true, catalog: {} }) : Response.json({ ok: true, policy: registration });
      const refreshed = await refreshOrganizationPlanPolicy({ ALLOW_CANONICAL_API_PROXY: 'true',
        CANONICAL_PORTAL_URL: 'https://procurement-price.example', CANONICAL_API_PROXY_SCOPE: 'platform-subscriptions' }, profile);
      assert.equal(refreshed.SubscriptionPrice, expected);
      assert.deepEqual(refreshed.SubscriptionPriceSnapshot, snapshot);
      assert.deepEqual(registration, original);
      assert.equal(profile.SubscriptionPrice, 123);
    }
  } finally { globalThis.fetch = originalFetch; invalidatePlanPolicyCache(); }
});

test('shared backup discovery includes Procurement stock, workflow, audit and configuration collections', async () => {
  const source = await readFile(new URL('../functions/lib/organization-backup.js', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('export async function organizationBackupDescriptors('),
    source.indexOf('export async function exportOrganizationBackupPage(')).replace('export ', '');
  const collections = ['procurementItems', 'procurementRequests', 'procurementPurchases', 'procurementTransfers',
    'procurementMovements', 'procurementOperations', 'procurementSettings'];
  for (const edition of editions) {
    const context = {
      requiredDeploymentIdentity: () => ({ edition }),
      listRootCollectionIds: async () => collections,
      getSchoolStructure: async () => ({ Branches: [{ Id: 'main' }] }),
      EXCLUDED_ROOT_COLLECTIONS: new Set(), EXTRA_NESTED_COLLECTIONS: [], STAFF_ATTENDANCE_COLLECTIONS: {},
      SCHOOL_SCOPED_COLLECTIONS: [], SCHOOL_BRANCH_SETTING_COLLECTIONS: [], CHURCH_COLLECTIONS: {},
      safePath: value => value
    };
    vm.runInNewContext(body, context);
    const descriptors = await context.organizationBackupDescriptors({});
    assert.deepEqual(Array.from(descriptors, ({ path }) => path).sort(), [...collections].sort());
    for (const collection of collections) {
      const row = { __id: `${edition}--main--test`, ScopeKey: `${edition}--main`, Quantity: 10, __updateTime: 'transport' };
      assert.deepEqual(sanitizeBackupDocument(collection, row), { __id: row.__id, ScopeKey: row.ScopeKey, Quantity: 10 });
      assert.equal(isOrganizationResetProtectedPath(collection), collection === 'procurementSettings');
    }
  }
});
