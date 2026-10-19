// Isolated UI check: every request is intercepted; no live API/email is used.
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { chromium } = await import(pathToFileURL(process.env.RECOVERY_PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const requests = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
const assets = new Map([
  ['/staff-password-recovery.html', ['staff-password-recovery.html', 'text/html']],
  ['/css/style.css', ['css/style.css', 'text/css']],
  ['/css/staff-password-recovery.css', ['css/staff-password-recovery.css', 'text/css']],
  ['/css/app-dialogs.css', ['css/app-dialogs.css', 'text/css']],
  ['/js/app-dialogs.js', ['js/app-dialogs.js', 'text/javascript']],
  ['/js/staff-password-recovery.js', ['js/staff-password-recovery.js', 'text/javascript']],
]);
await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.origin !== 'http://localhost:4198') return route.abort();
  if (url.pathname === '/api/staff-password-recovery') {
    const data = route.request().postDataJSON(); requests.push(data);
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, message: data.action === 'request'
      ? 'If this is an active staff account with a recovery email configured, a one-time code will be sent.'
      : 'Password reset. Sign in with your new password.' }) });
  }
  const asset = assets.get(url.pathname);
  if (!asset) return route.abort();
  return route.fulfill({ body: await fs.readFile(asset[0]), contentType: asset[1] });
});
try {
  await page.goto('http://localhost:4198/staff-password-recovery.html');
  await page.screenshot({ path: 'tmp/password-recovery-mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByRole('button', { name: 'Send recovery code' }).click();
  await page.getByRole('dialog').waitFor();
  assert.equal(requests.length, 0);
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  assert.equal(await page.locator('dialog[open]').count(), 0);
  await page.getByLabel('Staff login username').fill('fixture-user');
  await page.getByRole('button', { name: 'Send recovery code' }).click();
  await page.getByRole('dialog').waitFor();
  assert.equal(requests.length, 1);
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByLabel('One-time recovery code').fill('a'.repeat(48));
  await page.locator('#newPassword').fill('fixture-new-password');
  await page.locator('#confirmPassword').fill('fixture-mismatch-password');
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  assert.equal(requests.length, 1);
  assert.match(await page.getByRole('dialog').textContent(), /do not match/);
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('#confirmPassword').fill('fixture-new-password');
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].action, 'reset');
  assert.equal('confirmPassword' in requests[1], false);
  assert.equal(await page.locator('#newPassword').inputValue(), '');
  assert.equal(await page.locator('#recoveryCode').inputValue(), '');
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: 'tmp/password-recovery-desktop.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Browser QA passed: mobile/desktop fit, grouped validation, request/reset, mismatch protection, secret clearing, no live calls.');
} finally { await browser.close(); }
