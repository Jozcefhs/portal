import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { featureFlagsForEdition } from '../functions/lib/organization-config.js';
import {
  configuredModulesForUser,
  defaultModulesForRole,
  roleAccessView,
  withRoleModules,
  withoutRoleModules
} from '../functions/lib/role-module-access.js';
import { allowedSectionsFor } from '../functions/lib/staff-auth.js';

const [staffUsersApi, adminJs] = await Promise.all([
  readFile(new URL('../functions/api/staff-users.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/admin.js', import.meta.url), 'utf8')
]);

test('role settings use branch policy first, then organisation-wide policy, then safe defaults', () => {
  const flags = featureFlagsForEdition('faith');
  const document = {
    Scopes: {
      global: { Treasurer: ['funds', 'incomeAnalytics'] },
      west: { Treasurer: ['donations'] }
    }
  };
  assert.deepEqual(
    configuredModulesForUser(document, { branchId: 'west' }, 'Treasurer', 'faith', flags),
    ['donations']
  );
  assert.deepEqual(
    configuredModulesForUser(document, { branchId: 'east' }, 'Treasurer', 'faith', flags),
    ['funds', 'incomeAnalytics']
  );
  assert.equal(configuredModulesForUser(document, { branchId: 'east' }, 'Pastor', 'faith', flags), null);
});

test('saved role modules replace hardcoded role defaults without silently adding HR', () => {
  const flags = featureFlagsForEdition('faith');
  const resolved = allowedSectionsFor(
    { role: 'Treasurer' },
    flags,
    { edition: 'faith', roleModules: ['donations'] }
  );
  assert.deepEqual(resolved, ['donations']);
  assert.equal(resolved.includes('humanResources'), false);
  assert.equal(resolved.includes('staffAttendance'), false);
});

test('Super Admin can never lose the permission settings module', () => {
  const flags = featureFlagsForEdition('school');
  const scopes = withRoleModules({}, 'main', 'Super Admin', ['students'], 'school', flags);
  assert.deepEqual(scopes.main['Super Admin'], ['students', 'staffUsers']);
  assert.deepEqual(
    allowedSectionsFor({ role: 'Super Admin' }, flags, { edition: 'school', roleModules: ['students'] }),
    ['students', 'staffUsers']
  );
});

test('resetting a branch role restores organisation inheritance without changing other roles', () => {
  const original = {
    Scopes: {
      global: { Treasurer: ['funds'] },
      main: { Treasurer: ['donations'], Pastor: ['services'] }
    }
  };
  const scopes = withoutRoleModules(original, 'main', 'Treasurer');
  assert.deepEqual(scopes.main, { Pastor: ['services'] });
  const view = roleAccessView({ Scopes: scopes }, { branchId: 'main' }, 'faith', featureFlagsForEdition('faith'));
  assert.equal(view.roles.Treasurer.source, 'global');
  assert.deepEqual(view.roles.Treasurer.modules, ['funds']);
});

test('legacy defaults remain only as an unsaved starting policy', () => {
  const modules = defaultModulesForRole('Membership Officer', {
    edition: 'faith',
    featureFlags: featureFlagsForEdition('faith')
  });
  assert.equal(modules.includes('members'), true);
  assert.equal(modules.includes('staffAttendance'), true);
  const view = roleAccessView(null, { branchId: 'main' }, 'faith', featureFlagsForEdition('faith'));
  assert.equal(view.roles['Membership Officer'].source, 'default');
  assert.equal(view.roles['Membership Officer'].locallyConfigured, false);
});

test('staff settings API and interface expose persisted role module controls', () => {
  assert.doesNotMatch(staffUsersApi, /WEB_SECTION_KEYS\.has\(/);
  assert.match(staffUsersApi, /WEB_SECTION_KEY_SET\.has\(section\)/);
  assert.match(staffUsersApi, /getDocument\(env, 'settings', 'roleModuleAccess'\)/);
  assert.match(staffUsersApi, /action === 'save-role-access'/);
  assert.match(staffUsersApi, /action === 'reset-role-access'/);
  assert.match(adminJs, /Role module access/);
  assert.match(adminJs, /name="RoleModuleOption"/);
  assert.match(adminJs, /staffUserRequest\('save-role-access'/);
  assert.match(adminJs, /label: 'Role access'/);
});
