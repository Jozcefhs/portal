import { requireFirestoreEnv } from '../lib/firestore.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { querySchoolCollection } from '../lib/school-scope.js';
import { selectStudentBillingProfiles, studentBillingIdentity } from '../lib/student-billing-profile.js';
import { readJsonBody } from '../lib/request-security.js';
import { getStudentBillingPreview } from './backend.js';

const clean = (value) => String(value ?? '').trim();
function fail(message, status) { const error = new Error(message); error.status = status; throw error; }

export function billingPreviewStudent(rows, user, reference) {
  const wanted = clean(reference).toLowerCase();
  const section = clean(user.schoolSectionAccess || 'All').toLowerCase();
  const branch = clean(user.branchId).toLowerCase();
  const candidates = selectStudentBillingProfiles(rows).filter((row) => {
    const identity = studentBillingIdentity(row);
    return identity.reference === wanted && (!branch || identity.branch === branch) &&
      (section === 'all' || identity.section === section);
  });
  if (!candidates.length) fail('Student was not found in your current branch and school section.', 404);
  if (candidates.length !== 1) fail('This admission number belongs to more than one school scope. Select a specific branch and section before reviewing billing.', 409);
  const identity = studentBillingIdentity(candidates[0]);
  return { ...candidates[0], BranchId: identity.branch, SchoolSection: identity.section };
}

export async function onRequestPost({ request, env }) {
  try {
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    if (!(user.allowedSections || []).includes('accounts') || !(user.allowedSections || []).includes('students')) {
      fail('Student billing previews require both Accounts and Students access.', 403);
    }
    const body = await readJsonBody(request, { maxBytes: 4096 });
    const reference = clean(body.AccountRef);
    if (!reference || reference.length > 140) fail('Choose a student admission number.', 400);
    const groups = await Promise.all(['AdmissionNo', 'admissionNo', 'AccountRef', 'accountRef'].map((field) =>
      querySchoolCollection(env, 'students', {
        filters: [{ field, op: '==', value: reference }], limit: 3,
        scope: { branchId: user.branchId, schoolSectionAccess: user.schoolSectionAccess }
      })));
    const student = billingPreviewStudent(groups.flat(), user, reference);
    return Response.json(await getStudentBillingPreview(env, student), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, message: error.message || 'Billing preview failed.' },
      { status: error.status || 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
