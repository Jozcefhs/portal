import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  assertImmutableRecordIdentity,
  recordWritePrecondition
} from '../functions/lib/church-membership.js';

const [departmentSource, membershipSource] = await Promise.all([
  readFile(new URL('../functions/lib/organization-departments.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/lib/church-membership.js', import.meta.url), 'utf8')
]);

function between(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `Missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `Missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('record edit identity accepts the same immutable ID and rejects key changes or collisions', () => {
  assert.equal(
    assertImmutableRecordIdentity('Member ID', 'MEM-001', 'MEM-001', 'MEM-001'),
    'MEM-001'
  );
  assert.throws(
    () => assertImmutableRecordIdentity('Member ID', 'MEM-002', 'MEM-001'),
    (error) => error?.status === 409 && /Member ID cannot be changed while editing/i.test(error.message)
  );
  assert.throws(
    () => assertImmutableRecordIdentity('Department ID', 'CHOIR', '', 'Choir'),
    (error) => error?.status === 409 && /conflicts with an existing record/i.test(error.message)
  );
});

test('record edits use create and optimistic-concurrency preconditions', () => {
  assert.deepEqual(recordWritePrecondition(null), { exists: false });
  assert.deepEqual(recordWritePrecondition({ MemberId: 'MEM-001' }), { exists: true });
  assert.deepEqual(
    recordWritePrecondition({ MemberId: 'MEM-001', __updateTime: '2026-07-29T10:00:00.000Z' }),
    { updateTime: '2026-07-29T10:00:00.000Z' }
  );
});

test('member edits preserve the branch-scoped key, metadata, permissions and audit path', () => {
  const saveMember = between(
    membershipSource,
    'export async function saveChurchMember',
    'export async function importChurchMembers'
  );

  assert.match(saveMember, /requireCapability\(user, 'canEditMembers'\)/);
  assert.match(saveMember, /resolveMembershipBranch\(user, body\.BranchId \|\| body\.branchId\)/);
  assert.match(saveMember, /OriginalMemberId[\s\S]*originalMemberId/);
  assert.match(saveMember, /assertImmutableRecordIdentity\('Member ID'/);
  assert.match(saveMember, /existing && resolveMembershipBranch\(\{\}, existing\.BranchId \|\| branchId\) !== branchId/);
  assert.match(saveMember, /CreatedAt: existing\?\.CreatedAt \|\| nowIso\(\)/);
  assert.match(saveMember, /upsertDocument\(env, memberPath, id, payload, recordWritePrecondition\(existing\)\)/);
  assert.match(saveMember, /writeMembershipAudit\([\s\S]*existing \? 'UPDATE' : 'CREATE'/);
  assert.doesNotMatch(saveMember, /getDocument\(env, memberPath, id\)\.catch/);
});

test('department edits retain their immutable ID and optimistic concurrency guard', () => {
  const saveDepartment = between(
    departmentSource,
    'async function saveDepartment',
    'async function importDepartments'
  );

  assert.match(saveDepartment, /requireCapability\(user, 'canManageDepartments'\)/);
  assert.match(saveDepartment, /OriginalDepartmentId \|\| body\.originalDepartmentId/);
  assert.match(saveDepartment, /assertImmutableRecordIdentity\(\s*'Department ID'/);
  assert.match(saveDepartment, /existing && !belongsToBranch\(existing, branchId\)/);
  assert.match(saveDepartment, /CreatedAt: existing\?\.CreatedAt \|\| nowIso\(\)/);
  assert.match(saveDepartment, /recordWritePrecondition\(existing\)/);
  assert.match(saveDepartment, /existing \? 'UPDATE' : 'CREATE'/);
  assert.doesNotMatch(saveDepartment, /getDocument\(env, path\('departments', branchId\), id\)\.catch/);
});

test('position edits verify the selected branch department and preserve the composite key', () => {
  const savePosition = between(
    departmentSource,
    'async function savePosition',
    'function authoritativeMemberName'
  );

  assert.match(savePosition, /requireCapability\(user, 'canManageDepartments'\)/);
  assert.match(savePosition, /getDocument\(env, path\('departments', branchId\)/);
  assert.match(savePosition, /selected department does not exist in this branch/i);
  assert.match(savePosition, /OriginalPositionId \|\| body\.originalPositionId/);
  assert.match(savePosition, /OriginalDepartmentId \|\| body\.originalDepartmentId/);
  assert.match(savePosition, /assertImmutableRecordIdentity\(\s*'Position ID'/);
  assert.match(savePosition, /assertImmutableRecordIdentity\(\s*'Position department'/);
  assert.match(savePosition, /recordWritePrecondition\(existing\)/);
  assert.match(savePosition, /existing \? 'UPDATE' : 'CREATE'/);
});
