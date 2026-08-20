import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  hashStudentPassword,
  publicStudentLoginStatus,
  studentLoginCredentialCollection,
  studentLoginCredentialId,
  verifyStudentPasswordHash
} from '../functions/lib/student-login-credentials.js';
const portalRoot = new URL('../', import.meta.url);

test('student passwords use scoped PBKDF2 verifiers and never share the parent credential collection', async () => {
  const credential = await hashStudentPassword('StudentPass1!');
  assert.equal(credential.PasswordHashVersion, 'pbkdf2-sha256-v1');
  assert.equal(credential.PasswordIterations, 10000);
  assert.equal(credential.PasswordHash.length, 64);
  assert.equal(await verifyStudentPasswordHash(credential, 'StudentPass1!'), true);
  assert.equal(await verifyStudentPasswordHash(credential, 'wrong-password'), false);
  assert.equal(
    studentLoginCredentialCollection({ BranchId: 'Main', SchoolSection: 'Secondary' }),
    'schoolBranches/main/sections/secondary/studentLoginCredentials'
  );
  assert.match(await studentLoginCredentialId('DCA/21/0001'), /^student-login-[a-f0-9]{64}$/);
  assert.deepEqual(publicStudentLoginStatus(credential), {
    PasswordConfigured: true,
    PasswordChangedAt: ''
  });
});

test('student password policy rejects unsafe values', async () => {
  const minimum = await hashStudentPassword('123456');
  assert.equal(await verifyStudentPasswordHash(minimum, '123456'), true);
  await assert.rejects(() => hashStudentPassword('12345'), /at least 6/);
  await assert.rejects(() => hashStudentPassword(' StudentPass1!'), /begin or end/);
});

test('desktop CBT uses a reusable encrypted local login registry with no online preparation call', async () => {
  const [localCbt, academics, students] = await Promise.all([
    readFile(new URL('../suite/modules/local_cbt.py', portalRoot), 'utf8'),
    readFile(new URL('../suite/modules/academic_management.py', portalRoot), 'utf8'),
    readFile(new URL('../suite/modules/students.py', portalRoot), 'utf8')
  ]);
  assert.match(localCbt, /cbt_student_identity_registry/);
  assert.match(localCbt, /save_local_student_password/);
  assert.match(localCbt, /examination delivery, answer submission and marking never depend on[\s\S]*an Internet service/);
  assert.doesNotMatch(localCbt, /Sync Web Tests/);
  assert.doesNotMatch(academics, /prepareLocalCbtIdentityPackage/);
  assert.match(students, /save_local_student_password/);
});

test('student editors save passwords securely while the CBT portal remains local-only', async () => {
  const [admin, staffStudents, backend, academics] = await Promise.all([
    readFile(new URL('js/admin.js', portalRoot), 'utf8'),
    readFile(new URL('functions/api/staff-students.js', portalRoot), 'utf8'),
    readFile(new URL('functions/api/backend.js', portalRoot), 'utf8'),
    readFile(new URL('functions/lib/academic-management.js', portalRoot), 'utf8')
  ]);
  assert.match(admin, /Student own login/);
  assert.match(admin, /StudentLoginPasswordConfirm/);
  assert.match(admin, /minlength="6" maxlength="128"/);
  assert.match(admin, /password of at least 6 characters for CBT/);
  assert.match(staffStudents, /saveStudentLoginPassword/);
  assert.match(admin, /data-academic-local-cbt-only/);
  assert.match(academics, /ACADEMIC_CBT_LOCAL_ONLY/);
  assert.match(academics, /No online examination records were read/);
  assert.match(academics, /syncAcademicCbtScores/);
  assert.doesNotMatch(staffStudents, /student\.PasswordHash/);
});
