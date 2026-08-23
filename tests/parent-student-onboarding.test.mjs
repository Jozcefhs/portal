import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [backend, api, html, script, staffStudents, admin] = await Promise.all([
  readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/api/parent-dashboard.js', import.meta.url), 'utf8'),
  readFile(new URL('../parent-dashboard.html', import.meta.url), 'utf8'),
  readFile(new URL('../js/parent-dashboard.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/api/staff-students.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/admin.js', import.meta.url), 'utf8')
]);

test('minimal student import keeps separate names and applies the configured display-name format', () => {
  const importer = backend.slice(backend.indexOf('async function importStudents'), backend.indexOf('async function promoteStudents'));
  assert.match(importer, /FirstName/);
  assert.match(importer, /MiddleName/);
  assert.match(importer, /Surname/);
  assert.match(importer, /missing first name or surname/);
  assert.match(importer, /missing admission number/);
  assert.match(importer, /missing gender/);
  assert.match(importer, /missing class/);
  assert.match(importer, /formatPersonName\([^;]+schoolProfile/);
  assert.match(importer, /ParentOnboardingTokenHash: ''/);
  assert.match(importer, /ParentOnboardingStatus: 'PendingProfile'/);
  assert.match(importer, /TemporaryPassword: '12345678'/);
  assert.match(importer, /ParentOnboardingPath: '\/parent-dashboard\.html#onboarding=1'/);

  const persistedStudent = importer.slice(importer.indexOf('const student = {'), importer.indexOf('const saved ='));
  assert.doesNotMatch(persistedStudent, /TemporaryPassword|ParentOnboardingToken:/);
  assert.match(persistedStudent, /ParentLoginCode: ''/);
  assert.match(persistedStudent, /VerificationCode: ''/);
});

test('generic parent completion link is single-use and dashboard access waits for a private password', () => {
  const verifier = api.slice(api.indexOf('async function requireParentOnboardingStudent'), api.indexOf('function publicOnboardingStudent'));
  assert.doesNotMatch(verifier, /onboardingToken|ParentOnboardingToken/);
  assert.match(verifier, /admissionNo/);
  assert.match(verifier, /PARENT_ONBOARDING_TEMPORARY_PASSWORD/);
  assert.match(api, /ParentOnboardingTokenHash: ''/);
  assert.match(api, /ParentOnboardingStatus: existingCredential \? 'Complete' : 'AwaitingPassword'/);
  assert.match(api, /passwordChangeRequired: true/);
  assert.match(api, /completeParentPasswordSetup/);
  assert.match(api, /parentSessionCookie\(await createParentSession\(env, data\.parentEmail\)\)/);
  assert.match(html, /Complete an imported student profile/);
  assert.match(html, /id="onboardingAdmissionNo"/);
  assert.match(html, /id="onboardingParentEmail"/);
  assert.match(html, /for="onboardingStudentNin">Student's NIN/);
  assert.match(html, /id="onboardingStudentNin"[^>]+pattern="\[0-9\]\{11\}"/);
  assert.doesNotMatch(html, /id="onboardingPreviousSchool"/);
  assert.match(html, /id="requiredNewParentPassword"/);
  assert.match(script, /onboardingHash\.has\('onboarding'\)/);
  assert.match(script, /onboardingStudentNin: student\.studentNin/);
  assert.match(script, /studentNin: document\.getElementById\('onboardingStudentNin'\)\.value/);
  assert.match(api, /studentNin: clean\(student\.NIN\)/);
  assert.match(api, /NIN: clean\(profile\.studentNin \|\| profile\.NIN\)/);
  assert.match(api, /values\.NIN && !\/\^\\d\{11\}\$\//);
  assert.doesNotMatch(api.slice(api.indexOf('function publicOnboardingStudent'), api.indexOf('async function assertParentOnboardingAllowance')), /previousSchool|PreviousSchool/);
  assert.match(script, /window\.history\.replaceState/);
  assert.doesNotMatch(script, /(?:localStorage|sessionStorage)\.setItem\([^\n]*(?:onboard|passwordSetupToken|temporaryPassword)/i);
});

test('staff can reissue onboarding for any existing student and copy the shared link', () => {
  assert.match(staffStudents, /reissueparentonboarding/);
  assert.match(staffStudents, /ParentOnboardingStatus: 'PendingProfile'/);
  assert.match(staffStudents, /onboardingPath: '\/parent-dashboard\.html#onboarding=1'/);
  assert.match(admin, /data-parent-onboarding-student/);
  assert.match(admin, /copyTextToClipboard\(onboardingUrl\)/);
});
