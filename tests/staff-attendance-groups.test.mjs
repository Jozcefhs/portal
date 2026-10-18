import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { canonicalRecordEdition, staffRecordMatchesEdition } from '../functions/lib/records-desk.js';
import { staffEmploymentDetails } from '../functions/lib/staff-employment.js';
import { requiredDeploymentIdentity } from '../functions/lib/deployment-identity.js';
import { canonicalStaffAttendanceCollectionPath, resolveStaffAttendanceBranch, safeStaffAttendanceDocumentId,
  staffAttendanceWriteDocumentId } from '../functions/lib/staff-attendance-storage.js';
import { addAttendanceDays, attendanceGroupFor, attendanceShiftForDate, normalizeAttendanceGroup,
  resolveAttendanceShift } from '../functions/lib/staff-attendance-schedules.js';

const source = (await fs.readFile(new URL('../functions/lib/staff-attendance-groups.js', import.meta.url), 'utf8'))
  .replace(/^import[\s\S]*?from ['"][^'"]+['"];\r?$/gm, '').replace(/^export /gm, '');
const timeSource = (await fs.readFile(new URL('../functions/lib/staff-time-attendance.js', import.meta.url), 'utf8'))
  .replace(/^import[\s\S]*?from ['"][^'"]+['"];\r?$/gm, '').replace(/^export /gm, '');
const apiSource = (await fs.readFile(new URL('../functions/api/staff-attendance.js', import.meta.url), 'utf8'))
  .replace(/^import[\s\S]*?from ['"][^'"]+['"];\r?$/gm, '').replace(/^export /gm, '');
const clone = (value) => structuredClone(value);
const policy = { TimeZone: 'Africa/Lagos', GraceMinutes: 15, ClockInOpenMinutesBefore: 60, OvertimeMinimumMinutes: 15 };
const fixed = (name = 'Nurses') => ({ Name: name, ScheduleType: 'FIXED', DaySchedules: {
  MON: { Enabled: true, ResumptionTime: '08:00', ClosingTime: '17:00' },
  TUE: { Enabled: true, ResumptionTime: '08:00', ClosingTime: '17:00' },
  WED: { Enabled: true, ResumptionTime: '08:00', ClosingTime: '17:00' },
  THU: { Enabled: true, ResumptionTime: '08:00', ClosingTime: '17:00' },
  FRI: { Enabled: true, ResumptionTime: '08:00', ClosingTime: '17:00' },
  SAT: { Enabled: false }, SUN: { Enabled: false }
} });
const staff = (Username, edition, rest = {}) => ({ Username, Role: 'Department User', OrganisationEdition: edition, BranchId: 'main', Active: true, ...rest });

function harness(edition = 'school', options = {}) {
  const env = { ORGANISATION_EDITION: edition, DYNAMAX_WORKSPACE_ID: 'fixture' };
  const actor = { username: 'owner', role: 'Super Admin', edition, branchId: 'main' };
  const docs = new Map();
  const batches = [];
  const paths = (key, branch = 'main') => canonicalStaffAttendanceCollectionPath(edition, key, branch);
  let version = 0;
  const context = vm.createContext({
    crypto, Date, Intl, TextEncoder, canonicalRecordEdition, staffRecordMatchesEdition,
    requiredDeploymentIdentity, resolveStaffAttendanceBranch, normalizeAttendanceGroup,
    staffAttendanceCollectionPath: (_env, key, branch) => paths(key, branch),
    getStaffAttendanceDocument: async (_env, key, branch, id) => {
      if (options.failRead) throw new Error('Synthetic database unavailable');
      return clone(docs.get(`${paths(key, branch)}/${id}`) || null);
    },
    listCollection: async (_env, collection) => {
      if (options.failDirectory) throw new Error('Synthetic directory unavailable');
      return clone(collection === 'staffUsers' ? options.staff || [staff('nurse', edition), staff('guard', edition)] : options.employees || []);
    },
    batchCommitLiteralDocuments: async (_env, writes) => {
      await options.beforeCommit?.(docs, writes);
      for (const write of writes) {
        const row = docs.get(`${write.collectionPath}/${write.documentId}`);
        if ((write.exists === false && row) || (write.updateTime && row?.__updateTime !== write.updateTime)) {
          throw Object.assign(new Error('Synthetic database conflict'), { status: 412 });
        }
      }
      batches.push(clone(writes));
      for (const write of writes) {
        const key = `${write.collectionPath}/${write.documentId}`;
        const prior = write.updateMask ? docs.get(key) : {};
        docs.set(key, { ...prior, ...clone(write.data), __id: write.documentId, __updateTime: `v${++version}`,
          __storagePath: write.collectionPath, __legacyStorage: false });
      }
    }
  });
  vm.runInContext(source, context);
  const save = (Group = fixed(), extra = {}) => context.saveAttendanceGroup(env, actor,
    { Group, ExpectedRevision: docs.get(`${paths('policy')}/roster`)?.Revision || '', ...extra }, 'main', policy);
  const assign = (Assignments, extra = {}) => context.assignAttendanceGroups(env, actor,
    { Assignments, ExpectedRevision: docs.get(`${paths('policy')}/roster`)?.Revision || '', ...extra }, 'main', policy);
  return { context, env, actor, docs, batches, paths, save, assign };
}

