import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  academicManagementCapabilities,
  normalizeAcademicArm,
  normalizeAcademicClass,
  normalizeAcademicOffering,
  normalizeAcademicSession,
  normalizeAcademicStudentMembership,
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
    AllocationRole: 'Form Teacher'
  }, scope);

  assert.equal(subject.Code, 'MATH');
  assert.equal(offering.Compulsory, true);
  assert.match(offering.OfferingId, /session-1__term-1__class-1__arm-a/);
  assert.match(allocation.AllocationId, /ada\.teacher/);
  assert.equal(allocation.TeacherUsername, 'ada.teacher');
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
  assert.match(backendSource, /case 'saveAcademicStudentMembership'/);
  assert.match(backendSource, /handleAcademicManagementAction/);
});

test('staff web workspace exposes responsive academic registers and online-only success', () => {
  assert.match(adminSource, /\['academics', 'Academic Management'\]/);
  assert.match(adminSource, /function renderAcademicManagement/);
  assert.match(adminSource, /function academicManagementRequest/);
  assert.match(adminSource, /staffFetch\('\/api\/staff-academics'/);
  assert.match(adminSource, /active === 'academics'/);
  assert.match(styleSource, /\.academic-management-editor-grid/);
  assert.match(styleSource, /@media\(max-width:560px\)[\s\S]*\.academic-management-filterbar/);
  assert.match(adminHtml, /js\/admin\.js\?v=20260815-academic-management/);
});

test('Academic root collections are included in dynamic organisation backup and restore', () => {
  assert.match(backupSource, /listRootCollectionIds/);
  assert.doesNotMatch(backupSource, /EXCLUDED_ROOT_COLLECTIONS[\s\S]{0,500}academic(?:Sessions|Terms|Classes|Arms|Subjects)/);
});
