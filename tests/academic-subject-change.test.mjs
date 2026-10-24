import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import * as management from '../functions/lib/academic-management.js';
import * as results from '../functions/lib/academic-term-results.js';
import * as studentStatus from '../functions/lib/student-academic-status.js';
import { checkClassroomRemovals } from '../functions/lib/academic-classroom-removal.js';

const source = await readFile(new URL('../functions/lib/academic-management.js', import.meta.url), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const period = { SessionId: 'session', TermId: 'term', ClassId: 'class', ArmId: 'arm' };
const scope = { BranchId: 'main', SchoolSection: 'secondary', Status: 'Active' };
const teacher = { edition: 'school', role: 'Teacher', username: 'teacher', allowedSections: ['academics'] };
const admin = { ...teacher, role: 'Principal', username: 'principal' };
const ict = { ...teacher, role: 'ICT', username: 'ict' };
const membership = {
  ...period, ...scope, RecordId: 'member', MembershipId: 'member', StudentRef: 'S1',
  SubjectIds: ['english', 'catering', 'music'], CoreSubjectIds: ['english'], TradeSubjectIds: ['catering'], OptionalSubjectIds: ['music'],
  DepartmentId: '', CurriculumStatus: 'Complete', SchoolStage: 'senior-secondary', __updateTime: 'rev-1'
};
const score = { ...period, ...scope, StudentRef: 'S1', SubjectId: 'catering', ScoreId: 'score', RecordId: 'score',
  ComponentScores: [{ State: 'Numeric', RawScore: 0, ComponentId: 'test' }], CompletionStatus: 'Incomplete', __updateTime: 'score-rev' };

function harness({ scores = [score], termResults = [] } = {}) {
  const state = {
    sessions: [{ ...scope, RecordId: 'session', SessionId: 'session' }],
    terms: [{ ...scope, RecordId: 'term', TermId: 'term', SessionId: 'session' }],
    classes: [{ ...scope, RecordId: 'class', ClassId: 'class', Name: 'Grade 10', SchoolStage: 'senior-secondary' }],
    arms: [{ ...scope, RecordId: 'arm', ArmId: 'arm', ClassId: 'class', Name: 'Brilliance', DepartmentId: '' }],
    departments: [{ ...scope, DepartmentId: 'science', SchoolStage: 'senior-secondary', CoreSubjectIds: ['english'] }],
    subjects: ['english', 'catering', 'printing', 'music'].map(id => ({ ...scope, SubjectId: id, Name: id,
      SeniorChoiceRole: ['catering', 'printing'].includes(id) ? 'Trade' : id === 'music' ? 'Optional' : '' })),
    offerings: [], studentMemberships: [clone(membership)], studentMovements: [], audit: [],
    teacherAllocations: [{ ...scope, ...period, TeacherUsername: 'teacher', AllocationRole: 'Form Teacher' }],
    studentScores: clone(scores), termResults: clone(termResults)
  };
  const writes = [];
  const queries = [];
  let revision = 1;
  const keyFor = collection => Object.keys(management.ACADEMIC_MANAGEMENT_COLLECTIONS).find(key => management.ACADEMIC_MANAGEMENT_COLLECTIONS[key] === collection);
  const context = vm.createContext({ ...management, ...results, ...studentStatus, crypto: webcrypto, TextEncoder, TextDecoder, safeScopeId: String,
    queryCollection: async (_env, collection, options) => {
      queries.push({ collection, options: clone(options) });
      return clone((state[keyFor(collection)] || []).filter(row => options.filters.every(filter =>
        filter.op === 'in' ? filter.value.includes(row[filter.field]) : row[filter.field] === filter.value)));
    },
    batchCommitDocuments: async (_env, changes) => {
      for (const change of changes) {
        const previous = (state[keyFor(change.collectionPath)] || []).find(row => (row.RecordId || row.MembershipId || row.ResultId) === change.documentId);
        if ((change.updateTime && change.updateTime !== previous?.__updateTime) || (change.exists === false && previous)) {
          throw Object.assign(new Error('Conflict'), { status: 409 });
        }
      }
      writes.push(...clone(changes));
      for (const change of changes) {
        const key = keyFor(change.collectionPath);
        state[key] ||= [];
        const index = state[key].findIndex(row => (row.RecordId || row.MembershipId || row.ResultId) === change.documentId);
        const record = { ...(change.updateMask ? state[key][index] : {}), ...clone(change.data), __updateTime: `rev-${++revision}` };
        for (const field of change.updateMask || []) if (!Object.hasOwn(change.data, field)) delete record[field];
        if (index < 0) state[key].push(record); else state[key][index] = record;
      }
    }
  });
  vm.runInContext(source.replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/^export /gm, ''), context);
  context.academicScope = async (_env, user, input) => {
    assert.equal(input.SchoolSection, 'secondary');
    if (input.BranchId !== 'main') throw Object.assign(new Error('Wrong branch'), { status: 403 });
    return { branchId: 'main', section: 'secondary' };
  };
  context.loadScopedAcademicState = async () => clone(state);
  context.loadPeople = async () => ({ students: [{ AdmissionNo: 'S1', Status: 'Active' }], staff: [] });
  context.bootstrapAcademicManagement = async () => ({ ok: true });
  context.academicOperationalContext = async () => ({ state: clone(state), scope: { branchId: 'main', section: 'secondary' } });
  const member = () => state.studentMemberships[0];
  return { state, writes, queries, context, member,
    request: (input = {}, user = teacher) => context.bulkAssignAcademicArmStudentSubjects({}, user, {
      ...period, ...scope, Reason: 'Student requested a different trade',
      Assignments: [{ MembershipId: 'member', RevisionToken: member().__updateTime,
        CoreSubjectIds: ['english'], TradeSubjectIds: ['printing'], OptionalSubjectIds: [] }], ...input
    }),
    review: (decision = 'Approve', user = admin, input = {}) => context.reviewAcademicSubjectChange({}, user, {
      ...scope, MembershipId: 'member', RequestId: member().PendingSubjectChange?.RequestId,
      RevisionToken: member().__updateTime, Decision: decision, Reason: 'Reviewed with the class teacher', ...input
    })
  };
}

