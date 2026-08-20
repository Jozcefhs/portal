import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFile(resolve(root, path), 'utf8');

const [
  management,
  admin,
  middleware,
  backend,
  parentDashboard,
  policyStore,
  headers,
  adminHtml,
  serviceWorker,
  specification,
  runbook
] = await Promise.all([
  read('functions/lib/academic-management.js'),
  read('js/admin.js'),
  read('functions/_middleware.js'),
  read('functions/api/backend.js'),
  read('functions/api/parent-dashboard.js'),
  read('functions/lib/academic-policy-store.js'),
  read('_headers'),
  read('admin.html'),
  read('sw.js'),
  read('docs/academic-management-phase.md'),
  read('docs/academic-milestone-11-runbook.md')
]);

[
  management,
  backend,
  parentDashboard,
  policyStore
].forEach((source) => assert.doesNotMatch(source, /Math\.random\(/, 'Security-sensitive identifiers must use cryptographic randomness.'));

assert.match(management, /resultClearances:\s*'academicResultClearances'/);
assert.match(management, /academicMigrationReadiness/);
assert.match(management, /canManageFinancialClearance/);
assert.match(admin, /Academic Migration Readiness/);
assert.match(admin, /Result clearances/);

assert.match(headers, /X-Frame-Options: DENY/);
assert.match(headers, /X-Content-Type-Options: nosniff/);
assert.match(headers, /Permissions-Policy: camera=\(self\), microphone=\(\), geolocation=\(\)/);
assert.match(middleware, /responseHeaders\.set\('X-Frame-Options', 'DENY'\)/);
assert.match(middleware, /responseHeaders\.set\('Referrer-Policy', 'no-referrer'\)/);

const adminVersion = adminHtml.match(/js\/admin\.js\?v=([A-Za-z0-9._-]+)/)?.[1];
const cacheVersion = serviceWorker.match(/const CACHE = '([^']+)'/)?.[1];
assert.ok(adminVersion, 'admin.html must use a versioned admin script.');
assert.ok(cacheVersion, 'sw.js must use an explicit cache identifier.');
assert.match(adminVersion, /academic-cbt-low-read/);
assert.match(cacheVersion, /academic-cbt-low-read/);

assert.match(specification, /Milestone 11 implementation status/);
assert.match(specification, /Milestone 11 implementation status[\s\S]*Operational baseline/);
assert.match(runbook, /Finance result-clearance administration/);
assert.match(runbook, /run_local_cbt_readiness\.py/);
assert.match(runbook, /Rollback/);

console.log(JSON.stringify({
  status: 'PASS',
  adminVersion,
  cacheVersion,
  gates: [
    'cryptographic identifiers',
    'finance clearance and migration readiness',
    'security response headers',
    'versioned browser assets',
    'release and recovery runbook'
  ]
}, null, 2));
