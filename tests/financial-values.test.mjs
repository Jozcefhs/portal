import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

await import('../js/financial-values.js');

const financialValues = globalThis.DynamaxFinancialValues;
const portalRoot = new URL('../', import.meta.url);
const [adminHtml, giveHtml, paymentsHtml, parentHtml, adminJs, parentJs] = await Promise.all([
  readFile(new URL('admin.html', portalRoot), 'utf8'),
  readFile(new URL('give.html', portalRoot), 'utf8'),
  readFile(new URL('payments.html', portalRoot), 'utf8'),
  readFile(new URL('parent-dashboard.html', portalRoot), 'utf8'),
  readFile(new URL('js/admin.js', portalRoot), 'utf8'),
  readFile(new URL('js/parent-dashboard.js', portalRoot), 'utf8')
]);

test('financial values use grouping commas without changing their numeric meaning', () => {
  assert.equal(financialValues.format('1360', 8), '1,360');
  assert.equal(financialValues.format(2856000, 2, 2), '2,856,000.00');
  assert.equal(financialValues.format('4507', 2), '4,507');
  assert.equal(financialValues.format('1234567.89', 2), '1,234,567.89');
  assert.equal(financialValues.raw('2,856,000.00'), '2856000.00');
  assert.equal(financialValues.parse('1,360.50'), 1360.5);
});

test('school and church money-entry surfaces load the shared comma formatter', () => {
  [adminHtml, giveHtml, paymentsHtml, parentHtml].forEach((html) => {
    assert.match(html, /js\/financial-values\.js\?v=20260803-finance-commas/);
  });
  assert.match(giveHtml, /name="Amount"[^>]*data-finance-input/);
  assert.match(paymentsHtml, /id="walletAmount"[^>]*data-finance-input/);
  assert.match(adminJs, /name="GrossNgnProceeds"[^>]*data-finance-input[^>]*data-finance-fixed="2"/);
  assert.match(adminJs, /name="ApprovalMaxAmount"[^>]*data-finance-input/);
  assert.match(adminJs, /data-material-field="unitPrice"[^>]*data-finance-input/);
  assert.match(parentJs, /input\.dataset\.financeInput = ''/);
});