test('recorded zero, incomplete, absent and optional scores require approval; unrelated history does not', () => {
  for (const changedScore of [score, { ...score, SubjectId: 'music' }, { ...score, ComponentScores: [{ State: 'Absent' }] }]) {
    assert.equal(management.academicSubjectChangeImpact(membership, { ...membership, SubjectIds: ['english', 'printing'], TradeSubjectIds: ['printing'], OptionalSubjectIds: [] }, { studentScores: [changedScore] }).RequiresApproval, true);
  }
  const after = { ...membership, SubjectIds: ['english', 'printing'], TradeSubjectIds: ['printing'], OptionalSubjectIds: [] };
  assert.equal(management.academicSubjectChangeImpact(membership, after, { studentScores: [{ ...score, SubjectId: 'english' }, { ...score, BranchId: 'other' }, { ...score, TermId: 'previous' }] }).RequiresApproval, false);
});

function transferHarness(options) {
  const h = harness(options);
  h.state.arms.push({ ...scope, RecordId: 'destination', ArmId: 'destination', ClassId: 'class', Name: 'Genius', DepartmentId: 'arts' });
  h.state.departments.push({ ...scope, DepartmentId: 'arts', SchoolStage: 'senior-secondary', CoreSubjectIds: ['history'] });
  h.state.subjects.push({ ...scope, SubjectId: 'history', Name: 'History' });
  h.transfer = (input = {}, user = admin) => h.context.manageAcademicStudentMembership({}, user, {
    ...scope, RecordId: 'member', RevisionToken: h.member().__updateTime,
    ClassId: 'class', ArmId: 'destination', ResetSubjectSelections: true, Reason: 'Move to the Arts classroom', ...input
  });
  h.approver = { ...admin, username: 'other-principal' };
  return h;
}

function addLegacyDuplicate(h, extra = {}) {
  const row = { ...clone(membership), RecordId: 'legacy-duplicate', MembershipId: 'legacy-duplicate',
    __updateTime: 'legacy-rev', SavedNotes: 'Keep this historical record', ...extra };
  h.state.studentMemberships.push(row);
  return row;
}

test('applied transfer archives same-student legacy duplicates atomically and preserves scores and history', async () => {
  const h = transferHarness();
  const legacy = addLegacyDuplicate(h);
  const original = clone(legacy);
  const unrelated = addLegacyDuplicate(h, { RecordId: 'other-period', MembershipId: 'other-period', TermId: 'other-term' });
  h.state.studentMovements.push({ MovementId: 'historical-event', Status: 'Applied', Reason: 'Historical allocation' });
  await h.transfer({}, h.context.academicWebActor(ict));
  const archived = h.state.studentMemberships.find(row => row.MembershipId === legacy.MembershipId);
  assert.equal(h.member().ArmId, 'destination');
  assert.equal(archived.Status, 'Archived');
  assert.equal(archived.SupersededByMembershipId, h.member().MembershipId);
  for (const field of ['ClassId', 'ArmId', 'SubjectIds', 'TradeSubjectIds', 'SavedNotes']) assert.deepEqual(archived[field], original[field]);
  assert.equal(unrelated.Status, 'Active');
  assert.deepEqual(h.state.studentScores, [score]);
  assert.equal(h.state.studentMovements[0].Reason, 'Historical allocation');
  assert.ok(h.state.audit.some(row => row.Action === 'RETIRE DUPLICATE MEMBERSHIP'));
  const write = h.writes.find(row => row.documentId === legacy.MembershipId);
  assert.equal(write.updateTime, 'legacy-rev');
  assert.deepEqual(write.updateMask.sort(), ['Status', 'SupersededAt', 'SupersededByMembershipId', 'SupersededReason', 'UpdatedAt', 'UpdatedBy'].sort());
  assert.ok(h.writes.every(row => row.collectionPath !== 'academicStudentScores' && row.operation !== 'delete'));
});

for (const crossClass of [false, true]) {
  test(`${crossClass ? 'class-to-class' : 'arm-to-arm'} transfer leaves one current membership and allows the empty source classroom to be removed`, async () => {
    const h = transferHarness();
    addLegacyDuplicate(h);
    const originalScore = clone(h.state.studentScores);
    const oldArm = h.state.arms[0];
    Object.assign(oldArm, { IsClassroom: true, __updateTime: 'arm-v1' });
    if (crossClass) {
      h.state.classes.push({ ...h.state.classes[0], RecordId: 'class-11', ClassId: 'class-11', Name: 'Grade 11' });
      h.state.arms[1].ClassId = 'class-11';
    }
    await h.transfer({ ClassId: crossClass ? 'class-11' : 'class' }, h.context.academicWebActor(ict));
    const active = h.state.studentMemberships.filter(row => row.Status === 'Active');
    assert.equal(active.length, 1);
    assert.equal(active[0].MembershipId, 'member');
    assert.equal(active[0].ArmId, 'destination');
    assert.equal(active[0].ClassId, crossClass ? 'class-11' : 'class');
    assert.deepEqual(h.state.studentScores, originalScore);
    assert.equal(h.state.studentMovements.filter(row => row.FromArmId === 'arm').length, 1);
    const targets = await checkClassroomRemovals({
      input: { ClassIds: ['class'], ConfirmClassroomRemoval: true, RemoveClassrooms: [{ ArmId: 'arm', RevisionToken: 'arm-v1' }] },
      state: h.state, scope: { branchId: 'main', section: 'secondary' },
      query: async collection => { assert.equal(collection, 'academicStudentMemberships'); return h.state.studentMemberships.filter(row => row.ArmId === 'arm'); },
      students: async () => [{ AdmissionNo: 'S1', ClassName: crossClass ? 'Grade 11' : 'Grade 10', ClassArm: 'Genius', Status: 'Active' }]
    });
    assert.deepEqual(targets, [oldArm]);
    assert.deepEqual(h.state.studentScores, originalScore);
    const writesBeforeRetry = h.writes.length;
    await assert.rejects(h.transfer({ ClassId: active[0].ClassId }, h.context.academicWebActor(ict)), /different classroom|different class/);
    assert.equal(h.writes.length, writesBeforeRetry);
  });
}

