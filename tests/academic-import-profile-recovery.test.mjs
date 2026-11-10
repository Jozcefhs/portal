import * as placementGuards from '../functions/lib/academic-placement-guards.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import * as management from '../functions/lib/academic-management.js';
import * as outcomes from '../functions/lib/academic-session-outcomes.js';
import * as studentStatus from '../functions/lib/student-academic-status.js';
import * as schoolScope from '../functions/lib/school-scope.js';
import { formatPersonName } from '../functions/lib/person-name-format.js';
import { normalizeClassKey } from '../functions/lib/class-names.js';

const source = await readFile(new URL('../functions/lib/academic-management.js', import.meta.url), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const scope = { __updateTime: 'structure-1', BranchId: 'area-1-primary', SchoolSection: 'primary' };
const period = { SessionId: 'session', TermId: 'term' };
const reference = 'TEST/26/0356';
const profilePath = 'schoolBranches/area-1-primary/sections/primary/students';
const actor = { role: 'Super Admin', username: 'test-admin', edition: 'school', allowedSections: ['academics'] };
const membership = patch => ({ ...scope, ...period, StudentRef: reference,
  RecordId: 'legacy-membership', MembershipId: 'legacy-membership', ClassId: 'reception', ArmId: 'distinction',
  Status: 'Active', SubjectIds: ['math', 'retained-old-subject'], CoreSubjectIds: ['math'], OptionalSubjectIds: ['retained-old-subject'],
  TradeSubjectIds: [], DepartmentId: '', CurriculumStatus: 'Saved', PendingCurriculum: true,
  CustomHistory: { keep: true }, __updateTime: 'membership-v1', ...patch });

function harness(options = {}) {
  const state = Object.fromEntries(Object.keys(management.ACADEMIC_MANAGEMENT_COLLECTIONS).map(key => [key, []]));
  Object.assign(state, {
    sessions: [{ ...scope, SessionId: 'session', Name: '2026/2027', Status: 'Active' }],
    terms: [{ ...scope, ...period, Name: 'First Term', Status: 'Active' }],
    classes: [{ ...scope, ClassId: 'reception', Code: 'REC', Name: 'Reception', Status: 'Active', SchoolStage: 'primary' },
      { ...scope, ClassId: 'creche', Code: 'CRE', Name: 'Crèche', Status: 'Active', SchoolStage: 'primary' }],
    arms: [{ ...scope, ArmId: 'distinction', ClassId: 'reception', Name: 'Distinction', Code: 'DIS', Status: 'Active' },
      { ...scope, ArmId: 'merit', ClassId: 'reception', Name: 'Merit', Code: 'MER', Status: 'Active' }],
    subjects: [{ ...scope, SubjectId: 'math', Code: 'MAT', Name: 'Mathematics', Status: 'Active' },
      { ...scope, SubjectId: 'eng', Code: 'ENG', Name: 'English', Status: 'Active' }],
    offerings: [{ ...scope, ...period, ClassId: 'reception', SubjectId: 'eng', SubjectRole: 'Core', Status: 'Active' }],
    studentMemberships: options.newPupil ? [] : [membership(options.membership)],
    studentMovements: [{ ...scope, ...period, StudentRef: reference, MovementId: 'original-movement', CreatedAt: 'original' }],
    studentScores: [{ ...scope, ...period, StudentRef: reference, ScoreId: 'original-score', Score: 89 }]
  });
  const profiles = [], writes = [], store = Object.fromEntries(Object.entries(state).map(([key, rows]) => [management.ACADEMIC_MANAGEMENT_COLLECTIONS[key], rows]));
  store[profilePath] = profiles;
  const foreignPath = 'schoolBranches/main/sections/secondary/students';
  store[foreignPath] = [{ ...scope, BranchId: 'main', SchoolSection: 'secondary', AdmissionNo: reference,
    __id: 'TEST-26-0356', DisplayName: 'Different learner', GuardianEmail: 'private@example.invalid' }];
  const h = { state, profiles, writes, store, foreignPath, beforeCommit: null };
  const rowId = row => row.__id || row.RecordId || row.MembershipId || row.MovementId || row.AuditId || row.ScoreId || row.ArmId || row.ClassId;
  const context = vm.createContext({ ...placementGuards, ...management, ...outcomes, ...studentStatus, ...schoolScope,
    formatPersonName, normalizeClassKey, crypto: webcrypto, TextEncoder, TextDecoder,
    loadOrganizationNameProfile: async () => ({}),
    batchCommitDocuments: async (_env, batch) => {
      if (h.beforeCommit) h.beforeCommit();
      for (const write of batch) {
        const previous = (store[write.collectionPath] || []).find(row => rowId(row) === write.documentId);
        if ((write.exists === false && previous) || (write.updateTime && write.updateTime !== previous?.__updateTime)) {
          throw Object.assign(new Error('Concurrent edit'), { status: 409 });
        }
      }
      for (const write of batch) {
        const rows = store[write.collectionPath] ||= [], index = rows.findIndex(row => rowId(row) === write.documentId);
        const next = { ...(write.updateMask ? rows[index] : {}), ...clone(write.data), __id: write.documentId, __updateTime: 'saved-v2' };
        if (index < 0) rows.push(next); else rows[index] = next;
      }
      writes.push(...clone(batch));
    }
  });
  vm.runInContext(source.replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/^export /gm, ''), context);
  context.academicScope = async () => ({ branchId: scope.BranchId, section: scope.SchoolSection });
  context.loadScopedAcademicState = async () => clone(state);
  context.loadPeople = async (_env, _user, requested) => {
    assert.equal(requested.branchId, scope.BranchId);
    assert.equal(requested.section, scope.SchoolSection);
    return { staff: [], students: clone(profiles).map(row => ({ ...row, __scopePath: profilePath })) };
  };
  context.bootstrapAcademicManagement = async () => ({ ok: true });
  h.run = (patch = {}, input = {}) => context.bulkImportAcademicStudentMemberships({}, actor, { ...scope, ...period,
    Rows: [{ StudentRef: reference, FirstName: 'Test', Surname: 'Pupil', ClassCode: 'REC', ...patch }], ...input });
  return h;
}

