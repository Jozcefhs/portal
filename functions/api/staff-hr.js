import { batchCommitDocuments, getDocument, listCollection, requireFirestoreEnv, upsertDocument } from '../lib/firestore.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { readJsonBody } from '../lib/request-security.js';
import { branchRecordVisible, enforceActorBranch, recordBranchId } from '../lib/branch-scope.js';
import { staffRecordMatchesEdition } from '../lib/records-desk.js';
import {
  hrCapabilitiesFor,
  normalizeHrCandidate,
  normalizeHrCompensationChange,
  normalizeHrCompliance,
  normalizeHrEmployee,
  normalizeHrEmployeeCase,
  normalizeHrEmploymentHistory,
  normalizeHrExit,
  normalizeHrLeave,
  normalizeHrReview,
  normalizeHrTimeRecord,
  normalizeHrTraining,
  normalizeHrVacancy,
  safeHrStaffUser
} from '../lib/human-resources.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const nowIso = () => new Date().toISOString();
const activeValue = (value) => !['no', 'false', '0', 'inactive', 'disabled'].includes(lower(value));

function safeId(value) {
  return lower(value).replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 140);
}

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function actorName(user = {}) {
  return clean(user.displayName || user.DisplayName || user.username || user.Username || 'Staff');
}

function actorUsername(user = {}) {
  return lower(user.username || user.Username);
}

function staffBranchMap(staffUsers = []) {
  return new Map(staffUsers.map((row) => [
    lower(row.Username || row.username || row.__id),
    recordBranchId(row)
  ]).filter(([username]) => username));
}

function inferredHrBranch(row = {}, staffBranches = new Map(), vacancyBranches = new Map()) {
  const explicit = clean(row.BranchId || row.branchId);
  if (explicit) return recordBranchId(row);
  const username = lower(row.Username || row.username);
  if (username && staffBranches.has(username)) return staffBranches.get(username);
  const vacancyId = lower(row.VacancyId || row.vacancyId);
  if (vacancyId && vacancyBranches.has(vacancyId)) return vacancyBranches.get(vacancyId);
  return 'main';
}

function visibleHrRows(rows, user, staffBranches, vacancyBranches = new Map()) {
  return (rows || []).filter((row) => branchRecordVisible(row, user, {
    inferredBranchId: inferredHrBranch(row, staffBranches, vacancyBranches)
  }));
}

function requireVisibleStaff(row, user) {
  if (row && staffRecordMatchesEdition(row, user) && branchRecordVisible(row, user)) return row;
  fail('Choose an existing staff account in your assigned branch.', 404);
}

function canUseHumanResources(user = {}) {
  return (user.allowedSections || []).includes('humanResources');
}

function assertCapability(capabilities, key, message) {
  if (!capabilities[key]) fail(message, 403);
}

async function assertLineManagerTarget(env, user, username, known = null) {
  const staff = known || await knownStaff(env, user, username);
  if (clean(user.role || user.Role) !== 'Line Manager') return staff;
  const employee = await getDocument(env, 'hrEmployees', safeId(username)).catch(() => null);
  if (!employee || !branchRecordVisible(employee, user, { inferredBranchId: recordBranchId(staff) }) ||
      lower(employee.ManagerUsername) !== actorUsername(user)) {
    fail('Line managers may act only for staff who report directly to them.', 403);
  }
  return staff;
}

function sorted(rows, field = 'UpdatedAt') {
  return [...rows].sort((a, b) => clean(b[field]).localeCompare(clean(a[field])));
}

async function audit(env, user, action, reference, details = '', branchId = '') {
  const timestamp = nowIso();
  const id = safeId(`HR-${timestamp}-${crypto.randomUUID().slice(0, 8)}`);
  await upsertDocument(env, 'hrAudit', id, {
    AuditId: id,
    Timestamp: timestamp,
    Action: action,
    Reference: clean(reference),
    Details: clean(details),
    ActorUsername: actorUsername(user),
    Actor: actorName(user),
    BranchId: enforceActorBranch(user, branchId, '', 'main')
  });
}

