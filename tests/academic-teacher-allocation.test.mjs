import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import * as management from '../functions/lib/academic-management.js';
import * as outcomes from '../functions/lib/academic-session-outcomes.js';
import * as studentStatus from '../functions/lib/student-academic-status.js';
import { academicAssessmentScheme } from '../functions/lib/academic-scorebook.js';
import { safeScopeId } from '../functions/lib/school-scope.js';
import { normalizeClassKey } from '../functions/lib/class-names.js';

const source = await readFile(new URL('../functions/lib/academic-management.js', import.meta.url), 'utf8');
const ui = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));
const scope = { BranchId: 'garden', SchoolSection: 'primary' };
const period = { SessionId: 'session', TermId: 'term' };
const target = { ...scope, ...period, ClassId: 'class', ArmId: 'arm' };
const teacher = { username: 'teacher', role: 'Teacher', edition: 'school', branchId: 'garden', allowedSections: ['academics'] };
const id = row => row.RecordId || row.MembershipId || row.MovementId || row.AllocationId || row.AuditId || row.__id;
function harness(role = 'Form Teacher') {
  const state = Object.fromEntries(Object.keys(management.ACADEMIC_MANAGEMENT_COLLECTIONS).map(key => [key, []]));
  Object.assign(state, {
    sessions: [{ ...scope, SessionId: 'session', Name: '2026/2027', Status: 'Active' }],
    terms: [{ ...scope, ...period, Name: 'First Term', Status: 'Active' }],
    classes: [{ ...scope, ClassId: 'class', Name: 'Grade 1', SchoolStage: 'primary', Status: 'Active' },
      { ...scope, ClassId: 'other-class', Name: 'Grade 2', SchoolStage: 'primary', Status: 'Active' }],
    arms: [{ ...scope, ArmId: 'arm', ClassId: 'class', Name: 'Excellence', Status: 'Active' },
      { ...scope, ArmId: 'other-arm', ClassId: 'class', Name: 'Merit', Status: 'Active' }],
    teacherAllocations: [{ ...target, AllocationId: 'allocation', TeacherUsername: 'teacher', AllocationRole: role, Status: 'Active', __updateTime: 'a1' }],
    subjects: [{ ...scope, SubjectId: 'math', Name: 'Mathematics', Status: 'Active' }],
    offerings: [{ ...scope, ...period, ClassId: 'class', SubjectId: 'math', SubjectRole: 'Core', Compulsory: true, Status: 'Active' }],
    studentMemberships: [{ ...target, ArmId: '', MembershipId: 'legacy-pupil', StudentRef: 'P1', Status: 'Active', SubjectIds: ['math'], __updateTime: 'm1' }],
    studentScores: [{ StudentRef: 'P1', Score: 80, __id: 'saved-score' }],
    studentMovements: [{ StudentRef: 'P1', Reason: 'Preserved history', MovementId: 'history' }]
  });
  management.applyAcademicStudentCurriculum(state, state.studentMemberships[0], { allowIncompleteCurriculum: true });
  const profilePath = 'schoolBranches/garden/sections/primary/students';
  const profiles = ['P1','P2','OTHER','INACTIVE'].map(ref => ({ ...scope, AdmissionNo: ref, DisplayName: ref, __id: ref,
    AcademicClassId: ref === 'OTHER' ? 'other-class' : 'class', ClassName: ref === 'OTHER' ? 'Grade 2' : 'Grade 1',
    Status: ref === 'INACTIVE' ? 'Withdrawn' : 'Active', __scopePath: profilePath, __updateTime: 'p1', ParentPasswordHash: 'private' }));
  const store = Object.fromEntries(Object.entries(state).map(([key, rows]) => [management.ACADEMIC_MANAGEMENT_COLLECTIONS[key], rows]));
  store[profilePath] = profiles;
  const writes = [], reads = [];
  const context = vm.createContext({ ...management, ...outcomes, ...studentStatus, normalizeClassKey, academicAssessmentScheme, safeScopeId, crypto: webcrypto, TextEncoder, TextDecoder,
    listSchoolCollection: async () => copy(profiles), loadOrganizationNameProfile: async () => ({}),
    batchCommitDocuments: async (_env, batch) => {
      for (const w of batch) {
        const old = (store[w.collectionPath] || []).find(r => id(r) === w.documentId);
        if ((w.exists === false && old) || (w.updateTime && w.updateTime !== old?.__updateTime)) throw Object.assign(new Error('Conflict'), { status: 409 });
      }
      for (const w of batch) {
        const rows = store[w.collectionPath] ||= [], index = rows.findIndex(r => id(r) === w.documentId);
        const next = { ...(w.updateMask ? rows[index] : {}), ...copy(w.data), __id: w.documentId, __updateTime: 'v2' };
        if (index < 0) rows.push(next); else rows[index] = next;
      }
      writes.push(...copy(batch));
    }
  });
  vm.runInContext(source.replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/^export /gm, ''), context);
  context.academicScope = async (_env, user, input) => {
    if (input.BranchId !== scope.BranchId || input.SchoolSection !== scope.SchoolSection) throw Object.assign(new Error('Wrong scope'), { status: 403 });
    return { branchId: scope.BranchId, section: scope.SchoolSection, structure: { Sections: ['primary','secondary'] } };
  };
  context.loadScopedAcademicState = async (_env, _scope, keys, filters) => {
    reads.push({ keys: [...keys], filters: copy(filters || {}) });
    return Object.fromEntries(Object.keys(state).map(key => [key, keys.includes(key) ? copy(state[key]) : []]));
  };
  context.loadPeople = async (_env, _actor, _scope, opts = {}) => ({ students: opts.students === false ? [] : copy(profiles), staff: [] });
  context.loadAcademicManagementSummary = async () => ({});
  const bootstrap = context.bootstrapAcademicManagement;
  context.bootstrapAcademicManagement = async () => ({ ok: true });
  const actor = context.academicWebActor(teacher);
  return { state, profiles, context, writes, reads, actor,
    allocate: (patch = {}, user = actor) => context.bulkAllocateAcademicStudents({}, user, { ...target, StudentRefs: ['P1','P2'], ...patch }),
    bootstrap: patch => bootstrap({}, actor, { ...target, View: 'students', WorkspaceLoadMode: 'records', RecordClassId: 'class', ...patch }) };
}

