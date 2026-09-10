import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const backendSource = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');

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
  assert.match(reissue, /findStudentByAccountRef\(env, accountRef, requestedStudentScope\(body\)\)/);
});