test('pending/rejected/cancelled transfers do not retire duplicates; only approved transfers do', async () => {
  for (const decision of ['Approve', 'Reject', 'Cancel']) {
    const h = transferHarness();
    addLegacyDuplicate(h);
    await h.transfer();
    assert.equal(h.state.studentMemberships[1].Status, 'Active');
    await h.review(decision, decision === 'Cancel' ? admin : h.approver);
    assert.equal(h.state.studentMemberships[1].Status, decision === 'Approve' ? 'Archived' : 'Active');
    assert.deepEqual(h.state.studentScores, [score]);
  }
});

test('concurrent edits to a duplicate abort the whole transfer and its archival', async () => {
  for (const approval of [false, true]) {
    const h = transferHarness();
    addLegacyDuplicate(h);
    if (approval) await h.transfer();
    const writtenBefore = h.writes.length;
    const commit = h.context.batchCommitDocuments;
    h.context.batchCommitDocuments = async (...args) => {
      h.state.studentMemberships[1].__updateTime = 'concurrent-revision';
      return commit(...args);
    };
    await assert.rejects(approval ? h.review('Approve', h.approver) : h.transfer({}, h.context.academicWebActor(ict)), { code: 'ACADEMIC_WRITE_CONFLICT' });
    assert.equal(h.member().ArmId, 'arm');
    assert.equal(h.state.studentMemberships[1].Status, 'Active');
    assert.equal(h.writes.length, writtenBefore);
    assert.deepEqual(h.state.studentScores, [score]);
  }
});

test('web ICT supersedes source and duplicate pending requests atomically, preserving their full history and scores', async () => {
  const h = transferHarness();
  await h.request();
  const sourceRequest = clone(h.member().PendingSubjectChange);
  const duplicateRequest = { ...clone(sourceRequest), RequestId: 'duplicate-request', Reason: 'Original duplicate request' };
  addLegacyDuplicate(h, { PendingSubjectChange: duplicateRequest });
  const unrelated = addLegacyDuplicate(h, { RecordId: 'other-term', MembershipId: 'other-term', TermId: 'other-term', PendingSubjectChange: duplicateRequest });
  const oldHistory = clone(h.state.studentMovements);
  const firstNewWrite = h.writes.length;
  const response = await h.transfer({}, h.context.academicWebActor(ict));
  assert.match(response.message, /2 pending request\(s\) superseded.*Movement history/);
  assert.equal(h.member().ArmId, 'destination');
  assert.equal(h.member().PendingSubjectChange, undefined);
  assert.equal(h.state.studentMemberships[1].Status, 'Archived');
  assert.equal(h.state.studentMemberships[1].PendingSubjectChange, undefined);
  assert.equal(h.state.studentMemberships[1].SavedNotes, 'Keep this historical record');
  assert.deepEqual(h.state.studentMemberships[2], unrelated);
  assert.deepEqual(h.state.studentScores, [score]);
  assert.deepEqual(h.state.studentMovements.slice(0, oldHistory.length), oldHistory);
  const resolutions = h.state.studentMovements.filter(row => row.Status === 'Superseded');
  assert.equal(resolutions.length, 2);
  assert.deepEqual(resolutions.map(row => row.OriginalSubjectChangeRequest), [sourceRequest, duplicateRequest]);
  const transfer = h.state.studentMovements.find(row => row.Status === 'Approved');
  for (const row of resolutions) {
    assert.equal(row.SubjectChangeRequest.Status, 'Superseded');
    assert.equal(row.SubjectChangeRequest.ReviewedByUsername, 'ict');
    assert.equal(row.SubjectChangeRequest.SupersededByMembershipId, 'member');
    assert.equal(row.SubjectChangeRequest.SupersededByMovementId, transfer.MovementId);
    assert.match(row.Reason, /Superseded by ICT transfer/);
    assert.ok(h.writes.some(write => write.documentId === row.MovementId && write.exists === false));
  }
  assert.deepEqual(h.member().LastSupersededSubjectChange, resolutions[0].SubjectChangeRequest);
  assert.deepEqual(h.state.studentMemberships[1].LastSupersededSubjectChange, resolutions[1].SubjectChangeRequest);
  assert.equal(h.member().LastSubjectChange.Status, 'Approved');
  assert.equal(h.state.audit.filter(row => row.Action === 'SUBJECT CHANGE SUPERSEDED').length, 2);
  assert.ok(h.writes.slice(firstNewWrite).every(write => !/Scores|attendance|payment/i.test(write.collectionPath) && write.operation !== 'delete'));
  await assert.rejects(h.review('Approve', admin, { RequestId: sourceRequest.RequestId }), { code: 'ACADEMIC_SUBJECT_CHANGE_NOT_PENDING' });
});

test('web ICT may supersede an earlier transfer request without applying its old subject choices', async () => {
  const h = transferHarness();
  await h.transfer();
  const original = clone(h.member().PendingSubjectChange);
  const result = await h.transfer({}, h.context.academicWebActor(ict));
  assert.match(result.message, /superseded/);
  assert.equal(h.member().ArmId, 'destination');
  assert.equal(h.member().PendingSubjectChange, undefined);
  assert.deepEqual(h.state.studentMovements.find(row => row.Status === 'Superseded').OriginalSubjectChangeRequest, original);
  assert.deepEqual(h.state.studentScores, [score]);
});

