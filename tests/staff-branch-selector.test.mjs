import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  applyStaffBranchContext,
  configuredStaffBranches
} from '../functions/lib/staff-branch-context.js';

const adminHtml = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const adminJs = fs.readFileSync(new URL('../js/admin.js', import.meta.url), 'utf8');
const adminApi = fs.readFileSync(new URL('../functions/api/admin.js', import.meta.url), 'utf8');
const staffAuth = fs.readFileSync(new URL('../functions/lib/staff-auth.js', import.meta.url), 'utf8');

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

test('the web companion sends and renders the server-enforced session branch', () => {
  assert.match(adminHtml, /id="staffBranchSelector"/);
  assert.match(adminJs, /headers\.set\('X-Dynamax-Branch', selectedBranchId \|\| 'all'\)/);
  assert.match(adminJs, /function clearBranchScopedWorkspaceData\(\)/);
  assert.match(adminJs, /async function switchStaffBranch\(nextBranchId\)/);
  assert.match(staffAuth, /applyStaffBranchContext\(staffUserForAccess\(user, access\), requestedBranch, structure\)/);
  assert.match(adminApi, /branches,/);
});
