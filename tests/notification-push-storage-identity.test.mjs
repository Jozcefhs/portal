import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../functions/lib/school-announcements.js', import.meta.url), 'utf8');
const logicalJobId = 'ANN-PUSH-NOTIF-teacher-homework:synthetic';
const notificationId = 'NOTIF-teacher-homework:synthetic';
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

function fixture({ legacy = false, notificationLegacy = legacy, missing = false, foreign = false,
  wrongIdentity = false, claimConflict = false, readFailure = false, foreignJob = false } = {}) {
  const storedId = legacy ? encodeURIComponent(logicalJobId) : logicalJobId;
  const notificationStoredId = notificationLegacy ? encodeURIComponent(notificationId) : notificationId;
  const jobs = new Map([[storedId, { __id: storedId, __updateTime: 'v1', PushJobId: logicalJobId,
    NotificationId: notificationId, SchoolId: foreignJob ? 'other' : 'school', Status: 'Pending',
    Offset: 0, AttemptCount: 0, FailureCount: 0, CreatedAt: '2026-10-22T12:00:00.000Z',
    UpdatedAt: '2026-10-22T12:00:00.000Z', AnnouncementId: '' }]]);
  const notification = { NotificationId: wrongIdentity ? 'different' : notificationId,
    SchoolId: foreign ? 'other' : 'school', Audience: 'Parent', TargetEmails: ['synthetic@example.invalid'] };
  const reads = [], writes = [], sent = [];
  let revision = 1;
  const run = vm.runInNewContext(`${source.replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/\bexport\s+/g, '')}\nprocessSchoolAnnouncementPushQueue`, {
    queryCollection: async (_env, collection, options) => {
      assert.equal(collection, 'notificationAnnouncementPushJobs');
      assert.equal(options.limit, 100);
      return [...jobs.values()].filter(row => row.Status === options.filters[0].value).map(clone);
    },
    upsertDocument: async (_env, collection, id, data, condition = {}) => {
      assert.equal(collection, 'notificationAnnouncementPushJobs');
      const current = jobs.get(id);
      if (claimConflict || (condition.updateTime && current?.__updateTime !== condition.updateTime)) {
        throw Object.assign(new Error('Write conflict'), { status: 409 });
      }
      assert.ok(current, 'must never create an alternate job');
      writes.push({ id, data: clone(data), condition: clone(condition) });
      const stored = { ...clone(data), __id: id, __updateTime: `v${++revision}` };
      jobs.set(id, stored);
      return stored;
    },
    getDocument: async (_env, collection, id) => {
      reads.push({ collection, id });
      assert.equal(collection, 'notifications', 'homework has no announcement record to read');
      if (readFailure) throw Object.assign(new Error('Database unavailable'), { status: 503 });
      return missing || id !== notificationStoredId ? null : clone(notification);
    },
    dispatchNotificationPush: async (_env, payload) => {
      sent.push(clone(payload));
      return [{ status: 'Delivered' }];
    }
  });
  return { jobs, storedId, reads, writes, sent, run: () => run({ DYNAMAX_WORKSPACE_ID: 'school' },
    { now: '2026-11-10T13:00:00.000Z', edition: 'school', limit: 1 }) };
}

for (const legacy of [false, true]) {
  test(`${legacy ? 'legacy encoded' : 'current literal'} push job updates the original record and retry sends nothing twice`, async () => {
    const h = fixture({ legacy });
    const first = await h.run();
    assert.equal(first.delivered, 1); assert.equal(first.remaining, 0);
    assert.equal(h.jobs.size, 1); assert.equal(h.sent.length, 1);
    assert.equal(h.reads.length, 1);
    assert.deepEqual(h.writes.map(row => row.id), [h.storedId, h.storedId]);
    assert.equal(h.writes[0].condition.updateTime, 'v1');
    const saved = h.jobs.get(h.storedId);
    assert.equal(saved.PushJobId, logicalJobId); assert.equal(saved.NotificationId, notificationId);
    assert.equal(saved.Status, 'Completed'); assert.equal(saved.Offset, 1); assert.equal(saved.AttemptCount, 1);
    assert.equal(saved.CreatedAt, '2026-10-22T12:00:00.000Z');
    assert.equal((await h.run()).inspected, 0);
    assert.equal(h.sent.length, 1); assert.equal(h.writes.length, 2); assert.equal(h.reads.length, 1);
  });
}

test('legacy job can reference a current notification using at most two point reads', async () => {
  const h = fixture({ legacy: true, notificationLegacy: false });
  assert.equal((await h.run()).delivered, 1);
  assert.deepEqual(h.reads.map(row => row.id), [encodeURIComponent(notificationId), notificationId]);
});

test('missing legacy notification is abandoned once without sending or creating another job', async () => {
  const h = fixture({ legacy: true, missing: true });
  assert.equal((await h.run()).failed, 1);
  assert.equal(h.jobs.get(h.storedId).Status, 'Abandoned'); assert.equal(h.jobs.size, 1);
  assert.equal(h.sent.length, 0); assert.equal(h.reads.length, 2);
  assert.equal((await h.run()).inspected, 0);
});

for (const options of [{ foreign: true }, { wrongIdentity: true }]) {
  test(`mismatched linked notification fails closed ${JSON.stringify(options)}`, async () => {
    const h = fixture({ legacy: true, ...options });
    await assert.rejects(h.run(), /identity does not match/);
    assert.equal(h.sent.length, 0); assert.equal(h.jobs.get(h.storedId).Offset, 0);
    assert.equal(h.jobs.size, 1); assert.equal(h.reads.length, 1);
  });
}

test('another workspace job is not claimed or read', async () => {
  const h = fixture({ legacy: true, foreignJob: true });
  assert.equal((await h.run()).inspected, 0);
  assert.equal(h.sent.length, 0); assert.equal(h.writes.length, 0); assert.equal(h.reads.length, 0);
});

test('concurrent claim conflict sends nothing and preserves the pending job', async () => {
  const h = fixture({ legacy: true, claimConflict: true });
  assert.equal((await h.run()).delivered, 0);
  assert.equal(h.sent.length, 0); assert.equal(h.writes.length, 0); assert.equal(h.reads.length, 0);
  assert.equal(h.jobs.get(h.storedId).Status, 'Pending');
});

test('transient notification read failure does not abandon the original job', async () => {
  const h = fixture({ legacy: true, readFailure: true });
  await assert.rejects(h.run(), /Database unavailable/);
  assert.equal(h.sent.length, 0); assert.equal(h.jobs.get(h.storedId).Status, 'Processing');
  assert.equal(h.jobs.get(h.storedId).Offset, 0); assert.equal(h.writes.length, 1);
});
