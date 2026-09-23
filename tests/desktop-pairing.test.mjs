import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  desktopCredentialHash,
  normalizeDesktopPairingCode,
  parseDesktopDeviceCredential,
  parseDesktopPairingCode,
  secureDesktopHashEqual
} from '../functions/lib/desktop-pairing.js';
import { applyDesktopDeviceBranchScope } from '../functions/lib/backend-security.js';
import {
  desktopStaffUserMatchesDeviceScope,
  enforceDesktopDeviceActionScope
} from '../functions/api/backend.js';

const portalRoot = new URL('../', import.meta.url);

test('pairing and device credentials use separate strict formats', () => {
  const code = 'DXP-ABCD234567-JKLMNPQRSTUVWX23456789AB';
  assert.equal(normalizeDesktopPairingCode(`  ${code.toLowerCase()}  `), code);
  assert.deepEqual(parseDesktopPairingCode(code), { code, pairingId: 'abcd234567' });
  assert.equal(parseDesktopPairingCode('DXP-too-short'), null);
  assert.deepEqual(
    parseDesktopDeviceCredential('DXD.abcdefghijklmnop.ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef'),
    {
      credential: 'DXD.abcdefghijklmnop.ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef',
      deviceId: 'abcdefghijklmnop'
    }
  );
  assert.deepEqual(
    parseDesktopDeviceCredential('DXD.AbCdEfGhIjKlMnOp.ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef'),
    {
      credential: 'DXD.AbCdEfGhIjKlMnOp.ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef',
      deviceId: 'AbCdEfGhIjKlMnOp'
    }
  );
  assert.equal(parseDesktopDeviceCredential(code), null);
});

test('credential hashes compare without persisting the raw credential', async () => {
  const hash = await desktopCredentialHash('DXD.device.secret');
  assert.equal(hash.length, 64);
  assert.equal(await secureDesktopHashEqual(hash, await desktopCredentialHash('DXD.device.secret')), true);
  assert.equal(await secureDesktopHashEqual(hash, await desktopCredentialHash('DXD.device.other')), false);
});

test('pairing endpoint is organisation-admin controlled, one-time and plan independent', async () => {
  const [api, library] = await Promise.all([
    readFile(new URL('functions/api/desktop-pairing.js', portalRoot), 'utf8'),
    readFile(new URL('functions/lib/desktop-pairing.js', portalRoot), 'utf8')
  ]);
  assert.match(api, /requireStaffSession\(env, request\)/);
  assert.match(api, /organisationWideSuperAdmin/);
  assert.match(api, /consumeRequestAllowance/);
  assert.doesNotMatch(api, /subscriptionPlan|featureEntitlement|Starter|Enterprise/);
  assert.match(library, /Status: 'Used'/);
  assert.match(library, /expiresAtMs <= Date\.now\(\)/);
  assert.match(library, /CredentialHash: await desktopCredentialHash\(credential\)/);
  assert.doesNotMatch(library, /Credential:\s*credential/);
});

test('backend accepts revocable device credentials while retaining legacy migration support', async () => {
  const [backend, security] = await Promise.all([
    readFile(new URL('functions/api/backend.js', portalRoot), 'utf8'),
    readFile(new URL('functions/lib/backend-security.js', portalRoot), 'utf8')
  ]);
  assert.match(backend, /await requireBackendSecret\(env, body\)/);
  assert.match(backend, /verifyDesktopSecret\(env, supplied, 'desktop backend'\)/);
  assert.match(security, /verifyDesktopDeviceCredential\(env, credential\)/);
  assert.match(security, /has been revoked/);
});

