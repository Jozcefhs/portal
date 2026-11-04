// Synthetic financial evidence only. This test makes no production requests.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const admin = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const helper = admin.slice(admin.indexOf('async function openReinstatedSchoolChargeRecovery('), admin.indexOf('\nfunction moneyInCurrency('));
const declarations = ['escapeHtml', 'money', 'setStatus', 'setButtonLoading'].map(name => admin.match(new RegExp(`function ${name}\\([^]*?\\n}`))[0]).join('\n');
const plan = { ok: true, ready: true, noOp: false, previewToken: 'reviewed-token', amount: 158060,
  profile: { AccountRef: 'TEST/26/274', DisplayName: 'Test learner', AcademicSession: '2026/2027', Term: 'First Term' },
  charges: [{ code: 'TXT', name: 'Textbooks', amount: 143060, priorInvoiceIds: ['OLD-TXT'] },
    { code: 'YBK', name: 'Yearbook', amount: 15000, priorInvoiceIds: ['OLD-YBK'] }],
  expectedTotal: 1028660, postedTotal: 870600, afterPostedTotal: 1028660,
  existingCredit: 158060, creditToApply: 158060, afterCredit: 0, afterOutstanding: 0 };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.abort());
    await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><button id="review">Review textbook / yearbook charges</button><main id="content"></main>');
    await page.addScriptTag({ content: `${declarations}\n${helper}\n
      const content=document.getElementById('content'), review=document.getElementById('review');
      window.resetReview=(options={})=>{
        window.calls=[];window.applied=0;window.options=options;
        content.innerHTML='<h3>Resolve billing conflicts</h3><button data-post-conflict>Previous correction</button><button data-recheck-conflict>Recheck account</button>';
        review.disabled=false;
      };
      review.onclick=()=>openReinstatedSchoolChargeRecovery({content,accountRef:'TEST/26/274',isCurrent:()=>true,
        readOnly:window.options.readOnly,confirm:async()=>window.options.cancel!==true,
        setReviewBusy:busy=>{review.disabled=busy},onApplied:()=>{window.applied++},
        request:async body=>{window.calls.push(body); if(body.action==='previewReinstatedCharges') return {...${JSON.stringify(plan)},...(window.options.noOp?{ready:false,noOp:true,amount:0,charges:[],reason:'No applicable missing charges.'}:{})};
          await new Promise(resolve=>setTimeout(resolve,50));if(window.options.fail)throw Error('Response lost');
          return {ok:true,message:'Reviewed charges posted.',summary:{TotalDebit:1028660,CreditBalance:0,OutstandingBalance:0}};}
      });window.resetReview();` });
    assert.equal(await page.evaluate(() => calls.length), 0, 'Opening a module makes no recovery query');
    await page.locator('#review').click();
    const post = page.locator('[data-post-reinstated-charges]');
    await post.waitFor();
    assert.equal(await page.evaluate(() => calls.length), 1);
    assert.match(await page.locator('[data-reinstated-charge-review]').innerText(), /870,600\.00 → ₦1,028,660\.00/);
    await post.click();
    assert.equal(await page.evaluate(() => calls.length), 1, 'Reason required before posting');
    await page.locator('[data-reinstated-reason]').fill('Reviewed applicable current charges');
    await post.click();
    await post.evaluate(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await page.waitForFunction(() => document.querySelector('[data-post-reinstated-charges]').textContent.startsWith('Charges posted'));
    assert.equal(await page.evaluate(() => calls.filter(call => call.action === 'applyReinstatedCharges').length), 1);
    assert.equal(await page.evaluate(() => applied), 1); assert.equal(await post.isDisabled(), true);
    assert.equal(await page.locator('[data-post-conflict]').isDisabled(), true, 'Earlier posting preview is stale after recovery');
    assert.equal(await page.locator('[data-recheck-conflict]').isDisabled(), false);
    for (const options of [{ noOp: true }, { readOnly: true }]) {
      await page.evaluate(value => resetReview(value), options); await page.locator('#review').click();
      await page.waitForFunction(() => document.querySelector('[data-reinstated-charge-review]')?.getAttribute('aria-busy') === 'false');
      assert.equal(await post.count(), 0); assert.equal(await page.evaluate(() => calls.length), 1);
    }
    for (const options of [{ cancel: true }, { fail: true }]) {
      await page.evaluate(value => resetReview(value), options); await page.locator('#review').click(); await post.waitFor();
      await page.locator('[data-reinstated-reason]').fill('Reviewed charges'); await post.click();
      await page.waitForFunction(() => document.querySelector('[data-reinstated-charge-review]').getAttribute('aria-busy') === 'false');
      if (options.cancel) {
        assert.equal(await page.evaluate(() => calls.length), 1); assert.equal(await post.isDisabled(), false);
      } else {
        assert.equal(await post.isDisabled(), true);
        assert.match(await page.locator('[data-reinstated-status]').innerText(), /may already have saved/);
        await post.evaluate(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        assert.equal(await page.evaluate(() => calls.filter(call => call.action === 'applyReinstatedCharges').length), 1);
      }
    }
    assert.deepEqual(errors, []); await page.close();
    console.log(`Recovery UI ${width}px: explicit reads, totals, reason/confirmation, double-click, no-op, read-only and lost response passed.`);
  }
} finally { await browser.close(); }
