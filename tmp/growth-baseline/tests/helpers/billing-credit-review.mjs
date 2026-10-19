import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

export const student = { AdmissionNo: 'TEST/26/001', AccountRef: 'TEST/26/001', DisplayName: 'Sample student',
  ClassName: 'Grade 8', StudentType: 'Boarding Student', Gender: 'Male', BillingCategory: 'Regular',
  EnrollmentCategory: 'New Intake', AcademicProgress: 'Promoted', BranchId: 'main', SchoolSection: 'secondary',
  AcademicSession: '2026/2027', Term: 'First Term', ProfileCompletionStatus: 'Complete',
  __scopePath: 'schoolBranches/main/sections/secondary/students' };
const fee = { Active: 'YES', PayableOnline: 'YES', FeeCategory: 'School Fee', ClassName: 'All',
  StudentType: 'All', Gender: 'All', BillingCategory: 'All', BranchId: 'main',
  AcademicSession: '2026/2027', Term: 'First Term' };
export function billingFixture() {
  const feeItems = [['BASE', 'Other school fees', 880820, 'All'], ['TXT_OLD', 'Returning textbooks', 118030, 'Returning'],
    ['LEG', 'Yearbook', 10000, 'Returning'], ['BOW', 'Boarding wear', 60000, 'New Intake'],
    ['TAB', 'Learning tablet', 250000, 'New Intake'], ['TXT_NEW', 'Intake textbooks', 120065, 'New Intake'],
    ['UNI', 'Uniforms', 178000, 'New Intake']].map(([FeeCode, FeeName, Amount, EnrollmentCategory]) =>
    ({ ...fee, FeeCode, FeeName, Amount, EnrollmentCategory }));
  const invoices = feeItems.slice(0, 3).map((row, index) => ({ ...row, __id: `invoice-${index}`, InvoiceId: `INV-${index}`,
    AccountRef: student.AccountRef, Debit: row.Amount, Credit: row.Amount, Status: 'Paid' }));
  return { schoolProfile: {}, feeItems, invoices,
    ledger: [{ __id: 'payment-credit', AccountRef: student.AccountRef, FeeCategory: 'School Fee', Credit: 1502885 }],
    payments: [{ __id: 'payment', PaymentId: 'RECEIPT', AccountRef: student.AccountRef, FeeCategory: 'School Fee', Amount: 1502885, Status: 'Paid' }],
    accountSummaries: [{ AccountRef: student.AccountRef, CreditBalance: 494035 }] };
}

export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const money = (value) => `₦${Number(value).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function renderBillingReport(report) {
  const source = await readFile(new URL('../../js/admin.js', import.meta.url), 'utf8');
  const start = source.indexOf('content.innerHTML = `<h3>School-wide student billing review</h3>');
  const end = source.indexOf("\n      content.querySelector('[data-apply-billing-plans]')", start);
  if (start < 0 || end < start) throw new Error('Billing review renderer not found.');
  const content = {};
  vm.runInNewContext(source.slice(start, end), { content, report, ready: report.rows.filter((row) => row.ready),
    currentUser: {}, money, escapeHtml });
  return content.innerHTML;
}

export async function renderParentCredit(summary) {
  const source = await readFile(new URL('../../js/parent-dashboard.js', import.meta.url), 'utf8');
  const start = source.indexOf('function accountSummaryFor(child)');
  const end = source.indexOf('function isYes(value)', start);
  const accountCreditSummary = {};
  vm.runInNewContext(`${source.slice(start, end)}; renderAccountCredit({});`, {
    dashboard: { accountSummaries: {} }, childResult: () => summary, accountCreditSummary, money, escapeHtml
  });
  return accountCreditSummary.innerHTML;
}
