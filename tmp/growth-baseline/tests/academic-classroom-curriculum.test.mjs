import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import * as management from '../functions/lib/academic-management.js';
import * as timetable from '../functions/lib/academic-timetable-attendance.js';
import * as scorebook from '../functions/lib/academic-scorebook.js';

const source = await readFile(new URL('../functions/lib/academic-management.js', import.meta.url), 'utf8');
const admin = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const period = { SessionId: 'session', TermId: 'term', ClassId: 'grade-10', ArmId: 'brilliance' };
const scope = { BranchId: 'main', SchoolSection: 'secondary', Status: 'Active' };
const base = {
  ...period, ...scope, RecordId: 'membership', MembershipId: 'membership', StudentRef: 'S1',
  SchoolStage: 'senior-secondary', DepartmentId: 'social', SubjectIds: ['english', 'physics', 'catering'],
  CoreSubjectIds: ['english', 'physics'], TradeSubjectIds: ['catering'], OptionalSubjectIds: [],
  __updateTime: 'rev-1', CurriculumStatus: 'Complete'
};
function fixture() {
  return {
    sessions: [{ ...scope, RecordId: 'session', SessionId: 'session' }],
    terms: [{ ...scope, RecordId: 'term', SessionId: 'session', TermId: 'term' }],
    classes: [{ ...scope, RecordId: 'grade-10', ClassId: 'grade-10', Name: 'Grade 10', SchoolStage: 'senior-secondary' }],
    arms: [{ ...scope, RecordId: 'brilliance', ArmId: 'brilliance', ClassId: 'grade-10', Name: 'Brilliance', DepartmentId: '', IsClassroom: true }],
    departments: [
      { ...scope, DepartmentId: 'science', SchoolStage: 'senior-secondary', CoreSubjectIds: ['english', 'physics'] },
      { ...scope, DepartmentId: 'social', SchoolStage: 'senior-secondary', CoreSubjectIds: ['english', 'economics'] },
      { ...scope, DepartmentId: 'old', SchoolStage: 'senior-secondary', CoreSubjectIds: ['history'], Status: 'Inactive' }
    ],
    subjects: ['english', 'physics', 'economics', 'history', 'catering', 'music'].map(id => ({
      ...scope, SubjectId: id, Name: id, SeniorChoiceRole: id === 'catering' ? 'Trade' : id === 'music' ? 'Optional' : ''
    })),
    offerings: [], teacherAllocations: [], studentMemberships: [clone(base)]
  };
}

test('mixed classroom ignores legacy student department and deduplicates offered cores without assigning them all', () => {
  const state = fixture();
  const unchanged = clone(state);
  const result = management.applyAcademicStudentCurriculum(state, clone(base), { requireTradeSelection: true });
  assert.equal(result.DepartmentId, '');
  assert.deepEqual(result.CoreSubjectIds, ['english', 'physics']);
  assert.deepEqual(result.SubjectIds, base.SubjectIds);
  assert.equal(result.CurriculumStatus, 'Complete');
  assert.deepEqual(state, unchanged);
  const other = management.applyAcademicStudentCurriculum(state, {
    ...clone(base), DepartmentId: 'science', SubjectIds: ['economics', 'catering']
  }, { requireTradeSelection: true });
  assert.deepEqual(other.CoreSubjectIds, ['economics']);
  assert.throws(() => management.applyAcademicStudentCurriculum(state, {
    ...clone(base), SubjectIds: ['history', 'catering']
  }), /not available/);
});

test('mixed students can be allocated before choosing subjects but cannot complete an empty Core or Trade selection', () => {
  const empty = { ...clone(base), SubjectIds: [], CoreSubjectIds: [], TradeSubjectIds: [] };
  const result = management.applyAcademicStudentCurriculum(fixture(), clone(empty), { allowIncompleteCurriculum: true });
  assert.deepEqual(result.SubjectIds, []);
  assert.equal(result.CurriculumStatus, 'Pending Core Selection');
  assert.throws(() => management.applyAcademicStudentCurriculum(fixture(), clone(empty), { requireTradeSelection: true }), /at least one Core/);
  assert.throws(() => management.applyAcademicStudentCurriculum(fixture(), { ...empty, SubjectIds: ['physics'] }, { requireTradeSelection: true }), /at least one Trade/);
});

