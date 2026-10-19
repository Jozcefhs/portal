import { evaluatePayrollFormula, validatePayrollFormula } from './formula-engine.js';

const number = (value) => { const result = Number(String(value ?? '0').replace(/,/g, '')); return Number.isFinite(result) ? result : 0; };
const clean = (value) => String(value ?? '').trim();
const yes = (value) => ['yes', 'true', '1', 'active'].includes(clean(value).toLowerCase());
const dateOnly = (value) => clean(value).slice(0, 10);

function taxError(message, code = 'INVALID_TAX_CONFIGURATION') {
  const error = new Error(message); error.status = 400; error.code = code; return error;
}

function effective(row, payrollDate) {
  const date = dateOnly(payrollDate); const from = dateOnly(row.EffectiveFrom); const to = dateOnly(row.EffectiveTo);
  return (!from || from <= date) && (!to || to >= date) && clean(row.Active ?? 'YES').toUpperCase() !== 'NO';
}

export function selectEffectiveTaxProfile(profiles, payrollDate, options = {}) {
  const date = dateOnly(payrollDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw taxError('A valid payroll period date is required.', 'MISSING_PAYROLL_DATE');
  const jurisdiction = clean(options.jurisdiction).toLowerCase(); const assignedId = clean(options.profileId);
  const candidates = (profiles || []).filter((row) => effective(row, date))
    .filter((row) => !assignedId || clean(row.ProfileId || row.__id) === assignedId)
    .filter((row) => !jurisdiction || clean(row.Jurisdiction).toLowerCase() === jurisdiction)
    .sort((a, b) => {
      if (!assignedId && yes(a.IsDefault) !== yes(b.IsDefault)) return yes(a.IsDefault) ? -1 : 1;
      return number(b.Version) - number(a.Version) || dateOnly(b.EffectiveFrom).localeCompare(dateOnly(a.EffectiveFrom));
    });
  const selected = candidates[0];
  if (!selected) throw taxError('No applicable active tax profile was found for this employee and payroll date.', 'MISSING_TAX_PROFILE');
  return selected;
}

export function validateTaxBands(bands, options = {}) {
  const active = (bands || []).filter((row) => clean(row.Active ?? 'YES').toUpperCase() !== 'NO')
    .sort((a, b) => number(a.Sequence) - number(b.Sequence));
  if (!active.length) throw taxError('At least one active tax band is required.');
  let expectedLower = 0; let openEnded = 0;
  active.forEach((band, index) => {
    const lower = number(band.LowerLimit); const upper = number(band.UpperLimit); const rate = number(band.Rate);
    const open = yes(band.IsOpenEnded);
    if (number(band.Sequence) !== index + 1) throw taxError('Tax-band sequence must begin at 1 and contain no duplicates or gaps.');
    if (lower < 0 || rate < 0 || rate > 100) throw taxError('Tax-band limits and rates must be valid non-negative values.');
    if (Math.abs(lower - expectedLower) > 0.005) throw taxError(`Tax bands contain a gap or overlap at ${expectedLower}.`);
    if (open) { openEnded += 1; if (index !== active.length - 1) throw taxError('Only the final tax band may be open-ended.'); }
    else { if (upper <= lower) throw taxError('Every fixed tax band requires an upper limit greater than its lower limit.'); expectedLower = upper; }
  });
  if (openEnded !== 1 && options.requireOpenEnded !== false) throw taxError('Exactly one open-ended final tax band is required.');
  return active;
}

function rounded(value, method, precision) {
  const digits = Math.max(0, Math.min(6, Math.trunc(number(precision)))); const factor = 10 ** digits;
  const normalized = clean(method || 'NEAREST').toUpperCase();
  if (normalized === 'UP') return Math.ceil((value - Number.EPSILON) * factor) / factor;
  if (normalized === 'DOWN') return Math.floor((value + Number.EPSILON) * factor) / factor;
  if (normalized === 'NONE') return value;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function calculateMonthlyPaye(input) {
  const profile = input.profile || {}; const monthlyTaxable = Math.max(0, number(input.monthlyTaxableIncome));
  const monthlyGross = Math.max(0, number(input.monthlyGrossIncome ?? monthlyTaxable));
  const annualization = clean(profile.AnnualizationMethod || 'MONTHLY_X_12').toUpperCase();
  if (annualization !== 'MONTHLY_X_12') throw taxError(`Unsupported annualization method: ${annualization}.`);
  const annualTaxable = monthlyTaxable * 12; const annualGross = monthlyGross * 12;
  const craEnabled = profile.CraEnabled === undefined ? true : yes(profile.CraEnabled);
  const fixedRelief = Math.max(0, number(profile.CraFixedRelief));
  const comparisonRate = Math.max(0, number(profile.CraGrossComparisonRate));
  const additionalRate = Math.max(0, number(profile.CraAdditionalReliefRate));
  const cra = craEnabled ? Math.max(fixedRelief, annualGross * comparisonRate / 100) + annualGross * additionalRate / 100 : 0;
  const qualifyingReliefs = (input.qualifyingReliefs || []).map((row) => ({
    Code: clean(row.Code || row.Name || 'RELIEF'), Name: clean(row.Name || row.Code || 'Relief'),
    Amount: Math.max(0, number(row.AnnualAmount ?? row.Amount)), AnnualAmount: Math.max(0, number(row.AnnualAmount ?? row.Amount)), Category: clean(row.Category || 'Other')
  })).filter((row) => row.Amount > 0);
  const reliefTotal = qualifyingReliefs.reduce((sum, row) => sum + row.Amount, 0);
  const chargeableIncome = Math.max(0, annualTaxable - cra - reliefTotal);
  const bands = validateTaxBands((input.bands || []).filter((row) => !row.EffectiveFrom || effective(row, input.payrollDate || profile.EffectiveFrom || '9999-12-31')));
  let annualPayeBeforeMinimum = 0;
  const bandBreakdown = bands.map((band) => {
    const lower = number(band.LowerLimit); const upper = yes(band.IsOpenEnded) ? chargeableIncome : number(band.UpperLimit);
    const taxedAmount = Math.max(0, Math.min(chargeableIncome, upper) - lower); const rate = number(band.Rate);
    const tax = taxedAmount * rate / 100; annualPayeBeforeMinimum += tax;
    return { BandId: clean(band.BandId || band.__id), Sequence: number(band.Sequence), LowerLimit: lower, UpperLimit: yes(band.IsOpenEnded) ? null : number(band.UpperLimit), IsOpenEnded: yes(band.IsOpenEnded), TaxedAmount: taxedAmount, Rate: rate, Tax: tax };
  });
  let minimumTax = 0;
  if (yes(profile.MinimumTaxEnabled)) {
    const formula = clean(profile.MinimumTaxFormula);
    if (!formula) throw taxError('Minimum tax is enabled but no formula is configured.');
    const allowed = ['AnnualGross', 'AnnualTaxableIncome', 'ChargeableIncome', 'CRA', 'QualifyingReliefs', 'CalculatedAnnualPaye'];
    validatePayrollFormula(formula, allowed);
    minimumTax = Math.max(0, evaluatePayrollFormula(formula, { AnnualGross: annualGross, AnnualTaxableIncome: annualTaxable, ChargeableIncome: chargeableIncome, CRA: cra, QualifyingReliefs: reliefTotal, CalculatedAnnualPaye: annualPayeBeforeMinimum }));
  }
  const annualPaye = Math.max(annualPayeBeforeMinimum, minimumTax); const unroundedPeriodPaye = annualPaye / 12;
  const periodPaye = rounded(unroundedPeriodPaye, profile.RoundingMethod, profile.RoundingPrecision ?? 2);
  return {
    ProfileId: clean(profile.ProfileId || profile.__id), ProfileVersion: number(profile.Version), PayrollDate: dateOnly(input.payrollDate),
    MonthlyGrossIncome: monthlyGross, MonthlyTaxableIncome: monthlyTaxable, AnnualGrossIncome: annualGross,
    AnnualTaxableIncome: annualTaxable, CRA: cra, QualifyingReliefs: qualifyingReliefs, QualifyingReliefTotal: reliefTotal,
    ChargeableIncome: chargeableIncome, BandBreakdown: bandBreakdown, AnnualPayeBeforeMinimum: annualPayeBeforeMinimum,
    MinimumTax: minimumTax, AnnualPaye: annualPaye, UnroundedPeriodPaye: unroundedPeriodPaye,
    RoundingAdjustment: periodPaye - unroundedPeriodPaye, PeriodPaye: periodPaye, FinalPaye: periodPaye,
    AnnualizationMethod: annualization, RoundingMethod: clean(profile.RoundingMethod || 'NEAREST').toUpperCase(), RoundingPrecision: number(profile.RoundingPrecision ?? 2)
  };
}
