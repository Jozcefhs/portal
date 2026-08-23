import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [apiSource, dashboardSource, dashboardHtml, styleSource] = await Promise.all([
  readFile(new URL('../functions/api/parent-dashboard.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/parent-dashboard.js', import.meta.url), 'utf8'),
  readFile(new URL('../parent-dashboard.html', import.meta.url), 'utf8'),
  readFile(new URL('../css/style.css', import.meta.url), 'utf8')
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
  assert.match(dashboardHtml, /js\/parent-dashboard\.js\?v=20260823-student-nin-onboarding/);
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
