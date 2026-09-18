import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [apiSource, dashboardSource, dashboardHtml, styleSource, adminSource] = await Promise.all([
  readFile(new URL('../functions/api/parent-dashboard.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/parent-dashboard.js', import.meta.url), 'utf8'),
  readFile(new URL('../parent-dashboard.html', import.meta.url), 'utf8'),
  readFile(new URL('../css/style.css', import.meta.url), 'utf8'),
  readFile(new URL('../js/admin.js', import.meta.url), 'utf8')
]);

test('AM-001 parent activity resolves only scoped academic results and active clearances', () => {
  assert.match(apiSource, /queryRowsForReferences\(env, 'academicResults'/);
  assert.match(apiSource, /queryRowsForReferences\(env, 'academicResultClearances'/);
  assert.match(apiSource, /recordMatchesSelectedChildScope\(row, selectedScope\)/);
  assert.match(apiSource, /academicResultBelongsToChild\(row, child\)/);
  assert.match(apiSource, /loadAcademicPolicyView/);
  assert.match(apiSource, /academicPolicyIssues\(activePolicy, \{ forActivation: true \}\)/);
});

test('AM-001 result view, denial, exemption use and print are audited without finance details', () => {
  assert.match(apiSource, /academicResultAccessAudits/);
  assert.match(apiSource, /DecisionCode/);
  assert.match(apiSource, /UsedExemption/);
  assert.doesNotMatch(apiSource, /Results: results\.map[\s\S]{0,500}(?:OutstandingBalance|TotalDebit|TotalCredit)/);
  assert.match(apiSource, /action === 'getAcademicResultForPrint'/);
  assert.match(apiSource, /academicResultPurpose: 'Print'/);
});

test('AM-001 parent Results tab renders only server-approved details and rechecks before printing', () => {
  assert.match(dashboardHtml, /id="academicTermResults"/);
  assert.match(dashboardHtml, /js\/parent-dashboard\.js\?v=20260918-parent-documents/);
  assert.match(dashboardSource, /function renderAcademicResults\(child\)/);
  assert.match(dashboardSource, /if \(!record\.Access\?\.Allowed\)/);
  assert.match(dashboardSource, /action: 'getAcademicResultForPrint'/);
  assert.match(dashboardSource, /Rechecking result access/);
  assert.match(styleSource, /\.academic-result-restricted/);
});

test('Milestone 9 parent progress and printing use only permitted result fields and public verification references', () => {
  assert.match(dashboardSource, /className = 'academic-progress-overview'/);
  assert.match(dashboardSource, /Subjects to watch:/);
  assert.match(dashboardSource, /Approved recommendation:/);
  assert.match(dashboardSource, /current\.Attendance\?\.AttendancePercentage/);
  assert.match(dashboardSource, /api\/academic-result-qr\?reference=/);
  assert.match(dashboardSource, /verify-result\.html\?reference=/);
  assert.match(styleSource, /\.academic-progress-overview/);
});

test('academic result samples mirror the official printable result structure', () => {
  const officialColumns = '<th>Subject</th><th>Total</th><th>Grade</th><th>Point</th><th>Position / assessed</th><th>Remark</th>';
  assert.equal(dashboardSource.includes(officialColumns), true);
  assert.equal(adminSource.includes(officialColumns), true);
  for (const source of [dashboardSource, adminSource]) {
    assert.match(source, /class="report-table identity-table"/);
    assert.match(source, /class="report-table subject-table"/);
    assert.match(source, /class="report-table summary-table"/);
    assert.match(source, /class="report-table remarks-table"/);
    assert.match(source, /class="report-table criteria-table"/);
    assert.match(source, /class="report-table verification-table"/);
    assert.match(source, /<th>Grade key<\/th><th>Junior<\/th><th>Senior<\/th>/);
    assert.match(source, /Academic session/);
    assert.match(source, /Official stamp/);
    assert.match(source, /api\/academic-result-qr\?reference=/);
  }
  assert.match(adminSource, /SAMPLE PREVIEW · NOT AN OFFICIAL RESULT/);
});
