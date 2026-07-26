import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeMaterialItems } from '../functions/api/finance-workflow.js';

const portalRoot = new URL('../', import.meta.url);
const [adminJs, portalCss, workflowApi] = await Promise.all([
  readFile(new URL('js/admin.js', portalRoot), 'utf8'),
  readFile(new URL('css/style.css', portalRoot), 'utf8'),
  readFile(new URL('functions/api/finance-workflow.js', portalRoot), 'utf8')
]);

test('material requisition items are numbered and totalled consistently', () => {
  assert.deepEqual(normalizeMaterialItems([
    { item: 'A4 Paper', specification: '80 gsm, white', quantity: '3', unitPrice: '4,250' },
    { item: 'Toner', specification: 'Black, model 59A', quantity: 2, unitPrice: 15000 }
  ]), [
    { SNo: 1, Item: 'A4 Paper', Specification: '80 gsm, white', Quantity: 3, UnitPrice: 4250, Total: 12750 },
    { SNo: 2, Item: 'Toner', Specification: 'Black, model 59A', Quantity: 2, UnitPrice: 15000, Total: 30000 }
  ]);
});

test('material requisition normalizer accepts JSON and ignores empty rows', () => {
  assert.deepEqual(normalizeMaterialItems(JSON.stringify([
    { Item: '', Specification: '', Quantity: '', UnitPrice: '' },
    { Item: 'Marker', Specification: 'Blue', Quantity: 4, UnitPrice: 500 }
  ])), [
    { SNo: 1, Item: 'Marker', Specification: 'Blue', Quantity: 4, UnitPrice: 500, Total: 2000 }
  ]);
});

test('material requisition is an additional workflow with a multi-item table', () => {
  assert.match(adminJs, /data-open-dialog="requisitionDialog">\+ New Requisition/);
  assert.match(adminJs, /data-open-dialog="materialRequisitionDialog">\+ Material Requisition/);
  assert.match(adminJs, /<th>S\/No\.<\/th><th>Item<\/th><th>Specification<\/th><th>Quantity<\/th><th>Unit Price<\/th><th>Total<\/th>/);
  assert.match(adminJs, /data-add-material-item/);
  assert.match(adminJs, /financeRequest\('submitMaterialRequisition', payload\)/);
  assert.match(adminJs, /materialItemsTable\(record\.MaterialItems \|\| record\.Items\)/);
  assert.match(workflowApi, /RequisitionType: 'Material'/);
  assert.match(workflowApi, /MaterialItems: items/);
  assert.match(workflowApi, /action === 'submitmaterialrequisition'/);
  assert.match(portalCss, /\.material-requisition-dialog\{width:min\(1000px/);
});
