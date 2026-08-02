import {
  deleteSchoolDocument,
  listSchoolCollection,
  schoolSectionFor,
  upsertSchoolDocument
} from './school-scope.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const nowIso = () => new Date().toISOString();
const COLLECTION = 'studentConductCases';
const AUDIT_COLLECTION = 'studentConductAudit';

export const STUDENT_CONDUCT_CATEGORIES = Object.freeze([
  'Academic dishonesty',
  'Bullying or harassment',
  'Disobedience or insubordination',
  'Fighting or violence',
  'Property damage',
  'Theft',
  'Truancy or lateness',
  'Unsafe or prohibited item',
  'Digital or social-media misconduct',
  'Other misconduct'
]);

export const STUDENT_CONDUCT_STATUSES = Object.freeze([
  'Open',
  'Under Review',
  'Hearing Scheduled',
  'Action Assigned',
  'Resolved',
  'Closed'
]);

function error(message, status = 400) {
  const failure = new Error(message);
  failure.status = status;
  return failure;
}

function active(value) {
  return !['no', 'false', '0', 'inactive', 'disabled'].includes(lower(value));
}

export function studentConductCaseIsClosed(value = {}) {
  return lower(value && typeof value === 'object' ? value.Status : value) === 'closed';
}

function caseId(value = '') {
  const supplied = clean(value).replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 100);
  return supplied || `SCDC-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function capabilities(user = {}) {
  const edition = lower(user.edition || user.Edition || user.OrganisationEdition || user.OrganizationEdition) || 'school';
  const allowed = new Set((user.allowedSections || user.TabAccess || []).map(clean).filter(Boolean));
  const role = clean(user.role || user.Role);
  const permittedRoles = new Set(['Super Admin', 'Principal', 'Management', 'Admissions Officer', 'Student Welfare Officer']);
  return {
    enabled: edition === 'school' && (allowed.has('studentConduct') || permittedRoles.has(role)),
    canManage: edition === 'school' && permittedRoles.has(role),
    canDelete: edition === 'school' && role === 'Super Admin'
  };
}

function requireCapability(user, key) {
  const permissions = capabilities(user);
  if (permissions[key]) return permissions;
  throw error('This account is not permitted to manage student conduct cases.', 403);
}

function findStudent(students, reference) {
  const wanted = lower(reference);
  return students.find((row) => [
    row.AdmissionNo, row.AccountRef, row.ApplicationReference, row.__id
  ].some((value) => lower(value) === wanted));
}

export function normalizeStudentConductCase(input = {}, student = {}, existing = null) {
  const reference = clean(
    student.AdmissionNo || student.AccountRef || student.ApplicationReference
      || input.StudentRef || input.studentRef
  );
  const incidentDate = clean(input.IncidentDate || input.incidentDate);
  const category = clean(input.Category || input.category);
  const severity = clean(input.Severity || input.severity) || 'Moderate';
  const summary = clean(input.Summary || input.summary);
  const status = clean(input.Status || input.status) || 'Open';
  if (!reference) throw error('Choose the student involved in this conduct case.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(incidentDate)) throw error('Enter the incident date.');
  if (!STUDENT_CONDUCT_CATEGORIES.includes(category)) throw error('Choose a recognised conduct category.');
  if (!['Low', 'Moderate', 'High', 'Critical'].includes(severity)) throw error('Choose a valid severity.');
  if (!summary) throw error('Enter a concise summary of the incident.');
  if (!STUDENT_CONDUCT_STATUSES.includes(status)) throw error('Choose a valid case status.');
  const id = caseId(input.CaseId || input.caseId || existing?.CaseId);
  return {
    ...(existing || {}),
    CaseId: id,
    StudentRef: reference,
    StudentName: clean(student.DisplayName || student.ApplicantName || student.StudentName || input.StudentName || input.studentName),
    ClassName: clean(student.ClassName || input.ClassName || input.className),
    ClassArm: clean(student.ClassArm || input.ClassArm || input.classArm),
    IncidentDate: incidentDate,
    Category: category,
    Severity: severity,
    Summary: summary.slice(0, 240),
    Details: clean(input.Details || input.details).slice(0, 4000),
    ImmediateAction: clean(input.ImmediateAction || input.immediateAction).slice(0, 1000),
    Sanction: clean(input.Sanction || input.sanction).slice(0, 1000),
    HearingDate: clean(input.HearingDate || input.hearingDate),
    ParentNotified: active(input.ParentNotified ?? input.parentNotified ?? false),
    AssignedTo: clean(input.AssignedTo || input.assignedTo).slice(0, 160),
    Status: status,
    Resolution: clean(input.Resolution || input.resolution).slice(0, 2000),
    BranchId: clean(student.BranchId || input.BranchId || input.branchId || existing?.BranchId || 'main'),
    SchoolSection: schoolSectionFor(student || input),
    UpdatedAt: nowIso()
  };
}

function publicCase(row = {}) {
  return {
    CaseId: clean(row.CaseId || row.__id),
    StudentRef: clean(row.StudentRef),
    StudentName: clean(row.StudentName),
    ClassName: clean(row.ClassName),
    ClassArm: clean(row.ClassArm),
    IncidentDate: clean(row.IncidentDate),
    Category: clean(row.Category),
    Severity: clean(row.Severity),
    Summary: clean(row.Summary),
    Details: clean(row.Details),
    ImmediateAction: clean(row.ImmediateAction),
    Sanction: clean(row.Sanction),
    HearingDate: clean(row.HearingDate),
    ParentNotified: Boolean(row.ParentNotified),
    AssignedTo: clean(row.AssignedTo),
    Status: clean(row.Status),
    Resolution: clean(row.Resolution),
    ReportedBy: clean(row.ReportedBy),
    CreatedAt: clean(row.CreatedAt),
    UpdatedAt: clean(row.UpdatedAt),
    BranchId: clean(row.BranchId),
    SchoolSection: clean(row.SchoolSection)
  };
}

async function audit(env, user, action, conductCase) {
  const auditId = `SCDC-AUD-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  await upsertSchoolDocument(env, AUDIT_COLLECTION, auditId, {
    AuditId: auditId,
    CaseId: conductCase.CaseId,
    StudentRef: conductCase.StudentRef,
    Action: clean(action).toUpperCase(),
    Actor: clean(user.displayName || user.DisplayName || user.username || user.Username),
    ActorUsername: clean(user.username || user.Username),
    ActorRole: clean(user.role || user.Role),
    Timestamp: nowIso(),
    BranchId: conductCase.BranchId,
    SchoolSection: conductCase.SchoolSection
  });
}

