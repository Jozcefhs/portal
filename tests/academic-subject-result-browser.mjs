// Synthetic records only. Network is blocked; the navigation loader is an in-memory fixture.
// Run with PLAYWRIGHT_MODULE set to an installed playwright package directory.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { academicManagementCapabilities } from '../functions/lib/academic-management.js';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');
const extract = name => {
  const match = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n}`));
  assert.ok(match, `Missing actual function ${name}`);
  return match[0];
};
const declarations = ['clean', 'escapeHtml', 'academicRecordId', 'academicIsActive', 'academicFind',
  'academicLabel', 'academicSelectOptions', 'academicLearnerTerms', 'academicCurrentRows', 'table',
  'academicSubjectChangeRequests', 'academicTermResultActions', 'academicMidTermNotTaughtMarkup',
  'academicTermResultsWorkspace', 'academicSubjectResultContext', 'academicSubjectResultMatches',
  'openAcademicSubjectResults', 'returnToAcademicSubjectRequest'].map(extract).join('\n');
const bindSource = extract('bindAcademicManagement');
const handlers = bindSource.slice(bindSource.indexOf("  panelEl.querySelectorAll('[data-academic-subject-results]')"),
  bindSource.indexOf('  bindAcademicWorkflowFilters();'));
assert.match(handlers, /returnToAcademicSubjectRequest/);
const fixtureScope = { BranchId: 'main', SchoolSection: 'secondary', SessionId: 'session', TermId: 'term', ClassId: 'class', ArmId: 'arm' };
const result = (ResultId, Status, extra = {}) => ({ ...fixtureScope, StudentRef: 'TEST/1', ResultId, Status,
  ResultType: 'End of Term', RevisionToken: `${ResultId}-fresh`, OverallAverage: 80, Subjects: [], ...extra });
const freshResults = [result('reviewed', 'Reviewed'), result('approved', 'Approved'), result('published', 'Published'),
  result('new-report', 'Locked', { ResultType: 'Mid-Term' }), result('historical-arm', 'Approved', { ArmId: 'old-arm' }),
  result('another-student', 'Approved', { StudentRef: 'TEST/2' }), result('other-term', 'Approved', { TermId: 'past-term' }),
  result('other-branch', 'Approved', { BranchId: 'other' }), result('other-section', 'Approved', { SchoolSection: 'primary' })];
const data = {
  permissions: academicManagementCapabilities({ role: 'Vice Principal Academics', edition: 'school', allowedSections: ['academics'] }),
  sections: ['secondary'], students: [{ StudentRef: 'TEST/1', Name: 'Fixture Student' }, { StudentRef: 'TEST/2', Name: 'Unrelated Student' }],
  classes: [{ ClassId: 'class', Name: 'Grade 10' }],
  arms: [{ ArmId: 'arm', ClassId: 'class', Name: 'Brilliance', Status: 'Active' }, { ArmId: 'old-arm', ClassId: 'class', Name: 'Previous arm', Status: 'Inactive' }],
  subjects: [{ SubjectId: 'catering', Name: 'Catering' }, { SubjectId: 'printing', Name: 'Printing' }], resultEvents: [], termResults: [],
  studentMemberships: [{ ...fixtureScope, MembershipId: 'member', StudentRef: 'TEST/1', RevisionToken: 'member-v1', Status: 'Active',
    PendingSubjectChange: { RequestId: 'request', RequestedByUsername: 'teacher', RequestedBy: 'Fixture Teacher', RequestedAt: '2026-11-04',
      Reason: 'Student requested a different trade', Before: { SubjectIds: ['catering'] }, After: { SubjectIds: ['printing'] },
      Impact: { RecordedSubjectIds: ['catering'], ScoreRecordCount: 1,
        Results: [...freshResults.slice(0, 3), freshResults[4], result('earlier-class', 'Published', { ClassId: 'old-class' })] } } }]
};

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true, timeout: 20000 });
try {
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.setDefaultTimeout(10000);
    const errors = [], network = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => { network.push(route.request().url()); return route.abort(); });
    await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body class="staff-page"><main id="panel" class="academic-management-workspace"></main></body>');
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: `${declarations}
      const panelEl=document.getElementById('panel');
      let currentUser={username:'vp-academics',role:'Vice Principal Academics',branchId:'main'}, selectedBranchId='main', activeSection='academics';
      let academicManagementFilters={section:'secondary',sessionId:'session',termId:'term'}, academicManagementView='students';
      let academicResultDraft={armId:'arm'}, academicArmSubjectDraft={}, academicManagementTaskViews={};
      let academicManagementData=${JSON.stringify(data)};
      const originalData=structuredClone(academicManagementData), freshResults=${JSON.stringify(freshResults)};
      window.readCalls=[]; window.taskCalls=[];
      const ADMIN_LIST_CREATED_FIELDS=[],ADMIN_LIST_MODIFIED_FIELDS=[],ADMIN_LIST_SORT_MODES=[['saved','Saved order']];
      const DynamaxTime={formatCell:value=>value??'',formatDateTime:value=>value};
      const savedAdminListSort=()=> 'saved',adminListNameValue=row=>row.StudentRef||'',adminListTimestamp=()=>0;
      const sortAdminListEntries=rows=>rows,adminListStorageKey=title=>title;
      window.DynamaxAcademicWorkflow={badge:(_status,label)=>escapeHtml(label),resultStatus:row=>row.Status};
      function setStatus(element,message){if(element)element.textContent=message;}
      async function runButtonAction(button,label,action){button.disabled=true;try{return await action();}finally{button.disabled=false;}}
      function showAcademicManagementTask(view,task){window.taskCalls.push({view,task});}
      function bindSubjectNavigation(){${handlers}}
      function renderFixture(){
        panelEl.innerHTML='<p id="academicManagementStatus"></p>'+(academicManagementView==='students'
          ? academicSubjectChangeRequests(academicManagementData)
          : academicTermResultsWorkspace(academicManagementData,academicCurrentRows(academicManagementData)));
        bindSubjectNavigation();
        panelEl.querySelector('[data-academic-result-batch-classroom]')?.addEventListener('change',event=>{
          academicResultDraft.armId=event.target.value;renderFixture();
        });
      }
      async function loadAcademicManagement(options){
        window.readCalls.push({view:academicManagementView,branch:selectedBranchId,...academicManagementFilters,...options});
        await Promise.resolve();
        academicManagementData=structuredClone(originalData);
        if(academicManagementView==='results')academicManagementData.termResults=structuredClone(freshResults);
        renderFixture();
      }
      window.fixtureState=()=>({view:academicManagementView,armDraft:academicArmSubjectDraft,
        sourceUnchanged:JSON.stringify(originalData)===JSON.stringify(${JSON.stringify(data)}),freshResults,
        focusedRequest:document.activeElement?.closest('[data-academic-subject-request-card]')?.dataset.academicSubjectRequestCard});
      renderFixture();` });

    const assertControlVisible = async locator => {
      await locator.scrollIntoViewIfNeeded();
      assert.equal(await locator.isVisible(), true);
      const box = await locator.boundingBox();
      assert.ok(box && box.width > 0 && box.x >= -1 && box.x + box.width <= width + 1,
        `Control stays reachable within ${width}px: ${JSON.stringify(box)}`);
    };
    const open = page.getByRole('button', { name: 'Open affected results', exact: true });
    await assertControlVisible(open);
    await open.click();
    await page.locator('[data-academic-subject-results-notice]').waitFor();
    assert.deepEqual(await page.evaluate(() => readCalls), [{ view: 'results', branch: 'main', section: 'secondary', sessionId: 'session', termId: 'term', records: true, classId: 'class' }]);
    const notice = page.locator('[data-academic-subject-results-notice]');
    assert.match(await notice.innerText(), /not available.*earlier classroom or class/s);
    for (const id of ['reviewed', 'approved']) {
      await assertControlVisible(page.locator(`[data-academic-result-id="${id}"][data-academic-result-status="Calculated Draft"]`));
    }
    for (const id of ['published', 'new-report']) {
      assert.equal(await page.locator(`[data-academic-result-id="${id}"][data-academic-result-status="Withdrawn"]`).count(), 1);
      assert.equal(await page.locator(`[data-academic-result-id="${id}"][data-academic-result-status="Calculated Draft"]`).count(), 0);
    }
    for (const id of ['another-student', 'other-term', 'other-branch', 'other-section', 'earlier-class']) {
      assert.equal(await page.locator(`[data-academic-result-id="${id}"]`).count(), 0, `Exclude ${id}`);
    }
    assert.equal(await page.locator('[data-academic-result-calculator],[data-academic-result-batch]').count(), 0);
    await page.locator('[data-academic-result-batch-classroom]').selectOption('old-arm');
    await assertControlVisible(page.locator('[data-academic-result-id="historical-arm"][data-academic-result-status="Calculated Draft"]'));
    const back = page.getByRole('button', { name: 'Return to subject request', exact: true });
    await assertControlVisible(back); await back.click();
    await page.locator('[data-academic-subject-request-card="request"]').waitFor();
    assert.equal(await page.locator('[data-academic-subject-request-card="request"]').evaluate(element => element.contains(document.activeElement)), true);
    const state = await page.evaluate(() => fixtureState());
    assert.equal(state.view, 'students'); assert.equal(state.focusedRequest, 'request'); assert.equal(state.sourceUnchanged, true);
    assert.deepEqual(state.freshResults, freshResults, 'Navigation never edits result records');
    assert.deepEqual(state.armDraft, { sessionId: 'session', termId: 'term', classId: 'class', armId: 'arm' });
    assert.deepEqual(await page.evaluate(() => readCalls[1]), { view: 'students', branch: 'main', section: 'secondary', sessionId: 'session', termId: 'term', records: true, classId: 'class', armId: 'arm' });
    assert.equal(await page.evaluate(() => readCalls.length), 2, 'Only explicit fresh class reads');
    assert.deepEqual(network, []); assert.deepEqual(errors, []);
    await page.close();
    console.log(`Subject-result navigation ${width}px passed: fresh scoped read, late reports, historical arms, controlled actions, original request focus; no network or result writes.`);
  }
} finally { await browser.close(); }
