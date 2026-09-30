import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [admin, parent, store, hotel, adminHtml, parentHtml, storeHtml, hotelHtml] = await Promise.all([
  'js/admin.js', 'js/parent-dashboard.js', 'js/store.js', 'js/hotel-booking.js',
  'admin.html', 'parent-dashboard.html', 'store.html', 'hotel-booking.html'
].map((path) => readFile(new URL(path, root), 'utf8')));

test('shared register and specialist searches include available identifiers', () => {
  assert.match(admin, /columns\.filter\(\(column\) => typeof column\.value === 'function'\)/);
  assert.match(admin, /item\.Barcode, item\.SKU, reference/);
  assert.match(admin, /row\.dataset\.listSearch \|\| ''/);
  assert.match(admin, /row\.PersonKey \|\| ''/);
  assert.match(admin, /data-library-borrower-search/);
  assert.match(parent, /item\.Barcode,[\s\S]*?item\.SKU,[\s\S]*?item\.ClassName/);
  assert.match(store, /item\.Barcode, item\.SKU/);
  assert.match(hotel, /room\.RoomNumber, room\.RoomType, room\.RoomId, room\.Capacity/);
});

test('changed search scripts have fresh browser asset versions', () => {
  assert.match(adminHtml, /js\/admin\.js\?v=20260930-tuck-shop-stock-pos/);
  assert.match(parentHtml, /js\/parent-dashboard\.js\?v=20260930-identifier-search/);
  assert.match(storeHtml, /js\/store\.js\?v=20260930-identifier-search/);
  assert.match(hotelHtml, /js\/hotel-booking\.js\?v=20260930-identifier-search/);
});
