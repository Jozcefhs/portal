import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [css, html, admin] = await Promise.all([
  readFile(new URL('../css/style.css', import.meta.url), 'utf8'),
  readFile(new URL('../admin.html', import.meta.url), 'utf8'),
  readFile(new URL('../js/admin.js', import.meta.url), 'utf8')
]);

test('student bulk actions wrap with gaps rather than squeezing into one row', () => {
  assert.match(css, /\.student-onboarding-link-action\{[^}]*flex-wrap:wrap;[^}]*gap:10px;[^}]*min-width:0/);
  assert.match(css, /\.student-onboarding-link-action>button\{[^}]*min-width:0;max-width:100%;min-height:44px;margin:0;white-space:normal;overflow-wrap:anywhere;line-height:1\.35/);
});

test('phone student actions use a full-width single column with safe grid sizing', () => {
  assert.match(css, /@media\(max-width:600px\)\{\.student-onboarding-link-action\{display:grid;grid-template-columns:minmax\(0,1fr\)\}\.student-onboarding-link-action>button\{width:100%\}\}/);
  assert.match(html, /css\/style\.css\?v=20261006-student-actions-mobile/);
});

test('all student action buttons share the responsive container, including admin-only actions', () => {
  assert.match(admin, /class="student-onboarding-link-action"[\s\S]*?data-copy-shared-parent-onboarding[\s\S]*?data-review-all-student-billing/);
  assert.match(admin, /querySelector\('\.student-onboarding-link-action'\)\?\.insertAdjacentHTML\('beforeend',[\s\S]*?data-save-student-profile-defaults[\s\S]*?data-review-boardwear-all/);
});