function attendanceHarness(h, overrides = {}) {
  const context = vm.createContext({
    ...Object.fromEntries(['saveAttendanceGroup', 'assignAttendanceGroups', 'deleteAttendanceGroup', 'canManageAttendanceGroups',
      'loadAttendanceRoster', 'requireAttendanceStaff', 'attendanceHrRecordMatchesScope', 'getStaffAttendanceDocument', 'listCollection',
      'staffAttendanceCollectionPath'].map((name) => [name, h.context[name]])),
    Date, Intl, crypto, resolveStaffAttendanceBranch, safeStaffAttendanceDocumentId, staffAttendanceWriteDocumentId,
    addAttendanceDays, attendanceGroupFor, attendanceShiftForDate, resolveAttendanceShift, staffRecordMatchesEdition, staffEmploymentDetails,
    batchCommitDocuments: h.context.batchCommitLiteralDocuments,
    listStaffAttendanceCollection: async () => [], queryStaffAttendanceCollection: async () => [],
    ...overrides
  });
  vm.runInContext(timeSource, context);
  return context;
}

for (const edition of ['school', 'faith', 'organization']) {
  test(`${edition}: group create/edit uses isolated conditional roster plus atomic audit`, async () => {
    const h = harness(edition);
    const first = await h.save({ ...fixed(), CreatedAt: 'fake', UpdatedBy: 'attacker', EffectiveFrom: '2000-01-01', BranchId: 'other' });
    assert.equal(first.ok, true);
    const group = first.roster.Groups[0];
    assert.match(group.GroupId, /^[a-f\d-]{36}$/i);
    assert.notEqual(group.CreatedAt, 'fake');
    assert.notEqual(group.EffectiveFrom, '2000-01-01');
    assert.equal(group.UpdatedBy, 'owner');
    assert.equal(group.BranchId, undefined);
    assert.equal(h.batches[0].length, 2);
    assert.equal(h.batches[0][0].collectionPath, h.paths('policy'));
    assert.equal(h.batches[0][0].exists, false);
    assert.equal(h.batches[0][1].exists, false);
    assert.equal(h.batches[0][1].data.Action, 'SAVE_ATTENDANCE_GROUP');
    const second = await h.save({ ...group, Name: 'Nursing team' });
    assert.equal(second.roster.Groups[0].GroupId, group.GroupId);
    assert.equal(second.roster.Groups[0].CreatedAt, group.CreatedAt);
    assert.notEqual(second.roster.Revision, first.roster.Revision);
    assert.equal(h.batches[1][0].updateTime, 'v1');
    assert.equal((await h.context.loadAttendanceRoster(h.env, 'main')).__updateTime, undefined);
  });

  test(`${edition}: management and assignment reject unauthorized roles and other branch/edition`, async () => {
    const h = harness(edition);
    for (const role of ['Teacher', 'Department User', 'HR Assistant', 'Line Manager']) {
      await assert.rejects(h.context.saveAttendanceGroup(h.env, { ...h.actor, role }, { Group: fixed() }, 'main', policy), /Only organisation or HR/);
    }
    await assert.rejects(h.context.saveAttendanceGroup(h.env, h.actor, { Group: fixed() }, 'east', policy), /another organisation branch/);
    await assert.rejects(h.context.saveAttendanceGroup(h.env, { ...h.actor, edition: edition === 'school' ? 'faith' : 'school' }, { Group: fixed() }, 'main', policy), /another organisation edition/);
    assert.equal(h.batches.length, 0);
    const roles = ['Super Admin', 'HR Manager', ...(edition === 'faith' ? ['Church Administrator'] : edition === 'organization' ? ['Executive Director', 'Organisation Administrator'] : [])];
    for (const role of roles) assert.equal(h.context.canManageAttendanceGroups({ ...h.actor, role }), true);
    assert.equal(h.context.canManageAttendanceGroups({ ...h.actor, role: edition === 'faith' ? 'Organisation Administrator' : 'Church Administrator' }), false);
  });

  test(`${edition}: active staff assignment is authoritative and branch/edition scoped`, async () => {
    const otherEdition = edition === 'school' ? 'faith' : 'school';
    const h = harness(edition, { staff: [staff('nurse', edition), staff('inactive', edition, { Active: false }),
      staff('east', edition, { BranchId: 'east' }), staff('foreign', otherEdition), staff('exited', edition)],
      employees: [staff('exited', edition, { Status: 'Exited' })] });
    const groupId = (await h.save()).roster.Groups[0].GroupId;
    for (const Username of ['unknown', 'inactive', 'east', 'foreign', 'exited']) {
      await assert.rejects(h.assign([{ Username, GroupId: groupId, BranchId: 'main', Active: true }]), /unavailable, inactive, or outside/);
    }
    const result = await h.assign([{ Username: 'NURSE', GroupId: groupId, EffectiveFrom: '2000-01-01' }]);
    assert.equal(result.roster.Assignments[0].Username, 'nurse');
    assert.notEqual(result.roster.Assignments[0].EffectiveFrom, '2000-01-01');
    assert.equal(h.batches.length, 2);
  });
}

