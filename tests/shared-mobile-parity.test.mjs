import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const portalRoot = new URL('../', import.meta.url);
const sharedVersion = '20260728-records-desk';
const adminScriptVersion = '20260728-records-desk';
const pageNames = [
  'admin.html',
  'application.html',
  'buy-form.html',
  'index.html',
  'parent-dashboard.html',
  'payment-success.html',
  'payments.html',
  'school.html',
  'setup.html',
  'success.html',
  'upload-documents.html',
  'verify.html'
];
const [adminJs, portalCss, serviceWorker, ...pages] = await Promise.all([
  readFile(new URL('js/admin.js', portalRoot), 'utf8'),
  readFile(new URL('css/style.css', portalRoot), 'utf8'),
  readFile(new URL('sw.js', portalRoot), 'utf8'),
  ...pageNames.map((name) => readFile(new URL(name, portalRoot), 'utf8'))
]);

test('launcher selects the shared operations shell for religious and other organisations', () => {
  assert.match(pages[pageNames.indexOf('index.html')], /admin\.html\?workspace=faith/);
  assert.match(pages[pageNames.indexOf('index.html')], /admin\.html\?workspace=organization/);
  assert.match(adminJs, /const requestedWorkspace = new URLSearchParams\(window\.location\.search\)\.get\('workspace'\)/);
  assert.match(adminJs, /if \(\['church', 'faith', 'organization'\]\.includes\(requestedWorkspace\)\) return requestedWorkspace/);
});

test('sidebar swipe gestures are edition-neutral and installed globally', () => {
  assert.match(adminJs, /function installSidebarSwipeGestures\(\)/);
  assert.match(adminJs, /startedAtLeftEdge = touch\.clientX <= 32/);
  assert.match(adminJs, /openingGesture && deltaX >= 64/);
  assert.match(adminJs, /!openingGesture && deltaX <= -38/);
  assert.match(adminJs, /installSidebarSwipeGestures\(\);/);
  const gestureSource = adminJs.slice(adminJs.indexOf('function installSidebarSwipeGestures'), adminJs.indexOf('function showLogin'));
  assert.doesNotMatch(gestureSource, /edition|isChurch|school/);
});

test('recent compact interface rules target the shared staff shell', () => {
  assert.match(portalCss, /\.staff-page \.admin-table/);
  assert.match(portalCss, /\.staff-page \.config-form/);
  assert.match(portalCss, /\.compact-icon-action/);
  assert.match(portalCss, /\.staff-mobile-nav/);
  assert.match(portalCss, /\.staff-sidebar\.is-open/);
});

test('action buttons fit their contents instead of stretching across cards and forms', () => {
  assert.match(portalCss, /\.workflow-form button\{width:fit-content/);
  assert.match(portalCss, /\.activity-item button,.activity-item \.btn\{width:fit-content/);
  assert.match(portalCss, /\.staff-login-card button\[type="submit"\]\{width:fit-content/);
  assert.match(portalCss, /\.staff-sidebar-signout\{[^}]*width:fit-content/);
  assert.match(portalCss, /\.finance-record-actions button\{flex:0 0 auto;width:fit-content!important/);
  assert.doesNotMatch(portalCss, /\.workflow-form button\{width:100%/);
});

test('all portal pages reference the current shared stylesheet version', () => {
  pages.forEach((html, index) => {
    assert.match(html, new RegExp(`css/style\\.css\\?v=${sharedVersion}`), `${pageNames[index]} should use the shared stylesheet version`);
  });
  assert.match(pages[pageNames.indexOf('admin.html')], new RegExp(`js/admin\\.js\\?v=${adminScriptVersion}`));
  assert.match(pages[pageNames.indexOf('parent-dashboard.html')], new RegExp(`js/parent-dashboard\\.js\\?v=${sharedVersion}`));
});

test('service worker refreshes the shared school, church, and parent assets', () => {
  assert.match(serviceWorker, /dynamax-v55-records-desk/);
  assert.match(serviceWorker, /'\/admin\.html'/);
  assert.match(serviceWorker, /'\/js\/admin\.js'/);
  assert.match(serviceWorker, /self\.skipWaiting\(\)/);
  assert.match(serviceWorker, /self\.clients\.claim\(\)/);
});