async function listWorkspace(env, user) {
  const capabilities = hrCapabilitiesFor(user);
  const username = actorUsername(user);
  const [staffUsers, employees, leave, vacancies, reviews, training, lifecycleRecords] = await Promise.all([
    listCollection(env, 'staffUsers'),
    listCollection(env, 'hrEmployees').catch(() => []),
    listCollection(env, 'hrLeaveRequests').catch(() => []),
    listCollection(env, 'hrVacancies').catch(() => []),
    listCollection(env, 'hrPerformanceReviews').catch(() => []),
    listCollection(env, 'hrTrainingRecords').catch(() => []),
    listCollection(env, 'hrLifecycleRecords').catch(() => [])
  ]);
  const editionStaff = staffUsers.filter((row) => staffRecordMatchesEdition(row, user));
  const staffBranches = staffBranchMap(editionStaff);
  const scopedVacancies = visibleHrRows(vacancies, user, staffBranches);
  const vacancyBranches = new Map(scopedVacancies.map((row) => [
    lower(row.VacancyId || row.__id),
    inferredHrBranch(row, staffBranches)
  ]));
  const scopedEmployees = visibleHrRows(employees, user, staffBranches);
  const scopedLeave = visibleHrRows(leave, user, staffBranches);
  const scopedReviews = visibleHrRows(reviews, user, staffBranches);
  const scopedTraining = visibleHrRows(training, user, staffBranches);
  const scopedLifecycle = visibleHrRows(lifecycleRecords, user, staffBranches, vacancyBranches);
  const lifecycle = (kind) => scopedLifecycle.filter((row) => clean(row.RecordKind) === kind);
  const candidates = lifecycle('Candidate');
  const employmentHistory = lifecycle('EmploymentHistory');
  const compensation = lifecycle('Compensation');
  const timeRecords = lifecycle('TimeRecord');
  const employeeCases = lifecycle('EmployeeCase');
  const compliance = lifecycle('Compliance');
  const exits = lifecycle('Exit');
  const safeStaff = editionStaff.filter((row) => branchRecordVisible(row, user))
    .map(safeHrStaffUser).filter((row) => row.Username);
  const employeeByUsername = new Map(scopedEmployees.map((row) => [lower(row.Username), row]));
  const directory = safeStaff.map((row) => ({ ...row, ...(employeeByUsername.get(lower(row.Username)) || {}) }));
  const role = clean(user.role || user.Role);
  const directReports = new Set(directory
    .filter((row) => lower(row.ManagerUsername) === username)
    .map((row) => lower(row.Username)));
  const ownOrTeam = (rows) => rows.filter((row) => lower(row.Username) === username || directReports.has(lower(row.Username)));
  const visibleDirectory = capabilities.canSeeAllHrRecords || (capabilities.canViewDirectory && role !== 'Line Manager')
    ? directory
    : role === 'Line Manager'
      ? directory.filter((row) => lower(row.Username) === username || directReports.has(lower(row.Username)))
      : directory.filter((row) => lower(row.Username) === username);
  const visibleLeave = capabilities.canManageLeave || capabilities.canSeeAllHrRecords
    ? scopedLeave
    : ownOrTeam(scopedLeave);
  const visibleReviews = capabilities.canManagePerformance || capabilities.canSeeAllHrRecords
    ? role === 'Line Manager' ? ownOrTeam(scopedReviews) : scopedReviews
    : ownOrTeam(scopedReviews);
  const visibleTraining = capabilities.canManageTraining || capabilities.canSeeAllHrRecords
    ? scopedTraining
    : ownOrTeam(scopedTraining);
  const visibleHistory = capabilities.canManageEmploymentHistory || capabilities.canSeeAllHrRecords
    ? employmentHistory
    : employmentHistory.filter((row) => lower(row.Username) === username);
  const visibleCompensation = capabilities.canManageCompensation || capabilities.canReviewCompensation || capabilities.canSeeAllHrRecords
    ? compensation
    : compensation.filter((row) => lower(row.Username) === username);
  const visibleTimeRecords = capabilities.canManageTime || capabilities.canSeeAllHrRecords
    ? role === 'Line Manager' ? ownOrTeam(timeRecords) : timeRecords
    : ownOrTeam(timeRecords);
  const visibleCases = capabilities.canManageRelations || capabilities.canManageDiscipline || capabilities.canSeeAllHrRecords
    ? employeeCases
    : [];
  const visibleExits = capabilities.canManageExit || capabilities.canSeeAllHrRecords
    ? exits
    : exits.filter((row) => lower(row.Username) === username);
  return {
    ok: true,
    capabilities,
    roles: [...new Set(safeStaff.map((row) => row.Role).filter(Boolean))].sort(),
    directory: visibleDirectory.sort((a, b) => clean(a.DisplayName).localeCompare(clean(b.DisplayName))),
    leave: sorted(visibleLeave, 'SubmittedAt'),
    vacancies: capabilities.canManageRecruitment || capabilities.canSeeAllHrRecords ? sorted(scopedVacancies, 'CreatedAt') : [],
    candidates: capabilities.canManageRecruitment || capabilities.canSeeAllHrRecords ? sorted(candidates, 'UpdatedAt') : [],
    reviews: sorted(visibleReviews, 'ReviewedAt'),
    training: sorted(visibleTraining, 'UpdatedAt'),
    employmentHistory: sorted(visibleHistory, 'EffectiveDate'),
    compensation: sorted(visibleCompensation, 'UpdatedAt'),
    timeRecords: sorted(visibleTimeRecords, 'WorkDate'),
    employeeCases: sorted(visibleCases, 'OpenedDate'),
    compliance: capabilities.canManageCompliance || capabilities.canSeeAllHrRecords ? sorted(compliance, 'DueDate') : [],
    exits: sorted(visibleExits, 'LastWorkingDate')
  };
}

