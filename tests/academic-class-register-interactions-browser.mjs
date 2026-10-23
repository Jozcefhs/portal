import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { fixture, renderWorkspace, extractFunction } from './helpers/academic-register-fixture.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const input = fixture();
input.data.permissions.canReviewScores = true;
const form = renderWorkspace('scorebook', input).match(/<form[^>]*data-academic-class-score-register>[\s\S]*?<\/form>/)[0];
const Columns = Array.from({ length: 7 }, (_, i) => ['CA1', 'Exam'].map(TestId => ({
  Id: `s${i}-${TestId}`, SubjectId: `s${i}`, SubjectName: `Subject ${i}`, TestId, TestName: TestId
}))).flat();
const report = { ClassId: 'class', ClassName: 'Grade 8', SessionId: 'session', TermId: 'term',
  StudentCount: 65, SubjectCount: 7, Columns,
  Rows: Array.from({ length: 65 }, (_, i) => ({
    StudentName: `Fictional student with a longer name ${i}`, StudentRef: `TEST/${String(i).padStart(3, '0')}`,
    ArmName: 'Excellence', RosterConflict: i === 1,
    Cells: Columns.map(column => ({ ColumnId: column.Id, State: 'Numeric', RawScore: i, MaximumScore: 100, SheetStatus: 'Draft' }))
  })) };
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 980 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.setContent(`<body class="staff-page"><main class="academic-management-workspace" style="margin:20px"><h2 id="outside">Class scores</h2>${form}</main></body>`);
  for (const file of ['css/style.css', 'css/academic-class-score-register.css']) {
    await page.addStyleTag({ content: await readFile(new URL(`../${file}`, import.meta.url), 'utf8') });
  }
  const functions = ['academicRecordId', 'academicFind', 'academicLabel', 'academicClassRegisterView',
    'academicClassRegisterTable', 'academicClassRegisterPrintHtml', 'bindAcademicClassRegisterSubjectDismissal',
    'bindAcademicClassScoreRegister'].map(extractFunction).join('\n');
  await page.addScriptTag({ content: `const clean=v=>String(v??'').trim();
    const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const report=${JSON.stringify(report)}; let holdLoad=false, finishLoad, requests=0;
    const academicManagementRequest=async()=>{requests++;if(holdLoad) await new Promise(resolve=>{finishLoad=resolve;});return {classScoreRegister:report};};
    const academicManagementFilters={section:'secondary',sessionId:'session',termId:'term'};
    const academicManagementData={reportProfile:{SchoolName:'Test Academy'}, sessions:[{SessionId:'session',Name:'2026/2027'}],terms:[{TermId:'term',Name:'First Term'}]};
    ${functions}; bindAcademicClassScoreRegister(document.querySelector('form'));` });
  const menu = page.locator('[data-class-register-subjects]');
  const summary = menu.locator('summary');
  const panel = page.locator('.class-register-subject-panel');
  const isOpen = () => menu.evaluate(element => element.open);
  assert.equal(await isOpen(), false);
  assert.equal(await panel.isVisible(), false);
  await page.selectOption('[name=ClassId]', 'class');
  await page.click('button[type=submit]');
  await page.waitForSelector('tbody tr');
  assert.equal(await isOpen(), false);
  assert.equal(await panel.isVisible(), false);

  await summary.click();
  await page.uncheck('[data-class-register-subject][value=s0]');
  assert.equal(await isOpen(), true);
  assert.match(await summary.textContent(), /6 subjects selected/);
  await page.locator('#outside').click(); // non-focusable, outside the form
  assert.equal(await isOpen(), false);
  await summary.click();
  assert.equal(await page.locator('[data-class-register-subject][value=s0]').isChecked(), false);
  await page.click('[data-class-register-subject-action="all"]');
  assert.equal(await isOpen(), true);
  await page.locator('[data-class-register-subject]').last().focus();
  await page.keyboard.press('Tab');
  assert.equal(await isOpen(), false);
  await summary.click();
  await page.locator('[data-class-register-subject]').first().press('Escape');
  assert.equal(await isOpen(), false);
  assert.equal(await summary.evaluate(element => document.activeElement === element), true);
  await summary.click(); await summary.click();
  assert.equal(await isOpen(), false);

  // Loading must close an open menu, even if it was reopened while awaiting the response.
  await summary.click();
  await page.evaluate(() => { holdLoad = true; });
  await page.click('button[type=submit]');
  assert.equal(await isOpen(), false);
  await summary.click();
  await page.evaluate(() => { holdLoad = false; finishLoad(); });
  await page.waitForFunction(() => !document.querySelector('button[type=submit]').disabled);
  assert.equal(await isOpen(), false);

  const scroller = page.locator('[data-class-register-table]');
  const studentHeader = scroller.locator('thead th').nth(1);
  const student = scroller.locator('tbody tr').first().locator('td').nth(1);
  const mark = scroller.locator('tbody tr').first().locator('td').nth(4);
  const originalMark = await mark.boundingBox();
  await scroller.evaluate(element => { element.scrollLeft = 600; });
  await page.waitForFunction(() => document.querySelector('[data-class-register-table]').scrollLeft === 600);
  const scrollBox = await scroller.boundingBox(), studentBox = await student.boundingBox();
  assert.ok(Math.abs(studentBox.x - scrollBox.x - 1) < 2);
  assert.ok(Math.abs((await studentHeader.boundingBox()).x - studentBox.x) < 2);
  assert.ok(Math.abs(originalMark.x - (await mark.boundingBox()).x - 600) < 2);
  assert.equal(await student.evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(255, 255, 255)');
  assert.equal(await scroller.locator('tbody tr').nth(1).locator('td').nth(1).evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(243, 247, 250)');
  await scroller.evaluate(element => { element.scrollTop = 220; });
  const head = await studentHeader.boundingBox();
  assert.ok(Math.abs(head.y - (await scroller.boundingBox()).y - 1) < 2);
  assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName,
    { x: head.x + 20, y: head.y + 10 }), 'TH');
  await scroller.evaluate(element => { element.scrollTop = 0; });

  // A pinned name must leave room for marks on a small screen, not cover the table.
  await page.setViewportSize({ width: 390, height: 844 });
  await scroller.scrollIntoViewIfNeeded();
  await scroller.evaluate(element => { element.scrollLeft = 800; });
  const mobileBox = await scroller.boundingBox(), mobileName = await student.boundingBox();
  assert.ok(mobileName.width <= 141);
  assert.ok(mobileBox.width - mobileName.width >= 145);
  assert.ok(Math.abs(mobileName.x - mobileBox.x - 1) < 2);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await summary.click();
  await page.locator('#outside').dispatchEvent('pointerdown', { pointerType: 'touch' });
  assert.equal(await isOpen(), false);

  // Print preview uses a separate non-sticky table and still includes all filtered students.
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.click('[data-class-register-print]')]);
  await popup.waitForLoadState('domcontentloaded');
  assert.equal(await popup.locator('tbody tr').count(), 195); // 65 repeated in three subject sections
  assert.equal(await popup.locator('tbody td').nth(1).evaluate(element => getComputedStyle(element).position), 'static');
  await popup.close();
  await summary.click();
  await page.selectOption('[name=ClassId]', '');
  assert.equal(await isOpen(), false);
  assert.equal(await panel.isVisible(), false);
  assert.equal(await scroller.locator('tbody tr').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: closed-on-load Subjects, outside click/touch/tab/Escape dismissal, persistent multi-selection, pinned Student/header on desktop and mobile, and unchanged print preview.');
} finally { await browser.close(); }
