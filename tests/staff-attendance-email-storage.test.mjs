import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { requiredDeploymentIdentity } from '../functions/lib/deployment-identity.js';
import { safeScopeId } from '../functions/lib/school-scope.js';
import { staffRecordMatchesEdition } from '../functions/lib/records-desk.js';
import { hrCapabilitiesFor } from '../functions/lib/human-resources.js';

const sources = Object.fromEntries(await Promise.all(['firestore', 'staff-attendance-storage', 'staff-time-attendance', 'attendance-presence-notifications'].map(async name => [
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
  const attendance = loadModule(sources['staff-time-attendance'], {
    './firestore.js': firestore, './staff-attendance-storage.js': storage,
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
  const body = { SiteId: 'office', BranchId: 'main' };
  const context = { clientIp: '192.0.2.1' };
  const clock = direction => attendance.clockStaffAttendance(env, user, { ...body, Direction: direction }, context);
  const dailyId = (date = time.slice(0, 10)) => storage.safeStaffAttendanceDocumentId(`DAY-${date}-${username}`);
  return { env, firestore, storage, attendance, notifications, user, body, context, documents, commits, requests, path, put, get, count, clock, dailyId, setTime: value => { time = value; } };
}

for (const edition of ['school', 'faith', 'organization']) {
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