async function knownStaff(env, user, username) {
  const id = lower(username);
  const rows = await listCollection(env, 'staffUsers');
  const staff = rows.find((row) => lower(row.Username || row.__id) === id);
  requireVisibleStaff(staff, user);
  return safeHrStaffUser(staff);
}

async function saveManagedRecord(env, user, body, capabilities, options) {
  assertCapability(capabilities, options.capability, options.deniedMessage);
  const id = safeId(clean(body[options.idField]) || `${options.prefix}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`);
  const existing = clean(body[options.idField]) ? await getDocument(env, options.collection, id).catch(() => null) : null;
  if (existing && clean(existing.RecordKind) && clean(existing.RecordKind) !== options.recordKind) {
    fail('This HR record belongs to a different workflow.', 409);
  }
  let incoming = body;
  let targetStaff = null;
  if (options.staffTarget) {
    targetStaff = await knownStaff(env, user, body.Username || existing?.Username);
    if (options.lineManagerTarget) await assertLineManagerTarget(env, user, targetStaff.Username, targetStaff);
    incoming = { ...body, Username: targetStaff.Username, DisplayName: clean(body.DisplayName || targetStaff.DisplayName) };
  }
  const branchId = enforceActorBranch(
    user,
    body.BranchId || body.branchId,
    existing
      ? recordBranchId(existing, clean(targetStaff?.BranchId) || 'main')
      : clean(targetStaff?.BranchId),
    clean(targetStaff?.BranchId) || 'main'
  );
  const record = {
    ...(existing || {}),
    [options.idField]: id,
    RecordKind: options.recordKind,
    ...options.normalize(incoming, existing || {}),
    BranchId: branchId,
    CreatedAt: clean(existing?.CreatedAt) || nowIso(),
    CreatedBy: clean(existing?.CreatedBy) || actorName(user),
    CreatedByUsername: clean(existing?.CreatedByUsername) || actorUsername(user),
    UpdatedAt: nowIso(),
    UpdatedBy: actorName(user),
    UpdatedByUsername: actorUsername(user)
  };
  delete record.__id;
  delete record.__name;
  delete record.__createTime;
  delete record.__updateTime;
  await upsertDocument(env, options.collection, id, record,
    existing?.__updateTime ? { updateTime: existing.__updateTime } : { exists: false });
  await audit(env, user, existing ? `UPDATE ${options.auditLabel}` : `CREATE ${options.auditLabel}`, id, clean(record.Username || record.CandidateName || record.Obligation), branchId);
  return { ok: true, message: options.message, record };
}

async function saveEmployee(env, user, body, capabilities) {
  assertCapability(capabilities, 'canManagePeople', 'Your HR role cannot change staff employment records.');
  const username = lower(body.Username);
  const staff = await knownStaff(env, user, username);
  const id = safeId(username);
  const existing = await getDocument(env, 'hrEmployees', id).catch(() => null);
  const branchId = enforceActorBranch(
    user,
    body.BranchId || body.branchId,
    clean(existing?.BranchId || existing?.branchId || staff.BranchId),
    clean(staff.BranchId) || 'main'
  );
  const record = {
    ...(existing || {}),
    ...normalizeHrEmployee({
      ...body,
      DisplayName: clean(body.DisplayName || staff.DisplayName || username),
      Department: clean(body.Department || staff.Department)
    }, existing || {}),
    BranchId: branchId,
    UpdatedAt: nowIso(),
    UpdatedBy: actorName(user),
    CreatedAt: clean(existing?.CreatedAt) || nowIso(),
    CreatedBy: clean(existing?.CreatedBy) || actorName(user)
  };
  delete record.__id;
  delete record.__name;
  delete record.__createTime;
  delete record.__updateTime;
  await upsertDocument(env, 'hrEmployees', id, record);
  await audit(env, user, existing ? 'UPDATE EMPLOYEE' : 'CREATE EMPLOYEE', username, record.Position, branchId);
  return { ok: true, message: 'Employment record saved.', employee: record };
}