async function listCases(env, user, body = {}) {
  requireCapability(user, 'enabled');
  const scope = {
    branchId: clean(user.branchId || user.BranchId || body.BranchId),
    schoolSectionAccess: clean(user.schoolSectionAccess || user.SchoolSectionAccess || body.SchoolSectionAccess)
  };
  const [cases, students] = await Promise.all([
    listSchoolCollection(env, COLLECTION, scope),
    listSchoolCollection(env, 'students', scope)
  ]);
  const ordered = cases.map(publicCase).sort((left, right) =>
    `${right.IncidentDate}|${right.UpdatedAt}`.localeCompare(`${left.IncidentDate}|${left.UpdatedAt}`)
  ).slice(0, 500);
  return {
    ok: true,
    message: `${ordered.length} conduct case${ordered.length === 1 ? '' : 's'} loaded.`,
    title: 'Student Conduct & Discipline Committee',
    categories: STUDENT_CONDUCT_CATEGORIES,
    statuses: STUDENT_CONDUCT_STATUSES,
    permissions: capabilities(user),
    summary: {
      Total: ordered.length,
      Open: ordered.filter((row) => !['resolved', 'closed'].includes(lower(row.Status))).length,
      UnderReview: ordered.filter((row) => ['under review', 'hearing scheduled'].includes(lower(row.Status))).length,
      HighPriority: ordered.filter((row) => ['high', 'critical'].includes(lower(row.Severity))).length,
      Resolved: ordered.filter((row) => ['resolved', 'closed'].includes(lower(row.Status))).length
    },
    cases: ordered,
    students: students.map((row) => ({
      StudentRef: clean(row.AdmissionNo || row.AccountRef || row.ApplicationReference || row.__id),
      StudentName: clean(row.DisplayName || row.ApplicantName || row.StudentName),
      ClassName: clean(row.ClassName),
      ClassArm: clean(row.ClassArm)
    })).filter((row) => row.StudentRef).sort((a, b) => a.StudentName.localeCompare(b.StudentName))
  };
}

