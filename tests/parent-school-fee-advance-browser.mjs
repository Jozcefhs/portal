// Synthetic browser fixture; no payment provider or production data is contacted.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = await readFile('js/parent-dashboard.js', 'utf8');
const names = ['escapeHtml', 'childIdentity', 'schoolFeeAdvanceAmount', 'schoolFeeAdvanceDraft', 'renderSchoolFeeAdvance', 'paySchoolFeeAdvance'];
const functions = names.map(name => source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n}`))[0]).join('\n');
await mkdir('tmp/parent-fee-advance', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 850 } }), page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', route => {
      assert.equal(route.request().url(), 'https://advance-fixture.test/');
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body class="parent-dashboard-page"><main style="max-width:1100px;margin:16px auto;padding:10px"><section class="panel"><h2>Pay Now</h2><div id="schoolFeeAdvance"></div><div class="activity-item">There are no regular payment items due at the moment.</div></section></main></body>' });
    });
    await page.goto('https://advance-fixture.test/');
    await page.addStyleTag({ content: (await readFile('css/style.css', 'utf8')).replace(/@import[^;]+;/g, '') });
    await page.addStyleTag({ content: await readFile('css/parent-fee-advance.css', 'utf8') });
    await page.addScriptTag({ content: await readFile('js/financial-values.js', 'utf8') });
    await page.addScriptTag({ content: `
      const schoolFeeAdvance = document.getElementById('schoolFeeAdvance'), schoolFeeAdvanceDrafts = new Map();
      const testChild = { AccountRef:'DEMO/1', SourceType:'Student', BranchId:'branch-a', __scopePath:'schoolBranches/branch-a/sections/primary/students' };
      let selectedChildKey = testChild.__scopePath.toLowerCase() + '|' + testChild.AccountRef.toLowerCase(), sequence = 0;
      const newIdempotencyKey = () => 'demo-request-' + (++sequence), authPayload = () => ({email:'parent@example.test'});
      window.calls = []; window.choices = []; window.failNext = false;
      window.DynamaxPaymentMethods = { choose: async options => { choices.push(options); await new Promise(resolve => setTimeout(resolve, 30)); return { paymentMethod:'direct_bank_transfer', bankReference:'SYNTHETIC-BANK' }; }, directTransferMessage: () => 'Transfer submitted for verification.' };
      window.fetch = async (url, options) => { calls.push({url,body:JSON.parse(options.body),headers:options.headers}); await new Promise(resolve => setTimeout(resolve, 50));
        if (window.failNext) { window.failNext = false; throw new Error('Synthetic network interruption'); }
        return {ok:true,status:200,json:async()=>({ok:true,directTransfer:true})}; };
      ${functions}
      renderSchoolFeeAdvance(testChild);
      window.switchSyntheticChild = () => { const other={...testChild,AccountRef:'DEMO/2'}; selectedChildKey=childIdentity(other); renderSchoolFeeAdvance(other); };
      window.returnSyntheticChild = () => { selectedChildKey=childIdentity(testChild);renderSchoolFeeAdvance(testChild); };
    ` });
    const amount = page.getByLabel('Amount to pay in advance (NGN)', { exact: true });
    await amount.fill('2500000.50'); await page.getByRole('heading', { name: 'Pay fees in advance' }).click();
    assert.equal(await amount.inputValue(), '2,500,000.50'); assert.equal(await amount.getAttribute('max'), null);
    assert.equal(await page.evaluate(() => calls.length), 0);
    await page.evaluate(() => { switchSyntheticChild(); returnSyntheticChild(); });
    assert.equal(await amount.inputValue(), '2,500,000.50', 'Amount survives child navigation without a request');
    const card = page.locator('.parent-fee-advance'), cardBox = await card.boundingBox();
    assert.ok(cardBox.x >= 0 && cardBox.x + cardBox.width <= width + 1);
    assert.equal(await card.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
    await page.screenshot({ path: `tmp/parent-fee-advance/${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Pay fees in advance', exact: true }).evaluate(button => { button.click(); button.click(); });
    await page.getByRole('button', { name: 'Submitted for verification', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => calls.length), 1); assert.equal(await page.evaluate(() => choices.length), 1);
    assert.match(await page.getByRole('status').innerText(), /after the Accounts Office confirms/);
    assert.equal(await amount.isDisabled(), true);
    await page.getByRole('button', { name: 'Make another advance payment' }).click();
    assert.equal(await amount.inputValue(), ''); await amount.fill('3000000');
    await page.evaluate(() => { window.failNext = true; });
    await page.getByRole('button', { name: 'Pay fees in advance', exact: true }).click();
    await page.getByRole('button', { name: 'Retry payment request' }).waitFor();
    assert.equal(await amount.isDisabled(), true);
    await page.getByRole('button', { name: 'Retry payment request' }).click();
    await page.getByRole('button', { name: 'Submitted for verification', exact: true }).waitFor();
    const calls = await page.evaluate(() => window.calls);
    assert.equal(calls.length, 3); assert.deepEqual(calls[1], calls[2]);
    assert.equal(calls[0].body.feeCode, 'SCHOOL_FEES_ADVANCE'); assert.equal(calls[0].body.amount, 2500000.5);
    assert.equal(await page.evaluate(() => choices.length), 2); assert.deepEqual(errors, []);
    await context.close(); console.log(`Parent advance payment ${width}px: no reads on render, unlimited-by-balance amount, mobile layout, scope, duplicate-click guard, explicit new payment and identical network retry passed.`);
  }
} finally { await browser.close(); }