test('single-department classrooms override a conflicting personal department and keep compulsory cores', () => {
  const state = fixture();
  state.arms[0].DepartmentId = 'science';
  const result = management.applyAcademicStudentCurriculum(state, { ...clone(base), SubjectIds: ['catering'] }, { requireTradeSelection: true });
  assert.equal(result.DepartmentId, 'science');
  assert.deepEqual(result.CoreSubjectIds, ['english', 'physics']);
  assert.throws(() => management.applyAcademicStudentCurriculum(state, { ...clone(base), SubjectIds: ['economics', 'catering'] }), /not available/);
  state.arms[0].DepartmentId = 'old';
  assert.throws(() => management.applyAcademicStudentCurriculum(state, clone(base)), /active Senior department/);
});

test('missing, inactive and wrong-class arms are not treated as mixed classrooms', () => {
  for (const arm of [null, { Status: 'Inactive' }, { ClassId: 'grade-11' }]) {
    const state = fixture();
    state.arms = arm ? [{ ...state.arms[0], ...arm }] : [];
    assert.throws(() => management.applyAcademicStudentCurriculum(state, clone(base)), /Assign this student to a classroom/);
  }
});

function browserContext() {
  const context = {
    clean: value => String(value ?? '').trim(),
    academicIsActive: row => !['inactive', 'archived', 'closed', 'withdrawn', 'cancelled'].includes(String(row?.Status || '').toLowerCase()),
    academicRecordId: row => row.RecordId || row.MembershipId || row.DepartmentId || row.SubjectId || row.ArmId || row.ClassId,
    academicFind: (rows, id) => rows.find(row => (row.RecordId || row.ClassId) === id),
    academicIsSeniorClass: row => row.SchoolStage === 'senior-secondary'
  };
  const start = admin.indexOf('function academicStudentSubjectProfile(');
  const end = admin.indexOf('function academicStudentBelongsToClass(', start);
  context.academicStudentSubjectProfile = vm.runInNewContext(`${admin.slice(start, end)}\nacademicStudentSubjectProfile`, context);
  return context;
}

test('web profile shows Mixed departments and selectable union while preserving old selections', () => {
  const profile = browserContext().academicStudentSubjectProfile;
  const data = fixture();
  const result = clone(profile(data, clone(base)));
  assert.equal(result.mixedClassroom, true);
  assert.equal(result.departmentId, '');
  assert.deepEqual(result.coreSubjectIds, ['english', 'physics', 'economics']);
  assert.deepEqual(result.selectedCoreSubjectIds, ['english', 'physics']);
  assert.deepEqual(result.unavailableSubjectIds, []);
  data.arms[0].DepartmentId = 'social';
  const single = clone(profile(data, clone(base)));
  assert.equal(single.mixedClassroom, false);
  assert.deepEqual(single.coreSubjectIds, ['english', 'economics']);
  assert.deepEqual(single.unavailableSubjectIds, ['physics']);
});

test('web subject register renders mixed Core checkboxes as editable and single-department cores as locked', () => {
  const context = browserContext();
  Object.assign(context, {
    academicManagementFilters: { section: 'secondary', sessionId: 'session', termId: 'term' },
    academicArmSubjectDraft: { classId: 'grade-10', armId: 'brilliance' },
    academicStudentAllocationDraft: {},
    academicLabel: (_rows, id, fallback) => id || fallback || '',
    academicSelectOptions: () => '', escapeHtml: value => String(value ?? ''), currentUser: { username: 'admin' }
  });
  const start = admin.indexOf('function academicSubjectChangeRequests(');
  const end = admin.indexOf('function bindAcademicMembershipSearch(', start);
  const render = vm.runInNewContext(`${admin.slice(start, end)}\nacademicArmSubjectRegister`, context);
  const data = { ...fixture(), permissions: { canManageAllocations: true }, students: [] };
  let html = render(data, data, true);
  assert.match(html, /S1 · Mixed departments/);
  const coreInputs = html.match(/<input[^>]*data-academic-student-subject-role="Core"[^>]*>/g);
  assert.equal(coreInputs.length, 3);
  assert.ok(coreInputs.every(input => !input.includes('disabled')));
  assert.ok(coreInputs.find(input => input.includes('value="physics"')).includes(' checked'));
  assert.ok(!coreInputs.find(input => input.includes('value="economics"')).includes(' checked'));
  data.arms[0].DepartmentId = 'science';
  html = render(data, data, true);
  const singleInputs = html.match(/<input[^>]*data-academic-student-subject-role="Core"[^>]*>/g);
  assert.equal(singleInputs.length, 2);
  assert.ok(singleInputs.every(input => input.includes(' checked') && input.includes(' disabled')));
});

