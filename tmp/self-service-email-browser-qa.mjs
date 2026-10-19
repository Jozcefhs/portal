// Isolated rendering of the production login-details form and submit handler.
// Every network request is intercepted; no live staff account or email is used.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.RECOVERY_PLAYWRIGHT_MODULE).href);
const html = await fs.readFile('admin.html', 'utf8');
const js = await fs.readFile('js/admin.js', 'utf8');
const form = html.match(/<form id="staffLoginDetailsForm"[\s\S]*?<\/form>/)[0];
const start = js.indexOf("document.getElementById('staffLoginDetailsForm').addEventListener('submit'");
const handler = js.slice(start, js.indexOf('async function signOutFromPortal(', start));
const harness = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/css/style.css"></head><body class="staff-page"><dialog id="staffProfileDialog" class="workflow-dialog staff-profile-dialog">${form}</dialog><script>
const clean = value => String(value ?? '').trim();
function setButtonLoading(button, busy) { button.disabled = busy; }
function setStatus(node, message) { node.textContent = message; }
function showDashboard(user) { window.savedUser = user; }
async function sessionRequest(method, body) { const response = await fetch('/api/staff-session', { method, headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) }); return { response, data: await response.json() }; }
${handler}
document.getElementById('staffProfileLoginUsername').value = 'fixture-user';
document.getElementById('staffProfileRecoveryEmail').value = 'previous@example.test';
document.getElementById('staffProfileDialog').showModal();
</script></body></html>`;
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const requests = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://localhost:4199') return route.abort();
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: harness });
    if (url.pathname === '/css/style.css') return route.fulfill({ contentType: 'text/css', body: await fs.readFile('css/style.css') });
    if (url.pathname === '/api/staff-session') {
      const data = route.request().postDataJSON(); requests.push(data);
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true,
        message: 'Login details updated successfully.', user: { recoveryEmail: data.recoveryEmail } }) });
    }
    return route.abort();
  });
  await page.goto('http://localhost:4199/');
  assert.equal(await page.locator('#staffProfileRecoveryEmail').inputValue(), 'previous@example.test');
  await page.locator('#staffProfileRecoveryEmail').fill('staff@example.test');
  await page.getByRole('button', { name: 'Update login details' }).click();
  assert.equal(requests.length, 0); // Current password remains mandatory.
  await page.locator('#staffProfileCurrentPassword').fill('fixture-password');
  await page.locator('#staffProfileRecoveryEmail').fill('invalid-address');
  await page.getByRole('button', { name: 'Update login details' }).click();
  assert.equal(requests.length, 0);
  await page.locator('#staffProfileRecoveryEmail').fill('staff@example.test');
  assert.equal(await page.evaluate(() => document.querySelector('dialog').scrollWidth <= document.querySelector('dialog').clientWidth), true);
  await page.screenshot({ path: 'tmp/self-service-email-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Update login details' }).click();
  await page.waitForFunction(() => window.savedUser?.recoveryEmail === 'staff@example.test');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].action, 'updateLoginDetails');
  assert.equal(requests[0].recoveryEmail, 'staff@example.test');
  assert.equal(requests[0].currentPassword, 'fixture-password');
  assert.equal(await page.locator('#staffProfileCurrentPassword').inputValue(), '');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: 'tmp/self-service-email-desktop.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Self-service email browser QA passed: mobile/desktop fit, required password, email validation, account-email submission and secret clearing. No live calls.');
} finally { await browser.close(); }