for (const role of ['Form Teacher','Assistant Teacher']) test(`${role} allocates initial pupils, preserves records and retry writes nothing`, async () => {
  const h = harness(role), history = copy(h.state.studentMovements), scores = copy(h.state.studentScores);
  const result = await h.allocate({ MembershipId: 'forged', SubjectIds: ['forged'], Status: 'Archived' });
  assert.equal(result.bulkResult.Allocated, 2);
  assert.equal(h.state.studentMemberships.length, 2);
  assert.equal(h.state.studentMemberships[0].MembershipId, 'legacy-pupil');
  assert.equal(h.state.studentMemberships[0].ArmId, 'arm');
  assert.deepEqual(h.state.studentMemberships[0].SubjectIds, ['math']);
  assert.deepEqual(h.state.studentScores, scores);
  assert.deepEqual(h.state.studentMovements[0], history[0]);
  const writeCount = h.writes.length;
  assert.equal((await h.allocate()).bulkResult.Skipped, 2);
  assert.equal(h.writes.length, writeCount);
  assert.ok(h.reads.every(r => !r.keys.includes('studentMovements') && !r.keys.includes('studentScores')));
  assert.ok(h.reads.every(r => r.filters.SessionId === 'session' && r.filters.TermId === 'term'));
});

test('new capability does not grant transfers, imports, generic writes, archiving or desktop access', async () => {
  const h = harness(), p = h.context.academicManagementCapabilities(h.actor);
  assert.equal(p.canAllocateClassStudents, true);
  for (const key of ['canManageAllocations','canManageStructure','canArchive','canDelete']) assert.equal(p[key], false);
  for (const fn of ['bulkImportAcademicStudentMemberships','manageAcademicStudentMembership','saveAcademicManagementRecord']) {
    await assert.rejects(h.context[fn]({}, h.actor, { ...target, RecordType: 'studentmembership' }), { status: 403 });
  }
  await assert.rejects(h.context.archiveAcademicManagementRecord({}, h.actor, { ...target, RecordType: 'arm' }), { status: 403 });
  await assert.rejects(h.allocate({}, teacher), { status: 403 });
  assert.equal(h.writes.length, 0);
});

