import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const adminJs = readFileSync(new URL('../js/admin.js', import.meta.url), 'utf8');
const adminHtml = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');
const start = adminJs.indexOf('function syncSidebarNavigation()');
const end = adminJs.indexOf('function installSidebarSwipeGestures()', start);
assert.ok(start >= 0 && end > start, 'Use the production sidebar functions');
const source = adminJs.slice(start, end);

function fixture({mobile = false, signedIn = true, saved = null, storageBlocked = false} = {}) {
  const classes = () => {
    const values = new Set();
    return {contains: name => values.has(name), toggle(name, enabled) { enabled ? values.add(name) : values.delete(name); }};
  };
  const document = {body: {classList: classes()}, activeElement: null};
  const button = {hidden: true, attrs: {}, events: {}, setAttribute(name, value) {this.attrs[name] = value;}, focus() {document.activeElement = this;}, addEventListener(name, fn) {this.events[name] = fn;}};
  const navItem = {focus() {document.activeElement = this;}};
  const sidebar = {classList: classes(), attrs: {}, inert: false, setAttribute(name, value) {this.attrs[name] = value;}, contains: el => el === navItem, querySelector: () => navItem};
  const dashboard = {hidden: !signedIn};
  const scrim = {hidden: true};
  const accountMenu = {open: false};
  const writes = [];
  const window = {mobile, matchMedia() {return {matches: this.mobile};}};
  const localStorage = {getItem() {if (storageBlocked) throw new Error('Storage unavailable'); return saved;}, setItem(key, value) {if (storageBlocked) throw new Error('Storage unavailable'); writes.push([key, value]);}};
  const context = vm.createContext({document, window, localStorage, sidebarEl: sidebar, sidebarScrim: scrim, sidebarToggleButton: button, dashboardEl: dashboard, staffAccountMenu: accountMenu});
  vm.runInContext(`let desktopSidebarCollapsed = false;\n${source}\ninstallSidebarNavigation();`, context);
  const run = code => vm.runInContext(code, context);
  return {button, sidebar, navItem, dashboard, scrim, accountMenu, document, window, writes, run};
}

test('signed-in desktop starts with an accessible visible sidebar', () => {
  const f = fixture();
  assert.equal(f.button.hidden, false);
  assert.equal(f.button.attrs['aria-expanded'], 'true');
  assert.equal(f.button.attrs['aria-label'], 'Hide navigation menu');
  assert.equal(f.sidebar.inert, false);
  assert.equal(f.sidebar.attrs['aria-hidden'], 'false');
  assert.equal(f.scrim.hidden, true);
});

test('header toggle hides and reopens the desktop sidebar without a mobile overlay', () => {
  const f = fixture();
  f.accountMenu.open = true;
  f.button.events.click();
  assert.equal(f.document.body.classList.contains('staff-sidebar-collapsed'), true);
  assert.equal(f.button.hidden, false, 'The reopen control stays available');
  assert.equal(f.button.attrs['aria-expanded'], 'false');
  assert.equal(f.button.title, 'Show navigation menu');
  assert.equal(f.sidebar.inert, true, 'Hidden links cannot receive keyboard focus');
  assert.equal(f.sidebar.attrs['aria-hidden'], 'true');
  assert.equal(f.accountMenu.open, false);
  assert.equal(f.scrim.hidden, true);
  assert.equal(f.document.body.classList.contains('staff-sidebar-open'), false);
  assert.deepEqual(f.writes, [['dynamax:desktop-sidebar-collapsed', 'true']]);
  f.button.events.click();
  assert.equal(f.document.body.classList.contains('staff-sidebar-collapsed'), false);
  assert.equal(f.sidebar.inert, false);
  assert.equal(f.button.attrs['aria-expanded'], 'true');
  assert.deepEqual(f.writes[1], ['dynamax:desktop-sidebar-collapsed', 'false']);
});

test('desktop collapse safely moves focus out of the hidden menu', () => {
  const f = fixture();
  f.document.activeElement = f.navItem;
  f.run('toggleDesktopSidebar()');
  assert.equal(f.document.activeElement, f.button);
});

test('module navigation and Escape drawer cleanup do not reset the desktop preference', () => {
  const f = fixture();
  f.run('toggleDesktopSidebar(); setSidebarOpen(false)');
  assert.equal(f.sidebar.inert, true);
  assert.equal(f.document.body.classList.contains('staff-sidebar-collapsed'), true);
  f.run('toggleDesktopSidebar(); setSidebarOpen(false)');
  assert.equal(f.sidebar.inert, false);
  assert.equal(f.document.body.classList.contains('staff-sidebar-collapsed'), false);
});

test('desktop collapsed preference is restored on reload', () => {
  const f = fixture({saved: 'true'});
  assert.equal(f.document.body.classList.contains('staff-sidebar-collapsed'), true);
  assert.equal(f.button.attrs['aria-expanded'], 'false');
  assert.equal(f.sidebar.inert, true);
  assert.deepEqual(f.writes, [], 'Restoring a preference does not write anything');
});

