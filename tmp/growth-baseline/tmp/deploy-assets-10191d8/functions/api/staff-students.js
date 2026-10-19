import { listCollection, requireFirestoreEnv } from '../lib/firestore.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { listSchoolCollection, schoolSectionFor, upsertSchoolDocument } from '../lib/school-scope.js';
import { canonicalConfiguredClass } from '../lib/class-names.js';

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
    const body = await request.json().catch(() => ({}));
    if (lower(body.action) !== 'update') {
      const err = new Error('Choose a valid student action.'); err.status = 400; throw err;
    }
    const accountRef = clean(body.AccountRef || body.accountRef || body.AdmissionNo);
    const rows = await listSchoolCollection(env, 'students');
    const existing = rows.find((row) => referenceMatches(row, accountRef) && visibleToUser(row, user));
    if (!existing) {
      const err = new Error('Student was not found in your current school section.'); err.status = 404; throw err;
    }
    const editableFields = [
      'DisplayName', 'ApplicantName', 'Surname', 'FirstName', 'MiddleName', 'Gender',
      'DateOfBirth', 'ClassName', 'ClassArm', 'StudentType', 'BillingCategory',
      'EnrollmentCategory', 'AcademicProgress', 'AcademicSession', 'Term', 'ParentName',
      'ParentPhone', 'ParentEmail', 'ResidentialAddress', 'CityArea', 'StateOfResidence',
      'BloodGroup', 'Genotype', 'MedicalCondition', 'EmergencyContactName',
      'EmergencyContactPhone', 'PreviousSchool', 'VerificationCode', 'ParentLoginCode',
      'WalletCardId', 'WalletCardStatus', 'Status', 'StatusReason', 'StatusEffectiveDate',
      'ExpectedReturnDate'
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
    const student = { ...saved };
    delete student.WalletPinHash;
    return Response.json({ ok: true, message: 'Student profile updated.', student });
  } catch (err) {
    return Response.json({ ok: false, message: err.message || String(err) }, { status: err.status || 500 });
  }
}