test('remote approval stores only locally generated credential hashes and exposes authenticated status polling', async () => {
  const [api, library] = await Promise.all([
    readFile(new URL('functions/api/desktop-pairing.js', portalRoot), 'utf8'),
    readFile(new URL('functions/lib/desktop-pairing.js', portalRoot), 'utf8')
  ]);
  assert.match(api, /action === 'request'/);
  assert.match(api, /action === 'status'/);
  assert.match(api, /action === 'approve'/);
  assert.match(api, /action === 'reject'/);
  assert.match(api, /256-bit claim token/);
  assert.match(library, /CredentialHash: credentialHash/);
  assert.match(library, /ClaimHash: await desktopCredentialHash\(claimToken\)/);
  assert.match(library, /authenticatedPairingRequest\(env, requestId, claimToken\)/);
  assert.doesNotMatch(library, /DeviceCredential:\s*options\./);
  assert.match(library, /options\.organisationWide === true/);
  assert.match(library, /DESKTOP_APPROVAL_BRANCH_REQUIRED/);
});

test('branch-bound desktop credentials force branch scope and reject nested cross-branch paths', () => {
  const authentication = { type: 'device', branchId: 'lords-garden', branchName: "Lord's Garden" };
  const scoped = applyDesktopDeviceBranchScope({ Action: 'getStudents' }, authentication);
  assert.equal(scoped.BranchId, 'lords-garden');
  assert.equal(scoped.UserBranchId, 'lords-garden');
  assert.equal(scoped.DeviceBranchId, 'lords-garden');
  assert.throws(
    () => applyDesktopDeviceBranchScope({ BranchId: 'main' }, authentication),
    (error) => error?.code === 'DESKTOP_DEVICE_BRANCH_MISMATCH'
  );
  assert.throws(
    () => applyDesktopDeviceBranchScope({ Student: { __scopePath: 'schoolBranches/main/sections/primary/students' } }, authentication),
    (error) => error?.code === 'DESKTOP_DEVICE_BRANCH_MISMATCH'
  );
  assert.throws(
    () => applyDesktopDeviceBranchScope({ StudentScopePath: 'students' }, authentication),
    (error) => error?.code === 'DESKTOP_DEVICE_BRANCH_MISMATCH'
  );
  const organisationWide = { Action: 'getStudents', BranchId: 'main' };
  assert.equal(applyDesktopDeviceBranchScope(organisationWide, { type: 'device', branchId: '' }), organisationWide);
});

test('branch pairing can complete with branch staff or an organisation-wide Super Admin', () => {
  assert.equal(desktopStaffUserMatchesDeviceScope({ Role: 'Front Desk', BranchId: 'north' }, 'north'), true);
  assert.equal(desktopStaffUserMatchesDeviceScope({ Role: 'Front Desk', BranchId: 'south' }, 'north'), false);
  assert.equal(desktopStaffUserMatchesDeviceScope({ Role: 'Front Desk', BranchId: '' }, 'north'), false);
  assert.equal(desktopStaffUserMatchesDeviceScope({ Role: 'Super Admin', BranchId: '' }, 'north'), true);
  assert.equal(desktopStaffUserMatchesDeviceScope({ Role: 'Super Admin', BranchId: 'south' }, 'north'), false);
  assert.equal(desktopStaffUserMatchesDeviceScope({ Role: 'Front Desk', BranchId: 'south' }, ''), true);
});

