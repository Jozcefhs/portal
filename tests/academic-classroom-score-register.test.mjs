import test from 'node:test';
import assert from 'node:assert/strict';
import { academicTeacherScoreClassrooms, loadAcademicClassroomScoreRegister } from '../functions/lib/academic-classroom-score-register.js';
import { academicWebActor, academicManagementCapabilities, getAcademicClassroomScoreRegister,
  getAcademicClassScoreRegister, assertAcademicScoreSheetAuthority } from '../functions/lib/academic-management.js';
import { fixture as uiFixture, renderWorkspace } from './helpers/academic-register-fixture.mjs';

const scope = { branchId: 'main', section: 'secondary' };
const period = { SessionId: 's', TermId: 't', ClassId: 'c' };
const input = { ...period, ArmId: 'a' };
const teacher = { edition: 'school', role: 'Teacher', username: 'form.teacher', allowedSections: ['academics'] };
const row = data => ({ BranchId: 'main', SchoolSection: 'secondary', Status: 'Active', ...period, ...data });
const components = [{ Id: 'ca1', Name: 'First test', MaximumScore: 100 }];
function fixture() {
  const state = { sessions: [{ SessionId: 's' }], terms: [{ SessionId: 's', TermId: 't' }],
    classes: [{ ClassId: 'c', Name: 'Grade 7' }], arms: [{ ClassId: 'c', ArmId: 'a', Name: 'Brilliance' }, { ClassId: 'c', ArmId: 'b', Name: 'Excellence' }],
    subjects: [{ SubjectId: 'math', Name: 'Mathematics' }, { SubjectId: 'eng', Name: 'English Language' }, { SubjectId: 'science', Name: 'Basic Science' }],
    teacherAllocations: [row({ ArmId: 'a', TeacherUsername: 'form.teacher', AllocationRole: 'Form Teacher' }),
      row({ ArmId: 'b', TeacherUsername: 'form.teacher', AllocationRole: 'Subject Teacher', SubjectId: 'math' })] };
  const records = {
    academicStudentMemberships: [row({ ArmId: 'a', StudentRef: 'TEST/1', SubjectIds: ['math', 'eng', 'science'] }),
      row({ ArmId: 'a', StudentRef: 'TEST/2', SubjectIds: ['math', 'science'] }),
      row({ ArmId: 'b', StudentRef: 'PRIVATE', SubjectIds: ['math'] }),
      row({ ArmId: 'a', StudentRef: 'ARCHIVED', Status: 'Archived' })],
    academicStudentScores: [row({ ArmId: 'b', StudentRef: 'TEST/1', SubjectId: 'math', SheetId: 'math-sheet',
      ComponentScores: [{ ComponentId: 'ca1', State: 'Numeric', RawScore: 0, MaximumScore: 100 }] }),
      row({ ArmId: '', StudentRef: 'TEST/1', SubjectId: 'eng', SheetId: 'eng-sheet',
        ComponentScores: [{ ComponentId: 'ca1', State: 'Numeric', RawScore: 87, MaximumScore: 100 }] }),
      row({ ArmId: 'b', StudentRef: 'PRIVATE', SubjectId: 'math', SheetId: 'private-sheet' })],
    academicScoreSheets: [row({ SheetId: 'math-sheet', ArmId: 'b', SubjectId: 'math', TeacherUsername: 'math.teacher', Status: 'Draft', AssessmentComponents: components }),
      row({ SheetId: 'eng-sheet', ArmId: '', SubjectId: 'eng', TeacherUsername: 'english.teacher', Status: 'Approved', AssessmentComponents: components })]
  };
  const calls = [];
  const dependencies = {
    queryCollectionPages: async (_env, collection, options) => {
      calls.push({ collection, ...options });
      return structuredClone((records[collection] || []).filter(record => options.filters.every(filter =>
        filter.op === 'in' ? filter.value.includes(record[filter.field]) : record[filter.field] === filter.value)));
    },
    getDocuments: async (_env, collection, ids) => {
      calls.push({ collection, ids });
      return ids.map(id => structuredClone(records[collection].find(record => record.SheetId === id) || null));
    },
    academicAuditRecordLabels: async (_env, _scope, rows) => {
      calls.push({ collection: 'labels', refs: rows.map(row => row.StudentRef) });
      return rows.map(row => ({ ...row, RecordLabel: row.StudentRef === 'TEST/1' ? 'Ada Student' : 'Ben Student' }));
    },
    assessmentScheme: async () => ({ Components: components })
  };
  return { state, records, calls, dependencies, load: (overrides = {}) =>
    loadAcademicClassroomScoreRegister({}, scope, state, teacher.username, { ...input, ...overrides }, dependencies) };
}

