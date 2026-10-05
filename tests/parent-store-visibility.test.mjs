import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { normalizeClassKey } from '../functions/lib/class-names.js';
import { storeItemIsPurchasable } from '../functions/api/init-payment.js';

const source = await readFile(new URL('../js/parent-dashboard.js', import.meta.url), 'utf8');
const start = source.indexOf('function storeItemMatchesChild(');
const end = source.indexOf('function renderStores(', start);
assert.ok(start >= 0 && end > start, 'Parent store eligibility functions must exist');
const { normalizePortalClass, storeItemMatchesChild } = runInNewContext(
  `${source.slice(start, end)}; ({ normalizePortalClass, storeItemMatchesChild });`
);

test('parent class normalization agrees with checkout and never truncates two-digit grades', () => {
  for (const name of ['Grade 1', 'Grade 6', 'Grade 7', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12',
    'Grade 12 / Distinction', 'Primary 3', 'Basic 7', 'Basic 9', 'JSS 2', 'SS 3', 'Nursery 2']) {
    assert.equal(normalizePortalClass(name), normalizeClassKey(name), name);
  }
  for (const grade of [10, 11, 12]) assert.equal(normalizePortalClass(`Grade ${grade}`), `grade${grade}`);
});

const catalog = ['EEC1', 'ELD', 'FFT', 'GRH', 'NTB', 'S-ELD'].map((ItemCode) => ({
  ItemCode, ClassName: ItemCode === 'EEC1' ? 'Grade 10' : 'All',
  SchoolSection: 'Secondary', BranchId: 'main'
}));

test('all six secondary store items remain visible and purchasable for Grades 10 to 12', () => {
  for (const grade of [7, 8, 9, 10, 11, 12]) {
    const child = { ClassName: `Grade ${grade}`, SchoolSection: 'Secondary', BranchId: 'Main Branch' };
    assert.equal(catalog.filter((item) => storeItemMatchesChild(item, child)).length, 6, `Grade ${grade}`);
    for (const item of catalog) {
      assert.equal(storeItemMatchesChild(item, child), storeItemIsPurchasable(item, child), item.ItemCode);
    }
  }
});

test('parent store retains section and branch isolation after fixing grade matching', () => {
  const children = [
    { ClassName: 'Primary 3', SchoolSection: 'Secondary', BranchId: 'main' },
    { ClassName: 'Grade 12', SchoolSection: 'Secondary', BranchId: 'west' }
  ];
  for (const child of children) {
    for (const item of catalog) {
      assert.equal(storeItemMatchesChild(item, child), false);
      assert.equal(storeItemIsPurchasable(item, child), false);
    }
  }
  const primaryItem = { ClassName: 'All', SchoolSection: 'Primary', BranchId: 'main' };
  assert.equal(storeItemMatchesChild(primaryItem, { ClassName: 'Grade 3', BranchId: 'main' }), true);
});
