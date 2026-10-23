import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as auth from '../functions/lib/staff-auth.js';

const clientSource = await readFile(new URL('../js/staff-idle-session.js', import.meta.url), 'utf8');
const endpointSource = await readFile(new URL('../functions/api/staff-session.js', import.meta.url), 'utf8');
const adminSource = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const IDLE = 2 * 60 * 60 * 1000;
const initialTime = Date.parse('2026-10-23T08:00:00Z');
const env = { STAFF_SESSION_SECRET: 'synthetic-idle-session-test-secret-only' };
const user = { username: 'teacher', role: 'Teacher', authEpoch: 'current' };
const payload = token => JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());

function endpoint({ active = true, externalExpired = false, reader = auth.readStaffSession } = {}) {
  const context = vm.createContext({ ...auth, Date, Response, Request, Headers, URL, crypto,
    readStaffSession: reader, requireFirestoreEnv: () => {},
    readJsonBody: request => request.json(),
    findStaffUserRecord: async () => ({ Username: 'teacher', Active: active, Role: 'Teacher' }),
    externalAuditAccessExpired: () => externalExpired,
    formatPersonName: () => 'Teacher', loadStaffProfileImage: async () => null,
    loadOrganizationNameProfile: async () => ({}), staffUserForRequest: async (_env, current) => current
  });
  vm.runInContext(endpointSource.replace(/^import[\s\S]*?;\r?\n/gm, '')
    .replace(/^export \{[^\n]*\r?\n/gm, '').replace(/^export /gm, ''), context);
  return {
    renew: (token, age = 0) => context.onRequestPost({ env, request: new Request('https://example.test/api/staff-session', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'activity', activityAgeMs: age })
    }) }),
    get: token => context.onRequestGet({ env, request: new Request('https://example.test/api/staff-session', {
      headers: { Authorization: `Bearer ${token}` }
    }) })
  };
}

test('staff tokens and cookies start with a two-hour idle lifetime', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: initialTime });
  const token = await auth.createStaffSession(env, user);
  const claims = payload(token);
  assert.equal((claims.exp - claims.activityAt) * 1000, IDLE);
  assert.ok(claims.sid);
  assert.match(auth.staffSessionCookie(token), /Max-Age=7200/);
});

test('activity renews from the last action, not login time or delayed heartbeat time', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: initialTime });
  const token = await auth.createStaffSession(env, user);
  const api = endpoint();
  t.mock.timers.setTime(initialTime + 110 * 60 * 1000);
  const response = await api.renew(token, 30000);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(payload(data.sessionToken).sid, payload(token).sid);
  assert.equal(data.session.lastActivityAt, Date.now() - 30000);
  assert.equal(data.session.expiresAt, Date.now() - 30000 + IDLE);
  t.mock.timers.setTime(initialTime + IDLE + 1);
  const req = new Request('https://example.test/api/admin', { headers: { Authorization: `Bearer ${data.sessionToken}` } });
  assert.equal((await auth.readStaffSession(env, req)).username, 'teacher');
  t.mock.timers.setTime(data.session.expiresAt);
  assert.equal(await auth.readStaffSession(env, req), null);
  assert.equal((await api.renew(data.sessionToken)).status, 401);
});

test('session reads do not renew, and malformed, revoked or disabled sessions cannot be renewed', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: initialTime });
  const token = await auth.createStaffSession(env, user);
  const api = endpoint();
  t.mock.timers.setTime(initialTime + 45 * 60 * 1000);
  const restored = await api.get(token);
  assert.equal(restored.headers.get('set-cookie'), null);
  assert.equal((await restored.json()).session.expiresAt, initialTime + IDLE);
  for (const age of [-1, '100', null, IDLE, IDLE + 1]) assert.equal((await api.renew(token, age)).status, 400);
  assert.equal((await api.renew('forged.invalid')).status, 401);
  assert.equal((await endpoint({ active: false }).renew(token)).status, 401);
  assert.equal((await endpoint({ externalExpired: true }).renew(token)).status, 401);
  assert.equal((await endpoint({ reader: async () => null }).renew(token)).status, 401);
});

function browser(options = {}) {
  let clock = initialTime, nextId = 0;
  const timers = new Map(), calls = [], expired = [], tokens = [], messages = [];
  let channel;
  const context = vm.createContext({ atob, BroadcastChannel: class {
    constructor() { channel = this; }
    postMessage(data) { messages.push(data); }
  } });
  vm.runInContext(clientSource, context);
  const session = context.DynamaxStaffIdleSession.create({
    now: () => clock, setTimer: (fn, ms) => { const id = ++nextId; timers.set(id, { at: clock + ms, fn }); return id; },
    clearTimer: id => timers.delete(id), onToken: token => tokens.push(token), onExpire: message => expired.push(message),
    renew: async age => {
      calls.push({ at: clock, age });
      if (options.renew) return options.renew(age);
      return { ok: true, status: 200, sessionToken: `fresh-${calls.length}`, session: {
        id: 'session-1', serverNow: clock, lastActivityAt: clock - age, expiresAt: clock - age + IDLE
      } };
    }
  });
  function start(username = 'teacher', id = 'session-1') {
    session.start({ username, session: { id, serverNow: clock, lastActivityAt: clock, expiresAt: clock + IDLE } });
  }
  const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  async function advance(ms) {
    const target = clock + ms;
    for (let steps = 0; steps < 500; steps++) {
      const entry = [...timers.entries()].filter(([, value]) => value.at <= target).sort((a,b) => a[1].at - b[1].at)[0];
      if (!entry) break;
      const [id, value] = entry;
      timers.delete(id); clock = value.at; value.fn(); await settle();
      assert.ok(steps < 499, 'timer must not spin');
    }
    clock = target; await settle();
  }
  start();
  return { session, start, advance, settle, calls, expired, tokens, messages, channel,
    now: () => clock, sleep: ms => { clock += ms; } };
}