async function saveLeave(env, user, body, capabilities) {
  const requestedUsername = lower(body.Username || actorUsername(user));
  if (requestedUsername !== actorUsername(user) && !capabilities.canManageLeave) {
    fail('You can submit leave only for your own staff account.', 403);
  }
  const id = safeId(clean(body.LeaveId) || `LEAVE-${Date.now()}-${requestedUsername}-${crypto.randomUUID().slice(0, 8)}`);
  const existing = clean(body.LeaveId) ? await getDocument(env, 'hrLeaveRequests', id).catch(() => null) : null;
  const staff = await knownStaff(env, user, requestedUsername);
  const branchId = enforceActorBranch(
    user,
    body.BranchId || body.branchId,
    clean(existing?.BranchId || existing?.branchId || staff.BranchId),
    clean(staff.BranchId) || 'main'
  );
  if (existing && lower(existing.Username) !== actorUsername(user) && !capabilities.canManageLeave) fail('This leave request is not available to you.', 403);
  if (existing && clean(existing.Status).toLowerCase() !== 'pending') fail('A reviewed leave request cannot be edited.', 409);
  const record = {
    ...(existing || {}),
    LeaveId: id,
    ...normalizeHrLeave({ ...body, Username: requestedUsername }, user, existing || {}),
    BranchId: branchId,
    SubmittedAt: clean(existing?.SubmittedAt) || nowIso(),
    SubmittedBy: clean(existing?.SubmittedBy) || actorName(user),
    UpdatedAt: nowIso()
  };
  delete record.__id;
  delete record.__name;
  await upsertDocument(env, 'hrLeaveRequests', id, record,
    existing?.__updateTime ? { updateTime: existing.__updateTime } : { exists: false });
  await audit(env, user, existing ? 'UPDATE LEAVE' : 'SUBMIT LEAVE', id, `${record.Username} | ${record.Days} day(s)`, branchId);
  return { ok: true, message: 'Leave request submitted.', leave: record };
}

async function reviewLeave(env, user, body, capabilities) {
  assertCapability(capabilities, 'canApproveLeave', 'Your role cannot approve or decline leave.');
  const id = safeId(body.LeaveId);
  const decision = clean(body.Decision || body.Status);
  if (!id) fail('Choose a leave request.');
  if (!['Approved', 'Declined'].includes(decision)) fail('Choose Approve or Decline.');
  const existing = await getDocument(env, 'hrLeaveRequests', id).catch(() => null);
  if (!existing) fail('Leave request was not found.', 404);
  const staff = await knownStaff(env, user, existing.Username);
  const branchId = enforceActorBranch(user, '', clean(existing.BranchId || staff.BranchId), clean(staff.BranchId) || 'main');
  await assertLineManagerTarget(env, user, existing.Username);
  if (lower(existing.Username) === actorUsername(user)) fail('You cannot approve your own leave request.', 409);
  if (clean(existing.Status).toLowerCase() !== 'pending') fail('This leave request has already been reviewed.', 409);
  const record = {
    ...existing,
    BranchId: branchId,
    Status: decision,
    ReviewNotes: clean(body.ReviewNotes),
    ReviewedAt: nowIso(),
    ReviewedBy: actorName(user),
    ReviewedByUsername: actorUsername(user),
    UpdatedAt: nowIso()
  };
  delete record.__id;
  delete record.__name;
  await upsertDocument(env, 'hrLeaveRequests', id, record, { updateTime: existing.__updateTime });
  await audit(env, user, `${decision.toUpperCase()} LEAVE`, id, record.Username, branchId);
  return { ok: true, message: `Leave request ${decision.toLowerCase()}.`, leave: record };
}

async function saveVacancy(env, user, body, capabilities) {
  assertCapability(capabilities, 'canManageRecruitment', 'Your HR role cannot manage recruitment.');
  const id = safeId(clean(body.VacancyId) || `VAC-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`);
  const existing = clean(body.VacancyId) ? await getDocument(env, 'hrVacancies', id).catch(() => null) : null;
  const branchId = enforceActorBranch(
    user,
    body.BranchId || body.branchId,
    existing ? recordBranchId(existing) : '',
    'main'
  );
  const record = {
    ...(existing || {}), VacancyId: id, ...normalizeHrVacancy(body, existing || {}),
    BranchId: branchId,
    CreatedAt: clean(existing?.CreatedAt) || nowIso(),
    CreatedBy: clean(existing?.CreatedBy) || actorName(user),
    UpdatedAt: nowIso(), UpdatedBy: actorName(user)
  };
  delete record.__id;
  delete record.__name;
  await upsertDocument(env, 'hrVacancies', id, record);
  await audit(env, user, existing ? 'UPDATE VACANCY' : 'CREATE VACANCY', id, record.Title, branchId);
  return { ok: true, message: 'Vacancy saved.', vacancy: record };
}

