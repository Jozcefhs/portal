// Local assets and synthetic data only; no live learner or message operations.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(import.meta.dirname, '..'), out = resolve(root, 'tmp/branch-parent-onboarding-ui');
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
    const student = { admissionNo: 'DCA/26/001', studentName: 'Area Learner', firstName: 'Area', surname: 'Learner',
      className: 'Grade 2', branchName: 'Area 1 Primary', schoolSection: 'primary' };
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      if (url.pathname !== '/api/parent-dashboard') return route.fulfill({ json: { ok: true, settings: {}, profile: {} } });
      const body = route.request().postDataJSON(); calls.push(body);
      if (body.action === 'beginBranchParentOnboarding') {
        if (body.setupCode !== '82640317') return route.fulfill({ status: 401, json: { ok: false, message: 'Branch setup code is invalid or expired.' } });
        return route.fulfill({ json: { ok: true, student, branchClaimToken: 'synthetic-exact-area-claim' } });
      }
      if (body.action === 'completeParentOnboardingProfile') return route.fulfill({ json: { ok: true, parentEmail: 'parent@example.test', passwordChangeRequired: true, passwordSetupToken: 'synthetic-branch-password-proof' } });
      return route.fulfill({ status: 401, json: { ok: false, message: 'Synthetic session endpoint' } });
    });
    await page.goto(`${origin}/parent-dashboard#onboarding=1&branchAccess=synthetic-area-branch-invite`);
    await page.locator('#parentOnboardingPanel').waitFor({ state: 'visible' });
    assert.equal(calls.length, 0, 'A branch group link must not load student records on opening');
    assert.ok(!page.url().includes('branchAccess='));
    assert.ok(page.url().includes('branchSetup=1'), 'Refresh retains only the non-secret branch setup mode');
    assert.equal(await page.locator('#onboardingAccessLabel').textContent(), 'Branch setup code');
    assert.equal(await page.locator('#onboardingTemporaryPassword').inputValue(), '');
    await page.locator('#onboardingAdmissionNo').fill(student.admissionNo);
    await page.locator('#onboardingTemporaryPassword').fill('wrong-code');
    await page.locator('#verifyParentOnboardingBtn').click();
    await page.waitForFunction(() => document.getElementById('parentOnboardingAccessStatus').textContent.includes('invalid or expired'));
    assert.equal(await page.locator('#parentOnboardingProfileForm').isHidden(), true);
    assert.equal(await page.locator('#verifyParentOnboardingBtn').isEnabled(), true);
    await page.locator('#onboardingTemporaryPassword').fill('82640317');
    await page.locator('#onboardingBranchSection').selectOption('primary');
    await page.locator('#verifyParentOnboardingBtn').click();
    await page.locator('#parentOnboardingProfileForm').waitFor({ state: 'visible' });
    assert.equal(calls[1].branchInviteToken, 'synthetic-area-branch-invite');
    assert.equal(calls[1].setupCode, '82640317');
    assert.equal(calls[1].schoolSection, 'primary');
    assert.equal(calls[1].onboardingToken, undefined);
    assert.equal(await page.locator('#onboardingParentEmail').inputValue(), '');
    assert.equal(await page.locator('#onboardingDateOfBirth').inputValue(), '');
    assert.match(await page.locator('#onboardingStudentBranch').textContent(), /Area 1 Primary \/ primary/);
    for (const [id, value] of Object.entries({ onboardingDateOfBirth: '2018-01-03', onboardingParentName: 'Synthetic Parent',
      onboardingParentEmail: 'parent@example.test', onboardingConfirmParentEmail: 'parent@example.test', onboardingParentPhone: '00000000',
      onboardingResidentialAddress: 'Synthetic address', onboardingEmergencyName: 'Emergency Parent', onboardingEmergencyPhone: '00000000' })) {
      await page.locator('#' + id).fill(value);
    }
    await page.locator('#onboardingGender').selectOption('Female');
    await page.locator('#onboardingStudentType').selectOption('Day Student');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: resolve(out, `profile-${width}.png`), fullPage: true });
    await page.locator('#submitParentOnboardingBtn').click();
    await page.locator('#requiredParentPasswordDialog').waitFor({ state: 'visible' });
    assert.equal(calls[2].branchClaimToken, 'synthetic-exact-area-claim');
    assert.equal(calls[2].onboardingToken, undefined);
    assert.equal(calls[2].branchInviteToken, undefined, 'Completion uses the exact learner claim rather than a new lookup');
    assert.ok(await page.evaluate(() => !JSON.stringify({ ...localStorage, ...sessionStorage }).includes('synthetic-')));
    await page.locator('#cancelRequiredParentPassword').click();
    await page.locator('#resumeBranchParentPasswordBtn').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#verifyParentOnboardingBtn').isHidden(), true);
    await page.locator('#resumeBranchParentPasswordBtn').click();
    await page.locator('#requiredParentPasswordDialog').waitFor({ state: 'visible' });
    assert.equal(calls.length, 3, 'Resuming password setup must not reread or resubmit the claimed profile');
    assert.equal(await page.locator('#requiredParentEmail').inputValue(), 'parent@example.test');
    assert.deepEqual(errors, []);
    await page.reload();
    await page.locator('#parentOnboardingPanel').waitFor({ state: 'visible' });
    assert.equal(calls.length, 3);
    assert.match(await page.locator('#parentOnboardingAccessStatus').textContent(), /Reopen the full branch link/);
    await page.locator('#onboardingAdmissionNo').fill(student.admissionNo);
    await page.locator('#onboardingTemporaryPassword').fill('82640317');
    await page.locator('#verifyParentOnboardingBtn').click();
    assert.equal(calls.length, 3, 'A code without its branch invite must not fall back to admission-only access');
    await page.close();
  }
  await writeFile(resolve(out, 'proof.json'), JSON.stringify({ ok: true, widths: [390, 1280], noAutomaticLearnerReads: true, scopedBranchProof: true, exactClaimCompletion: true, resumePasswordWithoutReads: true, noTokenWebStorage: true }, null, 2));
  console.log('Branch parent onboarding passed at 390px and 1280px.');
} finally { await browser?.close(); await new Promise(r => server.close(r)); }
