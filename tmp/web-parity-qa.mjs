// Isolated browser QA. No requests are allowed to reach a live school service.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { buildPrintableCorrespondence } from '../functions/lib/executive-correspondence.js';
const { chromium } = await import(pathToFileURL(process.env.PARITY_PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => route.fulfill({ body: '<!doctype html><meta charset="utf-8"><body></body>', contentType: 'text/html' }));
await page.goto('http://localhost:4179');
await page.addStyleTag({ content: await fs.readFile('css/style.css', 'utf8') });
await page.addStyleTag({ content: await fs.readFile('css/payment-corrections.css', 'utf8') });
await page.addScriptTag({ content: await fs.readFile('js/financial-values.js', 'utf8') });
await page.addScriptTag({ content: await fs.readFile('js/manual-payments.js', 'utf8') });
await page.evaluate(() => {
  window.calls = []; window.confirms = []; window.active = true; window.abort = new AbortController();
  window.DynamaxDialogs = { confirm: async input => { confirms.push(input); return true; } };
  window.DynamaxManualPayments.open({ user: { edition: 'school', role: 'Accounts Officer', allowedSections: ['accounts'] },
    isCurrent: () => active, signal: abort.signal, fetch: async (url, options) => {
      if (url !== '/api/staff-manual-payments') throw Error('Unexpected endpoint');
      const input = JSON.parse(options.body); calls.push(input);
      if (input.action === 'lookup') return Response.json({ ok: true, account: { AccountRef: 'TEST/001', DisplayName: 'Sample Student', ClassName: 'Grade 8' },
        choices: [{ ChoiceId: 'tuition', FeeCode: 'TUI', FeeName: 'Tuition', Amount: 14000, Balance: 10000 },
          { ChoiceId: 'wallet', FeeCode: 'WALLET_TOPUP', FeeName: 'Student Wallet Top-up', Amount: 0 }] });
      if (!input.DuplicateWalletReviewDigest) return Response.json({ ok: false, code: 'WALLET_DUPLICATE_REVIEW_REQUIRED', message: 'Existing batch credit found.',
        duplicateReview: { ReviewDigest: 'TEST-DIGEST', Matches: [{ Date: '2026-10-10', Source: 'Batch upload', Reference: 'BATCH-TEST', Currency: 'NGN', Amount: 3500 }] } });
      return Response.json({ ok: true, message: 'Payment recorded.', payment: { ReceiptNo: 'TEST-RECEIPT', Amount: 3500, Currency: 'NGN' } });
    } });
});
await page.locator('[name=AccountRef]').fill('TEST/001');
await page.locator('[data-load]').click();
await page.locator('[name=ChoiceId]').selectOption('tuition');
assert.equal(await page.locator('[name=Amount]').inputValue(), '10,000.00');
assert.equal(await page.locator('[name=Description]').inputValue(), 'Tuition');
await page.locator('[name=ChoiceId]').selectOption('wallet');
assert.equal(await page.locator('[name=Amount]').inputValue(), '0.00');
await page.locator('[name=Amount]').fill('3500');
await page.locator('[name=PaymentProof]').fill('QA cash slip');
await page.locator('[data-submit]').click();
await page.locator('[data-duplicate]').waitFor({ state: 'visible' });
assert.equal((await page.evaluate(() => calls)).length, 2);
assert.equal(await page.locator('[data-retry]').isVisible(), false);
await page.locator('[data-separate]').click();
assert.equal((await page.evaluate(() => calls)).length, 2);
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: 'tmp/web-manual-payment-mobile.png' });
assert.equal(await page.locator('dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
await page.locator('[data-checked]').check();
await page.locator('[data-separate]').click();
await page.waitForFunction(() => document.querySelector('[data-status]').textContent.includes('TEST-RECEIPT'));
const calls = await page.evaluate(() => calls);
assert.equal(calls[1].Reference, calls[2].Reference);
assert.equal(calls[1].Amount, '3500');
assert.equal(calls[2].DuplicateWalletReviewDigest, 'TEST-DIGEST');
assert.equal(await page.locator('[data-retry]').isVisible(), false);
await page.locator('[data-close]').click();
await page.waitForFunction(() => !document.querySelector('dialog'));

// Exercise the actual directory markup, search functions and event wiring.
const admin = await fs.readFile('js/admin.js', 'utf8');
const functions = admin.slice(admin.indexOf('function cancelExecutiveDirectorySearch()'), admin.indexOf('function bindExecutiveOfficeEvents()'));
const markup = admin.slice(admin.indexOf('function renderExecutiveDirectory()'), admin.indexOf('function renderExecutiveTemplates()'));
const bindings = admin.slice(admin.indexOf("  document.getElementById('executiveDirectorySearch')?.addEventListener('submit'"), admin.indexOf("  panelEl.querySelectorAll('[data-executive-directory-type]')"));
await page.addScriptTag({ content: `
  var panelEl=document.body, clean=v=>String(v??'').trim(), escapeHtml=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;');
  var executiveDirectoryTimer=null,executiveDirectorySequence=0,executiveDirectoryPending=null,executiveDirectoryBusy=false,
    executiveDirectoryQuery='',executiveDirectoryResults=[],executiveDirectoryType='student',executiveAvailableDirectoryTypes=[],
    selectedBranchId='main',currentUser={username:'test'},staffSessionAbortController=new AbortController(),activeSection='executiveOffice',executiveOfficeTab='directory';
  var tabIcons={},executiveDirectoryTypes=()=>[{id:'student',label:'Students'}], executiveRecordName=r=>r.name,executiveRecordMeta=r=>r.id,
    executiveRecordId=r=>r.id, executiveRecordEmail=()=>'', executiveClassRows=()=>[], directoryCalls=[];
  var executiveOfficeRequest=async(action,body)=>{directoryCalls.push(body.query); await new Promise(resolve=>setTimeout(resolve,100));return {results:[{id:'TEST/001',name:'Sample '+body.query}]};};
  ${functions}\n${markup}\ndocument.body.innerHTML='<main style="padding:18px">'+renderExecutiveDirectory()+'</main>';\n${bindings}` });
await page.locator('[name=query]').pressSequentially('philip', { delay: 25 });
await page.waitForFunction(() => document.querySelector('.executive-directory-record'));
assert.deepEqual(await page.evaluate(() => directoryCalls), ['philip']);
assert.equal(await page.locator('[name=query]').evaluate(el => el === document.activeElement), true);
await page.locator('[name=query]').fill('ada');
await page.getByRole('button', { name: 'Search', exact: true }).click();
await page.waitForFunction(() => document.querySelector('.executive-directory-record')?.textContent.includes('ada'));
assert.equal(await page.getByRole('button', { name: 'Search', exact: true }).isVisible(), true);
await page.screenshot({ path: 'tmp/web-directory-mobile.png' });
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

await fs.mkdir('tmp/pdfs/web-parity', { recursive: true });
const logo = 'data:image/png;base64,' + (await fs.readFile('images/Logo.png')).toString('base64');
const signature = await page.evaluate(() => { const c=document.createElement('canvas');c.width=400;c.height=130;
  const ctx=c.getContext('2d');ctx.font='italic 42px cursive';ctx.fillStyle='#284c91';ctx.fillText('Test Officer',15,78);return c.toDataURL(); });
for (const edition of ['school', 'faith', 'organization', 'long']) {
  const long = edition === 'long';
  const { html } = buildPrintableCorrespondence({ Reference: 'DCA-COR-20261018-TEST01', Kind: edition === 'school' ? 'transfer-certificate' : 'general',
    RecipientName: 'Example Student', RecipientOrganisation: 'Example University', RecipientId: 'TEST/001', IssuedAt: '2026-10-18',
    IssuedBy: 'Test Officer', IssuerTitle: 'Principal', SignatureApplied: true,
    TokenValues: { STUDENT_NAME: 'Example Student', ADMISSION_NO: 'TEST/001', CLASS: 'Grade 9 Brilliance', ADMISSION_DATE: '20 July 2022', LEAVING_DATE: '12 September 2026', REASON: 'Graduation', CONDUCT: 'Satisfactory' } },
    { Edition: edition, Name: 'Destiny Christian Academy', Code: 'DCA', Address: 'The Lord’s Garden Airport Road, Abuja', Phone: '+234 123 456 7890', Email: 'office@example.test', LogoDataUrl: logo },
    { subject: edition === 'school' ? 'Official Letter: Transfer Letter' : 'Official Letter: Confirmation',
      body: long ? Array.from({length:32}, (_,i)=>`Paragraph ${i+1}. This sample confirms that longer official letters flow naturally across pages while retaining the desktop typography and margins. No real student record or financial account is involved in this test.`).join('\n\n')
      : 'This is to certify that Example Student, admission number TEST/001, was a student of Destiny Christian Academy in Grade 9 Brilliance.\n\nThe student attended from 20 July 2022 to 12 September 2026.\n\nReason for leaving: Graduation.\n\nConduct and remarks: Satisfactory.' }, { SignatureDataUrl: signature });
  await page.setContent(html); await page.evaluate(() => document.fonts.ready);
  await page.pdf({ path: `tmp/pdfs/web-parity/${edition}.pdf`, preferCSSPageSize: true, printBackground: true });
}
assert.deepEqual(errors, []);
await browser.close();
console.log('PASS: real browser manual-payment, duplicate confirmation, mobile layout, automatic directory search, Search button; four print PDFs rendered.');
