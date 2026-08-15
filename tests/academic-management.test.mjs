import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  applyAcademicStudentCurriculum,
  assertAcademicMembershipCapacity,
  academicManagementCapabilities,
  normalizeAcademicArm,
  normalizeAcademicClass,
  normalizeAcademicDepartment,
  normalizeAcademicOffering,
  normalizeAcademicSession,
  normalizeAcademicStudentMembership,
  normalizeAcademicStudentMovement,
  normalizeAcademicSubject,
  normalizeAcademicTeacherAllocation,
  normalizeAcademicTerm
} from '../functions/lib/academic-management.js';
import { staffRoleAllowedForEdition } from '../functions/lib/organization-config.js';
import { defaultModulesForRole, modulesForEdition } from '../functions/lib/role-module-access.js';

const [librarySource, apiSource, backendSource, backupSource, adminSource, styleSource, adminHtml] = await Promise.all([
  readFile(new URL('../functions/lib/academic-management.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/api/staff-academics.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/lib/organization-backup.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/admin.js', import.meta.url), 'utf8'),
  readFile(new URL('../css/style.css', import.meta.url), 'utf8'),
  readFile(new URL('../admin.html', import.meta.url), 'utf8')
]);

const scope = { branchId: 'north-campus', section: 'secondary' };

test('AM-003 sessions and terms are effective-dated and date validated', () => {
  const session = normalizeAcademicSession({
    Name: '2026/2027', StartDate: '2026-09-01', EndDate: '2027-07-31', Status: 'Active'
  }, scope);
  const term = normalizeAcademicTerm({
    SessionId: session.SessionId, Name: 'First Term', StartDate: '2026-09-01', EndDate: '2026-12-18'
  }, scope);

  assert.equal(session.SessionId, 'session__north-campus__2026-2027');
  assert.equal(term.TermId, `${session.SessionId}__term__first-term`);
  assert.equal(session.BranchId, 'north-campus');
  assert.throws(() => normalizeAcademicSession({
    Name: 'Invalid', StartDate: '2027-01-01', EndDate: '2026-01-01'
  }, scope), /end date cannot be before/);
});

test('AM-003 classes and arms retain branch and school-section isolation', () => {
  const schoolClass = normalizeAcademicClass({ Name: 'JSS 1', Code: 'JSS1', Capacity: 90 }, scope);
  const arm = normalizeAcademicArm({ ClassId: schoolClass.ClassId, Name: 'Excellence', Capacity: 30 }, scope);
  const otherBranch = normalizeAcademicClass({ Name: 'JSS 1', Code: 'JSS1' }, { branchId: 'south', section: 'secondary' });
  const otherSection = normalizeAcademicClass({ Name: 'JSS 1', Code: 'JSS1' }, { branchId: 'north-campus', section: 'primary' });

  assert.equal(schoolClass.ClassId, 'class__north-campus__secondary__jss-1');
  assert.equal(arm.ArmId, `${schoolClass.ClassId}__arm__excellence`);
  assert.notEqual(schoolClass.ClassId, otherBranch.ClassId);
  assert.notEqual(schoolClass.ClassId, otherSection.ClassId);
  assert.equal(schoolClass.LegacyDocumentId, 'JSS_1');
  assert.equal(schoolClass.SchoolStage, 'junior-secondary');
  assert.equal(normalizeAcademicClass({ Name: 'SS 2', Code: 'SS2', SchoolStage: 'senior-secondary' }, scope).SchoolStage, 'senior-secondary');
  assert.throws(() => normalizeAcademicClass({ Name: 'Year 10', Code: 'Y10' }, scope), /Junior Secondary or Senior Secondary/);
});

test('AM-002 senior departments own reusable core-subject sets', () => {
  const department = normalizeAcademicDepartment({
    Name: 'Sciences', Code: 'sci', CoreSubjectIds: ['math', 'physics', 'math']
  }, scope);

  assert.equal(department.DepartmentId, 'department__north-campus__senior-secondary__sci');
  assert.equal(department.SchoolStage, 'senior-secondary');
  assert.deepEqual(department.CoreSubjectIds, ['math', 'physics']);
  assert.throws(() => normalizeAcademicDepartment({ Name: 'Sciences', Code: 'SCI' }, { branchId: 'north-campus', section: 'primary' }), /only in Secondary/);
});

