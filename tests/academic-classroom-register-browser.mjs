import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { fixture, renderWorkspace, extractFunction } from './helpers/academic-register-fixture.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const input = fixture();
input.data.permissions.canViewClassroomScores = true;
input.rows.arms.push({ ArmId: 'second', ClassId: 'class', Name: 'Excellence', IsClassroom: true });
input.rows.teacherAllocations.push(...['arm', 'second'].map(ArmId => ({ SessionId: 'session', TermId: 'term', ClassId: 'class', ArmId, AllocationRole: ArmId === 'arm' ? 'Assistant Teacher' : 'Form Teacher' })));
const form = renderWorkspace('scorebook', input).match(/<form[^>]*data-classroom-register[^>]*>[\s\S]*?<\/form>/)[0];
const Columns = ['math', 'eng', 'science'].map(SubjectId => ({ Id: SubjectId, SubjectId,
  SubjectName: { math: 'Mathematics', eng: 'English Language', science: 'Basic Science' }[SubjectId], TestId: 'ca1', TestName: 'CA1' }));
const report = { ClassId: 'class', ClassName: 'Grade 10', ArmId: 'arm', ArmName: 'Brilliance', ClassroomName: 'Grade 10 / Brilliance',
  SessionId: 'session', TermId: 'term', StudentCount: 35, SubjectCount: 3, ReadOnly: true, Columns,
  Rows: Array.from({ length: 35 }, (_, index) => ({ StudentRef: `TEST/${String(index).padStart(3, '0')}`, StudentName: `Fictional Learner ${index}`,
    ArmName: 'Brilliance', Cells: Columns.map(column => ({ ColumnId: column.Id, State: index === 34 ? 'Missing' : 'Numeric',
      RawScore: index === 34 ? null : index, MaximumScore: 100, SheetStatus: 'Draft' })) })) };
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 980 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.setContent(`<body class="staff-page"><main class="academic-management-workspace" style="margin:20px">${form}</main></body>`);
  for (const file of ['css/style.css', 'css/academic-class-score-register.css']) await page.addStyleTag({ content: await readFile(new URL(`../${file}`, import.meta.url), 'utf8') });
  const functions = ['academicRecordId', 'academicFind', 'academicLabel', 'academicClassRegisterView', 'academicClassRegisterTable',
    'academicClassRegisterPrintHtml', 'bindAcademicClassRegisterSubjectDismissal', 'createAcademicClassRegisterCache', 'bindAcademicClassScoreRegister'].map(extractFunction).join('\n');
  await page.addScriptTag({ content: `const clean=v=>String(v??'').trim();
    const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const report=${JSON.stringify(report)}; const requests=[]; let failLoad=false;
    const academicManagementRequest=async(action,input)=>{requests.push({action,input}); if(failLoad)throw Error('Offline');
      return {classScoreRegister:input.ArmId==='second'?{...report,ArmId:'second',ArmName:'Excellence',ClassroomName:'Grade 10 / Excellence'}:report};};
    const academicManagementFilters={section:'secondary',sessionId:'session',termId:'term'};
    const academicManagementData={sessions:[{SessionId:'session',Name:'2026/2027'}],terms:[{TermId:'term',Name:'First Term'}]};
    ${functions};bindAcademicClassScoreRegister(document.querySelector('form'));` });
  assert.equal(await page.evaluate(() => requests.length), 0);
  const reload = page.locator('[data-class-register-reload]');
  assert.equal(await reload.textContent(), 'Load / refresh scores');
  assert.equal(await reload.isVisible(), true);
  assert.equal(await reload.isDisabled(), true);
  assert.equal(await page.locator('[data-class-register-reactivate]').count(), 0);
  await page.selectOption('[name=ClassId]', 'arm');
  assert.equal(await reload.isEnabled(), true);
  await page.click('button[type=submit]');
  await page.waitForSelector('tbody tr');
  assert.deepEqual(await page.evaluate(() => requests[0]), { action: 'getAcademicClassroomScoreRegister',
    input: { SchoolSection: 'secondary', SessionId: 'session', TermId: 'term', ClassId: 'class', ArmId: 'arm' } });
  assert.equal(await page.locator('tbody tr').count(), 30);
  assert.match(await page.locator('[data-class-register-status]').textContent(), /Grade 10 \/ Brilliance: 35 students/);
  assert.doesNotMatch(await page.locator('[data-class-register-status]').textContent(), /all arms/);
  assert.equal(await reload.textContent(), 'Load / refresh scores');
  assert.match(await page.locator('[data-class-register-status]').textContent(), /Use Load \/ refresh scores above/);
  await page.click('[data-class-register-page="1"]');
  assert.equal(await page.locator('tbody tr').count(), 5);
  const [preview] = await Promise.all([page.waitForEvent('popup'), page.click('[data-class-register-print]')]);
  await preview.waitForLoadState('domcontentloaded');
  assert.equal(await preview.locator('tbody tr').count(), 35);
  assert.match(await preview.locator('body').textContent(), /Grade 10 \/ Brilliance — Classroom score register/);
  assert.match(await preview.locator('body').textContent(), /2026\/2027 · First Term/);
  assert.match(await preview.locator('body').textContent(), /TEST\/034/);
  assert.doesNotMatch(await preview.locator('body').textContent(), /All arms/);
  await preview.evaluate(() => { window.print = () => { window.printed = true; }; });
  await preview.click('button'); assert.equal(await preview.evaluate(() => window.printed), true);
  await preview.close();
  assert.equal(await page.evaluate(() => requests.length), 1);
  await page.selectOption('[name=ClassId]', 'second'); await page.click('button[type=submit]');
  await page.waitForFunction(() => document.querySelector('[data-class-register-status]').textContent.includes('Excellence'));
  await page.selectOption('[name=ClassId]', 'arm');
  assert.match(await page.locator('[data-class-register-count]').textContent(), /31–35/);
  assert.equal(await page.evaluate(() => requests.length), 2);
  assert.equal(await reload.textContent(), 'Load / refresh scores');
  await page.selectOption('[name=ScoreFilter]', 'missing');
  assert.equal(await page.locator('tbody tr').count(), 1);
  assert.match(await page.locator('tbody').textContent(), /TEST\/034/);
  assert.equal(await page.evaluate(() => requests.length), 2);
  // Explicit refresh must fetch again even when the classroom has a cached snapshot.
  await page.selectOption('[name=ScoreFilter]', 'all');
  await page.evaluate(() => { report.Rows[0].Cells[0].RawScore = 88; });
  await reload.click();
  await page.waitForFunction(() => requests.length === 3 && !document.querySelector('[data-class-register-reload]').disabled);
  assert.equal(await reload.textContent(), 'Load / refresh scores');
  assert.match(await page.locator('tbody').textContent(), /88 \/ 100/);
  await page.selectOption('[name=ScoreFilter]', 'missing');
  await page.screenshot({ path: 'tmp/classroom-register-1366.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await reload.isVisible(), true);
  const reloadBox = await reload.boundingBox();
  assert.ok(reloadBox.x >= 0 && reloadBox.x + reloadBox.width <= 390);
  await page.screenshot({ path: 'tmp/classroom-register-390.png', fullPage: true });
  await page.evaluate(() => { failLoad = true; }); await page.click('button[type=submit]');
  await page.waitForFunction(() => document.querySelector('[data-class-register-status]').textContent.includes('refresh did not complete'));
  assert.equal(await page.locator('tbody tr').count(), 1);
  assert.equal(await reload.textContent(), 'Load / refresh scores');
  assert.equal(await reload.isEnabled(), true);
  assert.equal(await page.evaluate(() => requests.every(request => request.action === 'getAcademicClassroomScoreRegister')), true);
  assert.deepEqual(errors, []);
  console.log('PASS: Classroom scope, all-subject scores, read-only controls, complete print preview, cached classroom switching, missing-score filter, failed refresh preservation and mobile layout.');
} finally { await browser.close(); }
