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
import { encryptLocalCbtIdentityPackage } from '../functions/lib/academic-management.js';

const portalRoot = new URL('../', import.meta.url);

test('student passwords use scoped PBKDF2 verifiers and never share the parent credential collection', async () => {
  const credential = await hashStudentPassword('StudentPass1!');
  assert.equal(credential.PasswordHashVersion, 'pbkdf2-sha256-v1');
  assert.equal(credential.PasswordIterations, 120000);
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
  await assert.rejects(() => hashStudentPassword('short'), /at least 8/);
  await assert.rejects(() => hashStudentPassword(' StudentPass1!'), /begin or end/);
});

test('offline identity payload is hybrid-encrypted to the requesting desktop public key', async () => {
  const keys = await crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['encrypt', 'decrypt']
  );
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', keys.publicKey));
  const pemBody = Buffer.from(spki).toString('base64').match(/.{1,64}/g).join('\n');
  const envelope = await encryptLocalCbtIdentityPackage(
    `-----BEGIN PUBLIC KEY-----\n${pemBody}\n-----END PUBLIC KEY-----`,
    { Identities: [{ StudentRef: 'DCA/21/0001', Password: { PasswordHash: 'secret-verifier' } }] },
    'dynamax-local-cbt-identity-v1|workspace|main|secondary'
  );
  const decode = (value) => Buffer.from(String(value).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const aesKey = await crypto.subtle.decrypt(
    { name: 'RSA-OAEP' }, keys.privateKey, decode(envelope.WrappedKey)
  );
  const imported = await crypto.subtle.importKey('raw', aesKey, 'AES-GCM', false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt({
    name: 'AES-GCM',
    iv: decode(envelope.Nonce),
    additionalData: new TextEncoder().encode(envelope.Aad)
  }, imported, decode(envelope.Ciphertext));
  const payload = JSON.parse(new TextDecoder().decode(plaintext));
  assert.equal(payload.Identities[0].StudentRef, 'DCA/21/0001');
  assert.equal(payload.Identities[0].Password.PasswordHash, 'secret-verifier');
  assert.doesNotMatch(JSON.stringify(envelope), /secret-verifier/);
});

test('student editors and CBT package endpoint expose the new login without leaking credentials', async () => {
  const [admin, staffStudents, backend, academics] = await Promise.all([
    readFile(new URL('js/admin.js', portalRoot), 'utf8'),
    readFile(new URL('functions/api/staff-students.js', portalRoot), 'utf8'),
    readFile(new URL('functions/api/backend.js', portalRoot), 'utf8'),
    readFile(new URL('functions/lib/academic-management.js', portalRoot), 'utf8')
  ]);
  assert.match(admin, /Student own login/);
  assert.match(admin, /StudentLoginPasswordConfirm/);
  assert.match(staffStudents, /saveStudentLoginPassword/);
  assert.match(backend, /prepareLocalCbtIdentityPackage/);
  assert.match(academics, /encryptLocalCbtIdentityPackage/);
  assert.match(academics, /canCreateCbt/);
  assert.match(academics, /academicScoreSheetContext\(env, user, input, 'canCreateCbt'\)/);
  assert.match(academics, /ACADEMIC_CBT_COMPONENT_REQUIRED/);
  assert.match(academics, /ACADEMIC_CBT_ROSTER_FORBIDDEN/);
  assert.doesNotMatch(staffStudents, /student\.PasswordHash/);
});
