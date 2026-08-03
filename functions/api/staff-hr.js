import { getDocument, listCollection, requireFirestoreEnv, upsertDocument } from '../lib/firestore.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { readJsonBody } from '../lib/request-security.js';
import {
  hrCapabilitiesFor,
  normalizeHrEmployee,
  normalizeHrLeave,
  normalizeHrReview,
  normalizeHrTraining,
  normalizeHrVacancy,
  safeHrStaffUser
} from '../lib/human-resources.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const nowIso = () => new Date().toISOString();

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

function canUseHumanResources(user = {}) {
  return (user.allowedSections || []).includes('humanResources');
}

function assertCapability(capabilities, key, message) {
  if (!capabilities[key]) fail(message, 403);
}

async function assertLineManagerTarget(env, user, username) {
  if (clean(user.role || user.Role) !== 'Line Manager') return;
  const employee = await getDocument(env, 'hrEmployees', safeId(username)).catch(() => null);
  if (!employee || lower(employee.ManagerUsername) !== actorUsername(user)) {
    fail('Line managers may act only for staff who report directly to them.', 403);
  }
}

function sorted(rows, field = 'UpdatedAt') {
  return [...rows].sort((a, b) => clean(b[field]).localeCompare(clean(a[field])));
}

async function audit(env, user, action, reference, details = '') {
  const timestamp = nowIso();
  const id = safeId(`HR-${timestamp}-${crypto.randomUUID().slice(0, 8)}`);
  await upsertDocument(env, 'hrAudit', id, {
    AuditId: id,
    Timestamp: timestamp,
    Action: action,
    Reference: clean(reference),
    Details: clean(details),
    ActorUsername: actorUsername(user),
    Actor: actorName(user)
  });
}

async function listWorkspace(env, user) {
  const capabilities = hrCapabilitiesFor(user);
  const username = actorUsername(user);
  const [staffUsers, employees, leave, vacancies, reviews, training] = await Promise.all([
    listCollection(env, 'staffUsers'),
    listCollection(env, 'hrEmployees').catch(() => []),
    listCollection(env, 'hrLeaveRequests').catch(() => []),
    listCollection(env, 'hrVacancies').catch(() => []),
    listCollection(env, 'hrPerformanceReviews').catch(() => []),
    listCollection(env, 'hrTrainingRecords').catch(() => [])
  ]);
  const safeStaff = staffUsers.map(safeHrStaffUser).filter((row) => row.Username);
  const employeeByUsername = new Map(employees.map((row) => [lower(row.Username), row]));
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
    ? leave
    : ownOrTeam(leave);
  const visibleReviews = capabilities.canManagePerformance || capabilities.canSeeAllHrRecords
    ? reviews
    : ownOrTeam(reviews);
  const visibleTraining = capabilities.canManageTraining || capabilities.canSeeAllHrRecords
    ? training
    : ownOrTeam(training);
  return {
    ok: true,
    capabilities,
    roles: [...new Set(safeStaff.map((row) => row.Role).filter(Boolean))].sort(),
    directory: visibleDirectory.sort((a, b) => clean(a.DisplayName).localeCompare(clean(b.DisplayName))),
    leave: sorted(visibleLeave, 'SubmittedAt'),
    vacancies: capabilities.canManageRecruitment || capabilities.canSeeAllHrRecords ? sorted(vacancies, 'CreatedAt') : [],
    reviews: sorted(visibleReviews, 'ReviewedAt'),
    training: sorted(visibleTraining, 'UpdatedAt')
  };
}

async function saveEmployee(env, user, body, capabilities) {
  assertCapability(capabilities, 'canManagePeople', 'Your HR role cannot change staff employment records.');
  const username = lower(body.Username);
  const staffUsers = await listCollection(env, 'staffUsers');
  const staff = staffUsers.find((row) => lower(row.Username || row.__id) === username);
  if (!staff) fail('Choose an existing staff account.', 404);
  const id = safeId(username);
  const existing = await getDocument(env, 'hrEmployees', id).catch(() => null);
  const record = {
    ...(existing || {}),
    ...normalizeHrEmployee({
      ...body,
      DisplayName: clean(body.DisplayName || staff.DisplayName || username),
      Department: clean(body.Department || staff.Department)
    }, existing || {}),
    BranchId: clean(body.BranchId || staff.BranchId),
    UpdatedAt: nowIso(),
    UpdatedBy: actorName(user),
    CreatedAt: clean(existing?.CreatedAt) || nowIso(),
    CreatedBy: clean(existing?.CreatedBy) || actorName(user)
  };
  delete record.__id;
  delete record.__name;
  await upsertDocument(env, 'hrEmployees', id, record);
  await audit(env, user, existing ? 'UPDATE EMPLOYEE' : 'CREATE EMPLOYEE', username, record.Position);
  return { ok: true, message: 'Employment record saved.', employee: record };
}