test('roster reads fail closed and missing roster has an empty revision', async () => {
  const h = harness();
  assert.deepEqual(clone(await h.context.loadAttendanceRoster(h.env, 'main')), { Revision: '', Groups: [], Assignments: [] });
  const broken = harness('school', { failRead: true });
  await assert.rejects(broken.save(), /database unavailable/);
  assert.equal(broken.batches.length, 0);
});

test('stale revisions and competing updates cannot lose another administrator’s settings', async () => {
  const h = harness();
  await h.save();
  await assert.rejects(h.save(fixed('Guards'), { ExpectedRevision: '' }), /changed after/);
  await assert.rejects(h.save(fixed('Guards'), { ExpectedRevision: 'stale' }), /changed after/);
  const revision = h.docs.get(`${h.paths('policy')}/roster`).Revision;
  const results = await Promise.allSettled([h.save(fixed('Day nurses'), { ExpectedRevision: revision }), h.save(fixed('Night nurses'), { ExpectedRevision: revision })]);
  assert.equal(results.filter((row) => row.status === 'fulfilled').length, 1);
  assert.equal(results.find((row) => row.status === 'rejected').reason.status, 409);
  assert.equal(h.docs.get(`${h.paths('policy')}/roster`).Groups.length, 2);
  assert.equal(h.batches.length, 2);
});

test('case-insensitive names, fabricated group IDs, duplicate staff and nonexistent groups are rejected', async () => {
  const h = harness();
  const groupId = (await h.save()).roster.Groups[0].GroupId;
  await assert.rejects(h.save(fixed('nUrSeS')), /name already exists/);
  await assert.rejects(h.save({ ...fixed('Guards'), GroupId: 'fabricated' }), /no longer exists/);
  await assert.rejects(h.assign([{ Username: 'nurse', GroupId: groupId }, { Username: 'NURSE', GroupId: '' }]), /more than once/);
  await assert.rejects(h.assign([{ Username: 'nurse', GroupId: 'missing' }]), /no longer exists/);
  assert.equal(h.batches.length, 1);
});

