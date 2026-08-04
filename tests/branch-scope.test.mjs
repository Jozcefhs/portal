import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  actorBranchScope,
  branchRecordVisible,
  enforceActorBranch,
  recordBranchId,
  resolveRequestedBranch
} from '../functions/lib/branch-scope.js';

test('an assigned branch remains mandatory for every role including Super Admin', () => {
  const superAdmin = { role: 'Super Admin', branchId: 'West' };
  assert.equal(actorBranchScope(superAdmin), 'west');
  assert.equal(branchRecordVisible({ BranchId: 'west' }, superAdmin), true);
  assert.equal(branchRecordVisible({ BranchId: 'main' }, superAdmin), false);
  assert.equal(branchRecordVisible({}, superAdmin), false);
  assert.equal(resolveRequestedBranch(superAdmin, 'all', { allowAll: true }), 'west');
  assert.throws(
    () => resolveRequestedBranch(superAdmin, 'east', { allowAll: true }),
    /restricted to another branch/
  );
});

test('an unassigned organisation administrator may retain organisation-wide access', () => {
  const centralAdmin = { role: 'Super Admin', branchId: '' };
  assert.equal(branchRecordVisible({ BranchId: 'west' }, centralAdmin), true);
  assert.equal(branchRecordVisible({ BranchId: 'main' }, centralAdmin), true);
  assert.equal(resolveRequestedBranch(centralAdmin, '', { allowAll: true }), 'all');
});

test('legacy records are main-branch records and cannot be claimed by another branch', () => {
  assert.equal(recordBranchId({}), 'main');
  assert.equal(branchRecordVisible({}, { branchId: 'main' }), true);
  assert.equal(branchRecordVisible({}, { branchId: 'west' }), false);
  assert.throws(
    () => enforceActorBranch({ branchId: 'west' }, '', 'main'),
    /belongs to another branch/
  );
  assert.equal(enforceActorBranch({ branchId: 'west' }, '', '', 'main'), 'west');
});

test('branch isolation is wired into staff permissions, income analytics and HR', async () => {
  const [staffUsers, incomeAnalytics, humanResources] = await Promise.all([
    readFile(new URL('../functions/api/staff-users.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/income-analytics.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/staff-hr.js', import.meta.url), 'utf8')
  ]);
  assert.match(staffUsers, /staffRecordMatchesEdition\(row, actor\) && branchRecordVisible\(row, actor\)/);
  assert.match(staffUsers, /listSecurityAudit\(env, actor\)/);
  assert.match(incomeAnalytics, /resolveRequestedBranch\(user, body\.branchId/);
  assert.match(incomeAnalytics, /assignedBranch\s*\?\s*\[assignedBranch\]/);
  assert.match(humanResources, /visibleHrRows\(staffUsers|editionStaff\.filter\(\(row\) => branchRecordVisible\(row, user\)\)/);
  assert.match(humanResources, /BranchId: branchId/);
});
