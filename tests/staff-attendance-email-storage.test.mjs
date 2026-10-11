import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { requiredDeploymentIdentity } from '../functions/lib/deployment-identity.js';
import { safeScopeId } from '../functions/lib/school-scope.js';
import { canonicalRecordEdition, staffRecordMatchesEdition } from '../functions/lib/records-desk.js';
import { hrCapabilitiesFor } from '../functions/lib/human-resources.js';

const sources = Object.fromEntries(await Promise.all(['firestore', 'staff-attendance-storage', 'staff-attendance-schedules', 'staff-attendance-groups', 'staff-time-attendance', 'attendance-presence-notifications'].map(async name => [
  name, await readFile(new URL(`../functions/lib/${name}.js`, import.meta.url), 'utf8')
])));

// Run the actual storage, attendance and REST serialization code together. A
// document-name-only stub would miss the @ versus literal %40 regression.
function loadModule(source, imports, globals, setup = '') {
  const exports = [...source.matchAll(/^export (?:async )?function (\w+)|^export const (\w+)/gm)].map(match => match[1] || match[2]);
  const body = source.replace(/^import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?/gm, (_match, bindings, path) =>
    `const { ${bindings.replace(/\b(\w+)\s+as\s+(\w+)\b/g, '$1: $2')} } = __imports[${JSON.stringify(path)}];`
  ).replace(/^export /gm, '');
  return vm.runInNewContext(`(() => { ${body}\n${setup}\nreturn { ${exports.join(', ')} }; })()`, { ...globals, __imports: imports });
}