test('assignment history and untouched staff survive partial updates; returning to default records an effective date', async () => {
  const h = harness();
  const groupId = (await h.save()).roster.Groups[0].GroupId;
  const key = `${h.paths('policy')}/roster`;
  h.docs.get(key).Assignments = [
    { Username: 'nurse', GroupId: groupId, EffectiveFrom: '2020-01-01' },
    { Username: 'guard', GroupId: groupId, EffectiveFrom: '2020-01-02' }
  ];
  const result = await h.assign([{ Username: 'nurse', GroupId: '' }]);
  assert.equal(result.roster.Assignments.length, 3);
  assert.equal(result.roster.Assignments.filter((row) => row.Username === 'nurse').length, 2);
  assert.equal(result.roster.Assignments.find((row) => row.Username === 'guard').EffectiveFrom, '2020-01-02');
  assert.equal(result.roster.Assignments.at(-1).GroupId, '');
  const unchanged = await h.assign([{ Username: 'nurse', GroupId: '' }]);
  assert.equal(unchanged.roster.Assignments.length, 3);
  const sameDay = await h.assign([{ Username: 'nurse', GroupId: groupId }]);
  assert.equal(sameDay.roster.Assignments.length, 3);
  assert.equal(sameDay.roster.Assignments.at(-1).GroupId, groupId);
});

test('deletion protects historical assignments and only deletes an unused group', async () => {
  const h = harness();
  const groupId = (await h.save()).roster.Groups[0].GroupId;
  await h.assign([{ Username: 'nurse', GroupId: groupId }]);
  const remove = (GroupId) => h.context.deleteAttendanceGroup(h.env, h.actor,
    { GroupId, ExpectedRevision: h.docs.get(`${h.paths('policy')}/roster`).Revision }, 'main', policy);
  await assert.rejects(remove(groupId), /current or historical/);
  const unused = (await h.save(fixed('Unused group'))).roster.Groups.find((row) => row.Name === 'Unused group');
  const result = await remove(unused.GroupId);
  assert.equal(result.roster.Groups.length, 1);
  assert.equal(h.batches.at(-1)[1].data.Action, 'DELETE_ATTENDANCE_GROUP');
});

test('directory failures, duplicate identities, oversized payloads and group limits fail without partial writes', async () => {
  const failed = harness('school', { failDirectory: true });
  const id = (await failed.save()).roster.Groups[0].GroupId;
  await assert.rejects(failed.assign([{ Username: 'nurse', GroupId: id }]), /directory unavailable/);
  assert.equal(failed.batches.length, 1);
  const duplicate = harness('school', { staff: [staff('nurse', 'school'), staff('NURSE', 'school')] });
  const duplicateId = (await duplicate.save()).roster.Groups[0].GroupId;
  await assert.rejects(duplicate.assign([{ Username: 'nurse', GroupId: duplicateId }]), /ambiguous/);
  const h = harness();
  await assert.rejects(h.save({ ...fixed(), padding: 'x'.repeat(128 * 1024) }), /too large/);
  await h.save();
  const current = h.docs.get(`${h.paths('policy')}/roster`);
  current.Groups = Array.from({ length: 50 }, (_, index) => ({ ...current.Groups[0], GroupId: `group-${index}`, Name: `Group ${index}` }));
  await assert.rejects(h.save(fixed('Extra')), /at most 50/);
  assert.equal(h.batches.length, 1);
});

test('legacy-compatible roster is guarded and copied into canonical storage without clearing legacy data', async () => {
  const h = harness('faith');
  const canonical = `${h.paths('policy')}/roster`;
  const legacyPath = 'organisationBranches/main/churchStaffAttendancePolicy';
  const legacy = { Revision: 'old-revision', Groups: [], Assignments: [], LegacyNote: 'preserve',
    __id: 'roster', __updateTime: 'legacy-v1', __storagePath: legacyPath, __legacyStorage: true };
  h.docs.set(canonical, legacy);
  h.docs.set(`${legacyPath}/roster`, clone(legacy));
  // The compatibility getter returns this legacy record, while canonical create
  // protection must still see the real absence at commit time.
  const value = h.docs.get(canonical);
  h.docs.delete(canonical);
  h.context.getStaffAttendanceDocument = async () => clone(value);
  const result = await h.context.saveAttendanceGroup(h.env, h.actor,
    { Group: fixed(), ExpectedRevision: 'old-revision' }, 'main', policy);
  assert.equal(result.roster.Groups.length, 1);
  assert.equal(h.batches[0].length, 3);
  assert.equal(h.batches[0][0].exists, false);
  assert.equal(h.batches[0][1].updateTime, 'legacy-v1');
  assert.equal(h.docs.get(`${legacyPath}/roster`).LegacyNote, 'preserve');
});

