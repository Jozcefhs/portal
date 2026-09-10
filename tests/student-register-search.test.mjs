import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const adminSource = fs.readFileSync(new URL('../js/admin.js', import.meta.url), 'utf8');
const styleSource = fs.readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');

test('student register provides a scoped client-side search', () => {
  assert.match(adminSource, /function applyAdminListSearch\(input\)/);
  assert.match(adminSource, /data-admin-list-search/);
  assert.match(adminSource, /className: 'student-register-table'/);
  assert.match(adminSource, /searchable: true/);
  assert.match(adminSource, /pick\(row, \['AdmissionNo', 'AccountRef', '__id'\]\)/);
  assert.match(adminSource, /pick\(row, \['WalletCardId', 'walletCardId', 'CardId', 'cardId'\]\)/);
  assert.match(adminSource, /searchPlaceholder: `Name, admission number, card, class, type or status`/);
});

test('student register uses the available viewport for its row scrollbar', () => {
  assert.match(styleSource, /\.staff-page \.student-register-table\{[^}]*height:max\(420px,calc\(100dvh - 160px\)\);[^}]*max-height:none/);
  assert.match(styleSource, /\.student-register-table \.admin-list-sort-toolbar\{top:0;z-index:3\}/);
  assert.match(styleSource, /\.student-register-table \.admin-table thead\{top:49px;z-index:2\}/);
});