function fixture(edition = 'school', username = 'teacher@example.test') {
  let time = '2026-10-09T09:00:00.000Z';
  let beforeRequest = null;
  let revision = 0;
  class TestDate extends Date {
    constructor(...args) { super(...(args.length ? args : [time])); }
    static now() { return Date.parse(time); }
  }
  const env = {
    FIREBASE_PROJECT_ID: `attendance-test-${edition}`, FIREBASE_CLIENT_EMAIL: 'test@example.test', FIREBASE_PRIVATE_KEY: 'unused',
    ORGANISATION_EDITION: edition, DYNAMAX_WORKSPACE_ID: `attendance-${edition}`
  };
  const resourceBase = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
  const root = edition === 'school' ? 'schoolBranches' : 'organisationBranches';
  const path = key => `${root}/main/${key}`;
  const documents = new Map();
  const commits = [];
  const requests = [];
  const json = (status, data) => ({ status, ok: status < 300, json: async () => data });
  const conflict = name => json(409, { error: { status: 'ALREADY_EXISTS', message: `Document already exists: ${name}` } });
  const preconditionMet = (name, condition) => !condition || (
    condition.updateTime ? documents.get(name)?.updateTime === condition.updateTime
      : condition.exists === undefined || documents.has(name) === condition.exists
  );
  const save = (name, fields) => {
    const updateTime = `2026-10-09T09:00:00.${String(++revision).padStart(6, '0')}Z`;
    const row = { name, fields: structuredClone(fields), updateTime };
    documents.set(name, row);
    return row;
  };
  const fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    assert.equal(parsed.hostname, 'firestore.googleapis.com', 'No real network or OAuth calls');
    const name = decodeURIComponent(parsed.pathname.replace(/^\/v1\//, ''));
    requests.push({ name, method: options.method || 'GET' });
    if (beforeRequest) beforeRequest({ name, method: options.method || 'GET' });
    if (name.endsWith(':commit')) {
      const { writes } = JSON.parse(options.body);
      // Firestore JSON resource names are literal, unlike REST URL segments.
      const names = writes.map(write => write.update?.name || write.delete);
      assert.equal(new Set(names).size, writes.length, 'No duplicate names in an atomic commit');
      for (const [index, write] of writes.entries()) {
        if (!preconditionMet(names[index], write.currentDocument)) return conflict(names[index]);
      }
      commits.push(structuredClone(writes));
      return json(200, { writeResults: writes.map(write => {
        if (write.delete) { documents.delete(write.delete); return {}; }
        return { updateTime: save(write.update.name, write.update.fields).updateTime };
      }) });
    }
    if (options.method === 'PATCH') {
      const condition = parsed.searchParams.has('currentDocument.updateTime')
        ? { updateTime: parsed.searchParams.get('currentDocument.updateTime') }
        : parsed.searchParams.has('currentDocument.exists') ? { exists: parsed.searchParams.get('currentDocument.exists') === 'true' } : null;
      if (!preconditionMet(name, condition)) return conflict(name);
      const { fields } = JSON.parse(options.body);
      const merged = parsed.searchParams.has('updateMask.fieldPaths') ? { ...documents.get(name)?.fields, ...fields } : fields;
      return json(200, save(name, merged));
    }
    if (name.endsWith(':runQuery')) {
      const { structuredQuery: query } = JSON.parse(options.body);
      const collection = `${name.slice(0, -':runQuery'.length)}/${query.from[0].collectionId}`;
      let rows = [...documents.values()].filter(row => row.name.slice(0, row.name.lastIndexOf('/')) === collection);
      const filters = query.where?.compositeFilter?.filters || (query.where ? [query.where] : []);
      for (const { fieldFilter: filter } of filters) {
        const expected = filter.value.stringValue;
        rows = rows.filter(row => {
          const actual = row.fields[filter.field.fieldPath]?.stringValue;
          return filter.op === 'EQUAL' ? actual === expected : filter.op === 'GREATER_THAN' ? actual > expected : filter.op === 'GREATER_THAN_OR_EQUAL' ? actual >= expected : actual <= expected;
        });
      }
      return json(200, rows.slice(0, query.limit || rows.length).map(document => ({ document })));
    }
    if (name.split('/').length % 2 === 0) {
      return json(200, { documents: [...documents.values()].filter(row => row.name.slice(0, row.name.lastIndexOf('/')) === name) });
    }
    return documents.has(name) ? json(200, documents.get(name)) : json(404, { error: { status: 'NOT_FOUND', message: 'Not found' } });
  };
  const globals = { fetch, URL, URLSearchParams, TextEncoder, crypto: webcrypto, Date: TestDate };
  const firestore = loadModule(sources.firestore, {}, globals, "getFirestoreAccessToken = async () => 'isolated-test-token';");
  const storage = loadModule(sources['staff-attendance-storage'], {
    './firestore.js': firestore, './deployment-identity.js': { requiredDeploymentIdentity }, './school-scope.js': { safeScopeId }
  }, globals);
  const schedules = loadModule(sources['staff-attendance-schedules'], {}, globals);
  const groups = loadModule(sources['staff-attendance-groups'], {
    './firestore.js': firestore, './deployment-identity.js': { requiredDeploymentIdentity },
    './staff-attendance-storage.js': storage, './staff-attendance-schedules.js': schedules,
    './records-desk.js': { canonicalRecordEdition, staffRecordMatchesEdition }
  }, globals);
  const attendance = loadModule(sources['staff-time-attendance'], {
    './firestore.js': firestore, './staff-attendance-storage.js': storage,
    './staff-attendance-schedules.js': schedules, './staff-attendance-groups.js': groups,
    './records-desk.js': { staffRecordMatchesEdition }, './human-resources.js': { hrCapabilitiesFor }
  }, globals);
  const notifications = loadModule(sources['attendance-presence-notifications'], {
    './firestore.js': firestore, './staff-attendance-storage.js': storage,
    './staff-time-attendance.js': attendance, './notifications.js': {}, './school-scope.js': {}
  }, globals);
  const put = (collection, id, data) => save(`${resourceBase}/${collection}/${id}`, firestore.objectToFirestoreFields(data));
  const get = (collection, id) => {
    const document = documents.get(`${resourceBase}/${collection}/${id}`);
    return document ? firestore.firestoreDocumentToObject(document) : null;
  };
  const count = collection => [...documents.keys()].filter(name => name.slice(0, name.lastIndexOf('/')) === `${resourceBase}/${collection}`).length;
  put(path('staffAttendancePolicy'), 'default', {
    Active: 'YES', TimeZone: 'UTC', AutoRecordAbsence: 'NO', IdentityVerification: 'NONE',
    PresenceCheckMode: 'RANDOM', PresenceCheckMinimumMinutes: 15, PresenceCheckMaximumMinutes: 15
  });
  put(path('staffAttendanceSites'), 'office', { SiteId: 'office', Name: 'Office', Active: 'YES', Policy: 'NETWORK_ONLY', AllowedPublicIps: ['192.0.2.1'] });
  const user = { username, displayName: 'Sample Teacher', branchId: 'main', role: 'Department User', edition };
  put('staffUsers', username, { Username: username, DisplayName: user.displayName, Role: user.role,
    Edition: edition, BranchId: 'main', Active: 'YES' });
  const body = { SiteId: 'office', BranchId: 'main' };
  const context = { clientIp: '192.0.2.1' };
  const clock = direction => attendance.clockStaffAttendance(env, user, { ...body, Direction: direction }, context);
  const dailyId = (date = time.slice(0, 10)) => storage.safeStaffAttendanceDocumentId(`DAY-${date}-${username}`);
  return { env, firestore, storage, schedules, groups, attendance, notifications, user, body, context, documents, commits, requests, path, put, get, count, clock, dailyId,
    setTime: value => { time = value; }, beforeRequest: callback => { beforeRequest = callback; } };
}

function configureAttendanceGroup(f, changes = {}, policyChanges = {}) {
  const policy = { ...f.get(f.path('staffAttendancePolicy'), 'default'), ...policyChanges };
  f.put(f.path('staffAttendancePolicy'), 'default', policy);
  const daySchedules = Object.fromEntries(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map(day => [day, {
    Enabled: day === 'FRI', ResumptionTime: '21:00', ClosingTime: '07:00', EndDayOffset: 1
  }]));
  const group = f.schedules.normalizeAttendanceGroup({ GroupId: 'night-duty', Name: 'Night duty', ScheduleType: 'FIXED',
    EffectiveFrom: '2026-10-09', DaySchedules: daySchedules, ...changes }, {}, policy);
  const roster = { Revision: 'roster-1', Groups: [group], Assignments: [{ Username: f.user.username, GroupId: group.GroupId, EffectiveFrom: group.EffectiveFrom }] };
  f.put(f.path('staffAttendancePolicy'), 'roster', roster);
  f.put('staffUsers', f.user.username, { Username: f.user.username, DisplayName: f.user.displayName, Role: f.user.role,
    Edition: f.user.edition, BranchId: 'main', Active: 'YES' });
  return { policy: f.attendance.normalizeAttendancePolicy(policy), group, roster };
}

for (const edition of ['school', 'faith', 'organization']) {
  test(`${edition}: fixed overnight group retains its daily identity, metrics and presence after midnight`, async () => {
    const f = fixture(edition);
    configureAttendanceGroup(f);
    f.setTime('2026-10-09T22:00:00.000Z');
    const first = await f.clock('IN');
    assert.equal(first.daily.Date, '2026-10-09');
    assert.equal(first.daily.LateMinutes, 60);
    assert.equal(first.daily.ShiftSnapshot.EndAt, '2026-10-10T07:00:00.000Z');
    f.setTime('2026-10-10T02:00:00.000Z');
    const quick = await f.attendance.getStaffAttendanceQuickState(f.env, f.user);
    const list = await f.attendance.listStaffAttendance(f.env, f.user);
    const presence = await f.attendance.getStaffAttendancePresenceState(f.env, f.user);
    for (const view of [quick, list, presence]) {
      assert.equal(view.state, 'CLOCKED_IN');
      assert.equal(view.attendanceDate, '2026-10-09');
    }
    assert.equal(quick.todayDaily.DailyId, f.dailyId('2026-10-09'));
    assert.equal(list.myDailyRecords[0].DailyId, f.dailyId('2026-10-09'));
    await f.attendance.recordPresenceCheck(f.env, f.user, f.body, f.context);
    assert.equal(f.get(f.path('staffTimeState'), f.user.username).ShiftSnapshot.AttendanceDate, '2026-10-09');
    f.setTime('2026-10-10T08:00:00.000Z');
    const completed = await f.clock('OUT');
    assert.equal(completed.state, 'COMPLETED');
    assert.equal(completed.daily.WorkMinutes, 600);
    assert.equal(completed.daily.OvertimeMinutes, 60);
    assert.equal(completed.daily.LateMinutes, 60);
    assert.equal(completed.daily.EarlyDepartureMinutes, 0);
    assert.equal(completed.daily.PresenceCheckCount, 1);
    assert.equal(f.count(f.path('staffDailyAttendance')), 1);
    assert.equal(f.count(f.path('staffTimeEvents')), 3);
    assert.equal(f.get(f.path('staffDailyAttendance'), f.dailyId('2026-10-10')), null);
  });

  test(`${edition}: rotating 24-hour duty has two rest days and absence only after the duty ends`, async () => {
    const f = fixture(edition);
    const { policy, roster } = configureAttendanceGroup(f, { ScheduleType: 'ROTATING', AnchorDate: '2026-10-09', CycleDays: [
      { Enabled: true, ResumptionTime: '08:00', ClosingTime: '08:00', EndDayOffset: 1 }, { Enabled: false }, { Enabled: false }
    ] }, { AutoRecordAbsence: 'YES' });
    const directory = [{ Username: f.user.username, DisplayName: f.user.displayName }];
    const synchronize = (date, rows = []) => f.attendance.synchronizeRosterAbsences(f.env, 'main', policy, roster, new Date(date), directory, [], rows);
    assert.equal((await synchronize('2026-10-09T18:00:00.000Z')).dailyRows.length, 0);
    assert.equal((await synchronize('2026-10-10T07:59:59.000Z')).dailyRows.length, 0);
    const end = await synchronize('2026-10-10T08:00:00.000Z');
    assert.equal(end.dailyRows.length, 1);
    assert.equal(end.dailyRows[0].Date, '2026-10-09');
    assert.equal(end.dailyRows[0].AttendanceStatus, 'Absent');
    assert.equal(end.dailyRows[0].ShiftSnapshot.GroupId, 'night-duty');
    const rest = await synchronize('2026-10-11T23:00:00.000Z', end.dailyRows);
    assert.equal(rest.dailyRows.length, 1);
    f.setTime('2026-10-11T09:00:00.000Z');
    assert.equal((await f.attendance.getStaffAttendanceQuickState(f.env, f.user)).state, 'OFF_DUTY');
    await assert.rejects(f.clock('IN'), /no open shift scheduled/i);
    assert.equal(f.count(f.path('staffTimeEvents')), 0);
    assert.equal(f.count(f.path('staffDailyAttendance')), 1);
  });

  test(`${edition}: edited group history retains an unclocked prior-night duty for absence processing`, async () => {
    const f = fixture(edition);
    const { policy, roster, group } = configureAttendanceGroup(f, {}, { AutoRecordAbsence: 'YES' });
    const changed = f.schedules.normalizeAttendanceGroup({ Name: 'New daytime rota', EffectiveFrom: '2026-10-10',
      DaySchedules: { FRI: { Enabled: false }, SAT: { Enabled: true, ResumptionTime: '08:00', ClosingTime: '17:00', EndDayOffset: 0 } }
    }, group, policy);
    const updated = { ...roster, Revision: 'roster-2', Groups: [{ ...changed, History: [group] }] };
    f.put(f.path('staffAttendancePolicy'), 'roster', updated);
    const result = await f.attendance.synchronizeRosterAbsences(f.env, 'main', policy, updated, new Date('2026-10-10T07:00:00.000Z'),
      [{ Username: f.user.username, DisplayName: f.user.displayName }], [], []);
    assert.equal(result.dailyRows.length, 1);
    assert.equal(result.dailyRows[0].Date, '2026-10-09');
    assert.equal(result.dailyRows[0].AttendanceStatus, 'Absent');
    assert.equal(result.dailyRows[0].ShiftSnapshot.GroupName, 'Night duty');
    assert.equal(result.dailyRows[0].ShiftSnapshot.EndAt, '2026-10-10T07:00:00.000Z');
  });

  test(`${edition}: 24-hour clock-out and manual overnight correction use the starting attendance date`, async () => {
    const f = fixture(edition);
    configureAttendanceGroup(f, { ScheduleType: 'ROTATING', AnchorDate: '2026-10-09', CycleDays: [
      { Enabled: true, ResumptionTime: '08:00', ClosingTime: '08:00', EndDayOffset: 1 }, { Enabled: false }, { Enabled: false }
    ] });
    f.setTime('2026-10-09T08:00:00.000Z');
    await f.clock('IN');
    f.setTime('2026-10-10T08:00:00.000Z');
    const out = await f.clock('OUT');
    assert.equal(out.daily.Date, '2026-10-09');
    assert.equal(out.daily.WorkMinutes, 1440);
    const corrected = await f.attendance.recordManualAttendance(f.env, { ...f.user, role: 'Super Admin' }, {
      Username: f.user.username, Direction: 'OUT', AttendanceDate: '2026-10-09',
      Timestamp: '2026-10-10T09:00:00.000Z', Reason: 'Confirmed actual overnight handover time'
    });
    assert.equal(corrected.daily.Date, '2026-10-09');
    assert.equal(corrected.daily.WorkMinutes, 1500);
    assert.equal(corrected.daily.OvertimeMinutes, 60);
    assert.equal(f.count(f.path('staffDailyAttendance')), 1);
    assert.equal(f.get(f.path('staffTimeState'), f.user.username).AttendanceDate, '2026-10-09');
  });

  test(`${edition}: edits to schedule, assignment and default timing cannot change a clocked-in snapshot`, async () => {
    const f = fixture(edition);
    const { roster } = configureAttendanceGroup(f);
    f.setTime('2026-10-09T21:00:00.000Z');
    await f.clock('IN');
    const original = f.get(f.path('staffTimeState'), f.user.username).ShiftSnapshot;
    f.put(f.path('staffAttendancePolicy'), 'roster', { ...roster, Revision: 'roster-2',
      Groups: [{ ...roster.Groups[0], EffectiveFrom: '2026-10-10', GraceMinutes: 100, Name: 'Renamed night duty' }],
      Assignments: [...roster.Assignments, { Username: f.user.username, GroupId: '', EffectiveFrom: '2026-10-10' }]
    });
    f.put(f.path('staffAttendancePolicy'), 'default', {
      ...f.get(f.path('staffAttendancePolicy'), 'default'), ClosingTime: '18:00', GraceMinutes: 180, OvertimeMinimumMinutes: 240
    });
    f.setTime('2026-10-10T06:30:00.000Z');
    const quick = await f.attendance.getStaffAttendanceQuickState(f.env, f.user);
    assert.equal(quick.state, 'CLOCKED_IN');
    assert.deepEqual(quick.currentShift, original);
    const out = await f.clock('OUT');
    assert.equal(out.daily.Date, '2026-10-09');
    assert.equal(out.daily.WorkMinutes, 570);
    assert.equal(out.daily.EarlyDepartureMinutes, 30);
    assert.equal(out.daily.ShiftSnapshot.GroupName, 'Night duty');
  });

  test(`${edition}: simultaneous overnight clock-outs have one winner and cannot duplicate or rewrite history`, async () => {
    const f = fixture(edition);
    configureAttendanceGroup(f);
    f.setTime('2026-10-09T21:00:00.000Z');
    await f.clock('IN');
    f.setTime('2026-10-10T07:00:00.000Z');
    const results = await Promise.allSettled([f.clock('OUT'), f.clock('OUT')]);
    assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
    assert.equal(results.filter(row => row.status === 'rejected').length, 1);
    assert.equal(f.count(f.path('staffDailyAttendance')), 1);
    assert.equal(f.count(f.path('staffTimeEvents')), 2);
    f.setTime('2026-10-10T07:30:00.000Z');
    await assert.rejects(f.clock('OUT'), error => error.status === 409);
    assert.equal(f.get(f.path('staffDailyAttendance'), f.dailyId('2026-10-09')).LastClockOut, '2026-10-10T07:00:00.000Z');
  });

  test(`${edition}: assigning a group after a default-policy clock-in preserves that day's original hours`, async () => {
    const f = fixture(edition);
    await f.clock('IN');
    const original = f.get(f.path('staffDailyAttendance'), f.dailyId('2026-10-09'));
    configureAttendanceGroup(f);
    f.setTime('2026-10-09T09:16:00.000Z');
    await f.attendance.recordPresenceCheck(f.env, f.user, f.body, f.context);
    const preservedState = f.get(f.path('staffTimeState'), f.user.username);
    assert.equal(f.notifications.attendancePresenceNotificationCandidate(f.get(f.path('staffAttendancePolicy'), 'default'),
      preservedState, new Date('2026-10-09T09:31:00.000Z')).eligible, true);
    f.setTime('2026-10-09T17:00:00.000Z');
    const out = await f.clock('OUT');
    assert.equal(out.daily.ScheduledResumptionTime, original.ScheduledResumptionTime);
    assert.equal(out.daily.ScheduledClosingTime, original.ScheduledClosingTime);
    assert.equal(out.daily.WorkMinutes, 480);
    assert.equal(out.daily.EarlyDepartureMinutes, 0);
    assert.equal(out.daily.OvertimeMinutes, 0);
    assert.equal(out.daily.LateMinutes, 60);
    assert.equal(f.count(f.path('staffDailyAttendance')), 1);
  });

  test(`${edition}: assigning a group during default-policy rest-day work preserves its overtime classification`, async () => {
    const f = fixture(edition);
    f.setTime('2026-10-10T09:00:00.000Z');
    const clockIn = await f.clock('IN');
    assert.equal(clockIn.daily.AttendanceStatus, 'Overtime day');
    configureAttendanceGroup(f);
    f.setTime('2026-10-10T13:00:00.000Z');
    const out = await f.clock('OUT');
    assert.equal(out.daily.AttendanceStatus, 'Overtime day');
    assert.equal(out.daily.WorkMinutes, 240);
    assert.equal(out.daily.OvertimeMinutes, 240);
    assert.equal(out.daily.EarlyDepartureMinutes, 0);
    assert.equal(out.daily.LateMinutes, 0);
    assert.equal(f.count(f.path('staffDailyAttendance')), 1);
  });

  test(`${edition}: reaching shift end during attendance reads cannot create a late clock-in`, async () => {
    const f = fixture(edition);
    configureAttendanceGroup(f);
    f.setTime('2026-10-10T06:59:59.999Z');
    f.beforeRequest(({ name, method }) => {
      if (method === 'GET' && name.includes('/staffDailyAttendance/')) f.setTime('2026-10-10T07:00:00.000Z');
    });
    await assert.rejects(f.clock('IN'), error => [400, 403, 409].includes(error.status) && /shift|scheduled/i.test(error.message));
    assert.equal(f.count(f.path('staffDailyAttendance')), 0);
    assert.equal(f.count(f.path('staffTimeEvents')), 0);
  });

  test(`${edition}: group opening hours and normal premises checks remain enforced with inactive branch hours`, async () => {
    const f = fixture(edition);
    configureAttendanceGroup(f, {}, { Active: 'NO' });
    f.setTime('2026-10-09T19:59:00.000Z');
    await assert.rejects(f.clock('IN'), /Clock-in opens at/);
    assert.equal(f.count(f.path('staffDailyAttendance')), 0);
    f.setTime('2026-10-09T20:00:00.000Z');
    await assert.rejects(f.attendance.clockStaffAttendance(f.env, f.user, { ...f.body, Direction: 'IN',
      ShiftSnapshot: { StartAt: '2026-10-09T00:00:00Z', EndAt: '2026-10-10T23:00:00Z' }, GroupId: 'spoofed'
    }, { clientIp: '198.51.100.1' }), /outside the approved/);
    assert.equal(f.count(f.path('staffDailyAttendance')), 0);
    const saved = await f.clock('IN');
    assert.equal(saved.daily.ShiftSnapshot.GroupId, 'night-duty');
    assert.equal(saved.daily.ShiftSnapshot.StartAt, '2026-10-09T21:00:00.000Z');
    assert.equal(saved.daily.LateMinutes, 0);
  });

  test(`${edition}: email username clocks in, reloads, confirms presence and clocks out without duplicate records`, async () => {
    const f = fixture(edition);
    assert.equal((await f.clock('IN')).state, 'CLOCKED_IN');
    assert.equal((await f.attendance.getStaffAttendanceQuickState(f.env, f.user)).state, 'CLOCKED_IN');
    assert.equal((await f.attendance.getStaffAttendancePresenceState(f.env, f.user)).state, 'CLOCKED_IN');
    await assert.rejects(f.clock('IN'), /already clocked in/);
    f.setTime('2026-10-09T09:16:00.000Z');
    await f.attendance.recordPresenceCheck(f.env, f.user, f.body, f.context);
    assert.equal(f.get(f.path('staffDailyAttendance'), f.dailyId()).PresenceCheckCount, 1);
    f.setTime('2026-10-09T17:00:00.000Z');
    assert.equal((await f.clock('OUT')).state, 'COMPLETED');
    await assert.rejects(f.clock('OUT'), /already recorded/);
    assert.equal(f.count(f.path('staffTimeState')), 1);
    assert.equal(f.count(f.path('staffDailyAttendance')), 1);
    assert.equal(f.count(f.path('staffTimeEvents')), 3);
    assert.equal(f.get(f.path('staffDailyAttendance'), f.dailyId()).FirstClockIn, '2026-10-09T09:00:00.000Z');
  });

  test(`${edition}: existing percent-encoded state from an earlier day is reused on the next clock-in`, async () => {
    const f = fixture(edition);
    const encodedId = encodeURIComponent(f.user.username);
    f.put(f.path('staffTimeState'), encodedId, { Username: f.user.username, State: 'COMPLETED', AttendanceDate: '2026-10-08', LastTimestamp: '2026-10-08T17:00:00Z' });
    await f.clock('IN');
    assert.equal(f.get(f.path('staffTimeState'), encodedId).State, 'CLOCKED_IN');
    assert.equal(f.count(f.path('staffTimeState')), 1);
    assert.equal((await f.attendance.getStaffAttendanceQuickState(f.env, f.user)).state, 'CLOCKED_IN');
  });

  test(`${edition}: existing encoded daily record and first clock-in survive presence and clock-out`, async () => {
    const f = fixture(edition);
    const stateId = encodeURIComponent(f.user.username);
    const dailyId = encodeURIComponent(f.dailyId());
    f.put(f.path('staffTimeState'), stateId, {
      Username: f.user.username, AttendanceDate: '2026-10-09', State: 'CLOCKED_IN',
      NextPresenceCheckDueAt: '2026-10-09T08:30:00.000Z'
    });
    f.put(f.path('staffDailyAttendance'), dailyId, {
      Username: f.user.username, DailyId: f.dailyId(), Date: '2026-10-09', FirstClockIn: '2026-10-09T08:00:00.000Z', AttendanceStatus: 'Present',
      Notes: 'Preserve this historical note', CreatedAt: '2026-10-09T08:00:00.000Z'
    });
    const quick = await f.attendance.getStaffAttendanceQuickState(f.env, f.user);
    assert.equal(quick.state, 'CLOCKED_IN');
    assert.equal(f.get(f.path('staffTimeState'), stateId).NextPresenceNotificationAt, '2026-10-09T08:30:00.000Z');
    await f.attendance.recordPresenceCheck(f.env, f.user, f.body, f.context);
    f.setTime('2026-10-09T17:00:00.000Z');
    await f.clock('OUT');
    const daily = f.get(f.path('staffDailyAttendance'), dailyId);
    assert.equal(daily.FirstClockIn, '2026-10-09T08:00:00.000Z');
    assert.equal(daily.Notes, 'Preserve this historical note');
    assert.equal(daily.PresenceCheckCount, 1);
    assert.equal(daily.WorkMinutes, 540);
    assert.equal(f.count(f.path('staffDailyAttendance')), 1);
    assert.equal(f.count(f.path('staffTimeState')), 1);
  });

  test(`${edition}: manual correction preserves the actual encoded daily and state IDs`, async () => {
    const f = fixture(edition);
    const stateId = encodeURIComponent(f.user.username);
    const dailyId = encodeURIComponent(f.dailyId());
    f.put(f.path('staffTimeState'), stateId, { Username: f.user.username, State: 'CLOCKED_IN', LastTimestamp: '2026-10-09T08:00:00.000Z' });
    f.put(f.path('staffDailyAttendance'), dailyId, { Username: f.user.username, Date: '2026-10-09', DailyId: f.dailyId(), FirstClockIn: '2026-10-09T08:00:00.000Z', Notes: 'Retain note' });
    const result = await f.attendance.recordManualAttendance(f.env, { ...f.user, role: 'Super Admin' }, {
      Username: f.user.username, Direction: 'OUT', Reason: 'Verified exit time', Timestamp: '2026-10-09T17:00:00.000Z'
    });
    assert.equal(result.ok, true);
    assert.equal(f.get(f.path('staffDailyAttendance'), dailyId).FirstClockIn, '2026-10-09T08:00:00.000Z');
    assert.equal(f.get(f.path('staffDailyAttendance'), dailyId).Notes, 'Retain note');
    assert.equal(f.get(f.path('staffTimeState'), stateId).State, 'COMPLETED');
    assert.equal(f.count(f.path('staffDailyAttendance')), 1);
    assert.equal(f.count(f.path('staffTimeState')), 1);
    assert.equal(f.count(f.path('staffTimeAudit')), 1);
  });

  test(`${edition}: corrections replace either timestamp and recalculate the completed day's totals`, async () => {
    const f = fixture(edition);
    f.put(f.path('staffAttendancePolicy'), 'default', {
      Active: 'YES', TimeZone: 'UTC', ResumptionTime: '08:00', ClosingTime: '17:00', GraceMinutes: 0, OvertimeMinimumMinutes: 0
    });
    f.put(f.path('staffTimeState'), f.user.username, {
      Username: f.user.username, State: 'COMPLETED', AttendanceDate: '2026-10-09', LastTimestamp: '2026-10-09T17:00:00.000Z', PresenceCheckSequence: 3
    });
    f.put(f.path('staffDailyAttendance'), f.dailyId(), {
      Username: f.user.username, Date: '2026-10-09', DailyId: f.dailyId(), FirstClockIn: '2026-10-09T08:00:00.000Z',
      LastClockOut: '2026-10-09T17:00:00.000Z', WorkMinutes: 540, AttendanceStatus: 'Present', Notes: 'Preserve evidence', PresenceCheckCount: 3
    });
    const correct = (Direction, hour) => f.attendance.recordManualAttendance(f.env, { ...f.user, role: 'Super Admin' }, {
      Username: f.user.username, Direction, Reason: 'Verified attendance correction', Timestamp: `2026-10-09T${hour}:00:00.000Z`
    });
    const later = (await correct('IN', '09')).daily;
    assert.equal(later.FirstClockIn, '2026-10-09T09:00:00.000Z');
    assert.equal(later.WorkMinutes, 480);
    assert.equal(later.LateMinutes, 60);
    assert.equal(later.AttendanceStatus, 'Late');
    const earlier = (await correct('IN', '07')).daily;
    assert.equal(earlier.WorkMinutes, 600);
    assert.equal(earlier.LateMinutes, 0);
    assert.equal(earlier.AttendanceStatus, 'Present');
    const earlyExit = (await correct('OUT', '16')).daily;
    assert.equal(earlyExit.LastClockOut, '2026-10-09T16:00:00.000Z');
    assert.equal(earlyExit.WorkMinutes, 540);
    assert.equal(earlyExit.EarlyDepartureMinutes, 60);
    assert.equal(earlyExit.Notes, 'Preserve evidence');
    assert.equal(earlyExit.PresenceCheckCount, 3);
    const lateExit = (await correct('OUT', '18')).daily;
    assert.equal(lateExit.OvertimeMinutes, 60);
    assert.equal(lateExit.EarlyDepartureMinutes, 0);
    assert.equal(lateExit.WorkMinutes, 660);
    const state = f.get(f.path('staffTimeState'), f.user.username);
    assert.equal(state.State, 'COMPLETED');
    assert.equal(state.NextDirection, '');
    assert.equal(state.LastTimestamp, lateExit.LastClockOut);
    assert.equal(state.PresenceCheckSequence, 3);
    await assert.rejects(correct('IN', '19'), /Clock-in must not be later/);
    await assert.rejects(correct('OUT', '06'), /Clock-in must not be later/);
    assert.equal(f.count(f.path('staffTimeAudit')), 4);
    assert.equal(f.count(f.path('staffTimeEvents')), 4);
    assert.equal(f.get(f.path('staffDailyAttendance'), f.dailyId()).WorkMinutes, 660);
  });

  test(`${edition}: correcting an older day does not move the current-day clock state backwards`, async () => {
    const f = fixture(edition);
    f.put(f.path('staffTimeState'), f.user.username, { Username: f.user.username, State: 'CLOCKED_IN',
      AttendanceDate: '2026-10-10', LastTimestamp: '2026-10-10T08:00:00.000Z' });
    await f.attendance.recordManualAttendance(f.env, { ...f.user, role: 'Super Admin' }, {
      Username: f.user.username, Direction: 'IN', Reason: 'Verified earlier day', Timestamp: '2026-10-09T08:00:00.000Z'
    });
    assert.equal(f.get(f.path('staffTimeState'), f.user.username).AttendanceDate, '2026-10-10');
    assert.equal(f.get(f.path('staffTimeState'), f.user.username).State, 'CLOCKED_IN');
  });

  test(`${edition}: simultaneous clock-ins create one atomic attendance entry`, async () => {
    const f = fixture(edition);
    const results = await Promise.allSettled([f.clock('IN'), f.clock('IN')]);
    assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
    assert.equal(results.filter(row => row.status === 'rejected').length, 1);
    assert.equal(f.count(f.path('staffTimeState')), 1);
    assert.equal(f.count(f.path('staffDailyAttendance')), 1);
    assert.equal(f.count(f.path('staffTimeEvents')), 1);
  });

  test(`${edition}: migrations retain literal encoded IDs without double-escaping or deleting history`, async () => {
    const f = fixture(edition);
    const legacyPath = 'organisationBranches/main/churchStaffTimeState';
    const id = encodeURIComponent(f.user.username);
    f.put(legacyPath, id, { Username: f.user.username, State: 'COMPLETED', AttendanceDate: '2026-10-08' });
    const result = await f.storage.migrateLegacyStaffAttendanceStorage(f.env, 'main');
    assert.equal(result.copied, 1);
    assert.equal(result.missingCanonicalRecords, 0);
    assert.equal(f.count(f.path('staffTimeState')), 1);
    assert.equal(f.get(f.path('staffTimeState'), id).Username, f.user.username);
    assert.equal(f.get(legacyPath, id).AttendanceDate, '2026-10-08');
    await f.clock('IN');
    assert.equal(f.count(f.path('staffTimeState')), 1);
    assert.equal(f.get(legacyPath, id).AttendanceDate, '2026-10-08');
  });

  test(`${edition}: presence notification delivery updates an encoded state record, not a second raw record`, async () => {
    const f = fixture(edition);
    const stateId = encodeURIComponent(f.user.username);
    f.put(f.path('staffTimeState'), stateId, {
      Username: f.user.username, State: 'CLOCKED_IN', AttendanceDate: '2026-10-09', NextPresenceNotificationAt: '2026-10-09T08:30:00.000Z'
    });
    const notices = [];
    const options = {
      structure: { Branches: [{ Id: 'main' }] },
      createNotification: async (_env, notice) => { notices.push(notice); return { created: true }; }
    };
    const result = await f.notifications.processAttendancePresenceNotifications(f.env, options);
    assert.equal(result.created, 1);
    assert.equal(f.get(f.path('staffTimeState'), stateId).NextPresenceNotificationAt, '');
    assert.equal(f.count(f.path('staffTimeState')), 1);
    await f.notifications.processAttendancePresenceNotifications(f.env, options);
    assert.equal(notices.length, 1);
    assert.deepEqual([...notices[0].TargetUsernames], [f.user.username]);
  });
}

test('a later DST-gap schedule cannot block checkout or manual correction of an existing overnight snapshot', async () => {
  const f = fixture();
  const week = Object.fromEntries(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map(day => [day, { Enabled: false }]));
  const { policy, roster, group } = configureAttendanceGroup(f, { EffectiveFrom: '2026-03-28',
    DaySchedules: { ...week, SAT: { Enabled: true, ResumptionTime: '08:00', ClosingTime: '08:00', EndDayOffset: 1 } }
  }, { TimeZone: 'Europe/London' });
  f.setTime('2026-03-28T08:00:00.000Z');
  await f.clock('IN');
  const changed = f.schedules.normalizeAttendanceGroup({ EffectiveFrom: '2026-03-29', DaySchedules: {
    ...week, SUN: { Enabled: true, ResumptionTime: '01:30', ClosingTime: '08:00', EndDayOffset: 0 }
  } }, group, policy);
  f.put(f.path('staffAttendancePolicy'), 'roster', { ...roster, Groups: [{ ...changed, History: [group] }] });
  f.setTime('2026-03-29T07:15:00.000Z');
  assert.equal((await f.attendance.getStaffAttendanceQuickState(f.env, f.user)).state, 'CLOCKED_IN');
  const out = await f.clock('OUT');
  assert.equal(out.daily.Date, '2026-03-28');
  assert.equal(out.daily.WorkMinutes, 1395);
  assert.equal(out.daily.OvertimeMinutes, 15);
  const corrected = await f.attendance.recordManualAttendance(f.env, { ...f.user, role: 'Super Admin' }, {
    Username: f.user.username, Direction: 'OUT', AttendanceDate: '2026-03-28', Timestamp: '2026-03-29T07:30:00.000Z',
    Reason: 'Verified handover after the clock change'
  });
  assert.equal(corrected.daily.Date, '2026-03-28');
  assert.equal(corrected.daily.WorkMinutes, 1410);
  assert.equal(corrected.daily.OvertimeMinutes, 30);
  assert.equal(f.count(f.path('staffDailyAttendance')), 1);
});

for (const username of ['plain.teacher', 'teacher+primary@example.test', 'teacher%40literal@example.test', 'tęacher@example.test']) {
  test(`literal document IDs round-trip for ${username}`, async () => {
    const f = fixture('school', username);
    await f.clock('IN');
    assert.equal((await f.attendance.getStaffAttendanceQuickState(f.env, f.user)).state, 'CLOCKED_IN');
    f.setTime('2026-10-09T17:00:00.000Z');
    await f.clock('OUT');
    assert.equal(f.get(f.path('staffTimeState'), username).State, 'COMPLETED');
  });
}

test('an encoded alias belonging to another literal-percent username is not treated as this staff member', async () => {
  const f = fixture();
  const otherUsername = encodeURIComponent(f.user.username);
  f.put(f.path('staffTimeState'), otherUsername, { Username: otherUsername, State: 'COMPLETED' });
  f.put(f.path('staffDailyAttendance'), encodeURIComponent(f.dailyId()), { Username: otherUsername, Date: '2026-10-09', FirstClockIn: '2026-10-09T08:00:00Z' });
  assert.equal(await f.storage.getStaffAttendanceDocument(f.env, 'state', 'main', f.user.username), null);
  assert.equal(await f.storage.getStaffAttendanceDocument(f.env, 'daily', 'main', f.dailyId()), null);
  await f.clock('IN');
  assert.equal(f.get(f.path('staffTimeState'), otherUsername).State, 'COMPLETED');
  assert.equal(f.get(f.path('staffTimeState'), f.user.username).State, 'CLOCKED_IN');
});

test('literal commits reject document path injection while retaining existing default batch naming', async () => {
  const f = fixture();
  for (const id of ['one/two', '.', '..']) {
    await assert.rejects(f.firestore.batchCommitLiteralDocuments(f.env, [{ collectionPath: f.path('staffTimeState'), documentId: id, data: {} }]), /single document path segment/);
  }
  await f.firestore.batchCommitDocuments(f.env, [{ collectionPath: 'unrelatedCollection', documentId: 'legacy@example.test', data: { Value: 'unchanged' } }]);
  assert.equal(f.get('unrelatedCollection', 'legacy%40example.test').Value, 'unchanged');
  await f.firestore.batchCommitLiteralDocuments(f.env, [{ collectionPath: 'unrelatedCollection', documentId: 'legacy%40example.test', operation: 'delete' }]);
  assert.equal(f.get('unrelatedCollection', 'legacy%40example.test'), null);
});

test('mixed legacy and literal inventory writes preserve exact IDs and atomic version conditions', async () => {
  const f = fixture(), stockId = 'café%20stock', legacyId = 'sale@example.test';
  f.put('inventory', stockId, { Quantity: 2.125 });
  const stock = f.get('inventory', stockId);
  await f.firestore.batchCommitDocuments(f.env, [
    { collectionPath: 'inventory', documentId: stockId, literalDocumentId: true, updateTime: stock.__updateTime, data: { Quantity: 1.125 } },
    { collectionPath: 'legacySales', documentId: legacyId, exists: false, data: { Quantity: 1 } }
  ]);
  assert.equal(f.get('inventory', stockId).Quantity, 1.125);
  assert.equal(f.get('inventory', encodeURIComponent(stockId)), null);
  assert.equal(f.get('legacySales', encodeURIComponent(legacyId)).Quantity, 1);
  assert.equal(f.get('legacySales', legacyId), null);
  await assert.rejects(f.firestore.batchCommitDocuments(f.env, [
    { collectionPath: 'inventory', documentId: stockId, literalDocumentId: true, updateTime: stock.__updateTime, data: { Quantity: 0.125 } },
    { collectionPath: 'legacySales', documentId: 'never-created', exists: false, data: { Quantity: 1 } }
  ]));
  assert.equal(f.get('inventory', stockId).Quantity, 1.125);
  assert.equal(f.get('legacySales', 'never-created'), null);
  for (const documentId of ['one/two', '.', '..']) {
    await assert.rejects(f.firestore.batchCommitDocuments(f.env, [{ collectionPath: 'inventory', documentId, literalDocumentId: true, data: {} }]), /single document path segment/);
  }
});

test('a literal-percent login cannot overwrite an email account whose old encoded ID collides with it', async () => {
  const f = fixture('school', 'teacher%40example.test');
  f.put(f.path('staffTimeState'), f.user.username, { Username: 'teacher@example.test', State: 'COMPLETED' });
  const before = structuredClone([...f.documents.entries()]);
  await assert.rejects(f.clock('IN'), error => error.status === 409 && /another staff identity/.test(error.message));
  assert.deepEqual([...f.documents.entries()], before);
  assert.equal(f.commits.length, 0);
});

test('automatic email-user absence uses the same readable daily ID and cannot overwrite a clock-in', async () => {
  const f = fixture();
  f.setTime('2026-10-09T17:01:00.000Z');
  const policy = f.attendance.normalizeAttendancePolicy({ Active: 'YES', TimeZone: 'UTC' });
  const result = await f.attendance.synchronizeAutomaticAbsences(f.env, 'main', policy, new Date('2026-10-09T17:01:00Z'), [{ Username: f.user.username }], [], []);
  assert.equal(result.dailyRows.length, 1);
  assert.equal(f.get(f.path('staffDailyAttendance'), f.dailyId()).AttendanceStatus, 'Absent');
  await f.clock('IN');
  const daily = f.get(f.path('staffDailyAttendance'), f.dailyId());
  assert.equal(daily.FirstClockIn, '2026-10-09T17:01:00.000Z');
  assert.equal(daily.AutoGenerated, false);
  const repeated = await f.attendance.synchronizeAutomaticAbsences(f.env, 'main', policy, new Date('2026-10-09T17:01:00Z'), [{ Username: f.user.username }], [], [daily]);
  assert.equal(repeated.dailyRows[0].FirstClockIn, daily.FirstClockIn);
  assert.equal(f.count(f.path('staffDailyAttendance')), 1);
});