test('class teacher sees every offered subject for their classroom, including other teachers, drafts and transferred marks', async () => {
  const f = fixture(), before = structuredClone({ state: f.state, records: f.records });
  const report = await f.load();
  assert.equal(report.ClassroomName, 'Grade 7 / Brilliance'); assert.equal(report.ReadOnly, true);
  assert.equal(report.StudentCount, 2); assert.equal(report.SubjectCount, 3);
  assert.deepEqual(report.Rows.map(row => row.StudentName), ['Ada Student', 'Ben Student']);
  const cell = (ref, subject) => report.Rows.find(row => row.StudentRef === ref).Cells.find(cell =>
    cell.ColumnId === report.Columns.find(column => column.SubjectId === subject).Id);
  assert.equal(cell('TEST/1', 'math').RawScore, 0); assert.equal(cell('TEST/1', 'math').SheetStatus, 'Draft');
  assert.equal(cell('TEST/1', 'eng').RawScore, 87); assert.equal(cell('TEST/1', 'eng').SheetStatus, 'Approved');
  assert.equal(cell('TEST/2', 'science').State, 'Not recorded');
  assert.equal(cell('TEST/2', 'eng').State, 'Not enrolled');
  assert.deepEqual({ state: f.state, records: f.records }, before);
  assert.deepEqual(f.calls.find(call => call.collection === 'labels').refs, ['TEST/1', 'TEST/2']);
  for (const call of f.calls.filter(call => call.filters)) {
    for (const field of ['SessionId', 'TermId', 'ClassId']) assert.ok(call.filters.some(filter => filter.field === field && filter.value === input[field]));
  }
  assert.deepEqual(f.calls.find(call => call.collection === 'academicStudentScores').filters.find(filter => filter.field === 'StudentRef').value, ['TEST/1', 'TEST/2']);
});

test('unassigned, inactive, subject-only and wrong-period classrooms fail before any student or score reads', async () => {
  for (const patch of [{ ArmId: 'b' }, { ClassId: 'other' }, { SessionId: 'old' }, { TermId: 'old' }, { ArmId: '' }]) {
    const f = fixture(); await assert.rejects(f.load(patch), { code: 'ACADEMIC_CLASSROOM_REGISTER_FORBIDDEN' }); assert.equal(f.calls.length, 0);
  }
  for (const patch of [{ Status: 'Archived' }, { TeacherUsername: 'someone.else' }, { AllocationRole: 'Subject Teacher' }, { ArmId: '' }]) {
    const f = fixture(); Object.assign(f.state.teacherAllocations[0], patch);
    await assert.rejects(f.load(), { code: 'ACADEMIC_CLASSROOM_REGISTER_FORBIDDEN' }); assert.equal(f.calls.length, 0);
  }
});

test('branch and section collisions, historic terms and inactive students cannot enter the report', async () => {
  const f = fixture();
  for (const patch of [{ BranchId: 'private' }, { SchoolSection: 'primary' }, { SessionId: 'old' }, { TermId: 'old' }, { Status: 'Expelled' }]) {
    f.records.academicStudentMemberships.push(row({ ArmId: 'a', StudentRef: 'EXCLUDED', ...patch }));
  }
  for (const patch of [{ BranchId: 'private' }, { SchoolSection: 'primary' }, { TermId: 'old' }]) {
    f.records.academicStudentScores.push({ ...f.records.academicStudentScores[0], ...patch });
  }
  const report = await f.load(); assert.equal(report.StudentCount, 2);
  assert.equal(report.Rows.some(row => row.Cells.some(cell => cell.State === 'Review duplicate')), false);
});

test('empty classroom does not read scores, student profiles or assessment policy', async () => {
  const f = fixture(); f.records.academicStudentMemberships = [];
  f.dependencies.assessmentScheme = async () => { throw Error('Unnecessary read'); };
  assert.equal((await f.load()).StudentCount, 0);
  assert.deepEqual(f.calls.map(call => call.collection), ['academicStudentMemberships']);
});

test('primary-only schools retain legacy marks without a section field', async () => {
  const f = fixture();
  for (const rows of Object.values(f.records)) for (const row of rows) delete row.SchoolSection;
  const report = await loadAcademicClassroomScoreRegister({}, { branchId: 'main', section: 'primary', structure: { Sections: ['primary'] } },
    f.state, teacher.username, input, f.dependencies);
  assert.equal(report.StudentCount, 2);
  assert.ok(report.Rows[0].Cells.some(cell => cell.RawScore === 87));
});

test('failed score loading aborts instead of presenting a misleading partial register', async () => {
  const f = fixture(), read = f.dependencies.queryCollectionPages;
  f.dependencies.queryCollectionPages = async (env, collection, options) => {
    if (collection === 'academicStudentScores') throw new Error('Database unavailable');
    return read(env, collection, options);
  };
  await assert.rejects(f.load(), /Database unavailable/);
});

