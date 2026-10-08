import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { studentMaintenanceRequest, saveStudentProfileDefaults, reviewAllStudentBilling } from '../js/student-maintenance.js';

test('no missing defaults completes clearly without any save request', async () => {
  const calls = [];
  const result = await saveStudentProfileDefaults(async (url, body) => { calls.push([url, body]); return { remaining: 0 }; });
  assert.deepEqual(result, { updated: 0 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].action, 'previewProfileDefaults');
});

test('defaults save is batched, reports progress, and uses a fresh preview token for each save', async () => {
  const calls = [], progress = [], replies = [
    { remaining: 105, previewToken: 'first' }, { updated: 100, remaining: 5 },
    { remaining: 5, previewToken: 'second' }, { updated: 5, remaining: 0 }
  ];
  const result = await saveStudentProfileDefaults(async (url, body) => { calls.push(body); return replies.shift(); }, (row) => progress.push(row));
  assert.deepEqual(result, { updated: 105 });
  assert.deepEqual(calls.filter((row) => row.action === 'applyProfileDefaults').map((row) => row.PreviewToken), ['first', 'second']);
  assert.deepEqual(progress.at(-1), { updated: 105, remaining: 0 });
  assert.equal(replies.length, 0);
});

test('a failed save is not retried and retains the confirmed saved count', async () => {
  let index = 0;
  await assert.rejects(saveStudentProfileDefaults(async () => {
    index += 1;
    if (index === 4) throw new Error('Lost save response. Recheck defaults.');
    return index === 2 ? { updated: 100, remaining: 5 } : { remaining: 105, previewToken: 'token' };
  }), (error) => error.updated === 100 && /Lost save response/.test(error.message));
  assert.equal(index, 4);
});

test('stalled or malformed defaults responses stop instead of looping forever', async () => {
  for (const result of [{ updated: 0, remaining: 10 }, { updated: 1 }, { updated: -1, remaining: 1 }]) {
    let calls = 0;
    await assert.rejects(saveStudentProfileDefaults(async () => ++calls === 1 ? { remaining: 10 } : result), /save could not be confirmed/);
    assert.equal(calls, 2);
  }
});

function roster(count = 23) {
  return { ok: true, readOnly: true, total: count + 1, incomplete: 1, matched: 0, rows: [], configurationToken: 'config',
    pendingProfiles: Array.from({ length: count }, (_, index) => ({ AccountRef: `TEST/${index}`, revision: `revision-${index}` })) };
}

test('large school billing review uses bounded read-only batches and returns only a complete report', async () => {
  const calls = [], progress = [], first = roster(1126);
  const result = await reviewAllStudentBilling(async (url, body) => {
    calls.push(body);
    assert.equal(url, '/api/student-billing-reconciliation');
    if (body.action === 'previewAll') { assert.equal(body.paged, true); return first; }
    assert.equal(body.action, 'previewBatch');
    assert.ok(body.Profiles.length <= 10);
    assert.equal(body.ConfigurationToken, 'config');
    return { checked: body.Profiles.length, matched: body.Profiles.length, rows: [] };
  }, (row) => progress.push(row));
  assert.equal(result.matched, 1126);
  assert.equal(result.total, 1127);
  assert.equal(result.ready, 0);
  assert.equal(calls.length, 114);
  assert.deepEqual(progress.at(-1), { checked: 1127, total: 1127 });
  assert.ok(calls.every((row) => row.action.startsWith('preview')));
});

test('failed or truncated billing batch never returns a partial report', async () => {
  for (const response of ['failure', { checked: 10, matched: 9, rows: [] }]) {
    let calls = 0;
    await assert.rejects(reviewAllStudentBilling(async () => {
      if (++calls === 1) return roster();
      if (response === 'failure') throw new Error('Database read failed.');
      return response;
    }), /Database read failed|batch was incomplete/);
    assert.equal(calls, 2);
  }
});

test('ambiguous, incomplete and conflicting accounts are counted without posting', async () => {
  const initial = roster(2);
  initial.total += 1;
  initial.rows.push({ profile: { AccountRef: 'AMBIGUOUS' }, ready: false, reason: 'Ambiguous identity.' });
  const report = await reviewAllStudentBilling(async (_url, body) => body.action === 'previewAll' ? initial : {
    checked: 2, matched: 0, rows: [{ profile: { AccountRef: 'TEST/0' }, ready: true, difference: 100 },
      { profile: { AccountRef: 'TEST/1' }, ready: false, reason: 'Duplicate invoice.' }]
  });
  assert.equal(report.ready, 1);
  assert.equal(report.review, 2);
  assert.equal(report.incomplete, 1);
});

