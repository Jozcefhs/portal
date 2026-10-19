import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateMonthlyPaye, selectEffectiveTaxProfile, validateTaxBands } from '../../functions/lib/payroll/paye-engine.js';

const bands = [
  [1, 0, 300000, 7, false], [2, 300000, 600000, 11, false], [3, 600000, 1100000, 15, false],
  [4, 1100000, 1600000, 19, false], [5, 1600000, 3200000, 21, false], [6, 3200000, 0, 24, true]
].map(([Sequence, LowerLimit, UpperLimit, Rate, open]) => ({ BandId: `B${Sequence}`, Sequence, LowerLimit, UpperLimit, Rate, IsOpenEnded: open ? 'YES' : 'NO', Active: 'YES' }));

const profile = {
  ProfileId: 'NGA-V1', Version: 1, AnnualizationMethod: 'MONTHLY_X_12', Active: 'YES', IsDefault: 'YES',
  CraEnabled: 'YES', CraFixedRelief: 200000, CraGrossComparisonRate: 1, CraAdditionalReliefRate: 20,
  MinimumTaxEnabled: 'NO', RoundingMethod: 'NEAREST', RoundingPrecision: 2
};

const calculate = (monthly, extra = {}) => calculateMonthlyPaye({ profile: { ...profile, ...(extra.profile || {}) }, bands: extra.bands || bands, monthlyTaxableIncome: monthly, monthlyGrossIncome: extra.monthlyGrossIncome ?? monthly, qualifyingReliefs: extra.qualifyingReliefs || [], payrollDate: '2026-07-31' });

test('1. no taxable income produces zero PAYE', () => {
  const result = calculate(0); assert.equal(result.ChargeableIncome, 0); assert.equal(result.FinalPaye, 0);
});

test('2. chargeable income in the first band is taxed at 7 percent', () => {
  const result = calculate(50000); assert.equal(result.CRA, 320000); assert.equal(result.ChargeableIncome, 280000); assert.equal(result.AnnualPaye, 19600); assert.equal(result.FinalPaye, 1633.33);
});

test('3. income crossing multiple bands is calculated progressively', () => {
  const result = calculate(200000); assert.equal(result.ChargeableIncome, 1720000); assert.equal(result.AnnualPaye, 249200); assert.equal(result.FinalPaye, 20766.67);
});

test('4. income above all fixed bands uses the open-ended band', () => {
  const result = calculate(500000); assert.equal(result.AnnualPaye, 896000); assert.equal(result.FinalPaye, 74666.67); assert.equal(result.BandBreakdown.at(-1).TaxedAmount, 1400000);
});

test('5. enabled pension relief reduces chargeable income and PAYE', () => {
  const result = calculate(200000, { qualifyingReliefs: [{ Code: 'PENSION', AnnualAmount: 192000 }] });
  assert.equal(result.QualifyingReliefTotal, 192000); assert.equal(result.ChargeableIncome, 1528000); assert.equal(result.AnnualPaye, 210320); assert.equal(result.FinalPaye, 17526.67);
});

test('6. disabled pension relief contributes no relief amount', () => {
  const result = calculate(200000, { qualifyingReliefs: [] }); assert.equal(result.QualifyingReliefTotal, 0); assert.equal(result.FinalPaye, 20766.67);
});

test('7. NHF relief is included as a qualifying annual deduction', () => {
  const result = calculate(200000, { qualifyingReliefs: [{ Code: 'NHF', AnnualAmount: 30000 }] });
  assert.equal(result.ChargeableIncome, 1690000); assert.equal(result.AnnualPaye, 242900); assert.equal(result.FinalPaye, 20241.67);
});

test('8. CRA follows the configured fixed/comparison plus additional formula', () => {
  assert.equal(calculate(200000).CRA, 680000);
});

test('9. tax band validator requires one open-ended final band', () => {
  assert.equal(validateTaxBands(bands).length, 6); assert.throws(() => validateTaxBands(bands.slice(0, 5)), /open-ended/);
});

