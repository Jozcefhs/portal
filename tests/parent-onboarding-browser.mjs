// Isolated browser QA: local assets and synthetic API responses only.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(import.meta.dirname, '..'), out = resolve(root, 'tmp/parent-onboarding-ui');
await mkdir(out, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = resolve(root, '.' + (pathname === '/parent-dashboard' ? '/parent-dashboard.html' : pathname));
    if (!file.startsWith(root + '/') && !file.startsWith(root + '\\')) throw Error('Invalid path');
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' })[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    const errors = [], calls = [];
    page.on('pageerror', e => errors.push(e.message));
    const student = { admissionNo: 'DCA/26/001', studentName: 'Garden Learner', firstName: 'Garden', surname: 'Learner',
      gender: 'Female', dateOfBirth: '2018-02-03', className: 'Grade 2', branchName: "The Lord's Garden Primary", schoolSection: 'primary',
      studentType: 'Day Student', parentName: 'Test Parent', parentEmail: 'parent@example.test', parentPhone: '0000',
      residentialAddress: 'Synthetic address', emergencyContactName: 'Test Parent', emergencyContactPhone: '0000' };
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      if (url.pathname !== '/api/parent-dashboard') return route.fulfill({ json: { ok: true, settings: {}, profile: {} } });
      const body = route.request().postDataJSON(); calls.push(body);
      if (body.action === 'beginParentOnboarding') return route.fulfill({ json: { ok: true, student } });
      if (body.action === 'completeParentOnboardingProfile') return route.fulfill({ json: { ok: true, parentEmail: student.parentEmail, passwordChangeRequired: true, passwordSetupToken: 'synthetic-setup-proof' } });
      return route.fulfill({ status: 401, json: { ok: false, message: 'Synthetic session endpoint' } });
    });
    await page.goto(`${origin}/parent-dashboard#onboarding=1&admission=DCA%2F26%2F001&access=synthetic-personal-proof`);
    await page.locator('#parentOnboardingPanel').waitFor({ state: 'visible' });
    assert.equal(calls.length, 0, 'Opening a link must not load learner data automatically');
    assert.equal(await page.locator('#onboardingAdmissionNo').inputValue(), student.admissionNo);
    assert.equal(await page.locator('#onboardingTemporaryPassword').inputValue(), 'synthetic-personal-proof');
    assert.ok(!page.url().includes('access='), 'Personal proof must be removed from browser address history');
    await page.locator('#verifyParentOnboardingBtn').click();
    await page.locator('#parentOnboardingProfileForm').waitFor({ state: 'visible' });
    assert.equal(calls[0].onboardingToken, 'synthetic-personal-proof');
    assert.equal(calls[0].temporaryPassword, undefined);
    assert.match(await page.locator('#onboardingStudentBranch').textContent(), /Garden Primary \/ primary/);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: resolve(out, `profile-${width}.png`), fullPage: true });
    await page.locator('#submitParentOnboardingBtn').click();
    await page.locator('#requiredParentPasswordDialog').waitFor({ state: 'visible' });
    assert.equal(calls[1].onboardingToken, calls[0].onboardingToken);
    assert.equal(await page.locator('#requiredParentEmail').inputValue(), student.parentEmail);
    assert.equal(calls.filter(c => c.action === 'getDashboard').length, 0);
    assert.ok(await page.evaluate(() => !JSON.stringify({ ...localStorage, ...sessionStorage }).includes('synthetic-personal-proof')));
    await page.locator('#cancelRequiredParentPassword').click();
    assert.ok(await page.locator('#parentOnboardingAccessForm').isVisible(), 'Setup can resume from the personal proof in memory');
    assert.deepEqual(errors, []);
    await page.close();
  }
  // A desktop-exported shared link must explain how to obtain valid access,
  // without looking up a learner or repeatedly hitting the API.
  const legacyPage = await browser.newPage({ viewport: { width: 390, height: 900 }, serviceWorkers: 'block' });
  const legacyCalls = [];
  await legacyPage.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/parent-dashboard') legacyCalls.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true, settings: {}, profile: {} } });
  });
  await legacyPage.goto(`${origin}/parent-dashboard#onboarding=1`);
  await legacyPage.locator('#onboardingAdmissionNo').fill('DCA/26/001');
  await legacyPage.locator('#onboardingTemporaryPassword').fill('12345678');
  await legacyPage.locator('#verifyParentOnboardingBtn').click();
  await legacyPage.waitForFunction(() => document.getElementById('parentOnboardingAccessStatus').textContent.includes('old shared link'));
  assert.equal(legacyCalls.length, 0, 'The old common password must not perform learner reads');
  assert.equal(await legacyPage.locator('#verifyParentOnboardingBtn').isEnabled(), true);
  await legacyPage.locator('#onboardingTemporaryPassword').fill(`${origin}/parent-dashboard#onboarding=1`);
  await legacyPage.locator('#verifyParentOnboardingBtn').click();
  assert.equal(legacyCalls.length, 0, 'A shared page URL without personal proof must not perform learner reads');
  await legacyPage.close();
  await writeFile(resolve(out, 'proof.json'), JSON.stringify({ ok: true, widths: [390, 1280], scopedLink: true, noAutomaticLearnerReads: true, directPasswordSetup: true, noTokenWebStorage: true }, null, 2));
  console.log('Personal parent onboarding passed at 390px and 1280px.');
} finally { await browser?.close(); await new Promise(r => server.close(r)); }
