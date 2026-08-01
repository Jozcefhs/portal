import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const portalCss = fs.readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');
const adminHtml = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');

test('shared admin tables keep cell content on one line and scroll horizontally', () => {
  assert.match(portalCss, /\.admin-table-wrap\s*\{[\s\S]*?overflow-x:\s*auto/);
  assert.match(portalCss, /\.admin-table\s*\{[\s\S]*?width:\s*max-content;[\s\S]*?min-width:\s*100%/);
  assert.match(portalCss, /\.admin-table th,\s*\n?\.admin-table td\s*\{[\s\S]*?white-space:\s*nowrap;[\s\S]*?overflow-wrap:\s*normal;[\s\S]*?word-break:\s*normal/);
});

test('the staff portal requests the non-wrapping table stylesheet version', () => {
  assert.match(adminHtml, /css\/style\.css\?v=20260801-nowrap-tables/);
});
