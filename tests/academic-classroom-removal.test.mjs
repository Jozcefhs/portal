import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { checkClassroomRemovals } from '../functions/lib/academic-classroom-removal.js';

function fixture() {
  const arms = [8, 9, 10, 11, 12].map(grade => ({ ArmId: `g${grade}-virtue`, ClassId: `g${grade}`,
    Name: 'Virtue', Code: 'VIR', BranchId: 'main', SchoolSection: 'secondary', Status: 'Active',
    IsClassroom: true, __updateTime: 'rev1' }));
  return {
    input: { ClassIds: arms.map(row => row.ClassId), ArmTemplateIds: [], ConfirmClassroomRemoval: true,
      RemoveClassrooms: arms.map(row => ({ ArmId: row.ArmId, RevisionToken: row.__updateTime })) },
    state: { arms, classes: arms.map(row => ({ ClassId: row.ClassId, Name: `Grade ${row.ClassId.slice(1)}`, SchoolSection: 'secondary' })), armTemplates: [] },
    scope: { branchId: 'main', section: 'secondary' }, query: async () => [], students: async () => []
  };
}
test('five unused Virtue classrooms can be archived without mutating their records', async () => {
  const f = fixture(), before = structuredClone(f.state), calls = [];
  f.query = async (collection, options) => { calls.push({ collection, options }); return []; };
  assert.equal((await checkClassroomRemovals(f)).length, 5);
  assert.deepEqual(f.state, before);
  assert.ok(calls.length > 15);
  assert.ok(calls.every(call => call.options.limit === 1 && call.options.filters[0].value.length === 5));
});
test('removal blocks on any historical student, assessment, attendance, diary or movement reference', async () => {
  for (const collection of ['academicStudentMemberships', 'academicScoreSheets', 'academicStudentScores',
    'academicCbtTests', 'academicStudentAttendance', 'academicWeeklyDiaries', 'academicStudentMovements']) {
    const f = fixture();
    f.query = async name => name === collection ? [{ Status: 'Archived' }] : [];
    await assert.rejects(checkClassroomRemovals(f), { code: 'ACADEMIC_CLASSROOM_REMOVAL_BLOCKED' });
  }
});
test('legacy student profiles without memberships also block removal', async () => {
  for (const student of [{ ClassName: 'Grade 8', ClassArm: 'Virtue' }, { AcademicArmId: 'g12-virtue' }]) {
    const f = fixture(); f.students = async () => [student];
    await assert.rejects(checkClassroomRemovals(f), /student profile/);
  }
});
test('confirmation, scope, exact selection and revision are required', async () => {
  for (const change of [f => { f.input.ConfirmClassroomRemoval = false; },
    f => { f.input.ClassIds = ['g8']; }, f => { f.scope.branchId = 'other'; },
    f => { f.scope.section = 'primary'; }, f => { f.input.RemoveClassrooms[0].RevisionToken = 'stale'; },
    f => { f.input.RemoveClassrooms.push(f.input.RemoveClassrooms[0]); }]) {
    const f = fixture(); change(f); await assert.rejects(checkClassroomRemovals(f));
  }
});
test('failed dependency reads fail closed; no removal requested causes no reads', async () => {
  const f = fixture(); f.query = async () => { throw new Error('offline'); };
  await assert.rejects(checkClassroomRemovals(f), /offline/);
  f.input.RemoveClassrooms = [];
  assert.deepEqual(await checkClassroomRemovals(f), []);
});

const source = await readFile(new URL('../functions/lib/academic-management.js', import.meta.url), 'utf8');
const body = source.slice(source.indexOf('export async function bulkApplyAcademicArmTemplates('),
  source.indexOf('export async function bulkApplyAcademicSubjects(')).replace('export ', '');
