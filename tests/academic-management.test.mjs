import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ACADEMIC_STUDENT_IMPORT_COLUMNS,
  applyAcademicStudentCurriculum,
  assertAcademicMembershipCapacity,
  academicPermanentDeleteDependants,
  academicManagementCapabilities,
  academicOfferingSubjectRole,
  academicStudentMatchesClass,
  normalizeAcademicArm,
  normalizeAcademicArmTemplate,
  normalizeAcademicClass,
  normalizeAcademicDepartment,
  normalizeAcademicOffering,
  normalizeAcademicSession,
  normalizeAcademicStudentMembership,
  normalizeAcademicStudentImportRows,
  normalizeAcademicStudentMovement,
  normalizeAcademicSubject,
  normalizeAcademicTeacherAllocation,
  normalizeAcademicTerm,
  parseAcademicArmTemplateBatch,
  parseAcademicClassBatch,
  parseAcademicSubjectBatch,
  scopedSection
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

test('AM-003 bulk classes stay section scoped while reusable arm templates are branch wide', () => {
  const secondaryClasses = parseAcademicClassBatch({
    ClassLines: 'JSS 1 | JSS1 | Junior Secondary | 120\nSS 1 | SS1 | Senior Secondary | 100'
  }, scope);
  const primaryClasses = parseAcademicClassBatch({ ClassLines: 'Primary 1 | PRI1 | 40' }, { ...scope, section: 'primary' });
  const armRows = parseAcademicArmTemplateBatch({ ArmTemplateLines: 'A | A | 40\nGold | GOLD | 35' });
  const template = normalizeAcademicArmTemplate(armRows[1], scope);
  const appliedArm = normalizeAcademicArm({
    ClassId: 'class-1', Name: template.Name, Code: template.Code,
    ArmTemplateId: template.ArmTemplateId, Capacity: template.DefaultCapacity
  }, scope);

  assert.deepEqual(secondaryClasses.map((row) => row.SchoolStage), ['Junior Secondary', 'Senior Secondary']);
  assert.equal(secondaryClasses[0].Capacity, '120');
  assert.equal(primaryClasses[0].SchoolStage, 'primary');
  assert.equal(template.ArmTemplateId, 'arm-template__north-campus__gold');
  assert.equal(template.SchoolSection, 'all');
  assert.equal(template.DefaultCapacity, 35);
  assert.equal(scopedSection({ SchoolSection: template.SchoolSection }, false), '');
  assert.throws(() => scopedSection({ SchoolSection: template.SchoolSection }, true), /Choose Primary or Secondary/);
  assert.equal(appliedArm.ArmTemplateId, template.ArmTemplateId);
  assert.equal(appliedArm.Capacity, 35);
  assert.throws(() => parseAcademicArmTemplateBatch({ ArmTemplateLines: 'Brilliance BRI 30' }), /Line 1 is not in the required format/);
  assert.throws(() => parseAcademicClassBatch({ ClassLines: 'Grade 7 JSS1 Junior Secondary 200' }, scope), /Line 1 is not in the required format/);
});

test('AM-002 subjects are bulk-created once and reused through class offerings', () => {
  const rows = parseAcademicSubjectBatch({
    SubjectLines: 'Mathematics | MATH\nComputer Studies | COMP'
  });
  const subjects = rows.map((row) => normalizeAcademicSubject({ ...row, Category: 'Core' }, scope));
  const offering = normalizeAcademicOffering({
    SessionId: 'session-1', TermId: 'term-1', ClassId: 'jss-1',
    SubjectId: subjects[0].SubjectId, Compulsory: true
  }, scope);

  assert.deepEqual(rows, [
    { Name: 'Mathematics', Code: 'MATH' },
    { Name: 'Computer Studies', Code: 'COMP' }
  ]);
  assert.equal(subjects[0].SubjectId, 'subject__north-campus__secondary__math');
  assert.equal('Category' in subjects[0], false);
  assert.equal(offering.SubjectId, subjects[0].SubjectId);
  assert.throws(() => parseAcademicSubjectBatch({ SubjectLines: 'Mathematics MATH Core' }), /Line 1 is not in the required format/);
});

