import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateConfigurablePayroll, calculateLegacyPayroll } from '../../functions/lib/payroll/payroll-calculation-service.js';

const bands = [[1, 0, 300000, 7, false], [2, 300000, 600000, 11, false], [3, 600000, 1100000, 15, false], [4, 1100000, 1600000, 19, false], [5, 1600000, 3200000, 21, false], [6, 3200000, 0, 24, true]]
  .map(([Sequence, LowerLimit, UpperLimit, Rate, open]) => ({ BandId: `B${Sequence}`, TaxProfileId: 'NGA-V1', Sequence, LowerLimit, UpperLimit, Rate, IsOpenEnded: open ? 'YES' : 'NO', Active: 'YES' }));
const configuration = {
  profiles: [{ ProfileId: 'NGA-V1', Version: 1, Name: 'Nigeria', Jurisdiction: 'FCT', Active: 'YES', IsDefault: 'YES', EffectiveFrom: '2026-01-01', AnnualizationMethod: 'MONTHLY_X_12', CraEnabled: 'YES', CraFixedRelief: 200000, CraGrossComparisonRate: 1, CraAdditionalReliefRate: 20, RoundingMethod: 'NEAREST', RoundingPrecision: 2 }],
  bands,
  components: [
    { ComponentId: 'BASIC', Code: 'BASIC', Name: 'Basic', ComponentType: 'earning', CalculationType: 'fixed_amount', IsTaxable: 'YES', IsPensionable: 'YES', IsNhfApplicable: 'YES', Active: 'YES', DisplayOrder: 10 },
    { ComponentId: 'HOUSE', Code: 'HOUSING', Name: 'Housing', ComponentType: 'earning', CalculationType: 'formula', Formula: 'Basic * 0.20', IsTaxable: 'YES', IsPensionable: 'YES', Active: 'YES', DisplayOrder: 20 },
    { ComponentId: 'LOAN', Code: 'LOAN', Name: 'Staff Loan', ComponentType: 'deduction', CalculationType: 'fixed_amount', Active: 'YES', DisplayOrder: 30 }
  ],
  reliefs: [{ RuleId: 'PENSION', TaxProfileId: 'NGA-V1', Code: 'PENSION', Name: 'Pension', RuleType: 'COMPONENT_TOTAL', SourceComponentCodes: ['PENSION'], Active: 'YES' }]
};
const employee = { EmployeeId: 'E1', DisplayName: 'Ada', TaxStatus: 'TAXABLE', TaxJurisdiction: 'FCT', PensionParticipating: 'YES', PensionRate: 8, NhfParticipating: 'NO', ComponentAssignments: [{ ComponentId: 'BASIC', Amount: 100000 }, { ComponentId: 'HOUSE' }, { ComponentId: 'LOAN', Amount: 5000 }] };
const calculate = (overrides = {}) => calculateConfigurablePayroll({ employee: { ...employee, ...(overrides.employee || {}) }, configuration: overrides.configuration || configuration, payrollDate: '2026-07-28', approvedOverride: overrides.approvedOverride });

test('legacy payroll results remain compatible with the previous formula', () => {
  const result = calculateLegacyPayroll({ BasicSalary: 100000, Allowances: [{ Name: 'Housing', Amount: 20000 }], Deductions: [{ Name: 'Loan', Amount: 5000 }], PensionRate: 8, TaxRate: 5 });
  assert.deepEqual({ gross: result.GrossPay, pension: result.PensionAmount, tax: result.TaxAmount, deductions: result.TotalDeductions, net: result.NetPay }, { gross: 120000, pension: 9600, tax: 6000, deductions: 20600, net: 99400 });
});

