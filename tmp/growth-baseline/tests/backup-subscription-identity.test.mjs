import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { resolveOrganizationConfig } from '../functions/lib/organization-config.js';

const source = await readFile(new URL('../functions/lib/organization-backup.js', import.meta.url), 'utf8');
const slice = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

async function restoredProfile(current, backup, id = 'organisationProfile') {
  const context = vm.createContext({
    clean: (value) => String(value ?? '').trim(), lower: (value) => String(value ?? '').trim().toLowerCase(),
    restoreError: (message) => new Error(message), getDocument: async () => structuredClone({ ...current, __updateTime: 'live-version' })
  });
  vm.runInContext(slice('const SUBSCRIPTION_IDENTITY_SETTING_FIELDS =', 'const RESET_PRESERVED_ROOT_COLLECTIONS ='), context);
  vm.runInContext(slice('function withoutTransportMetadata(', 'export function sanitizeBackupDocument('), context);
  vm.runInContext(slice('async function protectedRestoreDocument(', 'export async function writeOrganizationRestoreChunk('), context);
  const result = await context.protectedRestoreDocument({}, 'settings', { __id: id, ...backup }, { username: 'owner' });
  return JSON.parse(JSON.stringify(result.data));
}

test('restoring an older profile cannot downgrade the live entitlement version or grant excluded modules', async () => {
  const current = { WorkspaceId: 'school-one', Edition: 'school', Plan: 'Flex', SubscriptionStatus: 'Active',
    PlanEntitlements: ['accounting', 'approvals'], PlanModuleCatalogVersion: 11,
    SubscriptionPriceSnapshot: { ModuleCatalogVersion: 11, TotalAmount: 8000 } };
  const restored = await restoredProfile(current, { WorkspaceId: 'school-one', Edition: 'school', Plan: 'Professional',
    PlanEntitlements: ['accounting', 'approvals', 'vendorSettlements', 'externalAudit'], PlanModuleCatalogVersion: 10,
    SubscriptionPriceSnapshot: { ModuleCatalogVersion: 10, TotalAmount: 4000 }, Name: 'Restored school name' });
  for (const key of ['Plan', 'PlanEntitlements', 'PlanModuleCatalogVersion', 'SubscriptionPriceSnapshot']) {
    assert.deepEqual(restored[key], current[key]);
  }
  assert.equal(restored.Name, 'Restored school name', 'Ordinary profile content remains restorable');
  const flags = resolveOrganizationConfig({ organizationProfile: restored }).FeatureFlags;
  assert.equal(flags.vendorSettlements, false);
  assert.equal(flags.externalAudit, false);
});

test('restoring a newer backup preserves absent legacy markers with their original entitlements', async () => {
  const current = { WorkspaceId: 'school-one', Edition: 'school', Plan: 'Flex', SubscriptionStatus: 'Active',
    PlanEntitlements: ['accounting', 'approvals'] };
  const restored = await restoredProfile(current, { Edition: 'school', Plan: 'Starter', PlanEntitlements: [],
    PlanModuleCatalogVersion: 11, SubscriptionPriceSnapshot: { ModuleCatalogVersion: 11, TotalAmount: 9000 } });
  assert.equal(Object.hasOwn(restored, 'PlanModuleCatalogVersion'), false);
  assert.equal(Object.hasOwn(restored, 'SubscriptionPriceSnapshot'), false);
  assert.deepEqual(restored.PlanEntitlements, current.PlanEntitlements);
  const flags = resolveOrganizationConfig({ organizationProfile: restored }).FeatureFlags;
  assert.equal(flags.vendorSettlements, true);
  assert.equal(flags.externalAudit, true);
});

test('subscription identity protection remains limited to the organisation profile', async () => {
  const restored = await restoredProfile({ PlanModuleCatalogVersion: 11 }, {
    PlanModuleCatalogVersion: 10, Name: 'Other settings'
  }, 'unrelatedSettings');
  assert.equal(restored.PlanModuleCatalogVersion, 10);
  assert.equal(restored.Name, 'Other settings');
});
