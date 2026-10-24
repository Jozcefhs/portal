import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { saveStudentStatusWithMemberships, studentStatusChanged, studentStatusKind, assertStudentCanHaveActiveMembership, STUDENT_STATUSES } from '../functions/lib/student-academic-status.js';
import { buildAcademicClassScoreRegister } from '../functions/lib/academic-class-score-register.js';

const clone = value => structuredClone(value);
const scope = { BranchId: 'main', SchoolSection: 'secondary' };
const profilePath = 'schoolBranches/main/sections/secondary/students';
const original = { ...scope, __id: 'S-1', __updateTime: 'p1', __scopePath: profilePath, AdmissionNo: 'S/1', Status: 'Active',
  ClassName: 'Grade 9', ClassArm: 'Merit', AcademicSession: '2026/2027', Term: 'First Term', AcademicMembershipId: 'member',
  AcademicEnrollmentStatus: 'Active', FeeBalance: 1500, MedicalCondition: 'Preserve', WalletCardStatus: 'Blocked' };
const member = { ...scope, __id: 'member', __updateTime: 'm1', MembershipId: 'member', StudentRef: 'S/1',
  SessionId: 'session', TermId: 'term', ClassId: 'grade9', ArmId: 'merit', Status: 'Active', SubjectIds: ['math'], CoreSubjectIds: ['math'] };

function harness() {
  const state = {
    [profilePath]: [clone(original)], academicStudentMemberships: [clone(member)],
    academicSessions: [{ ...scope, __id: 'session', __updateTime: 's1', SessionId: 'session', Status: 'Active', Name: '2026/2027' }],
    academicTerms: [{ ...scope, __id: 'term', __updateTime: 't1', TermId: 'term', SessionId: 'session', Status: 'Active', Name: 'First Term', EndDate: '2026-12-15' }],
    academicClasses: [{ ...scope, __id: 'grade9', __updateTime: 'c1', ClassId: 'grade9', Name: 'Grade 9', Status: 'Active' }],
    academicArms: [{ ...scope, __id: 'merit', __updateTime: 'a1', ArmId: 'merit', ClassId: 'grade9', Status: 'Active' }],
    academicStudentScores: [{ ScoreId: 'score', StudentRef: 'S/1', ComponentScores: [{ RawScore: 0 }, { RawScore: 72.5 }], Answers: ['A', 'B'] }],
    academicAttendance: [{ StudentRef: 'S/1', Status: 'Present' }], payments: [{ Amount: 25000, Reference: 'PAY1' }],
    academicStudentMovements: [{ __id: 'historical', Reason: 'Original allocation' }], academicManagementAudit: []
  };
  const commits = [];
  let beforeCommit = () => {}, sequence = 0;
  const dependencies = {
    now: '2026-10-24T10:00:00.000Z',
    getDocument: async (_env, collection, id) => clone((state[collection] || []).find(row => row.__id === id) || null),
    queryCollectionPages: async (_env, collection, options) => {
      assert.equal(collection, 'academicStudentMemberships');
      assert.equal(options.maxRows, 400);
      return clone(state[collection].filter(row => options.filters[0].value.includes(row.StudentRef)));
    },
    batchCommitDocuments: async (_env, writes) => {
      beforeCommit();
      assert.ok(writes.length <= 500);
      for (const write of writes) {
        const existing = (state[write.collectionPath] || []).find(row => row.__id === write.documentId);
        assert.notEqual(write.operation, 'delete');
        assert.ok(!/Scores|Attendance|payments/.test(write.collectionPath));
        if ((write.updateTime && write.updateTime !== existing?.__updateTime) || (write.exists === false && existing)) throw Object.assign(new Error('Concurrent update'), { status: 412 });
      }
      commits.push(clone(writes));
      return { writeResults: writes.map(write => {
        const rows = state[write.collectionPath] ||= [];
        const index = rows.findIndex(row => row.__id === write.documentId);
        const next = { ...(write.updateMask ? rows[index] : {}), ...clone(write.data), __id: write.documentId, __updateTime: `revision-${++sequence}` };
        if (index < 0) rows.push(next); else rows[index] = next;
        return { updateTime: next.__updateTime };
      }) };
    }
  };
  const current = () => state[profilePath][0];
  return { state, commits, dependencies, current, race(fn) { beforeCommit = fn; }, async save(Status, extra = {}) {
    const before = clone(current());
    return saveStudentStatusWithMemberships({}, before, { ...before, Status, StatusEffectiveDate: '2026-10-24', UpdatedBy: 'Test officer', ...extra },
      { collectionPath: profilePath, documentId: before.__id, updateTime: before.__updateTime }, dependencies);
  } };
}

