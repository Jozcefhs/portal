import { effectiveInvoiceAfterReversal } from './invoice-charge-reversal.js';

const clean = value => String(value ?? '').trim();

export function financeInvoiceAsOf(row, asOf) {
  if (row.FeeChargeReversed !== 'YES' || !asOf) return row;
  const reversed = effectiveInvoiceAfterReversal(row); // Validate retained history before using it.
  const date = clean(row.FeeChargeReversedAt).slice(0, 10);
  if (!date || date <= clean(asOf).slice(0, 10)) return row;
  return { ...row, FeeChargeReversed: 'NO',
    Amount: reversed.GrossInvoiceAmount, amount: reversed.GrossInvoiceAmount, Debit: reversed.GrossInvoiceAmount,
    Credit: reversed.GrossInvoiceCredit, PaidAmount: reversed.GrossInvoiceCredit, paidAmount: reversed.GrossInvoiceCredit,
    Balance: reversed.GrossInvoiceAmount - reversed.GrossInvoiceCredit,
    Status: reversed.GrossInvoiceStatus, status: reversed.GrossInvoiceStatus };
}

export function financeReportDate(row = {}, payment = false) {
  return clean(payment ? (row.PaidAt || row.paidAt || row.PaymentDate || row.paymentDate || row.Date || row.date || row.CreatedAt || row.createdAt)
    : (row.Date || row.date || row.CreatedAt || row.createdAt)).slice(0, 10);
}

export function financeReportWithinCutoff(row, asOf, payment = false) {
  const date = financeReportDate(row, payment);
  if (!date && payment && asOf && clean(asOf).slice(0, 10) < new Date().toISOString().slice(0, 10)) return false;
  return !date || !asOf || date <= clean(asOf).slice(0, 10);
}

// A current invoice balance is not evidence of what had been paid at an earlier
// cutoff. Dated receipts reconstruct that position; only an older, dated record
// snapshot can supply a historical stored credit not represented by receipts.
export function financeStoredCreditAsOf(row, asOf, amount, today = new Date().toISOString().slice(0, 10)) {
  if (!asOf || clean(asOf).slice(0, 10) >= today) return amount;
  const creditDate = clean(row.CreditUpdatedAt || row.creditUpdatedAt || row.LastPaymentDate || row.lastPaymentDate || row.UpdatedAt || row.updatedAt).slice(0, 10);
  return creditDate && creditDate <= clean(asOf).slice(0, 10) ? amount : 0;
}

export function financeDepartmentJournals(journals, department) {
  if (!clean(department)) return journals;
  const wanted = clean(department).toLowerCase();
  return journals.map(journal => {
    let lines = journal.Lines || journal.lines || [];
    if (typeof lines === 'string') {
      try { lines = JSON.parse(lines); } catch { lines = []; }
    }
    return { ...journal, Lines: (Array.isArray(lines) ? lines : []).filter(line =>
      clean(line.Department || journal.Department).toLowerCase() === wanted) };
  }).filter(journal => journal.Lines.length);
}
