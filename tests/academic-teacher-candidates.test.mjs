import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { academicSubjectTeacherCandidates, academicManagementCapabilities } from '../functions/lib/academic-management.js';
import { staffRecordMatchesEdition } from '../functions/lib/records-desk.js';

const [library, admin] = await Promise.all([
  readFile(new URL('../functions/lib/academic-management.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/admin.js', import.meta.url), 'utf8')
]);
const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();

// Run production helpers in isolation; no API calls or real staff records.
function declaration(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const remainder = source.slice(start);
  const end = remainder.search(/\r?\n(?:export )?(?:async )?function /);
  return remainder.slice(0, end < 0 ? undefined : end);
}
function libraryHelpers(names, context = {}) {
  return runInNewContext(`${names.map(name => declaration(library, name)).join('\n')}\n({${names.join(',')}})`, { clean, lower, ...context });
}
const staff = [
  { Username: 'teacher', DisplayName: 'Ada Teacher', Role: 'Teacher', Department: '', Active: true, SchoolSectionAccess: 'All' },
  { Username: 'science', DisplayName: 'Ben Science', Role: 'Teacher', Department: 'Science', Active: 'YES', SchoolSectionAccess: 'Primary' },
  { Username: 'secondary', Role: 'Teacher', Active: true, SchoolSectionAccess: 'Secondary' },
  { Username: 'inactive', Role: 'Teacher', Active: false },
  { Username: 'disabled', Role: 'Teacher', Active: 'NO' },
  { Username: 'academics', DisplayName: 'Cara Academics', Role: 'Department User', Department: 'Academics', Active: true },
  { Username: 'department-other', Role: 'Department User', Department: 'Academic Department', Active: true },
  { Username: 'accounts', Role: 'Accounts Officer', Department: 'Academics', Active: true }
];

test('Teacher candidates do not need an Academics department, but remain active and section-scoped', () => {
  assert.deepEqual(academicSubjectTeacherCandidates(staff, 'primary').map(row => row.Username), ['teacher', 'science', 'academics']);
  assert.deepEqual(academicSubjectTeacherCandidates(staff, 'secondary').map(row => row.Username), ['teacher', 'secondary', 'academics']);
  assert.deepEqual(academicSubjectTeacherCandidates(staff).map(row => row.Username), ['teacher', 'science', 'secondary', 'academics']);
  assert.equal(academicSubjectTeacherCandidates([{ Role: ' teacher ', Active: true }]).length, 1);
});

