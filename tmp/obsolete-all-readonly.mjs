// Read-only live review using the committed reversal planner. Never posts.
import { createRequire } from 'node:module';
import { buildStructuredQuery, firestoreDocumentToObject } from '../functions/lib/firestore.js';
import { selectStudentBillingProfiles, studentBillingIdentity, studentProfileValue } from '../functions/lib/student-billing-profile.js';
import { buildStudentBillingPreview, financialRowMatchesAccount, accountRefsFrom, normalizePayment, buildPaymentAccountingJournal, normalizeInvoice } from '../functions/api/backend.js';
import { obsoleteSchoolChargeReversalPlan } from '../functions/lib/obsolete-school-charge-reversal.js';
import { feeRowsForBranch } from '../functions/lib/fee-branch-scope.js';
const require = createRequire('C:/Users/DYNAMAX/AppData/Roaming/npm/node_modules/firebase-tools/lib/auth.js');
const auth = require('./auth.js'), { requireAuth } = require('./requireAuth.js'), { Client } = require('./apiv2.js');
const project = 'school-management-suite-27064', branch = 'main';
const account = auth.getProjectDefaultAccount(process.cwd());
if (!account) throw new Error('Firebase CLI sign-in required.');
await requireAuth({ project, ...account });
const client = new Client({ urlPrefix: 'https://firestore.googleapis.com', apiVersion: 'v1' });
const readTime = new Date(Date.now() - 5000).toISOString();
const basePath = `/projects/${project}/databases/(default)/documents`;
const clean = value => String(value ?? '').trim();
const keys = ['AccountRef', 'AdmissionNo', 'ApplicationReference', 'accountRef', 'admissionNo', 'applicationReference'];
const unique = rows => [...new Map(rows.map(row => [row.__name, row])).values()];
async function query(collection, options = {}) {
  if (!/^(students|schoolBranches\/main\/sections\/(primary|secondary)\/students|feeItems|invoices|payments|ledger|accountSummaries|accountingJournals)$/.test(collection)) throw new Error('Collection not allowed for this review.');
  const limit = 3000;
  const { endpoint, structuredQuery } = buildStructuredQuery(collection, { ...options, limit });
  if (!endpoint.endsWith(':runQuery')) throw new Error('Only read queries allowed.');
  const response = await client.post(`${basePath}/${endpoint}`, { structuredQuery, readTime }, { resolveOnHTTPError: true });
  const entries = Array.isArray(response.body) ? response.body : [response.body];
  if (response.status >= 400 || entries.some(row => row?.error)) throw new Error(`Read failed: ${collection} (${response.status}).`);
  const rows = entries.flatMap(row => row.document ? [firestoreDocumentToObject(row.document)] : []);
  if (rows.length >= limit) throw new Error(`Read limit reached: ${collection}. Partial review rejected.`);
  return rows;
}
const settingsResponse = await client.get(`${basePath}/settings/schoolProfile?readTime=${encodeURIComponent(readTime)}`, { resolveOnHTTPError: true });
if (settingsResponse.status !== 200) throw new Error('School configuration read failed.');
const schoolProfile = firestoreDocumentToObject(settingsResponse.body);
const feeItems = feeRowsForBranch(await query('feeItems'), branch);
const fields = ['AdmissionNo', 'admissionNo', 'AccountRef', 'accountRef', 'ApplicationReference', 'applicationReference', 'ApplicationID', 'AdmissionNumber',
  'FirstName', 'firstName', 'MiddleName', 'middleName', 'Surname', 'surname', 'DisplayName', 'displayName',
  'ClassName', 'className', 'ClassAdmitted', 'classAdmitted', 'AcademicSession', 'academicSession', 'Term', 'term',
  'StudentType', 'studentType', 'Gender', 'gender', 'Sex', 'sex', 'BillingCategory', 'billingCategory',
  'EnrollmentCategory', 'enrollmentCategory', 'IntakeCategory', 'StudentEntryType', 'AcademicProgress', 'academicProgress',
  'ProgressCategory', 'RepeaterStatus', 'ProfileCompletionStatus', 'profileCompletionStatus', 'Status', 'BranchId', 'branchId',
  'SchoolSection', 'schoolSection', 'UpdatedAt', 'updatedAt', 'ParentOnboardingProfileCompletedAt'];