test('10. effective-date selection chooses the applicable version', () => {
  const profiles = [
    { ...profile, ProfileId: 'V1', Version: 1, EffectiveFrom: '2025-01-01', EffectiveTo: '2025-12-31' },
    { ...profile, ProfileId: 'V2', Version: 2, EffectiveFrom: '2026-01-01', EffectiveTo: '' }
  ];
  assert.equal(selectEffectiveTaxProfile(profiles, '2026-07-31').ProfileId, 'V2');
});

test('11. overlapping tax bands fail validation', () => {
  const invalid = bands.map((row) => ({ ...row })); invalid[1].LowerLimit = 250000;
  assert.throws(() => validateTaxBands(invalid), /gap or overlap/);
});

test('12. missing applicable profile fails with a clear code', () => {
  assert.throws(() => selectEffectiveTaxProfile([], '2026-07-31'), (error) => error.code === 'MISSING_TAX_PROFILE');
});

test('13. monthly income is annualized by twelve', () => {
  const result = calculate(200000); assert.equal(result.AnnualGrossIncome, 2400000); assert.equal(result.AnnualTaxableIncome, 2400000);
});

test('14. configured rounding supports nearest, up, and down', () => {
  const base = { CraEnabled: 'NO', RoundingPrecision: 2 };
  assert.equal(calculate(100.05, { profile: { ...base, RoundingMethod: 'NEAREST' } }).FinalPaye, 7);
  assert.equal(calculate(100.05, { profile: { ...base, RoundingMethod: 'UP' } }).FinalPaye, 7.01);
  assert.equal(calculate(100.05, { profile: { ...base, RoundingMethod: 'DOWN' } }).FinalPaye, 7);
});

test('15. minimum tax formula applies only when it exceeds progressive tax', () => {
  const result = calculate(20000, { profile: { MinimumTaxEnabled: 'YES', MinimumTaxFormula: 'AnnualGross * 0.01' } });
  assert.equal(result.AnnualPayeBeforeMinimum, 0); assert.equal(result.MinimumTax, 2400); assert.equal(result.FinalPaye, 200);
});

test('16. default profile wins over a newer non-default profile', () => {
  const profiles = [
    { ...profile, ProfileId: 'DEFAULT', Version: 1, Jurisdiction: 'FCT', EffectiveFrom: '2026-01-01' },
    { ...profile, ProfileId: 'OPTIONAL', Version: 9, IsDefault: 'NO', Jurisdiction: 'FCT', EffectiveFrom: '2026-01-01' }
  ];
  assert.equal(selectEffectiveTaxProfile(profiles, '2026-07-31', { jurisdiction: 'FCT' }).ProfileId, 'DEFAULT');
});

test('17. explicit employee profile assignment takes precedence', () => {
  const profiles = [{ ...profile, ProfileId: 'DEFAULT' }, { ...profile, ProfileId: 'ASSIGNED', IsDefault: 'NO' }];
  assert.equal(selectEffectiveTaxProfile(profiles, '2026-07-31', { profileId: 'ASSIGNED' }).ProfileId, 'ASSIGNED');
});

test('18. expired and inactive profiles are not selected', () => {
  const profiles = [{ ...profile, ProfileId: 'OLD', EffectiveTo: '2025-12-31' }, { ...profile, ProfileId: 'OFF', Active: 'NO' }];
  assert.throws(() => selectEffectiveTaxProfile(profiles, '2026-07-31'), /No applicable active tax profile/);
});

test('19. a generic custom band set works without calculator changes', () => {
  const custom = [
    { BandId: 'C1', Sequence: 1, LowerLimit: 0, UpperLimit: 1000, Rate: 10, Active: 'YES' },
    { BandId: 'C2', Sequence: 2, LowerLimit: 1000, UpperLimit: 0, Rate: 20, IsOpenEnded: 'YES', Active: 'YES' }
  ];
  const result = calculate(200, { bands: custom, profile: { CraEnabled: 'NO' } });
  assert.equal(result.AnnualPaye, 380); assert.equal(result.FinalPaye, 31.67);
});

test('20. unsupported payroll frequency is rejected in Phase 2', () => {
  assert.throws(() => calculate(100000, { profile: { AnnualizationMethod: 'WEEKLY' } }), /Unsupported annualization/);
});