test('re-import restores a missing pupil profile from its active membership without changing placement, subjects or records', async () => {
  const h = harness(), original = clone(h.state.studentMemberships[0]), scores = clone(h.state.studentScores), movements = clone(h.state.studentMovements);
  const foreign = clone(h.store[h.foreignPath]);
  const result = await h.run();
  assert.equal(result.importResult.Imported, 0);
  assert.equal(result.importResult.ProfilesCreated, 1);
  assert.equal(result.importResult.ProfilesRestored, 1);
  assert.equal(result.importResult.Skipped, 1);
  assert.match(result.message, /restored with saved classroom and subjects preserved/);
  const profile = h.profiles[0];
  assert.equal(profile.AdmissionNo, reference);
  assert.equal(profile.ClassName, 'Reception');
  assert.equal(profile.ClassArm, 'Distinction');
  assert.equal(profile.AcademicMembershipId, original.MembershipId);
  assert.equal(profile.ProfileRestoredFromMembershipId, original.MembershipId);
  assert.equal(profile.ProfileCompletionStatus, 'Needs completion');
  assert.equal(profile.BranchId, scope.BranchId);
  assert.equal(profile.SchoolSection, 'primary');
  assert.equal(profile.GuardianEmail, undefined);
  for (const [key, value] of Object.entries(original)) if (!key.startsWith('__')) assert.deepEqual(h.state.studentMemberships[0][key], value);
  assert.deepEqual(h.state.studentScores, scores);
  assert.deepEqual(h.state.studentMovements, movements);
  assert.deepEqual(h.store[h.foreignPath], foreign);
  assert.equal(h.writes.length, 5, 'membership and destination guards, one profile creation, one audit');
  assert.deepEqual(h.writes[0].data, { Status: 'Active' });
  assert.deepEqual(h.writes[0].updateMask, ['Status']);
  assert.equal(h.writes[1].exists, false);
  const count = h.writes.length;
  const retry = await h.run();
  assert.equal(retry.importResult.ProfilesRestored, 0);
  assert.equal(retry.importResult.Skipped, 1);
  assert.equal(h.writes.length, count, 'retry adds no profile, membership, movement or audit writes');
});

test('existing membership preserves saved choices on a retry even when current subject offerings have changed', async () => {
  const h = harness();
  h.profiles.push({ AdmissionNo: reference, ClassName: 'Reception', Status: 'Active', __id: 'TEST-26-0356' });
  const before = clone(h.state.studentMemberships);
  assert.equal((await h.run({ ArmCode: 'DIS', CoreSubjectCodes: 'MAT' })).importResult.Skipped, 1);
  assert.deepEqual(h.state.studentMemberships, before);
  assert.equal(h.writes.length, 0);
});