test('configurable components calculate earnings, deductions, relief and PAYE', () => {
  const result = calculate();
  assert.equal(result.GrossPay, 120000); assert.equal(result.TaxableEarnings, 120000); assert.equal(result.PensionAmount, 9600);
  assert.equal(result.QualifyingReliefs[0].AnnualAmount, 115200); assert.equal(result.CalculatedPaye, 7460); assert.equal(result.TotalDeductions, 22060); assert.equal(result.NetPay, 97940);
});

test('NHF participation calculates from flagged earnings and becomes a configured relief source', () => {
  const config = structuredClone(configuration); config.reliefs.push({ RuleId: 'NHF', TaxProfileId: 'NGA-V1', Code: 'NHF', Name: 'NHF', RuleType: 'COMPONENT_TOTAL', SourceComponentCodes: ['NHF'], Active: 'YES' });
  const result = calculate({ configuration: config, employee: { NhfParticipating: 'YES', NhfRate: 2.5 } });
  assert.equal(result.NhfAmount, 2500); assert.equal(result.QualifyingReliefs.find((row) => row.Code === 'NHF').AnnualAmount, 30000);
});

test('tax-exempt employee produces zero PAYE without a tax profile', () => {
  const config = { ...configuration, profiles: [], bands: [], reliefs: [] }; const result = calculate({ configuration: config, employee: { TaxStatus: 'EXEMPT' } });
  assert.equal(result.FinalPaye, 0); assert.equal(result.TaxProfileId, ''); assert.equal(result.CalculationTrace.TaxExempt, true);
});

test('missing component assignments stop calculation safely', () => {
  assert.throws(() => calculate({ employee: { ComponentAssignments: [] } }), (error) => error.code === 'MISSING_COMPONENT_ASSIGNMENTS');
});

test('missing effective tax profile stops a taxable employee safely', () => {
  assert.throws(() => calculate({ configuration: { ...configuration, profiles: [] } }), (error) => error.code === 'MISSING_TAX_PROFILE');
});

test('approved manual PAYE override changes final PAYE and remains traceable', () => {
  const result = calculate({ approvedOverride: { OverrideId: 'OVR-1', Status: 'Approved', OverridePaye: 5000 } });
  assert.equal(result.CalculatedPaye, 7460); assert.equal(result.FinalPaye, 5000); assert.equal(result.TaxOverrideId, 'OVR-1'); assert.equal(result.NetPay, 100400);
});

test('pending override is not applied', () => {
  const result = calculate({ approvedOverride: { OverrideId: 'OVR-1', Status: 'Pending', OverridePaye: 1 } }); assert.equal(result.FinalPaye, result.CalculatedPaye);
});

test('calculation stores the exact tax and component configuration snapshot', () => {
  const result = calculate(); assert.equal(result.ConfigurationSnapshot.TaxProfile.ProfileId, 'NGA-V1'); assert.equal(result.ConfigurationSnapshot.TaxBands.length, 6); assert.equal(result.ConfigurationSnapshot.SalaryComponents.length, 3);
  configuration.profiles[0].Name = 'Changed after calculation'; assert.equal(result.ConfigurationSnapshot.TaxProfile.Name, 'Nigeria'); configuration.profiles[0].Name = 'Nigeria';
});

test('employee-specific approved annual relief reduces PAYE', () => {
  const normal = calculate(); const relieved = calculate({ employee: { AdditionalReliefs: [{ Code: 'LIFE', AnnualAmount: 120000 }] } });
  assert.equal(relieved.QualifyingReliefs.find((row) => row.Code === 'LIFE').AnnualAmount, 120000); assert.ok(relieved.FinalPaye < normal.FinalPaye);
});

test('configured deductions above gross stop payroll instead of creating an unbalanced journal', () => {
  assert.throws(() => calculate({ employee: { ComponentAssignments: [{ ComponentId: 'BASIC', Amount: 1000 }, { ComponentId: 'LOAN', Amount: 5000 }], PensionParticipating: 'NO', TaxStatus: 'EXEMPT' } }), (error) => error.code === 'DEDUCTIONS_EXCEED_GROSS');
});