test('ordinary and desktop ICT transfers still cannot supersede pending requests, including forged flags', async () => {
  for (const user of [admin, ict, { ...ict, fullAcademicAccess: true, WebCompanion: true }]) {
    const h = transferHarness();
    await h.request();
    const before = clone(h.state);
    await assert.rejects(h.transfer({ fullAcademicAccess: true, WebCompanion: true }, user), { code: 'ACADEMIC_SUBJECT_CHANGE_PENDING' });
    assert.deepEqual(h.state, before);
  }
  const h = transferHarness({ scores: [] });
  addLegacyDuplicate(h, { PendingSubjectChange: { RequestId: 'pending' } });
  await assert.rejects(h.transfer(), { code: 'ACADEMIC_SUBJECT_CHANGE_PENDING' });
  assert.equal(h.writes.length, 0);
});

test('pending requests survive invalid destinations, published-result locks, and non-transfer operations', async () => {
  for (const invalid of ['destination', 'published', 'withdrawal', 'same-classroom', 'subjects-only']) {
    const h = transferHarness();
    await h.request();
    if (invalid === 'published') h.state.termResults.push({ ...period, ...scope, ResultId: 'result', StudentRef: 'S1', Status: 'Published', Total: 80, __updateTime: 'result-rev' });
    const before = clone(h.state);
    const input = invalid === 'destination' ? { ArmId: 'unknown' }
      : invalid === 'withdrawal' ? { Operation: 'withdraw' }
      : invalid === 'same-classroom' ? { ArmId: 'arm' }
      : invalid === 'subjects-only' ? { ArmId: 'arm', ResetSubjectSelections: false, TradeSubjectIds: ['printing'], SubjectIds: ['english', 'printing'] } : {};
    await assert.rejects(h.transfer(input, h.context.academicWebActor(ict)));
    assert.deepEqual(h.state, before, invalid);
  }
});

test('concurrent source, duplicate or result updates keep every pending request intact and write no resolution', async () => {
  for (const target of ['source', 'duplicate', 'result']) {
    const h = transferHarness();
    await h.request();
    const pending = clone(h.member().PendingSubjectChange);
    addLegacyDuplicate(h, { PendingSubjectChange: pending });
    h.state.termResults.push({ ...period, ...scope, ResultId: 'result', StudentRef: 'S1', Status: 'Calculated Draft', Total: 80, __updateTime: 'result-rev' });
    const history = clone(h.state.studentMovements), count = h.writes.length;
    const commit = h.context.batchCommitDocuments;
    h.context.batchCommitDocuments = (...args) => {
      (target === 'result' ? h.state.termResults[0] : h.state.studentMemberships[target === 'source' ? 0 : 1]).__updateTime = 'concurrent-edit';
      return commit(...args);
    };
    await assert.rejects(h.transfer({}, h.context.academicWebActor(ict)), { code: 'ACADEMIC_WRITE_CONFLICT' });
    assert.equal(h.writes.length, count);
    assert.equal(h.member().ArmId, 'arm');
    for (const row of h.state.studentMemberships) {
      assert.equal(row.Status, 'Active');
      assert.deepEqual(row.PendingSubjectChange, pending);
      assert.equal(row.LastSupersededSubjectChange, undefined);
    }
    assert.deepEqual(h.state.studentMovements, history);
    assert.deepEqual(h.state.studentScores, [score]);
    assert.equal(h.state.termResults[0].SubjectChangeRecalculationRequired, undefined);
  }
});

test('destination reset disconnects old selections, applies compulsory cores and preserves history', async () => {
  const h = transferHarness({ scores: [] });
  const result = await h.transfer();
  assert.equal(h.member().ArmId, 'destination');
  assert.deepEqual(h.member().SubjectIds, ['history']);
  assert.deepEqual(h.member().TradeSubjectIds, []);
  assert.equal(h.member().CurriculumStatus, 'Pending Trade Selection');
  assert.deepEqual(h.state.studentMovements[0].FromSubjectIds, membership.SubjectIds);
  assert.match(result.message, /preserved/);
});

test('assessed transfer waits for independent approval then moves without rewriting any scores', async () => {
  const h = transferHarness();
  const result = await h.transfer();
  assert.equal(result.bulkResult.PendingApproval, 1);
  assert.equal(h.member().ArmId, 'arm');
  assert.deepEqual(h.member().SubjectIds, membership.SubjectIds);
  assert.equal(h.member().PendingSubjectChange.Kind, 'Classroom transfer');
  await assert.rejects(h.review('Approve'), { code: 'ACADEMIC_SUBJECT_CHANGE_SELF_APPROVAL' });
  await h.review('Approve', h.approver);
  assert.equal(h.member().ArmId, 'destination');
  assert.deepEqual(h.member().SubjectIds, ['history']);
  assert.deepEqual(h.state.studentScores, [score]);
  assert.ok(h.writes.every(row => row.collectionPath !== 'academicStudentScores'));
});

test('web ICT transfers an assessed student directly with an audited decision and no score writes', async () => {
  const h = transferHarness();
  await h.transfer({}, h.context.academicWebActor(ict));
  assert.equal(h.member().ArmId, 'destination');
  assert.equal(h.member().PendingSubjectChange, undefined);
  assert.equal(h.member().LastSubjectChange.ApprovalMode, 'Direct ICT web');
  assert.equal(h.member().LastSubjectChange.ReviewedByUsername, 'ict');
  assert.deepEqual(h.state.studentScores, [score]);
  assert.equal(h.state.studentMovements.length, 1);
  assert.equal(h.state.studentMovements[0].RecordedByRole, 'ICT');
  assert.equal(h.state.studentMovements[0].SubjectChangeRequest.Status, 'Approved');
  assert.ok(h.writes.every(row => row.collectionPath !== management.ACADEMIC_MANAGEMENT_COLLECTIONS.studentScores));
  assert.ok(h.writes.every(row => !row.data.PendingSubjectChange));
});

