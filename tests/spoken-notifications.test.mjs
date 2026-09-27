import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../js/spoken-notifications.js', import.meta.url), 'utf8');
function harness(saved = new Map()) {
  const events = new Map();
  const spoken = [];
  const timers = [];
  const document = { visibilityState: 'visible', querySelector: () => null, addEventListener: (name, fn) => events.set(name, fn) };
  const window = {
    setTimeout: (fn) => timers.push(fn),
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    speechSynthesis: { speaking: false, cancel() {}, speak(utterance) { spoken.push(utterance.text); utterance.onstart?.(); utterance.onend?.(); } }
  };
  vm.runInNewContext(source, { window, document, navigator: { language: 'en', locks: { request: (_key, fn) => fn() } },
    localStorage: { getItem: (key) => saved.get(key), setItem: (key, value) => saved.set(key, value) } });
  const api = window.DynamaxSpokenNotifications;
  api.configure({ recipientKey: 'accounts', branchId: 'main', quietHoursActive: false });
  return { api, spoken, document, events, timers, saved, window };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
const requisition = (overrides = {}) => ({ NotificationId: 'REQ-1-approved', Category: 'Requisitions', BranchId: 'main', CreatedAt: new Date().toISOString(), Title: 'Requisition approved', Message: 'Ready for accounts.', ...overrides });

test('requisition reads words after user interaction and only once across reloads', async () => {
  const h = harness();
  assert.equal(h.api.announce(requisition()), true);
  assert.equal(h.spoken.length, 0);
  h.events.get('pointerdown')();
  await flush();
  assert.deepEqual(h.spoken, ['Requisition approved. Ready for accounts.']);
  assert.equal(h.api.announce(requisition()), false);
  const reloaded = harness(h.saved);
  reloaded.events.get('pointerdown')();
  assert.equal(reloaded.api.announce(requisition()), false);
  assert.equal(reloaded.spoken.length, 0);
});

test('push presence and dashboard presence share a due-event deduplication key', async () => {
  const h = harness();
  h.events.get('pointerdown')();
  const presence = { Type: 'Presence confirmation', DueDate: new Date().toISOString(), Title: 'Presence check', Message: 'Confirm now.' };
  h.api.announce(presence);
  await flush();
  assert.equal(h.api.announce({ ...presence, NotificationId: 'server-id', BranchId: 'main' }), false);
  assert.equal(h.spoken.length, 1);
});

test('speech respects quiet hours, mute, expiry, read state, scope and old history', async () => {
  const h = harness();
  h.events.get('pointerdown')();
  for (const row of [requisition({ Read: true }), requisition({ Archived: true }), requisition({ BranchId: 'west' }), requisition({ ExpiresAt: '2000-01-01' }), requisition({ CreatedAt: '2000-01-01' }), requisition({ Category: 'Payments' })]) {
    assert.equal(h.api.announce(row), false);
  }
  h.api.configure({ recipientKey: 'accounts', branchId: 'main', quietHoursActive: true });
  assert.equal(h.api.announce(requisition()), false);
  h.api.configure({ recipientKey: 'accounts', branchId: 'main', quietHoursActive: false });
  h.api.setEnabled(false);
  assert.equal(h.api.announce(requisition()), false);
  h.api.configure(null);
  assert.equal(h.api.announce(requisition()), false);
  await flush();
  assert.equal(h.spoken.length, 0);
});

test('hidden pages wait and account switches discard queued private messages', async () => {
  const h = harness();
  h.document.visibilityState = 'hidden';
  h.events.get('pointerdown')();
  h.api.announce(requisition());
  await flush();
  assert.equal(h.spoken.length, 0);
  h.api.configure({ recipientKey: 'director', branchId: 'main', quietHoursActive: false });
  h.document.visibilityState = 'visible';
  h.events.get('visibilitychange')();
  await flush();
  assert.equal(h.spoken.length, 0);
});

test('camera guidance is not interrupted by notification speech', async () => {
  const h = harness();
  h.document.querySelector = () => ({});
  h.events.get('pointerdown')();
  h.api.announce(requisition());
  await flush();
  assert.equal(h.spoken.length, 0);
  h.document.querySelector = () => null;
  h.timers.shift()();
  await flush();
  assert.equal(h.spoken.length, 1);
});

test('service-worker push displays an audible alert and informs open pages even after reload', async () => {
  const listeners = new Map();
  const shown = [];
  const messages = [];
  const self = {
    addEventListener: (name, fn) => listeners.set(name, fn),
    clients: { matchAll: async () => [{ postMessage: (message) => messages.push(message) }] },
    registration: { getNotifications: async () => [], showNotification: async (title, options) => shown.push({ title, options }) }
  };
  vm.runInNewContext(await readFile(new URL('../sw.js', import.meta.url), 'utf8'), { self });
  let work;
  const payload = { notification: { title: 'Requisition confirmed' }, data: { notificationId: 'N-1', actionUrl: 'admin.html?section=financeRequests' } };
  listeners.get('push')({ data: { json: () => payload }, waitUntil: (promise) => { work = promise; } });
  await work;
  assert.equal(shown[0].options.silent, false);
  assert.equal(messages[0].type, 'dynamax:push-notification');
  assert.equal(messages[0].payload, payload);
  payload.data.expiresAt = '2000-01-01';
  listeners.get('push')({ data: { json: () => payload }, waitUntil: (promise) => { work = promise; } });
  await work;
  assert.equal(shown.length, 1, 'expired presence pushes must not ring late');
});
