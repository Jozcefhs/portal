import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const portalRoot = new URL('../', import.meta.url);
const [adminHtml, adminJs, portalCss] = await Promise.all([
  readFile(new URL('admin.html', portalRoot), 'utf8'),
  readFile(new URL('js/admin.js', portalRoot), 'utf8'),
  readFile(new URL('css/style.css', portalRoot), 'utf8')
]);
const parentDashboardJs = await readFile(new URL('js/parent-dashboard.js', portalRoot), 'utf8');

test('mobile staff header no longer renders the drawer toggle button', () => {
  assert.doesNotMatch(adminHtml, /id="staffMenuToggle"/);
  assert.match(adminHtml, /id="staffAvatar"/);
});

test('staff drawer exposes a dedicated sign-out action', () => {
  assert.match(adminHtml, /id="staffSidebarSignOut"/);
  assert.match(adminJs, /sidebarSignOutButton\.addEventListener\('click'/);
  assert.match(adminJs, /signOutFromPortal\(sidebarSignOutButton\)/);
});

test('staff drawer supports touch swipe gestures in both directions', () => {
  assert.match(adminJs, /addEventListener\('touchstart'/);
  assert.match(adminJs, /addEventListener\('touchmove'/);
  assert.match(adminJs, /addEventListener\('touchend'/);
  assert.match(adminJs, /openingGesture && deltaX >= 64/);
  assert.match(adminJs, /!openingGesture && deltaX <= -38/);
  assert.match(adminJs, /gestureAxis === 'vertical'[\s\S]*?tracking = false/);
  assert.match(adminJs, /movingInExpectedDirection = openingGesture \? deltaX > 0 : deltaX < 0/);
});

test('mobile welcome heading uses the reduced type scale', () => {
  assert.match(portalCss, /\.staff-page \.staff-welcome h1\{[^}]*font-size:20px/);
  assert.match(portalCss, /@media \(max-width:380px\)\{[\s\S]*?\.staff-page \.staff-welcome h1\{font-size:19px\}/);
});

test('mobile summary cards are equal, centered, legible, and color coded', () => {
  assert.match(portalCss, /\.staff-page \.staff-summary>div\{[\s\S]*?flex:0 0 144px;[\s\S]*?width:144px;[\s\S]*?height:98px;/);
  assert.match(portalCss, /\.staff-page \.staff-summary>div\{[\s\S]*?align-items:center;[\s\S]*?justify-content:center;[\s\S]*?text-align:center;/);
  assert.match(portalCss, /\.staff-page \.staff-summary>div:nth-child\(4n\+2\)\{background:linear-gradient/);
  assert.match(portalCss, /\.staff-page \.staff-summary>div:nth-child\(4n\+3\)\{background:linear-gradient/);
  assert.match(portalCss, /html\[data-theme="dark"\] \.staff-page \.staff-summary>div[\s\S]*?\{color:#fff\}/);
});

test('mobile data-table columns fit their unwrapped contents', () => {
  assert.match(portalCss, /\.staff-page \.admin-table\{[\s\S]*?width:max-content;[\s\S]*?min-width:100%;[\s\S]*?table-layout:auto;/);
  assert.match(portalCss, /\.staff-page \.admin-table th,[\s\S]*?\.staff-page \.admin-table td\{[\s\S]*?white-space:nowrap;[\s\S]*?overflow-wrap:normal;[\s\S]*?word-break:normal;/);
  assert.match(portalCss, /\.staff-page \.admin-table-wrap\{[\s\S]*?overflow-x:auto;/);
});

test('dark table selection inverts row text against the light selection surface', () => {
  assert.match(portalCss, /html\[data-theme="dark"\] \.staff-page \.admin-table tbody tr:hover[\s\S]*?background:#f8fbfd;[\s\S]*?color:#102a43;/);
  assert.match(portalCss, /html\[data-theme="dark"\] \.staff-page \.admin-table tbody tr:hover td[\s\S]*?color:#102a43;/);
});

test('staff and parent sign-out actions return to the suite landing page', () => {
  assert.match(adminJs, /signOutFromPortal[\s\S]*?window\.location\.replace\('index\.html'\)/);
  assert.match(adminJs, /staffPasswordSignOut[\s\S]*?window\.location\.replace\('index\.html'\)/);
  assert.match(parentDashboardJs, /signOutDashboardBtn[\s\S]*?window\.location\.replace\('index\.html'\)/);
});

test('mobile launcher uses a compact first-screen layout', () => {
  assert.match(portalCss, /\.suite-launcher-page\{height:100vh;height:100dvh;[^}]*overflow:hidden/);
  assert.match(portalCss, /@media \(max-width:560px\)\{[\s\S]*?\.suite-launcher\{height:100%;min-height:0;[^}]*overflow:hidden/);
  assert.match(portalCss, /\.launcher-showcase\{height:auto;min-height:0/);
  assert.match(portalCss, /\.launcher-channel\{[^}]*min-height:66px/);
});

test('student profile action uses a compact accessible pencil icon', () => {
  assert.match(adminJs, /class="student-edit-icon"/);
  assert.match(adminJs, /aria-label="Edit profile for \$\{studentName\}"/);
  assert.doesNotMatch(adminJs, /data-edit-student="[^"]*">Edit<\/button>/);
  assert.match(portalCss, /\.student-edit-icon\{[^}]*width:28px;[^}]*height:28px;[^}]*min-height:28px!important/);
});
