import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const clean = value => String(value ?? '').trim();
const escapeHtml = value => clean(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

function resultActions(row, permissions) {
  const context = vm.createContext({ clean, escapeHtml });
  const start = source.indexOf('function academicTermResultActions(');
  const end = source.indexOf('function academicMidTermNotTaughtMarkup(', start);
  vm.runInContext(source.slice(start, end), context);
  return context.academicTermResultActions({ ResultId: 'result', RevisionToken: 'revision', ...row }, permissions);
}

test('reviewers can reopen reviewed and approved results without first publishing them', () => {
  for (const Status of ['Reviewed', 'Approved', 'Withdrawn']) {
    const html = resultActions({ Status }, { canReviewResults: true });
    assert.match(html, /data-academic-result-status="Calculated Draft"/);
    assert.match(html, /Reopen for controlled correction/);
    assert.match(html, /data-academic-result-id="result"/);
    assert.match(html, /data-academic-revision="revision"/);
    assert.doesNotMatch(resultActions({ Status }, {}), /data-academic-result-status="Calculated Draft"/);
  }
});

test('published and locked results still require withdrawal before reopening', () => {
  for (const Status of ['Published', 'Locked']) {
    const html = resultActions({ Status }, { canReviewResults: true, canPublishResults: true });
    assert.match(html, /data-academic-result-status="Withdrawn"/);
    assert.doesNotMatch(html, /data-academic-result-status="Calculated Draft"/);
    assert.doesNotMatch(resultActions({ Status }, { canReviewResults: true }), /data-academic-result-status="Withdrawn"/);
  }
});

test('pending and stale drafts offer recalculation instead of an unusable review action',()=>{
  for(const flags of [{CalculationPending:true},{SubjectChangeRecalculationRequired:true}]){
    const html=resultActions({Status:'Calculated Draft',...flags},{canCalculateResults:true,canReviewResults:true});
    assert.match(html,/data-academic-result-recalculate="result"/);
    assert.doesNotMatch(html,/data-academic-result-status="Reviewed"/);
    assert.doesNotMatch(resultActions({Status:'Calculated Draft',...flags},{canReviewResults:true}),/data-academic-result-recalculate/);
  }
  for(const Status of ['Reviewed','Approved','Published','Locked','Withdrawn']){
    assert.doesNotMatch(resultActions({Status},{canCalculateResults:true}),/data-academic-result-recalculate/);
  }
});

function navigationHarness() {
  const loads = [], tasks = [], messages = [], focus = [];
  const context = vm.createContext({ clean, escapeHtml,
    currentUser: { username: 'vp', branchId: 'garden', role: 'Vice Principal Academics' },
    selectedBranchId: 'garden', activeSection: 'academics', academicManagementView: 'students',
    academicManagementFilters: { section: 'secondary', sessionId: 'session', termId: 'term' },
    academicResultDraft: { armId: '' }, academicManagementTaskViews: {}, academicArmSubjectDraft: {},
    academicManagementData: {
      permissions: { canReviewResults: true, canPublishResults: true }, students: [],
      studentMemberships: [{ MembershipId: 'membership', StudentRef: 'S1', BranchId: 'garden',
        SchoolSection: 'secondary', SessionId: 'session', TermId: 'term', ClassId: 'grade-10', ArmId: 'genius',
        PendingSubjectChange: { RequestId: 'request', Impact: { Results: [
          { ResultId: 'mid', Status: 'Published', ResultType: 'Mid-Term' },
          { ResultId: 'end', Status: 'Reviewed', ResultType: 'End of Term' } ] } } }]
    },
    academicRecordId: row => row.MembershipId,
    academicLabel: () => 'Sample learner',
    loadAcademicManagement: async options => loads.push({ ...options }),
    showAcademicManagementTask: (...args) => tasks.push(args),
    document: { getElementById: () => ({}) }, setStatus: (_node, message) => messages.push(message),
    panelEl: { querySelectorAll: () => [{ dataset: { academicSubjectRequestCard: 'request' },
      scrollIntoView: () => focus.push('scroll'), querySelector: () => ({ focus: () => focus.push('decision') }) }] }
  });
  vm.runInContext(source.slice(source.indexOf('function academicSubjectResultContext('),
    source.indexOf('function bindAcademicAreaNavigation(')), context);
  return { context, loads, tasks, messages, focus };
}

test('affected-results shortcut loads just the saved class and returns to the original request with fresh records', async () => {
  const { context, loads, tasks, focus } = navigationHarness();
  assert.equal(loads.length, 0);
  await context.openAcademicSubjectResults('membership', 'request');
  assert.equal(context.academicManagementView, 'results');
  assert.deepEqual(loads, [{ records: true, classId: 'grade-10' }]);
  assert.equal(tasks[0][1], 'workflow');
  const saved = context.academicSubjectResultContext();
  assert.equal(saved.branchId, 'garden');
  assert.equal(saved.studentRef, 'S1');
  assert.equal(context.academicSubjectResultMatches({ StudentRef: 'S1', ResultId: 'mid' }, saved), true);
  assert.equal(context.academicSubjectResultMatches({ StudentRef: 'S2', ResultId: 'mid' }, saved), false);
  assert.equal(context.academicSubjectResultMatches({ StudentRef: 'S1', ResultId: 'new-report-after-request' }, saved), true);
  for (const foreign of [{ BranchId: 'other' }, { SchoolSection: 'primary' }, { SessionId: 'other' }, { TermId: 'other' }]) {
    assert.equal(context.academicSubjectResultMatches({ StudentRef: 'S1', ResultId: 'mid', ...foreign }, saved), false);
  }
  await context.returnToAcademicSubjectRequest();
  assert.deepEqual(loads[1], { records: true, classId: 'grade-10', armId: 'genius' });
  assert.equal(context.academicManagementView, 'students');
  assert.equal(context.academicArmSubjectDraft.armId, 'genius');
  assert.equal(tasks[1][1], 'subjects');
  assert.deepEqual(focus, ['scroll', 'decision']);
});

test('stale requests, foreign scope and missing review permission trigger no results read', async () => {
  const changes = [
    h => { h.context.selectedBranchId = 'other'; },
    h => { h.context.academicManagementFilters.section = 'primary'; },
    h => { h.context.academicManagementFilters.sessionId = 'other'; },
    h => { h.context.academicManagementFilters.termId = 'other'; },
    h => { h.context.academicManagementData.permissions = {}; },
    h => { h.context.academicManagementData.studentMemberships[0].PendingSubjectChange.RequestId = 'new'; }
  ];
  for (const change of changes) {
    const h = navigationHarness(); change(h);
    await h.context.openAcademicSubjectResults('membership', 'request');
    assert.equal(h.loads.length, 0);
  }
});

test('return shortcut becomes invalid when user, branch, section or academic period changes', async () => {
  const changes = [
    h => { h.context.currentUser.username = 'other'; },
    h => { h.context.selectedBranchId = 'other'; },
    h => { h.context.academicManagementFilters.section = 'primary'; },
    h => { h.context.academicManagementFilters.sessionId = 'other'; },
    h => { h.context.academicManagementFilters.termId = 'other'; },
    h => { h.context.activeSection = 'accounts'; }
  ];
  for (const change of changes) {
    const h = navigationHarness();
    await h.context.openAcademicSubjectResults('membership', 'request');
    change(h);
    assert.equal(h.context.academicSubjectResultContext(), null);
    await h.context.returnToAcademicSubjectRequest();
    assert.equal(h.loads.length, 1);
  }
});
