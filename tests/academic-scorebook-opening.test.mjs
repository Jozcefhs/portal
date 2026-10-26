import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as management from '../functions/lib/academic-management.js';
import * as scorebook from '../functions/lib/academic-scorebook.js';
import { safeScopeId } from '../functions/lib/school-scope.js';

const source = await readFile(new URL('../functions/lib/academic-management.js', import.meta.url), 'utf8');
const admin = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const actor = { edition: 'school', role: 'Super Admin', username: 'reviewer', allowedSections: ['academics'], branchId: 'main', schoolSectionAccess: 'secondary' };
const input = { BranchId: 'main', SchoolSection: 'secondary', View: 'scorebook', ScoreRowsMode: 'on-demand', ScorebookTask: 'classRegister' };
const row = data => ({ BranchId: 'main', SchoolSection: 'secondary', Status: 'Active', ...data });

test('audit navigation loads period selectors only and denies teachers before history reads', async () => {
  const f = fixture();
  await f.context.bootstrapAcademicManagement({}, actor, {...input,View:'audit',WorkspaceLoadMode:'navigation'});
  assert.deepEqual(f.calls.map(call=>call.collection).sort(),['academicSessions','academicTerms']);
  f.calls.length=0;
  await assert.rejects(f.context.handleAcademicManagementAction({}, {...actor,role:'Teacher'},
    {...input,action:'getAcademicAuditLog'}), /not permitted/);
  assert.equal(f.calls.length,0); assert.equal(f.writes.length,0);
});

test('explicit all-classes choice does not query a literal asterisk class', async () => {
  const f=fixture();
  await f.context.bootstrapAcademicManagement({},actor,{...input,View:'results',WorkspaceLoadMode:'records',RecordClassId:'*',SessionId:'s',TermId:'t'});
  assert.ok(f.calls.every(call=>!(call.options.filters||[]).some(filter=>filter.field==='ClassId'&&filter.value==='*')));
});

test('navigation with no visible submit controls requests no deadline settings', async () => {
  const calls=[];
  const context=vm.createContext({academicManagementFilters:{sessionId:'s',termId:'t'},
    panelEl:{querySelectorAll:()=>[]},academicManagementRequest:async action=>calls.push(action)});
  vm.runInContext(admin.match(/async function updateAcademicDeadlineButtons\([\s\S]*?\n}/)[0],context);
  await context.updateAcademicDeadlineButtons(); assert.deepEqual(calls,[]);
});

function fixture() {
  const calls = [], writes = [];
  const records = {
    academicSessions: [row({ SessionId: 's', Name: '2026/2027' })],
    academicTerms: [row({ SessionId: 's', TermId: 't', Name: 'First Term' })],
    academicClasses: [row({ ClassId: 'c', Name: 'Grade 7' }), row({ ClassId: 'other', BranchId: 'north' }), row({ ClassId: 'primary', SchoolSection: 'primary' })],
    academicStudentMemberships: Array.from({ length: 1200 }, (_, i) => row({ StudentRef: `TEST/${i}` })),
    academicTeacherAllocations: Array.from({ length: 1000 }, (_, i) => row({ TeacherUsername: `teacher-${i}` })),
    academicStudentScores: [row({ StudentRef: 'TEST/0', RawScore: 0, History: ['preserve'] })],
    academicScoreImports: [row({ ImportId: 'old-import' })]
  };
  const read = async (_env, collection, options) => { calls.push({ collection, options }); return structuredClone(records[collection] || []); };
  const context = vm.createContext({ ...management, ...scorebook, safeScopeId, TextEncoder, TextDecoder,
    getSchoolStructure: async () => ({ ActiveBranchId: 'main', Branches: [{ Id: 'main' }], Sections: ['primary', 'secondary'] }),
    enforceActorBranch: (_actor, branch) => branch,
    queryCollection: read, queryCollectionPages: read, listBranchCollection: read, listSchoolCollection: read,
    getDocument: async () => { throw new Error('Opening the register must not load assessment policy'); },
    batchCommitDocuments: async (_env, changes) => { writes.push(changes); }
  });
  vm.runInContext(source.replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/^export /gm, ''), context);
  return { context, calls, writes, records };
}

