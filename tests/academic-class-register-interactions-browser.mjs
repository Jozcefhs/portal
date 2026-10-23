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

  // Score filters work on the loaded snapshot, including pagination and print, without writes or reloads.
  await page.evaluate(() => {
    report.Rows.forEach((row, index) => {
      if (index % 2) Object.assign(row.Cells[0], { State: 'Not recorded', RawScore: null });
    });
    Object.assign(report.Rows[0].Cells[2], { State: 'Not recorded', RawScore: null });
  });
  const originalReport = await page.evaluate(() => JSON.stringify(report));
  const requestCount = await page.evaluate(() => requests);
  await page.selectOption('[name=TestId]', 'CA1');
  await summary.click();
  await page.click('[data-class-register-subject-action="none"]');
  await page.check('[data-class-register-subject][value=s0]');
  await page.locator('[name=ScoreFilter]').focus();
  await page.selectOption('[name=ScoreFilter]', 'missing');
  assert.equal(await isOpen(), false);
  assert.equal(await page.locator('[name=ScoreThreshold]').isVisible(), false);
  assert.match(await page.locator('[data-class-register-count]').textContent(), /1–30 of 32 students/);
  await page.click('[data-class-register-page="1"]');
  assert.match(await page.locator('[data-class-register-count]').textContent(), /31–32 of 32 students/);
  await page.fill('[name=Query]', 'TEST/063');
  assert.match(await page.locator('[data-class-register-count]').textContent(), /1–1 of 1 students/);
  await page.fill('[name=Query]', '');
  await page.selectOption('[name=TestId]', 'Exam');
  assert.match(await page.locator('[data-class-register-count]').textContent(), /0–0 of 0 students/);
  assert.equal(await page.locator('[data-class-register-print]').isDisabled(), true);
  await page.selectOption('[name=TestId]', 'CA1');
  const [missingPrint] = await Promise.all([page.waitForEvent('popup'), page.click('[data-class-register-print]')]);
  await missingPrint.waitForLoadState('domcontentloaded');
  assert.equal(await missingPrint.locator('tbody tr').count(), 32);
  assert.match(await missingPrint.locator('body').textContent(), /Missing scores in at least one selected subject\/test/);
  assert.doesNotMatch(await missingPrint.locator('tbody').textContent(), /TEST\/000/);
  await missingPrint.close();
  await page.selectOption('[name=ScoreFilter]', 'below');
  assert.equal(await page.locator('[name=ScoreThreshold]').isVisible(), true);
  assert.equal(await page.locator('[data-class-register-print]').isDisabled(), true);
  await page.fill('[name=ScoreThreshold]', '32');
  assert.match(await page.locator('[data-class-register-count]').textContent(), /1–16 of 16 students/);
  assert.match(await scroller.locator('tbody').textContent(), /TEST\/000/);
  assert.doesNotMatch(await scroller.locator('tbody').textContent(), /TEST\/032|TEST\/001/);
  await summary.click();
  await page.check('[data-class-register-subject][value=s1]');
  await page.locator('[name=ScoreThreshold]').focus();
  assert.match(await page.locator('[data-class-register-count]').textContent(), /1–30 of 32 students/);
  await page.click('[data-class-register-page="1"]');
  await page.fill('[name=ScoreThreshold]', '10.5');
  assert.match(await page.locator('[data-class-register-count]').textContent(), /1–11 of 11 students/);
  const [lowPrint] = await Promise.all([page.waitForEvent('popup'), page.click('[data-class-register-print]')]);
  await lowPrint.waitForLoadState('domcontentloaded');
  assert.equal(await lowPrint.locator('tbody tr').count(), 11);
  assert.match(await lowPrint.locator('body').textContent(), /Raw score below 10.5/);
  await lowPrint.close();
  await page.fill('[name=ScoreThreshold]', '-1');
  assert.equal(await page.locator('[data-class-register-print]').isDisabled(), true);
  assert.match(await scroller.textContent(), /Enter a valid raw-score threshold/);
  await page.fill('[name=ScoreThreshold]', '32');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: 'tmp/class-score-filters-390.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 980 });
  await page.screenshot({ path: 'tmp/class-score-filters-1280.png', fullPage: true });
  await page.selectOption('[name=ScoreFilter]', 'all');
  assert.equal(await page.locator('[name=ScoreThreshold]').isVisible(), false);
  assert.match(await page.locator('[data-class-register-count]').textContent(), /1–30 of 65 students/);
  assert.equal(await page.evaluate(() => JSON.stringify(report)), originalReport);
  assert.equal(await page.evaluate(() => requests), requestCount);

  // The new all-missing option must not behave like the existing any-missing option.
  await page.selectOption('[name=ScoreFilter]', 'missing-all');
  assert.match(await page.locator('[data-class-register-count]').textContent(), /0–0 of 0 students/);
  assert.equal(await page.locator('[data-class-register-print]').isDisabled(), true);
  await page.evaluate(() => {
    report.Rows.forEach((row, index) => {
      if (index % 2) Object.assign(row.Cells[2], { State: 'Not recorded', RawScore: null });
    });
  });
  const allMissingSnapshot = await page.evaluate(() => JSON.stringify(report));
  await page.selectOption('[name=ScoreFilter]', 'missing');
  assert.match(await page.locator('[data-class-register-count]').textContent(), /1–30 of 33 students/);
  await page.click('[data-class-register-page="1"]');
  await page.selectOption('[name=ScoreFilter]', 'missing-all');
  assert.match(await page.locator('[data-class-register-count]').textContent(), /1–30 of 32 students/);
  assert.doesNotMatch(await scroller.locator('tbody').textContent(), /TEST\/000/); // Zero is a score.
  await page.click('[data-class-register-page="1"]');
  assert.match(await page.locator('[data-class-register-count]').textContent(), /31–32 of 32 students/);
  const [noScoresPrint] = await Promise.all([page.waitForEvent('popup'), page.click('[data-class-register-print]')]);
  await noScoresPrint.waitForLoadState('domcontentloaded');
  assert.equal(await noScoresPrint.locator('tbody tr').count(), 32);
  assert.match(await noScoresPrint.locator('body').textContent(), /No scores at all/);
  assert.doesNotMatch(await noScoresPrint.locator('tbody').textContent(), /TEST\/000/);
  await noScoresPrint.close();
  await page.fill('[name=Query]', 'TEST/063');
  assert.match(await page.locator('[data-class-register-count]').textContent(), /1–1 of 1 students/);
  await page.fill('[name=Query]', '');
  await page.selectOption('[name=TestId]', 'Exam');
  assert.match(await page.locator('[data-class-register-count]').textContent(), /0–0 of 0 students/);
  await page.selectOption('[name=TestId]', 'CA1');
  await summary.click();
  await page.click('[data-class-register-subject-action="none"]');
  assert.equal(await page.locator('[data-class-register-print]').isDisabled(), true);
  assert.match(await page.locator('[data-class-register-count]').textContent(), /0–0 of 0 students/);
  await page.check('[data-class-register-subject][value=s0]');
  assert.match(await page.locator('[data-class-register-count]').textContent(), /1–30 of 32 students/);
  await page.click('[data-class-register-subject-action="all"]');
  assert.match(await page.locator('[data-class-register-count]').textContent(), /0–0 of 0 students/);
  await page.locator('[name=ScoreFilter]').focus();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.locator('[name=ScoreThreshold]').isVisible(), false);
  assert.equal(await page.evaluate(() => JSON.stringify(report)), allMissingSnapshot);
  assert.equal(await page.evaluate(() => requests), requestCount);
  await summary.click();
  await page.selectOption('[name=ClassId]', '');
  assert.equal(await isOpen(), false);
  assert.equal(await panel.isVisible(), false);
  assert.equal(await scroller.locator('tbody tr').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: Subjects dismissal, pinned Student/header, separate any-missing/all-missing/below filters, strict thresholds including zero, subject/test/search intersections, pagination reset, filtered print, mobile layout, and no score writes or extra requests.');
} finally { await browser.close(); }
