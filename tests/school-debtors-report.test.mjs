import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { debtorReportRow, schoolDebtorsReport } from '../functions/lib/school-debtors-report.js';
const source = readFileSync(new URL('../functions/api/admin.js', import.meta.url), 'utf8');
const uiContext = vm.createContext({ Intl, Date });
vm.runInContext(readFileSync(new URL('../js/school-debtors.js', import.meta.url), 'utf8'), uiContext);
const ui = uiContext.DynamaxSchoolDebtors;
const account = (number, extra = {}) => ({ AccountRef: `TEST/${number}`, AdmissionNo: `TEST/${number}`, DisplayName: `Sample ${number}`,
  BranchId: 'main', ClassName: 'Grade 7', SchoolSection: 'secondary', StudentType: 'Day Student', TotalDebit: 100.15, TotalCredit: 40.05,
  OutstandingBalance: 60.1, PasswordHash: 'private', ParentEmail: 'private@example.invalid', WalletPinHash: 'private', ...extra });
const options = { available: true, readTime: '2026-11-15T10:00:00.000Z', academicSession: '2026/2027', schoolName: 'Sample School' };

test('full report includes more than ten debtors, excludes paid/credit accounts and preserves input', () => {
  const records = [...Array.from({ length: 215 }, (_, i) => account(i)), account('paid', { OutstandingBalance: 0 }), account('credit', { OutstandingBalance: -30 })];
  const before = structuredClone(records);
  const report = schoolDebtorsReport(records, options);
  assert.equal(report.rows.length, 215);
  assert.equal(ui.total(report.rows, 'OutstandingBalance'), 12921.5);
  assert.deepEqual(records, before);
  assert.ok(report.rows.every(row => !Object.hasOwn(row, 'PasswordHash') && !Object.hasOwn(row, 'ParentEmail') && !Object.hasOwn(row, 'WalletPinHash')));
});

test('zero outstanding overrides a legacy balance and unavailable accounts are not reported as complete', () => {
  assert.equal(schoolDebtorsReport([account(1, { OutstandingBalance: 0, Balance: 10 })], options).rows.length, 0);
  assert.deepEqual(schoolDebtorsReport([account(1)], { ...options, available: false }).rows, []);
  assert.equal(schoolDebtorsReport([], options).available, true);
  assert.equal(debtorReportRow({ Balance: '1,200.50' }).OutstandingBalance, 1200.5);
  assert.equal(debtorReportRow({ Balance: 'invalid' }).OutstandingBalance, 0);
});

test('search, normalised class, student type and sorting operate on the complete snapshot', () => {
  const report = schoolDebtorsReport([account(1), account(2, { ClassName: 'GRADE 7', StudentType: 'Boarding Student', DisplayName: 'Another Learner' }),
    account(3, { ClassName: 'Grade 8', OutstandingBalance: 80 })], options);
  assert.equal(ui.filterRows(report, { className: 'grade7' }).length, 2);
  assert.equal(ui.filterRows(report, { className: 'grade7', studentType: 'boarding student' })[0].AdmissionNo, 'TEST/2');
  assert.equal(ui.filterRows(report, { search: 'test/3' })[0].AdmissionNo, 'TEST/3');
  assert.equal(ui.filterRows(report, { search: 'another learner' }).length, 1);
  assert.equal(ui.filterRows(report, { sort: 'balance' })[0].AdmissionNo, 'TEST/3');
});

test('preview contains every matching row, correct totals, scope, time and escaped names', () => {
  const report = schoolDebtorsReport(Array.from({ length: 215 }, (_, i) => account(i)), options);
  report.rows[0].DisplayName = '<img src=x onerror=alert(1)>';
  const html = ui.printHtml(report, {}, { branchName: 'Sample Branch', schoolSection: 'secondary' });
  assert.equal((html.match(/<tr>/g) || []).length, 216);
  assert.ok(html.includes('12,921.50') && html.includes('Sample Branch') && html.includes('2026/2027') && html.includes('WAT'));
  assert.ok(html.includes('&lt;img') && !html.includes('<img'));
  assert.ok(html.includes('table-header-group'));
  assert.equal((ui.printHtml(report, { search: 'TEST/214' }).match(/<tr>/g) || []).length, 2);
});

