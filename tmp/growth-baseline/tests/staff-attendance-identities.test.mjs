import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { automaticAbsenceCandidates, staffAttendanceDirectoryFor, synchronizeAutomaticAbsences } from '../functions/lib/staff-time-attendance.js';
import { safeStaffAttendanceDocumentId } from '../functions/lib/staff-attendance-storage.js';

const date = '2026-10-06';
const now = new Date(`${date}T16:00:00Z`);
const policy = {
  Active: 'YES', AutoRecordAbsence: 'YES', TimeZone: 'UTC',
  DaySchedules: { TUE: { Enabled: true, ResumptionTime: '08:00', ClosingTime: '15:00' } }
};
const dailyId = username => safeStaffAttendanceDocumentId(`DAY-${date}-${username.toLowerCase()}`);
function fixture(edition = 'school') {
  const env = { ORGANISATION_EDITION: edition, DYNAMAX_WORKSPACE_ID: 'test-workspace' };
  const stored = new Map();
  const batches = [];
  const dependencies = {
    batchCommitDocuments: async (_env, writes) => {
      const names = writes.map(row => `${row.collectionPath}/${row.documentId}`);
      assert.equal(new Set(names).size, writes.length, 'Never send duplicate document names to Firestore');
      assert.ok(writes.every(row => row.exists === false), 'Never overwrite recorded attendance');
      if (names.some(name => stored.has(name))) throw Object.assign(new Error('Concurrent clock-in'), { status: 409 });
      writes.forEach((row, index) => stored.set(names[index], structuredClone(row.data)));
      batches.push(writes);
    },
    queryStaffAttendanceCollection: async () => [...stored.values()]
  };
  const sync = (directory, daily = [], leave = [], override = {}) => synchronizeAutomaticAbsences(env, 'main', { ...policy, ...override }, now, directory, leave, daily, dependencies);
  return { env, stored, batches, dependencies, sync };
}

for (const edition of ['school', 'faith', 'organization']) {
  test(`${edition}: staff directory preserves edition, branch, active and HR exit filters while deduplicating usernames`, () => {
    const row = { Edition: edition, BranchId: 'main', Active: 'YES' };
    const directory = staffAttendanceDirectoryFor([
      { ...row, Username: ' Teacher.One ', DisplayName: 'Teacher One' },
      { ...row, Username: 'TEACHER.ONE', DisplayName: 'Imported duplicate' },
      { ...row, __id: 'teacher.two', DisplayName: 'Teacher Two' },
      { ...row, Username: 'inactive', Active: 'NO' },
      { ...row, Username: 'exited' },
      { ...row, Username: 'other-branch', BranchId: 'east' },
      { ...row, Username: 'other-edition', Edition: edition === 'school' ? 'faith' : 'school' },
      { ...row, Username: '  ' }
    ], [{ Username: 'EXITED', Status: 'Terminated' }], { edition }, 'main');
    assert.deepEqual(directory.map(row => row.Username), ['teacher.one', 'teacher.two']);
  });

  test(`${edition}: duplicate staff entries create exactly one absence and subsequent reload creates none`, async () => {
    const f = fixture(edition);
    const directory = [{ Username: ' teacher.one ' }, { Username: 'TEACHER.ONE' }, { Username: 'teacher.two' }];
    const result = await f.sync(directory);
    assert.equal(result.dailyRows.length, 2);
    assert.deepEqual(result.processingWarnings, []);
    assert.equal(f.batches.length, 1);
    assert.deepEqual(f.batches[0].map(row => row.data.Username), ['teacher.one', 'teacher.two']);
    const root = edition === 'school' ? 'schoolBranches' : 'organisationBranches';
    assert.ok(f.batches[0].every(row => row.collectionPath === `${root}/main/staffDailyAttendance`));
    await f.sync(directory, result.dailyRows);
    assert.equal(f.batches.length, 1);
  });

  test(`${edition}: saved clock-in and approved leave are preserved`, async () => {
    const f = fixture(edition);
    const existing = { DailyId: dailyId('teacher.one'), Username: 'TEACHER.ONE', Date: date, FirstClockIn: `${date}T08:00:00Z`, AttendanceStatus: 'Present', __updateTime: 'original-revision' };
    const original = structuredClone(existing);
    const result = await f.sync([{ Username: 'teacher.one' }, { Username: 'teacher.two' }], [existing], [
      { Username: 'TEACHER.TWO', Status: 'Approved', StartDate: date, EndDate: date }
    ]);
    assert.deepEqual(existing, original);
    assert.deepEqual(result.dailyRows.find(row => row.Username === 'TEACHER.ONE'), original);
    assert.equal(result.dailyRows.find(row => row.Username === 'teacher.two').AttendanceStatus, 'Approved leave');
    assert.equal(f.batches[0].length, 1);
  });

  test(`${edition}: different usernames sharing a sanitized ID are flagged, not merged or inserted`, async () => {
    const f = fixture(edition);
    const result = await f.sync([{ Username: 'teacher/one' }, { Username: 'teacher-one' }, { Username: 'teacher.two' }]);
    assert.equal(result.processingWarnings.length, 1);
    assert.match(result.processingWarnings[0], /teacher\/one, teacher-one/);
    assert.deepEqual(f.batches[0].map(row => row.data.Username), ['teacher.two']);
    assert.equal(result.dailyRows.length, 1);
  });

  test(`${edition}: concurrent clock-in wins over an automatic absence`, async () => {
    const f = fixture(edition);
    const present = { DailyId: dailyId('teacher.one'), Username: 'teacher.one', Date: date, FirstClockIn: `${date}T08:00:00Z`, AttendanceStatus: 'Present' };
    const root = edition === 'school' ? 'schoolBranches' : 'organisationBranches';
    f.stored.set(`${root}/main/staffDailyAttendance/${present.DailyId}`, present);
    const result = await f.sync([{ Username: 'teacher.one' }]);
    assert.deepEqual(result.dailyRows, [present]);
    assert.equal(f.batches.length, 0);
    assert.equal(f.stored.size, 1);
  });
}

