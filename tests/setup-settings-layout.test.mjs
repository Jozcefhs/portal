import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [html, css, script, worker] = await Promise.all([
  read('setup.html'), read('css/style.css'), read('js/setup.js'), read('sw.js')
]);

test('icon-free settings headings span the full grid on desktop and mobile', () => {
  assert.match(html, /<div class="settings-section-heading"><div><h2>Branch school terminology<\/h2>/);
  assert.match(css, /\.settings-section-heading>div:only-child\{grid-column:1\/-1;min-width:0\}/);
  // The fallback must not remove the existing two-column layout for icon headings.
  assert.match(css, /\.settings-section-heading\{display:grid;grid-template-columns:42px minmax\(0,1fr\)/);
  assert.match(css, /\.settings-section-heading\{grid-template-columns:36px minmax\(0,1fr\)/);
});

test('terminology remains organisation-scoped and hidden from branch-locked and non-school settings', () => {
  assert.match(script, /getElementById\('branch-school-terminology'\)\.hidden = activeSettingsEdition !== 'school' \|\| branchMode \|\| scopeLocked/);
  assert.match(script, /settingsScopeField\.disabled = scopeLocked/);
  assert.match(script, /settingsBranchField\.disabled = !branchMode \|\| scopeLocked/);
});

test('settings stylesheet and offline shell refresh for the heading repair', () => {
  assert.match(html, /css\/style\.css\?v=[^"]*20261013-settings-heading/);
  assert.match(worker, /dynamax-v378-controlled-subject-changes/);
});