test('desktop ICT and forged client flags still need independent approval', async () => {
  const h = transferHarness();
  await h.transfer({ fullAcademicAccess: true, WebCompanion: true }, { ...ict, fullAcademicAccess: true });
  assert.equal(h.member().ArmId, 'arm');
  assert.equal(h.member().PendingSubjectChange.Status, 'Pending');
  await assert.rejects(h.review('Approve', ict), { code: 'ACADEMIC_SUBJECT_CHANGE_SELF_APPROVAL' });
  await h.review('Approve', h.context.academicWebActor(ict));
  assert.equal(h.member().ArmId, 'destination');
  assert.equal(h.member().LastSubjectChange.ApprovalMode, 'Direct ICT web');
  assert.deepEqual(h.state.studentScores, [score]);
});

test('web ICT applies assessed subject choices directly and can cancel existing requests', async () => {
  const h = harness();
  const response = await h.request({}, h.context.academicWebActor(ict));
  assert.equal(response.bulkResult.PendingApproval, 0);
  assert.equal(response.bulkResult.Updated, 1);
  assert.deepEqual(h.member().TradeSubjectIds, ['printing']);
  assert.equal(h.member().LastSubjectChange.ApprovalMode, 'Direct ICT web');
  assert.deepEqual(h.state.studentScores, [score]);
  const pending = harness();
  await pending.request();
  await pending.review('Cancel', pending.context.academicWebActor(ict));
  assert.equal(pending.member().PendingSubjectChange, undefined);
  assert.equal(pending.member().LastSubjectChange.Status, 'Cancelled');
  assert.deepEqual(pending.member().SubjectIds, membership.SubjectIds);
});

test('direct ICT changes retain result locks and only flag draft results for recalculation', async () => {
  for (const operation of ['transfer', 'request']) {
    const result = { ...period, ...scope, ResultId: 'result', StudentRef: 'S1', Status: 'Published', Total: 72, __updateTime: 'result-rev' };
    const h = transferHarness({ termResults: [result] });
    const actor = h.context.academicWebActor(ict);
    await assert.rejects(h[operation]({}, actor), { code: 'ACADEMIC_RESULT_IMMUTABLE' });
    assert.equal(h.writes.length, 0);
    h.state.termResults[0].Status = 'Calculated Draft';
    await h[operation]({}, actor);
    assert.equal(h.state.termResults[0].SubjectChangeRecalculationRequired, true);
    assert.equal(h.state.termResults[0].Total, 72);
    assert.deepEqual(h.state.studentScores, [score]);
  }
});

test('direct ICT transfers still validate capacity, scope, revision, period and subscription', async () => {
  const h = transferHarness();
  const actor = h.context.academicWebActor(ict);
  await assert.rejects(h.transfer({ RevisionToken: 'stale' }, actor), { code: 'ACADEMIC_WRITE_CONFLICT' });
  await assert.rejects(h.transfer({ BranchId: 'another' }, actor), { status: 403 });
  await assert.rejects(h.transfer({ Reason: 'no' }, actor), /5–1000/);
  await assert.rejects(h.transfer({}, { ...actor, subscriptionReadOnly: true }), { status: 403 });
  h.state.arms[1].Capacity = 1;
  h.state.studentMemberships.push({ ...membership, MembershipId: 'second', RecordId: 'second', StudentRef: 'S2', ArmId: 'destination' });
  await assert.rejects(h.transfer({}, actor), { code: 'ACADEMIC_ARM_CAPACITY_REACHED' });
  h.state.studentMemberships.pop();
  h.state.terms[0].Status = 'Closed';
  await assert.rejects(h.transfer({}, actor));
  assert.equal(h.writes.length, 0);
  assert.deepEqual(h.state.studentScores, [score]);
});

test('concurrent membership or result changes abort the entire direct ICT transfer', async () => {
  for (const changing of ['membership', 'result']) {
    const h = transferHarness({ termResults: [{ ...period, ...scope, ResultId: 'result', StudentRef: 'S1', Status: 'Calculated Draft', __updateTime: 'result-rev' }] });
    const commit = h.context.batchCommitDocuments;
    h.context.batchCommitDocuments = async (env, writes) => {
      (changing === 'membership' ? h.member() : h.state.termResults[0]).__updateTime = 'concurrent-edit';
      return commit(env, writes);
    };
    await assert.rejects(h.transfer({}, h.context.academicWebActor(ict)), { code: 'ACADEMIC_WRITE_CONFLICT' });
    assert.equal(h.writes.length, 0);
    assert.equal(h.member().ArmId, 'arm');
    assert.deepEqual(h.state.studentScores, [score]);
    assert.equal(h.state.termResults[0].SubjectChangeRecalculationRequired, undefined);
  }
});

test('mixed destination can await subject choices; reset in the current classroom is refused', async () => {
  const h = transferHarness({ scores: [] });
  await assert.rejects(h.transfer({ ArmId: 'arm' }), /different classroom/);
  h.state.arms[1].DepartmentId = '';
  await h.transfer();
  assert.deepEqual(h.member().SubjectIds, []);
  assert.equal(h.member().CurriculumStatus, 'Pending Core Selection');
});

test('pending transfers recheck capacity, curriculum, scores and published results on approval', async () => {
  const h = transferHarness({ termResults: [{ ...period, ...scope, ResultId: 'result', StudentRef: 'S1', Status: 'Published', __updateTime: 'result-rev' }] });
  await h.transfer();
  await assert.rejects(h.review('Approve', h.approver), { code: 'ACADEMIC_RESULT_IMMUTABLE' });
  h.state.termResults[0].Status = 'Calculated Draft';
  h.state.arms[1].Capacity = 1;
  h.state.studentMemberships.push({ ...membership, MembershipId: 'second', RecordId: 'second', StudentRef: 'S2', ArmId: 'destination' });
  await assert.rejects(h.review('Approve', h.approver), { code: 'ACADEMIC_ARM_CAPACITY_REACHED' });
  h.state.studentMemberships.pop();
  await h.review('Approve', h.approver);
  assert.equal(h.state.termResults[0].SubjectChangeRecalculationRequired, true);
});

