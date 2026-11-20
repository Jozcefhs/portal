import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { enforceDesktopDeviceActionScope } from '../functions/api/backend.js';

const backendSource = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');

test('branch-paired accounts can change a billing category only through a role-gated scoped student lookup', () => {
  const body = { BranchId: 'area-1-primary', AccountRef: 'DCAP1/26/0277', BillingCategory: 'Full Scholarship' };
  assert.deepEqual(enforceDesktopDeviceActionScope({ type: 'device', branchId: 'area-1-primary' }, 'updateStudentBillingCategory', body), body);
  const handler = backendSource.slice(backendSource.indexOf('async function updateStudentBillingCategory('), backendSource.indexOf('async function updateStudentStatus('));
  assert.match(handler, /requireAccountingRole\(body, \['Super Admin', 'Accounts Officer'\]\)/);
  assert.match(handler, /findStudentByAccountRef\(env, accountRef, requestedStudentScope\(body\)\)/);
  assert.doesNotMatch(handler, /findStudentByAccountRef\(env, accountRef\)/);
});

test('desktop student requests derive a branch and school-section scope', () => {
  const helper = backendSource.slice(
    backendSource.indexOf('function requestedStudentScope'),
    backendSource.indexOf('async function updateStudentProfile')
  );

  assert.match(helper, /body\.UserBranchId \|\| body\.BranchId \|\| body\.branchId/);
  assert.match(helper, /body\.UserSchoolSectionAccess/);
  assert.match(helper, /body\.SchoolSectionAccess/);
});

test('desktop student reads and mutations stay inside the requested branch', () => {
  const getStudents = backendSource.slice(
    backendSource.indexOf("case 'getStudents':"),
    backendSource.indexOf("case 'getStudentConductCases':")
  );
  const updateProfile = backendSource.slice(
    backendSource.indexOf('async function updateStudentProfile'),
    backendSource.indexOf('function normalizeApplication')
  );
  const reissue = backendSource.slice(
    backendSource.indexOf('async function reissueParentOnboarding'),
    backendSource.indexOf('async function promoteStudents')
  );

  assert.match(getStudents, /listSchoolCollection\(env, 'students', requestedStudentScope\(body\)\)/);
  assert.match(updateProfile, /findStudentByAccountRef\(env, accountRef, requestedStudentScope\(body\)\)/);
  assert.match(reissue, /issueStaffParentOnboarding\(env/);
  assert.match(reissue, /desktopSchoolOperationsActor\(env, body, 'students', true\)/);
  assert.match(reissue, /schoolOperationsScope\(body\)/);
  assert.doesNotMatch(reissue, /findStudentByAccountRef/);
});
