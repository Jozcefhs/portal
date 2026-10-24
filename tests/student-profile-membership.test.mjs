import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import * as management from '../functions/lib/academic-management.js';
import * as results from '../functions/lib/academic-term-results.js';
import * as studentStatus from '../functions/lib/student-academic-status.js';
import { normalizeClassKey, canonicalConfiguredClass } from '../functions/lib/class-names.js';
import { schoolSectionFor, safeScopeId } from '../functions/lib/school-scope.js';
import { enforceActorBranch } from '../functions/lib/branch-scope.js';
import { studentWalletProfile } from '../functions/lib/student-wallet-profile.js';

const managementSource = await readFile(new URL('../functions/lib/academic-management.js', import.meta.url), 'utf8');
const routeSource = await readFile(new URL('../functions/api/staff-students.js', import.meta.url), 'utf8');
const strip = source => source.replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/^export /gm, '');
const clone = value => structuredClone(value);
const scope = { BranchId: 'main', SchoolSection: 'secondary', Status: 'Active' };
const period = { SessionId: 'session', TermId: 'term' };
const actor = { edition: 'school', role: 'ICT', username: 'ict', branchId: 'main', schoolSectionAccess: 'secondary', allowedSections: ['students', 'academics'] };
const profile = { ...scope, __id: 'student', __scopePath: 'schoolBranches/main/sections/secondary/students', __updateTime: 'profile-1',
  AdmissionNo: 'S/009', AcademicMembershipId: 'legacy-member', ClassName: 'Grade 9', ClassAdmitted: 'Grade 9', ClassArm: 'Merit',
  AcademicSession: '2026/2027', Term: 'First Term', ParentPhone: 'old-phone', WalletCardId: 'card-123', MedicalCondition: 'Preserve this', FeeBalance: 1500 };
const member = { ...scope, ...period, RecordId: 'legacy-member', MembershipId: 'legacy-member', StudentRef: profile.AdmissionNo,
  ClassId: 'grade9', ArmId: 'merit', SchoolStage: 'junior-secondary', SubjectIds: ['math'], CoreSubjectIds: ['math'],
  TradeSubjectIds: [], OptionalSubjectIds: [], DepartmentId: '', CurriculumStatus: 'Complete', __updateTime: 'member-1' };
const score = { ...scope, ...period, ScoreId: 'score', StudentRef: profile.AdmissionNo, ClassId: 'grade9', ArmId: 'merit', SubjectId: 'math',
  ComponentScores: [{ ComponentId: 'ca1', State: 'Numeric', RawScore: 75, Maximum: 100 }], __updateTime: 'score-1' };

