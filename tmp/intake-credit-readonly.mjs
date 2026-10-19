// Read-only investigation of admission numbers supplied by the user.
// Only Firestore runQuery is used; never post receipts, invoices or journals.
import { createRequire } from 'node:module';
import { buildStructuredQuery, firestoreDocumentToObject } from '../functions/lib/firestore.js';
import { selectStudentBillingProfile } from '../functions/lib/student-billing-profile.js';
import { studentBillingReconciliationPlan, calculateAccountFinancialSummary, financialRowMatchesAccount } from '../functions/api/backend.js';
import { accountSummaryForKeys } from '../functions/api/parent-dashboard.js';
import { feeRowsForBranch } from '../functions/lib/fee-branch-scope.js';
const require = createRequire('C:/Users/DYNAMAX/AppData/Roaming/npm/node_modules/firebase-tools/lib/auth.js');
const auth = require('./auth.js');
const { requireAuth } = require('./requireAuth.js');
const { Client } = require('./apiv2.js');
const project = 'school-management-suite-27064';
const account = auth.getProjectDefaultAccount(process.cwd());
if (!account) throw new Error('Firebase CLI sign-in required for read-only billing lookup.');
await requireAuth({ project, ...account });
const client = new Client({ urlPrefix: 'https://firestore.googleapis.com', apiVersion: 'v1' });
const refs = ['DCA/26/259', 'DCA/26/260', 'DCA/26/261', 'DCA/26/263', 'DCA/26/270', 'DCA/26/273'];
async function query(collection, options = {}) {
  const { endpoint, structuredQuery } = buildStructuredQuery(collection, { limit: 1500, ...options });
  if (!endpoint.endsWith(':runQuery')) throw new Error('Non-read endpoint refused.');
  const response = await client.post(`/projects/${project}/databases/(default)/documents/${endpoint}`, { structuredQuery }, { resolveOnHTTPError: true });
  const entries = Array.isArray(response.body) ? response.body : [response.body];
  if (response.status >= 400 || entries.some(item => item?.error)) throw new Error(`Read failed for ${collection} (${response.status}): ${entries.find(item => item?.error)?.error?.status || ''}`);
  const rows = entries.flatMap(item => item.document ? [firestoreDocumentToObject(item.document)] : []);
  if (rows.length >= 1500) throw new Error(`Read limit reached for ${collection}; refusing partial conclusions.`);
  return rows;
}
const pick = (row, fields) => Object.fromEntries(fields.map(key => [key, row[key] ?? '']));
const studentPaths = ['students', 'schoolBranches/main/sections/secondary/students', 'schoolBranches/main/sections/primary/students'];
const studentFields = ['AdmissionNo', 'admissionNo', 'AccountRef', 'accountRef', 'ApplicationReference', 'ClassName', 'ClassAdmitted', 'ClassArm', 'AcademicSession', 'Term', 'StudentType', 'Gender', 'BillingCategory', 'EnrollmentCategory', 'AcademicProgress', 'ProfileCompletionStatus', 'Status', 'BranchId', 'SchoolSection', 'UpdatedAt', 'IntakeCorrectedAt'];
const groups = await Promise.all(studentPaths.map(async path => (await query(path, { select: studentFields,
  filters: ['AdmissionNo', 'admissionNo', 'AccountRef', 'accountRef'].map(field => ({ field, op: 'in', value: refs })), filterJoin: 'OR'
})).map(row => ({ ...row, __scopePath: path }))));
const students = groups.flat();
const feeItems = feeRowsForBranch(await query('feeItems'), 'main');
const additionalRefs = [...new Set(students.flatMap(row => [row.AdmissionNo, row.AccountRef, row.ApplicationReference]).filter(Boolean))];
async function financeRows(collection) {
  const results = [];
  for (let offset = 0; offset < additionalRefs.length; offset += 10) {
    const batch = additionalRefs.slice(offset, offset + 10);
    const groups = await Promise.all(['AccountRef', 'AdmissionNo', 'ApplicationReference', 'accountRef', 'admissionNo', 'applicationReference']
      .map(field => query(collection, { filters: [{ field, op: 'in', value: batch }] })));
    results.push(...groups.flat());
  }
  return [...new Map(results.map(row => [row.__name || row.__id, row])).values()];
}
const finances = {};
for (const name of ['invoices', 'payments', 'ledger', 'accountSummaries']) finances[name] = await financeRows(name);
const result = [];
for (const ref of refs) {
  const copies = students.filter(row => [row.AdmissionNo, row.admissionNo, row.AccountRef, row.accountRef].includes(ref));
  const student = selectStudentBillingProfile(copies, { branchId: 'main', schoolSectionAccess: 'secondary' });
  if (!student) { result.push({ reference: ref, found: false }); continue; }
  const identity = { ...student, AccountRef: ref };
  const financial = Object.fromEntries(Object.entries(finances).map(([collection, rows]) => [collection, rows.filter(row =>
    financialRowMatchesAccount({ ...row, AccountRef: row.AccountRef || row.accountRef, AdmissionNo: row.AdmissionNo || row.admissionNo, ApplicationReference: row.ApplicationReference || row.applicationReference }, identity)
    && (!row.BranchId || row.BranchId === 'main') && (!row.SchoolSection || row.SchoolSection === 'secondary'))]));
  const plan = await studentBillingReconciliationPlan(student, { schoolProfile: {}, feeItems, ...financial });
  result.push({ reference: ref, profile: pick(student, studentFields), copies: copies.map(row => pick(row, ['__scopePath', '__id', '__updateTime', 'ClassName', 'StudentType', 'EnrollmentCategory', 'ProfileCompletionStatus', 'UpdatedAt', 'IntakeCorrectedAt'])),
    review: { ready: plan.ready, reason: plan.reason, expected: plan.expectedTotal, invoiced: plan.invoicedTotal, difference: plan.difference, recordedCredit: plan.recordedCredit,
      missing: plan.missing, rows: plan.rows },
    calculatedSummary: calculateAccountFinancialSummary(financial.invoices, financial.ledger, ref),
    parentSummary: accountSummaryForKeys(financial.accountSummaries, [ref], financial.ledger, financial.invoices),
    savedSummaries: financial.accountSummaries.map(row => pick(row, ['__id','__updateTime','AccountRef','TotalDebit','TotalCredit','OutstandingBalance','CreditBalance','UpdatedAt'])),
    invoices: financial.invoices.map(row => pick(row, ['InvoiceId','FeeCode','FeeName','Amount','Debit','Credit','Balance','Status','AcademicSession','Term','Date','CreatedAt','UpdatedAt','Source','FeeChargeReversed','FeeChargeReversalAmount','FeeChargeReleasedCredit'])),
    payments: financial.payments.map(row => pick(row, ['PaymentId','Reference','FeeCode','FeeCategory','Amount','CreditedAmount','Status','AcademicSession','Term','Date','Method','Source'])),
    ledger: financial.ledger.map(row => pick(row, ['__id','AccountRef','AdmissionNo','FeeCode','FeeCategory','EntryType','Debit','Credit','Amount','AcademicSession','Term','Date','Reference'])) });
}
const summary = result.map(row => ({ reference: row.reference, class: row.profile?.ClassName,
  savedIntake: row.profile?.EnrollmentCategory, correctedAt: row.profile?.IntakeCorrectedAt,
  copies: row.copies?.length, expected: row.review?.expected, invoiced: row.review?.invoiced, difference: row.review?.difference,
  recordedCredit: row.review?.recordedCredit, calculatedSummary: row.calculatedSummary, parentSummary: row.parentSummary,
  savedSummaries: row.savedSummaries,
  mismatches: row.review?.rows.filter(item => item.difference || item.invoiceIds.length > 1).map(item => ({ code:item.code, expected:item.expected, invoiced:item.invoiced, invoices:item.invoiceIds.length })),
  receipts: row.payments, ledgerCredits: row.ledger?.filter(entry => Number(entry.Credit) > 0).map(entry => pick(entry, ['FeeCode','FeeCategory','EntryType','Credit','Date','Reference'])) }));
console.log(JSON.stringify({ readOnly: true, checkedAt: new Date().toISOString(), result: summary,
  relevantFeeRules: feeItems.filter(row => /^(TXT|LEG|BOW|TAB|UNI)/i.test(row.FeeCode || '')).map(row => pick(row,
    ['FeeCode','Amount','Active','ClassName','StudentType','EnrollmentCategory','AcademicProgress','AcademicSession','Term'])) }, null, 2));
