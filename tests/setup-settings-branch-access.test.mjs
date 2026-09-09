import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { resolveSetupSettingsAccess } from '../functions/lib/setup-auth.js';

test('assigned branch administrators are forced into their own branch settings', () => {
  const access = resolveSetupSettingsAccess({
    source: 'staff-session',
    role: 'Super Admin',
    branchId: 'lords-garden'
  }, 'organisation', '');

  assert.deepEqual(access, {
    scope: 'branch',
    branchId: 'lords-garden',
    scopeLocked: true
  });
});

test('assigned branch administrators cannot target a different branch', () => {
  assert.throws(
    () => resolveSetupSettingsAccess({
      source: 'staff-session',
      role: 'Super Admin',
      branchId: 'lords-garden'
    }, 'branch', 'area-one'),
    (error) => error.status === 403 && /assigned to one branch/i.test(error.message)
  );
});

test('organisation-wide setup administrators retain organisation and branch choices', () => {
  assert.deepEqual(
    resolveSetupSettingsAccess({ source: 'staff-session', role: 'Super Admin' }, 'organisation', ''),
    { scope: 'organisation', branchId: '', scopeLocked: false }
  );
  assert.deepEqual(
    resolveSetupSettingsAccess({ source: 'staff-session', role: 'Super Admin' }, 'branch', 'area-one'),
    { scope: 'branch', branchId: 'area-one', scopeLocked: false }
  );
});

test('web settings and organisation policies enforce the resolved scope on the server', async () => {
  const [settingsApi, academicPolicyApi, setupScript, staffSubscriptionApi, staffUsersApi, staffMfa, adminScript] = await Promise.all([
    readFile(new URL('../functions/api/settings.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/academic-policy.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/setup.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/staff-subscription.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/staff-users.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/lib/staff-mfa.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/admin.js', import.meta.url), 'utf8')
  ]);

  assert.match(settingsApi, /resolveSetupSettingsAccess/);
  assert.match(settingsApi, /const settingsScope = settingsAccess\.scope/);
  assert.match(settingsApi, /const branchId = settingsAccess\.branchId/);
  assert.match(academicPolicyApi, /resolveSetupSettingsAccess/);
  assert.match(academicPolicyApi, /SettingsScope: settingsAccess\.scope/);
  assert.match(setupScript, /settingsScopeField\.disabled = scopeLocked/);
  assert.match(setupScript, /settingsBranchField\.disabled = !branchMode \|\| scopeLocked/);
  assert.match(staffSubscriptionApi, /organisation-wide Super Admin/);
  assert.match(staffUsersApi, /ensureOrganisationWideSuperAdmin\(actor\)/);
  assert.match(staffMfa, /Only an organisation-wide Super Administrator can change the two-factor policy/);
  assert.match(adminScript, /canManageOrganisationSettings/);
  assert.match(adminScript, /canManageOrganisationPolicy \? '' : ' disabled'/);
});
