import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { featureFlagsForEdition } from '../functions/lib/organization-config.js';
import { allowedSectionsFor } from '../functions/lib/staff-auth.js';

const portalRoot = new URL('../', import.meta.url);
const [adminJs, adminApi, staffUsersApi, storeApi, departmentApi, categorySource, portalCss] = await Promise.all([
  readFile(new URL('js/admin.js', portalRoot), 'utf8'),
  readFile(new URL('functions/api/admin.js', portalRoot), 'utf8'),
  readFile(new URL('functions/api/staff-users.js', portalRoot), 'utf8'),
  readFile(new URL('functions/api/staff-stores.js', portalRoot), 'utf8'),
  readFile(new URL('functions/api/staff-departments.js', portalRoot), 'utf8'),
  readFile(new URL('functions/lib/store-categories.js', portalRoot), 'utf8'),
  readFile(new URL('css/style.css', portalRoot), 'utf8')
]);

test('religious organisations receive dedicated store and restaurant modules without school commerce', () => {
  const flags = featureFlagsForEdition('faith');
  assert.equal(flags.retail, true);
  assert.equal(flags.restaurant, true);
  assert.equal(flags.stores, false);
  assert.equal(flags.kitchen, false);
  const sections = allowedSectionsFor({ role: 'Super Admin' }, flags);
  assert.equal(sections.includes('organizationStore'), true);
  assert.equal(sections.includes('restaurant'), true);
  assert.equal(sections.includes('bookstore'), false);
  assert.equal(sections.includes('uniformStore'), false);
  assert.equal(sections.includes('tuckShop'), false);
  assert.equal(sections.includes('kitchen'), false);
});

test('church staff editor removes school modules, roles and accounting permissions', () => {
  assert.match(adminJs, /function webTabsForEdition/);
  assert.match(adminJs, /tabConfig\.filter\(\(\[key\]\) => !schoolOnlyWebSections\.has\(key\)\)/);
  assert.match(adminJs, /function staffRolesForEdition/);
  assert.match(adminJs, /\$\{schoolEdition \? '<label>School section/);
  assert.match(adminJs, /permissionTabs\.map/);
  assert.match(staffUsersApi, /accountingChartForEdition\(accounts, actor\.edition\)/);
  assert.match(staffUsersApi, /ensureRoleAvailable\(role, edition\)/);
  assert.match(staffUsersApi, /LoginUsername: clean\(row\.LoginUsername/);
});

test('church store uses its own catalogue scope and customer-facing language', () => {
  assert.match(storeApi, /organizationStore/);
  assert.match(storeApi, /return 'Organisation Store'/);
  assert.match(categorySource, /return 'Organisation Store'/);
  assert.match(adminApi, /StoreType\) === 'Organisation Store'/);
  assert.match(adminJs, /\['organizationStore', 'Organisation Store'\]/);
  assert.match(adminJs, /organisationStore \? 'customers and storekeepers'/);
  assert.match(adminJs, /organisationStore \? 'Available for sale'/);
  assert.match(adminJs, /data-edit-store-item/);
  assert.match(adminJs, /name="ItemId"/);
  assert.match(adminJs, /textContent = 'Update item'/);
  assert.match(storeApi, /existing \? 'Store item updated\.' : 'Store item saved\.'/);
  assert.match(storeApi, /Store item not found or is outside your permitted workspace/);
  assert.match(storeApi, /action === 'deletecategory'/);
  assert.match(categorySource, /export async function deleteStoreCategory/);
  assert.match(categorySource, /is assigned to \$\{affected\.length\} inventory item/);
  assert.match(categorySource, /await deleteDocument\(env, 'storeCategories', id\)/);
});

test('restaurant manages separate inventory, movements, low stock and supplier market lists', () => {
  assert.match(departmentApi, /restaurant: \{ label: 'Restaurant', inventory: 'restaurantInventory', movements: 'restaurantMovements'/);
  assert.match(departmentApi, /\['clinic', 'kitchen', 'restaurant'\]\.includes\(section\)/);
  assert.match(adminApi, /lowRestaurant/);
  assert.match(adminJs, /restaurant: 'Manage restaurant and catering inventory/);
  assert.match(adminJs, /\['clinic', 'kitchen', 'restaurant'\]\.includes\(section\)/);
});

test('shared checkbox labels keep controls vertically aligned with their text', () => {
  assert.match(portalCss, /\.check-row\{[^}]*align-items:center/);
  assert.match(portalCss, /\.check-row>input\[type="checkbox"\][^{]*\{[^}]*align-self:center/);
  assert.doesNotMatch(portalCss, /\.check-row\{[^}]*align-items:flex-start/);
});
