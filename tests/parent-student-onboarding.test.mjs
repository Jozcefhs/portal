import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [backend, api, html, script] = await Promise.all([
  readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/api/parent-dashboard.js', import.meta.url), 'utf8'),
  readFile(new URL('../parent-dashboard.html', import.meta.url), 'utf8'),
  readFile(new URL('../js/parent-dashboard.js', import.meta.url), 'utf8')
]);

test('minimal student import requires the four school-owned identity fields', () => {
  const importer = backend.slice(backend.indexOf('async function importStudents'), backend.indexOf('async function promoteStudents'));
  assert.match(importer, /missing student name/);
  assert.match(importer, /missing admission number/);
  assert.match(importer, /missing gender/);
  assert.match(importer, /missing class/);
  assert.match(importer, /ParentOnboardingTokenHash: onboardingTokenHash/);
  assert.match(importer, /ParentOnboardingStatus: 'PendingProfile'/);
  assert.match(importer, /TemporaryPassword: '12345678'/);

  const persistedStudent = importer.slice(importer.indexOf('const student = {'), importer.indexOf('const saved ='));
  assert.doesNotMatch(persistedStudent, /TemporaryPassword|ParentOnboardingToken:/);
  assert.match(persistedStudent, /ParentLoginCode: ''/);
  assert.match(persistedStudent, /VerificationCode: ''/);
});

test('parent completion link is single-use and dashboard access waits for a private password', () => {
  assert.match(api, /ParentOnboardingTokenHash: ''/);
  assert.match(api, /ParentOnboardingStatus: existingCredential \? 'Complete' : 'AwaitingPassword'/);
  assert.match(api, /passwordChangeRequired: true/);
  assert.match(api, /completeParentPasswordSetup/);
  assert.match(api, /parentSessionCookie\(await createParentSession\(env, data\.parentEmail\)\)/);
  assert.match(html, /Complete an imported student profile/);
  assert.match(html, /id="onboardingAdmissionNo"/);
  assert.match(html, /id="onboardingParentEmail"/);
  assert.match(html, /id="requiredNewParentPassword"/);
  assert.match(script, /window\.location\.hash/);
  assert.match(script, /window\.history\.replaceState/);
  assert.doesNotMatch(script, /(?:localStorage|sessionStorage)\.setItem\([^\n]*(?:onboard|passwordSetupToken|temporaryPassword)/i);
});
