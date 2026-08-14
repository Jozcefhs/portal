import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const portalRoot = new URL('../', import.meta.url);
const sharedVersion = '20260814-finance-drive-uploads';
const adminScriptVersion = '20260814-finance-drive-uploads';
const parentScriptVersion = '20260809-direct-transfer';
const notificationVersion = '20260804-read-efficiency';
const pageNames = [
  'admin.html',
  'application.html',
  'buy-form.html',
  'give.html',
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
  const gestureSource = adminJs.slice(adminJs.indexOf('function installSidebarSwipeGestures'), adminJs.indexOf('function clearStaffWorkspaceState'));
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

test('parent mobile dashboard actions keep the bell and compact buttons on one row', () => {
  assert.match(portalCss, /@media \(max-width:680px\)[\s\S]*?\.dashboard-actions\{display:flex;[^}]*flex-wrap:nowrap/);
  assert.match(portalCss, /\.dashboard-actions button\{[^}]*font-size:10px[^}]*white-space:nowrap/);
  assert.match(portalCss, /\.dashboard-actions \.parent-notification-button\{[^}]*width:36px/);
});

test('parent mobile notification heading stacks compact actions below compact text', () => {
  assert.match(portalCss, /@media \(max-width:680px\)[\s\S]*?\.parent-notification-heading\{display:grid;grid-template-columns:max-content max-content/);
  assert.match(portalCss, /\.parent-notification-heading>div\{grid-column:1\/-1/);
  assert.match(portalCss, /\.parent-notification-heading h2\{font-size:14px/);
  assert.match(portalCss, /\.parent-notification-heading p\{[^}]*font-size:9px/);
  assert.match(portalCss, /\.parent-notification-heading>button\{[^}]*font-size:8px/);
});

test('multi-function workspaces use focused URL-aware tabs', () => {
  assert.match(adminJs, /function mountWorkspaceTabs\(section, tabs = \[\], options = \{\}\)/);
  assert.match(adminJs, /window\.history\.replaceState\(window\.history\.state, '', url\)/);
  assert.match(adminJs, /window\.localStorage\.setItem\(workspaceViewStorageKey\(section\), selected\)/);
  ['donations', 'funds', 'offerings', 'services', 'staffAttendance', 'humanResources', 'incomeAnalytics', 'financeRequests', 'staffUsers', 'studentConduct'].forEach((section) => {
    assert.match(adminJs, new RegExp(`mountWorkspaceTabs\\('${section}'`), `${section} should use focused tabs`);
  });
  assert.doesNotMatch(adminJs, /data-donation-jump/);
  assert.match(portalCss, /\.module-workspace-tabs\{[^}]*overflow-x:auto/);
  assert.match(portalCss, /\.module-workspace-panel\[hidden\]\{display:none!important\}/);
});

test('all portal pages reference the current shared stylesheet version', () => {
  pages.forEach((html, index) => {
    assert.match(html, new RegExp(`css/style\\.css\\?v=${sharedVersion}`), `${pageNames[index]} should use the shared stylesheet version`);
  });
  assert.match(pages[pageNames.indexOf('admin.html')], new RegExp(`js/admin\\.js\\?v=${adminScriptVersion}`));
  assert.match(pages[pageNames.indexOf('admin.html')], new RegExp(`js/notifications\\.js\\?v=${notificationVersion}`));
  assert.match(pages[pageNames.indexOf('admin.html')], new RegExp(`css/notifications\\.css\\?v=${notificationVersion}`));
  assert.match(pages[pageNames.indexOf('parent-dashboard.html')], new RegExp(`js/parent-dashboard\\.js\\?v=${parentScriptVersion}`));
  assert.match(pages[pageNames.indexOf('parent-dashboard.html')], new RegExp(`css/notifications\\.css\\?v=${notificationVersion}`));
});

test('service worker refreshes the shared school, church, and parent assets', () => {
  assert.match(serviceWorker, /dynamax-v182-finance-drive-uploads/);
  assert.match(serviceWorker, /'\/css\/school-landing\.css'/);
  assert.match(serviceWorker, /'\/css\/guest-fee-payment\.css'/);
  assert.match(serviceWorker, /'\/js\/app-dialogs\.js'/);
  assert.match(serviceWorker, /'\/js\/student-face-lookup\.js'/);
  assert.match(serviceWorker, /'\/setup\.html'/);
  assert.match(serviceWorker, /'\/js\/setup\.js'/);
  assert.match(serviceWorker, /'\/js\/financial-values\.js'/);
  assert.match(serviceWorker, /'\/payments\.html'/);
  assert.match(serviceWorker, /'\/js\/payments\.js'/);
  assert.match(serviceWorker, /'\/js\/payment-methods\.js'/);
  assert.match(serviceWorker, /'\/css\/payment-methods\.css'/);
  assert.match(serviceWorker, /'\/give\.html'/);
  assert.match(serviceWorker, /'\/js\/give\.js'/);
  assert.match(serviceWorker, /'\/store\.html'/);
  assert.match(serviceWorker, /'\/js\/store\.js'/);
  assert.match(serviceWorker, /'\/js\/action-feedback\.js'/);
  assert.match(serviceWorker, /'\/admin\.html'/);
  assert.match(serviceWorker, /'\/js\/admin\.js'/);
  assert.match(serviceWorker, /'\/plan-management\.html'/);
  assert.match(serviceWorker, /'\/subscription-payment\.html'/);
  assert.match(serviceWorker, /self\.skipWaiting\(\)/);
  assert.match(serviceWorker, /self\.clients\.claim\(\)/);
});