test('opening the class register reads only its three selector collections, no people, scores, history, policy or writes', async () => {
  const f = fixture(), before = structuredClone(f.records);
  const data = await f.context.bootstrapAcademicManagement({}, actor, input);
  assert.deepEqual(f.calls.map(call => call.collection).sort(), ['academicClasses', 'academicSessions', 'academicTerms']);
  assert.ok(f.calls.every(call => call.options.filters.some(filter => filter.field === 'BranchId' && filter.value === 'main')));
  assert.deepEqual(Array.from(data.classes, item => item.Name), ['Grade 7']);
  assert.equal(data.selection.SessionId, 's'); assert.equal(data.selection.TermId, 't');
  assert.equal(data.scorebookWorkspaceDeferred, true);
  for (const key of ['students', 'staff', 'studentMemberships', 'teacherAllocations', 'scoreSheets', 'studentScores', 'scoreImports', 'scoreSyncBatches']) assert.equal(data[key].length, 0);
  assert.equal(data.assessmentScheme, undefined);
  assert.equal(f.writes.length, 0); assert.deepEqual(f.records, before);
});

test('explicit entry, old desktop clients and class report requests retain their required data', async () => {
  for (const [request, options, wantsScores] of [
    [{ ...input, ScorebookTask: 'entry' }, {}, false],
    [{ ...input, ScorebookTask: undefined, ScoreRowsMode: undefined }, {}, true],
    [input, { classRegister: true }, true]
  ]) {
    const f = fixture();
    const data = await f.context.bootstrapAcademicManagement({}, actor,
      { ...request, IncludeAssessmentPolicy: false }, {}, options);
    assert.equal(data.scorebookWorkspaceDeferred, false);
    assert.ok(f.calls.some(call => call.collection === 'academicStudentMemberships'));
    assert.equal(f.calls.some(call => call.collection === 'academicStudentScores'), wantsScores);
    assert.equal(f.writes.length, 0);
  }
});

test('teachers still open their allocated entry workspace instead of an unavailable class register', async () => {
  const f = fixture();
  const data = await f.context.bootstrapAcademicManagement({}, { ...actor, role: 'Teacher', username: 'teacher-1' },
    { ...input, IncludeAssessmentPolicy: false });
  assert.equal(data.scorebookWorkspaceDeferred, false);
  assert.equal(data.teacherAllocations.length, 1);
  assert.equal(data.teacherAllocations[0].TeacherUsername, 'teacher-1');
});

function clientFixture(task, deferred = false) {
  const calls = [], rendered = [];
  const payload = { SessionId: 's', TermId: 't', ClassId: 'c', ArmId: 'a', SubjectId: 'math', TeacherUsername: 't' };
  let complete;
  const context = vm.createContext({ clean: value => String(value ?? '').trim(), activeSection: 'academics', academicManagementView: 'scorebook',
    academicManagementTaskViews: { scorebook: task }, academicManagementData: { scorebookWorkspaceDeferred: deferred },
    academicScorebookDraft: {}, academicScorebookContextPayload: () => payload,
    document: { getElementById: () => ({}) }, setStatus: () => {},
    academicManagementRequest: async action => { calls.push(action); return new Promise(resolve => { complete = resolve; }); },
    renderAcademicManagement: data => rendered.push(data)
  });
  vm.runInContext(admin.match(/async function loadAcademicScorebookContext\([\s\S]*?\n}/)[0], context);
  return { context, calls, rendered, complete: () => complete({ ok: true }) };
}

test('hidden score-entry panels make no context request on register, review or scheme', async () => {
  for (const task of ['classRegister', 'workflow', 'scheme']) {
    const f = clientFixture(task);
    await f.context.loadAcademicScorebookContext(); assert.equal(f.calls.length, 0);
  }
  const f = clientFixture('entry', true);
  await f.context.loadAcademicScorebookContext(); assert.equal(f.calls.length, 0);
});