function runtime(f) {
  const commits = [], capabilities = [];
  const ctx = vm.createContext({ checkClassroomRemovals, requireWritableSubscription: () => {},
    requireCapability: (_user, name) => capabilities.push(name), academicScope: async () => f.scope,
    uniqueIds: value => value || [], loadScopedAcademicState: async () => f.state,
    findById: (rows, id) => rows.find(row => row.ClassId === id), assertReference: row => row,
    lower: value => String(value || '').toLowerCase(), clean: value => String(value || '').trim(),
    queryCollection: (_env, collection, options) => f.query(collection, options),
    loadPeople: async () => ({ students: await f.students() }),
    withoutMetadata: row => Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('__'))),
    nowIso: () => 'now', actorName: () => 'Manager', stampAcademicRecord: () => {},
    ACADEMIC_MANAGEMENT_COLLECTIONS: { arms: 'academicArms' },
    legacyClassWrite: (state, schoolClass) => ({ collectionPath: 'legacy', documentId: schoolClass.ClassId,
      data: { Arms: state.arms.filter(row => row.ClassId === schoolClass.ClassId && row.Status === 'Active').map(row => row.Name) } }),
    auditWrite: () => ({ collectionPath: 'audit' }), commitAcademicBatch: async (_env, writes) => commits.push(writes),
    bootstrapAcademicManagement: async () => ({}), failure: message => new Error(message) });
  vm.runInContext(body, ctx);
  return { ctx, commits, capabilities };
}
test('removal-only bulk save atomically archives targets and updates the legacy classroom list', async () => {
  const f = fixture(), { ctx, commits, capabilities } = runtime(f);
  const result = await ctx.bulkApplyAcademicArmTemplates({}, {}, f.input);
  assert.equal(result.bulkResult.Removed, 5);
  assert.ok(capabilities.includes('canArchive'));
  assert.equal(commits.length, 1);
  assert.equal(commits[0].filter(write => write.data?.Status === 'Archived').length, 5);
  assert.ok(commits[0].filter(write => write.collectionPath === 'legacy').every(write => !write.data.Arms.length));
  assert.ok(commits[0].every(write => write.operation !== 'delete'));
  assert.ok(f.state.arms.every(row => row.Status === 'Active'));
});
test('a linked classroom blocks the entire batch before any write', async () => {
  const f = fixture(); f.query = async () => [{ ArmId: 'g9-virtue' }];
  const { ctx, commits } = runtime(f);
  await assert.rejects(ctx.bulkApplyAcademicArmTemplates({}, {}, f.input));
  assert.equal(commits.length, 0);
});

test('unchecking Virtue names only the selected classroom targets and rechecking cancels removal', async () => {
  const admin = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
  const { state } = fixture();
  state.arms.forEach(row => { row.RevisionToken = row.__updateTime; row.ArmTemplateId = 'virtue'; });
  const inputs = [...state.classes.map(row => ({ name: 'ClassIds', value: row.ClassId, checked: true })),
    { name: 'ArmTemplateIds', value: 'virtue', checked: false }];
  const field = { dataset: {} }, summary = {};
  const form = {
    querySelectorAll: selector => inputs.filter(input => selector === `input[name="${input.name}"]`),
    querySelector: selector => selector.includes('summary') ? summary : field,
    addEventListener: (_event, listener) => { form.change = listener; }
  };
  const ctx = vm.createContext({
    clean: value => String(value || '').trim(), academicIsActive: row => row.Status === 'Active',
    academicCheckedValues: (_form, name) => inputs.filter(input => input.name === name && input.checked).map(input => input.value),
    setAcademicCheckedValues: (_form, name, values) => inputs.filter(input => input.name === name).forEach(input => { input.checked = values.includes(input.value); })
  });
  vm.runInContext(admin.slice(admin.indexOf('function academicExistingClassroomTemplateIds('),
    admin.indexOf('function academicSavedClassSubjectIds(')), ctx);
  ctx.bindAcademicClassroomArmSelection(form, state.arms, [{ ArmTemplateId: 'virtue', Name: 'Virtue', Status: 'Active' }]);
  const virtue = inputs.at(-1);
  assert.equal(virtue.checked, true);
  assert.equal(form._academicClassroomRemovals.length, 0);
  virtue.checked = false; form.change({ target: virtue });
  assert.equal(form._academicClassroomRemovals.length, 5);
  assert.equal(field.dataset.academicCheckboxRequired, 'false');
  assert.ok(form._academicClassroomRemovals.every(row => row.RevisionToken === 'rev1'));
  inputs[0].checked = false; form.change({ target: inputs[0] });
  assert.equal(form._academicClassroomRemovals.length, 4);
  virtue.checked = true; form.change({ target: virtue });
  assert.equal(form._academicClassroomRemovals.length, 0);
  assert.match(admin, /payload.ConfirmClassroomRemoval = true/);
});
