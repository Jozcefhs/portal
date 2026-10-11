import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { payrollImportRows, payrollProfileValues, payrollProfileComponents } from '../../functions/lib/payroll/profile-input.js';
import { accountingRequestBranch, accountingRowsForBranch, accountingWriteBranch } from '../../functions/lib/accounting-branch-scope.js';

const source = readFileSync(new URL('../../functions/api/backend.js', import.meta.url), 'utf8');
const extract = (from, to) => source.slice(source.indexOf(from), source.indexOf(to));
const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
function harness(records = []) {
  const rows = structuredClone(records), writes = [];
  let id = 0;
  const context = vm.createContext({ clean, lower, sameText: (a,b) => lower(a) === lower(b),
    accountingWriteBranch, accountingRequestBranch, accountingRowsForBranch, payrollImportRows, payrollProfileValues,
    ledgerDocumentId: prefix => `${prefix}-${++id}`, safeDocumentId: value => value,
    yesNo: value => ['yes','true','1'].includes(lower(value)) ? 'YES' : 'NO',
    nowIso: () => '2026-10-11T10:00:00.000Z', asMoneyNumber: value => Number(value || 0),
    PAYROLL_BULK_ACTION_LIMIT: 15,
    listCollection: async () => rows, writePayrollAudit: async () => {},
    upsertDocument: async (_env, _collection, key, payload) => {
      writes.push(payload);
      const index = rows.findIndex(row => row.EmployeeId === key);
      if (index < 0) rows.push(payload); else rows[index] = payload;
    }
  });
  vm.runInContext(extract('function accountingRoleAllowed(', 'const DEPARTMENT_ACCOUNTING_ROLES'), context);
  vm.runInContext(extract('async function savePayrollProfile(', 'async function createPayrollProfilesFromStaff('), context);
  vm.runInContext(extract('async function importPayrollProfiles(', 'async function requestPayrollTaxOverride('), context);
  return { rows, writes, run: body => context.importPayrollProfiles({}, body), save: body => context.savePayrollProfile({}, body) };
}
const actor = edition => ({ UserRole: 'Accounts Officer', UserUsername: 'accounts', UserBranchId: 'main', BranchId: 'main', RecordedBy: 'Accounts', OrganisationEdition: edition });
const row = { Username: 'ada', DisplayName: 'Ada', BasicSalary: '150,000.00' };

for (const edition of ['school', 'faith', 'organization']) {
  test(`${edition}: nested actor/branch/extra-cell fields are rejected before writes`, async () => {
    for (const injected of [{ UserBranchId: '' }, { userRole: 'Super Admin' }, { BranchId: 'west' }, { RecordedBy: 'boss' }, { '': ['000'] }]) {
      const h = harness();
      await assert.rejects(h.run({ ...actor(edition), Profiles: [{ ...row, ...injected }] }), /unsupported column/);
      assert.equal(h.writes.length, 0);
    }
  });
  test(`${edition}: foreign employee ID cannot be moved or overwritten`, async () => {
    const h = harness([{ ...row, EmployeeId: 'WEST1', BranchId: 'west', BasicSalary: 5000 }]);
    const result = await h.run({ ...actor(edition), Profiles: [{ ...row, EmployeeId: 'WEST1' }] });
    assert.equal(result.failures.length, 1); assert.equal(h.writes.length, 0);
    assert.equal(h.rows[0].BasicSalary, 5000);
  });
  test(`${edition}: duplicate username spanning batches rejects complete file before mutation`, async () => {
    const h = harness();
    const profiles = Array.from({ length: 16 }, (_, index) => ({ ...row, Username: `user${index}` }));
    profiles[15].Username = 'USER0';
    for (const Cursor of [0, 15]) await assert.rejects(h.run({ ...actor(edition), Profiles: profiles, Cursor }), /duplicate username/);
    assert.equal(h.writes.length, 0);
  });
  test(`${edition}: invalid calculation choices in a later batch fail before the first write`, async () => {
    for (const extra of [{ CalculationMode: 'UNKNOWN' }, { TaxStatus: 'UNKNOWN' }]) {
      const h = harness();
      const profiles = Array.from({ length: 16 }, (_, index) => ({ ...row, Username: `user${index}` }));
      Object.assign(profiles[15], extra);
      await assert.rejects(h.run({ ...actor(edition), Profiles: profiles }), /invalid (CalculationMode|TaxStatus)/);
      assert.equal(h.writes.length, 0);
    }
  });
  test(`${edition}: salary-only update preserves allowances, bank, tax and inactive status`, async () => {
    const existing = { ...row, EmployeeId: 'EMP1', BranchId: 'main', BasicSalary: 100,
      Allowances: [{ Name: 'Housing', Amount: 200 }], Deductions: [{ Name: 'Loan', Amount: 10 }],
      BankName: 'Example', AccountNumber: '0123456789', PensionRate: 5, TaxRate: 7, Active: 'NO' };
    const h = harness([existing]);
    const result = await h.run({ ...actor(edition), Profiles: [{ ...row, BasicSalary: 300 }] });
    assert.equal(result.updated, 1);
    for (const key of ['Allowances','Deductions','BankName','AccountNumber','PensionRate','TaxRate','Active'])
      assert.deepEqual(JSON.parse(JSON.stringify(h.rows[0][key])), existing[key]);
    assert.equal(h.rows[0].BasicSalary, 300);
  });
  test(`${edition}: advanced JSON CSV values reach the real profile save`, async () => {
    const h = harness();
    const result = await h.run({ ...actor(edition), Profiles: [{ ...row,
      ComponentAssignments: '[{"Code":"BASIC","Amount":"150,000.00"},{"Code":"HOUSING"}]',
      AdditionalReliefs: '[{"Name":"Approved relief","AnnualAmount":"120,000.00"}]',
      BeginningYearCumulative: '{"GrossPay":900000,"Paye":60000}' }] });
    assert.equal(result.created, 1); assert.equal(result.failures.length, 0);
    assert.equal(h.rows[0].ComponentAssignments[0].Amount, 150000);
    assert.equal(Object.hasOwn(h.rows[0].ComponentAssignments[1], 'Amount'), false, 'omitted values must inherit component configuration');
    assert.equal(h.rows[0].AdditionalReliefs[0].AnnualAmount, 120000);
    assert.deepEqual(h.rows[0].BeginningYearCumulative, { GrossPay: 900000, Paye: 60000 });
  });
  test(`${edition}: malformed advanced fields reject the whole file before profile writes`, async () => {
    for (const extra of [{ ComponentAssignments: 'bad JSON' }, { ComponentAssignments: '{}' },
      { ComponentAssignments: '[null]' }, { ComponentAssignments: '[{"Amount":100}]' },
      { ComponentAssignments: '[{"Code":"BASIC","Amount":"NaN"}]' },
      { ComponentAssignments: '[{"Code":"BASIC","PercentageRate":101}]' },
      { AdditionalReliefs: '{}' }, { AdditionalReliefs: '[{"Amount":-1}]' },
      { BeginningYearCumulative: '[]' }, { BeginningYearCumulative: '{"Gross":1e999}' }]) {
      const existing = { ...row, EmployeeId: 'EMP1', BranchId: 'main', BasicSalary: 100,
        ComponentAssignments: [{ Code: 'BASIC', Amount: 100 }] };
      const h = harness([existing]);
      await assert.rejects(h.run({ ...actor(edition), Profiles: [{ ...row, Username: 'valid' }, { ...row, ...extra }] }));
      assert.equal(h.writes.length, 0); assert.deepEqual(h.rows[0], existing);
      await assert.rejects(h.save({ ...actor(edition), ...row, EmployeeId: 'EMP1', ...extra }));
      assert.equal(h.writes.length, 0);
    }
  });
  test(`${edition}: omitted advanced columns preserve existing configuration; explicit JSON clears it`, async () => {
    const existing = { ...row, EmployeeId: 'EMP1', BranchId: 'main', BasicSalary: 100,
      ComponentAssignments: [{ Code: 'BASIC', Amount: 100 }], AdditionalReliefs: [{ MonthlyAmount: 10 }],
      BeginningYearCumulative: { Gross: 1000 } };
    const h = harness([existing]);
    await h.run({ ...actor(edition), Profiles: [row] });
    for (const key of ['ComponentAssignments', 'AdditionalReliefs', 'BeginningYearCumulative']) assert.deepEqual(h.rows[0][key], existing[key]);
    await h.run({ ...actor(edition), Profiles: [{ ...row, ComponentAssignments: '[]', AdditionalReliefs: '[]', BeginningYearCumulative: '{}' }] });
    assert.deepEqual(h.rows[0].ComponentAssignments, []); assert.deepEqual(h.rows[0].AdditionalReliefs, []);
    assert.deepEqual(h.rows[0].BeginningYearCumulative, {});
  });
}

