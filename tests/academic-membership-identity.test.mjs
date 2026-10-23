import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import * as management from '../functions/lib/academic-management.js';
import * as outcomes from '../functions/lib/academic-session-outcomes.js';

const source = await readFile(new URL('../functions/lib/academic-management.js', import.meta.url), 'utf8');
const scope = { BranchId: 'main', SchoolSection: 'secondary' };
const period = { SessionId: 'session', TermId: 'term' };
const identity = { ...scope, ...period, StudentRef: 'TEST/26/268' };
const actor = { role: 'Principal', username: 'admin', edition: 'school', allowedSections: ['academics'] };
const clone = value => JSON.parse(JSON.stringify(value));
const member = patch => ({ ...identity, RecordId: 'legacy-0268', MembershipId: 'legacy-0268',
  ClassId: 'class', ArmId: 'arm', Status: 'Active', SubjectIds: ['math'], __updateTime: 'v1', ...patch });

test('membership lookup reuses legacy document IDs and keeps branch/section/period/admission scopes separate', () => {
  const legacy = member();
  assert.equal(management.findAcademicStudentMembership([legacy], identity), legacy);
  for (const field of ['BranchId', 'SchoolSection', 'SessionId', 'TermId', 'StudentRef']) {
    assert.equal(management.findAcademicStudentMembership([legacy], { ...identity, [field]: 'other' }), null);
  }
  assert.equal(management.findAcademicStudentMembership([legacy], { ...identity, StudentRef: 'TEST/26/0268' }), null);
  assert.equal(management.sameAcademicMembershipIdentity({}, {}), false);
  assert.equal(management.findAcademicStudentMembership([member({ Status: 'Archived', SupersededByMembershipId: 'current' }),
    member({ RecordId: 'current', MembershipId: 'current' })], identity).MembershipId, 'current');
  assert.throws(() => management.findAcademicStudentMembership([legacy, member({ MembershipId: 'second', RecordId: 'second' })], identity), { code: 'ACADEMIC_DUPLICATE_MEMBERSHIP' });
  assert.throws(() => management.normalizeAcademicStudentMembership({}, {}, member({ Status: 'Archived', SupersededByMembershipId: 'current' })), { code: 'ACADEMIC_MEMBERSHIP_SUPERSEDED' });
});

test('retirement planner is reversible, scoped, revision guarded and does not mutate input', () => {
  const kept = member({ MembershipId: 'current', RecordId: 'current', ArmId: 'destination' });
  const legacy = member({ UnknownHistory: { Keep: true }, CreatedAt: 'original' });
  const rows = [kept, legacy, member({ RecordId: 'other', MembershipId: 'other', TermId: 'old' })];
  const before = clone(rows);
  const plan = management.planAcademicDuplicateMembershipRetirement(rows, kept, { reason: 'Confirmed transfer', timestamp: 'now', actor: 'admin' });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].after.Status, 'Archived');
  assert.equal(plan[0].after.SupersededByMembershipId, 'current');
  assert.deepEqual(plan[0].after.UnknownHistory, { Keep: true });
  assert.equal(plan[0].after.CreatedAt, 'original');
  assert.equal(plan[0].after.ArmId, legacy.ArmId);
  assert.deepEqual(rows, before);
  assert.throws(() => management.planAcademicDuplicateMembershipRetirement(rows, { ...kept, __updateTime: '' }, { reason: 'Repair' }), { code: 'ACADEMIC_WRITE_CONFLICT' });
});

