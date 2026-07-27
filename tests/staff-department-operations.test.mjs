import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const portalRoot = new URL('../', import.meta.url);
const [api, adminApi, adminJs] = await Promise.all([
  readFile(new URL('functions/api/staff-departments.js', portalRoot), 'utf8'),
  readFile(new URL('functions/api/admin.js', portalRoot), 'utf8'),
  readFile(new URL('js/admin.js', portalRoot), 'utf8')
]);

test('clinic, kitchen and tuck shop operations require staff section access', () => {
  assert.match(api, /requireStaffSession\(env, request\)/);
  assert.match(api, /!\(user\.allowedSections \|\| \[\]\)\.includes\(section\)/);
  assert.match(api, /clinicInventory/);
  assert.match(api, /kitchenInventory/);
  assert.match(api, /tuckShopInventory/);
});

test('department inventory writes carry branch, school section and staff audit fields', () => {
  assert.match(api, /BranchId: clean\(user\.branchId\) \|\| 'main'/);
  assert.match(api, /SchoolSection:/);
  assert.match(api, /UpdatedBy: user\.displayName \|\| user\.username/);
  assert.match(api, /RecordedBy: user\.displayName \|\| user\.username/);
});

test('stock issues cannot exceed available stock', () => {
  assert.match(api, /movementType === 'OUT' && quantity > current/);
  assert.match(api, /Only \$\{current\} \$\{clean\(item\.Unit\) \|\| 'units'\} are currently available/);
});

test('clinic web workflow records visits and all departments manage stock', () => {
  assert.match(adminJs, /id="clinicRecordForm"/);
  assert.match(adminJs, /saveClinicRecord/);
  assert.match(adminJs, /id="departmentInventoryForm"/);
  assert.match(adminJs, /id="departmentMovementForm"/);
  assert.match(adminJs, /active === 'clinic' \|\| active === 'kitchen' \|\| active === 'tuckShop'/);
});

test('tuck shop dashboard includes inventory without bypassing wallet purchase history', () => {
  assert.match(adminApi, /tuckShopInventory/);
  assert.match(adminApi, /tuckShopMovements/);
  assert.match(adminApi, /purchases: publicRows\(sortRecent\(walletPurchases/);
  assert.match(adminJs, /Wallet Purchases/);
});
