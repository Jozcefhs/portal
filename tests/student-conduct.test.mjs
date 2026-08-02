import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  normalizeStudentConductCase,
  studentConductCaseIsClosed,
  STUDENT_CONDUCT_CATEGORIES,
  STUDENT_CONDUCT_STATUSES
} from '../functions/lib/student-conduct.js';
import { featureFlagsForEdition, filterSectionsForFeatures } from '../functions/lib/organization-config.js';
import { allowedSectionsFor } from '../functions/lib/staff-auth.js';

const portalRoot = new URL('../', import.meta.url);
const [conductSource, apiSource, backendSource, adminSource, cssSource] = await Promise.all([
  readFile(new URL('functions/lib/student-conduct.js', portalRoot), 'utf8'),
  readFile(new URL('functions/api/staff-conduct.js', portalRoot), 'utf8'),
  readFile(new URL('functions/api/backend.js', portalRoot), 'utf8'),
  readFile(new URL('js/admin.js', portalRoot), 'utf8'),
  readFile(new URL('css/style.css', portalRoot), 'utf8')
]);

test('student conduct is a school-only feature with standard committee access', () => {
  assert.equal(featureFlagsForEdition('school').studentConduct, true);
  assert.equal(featureFlagsForEdition('faith').studentConduct, false);
  assert.deepEqual(filterSectionsForFeatures(['students', 'studentConduct'], featureFlagsForEdition('faith')), []);
  assert.equal(allowedSectionsFor({ role: 'Principal' }, featureFlagsForEdition('school')).includes('studentConduct'), true);
  assert.equal(allowedSectionsFor({ role: 'Student Welfare Officer' }, featureFlagsForEdition('school')).includes('studentConduct'), true);
  assert.equal(allowedSectionsFor({ role: 'Senior Pastor' }, featureFlagsForEdition('faith')).includes('studentConduct'), false);
});

test('conduct cases normalize the committee record and validate controlled fields', () => {
  const row = normalizeStudentConductCase({
    IncidentDate: '2026-07-28',
    Category: STUDENT_CONDUCT_CATEGORIES[0],
    Severity: 'High',
    Summary: 'Examination misconduct',
    Status: STUDENT_CONDUCT_STATUSES[1],
    ParentNotified: 'yes'
  }, {
    AdmissionNo: 'DCA/26/001',
    DisplayName: 'Ada Grace',
    ClassName: 'JSS 1',
    BranchId: 'main',
    SchoolSection: 'secondary'
  });
  assert.match(row.CaseId, /^SCDC-/);
  assert.equal(row.StudentRef, 'DCA/26/001');
  assert.equal(row.StudentName, 'Ada Grace');
  assert.equal(row.ParentNotified, true);
  assert.throws(() => normalizeStudentConductCase({
    IncidentDate: 'bad', Category: 'Unknown', Summary: 'Case'
  }, { AdmissionNo: 'DCA/26/001' }), /incident date/i);
});

test('closed conduct cases are read-only in the register and rejected by every save path', () => {
  assert.equal(studentConductCaseIsClosed('Closed'), true);
  assert.equal(studentConductCaseIsClosed({ Status: 'closed' }), true);
  assert.equal(studentConductCaseIsClosed({ Status: 'Resolved' }), false);
  assert.match(conductSource, /studentConductCaseIsClosed\(existing\)/);
  assert.match(conductSource, /This conduct case is closed and cannot be edited\./);
  assert.match(conductSource, /existing \? \{ updateTime: clean\(existing\.__updateTime\) \} : \{ exists: false \}/);
  assert.match(backendSource, /handleStudentConductAction/);
  assert.match(adminSource, /lower\(row\.Status\) === 'closed'/);
  assert.match(adminSource, /data-view-conduct/);
  assert.match(adminSource, /Closed case · View only/);
  assert.match(adminSource, /This case is closed and read-only/);
});

test('conduct APIs require authenticated, scoped school staff and support desktop parity', () => {
  assert.match(apiSource, /requireStaffSession\(env, request\)/);
  assert.match(apiSource, /handleStudentConductAction\(env, user, body\)/);
  assert.match(backendSource, /getStudentConductCases/);
  assert.match(backendSource, /saveStudentConductCase/);
  assert.match(backendSource, /deleteStudentConductCase/);
  assert.match(adminSource, /Student Conduct & Discipline/);
  assert.match(cssSource, /\.student-conduct-layout/);
});

test('conduct incident composer can search students by name, admission number, or class', () => {
  assert.match(adminSource, /id="studentConductStudentSearch"/);
  assert.match(adminSource, /id="studentConductStudentSearchButton">Search/);
  assert.match(adminSource, /Name, admission no\. or class/);
  assert.match(adminSource, /searchText: lower\(\[row\.StudentName, row\.StudentRef, row\.ClassName\]/);
  assert.match(adminSource, /No matching student/);
  assert.match(adminSource, /chooseSingle && query && matching\.length === 1/);
  assert.match(adminSource, /searchButton\.addEventListener\('click', runSearch\)/);
  assert.match(adminSource, /event\.key === 'Enter'/);
  assert.match(cssSource, /\.student-conduct-student-search/);
  assert.match(cssSource, /\.student-conduct-student-search-controls/);
  assert.match(cssSource, /html\[data-theme="dark"\] \.student-conduct-student-search input/);
});
