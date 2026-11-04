import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const helper = source.slice(source.indexOf('function branchParentOnboardingMessage('), source.indexOf('function openBranchParentOnboardingDialog('));
const origin = 'https://school.example';
const branch = 'area-1-primary';
const expiry = Date.now() + 3600000;
function fixture(payload = {}, changes = {}) {
  const token = `${Buffer.from(JSON.stringify({ purpose: 'parent-branch-onboarding', branchId: branch,
    exp: Math.floor(expiry / 1000), ...payload })).toString('base64url')}.testSignature`;
  return { ok: true, branchId: branch, branchName: 'Area 1 Primary', schoolSections: ['primary'],
    setupCode: '42893671', expiresAt: new Date(expiry).toISOString(),
    onboardingPath: `/parent-dashboard#onboarding=1&branchAccess=${token}`, ...changes };
}
const makeMessage = vm.runInNewContext(`${helper}; branchParentOnboardingMessage`, {
  URL, URLSearchParams, TextDecoder, Uint8Array, atob, Date, Intl,
  clean: value => String(value ?? '').trim(), window: { location: { origin } }
});

test('branch message contains the actual signed link, separate code, branch and one-use-per-learner instructions', () => {
  const data = fixture(), message = makeMessage(data, branch);
  assert.ok(message.includes(origin + data.onboardingPath));
  assert.ok(message.includes('Setup code: 42893671'));
  assert.ok(message.includes('Area 1 Primary'));
  assert.ok(message.includes('Nursery / Primary'));
  assert.match(message, /once for each unfinished learner profile/);
  assert.match(message, /private password/);
  assert.match(message, /WAT/);
});

test('staff will not copy a foreign-origin, different-branch, personal, generic or expired response', () => {
  const invalid = [
    fixture({ branchId: 'main' }), fixture({ purpose: 'parent-onboarding' }),
    fixture({ exp: 1 }), fixture({}, { branchId: 'main' }), fixture({}, { setupCode: '' }),
    fixture({}, { expiresAt: '2020-01-01' }), fixture({}, { onboardingPath: '/parent-dashboard#onboarding=1' }),
    fixture({}, { onboardingPath: 'https://other.example' + fixture().onboardingPath }),
    fixture({}, { onboardingPath: fixture().onboardingPath + '&access=personal-proof' })
  ];
  for (const data of invalid) assert.throws(() => makeMessage(data, branch), /did not return a setup link for this branch/);
});

test('staff issuance is explicit and copying the issued message cannot issue another invitation', () => {
  const dialog = source.slice(source.indexOf('function openBranchParentOnboardingDialog('), source.indexOf('function pick(row, keys)'));
  const copy = dialog.slice(dialog.indexOf('  copy.onclick'), dialog.indexOf("  dialog.querySelector('[data-close-branch-parent-link]')"));
  assert.doesNotMatch(copy, /staffFetch/);
  assert.match(copy, /copyTextToClipboard\(textarea.value\)/);
  assert.match(dialog, /if \(generate.disabled\) return/);
  assert.match(dialog, /branch !== clean\(selectedBranchId/);
  assert.match(dialog, /Generating a replacement disables the previous group link/);
});
