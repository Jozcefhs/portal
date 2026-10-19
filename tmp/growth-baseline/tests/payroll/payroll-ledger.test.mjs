import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPayrollJournalLines } from '../../functions/lib/payroll/payroll-ledger-service.js';

const mappings = [
  ['GROSS_SALARY', '6000', ''], ['PAYE', '', '2110'], ['PENSION', '', '2120'], ['NHF', '', '2130'],
  ['OTHER_DEDUCTIONS', '', '2140'], ['NET_SALARY', '', '2300']
].map(([MappingType, DebitAccountId, CreditAccountId]) => ({ MappingId: `MAP-${MappingType}`, MappingType, DebitAccountId, CreditAccountId, Active: 'YES', EffectiveFrom: '2026-01-01' }));
const configurable = { CalculationMode: 'CONFIGURABLE_PAYE', GrossPay: 120000, FinalPaye: 7460, PensionAmount: 9600, NhfAmount: 2500, OtherDeductionTotal: 5000, NetPay: 95440 };

test('configurable payroll posts each liability through effective mappings', () => {
  const result = buildPayrollJournalLines([configurable], mappings, '2026-07-28', 'July payroll');
  assert.equal(result.totalDebit, 120000); assert.equal(result.totalCredit, 120000); assert.equal(result.mappingSnapshot.length, 6);
  assert.equal(result.lines.find((row) => row.AccountCode === '2110').Credit, 7460);
});

test('missing required configurable mapping prevents posting', () => {
  assert.throws(() => buildPayrollJournalLines([configurable], mappings.filter((row) => row.MappingType !== 'PAYE'), '2026-07-28'), (error) => error.code === 'MISSING_PAYROLL_LEDGER_MAPPING');
});

test('expired mappings do not apply', () => {
  const expired = mappings.map((row) => row.MappingType === 'PAYE' ? { ...row, EffectiveTo: '2026-06-30' } : row);
  assert.throws(() => buildPayrollJournalLines([configurable], expired, '2026-07-28'), /Configure the PAYE/);
});

test('legacy payroll retains existing expense and liability behavior', () => {
  const legacy = { CalculationMode: 'LEGACY_FLAT_RATE', SalaryExpenseAccount: '6050', GrossPay: 100000, TotalDeductions: 15000, NetPay: 85000 };
  const result = buildPayrollJournalLines([legacy], [], '2026-07-28'); assert.equal(result.totalDebit, 100000); assert.equal(result.totalCredit, 100000);
  assert.equal(result.lines.find((row) => row.AccountCode === '6050').Debit, 100000);
});

test('mixed legacy and configurable payroll creates one balanced journal', () => {
  const legacy = { CalculationMode: 'LEGACY_FLAT_RATE', SalaryExpenseAccount: '6050', GrossPay: 100000, TotalDeductions: 15000, NetPay: 85000 };
  const result = buildPayrollJournalLines([configurable, legacy], mappings, '2026-07-28'); assert.equal(result.totalDebit, 220000); assert.equal(result.totalCredit, 220000);
});