test('numeric validation rejects malformed, nonfinite and negative values without reinterpretation', () => {
  for (const BasicSalary of ['1e3','oops','150,00', 'NaN','Infinity', NaN, Infinity, -1, '1.005'])
    assert.throws(() => payrollImportRows([{ ...row, BasicSalary }]));
  assert.equal(payrollImportRows([row])[0].BasicSalary, 150000);
  for (const value of ['Housing=oops', 'Housing=-5', '[{"Name":"Housing","Amount":"1e3"}]', 'broken'])
    assert.throws(() => payrollProfileComponents(value, 'Allowances'));
  assert.throws(() => payrollImportRows([{ ...row, TaxRate: 101 }]));
});

test('normal 500-row imports finish in 34 bounded batches and retain leading bank-account zeros', async () => {
  const h = harness();
  const Profiles = Array.from({ length: 500 }, (_, index) => ({ ...row, Username: `user${index}`, AccountNumber: '0123456789' }));
  let Cursor = 0, batches = 0, created = 0;
  do {
    const result = await h.run({ ...actor('school'), Profiles, Cursor });
    batches++; created += result.created;
    assert.equal(result.failures.length, 0);
    Cursor = result.progress.nextCursor;
  } while (Cursor !== null);
  assert.equal(batches, 34); assert.equal(created, 500);
  assert.equal(h.rows[499].AccountNumber, '0123456789');
});

test('explicit optional-field clearing is distinguished from omitted fields', () => {
  const result = payrollProfileValues({ BasicSalary: 0, BankName: '', Allowances: [] }, { BankName: 'old', AccountNumber: '001', Allowances: [{ Name: 'A', Amount: 10 }] });
  assert.equal(result.BankName, ''); assert.equal(result.AccountNumber, '001'); assert.deepEqual(result.Allowances, []);
});

test('unspecified pension override retains rate fallback while explicit zero remains valid', () => {
  assert.equal(Object.hasOwn(payrollProfileValues({ BasicSalary: 1000, PensionRate: 8 }), 'PensionRateOverride'), false);
  assert.equal(Object.hasOwn(payrollImportRows([{ ...row, PensionRate: 8, PensionRateOverride: '' }])[0], 'PensionRateOverride'), false);
  assert.equal(payrollProfileValues({ BasicSalary: 1000, PensionRateOverride: 0 }, { PensionRate: 8 }).PensionRateOverride, 0);
  assert.equal(payrollProfileValues({ BasicSalary: 1000 }, { PensionRate: 8, PensionRateOverride: 5 }).PensionRateOverride, 5);
});