test('rotating 24-on/48-off groups persist through the real schedule normalizer', async () => {
  const h = harness('organization');
  const result = await h.save({ Name: 'Security rotation', ScheduleType: 'ROTATING', AnchorDate: '2026-10-01',
    CycleDays: [{ Enabled: true, ResumptionTime: '08:00', ClosingTime: '08:00', EndDayOffset: 1 },
      { Enabled: false }, { Enabled: false }] });
  assert.equal(result.roster.Groups[0].CycleDays.length, 3);
  assert.equal(result.roster.Groups[0].CycleDays[0].EndDayOffset, 1);
  await h.assign([{ Username: 'guard', GroupId: result.roster.Groups[0].GroupId }]);
  assert.equal(h.batches.length, 2);
  await assert.rejects(h.save({ Name: 'Invalid rotation', ScheduleType: 'ROTATING', AnchorDate: '2026-10-01',
    CycleDays: [{ Enabled: true, ResumptionTime: '08:00', ClosingTime: '08:00', EndDayOffset: 2 }] }), /overlap/);
  assert.equal(h.batches.length, 2);
});

test('renaming keeps the original effective date while changed schedule rules start today', async () => {
  const h = harness();
  const group = (await h.save()).roster.Groups[0];
  h.docs.get(`${h.paths('policy')}/roster`).Groups[0].EffectiveFrom = '2020-01-01';
  const renamed = await h.save({ GroupId: group.GroupId, Name: 'Renamed nurses' });
  assert.equal(renamed.roster.Groups[0].EffectiveFrom, '2020-01-01');
  const modified = await h.save({ GroupId: group.GroupId, GraceMinutes: 20 });
  assert.notEqual(modified.roster.Groups[0].EffectiveFrom, '2020-01-01');
  assert.equal(modified.roster.Groups[0].History[0].EffectiveFrom, '2020-01-01');
});

test('effective-dated schedule history is server-owned, flat and preserved across later edits', async () => {
  const h = harness();
  const setDate = (date) => {
    h.context.Date = class extends Date { constructor(...args) { super(...(args.length ? args : [`${date}T08:00:00.000Z`])); } };
  };
  setDate('2026-10-11');
  const group = (await h.save({ ...fixed(), History: [{ GroupId: 'forged', EffectiveFrom: '2000-01-01' }] })).roster.Groups[0];
  assert.equal(group.History.length, 0);
  setDate('2026-10-12');
  const changed = (await h.save({ GroupId: group.GroupId, GraceMinutes: 20, History: [] })).roster.Groups[0];
  assert.equal(changed.History.length, 1);
  assert.equal(changed.History[0].EffectiveFrom, '2026-10-11');
  assert.equal(changed.History[0].GraceMinutes, 15);
  assert.equal(changed.History[0].History, undefined);
  assert.equal(changed.EffectiveFrom, '2026-10-12');
  const sameDay = (await h.save({ GroupId: group.GroupId, GraceMinutes: 25 })).roster.Groups[0];
  assert.equal(sameDay.History.length, 1);
  setDate('2026-10-13');
  const renamed = (await h.save({ GroupId: group.GroupId, Name: 'Nurses renamed' })).roster.Groups[0];
  assert.equal(renamed.EffectiveFrom, '2026-10-12');
  assert.equal(renamed.History.length, 1);
  const next = (await h.save({ GroupId: group.GroupId, GraceMinutes: 30 })).roster.Groups[0];
  assert.equal(next.History.length, 2);
  assert.equal(next.History[1].EffectiveFrom, '2026-10-12');
  assert.equal(next.History[1].GraceMinutes, 25);
  assert.equal(next.History[1].History, undefined);
});

test('two first-time saves cannot silently overwrite one another', async () => {
  const h = harness();
  const results = await Promise.allSettled([h.save(fixed('Nurses')), h.save(fixed('Security'))]);
  assert.equal(results.filter((row) => row.status === 'fulfilled').length, 1);
  assert.equal(h.batches.length, 1);
  assert.equal(h.docs.get(`${h.paths('policy')}/roster`).Groups.length, 1);
});