test('AM-003 permanent deletion detects current and historical academic references', () => {
  const state = {
    classes: [{ ClassId: 'jss-2', NextClassId: 'jss-3' }],
    arms: [{ ArmId: 'arm-a', ArmTemplateId: 'template-a', ClassId: 'jss-1' }],
    subjects: [], departments: [{ DepartmentId: 'science', CoreSubjectIds: ['physics'], Status: 'Archived' }],
    offerings: [], teacherAllocations: [], studentMemberships: [],
    studentMovements: [{ MovementId: 'move-1', FromClassId: 'jss-1', ToClassId: 'jss-2', FromArmId: 'arm-a', FromDepartmentId: 'science', FromSubjectIds: ['physics'] }]
  };

  assert.equal(academicPermanentDeleteDependants(state, 'class', { ClassId: 'jss-1' }).length, 2);
  assert.equal(academicPermanentDeleteDependants(state, 'arm', { ArmId: 'arm-a' }).length, 1);
  assert.equal(academicPermanentDeleteDependants(state, 'armTemplate', { ArmTemplateId: 'template-a' }).length, 1);
  assert.equal(academicPermanentDeleteDependants(state, 'subject', { SubjectId: 'physics' }).length, 2);
  assert.equal(academicPermanentDeleteDependants(state, 'department', { DepartmentId: 'science' }).length, 1);
  assert.equal(academicPermanentDeleteDependants(state, 'class', { ClassId: 'unused' }).length, 0);

  const offering = { OfferingId: 'offering-1', SessionId: 'session-1', TermId: 'term-1', ClassId: 'jss-1', ArmId: '', SubjectId: 'physics' };
  const offeringState = {
    teacherAllocations: [{ SessionId: 'session-1', TermId: 'term-1', ClassId: 'jss-1', ArmId: '', SubjectId: 'physics' }],
    studentMemberships: [{ SessionId: 'session-1', TermId: 'term-1', ClassId: 'jss-1', ArmId: 'arm-a', SubjectIds: ['physics'] }],
    studentMovements: [{ SessionId: 'session-1', TermId: 'term-1', FromClassId: 'jss-1', FromArmId: 'arm-a', FromSubjectIds: ['physics'] }]
  };
  assert.equal(academicPermanentDeleteDependants(offeringState, 'offering', offering).length, 3);
  assert.equal(academicPermanentDeleteDependants(offeringState, 'offering', { ...offering, SubjectId: 'music' }).length, 0);
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
  assert.equal(offering.SubjectRole, 'Core');
  const tradeOffering = normalizeAcademicOffering({
    SessionId: 'session-1', TermId: 'term-1', ClassId: 'class-1', SubjectId: subject.SubjectId,
    SubjectRole: 'Trade'
  }, scope);
  assert.equal(tradeOffering.SubjectRole, 'Trade');
  assert.equal(tradeOffering.Compulsory, false);
  assert.equal(academicOfferingSubjectRole({ Compulsory: false }), 'Optional');
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

test('AM-002 existing-student import rows use reusable codes and semicolon subject lists', () => {
  assert.deepEqual(ACADEMIC_STUDENT_IMPORT_COLUMNS, [
    'StudentRef', 'StudentName', 'ClassCode', 'ArmCode', 'DepartmentCode',
    'TradeSubjectCodes', 'OptionalSubjectCodes', 'Reason'
  ]);
  assert.deepEqual(normalizeAcademicStudentImportRows([{
    AdmissionNo: 'DCA/2026/001', DisplayName: 'Ada Student', ClassCode: 'SS1', ArmCode: 'EXC',
    DepartmentCode: 'SCI', TradeSubjectCodes: 'CATER; AGR | CATER', OptionalSubjectCodes: 'BIO;MUSIC'
  }]), [{
    StudentRef: 'DCA/2026/001', StudentName: 'Ada Student', ClassCode: 'SS1', ArmCode: 'EXC',
    DepartmentCode: 'SCI', TradeSubjectCodes: ['CATER', 'AGR'], OptionalSubjectCodes: ['BIO', 'MUSIC'], Reason: ''
  }]);
  assert.deepEqual(normalizeAcademicStudentImportRows('not-json'), []);
});

test('AM-002 arm allocation candidates must belong to the selected existing class', () => {
  const gradeSeven = { ClassId: 'grade-7', Name: 'Grade 7', Code: 'JSS1', LegacyDocumentId: 'Grade_7' };
  assert.equal(academicStudentMatchesClass({ ClassName: 'Grade 7' }, gradeSeven), true);
  assert.equal(academicStudentMatchesClass({ ClassAdmitted: 'JSS 1' }, gradeSeven), true);
  assert.equal(academicStudentMatchesClass({ AcademicClassId: 'grade-7', ClassName: 'Grade 8' }, gradeSeven), true);
  assert.equal(academicStudentMatchesClass({ AcademicClassId: 'grade-8', ClassName: 'Grade 7' }, gradeSeven), false);
  assert.equal(academicStudentMatchesClass({ ClassName: 'Grade 8' }, gradeSeven), false);
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

test('AM-002 Senior arm subjects lock core, require Trade and retain optional selections', () => {
  const state = {
    offerings: [
      { SessionId: 'session-1', TermId: 'term-1', ClassId: 'sss-1', ArmId: '', SubjectId: 'english', SubjectRole: 'Core', Status: 'Active' },
      { SessionId: 'session-1', TermId: 'term-1', ClassId: 'sss-1', ArmId: '', SubjectId: 'physics', SubjectRole: 'Optional', Status: 'Active' },
      { SessionId: 'session-1', TermId: 'term-1', ClassId: 'sss-1', ArmId: '', SubjectId: 'catering', SubjectRole: 'Trade', Status: 'Active' },
      { SessionId: 'session-1', TermId: 'term-1', ClassId: 'sss-1', ArmId: '', SubjectId: 'music', SubjectRole: 'Optional', Status: 'Active' }
    ],
    departments: [{ DepartmentId: 'science', SchoolStage: 'senior-secondary', CoreSubjectIds: ['physics'], Status: 'Active' }]
  };
  const base = {
    SessionId: 'session-1', TermId: 'term-1', ClassId: 'sss-1', ArmId: 'excellence',
    SchoolStage: 'senior-secondary', DepartmentId: 'science', SubjectIds: []
  };
  const pending = applyAcademicStudentCurriculum(state, { ...base });
  assert.deepEqual(pending.CoreSubjectIds, ['english', 'physics']);
  assert.deepEqual(pending.TradeSubjectIds, []);
  assert.equal(pending.CurriculumStatus, 'Pending Trade Selection');
  assert.throws(() => applyAcademicStudentCurriculum(state, { ...base }, { requireTradeSelection: true }), /at least one Trade subject/);
  const complete = applyAcademicStudentCurriculum(state, {
    ...base, TradeSubjectIds: ['catering'], OptionalSubjectIds: ['music'], SubjectIds: ['catering', 'music']
  }, { requireTradeSelection: true });
  assert.deepEqual(complete.CoreSubjectIds, ['english', 'physics']);
  assert.deepEqual(complete.TradeSubjectIds, ['catering']);
  assert.deepEqual(complete.OptionalSubjectIds, ['music']);
  assert.deepEqual(complete.SubjectIds, ['catering', 'music', 'english', 'physics']);
  assert.equal(complete.CurriculumStatus, 'Complete');
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
  assert.equal(teacher.canDelete, false);
  assert.equal(academicManagementCapabilities({ edition: 'faith', role: 'Teacher', allowedSections: ['academics'] }).enabled, false);
});

test('Academic writes are audited, optimistic and preserve legacy class/student compatibility', () => {
  assert.match(librarySource, /batchCommitDocuments/);
  assert.match(librarySource, /ACADEMIC_WRITE_CONFLICT/);
  assert.match(librarySource, /academicManagementAudit/);
  assert.match(librarySource, /settings\/academics\/classes/);
  assert.match(librarySource, /ClassName: clean\(schoolClass\?\.Name\)/);
  assert.match(librarySource, /SubjectIds: uniqueIds/);
  assert.match(librarySource, /record\.CoreSubjectIds = coreSubjectIds/);
  assert.match(librarySource, /record\.CurriculumStatus = !tradeAvailable\.length/);
  assert.match(librarySource, /department\.CoreSubjectIds/);
  assert.match(librarySource, /AcademicDepartment: clean\(department\?\.Name\)/);
  assert.match(librarySource, /ACADEMIC_MOVEMENT_REQUIRED/);
  assert.match(librarySource, /academicStudentMovements/);
  assert.match(librarySource, /Allocate at most 100 students in one batch/);
  assert.match(librarySource, /Import at most 100 student memberships at a time/);
  assert.match(librarySource, /ACADEMIC_IMPORT_MEMBERSHIP_CONFLICT/);
  assert.match(librarySource, /Imported into Academic Management/);
  assert.match(librarySource, /Update at most 200 student subject selections in one arm batch/);
  assert.match(librarySource, /ACADEMIC_SUBJECT_ROLES/);
  assert.match(librarySource, /Every Senior Secondary student must select at least one Trade subject/);
  assert.match(librarySource, /ACADEMIC_STUDENT_CLASS_MISMATCH/);
  assert.match(librarySource, /AcademicClassId: academicStudentClassId\(row, classes\)/);
  assert.match(librarySource, /Create at most 50 classes in one batch/);
  assert.match(librarySource, /Apply at most 200 class-arm combinations in one batch/);
  assert.match(librarySource, /Create at most 50 subjects in one batch/);
  assert.match(librarySource, /Apply at most 200 class-subject combinations in one batch/);
  assert.doesNotMatch(librarySource, /ACADEMIC_SUBJECT_CATEGORIES/);
  assert.match(librarySource, /ACADEMIC_DELETE_REFERENCED/);
  assert.match(librarySource, /class, reusable arm definition, arm, subject, department or subject offering can be permanently deleted/);
  assert.match(librarySource, /academicArmTemplates/);
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
  assert.match(backendSource, /case 'saveAcademicArmTemplate'/);
  assert.match(backendSource, /case 'bulkCreateAcademicClasses'/);
  assert.match(backendSource, /case 'bulkCreateAcademicArmTemplates'/);
  assert.match(backendSource, /case 'bulkApplyAcademicArmTemplates'/);
  assert.match(backendSource, /case 'bulkCreateAcademicSubjects'/);
  assert.match(backendSource, /case 'bulkApplyAcademicSubjects'/);
  assert.match(backendSource, /case 'deleteAcademicRecord'/);
  assert.match(backendSource, /case 'saveAcademicStudentMembership'/);
  assert.match(backendSource, /case 'bulkAllocateAcademicStudents'/);
  assert.match(backendSource, /case 'bulkImportAcademicStudentMemberships'/);
  assert.match(backendSource, /case 'bulkAssignAcademicArmStudentSubjects'/);
  assert.match(librarySource, /assignments\.length > 200/);
  assert.match(backendSource, /case 'moveAcademicStudentMembership'/);
  assert.match(backendSource, /case 'withdrawAcademicStudentMembership'/);
  assert.match(backendSource, /handleAcademicManagementAction/);
});

test('staff web workspace exposes responsive academic registers and online-only success', () => {
  assert.match(adminSource, /\['academics', 'Academic Management'\]/);
  assert.match(adminSource, /function renderAcademicManagement/);
  assert.match(adminSource, /function academicManagementRequest/);
  assert.match(adminSource, /function academicDepartmentsWorkspace/);
  assert.match(adminSource, /Junior Secondary offerings become Core automatically/);
  assert.match(adminSource, /The same staff member can also teach different subjects in other classes and arms/);
  assert.match(adminSource, /function syncAcademicTeacherAssignmentForm/);
  assert.match(adminSource, /function academicCheckboxField/);
  assert.match(adminSource, /function validateAcademicCheckboxFields/);
  assert.match(adminSource, /payload\[name\] = academicCheckedValues\(form, name\)/);
  assert.match(adminSource, /name: 'StudentRefs'/);
  assert.match(adminSource, /name: 'CoreSubjectIds'/);
  assert.doesNotMatch(adminSource, /select name="(?:CoreSubjectIds|StudentRefs|SubjectIds)" multiple/);
  assert.match(adminSource, /data-academic-workflow="bulkAllocateAcademicStudents"/);
  assert.match(adminSource, /data-academic-student-membership-import/);
  assert.match(adminSource, /data-academic-download-student-import/);
  assert.match(adminSource, /bulkImportAcademicStudentMemberships/);
  assert.match(adminSource, /function academicStudentMembershipImportCsv/);
  assert.match(adminSource, /Separate multiple Trade or Optional subject codes with semicolons/);
  assert.match(adminSource, /data-academic-workflow="bulkAssignAcademicArmStudentSubjects"/);
  assert.match(adminSource, /function academicArmSubjectRegister/);
  assert.match(adminSource, /Core · locked/);
  assert.match(adminSource, /Trade · choose at least one/);
  assert.match(adminSource, /must have at least one Trade subject/);
  assert.doesNotMatch(adminSource, /name: 'SubjectIds', label: 'Optional subjects'/);
  assert.match(adminSource, /data-academic-student-placement="bulk"/);
  assert.doesNotMatch(adminSource, /data-academic-form="studentMembership"/);
  assert.doesNotMatch(adminSource, /Single allocation/);
  assert.match(adminSource, /class="academic-student-allocation-layout"/);
  assert.match(adminSource, /One or up to 100 at once/);
  assert.match(adminSource, /function academicStudentAllocationCandidates/);
  assert.match(adminSource, /data-academic-checkbox-purpose="student-arm-candidates"/);
  assert.match(adminSource, /remain unassigned for this period/);
  assert.match(adminSource, /Students awaiting an arm/);
  assert.match(adminSource, /function academicBulkSetupWorkspace/);
  assert.match(adminSource, /data-academic-workflow="bulkCreateAcademicClasses"/);
  assert.match(adminSource, /data-academic-workflow="bulkCreateAcademicArmTemplates"/);
  assert.match(adminSource, /data-academic-workflow="bulkApplyAcademicArmTemplates"/);
  assert.match(adminSource, /data-academic-workflow="bulkCreateAcademicSubjects"/);
  assert.match(adminSource, /data-academic-workflow="bulkApplyAcademicSubjects"/);
  assert.match(adminSource, /Select subjects applicable to Junior Secondary/);
  assert.match(adminSource, /name: 'ClassIds', label: 'Junior Secondary classes'/);
  assert.match(adminSource, /name: 'SubjectIds', label: 'Applicable Junior Secondary subjects'/);
  assert.match(adminSource, /Every selected subject is assigned to every selected class and is compulsory/);
  assert.match(adminSource, /\['offerings', 'Class subjects'\]/);
  assert.match(adminSource, /Core status is assigned within each Senior Secondary department/);
  assert.doesNotMatch(adminSource, /data-academic-form="subject"[\s\S]{0,1200}name="Category"/);
  assert.match(adminSource, /data-academic-delete=/);
  assert.match(adminSource, /Permanently delete academic record/);
  assert.match(adminSource, /academicActionButtons\('offering', row, canManage, data\.permissions\?\.canArchive, data\.permissions\?\.canDelete\)/);
  assert.doesNotMatch(adminSource, /Reusable Arm Definitions \(not class arms\)/);
  const structureWorkspace = adminSource.slice(
    adminSource.indexOf('function academicStructureWorkspace'),
    adminSource.indexOf('function academicBulkSetupWorkspace')
  );
  assert.match(structureWorkspace, /table\('Reusable Arm Catalogue', rows\.armTemplates/);
  assert.match(structureWorkspace, /data-academic-apply-arm-template/);
  assert.match(structureWorkspace, /table\('Applied Class Arms', rows\.arms/);
  assert.match(structureWorkspace, /No reusable arm has been applied to a class yet/);
  assert.ok(
    structureWorkspace.indexOf("table('Reusable Arm Catalogue'") > structureWorkspace.indexOf('academic-management-registers'),
    'the reusable arm catalogue should render inside the Structure register grid'
  );
  assert.match(adminSource, /type === 'armTemplate' && !panelEl\.querySelector\('\[data-academic-form="armTemplate"\]'\)/);
  assert.match(adminSource, /setAcademicCheckedValues\(form, 'ArmTemplateIds', \[templateId\]\)/);
  assert.match(adminSource, /This step does not create class arms/);
  assert.match(adminSource, /academicActionButtons\('department',[\s\S]{0,150}permissions\?\.canDelete/);
  assert.match(adminSource, /academicActionButtons\('armTemplate',[\s\S]{0,150}permissions\?\.canDelete/);
  assert.match(adminSource, /Reusable Arm Catalogue/);
  assert.match(adminSource, /Student Movement History/);
  assert.match(adminSource, /staffFetch\('\/api\/staff-academics'/);
  assert.match(adminSource, /active === 'academics'/);
  assert.match(styleSource, /\.academic-management-editor-grid/);
  assert.match(styleSource, /\.academic-checkbox-options/);
  assert.match(styleSource, /\.academic-checkbox-option input\[type="checkbox"\]/);
  assert.match(styleSource, /\[data-academic-checkbox-purpose="student-arm-candidates"\] \.academic-checkbox-options\{max-height:320px\}/);
  assert.match(styleSource, /\.academic-student-allocation-layout\{grid-column:1\/-1/);
  assert.match(styleSource, /\.academic-arm-student-subject-list/);
  assert.match(styleSource, /\.academic-subject-locked/);
  assert.match(styleSource, /grid-template-areas:"register controls"/);
  assert.match(styleSource, /grid-template-areas:"controls" "register"/);
  assert.match(styleSource, /\.academic-management-tabs button\{[^}]*font-size:13px/);
  assert.match(styleSource, /\.academic-management-editor-heading small\{[^}]*font-size:11px/);
  assert.match(styleSource, /@media\(max-width:560px\)\{[\s\S]*?\.academic-management-tabs button\{[^}]*font-size:12px/);
  assert.match(styleSource, /@media\(max-width:560px\)[\s\S]*\.academic-management-filterbar/);
  assert.match(adminHtml, /js\/admin\.js\?v=20260815-student-membership-import/);
});

test('Academic root collections are included in dynamic organisation backup and restore', () => {
  assert.match(backupSource, /listRootCollectionIds/);
  assert.doesNotMatch(backupSource, /EXCLUDED_ROOT_COLLECTIONS[\s\S]{0,500}academic(?:Sessions|Terms|Classes|ArmTemplates|Arms|Subjects|StudentMovements)/);
});
