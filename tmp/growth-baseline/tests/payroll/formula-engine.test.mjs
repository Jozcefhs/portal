import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePayrollFormula, parsePayrollFormula, validatePayrollFormula } from '../../functions/lib/payroll/formula-engine.js';

test('evaluates arithmetic with normal precedence', () => {
  assert.equal(evaluatePayrollFormula('Basic + Housing * 2', { Basic: 100, Housing: 25 }), 150);
});

test('evaluates parentheses and unary values', () => {
  assert.equal(evaluatePayrollFormula('-(Basic - 50) * 2', { Basic: 100 }), -100);
});

test('evaluates MIN, MAX, and ROUND safely', () => {
  assert.equal(evaluatePayrollFormula('ROUND(MAX(200000, AnnualGross * 0.01) + MIN(10.555, 20), 2)', { AnnualGross: 1_000_000 }), 200010.56);
});

test('formula variable names are case-insensitive at evaluation', () => {
  assert.equal(evaluatePayrollFormula('BASIC * PensionRate', { basic: 1000, pensionrate: 0.08 }), 80);
});

test('validation reports formula dependencies', () => {
  assert.deepEqual(validatePayrollFormula('Basic + Housing', ['Basic', 'Housing']).variables, ['Basic', 'Housing']);
});

test('validation rejects unknown variables', () => {
  assert.throws(() => validatePayrollFormula('Basic + Secret', ['Basic']), /Unknown variable/);
});

test('parser rejects unapproved functions', () => {
  assert.throws(() => parsePayrollFormula('fetch(Basic)'), /not allowed/);
});

test('parser rejects code-like property access', () => {
  assert.throws(() => parsePayrollFormula('globalThis.process'), /Invalid number|Unsupported character/);
});

test('evaluation rejects division by zero', () => {
  assert.throws(() => evaluatePayrollFormula('Basic / 0', { Basic: 100 }), /Division by zero/);
});

test('ROUND precision is constrained', () => {
  assert.throws(() => evaluatePayrollFormula('ROUND(Basic, 9)', { Basic: 10.5 }), /precision/);
});
