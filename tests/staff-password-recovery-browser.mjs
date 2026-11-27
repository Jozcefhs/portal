import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const origin = 'https://demo.example.test';
const resetUrl = origin + '/staff-password-recovery';
const assets = new Map([
  ['/staff-password-recovery', ['staff-password-recovery.html', 'text/html']],
  ['/js/staff-password-recovery.js', ['js/staff-password-recovery.js', 'application/javascript']],
  ['/js/app-dialogs.js', ['js/app-dialogs.js', 'application/javascript']]
]);

try {
  const page = await browser.newPage();
  const requests = [];
  let rejectReset = false;
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    assert.equal(url.origin, origin);
    if (url.pathname === '/api/staff-password-recovery') {
      const { action } = route.request().postDataJSON();
      requests.push(action);
      const ok = action !== 'reset' || !rejectReset;
      return route.fulfill({ status: ok ? 200 : 400, json: { ok, message: ok ? 'Completed.' : 'Invalid code.' } });
    }
    if (url.pathname === '/admin.html') return route.fulfill({ contentType: 'text/html', body: '<h1>Staff sign-in</h1>' });
    const asset = assets.get(url.pathname);
    if (!asset) return route.abort();
    return route.fulfill({ contentType: asset[1], body: await readFile(new URL('../' + asset[0], import.meta.url)) });
  });
  const reset = page.getByRole('button', { name: 'Reset password', exact: true });
  const closeDialog = () => page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  async function fillReset(password) {
    await page.getByLabel('One-time recovery code').fill('a'.repeat(48));
    await page.locator('#newPassword').fill(password);
    await page.getByLabel('Confirm new password').fill(password);
  }
  async function checkPolicy(type, minimum) {
    assert.equal(await page.getByLabel('Recovery code type').inputValue(), type);
    assert.equal(await page.locator('#newPasswordLabel').textContent(), `New password (${minimum}–128 characters)`);
    for (const id of ['newPassword', 'confirmPassword']) {
      assert.equal(await page.locator('#' + id).getAttribute('minlength'), String(minimum));
      assert.equal(await page.locator('#' + id).getAttribute('maxlength'), '128');
    }
  }

  await page.goto(resetUrl + '#owner-recovery');
  await checkPolicy('owner', 12);
  await fillReset('123456');
  await reset.click();
  await closeDialog();
  assert.deepEqual(requests, []);
  await fillReset('123456789012');
  rejectReset = true;
  await reset.click();
  await closeDialog();
  assert.equal(page.url(), resetUrl + '#owner-recovery');
  rejectReset = false;
  await reset.click();
  await page.waitForURL(origin + '/admin.html');
  assert.deepEqual(requests, ['reset', 'reset']);

  await page.goto(resetUrl);
  await page.getByText('Recover the original administrator account', { exact: true }).click();
  await page.getByLabel('Original administrator’s staff login').fill('fixture-user');
  await page.getByRole('button', { name: 'Send owner verification code' }).click();
  await closeDialog();
  await page.reload();
  await checkPolicy('owner', 12);
  await page.getByLabel('Staff login username').fill('fixture-user');
  await page.getByRole('button', { name: 'Send recovery code', exact: true }).click();
  await closeDialog();
  await checkPolicy('staff', 6);
  await page.getByLabel('Recovery code type').selectOption('owner');
  await checkPolicy('owner', 12);
  await page.getByLabel('Recovery code type').selectOption('staff');
  await fillReset('123456');
  await reset.click();
  await page.waitForURL(origin + '/admin.html');
  assert.deepEqual(requests, ['reset', 'reset', 'request-owner', 'request', 'reset']);
  console.log('Passed owner and staff password limits, switching, reload, error handling and sign-in redirects.');
} finally {
  await browser.close();
}
