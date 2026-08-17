import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { featureFlagsForEdition } from '../functions/lib/organization-config.js';
import {
  configuredModulesForUser,
  defaultModulesForRole,
  modulesForEdition,
  roleAccessView,
  rolesForEdition,
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

test('Super Admin can never lose backup, security audit or permission settings modules', () => {
  const flags = featureFlagsForEdition('school');
  const scopes = withRoleModules({}, 'main', 'Super Admin', ['students'], 'school', flags);
  assert.deepEqual(scopes.main['Super Admin'], ['students', 'dataBackup', 'securityAudit', 'staffUsers']);
  assert.deepEqual(
    allowedSectionsFor({ role: 'Super Admin' }, flags, { edition: 'school', roleModules: ['students'] }),
    ['students', 'dataBackup', 'securityAudit', 'staffUsers']
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

test('Academics department users retain the School academic workspace', () => {
  const flags = featureFlagsForEdition('school');
  assert.equal(defaultModulesForRole('Department User', {
    edition: 'school', featureFlags: flags, department: 'Academics'
  }).includes('academics'), true);
  assert.equal(allowedSectionsFor({
    role: 'Department User', department: 'Academics', TabAccess: ['financeRequests']
  }, flags, { edition: 'school', roleModules: ['financeRequests'] }).includes('academics'), true);
  assert.equal(allowedSectionsFor({
    role: 'Department User', department: 'Accounts'
  }, flags, { edition: 'school', roleModules: ['financeRequests'] }).includes('academics'), false);
  assert.equal(defaultModulesForRole('Department User', {
    edition: 'faith', featureFlags: featureFlagsForEdition('faith'), department: 'Academics'
  }).includes('academics'), false);
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

test('role access settings expose only edition-appropriate roles and modules', () => {
  const schoolRoles = rolesForEdition('school');
  assert.equal(schoolRoles.includes('Principal'), true);
  assert.equal(schoolRoles.includes('Senior Pastor'), false);
  assert.equal(schoolRoles.includes('Church Administrator'), false);
  const schoolModules = modulesForEdition('school', featureFlagsForEdition('school')).map(({ key }) => key);
  assert.equal(schoolModules.includes('students'), true);
  assert.equal(schoolModules.includes('offerings'), false);

  const churchRoles = rolesForEdition('faith');
  assert.equal(churchRoles.includes('Senior Pastor'), true);
  assert.equal(churchRoles.includes('Principal'), false);
  assert.equal(churchRoles.includes('Admissions Officer'), false);
  const churchModules = modulesForEdition('faith', featureFlagsForEdition('faith')).map(({ key }) => key);
  assert.equal(churchModules.includes('offerings'), true);
  assert.equal(churchModules.includes('students'), false);

  const organizationRoles = rolesForEdition('organization');
  assert.equal(organizationRoles.includes('Executive Director'), true);
  assert.equal(organizationRoles.includes('Organisation Administrator'), true);
  assert.equal(organizationRoles.includes('Head Minister'), false);
  assert.equal(organizationRoles.includes('Pastor'), false);
  assert.equal(organizationRoles.includes('Principal'), false);
  const organizationModules = modulesForEdition(
    'organization',
    featureFlagsForEdition('organization')
  );
  assert.equal(
    organizationModules.find(({ key }) => key === 'members')?.label,
    'Departments & Personnel'
  );
  assert.equal(
    organizationModules.find(({ key }) => key === 'offerings')?.label,
    'Income & Receipts'
  );
  assert.equal(
    organizationModules.find(({ key }) => key === 'services')?.label,
    'Meetings & Attendance'
  );
});

test('School Accounts Officers receive only the academic clearance entry by default', () => {
  const modules = defaultModulesForRole('Accounts Officer', {
    edition: 'school', featureFlags: featureFlagsForEdition('school')
  });
  assert.equal(modules.includes('academics'), true);
});

test('generic organisation interface has a neutral terminology layer', () => {
  assert.match(adminJs, /Departments & Personnel/);
  assert.match(adminJs, /Budgets & Account Mappings/);
  assert.match(adminJs, /Grants & Contributions/);
  assert.match(adminJs, /faithOnlyStaffRoles/);
  assert.match(adminJs, /organizationOnlyStaffRoles/);
});