test('AM-002 subjects, offerings and teacher allocations retain period scope', () => {
  const subject = normalizeAcademicSubject({ Name: 'Mathematics', Code: 'MATH' }, scope);
  const offering = normalizeAcademicOffering({
    SessionId: 'session-1', TermId: 'term-1', ClassId: 'class-1', ArmId: 'arm-a',
    SubjectId: subject.SubjectId, Compulsory: true
  }, scope);
  const allocation = normalizeAcademicTeacherAllocation({
    SessionId: 'session-1', TermId: 'term-1', TeacherUsername: 'Ada.Teacher',
    ClassId: 'class-1', ArmId: 'arm-a', SubjectId: subject.SubjectId,
    AllocationRole: 'Subject Teacher'
  }, scope);

  assert.equal(subject.Code, 'MATH');
  assert.equal(offering.Compulsory, true);
  assert.match(offering.OfferingId, /session-1__term-1__class-1__arm-a/);
  assert.match(allocation.AllocationId, /ada\.teacher/);
  assert.equal(allocation.TeacherUsername, 'ada.teacher');
});

test('AM-002 one staff member can combine form, assistant and subject responsibilities', () => {
  const common = { SessionId: 'session-1', TermId: 'term-1', TeacherUsername: 'Ada.Teacher' };
  const assignments = [
    normalizeAcademicTeacherAllocation({ ...common, ClassId: 'jss-1', ArmId: 'arm-a', AllocationRole: 'Form Teacher' }, scope),
    normalizeAcademicTeacherAllocation({ ...common, ClassId: 'jss-2', ArmId: 'arm-b', AllocationRole: 'Assistant Teacher' }, scope),
    normalizeAcademicTeacherAllocation({ ...common, ClassId: 'jss-3', ArmId: 'arm-a', SubjectId: 'math', AllocationRole: 'Subject Teacher' }, scope),
    normalizeAcademicTeacherAllocation({ ...common, ClassId: 'sss-2', ArmId: 'arm-b', SubjectId: 'physics', AllocationRole: 'Subject Teacher' }, scope)
  ];

  assert.equal(new Set(assignments.map((row) => row.AllocationId)).size, 4);
  assert.ok(assignments.every((row) => row.TeacherUsername === 'ada.teacher'));
  assert.equal(assignments[0].SubjectId, '');
  assert.equal(assignments[1].SubjectId, '');
  assert.equal(assignments[2].SubjectId, 'math');
  assert.throws(() => normalizeAcademicTeacherAllocation({ ...common, ClassId: 'jss-3', ArmId: 'arm-a', AllocationRole: 'Subject Teacher' }, scope), /Choose a subject/);
  assert.throws(() => normalizeAcademicTeacherAllocation({ ...common, ClassId: 'jss-3', AllocationRole: 'Form Teacher' }, scope), /Choose the class arm/);
});

test('AM-002 student memberships allocate one arm and a unique subject set per term', () => {
  const membership = normalizeAcademicStudentMembership({
    SessionId: 'session-1', TermId: 'term-1', StudentRef: 'DCA/2026/001',
    ClassId: 'class-1', ArmId: 'arm-a', SubjectIds: ['math', 'eng', 'math']
  }, scope);

  assert.deepEqual(membership.SubjectIds, ['math', 'eng']);
  assert.match(membership.MembershipId, /session-1__term-1__dca-2026-001$/);
  assert.throws(() => normalizeAcademicStudentMembership({
    SessionId: 'session-1', TermId: 'term-1', StudentRef: 'DCA/2026/001', ClassId: 'class-1'
  }, scope), /class and arm/);
});

