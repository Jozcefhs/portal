// Read-only diagnostic. Only projected Firestore runQuery requests; no writes.
import { createRequire } from 'node:module';
import { buildStructuredQuery, firestoreDocumentToObject } from '../functions/lib/firestore.js';
import { selectStudentBillingProfile } from '../functions/lib/student-billing-profile.js';
import { studentBillingReconciliationPlan, calculateAccountFinancialSummary, financialRowMatchesAccount, buildPaymentAccountingJournal, normalizePayment } from '../functions/api/backend.js';
import { obsoleteSchoolChargeReversalPlan } from '../functions/lib/obsolete-school-charge-reversal.js';
import { accountSummaryForKeys } from '../functions/api/parent-dashboard.js';
import { effectiveInvoiceAfterReversal } from '../functions/lib/invoice-charge-reversal.js';
import { feeRowsForBranch } from '../functions/lib/fee-branch-scope.js';
const require = createRequire('C:/Users/DYNAMAX/AppData/Roaming/npm/node_modules/firebase-tools/lib/auth.js');
const auth = require('./auth.js'), { requireAuth } = require('./requireAuth.js'), { Client } = require('./apiv2.js');
const project = 'school-management-suite-27064';
const reference = process.argv[2] || 'DCA/26/263';
if (!/^DCA\/26\/\d+$/.test(reference)) throw new Error('A specific DCA/26 admission number is required.');
const account = auth.getProjectDefaultAccount(process.cwd());
if (!account) throw new Error('Firebase CLI sign-in required.');
await requireAuth({ project, ...account });
const client = new Client({ urlPrefix: 'https://firestore.googleapis.com', apiVersion: 'v1' });
const clean = value => String(value ?? '').trim();
const pick = (row, fields) => Object.fromEntries(fields.map(key => [key, row[key] ?? '']));
async function query(collection, options = {}) {
  const { endpoint, structuredQuery } = buildStructuredQuery(collection, { limit: 1500, ...options });
  if (!endpoint.endsWith(':runQuery')) throw new Error('Only read queries are allowed.');
  const response = await client.post(`/projects/${project}/databases/(default)/documents/${endpoint}`, { structuredQuery }, { resolveOnHTTPError: true });
  const entries = Array.isArray(response.body) ? response.body : [response.body];
  if (response.status >= 400 || entries.some(row => row?.error)) throw new Error(`Read failed for ${collection} (${response.status}).`);
  const rows = entries.flatMap(row => row.document ? [firestoreDocumentToObject(row.document)] : []);
  if (rows.length >= 1500) throw new Error(`Read limit reached for ${collection}; partial results rejected.`);
  return rows;
}
const fields = ['AdmissionNo', 'admissionNo', 'AccountRef', 'accountRef', 'ApplicationReference', 'ClassName', 'ClassAdmitted',
  'AcademicSession', 'Term', 'StudentType', 'Gender', 'BillingCategory', 'EnrollmentCategory', 'AcademicProgress',
  'ProfileCompletionStatus', 'Status', 'BranchId', 'SchoolSection', 'UpdatedAt', 'IntakeCorrectedAt'];
