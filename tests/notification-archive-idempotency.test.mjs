import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { archiveNotification, markNotificationRead, notificationReadDocumentId } from '../functions/lib/notifications.js';
import { prepareSecurityAudit } from '../functions/lib/security-audit.js';

const [staffSource, parentSource, staffApiSource, parentApiSource, auditSource, middlewareSource] = await Promise.all([
  readFile(new URL('../js/notifications.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/parent-dashboard.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/api/staff-notifications.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/api/parent-dashboard.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/lib/security-audit.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/_middleware.js', import.meta.url), 'utf8')
]);

function memoryStore(initial = null) {
  let state = initial ? { __updateTime: 'version-0', ...initial } : null;
  let writes = 0;
  const options = {
    now: '2026-10-08T10:00:00.000Z',
    getDocument: async (_env, collection) => collection === 'notifications'
      ? { NotificationId: 'N1' } : state ? { ...state } : null,
    upsertDocument: async (_env, collection, id, document, precondition) => {
      assert.equal(collection, 'notificationReads');
      assert.equal(id, notificationReadDocumentId('N1', 'recipient'));
      if (state ? precondition.updateTime !== state.__updateTime : precondition.exists !== false) {
        throw Object.assign(new Error('Write conflict'), { status: 409 });
      }
      state = { ...document, __updateTime: `version-${++writes}` };
      assert.equal('changed' in document, false);
    }
  };
  return { options, get state() { return state; }, get writes() { return writes; } };
}

test('repeat archive requests write once and preserve original archive/read timestamps', async () => {
  const store = memoryStore();
  const first = await archiveNotification({}, 'N1', 'Recipient', true, store.options);
  const again = await archiveNotification({}, 'N1', 'recipient', true,
    { ...store.options, now: '2026-10-08T11:00:00.000Z' });
  assert.equal(first.changed, true);
  assert.equal(again.changed, false);
  assert.equal(store.writes, 1);
  assert.equal(again.ArchivedAt, first.ArchivedAt);
  assert.equal(again.ReadAt, first.ReadAt);
});

test('restore is a separate real change; repeat restore and already-unarchived requests do not write', async () => {
  const store = memoryStore({ NotificationId: 'N1', RecipientKey: 'recipient',
    ReadAt: '2026-10-07T00:00:00Z', ArchivedAt: '2026-10-07T01:00:00Z', OtherState: 'keep' });
  const restored = await archiveNotification({}, 'N1', 'recipient', false, store.options);
  assert.equal(restored.changed, true);
  assert.equal(restored.ArchivedAt, '');
  assert.equal(restored.ReadAt, '2026-10-07T00:00:00Z');
  assert.equal(restored.OtherState, 'keep');
  assert.equal((await archiveNotification({}, 'N1', 'recipient', false, store.options)).changed, false);
  assert.equal(store.writes, 1);
  const absent = memoryStore();
  assert.equal((await archiveNotification({}, 'N1', 'recipient', false, absent.options)).changed, false);
  assert.equal(absent.writes, 0);
});

for (const initial of [null, { NotificationId: 'N1', RecipientKey: 'recipient', ReadAt: 'keep-read' }]) {
  test(`simultaneous archive requests for ${initial ? 'existing' : 'absent'} state change it only once`, async () => {
    const store = memoryStore(initial);
    let readers = 0;
    let release;
    const ready = new Promise((resolve) => { release = resolve; });
    const options = { ...store.options, getDocument: async (...args) => {
      const snapshot = await store.options.getDocument(...args);
      if (args[1] === 'notificationReads' && ++readers <= 2) {
        if (readers === 2) release();
        await ready;
      }
      return snapshot;
    } };
    const results = await Promise.all([
      archiveNotification({}, 'N1', 'recipient', true, options),
      archiveNotification({}, 'N1', 'recipient', true, options)
    ]);
    assert.deepEqual(results.map((row) => row.changed).sort(), [false, true]);
    assert.equal(store.writes, 1);
  });
}

test('archive does not overwrite unread-state read errors or missing document versions', async () => {
  let writes = 0;
  await assert.rejects(archiveNotification({}, 'N1', 'recipient', true, {
    getDocument: async (_env, collection) => {
      if (collection === 'notifications') return { NotificationId: 'N1' };
      throw new Error('Backend unavailable');
    }, upsertDocument: async () => { writes += 1; }
  }), /Backend unavailable/);
  await assert.rejects(archiveNotification({}, 'N1', 'recipient', true, {
    getDocument: async (_env, collection) => collection === 'notifications'
      ? { NotificationId: 'N1' } : { ReadAt: 'existing' },
    upsertDocument: async () => { writes += 1; }
  }), { status: 428 });
  assert.equal(writes, 0);
});

test('contention is bounded and unavailable or missing notifications still fail', async () => {
  let attempts = 0;
  const store = memoryStore();
  await assert.rejects(archiveNotification({}, 'N1', 'recipient', true, {
    ...store.options, upsertDocument: async () => {
      attempts += 1;
      throw Object.assign(new Error('Conflict'), { status: 409 });
    }
  }), { status: 409 });
  assert.equal(attempts, 3);
  await assert.rejects(archiveNotification({}, 'N1', 'recipient', true, {
    getDocument: async () => null
  }), { status: 404 });
});

