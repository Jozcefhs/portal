import { evaluatePayrollFormula } from './formula-engine.js';
import { calculateMonthlyPaye, selectEffectiveTaxProfile } from './paye-engine.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const number = (value) => { const result = Number(String(value ?? '0').replace(/,/g, '')); return Number.isFinite(result) ? result : 0; };
const yes = (value) => ['yes', 'true', '1', 'active', 'taxable'].includes(lower(value));
const money = (value) => Math.round((Math.max(0, number(value)) + Number.EPSILON) * 100) / 100;
const codeVariable = (value) => clean(value).replace(/[^A-Za-z0-9_]/g, '_');
const dateOnly = (value) => clean(value).slice(0, 10);
const effective = (row, date) => (!dateOnly(row.EffectiveFrom) || dateOnly(row.EffectiveFrom) <= dateOnly(date)) && (!dateOnly(row.EffectiveTo) || dateOnly(row.EffectiveTo) >= dateOnly(date));

function payrollError(message, code = 'PAYROLL_CALCULATION_ERROR') {
  const error = new Error(message); error.status = 400; error.code = code; return error;
}

function rows(value) { return Array.isArray(value) ? value : []; }
function normalizeLegacyRows(value) {
  return rows(value).map((row) => ({ Name: clean(row.Name || row.name), Amount: money(row.Amount ?? row.amount) })).filter((row) => row.Name && row.Amount > 0);
}

export function calculateLegacyPayroll(profile) {
  const basic = money(profile.BasicSalary); const allowances = normalizeLegacyRows(profile.Allowances); const other = normalizeLegacyRows(profile.Deductions);
  const allowanceTotal = money(allowances.reduce((sum, row) => sum + row.Amount, 0)); const gross = money(basic + allowanceTotal);
  const pension = money(gross * Math.max(0, number(profile.PensionRate)) / 100); const tax = money(gross * Math.max(0, number(profile.TaxRate)) / 100);
  const otherTotal = money(other.reduce((sum, row) => sum + row.Amount, 0)); const requestedDeductions = money(pension + tax + otherTotal);
  const totalDeductions = money(Math.min(gross, requestedDeductions)); const net = money(Math.max(0, gross - totalDeductions));
  return {
    CalculationVersion: 'LEGACY_FLAT_RATE', CalculationMode: 'LEGACY_FLAT_RATE', CalculationStatus: 'VALID',
    BasicSalary: basic, Allowances: allowances, AllowanceTotal: allowanceTotal, GrossPay: gross,
    PensionRate: number(profile.PensionRate), PensionAmount: pension, TaxRate: number(profile.TaxRate), TaxAmount: tax,
    CalculatedPaye: tax, FinalPaye: tax, OtherDeductions: other, OtherDeductionTotal: otherTotal,
    TotalDeductions: totalDeductions, NetPay: net, CalculationWarnings: requestedDeductions > gross ? ['Deductions were capped at gross pay.'] : []
  };
}

function componentValue(definition, assignment, context) {
  const type = lower(assignment.CalculationType || definition.CalculationType || 'fixed_amount');
  if (type === 'fixed_amount' || type === 'manual_input') return money(assignment.Amount ?? assignment.Value ?? definition.FixedAmount);
  if (type === 'percentage') {
    const rate = Math.max(0, number(assignment.PercentageRate ?? definition.PercentageRate));
    const baseName = clean(assignment.PercentageBase || definition.PercentageBase || 'Basic');
    return money(number(context[baseName] ?? context[codeVariable(baseName)]) * rate / 100);
  }
  if (type === 'formula') return money(evaluatePayrollFormula(clean(assignment.Formula || definition.Formula), context));
  throw payrollError(`Unsupported calculation type ${type}.`, 'INVALID_COMPONENT_CALCULATION');
}

function snapshotRow(row) {
  const result = { ...row }; delete result.__id; delete result.__name; delete result.UsageCount; return result;
}

