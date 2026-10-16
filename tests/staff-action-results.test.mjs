import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../js/staff-action-feedback.js', import.meta.url), 'utf8');
function harness() {
  const alerts = [], listeners = {};
  const window = { DynamaxDialogs: { alert: async options => alerts.push(options) } };
  vm.runInNewContext(source, { window, document: { addEventListener: (name, fn) => { listeners[name] = fn; } }, queueMicrotask });
  return { api: window.DynamaxStaffActionFeedback, alerts, listeners };
}

test('staff mutations across modules get results; reads, previews and authentication challenges stay quiet', () => {
  const { api } = harness();
  const check = (path, action, method = 'POST') => api.isMutation(new URL(path, 'https://school.example'), { method, body: JSON.stringify({ action }) });
  for (const [path, action] of [['/api/staff-academics', 'saveAcademicStudentAttendance'], ['/api/staff-academics', 'moveAcademicStudentMembership'],
    ['/api/staff-library', 'lend'], ['/api/staff-procurement', 'createpurchase'], ['/api/staff-vendor-settlements', 'approve'],
    ['/api/finance-workflow', 'submit'], ['/api/staff-homework', 'sendHomework'], ['/api/staff-users', 'save'], ['/api/staff-cbt-paper', '']]) {
    assert.equal(check(path, action), true, `${path}: ${action}`);
  }
  for (const action of ['bootstrap', 'list', 'getAcademicScorebookContext', 'previewAcademicTermResults', 'lookup', 'search', 'prepareScoreSync', 'records', 'downloadAcademicCbtTestPackage']) {
    assert.equal(check('/api/staff-academics', action), false, action);
  }
  assert.equal(check('/api/staff-mfa', 'enroll'), false);
  assert.equal(check('/api/staff-users', 'list-security-audit'), false, 'audit paging never opens mutation-result popups');
  assert.equal(check('/api/staff-academics', 'list', 'GET'), false);
  for (const action of ['previewCardRefundBatch','approveCardRefundBatch','postCardRefundBatch'])
    assert.equal(check('/api/staff-vendor-settlements',action),false,'reviewed bulk refunds own a single completion/error dialogue');
});

test('only explicit server success is reported as success, with exact details and no consumed response body', async () => {
  const { api, alerts } = harness();
  const response = Response.json({ ok: true, message: 'Transfer request saved; approval is still required.' });
  await api.response(response);
  assert.equal(alerts[0].message, 'Transfer request saved; approval is still required.');
  assert.equal((await response.json()).ok, true);
  await api.response(Response.json({ ok: false, message: 'Core subject required.', issues: ['Choose a Core subject.'] }, { status: 409 }));
  assert.equal(alerts[1].tone, 'danger');
  assert.deepEqual(alerts[1].items, ['Choose a Core subject.']);
  await api.response(new Response('<html>Temporary outage</html>', { status: 502 }));
  assert.match(alerts[2].message, /may have saved/);
  assert.equal(alerts[2].title, 'Check the outcome before retrying');
});

test('client validation errors are visible and background success messages do not open dialogs', () => {
  const { api, alerts } = harness();
  api.inline('Records loaded', 'ok');
  assert.equal(alerts.length, 0);
  api.inline('Select a Trade subject', 'bad');
  assert.equal(alerts[0].message, 'Select a Trade subject');
  api.begin(); api.inline('Offline draft saved', 'ok'); api.end();
  assert.equal(alerts[1].message, 'Offline draft saved');
});

test('staff feedback leaves form validation to the shared dialogue component', () => {
  assert.equal(harness().listeners.invalid, undefined);
});
