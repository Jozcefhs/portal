import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const portalRoot = new URL('../', import.meta.url);
await import(new URL('../js/list-sorting.js', import.meta.url));
const sorting = globalThis.DynamaxListSorting;
const [adminSource, adminHtml, styleSource, serviceWorker] = await Promise.all([
  readFile(new URL('../js/admin.js', import.meta.url), 'utf8'),
  readFile(new URL('../admin.html', import.meta.url), 'utf8'),
  readFile(new URL('../css/style.css', import.meta.url), 'utf8'),
  readFile(new URL('../sw.js', import.meta.url), 'utf8')
]);

function entries(rows) {
  return rows.map((row, index) => ({
    row,
    index,
    name: sorting.nameValue(row),
    created: sorting.timestamp(row, sorting.createdFields),
    modified: sorting.timestamp(row, sorting.modifiedFields)
  }));
}

test('shared web lists support natural alphabetical sorting in both directions', () => {
  const rows = entries([{ Name: 'Class 10' }, { Name: 'class 2' }, { Name: 'Alpha' }]);
  assert.deepEqual(sorting.sortEntries(rows, 'name-asc').map((entry) => entry.row.Name), ['Alpha', 'class 2', 'Class 10']);
  assert.deepEqual(sorting.sortEntries(rows, 'name-desc').map((entry) => entry.row.Name), ['Class 10', 'class 2', 'Alpha']);
});

test('created and modified sorting are independent and keep missing dates last', () => {
  const rows = entries([
    { Name: 'Older edit', CreatedAt: '2026-01-01T00:00:00Z', UpdatedAt: '2026-04-01T00:00:00Z' },
    { Name: 'Newer record', CreatedAt: '2026-03-01T00:00:00Z', UpdatedAt: '2026-03-01T00:00:00Z' },
    { Name: 'Legacy record' }
  ]);
  assert.deepEqual(sorting.sortEntries(rows, 'created-desc').map((entry) => entry.row.Name), ['Newer record', 'Older edit', 'Legacy record']);
  assert.deepEqual(sorting.sortEntries(rows, 'modified-desc').map((entry) => entry.row.Name), ['Older edit', 'Newer record', 'Legacy record']);
});

test('every shared web register renders a remembered sorting selector', () => {
  assert.match(adminSource, /function table\(title, rows, columns\)[\s\S]*data-admin-list-sort/);
  assert.match(adminSource, /window\.localStorage\.setItem\(select\.dataset\.listStorageKey/);
  assert.match(adminSource, /ADMIN_LIST_CREATED_FIELDS/);
  assert.match(adminSource, /ADMIN_LIST_MODIFIED_FIELDS/);
  assert.match(styleSource, /\.admin-list-sort-toolbar\{/);
  assert.match(styleSource, /@media \(max-width:520px\)[^\n]*\.admin-list-sort-toolbar/);
});

test('the shared sorting runtime loads before the edition-neutral admin workspace and is cached offline', () => {
  assert.ok(adminHtml.indexOf('js/list-sorting.js') < adminHtml.indexOf('js/admin.js'));
  assert.match(adminHtml, /js\/list-sorting\.js\?v=20260815-shared-list-sorting/);
  assert.match(serviceWorker, /'\/js\/list-sorting\.js'/);
});

test('manual ordering remains only where the value controls operational sequence', () => {
  assert.doesNotMatch(adminSource, /data-academic-form="arm"[\s\S]{0,1300}name="SortOrder"/);
  assert.doesNotMatch(adminSource, /data-academic-form="armTemplate"[\s\S]{0,1300}name="SortOrder"/);
  assert.match(adminSource, /Progression order/);
  assert.match(adminSource, /Route priority/);
});
