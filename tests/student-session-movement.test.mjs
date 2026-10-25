import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { moveStudentSession } from '../functions/lib/student-session-movement.js';

const clone = value => structuredClone(value);
const scope = { BranchId: 'main', SchoolSection: 'secondary', Status: 'Active' };
const actor = { edition: 'school', username: 'admin', role: 'Super Admin', branchId: 'main', allowedSections: ['admissions', 'academics'] };
const profilePath = 'schoolBranches/main/sections/secondary/students';
const original = { ...scope, __id: 'S-1', __scopePath: profilePath, __updateTime: 'p1', AdmissionNo: 'S/1',
  ClassName: 'Grade 11', ClassAdmitted: 'Grade 11', ClassArm: 'Merit', AcademicSession: '2026/2027', Term: 'Third Term',
  AcademicMembershipId: 'old-member', WalletBalance: 1000, MedicalCondition: 'Retain', ParentPhone: '000123', PromotionHistory: 'Prior movement' };
const input = { NewClass: 'Grade 12', AcademicSession: '2027/2028', Term: 'First Term', AcademicProgress: 'Promoted', RevisionToken: 'p1' };
const row = (__id, values) => ({ ...scope, __id, __updateTime: `${__id}-v1`, ...values });
function harness() {
  const store = {
    [profilePath]: [clone(original)],
    academicSessions: [row('old-session', { SessionId: 'old-session', Name: '2026/2027' }), row('session', { SessionId: 'session', Name: '2027/2028' })],
    academicTerms: [row('old-term', { TermId: 'old-term', SessionId: 'old-session', Name: 'Third Term' }), row('term', { TermId: 'term', SessionId: 'session', Name: 'First Term' })],
    academicClasses: [row('grade12', { ClassId: 'grade12', Name: 'Grade 12', SchoolStage: 'senior-secondary' })],
    academicArms: [row('merit', { ArmId: 'merit', ClassId: 'grade12', Name: 'Merit', DepartmentId: 'science' })],
    academicDepartments: [row('science', { DepartmentId: 'science', Name: 'Science', Code: 'SCI', SchoolStage: 'senior-secondary', CoreSubjectIds: ['math'] })],
    academicSubjects: [row('math', { SubjectId: 'math', Name: 'Mathematics' })], academicSubjectOfferings: [],
    academicStudentMemberships: [row('old-member', { MembershipId: 'old-member', RecordId: 'old-member', StudentRef: 'S/1', ClassId: 'grade11',
      ArmId: 'grade11-merit', SessionId: 'old-session', TermId: 'old-term', SubjectIds: ['math', 'physics'], PendingSubjectChange: { RequestId: 'history' } })],
    academicStudentMovements: [], academicManagementAudit: [],
    academicStudentScores: [{ RawScore: 0, StudentRef: 'S/1', Answers: ['A', 'B'] }], payments: [{ Amount: 25000, Reference: 'PAY-01' }],
    attendance: [{ StudentRef: 'S/1', Present: true }]
  };
  const writes = [], reads = [], cache = new Map();
  let sequence = 0, hook = () => {}, loseResponse = false;
  const dependencies = {
    now: '2026-10-25T10:00:00Z',
    getDocument: async (_env, collection, id) => { reads.push([collection, id]); return clone((store[collection] || []).find(row => row.__id === id) || null); },
    listBranchCollection: async (_env, collection, branch) => { assert.equal(branch, 'main'); reads.push([collection]); return clone(store[collection] || []); },
    queryCollectionPages: async (_env, collection, options) => {
      assert.equal(collection, 'academicStudentMemberships');
      reads.push([collection, options]);
      return clone(store[collection].filter(row => options.filters.every(f => f.op === 'in' ? f.value.includes(row[f.field]) : row[f.field] === f.value)));
    },
    batchCommitDocuments: async (_env, batch) => {
      hook();
      for (const write of batch) {
        assert.ok(!['payments', 'academicStudentScores', 'attendance'].includes(write.collectionPath));
        assert.notEqual(write.operation, 'delete');
        const existing = (store[write.collectionPath] || []).find(row => row.__id === write.documentId);
        if ((write.updateTime && write.updateTime !== existing?.__updateTime) || (write.exists === false && existing)) throw Object.assign(new Error('Race'), { status: 412 });
      }
      writes.push(clone(batch));
      const writeResults = batch.map(write => {
        const rows = store[write.collectionPath] ||= [];
        const index = rows.findIndex(row => row.__id === write.documentId);
        const next = { ...(write.updateMask ? rows[index] : {}), ...clone(write.data), __id: write.documentId, __updateTime: `r${++sequence}` };
        if (index < 0) rows.push(next); else rows[index] = next;
        return { updateTime: next.__updateTime };
      });
      if (loseResponse) { loseResponse = false; throw Object.assign(new Error('Connection lost after commit'), { status: 503 }); }
      return { writeResults };
    }
  };
  return { store, writes, reads, cache, dependencies, current: () => store[profilePath][0], hook: fn => { hook = fn; }, lose: () => { loseResponse = true; },
    run: (patch = {}, user = actor) => moveStudentSession({}, user, { ...clone(store[profilePath][0]), __scopePath: profilePath }, { ...input, ...patch }, cache, dependencies) };
}

