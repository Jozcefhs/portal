import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ACADEMIC_MANAGEMENT_COLLECTIONS,
  ACADEMIC_SUBJECT_TEACHER_STATE_KEYS,
  ACADEMIC_STUDENT_IMPORT_COLUMNS,
  ACADEMIC_VIEW_STATE_KEYS,
  applyAcademicStudentCurriculum,
  assertAcademicMembershipCapacity,
  academicPermanentDeleteDependants,
  academicManagementCapabilities,
  academicManagementViewStateKeys,
  academicOfferingSubjectRole,
  academicSeniorCoreSubjectIds,
  academicStudentMatchesClass,
  academicTeacherVisibleMemberships,
  importedAcademicStudentProfile,
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

const [librarySource, apiSource, backendSource, staffStudentsSource, backupSource, adminSource, styleSource, adminHtml] = await Promise.all([
  readFile(new URL('../functions/lib/academic-management.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/api/staff-academics.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/api/staff-students.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/lib/organization-backup.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/admin.js', import.meta.url), 'utf8'),
  readFile(new URL('../css/style.css', import.meta.url), 'utf8'),
  readFile(new URL('../admin.html', import.meta.url), 'utf8')
]);

const scope = { branchId: 'north-campus', section: 'secondary' };

test('every academic workspace stays focused below the Worker subrequest ceiling', () => {
  assert.deepEqual(ACADEMIC_SUBJECT_TEACHER_STATE_KEYS, [
    'sessions', 'terms', 'classes', 'arms', 'subjects', 'departments',
    'offerings', 'teacherAllocations'
  ]);
  assert.deepEqual(Object.keys(ACADEMIC_VIEW_STATE_KEYS), [
    'classrooms', 'structure', 'bulksetup', 'departments', 'offerings', 'teachers',
    'students', 'timetable', 'attendance', 'scorebook', 'results', 'outcomes',
    'clearances', 'readiness', 'cbt'
  ]);
  const validKeys = new Set(Object.keys(ACADEMIC_MANAGEMENT_COLLECTIONS));
  Object.entries(ACADEMIC_VIEW_STATE_KEYS).forEach(([view, keys]) => {
    assert.ok(keys.length > 0 && keys.length < 50, `${view} must stay below the Worker subrequest ceiling`);
    assert.equal(new Set(keys).size, keys.length, `${view} must not repeat collections`);
    keys.forEach((key) => assert.ok(validKeys.has(key) && key !== 'audit', `${view} contains invalid state key ${key}`));
  });
  assert.equal(academicManagementViewStateKeys('subject-teachers'), ACADEMIC_SUBJECT_TEACHER_STATE_KEYS);
  assert.equal(academicManagementViewStateKeys('unknown-view'), ACADEMIC_VIEW_STATE_KEYS.classrooms);
  assert.equal(academicManagementViewStateKeys('teachers', { financeView: true }), ACADEMIC_VIEW_STATE_KEYS.clearances);
  const saveSource = librarySource.slice(
    librarySource.indexOf('export async function bulkAssignAcademicSubjectTeacher'),
    librarySource.indexOf('export async function bulkAllocateAcademicStudents')
  );
  assert.match(saveSource, /loadAcademicState\(env, scope\.branchId, ACADEMIC_SUBJECT_TEACHER_STATE_KEYS\)/);
  assert.match(saveSource, /loadPeople\(env, user, scope, \{ students: false \}\)/);
  assert.match(saveSource, /View: 'teachers'/);
  assert.doesNotMatch(librarySource, /loadAcademicState\(env,\s*scope\.branchId\s*\)/);
  assert.match(librarySource, /ACADEMIC_STATE_BUNDLE_REQUIRED/);
  assert.match(librarySource, /focusedStateKeys = academicManagementViewStateKeys/);
  assert.match(librarySource, /queryCollection\(env, collection, \{\s*filters: \[\{ field: 'BranchId', op: '==', value: branchId \}\]/);
  assert.doesNotMatch(librarySource, /collections\.map\(\(\[, collection\]\) => listCollection\(env, collection\)/);
  assert.match(adminSource, /academicManagementView = button\.dataset\.academicView;[\s\S]{0,800}void loadAcademicManagement\(\);/);
});

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
  const classroom = normalizeAcademicArm({ ClassId: schoolClass.ClassId, Name: 'Brilliance', IsClassroom: 'YES' }, scope);
  const departmentalArm = normalizeAcademicArm({ ClassId: 'sss-1', Name: 'Science', DepartmentId: 'science' }, scope);
  const otherBranch = normalizeAcademicClass({ Name: 'JSS 1', Code: 'JSS1' }, { branchId: 'south', section: 'secondary' });
  const otherSection = normalizeAcademicClass({ Name: 'JSS 1', Code: 'JSS1' }, { branchId: 'north-campus', section: 'primary' });

  assert.equal(schoolClass.ClassId, 'class__north-campus__secondary__jss-1');
  assert.equal(arm.ArmId, `${schoolClass.ClassId}__arm__excellence`);
  assert.equal(departmentalArm.DepartmentId, 'science');
  assert.equal(arm.IsClassroom, false);
  assert.equal(classroom.IsClassroom, true);
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

test('AM-002 reusable Secondary subjects carry one school-wide Senior choice role', () => {
  const trade = normalizeAcademicSubject({ Name: 'Catering Craft', Code: 'CATER', SeniorChoiceRole: 'Trade' }, scope);
  const optional = normalizeAcademicSubject({ Name: 'Music', Code: 'MUSIC', SeniorChoiceRole: 'Optional' }, scope);
  const primary = normalizeAcademicSubject(
    { Name: 'Creative Arts', Code: 'CCA', SeniorChoiceRole: 'Trade' },
    { ...scope, section: 'primary' }
  );

  assert.equal(trade.SeniorChoiceRole, 'Trade');
  assert.equal(optional.SeniorChoiceRole, 'Optional');
  assert.equal(primary.SeniorChoiceRole, '');
});

test('AM-002 active Senior departments reserve their Core subjects from school-wide choices', () => {
  assert.deepEqual(academicSeniorCoreSubjectIds([
    { DepartmentId: 'science', CoreSubjectIds: ['physics', 'chemistry'], Status: 'Active' },
    { DepartmentId: 'arts', CoreSubjectIds: ['literature', 'physics'], Status: 'Active' },
    { DepartmentId: 'old', CoreSubjectIds: ['history'], Status: 'Archived' }
  ]), ['physics', 'chemistry', 'literature']);
});

test('AM-003 permanent deletion detects current and historical academic references', () => {
  const state = {
    classes: [{ ClassId: 'jss-2', NextClassId: 'jss-3' }],
    arms: [{ ArmId: 'arm-a', ArmTemplateId: 'template-a', ClassId: 'jss-1', DepartmentId: 'science' }],
    subjects: [], departments: [{ DepartmentId: 'science', CoreSubjectIds: ['physics'], Status: 'Archived' }],
    offerings: [], teacherAllocations: [], studentMemberships: [],
    studentMovements: [{ MovementId: 'move-1', FromClassId: 'jss-1', ToClassId: 'jss-2', FromArmId: 'arm-a', FromDepartmentId: 'science', FromSubjectIds: ['physics'] }]
  };

  assert.equal(academicPermanentDeleteDependants(state, 'class', { ClassId: 'jss-1' }).length, 2);
  assert.equal(academicPermanentDeleteDependants(state, 'arm', { ArmId: 'arm-a' }).length, 1);
  assert.equal(academicPermanentDeleteDependants(state, 'armTemplate', { ArmTemplateId: 'template-a' }).length, 1);
  assert.equal(academicPermanentDeleteDependants(state, 'subject', { SubjectId: 'physics' }).length, 2);
  assert.equal(academicPermanentDeleteDependants(state, 'department', { DepartmentId: 'science' }).length, 2);
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

test('AM-002 migration can stage a missing student profile for completion in Students', () => {
  const profile = importedAcademicStudentProfile(
    { StudentRef: 'DCA/21/0777', StudentName: 'Nnaemeka Jerry' },
    scope,
    { ClassId: 'jss-1', Name: 'JSS 1', SchoolStage: 'junior-secondary' },
    { ArmId: 'jss-1-bri', Name: 'Brilliance' },
    { Name: '2026/2027' },
    { Name: 'First Term' },
    { displayName: 'School Admin' }
  );
  assert.equal(profile.AdmissionNo, 'DCA/21/0777');
  assert.equal(profile.__id, 'DCA-21-0777');
  assert.equal(profile.__scopePath, 'schoolBranches/north-campus/sections/secondary/students');
  assert.equal(profile.ProfileCompletionStatus, 'Needs completion');
  assert.equal(profile.ClassName, 'JSS 1');
  assert.equal(profile.ClassArm, 'Brilliance');
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
    { SessionId: 'session-1', TermId: 'term-1', ClassId: 'class-1', ArmId: 'arm-a', SubjectId: 'french', SubjectRole: 'Trade', Status: 'Active' },
    { SessionId: 'session-1', TermId: 'term-1', ClassId: 'class-1', ArmId: 'arm-a', SubjectId: 'music', Compulsory: false, Status: 'Active' }
  ];
  const subjects = [
    { SubjectId: 'french', SchoolSection: 'secondary', SeniorChoiceRole: '', Status: 'Active' },
    { SubjectId: 'music', SchoolSection: 'secondary', SeniorChoiceRole: 'Optional', Status: 'Active' }
  ];
  const departments = [{ DepartmentId: 'science', SchoolStage: 'senior-secondary', CoreSubjectIds: ['physics'], Status: 'Active' }];
  const base = { SessionId: 'session-1', TermId: 'term-1', ClassId: 'class-1', ArmId: 'arm-a' };
  const junior = applyAcademicStudentCurriculum({ offerings, subjects, departments }, {
    ...base, SchoolStage: 'junior-secondary', DepartmentId: 'science', SubjectIds: []
  });
  const senior = applyAcademicStudentCurriculum({ offerings, subjects, departments }, {
    ...base, SchoolStage: 'senior-secondary', DepartmentId: 'science', SubjectIds: ['music']
  });

  assert.equal(junior.DepartmentId, '');
  assert.deepEqual(junior.SubjectIds, ['english', 'french', 'music']);
  assert.deepEqual(senior.CoreSubjectIds, ['physics']);
  assert.deepEqual(senior.OptionalSubjectIds, ['music']);
  assert.deepEqual(senior.SubjectIds, ['music', 'physics']);
  assert.equal(senior.SubjectIds.includes('english'), false);
  assert.equal(senior.SubjectIds.includes('french'), false);
  const incompleteSenior = applyAcademicStudentCurriculum({ offerings: [], subjects: [], departments }, {
    ...base, SchoolStage: 'senior-secondary', DepartmentId: 'science', SubjectIds: []
  }, { allowIncompleteCurriculum: true });
  assert.deepEqual(incompleteSenior.SubjectIds, ['physics']);
  assert.equal(incompleteSenior.CurriculumStatus, 'Trade Subjects Not Configured');
});

test('AM-002 Senior arm subjects lock core, require Trade and retain optional selections', () => {
  const state = {
    offerings: [
      { SessionId: 'session-1', TermId: 'term-1', ClassId: 'sss-1', ArmId: '', SubjectId: 'english', SubjectRole: 'Core', Status: 'Active' },
      { SessionId: 'session-1', TermId: 'term-1', ClassId: 'sss-1', ArmId: '', SubjectId: 'french', SubjectRole: 'Trade', Status: 'Active' }
    ],
    subjects: [
      { SubjectId: 'physics', SchoolSection: 'secondary', SeniorChoiceRole: '', Status: 'Active' },
      { SubjectId: 'french', SchoolSection: 'secondary', SeniorChoiceRole: '', Status: 'Active' },
      { SubjectId: 'catering', SchoolSection: 'secondary', SeniorChoiceRole: 'Trade', Status: 'Active' },
      { SubjectId: 'music', SchoolSection: 'secondary', SeniorChoiceRole: 'Optional', Status: 'Active' }
    ],
    departments: [{ DepartmentId: 'science', SchoolStage: 'senior-secondary', CoreSubjectIds: ['physics'], Status: 'Active' }]
  };
  const base = {
    SessionId: 'session-1', TermId: 'term-1', ClassId: 'sss-1', ArmId: 'excellence',
    SchoolStage: 'senior-secondary', DepartmentId: 'science', SubjectIds: []
  };
  const pending = applyAcademicStudentCurriculum(state, { ...base });
  assert.deepEqual(pending.CoreSubjectIds, ['physics']);
  assert.deepEqual(pending.TradeSubjectIds, []);
  assert.equal(pending.CurriculumStatus, 'Pending Trade Selection');
  assert.equal(pending.SubjectIds.includes('french'), false);
  assert.throws(() => applyAcademicStudentCurriculum(state, { ...base }, { requireTradeSelection: true }), /at least one Trade subject/);
  const complete = applyAcademicStudentCurriculum(state, {
    ...base, TradeSubjectIds: ['catering'], OptionalSubjectIds: ['music'], SubjectIds: ['catering', 'music']
  }, { requireTradeSelection: true });
  assert.deepEqual(complete.CoreSubjectIds, ['physics']);
  assert.deepEqual(complete.TradeSubjectIds, ['catering']);
  assert.deepEqual(complete.OptionalSubjectIds, ['music']);
  assert.deepEqual(complete.SubjectIds, ['catering', 'music', 'physics']);
  assert.equal(complete.CurriculumStatus, 'Complete');
  assert.throws(() => applyAcademicStudentCurriculum(state, {
    ...base, TradeSubjectIds: ['french'], SubjectIds: ['french']
  }, { requireTradeSelection: true }), /not available/);
  const pendingDepartment = applyAcademicStudentCurriculum(state, {
    ...base, DepartmentId: '', TradeSubjectIds: [], OptionalSubjectIds: [], SubjectIds: []
  }, { allowIncompleteCurriculum: true });
  assert.deepEqual(pendingDepartment.CoreSubjectIds, []);
  assert.equal(pendingDepartment.CurriculumStatus, 'Pending Department Selection');
  assert.throws(() => applyAcademicStudentCurriculum(state, {
    ...base, DepartmentId: '', TradeSubjectIds: [], OptionalSubjectIds: [], SubjectIds: []
  }), /Choose an active senior secondary department/);
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
  const academicsDepartmentUser = academicManagementCapabilities({
    edition: 'school', role: 'Department User', department: 'Academics', allowedSections: []
  });
  assert.equal(academicsDepartmentUser.enabled, true);
  assert.equal(academicsDepartmentUser.teacherView, true);
  assert.equal(academicsDepartmentUser.canManageStructure, false);
  assert.equal(academicsDepartmentUser.canManageAllocations, false);
  assert.equal(academicManagementCapabilities({
    edition: 'school', role: 'Department User', department: 'Accounts', allowedSections: []
  }).enabled, false);
  assert.equal(academicManagementCapabilities({ edition: 'faith', role: 'Teacher', allowedSections: ['academics'] }).enabled, false);
});

test('a subject teacher can load every student in the class who offers that subject across arms', () => {
  const visible = academicTeacherVisibleMemberships({
    teacherAllocations: [
      { TeacherUsername: 'math.teacher', AllocationRole: 'Subject Teacher', ClassId: 'grade-1', ArmId: 'distinction', SubjectId: 'math', Status: 'Active' },
      { TeacherUsername: 'other.teacher', AllocationRole: 'Subject Teacher', ClassId: 'grade-1', ArmId: 'excellence', SubjectId: 'english', Status: 'Active' }
    ],
    studentMemberships: [
      { StudentRef: 'G1-D-1', ClassId: 'grade-1', ArmId: 'distinction', SubjectIds: ['math'] },
      { StudentRef: 'G1-E-1', ClassId: 'grade-1', ArmId: 'excellence', SubjectIds: ['math', 'english'] },
      { StudentRef: 'G1-E-2', ClassId: 'grade-1', ArmId: 'excellence', SubjectIds: ['english'] },
      { StudentRef: 'G2-D-1', ClassId: 'grade-2', ArmId: 'distinction', SubjectIds: ['math'] }
    ]
  }, 'math.teacher');

  assert.deepEqual(visible.map((row) => row.StudentRef), ['G1-D-1', 'G1-E-1']);
});

test('Academic writes are audited, optimistic and preserve legacy class/student compatibility', () => {
  assert.match(librarySource, /batchCommitDocuments/);
  assert.match(librarySource, /ACADEMIC_WRITE_CONFLICT/);
  assert.match(librarySource, /academicManagementAudit/);
  assert.match(librarySource, /settings\/academics\/classes/);
  assert.match(librarySource, /ClassName: clean\(schoolClass\?\.Name\)/);
  assert.match(librarySource, /SubjectIds: uniqueIds/);
  assert.match(librarySource, /record\.CoreSubjectIds = coreSubjectIds/);
  assert.match(librarySource, /record\.CurriculumStatus = !record\.DepartmentId/);
  assert.match(librarySource, /department\.CoreSubjectIds/);
  assert.match(librarySource, /AcademicDepartment: clean\(department\?\.Name\)/);
  assert.match(librarySource, /ACADEMIC_MOVEMENT_REQUIRED/);
  assert.match(librarySource, /academicStudentMovements/);
  assert.match(librarySource, /Allocate at most 100 students in one batch/);
  assert.match(librarySource, /Import at most 100 student memberships at a time/);
  assert.match(librarySource, /ProfileCompletionStatus: 'Needs completion'/);
  assert.match(librarySource, /scopedCollectionPath\('students', scope\.branchId, scope\.section\)/);
  assert.match(librarySource, /ACADEMIC_IMPORT_STUDENT_SCOPE_CONFLICT/);
  assert.match(librarySource, /allowIncompleteCurriculum: true/);
  assert.match(adminSource, /Senior department, Trade and Optional subject codes may be left blank and completed in the app/);
  assert.match(adminSource, /ProfileCompletionStatus/);
  assert.match(backendSource, /ProfileCompletionStatus/);
  assert.match(staffStudentsSource, /ProfileCompletionStatus/);
  assert.match(librarySource, /ACADEMIC_IMPORT_MEMBERSHIP_CONFLICT/);
  assert.match(librarySource, /Imported into Academic Management/);
  assert.match(librarySource, /Update at most 200 student subject selections in one arm batch/);
  assert.match(librarySource, /ACADEMIC_SUBJECT_ROLES/);
  assert.match(librarySource, /ACADEMIC_SENIOR_CHOICE_ROLES/);
  assert.match(librarySource, /configureAcademicSeniorChoiceSubjects/);
  assert.match(librarySource, /SeniorChoiceRole/);
  assert.match(librarySource, /Subjects already assigned as department Core cannot be selected as Senior Trade or Optional subjects/);
  assert.match(librarySource, /A department Core subject cannot also be a school-wide Senior Trade or Optional subject/);
  assert.match(librarySource, /Every Senior Secondary student must select at least one Trade subject/);
  assert.match(librarySource, /const curriculumOfferings = record\.SchoolStage === 'senior-secondary' \? \[\] : offerings/);
  assert.match(librarySource, /ACADEMIC_SENIOR_OFFERING_DEPRECATED/);
  assert.match(librarySource, /ACADEMIC_STUDENT_CLASS_MISMATCH/);
  assert.match(librarySource, /AcademicClassId: academicStudentClassId\(row, classes\)/);
  assert.match(librarySource, /Create at most 50 classes in one batch/);
  assert.match(librarySource, /Apply at most 200 class-arm combinations in one batch/);
  assert.match(librarySource, /Create at most 50 subjects in one batch/);
  assert.match(librarySource, /Apply at most 200 class-subject combinations in one batch/);
  assert.doesNotMatch(librarySource, /ACADEMIC_SUBJECT_CATEGORIES/);
  assert.match(librarySource, /ACADEMIC_DELETE_REFERENCED/);
  assert.match(librarySource, /unused structure record, subject offering or teacher allocation can be permanently deleted/);
  assert.match(librarySource, /academicArmTemplates/);
  assert.match(librarySource, /ACADEMIC_TEACHER_SECTION_INVALID/);
  assert.match(librarySource, /activeValue\(row\.Active, true\)/);
  assert.match(librarySource, /Department: clean\(row\.Department/);
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
  assert.match(backendSource, /case 'configureAcademicSeniorChoiceSubjects'/);
  assert.match(backendSource, /case 'bulkApplyAcademicSubjects'/);
  assert.match(backendSource, /case 'bulkAssignAcademicSubjectTeacher'/);
  assert.match(backendSource, /case 'updateAcademicSubjectTeacherAllocation'/);
  assert.match(backendSource, /case 'deleteAcademicRecord'/);
  assert.match(backendSource, /case 'saveAcademicStudentMembership'/);
  assert.match(backendSource, /case 'bulkAllocateAcademicStudents'/);
  assert.match(backendSource, /case 'bulkImportAcademicStudentMemberships'/);
  assert.match(backendSource, /department: clean\(body\.UserDepartment\)/);
  assert.match(backendSource, /case 'bulkAssignAcademicArmStudentSubjects'/);
  assert.match(librarySource, /assignments\.length > 200/);
  assert.match(backendSource, /case 'moveAcademicStudentMembership'/);
  assert.match(backendSource, /case 'withdrawAcademicStudentMembership'/);
  assert.match(backendSource, /handleAcademicManagementAction/);
});

test('bulk student allocation maps every selected reference into membership and movement records', () => {
  const bulkAllocationSource = librarySource.slice(
    librarySource.indexOf('export async function bulkAllocateAcademicStudents'),
    librarySource.indexOf('export async function bulkImportAcademicStudentMemberships')
  );
  assert.equal([...bulkAllocationSource.matchAll(/StudentRef: studentRef/g)].length, 2);
  assert.doesNotMatch(bulkAllocationSource, /\.\.\.input,\s*StudentRef(?:\s*[,}])/);
  assert.match(librarySource, /type === 'studentmembership' && arm\.DepartmentId/);
  assert.match(librarySource, /record\.DepartmentId = arm\.DepartmentId/);
  assert.match(bulkAllocationSource, /allowIncompleteCurriculum: true/);
});

test('subject teachers are batch-assigned only to the exact selected classrooms', () => {
  const bulkTeacherSource = librarySource.slice(
    librarySource.indexOf('export async function bulkAssignAcademicSubjectTeacher'),
    librarySource.indexOf('export async function bulkAllocateAcademicStudents')
  );
  assert.match(bulkTeacherSource, /const classroomIds = uniqueIds\(input\.ClassroomIds/);
  assert.match(bulkTeacherSource, /for \(const classroom of classrooms\)/);
  assert.match(bulkTeacherSource, /activeValue\(classroom\.IsClassroom, false\)/);
  assert.doesNotMatch(bulkTeacherSource, /for \(const schoolClass of classes\)/);
  assert.doesNotMatch(bulkTeacherSource, /for \(const armTemplate of armTemplates\)/);
  assert.match(bulkTeacherSource, /AllocationRole: 'Subject Teacher'/);
  assert.match(bulkTeacherSource, /Repeat for another subject if needed/);
  assert.match(librarySource, /bulkassignacademicsubjectteacher/);
});

test('subject-teacher allocations can be corrected atomically or permanently deleted', () => {
  const updateSource = librarySource.slice(
    librarySource.indexOf('export async function updateAcademicSubjectTeacherAllocation'),
    librarySource.indexOf('export async function bulkAllocateAcademicStudents')
  );
  assert.match(updateSource, /existing\.AllocationRole !== 'Subject Teacher'/);
  assert.match(updateSource, /const changedIdentity = recordId\(record\) !== recordId\(existing\)/);
  assert.match(updateSource, /operation: 'delete'/);
  assert.match(updateSource, /exists: false/);
  assert.match(updateSource, /ACADEMIC_TEACHER_ALLOCATION_DUPLICATE/);
  assert.match(librarySource, /type === 'teacherallocation' \? 'canManageAllocations' : 'canDelete'/);
  assert.match(librarySource, /'offering', 'teacherallocation'/);
});

test('student withdrawal sends its reason and withdrawn memberships can be reassigned safely', () => {
  const movementSource = librarySource.slice(
    librarySource.indexOf('export async function manageAcademicStudentMembership'),
    librarySource.indexOf('function activeDependants')
  );
  assert.match(adminSource, /Reason: reason, EffectiveDate/);
  assert.doesNotMatch(adminSource, /SchoolSection: record\.SchoolSection, Reason, EffectiveDate/);
  assert.match(adminSource, /const movableMemberships = rows\.studentMemberships\.filter/);
  assert.match(adminSource, /Reassign to another classroom/);
  assert.match(adminSource, /Withdrawal is for a student leaving the current term/);
  assert.match(movementSource, /const reassigningWithdrawn = !reinstating/);
  assert.match(movementSource, /active or withdrawn membership can be transferred or changed/);
  assert.match(movementSource, /use Reinstate to restore the student to the original classroom/);
  assert.match(movementSource, /reinstating \|\| reassigningWithdrawn/);
});

test('staff web workspace exposes responsive academic registers and online-only success', () => {
  assert.match(adminSource, /\['academics', 'Academic Management'\]/);
  assert.match(adminSource, /function renderAcademicManagement/);
  assert.match(adminSource, /let academicManagementView = 'classrooms'/);
  assert.match(adminSource, /function academicClassroomWorkspace/);
  assert.match(adminSource, /function syncAcademicClassroomEditor/);
  assert.match(adminSource, /data-academic-classroom-editor/);
  assert.match(adminSource, /Create classroom/);
  assert.match(adminSource, /Reusable class/);
  assert.match(adminSource, /Reusable arm/);
  assert.match(adminSource, /name="IsClassroom" value="YES"/);
  assert.match(adminSource, /row\.IsClassroom === true/);
  assert.match(adminSource, /if \(!wanted\) return null/);
  assert.match(adminSource, /Students ready for this classroom/);
  assert.match(adminSource, /data-academic-classroom-staff-role/);
  assert.match(adminSource, /\['classrooms', 'Classrooms'\]/);
  assert.match(adminSource, /function academicManagementRequest/);
  assert.match(adminSource, /function academicDepartmentsWorkspace/);
  assert.match(adminSource, /Junior Secondary offerings become Core automatically/);
  assert.match(adminSource, /row\.Department \? ` · \$\{row\.Department\}`/);
  const teacherWorkspace = adminSource.slice(
    adminSource.indexOf('function academicTeacherWorkspace'),
    adminSource.indexOf('function academicStudentMembershipActions')
  );
  assert.match(teacherWorkspace, /const classrooms = rows\.arms\.filter/);
  assert.match(teacherWorkspace, /data-academic-workflow="bulkAssignAcademicSubjectTeacher"/);
  assert.match(teacherWorkspace, /name: 'ClassroomIds', label: 'Classrooms taught for this subject'/);
  assert.match(teacherWorkspace, /Only checked classrooms will be saved/);
  assert.match(teacherWorkspace, /Repeat the process if the teacher handles another subject/);
  assert.doesNotMatch(teacherWorkspace, /<select name="AllocationRole"/);
  assert.match(teacherWorkspace, /data-academic-form="teacherAllocation"/);
  assert.match(teacherWorkspace, /data-academic-action="updateAcademicSubjectTeacherAllocation"/);
  assert.match(teacherWorkspace, /data-academic-teacher-edit/);
  assert.match(teacherWorkspace, /academicActionButtons\('teacherAllocation', row, canManage, false, canManage\)/);
  assert.match(teacherWorkspace, /Update this allocation/);
  assert.match(adminSource, /function syncAcademicTeacherEditPeriod/);
  assert.match(teacherWorkspace, /Subject Teacher Allocations/);
  assert.match(teacherWorkspace, /subjectAllocations/);
  assert.match(librarySource, /export async function bulkAssignAcademicSubjectTeacher/);
  assert.match(librarySource, /Assign at most 200 classrooms/);
  assert.match(librarySource, /ACADEMIC_CLASSROOM_REQUIRED/);
  assert.match(adminSource, /function academicCheckboxField/);
  assert.match(adminSource, /data-academic-checkbox-count/);
  assert.match(adminSource, /function bindAcademicCheckboxField/);
  assert.match(adminSource, /event\.shiftKey && anchor/);
  assert.match(adminSource, /academicCheckboxInputs\(field, true\)/);
  assert.match(adminSource, /field\._academicShiftAnchor = target/);
  assert.match(adminSource, /Shift-click to select a range/);
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
  assert.match(adminSource, /profile marked Needs completion will be created automatically/);
  assert.match(adminSource, /Blank student migration template downloaded/);
  assert.match(adminSource, /data-academic-workflow="bulkAssignAcademicArmStudentSubjects"/);
  assert.match(adminSource, /function academicArmSubjectRegister/);
  assert.match(adminSource, /Core · locked/);
  assert.match(adminSource, /Trade · choose at least one/);
  assert.match(adminSource, /must have at least one Trade subject/);
  assert.match(adminSource, /Assignments: assignments/);
  assert.match(adminSource, /function updateAcademicArmStudentSubjectCounts/);
  assert.match(adminSource, /data-academic-student-subject-count/);
  assert.match(adminSource, /data-academic-student-subject-total/);
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
  assert.match(adminSource, /data-academic-workflow="configureAcademicSeniorChoiceSubjects"/);
  assert.match(adminSource, /name: 'TradeSubjectIds', label: 'Trade subjects'/);
  assert.match(adminSource, /name: 'OptionalSubjectIds', label: 'Optional subjects'/);
  assert.match(adminSource, /every current and future Senior Secondary classroom/);
  assert.match(adminSource, /subject\.SeniorChoiceRole === 'Trade'/);
  assert.match(adminSource, /subject\.SeniorChoiceRole === 'Optional'/);
  assert.match(adminSource, /disabled: departments\.length > 0/);
  assert.match(adminSource, /Department Core subjects are disabled/);
  assert.match(adminSource, /const applicable = stage === 'senior-secondary' \? \[\]/);
  assert.match(adminSource, /Legacy · ignored/);
  assert.match(adminSource, /legacy Senior class assignment/);
  assert.match(adminSource, /const form = canManage && !secondary/);
  assert.match(adminSource, /option\.disabled \? ' disabled' : ''/);
  assert.match(adminSource, /input\.checked = !input\.disabled && selected\.has/);
  assert.match(adminSource, /Select subjects applicable to \$\{secondary \? 'Junior Secondary' : 'Primary'\}/);
  assert.match(adminSource, /name: 'ClassIds', label: secondary \? 'Junior Secondary classes' : 'Primary classes'/);
  assert.match(adminSource, /name: 'SubjectIds', label: secondary \? 'Applicable Junior Secondary subjects' : 'Applicable Primary subjects'/);
  assert.match(adminSource, /label: sectionName === 'secondary' \? 'Junior curriculum' : 'Primary curriculum'/);
  assert.match(adminSource, /Every selected subject is assigned to every selected class and is compulsory/);
  const bulkSetupWorkspace = adminSource.slice(
    adminSource.indexOf('function academicBulkSetupWorkspace'),
    adminSource.indexOf('function academicDepartmentsWorkspace')
  );
  assert.doesNotMatch(bulkSetupWorkspace, /bulkApplyAcademicSubjects/);
  assert.doesNotMatch(adminSource, /key: 'applySubjects'/);
  assert.match(librarySource, /ACADEMIC_JUNIOR_SUBJECT_APPLICATION_ONLY/);
  assert.match(librarySource, /scope\.section === 'secondary' \? 'Core'/);
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
  assert.match(styleSource, /\.academic-checkbox-count\{/);
  assert.match(styleSource, /\.academic-checkbox-count-limit\{/);
  assert.match(styleSource, /\.academic-classroom-flow-grid\{/);
  assert.match(styleSource, /\.academic-classroom-current\{/);
  assert.match(styleSource, /\.academic-classroom-staff-grid\{/);
  assert.match(styleSource, /\.academic-checkbox-option input\[type="checkbox"\]/);
  assert.match(styleSource, /\[data-academic-checkbox-purpose="student-arm-candidates"\] \.academic-checkbox-options\{max-height:320px\}/);
  assert.match(styleSource, /\.academic-student-allocation-layout\{grid-column:1\/-1/);
  assert.match(styleSource, /\.academic-arm-student-subject-list/);
  assert.match(styleSource, /\.academic-subject-locked/);
  assert.match(styleSource, /\.academic-arm-student-subject-status/);
  assert.match(styleSource, /grid-template-areas:"register controls"/);
  assert.match(styleSource, /grid-template-areas:"controls" "register"/);
  assert.match(styleSource, /\.academic-management-tabs button\{[^}]*font-size:13px/);
  assert.match(styleSource, /\.academic-management-editor-heading small\{[^}]*font-size:11px/);
  assert.match(styleSource, /@media\(max-width:560px\)\{[\s\S]*?\.academic-management-tabs button\{[^}]*font-size:12px/);
  assert.match(styleSource, /@media\(max-width:560px\)[\s\S]*\.academic-management-filterbar/);
  assert.match(adminSource, /function organizeAcademicManagementWorkspace/);
  assert.match(adminSource, /Only the selected task is shown/);
  assert.match(adminSource, /data-academic-task-panel/);
  assert.match(adminSource, /showAcademicManagementTask\('students', 'transfer'\)/);
  assert.match(styleSource, /\.academic-task-workspace\{display:grid/);
  assert.match(styleSource, /\.academic-register-card/);
  assert.match(adminHtml, /js\/admin\.js\?v=20260903-hotel-room-status/);
});

test('Academic root collections are included in dynamic organisation backup and restore', () => {
  assert.match(backupSource, /listRootCollectionIds/);
  assert.doesNotMatch(backupSource, /EXCLUDED_ROOT_COLLECTIONS[\s\S]{0,500}academic(?:Sessions|Terms|Classes|ArmTemplates|Arms|Subjects|StudentMovements)/);
});