test('marking read touches only read fields and cannot restore an archived notification', async () => {
  const state = { ArchivedAt: '2026-10-08T09:00:00Z', OtherState: 'keep' };
  await markNotificationRead({}, 'N1', 'recipient', {
    getDocument: async () => ({ NotificationId: 'N1' }),
    now: '2026-10-08T10:00:00Z',
    patchDocumentFields: async (_env, _collection, _id, fields) => {
      assert.deepEqual(Object.keys(fields).sort(), ['NotificationId', 'ReadAt', 'RecipientKey']);
      Object.assign(state, fields);
    }
  });
  assert.equal(state.ArchivedAt, '2026-10-08T09:00:00Z');
  assert.equal(state.OtherState, 'keep');
  assert.equal(state.ReadAt, '2026-10-08T10:00:00Z');
});

test('archive after a restore is a new legitimate state change, not a suppressed retry', async () => {
  const store = memoryStore();
  for (const archived of [true, false, true]) {
    assert.equal((await archiveNotification({}, 'N1', 'recipient', archived, store.options)).changed, true);
  }
  assert.equal(store.writes, 3);
});

test('notification audit metadata identifies the record without logging credentials', async () => {
  for (const [pathname, action, key] of [
    ['/api/staff-notifications', 'archive', 'notificationId'],
    ['/api/parent-dashboard', 'archiveNotification', 'NotificationId']
  ]) {
    const prepared = await prepareSecurityAudit(new Request(`https://example.test${pathname}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, [key]: 'N1', password: 'do-not-log', code: 'secret-code', securityAuditNoChange: true })
    }), pathname);
    assert.equal(prepared.subject, 'N1');
    assert.equal(prepared.entityId, 'N1');
    assert.doesNotMatch(JSON.stringify(prepared), /do-not-log|secret-code|securityAuditNoChange/);
  }
});

test('only attested successful archive/restore no-ops skip new audit rows, not errors or other operations', async () => {
  const start = auditSource.indexOf('export async function persistRequestSecurityAudit(');
  const end = auditSource.indexOf('\nfunction sourceDateRange', start);
  const writes = [];
  const context = vm.createContext({
    clean: (value) => String(value ?? '').trim(), lower: (value) => String(value ?? '').trim().toLowerCase(),
    titleWords: (value) => String(value ?? '').trim().toUpperCase(),
    shouldPersistSecurityAudit: () => true,
    readStaffSession: async () => ({ username: 'recipient', role: 'Admin' }),
    securityAuditOutcome: (status) => status === 403 ? 'Denied' : status >= 400 ? 'Failed' : 'Success',
    securityAuditModuleForRoute: () => 'Notifications',
    writeSecurityAudit: async (_env, event) => { writes.push(event); return event; }
  });
  vm.runInContext(auditSource.slice(start, end).replace('export ', ''), context);
  const prepared = { pathname: '/api/staff-notifications', method: 'POST', action: 'ARCHIVE NOTIFICATION', entityId: 'N1' };
  const run = (extra = {}) => context.persistRequestSecurityAudit({ prepared, response: { status: 200 }, auditNoChange: true, ...extra });
  assert.equal(await run(), null);
  assert.equal(await run({ authoritativeAction: 'RESTORE NOTIFICATION' }), null);
  assert.equal(await run({ prepared: { ...prepared, pathname: '/api/parent-dashboard' } }), null);
  assert.equal(writes.length, 0);
  for (const extra of [{ auditNoChange: false }, { response: { status: 403 } }, { response: { status: 500 } },
    { prepared: { ...prepared, pathname: '/api/accounting' } }, { authoritativeAction: 'SAVE SETTINGS' }]) await run(extra);
  assert.equal(writes.length, 5);
  assert.equal(writes[1].outcome, 'Denied');
  assert.equal(writes[2].outcome, 'Failed');
  assert.match(middlewareSource, /auditNoChange: context\.data\?\.securityAuditNoChange/);
});

function staffArchiveContext(update) {
  const statusNodes = [];
  const button = { disabled: false };
  const item = { dataset: { notificationId: 'N1' }, querySelector: () => null,
    appendChild: (node) => statusNodes.push(node) };
  const event = { target: { closest: (selector) => selector === '[data-notification-id]' ? item
    : selector === '[data-delete-notification]' ? button : null } };
  const context = vm.createContext({ loadGeneration: 0, pendingArchiveActions: new Set(), update,
    loadHistory: async () => {}, document: { createElement: () => ({ setAttribute: () => {} }) } });
  const start = staffSource.indexOf('  async function handleNotificationClick(');
  const end = staffSource.indexOf('\n  list.addEventListener', start);
  vm.runInContext(staffSource.slice(start, end), context);
  return { context, event, button, statusNodes };
}

test('staff tray blocks double-clicks and unlocks after completion or failure', async () => {
  let calls = 0;
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const ui = staffArchiveContext(async () => { calls += 1; await pending; });
  const first = ui.context.handleNotificationClick(ui.event, []);
  assert.equal(ui.button.disabled, true);
  await ui.context.handleNotificationClick(ui.event, []);
  assert.equal(calls, 1);
  finish();
  await first;
  assert.equal(ui.button.disabled, false);
  const failed = staffArchiveContext(async () => { throw new Error('Try again'); });
  await failed.context.handleNotificationClick(failed.event, []);
  assert.equal(failed.button.disabled, false);
  assert.equal(failed.context.pendingArchiveActions.size, 0);
  assert.equal(failed.statusNodes[0].textContent, 'Try again');
});

test('parent tray/history share one pending guard and unlock on error', async () => {
  let calls = 0;
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const context = vm.createContext({ parentNotificationRequest: async () => { calls += 1; await pending; return {}; } });
  const start = parentSource.indexOf('const pendingParentArchiveActions = new Set();');
  const end = parentSource.indexOf('\nasync function parentNotificationRequest', start);
  vm.runInContext(parentSource.slice(start, end), context);
  const firstButton = { disabled: false }, otherButton = { disabled: false };
  const first = context.runParentNotificationArchive('N1', firstButton, 'archiveNotification', () => {});
  assert.equal(firstButton.disabled, true);
  await context.runParentNotificationArchive('N1', otherButton, 'archiveNotification', () => {});
  assert.equal(calls, 1);
  finish();
  await first;
  assert.equal(firstButton.disabled, false);
  context.parentNotificationRequest = async () => { throw new Error('Try again'); };
  await assert.rejects(context.runParentNotificationArchive('N1', firstButton, 'archiveNotification', () => {}), /Try again/);
  assert.equal(firstButton.disabled, false);
  assert.equal(vm.runInContext('pendingParentArchiveActions.size', context), 0);
  assert.equal((parentSource.match(/await runParentNotificationArchive\(/g) || []).length, 2);
});

test('shared staff archive handler retains recipient targeting for each edition', async () => {
  const source = staffApiSource.replace(/import[\s\S]*?from '[^']+';\s*/g, '').replace(/export /g, '');
  for (const edition of ['school', 'faith', 'hotel']) {
    let calls = 0;
    let allowed = true;
    const context = vm.createContext({ Response, URL,
      requireStaffSession: async () => ({ username: 'recipient', role: 'Admin', edition }),
      readJsonBody: async () => ({ action: 'archive', notificationId: 'N1', securityAuditNoChange: true }),
      getDocument: async () => ({ NotificationId: 'N1' }),
      notificationTargetsRecipient: () => allowed,
      archiveNotification: async () => { calls += 1; return { changed: calls === 1 }; }
    });
    vm.runInContext(source, context);
    vm.runInContext('responseData = async () => ({ notifications: [] });', context);
    const requestContext = { env: {}, request: {}, data: {} };
    assert.equal((await context.onRequestPost(requestContext)).status, 200);
    assert.equal(requestContext.data.securityAuditNoChange, false);
    assert.match(requestContext.data.securityAuditDetails, /Notification: N1/);
    assert.equal((await context.onRequestPost(requestContext)).status, 200);
    assert.equal(requestContext.data.securityAuditNoChange, true);
    allowed = false;
    const deniedContext = { env: {}, request: {}, data: {} };
    assert.equal((await context.onRequestPost(deniedContext)).status, 404);
    assert.equal(calls, 2);
    assert.equal(deniedContext.data.securityAuditNoChange, undefined);
  }
});

test('parent archive handler attests no-ops only after authenticated recipient targeting', async () => {
  let allowed = true;
  let changed = false;
  let calls = 0;
  const context = vm.createContext({
    clean: (value) => String(value ?? '').trim(), lower: (value) => String(value ?? '').trim().toLowerCase(),
    getParentNotificationContext: async () => ({ email: 'parent@example.test', recipient: {} }),
    getDocument: async () => ({ NotificationId: 'N1' }), notificationTargetsRecipient: () => allowed,
    archiveNotification: async () => { calls += 1; return { changed }; },
    markNotificationRead: async () => {}, parentNotificationResponse: async () => ({ ok: true })
  });
  const start = parentApiSource.indexOf('async function updateParentNotificationState(');
  const end = parentApiSource.indexOf('\nasync function updateParentNotificationConfiguration', start);
  vm.runInContext(parentApiSource.slice(start, end), context);
  const body = { action: 'archiveNotification', notificationId: 'N1', securityAuditNoChange: true };
  const requestContext = { data: {} };
  await context.updateParentNotificationState({}, body, requestContext);
  assert.equal(requestContext.data.securityAuditNoChange, true);
  changed = true;
  await context.updateParentNotificationState({}, body, requestContext);
  assert.equal(requestContext.data.securityAuditNoChange, false);
  allowed = false;
  await assert.rejects(context.updateParentNotificationState({}, body, { data: {} }), { status: 404 });
  assert.equal(calls, 2);
  assert.equal((parentApiSource.match(/updateParentNotificationState\(env, body, context\)/g) || []).length, 2);
});