function harness({ user = actor, assessed = true, members = [member] } = {}) {
  const state = {
    profiles: [clone(profile)],
    sessions: [{ ...scope, ...period, RecordId: 'session', Name: '2026/2027' }],
    terms: [{ ...scope, ...period, RecordId: 'term', Name: 'First Term' }],
    classes: ['grade9', 'grade8'].map((id, i) => ({ ...scope, ClassId: id, RecordId: id, Name: `Grade ${9 - i}`, SchoolStage: 'junior-secondary' })),
    arms: [['merit', 'Merit', 'grade9'], ['brilliance', 'Brilliance', 'grade9'], ['grade8-merit', 'Merit', 'grade8']].map(([ArmId, Name, ClassId]) => ({ ...scope, RecordId: ArmId, ArmId, Name, ClassId })),
    subjects: [{ ...scope, SubjectId: 'math', Name: 'Mathematics' }], departments: [], teacherAllocations: [],
    offerings: ['grade9', 'grade8'].map(ClassId => ({ ...scope, ...period, ClassId, SubjectId: 'math' })),
    studentMemberships: clone(members), studentScores: assessed ? [clone(score)] : [], termResults: [],
    studentMovements: [{ MovementId: 'old-movement', Reason: 'Original allocation' }], audit: [],
    attendance: [{ StudentRef: profile.AdmissionNo, Status: 'Present', ArmId: 'merit' }]
  };
  const commits = [], directWrites = [];
  let revision = 1;
  const keyFor = path => path === profile.__scopePath ? 'profiles' : Object.keys(management.ACADEMIC_MANAGEMENT_COLLECTIONS).find(key => management.ACADEMIC_MANAGEMENT_COLLECTIONS[key] === path);
  const idOf = row => row.__id || row.RecordId || row.MembershipId || row.ResultId || row.MovementId;
  const context = vm.createContext({ ...management, ...results, ...studentStatus, crypto: webcrypto, TextEncoder, TextDecoder,
    normalizeClassKey, canonicalConfiguredClass, schoolSectionFor, safeScopeId, enforceActorBranch,
    getSchoolStructure: async () => ({ ActiveBranchId: 'main', Branches: [{ Id: 'main' }, { Id: 'annex' }], Sections: ['secondary', 'primary'] }),
    queryCollection: async (_env, path, options) => clone((state[keyFor(path)] || []).filter(row => options.filters.every(filter =>
      filter.op === 'in' ? filter.value.includes(row[filter.field]) : row[filter.field] === filter.value))),
    batchCommitDocuments: async (_env, writes) => {
      for (const write of writes) {
        const previous = (state[keyFor(write.collectionPath)] || []).find(row => idOf(row) === write.documentId);
        if ((write.updateTime && write.updateTime !== previous?.__updateTime) || (write.exists === false && previous)) {
          throw Object.assign(new Error('Concurrent write'), { status: 409 });
        }
      }
      commits.push(clone(writes));
      const writeResults = [];
      for (const write of writes) {
        const key = keyFor(write.collectionPath);
        assert.ok(key, `Unexpected collection ${write.collectionPath}`);
        assert.notEqual(write.operation, 'delete');
        state[key] ||= [];
        const index = state[key].findIndex(row => idOf(row) === write.documentId);
        const previous = state[key][index];
        const updateTime = `saved-${++revision}`;
        const value = { ...(write.updateMask ? previous : {}), ...clone(write.data), __updateTime: updateTime,
          ...(key === 'profiles' ? { __id: write.documentId, __scopePath: write.collectionPath } : {}) };
        for (const field of write.updateMask || []) if (!Object.hasOwn(write.data, field)) delete value[field];
        if (index < 0) state[key].push(value); else state[key][index] = value;
        writeResults.push({ updateTime });
      }
      return { writeResults };
    }
  });
  vm.runInContext(strip(managementSource), context);
  context.loadScopedAcademicState = async (_env, selectedScope) => {
    const data = clone(state);
    for (const key of ['sessions', 'terms', 'classes', 'arms', 'studentMemberships']) data[key] = data[key].filter(row => row.BranchId === selectedScope.branchId && row.SchoolSection === selectedScope.section);
    return data;
  };
  const route = vm.runInNewContext(`${strip(routeSource)}\nonRequestPost`, {
    Response, crypto: webcrypto, Date, TextEncoder, schoolSectionFor, canonicalConfiguredClass, studentWalletProfile,
    academicWebActor: context.academicWebActor, studentProfilePlacementChanged: context.studentProfilePlacementChanged,
    saveStudentProfileAcademicPlacement: (...args) => context.saveStudentProfileAcademicPlacement(...args),
    requireFirestoreEnv: () => {}, requireStaffSession: async () => user, readJsonBody: request => request.json(),
    listSchoolCollection: async () => clone(state.profiles), listCollection: async () => [],
    upsertSchoolDocument: async (_env, _collection, id, data, options) => {
      assert.equal(options.updateTime, state.profiles[0].__updateTime);
      directWrites.push(clone(data));
      state.profiles[0] = { ...clone(data), __updateTime: `saved-${++revision}` };
      return clone(state.profiles[0]);
    }
  });
  const current = () => state.profiles[0];
  return { state, commits, directWrites, context, current, async save(extra = {}) {
    const response = await route({ env: {}, request: { json: async () => ({ action: 'update', AccountRef: profile.AdmissionNo,
      RevisionToken: current().__updateTime, ...extra }) } });
    return { status: response.status, data: await response.json() };
  } };
}