test('blank usernames produce no automatic attendance records', () => {
  assert.deepEqual(automaticAbsenceCandidates([{ Username: '' }, {}], [], date), { candidates: [], processingWarnings: [] });
});

test('truncated legacy document ID collisions are skipped without choosing a staff identity', () => {
  const prefix = 'a'.repeat(140);
  const result = automaticAbsenceCandidates([{ Username: `${prefix}-one` }, { Username: `${prefix}-two` }], [], date);
  assert.equal(result.candidates.length, 0);
  assert.equal(result.processingWarnings.length, 1);
});

test('existing daily document belonging to a different username is preserved and flagged', async () => {
  const f = fixture();
  const saved = { DailyId: dailyId('teacher-one'), Username: 'teacher/one', Date: date, AttendanceStatus: 'Present' };
  const result = await f.sync([{ Username: 'teacher-one' }], [saved]);
  assert.deepEqual(result.dailyRows, [saved]);
  assert.match(result.processingWarnings[0], /another staff identity/);
  assert.equal(f.batches.length, 0);
});

test('deduplication precedes chunking even when repeated identities cross the batch boundary', async () => {
  const f = fixture();
  const directory = Array.from({ length: 805 }, (_, i) => ({ Username: `teacher-${i}` }));
  const result = await f.sync([...directory, ...directory.map(row => ({ Username: row.Username.toUpperCase() }))]);
  assert.equal(result.dailyRows.length, 805);
  assert.deepEqual(f.batches.map(rows => rows.length), [400, 400, 5]);
  assert.equal(f.stored.size, 805);
});

test('disabled policy, non-workday and before closing do not write automatic absences', async () => {
  for (const override of [ { Active: 'NO' }, { AutoRecordAbsence: 'NO' }, { DaySchedules: {} }, { DaySchedules: { TUE: { Enabled: true, ClosingTime: '17:00' } } } ]) {
    const f = fixture();
    assert.deepEqual(await f.sync([{ Username: 'teacher.one' }], [], [], override), { dailyRows: [], processingWarnings: [] });
    assert.equal(f.batches.length, 0);
  }
});

test('unrelated database failures are not hidden as duplicate identity conflicts', async () => {
  const f = fixture();
  f.dependencies.batchCommitDocuments = async () => { throw Object.assign(new Error('Database unavailable'), { status: 503 }); };
  await assert.rejects(f.sync([{ Username: 'teacher.one' }]), /Database unavailable/);
});

test('attendance list exposes identity warnings only to authorized reporters and the UI escapes them', async () => {
  const service = await readFile(new URL('../functions/lib/staff-time-attendance.js', import.meta.url), 'utf8');
  const ui = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
  assert.match(service, /processingWarnings: canReport \? processingWarnings : \[\]/);
  assert.match(service, /const directory = staffAttendanceDirectoryFor\(staffUsers, employees, user, branchId\)/);
  assert.match(ui, /data\.processingWarnings[\s\S]{0,180}escapeHtml\(warning\)/);
});