test('read-only access is web-only, never grants class-wide viewing, subject editing or approval', async () => {
  const web = academicWebActor(teacher), capabilities = academicManagementCapabilities(web);
  assert.equal(capabilities.canViewClassroomScores, true);
  assert.equal(capabilities.canReviewScores, false); assert.equal(capabilities.canApproveScores, false);
  assert.equal(academicManagementCapabilities(teacher).canViewClassroomScores, false);
  for (const actor of [teacher, academicWebActor({ ...teacher, edition: 'faith' }), academicWebActor({ ...teacher, allowedSections: [] })]) {
    await assert.rejects(getAcademicClassroomScoreRegister({}, actor, input), { code: 'ACADEMIC_ACCESS_FORBIDDEN' });
  }
  await assert.rejects(getAcademicClassScoreRegister({}, web, input), { code: 'ACADEMIC_ACCESS_FORBIDDEN' });
  const f = fixture();
  assert.throws(() => assertAcademicScoreSheetAuthority(web, capabilities, f.state,
    { ...input, SubjectId: 'eng' }, f.records.academicScoreSheets[1]), /teacher/i);
});

test('classroom selector lists only exact active form-teacher assignments', () => {
  const f = fixture();
  assert.deepEqual(academicTeacherScoreClassrooms(f.state, 'FORM.TEACHER', input).map(row => row.ArmId), ['a']);
  assert.deepEqual(academicTeacherScoreClassrooms(f.state, 'other', input), []);
});

test('authorised reviewers read one classroom at a time without requiring a teacher assignment', async () => {
  const f = fixture(); f.state.teacherAllocations = [];
  const before = structuredClone(f.records);
  f.dependencies.canViewAllClassrooms = true;
  const first = await f.load();
  assert.equal(first.ClassroomName, 'Grade 7 / Brilliance');
  assert.deepEqual(first.Rows.map(row => row.StudentRef).sort(), ['TEST/1', 'TEST/2']);
  assert.ok(f.calls.find(call => call.collection === 'academicStudentMemberships').filters.some(filter => filter.field === 'ArmId' && filter.value === 'a'));
  assert.ok(f.calls.filter(call => call.collection === 'academicStudentScores').every(call => call.filters.some(filter => filter.field === 'StudentRef' && filter.op === 'in' && !filter.value.includes('PRIVATE'))));
  f.calls.length = 0;
  const second = await f.load({ ArmId: 'b' });
  assert.equal(second.ClassroomName, 'Grade 7 / Excellence');
  assert.deepEqual(second.Rows.map(row => row.StudentRef), ['PRIVATE']);
  assert.deepEqual(f.records, before);
  f.calls.length = 0;
  await assert.rejects(f.load({ ArmId: 'unavailable' }), { code: 'ACADEMIC_CLASSROOM_REGISTER_FORBIDDEN' });
  assert.equal(f.calls.length, 0);
});

test('request fields cannot broaden a teacher to unassigned classrooms', async () => {
  const f = fixture();
  await assert.rejects(f.load({ ArmId: 'b', canViewAllClassrooms: true }), { code: 'ACADEMIC_CLASSROOM_REGISTER_FORBIDDEN' });
  assert.equal(f.calls.length, 0);
});

test('web academic managers select classrooms and receive a read-only form', () => {
  for (const role of ['Super Admin', 'ICT', 'Principal', 'Director', 'Admin', 'Admissions Officer']) {
    const f = uiFixture();
    f.data.permissions = academicManagementCapabilities(academicWebActor({ ...teacher, role }));
    f.rows.arms.push({ ClassId: 'class', ArmId: 'other-arm', Name: 'Excellence', IsClassroom: true });
    f.rows.teacherAllocations = [];
    const form = renderWorkspace('scorebook', f).match(/<form[^>]*data-classroom-register[^>]*>[\s\S]*?<\/form>/)[0];
    assert.match(form, /Classroom score register — all subjects/);
    assert.match(form, /Grade 10 \/ Brilliance/); assert.match(form, /Grade 10 \/ Excellence/);
    assert.match(form, /data-class-register-reload[^>]*>Load \/ refresh scores<\/button>/); assert.match(form, /Preview \/ print/);
    assert.doesNotMatch(form, /all arms|whole class|data-class-register-reactivate|contenteditable/);
  }
});

test('teacher interface exposes classroom selection and printing without score mutation buttons', () => {
  const f = uiFixture(); f.data.permissions.canViewClassroomScores = true;
  f.rows.teacherAllocations.push({ SessionId: 'session', TermId: 'term', ClassId: 'class', ArmId: 'arm', AllocationRole: 'Form Teacher' });
  const html = renderWorkspace('scorebook', f).match(/<form[^>]*data-classroom-register[^>]*>[\s\S]*?<\/form>/)[0];
  assert.match(html, /My classroom scores/); assert.match(html, /Grade 10 \/ Brilliance/);
  assert.match(html, /Preview \/ print/); assert.match(html, /data-class-id="class"/);
  assert.doesNotMatch(html, /data-class-register-reactivate|data-academic-score-status|contenteditable/);
});