test('rejecting or cancelling a transfer preserves the original classroom and selections', async () => {
  for (const decision of ['Reject', 'Cancel']) {
    const h = transferHarness();
    await h.transfer();
    await h.review(decision, decision === 'Cancel' ? admin : h.approver);
    assert.equal(h.member().ArmId, 'arm');
    assert.deepEqual(h.member().SubjectIds, membership.SubjectIds);
    assert.deepEqual(h.state.studentScores, [score]);
  }
});

test('classroom changes with unchanged subject IDs still protect existing assessment history', () => {
  assert.equal(management.academicSubjectChangeImpact(membership, { ...membership, ArmId: 'destination' }, { studentScores: [score] }).RequiresApproval, true);
});

test('transfer approval revalidates destination curriculum and rejects stale source revisions', async () => {
  const h = transferHarness();
  await assert.rejects(h.transfer({ RevisionToken: 'old' }), { code: 'ACADEMIC_WRITE_CONFLICT' });
  await h.transfer();
  h.state.departments.find(row => row.DepartmentId === 'arts').CoreSubjectIds = ['english'];
  await assert.rejects(h.review('Approve', h.approver));
  assert.equal(h.member().ArmId, 'arm');
  assert.deepEqual(h.state.studentScores, [score]);
});

test('scored subject changes require a meaningful reason, including older client requests', async () => {
  const h = harness();
  await assert.rejects(h.request({ Reason: '' }), { code: 'ACADEMIC_SUBJECT_CHANGE_REASON_REQUIRED' });
  await assert.rejects(h.request({ Reason: 'ok' }), { code: 'ACADEMIC_SUBJECT_CHANGE_REASON_REQUIRED' });
  assert.equal(h.writes.length, 0);
});

test('request preserves selections and scores; an independent authorised approval applies only the choices', async () => {
  const h = harness();
  const beforeScores = clone(h.state.studentScores);
  const response = await h.request();
  assert.equal(response.bulkResult.PendingApproval, 1);
  assert.deepEqual(h.member().SubjectIds, membership.SubjectIds);
  assert.equal(h.member().PendingSubjectChange.Status, 'Pending');
  assert.equal(h.state.studentMovements[0].Status, 'Pending approval');
  await assert.rejects(h.request(), { code: 'ACADEMIC_SUBJECT_CHANGE_PENDING' });
  await assert.rejects(h.review('Approve', teacher), { status: 403 });
  await h.review();
  assert.equal(h.member().PendingSubjectChange, undefined);
  assert.deepEqual(h.member().SubjectIds, ['english', 'printing']);
  assert.equal(h.member().LastSubjectChange.ReviewedByUsername, 'principal');
  assert.deepEqual(h.state.studentScores, beforeScores);
  assert.ok(h.writes.every(row => row.collectionPath !== 'academicStudentScores'));
  const count = h.writes.length;
  await assert.rejects(h.review(), { code: 'ACADEMIC_SUBJECT_CHANGE_NOT_PENDING' });
  assert.equal(h.writes.length, count);
});

test('an obsolete Trade choice can be replaced through approval without altering its existing scores', async () => {
  const h = harness();
  h.state.subjects.find(row => row.SubjectId === 'catering').SeniorChoiceRole = 'Optional';
  const beforeScores = clone(h.state.studentScores);
  await assert.rejects(h.request({ Reason: '' }), { code: 'ACADEMIC_SUBJECT_CHANGE_REASON_REQUIRED' });
  assert.equal(h.writes.length, 0);
  await h.request();
  assert.deepEqual(h.member().SubjectIds, membership.SubjectIds);
  assert.equal(h.member().PendingSubjectChange.Status, 'Pending');
  await assert.rejects(h.review('Approve', teacher), { status: 403 });
  await h.review();
  assert.deepEqual(h.member().SubjectIds, ['english', 'printing']);
  assert.deepEqual(h.state.studentScores, beforeScores);
  assert.ok(h.writes.every(row => row.collectionPath !== 'academicStudentScores'));
});

test('a manager cannot approve their own request; rejection and requester cancellation preserve subjects', async () => {
  const h = harness();
  await h.request({}, admin);
  await assert.rejects(h.review(), { code: 'ACADEMIC_SUBJECT_CHANGE_SELF_APPROVAL' });
  await h.review('Cancel', admin);
  assert.equal(h.member().LastSubjectChange.Status, 'Cancelled');
  assert.deepEqual(h.member().SubjectIds, membership.SubjectIds);
  await h.request();
  await h.review('Reject');
  assert.equal(h.member().LastSubjectChange.Status, 'Rejected');
  assert.deepEqual(h.member().SubjectIds, membership.SubjectIds);
});

test('unassessed changes apply immediately and unassigned teachers cannot request them', async () => {
  const h = harness({ scores: [] });
  await assert.rejects(h.request({}, { ...teacher, username: 'another-teacher' }), { status: 403 });
  const response = await h.request();
  assert.equal(response.bulkResult.Updated, 1);
  assert.equal(h.member().PendingSubjectChange, undefined);
});

test('stale revisions, wrong scope, changed curriculum and pending transfers fail closed', async () => {
  const h = harness();
  await h.request();
  await assert.rejects(h.review('Approve', admin, { RevisionToken: 'old' }), { code: 'ACADEMIC_WRITE_CONFLICT' });
  await assert.rejects(h.review('Approve', admin, { BranchId: 'other' }), { status: 403 });
  await assert.rejects(h.context.manageAcademicStudentMembership({}, admin, { ...scope, MembershipId: 'member', RevisionToken: h.member().__updateTime }), { code: 'ACADEMIC_SUBJECT_CHANGE_PENDING' });
  h.state.subjects.find(row => row.SubjectId === 'printing').Status = 'Inactive';
  await assert.rejects(h.review());
  assert.ok(h.member().PendingSubjectChange);
  assert.deepEqual(h.member().SubjectIds, membership.SubjectIds);
});

