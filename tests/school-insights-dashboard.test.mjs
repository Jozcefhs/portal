import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const portalRoot = new URL('../', import.meta.url);
const [adminJs, adminApi, backend] = await Promise.all([
  readFile(new URL('js/admin.js', portalRoot), 'utf8'),
  readFile(new URL('functions/api/admin.js', portalRoot), 'utf8'),
  readFile(new URL('functions/api/backend.js', portalRoot), 'utf8')
]);

test('school insights is a school-only, accounts-protected on-demand workspace', () => {
  assert.match(adminJs, /function schoolInsightsAvailable\(allowed = \[\], user = currentUser \|\| \{\}\)/);
  assert.match(adminJs, /resolveDashboardEdition\(user\) === 'school' && \(allowed \|\| \[\]\)\.includes\('accounts'\)/);
  assert.match(adminJs, /schoolInsightsAvailable\(allowed, currentUser \|\| \{\}\)/);
  assert.match(adminJs, /loadDashboard\(\{ mode: 'section', section: active, merge: true \}\)/);
  assert.match(adminApi, /schoolInsights && \(user\.edition !== 'school' \|\| !allowed\.has\('accounts'\)\)/);
  assert.match(adminApi, /School Insights requires school-edition Accounts access/);
});

test('default dashboard remains dedicated to time and attendance', () => {
  assert.match(adminJs, /const overview = active === 'overview'/);
  assert.match(adminJs, /setDashboardClockActive\(overview\)/);
  assert.match(adminJs, /if \(!dashboardClockEl \|\| activeSection !== 'overview'/);
});

test('school insights restores enrolment charts, fee cards and defaulters table', () => {
  assert.match(adminJs, /Students by Gender/);
  assert.match(adminJs, /New Intake \/ Returning/);
  assert.match(adminJs, /Fee Balance by Class/);
  assert.match(adminJs, /Fee Position/);
  assert.match(adminJs, /Top 10 Fee-Payment Defaulters/);
  assert.match(adminJs, /Expected Fees/);
  assert.match(adminJs, /Fees Received/);
  assert.match(adminJs, /Outstanding Fees/);
  assert.match(adminApi, /summary\.collectionRate = totalInvoiced > 0/);
  assert.match(adminApi, /departments\.schoolInsights = \{/);
  assert.match(adminApi, /defaulters: outstandingRows\.slice\(0, 10\)/);
});

test('insight account identities retain branch and school-section scope', () => {
  assert.match(adminApi, /const accountRows = accountOverview && accountOverview\.ok \? staffScope/);
  assert.match(backend, /BranchId: clean\(existing\.BranchId \|\| normalized\.BranchId\)/);
  assert.match(backend, /SchoolSection: clean\(existing\.SchoolSection \|\| normalized\.SchoolSection\)/);
  assert.match(backend, /BranchId: student\.BranchId/);
  assert.match(backend, /SchoolSection: student\.SchoolSection/);
});