test('web save payload includes exactly the selected Core subjects and no personal department', () => {
  const context = browserContext();
  context.academicManagementData = fixture();
  Object.assign(context.academicManagementData.studentMemberships[0], {
    SubjectIds: ['history', 'music'], CoreSubjectIds: ['history'], TradeSubjectIds: ['music']
  });
  const row = {
    dataset: { membershipId: 'membership', revisionToken: 'rev-1', studentName: 'Student' },
    querySelectorAll: selector => (selector.includes('"Core"') ? ['english', 'economics'] : selector.includes('"Trade"') ? ['catering'] : []).map(value => ({ value }))
  };
  const form = { dataset: { academicWorkflow: 'bulkAssignAcademicArmStudentSubjects' },
    elements: Object.fromEntries(Object.entries({ ...period, Reason: 'Confirmed' }).map(([key, value]) => [key, { value }])),
    querySelectorAll: () => [row]
  };
  const start = admin.indexOf('function academicWorkflowPayload(');
  const end = admin.indexOf('function populateAcademicMovementForm(', start);
  const payload = vm.runInNewContext(`${admin.slice(start, end)}\nacademicWorkflowPayload`, context)(form);
  assert.deepEqual(clone(payload.Assignments[0]), {
    MembershipId: 'membership', RevisionToken: 'rev-1', CoreSubjectIds: ['english', 'economics'], TradeSubjectIds: ['catering'], OptionalSubjectIds: []
  });
});

function batchHarness(state = fixture()) {
  const writes = [];
  const context = vm.createContext({
    ...management, ...timetable, ...scorebook, crypto: webcrypto, safeScopeId: String, TextEncoder, TextDecoder,
    batchCommitDocuments: async (_env, changes) => { writes.push(...clone(changes)); },
    queryCollection: async () => []
  });
  vm.runInContext(source.replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/^export /gm, ''), context);
  context.loadScopedAcademicState = async () => clone(state);
  context.academicScope = async () => ({ branchId: 'main', section: 'secondary' });
  context.bootstrapAcademicManagement = async () => ({});
  const user = { edition: 'school', role: 'Super Admin', allowedSections: ['academics'], username: 'admin' };
  return {
    writes,
    save: (selection = {}, actor = user) => context.bulkAssignAcademicArmStudentSubjects({}, actor, {
      ...period, ...scope, Assignments: [{ MembershipId: 'membership', RevisionToken: 'rev-1', TradeSubjectIds: ['catering'], OptionalSubjectIds: [], ...selection }]
    }),
    saveClassroom: () => context.bulkAssignAcademicClassroomDepartments({}, user, {
      ...scope, Assignments: [{ ClassroomId: 'brilliance', DepartmentId: '', RevisionToken: 'arm-rev' }]
    })
  };
}

test('batch saves chosen mixed Core subjects and movement history without touching scores', async () => {
  const { save, writes } = batchHarness();
  await save({ CoreSubjectIds: ['english', 'economics'] });
  const membership = writes.find(row => row.collectionPath === 'academicStudentMemberships').data;
  assert.equal(membership.DepartmentId, '');
  assert.deepEqual(membership.CoreSubjectIds, ['english', 'economics']);
  assert.deepEqual(new Set(membership.SubjectIds), new Set(['english', 'economics', 'catering']));
  const movement = writes.find(row => row.collectionPath === 'academicStudentMovements').data;
  assert.deepEqual(movement.FromSubjectIds, base.SubjectIds);
  assert.deepEqual(movement.ToSubjectIds, membership.SubjectIds);
  assert.deepEqual(new Set(writes.map(row => row.collectionPath)), new Set(['academicStudentMemberships', 'academicStudentMovements', 'academicManagementAudit']));
});

test('older clients omitting Core choices preserve the existing mixed Core selection', async () => {
  const { save, writes } = batchHarness();
  await save();
  assert.deepEqual(writes.find(row => row.collectionPath === 'academicStudentMemberships').data.CoreSubjectIds, base.CoreSubjectIds);
});