test('branch-bound devices fail closed for unverified global and bare-ID actions', async () => {
  const backend = await readFile(new URL('functions/api/backend.js', portalRoot), 'utf8');
  const branchDevice = { type: 'device', branchId: 'north', branchName: 'North' };
  const allowed = enforceDesktopDeviceActionScope(branchDevice, 'getStudents', { Action: 'getStudents' });
  assert.equal(allowed.Action, 'getStudents');

  [
    'updateApplicationStatus', 'deleteApplication', 'importStudents', 'promoteStudents',
    'getClinicRecords', 'getClinicInventory', 'getKitchenInventory',
    'getStoreOverview', 'getFormSales', 'saveFeeItem', 'recordSale',
    'recordManualPayment', 'generateSchoolFeeInvoices', 'getAccountingOverview',
    'saveAccountingPeriod', 'saveAccountingApprovalLimit', 'saveAccountingCloseChecklist',
    'syncAccountingRevenue', 'savePayrollTaxProfile', 'exportBackup',
    'saveOrganisationStructure', 'saveOrganizationModulePreferences'
  ].forEach((action) => {
    assert.throws(
      () => enforceDesktopDeviceActionScope(branchDevice, action, {
        Action: action,
        ApplicationReference: 'SOUTH/26/000001'
      }),
      (error) => error?.code === 'DESKTOP_DEVICE_ORGANISATION_WIDE_REQUIRED',
      `${action} must fail closed for a branch-bound device`
    );
  });

  const organisationWideBody = { Action: 'deleteApplication', ApplicationReference: 'ANY/26/000001' };
  assert.equal(
    enforceDesktopDeviceActionScope({ type: 'device', branchId: '' }, 'deleteApplication', organisationWideBody),
    organisationWideBody
  );
  assert.equal(
    enforceDesktopDeviceActionScope({ type: 'legacy-secret' }, 'deleteApplication', organisationWideBody),
    organisationWideBody
  );

  assert.match(backend, /BRANCH_BOUND_DEVICE_ACTIONS/);
  assert.match(backend, /if \(!BRANCH_BOUND_DEVICE_ACTIONS\.has\(action\)\)/);
  assert.match(backend, /action !== 'saveSchoolProfile'/);
  assert.match(backend, /SettingsScope: 'branch'/);
  assert.match(backend, /body\.DeviceBranchId[\s\S]*saveBranchProfileOverrides\(env/);
  assert.match(backend, /message: `\$\{saved\.branch\.name\} email sender settings saved\.`/);
  assert.match(backend, /duplicateIsSelectedStudent[\s\S]*duplicate\.__scopePath, student\.__scopePath/);
  assert.match(backend, /balance: updatedAccount\.WalletBalance/);
  assert.match(backend, /const desktopAuthentication = await requireBackendSecret/);
  assert.match(backend, /applyDesktopDeviceBranchScope\(body, desktopAuthentication\)/);
});

test('desktop document bridges accept device credentials instead of requiring the Cloudflare secret', async () => {
  const sources = await Promise.all([
    readFile(new URL('functions/api/passport-photo.js', portalRoot), 'utf8'),
    readFile(new URL('functions/api/staff-document.js', portalRoot), 'utf8'),
    readFile(new URL('functions/api/import-firestore.js', portalRoot), 'utf8')
  ]);
  sources.forEach((source) => assert.match(source, /verifyDesktopCredential/));
  sources.forEach((source) => assert.match(source, /desktopAuthentication/));
  assert.match(sources[0], /applyDesktopDeviceBranchScope/);
  assert.match(sources[1], /applyDesktopDeviceBranchScope/);
  assert.match(sources[2], /DESKTOP_DEVICE_ORGANISATION_WIDE_REQUIRED/);
  assert.doesNotMatch(sources[0], /suppliedSecret === clean\(env\.BACKEND_SHARED_SECRET\)/);
  assert.doesNotMatch(sources[1], /clean\(body\.Secret \|\| body\.secret\) === clean\(env\.BACKEND_SHARED_SECRET\)/);
});

test('web companion exposes pairing and device revocation to organisation administrators', async () => {
  const [html, javascript] = await Promise.all([
    readFile(new URL('admin.html', portalRoot), 'utf8'),
    readFile(new URL('js/admin.js', portalRoot), 'utf8')
  ]);
  assert.match(html, /id="staffDesktopSetup"/);
  assert.match(html, /Generate one-time pairing code/);
  assert.match(javascript, /desktopSetupButton\.hidden = !canManageOrganisationSettings\(user\)/);
  assert.match(javascript, /desktopPairingRequest\('revoke'/);
});
