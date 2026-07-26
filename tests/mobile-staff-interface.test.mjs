import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const portalRoot = new URL('../', import.meta.url);
const [adminHtml, adminJs, portalCss] = await Promise.all([
  readFile(new URL('admin.html', portalRoot), 'utf8'),
  readFile(new URL('js/admin.js', portalRoot), 'utf8'),
  readFile(new URL('css/style.css', portalRoot), 'utf8')
]);

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
  assert.match(adminJs, /openingGesture && deltaX > 0/);
  assert.match(adminJs, /!openingGesture && deltaX < 0/);
});

test('mobile welcome heading uses the reduced type scale', () => {
  assert.match(portalCss, /\.staff-page \.staff-welcome h1\{[^}]*font-size:20px/);
  assert.match(portalCss, /@media \(max-width:380px\)\{[\s\S]*?\.staff-page \.staff-welcome h1\{font-size:19px\}/);
});
