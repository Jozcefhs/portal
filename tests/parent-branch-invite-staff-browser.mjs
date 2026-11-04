// Synthetic browser proof: no production requests or records.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const helper = source.slice(source.indexOf('function branchParentOnboardingMessage('), source.indexOf('function pick(row, keys)'));
const out = resolve('tmp/branch-parent-invite-ui');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:16px Arial}button{padding:12px}textarea{font:14px Arial}</style>' }));
    await page.goto('http://branch-invite.test/');
    await page.evaluate(({ helper }) => {
      window.calls = []; window.copies = [];
      window.clean = value => String(value ?? '').trim();
      window.escapeHtml = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/'/g, '&#39;');
      window.selectedBranchId = 'area-1-primary'; window.currentUser = { branchId: 'area-1-primary' };
      window.availableBranches = [{ id: 'area-1-primary', name: 'Area 1 Primary' }];
      window.dashboardStatus = {}; window.setStatus = () => {};
      window.setButtonLoading = (button, loading, busy, ready) => { button.disabled = loading; button.textContent = loading ? busy : ready; };
      window.copyTextToClipboard = async text => { window.copies.push(text); throw Error('Clipboard unavailable'); };
      window.staffFetch = async (url, options) => {
        window.calls.push(JSON.parse(options.body));
        const exp = Math.floor(Date.now() / 1000) + 3600;
        const token = btoa(JSON.stringify({ purpose: 'parent-branch-onboarding', branchId: 'area-1-primary', exp })).replace(/=/g, '') + '.signature';
        return { ok: true, json: async () => ({ ok: true, branchId: 'area-1-primary', branchName: 'Area 1 Primary',
          schoolSections: ['primary'], setupCode: '82493716', expiresAt: new Date(exp * 1000).toISOString(),
          onboardingPath: `/parent-dashboard#onboarding=1&branchAccess=${token}` }) };
      };
      (0, eval)(helper);
      openBranchParentOnboardingDialog();
    }, { helper });
    assert.equal(await page.locator('textarea').isVisible(), false);
    assert.equal(await page.evaluate(() => calls.length), 0);
    await page.getByRole('button', { name: 'Generate link and code', exact: true }).click();
    await page.locator('textarea').waitFor({ state: 'visible' });
    assert.match(await page.locator('textarea').inputValue(), /Area 1 Primary/);
    assert.match(await page.locator('textarea').inputValue(), /Setup code: 82493716/);
    await page.getByRole('button', { name: 'Copy message for WhatsApp' }).click();
    assert.equal(await page.evaluate(() => calls.length), 1);
    assert.equal(await page.evaluate(() => copies.length), 1);
    assert.match(await page.locator('[role=status]').innerText(), /Copy command/);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: resolve(out, `staff-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.locator('dialog').waitFor({ state: 'detached' });
    assert.equal(await page.locator('dialog').count(), 0);
    await page.close();
  }
  console.log('Branch invitation dialog passed at 390px and 1280px: explicit issuance, copy fallback, one request, no overflow.');
} finally { await browser.close(); }