function harness({ unassigned = false } = {}) {
  const row = member({ ArmId: unassigned ? '' : 'arm' });
  const state = {
    sessions: [{ ...scope, SessionId: 'session', Status: 'Active' }],
    terms: [{ ...scope, ...period, Status: 'Active' }],
    classes: [{ ...scope, ClassId: 'class', Code: 'GR7', Name: 'Grade 7', SchoolStage: 'junior-secondary', Status: 'Active' }],
    arms: [{ ...scope, ClassId: 'class', ArmId: 'arm', Code: 'MER', Name: 'Merit', Status: 'Active' },
      { ...scope, ClassId: 'class', ArmId: 'other-arm', Code: 'RES', Name: 'Reserved', Status: 'Active' }],
    subjects: [{ ...scope, SubjectId: 'math', Code: 'MAT', Name: 'Mathematics', Status: 'Active' }],
    departments: [], offerings: [{ ...scope, ...period, ClassId: 'class', SubjectId: 'math', SubjectRole: 'Core', Compulsory: true, Status: 'Active' }],
    teacherAllocations: [], studentMemberships: [row], studentMovements: [], audit: [], promotionDecisions: [], promotionEvents: []
  };
  management.applyAcademicStudentCurriculum(state, row, { allowIncompleteCurriculum: true });
  const profiles = [{ ...scope, AdmissionNo: identity.StudentRef, ClassName: 'Grade 7', Status: 'Active',
    __scopePath: 'schoolBranches/main/sections/secondary/students', __id: 'profile', __updateTime: 'profile-v1' }];
  const writes = [];
  const store = Object.fromEntries(Object.entries(state).map(([key, rows]) => [management.ACADEMIC_MANAGEMENT_COLLECTIONS[key], rows]));
  store[profiles[0].__scopePath] = profiles;
  const id = row => row.RecordId || row.MembershipId || row.MovementId || row.AuditId || row.__id;
  const context = vm.createContext({ ...management, ...outcomes, crypto: webcrypto, TextEncoder, TextDecoder, safeScopeId: String,
    listSchoolCollection: async () => clone(profiles), loadOrganizationNameProfile: async () => ({}),
    batchCommitDocuments: async (_env, batch) => {
      for (const write of batch) {
        const existing = (store[write.collectionPath] || []).find(row => id(row) === write.documentId);
        if ((write.updateTime && write.updateTime !== existing?.__updateTime) || (write.exists === false && existing)) {
          throw Object.assign(new Error('Concurrent edit'), { status: 409 });
        }
      }
      for (const write of batch) {
        const rows = store[write.collectionPath] ||= [];
        const index = rows.findIndex(row => id(row) === write.documentId);
        const next = { ...(write.updateMask ? rows[index] : {}), ...clone(write.data), __id: write.documentId, __updateTime: 'v2' };
        if (index < 0) rows.push(next); else rows[index] = next;
      }
      writes.push(...clone(batch));
    }
  });
  vm.runInContext(source.replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/^export /gm, ''), context);
  context.academicScope = async () => ({ branchId: 'main', section: 'secondary' });
  context.loadScopedAcademicState = async () => clone(state);
  context.loadPeople = async () => ({ students: clone(profiles), staff: [] });
  context.bootstrapAcademicManagement = async () => ({ ok: true });
  context.academicOperationalContext = async () => ({ state: clone(state), scope: { branchId: 'main', section: 'secondary' } });
  context.academicOperationalResponse = async () => ({ ok: true });
  return { state, profiles, writes, context,
    allocate: patch => context.bulkAllocateAcademicStudents({}, actor, { ...scope, ...period, ClassId: 'class', ArmId: 'arm', StudentRefs: [identity.StudentRef], ...patch }),
    import: patch => context.bulkImportAcademicStudentMemberships({}, actor, { ...scope, ...period, Rows: [{ StudentRef: identity.StudentRef,
      FirstName: 'Test', Surname: 'Student', ClassCode: 'GR7', ArmCode: 'MER', ...patch }] }) };
}

test('repeat allocations and CSV imports use the legacy ID instead of creating a second membership', async () => {
  const h = harness();
  assert.equal((await h.allocate()).bulkResult.Skipped, 1);
  assert.equal((await h.import()).importResult.Skipped, 1);
  assert.equal(h.state.studentMemberships.length, 1);
  assert.equal(h.writes.length, 0);
  await assert.rejects(h.allocate({ ArmId: 'other-arm' }), { code: 'ACADEMIC_BULK_MEMBERSHIP_CONFLICT' });
  await assert.rejects(h.import({ ArmCode: 'RES' }), { code: 'ACADEMIC_IMPORT_MEMBERSHIP_CONFLICT' });
});

