import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const helper = source.slice(source.indexOf('function personalParentOnboardingUrl('), source.indexOf('function showPersonalParentLinkForManualCopy('));
const binding = source.slice(source.indexOf("  panelEl.querySelectorAll('[data-parent-onboarding-student]')"),
  source.indexOf("  document.getElementById('studentProfileForm')?.addEventListener"));
const origin = 'https://school.example';
const expected = { admissionNo: 'DCA/26/001', scopePath: 'schoolBranches/area-1-primary/sections/primary/students', documentId: 'DCA-26-001' };
const claims = { ...expected, purpose: 'parent-onboarding', exp: Math.floor(Date.now() / 1000) + 3600 };
function response(changes = {}) {
  const token = `${Buffer.from(JSON.stringify({ ...claims, ...changes })).toString('base64url')}.syntheticSignature`;
  return { ok: true, admissionNo: expected.admissionNo, branchName: 'Area 1 Primary', schoolSection: 'primary',
    onboardingPath: `/parent-dashboard#${new URLSearchParams({ onboarding: '1', admission: expected.admissionNo, access: token })}` };
}
const globals = { URL, URLSearchParams, TextDecoder, Uint8Array, atob, Date,
  clean: value => String(value ?? '').trim(), window: { location: { origin } } };
const validate = vm.runInNewContext(`${helper}; personalParentOnboardingUrl`, globals);

test('the returned personal link matches the exact selected learner, not only admission number', () => {
  const result = response();
  assert.equal(validate(result, expected), new URL(result.onboardingPath, origin).href);
  for (const changed of [{ scopePath: 'schoolBranches/main/sections/primary/students' }, { documentId: 'another-student' },
    { admissionNo: 'DCA/26/002' }, { purpose: 'parent-session' }, { exp: Math.floor(Date.now() / 1000) - 1 }]) {
    assert.throws(() => validate(response(changed), expected), /did not return a personal link/);
  }
});

test('shared pages, old passwords, missing proofs and foreign origins cannot be copied as issued links', () => {
  const valid = response();
  for (const change of [{ onboardingPath: '' }, { onboardingPath: '/parent-dashboard#onboarding=1' },
    { onboardingPath: `/parent-dashboard#onboarding=1&admission=${encodeURIComponent(expected.admissionNo)}&access=12345678` },
    { onboardingPath: `https://elsewhere.example${valid.onboardingPath}` },
    { onboardingPath: valid.onboardingPath.replace('/parent-dashboard', '/admin') },
    { admissionNo: 'DCA/26/002' }]) {
    assert.throws(() => validate({ ...valid, ...change }, expected), /did not return a personal link/);
  }
});

function handlerFixture(data, { clipboardFails = false } = {}) {
  let click;
  const calls = [], copies = [], manual = [], statuses = [];
  const button = { isConnected: true, dataset: { parentOnboardingStudent: expected.admissionNo,
    parentOnboardingScope: expected.scopePath, parentOnboardingId: expected.documentId },
    addEventListener: (_name, callback) => { click = callback; } };
  const context = { ...globals, selectedBranchId: 'area-1-primary', currentUser: { branchId: 'area-1-primary' },
    panelEl: { querySelectorAll: () => [button] }, dashboardStatus: {},
    setButtonLoading: (_button, loading) => { button.disabled = loading; },
    setStatus: (_target, message, status) => { statuses.push({ message, status }); },
    staffFetch: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, json: async () => data }; },
    copyTextToClipboard: async url => { copies.push(url); if (clipboardFails) throw Error('Clipboard denied'); },
    showPersonalParentLinkForManualCopy: (url, admission) => { manual.push({ url, admission }); }
  };
  vm.runInNewContext(helper + binding, context);
  return { run: () => click(), calls, copies, manual, statuses, button };
}

test('clipboard refusal preserves the issued scoped link for manual copy without another reissue', async () => {
  const data = response(), fixture = handlerFixture(data, { clipboardFails: true });
  await fixture.run();
  assert.deepEqual(fixture.calls, [{ url: '/api/staff-students', body: { action: 'reissueParentOnboarding',
    AccountRef: expected.admissionNo, ScopePath: expected.scopePath, DocumentId: expected.documentId } }]);
  assert.equal(fixture.copies.length, 1);
  assert.deepEqual(fixture.manual, [{ url: new URL(data.onboardingPath, origin).href, admission: expected.admissionNo }]);
  assert.equal(fixture.button.disabled, false);
  assert.equal(fixture.statuses.at(-1).status, 'ok');
});

test('invalid successful responses are reported without copying a shared or different learner link', async () => {
  const fixture = handlerFixture({ ...response(), onboardingPath: '/parent-dashboard#onboarding=1' });
  await fixture.run();
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.copies.length, 0);
  assert.equal(fixture.manual.length, 0);
  assert.equal(fixture.statuses.at(-1).status, 'bad');
  assert.equal(fixture.button.disabled, false);
});