test('web Teacher selectors agree with the server and render Teacher accounts with their role', () => {
  const names = ['academicManagementStaffCandidates', 'academicFind', 'academicSelectOptions', 'academicIsActive', 'academicTeacherWorkspace'];
  const context = {
    clean, escapeHtml: value => clean(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    academicManagementFilters: { section: 'primary', sessionId: 'session', termId: 'term' },
    academicRecordId: row => row.RecordId || row.Username || row.SessionId || row.TermId || row.ClassId || row.ArmId || row.SubjectId,
    academicClassroomCheckboxField: () => '', academicRecordFields: () => '', academicActionButtons: () => '', table: () => ''
  };
  const helpers = runInNewContext(`${names.map(name => declaration(admin, name)).join('\n')}\n({${names.join(',')}})`, context);
  for (const section of ['primary', 'secondary', '']) {
    assert.deepEqual(Array.from(helpers.academicManagementStaffCandidates(staff, section), row => row.Username),
      academicSubjectTeacherCandidates(staff, section).map(row => row.Username));
  }
  const data = { staff, permissions: { canManageAllocations: true }, terms: [] };
  const rows = { sessions: [], classes: [], arms: [], subjects: [], teacherAllocations: [] };
  const html = helpers.academicTeacherWorkspace(data, rows);
  assert.match(html, /value="teacher">Ada Teacher \(Teacher\)<\/option>/);
  assert.match(html, /value="science">Ben Science \(Teacher · Science\)<\/option>/);
  assert.doesNotMatch(html, /value="(?:inactive|disabled|secondary|accounts|department-other)"/);
  assert.doesNotMatch(admin, /Only active Department Users in the Academics department are listed|No eligible Academics Department Users/);
});

test('server accepts Teacher subject, form and assistant allocations, and still rejects ineligible staff', () => {
  const names = ['failure', 'activeValue', 'recordId', 'statusActive', 'schoolStageValue', 'findById', 'assertReference',
    'isAcademicsDepartmentUser', 'isAcademicsDepartmentStaff', 'validateActiveConflict', 'validateAcademicRecord'];
  const { validateAcademicRecord } = libraryHelpers(names);
  const state = {
    sessions: [{ SessionId: 'session' }], terms: [{ TermId: 'term', SessionId: 'session' }],
    classes: [{ ClassId: 'class', SchoolSection: 'primary' }], arms: [{ ArmId: 'arm', ClassId: 'class' }],
    subjects: [{ SubjectId: 'math', SchoolSection: 'primary' }],
    offerings: [{ SessionId: 'session', TermId: 'term', ClassId: 'class', ArmId: 'arm', SubjectId: 'math' }]
  };
  const allocation = role => ({ SessionId: 'session', TermId: 'term', ClassId: 'class', ArmId: 'arm',
    SubjectId: 'math', SchoolSection: 'primary', TeacherUsername: 'teacher', AllocationRole: role });
  for (const role of ['Subject Teacher', 'Form Teacher', 'Assistant Teacher']) {
    assert.doesNotThrow(() => validateAcademicRecord(state, 'teacherallocation', allocation(role), { staff }));
    assert.doesNotThrow(() => validateAcademicRecord(state, 'teacherallocation', { ...allocation(role), TeacherUsername: 'academics' }, { staff }));
  }
  for (const username of ['accounts', 'department-other']) {
    assert.throws(() => validateAcademicRecord(state, 'teacherallocation', { ...allocation('Subject Teacher'), TeacherUsername: username }, { staff }),
      error => error.code === 'ACADEMIC_TEACHER_DEPARTMENT_INVALID');
  }
  assert.throws(() => validateAcademicRecord(state, 'teacherallocation', { ...allocation('Subject Teacher'), TeacherUsername: 'secondary' }, { staff }),
    error => error.code === 'ACADEMIC_TEACHER_SECTION_INVALID');
  for (const username of ['inactive', 'disabled', 'missing']) {
    assert.throws(() => validateAcademicRecord(state, 'teacherallocation', { ...allocation('Subject Teacher'), TeacherUsername: username }, { staff }), /not an active staff account/);
  }
});

test('Teacher candidates still pass through the existing edition and branch boundary', async () => {
  const rows = [
    ...staff.map(row => ({ ...row, BranchId: 'main', OrganisationEdition: 'school' })),
    { Username: 'other-branch', Role: 'Teacher', BranchId: 'north', OrganisationEdition: 'school' },
    { Username: 'other-edition', Role: 'Teacher', BranchId: 'main', OrganisationEdition: 'church' }
  ];
  const { activeValue } = libraryHelpers(['activeValue']);
  const load = runInNewContext(`async ${declaration(library, 'loadPeople')}\nloadPeople`, {
    lower, activeValue, staffRecordMatchesEdition, listCollection: async () => rows,
    listSchoolCollection: async () => { throw new Error('Students are not needed'); }
  });
  const people = await load({}, { edition: 'school' }, { branchId: 'main', section: 'primary' }, { students: false });
  assert.deepEqual(Array.from(academicSubjectTeacherCandidates(people.staff, 'primary'), row => row.Username), ['teacher', 'science', 'academics']);
});

test('selection eligibility does not grant Teacher accounts administrator permissions', () => {
  const capabilities = academicManagementCapabilities({ edition: 'school', role: 'Teacher', allowedSections: ['academics'] });
  assert.equal(capabilities.canManageAllocations, false);
  assert.equal(capabilities.canManageStructure, false);
  assert.equal(capabilities.canPublishTimetables, false);
});