for (const Status of ['Withdrawn', 'Expelled', 'Graduated', 'Transferred', 'Left School', 'Deceased']) {
  test(`${Status}: removes active membership and preserves marks, zeroes, answers, attendance, payments and history`, async () => {
    const h = harness();
    const protectedData = clone([h.state.academicStudentScores, h.state.academicAttendance, h.state.payments, h.state.academicStudentMovements[0]]);
    const result = await h.save(Status);
    assert.equal(result.Status, Status);
    assert.equal(h.current().AcademicEnrollmentStatus, 'Withdrawn');
    assert.equal(h.state.academicStudentMemberships[0].Status, 'Withdrawn');
    for (const field of ['MembershipId', 'ClassId', 'ArmId', 'SubjectIds', 'CoreSubjectIds']) assert.deepEqual(h.state.academicStudentMemberships[0][field], member[field]);
    assert.deepEqual([h.state.academicStudentScores, h.state.academicAttendance, h.state.payments, h.state.academicStudentMovements[0]], protectedData);
    assert.equal(h.current().FeeBalance, 1500);
    assert.equal(h.current().WalletCardStatus, 'Blocked');
    assert.equal(h.commits.length, 1);
    const register = buildAcademicClassScoreRegister({ classes: h.state.academicClasses, studentMemberships: h.state.academicStudentMemberships }, member);
    assert.equal(register.StudentCount, 0);
  });
}

for (const Status of ['On Leave', 'Suspended', 'Inactive']) {
  test(`${Status}: pauses and restores the same membership without duplicates`, async () => {
    const h = harness();
    await h.save(Status);
    assert.equal(h.state.academicStudentMemberships[0].Status, 'Inactive');
    await h.save('Active');
    assert.equal(h.state.academicStudentMemberships.length, 1);
    assert.equal(h.state.academicStudentMemberships[0].MembershipId, 'member');
    assert.equal(h.state.academicStudentMemberships[0].Status, 'Active');
    assert.equal(h.state.academicStudentMemberships[0].ProfileStatusManaged, false);
    assert.equal(h.current().ClassArm, 'Merit');
  });
}

test('closed/expired periods, archived duplicates, other students and other scopes are untouched', async () => {
  const h = harness();
  h.state.academicTerms.push({ ...h.state.academicTerms[0], __id: 'old', TermId: 'old', Status: 'Closed' }, { ...h.state.academicTerms[0], __id: 'expired', TermId: 'expired', EndDate: '2026-07-20' });
  const protectedRows = [ { ...member, __id: 'old-member', TermId: 'old' }, { ...member, __id: 'expired-member', TermId: 'expired' },
    { ...member, __id: 'superseded', Status: 'Archived', SupersededByMembershipId: 'member' },
    { ...member, __id: 'other-student', StudentRef: 'OTHER' }, { ...member, __id: 'other-branch', BranchId: 'annex' },
    { ...member, __id: 'other-section', SchoolSection: 'primary' } ];
  h.state.academicStudentMemberships.push(...clone(protectedRows));
  await h.save('Expelled');
  assert.deepEqual(h.state.academicStudentMemberships.slice(1), protectedRows);
});

test('all active duplicate arms close together; restoration chooses the confirmed profile membership', async () => {
  const h = harness();
  h.state.academicStudentMemberships.push({ ...member, __id: 'duplicate', MembershipId: 'duplicate', ArmId: 'other' });
  await h.save('Withdrawn');
  assert.ok(h.state.academicStudentMemberships.every(row => row.Status === 'Withdrawn'));
  await h.save('Active');
  assert.deepEqual(h.state.academicStudentMemberships.map(row => row.Status), ['Active', 'Withdrawn']);
});

test('ambiguous or unavailable reinstatement never guesses or creates a new membership', async () => {
  for (const problem of ['ambiguous', 'closed-arm', 'already-active']) {
    const h = harness(); await h.save('On Leave');
    if (problem === 'closed-arm') h.state.academicArms[0].Status = 'Archived';
    else {
      h.state.academicStudentMemberships.push({ ...h.state.academicStudentMemberships[0], __id: 'second', MembershipId: 'second', Status: problem === 'already-active' ? 'Active' : 'Inactive' });
      h.current().AcademicMembershipId = '';
    }
    await assert.rejects(h.save('Active'), { status: 409 });
    assert.equal(h.current().Status, 'On Leave');
    assert.equal(h.commits.length, 1);
  }
});