test('empty choices, conflicts, unavailable proposed subjects and unauthorized teachers fail without writes', async () => {
  for (const selection of [{ CoreSubjectIds: [] }, { RevisionToken: 'stale' }, { CoreSubjectIds: ['history'] }]) {
    const { save, writes } = batchHarness();
    await assert.rejects(save(selection));
    assert.equal(writes.length, 0);
  }
  const unauthorized = batchHarness();
  await assert.rejects(unauthorized.save({}, { edition: 'school', role: 'Teacher', allowedSections: ['academics'], username: 'unassigned' }), /assigned class teacher/);
  assert.equal(unauthorized.writes.length, 0);
});

test('valid replacements repair obsolete Trade roles and removed subjects instead of validating the old selection', async () => {
  for (const old of [
    { SubjectIds: ['english', 'catering', 'music'], TradeSubjectIds: ['music'], OptionalSubjectIds: [] },
    { SubjectIds: ['english', 'removed-trade'], TradeSubjectIds: ['removed-trade'], OptionalSubjectIds: [] },
    { SubjectIds: ['history', 'catering'], CoreSubjectIds: ['history'], TradeSubjectIds: ['catering'] }
  ]) {
    const state = fixture();
    Object.assign(state.studentMemberships[0], old);
    const { save, writes } = batchHarness(state);
    await save({ CoreSubjectIds: ['english'], TradeSubjectIds: ['catering'] });
    const saved = writes.find(row => row.collectionPath === 'academicStudentMemberships').data;
    assert.deepEqual(saved.SubjectIds, ['english', 'catering']);
    assert.deepEqual(writes.find(row => row.collectionPath === 'academicStudentMovements').data.FromSubjectIds, old.SubjectIds);
    assert.ok(writes.every(row => row.collectionPath !== 'academicStudentScores'));
  }
});

test('older clients cannot silently drop obsolete Core choices when they omit CoreSubjectIds', async () => {
  const state = fixture();
  Object.assign(state.studentMemberships[0], { SubjectIds: ['history', 'catering'], CoreSubjectIds: ['history'] });
  const { save, writes } = batchHarness(state);
  await assert.rejects(save(), /Core|not available/);
  assert.equal(writes.length, 0);
});

test('web choices retain selected subjects under their current category and flag obsolete subjects', () => {
  const result = clone(browserContext().academicStudentSubjectProfile(fixture(), {
    ...clone(base), SubjectIds: ['english', 'music', 'catering', 'removed-trade'],
    TradeSubjectIds: ['music', 'removed-trade'], OptionalSubjectIds: ['catering']
  }));
  assert.deepEqual(result.selectedTradeSubjectIds, ['catering']);
  assert.deepEqual(result.selectedOptionalSubjectIds, ['music']);
  assert.deepEqual(result.unavailableSubjectIds, ['removed-trade']);
  assert.deepEqual(result.reclassifiedSubjectIds, ['music', 'catering']);
});

test('import template accepts mixed Core subject codes and no longer requests a student department', () => {
  assert.ok(management.ACADEMIC_STUDENT_IMPORT_COLUMNS.includes('CoreSubjectCodes'));
  assert.ok(!management.ACADEMIC_STUDENT_IMPORT_COLUMNS.includes('DepartmentCode'));
  assert.deepEqual(management.normalizeAcademicStudentImportRows([{ CoreSubjectCodes: 'ENG; PHY|ENG' }])[0].CoreSubjectCodes, ['ENG', 'PHY']);
  const forms = admin.slice(admin.indexOf('function academicStudentWorkspace('), admin.indexOf('function academicPeriodsForDay('));
  assert.ok(!forms.includes('name="DepartmentId"'));
});

test('switching a classroom to Mixed writes only the classroom and audit, not student selections or scores', async () => {
  const state = fixture();
  state.arms[0].DepartmentId = 'social';
  state.arms[0].__updateTime = 'arm-rev';
  const { saveClassroom, writes } = batchHarness(state);
  await saveClassroom();
  assert.equal(writes.find(row => row.collectionPath === 'academicArms').data.DepartmentId, '');
  assert.deepEqual(new Set(writes.map(row => row.collectionPath)), new Set(['academicArms', 'academicManagementAudit']));
  assert.deepEqual(state.studentMemberships, [base]);
});
