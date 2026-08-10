import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const portalRoot = new URL('../', import.meta.url);
const [adminHtml, adminJs, portalCss, indexHtml] = await Promise.all([
  readFile(new URL('admin.html', portalRoot), 'utf8'),
  readFile(new URL('js/admin.js', portalRoot), 'utf8'),
  readFile(new URL('css/style.css', portalRoot), 'utf8'),
  readFile(new URL('index.html', portalRoot), 'utf8')
]);
const parentDashboardJs = await readFile(new URL('js/parent-dashboard.js', portalRoot), 'utf8');
const parentDashboardHtml = await readFile(new URL('parent-dashboard.html', portalRoot), 'utf8');

test('mobile staff header no longer renders the drawer toggle button', () => {
  assert.doesNotMatch(adminHtml, /id="staffMenuToggle"/);
  assert.match(adminHtml, /id="staffAvatar"/);
});

test('desktop header owns refresh and theme controls while the mobile logo refreshes', () => {
  assert.match(adminHtml, /id="staffHeaderRefresh"[\s\S]*?id="staffThemeToggle"/);
  assert.doesNotMatch(adminHtml, /id="staffRefresh"/);
  assert.match(adminHtml, /id="staffBrand"/);
  assert.match(adminJs, /headerRefreshButton\.addEventListener\('click', loadDashboard\)/);
  assert.match(adminJs, /themeToggleButton\.addEventListener\('click', toggleStaffTheme\)/);
  assert.match(adminJs, /DIGCPreferences\.save\(\{ \.\.\.preferences, theme: nextTheme \}\)/);
  assert.match(adminJs, /window\.matchMedia\('\(max-width:680px\)'\)\.matches[\s\S]*?!dashboardEl\.hidden/);
  assert.match(adminJs, /event\.target\.closest\('\.nav-logo'\)/);
  assert.match(adminJs, /if \(!headerRefreshButton\.disabled\) loadDashboard\(\)/);
  assert.match(portalCss, /@media \(max-width:680px\)\{[\s\S]*?\.staff-desktop-tools\{display:none\}[\s\S]*?\.staff-brand \.nav-logo\{cursor:pointer\}[\s\S]*?\.staff-brand\.is-refreshing \.nav-logo\{animation:button-spin/);
});

test('mobile sidebar exposes the theme toggle in its workspace heading', () => {
  assert.match(adminHtml, /id="staffSidebarThemeToggle"[\s\S]*?id="staffSidebarThemeToggleIcon"/);
  assert.match(adminJs, /sidebarThemeToggleButton\.addEventListener\('click', toggleStaffTheme\)/);
  assert.match(portalCss, /\.staff-sidebar-theme\{display:none\}/);
  assert.match(portalCss, /@media \(max-width:680px\)\{[\s\S]*?\.staff-sidebar \.staff-sidebar-heading\{position:relative;padding-right:58px\}[\s\S]*?\.staff-sidebar-theme\{position:absolute;right:4px;top:0;display:grid/);
});

test('desktop header sign-out uses a compact accessible icon', () => {
  assert.match(adminHtml, /id="staffSignOut" class="dashboard-signout staff-header-signout" aria-label="Sign out" title="Sign out"[\s\S]*?<span aria-hidden="true">/);
  assert.doesNotMatch(adminHtml, /id="staffSignOut"[^>]*>Sign Out<\/button>/);
  assert.match(portalCss, /\.staff-header-signout\{display:grid;place-items:center;flex:0 0 38px;width:38px;height:38px;min-height:38px/);
});

test('switch user is available as an accessible compact account action', () => {
  assert.match(adminHtml, /id="staffSwitchUser" class="dashboard-signout staff-header-signout" aria-label="Switch user" title="Switch user"[\s\S]*?<span aria-hidden="true">/);
  assert.match(adminHtml, /id="staffSidebarSwitchUser" class="staff-sidebar-signout"[\s\S]*?Switch user/);
  assert.match(adminHtml, /id="staffPasswordSwitchUser"[^>]*>Switch user<\/button>/);
  assert.match(adminJs, /switchUserButton\.addEventListener\('click', switchUserFromPortal\)/);
  assert.match(adminJs, /sidebarSwitchUserButton\.addEventListener\('click', switchUserFromPortal\)/);
  assert.match(adminJs, /passwordSwitchUserButton\.addEventListener\('click', switchUserFromPortal\)/);
});

test('enrolled applications count as admitted rather than pending', () => {
  assert.match(adminJs, /function applicationIsAdmitted\(row\)[\s\S]*?\/admitted\|accepted\|approved\|enrolled\//);
  assert.match(adminJs, /label: 'Admitted', value: rows\.filter\(applicationIsAdmitted\)\.length/);
  assert.match(adminJs, /label: 'Pending', value: rows\.filter\(\(row\) => !applicationIsAdmitted\(row\) && !applicationIsRejected\(row\)\)\.length/);
});

test('staff drawer exposes a dedicated sign-out action', () => {
  assert.match(adminHtml, /id="staffSidebarSignOut"/);
  assert.match(adminHtml, /id="staffSidebarSwitchUser"/);
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

test('mobile summary cards resize to fit their contents and remain centered and color coded', () => {
  assert.match(portalCss, /\.staff-page \.staff-summary>div\{[\s\S]*?flex:0 0 auto;[\s\S]*?width:max-content;[\s\S]*?min-width:128px;[\s\S]*?max-width:none;/);
  assert.match(portalCss, /\.staff-page \.staff-summary>div strong,[\s\S]*?\.staff-page \.staff-summary>div small\{white-space:nowrap\}/);
  assert.match(portalCss, /\.staff-page \.staff-summary \.student-summary-card\{[\s\S]*?flex-basis:auto;[\s\S]*?width:max-content;[\s\S]*?min-width:max-content;[\s\S]*?max-width:none/);
  assert.match(portalCss, /\.staff-page \.staff-summary>div\{[\s\S]*?align-items:center;[\s\S]*?justify-content:center;[\s\S]*?text-align:center;/);
  assert.match(portalCss, /\.staff-page \.staff-summary>div:nth-child\(4n\+2\)\{background:linear-gradient/);
  assert.match(portalCss, /\.staff-page \.staff-summary>div:nth-child\(4n\+3\)\{background:linear-gradient/);
  assert.match(portalCss, /html\[data-theme="dark"\] \.staff-page \.staff-summary>div[\s\S]*?\{color:#fff\}/);
});

test('School Insights refresh becomes an accessible icon button on mobile', () => {
  assert.match(adminJs, /id="refreshSchoolInsights" class="school-insights-refresh" aria-label="Refresh School Insights" title="Refresh School Insights"/);
  assert.match(adminJs, /class="school-insights-refresh-icon" aria-hidden="true">&#8635;<\/span>/);
  assert.match(portalCss, /@media \(max-width:680px\)\{[\s\S]*?\.school-insights-refresh\{flex:0 0 38px;width:38px;min-width:38px;max-width:38px;height:38px;[\s\S]*?\.school-insights-refresh-label\{display:none\}/);
});

test('summary-card contents are centered on desktop as well as mobile', () => {
  assert.match(portalCss, /\.staff-page \.staff-summary>div\{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;/);
  assert.match(portalCss, /\.staff-page \.staff-summary\{display:flex;flex-wrap:nowrap;[\s\S]*?overflow-x:auto;[\s\S]*?scroll-snap-type:x proximity;/);
  assert.match(portalCss, /\.staff-page \.staff-summary>div\{[\s\S]*?flex:0 0 clamp\(150px,13vw,178px\);[\s\S]*?scroll-snap-align:start/);
  assert.match(portalCss, /@media \(min-width:681px\)\{[\s\S]*?\.staff-page \.staff-summary>div:nth-child\(4n\+2\)\{background:linear-gradient/);
  assert.match(portalCss, /@media \(min-width:681px\)\{[\s\S]*?\.staff-page \.staff-summary>div:nth-child\(4n\+3\)\{background:linear-gradient/);
  assert.match(portalCss, /@media \(min-width:681px\)\{[\s\S]*?\.staff-page \.staff-summary>div:nth-child\(4n\+4\)\{background:linear-gradient/);
});

test('overview and department summary cards stay in one scrollable row', () => {
  assert.match(portalCss, /\.staff-page \.staff-summary\{display:flex;flex-wrap:nowrap;[\s\S]*?overflow-x:auto;/);
  assert.match(portalCss, /\.department-summary-grid \{[\s\S]*?display: flex;[\s\S]*?flex-wrap: nowrap;[\s\S]*?overflow-x: auto;/);
  assert.match(portalCss, /\.department-summary-grid \.module-stat \{[\s\S]*?flex: 0 0 auto;[\s\S]*?width: max-content;[\s\S]*?min-width: 200px;[\s\S]*?scroll-snap-align: start;/);
  assert.match(portalCss, /\.department-summary-grid \.module-stat > \*\s*\{[\s\S]*?white-space: nowrap;/);
});

test('sidebar keeps account actions in one compact opaque control without covering modules', () => {
  const actionsIndex = adminHtml.indexOf('class="staff-sidebar-actions"');
  const accountMenuIndex = adminHtml.indexOf('id="staffAccountMenu"');
  const databaseIndex = adminHtml.indexOf('<strong>Database live</strong>');
  assert.ok(actionsIndex >= 0 && accountMenuIndex > actionsIndex && databaseIndex > accountMenuIndex);
  assert.doesNotMatch(adminHtml, /Firestore Live/);
  assert.match(portalCss, /\.staff-sidebar \.staff-tabs\{flex:1 1 auto;min-height:0\}/);
  assert.match(portalCss, /\.staff-sidebar-actions\{flex:0 0 auto;margin-top:auto\}/);
  assert.match(portalCss, /\.staff-account-menu\[open\]\{display:flex;flex-direction:column-reverse;gap:8px\}/);
  assert.match(portalCss, /\.staff-account-menu\[open\]>\.staff-account-menu-panel\{[\s\S]*?position:relative;[\s\S]*?width:100%;[\s\S]*?background-color:#071c31!important;[\s\S]*?opacity:1/);
  assert.match(portalCss, /\.staff-account-menu-panel\{[^}]*background:#071c31!important;[^}]*opacity:1/);
  assert.match(portalCss, /\.staff-account-menu-panel>\.staff-profile-settings,[\s\S]*?background:#15344f;[\s\S]*?opacity:1/);
  assert.match(portalCss, /\.staff-account-menu:not\(\[open\]\)>\.staff-account-menu-panel\{display:none\}/);
  assert.match(adminJs, /staffAccountMenuPanel\.addEventListener\('click'/);
});

test('sidebar action zone prevents the final module from overlapping user controls', () => {
  assert.match(portalCss, /\.staff-sidebar-actions\{[\s\S]*?position:relative;[\s\S]*?z-index:3;[\s\S]*?padding-top:11px;[\s\S]*?background:#0b2239/);
  assert.match(portalCss, /@media \(max-width:680px\)\{[\s\S]*?\.staff-sidebar-actions\{background:#092642\}/);
  assert.match(portalCss, /\.staff-sidebar \.staff-tabs\{margin-bottom:0;padding-bottom:12px\}/);
  assert.match(portalCss, /@media \(min-width:681px\)\{[\s\S]*?\.staff-sidebar > \.staff-tabs\{[\s\S]*?overflow-x:hidden;[\s\S]*?overflow-y:auto;[\s\S]*?overscroll-behavior-y:contain;[\s\S]*?scrollbar-width:thin/);
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
  assert.match(portalCss, /@media \(max-width:560px\)\{[\s\S]*?\.suite-launcher-page\{height:auto;[^}]*overflow-y:auto/);
  assert.match(portalCss, /@media \(max-width:560px\)\{[\s\S]*?\.suite-launcher\{height:auto;[^}]*overflow:visible/);
  assert.match(portalCss, /\.launcher-showcase\{height:auto;min-height:clamp\(190px,28dvh,220px\)/);
  assert.match(portalCss, /\.launcher-directory\{min-height:0;[^}]*overflow:visible;justify-content:flex-start/);
  assert.match(portalCss, /\.launcher-channel\{[^}]*min-height:66px/);
  assert.doesNotMatch(indexHtml, /id="installDynamaxApp"/);
});

test('preference toggles have clearly distinct on and off states', () => {
  assert.match(portalCss, /\.preference-switch-row:has\(\.preference-switch input:checked\)\{background:#edf9f4;box-shadow:inset 4px 0 0 #087a55\}/);
  assert.match(portalCss, /\.preference-switch span::before\{content:"OFF"/);
  assert.match(portalCss, /\.preference-switch input:checked\+span\{border-color:#087a55;background:#0aa174/);
  assert.match(portalCss, /\.preference-switch input:checked\+span::before\{content:"ON"/);
  assert.match(portalCss, /\.preference-switch input:focus-visible\+span\{outline:3px solid/);
});

test('dark mode preserves dashboard and requisition text contrast', () => {
  assert.match(portalCss, /html\[data-theme="dark"\] \.staff-page \.staff-identity-copy strong\{color:#f4f8ff\}/);
  assert.match(portalCss, /html\[data-theme="dark"\] \.staff-page \.staff-summary strong,/);
  assert.match(portalCss, /html\[data-theme="dark"\] \.dashboard-charts article\{background:#111e2e;border-color:#2b3d53\}/);
  assert.match(portalCss, /html\[data-theme="dark"\] \.chart-row>span,[\s\S]*?color:#c3d0df/);
  assert.match(portalCss, /html\[data-theme="dark"\] \.workflow-ledger-heading h2\{color:#f4f8ff\}/);
  assert.match(portalCss, /html\[data-theme="dark"\] \.workflow-dialog,[\s\S]*?background:#0d1a29;color:#edf4ff/);
  assert.match(portalCss, /html\[data-theme="dark"\] \.workflow-dialog \.workflow-form label\{color:#f4f8ff\}/);
});

test('school and organisation dashboard graphs remain available on mobile', () => {
  const renderTabsSource = adminJs.slice(adminJs.indexOf('function renderTabs'), adminJs.indexOf('function renderWorkspace'));
  assert.doesNotMatch(renderTabsSource, /dataset\.edition\s*=/);
  assert.match(adminJs, /document\.documentElement\.dataset\.edition = isOrganisationOperations \? 'church' : 'school'/);
  assert.match(adminJs, /if \(activeSection !== 'overview'\)/);
  assert.match(adminJs, /if \(document\.documentElement\.dataset\.edition === 'church'\)[\s\S]*?loadOrganizationDashboardCharts\(\)/);
  assert.match(adminJs, /Attendance by department[\s\S]*?Offerings by department[\s\S]*?Home churches by area \/ zone[\s\S]*?Program participants by country/);
  assert.match(portalCss, /@media \(max-width:780px\)\{\.dashboard-charts\{grid-template-columns:1fr\}/);
});

test('authenticated school edition overrides an organisation-flavoured URL', () => {
  assert.match(adminJs, /function resolveDashboardEdition\(user = \{\}\)/);
  assert.match(adminJs, /if \(\['school', 'church', 'faith', 'organization'\]\.includes\(explicitEdition\)\) return explicitEdition/);
  assert.match(adminJs, /const dashboardEdition = resolveDashboardEdition\(user\)/);
  assert.doesNotMatch(adminJs, /\/dunamis\|digc\|church\/i\.test\(profileName\)/);
  const source = adminJs.slice(
    adminJs.indexOf('function resolveDashboardEdition'),
    adminJs.indexOf('function showDashboard')
  );
  const resolveFor = new Function('clean', 'requestedWorkspace', `${source}; return resolveDashboardEdition;`);
  const cleanValue = (value) => String(value ?? '').trim();
  assert.equal(resolveFor(cleanValue, 'organization')({ edition: 'school' }), 'school');
  assert.equal(resolveFor(cleanValue, 'faith')({ edition: 'school' }), 'school');
  assert.equal(resolveFor(cleanValue, 'faith')({}), 'faith');
});

test('sidebar module labels keep strong contrast', () => {
  assert.match(portalCss, /\.staff-page \.staff-tabs \.child-card\{[^}]*color:#edf4ff/);
  assert.match(portalCss, /\.staff-page \.staff-tabs \.child-card>span:last-child\{color:#edf4ff;font-weight:600\}/);
  assert.match(portalCss, /\.child-list \.child-card span\{display:block;color:hsl/);
  assert.doesNotMatch(portalCss, /(?:^|})\.child-card span\{display:block;color:hsl/);
});

test('dark mode covers staff configuration and account-management surfaces', () => {
  assert.match(portalCss, /html\[data-theme="dark"\] \.config-switch/);
  assert.match(portalCss, /html\[data-theme="dark"\] \.config-option-list/);
  assert.match(portalCss, /html\[data-theme="dark"\] \.config-option-list label/);
  assert.match(portalCss, /\.config-option-list \.check-row\{display:flex;align-items:center;gap:8px;min-height:28px/);
  assert.match(portalCss, /\.config-option-list \.check-row input\[type="checkbox"\]\{flex:0 0 15px;width:15px;height:15px;min-height:15px;margin:0/);
  assert.match(portalCss, /html\[data-theme="dark"\] \.config-dialog-actions/);
  assert.match(portalCss, /html\[data-theme="dark"\] \.staff-user-row/);
  assert.match(portalCss, /html\[data-theme="dark"\] \.staff-module-dialog/);
});

test('dark mode covers shared forms, notices, and general settings', () => {
  assert.match(portalCss, /html\[data-theme="dark"\] \.fee-option/);
  assert.match(portalCss, /html\[data-theme="dark"\] \.upload-result/);
  assert.match(portalCss, /html\[data-theme="dark"\] \.settings-section/);
  assert.match(portalCss, /html\[data-theme="dark"\] \.settings-field input/);
  assert.match(portalCss, /html\[data-theme="dark"\] \.settings-topbar h1/);
  assert.match(portalCss, /html\[data-theme="dark"\] \.settings-nav-link\{color:#d8e5f5\}/);
  assert.match(portalCss, /html\[data-theme="dark"\] \.settings-field label/);
  assert.match(portalCss, /html\[data-theme="dark"\] \.settings-subsection-title strong/);
  assert.match(portalCss, /html\[data-theme="dark"\] \.settings-savebar\{/);
  assert.match(portalCss, /html\[data-theme="dark"\] input::placeholder/);
});

test('password visibility controls stay compact and reserve input space', () => {
  assert.match(portalCss, /\.password-field>input\{padding-right:68px!important\}/);
  assert.match(portalCss, /\.password-field>\.password-toggle\{[\s\S]*?right:6px;[\s\S]*?width:auto!important;[\s\S]*?min-width:50px;/);
  assert.match(portalCss, /html\[data-theme="dark"\] \.password-field>\.password-toggle\{color:#75adff\}/);
});

test('every staff module uses a corresponding navigation icon', () => {
  ['overview', 'recordsDesk', 'executiveOffice', 'admissions', 'formPurchases', 'students', 'members', 'services', 'funds', 'offerings',
    'donations', 'accounts', 'humanResources', 'financeRequests', 'payroll', 'clinic', 'kitchen', 'tuckShop',
    'bookstore', 'uniformStore', 'organizationStore', 'restaurant', 'staffUsers'].forEach((key) => {
    assert.match(adminJs, new RegExp(`${key}: '\\\\u`), `${key} should define an icon`);
  });
  assert.match(adminJs, /class="staff-tab-icon"[\s\S]*?tabIcons\[key\]/);
  assert.match(portalCss, /\.staff-tab-icon\{display:grid!important;place-items:center/);
});

test('selected modules replace overview content with a full-height workspace', () => {
  assert.match(adminJs, /const tabs = \[[\s\S]*?\['overview', 'Dashboard'\],[\s\S]*?\.\.\.editionTabs\.filter/);
  assert.match(adminJs, /\.\.\.\(insightAllowed \? \[\['schoolInsights', 'School Insights'\]\] : \[\]\)/);
  assert.match(adminJs, /restrictedSet\.has\(key\)/);
  assert.match(adminJs, /welcomeEl\.hidden = !overview/);
  assert.match(adminJs, /dashboardStatus\.hidden = !overview/);
  assert.match(adminJs, /panelEl\.hidden = overview/);
  assert.match(adminJs, /activeSection !== 'overview'[\s\S]*?dashboardChartsEl\.hidden = true/);
  assert.match(portalCss, /\.staff-main-content\.module-view-active \.staff-panel\{min-height:calc\(100vh - 168px\)/);
});

test('school, church, finance, payroll, store, and staff modules receive summary cards', () => {
  ['recordsDesk', 'executiveOffice', 'admissions', 'formPurchases', 'students', 'accounts', 'clinic', 'kitchen', 'tuckShop',
    'bookstore', 'uniformStore', 'members', 'services', 'funds', 'donations', 'offerings',
    'humanResources', 'financeRequests', 'payroll', 'staffUsers'].forEach((key) => {
    assert.match(adminJs, new RegExp(`active === '${key}'|renderModuleSummary\\('${key}'`), `${key} should render module summaries`);
  });
  assert.match(adminJs, /class="module-summary-card"/);
  assert.match(portalCss, /\.staff-summary \.module-summary-icon/);
});

test('selected student card has an unmistakable active state', () => {
  assert.match(portalCss, /\.child-list \.child-card\.selected\{border:2px solid #43d19e;background:hsl\(var\(--child-hue,207\) 64% 34%\);box-shadow:0 0 0 3px/);
  assert.match(portalCss, /\.child-list \.child-card\.selected::after\{content:"✓ Selected"/);
  assert.match(portalCss, /\.child-list \.child-card\.selected \.child-card-layout\{padding-right:72px\}/);
  assert.match(portalCss, /html\[data-theme="dark"\] \.child-list \.child-card\.selected\{border-color:#43d19e;background:hsl\(var\(--child-hue,207\) 55% 29%\)/);
  assert.match(portalCss, /html\[data-theme="dark"\] \.child-list \.child-card\.selected::after\{background:#43d19e;color:#071b2c\}/);
});

test('parent dashboard gives each student card a distinct colour', () => {
  assert.match(parentDashboardJs, /function childCardHue\(index\)/);
  assert.match(parentDashboardJs, /index \* 137\.508/);
  assert.match(parentDashboardJs, /button\.style\.setProperty\('--child-hue', String\(childCardHue\(index\)\)\)/);
  assert.match(portalCss, /\.child-list \.child-card\{[^}]*background:hsl\(var\(--child-hue,207\) 72% 94%\)/);
});

test('parent student selector cards are compact on mobile', () => {
  assert.match(portalCss, /@media \(max-width:680px\)\{[\s\S]*?\.child-list\{[^}]*gap:5px;[^}]*margin:7px 0 10px/);
  assert.match(portalCss, /\.child-list \.child-card\{[^}]*min-height:0;[^}]*padding:7px 8px;[^}]*font-size:9px/);
  assert.match(portalCss, /\.child-list \.child-card\.selected::after\{[^}]*padding:2px 4px;[^}]*font-size:7px/);
  assert.match(portalCss, /\.child-card-layout\{grid-template-columns:44px minmax\(0,1fr\);gap:7px\}/);
  assert.match(portalCss, /\.child-card-copy strong\{font-size:9px;line-height:1\.25\}/);
  assert.match(portalCss, /\.child-list \.child-card span\{[^}]*font-size:9px/);
  assert.match(portalCss, /\.child-passport\{width:44px;height:50px;border-radius:6px\}/);
});

test('parent dashboard history sections use compact mobile typography', () => {
  assert.match(portalCss, /@media \(max-width:680px\)\{[\s\S]*?\.dashboard-card \.dashboard-view-panel\{padding:9px\}/);
  assert.match(portalCss, /\.dashboard-card \.dashboard-view-panel h2\{[^}]*font-size:13px/);
  assert.match(portalCss, /\.dashboard-card \.dashboard-view-panel \.activity-item\{[^}]*padding:7px 8px;[^}]*font-size:9px/);
  assert.match(portalCss, /\.dashboard-card \.dashboard-view-panel \.activity-item strong\{font-size:10px/);
  assert.match(portalCss, /\.dashboard-card \.dashboard-view-panel \.activity-item span,[\s\S]*?font-size:9px/);
  assert.match(portalCss, /\.dashboard-card \.dashboard-view-panel \.collapsible-activity summary\{[^}]*font-size:9px/);
});

test('mobile histories share the compact records-desk type scale', () => {
  assert.match(portalCss, /One compact, readable type scale for history and audit records on phones/);
  assert.match(portalCss, /\.activity-list \.activity-item strong\{font-size:10px/);
  assert.match(portalCss, /\.activity-list \.activity-item span,[^}]*font-size:8px/);
  assert.match(portalCss, /\.workflow-record-list \.workflow-record-heading>div strong\{font-size:10px/);
  assert.match(portalCss, /\.workflow-record-list \.workflow-record-heading>div small,[^}]*font-size:8px/);
  assert.match(portalCss, /\.staff-page \.module-workspace-panel \.admin-table td\{[^}]*font-size:9px/);
  assert.match(portalCss, /\.records-desk-activity-card article strong,[^}]*font-size:10px/);
  assert.match(portalCss, /\.records-desk-activity-card article small,[^}]*font-size:8px/);
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
  assert.match(adminJs, /button\.dataset\.storeStatus === 'Collected'[\s\S]*?window\.DynamaxDialogs\.prompt/);
  assert.match(adminJs, /await loadStaffStore\(section\)/);
  assert.match(portalCss, /\.store-order-status\{[^}]*width:100%;[^}]*min-height:38px/);
  assert.match(portalCss, /\.store-order-status\.is-collected,[\s\S]*?background:#e8f7ee/);
});

test('store collection status button fits its content', () => {
  assert.match(portalCss, /\.store-order-status\{[\s\S]*?display:inline-flex;[\s\S]*?width:fit-content;[\s\S]*?max-width:100%;/);
});

test('mobile configuration inputs use compact regular-weight sizing', () => {
  assert.match(portalCss, /@media \(max-width:680px\)\{[\s\S]*?\.staff-page \.workflow-form-grid\{gap:9px 12px\}/);
  assert.match(portalCss, /\.staff-page \.config-form>label,[\s\S]*?font-size:11px;[\s\S]*?font-weight:400;/);
  assert.match(portalCss, /\.staff-page \.config-form input:not\(\[type="checkbox"\]\)[\s\S]*?min-height:36px;[\s\S]*?padding:6px 9px;[\s\S]*?font-size:12px;[\s\S]*?font-weight:400;/);
  assert.match(portalCss, /\.staff-page \.config-form textarea,[\s\S]*?min-height:58px;[\s\S]*?font-size:12px;/);
});

test('finance requests use one-row records, icon decisions, printing, and a repeat action', () => {
  assert.match(adminJs, /class="admin-table finance-record-table"/);
  assert.match(adminJs, /<th>Reference<\/th><th>Request<\/th><th>Description<\/th><th>Amount<\/th><th>Department<\/th><th>Date<\/th>/);
  assert.match(adminJs, /class="finance-row-actions"/);
  assert.doesNotMatch(adminJs, /class="finance-new-request"/);
  assert.match(adminJs, /class="compact-icon-action compact-print-action" data-print-finance-record=/);
  assert.match(adminJs, /class="compact-icon-action compact-approve-action"[\s\S]*?aria-label="Approve/);
  assert.match(adminJs, /class="compact-icon-action compact-reject-action"[\s\S]*?aria-label="Reject/);
  assert.match(adminJs, /function openFinanceRecordPrint\(record, type, endorsements = \{\}, printableWindow = null\)/);
  assert.match(adminJs, /window\.setTimeout\(\(\) => printable\.print\(\), 250\)/);
  assert.match(adminJs, /data-offering-action="approvechurchoffering"[\s\S]*?aria-label="Approve offering"/);
  assert.match(adminJs, /data-offering-action="rejectchurchoffering"[\s\S]*?aria-label="Reject offering"/);
  assert.match(portalCss, /\.finance-record-table\{[^}]*width:max-content;[^}]*min-width:100%;[^}]*table-layout:auto/);
  assert.match(portalCss, /\.finance-record-table th,\.finance-record-table td\{white-space:nowrap\}/);
  assert.match(portalCss, /\.finance-row-actions\{[^}]*display:flex;[^}]*gap:4px/);
  assert.doesNotMatch(portalCss, /\.workflow-ledger-heading \.finance-new-request/);
  assert.match(portalCss, /\.compact-print-action\{color:/);
  assert.match(portalCss, /\.compact-approve-action\{color:/);
  assert.match(portalCss, /\.compact-reject-action\{color:/);
});

test('mobile finance actions use compact content-width labels in one row', () => {
  assert.match(adminJs, /title="New Requisition">\+ Request/);
  assert.match(adminJs, /title="Material Requisition">\+ Materials/);
  assert.match(adminJs, /title="Supplier Bill">\+ Invoice/);
  assert.match(adminJs, /class="workflow-icon-action finance-workflow-refresh"[\s\S]*?aria-label="Refresh requests"[\s\S]*?&#8635;/);
  assert.match(portalCss, /@media \(max-width:680px\)\{[\s\S]*?\.workflow-primary-actions\{[^}]*flex-wrap:nowrap;[^}]*gap:4px;/);
  assert.match(portalCss, /\.workflow-primary-actions button\{[^}]*width:fit-content;[^}]*font-size:9px;[^}]*white-space:nowrap/);
  assert.match(portalCss, /\.workflow-primary-actions \.finance-workflow-refresh\{[^}]*width:29px;[^}]*height:29px;/);
});

test('parents can search the eligible school-store catalog', () => {
  assert.match(parentDashboardHtml, /id="storeSearch" type="search"/);
  assert.match(parentDashboardHtml, /id="storeSearchSummary"[\s\S]*?aria-live="polite"/);
  assert.match(parentDashboardJs, /const eligibleCatalog = \(dashboard\.storeCatalogByChild\?\.\[identity\] \|\| \[\]\)\.filter/);
  assert.match(parentDashboardJs, /item\.ItemName,[\s\S]*?item\.Category,[\s\S]*?item\.Size,[\s\S]*?item\.ClassName,[\s\S]*?item\.StoreType/);
  assert.match(parentDashboardJs, /\.join\(' '\)\.toLowerCase\(\)\.includes\(query\)/);
  assert.match(parentDashboardJs, /storeSearch\?\.addEventListener\('input'/);
  assert.match(parentDashboardJs, /No store items match/);
  assert.match(portalCss, /\.store-search-control input\{height:36px;min-height:36px;[^}]*font-size:12px/);
});

test('parent store uses a compact quantity selector and cart icon', () => {
  assert.match(parentDashboardJs, /const qty = document\.createElement\('select'\)/);
  assert.match(parentDashboardJs, /Array\.from\(\{ length: available \}/);
  assert.match(parentDashboardJs, /qty\.setAttribute\('aria-label', `Quantity for \$\{item\.ItemName\}`\)/);
  assert.match(parentDashboardJs, /buy\.className = 'compact-icon-action store-cart-action'/);
  assert.match(parentDashboardJs, /buy\.setAttribute\('aria-label', `Add \$\{item\.ItemName\} to cart`\)/);
  assert.match(portalCss, /\.store-purchase-controls\{display:flex;[^}]*gap:6px/);
  assert.match(portalCss, /\.store-quantity\{width:78px;max-width:78px;height:30px;min-height:30px/);
  assert.match(portalCss, /@media \(max-width:780px\)[\s\S]*?\.store-quantity\{width:58px;max-width:58px/);
  assert.match(portalCss, /\.activity-item \.store-cart-action\{width:30px!important;[^}]*border-radius:50%/);
});

test('parent store confirms added items and prevents repeated cart clicks', () => {
  assert.match(parentDashboardJs, /const markAdded = \(\) => \{/);
  assert.match(parentDashboardJs, /qty\.classList\.add\('is-locked'\)/);
  assert.match(parentDashboardJs, /qty\.setAttribute\('aria-disabled', 'true'\)/);
  assert.match(parentDashboardJs, /qty\.tabIndex = -1/);
  assert.match(parentDashboardJs, /buy\.disabled = true/);
  assert.match(parentDashboardJs, /buy\.classList\.add\('is-added'\)/);
  assert.match(parentDashboardJs, /buy\.title = 'Added to cart'/);
  assert.match(parentDashboardJs, /buy\.innerHTML = '<span aria-hidden="true">&#10003;<\/span>'/);
  assert.match(parentDashboardJs, /storeCart\.delete\(key\); renderStores\(child\)/);
  assert.match(portalCss, /\.store-cart-action\.is-added\{background:#e7f7ef;[^}]*opacity:1/);
  assert.match(portalCss, /\.store-quantity\.is-locked\{pointer-events:none;opacity:1;color:#102a43;-webkit-text-fill-color:#102a43/);
  assert.match(portalCss, /\.store-catalog-section \.store-item-row\{gap:2px 6px\}/);
  assert.match(portalCss, /\.store-catalog-section \.store-item-row>span\{margin:0;font-size:12px/);
  assert.match(portalCss, /\.store-catalog-section \.store-item-row>small\{margin:0;font-size:11px/);
  assert.match(portalCss, /\.store-cart-panel\{margin:10px 0;padding:10px/);
});

test('parent store checkout button fits its content', () => {
  assert.match(parentDashboardHtml, /id="checkoutStoreCartBtn"/);
  assert.match(portalCss, /\.store-cart-panel>button\{[^}]*width:fit-content;[^}]*max-width:100%;[^}]*min-height:38px/);
});
