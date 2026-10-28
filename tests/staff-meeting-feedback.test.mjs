import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const sources = await Promise.all(['js/staff-action-feedback.js', 'js/staff-workspace-cache.js']
  .map(path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')));
const window = {};
vm.runInNewContext(sources.join('\n'), { window, Response, TextEncoder, DOMException });
const url = new URL('https://school.example/api/staff-meetings');
const post = action => ({ method: 'POST', body: JSON.stringify({ action }) });

test('meeting controls and reports remain quiet reads without evicting other loaded records', async () => {
  const cache = window.DynamaxWorkspaceCache.create({ context: () => ({ scope: 'main|staff' }) });
  const revision = cache.version();
  let calls = 0;
  for (const action of ['bootstrap', 'setup', 'list', 'report']) {
    assert.equal(window.DynamaxStaffActionFeedback.isMutation(url, post(action)), false, action);
    const policy = window.DynamaxWorkspaceCache.requestPolicy(url, post(action));
    assert.equal(policy.mutation, false, action);
    assert.equal(policy.cacheable, false, 'the meeting UI owns explicit refresh and date snapshots');
    for (let i = 0; i < 2; i++) await cache.fetch(url, post(action), async () => {
      calls++; return Response.json({ ok: true });
    });
    assert.equal(cache.version(), revision, action);
  }
  assert.equal(calls, 8, 'explicit refreshes reach the server');
});

test('meeting saves and clocking still invalidate stale records and report their outcomes', async () => {
  for (const action of ['save', 'clock', 'futureUnknownAction']) {
    assert.equal(window.DynamaxStaffActionFeedback.isMutation(url, post(action)), true, action);
    const cache = window.DynamaxWorkspaceCache.create({ context: () => ({ scope: 'main|staff' }) });
    const revision = cache.version();
    await cache.fetch(url, post(action), async () => Response.json({ ok: true }));
    assert.ok(cache.version() > revision, action);
  }
  assert.equal(window.DynamaxStaffActionFeedback.isMutation(new URL('https://school.example/api/staff-other'), post('setup')), true,
    'the exception must not suppress an unrelated setup mutation');
});
