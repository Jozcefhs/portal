import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  applicationMatchesChild,
  findParentOwnedApplication,
  findScopedChildApplication
} from '../functions/api/parent-dashboard.js';

const [parentDashboardSource, backendSource] = await Promise.all([
  readFile(new URL('../functions/api/parent-dashboard.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8')
]);

test('an explicit identity scope fails closed instead of falling back globally', () => {
  assert.match(
    parentDashboardSource,
    /const requestedScopePath = clean\(scopePath\);[\s\S]*?if \(requestedScopePath && !path\) return null;[\s\S]*?const paths = path \? \[path\] : await getCollectionPaths/
  );
  assert.match(
    parentDashboardSource,
    /return matches\.size === 1 \? \[\.\.\.matches\.values\(\)\]\[0\] : null/
  );
  assert.match(
    backendSource,
    /const requestedScopePath = clean\(scopePath\);[\s\S]*?if \(requestedScopePath && !path\) return null;[\s\S]*?if \(path\) \{[\s\S]*?return null;[\s\S]*?\}[\s\S]*?return getSchoolDocumentById/
  );
});

test('parent sibling fallback selects one record only inside the requested scope', () => {
  assert.match(
    parentDashboardSource,
    /const requestedScopePath = validatedIdentityScopePath\(requestedScopeValue, collection\)/
  );
  assert.match(
    parentDashboardSource,
    /lower\(row\.__scopePath\) === lower\(requestedScopePath\)/
  );
  assert.match(parentDashboardSource, /child = scopedStudents\.length === 1 \? scopedStudents\[0\] : null/);
  assert.match(
    parentDashboardSource,
    /child = scopedApplications\.length === 1 \? scopedApplications\[0\] : null/
  );
});

test('payable sibling selection binds students and applications to paired scopes', () => {
  assert.match(backendSource, /const requestedStudentScopePath = identityScopePathForCollection/);
  assert.match(backendSource, /const requestedApplicationScopePath = identityScopePathForCollection/);
  assert.match(
    backendSource,
    /rowsInScope\(students, requestedStudentScopePath\)/
  );
  assert.match(
    backendSource,
    /rowsInScope\(applications, requestedApplicationScopePath\)/
  );
  assert.match(backendSource, /let app = requestedAccountRef \? null : loginApp/);
  assert.match(backendSource, /app = linkedApplication \|\| selectedApplication \|\| null/);
});

test('linked application and student lookups preserve the selected child scope', () => {
  assert.match(
    parentDashboardSource,
    /identityScopePathForCollection\(child, 'applications'\)/
  );
  assert.match(
    backendSource,
    /identityScopePathForCollection\(student, 'applications'\)/
  );
  assert.match(
    backendSource,
    /const studentScopePath = identityScopePathForCollection\(app, 'students'\)/
  );
  assert.doesNotMatch(
    backendSource,
    /getSelectedIdentityRow\(env, 'applications', student\.ApplicationReference\);/
  );
});

test('a duplicate application reference in another branch cannot supply the selected child result or photo', () => {
  const child = {
    AccountRef: 'DCA/26/001',
    AdmissionNo: 'DCA/26/001',
    ApplicationReference: 'DCA/26/000001',
    ParentEmail: 'parent@example.com',
    DisplayName: 'Ada Grace',
    __scopePath: 'schoolBranches/west/sections/primary/students'
  };
  const wrongBranch = {
    ApplicationReference: 'DCA/26/000001',
    AdmissionNo: 'DCA/26/001',
    VerificationEmail: 'parent@example.com',
    ApplicantName: 'Ada Grace',
    ResultPercentage: 99,
    PassportPhotographUrl: 'https://example.test/wrong.jpg',
    __scopePath: 'schoolBranches/main/sections/primary/applications'
  };
  const correctBranch = {
    ApplicationReference: 'DCA/26/000001',
    AdmissionNo: 'DCA/26/001',
    VerificationEmail: 'parent@example.com',
    ApplicantName: 'Ada Grace',
    ResultPercentage: 81,
    PassportPhotographUrl: 'https://example.test/correct.jpg',
    __scopePath: 'schoolBranches/west/sections/primary/applications'
  };

  assert.equal(applicationMatchesChild(wrongBranch, child), false);
  assert.equal(applicationMatchesChild(correctBranch, child), true);
  assert.equal(findScopedChildApplication([wrongBranch, correctBranch], child), correctBranch);
});

test('a duplicate application reference in another school section cannot suppress the correct scoped application', () => {
  const child = {
    AccountRef: 'DCA/26/002',
    ApplicationReference: 'DCA/26/000002',
    ParentEmail: 'parent@example.com',
    DisplayName: 'Peter Hope',
    __scopePath: 'schoolBranches/main/sections/secondary/students'
  };
  const primaryApplication = {
    ApplicationReference: 'DCA/26/000002',
    VerificationEmail: 'parent@example.com',
    ApplicantName: 'Peter Hope',
    __scopePath: 'schoolBranches/main/sections/primary/applications'
  };
  const secondaryApplication = {
    ApplicationReference: 'DCA/26/000002',
    VerificationEmail: 'parent@example.com',
    ApplicantName: 'Peter Hope',
    __scopePath: 'schoolBranches/main/sections/secondary/applications'
  };

  assert.equal(applicationMatchesChild(primaryApplication, child), false);
  assert.equal(applicationMatchesChild(secondaryApplication, child), true);
  assert.equal(findScopedChildApplication([primaryApplication, secondaryApplication], child), secondaryApplication);
});

test('parent-owned duplicate references require a selected application scope', () => {
  const applications = [{
    ApplicationReference: 'DCA/26/000003',
    VerificationEmail: 'parent@example.com',
    __scopePath: 'schoolBranches/main/sections/secondary/applications'
  }, {
    ApplicationReference: 'DCA/26/000003',
    VerificationEmail: 'parent@example.com',
    __scopePath: 'schoolBranches/west/sections/secondary/applications'
  }];

  assert.equal(
    findParentOwnedApplication(applications, 'DCA/26/000003', 'parent@example.com'),
    null
  );
  assert.equal(
    findParentOwnedApplication(
      applications,
      'DCA/26/000003',
      'parent@example.com',
      'schoolBranches/west/sections/secondary/students'
    ),
    applications[1]
  );
  assert.equal(
    findParentOwnedApplication(
      applications,
      'DCA/26/000003',
      'parent@example.com',
      'schoolBranches/west/sections/secondary/not-applications'
    ),
    null
  );
});

test('student admission-number application fallback is explicitly bound to the student scope', () => {
  assert.match(
    parentDashboardSource,
    /querySchoolCollection\(env, 'applications', \{[\s\S]*?scopePath: applicationScope,[\s\S]*?limit: 1/
  );
  assert.doesNotMatch(parentDashboardSource, /const linkedApplication = parentApplications\.find/);
  assert.match(
    parentDashboardSource,
    /const linkedApplication = findScopedChildApplication\(parentApplications, child\)/
  );
  assert.match(
    parentDashboardSource,
    /const resultSource = findScopedChildApplication\(applications, child\)/
  );
});
