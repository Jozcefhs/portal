import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseProductCsv, normalizeProductRow, productCsv, productChunks, duplicatePreviewRows } from '../js/vendor-product-import.js';

test('assignment CSV requires stable stock IDs, not names or quantities', () => {
  const rows = parseProductCsv('\uFEFFInventoryId,Owner,Store\r\nstock1,Henocop Limited,tuckShop\r\n','assign');
  assert.equal(rows[0].InventoryId,'stock1'); assert.equal(rows[0].RowNumber,2);
  assert.deepEqual(normalizeProductRow(rows[0],'assign').errors,[]);
  assert.throws(() => parseProductCsv('ItemName,Owner\nWater,v1','assign'),/InventoryId/);
  assert.ok(normalizeProductRow({InventoryId:'../other',Owner:'v1'},'assign').errors.length);
});
test('quoted CSV supports escaped quotes, commas, CRLF and embedded newlines', () => {
  const rows = parseProductCsv('ItemCode,ItemName,Owner,Quantity,Price\r\nA,"Book, ' +
    '""special""\ncopy",v1,2,"1,200.50"\r\nB,Pen,v2,0,20','create');
  assert.equal(rows[0].ItemName,'Book, "special"\ncopy');
  assert.equal(rows[1].RowNumber,4);
  const normalized = normalizeProductRow(rows[0],'create');
  assert.deepEqual(normalized.errors,[]); assert.equal(normalized.row.Price,1200.5);
});
test('CSV rejects unknown / repeated headers, wrong widths, malformed quotes and oversized files', () => {
  for (const text of ['InventoryId,Owner,Owner\na,b,c','InventoryId,Owner,Quantityy\na,b,c',
    'InventoryId,Owner\na,b,c','InventoryId,Owner\na,"b','InventoryId,Owner\na,"b"x']) assert.throws(() => parseProductCsv(text,'assign'));
  assert.throws(() => parseProductCsv('InventoryId,Owner\n' + 'a'.repeat(512*1024),'assign'),/512 KB/);
  assert.throws(() => parseProductCsv('InventoryId,Owner\n' + 'a,v1\n'.repeat(1001),'assign'),/1,000/);
  assert.throws(() => parseProductCsv('InventoryId,Owner\n','assign'),/at least one/);
});
test('new product validation excludes negative stock, invalid money, blank owner and inherited IDs', () => {
  const row = {ItemCode:'water-1',ItemName:'Water',Owner:'v1',Quantity:'2',Price:'100.50'};
  assert.equal(normalizeProductRow(row,'create').row.ItemCode,'WATER-1');
  for (const extra of [{Quantity:'-1'},{Quantity:'1.5'},{Quantity:'1e3'},{Price:'0'},{Price:'10.123'},{Price:'1,00'},
    {Price:'NaN'},{Price:'1e3'},{Owner:''},{InventoryId:'stock1'},{Active:'maybe'},{ItemCode:'../a'}]) assert.ok(normalizeProductRow({...row,...extra},'create').errors.length,JSON.stringify(extra));
});
test('CSV download escapes spreadsheet formulas and roundtrips normal identities', () => {
  const text = productCsv(['InventoryId','Owner','ItemName'],[{InventoryId:'s1',Owner:'v1',ItemName:'Water, "large"'},
    {InventoryId:'s2',Owner:'=HYPERLINK("bad")',ItemName:'@command'}]);
  const rows = parseProductCsv(text,'assign');
  assert.equal(rows[0].ItemName,'Water, "large"'); assert.ok(rows[1].Owner.startsWith("'=")); assert.ok(rows[1].ItemName.startsWith("'@"));
});
test('chunks remain bounded and duplicate checks span the entire file, including owner aliases', () => {
  assert.deepEqual(productChunks(Array.from({length:41},(_,i)=>i)).map(rows=>rows.length),[20,20,1]);
  const previews = [{rows:[{InventoryId:'s1',Section:'tuckShop',RowNumber:2,Errors:[]}]},
    {rows:[{InventoryId:'s1',Section:'tuckShop',RowNumber:23,Errors:[]},{InventoryId:'s1',Section:'restaurant',RowNumber:24,Errors:[]}]}];
  assert.deepEqual([...duplicatePreviewRows(previews)],[2,23]);
});
test('CSV controls are direct browser download links, with object URLs cleaned up on close', async () => {
  const source = await readFile(new URL('../js/vendor-settlements.js',import.meta.url),'utf8');
  assert.match(source,/<a class="vendor-download" data-template download>/);
  assert.match(source,/<a class="vendor-download" data-owners download>/);
  assert.match(source,/el\.href = url; el\.download = filename/);
  assert.match(source,/modal\.addEventListener\('close',[\s\S]*URL\.revokeObjectURL/);
});
