// All financial responses are synthetic and every browser request is intercepted.
import assert from 'node:assert/strict';
import {readFile, mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {renderBillingReport} from './helpers/billing-credit-review.mjs';
const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const admin = await read('js/admin.js');
const handler = admin.slice(admin.indexOf('  const openBillingChargeReview ='), admin.indexOf('  const reviewBoardingWearReversal ='))
  .replace("import('./obsolete-charge-review.js", "import('/js/obsolete-charge-review.js"); // Inline fixture keeps the production module location.
const declarations = ['setStatus', 'setButtonLoading'].map(name => admin.match(new RegExp(`function ${name}\\([^]*?\\n}`))[0]).join('\n');
const plan = {ok: true, readOnly: true, candidateOnly: false, ready: true, previewToken: 'a'.repeat(64),
  amount: 143880, releasedCredit: 0, outstandingRemoved: 143880, postedTotal: 730540, afterPostedTotal: 586660, expectedTotal: 586660,
  profile: {AccountRef: 'TEST/22/001', DisplayName: 'Sample student', ClassName: 'Grade 10', SchoolSection: 'secondary', AcademicSession: '2026/2027', Term: 'First Term'},
  charges: [{invoiceId: 'INV-11', code: 'TXT_SNR_11', name: 'Grade 11 textbooks', amount: 143880, ready: true, explanation: 'The saved fee rule applies to Grade 11, but the student’s saved class is Grade 10.'}],
  conflicts: [{code: 'TXT_SNR_11', expected: 0, invoiced: 143880, invoiceIds: ['INV-11'], conflict: true, review: 'Posted charge does not apply under the current fee setup'}]};
const report = {total: 1, matched: 0, incomplete: 0, missingAccounts: 0, ready: 0, blockedMissingAccounts: 0, review: 1, recheck: 0, readyWithReview: 0,
  rows: [{...plan, ready: false, invoicedTotal: 730540, difference: -143880, rows: plan.conflicts, missing: [], recordedCredit: 0, reason: 'Existing invoice conflicts need review.'}]};
const uniformPlan = {...plan, amount: 192000, releasedCredit: 178000, outstandingRemoved: 14000, postedTotal: 1680885, afterPostedTotal: 1488885, expectedTotal: 1488885,
  profile: {...plan.profile, ClassName: 'Grade 7', Gender: 'Male'},
  charges: [{invoiceId: 'INV-GIRLS', code: 'UNI_F', name: 'Girls uniforms', amount: 192000, ready: true, explanation: 'The saved uniform fee rule is for Female students, but the student’s saved gender is Male.'}],
  conflicts: [{code: 'UNI_F', expected: 0, invoiced: 192000, invoiceIds: ['INV-GIRLS'], conflict: true}],
  reallocations: [{invoiceId: 'INV-BOYS', code: 'UNI_M', name: 'Boys uniforms', amount: 178000}]};
const markup = await renderBillingReport(report), calls = [], errors = [];
const batchRefs = ['TEST/22/001', 'TEST/22/002', 'TEST/22/003', 'TEST/22/004'];
const batchMarkup = await renderBillingReport({...report, total: 4, review: 4, rows: batchRefs.map(AccountRef => ({...report.rows[0], profile: {...plan.profile, AccountRef}}))});
const {chromium} = await import(pathToFileURL(`${process.env.PLAYWRIGHT_MODULE}/index.mjs`).href);
const browser = await chromium.launch({channel: 'chrome', headless: true});
await mkdir('tmp/billing-conflict-ui', {recursive: true});
try {
  const context = await browser.newContext({viewport: {width: 1366, height: 900}}), page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  let posted = false, lostResponse = false, uniformMode = false, batchMode = false;
  const batchPosted = new Set();
  await context.route('**/*', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/student-billing-reconciliation') {
      const body = route.request().postDataJSON(); calls.push(body);
      if (batchMode) {
        assert.ok(batchRefs.includes(body.AccountRef));
        if (body.action === 'previewObsoleteReversal') return route.fulfill({json: {...plan, profile: {...plan.profile, AccountRef: body.AccountRef},
          ...(body.AccountRef.endsWith('004') || batchPosted.has(body.AccountRef) ? {ready: false, amount: 0, charges: [], reason: 'Needs further review'} : {})}});
        assert.equal(body.action, 'applyObsoleteReversal'); assert.ok(body.Reason); assert.equal(body.PreviewToken, plan.previewToken);
        assert.ok(!batchPosted.has(body.AccountRef), 'No duplicate write'); batchPosted.add(body.AccountRef);
        if (body.AccountRef.endsWith('002')) return route.abort('failed');
        return route.fulfill({json: {ok:true, message:'Correction saved.'}});
      }
      assert.equal(body.AccountRef, 'TEST/22/001');
      if (body.action === 'previewObsoleteReversal') return route.fulfill({json: posted
        ? {...plan, ready: false, amount: 0, charges: [], conflicts: [], reason: 'No eligible obsolete textbook or yearbook charges in this period.'} : uniformMode ? uniformPlan : plan});
      assert.equal(body.action, 'applyObsoleteReversal'); assert.equal(body.PreviewToken, plan.previewToken);
      assert.ok(body.Reason); posted = true;
      if (lostResponse) return route.abort('failed');
      return route.fulfill({json: {ok: true, message: 'Charge corrected. Original invoices, payments and receipts preserved.'}});
    }
    if (['/js/obsolete-charge-review.js', '/js/boarding-wear-bulk.js'].includes(path)) return route.fulfill({contentType: 'text/javascript', body: await read(path.slice(1))});
    assert.equal(path, '/', 'Unexpected request');
    return route.fulfill({contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><p id="status"></p><main id="panel"></main><dialog id="studentBillingPreviewDialog" class="workflow-dialog student-profile-dialog"><div class="workflow-dialog-header"><div><small>Read-only finance review</small><h2>Student billing reconciliation preview</h2></div><button type="button" id="close-review" aria-label="Close billing review">&times;</button></div><div class="config-group" data-billing-preview-content></div></dialog>'});
  });
  await page.goto('https://billing-fixture.test/');
  await page.addStyleTag({content: (await read('css/style.css')).replace(/@import[^;]+;/g, '')});
  await page.addScriptTag({content: await read('js/app-dialogs.js')});
  await page.addScriptTag({content: `
    let currentUser={role:'Super Admin'},selectedBranchId='main',activeSection='students';
    const panelEl=document.getElementById('panel'), maintenanceStatus=document.getElementById('status'),staffSessionAbortController=new AbortController();
    const staffFetch=(url,options)=>fetch(url,options);
    const money=value=>'₦'+Number(value).toLocaleString('en-NG',{minimumFractionDigits:2,maximumFractionDigits:2});
    ${declarations}
    ${handler}
    const dialog=document.getElementById('studentBillingPreviewDialog'),content=document.querySelector('[data-billing-preview-content]');
    document.getElementById('close-review').onclick=()=>dialog.close();
    window.renderReport=(readOnly=false,batch=false)=>{currentUser={role:'Super Admin',subscriptionReadOnly:readOnly};selectedBranchId='main';content.innerHTML=batch?${JSON.stringify(batchMarkup)}:${JSON.stringify(markup)};bindBillingConflictButtons(content);if(!dialog.open)dialog.showModal();};
    renderReport();
  `});
  await page.getByRole('button', {name: 'Review / resolve conflicts', exact: true}).click();
  await page.getByRole('button', {name: 'Approve this charge correction', exact: true}).waitFor();
  assert.equal(calls.length, 1); assert.equal(calls[0].action, 'previewObsoleteReversal');
  assert.match(await page.locator('[data-billing-preview-content]').innerText(), /Grade 11.*Grade 10/);
  await page.getByRole('button', {name: 'Approve this charge correction', exact: true}).click();
  await page.getByRole('heading', {name: 'Correction reason required', exact: true}).waitFor();
  await page.getByRole('button', {name: 'Close', exact: true}).click(); assert.equal(calls.length, 1);
  await page.getByLabel('Correction reason', {exact: true}).fill('Verified current class; this textbook charge belongs to Grade 11.');
  await page.getByRole('button', {name: 'Approve this charge correction', exact: true}).click();
  await page.getByRole('button', {name: 'Cancel', exact: true}).click(); assert.equal(calls.length, 1);
  await page.screenshot({path: 'tmp/billing-conflict-ui/review-desktop.png'});
  await page.setViewportSize({width: 390, height: 844});
  await page.screenshot({path: 'tmp/billing-conflict-ui/review-mobile.png'});
  assert.ok(await page.locator('#studentBillingPreviewDialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
  await page.getByRole('button', {name: 'Approve this charge correction', exact: true}).click();
  await page.getByRole('button', {name: 'Approve correction', exact: true}).click();
  await page.getByRole('heading', {name: 'Charge correction posted', exact: true}).waitFor();
  await page.getByRole('button', {name: 'Close', exact: true}).click();
  assert.equal(calls.filter(row => row.action === 'applyObsoleteReversal').length, 1);
  assert.equal(await page.getByRole('button', {name: 'Correction posted', exact: true}).isDisabled(), true);
  const callsBeforeBack=calls.length;
  await page.getByRole('button', {name:'Back to loaded review',exact:true}).click();
  assert.equal(calls.length,callsBeforeBack,'Return retains the loaded report without a read');
  await page.getByRole('button', {name:'Correction posted — recheck',exact:true}).click();
  await page.getByText('No conflicting posted charges remain for this period.', {exact: true}).waitFor();
  await page.getByRole('button', {name: 'Recheck this account', exact: true}).click();
  await page.getByText('No conflicting posted charges remain for this period.', {exact: true}).waitFor();
  assert.equal(calls.length, 4); assert.equal(await page.locator('[data-post-conflict]').count(), 0);
  await page.getByRole('button', {name: 'Close billing review', exact: true}).click();

  // Lost responses remain non-retryable until a new read, and read-only staff cannot post.
  posted = false; lostResponse = true;
  await page.evaluate(() => renderReport());
  await page.getByRole('button', {name: 'Review / resolve conflicts', exact: true}).click();
  await page.getByLabel('Correction reason', {exact: true}).fill('Reviewed class mismatch.');
  await page.getByRole('button', {name: 'Approve this charge correction', exact: true}).click();
  await page.getByRole('button', {name: 'Approve correction', exact: true}).click();
  await page.getByRole('button', {name: 'Recheck required', exact: true}).waitFor();
  assert.equal(await page.getByRole('button', {name: 'Recheck required', exact: true}).isDisabled(), true);
  assert.equal(calls.filter(row => row.action === 'applyObsoleteReversal').length, 2);
  await page.getByRole('button', {name: 'Close billing review', exact: true}).click();
  posted = false; lostResponse = false; uniformMode = true;
  await page.evaluate(() => renderReport(true));
  await page.getByRole('button', {name: 'Review / resolve conflicts', exact: true}).click();
  await page.getByRole('button', {name: 'Recheck this account', exact: true}).waitFor();
  assert.equal(await page.locator('[data-post-conflict]').count(), 0);
  assert.match(await page.locator('[data-billing-preview-content]').innerText(), /Boys uniforms: ₦178,000.00/);
  assert.match(await page.locator('[data-billing-preview-content]').innerText(), /does not record a new payment/);
  await page.screenshot({path: 'tmp/billing-conflict-ui/uniform-mobile.png'});
  await page.getByRole('button', {name: 'Close billing review', exact: true}).click();

  // Batch: only loaded accounts; selection, partial outcomes, no retry, retained rows.
  batchMode=true;
  await page.evaluate(()=>renderReport(false,true));
  const initialReads=calls.length;
  await page.getByRole('button',{name:'Batch review / approve loaded conflicts',exact:true}).click();
  await page.getByRole('button',{name:'Approve selected corrections',exact:true}).waitFor();
  assert.equal(calls.length-initialReads,4);
  assert.equal(await page.locator('[data-batch-account]').count(),3);
  await page.locator('[data-batch-account="2"]').uncheck();
  await page.getByLabel('Approval reason',{exact:true}).fill('Confirmed obsolete charges against saved classifications.');
  await page.screenshot({path:'tmp/billing-conflict-ui/batch-mobile.png'});
  await page.getByRole('button',{name:'Approve selected corrections',exact:true}).click();
  await page.getByRole('button',{name:'Approve selected',exact:true}).click();
  await page.getByText('1 corrected; 1 need rechecking; 2 left unchanged.',{exact:true}).waitFor();
  assert.deepEqual([...batchPosted],batchRefs.slice(0,2));
  const afterBatch=calls.length;
  await page.getByRole('button',{name:'Back to loaded review',exact:true}).click();
  assert.equal(calls.length,afterBatch);
  assert.equal(await page.locator('[data-review-billing-conflicts]').count(),4);
  await page.getByRole('button',{name:'Posting unconfirmed — recheck',exact:true}).waitFor();
  await page.getByRole('button',{name:'Batch review / approve loaded conflicts',exact:true}).click();
  await page.getByRole('button',{name:'Approve selected corrections',exact:true}).waitFor();
  assert.deepEqual(calls.slice(afterBatch).map(row=>row.AccountRef),batchRefs.slice(2),'Posted and unconfirmed accounts are excluded from the next batch');
  await page.getByRole('button',{name:'Back to loaded review',exact:true}).click();
  await page.getByRole('button',{name:'Close billing review',exact:true}).click();
  await page.evaluate(()=>renderReport(true,true));
  await page.getByRole('button',{name:'Batch review / approve loaded conflicts',exact:true}).click();
  await page.getByText('Verified accounts to correct',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-batch-post]').count(),0,'Read-only users cannot approve a batch');
  await page.getByRole('button',{name:'Back to loaded review',exact:true}).click();
  await page.evaluate(()=>document.querySelectorAll('[data-review-billing-conflicts]').forEach(button=>button.dataset.billingCorrection='posted'));
  const beforeEmpty=calls.length;
  await page.getByRole('button',{name:'Batch review / approve loaded conflicts',exact:true}).click();
  assert.equal(calls.length,beforeEmpty,'An exhausted batch never requests a new school-wide roster');
  await page.getByRole('button',{name:'Close billing review',exact:true}).click();
  batchMode=false;
  await page.evaluate(() => renderReport());
  await page.getByRole('button', {name: 'Review / resolve conflicts', exact: true}).click();
  await page.getByLabel('Correction reason', {exact: true}).fill('Reviewed class mismatch.');
  await page.getByRole('button', {name: 'Approve this charge correction', exact: true}).click();
  await page.evaluate(() => { selectedBranchId='another-branch'; });
  await page.getByRole('button', {name: 'Approve correction', exact: true}).click();
  assert.equal(calls.filter(row => row.action === 'applyObsoleteReversal').length, 4, 'No write after scope change');
  assert.deepEqual(errors, []);
  console.log('PASS: direct row resolution, one-account reads, desktop/mobile preview, reason and confirmation, single posting, recheck, lost-response handling, read-only and branch guards.');
} finally { await browser.close(); }
