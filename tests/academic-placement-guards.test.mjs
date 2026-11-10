import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { appendAcademicPlacementGuards, academicPlacementGuardWrites, readStudentPlacementGuards, studentPlacementAcquired } from '../functions/lib/academic-placement-guards.js';
import { safeScopeId, schoolSectionFor, scopedCollectionPath } from '../functions/lib/school-scope.js';
import { studentStatusChanged, studentProfileHasChanges } from '../functions/lib/student-academic-status.js';

const scope = { branchId: 'garden', section: 'primary' };
const fields = { BranchId: 'garden', SchoolSection: 'primary', Status: 'Active' };
const state = () => ({ classes: [{ ...fields, ClassId: 'class', Name: 'Nursery 2', __updateTime: 'c1' }],
  arms: [{ ...fields, ClassId: 'class', ArmId: 'arm', Name: 'Excellence', __updateTime: 'a1' }], studentMemberships: [] });
const member = { ...fields, MembershipId: 'member', ClassId: 'class', ArmId: 'arm', StudentRef: 'P1', SessionId: 'session', TermId: 'term' };
const profilePath = 'schoolBranches/garden/sections/primary/students';
const profile = { ...fields, AdmissionNo: 'P1', ClassName: 'NURSERY2', ClassArm: 'EXCELLENCE', AcademicClassId: 'class', AcademicArmId: 'arm' };
const memberWrite = row => ({ collectionPath: 'academicStudentMemberships', documentId: row.MembershipId, data: row, exists: false });

function database() {
  const s = state(), records = new Map([
    ['academicClasses/class', structuredClone(s.classes[0])], ['academicArms/arm', structuredClone(s.arms[0])],
    ['payments/receipt', { Amount: 1000, __updateTime: 'p1' }], ['academicStudentScores/score', { Score: 87, __updateTime: 's1' }]
  ]), reads = [], commits = [];
  let revision = 1;
  const db = {
    getDocument: async (_env, path, id) => { reads.push([path, id]); return structuredClone(records.get(`${path}/${id}`) || null); },
    queryCollectionPages: async (_env, path, options) => {
      reads.push([path, options]);
      assert.ok(['academicClasses', 'academicArms'].includes(path));
      assert.ok(options.maxRows <= 1000);
      return [...records].filter(([key, row]) => key.startsWith(`${path}/`) && options.filters.every(f => row[f.field] === f.value)).map(([,row]) => structuredClone(row));
    },
    batchCommitDocuments: async (_env, writes) => {
      for (const w of writes) {
        const row = records.get(`${w.collectionPath}/${w.documentId}`);
        if ((w.updateTime && w.updateTime !== row?.__updateTime) || (w.exists === false && row)) throw Object.assign(new Error('Conflict'), { status: 409 });
      }
      commits.push(structuredClone(writes));
      return { writeResults: writes.map(w => {
        const key = `${w.collectionPath}/${w.documentId}`;
        if (w.operation === 'delete') { records.delete(key); return {}; }
        const next = { ...(w.updateMask ? records.get(key) : {}), ...structuredClone(w.data), __updateTime: `r${++revision}` };
        records.set(key, next); return { updateTime: next.__updateTime };
      }) };
    }
  };
  return { s, records, reads, commits, db };
}

test('100 allocations share one class and one arm fence without touching scores or financial history', async () => {
  const h = database(), writes = Array.from({ length: 100 }, (_,i) => memberWrite({ ...member, MembershipId: `m${i}`, StudentRef: `P${i}` }));
  appendAcademicPlacementGuards(writes, h.s, scope);
  appendAcademicPlacementGuards(writes, h.s, scope);
  assert.equal(writes.length, 102);
  const before = structuredClone([...h.records].filter(([key]) => /payments|Scores/.test(key)));
  await h.db.batchCommitDocuments({}, writes);
  assert.deepEqual([...h.records].filter(([key]) => /payments|Scores/.test(key)), before);
  assert.equal(h.reads.length, 0);
});

for (const path of ['academicClasses', 'academicArms']) for (const deletionFirst of [true, false]) {
  test(`${path}: ${deletionFirst ? 'deletion' : 'allocation'} commits first; competing change cannot partially commit`, async () => {
    const h = database(), target = path === 'academicClasses' ? 'class' : 'arm';
    const deletion = [{ collectionPath: path, documentId: target, updateTime: path === 'academicClasses' ? 'c1' : 'a1', operation: 'delete' }];
    const allocation = appendAcademicPlacementGuards([memberWrite(member), { collectionPath: profilePath, documentId: 'P1', data: profile, exists: false }], h.s, scope);
    await h.db.batchCommitDocuments({}, deletionFirst ? deletion : allocation);
    await assert.rejects(h.db.batchCommitDocuments({}, deletionFirst ? allocation : deletion), { status: 409 });
    assert.equal(h.records.has('academicStudentMemberships/member'), !deletionFirst);
    assert.equal(h.records.has(`${profilePath}/P1`), !deletionFirst);
    assert.equal(h.records.has(`${path}/${target}`), !deletionFirst);
    assert.equal(h.commits.length, 1);
  });
}