test('concurrent profile, membership, class or period changes abort the whole save', async () => {
  for (const target of [profilePath, 'academicStudentMemberships', 'academicTerms', 'academicSessions']) {
    const h = harness();
    h.race(() => { h.state[target][0].__updateTime = 'concurrent'; });
    await assert.rejects(h.save('Withdrawn'), { code: 'STUDENT_STATUS_CONFLICT' });
    assert.equal(h.current().Status, 'Active');
    assert.equal(h.state.academicStudentMemberships[0].Status, 'Active');
    assert.equal(h.commits.length, 0);
  }
  const h = harness(); await h.save('On Leave');
  h.race(() => { h.state.academicArms[0].__updateTime = 'concurrent'; });
  await assert.rejects(h.save('Active'), { status: 409 });
  assert.equal(h.current().Status, 'On Leave');
});

test('read failures, missing revisions, invalid dates/status and unknown periods never report success', async () => {
  for (const problem of ['read', 'revision', 'period', 'future', 'invalid-date', 'status']) {
    const h = harness();
    if (problem === 'read') h.dependencies.queryCollectionPages = async () => { throw new Error('Unavailable'); };
    if (problem === 'revision') delete h.state.academicStudentMemberships[0].__updateTime;
    if (problem === 'period') h.state.academicTerms = [];
    await assert.rejects(h.save(problem === 'status' ? 'Unknown' : 'Expelled',
      problem === 'future' ? { StatusEffectiveDate: '2027-01-01' } : problem === 'invalid-date' ? { StatusEffectiveDate: '2026-02-30' } : {}));
    assert.equal(h.commits.length, 0);
    assert.equal(h.current().Status, 'Active');
  }
});

test('legacy lowercase status stays synchronized; no membership or closed-only history requires no allocation', async () => {
  const h = harness(); h.current().status = 'Active'; h.state.academicStudentMemberships = [];
  const result = await h.save('Withdrawn');
  assert.equal(result.status, 'Withdrawn');
  assert.equal(h.state.academicStudentMemberships.length, 0);
  assert.equal(studentStatusChanged({ Status: 'Active' }, { Status: 'Active' }), false);
  assert.equal(studentStatusKind('Suspended'), 'temporary');
});

test('allocation/transfer guard refuses an active membership for absent students', () => {
  for (const Status of STUDENT_STATUSES.filter(value => studentStatusKind(value) !== 'active')) {
    assert.throws(() => assertStudentCanHaveActiveMembership({ Status }, member), { code: 'STUDENT_NOT_ACTIVE' });
    assert.doesNotThrow(() => assertStudentCanHaveActiveMembership({ Status }, { ...member, Status: 'Withdrawn' }));
  }
});

test('mixed-case legacy references use the confirmed membership ID and WAT effective dates', async () => {
  const h = harness();
  h.state.academicStudentMemberships[0].StudentRef = 's/1';
  h.dependencies.queryCollectionPages = async () => [];
  h.dependencies.now = '2026-10-23T23:30:00.000Z';
  await h.save('Expelled');
  assert.equal(h.state.academicStudentMemberships[0].Status, 'Withdrawn');
});

test('the common student writer runs status synchronization for web, Accounts and desktop callers', async () => {
  const source = await readFile(new URL('../functions/lib/school-scope.js', import.meta.url), 'utf8');
  const h = harness();
  let statusCalls = 0;
  const context = vm.createContext({ studentStatusChanged,
    saveStudentStatusWithMemberships: async (...args) => { statusCalls++; return saveStudentStatusWithMemberships(...args, h.dependencies); },
    withStudentProfileDefaults: row => row, getDocument: h.dependencies.getDocument,
    upsertDocument: async () => { throw new Error('A status change must use the atomic writer.'); } });
  vm.runInContext(source.replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/^export /gm, ''), context);
  context.getSchoolStructure = async () => ({ ActiveBranchId: 'main' });
  const result = await context.upsertSchoolDocument({}, 'students', original.__id, { ...clone(original), Status: 'Expelled' });
  assert.equal(result.Status, 'Expelled'); assert.equal(statusCalls, 1);
  await assert.rejects(context.upsertSchoolDocument({}, 'students', original.__id, { ...clone(original), Status: 'Active' }), { status: 409 });
  h.state[profilePath] = [];
  await assert.rejects(context.upsertSchoolDocument({}, 'students', original.__id, { ...clone(original), Status: 'Active' }), { status: 409 });
  assert.equal(h.state[profilePath].length, 0);
});