test('profile arm change atomically updates the legacy membership and history, preserving all marks and records', async () => {
  const h = harness();
  const history = clone({ scores: h.state.studentScores, attendance: h.state.attendance, movement: h.state.studentMovements[0] });
  const response = await h.save({ ClassArm: 'Brilliance', ParentPhone: 'new-phone' });
  assert.equal(response.status, 200, response.data.message);
  assert.equal(response.data.academicPlacementUpdated, true);
  assert.equal(h.state.studentMemberships.length, 1);
  assert.equal(h.state.studentMemberships[0].MembershipId, 'legacy-member');
  assert.equal(h.state.studentMemberships[0].ArmId, 'brilliance');
  assert.deepEqual(h.state.studentMemberships[0].SubjectIds, ['math']);
  assert.equal(h.current().ClassArm, 'Brilliance');
  assert.equal(h.current().AcademicArmId, 'brilliance');
  assert.equal(h.current().ParentPhone, 'new-phone');
  for (const key of ['WalletCardId', 'MedicalCondition', 'FeeBalance']) assert.equal(h.current()[key], profile[key]);
  assert.deepEqual(h.state.studentScores, history.scores);
  assert.deepEqual(h.state.attendance, history.attendance);
  assert.deepEqual(h.state.studentMovements[0], history.movement);
  assert.equal(h.state.studentMovements[1].MovementType, 'Arm Transfer');
  assert.equal(h.commits.length, 1);
  assert.equal(h.directWrites.length, 0);
  assert.ok(h.commits[0].every(write => write.collectionPath !== 'academicStudentScores'));
  const replay = await h.save({ ClassArm: 'Brilliance' });
  assert.equal(replay.status, 200);
  assert.equal(h.state.studentMemberships.length, 1);
  assert.equal(h.state.studentMovements.length, 2);
});

const pendingRequest = { RequestId: 'old-request', Status: 'Pending', Before: { SubjectIds: ['math'] },
  After: { SubjectIds: ['english'] }, Reason: 'Original subject selection request',
  RequestedByUsername: 'form-teacher', RequestedAt: '2026-09-30T12:00:00.000Z' };

test('ICT profile transfer supersedes pending requests and duplicate copies in the same profile commit', async () => {
  const source = { ...member, PendingSubjectChange: pendingRequest };
  const duplicate = { ...source, RecordId: 'duplicate', MembershipId: 'duplicate', __updateTime: 'duplicate-1' };
  const h = harness({ members: [source, duplicate] });
  const original = clone(h.state);
  const result = await h.save({ ClassArm: 'Brilliance', ParentPhone: 'new-phone' });
  assert.equal(result.status, 200, result.data.message);
  assert.equal(result.data.academicPlacementUpdated, true);
  assert.equal(h.commits.length, 1);
  assert.equal(h.directWrites.length, 0);
  assert.equal(h.current().ClassArm, 'Brilliance');
  assert.equal(h.current().ParentPhone, 'new-phone');
  assert.equal(h.state.studentMemberships.filter(row => row.Status === 'Active').length, 1);
  for (const row of h.state.studentMemberships) {
    assert.equal(row.PendingSubjectChange, undefined);
    assert.equal(row.LastSupersededSubjectChange.RequestId, pendingRequest.RequestId);
  }
  const history = h.state.studentMovements.filter(row => row.Status === 'Superseded');
  assert.equal(history.length, 2);
  for (const row of history) assert.deepEqual(row.OriginalSubjectChangeRequest, pendingRequest);
  assert.deepEqual(h.state.studentMovements[0], original.studentMovements[0]);
  assert.deepEqual(h.state.studentScores, original.studentScores);
  assert.deepEqual(h.state.attendance, original.attendance);
  for (const key of ['FeeBalance', 'WalletCardId', 'MedicalCondition']) assert.equal(h.current()[key], profile[key]);
});

test('a concurrent profile edit cannot clear pending requests or partially commit their history', async () => {
  const h = harness({ members: [{ ...member, PendingSubjectChange: pendingRequest }] });
  const commit = h.context.batchCommitDocuments;
  h.context.batchCommitDocuments = (...args) => {
    h.current().__updateTime = 'concurrent-profile-edit';
    return commit(...args);
  };
  const result = await h.save({ ClassArm: 'Brilliance' });
  assert.equal(result.status, 409);
  assert.equal(h.commits.length, 0);
  assert.equal(h.current().ClassArm, 'Merit');
  assert.equal(h.state.studentMemberships[0].ArmId, 'merit');
  assert.deepEqual(h.state.studentMemberships[0].PendingSubjectChange, pendingRequest);
  assert.equal(h.state.studentMovements.length, 1);
  assert.deepEqual(h.state.studentScores, [score]);
});