const paths = ['students', 'schoolBranches/main/sections/secondary/students', 'schoolBranches/main/sections/primary/students'];
const raw = (await Promise.all(paths.map(async path => (await query(path, { select: fields })).map(row => ({ ...row, __scopePath: path }))))).flat();
const roster = selectStudentBillingProfiles(raw).filter(row => studentBillingIdentity(row).branch === branch);
const students = [], ambiguous = [];
for (const student of roster) {
  const identity = studentBillingIdentity(student);
  if (roster.filter(row => studentBillingIdentity(row).reference === identity.reference).length !== 1) { ambiguous.push(identity.reference); continue; }
  const AccountRef = studentProfileValue(student, 'AdmissionNo', ['admissionNo', 'AccountRef', 'accountRef', '__id']);
  const normalized = { ...student, AccountRef, AdmissionNo: AccountRef, BranchId: branch, SchoolSection: identity.section,
    ApplicationReference: clean(student.applicationReference || student.ApplicationReference) };
  const preview = await buildStudentBillingPreview(normalized, { schoolProfile, feeItems });
  if (preview.profile.EnrollmentCategory === 'New Intake') students.push(normalized);
}
console.log(JSON.stringify({ stage: 'roster', readOnly: true, readTime, total: roster.length, newIntake: students.length, ambiguous }));
async function financialRows(collection, references) {
  const rows = [];
  // At most 30 OR disjunctions per indexed read; reject truncated responses.
  for (let offset = 0; offset < references.length; offset += 5) {
    rows.push(...await query(collection, { filterJoin: 'OR', filters: keys.map(field => ({ field, op: 'in', value: references.slice(offset, offset + 5) })) }));
  }
  return unique(rows);
}
const references = [...new Set(students.flatMap(accountRefsFrom))];
const invoices = await financialRows('invoices', references);
const matches = (student, row) => financialRowMatchesAccount({ ...row, AccountRef: row.AccountRef || row.accountRef,
  AdmissionNo: row.AdmissionNo || row.admissionNo, ApplicationReference: row.ApplicationReference || row.applicationReference }, student)
  && clean(row.BranchId || 'main').toLowerCase() === branch
  && (!clean(row.SchoolSection || row.schoolSection) || clean(row.SchoolSection || row.schoolSection).toLowerCase() === student.SchoolSection);
const candidates = [];
for (const student of students) {
  const data = { schoolProfile, feeItems, invoices: invoices.filter(row => matches(student, row)), payments: [], ledger: [], accountSummaries: [] };
  const candidate = await obsoleteSchoolChargeReversalPlan(student, data, { candidateOnly: true });
  if (candidate.charges.length) candidates.push({ student, data });
}
console.log(JSON.stringify({ stage: 'candidates', readOnly: true, count: candidates.length }));
const results = [];
for (const { student, data } of candidates) {
  const refs = [...new Set(accountRefsFrom(student))];
  for (const collection of ['payments', 'ledger', 'accountSummaries']) data[collection] = (await financialRows(collection, refs)).filter(row => matches(student, row));
  const journals = [];
  for (const invoice of data.invoices.map(normalizeInvoice).filter(row => /^(TXT(?:_|$)|LEG$)/i.test(row.FeeCode) || /\b(textbooks?|yearbook)\b/i.test(row.FeeName))) {
    journals.push(...await query('accountingJournals', { filters: [{ field: 'SourceId', op: '==', value: invoice.InvoiceId }] }));
  }
  for (const payment of data.payments) {
    const journal = buildPaymentAccountingJournal(normalizePayment(payment));
    if (journal) journals.push(...await query('accountingJournals', { filters: [{ field: 'JournalNo', op: '==', value: journal.JournalNo }] }));
  }
  data.journals = unique(journals);
  const plan = await obsoleteSchoolChargeReversalPlan(student, data);
  const result = { reference: plan.profile.AccountRef, name: plan.profile.DisplayName, class: plan.profile.ClassName,
    session: plan.profile.AcademicSession, term: plan.profile.Term, ready: plan.ready, reason: plan.reason,
    before: plan.postedTotal, after: plan.afterPostedTotal, expected: plan.expectedTotal, amount: plan.amount,
    releasedCredit: plan.releasedCredit, charges: plan.charges, baselineJournals: plan.baselineJournals.length, writeCount: plan.writeCount };
  results.push(result);
  console.log(JSON.stringify({ stage: 'reviewed', readOnly: true, ...result }));
}
const eligible = results.filter(row => row.ready);
console.log(JSON.stringify({ stage: 'complete', readOnly: true, readTime, totalProfiles: roster.length,
  ready: eligible.length, blocked: results.length - eligible.length,
  amount: eligible.reduce((sum, row) => sum + row.amount, 0), releasedCredit: eligible.reduce((sum, row) => sum + row.releasedCredit, 0) }));