test('subject edits, inactive history and unchanged retries add no destination writes', async () => {
  const s = state(); s.studentMemberships.push(member);
  const writes = [memberWrite({ ...member, SubjectIds: ['math'] }), memberWrite({ ...member, MembershipId: 'history', Status: 'Withdrawn' }),
    { collectionPath: 'academicStudentScores', documentId: 'score', data: { Score: 90 } }];
  appendAcademicPlacementGuards(writes, s, scope);
  assert.equal(writes.length, 3);
  const h = database();
  assert.deepEqual(await readStudentPlacementGuards({}, profile, { ...profile, ParentPhone: 'new' }, h.db), []);
  assert.equal(h.reads.length, 0);
  assert.equal(studentPlacementAcquired({ ...profile, Status: 'Expelled' }, profile), true);
});

test('transfer, promotion and reinstatement acquire the destination fence', () => {
  for (const before of [{ ...member, ArmId: 'old' }, { ...member, Status: 'Withdrawn' }, { ...member, TermId: 'old-term' }]) {
    const s = state(); s.studentMemberships.push(before);
    assert.equal(appendAcademicPlacementGuards([memberWrite(member)], s, scope).length, 3);
  }
  const writes = [{ collectionPath: profilePath, documentId: 'P1', data: profile, exists: false }];
  assert.equal(appendAcademicPlacementGuards(writes, state(), scope).length, 3);
});

test('unknown, ambiguous, inactive and cross-branch destinations fail closed; names never override stable IDs', async () => {
  for (const alter of [s => s.classes.splice(0), s => s.classes[0].BranchId = 'main', s => s.arms[0].SchoolSection = 'secondary',
    s => s.arms[0].Status = 'Archived', s => delete s.classes[0].__updateTime]) {
    const s = state(); alter(s);
    assert.throws(() => academicPlacementGuardWrites(s, member, scope), { code: 'ACADEMIC_PLACEMENT_CONFLICT' });
  }
  const h = database();
  assert.equal((await readStudentPlacementGuards({}, null, profile, h.db)).length, 2);
  assert.equal(h.reads.length, 2, 'stable IDs use two exact reads');
  await assert.rejects(readStudentPlacementGuards({}, null, { ...profile, ClassName: 'Grade 1' }, h.db), { code: 'ACADEMIC_PLACEMENT_CONFLICT' });
  h.records.set('academicClasses/duplicate', { ...fields, ClassId: 'duplicate', Name: 'NURSERY2', __updateTime: 'other' });
  await assert.rejects(readStudentPlacementGuards({}, null, { ...profile, AcademicClassId: '' }, h.db), { code: 'ACADEMIC_PLACEMENT_CONFLICT' });
});

test('common profile-only import/enrollment saves placement and profile atomically; ordinary edits read no catalogue', async () => {
  const h = database();
  const source = await readFile(new URL('../functions/lib/school-scope.js', import.meta.url), 'utf8');
  let beforeCommit = () => {};
  const context = vm.createContext({ clean: value => String(value ?? '').trim(), safeScopeId, schoolSectionFor, scopedCollectionPath,
    withStudentProfileDefaults: row => ({ ...row }), getSchoolStructure: async () => ({ ActiveBranchId: 'garden' }),
    studentStatusChanged, studentProfileHasChanges, getDocument: h.db.getDocument,
    readStudentPlacementGuards: (env,before,after) => readStudentPlacementGuards(env,before,after,h.db),
    batchCommitDocuments: async (env,writes) => { beforeCommit(); return h.db.batchCommitDocuments(env,writes); },
    upsertDocument: async (env,path,id,data,options) => (await h.db.batchCommitDocuments(env,[{collectionPath:path,documentId:id,data,...options}])).writeResults[0]
  });
  vm.runInContext(source.slice(source.indexOf('export async function upsertSchoolDocument'), source.indexOf('export async function deleteSchoolDocument')).replace('export ', ''), context);
  beforeCommit = () => h.records.delete('academicArms/arm');
  await assert.rejects(context.upsertSchoolDocument({}, 'students', 'P1', profile, { exists: false }), { status: 409 });
  assert.equal(h.records.has(`${profilePath}/P1`), false);
  h.records.set('academicArms/arm', state().arms[0]); beforeCommit = () => {};
  const saved = await context.upsertSchoolDocument({}, 'students', 'P1', profile, { exists: false });
  assert.equal(h.commits[0].length, 3);
  assert.ok(saved.__updateTime);
  const priorReads = h.reads.length;
  await context.upsertSchoolDocument({}, 'students', 'P1', { ...saved, ParentPhone: 'new' });
  assert.equal(h.reads.length - priorReads, 1, 'only existing profile revision read for unrelated edit');
  assert.equal(h.commits.at(-1).length, 1);
});