async function saveReview(env, user, body, capabilities) {
  assertCapability(capabilities, 'canManagePerformance', 'Your HR role cannot record performance reviews.');
  if (lower(body.Username) === actorUsername(user)) fail('You cannot record your own performance review.', 409);
  const staff = await assertLineManagerTarget(env, user, body.Username);
  const id = safeId(clean(body.ReviewId) || `REVIEW-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`);
  const existing = clean(body.ReviewId) ? await getDocument(env, 'hrPerformanceReviews', id).catch(() => null) : null;
  const branchId = enforceActorBranch(user, body.BranchId || body.branchId, clean(existing?.BranchId || staff.BranchId), clean(staff.BranchId) || 'main');
  const record = {
    ...(existing || {}), ReviewId: id, ...normalizeHrReview(body, existing || {}),
    BranchId: branchId,
    ReviewedAt: nowIso(), ReviewedBy: actorName(user), ReviewedByUsername: actorUsername(user), UpdatedAt: nowIso()
  };
  delete record.__id;
  delete record.__name;
  await upsertDocument(env, 'hrPerformanceReviews', id, record);
  await audit(env, user, existing ? 'UPDATE REVIEW' : 'CREATE REVIEW', id, record.Username, branchId);
  return { ok: true, message: 'Performance review saved.', review: record };
}

async function saveTraining(env, user, body, capabilities) {
  assertCapability(capabilities, 'canManageTraining', 'Your HR role cannot manage training records.');
  const id = safeId(clean(body.TrainingId) || `TRAINING-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`);
  const existing = clean(body.TrainingId) ? await getDocument(env, 'hrTrainingRecords', id).catch(() => null) : null;
  const staff = await knownStaff(env, user, body.Username || existing?.Username);
  const branchId = enforceActorBranch(user, body.BranchId || body.branchId, clean(existing?.BranchId || staff.BranchId), clean(staff.BranchId) || 'main');
  const record = {
    ...(existing || {}), TrainingId: id, ...normalizeHrTraining(body, existing || {}),
    BranchId: branchId,
    UpdatedAt: nowIso(), UpdatedBy: actorName(user), CreatedAt: clean(existing?.CreatedAt) || nowIso()
  };
  delete record.__id;
  delete record.__name;
  await upsertDocument(env, 'hrTrainingRecords', id, record);
  await audit(env, user, existing ? 'UPDATE TRAINING' : 'CREATE TRAINING', id, record.Username, branchId);
  return { ok: true, message: 'Training record saved.', training: record };
}

async function saveCandidate(env, user, body, capabilities) {
  const vacancy = await getDocument(env, 'hrVacancies', safeId(body.VacancyId)).catch(() => null);
  if (!vacancy) fail('Choose an existing vacancy before adding a candidate.', 404);
  if (!branchRecordVisible(vacancy, user)) fail('Choose a vacancy in your assigned branch.', 404);
  return saveManagedRecord(env, user, { ...body, BranchId: recordBranchId(vacancy) }, capabilities, {
    capability: 'canManageRecruitment', deniedMessage: 'Your HR role cannot manage recruitment candidates.',
    collection: 'hrLifecycleRecords', recordKind: 'Candidate', idField: 'CandidateId', prefix: 'CANDIDATE', normalize: normalizeHrCandidate,
    auditLabel: 'CANDIDATE', message: 'Candidate record saved.'
  });
}

async function saveEmploymentHistory(env, user, body, capabilities) {
  return saveManagedRecord(env, user, body, capabilities, {
    capability: 'canManageEmploymentHistory', deniedMessage: 'Your HR role cannot manage employment history or document references.',
    collection: 'hrLifecycleRecords', recordKind: 'EmploymentHistory', idField: 'HistoryId', prefix: 'HISTORY', normalize: normalizeHrEmploymentHistory,
    auditLabel: 'EMPLOYMENT HISTORY', message: 'Employment history record saved.', staffTarget: true
  });
}

