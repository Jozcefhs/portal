// Isolated browser QA: every request is intercepted; no real checkout or school data.
// Run: SUBMISSION_PLAYWRIGHT_MODULE=<playwright/index.mjs> node tests/academic-submissions-browser.mjs
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { chromium } = await import(pathToFileURL(process.env.SUBMISSION_PLAYWRIGHT_MODULE).href);
const source = await fs.readFile('js/academic-submissions.js', 'utf8');
const harness = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:15px Arial}button,input,select{padding:8px;margin:4px}th,td{text-align:left;padding:8px}</style></head><body>
<button id="settings">Open settings</button><button id="payment">Open payment</button><script type="module">
import {openSubmissionSettings,openSurchargeCheckout} from '/module.js';
let saved={Enabled:false,Rules:[],RevisionToken:''}; window.calls=[]; window.complete=false;
const scope={BranchId:'main',SchoolSection:'secondary',SessionId:'s',TermId:'t'};
const submission={...scope,Reference:'ACS-'+ 'a'.repeat(64),Actor:'sample.teacher',Description:'Weekly subject work',RecordType:'diary-entry',AmountKobo:350000,Deadline:'2026-10-01T08:00:00Z',Status:'Awaiting payment'};
async function request(action,input){window.calls.push({action,input});
 if(action==='getAcademicSubmissionSettings')return {ok:true,settings:saved,canManage:true,recordTypes:{cbt:'CBT test upload','diary-entry':'Weekly subject work'}};
 if(action==='saveAcademicSubmissionSettings'){saved={...input,RevisionToken:'saved'};window.saved=saved;return {ok:true,settings:saved};}
 if(action==='listAcademicSubmissions')return {ok:true,submissions:[submission]};
 if(action==='payAcademicSubmission')return {ok:true,submission,checkoutUrl:'https://checkout.paystack.com/test'};
 if(action==='verifyAcademicSubmission')return {ok:true,submission:{...submission,Status:'Submitted',Message:'Verified and submitted.'}};
 throw new Error(action);
}
document.querySelector('#settings').onclick=()=>openSubmissionSettings({request,context:scope,classes:[{ClassId:'g7',Name:'Grade 7'}],subjects:[{SubjectId:'math',Name:'Mathematics'}]});
document.querySelector('#payment').onclick=()=>openSurchargeCheckout({request,submission}).then(()=>window.complete=true).catch(error=>window.failure=error.message);
</script></body></html>`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const viewport of [{ width: 1366, height: 900 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport });
    const errors = [];
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === 'http://localhost:4198') return route.fulfill({ contentType: url.pathname === '/module.js' ? 'application/javascript' : 'text/html', body: url.pathname === '/module.js' ? source : harness });
      if (url.origin === 'https://checkout.paystack.com') return route.fulfill({ contentType: 'text/html', body: '<h1>Simulated checkout — no payment</h1>' });
      return route.abort();
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://localhost:4198/');
    await page.locator('#settings').click();
    await page.getByRole('button', { name: 'Add deadline', exact: true }).click();
    await page.locator('[data-class]').selectOption('g7');
    await page.locator('[data-subject]').selectOption('math');
    await page.locator('[data-deadline]').fill('2026-10-23T09:30');
    await page.locator('[data-amount]').fill('3500.25');
    await page.locator('[name="Enabled"]').check();
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await page.waitForFunction(() => !!window.saved);
    assert.equal((await page.evaluate(() => window.saved)).Rules[0].AmountKobo, 350025);
    assert.equal((await page.evaluate(() => window.saved)).Rules[0].Deadline, '2026-10-23T09:30:00+01:00');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `tmp/submission-settings-${viewport.width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.locator('#payment').click();
    await page.getByRole('button', { name: 'Pay charges', exact: true }).click();
    await page.getByRole('button', { name: 'Check payment / submission', exact: true }).click();
    await page.waitForFunction(() => window.complete);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('PASS: desktop/mobile settings, WAT deadlines, amounts, checkout and verified automatic completion; no live requests.');
} finally { await browser.close(); }
