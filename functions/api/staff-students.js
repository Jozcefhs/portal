import { listCollection, patchDocumentFieldsIfCurrent, requireFirestoreEnv } from '../lib/firestore.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { listSchoolCollection, schoolSectionFor, upsertSchoolDocument } from '../lib/school-scope.js';
import { canonicalConfiguredClass } from '../lib/class-names.js';
import { readJsonBody } from '../lib/request-security.js';
import { saveStudentLoginPassword } from '../lib/student-login-credentials.js';
import { gradeSevenIntakeFingerprint, gradeSevenIntakePlan } from '../lib/student-intake-bulk.js';

function clean(value) { return String(value ?? '').trim(); }
function lower(value) { return clean(value).toLowerCase(); }

function visibleToUser(row, user) {
  const section = lower(user.schoolSectionAccess || 'All');
  const branch = lower(user.branchId || '');
  return (section === 'all' || schoolSectionFor(row) === section) && (!branch || lower(row.BranchId || 'main') === branch);
}

function referenceMatches(row, value) {
  const wanted = lower(value);
  return wanted && [row.AdmissionNo, row.AccountRef, row.__id].some((candidate) => lower(candidate) === wanted);
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    if (!(user.allowedSections || []).includes('students')) {
      const err = new Error('This staff account is not allowed to manage students.'); err.status = 403; throw err;
    }
    const body = await readJsonBody(request, { maxBytes: 256 * 1024 });
    const action = lower(body.action);
    if (!['update', 'reissueparentonboarding', 'previewgrade7intake', 'applygrade7intake'].includes(action)) {
      const err = new Error('Choose a valid student action.'); err.status = 400; throw err;
    }
    if (['previewgrade7intake', 'applygrade7intake'].includes(action)) {
      if (user.role !== 'Super Admin' || user.edition !== 'school' || !clean(user.branchId) ||
          lower(user.schoolSectionAccess) === 'primary') {
        const err = new Error('Select a school branch and use a Super Admin account to correct Grade 7 intake.');
        err.status = 403;
        throw err;
      }
      const rows = await listSchoolCollection(env, 'students', {
        branchId: user.branchId,
        schoolSectionAccess: 'secondary'
      });
      const plan = gradeSevenIntakePlan(rows, {
        branchId: user.branchId,
        academicSession: body.AcademicSession
      });
      const previewToken = await gradeSevenIntakeFingerprint(plan);
      const summary = {
        ok: true,
        branchId: plan.branchId,
        academicSession: plan.academicSession,
        total: plan.total,
        alreadyNew: plan.alreadyNew,
        toChange: plan.toChange.length,
        excludedOtherSession: plan.excludedOtherSession,
        missingRevision: plan.missingRevision,
        previewToken
      };
      if (action === 'previewgrade7intake') return Response.json(summary);
      if (!plan.total || !plan.toChange.length) {
        return Response.json({ ...summary, updated: 0, remaining: 0 });
      }
      if (clean(body.PreviewToken) !== previewToken) {
        const err = new Error('Grade 7 records changed after preview. Review the count again before applying.');
        err.status = 409;
        throw err;
      }
      if (plan.missingRevision) {
        const err = new Error('Some Grade 7 records lack a database revision. No changes were made.');
        err.status = 409;
        throw err;
      }
      const now = new Date().toISOString();
      const next = plan.toChange.slice(0, 10);
      const outcomes = await Promise.allSettled(next.map((row) => patchDocumentFieldsIfCurrent(
        env,
        row.__scopePath,
        clean(row.__id || row.AdmissionNo || row.AccountRef),
        {
          EnrollmentCategory: 'New Intake',
          UpdatedAt: now,
          UpdatedBy: clean(user.displayName || user.username) || 'Super Admin'
        },
        row
      )));
      const updated = outcomes.filter((result) => result.status === 'fulfilled').length;
      const failed = outcomes.length - updated;
      return Response.json({
        ...summary,
        updated,
        failed,
        remaining: plan.toChange.length - updated,
        message: failed
          ? `${updated} record(s) updated; ${failed} failed. Review the live count before continuing.`
          : `${updated} Grade 7 record(s) marked New Intake.`
      });
    }
    const accountRef = clean(body.AccountRef || body.accountRef || body.AdmissionNo);
    const rows = await listSchoolCollection(env, 'students', {
      branchId: user.branchId,
      schoolSectionAccess: user.schoolSectionAccess
    });
    const existing = rows.find((row) => referenceMatches(row, accountRef) && visibleToUser(row, user));
    if (!existing) {
      const err = new Error('Student was not found in your current school section.'); err.status = 404; throw err;
    }
    if (action === 'reissueparentonboarding') {
      const now = new Date().toISOString();
      const documentId = clean(existing.__id || existing.AdmissionNo || existing.AccountRef);
      const saved = await upsertSchoolDocument(env, 'students', documentId, {
        ...existing,
        ParentOnboardingTokenHash: '',
        ParentOnboardingStatus: 'PendingProfile',
        ProfileCompletionStatus: 'Needs completion',
        ParentOnboardingReissuedAt: now,
        UpdatedAt: now,
        UpdatedBy: user.displayName || user.username
      });
      return Response.json({
        ok: true,
        message: 'Parent onboarding is ready. The shared link is available to copy.',
        onboardingPath: '/parent-dashboard#onboarding=1',
        admissionNo: clean(saved.AdmissionNo || saved.__id),
        temporaryPassword: '12345678'
      });
    }
    const editableFields = [
      'DisplayName', 'ApplicantName', 'Surname', 'FirstName', 'MiddleName', 'Gender',
      'DateOfBirth', 'ClassName', 'ClassArm', 'StudentType', 'BillingCategory',
      'EnrollmentCategory', 'AcademicProgress', 'AcademicSession', 'Term', 'ParentName',
      'ParentPhone', 'ParentEmail', 'ResidentialAddress', 'CityArea', 'StateOfResidence',
      'BloodGroup', 'Genotype', 'MedicalCondition', 'EmergencyContactName',
      'EmergencyContactPhone', 'PreviousSchool', 'VerificationCode', 'ParentLoginCode',
      'WalletCardId', 'WalletCardStatus', 'Status', 'StatusReason', 'StatusEffectiveDate',
      'ExpectedReturnDate', 'ProfileCompletionStatus'
    ];
    const updated = { ...existing };
    editableFields.forEach((field) => {
      if (body[field] !== undefined) updated[field] = clean(body[field]);
    });
    if (body.ClassName !== undefined) {
      const configuredClasses = await listCollection(env, 'settings/academics/classes').catch(() => []);
      updated.ClassName = canonicalConfiguredClass(body.ClassName, configuredClasses);
      updated.ClassAdmitted = updated.ClassName;
    }
    if (body.ParentEmail !== undefined) updated.ParentEmail = lower(body.ParentEmail);
    if (body.ParentLoginCode !== undefined || body.VerificationCode !== undefined) {
      const code = clean(body.ParentLoginCode ?? body.VerificationCode).toUpperCase();
      updated.ParentLoginCode = code;
      updated.VerificationCode = code;
    }
    if (body.DisplayName !== undefined) updated.ApplicantName = clean(body.DisplayName);
    updated.UpdatedAt = new Date().toISOString();
    updated.UpdatedBy = user.displayName || user.username;
    const documentId = clean(existing.__id || existing.AdmissionNo || existing.AccountRef);
    const saved = await upsertSchoolDocument(env, 'students', documentId, updated);
    const studentPassword = String(body.StudentLoginPassword || '');
    let loginStatus = null;
    if (studentPassword) {
      loginStatus = await saveStudentLoginPassword(
        env,
        saved,
        studentPassword,
        user.displayName || user.username
      );
    }
    const student = { ...saved };
    delete student.WalletPinHash;
    return Response.json({
      ok: true,
      message: studentPassword ? 'Student profile and personal login password updated.' : 'Student profile updated.',
      student,
      loginStatus
    });
  } catch (err) {
    return Response.json({ ok: false, message: err.message || String(err) }, { status: err.status || 500 });
  }
}