export function calculateConfigurablePayroll({ employee, configuration, payrollDate, approvedOverride = null }) {
  const status = clean(employee.TaxStatus || 'TAXABLE').toUpperCase(); const taxExempt = ['EXEMPT', 'TAX_EXEMPT', 'NO'].includes(status);
  const definitions = rows(configuration.components).filter((row) => clean(row.Active ?? 'YES').toUpperCase() !== 'NO' && effective(row, payrollDate));
  const byId = new Map(); const byCode = new Map();
  definitions.forEach((row) => { byId.set(clean(row.ComponentId || row.__id), row); byCode.set(lower(row.Code), row); });
  const assignments = rows(employee.ComponentAssignments);
  if (!assignments.length) throw payrollError(`Employee ${clean(employee.DisplayName || employee.EmployeeId)} has no configurable salary-component assignments.`, 'MISSING_COMPONENT_ASSIGNMENTS');
  const ordered = assignments.map((assignment) => {
    const definition = byId.get(clean(assignment.ComponentId)) || byCode.get(lower(assignment.Code));
    if (!definition) throw payrollError(`Salary component ${clean(assignment.Code || assignment.ComponentId)} is not configured or active.`, 'MISSING_SALARY_COMPONENT');
    return { assignment, definition };
  }).sort((a, b) => number(a.definition.DisplayOrder) - number(b.definition.DisplayOrder));
  const context = { PensionRate: number(employee.PensionRateOverride ?? employee.PensionRate), NHFRate: number(employee.NhfRate), Basic: 0, Gross: 0, TaxableEarnings: 0, PensionableEarnings: 0 };
  const componentLines = [];
  ordered.forEach(({ assignment, definition }) => {
    const value = componentValue(definition, assignment, context); const code = clean(definition.Code); const type = lower(definition.ComponentType);
    const line = { ComponentId: clean(definition.ComponentId || definition.__id), Code: code, Name: clean(definition.Name), ComponentType: type, Amount: value,
      IsTaxable: clean(definition.IsTaxable || 'NO').toUpperCase(), IsPensionable: clean(definition.IsPensionable || 'NO').toUpperCase(),
      IsNhfApplicable: clean(definition.IsNhfApplicable || 'NO').toUpperCase(), ReducesTaxableIncome: clean(definition.ReducesTaxableIncome || 'NO').toUpperCase() };
    componentLines.push(line); context[code] = value; context[codeVariable(code)] = value;
    if (lower(code) === 'basic') context.Basic = value;
    if (type === 'earning') {
      context.Gross += value; if (yes(definition.IsTaxable)) context.TaxableEarnings += value; if (yes(definition.IsPensionable)) context.PensionableEarnings += value;
    }
  });
  context.AnnualGross = context.Gross * 12; context.AnnualTaxableIncome = context.TaxableEarnings * 12;
  const pensionRate = Math.max(0, number(employee.PensionRateOverride ?? employee.PensionRate));
  const pension = yes(employee.PensionParticipating) ? money(context.PensionableEarnings * pensionRate / 100) : 0;
  const nhfRate = Math.max(0, number(employee.NhfRate)); const nhfBase = componentLines.filter((row) => row.ComponentType === 'earning' && row.IsNhfApplicable === 'YES').reduce((sum, row) => sum + row.Amount, 0);
  const nhf = yes(employee.NhfParticipating) ? money(nhfBase * nhfRate / 100) : 0;
  context.PENSION = pension; context.NHF = nhf;
  const configuredDeductions = componentLines.filter((row) => row.ComponentType === 'deduction').reduce((sum, row) => sum + row.Amount, 0);
  const selectedProfile = taxExempt ? null : selectEffectiveTaxProfile(configuration.profiles, payrollDate, { profileId: employee.TaxProfileId, jurisdiction: employee.TaxJurisdiction || 'FCT' });
  const reliefRules = rows(configuration.reliefs).filter((row) => clean(row.Active ?? 'YES').toUpperCase() !== 'NO' && effective(row, payrollDate))
    .filter((row) => !selectedProfile || clean(row.TaxProfileId) === clean(selectedProfile.ProfileId || selectedProfile.__id));
  const amountsByCode = new Map(componentLines.map((row) => [lower(row.Code), row.Amount])); amountsByCode.set('pension', pension); amountsByCode.set('nhf', nhf);
  const configuredReliefs = reliefRules.map((rule) => {
    const ruleType = clean(rule.RuleType || 'COMPONENT_TOTAL').toUpperCase(); let monthlyAmount = 0;
    if (ruleType === 'COMPONENT_TOTAL') monthlyAmount = rows(rule.SourceComponentCodes).reduce((sum, code) => sum + number(amountsByCode.get(lower(code))), 0);
    else if (ruleType === 'FIXED') monthlyAmount = number(rule.FixedAmount);
    else if (ruleType === 'PERCENTAGE') monthlyAmount = number(context[clean(rule.PercentageBase)] ?? context[codeVariable(rule.PercentageBase)]) * number(rule.PercentageRate) / 100;
    else if (ruleType === 'FORMULA') monthlyAmount = evaluatePayrollFormula(clean(rule.Formula), context);
    return { Code: clean(rule.Code), Name: clean(rule.Name), Category: clean(rule.Category), AnnualAmount: money(monthlyAmount * 12) };
  }).filter((row) => row.AnnualAmount > 0);
  const reliefSourceCodes = new Set(reliefRules.flatMap((rule) => rows(rule.SourceComponentCodes).map((code) => lower(code))));
  const flaggedComponentReliefs = componentLines.filter((row) => row.ReducesTaxableIncome === 'YES' && !reliefSourceCodes.has(lower(row.Code))).map((row) => ({
    Code: row.Code, Name: row.Name, Category: 'Component', AnnualAmount: money(row.Amount * 12)
  })).filter((row) => row.AnnualAmount > 0);
  const employeeReliefs = rows(employee.AdditionalReliefs).filter((row) => clean(row.Active ?? 'YES').toUpperCase() !== 'NO').map((row) => ({
    Code: clean(row.Code || row.Name || 'EMPLOYEE_RELIEF'), Name: clean(row.Name || row.Code || 'Approved employee relief'), Category: clean(row.Category || 'Other'),
    AnnualAmount: money(row.AnnualAmount ?? (number(row.MonthlyAmount ?? row.Amount) * 12))
  })).filter((row) => row.AnnualAmount > 0);
  const qualifyingReliefs = [...configuredReliefs, ...flaggedComponentReliefs, ...employeeReliefs];
  let taxResult = null;
  if (!taxExempt) {
    const applicableBands = rows(configuration.bands).filter((row) => clean(row.TaxProfileId) === clean(selectedProfile.ProfileId || selectedProfile.__id));
    taxResult = calculateMonthlyPaye({ profile: selectedProfile, bands: applicableBands, monthlyTaxableIncome: context.TaxableEarnings, monthlyGrossIncome: context.Gross, qualifyingReliefs, payrollDate });
  }
  const calculatedPaye = money(taxResult?.PeriodPaye || 0); const hasOverride = approvedOverride && lower(approvedOverride.Status) === 'approved';
  const finalPaye = hasOverride ? money(approvedOverride.OverridePaye) : calculatedPaye;
  const totalDeductionsRequested = money(configuredDeductions + pension + nhf + finalPaye);
  if (totalDeductionsRequested > money(context.Gross)) throw payrollError('Configured deductions exceed gross pay. Correct the component values or approved override before generating payroll.', 'DEDUCTIONS_EXCEED_GROSS');
  const totalDeductions = totalDeductionsRequested;
  const earnings = componentLines.filter((row) => row.ComponentType === 'earning'); const deductions = componentLines.filter((row) => row.ComponentType === 'deduction');
  const profileSnapshot = selectedProfile ? snapshotRow(selectedProfile) : null;
  const bandSnapshot = selectedProfile ? rows(configuration.bands).filter((row) => clean(row.TaxProfileId) === clean(selectedProfile.ProfileId || selectedProfile.__id)).map(snapshotRow) : [];
  return {
    CalculationVersion: 'CONFIGURABLE_PAYE_V1', CalculationMode: 'CONFIGURABLE_PAYE', CalculationStatus: 'VALID', TaxStatus: status,
    BasicSalary: money(context.Basic), Allowances: earnings.filter((row) => lower(row.Code) !== 'basic').map((row) => ({ Name: row.Name, Amount: row.Amount, Code: row.Code })),
    AllowanceTotal: money(earnings.filter((row) => lower(row.Code) !== 'basic').reduce((sum, row) => sum + row.Amount, 0)), GrossPay: money(context.Gross),
    TaxableEarnings: money(context.TaxableEarnings), PensionableEarnings: money(context.PensionableEarnings), PensionRate: pensionRate, PensionAmount: pension,
    NhfRate: nhfRate, NhfAmount: nhf, TaxRate: 0, TaxAmount: finalPaye, CalculatedPaye: calculatedPaye, FinalPaye: finalPaye,
    TaxOverrideId: hasOverride ? clean(approvedOverride.OverrideId || approvedOverride.__id) : '', OtherDeductions: deductions.map((row) => ({ Name: row.Name, Amount: row.Amount, Code: row.Code })),
    OtherDeductionTotal: money(configuredDeductions), TotalDeductions: totalDeductions, NetPay: money(Math.max(0, context.Gross - totalDeductions)),
    TaxProfileId: clean(selectedProfile?.ProfileId || selectedProfile?.__id), TaxProfileVersion: number(selectedProfile?.Version), CraAmount: money(taxResult?.CRA),
    ChargeableIncome: money(taxResult?.ChargeableIncome), QualifyingReliefs: taxResult?.QualifyingReliefs || qualifyingReliefs, PayeBandBreakdown: taxResult?.BandBreakdown || [],
    ComponentBreakdown: componentLines, CalculationTrace: taxResult || { TaxExempt: true, Reason: 'Employee tax status is exempt.' },
    ConfigurationSnapshot: { TaxProfile: profileSnapshot, TaxBands: bandSnapshot, ReliefRules: reliefRules.filter((row) => !selectedProfile || clean(row.TaxProfileId) === clean(selectedProfile.ProfileId || selectedProfile.__id)).map(snapshotRow), SalaryComponents: ordered.map(({ definition }) => snapshotRow(definition)) },
    CalculationWarnings: []
  };
}
