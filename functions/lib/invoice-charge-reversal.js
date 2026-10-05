// Gross invoice/receipt fields remain on the source document. An approved,
// full charge reversal changes the effective subledger view, not that history.
export function effectiveInvoiceAfterReversal(row = {}) {
  if (row.FeeChargeReversed !== 'YES') return row;
  const amount = Number(row.GrossInvoiceAmount ?? row.amount ?? row.Amount ?? row.Debit ?? 0);
  const credit = Number(row.GrossInvoiceCredit ?? row.paidAmount ?? row.PaidAmount ?? row.Credit ?? 0);
  if (!row.FeeChargeReversalId || amount <= 0 || Number(row.FeeChargeReversalAmount) !== amount ||
      Number(row.FeeChargeReleasedCredit) !== credit || credit < 0 || credit > amount) {
    throw new Error('Invalid invoice reversal metadata; finance review is required.');
  }
  return { ...row, GrossInvoiceAmount: amount, GrossInvoiceCredit: credit,
    GrossInvoiceStatus: row.GrossInvoiceStatus ?? row.status ?? row.Status,
    Amount: 0, amount: 0, Debit: 0, debit: 0, Credit: 0, credit: 0,
    PaidAmount: 0, paidAmount: 0, Balance: 0, balance: 0, BalanceAmount: 0, balanceAmount: 0,
    Status: 'Reversed', status: 'Reversed' };
}
