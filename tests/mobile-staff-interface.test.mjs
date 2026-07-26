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
  assert.match(adminJs, /class="student-edit-icon compact-icon-action compact-edit-action"/);
  assert.match(adminJs, /aria-label="Edit profile for \$\{studentName\}"/);
  assert.doesNotMatch(adminJs, /data-edit-student="[^"]*">Edit<\/button>/);
  assert.match(portalCss, /\.student-edit-icon\{[^}]*width:28px;[^}]*height:28px;[^}]*min-height:28px!important/);
});

test('student profile editor uses smaller regular-weight typography', () => {
  assert.match(portalCss, /\.student-profile-dialog \.workflow-dialog-header h2\{font-size:17px;font-weight:400\}/);
  assert.match(portalCss, /\.student-profile-dialog \.config-group>header strong\{font-size:12px;font-weight:400\}/);
  assert.match(portalCss, /\.student-profile-dialog \.config-grid>label\{font-size:11px;font-weight:400\}/);
  assert.match(portalCss, /\.student-profile-dialog \.config-grid input,[\s\S]*?font-size:13px;font-weight:400/);
  assert.match(portalCss, /\.student-profile-dialog \.config-dialog-actions button\{font-size:12px;font-weight:400\}/);
});

test('store categories use compact pencil and active-checkbox controls', () => {
  assert.match(adminJs, /class="store-category-edit compact-icon-action compact-edit-action"[\s\S]*?data-edit-category=/);
  assert.match(adminJs, /type="checkbox" data-category-active=/);
  assert.doesNotMatch(adminJs, /data-deactivate-category=/);
  assert.match(adminJs, /action: 'saveCategory'[\s\S]*?Active: active \? 'YES' : 'NO'/);
  assert.match(portalCss, /\.store-category-row\{[^}]*min-height:44px;[^}]*padding:7px 9px/);
  assert.match(portalCss, /\.store-category-edit\{[^}]*width:24px!important;[^}]*height:24px;[^}]*min-height:24px!important/);
  assert.match(portalCss, /\.store-category-toggle input\{[^}]*width:15px;[^}]*height:15px/);
});

test('edit and delete row actions use shared small accessible icons', () => {
  assert.match(adminJs, /data-edit-user="[^"]*" aria-label="Edit/);
  assert.match(adminJs, /data-delete-user="[^"]*" aria-label="Delete/);
  assert.doesNotMatch(adminJs, /data-edit-user="[^"]*">Manage<\/button>/);
  assert.doesNotMatch(adminJs, /data-delete-user="[^"]*">Delete<\/button>/);
  assert.match(adminJs, /data-delete-document="[^"]*"[\s\S]*?aria-label="Delete/);
  assert.match(adminJs, /data-offering-route-action="edit"[\s\S]*?title="Edit route"/);
  assert.match(adminJs, /data-offering-route-action="delete"[\s\S]*?title="Delete route"/);
  assert.match(parentDashboardJs, /remove\.className = 'compact-icon-action compact-delete-action'/);
  assert.doesNotMatch(parentDashboardJs, /remove\.textContent = 'Remove'/);
  assert.match(portalCss, /\.compact-icon-action\{[\s\S]*?width:24px!important;[\s\S]*?height:24px!important;/);
  assert.match(portalCss, /\.compact-edit-action\{color:/);
  assert.match(portalCss, /\.compact-delete-action\{color:/);
});

test('store collection uses one state-aware status button per order', () => {
  assert.match(adminJs, /const statusLabel = collected \? 'Collected' : ready \? 'Ready · Verify Collection' : 'Paid · Mark Ready'/);
  assert.match(adminJs, /class="store-order-status \$\{collected \? 'is-collected' : ''\}"/);
  assert.match(adminJs, /\$\{collected \? 'disabled' : ''\}>\$\{escapeHtml\(statusLabel\)\}<\/button>/);
  assert.doesNotMatch(adminJs, />Ready for Collection<\/button><button[^>]*>Verify & Mark Collected<\/button>/);
  assert.match(adminJs, /button\.dataset\.storeStatus === 'Collected'[\s\S]*?window\.prompt/);
  assert.match(adminJs, /await loadStaffStore\(section\)/);
  assert.match(portalCss, /\.store-order-status\{[^}]*width:100%;[^}]*min-height:38px/);
  assert.match(portalCss, /\.store-order-status\.is-collected,[\s\S]*?background:#e8f7ee/);
});

test('mobile configuration inputs use compact regular-weight sizing', () => {
  assert.match(portalCss, /@media \(max-width:680px\)\{[\s\S]*?\.staff-page \.workflow-form-grid\{gap:9px 12px\}/);
  assert.match(portalCss, /\.staff-page \.config-form>label,[\s\S]*?font-size:11px;[\s\S]*?font-weight:400;/);
  assert.match(portalCss, /\.staff-page \.config-form input:not\(\[type="checkbox"\]\)[\s\S]*?min-height:36px;[\s\S]*?padding:6px 9px;[\s\S]*?font-size:12px;[\s\S]*?font-weight:400;/);
  assert.match(portalCss, /\.staff-page \.config-form textarea,[\s\S]*?min-height:58px;[\s\S]*?font-size:12px;/);
});

test('finance requests use one-row metadata, paired decisions, and a repeat action', () => {
  assert.match(adminJs, /class="admin-table-wrap finance-record-meta-table"/);
  assert.match(adminJs, /<th>Amount<\/th><th>Department<\/th><th>Date<\/th>/);
  assert.match(adminJs, /class="workflow-actions finance-record-actions"/);
  assert.match(adminJs, /class="finance-new-request" data-open-dialog="requisitionDialog">\+ New Requisition/);
  assert.match(portalCss, /\.finance-record-meta-table \.admin-table\{[^}]*width:max-content;[^}]*min-width:100%;[^}]*table-layout:auto/);
  assert.match(portalCss, /\.finance-record-actions\{[^}]*display:flex!important;[^}]*flex-wrap:nowrap/);
  assert.match(portalCss, /\.finance-record-actions button\{[^}]*flex:1 1 0;[^}]*width:auto!important/);
  assert.match(portalCss, /\.workflow-ledger-heading \.finance-new-request\{[^}]*width:auto;[^}]*min-width:132px/);
});
