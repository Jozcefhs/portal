import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [adminHtml, adminJs, setupHtml, setupJs] = await Promise.all([
  readFile(new URL('admin.html', root), 'utf8'),
  readFile(new URL('js/admin.js', root), 'utf8'),
  readFile(new URL('setup.html', root), 'utf8'),
  readFile(new URL('js/setup.js', root), 'utf8')
]);

test('super administrators have a visible route to payment settings', () => {
  assert.match(adminHtml, /id="staffPaymentSettings"/);
  assert.match(adminHtml, /> Payment settings\s*<\/button>/);
  assert.match(adminJs, /paymentSettingsButton\.hidden = user\.role !== 'Super Admin'/);
  assert.match(adminJs, /url\.hash = 'payment-settings'/);
});

test('payment settings navigation preserves the selected branch', () => {
  assert.match(adminJs, /url\.searchParams\.set\('scope', 'branch'\)/);
  assert.match(adminJs, /url\.searchParams\.set\('branch', selectedBranchId\)/);
  assert.match(setupJs, /requestedSettingsParams\.get\('branch'\)/);
  assert.match(setupJs, /scope: requestedSettingsScope/);
  assert.match(setupJs, /branchId: requestedSettingsBranch/);
});

test('the protected settings page reveals the requested payment section after unlock', () => {
  assert.match(setupHtml, /id="payment-settings"/);
  assert.match(setupJs, /function revealRequestedSettingsSection\(\)/);
  assert.match(setupJs, /section\.scrollIntoView/);
  assert.match(setupJs, /revealRequestedSettingsSection\(\)/);
});
