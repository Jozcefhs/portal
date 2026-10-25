import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const routes = { '/': '../tests/fixtures/admission-cycle.html', '/js/admission-cycles.js': '../js/admission-cycles.js', '/css/admission-cycles.css': '../css/admission-cycles.css' };
const server = createServer(async (req, res) => {
  if (!Object.hasOwn(routes, req.url)) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : req.url.endsWith('.css') ? 'text/css' : 'text/html');
  res.end(await readFile(new URL(routes[req.url], import.meta.url)));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  for (const width of [1366, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 850 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator('#open').click();
    await page.locator('[data-status]').filter({ hasText: 'Choose a session' }).waitFor();
    await page.locator('#admissionRetentionMode').selectOption('days');
    await page.locator('#admissionRetentionDays').fill('0');
    await page.locator('[data-save-policy]').click();
    await page.locator('[data-status]').filter({ hasText: 'Retention policy saved' }).waitFor();
    await page.locator('[name=session]').fill('2026/2027');
    await page.locator('[data-preview]').click();
    await page.locator('#admissionCycleConfirm').fill('CLOSE 2026/2027 First Term');
    await page.locator('[data-confirm-action]').click();
    await page.locator('[data-status]').filter({ hasText: 'No applicant details were deleted' }).waitFor();
    assert.ok((await page.locator('[data-preview-content]').textContent()).includes('Linked to a student record'));
    await page.locator('#admissionCycleConfirm').fill('CLEAN 2026/2027 First Term');
    await page.locator('[data-confirm-action]').click();
    await page.locator('[data-status]').filter({ hasText: 'cleaned after verified backup' }).waitFor();
    assert.equal(await page.locator('[data-download]').count(), 1);
    assert.equal(await page.locator('[data-confirm-action]').count(), 0);
    await page.locator('[data-dismiss]').click();
    await page.locator('dialog').waitFor({ state: 'detached' });
    assert.equal(await page.locator('dialog').count(), 0);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('PASS: admission retention, close, protected applicant, verified-cleanup receipt and dialog dismissal at desktop and phone widths (synthetic records only).');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
