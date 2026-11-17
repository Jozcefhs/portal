import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const portalRoot = new URL('../', import.meta.url);
const [adminJs, adminApi, backend] = await Promise.all([
  readFile(new URL('js/admin.js', portalRoot), 'utf8'),
  readFile(new URL('functions/api/admin.js', portalRoot), 'utf8'),
  readFile(new URL('functions/api/backend.js', portalRoot), 'utf8')
]);

test('school insights uses its own school-only module grant and loads on demand', () => {
  assert.match(adminJs, /const tabConfig = \[\s*\['schoolInsights', 'School Insights'\]/);
  assert.match(adminJs, /schoolOnlyWebSections = new Set\(\[\s*'schoolInsights'/);
  assert.match(adminJs, /\[name="RoleModuleOption"\]\[value="schoolInsights"\]/);
  assert.match(adminJs, /\[name="TabAccessOption"\]\[value="schoolInsights"\]/);
  assert.match(adminJs, /loadDashboard\(\{ mode: 'section', section: active, merge: true \}\)/);
  assert.match(adminApi, /schoolInsights && user\.edition !== 'school'/);
  assert.match(adminApi, /requestedSection && !allowed\.has\(requestedSection\)/);
});

test('default dashboard remains dedicated to time and attendance', () => {
  assert.match(adminJs, /const overview = active === 'overview'/);
  assert.match(adminJs, /setDashboardClockActive\(overview, options\)/);
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