test('initial arm allocation completes an unassigned legacy membership in place and is safe to repeat', async () => {
  const h = harness({ unassigned: true });
  const result = await h.allocate();
  assert.equal(result.bulkResult.Updated, 1);
  assert.equal(result.bulkResult.Created, 0);
  assert.equal(h.state.studentMemberships.length, 1);
  assert.equal(h.state.studentMemberships[0].MembershipId, 'legacy-0268');
  assert.equal(h.state.studentMemberships[0].ArmId, 'arm');
  assert.equal(h.profiles[0].AcademicMembershipId, 'legacy-0268');
  assert.equal((await h.allocate()).bulkResult.Skipped, 1);
});

test('direct creation with a different ID cannot duplicate an existing student-period', async () => {
  const h = harness();
  await assert.rejects(h.context.saveAcademicManagementRecord({}, actor, { ...identity, RecordType: 'studentmembership',
    MembershipId: 'new-0268', ClassId: 'class', ArmId: 'arm' }), { code: 'ACADEMIC_DUPLICATE_MEMBERSHIP' });
  assert.equal(h.writes.length, 0);
});

test('a concurrent profile change prevents allocation from overwriting a newer placement', async () => {
  const h = harness({ unassigned: true });
  const commit = h.context.batchCommitDocuments;
  h.context.batchCommitDocuments = async (...args) => {
    h.profiles[0].__updateTime = 'concurrent-profile';
    return commit(...args);
  };
  await assert.rejects(h.allocate(), { code: 'ACADEMIC_WRITE_CONFLICT' });
  assert.equal(h.state.studentMemberships[0].ArmId, '');
  assert.equal(h.writes.length, 0);
});

test('student register hides only explicitly superseded archives while retaining other history', async () => {
  const ui = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
  const fn = ui.slice(ui.indexOf('function academicCurrentMembershipRegisterRows('), ui.indexOf('function academicStudentWorkspace('));
  const context = vm.createContext({ clean: value => String(value || '').trim() });
  vm.runInContext(fn, context);
  const rows = [member(), member({ Status: 'Archived', SupersededByMembershipId: 'current' }), member({ Status: 'Withdrawn' }), member({ Status: 'Archived' })];
  assert.deepEqual(context.academicCurrentMembershipRegisterRows(rows), [rows[0], rows[2], rows[3]]);
  assert.match(ui, /table\(membershipRegister, academicCurrentMembershipRegisterRows\(rows.studentMemberships\)/);
});

test('promotion reuses a matching legacy membership and guards it against concurrent transfers', async () => {
  for (const concurrent of [false, true]) {
    const h = harness();
    h.state.promotionDecisions.push({ ...identity, PromotionDecisionId: 'promotion', RecordId: 'promotion',
      Status: 'Approved', FinalOutcome: 'Repeated', __updateTime: 'promotion-v1' });
    if (concurrent) {
      const commit = h.context.batchCommitDocuments;
      h.context.batchCommitDocuments = async (...args) => {
        h.state.studentMemberships[0].__updateTime = 'concurrent-transfer';
        return commit(...args);
      };
    }
    const action = h.context.changeAcademicPromotionStatus({}, actor, { ...scope, PromotionDecisionId: 'promotion',
      Status: 'Committed', RevisionToken: 'promotion-v1', DestinationSessionId: 'session', DestinationTermId: 'term',
      DestinationClassId: 'class', DestinationArmId: 'arm' });
    if (concurrent) {
      await assert.rejects(action, { code: 'ACADEMIC_WRITE_CONFLICT' });
      assert.equal(h.writes.length, 0);
    } else {
      await action;
      assert.equal(h.state.promotionDecisions[0].DestinationMembershipId, 'legacy-0268');
      assert.equal(h.state.studentMemberships.length, 1);
      assert.deepEqual(h.state.studentMemberships[0].SubjectIds, ['math']);
    }
  }
});