test('entry context coalesces repeated render requests and cannot replace a newly selected register', async () => {
  const f = clientFixture('entry');
  const first = f.context.loadAcademicScorebookContext();
  await f.context.loadAcademicScorebookContext();
  assert.equal(f.calls.length, 1);
  f.context.academicManagementTaskViews.scorebook = 'classRegister';
  f.complete(); await first;
  assert.equal(f.rendered.length, 0);
  assert.equal(f.context.academicScorebookDraft.loadingKey, undefined);
});

test('workspace loading requests the remembered task and defaults to the lightweight register', async () => {
  const calls = [];
  const context = vm.createContext({ clean: value => String(value ?? '').trim(), activeSection: 'academics',
    academicManagementView: 'scorebook', academicManagementLoadRequest: 0, academicManagementTaskViews: {},
    academicManagementFilters: { section: 'secondary', sessionId: 's', termId: 't' },
    academicManagementRequest: async (_action, payload) => { calls.push(payload); return {}; }, renderAcademicManagement: () => {}
  });
  vm.runInContext(admin.match(/async function loadAcademicManagement\([\s\S]*?\n}/)[0], context);
  await context.loadAcademicManagement();
  assert.equal(calls[0].ScorebookTask, 'classRegister');
  assert.equal(calls[0].WorkspaceLoadMode, 'navigation');
  context.academicManagementTaskViews.scorebook = 'entry';
  await context.loadAcademicManagement(); assert.equal(calls[1].ScorebookTask, 'entry');
  await context.loadAcademicManagement({ records: true, classId: 'c' });
  assert.equal(calls[2].WorkspaceLoadMode, 'records'); assert.equal(calls[2].RecordClassId, 'c');
});

for (const view of ['results', 'outcomes', 'analysis', 'classrooms', 'classstaff', 'teachers', 'students', 'timetable', 'presence', 'attendance', 'clearances', 'readiness', 'cbt']) {
  test(`${view}: navigation loads settings without unrequested records or history`, async () => {
    const f = fixture(), before = structuredClone(f.records);
    const data = await f.context.bootstrapAcademicManagement({}, actor, { ...input, View: view, WorkspaceLoadMode: 'navigation' });
    assert.equal(data.workspaceDataDeferred, true);
    assert.deepEqual(f.calls.map(call => call.collection).sort(), ['academicClasses', 'academicSessions', 'academicTerms']);
    assert.equal(data.termResults.length, 0); assert.equal(data.studentScores.length, 0); assert.equal(data.students.length, 0);
    assert.equal(f.writes.length, 0); assert.deepEqual(f.records, before);
  });
}

test('explicit Results reads use the selected branch, period and class without downloading raw marks or attendance', async () => {
  const f = fixture();
  f.context.getDocument = async () => ({});
  await f.context.bootstrapAcademicManagement({}, actor, { ...input, View: 'results', WorkspaceLoadMode: 'records',
    RecordClassId: 'c', SessionId: 's', TermId: 't' });
  for (const collection of ['academicResults', 'academicResultEvents', 'academicStudentMemberships']) {
    const call = f.calls.find(call => call.collection === collection);
    assert.ok(call, collection);
    assert.deepEqual(Array.from(call.options.filters, f => [f.field, f.value]), [['BranchId', 'main'], ['SessionId', 's'], ['TermId', 't'], ['ClassId', 'c']]);
  }
  assert.ok(!f.calls.some(call => ['academicStudentScores', 'academicScoreSheets', 'academicStudentAttendance'].includes(call.collection)));
  assert.equal(f.writes.length, 0);
});

test('small catalogue navigation omits membership counts while retaining the catalogue', async () => {
  const f = fixture();
  const data = await f.context.bootstrapAcademicManagement({}, actor, { ...input, View: 'structure', WorkspaceLoadMode: 'navigation' });
  assert.equal(data.workspaceDataDeferred, false);
  assert.ok(f.calls.some(call => call.collection === 'academicSubjects'));
  assert.ok(!f.calls.some(call => ['academicStudentMemberships', 'staffUsers', 'students'].includes(call.collection)));
});
