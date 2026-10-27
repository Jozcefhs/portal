import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { fixture, renderWorkspace, extractFunction, source } from './helpers/academic-register-fixture.mjs';
import { academicManagementCapabilities, academicWebActor } from '../functions/lib/academic-management.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const input = fixture();
input.data.permissions = academicManagementCapabilities(academicWebActor({ role: 'Super Admin', edition: 'school', allowedSections: ['academics'] }));
input.data.sections = ['secondary'];
input.data.sessions = [{ SessionId: 'session', Name: '2026/2027' }];
input.data.terms = [{ SessionId: 'session', TermId: 'term', Name: 'First Term' }];
const register = renderWorkspace('scorebook', input).match(/<form[^>]*data-academic-class-score-register>[\s\S]*?<\/form>/)[0];
const functions = ['academicRecordId', 'academicIsActive', 'academicFind', 'academicLabel', 'academicSelectOptions', 'academicLearnerTerms',
  'academicManagementViews', 'academicManagementHeader', 'openAcademicClassScoreRegister', 'bindAcademicAreaNavigation',
  'showAcademicManagementTask', 'academicClassRegisterView', 'academicClassRegisterTable', 'academicClassRegisterPrintHtml',
  'bindAcademicClassRegisterSubjectDismissal', 'createAcademicClassRegisterCache', 'bindAcademicClassScoreRegister'].map(extractFunction).join('\n');
const loader = source.match(/async function loadAcademicManagement\([\s\S]*?\n}/)[0];
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 980 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<body class="staff-page"><main id="panel" style="margin:20px"></main></body>');
  for (const file of ['css/style.css', 'css/academic-class-score-register.css']) await page.addStyleTag({ content: await readFile(new URL(`../${file}`, import.meta.url), 'utf8') });
  await page.addScriptTag({ content: `const clean=v=>String(v??'').trim();
    const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const panelEl=document.querySelector('#panel'), currentUser={role:'Super Admin'}, selectedBranchId='main', availableBranches=[{id:'main',name:'Main Branch'}];
    let academicManagementData=${JSON.stringify(input.data)},academicManagementView='scorebook',academicManagementLoadRequest=0,activeSection='academics';
    const academicManagementTaskViews={scorebook:'entry'},academicManagementFilters={section:'secondary',sessionId:'session',termId:'term'},requests=[];
    const setStatus=(node,text)=>{if(node)node.textContent=text;},updateTutorialControls=()=>{};
    const academicManagementRequest=async(action,payload)=>{requests.push({action,payload});
      if(action==='bootstrap')return {...academicManagementData,workspaceDataDeferred:false,scorebookWorkspaceDeferred:true};
      return {classScoreRegister:{ClassId:'class',ClassName:'Grade 10',SessionId:'session',TermId:'term',StudentCount:1,SubjectCount:1,
        Columns:[{Id:'math-ca1',SubjectId:'math',SubjectName:'Mathematics',TestId:'ca1',TestName:'CA1'}],
        Rows:[{StudentRef:'TEST/001',StudentName:'Sample Student',ArmName:'Brilliance',Cells:[{ColumnId:'math-ca1',State:'Numeric',RawScore:85,MaximumScore:100}]}]}};};
    ${functions}
    ${loader}
    function renderAcademicManagement(data){academicManagementData=data;panelEl.innerHTML=academicManagementHeader(data,{})+
      '<section class="academic-management-workspace" data-academic-task-workspace="scorebook"><button data-academic-task="classRegister">Class score register</button><div data-academic-task-panel="classRegister">'+${JSON.stringify(register)}+'</div></section>';
      bindAcademicAreaNavigation();bindAcademicClassScoreRegister(panelEl.querySelector('form'));showAcademicManagementTask('scorebook','classRegister');}
    function showDeferred(){academicManagementView='scorebook';academicManagementTaskViews.scorebook='entry';academicManagementData.workspaceDataDeferred=true;
      panelEl.innerHTML=academicManagementHeader(academicManagementData,{})+'<section>Settings loaded. Choose the records to load.</section>';bindAcademicAreaNavigation();}
    showDeferred();` });
  assert.equal(await page.locator('[data-academic-class-score-register]').count(), 0);
  assert.equal(await page.locator('[data-academic-open-score-register]').isVisible(), true);
  await page.click('[data-academic-open-score-register]');
  await page.waitForSelector('[data-academic-class-score-register]');
  assert.equal(await page.locator('[data-academic-view-select]').inputValue(), 'classRegister');
  assert.deepEqual(await page.evaluate(() => requests.map(row => [row.action, row.payload.ScorebookTask, row.payload.WorkspaceLoadMode])), [['bootstrap', 'classRegister', 'navigation']]);
  await page.selectOption('[name=ClassId]', 'class'); await page.click('button[type=submit]');
  await page.waitForSelector('tbody tr');
  await page.click('[data-academic-open-score-register]');
  assert.equal(await page.evaluate(() => requests.length), 2);
  assert.match(await page.locator('tbody').textContent(), /85 \/ 100/);
  const [preview] = await Promise.all([page.waitForEvent('popup'), page.click('[data-class-register-print]')]);
  await preview.waitForLoadState('domcontentloaded'); assert.match(await preview.locator('tbody').textContent(), /Sample Student/); await preview.close();
  assert.equal(await page.evaluate(() => requests.length), 2);
  await page.screenshot({ path: 'tmp/super-admin-score-register-1366.png', fullPage: true });
  await page.evaluate(() => showDeferred());
  await page.selectOption('[data-academic-view-select]', 'classRegister');
  await page.waitForSelector('[data-academic-class-score-register]');
  assert.equal(await page.evaluate(() => requests.at(-1).payload.ScorebookTask), 'classRegister');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('[data-academic-open-score-register]').isVisible(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: 'tmp/super-admin-score-register-390.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS: Super Admin button and area option bypass deferred entry, use selector-only navigation, preserve mounted scores, print, and fit mobile.');
} finally { await browser.close(); }