for (const edition of ['school', 'faith', 'organization']) {
  test(`${edition}: real attendance action dispatch enforces group-management permission and branch scope`, async () => {
    const h = harness(edition);
    const attendance = attendanceHarness(h);
    for (const action of ['savegroup', 'assigngroups', 'deletegroup']) {
      await assert.rejects(attendance.handleStaffAttendanceAction(h.env, { ...h.actor, subscriptionReadOnly: true },
        { action, Group: fixed(), Assignments: [{ Username: 'nurse', GroupId: '' }] }), /subscription is read-only/);
      await assert.rejects(attendance.handleStaffAttendanceAction(h.env, { ...h.actor, role: 'Department User' },
        { action, Group: fixed(), Assignments: [{ Username: 'nurse', GroupId: '' }] }), /Only attendance administrators/);
      await assert.rejects(attendance.handleStaffAttendanceAction(h.env, h.actor,
        { action, BranchId: 'east', Group: fixed(), Assignments: [{ Username: 'nurse', GroupId: '' }] }), /another organisation branch/);
    }
    const group = await attendance.handleStaffAttendanceAction(h.env, h.actor,
      { action: 'savegroup', BranchId: 'main', Group: fixed(), ExpectedRevision: '' });
    const assigned = await attendance.handleStaffAttendanceAction(h.env, h.actor,
      { action: 'assigngroups', BranchId: 'main', ExpectedRevision: group.roster.Revision,
        Assignments: [{ Username: 'nurse', GroupId: group.roster.Groups[0].GroupId }] });
    assert.equal(assigned.roster.Assignments[0].Username, 'nurse');
    await assert.rejects(attendance.handleStaffAttendanceAction(h.env, h.actor,
      { action: 'deletegroup', BranchId: 'main', GroupId: group.roster.Groups[0].GroupId,
        ExpectedRevision: assigned.roster.Revision }), /current or historical/);
    assert.equal(h.batches.length, 2);
  });

  test(`${edition}: HTTP attendance API enforces module access and read-only subscription before idempotent writes`, async () => {
    const h = harness(edition);
    const attendance = attendanceHarness(h);
    let actor = { ...h.actor, allowedSections: ['staffAttendance'] };
    let idempotencyStarts = 0;
    const api = vm.createContext({
      Request, Response, requireFirestoreEnv: () => {},
      requireStaffSession: async () => actor, readStaffSession: async () => actor,
      readJsonBody: (request) => request.json(),
      handleStaffAttendanceAction: attendance.handleStaffAttendanceAction,
      beginIdempotentRequest: async () => { idempotencyStarts++; return { owner: true }; },
      completeIdempotentRequest: async () => {}, failIdempotentRequest: async () => {}
    });
    vm.runInContext(apiSource, api);
    const send = (action, extra = {}) => api.onRequestPost({ env: h.env, request: new Request('https://fixture.invalid/api/staff-attendance', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, Group: fixed(), ...extra })
    }) });
    for (const action of ['savegroup', 'assigngroups', 'deletegroup']) {
      actor = { ...h.actor, allowedSections: ['staffAttendance'], subscriptionReadOnly: true };
      const readonly = await send(action);
      assert.equal(readonly.status, 403);
      assert.match((await readonly.json()).message, /read-only/);
      actor = { ...h.actor, allowedSections: [] };
      const unavailable = await send(action);
      assert.equal(unavailable.status, 403);
      assert.match((await unavailable.json()).message, /not available/);
    }
    assert.equal(idempotencyStarts, 0);
    assert.equal(h.batches.length, 0);
    actor = { ...h.actor, allowedSections: ['staffAttendance'] };
    const saved = await send('savegroup', { ExpectedRevision: '' });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).roster.Groups.length, 1);
    assert.equal(idempotencyStarts, 1);
    assert.equal(h.batches.length, 1);
  });

  test(`${edition}: manual corrections validate staff ownership but retain historical inactive-account corrections`, async () => {
    const otherEdition = edition === 'school' ? 'faith' : 'school';
    const h = harness(edition, { staff: [staff('nurse', edition, { Active: false, DisplayName: 'Verified Nurse', Role: 'Clinic User' }),
      staff('east', edition, { BranchId: 'east' }), staff('foreign', otherEdition)],
      employees: [staff('nurse', edition, { Status: 'Exited' })] });
    const attendance = attendanceHarness(h);
    const body = { Direction: 'IN', Reason: 'Correct historical attendance', Timestamp: '2026-10-09T09:00:00.000Z',
      DisplayName: 'Forged client name', Role: 'Super Admin' };
    for (const Username of ['unknown', 'east', 'foreign']) {
      await assert.rejects(attendance.recordManualAttendance(h.env, h.actor, { ...body, Username }), /unavailable, inactive, or outside/);
    }
    assert.equal(h.batches.length, 0);
    const corrected = await attendance.recordManualAttendance(h.env, h.actor, { ...body, Username: 'nurse' });
    assert.equal(corrected.event.DisplayName, 'Verified Nurse');
    assert.equal(corrected.event.Role, 'Clinic User');
    assert.equal(corrected.daily.Username, 'nurse');
    assert.equal(h.batches.length, 1);
    const groupId = (await h.save()).roster.Groups[0].GroupId;
    await assert.rejects(h.assign([{ Username: 'nurse', GroupId: groupId }]), /unavailable, inactive, or outside/);
  });

  test(`${edition}: employee exit records affect only their authoritative staff branch and edition`, () => {
    const h = harness(edition);
    const attendance = attendanceHarness(h);
    const directory = [staff('nurse', edition)];
    const foreignEdition = edition === 'school' ? 'faith' : 'school';
    for (const employee of [staff('nurse', edition, { Status: 'Exited', BranchId: 'east' }),
      staff('nurse', foreignEdition, { Status: 'Exited' })]) {
      assert.equal(attendance.staffAttendanceDirectoryFor(directory, [employee], h.actor, 'main').length, 1);
    }
    assert.equal(attendance.staffAttendanceDirectoryFor(directory, [staff('nurse', edition, { Status: 'Exited' })], h.actor, 'main').length, 0);
    // Existing HR writers omit Edition: resolve those rows through the actual
    // uniquely identified account instead of dropping faith/organization HR data.
    assert.equal(attendance.staffAttendanceDirectoryFor(directory, [{ Username: 'nurse', Status: 'Exited' }], h.actor, 'main').length, 0);
    assert.equal(h.context.attendanceHrRecordMatchesScope({ Username: 'nurse', Status: 'Exited' },
      [...directory, staff('nurse', foreignEdition)], h.actor, 'main'), false);
  });

  test(`${edition}: leave from another branch or edition cannot suppress absence; legacy local HR leave still works`, async () => {
    class AttendanceDate extends Date {
      constructor(...args) { super(...(args.length ? args : ['2026-10-09T18:00:00.000Z'])); }
      static now() { return Date.parse('2026-10-09T18:00:00.000Z'); }
    }
    const foreignEdition = edition === 'school' ? 'faith' : 'school';
    const base = { Username: 'nurse', Status: 'Approved', StartDate: '2026-10-01', EndDate: '2026-10-10' };
    for (const [leave, expected] of [
      [{ ...base, Edition: edition, BranchId: 'east' }, 'Absent'],
      [{ ...base, Edition: foreignEdition, BranchId: 'main' }, 'Absent'],
      [{ ...base, Edition: edition, BranchId: 'main' }, 'Approved leave'],
      [{ ...base }, 'Approved leave']
    ]) {
      const h = harness(edition, { staff: [staff('nurse', edition)] });
      const attendance = attendanceHarness(h, {
        Date: AttendanceDate,
        listCollection: async (env, collection) => collection === 'hrLeaveRequests' ? [leave] : h.context.listCollection(env, collection),
        getStaffAttendanceDocument: async (env, key, branch, id) => key === 'policy' && id === 'default'
          ? { Active: 'YES', AutoRecordAbsence: 'YES', TimeZone: 'UTC', PresenceCheckMode: 'NONE' }
          : h.context.getStaffAttendanceDocument(env, key, branch, id)
      });
      await attendance.listStaffAttendance(h.env, h.actor, {});
      assert.equal(h.batches.length, 1);
      assert.equal(h.batches[0][0].data.AttendanceStatus, expected);
    }
  });
}

test('staff and HR prerequisite read failures prevent automatic absence writes instead of treating missing data as empty', async () => {
  for (const failedCollection of ['staffUsers', 'hrEmployees', 'hrLeaveRequests']) {
    const h = harness();
    const attendance = attendanceHarness(h, { listCollection: async (env, collection) => {
      if (collection === failedCollection) throw new Error(`Synthetic ${collection} read failure`);
      return h.context.listCollection(env, collection);
    } });
    await assert.rejects(attendance.listStaffAttendance(h.env, h.actor, {}), new RegExp(`${failedCollection} read failure`));
    assert.equal(h.batches.length, 0, 'No absence, presence, event or audit writes after incomplete prerequisites');
  }
});