test('missing, false or invalid stored preferences keep the desktop menu open', () => {
  for (const saved of [null, 'false', 'invalid']) {
    const f = fixture({saved});
    assert.equal(f.sidebar.inert, false);
    assert.equal(f.button.attrs['aria-expanded'], 'true');
  }
});

test('unavailable browser storage does not prevent toggling the sidebar', () => {
  const f = fixture({storageBlocked: true});
  assert.doesNotThrow(() => f.run('toggleDesktopSidebar()'));
  assert.equal(f.sidebar.inert, true);
  assert.doesNotThrow(() => f.run('toggleDesktopSidebar()'));
  assert.equal(f.sidebar.inert, false);
});

test('mobile retains its drawer, scrim and first-link focus instead of a desktop toggle', () => {
  const f = fixture({mobile: true, saved: 'true'});
  assert.equal(f.button.hidden, true);
  assert.equal(f.document.body.classList.contains('staff-sidebar-collapsed'), false);
  assert.equal(f.sidebar.inert, true);
  f.run('toggleDesktopSidebar()');
  assert.deepEqual(f.writes, []);
  f.run('setSidebarOpen(true)');
  assert.equal(f.sidebar.classList.contains('is-open'), true);
  assert.equal(f.sidebar.inert, false);
  assert.equal(f.scrim.hidden, false);
  assert.equal(f.document.body.classList.contains('staff-sidebar-open'), true);
  assert.equal(f.document.activeElement, f.navItem);
  f.run('setSidebarOpen(false)');
  assert.equal(f.sidebar.inert, true);
  assert.equal(f.scrim.hidden, true);
});

test('desktop-to-mobile-to-desktop resize preserves the desktop choice without leaving an overlay', () => {
  const f = fixture({saved: 'true'});
  f.window.mobile = true;
  f.run('syncSidebarNavigation(); setSidebarOpen(true)');
  assert.equal(f.document.body.classList.contains('staff-sidebar-collapsed'), false);
  assert.equal(f.button.hidden, true);
  assert.equal(f.sidebar.inert, false);
  f.window.mobile = false;
  f.run('setSidebarOpen(false)');
  assert.equal(f.document.body.classList.contains('staff-sidebar-collapsed'), true);
  assert.equal(f.document.body.classList.contains('staff-sidebar-open'), false);
  assert.equal(f.button.hidden, false);
  assert.equal(f.scrim.hidden, true);
});

test('sign-in screen has no menu toggle and signing in restores the appearance choice', () => {
  const f = fixture({signedIn: false, saved: 'true'});
  assert.equal(f.button.hidden, true);
  assert.equal(f.sidebar.inert, true);
  assert.equal(f.document.body.classList.contains('staff-sidebar-collapsed'), false);
  assert.deepEqual(f.writes, []);
  f.run('toggleDesktopSidebar(); setSidebarOpen(true)');
  assert.equal(f.scrim.hidden, true);
  f.dashboard.hidden = false;
  f.run('syncSidebarNavigation()');
  assert.equal(f.button.hidden, false);
  assert.equal(f.document.body.classList.contains('staff-sidebar-collapsed'), true);
  f.dashboard.hidden = true;
  f.run('setSidebarOpen(false)');
  assert.equal(f.button.hidden, true);
  assert.equal(f.document.body.classList.contains('staff-sidebar-collapsed'), false);
});

test('production markup and styles expose the desktop control without changing mobile navigation', () => {
  assert.match(adminHtml, /class="staff-brand-controls"[\s\S]*?id="staffSidebarToggle"[^>]*aria-controls="staffSidebar"[^>]*hidden[\s\S]*?id="staffBrand"/);
  assert.doesNotMatch(adminHtml, /id="staffMenuToggle"/);
  assert.match(css, /@media\(min-width:681px\)\{\.staff-sidebar-collapsed \.staff-app-layout\{grid-template-columns:minmax\(0,1fr\)\}\.staff-sidebar-collapsed \.staff-sidebar\{display:none\}\}/);
  assert.match(css, /@media\(max-width:680px\)\{\.staff-sidebar-toggle\{display:none\}\}/);
  assert.match(css, /\.staff-sidebar-toggle\[hidden\]\{display:none\}/);
  assert.match(adminHtml, /css\/style\.css\?[^"\n]*sidebar-collapse/);
  assert.match(adminHtml, /js\/admin\.js\?[^"\n]*sidebar-collapse/);
});

test('production lifecycle and resize synchronize navigation without touching financial data', () => {
  assert.match(adminJs, /dashboardEl\.hidden = true;\s*identityEl\.hidden = true;\s*syncSidebarNavigation\(\)/);
  assert.match(adminJs, /identityEl\.hidden = false;\s*dashboardEl\.hidden = false;\s*syncSidebarNavigation\(\)/);
  assert.match(adminJs, /updateStaffThemeToggle\(\);\s*installSidebarNavigation\(\)/);
  assert.match(adminJs, /window\.addEventListener\('resize',[\s\S]*?setSidebarOpen\(false\);[\s\S]*?else syncSidebarNavigation\(\)/);
  assert.doesNotMatch(source, /fetch\(|sessionRequest\(|currentUser|\.role\b|payment|wallet|postLedger/i);
});