test('session movement atomically updates the profile and actual membership, retaining all historical evidence', async () => {
  const h = harness(), historical = clone(h.store.academicStudentMemberships[0]);
  const protectedData = clone([h.store.academicStudentScores, h.store.payments, h.store.attendance]);
  assert.equal((await h.run()).status, 'moved');
  assert.equal(h.current().ClassName, 'Grade 12');
  assert.equal(h.current().AcademicSession, '2027/2028');
  const destination = h.store.academicStudentMemberships.find(row => row.MembershipId === h.current().AcademicMembershipId);
  assert.equal(destination.ClassId, 'grade12'); assert.equal(destination.ArmId, 'merit');
  assert.equal(destination.SessionId, 'session'); assert.equal(destination.TermId, 'term');
  assert.deepEqual(destination.CoreSubjectIds, ['math']);
  const old = h.store.academicStudentMemberships[0];
  assert.deepEqual({ ...old, __updateTime: historical.__updateTime }, historical);
  assert.deepEqual([h.store.academicStudentScores, h.store.payments, h.store.attendance], protectedData);
  assert.equal(h.current().WalletBalance, 1000); assert.equal(h.current().ParentPhone, '000123');
  assert.equal(h.writes.length, 1); assert.equal(h.store.academicStudentMovements.length, 1);
});
test('retry, including a lost response, adds no membership, audit or promotion history', async () => {
  const h = harness(); h.lose();
  await assert.rejects(h.run(), /Connection lost/);
  const history = h.current().PromotionHistory;
  assert.equal((await h.run()).status, 'alreadyMoved');
  assert.equal(h.current().PromotionHistory, history);
  assert.equal(h.store.academicStudentMemberships.length, 2);
  assert.equal(h.store.academicManagementAudit.length, 1); assert.equal(h.writes.length, 1);
});
test('a retry does not undo a subsequent destination-arm transfer', async () => {
  const h = harness(); await h.run(); h.current().ClassArm = 'Excellence';
  assert.equal((await h.run()).status, 'alreadyMoved');
  assert.equal(h.current().ClassArm, 'Excellence'); assert.equal(h.writes.length, 1);
});
test('reuses a matching legacy destination membership with its subjects and records', async () => {
  const h = harness();
  h.store.academicStudentMemberships.push(row('legacy-destination', { MembershipId: 'legacy-destination', StudentRef: 'S/1',
    ClassId: 'grade12', ArmId: 'merit', SessionId: 'session', TermId: 'term', SubjectIds: ['math', 'physics'] }));
  await h.run();
  assert.equal(h.current().AcademicMembershipId, 'legacy-destination');
  assert.equal(h.store.academicStudentMemberships.length, 2);
  assert.deepEqual(h.store.academicStudentMemberships[1].SubjectIds, ['math', 'physics']);
});
for (const [label, change] of [
  ['inactive student', h => { h.current().Status = 'Expelled'; }],
  ['unknown session', h => { h.store.academicSessions = []; }],
  ['closed term', h => { h.store.academicTerms[1].Status = 'Closed'; }],
  ['missing destination arm', h => { h.store.academicArms = []; }],
  ['concurrent profile change', h => { h.hook(() => { h.current().__updateTime = 'changed'; }); }],
  ['different destination', h => { h.store.academicStudentMemberships.push(row('other', { MembershipId: 'other', StudentRef: 'S/1', SessionId: 'session', TermId: 'term', ClassId: 'different', ArmId: 'other' })); }]
]) test(`${label} cannot partially update a profile or overwrite records`, async () => {
  const h = harness(); change(h);
  await assert.rejects(h.run()); assert.equal(h.writes.length, 0); assert.equal(h.current().ClassName, 'Grade 11');
});
test('an explicit destination arm is supported and an unassigned student can remain unassigned', async () => {
  const h = harness(); h.current().ClassArm = '';
  await h.run({ NewClassArm: 'Merit' }); assert.equal(h.current().ClassArm, 'Merit');
  const other = harness(); other.current().ClassArm = '';
  await other.run(); assert.equal(other.current().ClassArm, ''); assert.equal(other.store.academicStudentMemberships[1].ArmId, '');
});
test('a legacy profile-only move is repaired without changing the old period', async () => {
  const h = harness(); h.current().ClassName = 'Grade 12'; h.current().AcademicSession = '2027/2028'; h.current().Term = 'First Term';
  await h.run(); assert.equal(h.store.academicStudentMemberships.length, 2);
  assert.equal(h.store.academicStudentMemberships[0].ClassId, 'grade11');
});
test('shared catalogues are read once for a selected batch and old revisions advance safely', async () => {
  const h = harness(); await h.run();
  const second = { ...original, __id: 'S-2', AdmissionNo: 'S/2', AcademicMembershipId: '' };
  h.store[profilePath].push(second);
  await moveStudentSession({}, actor, second, input, h.cache, h.dependencies);
  for (const collection of ['academicSessions', 'academicTerms', 'academicClasses', 'academicSubjects']) {
    assert.equal(h.reads.filter(row => row[0] === collection).length, 1);
  }
  assert.ok(!h.reads.some(row => ['payments', 'academicStudentScores'].includes(row[0])));
  assert.equal(h.writes.length, 2);
});
test('read-only, unauthorized and wrong-section actors cannot move memberships', async () => {
  for (const patch of [{ role: 'Teacher' }, { subscriptionReadOnly: true }, { schoolSectionAccess: 'primary' }]) {
    const h = harness(); await assert.rejects(h.run({}, { ...actor, ...patch })); assert.equal(h.writes.length, 0);
  }
});
test('desktop route isolates per-student failures and avoids full-school student scans', async () => {
  const source = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
  const fn = source.slice(source.indexOf('async function promoteStudents'), source.indexOf('async function desktopSchoolOperationsActor'));
  let calls = 0;
  const ctx = vm.createContext({ clean: value => String(value || '').trim(), pick: (row, keys) => row[keys[0]],
    desktopSchoolOperationsActor: async () => actor, schoolOperationsScope: () => ({ branchId: 'main', strictReads: true }),
    schoolOperationsRowVisible: () => true, normalizeStudent: row => row,
    findStudentByAccountRef: async (_env, ref, scope) => { assert.equal(scope.branchId, 'main'); return { AdmissionNo: ref }; },
    moveStudentSession: async () => { calls++; if (calls === 1) throw new Error('Unconfigured arm'); return { status: 'moved', student: { AdmissionNo: 'S/2' } }; }
  });
  vm.runInContext(fn, ctx);
  const result = await ctx.promoteStudents({}, { ...input, Students: [{ AdmissionNo: 'S/1' }, { AdmissionNo: 'S/2' }] });
  assert.equal(result.promoted, 1); assert.equal(result.skipped, 1); assert.equal(calls, 2);
  assert.ok(!fn.includes('listSchoolCollection'));
});