async function saveCase(env, user, body = {}) {
  requireCapability(user, 'canManage');
  const scope = {
    branchId: clean(user.branchId || user.BranchId || body.BranchId),
    schoolSectionAccess: clean(user.schoolSectionAccess || user.SchoolSectionAccess || body.SchoolSectionAccess)
  };
  const [students, cases] = await Promise.all([
    listSchoolCollection(env, 'students', scope),
    listSchoolCollection(env, COLLECTION, scope)
  ]);
  const reference = clean(body.StudentRef || body.studentRef);
  const student = findStudent(students, reference);
  if (!student) throw error('The selected student was not found in your permitted school scope.', 404);
  const requestedId = clean(body.CaseId || body.caseId);
  const existing = requestedId
    ? cases.find((row) => lower(row.CaseId || row.__id) === lower(requestedId))
    : null;
  if (requestedId && !existing) {
    throw error('The conduct case was not found in your permitted school scope.', 404);
  }
  if (studentConductCaseIsClosed(existing)) {
    throw error('This conduct case is closed and cannot be edited.', 409);
  }
  const conductCase = normalizeStudentConductCase(body, student, existing);
  conductCase.ReportedBy = existing?.ReportedBy || clean(user.displayName || user.DisplayName || user.username || user.Username);
  conductCase.ReportedByUsername = existing?.ReportedByUsername || clean(user.username || user.Username);
  conductCase.CreatedAt = existing?.CreatedAt || nowIso();
  let saved;
  try {
    saved = await upsertSchoolDocument(
      env,
      COLLECTION,
      conductCase.CaseId,
      conductCase,
      existing ? { updateTime: clean(existing.__updateTime) } : { exists: false }
    );
  } catch (writeError) {
    if ([409, 412].includes(Number(writeError?.status))) {
      throw error('This conduct case changed while it was being edited. Reload the register before trying again.', 409);
    }
    throw writeError;
  }
  await audit(env, user, existing ? 'UPDATE' : 'CREATE', saved);
  return { ok: true, message: existing ? 'Conduct case updated.' : 'Conduct case recorded.', conductCase: publicCase(saved) };
}

async function deleteCase(env, user, body = {}) {
  requireCapability(user, 'canDelete');
  const id = clean(body.CaseId || body.caseId);
  if (!id) throw error('Choose a conduct case to delete.');
  const cases = await listSchoolCollection(env, COLLECTION, {
    branchId: clean(user.branchId || user.BranchId || body.BranchId),
    schoolSectionAccess: clean(user.schoolSectionAccess || user.SchoolSectionAccess)
  });
  const existing = cases.find((row) => lower(row.CaseId || row.__id) === lower(id));
  if (!existing) throw error('The conduct case was not found in your permitted school scope.', 404);
  await deleteSchoolDocument(env, COLLECTION, existing.__id || id, existing);
  await audit(env, user, 'DELETE', existing);
  return { ok: true, message: 'Conduct case deleted.' };
}

export async function handleStudentConductAction(env, user, body = {}) {
  const action = lower(body.action || body.Action || 'list');
  if (['list', 'getstudentconductcases'].includes(action)) return listCases(env, user, body);
  if (['save', 'savestudentconductcase'].includes(action)) return saveCase(env, user, body);
  if (['delete', 'deletestudentconductcase'].includes(action)) return deleteCase(env, user, body);
  throw error('Choose a valid student conduct action.');
}