test('non-ICT profile transfer retains the pending-request approval guard', async () => {
  const h = harness({ user: { ...actor, role: 'Principal' }, members: [{ ...member, PendingSubjectChange: pendingRequest }] });
  const result = await h.save({ ClassArm: 'Brilliance' });
  assert.equal(result.status, 409);
  assert.equal(result.data.code, 'ACADEMIC_SUBJECT_CHANGE_PENDING');
  assert.equal(h.commits.length, 0);
  assert.deepEqual(h.state.studentMemberships[0].PendingSubjectChange, pendingRequest);
  assert.equal(h.current().ClassArm, 'Merit');
});

test('class change keeps the membership ID and old scores under their original class', async () => {
  const h = harness();
  const response = await h.save({ ClassName: 'Grade 8', ClassArm: 'Merit' });
  assert.equal(response.status, 200, response.data.message);
  assert.equal(h.current().ClassName, 'Grade 8');
  assert.equal(h.state.studentMemberships[0].ClassId, 'grade8');
  assert.equal(h.state.studentMemberships[0].MembershipId, 'legacy-member');
  assert.equal(h.state.studentMovements[1].MovementType, 'Class Transfer');
  assert.deepEqual(h.state.studentScores, [score]);
});

test('initial profile allocation creates only one membership and preserves history', async () => {
  const h = harness({ members: [], assessed: false });
  const response = await h.save({ ClassArm: 'Brilliance' });
  assert.equal(response.status, 200, response.data.message);
  assert.equal(h.state.studentMemberships.length, 1);
  assert.equal(h.current().AcademicMembershipId, h.state.studentMemberships[0].MembershipId);
  await h.save({ ClassArm: 'Merit' });
  assert.equal(h.state.studentMemberships.length, 1);
});

test('only confirmed duplicate copies are retired, without deleting historical data', async () => {
  const duplicate = { ...member, RecordId: 'duplicate', MembershipId: 'duplicate', __updateTime: 'duplicate-1', Notes: 'Keep history' };
  const h = harness({ members: [member, duplicate, { ...duplicate, RecordId: 'old-term', MembershipId: 'old-term', TermId: 'old-term' }] });
  const response = await h.save({ ClassArm: 'Brilliance' });
  assert.equal(response.status, 200, response.data.message);
  assert.equal(h.state.studentMemberships[1].Status, 'Archived');
  assert.equal(h.state.studentMemberships[1].Notes, 'Keep history');
  assert.equal(h.state.studentMemberships[2].Status, 'Active');
  assert.deepEqual(h.state.studentScores, [score]);
  const ambiguous = harness({ members: [member, duplicate] });
  ambiguous.current().AcademicMembershipId = '';
  assert.equal((await ambiguous.save({ ClassArm: 'Brilliance' })).status, 409);
  assert.equal(ambiguous.commits.length, 0);
});

test('approval-required transfers keep the old profile placement while saving unrelated fields and the request', async () => {
  const h = harness({ user: { ...actor, role: 'Principal' } });
  const response = await h.save({ ClassArm: 'Brilliance', ParentPhone: 'new-phone' });
  assert.equal(response.status, 200, response.data.message);
  assert.equal(response.data.pendingApproval, true);
  assert.equal(response.data.academicPlacementUpdated, false);
  assert.match(response.data.message, /awaiting.*approval/);
  assert.equal(h.current().ClassArm, 'Merit');
  assert.equal(h.current().ParentPhone, 'new-phone');
  assert.equal(h.state.studentMemberships[0].ArmId, 'merit');
  assert.equal(h.state.studentMemberships[0].PendingSubjectChange.After.ArmId, 'brilliance');
  assert.deepEqual(h.state.studentScores, [score]);
  assert.equal(h.commits.length, 1);
});

