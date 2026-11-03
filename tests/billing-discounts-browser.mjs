// All data is synthetic. No live accounts, payments or settings are changed.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
await mkdir('tmp/billing-discount-ui', { recursive: true });
try {
  for (const width of [1366, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 850 } });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/js/billing-discounts.js') return route.fulfill({ contentType: 'text/javascript', body: await readFile('js/billing-discounts.js', 'utf8') });
      assert.equal(path, '/');
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body class="staff-page"></body>' });
    });
    await page.goto('https://discount-fixture.test/');
    await page.addStyleTag({ content: (await readFile('css/style.css', 'utf8')).replace(/@import[^;]+;/g, '') });
    await page.evaluate(async () => {
      window.calls = []; window.current = true;
      const { openBillingDiscounts } = await import('/js/billing-discounts.js');
      await openBillingDiscounts(async payload => {
        calls.push(payload);
        if (payload.action === 'list') return { branchId: 'main', rules: [{ Name: 'Church Staff Child', DiscountType: 'Percentage', DiscountValue: 15, recordVersion: 'v1' }],
          categories: ['Church Staff Child', 'School Staff Child', 'Sibling Discount'] };
        await new Promise(resolve => setTimeout(resolve, 100));
        return { ok: true, rule: { ...payload, recordVersion: 'v2' }, message: 'Discount saved. Existing invoices and payments are unchanged.' };
      }, { isCurrent: () => window.current });
    });
    assert.equal(await page.getByLabel('Discount on total school fees', { exact: true }).inputValue(), 'Percentage');
    assert.equal(await page.getByLabel('Value (% or NGN)', { exact: true }).inputValue(), '15');
    await page.getByLabel('Billing category', { exact: true }).fill('Sibling Discount');
    await page.getByLabel('Billing category', { exact: true }).press('Tab');
    await page.getByLabel('Discount on total school fees', { exact: true }).selectOption('Fixed amount');
    await page.getByLabel('Value (% or NGN)', { exact: true }).fill('12000');
    const save = page.getByRole('button', { name: 'Save total-fee discount', exact: true });
    await save.evaluate(button => { button.click(); button.click(); });
    await page.getByRole('status').filter({ hasText: 'Discount saved' }).waitFor();
    const calls = await page.evaluate(() => window.calls);
    assert.equal(calls.length, 2); assert.equal(calls[1].DiscountValue, '12000');
    assert.equal(calls[1].Name, 'Sibling Discount');
    const bounds = await page.getByRole('dialog').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, 'dialog must fit the viewport');
    await page.screenshot({ path: `tmp/billing-discount-ui/${width}.png` });
    await page.evaluate(() => window.current = false);
    await save.click();
    assert.equal((await page.evaluate(() => window.calls)).length, 2, 'no write after a branch or user change');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    assert.equal(await page.getByRole('dialog').count(), 0); assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('PASS: desktop/mobile discount dialog, saved values, fixed/percentage options, single save, scoped writes, and close.');
} finally { await browser.close(); }
