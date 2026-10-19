import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const middleware = await readFile(new URL('../functions/_middleware.js', import.meta.url), 'utf8');
const adminApi = await readFile(new URL('../functions/api/admin.js', import.meta.url), 'utf8');
const adminUi = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const firestore = await readFile(new URL('../functions/lib/firestore.js', import.meta.url), 'utf8');

test('sign-in and dashboard shell validate deployment variables without a profile read', () => {
  assert.match(middleware, /LOW_READ_IDENTITY_PATHS = new Set\(\[[\s\S]*?'\/api\/staff-session'/);
  assert.match(middleware, /'\/api\/staff-passkey'/);
  assert.match(middleware, /'\/api\/admin'/);
  assert.match(middleware, /LOW_READ_IDENTITY_PATHS\.has\(pathname\)[\s\S]*?requiredDeploymentIdentity\(env\)/);
});

test('the initial dashboard request returns a shell before collection scans', () => {
  const shellBranch = adminApi.indexOf('if (shellOnly)');
  const collectionScan = adminApi.indexOf('] = await Promise.all([');
  assert.ok(shellBranch >= 0);
  assert.ok(collectionScan > shellBranch);
  assert.match(adminApi, /summaryDeferred: true/);
  assert.match(adminApi, /const shouldLoad = \(section\)/);
  assert.match(adminApi, /requestedSection \? key === requestedSection/);
});

test('fresh login reuses the signed session response instead of issuing verification retries', () => {
  const confirmation = adminUi.match(/async function confirmFreshStaffSession[\s\S]*?\n\}/)?.[0] || '';
  assert.match(confirmation, /staffBearerToken = memoryToken;\s*return fallbackUser;/);
  assert.doesNotMatch(confirmation, /\[120, 300, 700, 1200\]/);
  assert.match(adminUi, /loadDashboard\(\{ mode: 'shell' \}\)/);
  assert.match(adminUi, /legacyDashboardSections/);
  assert.match(adminUi, /mode: 'section', section: active, merge: true/);
});

test('Firestore quota failures retain a safe machine-readable status', () => {
  assert.match(firestore, /upstreamCode === 'RESOURCE_EXHAUSTED'/);
  assert.match(firestore, /code: 'FIRESTORE_QUOTA_EXHAUSTED'/);
  assert.match(middleware, /resource limit was reached/i);
  assert.match(middleware, /not necessarily the daily read quota/i);
  assert.match(middleware, /event: 'api_identity_error'/);
});