test('subject-only, revoked, other-arm, other-term and foreign-scope attempts fail atomically', async () => {
  for (const patch of [{ ArmId: 'other-arm' }, { ClassId: 'other-class' }, { TermId: 'other-term' }, { BranchId: 'other' }, { SchoolSection: 'secondary' }]) {
    const h = harness(); await assert.rejects(h.allocate(patch), { status: 403 }); assert.equal(h.writes.length, 0);
  }
  for (const change of [{ AllocationRole: 'Subject Teacher' }, { Status: 'Inactive' }, { TeacherUsername: 'someone-else' }]) {
    const h = harness(); Object.assign(h.state.teacherAllocations[0], change);
    await assert.rejects(h.allocate(), { status: 403 }); assert.equal(h.writes.length, 0);
  }
});

test('assigned, wrong-class and withdrawn pupils cannot be taken through initial allocation', async () => {
  for (const kind of ['assigned','wrong-class','withdrawn']) {
    const h = harness();
    if (kind === 'assigned') h.state.studentMemberships[0].ArmId = 'other-arm';
    const refs = kind === 'wrong-class' ? ['P2','OTHER'] : kind === 'withdrawn' ? ['P2','INACTIVE'] : ['P2','P1'];
    await assert.rejects(h.allocate({ StudentRefs: refs }), { status: 409 });
    assert.equal(h.writes.length, 0, 'no partial batch');
  }
});

test('assignment revocation during saving aborts the entire placement batch', async () => {
  const h = harness(), commit = h.context.batchCommitDocuments;
  h.context.batchCommitDocuments = async (...args) => { h.state.teacherAllocations[0].__updateTime = 'revoked'; return commit(...args); };
  await assert.rejects(h.allocate(), { code: 'ACADEMIC_WRITE_CONFLICT' });
  assert.equal(h.writes.length, 0);
  assert.equal(h.state.studentMemberships[0].ArmId, '');
});

test('teacher bootstrap supplies only eligible candidates separately, without scores, history or private profile fields', async () => {
  const h = harness('Assistant Teacher');
  const data = await h.bootstrap();
  assert.deepEqual(copy(data.allocationCandidates.map(r => r.StudentRef)), ['P1','P2']);
  assert.ok(data.classes.some(r => r.ClassId === 'class'));
  assert.ok(data.arms.some(r => r.ArmId === 'arm')); // Existing subject-teacher labels are retained.
  assert.equal(data.students.length, 0, 'normal classroom visibility is not widened');
  assert.equal(JSON.stringify(data.allocationCandidates).includes('ParentPassword'), false);
  assert.ok(h.reads.every(r => !r.keys.includes('studentMovements') && !r.keys.includes('studentScores')));
  const navigation = await h.bootstrap({ WorkspaceLoadMode: 'navigation' });
  assert.equal(navigation.allocationCandidates.length, 0);
  assert.ok(!h.reads.at(-1).keys.includes('studentMemberships'));
});

test('teachers without a current homeroom assignment receive no candidate pupils', async () => {
  const h = harness('Subject Teacher'), data = await h.bootstrap();
  assert.equal(data.allocationCandidates.length, 0);
  assert.equal(data.permissions.canManageAllocations, false);
});

