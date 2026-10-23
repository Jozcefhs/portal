import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { fixture, renderWorkspace, extractFunction } from './helpers/academic-register-fixture.mjs';
import { academicAssessmentScheme } from '../functions/lib/academic-scorebook.js';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const input = fixture();
input.data.permissions.canReviewScores = true;
assert.doesNotMatch(renderWorkspace('scorebook', input), /data-class-register-reactivate/);
input.data.permissions.canManageScoreCorrections = true;
const workspace = renderWorkspace('scorebook', input);
const form = workspace.match(/<form[^>]*data-academic-class-score-register>[\s\S]*?<\/form>/)[0];
const register = { ClassId: 'class', ClassName: 'Grade 7', SessionId: 'session', TermId: 'term', StudentCount: 1, SubjectCount: 1,
  Columns: [{ Id: 'math-ca1', SubjectId: 'math', SubjectName: 'Mathematics', TestId: 'ca1', TestName: 'CA1' }],
  Rows: [{ StudentName: 'Fictional learner', StudentRef: 'TEST/001', ArmName: 'Excellence',
    Cells: [{ ColumnId: 'math-ca1', State: 'Numeric', RawScore: 85, MaximumScore: 100, SheetStatus: 'Locked' }] }] };
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.setContent(`<main class="academic-management-workspace">${form}</main>`);
  for (const path of ['css/style.css', 'css/academic-class-score-register.css']) {
    await page.addStyleTag({ content: await readFile(new URL(`../${path}`, import.meta.url), 'utf8') });
  }
  const functions = ['academicClassRegisterView', 'academicClassRegisterTable', 'bindAcademicClassRegisterSubjectDismissal', 'bindAcademicClassScoreRegister'].map(extractFunction).join('\n');
  await page.addScriptTag({ content: `const clean=v=>String(v??'').trim();
    const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const report=${JSON.stringify(register)};
    const calls=[]; let reason=null, promptOptions, pending, rendered;
    const academicManagementFilters={section:'secondary',sessionId:'session',termId:'term'};
    const academicManagementData={scorebookContext:{stale:true}}, academicScorebookDraft={contextKey:'stale'};
    window.DynamaxDialogs={prompt:async options=>{promptOptions=options; return reason;}};
    const renderAcademicManagement=(data,message)=>{rendered={data,message};};
    const academicManagementRequest=async(action,payload)=>{
      calls.push({action,payload});
      if(action==='getAcademicClassScoreRegister')return {classScoreRegister:report};
      return new Promise((resolve,reject)=>{pending={resolve,reject};});
    };
    ${functions}; bindAcademicClassScoreRegister(document.querySelector('form'));` });
  const button = page.locator('[data-class-register-reactivate]');
  assert.equal(await button.isDisabled(), true);
  await page.selectOption('[name=ClassId]', 'class');
  await page.click('button[type=submit]');
  await page.waitForFunction(() => !document.querySelector('[data-class-register-reactivate]').disabled);
  await button.click(); // cancelled prompt
  await page.evaluate(() => { reason = 'x'; });
  await button.click();
  assert.equal(await page.evaluate(() => calls.length), 1);
  await page.fill('[name=Query]', 'no matching student');
  await page.selectOption('[name=TestId]', 'ca1');
  await page.evaluate(() => { reason = 'Reviewed scripts'; });
  await button.click();
  assert.equal(await button.isDisabled(), true);
  assert.equal(await page.locator('[name=ClassId]').isDisabled(), true);
  assert.match(await page.evaluate(() => promptOptions.message), /EVERY arm/);
  assert.deepEqual(await page.evaluate(() => calls.at(-1)), { action: 'reactivateAcademicClassScoreEditing', payload: {
    SchoolSection: 'secondary', SessionId: 'session', TermId: 'term', ClassId: 'class', Reason: 'Reviewed scripts'
  } });
  await page.evaluate(() => pending.reject(new Error('Concurrent save; no scorebooks reopened.')));
  await page.waitForFunction(() => !document.querySelector('[data-class-register-reactivate]').disabled);
  assert.match(await page.locator('[data-class-register-status]').textContent(), /Concurrent save/);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await button.click();
  await page.evaluate(() => pending.resolve({ message: 'Reopened. Marks unchanged.' }));
  await page.waitForFunction(() => Boolean(rendered));
  assert.equal(await page.evaluate(() => academicManagementData.scorebookContext), null);
  assert.equal(await page.evaluate(() => academicScorebookDraft.contextKey), '');
  assert.equal(await button.isDisabled(), true);

  // Both split fields become available under Any, but recorded cells stay locked.
  const scheme = academicAssessmentScheme({ Assessment: { Components: [{ Id: 'exam', Name: 'Exam', MaximumScore: 100,
    WeightPercentage: 100, SourceMode: 'any', ScoreEntryMode: 'objective-theory', ObjectiveMaximumScore: 40,
    TheoryMaximumScore: 60 }], GradeBands: [{ Grade: 'A', MinimumPercentage: 0, MaximumPercentage: 100 }] } });
  input.data.assessmentScheme = scheme;
  input.rows.scoreSheets = [{ SheetId: 'sheet', ClassId: 'class', ArmId: 'arm', SubjectId: 'math', Status: 'Draft' }];
  input.rows.studentScores = [{ SheetId: 'sheet', StudentRef: 'TEST/10', ComponentScores: [{ ComponentId: 'exam', Parts: [
    { PartId: 'objective', State: 'Numeric', RawScore: 32 }, { PartId: 'theory', State: 'Numeric', RawScore: 49 }
  ] }] }];
  await page.setContent(renderWorkspace('scorebook', input));
  const saved = page.locator('tr[data-student-ref="TEST/10"]');
  // Markup uses the row's admission number in a data attribute; select by text if it changes.
  const row = await saved.count() ? saved : page.locator('tr').filter({ hasText: 'TEST/10' }).first();
  assert.equal(await row.locator('input[type=number]:disabled').count(), 2);
  assert.equal(await page.locator('[data-academic-score-part="objective"] input[type=number]:enabled').count(), 5);
  assert.equal(await page.locator('[data-academic-score-part="theory"] input[type=number]:enabled').count(), 5);
  input.rows.scoreSheets[0].ScoreEditingReactivated = true;
  await page.setContent(renderWorkspace('scorebook', input));
  assert.equal(await page.locator('[data-academic-score-part="objective"] input[type=number]:enabled').count(), 6);
  assert.equal(await page.locator('[data-academic-score-part="theory"] input[type=number]:enabled').count(), 6);
  assert.deepEqual(errors, []);
  console.log('PASS: whole-class scope, reason/cancel, busy/error/retry, fresh context, mobile layout, and both split fields with saved-score protection.');
} finally { await browser.close(); }
