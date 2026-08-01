const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const number = (value) => { const result = Number(String(value ?? '0').replace(/,/g, '')); return Number.isFinite(result) ? result : 0; };
const dateOnly = (value) => clean(value).slice(0, 10);
const activeAt = (row, date) => clean(row.Active ?? 'YES').toUpperCase() !== 'NO' && (!dateOnly(row.EffectiveFrom) || dateOnly(row.EffectiveFrom) <= dateOnly(date)) && (!dateOnly(row.EffectiveTo) || dateOnly(row.EffectiveTo) >= dateOnly(date));
const amount = (value) => Math.round((Math.max(0, number(value)) + Number.EPSILON) * 100) / 100;

function ledgerError(message) { const error = new Error(message); error.status = 409; error.code = 'MISSING_PAYROLL_LEDGER_MAPPING'; return error; }
function snapshot(row) { const result = { ...row }; delete result.__id; delete result.__name; return result; }

export function buildPayrollJournalLines(items, mappings, postingDate, description = 'Payroll') {
  const configurable = (items || []).filter((row) => clean(row.CalculationMode).toUpperCase() === 'CONFIGURABLE_PAYE');
  const legacy = (items || []).filter((row) => clean(row.CalculationMode).toUpperCase() !== 'CONFIGURABLE_PAYE');
  const available = (mappings || []).filter((row) => activeAt(row, postingDate));
  const find = (type) => available.find((row) => clean(row.MappingType).toUpperCase() === type);
  const lines = []; const used = [];
  const add = (AccountCode, Debit, Credit, lineDescription) => {
    const code = clean(AccountCode); const debit = amount(Debit); const credit = amount(Credit); if (!code || (!debit && !credit)) return;
    const existing = lines.find((row) => row.AccountCode === code && row.Description === lineDescription);
    if (existing) { existing.Debit = amount(existing.Debit + debit); existing.Credit = amount(existing.Credit + credit); }
    else lines.push({ AccountCode: code, Debit: debit, Credit: credit, Description: lineDescription });
  };
  const requireMapping = (type, side, total) => {
    if (amount(total) <= 0) return null; const mapping = find(type); const account = clean(mapping?.[side]);
    if (!mapping || !account) throw ledgerError(`Configure the ${type.replace(/_/g, ' ')} ${side === 'DebitAccountId' ? 'debit' : 'credit'} account before posting configurable payroll.`);
    used.push(snapshot(mapping)); return account;
  };
  if (configurable.length) {
    const totals = configurable.reduce((sum, item) => {
      sum.gross += number(item.GrossPay); sum.paye += number(item.FinalPaye ?? item.TaxAmount); sum.pension += number(item.PensionAmount);
      sum.nhf += number(item.NhfAmount); sum.other += number(item.OtherDeductionTotal); sum.net += number(item.NetPay); return sum;
    }, { gross: 0, paye: 0, pension: 0, nhf: 0, other: 0, net: 0 });
    add(requireMapping('GROSS_SALARY', 'DebitAccountId', totals.gross), totals.gross, 0, description);
    add(requireMapping('PAYE', 'CreditAccountId', totals.paye), 0, totals.paye, 'PAYE payable');
    add(requireMapping('PENSION', 'CreditAccountId', totals.pension), 0, totals.pension, 'Pension payable');
    add(requireMapping('NHF', 'CreditAccountId', totals.nhf), 0, totals.nhf, 'NHF payable');
    add(requireMapping('OTHER_DEDUCTIONS', 'CreditAccountId', totals.other), 0, totals.other, 'Other payroll deductions payable');
    add(requireMapping('NET_SALARY', 'CreditAccountId', totals.net), 0, totals.net, 'Net salaries payable');
  }
  if (legacy.length) {
    const expenseByAccount = new Map(); let deductions = 0; let net = 0;
    legacy.forEach((item) => { const code = clean(item.SalaryExpenseAccount) || '6000'; expenseByAccount.set(code, (expenseByAccount.get(code) || 0) + number(item.GrossPay)); deductions += number(item.TotalDeductions); net += number(item.NetPay); });
    expenseByAccount.forEach((debit, code) => add(code, debit, 0, description)); add('2100', 0, deductions, 'Legacy payroll deductions payable'); add('2300', 0, net, 'Legacy net salaries payable');
  }
  const debit = amount(lines.reduce((sum, row) => sum + number(row.Debit), 0)); const credit = amount(lines.reduce((sum, row) => sum + number(row.Credit), 0));
  if (Math.abs(debit - credit) > 0.01) throw ledgerError(`Payroll journal is out of balance by ${amount(Math.abs(debit - credit))}. Review component totals and mappings.`);
  return { lines, mappingSnapshot: used, totalDebit: debit, totalCredit: credit };
}