async function saveCompensation(env, user, body, capabilities) {
  if (clean(body.CompensationId)) {
    const existing = await getDocument(env, 'hrLifecycleRecords', safeId(body.CompensationId)).catch(() => null);
    if (existing && lower(existing.Status) !== 'pending') fail('A reviewed pay or benefit change cannot be edited.', 409);
  }
  return saveManagedRecord(env, user, body, capabilities, {
    capability: 'canManageCompensation', deniedMessage: 'Your HR role cannot submit pay or benefit changes.',
    collection: 'hrLifecycleRecords', recordKind: 'Compensation', idField: 'CompensationId', prefix: 'COMP', normalize: normalizeHrCompensationChange,
    auditLabel: 'COMPENSATION CHANGE', message: 'Pay or benefit change sent for review.', staffTarget: true
  });
}

async function reviewCompensation(env, user, body, capabilities) {
  assertCapability(capabilities, 'canReviewCompensation', 'Your role cannot review pay or benefit changes.');
  const id = safeId(body.CompensationId);
  const decision = clean(body.Decision);
  if (!id) fail('Choose a pay or benefit change.');
  if (!['Approved', 'Declined', 'Implemented'].includes(decision)) fail('Choose Approve, Decline or Implemented.');
  const existing = await getDocument(env, 'hrLifecycleRecords', id).catch(() => null);
  if (!existing) fail('The pay or benefit change was not found.', 404);
  if (clean(existing.RecordKind) !== 'Compensation') fail('This is not a pay or benefit change.', 409);
  const staff = await knownStaff(env, user, existing.Username);
  const branchId = enforceActorBranch(user, '', clean(existing.BranchId || staff.BranchId), clean(staff.BranchId) || 'main');
  if (lower(existing.CreatedByUsername) === actorUsername(user) && decision === 'Approved') fail('You cannot approve a pay or benefit change that you created.', 409);
  const currentStatus = clean(existing.Status || 'Pending');
  const validTransition = (currentStatus === 'Pending' && ['Approved', 'Declined'].includes(decision))
    || (currentStatus === 'Approved' && decision === 'Implemented');
  if (!validTransition) fail(`A ${currentStatus.toLowerCase()} pay or benefit change cannot be marked ${decision.toLowerCase()}.`, 409);
  const record = {
    ...existing, Status: decision, ReviewNotes: clean(body.ReviewNotes), ReviewedAt: nowIso(),
    ReviewedBy: actorName(user), ReviewedByUsername: actorUsername(user), BranchId: branchId, UpdatedAt: nowIso()
  };
  delete record.__id;
  delete record.__name;
  delete record.__createTime;
  delete record.__updateTime;
  await upsertDocument(env, 'hrLifecycleRecords', id, record, { updateTime: existing.__updateTime });
  await audit(env, user, `${decision.toUpperCase()} COMPENSATION CHANGE`, id, record.Username, branchId);
  return { ok: true, message: `Pay or benefit change marked ${decision.toLowerCase()}.`, record };
}

async function saveTimeRecord(env, user, body, capabilities) {
  return saveManagedRecord(env, user, body, capabilities, {
    capability: 'canManageTime', deniedMessage: 'Your HR role cannot manage schedules, lateness or absence records.',
    collection: 'hrLifecycleRecords', recordKind: 'TimeRecord', idField: 'TimeRecordId', prefix: 'TIME', normalize: normalizeHrTimeRecord,
    auditLabel: 'TIME RECORD', message: 'Attendance or schedule record saved.', staffTarget: true, lineManagerTarget: true
  });
}

async function saveEmployeeCase(env, user, body, capabilities) {
  const existing = clean(body.CaseId) ? await getDocument(env, 'hrLifecycleRecords', safeId(body.CaseId)).catch(() => null) : null;
  const caseType = clean(body.CaseType || existing?.CaseType);
  const capability = ['Misconduct', 'Disciplinary action'].includes(caseType) ? 'canManageDiscipline' : 'canManageRelations';
  return saveManagedRecord(env, user, body, capabilities, {
    capability, deniedMessage: 'Your HR role cannot manage this employee relations or conduct case.',
    collection: 'hrLifecycleRecords', recordKind: 'EmployeeCase', idField: 'CaseId', prefix: 'CASE', normalize: normalizeHrEmployeeCase,
    auditLabel: 'EMPLOYEE CASE', message: 'Employee relations or conduct case saved.', staffTarget: true
  });
}

async function saveCompliance(env, user, body, capabilities) {
  return saveManagedRecord(env, user, body, capabilities, {
    capability: 'canManageCompliance', deniedMessage: 'Your HR role cannot manage the compliance register.',
    collection: 'hrLifecycleRecords', recordKind: 'Compliance', idField: 'ComplianceId', prefix: 'COMPLIANCE', normalize: normalizeHrCompliance,
    auditLabel: 'COMPLIANCE ITEM', message: 'Compliance item saved.'
  });
}