async function saveLeave(env, user, body, capabilities) {
  const requestedUsername = lower(body.Username || actorUsername(user));
  if (requestedUsername !== actorUsername(user) && !capabilities.canManageLeave) {
    fail('You can submit leave only for your own staff account.', 403);
  }
  const id = safeId(clean(body.LeaveId) || `LEAVE-${Date.now()}-${requestedUsername}-${crypto.randomUUID().slice(0, 8)}`);
  const existing = clean(body.LeaveId) ? await getDocument(env, 'hrLeaveRequests', id).catch(() => null) : null;
  if (existing && lower(existing.Username) !== actorUsername(user) && !capabilities.canManageLeave) fail('This leave request is not available to you.', 403);
  if (existing && clean(existing.Status).toLowerCase() !== 'pending') fail('A reviewed leave request cannot be edited.', 409);
  const record = {
    ...(existing || {}),
    LeaveId: id,
    ...normalizeHrLeave({ ...body, Username: requestedUsername }, user, existing || {}),
    SubmittedAt: clean(existing?.SubmittedAt) || nowIso(),
    SubmittedBy: clean(existing?.SubmittedBy) || actorName(user),
    UpdatedAt: nowIso()
  };
  delete record.__id;
  delete record.__name;
  await upsertDocument(env, 'hrLeaveRequests', id, record,
    existing?.__updateTime ? { updateTime: existing.__updateTime } : { exists: false });
  await audit(env, user, existing ? 'UPDATE LEAVE' : 'SUBMIT LEAVE', id, `${record.Username} | ${record.Days} day(s)`);
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
  await assertLineManagerTarget(env, user, existing.Username);
  if (lower(existing.Username) === actorUsername(user)) fail('You cannot approve your own leave request.', 409);
  if (clean(existing.Status).toLowerCase() !== 'pending') fail('This leave request has already been reviewed.', 409);
  const record = {
    ...existing,
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
  await audit(env, user, `${decision.toUpperCase()} LEAVE`, id, record.Username);
  return { ok: true, message: `Leave request ${decision.toLowerCase()}.`, leave: record };
}

async function saveVacancy(env, user, body, capabilities) {
  assertCapability(capabilities, 'canManageRecruitment', 'Your HR role cannot manage recruitment.');
  const id = safeId(clean(body.VacancyId) || `VAC-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`);
  const existing = clean(body.VacancyId) ? await getDocument(env, 'hrVacancies', id).catch(() => null) : null;
  const record = {
    ...(existing || {}), VacancyId: id, ...normalizeHrVacancy(body, existing || {}),
    CreatedAt: clean(existing?.CreatedAt) || nowIso(),
    CreatedBy: clean(existing?.CreatedBy) || actorName(user),
    UpdatedAt: nowIso(), UpdatedBy: actorName(user)
  };
  delete record.__id;
  delete record.__name;
  await upsertDocument(env, 'hrVacancies', id, record);
  await audit(env, user, existing ? 'UPDATE VACANCY' : 'CREATE VACANCY', id, record.Title);
  return { ok: true, message: 'Vacancy saved.', vacancy: record };
}

async function saveReview(env, user, body, capabilities) {
  assertCapability(capabilities, 'canManagePerformance', 'Your HR role cannot record performance reviews.');
  if (lower(body.Username) === actorUsername(user)) fail('You cannot record your own performance review.', 409);
  await assertLineManagerTarget(env, user, body.Username);
  const id = safeId(clean(body.ReviewId) || `REVIEW-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`);
  const existing = clean(body.ReviewId) ? await getDocument(env, 'hrPerformanceReviews', id).catch(() => null) : null;
  const record = {
    ...(existing || {}), ReviewId: id, ...normalizeHrReview(body, existing || {}),
    ReviewedAt: nowIso(), ReviewedBy: actorName(user), ReviewedByUsername: actorUsername(user), UpdatedAt: nowIso()
  };
  delete record.__id;
  delete record.__name;
  await upsertDocument(env, 'hrPerformanceReviews', id, record);
  await audit(env, user, existing ? 'UPDATE REVIEW' : 'CREATE REVIEW', id, record.Username);
  return { ok: true, message: 'Performance review saved.', review: record };
}

async function saveTraining(env, user, body, capabilities) {
  assertCapability(capabilities, 'canManageTraining', 'Your HR role cannot manage training records.');
  const id = safeId(clean(body.TrainingId) || `TRAINING-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`);
  const existing = clean(body.TrainingId) ? await getDocument(env, 'hrTrainingRecords', id).catch(() => null) : null;
  const record = {
    ...(existing || {}), TrainingId: id, ...normalizeHrTraining(body, existing || {}),
    UpdatedAt: nowIso(), UpdatedBy: actorName(user), CreatedAt: clean(existing?.CreatedAt) || nowIso()
  };
  delete record.__id;
  delete record.__name;
  await upsertDocument(env, 'hrTrainingRecords', id, record);
  await audit(env, user, existing ? 'UPDATE TRAINING' : 'CREATE TRAINING', id, record.Username);
  return { ok: true, message: 'Training record saved.', training: record };
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
    else fail('Choose a valid Human Resources action.');
    return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return Response.json({ ok: false, message: error.message || String(error) }, {
      status: error.status || 500,
      headers: { 'Cache-Control': 'private, no-store' }
    });
  }
}