function declaration(name) {
  const start = ui.indexOf(`function ${name}(`), end = ui.indexOf('\nfunction ', start + 1);
  assert.ok(start >= 0, name); return ui.slice(start, end);
}
export function allocationUiFixture(role = 'Assistant Teacher') {
  const h = harness(role), data = copy(h.state);
  data.permissions = { canAllocateClassStudents: true, canManageAllocations: false, teacherView: true };
  data.allocationPeriod = { ...scope, ...period };
  data.allocationCandidates = [{ StudentRef: 'P1', StudentName: 'Test Pupil', AcademicClassId: 'class', SchoolSection: 'primary' }];
  data.students = [];
  const c = vm.createContext({ clean: value => String(value ?? '').trim(), escapeHtml: value => String(value ?? ''),
    academicManagementFilters: { section: 'primary', sessionId: 'session', termId: 'term' }, academicStudentAllocationDraft: {}, academicManagementData: data,
    academicLearnerTerms: () => ({ singular: 'pupil', plural: 'pupils', Singular: 'Pupil', Plural: 'Pupils' }),
    academicSchoolStageLabel: () => 'Primary', academicArmSubjectRegister: () => '', academicArchivedMembershipWorkspace: () => '',
    table: () => '', academicCheckboxField: () => '<div data-academic-checkbox-purpose="student-arm-candidates"><div class="academic-checkbox-options"></div><small data-academic-checkbox-help></small></div>',
    academicCheckboxChoices: (_name, options) => options.map(o => `<label><input type="checkbox" name="StudentRefs" value="${o.value}">${o.label}</label>`).join(''),
    updateAcademicCheckboxCount: () => {}, filterAcademicStudentCandidateOptions: () => {}
  });
  const names = ['academicCheckboxChoices','academicCheckboxField','academicCheckboxInputs','updateAcademicCheckboxCount','filterAcademicStudentCandidateOptions','academicRecordId','academicIsActive','academicFind','academicLabel','academicSelectOptions','academicStudentBelongsToClass',
    'academicStudentAllocationCandidates','academicStudentPlacementClassrooms','academicCurrentMembershipRegisterRows','academicStudentWorkspace','syncAcademicStudentPlacementForm'];
  vm.runInContext(names.map(declaration).join('\n'), c);
  return { html: c.academicStudentWorkspace(data, data), scripts: names.map(declaration).join('\n'), context: c, data };
}

test('teacher form renders Allocate only, with the assigned classroom and eligible pupil', () => {
  const f = allocationUiFixture();
  assert.match(f.html, /bulkAllocateAcademicStudents/);
  assert.doesNotMatch(f.html, /moveAcademicStudentMembership|student-membership-import|value="other-arm"|value="other-class"/);
  assert.match(f.html, /value="arm" selected/);
  assert.equal(f.context.academicStudentAllocationCandidates('session','term','class').candidates.length, 1);
  assert.equal(f.context.academicStudentAllocationCandidates('session','other-term','class').candidates.length, 0);
});

for (const section of ['primary','secondary']) test(`classroom assignment checks the complete scope for ${section}`, () => {
  const h = harness(), actor = management.academicWebActor(teacher);
  for (const key of ['classes','arms','teacherAllocations']) h.state[key].forEach(row => row.SchoolSection = section);
  const input = { ...target, SchoolSection: section };
  assert.equal(management.academicStudentAllocationClassrooms(h.state, actor, input).length, 1);
  for (const field of ['BranchId','SchoolSection','SessionId','TermId']) {
    assert.equal(management.academicStudentAllocationClassrooms(h.state, actor, { ...input, [field]: 'other' }).length, 0);
  }
});

test('candidate visibility never mistakes another arm placement or duplicate for unassigned', async () => {
  const h = harness();
  h.state.studentMemberships[0].ArmId = 'other-arm';
  let data = await h.bootstrap();
  assert.deepEqual(copy(data.allocationCandidates.map(r => r.StudentRef)), ['P2']);
  h.state.studentMemberships.push({ ...h.state.studentMemberships[0], MembershipId: 'duplicate', ArmId: '' });
  data = await h.bootstrap();
  assert.deepEqual(copy(data.allocationCandidates.map(r => r.StudentRef)), ['P2']);
});