const paths = ['students', 'schoolBranches/main/sections/secondary/students'];
const copies = (await Promise.all(paths.map(async path => (await query(path, { select: fields,
  filters: ['AdmissionNo', 'admissionNo', 'AccountRef', 'accountRef'].map(field => ({ field, op: '==', value: reference })), filterJoin: 'OR'
})).map(row => ({ ...row, __scopePath: path }))))).flat();
const student = selectStudentBillingProfile(copies, { branchId: 'main', schoolSectionAccess: 'secondary' });
if (!student) throw new Error('The requested student was not found in this scope.');
const keys = [...new Set([reference, student.AccountRef, student.AdmissionNo, student.ApplicationReference].filter(Boolean))];
const feeItems = feeRowsForBranch(await query('feeItems'), 'main');
const finances = {};
for (const collection of ['invoices', 'payments', 'ledger', 'accountSummaries']) {
  const matches = (await Promise.all(['AccountRef', 'AdmissionNo', 'ApplicationReference', 'accountRef', 'admissionNo', 'applicationReference']
    .map(field => query(collection, { filters: [{ field, op: 'in', value: keys }] })))).flat();
  finances[collection] = [...new Map(matches.map(row => [row.__name, row])).values()].filter(row =>
    (!row.BranchId || clean(row.BranchId).toLowerCase() === 'main') && (!row.SchoolSection || clean(row.SchoolSection).toLowerCase() === 'secondary')
    && financialRowMatchesAccount({ ...row, AccountRef: row.AccountRef || row.accountRef, AdmissionNo: row.AdmissionNo || row.admissionNo,
      ApplicationReference: row.ApplicationReference || row.applicationReference }, { ...student, AccountRef: reference }));
}
const data = { schoolProfile: {}, feeItems, ...finances };
if (process.argv.includes('--reversal-preview')) {
  const journals = [];
  for (const invoice of data.invoices.filter(row => /^(TXT|LEG)/.test(row.FeeCode || ''))) journals.push(...await query('accountingJournals', {
    filters: [{ field: 'SourceId', op: '==', value: invoice.InvoiceId }]
  }));
  for (const payment of data.payments) {
    const journal = buildPaymentAccountingJournal(normalizePayment(payment));
    if (journal) journals.push(...await query('accountingJournals', { filters: [{ field: 'JournalNo', op: '==', value: journal.JournalNo }] }));
  }
  data.journals = [...new Map(journals.map(row => [row.__name, row])).values()];
  const reversal = await obsoleteSchoolChargeReversalPlan(student, data);
  console.log(JSON.stringify({ readOnly: true, reference, ready: reversal.ready, reason: reversal.reason,
    before: reversal.postedTotal, after: reversal.afterPostedTotal, expected: reversal.expectedTotal,
    amount: reversal.amount, releasedCredit: reversal.releasedCredit, charges: reversal.charges,
    baselineJournalCount: reversal.baselineJournals.length, atomicWriteCount: reversal.writeCount }, null, 2));
  process.exit(0);
}
const plan = await studentBillingReconciliationPlan(student, data);
const girlPlan = await studentBillingReconciliationPlan({ ...student, Gender: 'Female' }, { ...data, invoices: [], payments: [], ledger: [], accountSummaries: [] });
const invoiceFields = ['InvoiceId', 'FeeCode', 'FeeName', 'Amount', 'Debit', 'Credit', 'Balance', 'Status', 'AcademicSession', 'Term',
  'Date', 'CreatedAt', 'UpdatedAt', 'Source', 'FeeChargeReversed', 'FeeChargeReversalAmount'];
console.log(JSON.stringify({ readOnly: true, checkedAt: new Date().toISOString(), reference, profile: pick(student, fields),
  expected: plan.expectedTotal, posted: plan.invoicedTotal, difference: plan.difference, girlSetupExpected: girlPlan.expectedTotal,
  parentSummary: accountSummaryForKeys(finances.accountSummaries, keys, finances.ledger, finances.invoices.map(effectiveInvoiceAfterReversal)),
  calculatedSummary: calculateAccountFinancialSummary(finances.invoices, finances.ledger, reference),
  savedSummaries: finances.accountSummaries.map(row => pick(row, ['TotalDebit', 'TotalCredit', 'OutstandingBalance', 'CreditBalance', 'UpdatedAt'])),
  componentReview: plan.rows, remainingConflicts: plan.conflicts, missing: plan.missing,
  invoices: finances.invoices.map(row => pick(row, invoiceFields)),
  ledgerDebits: finances.ledger.filter(row => Number(row.Debit) > 0).map(row => pick(row, ['FeeCode', 'EntryType', 'FeeCategory', 'Debit', 'Reference'])),
  payments: finances.payments.map(row => pick(row, ['PaymentId', 'Reference', 'FeeCode', 'FeeCategory', 'Amount', 'CreditedAmount', 'Status', 'AcademicSession', 'Term', 'Date'])),
  matchingFeeRules: feeItems.filter(row => ['TXT_JNR_8', 'LEG'].includes(row.FeeCode)).map(row => pick(row, ['FeeCode', 'FeeName', 'Amount', 'ClassName', 'StudentType', 'Gender', 'EnrollmentCategory', 'AcademicSession', 'Term']))
}, null, 2));