test('stale forms and concurrent profile, membership, duplicate or result edits cannot partially apply a transfer', async () => {
  for (const target of ['profile', 'membership', 'duplicate', 'result']) {
    const h = harness();
    if (target === 'duplicate') h.state.studentMemberships.push({ ...member, RecordId: 'duplicate', MembershipId: 'duplicate', __updateTime: 'duplicate-1' });
    if (target === 'result') h.state.termResults.push({ ...scope, ...period, ResultId: 'result', RecordId: 'result', StudentRef: profile.AdmissionNo, Status: 'Draft', __updateTime: 'result-1' });
    const commit = h.context.batchCommitDocuments;
    h.context.batchCommitDocuments = (...args) => {
      const row = target === 'profile' ? h.current() : target === 'result' ? h.state.termResults[0] : h.state.studentMemberships[target === 'duplicate' ? 1 : 0];
      row.__updateTime = 'concurrent';
      return commit(...args);
    };
    assert.equal((await h.save({ ClassArm: 'Brilliance', ParentPhone: 'new-phone' })).status, 409, target);
    assert.equal(h.commits.length, 0);
    assert.equal(h.current().ClassArm, 'Merit');
    assert.equal(h.current().ParentPhone, 'old-phone');
    assert.equal(h.state.studentMemberships[0].ArmId, 'merit');
    assert.deepEqual(h.state.studentScores, [score]);
  }
  for (const token of ['', 'stale']) {
    const h = harness();
    assert.equal((await h.save({ ClassArm: 'Brilliance', RevisionToken: token })).status, 409);
    assert.equal(h.commits.length, 0);
  }
});

test('invalid destinations, inactive periods and unauthorised accounts leave everything unchanged', async () => {
  const scenarios = [
    h => { h.state.arms[1].Status = 'Archived'; },
    h => { h.state.arms[1].BranchId = 'annex'; },
    h => { h.state.classes[0].SchoolSection = 'primary'; },
    h => { h.state.terms[0].Status = 'Closed'; },
    h => { h.state.studentMemberships[0].Status = 'Withdrawn'; },
    h => { h.state.arms.push({ ...h.state.arms[1], ArmId: 'ambiguous', RecordId: 'ambiguous' }); }
  ];
  for (const prepare of scenarios) {
    const h = harness(); prepare(h);
    assert.ok((await h.save({ ClassArm: 'Brilliance' })).status >= 400);
    assert.equal(h.commits.length, 0);
    assert.equal(h.current().ClassArm, 'Merit');
  }
  for (const user of [{ ...actor, allowedSections: ['students'] }, { ...actor, role: 'Teacher' }, { ...actor, subscriptionReadOnly: true }, { ...actor, branchId: 'annex' }]) {
    const h = harness({ user });
    assert.ok((await h.save({ ClassArm: 'Brilliance' })).status >= 400);
    assert.equal(h.commits.length, 0);
  }
});

test('unrelated edits do not change placement, and academic-period changes cannot move historical membership', async () => {
  const h = harness();
  assert.equal((await h.save({ ParentPhone: 'new-phone' })).status, 200);
  assert.equal(h.commits.length, 0);
  assert.deepEqual(h.state.studentMemberships, [member]);
  h.state.terms.push({ ...h.state.terms[0], Name: 'Second Term', TermId: 'second', RecordId: 'second' });
  const result = await h.save({ ClassArm: 'Brilliance', Term: 'Second Term' });
  assert.equal(result.status, 409);
  assert.equal(result.data.code, 'ACADEMIC_PROFILE_PERIOD_CHANGE');
  assert.equal(h.commits.length, 0);
});

test('inactive profiles cannot be transferred back into active lists or change placement and status together', async () => {
  const h = harness();
  h.current().Status = 'Expelled';
  assert.equal((await h.save({ ClassArm: 'Brilliance' })).data.code, 'STUDENT_NOT_ACTIVE');
  assert.equal((await h.save({ Status: 'Active', ClassArm: 'Brilliance' })).data.code, 'STUDENT_STATUS_AND_PLACEMENT_CHANGE');
  assert.equal(h.commits.length, 0);
});

test('profile editor submits its original revision, explains the transfer and clears stale academic views', async () => {
  const frontend = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
  const editor = frontend.slice(frontend.indexOf('function openStudentEditor('), frontend.indexOf('function bindStudentEditor('));
  assert.match(editor, /form\.elements\.RevisionToken\.value = clean\(student\.__updateTime/);
  assert.match(editor, /also updates the academic membership/);
  assert.match(frontend, /data\.academicPlacementUpdated \|\| data\.pendingApproval\) academicManagementData = null/);
});
