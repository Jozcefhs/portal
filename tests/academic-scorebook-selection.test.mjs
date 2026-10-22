import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const body = source.slice(source.indexOf('function selectAcademicScorebookClassroom('),
  source.indexOf('function readAcademicCbtStepOne('));

function harness() {
  const renders = [], statuses = [], requests = [];
  const data = {
    arms: [{ ArmId: 'a', ClassId: 'grade7' }, { ArmId: 'b', ClassId: 'grade10' }],
    subjects: [{ SubjectId: 'assembly', AssessmentCategory: 'TimetableOnly' }, { SubjectId: 'math' }, { SubjectId: 'art' }],
    teacherAllocations: [
      { ClassId: 'grade7', ArmId: 'a', SubjectId: 'math', TeacherUsername: 'math.teacher', AllocationRole: 'Subject Teacher' },
      { ClassId: 'grade10', ArmId: 'b', SubjectId: 'assembly', TeacherUsername: 'form.teacher', AllocationRole: 'Subject Teacher' },
      { ClassId: 'grade10', ArmId: 'b', SubjectId: 'art', TeacherUsername: 'art.teacher', AllocationRole: 'Subject Teacher' }
    ]
  };
  const runtime = vm.createContext({
    academicManagementData: data,
    academicScorebookDraft: { armId: 'a', subjectId: 'math', teacherUsername: 'math.teacher', importPreview: { old: true } },
    academicManagementFilters: { section: 'secondary', sessionId: 'session', termId: 'term' },
    activeSection: 'academics', academicManagementView: 'scorebook',
    clean: value => String(value ?? '').trim(),
    academicFind: (rows, id) => rows.find(row => [row.ArmId, row.SubjectId].includes(id)),
    academicCurrentRows: value => value, academicIsActive: row => row.Status !== 'Inactive',
    document: { getElementById: () => ({}) },
    setStatus: (_element, message, kind) => statuses.push({ message, kind }),
    renderAcademicManagement: value => renders.push(value),
    academicManagementRequest: (action, payload) => new Promise((resolve, reject) => requests.push({ action, payload, resolve, reject }))
  });
  vm.runInContext(body, runtime);
  return { runtime, renders, requests, statuses, data };
}

test('classroom change renders dependent options immediately, without waiting for a request', () => {
  const { runtime, renders, requests, data } = harness();
  const before = structuredClone(data);
  runtime.selectAcademicScorebookClassroom('b');
  assert.equal(renders.length, 1);
  assert.equal(requests.length, 0);
  assert.equal(runtime.academicScorebookDraft.subjectId, '');
  assert.equal(runtime.academicScorebookDraft.importPreview, null);
  const payload = runtime.academicScorebookContextPayload();
  assert.equal(payload.ArmId, 'b');
  assert.equal(payload.SubjectId, 'art');
  assert.equal(payload.TeacherUsername, 'art.teacher');
  assert.deepEqual(data, before);
  assert.match(source, /selectAcademicScorebookClassroom\(event.target.value\)/);
  assert.match(source, /if \(academicManagementView === 'scorebook'\) queueMicrotask/);
});

test('rapid classroom changes ignore the earlier response and load the latest subject', async () => {
  const { runtime, requests, renders } = harness();
  const old = runtime.loadAcademicScorebookContext();
  runtime.selectAcademicScorebookClassroom('b');
  const current = runtime.loadAcademicScorebookContext();
  requests[1].resolve({ message: 'New classroom' });
  await current;
  requests[0].resolve({ message: 'Old classroom' });
  await old;
  assert.equal(renders.length, 2);
  assert.equal(renders[1].message, 'New classroom');
  assert.equal(runtime.academicScorebookDraft.subjectId, 'art');
});

test('an old classroom request failure cannot replace the current status', async () => {
  const { runtime, requests, statuses } = harness();
  const old = runtime.loadAcademicScorebookContext();
  runtime.selectAcademicScorebookClassroom('b');
  requests[0].reject(new Error('Old classroom failed'));
  await old;
  assert.equal(statuses.some(row => row.kind === 'bad'), false);
});

test('a classroom without scoreable allocations does not retain the previous subject', () => {
  const { runtime, data, renders, requests } = harness();
  data.teacherAllocations = data.teacherAllocations.filter(row => row.ClassId !== 'grade10');
  runtime.selectAcademicScorebookClassroom('b');
  assert.equal(renders.length, 1);
  assert.equal(runtime.academicScorebookContextPayload(), null);
  assert.equal(runtime.academicScorebookDraft.subjectId, '');
  assert.equal(requests.length, 0);
});