test('AM-002 Junior takes all offerings while Senior inherits department core subjects', () => {
  const offerings = [
    { SessionId: 'session-1', TermId: 'term-1', ClassId: 'class-1', ArmId: '', SubjectId: 'english', Compulsory: true, Status: 'Active' },
    { SessionId: 'session-1', TermId: 'term-1', ClassId: 'class-1', ArmId: 'arm-a', SubjectId: 'physics', Compulsory: false, Status: 'Active' },
    { SessionId: 'session-1', TermId: 'term-1', ClassId: 'class-1', ArmId: 'arm-a', SubjectId: 'music', Compulsory: false, Status: 'Active' }
  ];
  const departments = [{ DepartmentId: 'science', SchoolStage: 'senior-secondary', CoreSubjectIds: ['physics'], Status: 'Active' }];
  const base = { SessionId: 'session-1', TermId: 'term-1', ClassId: 'class-1', ArmId: 'arm-a' };
  const junior = applyAcademicStudentCurriculum({ offerings, departments }, {
    ...base, SchoolStage: 'junior-secondary', DepartmentId: 'science', SubjectIds: []
  });
  const senior = applyAcademicStudentCurriculum({ offerings, departments }, {
    ...base, SchoolStage: 'senior-secondary', DepartmentId: 'science', SubjectIds: ['music']
  });

  assert.equal(junior.DepartmentId, '');
  assert.deepEqual(junior.SubjectIds, ['english', 'physics', 'music']);
  assert.deepEqual(senior.SubjectIds, ['music', 'english', 'physics']);
  assert.throws(() => applyAcademicStudentCurriculum({ offerings: offerings.filter((row) => row.SubjectId !== 'physics'), departments }, {
    ...base, SchoolStage: 'senior-secondary', DepartmentId: 'science', SubjectIds: []
  }), /Offer every department core subject/);
});

test('AM-003 movements preserve before and after membership snapshots', () => {
  const before = {
    StudentRef: 'DCA/2026/001', SessionId: 'session-1', TermId: 'term-1',
    ClassId: 'jss-1', ArmId: 'a', DepartmentId: '', SubjectIds: ['math'],
    BranchId: scope.branchId, SchoolSection: scope.section
  };
  const after = { ...before, ClassId: 'jss-2', ArmId: 'b', SubjectIds: ['math', 'english'] };
  const movement = normalizeAcademicStudentMovement({
    EffectiveDate: '2026-10-02', Reason: 'Approved class correction'
  }, scope, before, after);

  assert.equal(movement.MovementType, 'Class Transfer');
  assert.equal(movement.FromClassId, 'jss-1');
  assert.equal(movement.ToClassId, 'jss-2');
  assert.deepEqual(movement.FromSubjectIds, ['math']);
  assert.deepEqual(movement.ToSubjectIds, ['math', 'english']);
  assert.throws(() => normalizeAcademicStudentMovement({ EffectiveDate: '2026-10-02' }, scope, before, after), /reason/);
});

test('AM-003 class and arm capacities fail closed during allocation', () => {
  const capacityState = {
    classes: [{ ClassId: 'class-1', Name: 'JSS 1', Capacity: 2, Status: 'Active' }],
    arms: [{ ArmId: 'arm-a', ClassId: 'class-1', Name: 'A', Capacity: 1, Status: 'Active' }],
    studentMemberships: [{
      MembershipId: 'existing', SessionId: 'session-1', TermId: 'term-1',
      ClassId: 'class-1', ArmId: 'arm-a', Status: 'Active'
    }]
  };
  const candidate = { SessionId: 'session-1', TermId: 'term-1', ClassId: 'class-1', ArmId: 'arm-a', Status: 'Active' };
  assert.throws(() => assertAcademicMembershipCapacity(capacityState, candidate), /configured capacity/);
  assert.doesNotThrow(() => assertAcademicMembershipCapacity(capacityState, candidate, 'existing'));
});

test('Academic Management is a School-only role module with a constrained Teacher role', () => {
  assert.equal(staffRoleAllowedForEdition('Teacher', 'school'), true);
  assert.equal(staffRoleAllowedForEdition('Teacher', 'faith'), false);
  assert.equal(modulesForEdition('school').some((module) => module.key === 'academics'), true);
  assert.equal(modulesForEdition('faith').some((module) => module.key === 'academics'), false);
  assert.deepEqual(defaultModulesForRole('Teacher', { edition: 'school' }), ['academics', 'humanResources', 'staffAttendance']);

  const teacher = academicManagementCapabilities({ edition: 'school', role: 'Teacher', allowedSections: ['academics'] });
  assert.equal(teacher.enabled, true);
  assert.equal(teacher.teacherView, true);
  assert.equal(teacher.canManageStructure, false);
  assert.equal(teacher.canManageAllocations, false);
  assert.equal(academicManagementCapabilities({ edition: 'faith', role: 'Teacher', allowedSections: ['academics'] }).enabled, false);
});

