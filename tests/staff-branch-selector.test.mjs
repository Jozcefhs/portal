import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  applyStaffBranchContext,
  configuredStaffBranches,
  resolveStaffAssignmentBranch,
  staffAssignmentActor
} from '../functions/lib/staff-branch-context.js';

const adminHtml = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const adminJs = fs.readFileSync(new URL('../js/admin.js', import.meta.url), 'utf8');
const adminApi = fs.readFileSync(new URL('../functions/api/admin.js', import.meta.url), 'utf8');
const staffUsersApi = fs.readFileSync(new URL('../functions/api/staff-users.js', import.meta.url), 'utf8');
const staffAuth = fs.readFileSync(new URL('../functions/lib/staff-auth.js', import.meta.url), 'utf8');
const portalCss = fs.readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');

const structure = {
  Branches: [
    { Id: 'main', Name: 'Main Branch' },
    { Id: 'north', Name: 'North Branch' }
  ]
};

test('configured branch choices use stable ids and names', () => {
  assert.deepEqual(configuredStaffBranches(structure), [
    { id: 'main', name: 'Main Branch' },
    { id: 'north', name: 'North Branch' }
  ]);
});

test('a branch-assigned account remains locked to its assigned branch', () => {
  const scoped = applyStaffBranchContext({ username: 'branch.user', branchId: 'north' }, '', structure);
  assert.equal(scoped.branchId, 'north');
  assert.equal(scoped.assignedBranchId, 'north');
  assert.equal(scoped.activeBranchId, 'north');
  assert.equal(scoped.canSwitchBranches, false);
  assert.throws(
    () => applyStaffBranchContext({ branchId: 'north' }, 'main', structure),
    (error) => error.status === 403 && /assigned to one branch/i.test(error.message)
  );
});

test('an organisation-wide account may select all or one configured branch', () => {
  const all = applyStaffBranchContext({ username: 'admin', branchId: '' }, 'all', structure);
  assert.equal(all.branchId, '');
  assert.equal(all.activeBranchId, 'all');
  assert.equal(all.canSwitchBranches, true);

  const north = applyStaffBranchContext({ username: 'admin', branchId: '' }, 'north', structure);
  assert.equal(north.branchId, 'north');
  assert.equal(north.activeBranchId, 'north');
  assert.equal(north.canSwitchBranches, true);
  assert.throws(
    () => applyStaffBranchContext({ branchId: '' }, 'unknown', structure),
    (error) => error.status === 403 && /not configured/i.test(error.message)
  );
});

test('an organisation-wide Super Admin may assign staff without changing the working branch', () => {
  const actor = {
    role: 'Super Admin', assignedBranchId: '', activeBranchId: 'main', branchId: 'main', canSwitchBranches: true
  };
  assert.equal(resolveStaffAssignmentBranch(actor, 'north', '', structure), 'north');
  assert.equal(resolveStaffAssignmentBranch(actor, 'all', '', structure), '');
  assert.throws(
    () => resolveStaffAssignmentBranch(actor, 'unknown', '', structure),
    (error) => error.status === 400 && /configured for this organisation/i.test(error.message)
  );
});

test('a branch-assigned administrator cannot assign staff to another branch', () => {
  const actor = {
    role: 'Super Admin', assignedBranchId: 'main', activeBranchId: 'main', branchId: 'main', canSwitchBranches: false
  };
  assert.equal(resolveStaffAssignmentBranch(actor, '', '', structure), 'main');
  assert.throws(
    () => resolveStaffAssignmentBranch(actor, 'north', '', structure),
    (error) => error.status === 403 && /cannot register staff in another branch/i.test(error.message)
  );
});

test('only the configured environment Super Admin may recover organisation-wide staff assignment control', () => {
  const branchAdmin = {
    username: 'admin', role: 'Super Admin', assignedBranchId: 'main', branchId: 'main', canSwitchBranches: false
  };
  const recovered = staffAssignmentActor(branchAdmin, 'admin');
  assert.equal(recovered.assignedBranchId, '');
  assert.equal(recovered.canSwitchBranches, true);
  assert.equal(resolveStaffAssignmentBranch(recovered, 'north', 'main', structure), 'north');
  const ordinary = staffAssignmentActor({ ...branchAdmin, username: 'branch.admin' }, 'admin');
  assert.equal(ordinary.assignedBranchId, 'main');
  assert.equal(ordinary.canSwitchBranches, false);
});

test('the web companion sends and renders the server-enforced session branch', () => {
  assert.match(adminHtml, /id="staffBranchSelector"/);
  assert.match(adminJs, /headers\.set\('X-Dynamax-Branch', selectedBranchId \|\| 'all'\)/);
  assert.match(adminJs, /function clearBranchScopedWorkspaceData\(\)/);
  assert.match(adminJs, /async function switchStaffBranch\(nextBranchId\)/);
  assert.match(adminJs, /window\.sessionStorage\.setItem\(staffBranchStorageKey\(user\), selectedBranchId\)/);
  assert.match(adminJs, /selectedOption\?\.id \|\| userOption\?\.id \|\| options\[0\]\?\.id \|\| 'all'/);
  assert.match(adminJs, /responseBranchId\.toLowerCase\(\) !== requestedBranchId\.toLowerCase\(\)/);
  assert.doesNotMatch(adminJs, /canSwitchBranches === true && user\.featureFlags\?\.branches !== false/);
  assert.match(adminJs, /branchControl\.hidden = !options\.length/);
  assert.match(adminJs, /branchSelector\.disabled = branchSwitchInProgress \|\| !canSwitch \|\| options\.length < 2/);
  assert.match(adminJs, /branchControlLabel = canSwitch && options\.length > 1 \? 'Working branch' : 'Current branch'/);
  assert.match(adminJs, /welcomeEl\.classList\.toggle\('branch-context-only', !overview\)/);
  assert.match(portalCss, /\.staff-page \.staff-welcome\.branch-context-only/);
  assert.match(staffAuth, /applyStaffBranchContext\(staffUserForAccess\(user, access\), requestedBranch, structure\)/);
  assert.match(adminApi, /branches,/);
  assert.match(staffUsersApi, /branches: configuredStaffBranches\(structure\)/);
  assert.match(adminJs, /availableBranches = data\.branches\.map\(\(branch\) => \(\{/);
  assert.match(adminJs, /staffModulePreferencesData = data\.modulePreferences \|\| null;[\s\S]*Array\.isArray\(data\.branches\)/);
  assert.match(adminJs, /All branches \(organisation-wide\)/);
  assert.match(adminJs, /Choose any configured branch without changing your working branch/);
  assert.match(adminJs, /canAssignStaffBranches = data\.canAssignStaffBranches === true/);
});