test('changed class, arm or explicit subjects cannot silently replace an existing membership during profile recovery', async () => {
  for (const patch of [{ ClassCode: 'CRE' }, { ArmCode: 'MER' }, { CoreSubjectCodes: 'ENG' }, { OptionalSubjectCodes: 'ENG' }]) {
    const h = harness();
    await assert.rejects(h.run(patch), error => error.code === 'ACADEMIC_IMPORT_MEMBERSHIP_CONFLICT'
      && /restore the missing pupil profile/.test(error.message));
    assert.equal(h.writes.length, 0);
    assert.equal(h.profiles.length, 0);
  }
});

test('inactive memberships and ambiguous duplicates require review before a profile can be recreated', async () => {
  for (const Status of ['Archived', 'Inactive', 'Withdrawn']) {
    const h = harness({ membership: { Status } });
    await assert.rejects(h.run(), { code: 'ACADEMIC_IMPORT_MEMBERSHIP_CONFLICT' });
    assert.equal(h.writes.length, 0);
  }
  const duplicate = harness();
  duplicate.state.studentMemberships.push(membership({ MembershipId: 'other', RecordId: 'other' }));
  await assert.rejects(duplicate.run(), { code: 'ACADEMIC_DUPLICATE_MEMBERSHIP' });
  assert.equal(duplicate.writes.length, 0);
});

test('missing profile restoration checks revision, classroom scope and document-name collisions', async () => {
  const revision = harness({ membership: { __updateTime: '' } });
  await assert.rejects(revision.run(), { code: 'ACADEMIC_WRITE_CONFLICT' });
  const classroom = harness();
  classroom.state.arms[0].BranchId = 'main';
  await assert.rejects(classroom.run(), { code: 'ACADEMIC_REFERENCE_INVALID' });
  const collision = harness();
  collision.profiles.push({ AdmissionNo: 'DIFFERENT/26/0356', __id: 'TEST-26-0356' });
  await assert.rejects(collision.run(), { code: 'ACADEMIC_IMPORT_STUDENT_ID_CONFLICT' });
  for (const h of [revision, classroom, collision]) assert.equal(h.writes.length, 0);
});

test('concurrent transfer or profile creation aborts recovery atomically', async () => {
  for (const kind of ['membership', 'profile']) {
    const h = harness();
    h.beforeCommit = () => {
      if (kind === 'membership') Object.assign(h.state.studentMemberships[0], { ArmId: 'merit', __updateTime: 'changed' });
      else h.profiles.push({ AdmissionNo: reference, __id: 'TEST-26-0356', DisplayName: 'Concurrent profile' });
    };
    await assert.rejects(h.run(), { code: 'ACADEMIC_WRITE_CONFLICT' });
    assert.equal(h.writes.length, 0);
    assert.equal(h.state.audit.length, 0);
    if (kind === 'membership') assert.equal(h.profiles.length, 0);
    else assert.equal(h.profiles[0].DisplayName, 'Concurrent profile');
  }
});

test('profile recovery cannot recreate occupancy after its destination is concurrently removed', async () => {
  for (const key of ['classes', 'arms']) {
    const h = harness();
    h.beforeCommit = () => h.state[key].splice(0, 1);
    await assert.rejects(h.run(), { code: 'ACADEMIC_WRITE_CONFLICT' });
    assert.equal(h.profiles.length, 0);
    assert.equal(h.writes.length, 0);
  }
});

test('a later invalid row prevents partial restoration and an ordinary new import remains retry-safe', async () => {
  const h = harness();
  await assert.rejects(h.run({}, { Rows: [
    { StudentRef: reference, FirstName: 'Test', Surname: 'Pupil', ClassCode: 'REC' },
    { StudentRef: 'TEST/25/0382', FirstName: 'New', Surname: 'Pupil', ClassCode: 'UNKNOWN' }
  ] }), { code: 'ACADEMIC_IMPORT_REFERENCE_INVALID' });
  assert.equal(h.profiles.length, 0);
  assert.equal(h.writes.length, 0);
  const fresh = harness({ newPupil: true });
  const first = await fresh.run({ ClassCode: 'CRE' });
  assert.equal(first.importResult.Imported, 1);
  assert.equal(first.importResult.ProfilesRestored, 0);
  assert.equal(fresh.state.studentMemberships.length, 1);
  const count = fresh.writes.length;
  assert.equal((await fresh.run({ ClassCode: 'CRE' })).importResult.Skipped, 1);
  assert.equal(fresh.writes.length, count);
});
