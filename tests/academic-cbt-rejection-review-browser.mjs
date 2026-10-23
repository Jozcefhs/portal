import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { extractFunction } from './helpers/academic-register-fixture.mjs';
import { runInNewContext } from 'node:vm';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
// Reuse the synthetic fixture without registering node:test suites in the browser runner.
const fixtureSource = await readFile(new URL('./academic-cbt-rejection-review.test.mjs', import.meta.url), 'utf8');
const fixture = runInNewContext(`(${fixtureSource.slice(fixtureSource.indexOf('export function fixture()') + 7, fixtureSource.indexOf('\ntest('))})`);
const f = fixture(), original = JSON.stringify(f);
const moduleSource = await readFile(new URL('../js/academic-cbt-rejection-review.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('https://review.test/**', route => route.fulfill(route.request().url().endsWith('/academic-cbt-rejection-review.js')
    ? { contentType: 'text/javascript', body: moduleSource }
    : { contentType: 'text/html', body: '<body><main><button data-academic-cbt-rejections="receipt-1">Review rejected students</button><p id="academicManagementStatus"></p></main></body>' }));
  await page.goto('https://review.test/js/test.html');
  await page.addStyleTag({ content: await readFile(new URL('../css/style.css', import.meta.url), 'utf8') });
  await page.addScriptTag({ content: `
    const f=${JSON.stringify(f)}, clean=v=>String(v??'').trim();
    let academicManagementData=f.data, selectedBranchId='school', currentUser={}, activeSection='academics', academicManagementView='scorebook';
    const academicManagementFilters={section:'secondary',sessionId:'session',termId:'term'}, academicManagementTaskViews={};
    let academicScorebookDraft={}, renderCalls=0, mode='success', pending, calls=[], aborted=0;
    const academicCurrentRows=d=>d, academicIsActive=r=>r.Status!=='Inactive';
    const setStatus=(el,message)=>{el.textContent=message;};
    const renderAcademicManagement=()=>{renderCalls++;};
    const academicManagementRequest=async(action,payload,options)=>{
      calls.push({action,payload});
      if(mode==='fail') throw Error('Temporary connection failure');
      if(mode==='wait') await new Promise((resolve,reject)=>{pending=resolve;options.signal.addEventListener('abort',()=>{aborted++;reject(Error('Aborted'));},{once:true});});
      return {scorebookSnapshot:mode==='wrong'?{...f.snapshot,SheetId:'other-sheet'}:f.snapshot};
    };
    ${extractFunction('bindAcademicCbtRejectionReviews')}
    bindAcademicCbtRejectionReviews(document.querySelector('main'));
  ` });
  const launch = () => page.click('[data-academic-cbt-rejections]');
  const modal = page.locator('.cbt-rejection-review');
  await launch(); await modal.waitFor();
  await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent.startsWith('Current marks checked'));
  assert.equal(await modal.locator('tbody tr').count(), 3);
  assert.match(await modal.textContent(), /An earlier accepted result is preserved/);
  assert.match(await modal.textContent(), /0 \/ 100/);
  assert.match(await modal.textContent(), /85 \/ 100/);
  const technical = modal.locator('details.review-technical-details').first();
  assert.equal(await technical.count(), 1);
  assert.equal(await technical.evaluate(el => el.open), false);
  assert.equal(await technical.locator('small').isVisible(), false);
  assert.doesNotMatch(await modal.innerText(), /Saved attempt:|Saved test:/);
  await technical.locator('summary').click();
  assert.equal(await technical.locator('small').isVisible(), true);
  assert.match(await modal.innerText(), /Saved attempt: first-attempt/);
  assert.match(await modal.innerText(), /Saved test: original-test/);
  await technical.locator('summary').press('Enter');
  assert.equal(await technical.evaluate(el => el.open), false);
  await technical.locator('summary').press('Space');
  assert.equal(await technical.evaluate(el => el.open), true);
  await modal.locator('[data-refresh]').click();
  await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent.startsWith('Current marks checked'));
  assert.equal(await technical.evaluate(el => el.open), false);
  assert.doesNotMatch(await modal.innerText(), /Saved attempt:|Saved test:/);
  const [technicalPreview] = await Promise.all([page.waitForEvent('popup'), modal.locator('[data-print]').click()]);
  await technicalPreview.waitForLoadState('domcontentloaded');
  const printTechnical = technicalPreview.locator('details.review-technical-details').first();
  assert.equal(await printTechnical.evaluate(el => el.open), false);
  assert.equal(await printTechnical.locator('small').isVisible(), false);
  await printTechnical.locator('summary').click();
  assert.match(await technicalPreview.locator('body').innerText(), /Saved test: original-test/);
  await printTechnical.locator('summary').click();
  await technicalPreview.emulateMedia({ media: 'print' });
  assert.equal(await printTechnical.isVisible(), false);
  await technicalPreview.close();
  await modal.locator('[data-search]').fill('test/002');
  assert.equal(await modal.locator('tbody tr').count(), 1);
  const [popup] = await Promise.all([page.waitForEvent('popup'), modal.locator('[data-print]').click()]);
  await popup.waitForLoadState('domcontentloaded');
  assert.match(await popup.locator('body').textContent(), /Ben/);
  assert.doesNotMatch(await popup.locator('body').textContent(), /Chidi|TEST\/001/);
  await popup.close();
  await modal.locator('[data-search]').fill('');
  await page.screenshot({ path: 'tmp/cbt-rejection-review-1280.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: 'tmp/cbt-rejection-review-390.png', fullPage: true });
  await modal.locator('[data-close]').click(); await modal.waitFor({ state: 'detached' });
  assert.equal(await page.locator('[data-academic-cbt-rejections]').evaluate(el => document.activeElement === el), true);
  await page.evaluate(() => { mode='fail'; }); await launch();
  await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent.includes('Temporary connection failure'));
  assert.match(await modal.textContent(), /An earlier accepted result/);
  await page.evaluate(() => { mode='success'; }); await modal.locator('[data-refresh]').click();
  await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent.startsWith('Current marks checked'));
  await page.keyboard.press('Escape'); await modal.waitFor({ state: 'detached' });
  await page.evaluate(() => { mode='wait'; }); await launch();
  await page.waitForFunction(() => !!pending);
  await modal.locator('[data-close]').click(); await modal.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => aborted), 1);
  await page.evaluate(() => { mode='wrong'; }); await launch();
  await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent.includes('does not match'));
  assert.doesNotMatch(await modal.textContent(), /85 \/ 100/);
  await modal.locator('[data-close]').click();
  await page.evaluate(() => { mode='success'; }); await launch();
  await modal.locator('[data-scorebook]').click(); await modal.waitFor({ state: 'detached' });
  assert.deepEqual(await page.evaluate(() => ({ classId:academicScorebookDraft.classId, armId:academicScorebookDraft.armId,
    subjectId:academicScorebookDraft.subjectId, task:academicManagementTaskViews.scorebook, renderCalls })),
    { classId:'class', armId:'arm', subjectId:'music', task:'entry', renderCalls:1 });
  await page.evaluate(() => { mode='wait';pending=null; }); await launch();
  await page.waitForFunction(() => !!pending);
  await page.evaluate(() => { selectedBranchId='different-branch';pending(); });
  await modal.waitFor({ state: 'detached' });
  await page.evaluate(() => { selectedBranchId='school';mode='success'; });
  assert.equal(await page.evaluate(() => JSON.stringify(f)), original);
  assert.equal(await page.evaluate(() => calls.every(call => call.action==='getAcademicScorebookContext'
    && call.payload.SheetId==='sheet-1' && call.payload.ClassId==='class' && call.payload.SubjectId==='music')), true);
  const callsBefore = await page.evaluate(() => calls.length);
  await page.evaluate(() => { academicManagementData.permissions.canReviewScores=false; }); await launch();
  assert.equal(await modal.count(), 0); assert.equal(await page.evaluate(() => calls.length), callsBefore);
  await page.evaluate(() => { academicManagementData.permissions.canReviewScores=true;academicManagementData.scoreSyncBatches[0].RejectedCount=11;academicManagementData.scoreSyncBatches[0].RejectedScores=[]; });
  await launch(); assert.match(await modal.textContent(), /cannot be reconstructed/);
  await modal.locator('[data-close]').click();
  assert.deepEqual(errors, []);
  console.log('PASS: authorised history review, correct scoped snapshot, reasons/zero/corrections, collapsed technical references with mouse/keyboard and print, search/print, desktop/mobile, failure/retry, close/Escape/abort, wrong snapshot and branch guards, legacy warning, scorebook navigation, no writes.');
} finally { await browser.close(); }
