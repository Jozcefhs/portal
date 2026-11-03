// Synthetic settings only. No live credentials, records or settings are used.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const profile = { OrganisationEdition: 'school', SchoolName: 'Test Academy', NameFormat: 'Surname, first name, middle name',
  AvailableBranches: [{ Id: 'main', Name: 'Main Branch' }, { Id: 'garden', Name: 'Garden Branch' }],
  EmailProvider: 'brevo', EmailProviderConnectionReady: true, EmailProviderSelfServiceAvailable: true };
await mkdir('tmp/branch-name-ui', { recursive: true });
try {
  for (const width of [1366, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await context.route('**/*', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.startsWith('/api/')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, profile }) });
      try {
        const types = { js: 'text/javascript', css: 'text/css', html: 'text/html', png: 'image/png' };
        return route.fulfill({ contentType: types[path.split('.').pop()] || 'application/octet-stream', body: await readFile(`.${path}`) });
      } catch { return route.fulfill({ status: 404, body: '' }); }
    });
    await page.goto('https://branch-settings.test/setup.html');
    await page.waitForFunction(() => typeof applyProfile === 'function');
    await page.evaluate(profile => {
      applyProfile(profile, { scope: 'branch', branchId: 'garden', scopeLocked: true });
      setupLoginForm.hidden = true; setupForm.hidden = false;
    }, profile);
    const field = page.locator('#nameFormat');
    assert.equal(await field.isEnabled(), true);
    assert.equal(await field.evaluate(el => Boolean(el.closest('.settings-scope-locked'))), false);
    await field.selectOption('First name, middle name, surname');
    assert.equal(await page.evaluate(() => profileFromForm().NameFormat), 'First name, middle name, surname');
    assert.match(await page.locator('#nameFormatHelp').textContent(), /Garden Branch/);
    assert.equal(await page.locator('#connectGoogleEmail').isDisabled(), true);
    assert.match(await page.locator('#emailProviderScopeHelp').textContent(), /affects every branch/);
    await field.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `tmp/branch-name-ui/${width}.png` });
    await page.evaluate(profile => applyProfile(profile, { scope: 'organisation', branchId: '', scopeLocked: false }), profile);
    assert.equal(await field.isDisabled(), true);
    assert.equal(await page.evaluate(() => Object.hasOwn(profileFromForm(), 'NameFormat')), false);
    await page.evaluate(profile => applyProfile({ ...profile, NameFormat: 'Middle name, surname, first name' }, { scope: 'branch', branchId: 'main' }), profile);
    assert.equal(await field.inputValue(), 'Middle name, surname, first name');
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('PASS: desktop/mobile branch-only name settings, branch switching, save payload and shared-email explanation.');
} finally { await browser.close(); }
