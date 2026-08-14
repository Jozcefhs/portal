const clean = (value) => String(value ?? '').trim();

const money = (value) => {
  const number = Number(String(value ?? '0').replace(/,/g, ''));
  return Number.isFinite(number)
    ? Math.round((number + Number.EPSILON) * 100) / 100
    : 0;
};

export const IMPREST_ADVANCE_ACCOUNT = '1080';
export const IMPREST_OPEN_STATUSES = Object.freeze([
  'Submitted',
  'Approved',
  'Issued',
  'Retirement Submitted'
]);

export function isOpenImprestStatus(status) {
  return IMPREST_OPEN_STATUSES.some((value) => value.toLowerCase() === clean(status).toLowerCase());
}

export function normalizeImprestRetirementLines(value) {
  let rows = value;
  if (typeof rows === 'string') {
    try {
      rows = JSON.parse(rows);
    } catch {
      rows = [];
    }
  }
  if (!Array.isArray(rows)) return [];
  return rows.map((row, index) => ({
    SNo: index + 1,
    Date: clean(row?.date ?? row?.Date),
    Description: clean(row?.description ?? row?.Description),
    ExpenseAccount: clean(row?.expenseAccount ?? row?.ExpenseAccount) || '6090',
    Amount: money(row?.amount ?? row?.Amount),
    ReceiptUrl: clean(row?.receiptUrl ?? row?.ReceiptUrl),
    ReceiptReference: clean(row?.receiptReference ?? row?.ReceiptReference)
  })).filter((row) => row.Description || row.Amount || row.ReceiptUrl || row.ReceiptReference)
    .map((row, index) => ({ ...row, SNo: index + 1 }));
}

export function validateImprestRetirement(issuedAmount, value) {
  const amountIssued = money(issuedAmount);
  const lines = normalizeImprestRetirementLines(value);
  if (amountIssued <= 0) throw new Error('The imprest has no valid issued amount.');
  if (!lines.length) throw new Error('Add at least one expense before submitting the retirement.');
  const validDate = (value) => {
    const date = clean(value);
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00.000Z`) : null;
    return Boolean(parsed && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date);
  };
  const invalidDate = lines.find((line) => !validDate(line.Date));
  if (invalidDate) {
    throw new Error(`Enter a valid date for retirement line ${invalidDate.SNo || 1}.`);
  }
  const invalid = lines.find((line) =>
    !line.Description || !line.ExpenseAccount || line.Amount <= 0 || !line.ReceiptUrl
  );
  if (invalid) {
    throw new Error(`Complete the date, description, expense account, amount and receipt URL for retirement line ${invalid?.SNo || 1}.`);
  }
  const expenseTotal = money(lines.reduce((sum, line) => sum + line.Amount, 0));
  if (expenseTotal > amountIssued) {
    throw new Error('Retired expenses cannot exceed the amount issued. Record an additional reimbursement separately.');
  }
  return {
    lines,
    expenseTotal,
    returnedAmount: money(amountIssued - expenseTotal)
  };
}

export function buildImprestIssueJournal(imprest = {}, actor = '') {
  const amountIssued = money(imprest.AmountApproved || imprest.AmountRequested || imprest.Amount);
  if (amountIssued <= 0) throw new Error('Approve an amount greater than zero before issuing the imprest.');
  const advanceAccount = clean(imprest.AdvanceAccount) || IMPREST_ADVANCE_ACCOUNT;
  const paymentAccount = clean(imprest.PaymentAccount) || '1020';
  const reference = clean(imprest.ImprestNo || imprest.__id);
  return {
    JournalNo: `SYS-IMPREST-ISSUE-${reference}`,
    Date: clean(imprest.IssueDate || imprest.Date) || new Date().toISOString().slice(0, 10),
    Status: 'Posted',
    Description: `Imprest issued to ${clean(imprest.CustodianName || imprest.RequestedBy)}`,
    Reference: reference,
    Source: 'Imprest Issue',
    SourceId: reference,
    BranchId: clean(imprest.BranchId) || 'main',
    Department: clean(imprest.Department),
    RecordedBy: clean(actor),
    Lines: [
      {
        AccountCode: advanceAccount,
        Debit: amountIssued,
        Credit: 0,
        Description: clean(imprest.Purpose) || 'Staff imprest advance',
        Department: clean(imprest.Department)
      },
      {
        AccountCode: paymentAccount,
        Debit: 0,
        Credit: amountIssued,
        Description: clean(imprest.DisbursementReference || imprest.CustodianName || 'Imprest disbursement')
      }
    ]
  };
}

export function buildImprestRetirementJournal(imprest = {}, actor = '') {
  const result = validateImprestRetirement(
    imprest.AmountIssued || imprest.AmountApproved || imprest.AmountRequested,
    imprest.RetirementLines
  );
  const reference = clean(imprest.ImprestNo || imprest.__id);
  const advanceAccount = clean(imprest.AdvanceAccount) || IMPREST_ADVANCE_ACCOUNT;
  const paymentAccount = clean(imprest.PaymentAccount) || '1020';
  const lines = result.lines.map((line) => ({
    AccountCode: line.ExpenseAccount,
    Debit: line.Amount,
    Credit: 0,
    Description: line.Description,
    Department: clean(imprest.Department)
  }));
  if (result.returnedAmount > 0) {
    lines.push({
      AccountCode: paymentAccount,
      Debit: result.returnedAmount,
      Credit: 0,
      Description: `Unused imprest returned: ${clean(imprest.ReturnReference)}`
    });
  }
  lines.push({
    AccountCode: advanceAccount,
    Debit: 0,
    Credit: money(result.expenseTotal + result.returnedAmount),
    Description: `Retire ${reference}`,
    Department: clean(imprest.Department)
  });
  return {
    JournalNo: `SYS-IMPREST-RETIRE-${reference}`,
    Date: clean(imprest.RetirementDate) || new Date().toISOString().slice(0, 10),
    Status: 'Posted',
    Description: `Imprest retirement: ${clean(imprest.Purpose || reference)}`,
    Reference: reference,
    Source: 'Imprest Retirement',
    SourceId: reference,
    BranchId: clean(imprest.BranchId) || 'main',
    Department: clean(imprest.Department),
    RecordedBy: clean(actor),
    Lines: lines,
    ExpenseTotal: result.expenseTotal,
    ReturnedAmount: result.returnedAmount
  };
}

export function imprestReportSummary(rows = [], today = new Date().toISOString().slice(0, 10)) {
  return (rows || []).reduce((summary, row) => {
    const amountIssued = money(row.AmountIssued || row.AmountApproved || row.AmountRequested);
    const expenseTotal = money(row.ExpenseTotal);
    const returnedAmount = money(row.ReturnedAmount);
    const outstanding = isOpenImprestStatus(row.Status)
      ? money(Math.max(0, amountIssued - expenseTotal - returnedAmount))
      : 0;
    summary.total += 1;
    summary.outstanding += outstanding;
    if (isOpenImprestStatus(row.Status)) summary.open += 1;
    if (isOpenImprestStatus(row.Status) && clean(row.DueDate) && clean(row.DueDate) < today) summary.overdue += 1;
    return summary;
  }, { total: 0, open: 0, overdue: 0, outstanding: 0 });
}