async function saveExit(env, user, body, capabilities) {
  assertCapability(capabilities, 'canManageExit', 'Your HR role cannot manage employee exits.');
  const existingExit = clean(body.ExitId) ? await getDocument(env, 'hrLifecycleRecords', safeId(body.ExitId)).catch(() => null) : null;
  if (existingExit && clean(existingExit.RecordKind) && clean(existingExit.RecordKind) !== 'Exit') {
    fail('This HR record belongs to a different workflow.', 409);
  }
  const alreadyCompleted = lower(existingExit?.Status) === 'completed';
  if (alreadyCompleted && clean(body.Status) && lower(body.Status) !== 'completed') {
    fail('A completed employee exit cannot be changed or reopened.', 409);
  }
  const completingExit = alreadyCompleted || lower(body.Status || existingExit?.Status) === 'completed';
  if (!completingExit) {
    return saveManagedRecord(env, user, body, capabilities, {
      capability: 'canManageExit', deniedMessage: 'Your HR role cannot manage employee exits.',
      collection: 'hrLifecycleRecords', recordKind: 'Exit', idField: 'ExitId', prefix: 'EXIT', normalize: normalizeHrExit,
      auditLabel: 'EMPLOYEE EXIT', message: 'Employee exit record saved.', staffTarget: true
    });
  }

  // Completing an exit changes three security-sensitive records. Keep them in one
  // Firestore commit so a quota or network failure cannot leave a completed exit
  // attached to an active login. Re-running a previously completed exit repairs
  // legacy partial saves without allowing the HR details to be edited.
  const timestamp = nowIso();
  const exitId = safeId(clean(existingExit?.ExitId || body.ExitId) || `EXIT-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`);
  const targetUsername = lower(existingExit?.Username || body.Username);
  if (!targetUsername) fail('Choose an existing staff account.', 404);
  let targetStaff = null;
  const staffUsers = await listCollection(env, 'staffUsers');
  targetStaff = staffUsers.find((row) => lower(row.Username || row.__id) === targetUsername);
  requireVisibleStaff(targetStaff, user);
  const branchId = enforceActorBranch(
    user,
    body.BranchId || body.branchId,
    clean(existingExit?.BranchId || targetStaff.BranchId),
    clean(targetStaff.BranchId) || 'main'
  );
  const targetIsActive = targetStaff.Active === undefined || activeValue(targetStaff.Active);
  if (targetIsActive && clean(targetStaff.Role) === 'Super Admin') {
    const otherActiveAdmins = staffUsers.filter((row) =>
      lower(row.Username || row.__id) !== targetUsername &&
      staffRecordMatchesEdition(row, user) &&
      recordBranchId(row) === branchId &&
      clean(row.Role) === 'Super Admin' &&
      (row.Active === undefined || activeValue(row.Active)));
    if (!otherActiveAdmins.length) fail('At least one active Super Admin must remain. Assign another Super Admin before completing this exit.', 409);
  }

  const stripMetadata = (value = {}) => {
    const record = { ...value };
    delete record.__id;
    delete record.__name;
    delete record.__createTime;
    delete record.__updateTime;
    return record;
  };
  const record = alreadyCompleted
    ? stripMetadata(existingExit)
    : {
        ExitId: exitId,
        RecordKind: 'Exit',
        ...normalizeHrExit({
          ...body,
          Username: targetUsername,
          DisplayName: clean(body.DisplayName || targetStaff.DisplayName || targetUsername),
          Status: 'Completed'
        }, existingExit || {}),
        CreatedAt: clean(existingExit?.CreatedAt) || timestamp,
        CreatedBy: clean(existingExit?.CreatedBy) || actorName(user),
        CreatedByUsername: clean(existingExit?.CreatedByUsername) || actorUsername(user),
        UpdatedAt: timestamp,
        UpdatedBy: actorName(user),
        UpdatedByUsername: actorUsername(user)
      };
  record.ExitId = exitId;
  record.RecordKind = 'Exit';
  record.BranchId = branchId;
  record.Status = 'Completed';
  record.AccountDeactivated = true;
  record.AccessSyncStatus = 'Completed';
  record.AccessSyncedAt = timestamp;
  record.AccessSyncedBy = actorName(user);

  const employeeId = safeId(targetUsername);
  const employee = await getDocument(env, 'hrEmployees', employeeId).catch(() => null);
  const auditId = safeId(`HR-${timestamp}-${crypto.randomUUID().slice(0, 8)}`);
  const writes = [{
    collectionPath: 'hrLifecycleRecords', documentId: exitId, data: record,
    ...(existingExit?.__updateTime ? { updateTime: existingExit.__updateTime } : { exists: false })
  }, {
    collectionPath: 'hrAudit', documentId: auditId, exists: false, data: {
      AuditId: auditId,
      Timestamp: timestamp,
      Action: alreadyCompleted ? 'REPAIR COMPLETED EMPLOYEE EXIT' : 'COMPLETE EMPLOYEE EXIT',
      Reference: exitId,
      Details: targetUsername,
      ActorUsername: actorUsername(user),
      Actor: actorName(user),
      BranchId: branchId
    }
  }];
  if (targetIsActive) {
    const updatedStaff = stripMetadata({
      ...targetStaff,
      Active: false,
      DeactivatedAt: timestamp,
      DeactivatedBy: actorName(user),
      DeactivationReason: `Completed HR exit: ${record.ExitType}`,
      UpdatedAt: timestamp,
      UpdatedBy: actorName(user)
    });
    writes.push({
      collectionPath: 'staffUsers', documentId: targetStaff.__id || employeeId, data: updatedStaff,
      ...(targetStaff.__updateTime ? { updateTime: targetStaff.__updateTime } : {})
    });
    const securityAuditId = safeId(`STAFF-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`);
    writes.push({
      collectionPath: 'staffSecurityAudit', documentId: securityAuditId, exists: false, data: {
        AuditId: securityAuditId,
        Timestamp: timestamp,
        Action: 'DEACTIVATE USER',
        Username: targetUsername,
        Details: `Automatically deactivated after completed ${clean(record.ExitType).toLowerCase()} exit.`,
        Actor: actorName(user),
        ActorUsername: actorUsername(user),
        BranchId: branchId,
        SourcePlatform: 'Web HR'
      }
    });
  }
  if (employee) {
    writes.push({
      collectionPath: 'hrEmployees', documentId: employeeId,
      data: stripMetadata({
        ...employee,
        BranchId: branchId,
        Status: 'Exited',
        ExitDate: record.LastWorkingDate,
        UpdatedAt: timestamp,
        UpdatedBy: actorName(user)
      }),
      ...(employee.__updateTime ? { updateTime: employee.__updateTime } : {})
    });
  }
  await batchCommitDocuments(env, writes);
  return {
    ok: true,
    message: targetIsActive
      ? 'Employee exit completed and staff account deactivated.'
      : 'Employee exit verified; the staff account is disabled.',
    record
  };
}

