import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPayrollCanRegenerate, buildFinalizedRunSnapshot, validatePayrollForSubmission } from '../../functions/lib/payroll/payroll-run-guards.js';

test('new, Draft, and Rejected payroll can be recalculated', () => {
  assert.equal(assertPayrollCanRegenerate({}), true); assert.equal(assertPayrollCanRegenerate({ RunId: 'R1', Status: 'Draft' }), true); assert.equal(assertPayrollCanRegenerate({ RunId: 'R1', Status: 'Rejected' }), true);
});

test('Submitted payroll cannot silently recalculate', () => {
  assert.throws(() => assertPayrollCanRegenerate({ RunId: 'R1', Status: 'Submitted' }), (error) => error.code === 'PAYROLL_RUN_LOCKED');
});

test('finalized and posted payroll cannot silently recalculate', () => {
  for (const status of ['Approved', 'Posted', 'Part Paid', 'Paid']) assert.throws(() => assertPayrollCanRegenerate({ RunId: 'R1', Status: status }), /locked/);
});

test('approved override forces recalculation before submission', () => {
  assert.throws(() => validatePayrollForSubmission({ EmployeeCount: 1, RequiresRecalculation: 'YES' }, [{ CalculationStatus: 'VALID' }]), (error) => error.code === 'PAYROLL_RECALCULATION_REQUIRED');
});

test('invalid configurable item prevents submission', () => {
  assert.throws(() => validatePayrollForSubmission({ EmployeeCount: 1 }, [{ CalculationMode: 'CONFIGURABLE_PAYE', CalculationStatus: 'INVALID' }]), (error) => error.code === 'INVALID_PAYROLL_CALCULATION');
});

test('valid mixed legacy and configurable register can be submitted', () => {
  assert.equal(validatePayrollForSubmission({ EmployeeCount: 2 }, [{ CalculationMode: 'LEGACY_FLAT_RATE' }, { CalculationMode: 'CONFIGURABLE_PAYE', CalculationStatus: 'VALID' }]), true);
});

test('finalized snapshot preserves profile versions and exact PAYE values', () => {
  const snapshot = buildFinalizedRunSnapshot({ CalculationVersion: 'CONFIGURABLE_PAYE_V1', TaxProfileIds: ['NGA-V1'] }, [{ ItemId: 'I1', EmployeeId: 'E1', TaxProfileId: 'NGA-V1', TaxProfileVersion: 1, CalculatedPaye: 7460, FinalPaye: 5000 }], 'Admin', '2026-07-22T20:00:00Z');
  assert.deepEqual(snapshot.ItemSnapshots[0], { ItemId: 'I1', EmployeeId: 'E1', TaxProfileId: 'NGA-V1', TaxProfileVersion: 1, CalculatedPaye: 7460, FinalPaye: 5000 }); assert.equal(snapshot.FinalizedBy, 'Admin');
});