test('activity at 110 minutes keeps the page open until two hours after that action', async () => {
  const b = browser();
  await b.advance(110 * 60 * 1000);
  b.session.activity({ isTrusted: true }); await b.settle();
  assert.equal(b.calls.length, 1);
  await b.advance(119 * 60 * 1000);
  assert.equal(b.expired.length, 0);
  await b.advance(60 * 1000);
  assert.equal(b.expired.length, 1);
  assert.equal(b.calls.length, 1, 'background timers must not renew an idle session');
});

test('polls, visibility checks and synthetic events cannot keep an unattended page signed in', async () => {
  const b = browser();
  for (let i = 0; i < 119; i++) {
    await b.advance(60 * 1000); b.session.check(); b.session.activity({ isTrusted: false });
  }
  await b.advance(60 * 1000);
  assert.equal(b.calls.length, 0);
  assert.equal(b.expired.length, 1);
});

test('typing is throttled, and the last keypress is flushed without adding idle time', async () => {
  const b = browser();
  for (let i = 0; i < 75; i++) { await b.advance(1000); b.session.activity({ isTrusted: true }); }
  await b.advance(45000);
  assert.equal(b.calls.length, 2);
  assert.equal(b.calls[1].age, 45000);
  await b.advance(IDLE - 45000);
  assert.equal(b.expired.length, 1);
});

test('a sleeping or offline tab never revives an expired session on its first click', async () => {
  const b = browser();
  b.sleep(IDLE + 1);
  b.session.activity({ isTrusted: true }); await b.settle();
  assert.equal(b.calls.length, 0);
  assert.equal(b.expired.length, 1);
});

test('transient failure retries the same activity; unauthorized renewal signs out', async () => {
  const b = browser({ renew: async () => { throw new Error('offline'); } });
  await b.advance(60000); b.session.activity({ isTrusted: true }); await b.settle();
  await b.advance(60000);
  assert.equal(b.calls.length, 2);
  assert.equal(b.calls[1].age, 60000);
  b.sleep(IDLE); b.session.check();
  assert.equal(b.expired.length, 1);
  const denied = browser({ renew: async () => ({ status: 401 }) });
  await denied.advance(60000); denied.session.activity({ isTrusted: true }); await denied.settle();
  assert.equal(denied.expired.length, 1);
});

test('an old renewal response cannot restore credentials after logout or a user switch', async () => {
  let resolve;
  const b = browser({ renew: () => new Promise(done => { resolve = done; }) });
  await b.advance(60000); b.session.activity({ isTrusted: true }); await b.settle();
  b.session.stop(); b.start('another', 'session-2');
  resolve({ ok: true, sessionToken: 'old-token', session: { id: 'session-1', serverNow: b.now(), lastActivityAt: b.now(), expiresAt: b.now() + IDLE } });
  await b.settle();
  assert.deepEqual(b.tokens, []);
});

test('same-session tabs share renewed credentials without accepting a different account or old token', async () => {
  const b = browser();
  await b.advance(60000);
  const session = { id: 'session-1', serverNow: b.now(), lastActivityAt: b.now(), expiresAt: b.now() + IDLE };
  b.channel.onmessage({ data: { type: 'renewed', id: 'session-2', username: 'teacher', session, sessionToken: 'wrong-session' } });
  b.channel.onmessage({ data: { type: 'renewed', id: 'session-1', username: 'teacher', session, sessionToken: 'new-token' } });
  b.channel.onmessage({ data: { type: 'renewed', id: 'session-1', username: 'teacher', session: { ...session, expiresAt: initialTime + IDLE }, sessionToken: 'old-token' } });
  assert.deepEqual(b.tokens, ['new-token']);
});

test('idle handling starts after authentication and stops on logout, without storing tokens or changing workspace scope', () => {
  assert.match(adminSource, /continueAfterAuthentication\(user\) \{\s*staffIdleSession.start/);
  assert.match(adminSource, /clearStaffWorkspaceState\(\) \{[\s\S]*?staffIdleSession.stop\(\)/);
  assert.doesNotMatch(clientSource, /localStorage|sessionStorage|indexedDB/);
  const scope = adminSource.slice(adminSource.indexOf('function staffWorkspaceReadScope()'), adminSource.indexOf('const staffWorkspaceReads'));
  assert.doesNotMatch(scope, /staffBearerToken/, 'routine token rotation must not abort academic reads');
});