test('incomplete or duplicate roster cannot produce posting controls', async () => {
  const first = roster(2);
  first.pendingProfiles[1].AccountRef = first.pendingProfiles[0].AccountRef;
  await assert.rejects(reviewAllStudentBilling(async () => first), /roster was incomplete/);
  await assert.rejects(reviewAllStudentBilling(async () => ({ ...roster(), total: 0 })), /roster was incomplete/);
});

test('maintenance requests reject changed branch/session before sending or accepting data', async () => {
  let current = false, calls = 0;
  const request = studentMaintenanceRequest(async () => { calls += 1; current = false; return Response.json({ ok: true }); }, { isCurrent: () => current });
  await assert.rejects(request('/api/test', { action: 'previewAll' }), /branch or signed-in user changed/);
  assert.equal(calls, 0);
  current = true;
  await assert.rejects(request('/api/test', { action: 'previewAll' }), /branch or signed-in user changed/);
  assert.equal(calls, 1);
});

test('server errors and invalid responses are surfaced without automatic retries', async () => {
  for (const response of [Response.json({ ok: false, message: 'Profiles changed after preview.' }, { status: 409 }),
    new Response('<html>timeout</html>', { status: 504 })]) {
    let calls = 0;
    const request = studentMaintenanceRequest(async () => { calls += 1; return response; });
    await assert.rejects(request('/api/test', { action: 'applyProfileDefaults' }), /Profiles changed|valid response/);
    assert.equal(calls, 1);
  }
});

test('a branch change while decoding the response cannot accept stale results', async () => {
  let current = true;
  const request = studentMaintenanceRequest(async () => ({ ok: true,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => { current = false; return { ok: true }; }
  }), { isCurrent: () => current });
  await assert.rejects(request('/api/test', { action: 'previewAll' }), /branch or signed-in user changed/);
});

test('timeouts stop the spinner and explain uncertain default saves without re-posting', async () => {
  let calls = 0;
  const request = studentMaintenanceRequest(async (_url, { signal }) => {
    calls += 1;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
  }, { timeoutMs: 5 });
  await assert.rejects(request('/api/test', { action: 'applyProfileDefaults' }), /Some defaults may already be saved/);
  await assert.rejects(request('/api/test', { action: 'previewAll' }), /read-only check stopped/);
  assert.equal(calls, 2);
});

test('closing the review or ending the session cancels outstanding read requests', async () => {
  for (const key of ['signal', 'sessionSignal']) {
    const controller = new AbortController();
    const request = studentMaintenanceRequest(async (_url, { signal }) => new Promise((_resolve, reject) =>
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })), { [key]: controller.signal });
    const pending = request('/api/test', { action: 'previewBatch' });
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
  }
});

test('both real toolbar handlers guard duplicate clicks, show local feedback, and always clear loading', async () => {
  const admin = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
  const defaults = admin.slice(admin.indexOf("  panelEl.querySelector('[data-save-student-profile-defaults]')"), admin.indexOf("  document.querySelector('[data-close-billing-preview]')"));
  const billing = admin.slice(admin.indexOf("  panelEl.querySelector('[data-review-all-student-billing]')"), admin.indexOf("  document.querySelector('[data-student-billing-preview]')"));
  for (const handler of [defaults, billing]) {
    assert.match(handler, /button.disabled \|\| button.getAttribute\('aria-busy'\) === 'true'/);
    assert.match(handler, /setStatus\(maintenanceStatus/);
    assert.match(handler, /finally[\s\S]*setButtonLoading\(button, false/);
    assert.match(handler, /currentUser === user && selectedBranchId === branch && button.isConnected/);
  }
  assert.ok(billing.indexOf('dialog.showModal()') < billing.indexOf('await reviewAllStudentBilling'));
  assert.match(billing, /data-billing-review-progress/);
  assert.match(billing, /!currentUser\?\.subscriptionReadOnly/);
  assert.match(defaults, /No missing profile defaults were found/);
  assert.match(admin, /role="status" aria-live="polite" data-student-maintenance-status/);
});
