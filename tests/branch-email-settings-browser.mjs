import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('../', import.meta.url);
await mkdir(new URL('tmp/branch-email-ui/', root), { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const width of [1366, 390]) {
    for (const edition of ['school', 'faith', 'organization', 'hospital']) {
      const page = await browser.newPage({ viewport: { width, height: 960 } });
      const errors = [], actions = [];
      page.on('pageerror', error => errors.push(error.message));
      let independent = false;
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.hostname !== 'branch-settings.test') return route.abort();
        if (url.pathname === '/api/settings') {
          const request = route.request().postDataJSON() || {};
          const branch = request.SettingsScope === 'branch' ? request.BranchId : '';
          return route.fulfill({ json: { ok: true, settingsAccess: { scope: branch ? 'branch' : 'organisation', branchId: branch, scopeLocked: false }, profile: {
            OrganisationEdition: edition, SchoolName: 'Example organisation', SchoolEmail: 'office@example.invalid',
            SettingsScope: branch ? 'branch' : 'organisation', EffectiveBranchId: branch, AvailableBranches: [{ Id: 'area-1', Name: 'Area 1' }, { Id: 'main', Name: 'Main Branch' }],
            EmailProvider: independent && branch ? 'gmail' : 'brevo', GmailConnectedEmail: independent && branch ? 'branch@example.invalid' : '',
            EmailProviderMode: independent && branch ? 'independent' : 'inherit', EmailProviderConnectionReady: true, EmailProviderSelfServiceAvailable: true
          } } });
        }
        if (url.pathname === '/api/email-provider-connection') {
          const body = route.request().postDataJSON(); actions.push(body);
          assert.equal(body.SettingsScope, 'branch'); assert.equal(body.BranchId, 'area-1');
          return route.fulfill({ json: { ok: true, deploymentQueued: true, message: 'Branch change queued.' } });
        }
        if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { ok: true, policy: {}, profile: {}, sessions: [], terms: [], components: [] } });
        try {
          const path = url.pathname === '/' ? '/setup.html' : url.pathname;
          const body = await readFile(new URL('.' + path, root));
          const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' }[extname(path)] || 'application/octet-stream';
          return route.fulfill({ body, contentType: type });
        } catch { return route.fulfill({ status: 404, body: '' }); }
      });
      await page.goto('https://branch-settings.test/setup.html?scope=branch&branch=area-1#document-settings');
      await page.locator('#setupPassword').fill('synthetic');
      await page.locator('#setupLoginForm button[type=submit]').click();
      await page.locator('#setupForm').waitFor({ state: 'visible' });
      await page.locator('#emailProviderPanel').scrollIntoViewIfNeeded();
      assert.match(await page.locator('#emailProviderScopeTitle').innerText(), /Inherit organisation provider/i);
      assert.equal(await page.locator('#connectGoogleEmail').isDisabled(), false);
      assert.equal(await page.locator('#branchBrevoConnection').isVisible(), true);
      assert.equal(await page.locator('#useBrevoEmail').isVisible(), false);
      await page.locator('#branchBrevoApiKey').fill('synthetic-branch-key');
      await page.locator('#connectBranchBrevo').click();
      await page.locator('#emailProviderStatus').filter({ hasText: 'Branch change queued.' }).waitFor();
      assert.equal(actions.length, 1); assert.equal(actions[0].action, 'use-brevo');
      assert.equal(await page.locator('#branchBrevoApiKey').inputValue(), '');
      independent = true;
      await page.evaluate(() => loadProfile('synthetic'));
      assert.equal(await page.locator('#inheritEmailProvider').isVisible(), true);
      await page.locator('#emailProviderPanel').screenshot({ path: fileURLToPath(new URL(`tmp/branch-email-ui/${edition}-${width}.png`, root)) });
      await page.locator('#inheritEmailProvider').click();
      await page.waitForFunction(() => document.getElementById('inheritEmailProvider').disabled);
      assert.equal(actions.length, 2); assert.equal(actions[1].action, 'inherit-email');
      assert.equal('brevoApiKey' in actions[1], false);
      await page.evaluate(() => { settingsScopeField.value = 'organisation'; });
      await page.evaluate(() => loadProfile('synthetic'));
      assert.equal(await page.locator('#branchBrevoConnection').isVisible(), false);
      assert.equal(await page.locator('#inheritEmailProvider').isVisible(), false);
      assert.deepEqual(errors, []);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), 'no horizontal page overflow');
      await page.close();
    }
  }
  console.log('Branch email settings passed at 1366/390px in all four editions; scoped mock actions only, no emails or real credentials.');
} finally { await browser.close(); }
