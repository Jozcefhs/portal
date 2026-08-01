const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const number = (value) => { const result = Number(value); return Number.isFinite(result) ? result : 0; };
const yes = (value) => ['yes', 'true', '1'].includes(lower(value));

function guardError(message, code) { const error = new Error(message); error.status = 409; error.code = code; return error; }

export function assertPayrollCanRegenerate(run) {
  if (!run || !clean(run.RunId)) return true;
  if (!['draft', 'rejected'].includes(lower(run.Status))) throw guardError('Only Draft or Rejected payroll can be recalculated. Submitted, approved, or posted payroll is locked.', 'PAYROLL_RUN_LOCKED');
  return true;
}

export function validatePayrollForSubmission(run, items) {
  if (yes(run?.RequiresRecalculation)) throw guardError('This payroll has an approved tax change and must be recalculated before submission.', 'PAYROLL_RECALCULATION_REQUIRED');
  if (!items?.length || items.length !== Math.trunc(number(run?.EmployeeCount))) throw guardError('Payroll register is incomplete and cannot be submitted. Recalculate the draft.', 'INCOMPLETE_PAYROLL_REGISTER');
  const invalid = items.filter((item) => clean(item.CalculationMode).toUpperCase() === 'CONFIGURABLE_PAYE' && clean(item.CalculationStatus).toUpperCase() !== 'VALID');
  if (invalid.length) throw guardError(`${invalid.length} configurable payroll item(s) have invalid tax calculations.`, 'INVALID_PAYROLL_CALCULATION');
  return true;
}

export function buildFinalizedRunSnapshot(run, items, actor, timestamp) {
  return {
    CalculationVersion: clean(run?.CalculationVersion), TaxProfileIds: run?.TaxProfileIds || [], FinalizedAt: clean(timestamp), FinalizedBy: clean(actor),
    ItemSnapshots: (items || []).map((item) => ({ ItemId: clean(item.ItemId), EmployeeId: clean(item.EmployeeId), TaxProfileId: clean(item.TaxProfileId),
      TaxProfileVersion: number(item.TaxProfileVersion), CalculatedPaye: number(item.CalculatedPaye), FinalPaye: number(item.FinalPaye ?? item.TaxAmount) }))
  };
}
