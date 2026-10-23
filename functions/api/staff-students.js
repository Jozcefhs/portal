import { batchCommitDocuments, listCollection, requireFirestoreEnv } from '../lib/firestore.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { listSchoolCollection, schoolSectionFor, upsertSchoolDocument } from '../lib/school-scope.js';
import { canonicalConfiguredClass } from '../lib/class-names.js';
import { readJsonBody } from '../lib/request-security.js';
import { saveStudentLoginPassword } from '../lib/student-login-credentials.js';
import { admissionYearIntakeFingerprint, admissionYearIntakePlan } from '../lib/student-intake-bulk.js';
import { studentProfileDefaultsPlan, studentProfileDefaultsFingerprint } from '../lib/student-profile-defaults.js';
import { studentWalletProfile } from '../lib/student-wallet-profile.js';
import { academicWebActor, saveStudentProfileAcademicPlacement, studentProfilePlacementChanged } from '../lib/academic-management.js';

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
    if (['previewgrade7intake', 'applygrade7intake'].includes(action)) {
      const err = new Error('Reload Students to review the new admission-year intake rule across all classes. No records were changed.'); err.status = 409; throw err;
    }
    if (!['update', 'reissueparentonboarding', 'previewintakecorrection', 'applyintakecorrection', 'previewprofiledefaults', 'applyprofiledefaults'].includes(action)) {
      const err = new Error('Choose a valid student action.'); err.status = 400; throw err;
    }
    if (['previewprofiledefaults', 'applyprofiledefaults'].includes(action)) {
      if (user.role !== 'Super Admin' || user.edition !== 'school' || !clean(user.branchId) ||
        !(user.allowedSections || []).includes('accounts') || user.subscriptionReadOnly) {
        const err = new Error('Select a school branch and use a writable Super Admin account with Students and Accounts access.'); err.status = 403; throw err;
      }
      const scope = { branchId: user.branchId, schoolSectionAccess: user.schoolSectionAccess };
      const rows = (await listSchoolCollection(env, 'students', scope)).filter((row) => visibleToUser(row, user));
      const plan = studentProfileDefaultsPlan(rows);
      const previewToken = await studentProfileDefaultsFingerprint(plan, scope);
      const summary = { ok: true, total: plan.total, remaining: plan.changes.length,
        billingCategory: plan.billingCategory, academicProgress: plan.academicProgress, previewToken, branchId: user.branchId };
      if (action === 'previewprofiledefaults' || !plan.changes.length) return Response.json(summary, { headers: { 'Cache-Control': 'no-store' } });
      if (clean(body.PreviewToken) !== previewToken) {
        const err = new Error('Profiles changed after preview. Review the defaults again; no records were changed.'); err.status = 409; throw err;
      }
      const next = plan.changes.slice(0, 100);
      const timestamp = new Date().toISOString();
      const writes = next.flatMap(({ row, patch }) => {
        if (!row.__id || !row.__updateTime || !row.__scopePath) { const err = new Error('A profile lacks its database revision. No records were changed.'); err.status = 409; throw err; }
        const auditId = crypto.randomUUID();
        return [{ collectionPath: row.__scopePath, documentId: row.__id, updateTime: row.__updateTime,
          updateMask: [...Object.keys(patch), 'ProfileDefaultsSavedAt', 'ProfileDefaultsSavedBy'],
          data: { ...patch, ProfileDefaultsSavedAt: timestamp, ProfileDefaultsSavedBy: user.username } },
          { collectionPath: 'staffRecordsAudit', documentId: auditId, exists: false, data: {
            AuditId: auditId, Timestamp: timestamp, Action: 'SAVE MISSING STUDENT PROFILE DEFAULTS',
            EntityType: 'Student profile', EntityId: clean(row.AdmissionNo || row.AccountRef || row.__id),
            BranchId: user.branchId, ActorUsername: user.username, UserName: user.displayName || user.username,
            UserRole: user.role, SourcePlatform: 'Web', ScopePath: row.__scopePath,
            Before: Object.fromEntries(Object.keys(patch).map((field) => [field, row[field] ?? null])), After: patch,
            Details: 'Missing defaults saved. Existing classifications and all financial records preserved.'
          } }];
      });
      await batchCommitDocuments(env, writes);
      return Response.json({ ...summary, updated: next.length, remaining: plan.changes.length - next.length }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (['previewintakecorrection', 'applyintakecorrection'].includes(action)) {
      if (user.role !== 'Super Admin' || user.edition !== 'school' || !clean(user.branchId) ||
          ['all', '*'].includes(lower(user.branchId)) ||
          !(user.allowedSections || []).includes('accounts') || user.subscriptionReadOnly) {
        const err = new Error('Select a school branch and use a writable Super Admin account with Students and Accounts access to correct intake.');
        err.status = 403;
        throw err;
      }
      const rows = (await listSchoolCollection(env, 'students', {
        branchId: user.branchId,
        schoolSectionAccess: user.schoolSectionAccess
      })).filter((row) => visibleToUser(row, user));
      const plan = admissionYearIntakePlan(rows, {
        branchId: user.branchId,
        academicSession: body.AcademicSession,
        schoolSectionAccess: user.schoolSectionAccess || 'All'
      });
      const previewToken = await admissionYearIntakeFingerprint(plan);
      const summary = {
        ok: true,
        branchId: plan.branchId,
        academicSession: plan.academicSession,
        term: plan.term,
        admissionYear: plan.admissionYear,
        schoolSectionAccess: plan.schoolSectionAccess,
        total: plan.total,
        alreadyNew: plan.alreadyNew,
        toChange: plan.toChange.length,
        excludedOtherSession: plan.excludedOtherSession,
        excludedOtherTerm: plan.excludedOtherTerm,
        excludedAdmissionYear: plan.excludedAdmissionYear,
        unrecognizedAdmissionNumbers: plan.unrecognizedAdmissionNumbers,
        excludedInactive: plan.excludedInactive,
        missingRevision: plan.missingRevision,
        previewToken
      };
      const noStore = { headers: { 'Cache-Control': 'no-store' } };
      if (action === 'previewintakecorrection') return Response.json(summary, noStore);
      if (!plan.total || !plan.toChange.length) {
        return Response.json({ ...summary, updated: 0, remaining: 0 }, noStore);
      }
      if (clean(body.PreviewToken) !== previewToken) {
        const err = new Error('Student records changed after preview. Review intake again before applying; no records were changed.');
        err.status = 409;
        throw err;
      }
      if (plan.missingRevision) {
        const err = new Error('Some student records lack a database revision. No changes were made.');
        err.status = 409;
        throw err;
      }
      const now = new Date().toISOString();
      const next = plan.toChange.slice(0, 100);
      const writes = next.flatMap((row) => {
        const auditId = crypto.randomUUID();
        const patch = { EnrollmentCategory: 'New Intake', IntakeCorrectedAt: now, IntakeCorrectedBy: user.username };
        return [{ collectionPath: row.__scopePath, documentId: row.__id, updateTime: row.__updateTime,
          updateMask: Object.keys(patch), data: patch },
          { collectionPath: 'staffRecordsAudit', documentId: auditId, exists: false, data: {
            AuditId: auditId, Timestamp: now, Action: 'CORRECT STUDENT INTAKE BY ADMISSION YEAR',
            EntityType: 'Student profile', EntityId: clean(row.AdmissionNo || row.AccountRef || row.__id),
            BranchId: plan.branchId, SchoolSection: schoolSectionFor(row), ActorUsername: user.username,
            UserName: user.displayName || user.username, UserRole: user.role, SourcePlatform: 'Web', ScopePath: row.__scopePath,
            AcademicSession: plan.academicSession, Term: plan.term,
            Before: { EnrollmentCategory: row.EnrollmentCategory || row.enrollmentCategory || '' },
            After: { EnrollmentCategory: 'New Intake' },
            Summary: `${user.displayName || user.username} marked ${clean(row.AdmissionNo || row.AccountRef)} (${clean(row.ClassName || row.ClassAdmitted)}) as New Intake for First Term ${plan.academicSession} because the admission year matches the session start year. Existing invoices and payments were not changed.`,
            Details: `Enrollment category changed from ${clean(row.EnrollmentCategory || row.enrollmentCategory) || 'not set'} to New Intake. Academic progress and other classifications were preserved.`
          } }];
      });
      // Commit the classification and its audit together, with a revision guard
      // on every profile. A stale record aborts this whole batch.
      await batchCommitDocuments(env, writes);
      const updated = next.length;
      return Response.json({
        ...summary,
        updated,
        remaining: plan.toChange.length - updated,
        message: `${updated} student record(s) marked New Intake for First Term ${plan.academicSession}. Existing invoices and payments were not changed.`
      }, noStore);
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
    // An old/cached profile form may submit its empty "Select" placeholder.
    // Do not let an unrelated profile edit clear a saved wallet restriction.
    if (body.WalletCardStatus !== undefined && !clean(body.WalletCardStatus)) {
      updated.WalletCardStatus = studentWalletProfile(existing).WalletCardStatus;
    }
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
    const studentPassword = String(body.StudentLoginPassword || '');
    if (studentPassword && studentPassword.length < 6) {
      throw Object.assign(new Error('The student password must be at least 6 characters.'), { status: 400 });
    }
    if (clean(body.RevisionToken) && clean(body.RevisionToken) !== clean(existing.__updateTime)) {
      throw Object.assign(new Error('This student changed after you opened the profile. Refresh the student register and reopen the profile before saving.'), { status: 409 });
    }
    const placement = lower(user.edition) === 'school' && studentProfilePlacementChanged(existing, updated)
      ? await saveStudentProfileAcademicPlacement(env, academicWebActor(user), existing, updated, body.RevisionToken)
      : null;
    const saved = placement?.student || await upsertSchoolDocument(env, 'students', documentId, updated,
      existing.__updateTime ? { updateTime: existing.__updateTime } : {});
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
      message: placement ? `${placement.message}${studentPassword ? ' Personal login password updated.' : ''}`
        : studentPassword ? 'Student profile and personal login password updated.' : 'Student profile updated.',
      academicPlacementUpdated: Boolean(placement) && !placement.pendingApproval,
      pendingApproval: placement?.pendingApproval === true,
      student,
      loginStatus
    });
  } catch (err) {
    return Response.json({ ok: false, message: err.message || String(err), code: err.code || '' }, { status: err.status || 500 });
  }
}