test('historical classroom scores in the same term still require approval', async () => {
  const h = harness({ scores: [{ ...score, ClassId: 'old-class', ArmId: 'old-arm' }] });
  await h.request();
  assert.ok(h.member().PendingSubjectChange);
  assert.ok(h.queries.every(query => query.options.filters.some(filter => filter.field === 'BranchId')
    && query.options.filters.some(filter => filter.field === 'StudentRef')));
});

test('legacy sectionless scores are protected using existing section scoping', async () => {
  const legacy = { ...score };
  delete legacy.SchoolSection;
  const h = harness({ scores: [legacy] });
  await h.request();
  assert.ok(h.member().PendingSubjectChange);
  const otherSection = harness({ scores: [{ ...score, SchoolSection: 'primary' }] });
  await otherSection.request();
  assert.equal(otherSection.member().PendingSubjectChange, undefined);
});

test('closed terms allow rejection or cancellation but never approval', async () => {
  for (const decision of ['Reject', 'Cancel']) {
    const h = harness();
    await h.request();
    h.state.terms[0].Status = 'Closed';
    await assert.rejects(h.review('Approve'));
    await h.review(decision, decision === 'Cancel' ? teacher : admin);
    assert.equal(h.member().PendingSubjectChange, undefined);
    assert.deepEqual(h.member().SubjectIds, membership.SubjectIds);
  }
});

test('membership payloads cannot forge or clear server-owned approval fields', () => {
  const forged = { ...membership, PendingSubjectChange: { Status: 'Approved' }, LastSubjectChange: { Status: 'Approved' } };
  const fresh = management.normalizeAcademicStudentMembership(forged, { branchId: 'main', section: 'secondary' });
  assert.equal(fresh.PendingSubjectChange, undefined);
  assert.equal(fresh.LastSubjectChange, undefined);
  const existing = { ...membership, PendingSubjectChange: { Status: 'Pending', RequestId: 'existing' } };
  const normalized = management.normalizeAcademicStudentMembership(forged, { branchId: 'main', section: 'secondary' }, existing);
  assert.deepEqual(normalized.PendingSubjectChange, existing.PendingSubjectChange);
});

test('assessment-history queries chunk students and fail closed if the safe limit is exceeded', async () => {
  const h = harness();
  await h.context.loadAcademicSubjectChangeEvidence({}, { branchId: 'main', section: 'secondary' }, {
    ...period, StudentRefs: Array.from({ length: 45 }, (_value, index) => `S${index}`)
  });
  assert.equal(h.queries.length, 6);
  assert.ok(h.queries.every(query => query.options.filters.find(filter => filter.field === 'StudentRef').value.length <= 20));
  h.context.queryCollection = async () => Array.from({ length: 10001 }, () => score);
  await assert.rejects(h.request(), { code: 'ACADEMIC_SUBJECT_HISTORY_LIMIT' });
  assert.equal(h.writes.length, 0);
});

test('finalised results block approval; draft results become ineligible for publication until recalculated', async () => {
  const result = { ...period, ...scope, ResultId: 'result', RecordId: 'result', StudentRef: 'S1', Status: 'Published', __updateTime: 'result-rev' };
  const h = harness({ termResults: [result] });
  await h.request();
  await assert.rejects(h.review(), { code: 'ACADEMIC_RESULT_IMMUTABLE' });
  h.state.termResults[0].Status = 'Calculated Draft';
  await h.review();
  assert.equal(h.state.termResults[0].SubjectChangeRecalculationRequired, true);
  await assert.rejects(h.context.changeAcademicTermResultStatus({}, admin, { ResultId: 'result', Status: 'Reviewed' }), { code: 'ACADEMIC_SUBJECT_RESULT_STALE' });
  assert.deepEqual(h.state.studentScores, [score]);
});

test('score guards are masked revision writes and race with subject changes atomically', async () => {
  const h = harness({ scores: [] });
  const guard = management.academicScoreMembershipGuards(h.state, [score, score]);
  assert.equal(guard.length, 1);
  assert.deepEqual(guard[0].updateMask, ['ScoreHistoryRevision']);
  assert.deepEqual(Object.keys(guard[0].data), ['ScoreHistoryRevision']);
  await h.request();
  await assert.rejects(h.context.batchCommitDocuments({}, guard), { status: 409 });
  assert.throws(() => management.academicScoreMembershipGuards({ studentMemberships: [] }, [score]), { code: 'ACADEMIC_WRITE_CONFLICT' });
});

test('every score writer and desktop action entry point includes the controlled workflow', async () => {
  for (const name of ['saveAcademicScoreDraft', 'applyActiveAcademicScoreLayout', 'importAcademicScores', 'rollbackAcademicScoreImport', 'syncAcademicCbtScores']) {
    const part = source.slice(source.indexOf(`export async function ${name}(`)).split(/\nexport (?:async )?function /)[0];
    assert.match(part, /academicScoreMembershipGuards/);
  }
  const backend = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
  assert.equal((backend.match(/'reviewAcademicSubjectChange'/g) || []).length, 3);
});

