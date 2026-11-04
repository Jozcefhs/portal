import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { assignedStaffBranches } from '../functions/lib/staff-branch-access.js';

const source = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const extract = name => source.match(new RegExp(`function ${name}\\([^]*?\\n}`))[0];
const context = vm.createContext({ currentUser: {} });
vm.runInContext(['clean', 'lower', 'yes', 'escapeHtml', 'canManageOrganisationSettings', 'canResetStaffBiometrics', 'staffBiometricRecoveryAction'].map(extract).join('\n'), context);

test('lost-device recovery is offered only to an active organisation-wide Super Admin for another account, in every edition', () => {
  for (const edition of ['school', 'faith', 'organisation', 'hospital']) {
    context.currentUser = { username: 'owner', role: 'Super Admin', edition, subscriptionActive: true };
    assert.equal(vm.runInContext("canResetStaffBiometrics({Username:'staff',Active:true})", context), true);
    assert.equal(vm.runInContext("canResetStaffBiometrics({Username:'OWNER',Active:true})", context), false);
    assert.equal(vm.runInContext("canResetStaffBiometrics({Username:'staff',Active:false})", context), false);
    assert.equal(vm.runInContext("canResetStaffBiometrics({Username:'staff',Active:true,PasswordSetupRequired:true})", context), false);
    for (const changes of [{ role: 'Admin' }, { assignedBranchId: 'main' }, { canSwitchBranches: false, branchId: 'main' }, { subscriptionReadOnly: true }, { subscriptionActive: false }]) {
      context.currentUser = { username: 'owner', role: 'Super Admin', edition, ...changes };
      assert.equal(vm.runInContext("canResetStaffBiometrics({Username:'staff',Active:true})", context), false);
    }
  }
});

test('row recovery targets the permanent account identity after a staff username change', () => {
  context.currentUser = { username: 'owner', role: 'Super Admin' };
  const html = vm.runInContext(`staffBiometricRecoveryAction({Username:'permanent-key',LoginUsername:'new.login@example.test',Active:true})`, context);
  assert.match(html, /data-recover-staff-biometrics="permanent-key"/);
  assert.doesNotMatch(html, /new.login/);
  assert.match(source, /data-recover-staff-biometrics[^]*?openStaffBiometricRecovery\(button\.dataset\.recoverStaffBiometrics\)/);
});

test('recovery branch eligibility matches the backend for explicit lists, selected-empty and legacy assignments', () => {
  const examples = [
    {}, { branchAccess:'all', assignedBranchIds:[], branchId:'main', canSwitchBranches:true },
    { BranchAccess:'all', BranchIds:['main','area-1'], assignedBranchId:'main' },
    { branchAccess:'selected', assignedBranchIds:[], canSwitchBranches:true },
    { BranchAccess:'selected' }, { branchAccess:'selected', assignedBranchIds:['main','area-1'],canSwitchBranches:true },
    { BranchIds:['main','area-1'],canSwitchBranches:true }, { branchIds:[] },
    { BranchId:'main' }, { branchId:'main',canSwitchBranches:true }, { assignedBranchId:'main',canSwitchBranches:true },
    { BranchId:'all' }
  ];
  for(const branchFields of examples){
    context.currentUser={username:'owner',role:'Super Admin',...branchFields};
    assert.equal(vm.runInContext("canResetStaffBiometrics({Username:'staff',Active:true})",context),assignedStaffBranches(context.currentUser)===null,JSON.stringify(branchFields));
  }
});

test('embedded recovery and row shortcut use one dialog, without a second MFA status scan or whole-page reload', () => {
  const start = source.indexOf("document.getElementById('resetStaffMfa')?.addEventListener");
  const handler = source.slice(start, source.indexOf("document.getElementById('staffUserForm')?.addEventListener('submit'", start));
  assert.match(handler, /openStaffBiometricRecovery\(targetUsername\)/);
  assert.doesNotMatch(handler, /mfaRequest\(|renderStaffUsers\(|location\.reload/);
  const dialog = extract('openStaffBiometricRecovery');
  assert.equal((dialog.match(/await mfaRequest\(/g) || []).length, 1);
  assert.doesNotMatch(dialog, /admin-status|renderStaffUsers\(|location\.reload/);
});
