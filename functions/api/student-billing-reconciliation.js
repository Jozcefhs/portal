import { getDocument, listCollectionForReport, requireFirestoreEnv } from '../lib/firestore.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { schoolCollectionPaths, querySchoolCollection } from '../lib/school-scope.js';
import { selectStudentBillingProfiles, studentBillingIdentity } from '../lib/student-billing-profile.js';
import { readJsonBody } from '../lib/request-security.js';
import { billingPreviewStudent } from './student-billing-preview.js';
import { financialRowMatchesAccount, studentBillingReconciliationPlan, getStudentBillingData, reconcileStudentBilling } from './backend.js';

const clean = (value) => String(value ?? '').trim();
function fail(message, status) { const error = new Error(message); error.status = status; throw error; }

export async function onRequestPost({ request, env }) {
  try {
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    if (user.role !== 'Super Admin' || user.edition !== 'school' || !clean(user.branchId) ||
      !(user.allowedSections || []).includes('accounts') || !(user.allowedSections || []).includes('students')) {
      fail('Select a school branch and use a Super Admin account with Accounts and Students access.', 403);
    }
    const body = await readJsonBody(request, { maxBytes: 4096 });
    if (!['previewAll', 'preview', 'apply'].includes(body.action)) fail('Choose a reconciliation action.', 400);
    const scope = { branchId: user.branchId, schoolSectionAccess: user.schoolSectionAccess };
    if (body.action === 'previewAll') {
      const paths = await schoolCollectionPaths(env, 'students', scope);
      const [groups, schoolProfile, feeItems, invoices, accountSummaries] = await Promise.all([
        Promise.all(paths.map(async (path) => (await listCollectionForReport(env, path))
          .map((row) => ({ ...row, __scopePath: path })))),
        getDocument(env, 'settings', 'schoolProfile'), listCollectionForReport(env, 'feeItems'),
        listCollectionForReport(env, 'invoices'), listCollectionForReport(env, 'accountSummaries')
      ]);
      const students = selectStudentBillingProfiles(groups.flat()).filter((row) => {
        const identity = studentBillingIdentity(row);
        return identity.branch === clean(user.branchId).toLowerCase() &&
          (!['primary', 'secondary'].includes(clean(user.schoolSectionAccess).toLowerCase()) || identity.section === clean(user.schoolSectionAccess).toLowerCase());
      });
      const rows = [];
      let matched = 0, incomplete = 0;
      for (const student of students) {
        const identity = studentBillingIdentity(student);
        if (clean(student.ProfileCompletionStatus).toLowerCase() !== 'complete') { incomplete += 1; continue; }
        if (students.filter((row) => studentBillingIdentity(row).reference === identity.reference).length !== 1) {
          rows.push({ profile: { AccountRef: student.AdmissionNo, DisplayName: student.DisplayName }, ready: false, reason: 'Ambiguous admission number across school sections.', difference: 0 }); continue;
        }
        const account = { ...student, AccountRef: student.AdmissionNo || student.AccountRef };
        const matches = (row) => financialRowMatchesAccount({ ...row, AccountRef: row.AccountRef || row.accountRef,
          AdmissionNo: row.AdmissionNo || row.admissionNo, ApplicationReference: row.ApplicationReference || row.applicationReference }, account) &&
          clean(row.BranchId || 'main').toLowerCase() === identity.branch;
        const plan = await studentBillingReconciliationPlan({ ...student, BranchId: identity.branch, SchoolSection: identity.section }, {
          schoolProfile, feeItems: feeItems.filter((row) => !clean(row.BranchId) || clean(row.BranchId).toLowerCase() === identity.branch),
          invoices: invoices.filter(matches), accountSummaries: accountSummaries.filter(matches), payments: [], ledger: []
        });
        if (plan.rows.every((row) => Math.abs(row.difference) < 0.005 && row.invoiceIds.length <= 1)) matched += 1;
        else rows.push(plan);
      }
      rows.sort((a, b) => String(a.profile.AccountRef).localeCompare(String(b.profile.AccountRef)));
      return Response.json({ ok: true, readOnly: true, total: students.length, matched, incomplete,
        ready: rows.filter((row) => row.ready).length, review: rows.filter((row) => !row.ready).length, rows }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const reference = clean(body.AccountRef);
    if (!reference || reference.length > 140) fail('Choose an admission number.', 400);
    const groups = await Promise.all(['AdmissionNo', 'admissionNo', 'AccountRef', 'accountRef'].map((field) =>
      querySchoolCollection(env, 'students', { filters: [{ field, op: '==', value: reference }], limit: 3, scope })));
    const student = billingPreviewStudent(groups.flat(), user, reference);
    const result = body.action === 'apply'
      ? await reconcileStudentBilling(env, student, clean(body.PreviewToken), user)
      : await studentBillingReconciliationPlan(student, await getStudentBillingData(env, student));
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, message: error.message || 'Student reconciliation failed.' },
      { status: error.status || 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