export async function onRequestPost(context) {
  try {
    requireFirestoreEnv(context.env);
    const user = await requireStaffSession(context.env, context.request);
    if (!canUseHumanResources(user)) fail('Human Resources is not available to this account.', 403);
    const body = await readJsonBody(context.request, { maxBytes: 256 * 1024 });
    const action = lower(body.action || 'list');
    const capabilities = hrCapabilitiesFor(user);
    let result;
    if (action === 'list') result = await listWorkspace(context.env, user);
    else if (action === 'saveemployee') result = await saveEmployee(context.env, user, body, capabilities);
    else if (action === 'saveleave') result = await saveLeave(context.env, user, body, capabilities);
    else if (action === 'reviewleave') result = await reviewLeave(context.env, user, body, capabilities);
    else if (action === 'savevacancy') result = await saveVacancy(context.env, user, body, capabilities);
    else if (action === 'savereview') result = await saveReview(context.env, user, body, capabilities);
    else if (action === 'savetraining') result = await saveTraining(context.env, user, body, capabilities);
    else if (action === 'savecandidate') result = await saveCandidate(context.env, user, body, capabilities);
    else if (action === 'saveemploymenthistory') result = await saveEmploymentHistory(context.env, user, body, capabilities);
    else if (action === 'savecompensation') result = await saveCompensation(context.env, user, body, capabilities);
    else if (action === 'reviewcompensation') result = await reviewCompensation(context.env, user, body, capabilities);
    else if (action === 'savetimerecord') result = await saveTimeRecord(context.env, user, body, capabilities);
    else if (action === 'saveemployeecase') result = await saveEmployeeCase(context.env, user, body, capabilities);
    else if (action === 'savecompliance') result = await saveCompliance(context.env, user, body, capabilities);
    else if (action === 'saveexit') result = await saveExit(context.env, user, body, capabilities);
    else fail('Choose a valid Human Resources action.');
    return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return Response.json({ ok: false, message: error.message || String(error) }, {
      status: error.status || 500,
      headers: { 'Cache-Control': 'private, no-store' }
    });
  }
}