async function route({ branch = 'main', section = 'secondary', records = [], allowed = ['accounts'], overviewFails = false, requestedSection = 'schoolInsights' } = {}) {
  const reads = [];
  const io = (kind, result) => async (...args) => { reads.push({ kind, args }); return result; };
  const context = vm.createContext({ Response, Date, console, debtorReportRow, schoolDebtorsReport,
    requireFirestoreEnv: () => {}, requireStaffSession: async () => ({ allowedSections: allowed, edition: 'school', branchId: branch, schoolSectionAccess: section }),
    readJsonBody: async () => ({ section: requestedSection }),
    loadFinanceSchoolProfile: io('profile', { SchoolName: 'Sample School', CurrentAcademicSession: '2026/2027' }),
    loadBranchFinanceRows: io('finance', []), loadAccountsWalletLedger: io('wallet', []), listSchoolCollection: io('students', []),
    getAccountsOverview: async (_env, preloaded, scope) => { reads.push({ kind: 'overview', scope }); assert.ok(Array.isArray(preloaded.payments)); if (overviewFails) throw Error('Unavailable'); return { ok: true, accounts: records }; },
    branchProfilesForRecords: async () => new Map(), withVendorStorePolicy: async (_env, _user, rows) => rows,
    schoolSectionFor: row => row.SchoolSection || 'secondary', normalizeClassKey: v => String(v).toLowerCase(), recordBranchId: row => row.BranchId || 'main'
  });
  vm.runInContext(source.replace(/^import .*;\r?\n/gm, '').replaceAll('export async function ', 'async function ').replaceAll('export function ', 'function '), context);
  const response = await context.onRequestPost({ request: {}, env: {} });
  return { response, body: await response.json(), reads };
}

test('actual School Insights handler returns all authorised debtors without any additional collection read', async () => {
  const records = Array.from({ length: 215 }, (_, i) => account(i));
  records.push(account('other', { BranchId: 'other' }), account('primary', { SchoolSection: 'primary' }));
  const result = await route({ records });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.departments.schoolInsights.debtorsReport.rows.length, 215);
  assert.equal(result.body.departments.schoolInsights.defaulters.length, 10);
  assert.equal(result.body.summary.defaulters, 215);
  assert.equal(result.body.summary.outstandingFees.toFixed(2), '12921.50');
  assert.deepEqual(result.reads.filter(read => read.kind === 'finance').map(read => read.args[1]), ['accountSummaries', 'payments', 'invoices', 'ledger']);
  assert.equal(result.reads.filter(read => read.kind === 'overview').length, 1);
  assert.equal(result.response.headers.get('Cache-Control'), 'no-store');
});

test('report preserves separate branch identities with matching admission numbers', async () => {
  const result = await route({ branch: 'area1', section: 'primary', records: [account(1), account(1, { BranchId: 'area1', SchoolSection: 'primary', DisplayName: 'Area Learner' })] });
  assert.equal(result.body.departments.schoolInsights.debtorsReport.rows.length, 1);
  assert.equal(result.body.departments.schoolInsights.debtorsReport.rows[0].DisplayName, 'Area Learner');
});

test('Accounts permission is required before reading debtors', async () => {
  const result = await route({ allowed: ['students'], records: [account(1)] });
  assert.equal(result.response.status, 403);
  assert.equal(result.reads.length, 0);
});

test('failed financial overview is explicitly unavailable, never a printable empty report', async () => {
  const result = await route({ overviewFails: true });
  assert.equal(result.body.departments.schoolInsights.debtorsReport.available, false);
});
