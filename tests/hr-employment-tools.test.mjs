import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../js/hr-employment-tools.js', import.meta.url), 'utf8');
const context = { window: {} };
vm.runInNewContext(source, context);
const tools = context.window.DynamaxHrEmployment;

test('salary components preserve explicit names and amounts without inventing deductions', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(tools.normalizeComponents([{Name:' Housing ',Amount:'20,000'},{Name:'Transport',Amount:10000},{Name:'Other',Amount:0}]))),
    [{Name:'Housing',Amount:20000},{Name:'Transport',Amount:10000},{Name:'Other',Amount:0}]);
  assert.equal(tools.normalizeComponents([]).length, 0);
  for (const invalid of [{Name:'',Amount:100},{Name:'Transport',Amount:-1},{Name:'Tax',Amount:NaN},{Name:'Other',Amount:'1.234'},{Name:'Other',Amount:''}]) {
    assert.throws(() => tools.normalizeComponents([invalid]), /name and a valid amount/);
  }
});

test('HR integration is edition-neutral and does not load payroll on workspace opening', async () => {
  const admin = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../admin.html', import.meta.url), 'utf8');
  assert.match(admin, /key: 'salaryLetters', label: 'Salary & letters'/);
  assert.match(admin, /DynamaxHrEmployment\?\.mount/);
  assert.ok(html.indexOf('js/hr-employment-tools.js?') < html.indexOf('js/admin.js?'));
  assert.doesNotMatch(source, /school|church|hospital|hotel/i);
  assert.match(source, /PayrollVersion: loaded.PayrollVersion/);
  assert.match(source, /ConfirmedRecipientEmail: letter.RecipientEmail, ConfirmSend: true/);
  assert.doesNotMatch(source, /loadHumanResources\(/);
});
