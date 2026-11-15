const clean = value => String(value ?? '').trim();
const amount = value => {
  const number = Number(String(value ?? 0).replace(/,/g, ''));
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
};

// Input is the already authorised, branch/section-scoped Accounts snapshot.
// This projection performs no queries, writes, billing changes or new calculation.
export function debtorReportRow(row) {
  return {
    AccountRef: clean(row.AccountRef), AdmissionNo: clean(row.AdmissionNo),
    DisplayName: clean(row.DisplayName || row.AccountRef), ClassName: clean(row.ClassName),
    BranchId: clean(row.BranchId || 'main'), StudentType: clean(row.StudentType),
    TotalDebit: amount(row.TotalDebit), TotalCredit: amount(row.TotalCredit),
    OutstandingBalance: amount(row.OutstandingBalance ?? row.Balance),
    LastPaymentAt: clean(row.LastPaymentAt)
  };
}

export function schoolDebtorsReport(accountRows, { available, readTime, academicSession, schoolName } = {}) {
  return {
    available: available === true,
    readTime: clean(readTime), academicSession: clean(academicSession), schoolName: clean(schoolName),
    rows: available === true ? accountRows.map(debtorReportRow)
      .filter(row => row.OutstandingBalance > 0)
      .sort((a, b) => b.OutstandingBalance - a.OutstandingBalance || a.DisplayName.localeCompare(b.DisplayName)) : []
  };
}