test('Academic writes are audited, optimistic and preserve legacy class/student compatibility', () => {
  assert.match(librarySource, /batchCommitDocuments/);
  assert.match(librarySource, /ACADEMIC_WRITE_CONFLICT/);
  assert.match(librarySource, /academicManagementAudit/);
  assert.match(librarySource, /settings\/academics\/classes/);
  assert.match(librarySource, /ClassName: clean\(schoolClass\?\.Name\)/);
  assert.match(librarySource, /SubjectIds: uniqueIds/);
  assert.match(librarySource, /record\.SubjectIds = \[\.\.\.available\]/);
  assert.match(librarySource, /department\.CoreSubjectIds/);
  assert.match(librarySource, /AcademicDepartment: clean\(department\?\.Name\)/);
  assert.match(librarySource, /ACADEMIC_MOVEMENT_REQUIRED/);
  assert.match(librarySource, /academicStudentMovements/);
  assert.match(librarySource, /Allocate at most 100 students in one batch/);
  assert.match(librarySource, /ACADEMIC_TEACHER_SECTION_INVALID/);
  assert.match(librarySource, /Archive the \$\{dependants\.length\} active dependent record/);
});

test('Web and desktop transports share one protected Academic Management handler', () => {
  assert.match(apiSource, /requiredDeploymentIdentity/);
  assert.match(apiSource, /deployment\.edition !== 'school'/);
  assert.match(apiSource, /requireStaffSession/);
  assert.match(apiSource, /handleAcademicManagementAction/);
  assert.match(apiSource, /Cache-Control': 'no-store/);
  assert.match(backendSource, /case 'getAcademicManagement'/);
  assert.match(backendSource, /case 'saveAcademicTeacherAllocation'/);
  assert.match(backendSource, /case 'saveAcademicDepartment'/);
  assert.match(backendSource, /case 'saveAcademicStudentMembership'/);
  assert.match(backendSource, /case 'bulkAllocateAcademicStudents'/);
  assert.match(backendSource, /case 'moveAcademicStudentMembership'/);
  assert.match(backendSource, /case 'withdrawAcademicStudentMembership'/);
  assert.match(backendSource, /handleAcademicManagementAction/);
});

test('staff web workspace exposes responsive academic registers and online-only success', () => {
  assert.match(adminSource, /\['academics', 'Academic Management'\]/);
  assert.match(adminSource, /function renderAcademicManagement/);
  assert.match(adminSource, /function academicManagementRequest/);
  assert.match(adminSource, /function academicDepartmentsWorkspace/);
  assert.match(adminSource, /Junior receives every offering/);
  assert.match(adminSource, /The same staff member can also teach different subjects in other classes and arms/);
  assert.match(adminSource, /function syncAcademicTeacherAssignmentForm/);
  assert.match(adminSource, /data-academic-workflow="bulkAllocateAcademicStudents"/);
  assert.match(adminSource, /Student Movement History/);
  assert.match(adminSource, /staffFetch\('\/api\/staff-academics'/);
  assert.match(adminSource, /active === 'academics'/);
  assert.match(styleSource, /\.academic-management-editor-grid/);
  assert.match(styleSource, /@media\(max-width:560px\)[\s\S]*\.academic-management-filterbar/);
  assert.match(adminHtml, /js\/admin\.js\?v=20260815-teacher-responsibilities/);
});

test('Academic root collections are included in dynamic organisation backup and restore', () => {
  assert.match(backupSource, /listRootCollectionIds/);
  assert.doesNotMatch(backupSource, /EXCLUDED_ROOT_COLLECTIONS[\s\S]{0,500}academic(?:Sessions|Terms|Classes|Arms|Subjects|StudentMovements)/);
});