test('web review queue escapes stored text, respects reviewer roles and stays in the Student subjects task', async () => {
  const h = harness();
  await h.request({ Reason: '<script>untrusted reason</script>' });
  const adminSource = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
  const start = adminSource.indexOf('function academicSubjectChangeRequests(');
  const end = adminSource.indexOf('function academicArmSubjectRegister(', start);
  const context = vm.createContext({
    currentUser: admin, academicManagementFilters: { sessionId: 'session', termId: 'term' },
    clean: value => String(value ?? '').trim(), academicRecordId: row => row.MembershipId,
    academicLabel: (_rows, id) => id, escapeHtml: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
  });
  vm.runInContext(adminSource.slice(start, end), context);
  const data = { ...h.state, permissions: { canApproveSubjectChanges: true } };
  const render = () => context.academicSubjectChangeRequests(data);
  assert.match(render(), /value="Approve"/);
  assert.match(render(), /name="RequestId"/);
  assert.match(render(), /&lt;script&gt;/);
  assert.doesNotMatch(render(), /<script>/);
  context.currentUser = teacher;
  assert.match(render(), /value="Cancel"/);
  assert.doesNotMatch(render(), /value="Approve"/);
  data.permissions.fullAcademicAccess = true;
  assert.match(render(), /value="Approve"/);
  assert.match(render(), /including their own requests/);
  data.permissions.fullAcademicAccess = false;
  context.currentUser = { ...teacher, username: 'another' };
  data.permissions.canApproveSubjectChanges = false;
  assert.doesNotMatch(render(), /data-academic-workflow/);
  context.academicManagementFilters.termId = 'other';
  assert.equal(render(), '');
  assert.match(adminSource, /nodes: nodes\(form\('\[data-academic-arm-subject-register\]'\), form\('\[data-academic-arm-subject-info\]'\), form\('\[data-academic-subject-change-requests\]'\)\)/);
});

async function workflowUiHarness({ missingRole, action = 'bulkAssignAcademicArmStudentSubjects', response = {}, requestError } = {}) {
  const adminSource = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
  const alerts = [], statuses = [], requests = [];
  let submit, focuses = 0, scrolls = 0;
  const document = { activeElement: null, getElementById: () => ({}) };
  const choice = { isConnected: true, focus: () => { focuses++; document.activeElement = choice; }, scrollIntoView: () => { scrolls++; } };
  const row = {
    dataset: { membershipId: 'member', revisionToken: 'rev-1', studentName: 'Adutomvie Gbenizibe' },
    querySelector: () => choice,
    querySelectorAll: selector => selector.includes(`"${missingRole}"`) ? [] : [{ value: selector.includes('Core') ? 'english' : 'printing' }]
  };
  const form = {
    dataset: { academicWorkflow: action }, contains: target => target === choice,
    elements: Object.fromEntries(['SchoolSection', 'SessionId', 'TermId', 'ClassId', 'ArmId', 'Reason'].map(key => [key, { value: key }])),
    querySelector: () => ({}), querySelectorAll: () => [row],
    addEventListener: (_event, handler) => { submit = handler; }
  };
  const context = vm.createContext({
    document, window: { DynamaxDialogs: { alert: async options => { alerts.push(options); document.activeElement = {}; } } },
    panelEl: { querySelectorAll: () => [form] },
    academicManagementData: { studentMemberships: [membership] },
    academicFind: rows => rows[0], academicStudentSubjectProfile: () => ({ unavailableSubjectIds: [] }),
    runButtonAction: async (_button, _text, task) => task(),
    setStatus: (_node, message, tone) => statuses.push({ message, tone }),
    academicManagementRequest: async (requestedAction, payload) => { requests.push({ action: requestedAction, payload }); if (requestError) throw requestError; return response; },
    renderAcademicManagement: () => {}
  });
  vm.runInContext(adminSource.slice(adminSource.indexOf('async function showAcademicSubjectWorkflowFeedback('), adminSource.indexOf('function populateAcademicMovementForm(')), context);
  const bindingStart = adminSource.indexOf("  panelEl.querySelectorAll('[data-academic-workflow]').forEach((form) => form.addEventListener('submit'");
  vm.runInContext(adminSource.slice(bindingStart, adminSource.indexOf('  const movementForm =', bindingStart)), context);
  return { context, form, alerts, statuses, requests, submit: () => submit({ preventDefault() {} }), focuses: () => focuses, scrolls: () => scrolls };
}

test('missing Core or Trade selections show a popup, retain the inline error and refocus the affected student without saving', async () => {
  for (const role of ['Core', 'Trade']) {
    const h = await workflowUiHarness({ missingRole: role });
    await h.submit();
    const message = `Adutomvie Gbenizibe must have at least one ${role} subject.`;
    assert.equal(h.alerts.length, 1);
    assert.equal(h.alerts[0].message, message);
    assert.equal(h.alerts[0].tone, 'danger');
    assert.deepEqual(h.statuses, [{ message, tone: 'bad' }]);
    assert.equal(h.requests.length, 0);
    assert.equal(h.focuses(), 2);
    assert.equal(h.scrolls(), 1);
  }
});

test('subject submission shows server errors and pending approval notices without changing unrelated workflows', async () => {
  const failed = await workflowUiHarness({ requestError: new Error('Enter a reason for this scored subject change.') });
  await failed.submit();
  assert.equal(failed.alerts[0].message, 'Enter a reason for this scored subject change.');
  const pending = await workflowUiHarness({ response: { message: '1 applied; 2 awaiting authorised approval.', bulkResult: { PendingApproval: 2 } } });
  await pending.submit();
  assert.equal(pending.alerts[0].title, 'Subject changes awaiting approval');
  assert.match(pending.alerts[0].items.join(' '), /current subject selections remain active/);
  const immediate = await workflowUiHarness({ response: { bulkResult: { PendingApproval: 0 } } });
  await immediate.submit();
  assert.equal(immediate.alerts.length, 0);
  await immediate.context.showAcademicSubjectWorkflowFeedback({ dataset: { academicWorkflow: 'saveAcademicTimetableEntry' } }, { error: new Error('Other workflow') });
  assert.equal(immediate.alerts.length, 0);
  await immediate.context.showAcademicSubjectWorkflowFeedback({ dataset: { academicWorkflow: 'reviewAcademicSubjectChange' } }, { error: new Error('You cannot approve your own request.') });
  assert.equal(immediate.alerts[0].title, 'Subject-change review not completed');
});
