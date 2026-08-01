import { getDocument, listCollection, upsertDocument } from './firestore.js';
import {
  CHURCH_COLLECTIONS,
  churchCollectionPath,
  safeChurchDocumentId
} from './church-foundation.js';
import { resolveOrganizationConfig } from './organization-config.js';
import { resolveMembershipBranch } from './church-membership.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const nowIso = () => new Date().toISOString();
const inputError = (message) => {
  const error = new Error(message);
  error.status = 400;
  return error;
};

const VIEW_ROLES = new Set(['Super Admin', 'Pastor', 'Church Administrator', 'Membership Officer']);
const MANAGE_ROLES = new Set(['Super Admin', 'Pastor', 'Church Administrator']);

export function serviceCapabilities(user = {}) {
  const role = clean(user.role || user.Role);
  return {
    canView: VIEW_ROLES.has(role),
    canManageServices: MANAGE_ROLES.has(role),
    canManageOccurrences: MANAGE_ROLES.has(role),
    canRecordAttendance: VIEW_ROLES.has(role),
    canViewAudit: MANAGE_ROLES.has(role)
  };
}

export function normalizeChurchService(input = {}, branchId = 'main') {
  const serviceId = clean(input.ServiceId || input.serviceId);
  const name = clean(input.Name || input.name || input.ServiceName || input.serviceName);
  if (!serviceId) throw inputError('ServiceId is required.');
  if (!name) throw inputError('Service name is required.');
  return {
    ServiceId: serviceId,
    BranchId: resolveMembershipBranch({}, branchId),
    Name: name,
    Description: clean(input.Description || input.description),
    DayOfWeek: clean(input.DayOfWeek || input.dayOfWeek),
    StartTime: clean(input.StartTime || input.startTime),
    EndTime: clean(input.EndTime || input.endTime),
    Location: clean(input.Location || input.location),
    Ministry: clean(input.Ministry || input.ministry),
    Frequency: clean(input.Frequency || input.frequency) || 'Weekly',
    Active: ['no', 'false', '0', 'inactive'].includes(lower(input.Active ?? input.active ?? 'YES')) ? 'NO' : 'YES',
    Notes: clean(input.Notes || input.notes)
  };
}

export function normalizeServiceOccurrence(input = {}, branchId = 'main') {
  const occurrenceId = clean(input.OccurrenceId || input.occurrenceId);
  const serviceId = clean(input.ServiceId || input.serviceId);
  const date = clean(input.Date || input.date);
  if (!occurrenceId) throw inputError('OccurrenceId is required.');
  if (!serviceId) throw inputError('ServiceId is required.');
  const parsedDate = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
    throw inputError('Occurrence date must use a valid YYYY-MM-DD date.');
  }
  return {
    OccurrenceId: occurrenceId,
    ServiceId: serviceId,
    BranchId: resolveMembershipBranch({}, branchId),
    Date: date,
    StartTime: clean(input.StartTime || input.startTime),
    EndTime: clean(input.EndTime || input.endTime),
    Location: clean(input.Location || input.location),
    Theme: clean(input.Theme || input.theme),
    Minister: clean(input.Minister || input.minister),
    Status: clean(input.Status || input.status) || 'Scheduled',
    Notes: clean(input.Notes || input.notes)
  };
}

export function attendanceDocumentId(input = {}) {
  const occurrenceId = safeChurchDocumentId(input.OccurrenceId || input.occurrenceId);
  const memberId = safeChurchDocumentId(input.MemberId || input.memberId);
  if (occurrenceId && memberId) return safeChurchDocumentId(`${occurrenceId}--member--${memberId}`);
  return safeChurchDocumentId(input.AttendanceId || input.attendanceId);
}

export function normalizeAttendance(input = {}, branchId = 'main') {
  const occurrenceId = clean(input.OccurrenceId || input.occurrenceId);
  const memberId = clean(input.MemberId || input.memberId);
  const requestedType = lower(input.AttendanceType || input.attendanceType);
  const attendanceType = memberId ? 'Member' : 'Visitor';
  const displayName = clean(input.DisplayName || input.displayName || input.VisitorName || input.visitorName);
  const attendanceId = attendanceDocumentId(input) || (
    occurrenceId && attendanceType === 'Visitor'
      ? safeChurchDocumentId(`${occurrenceId}--visitor--${clean(input.VisitorReference || input.visitorReference)}`)
      : ''
  );
  if (!occurrenceId) throw inputError('OccurrenceId is required for attendance.');
  if (requestedType === 'member' && !memberId) throw inputError('MemberId is required for member attendance.');
  if (!attendanceId) throw inputError('AttendanceId or VisitorReference is required for a visitor.');
  if (!memberId && !displayName) throw inputError('Visitor name is required.');
  return {
    AttendanceId: attendanceId,
    OccurrenceId: occurrenceId,
    BranchId: resolveMembershipBranch({}, branchId),
    AttendanceType: memberId ? 'Member' : 'Visitor',
    MemberId: memberId,
    DisplayName: displayName,
    Phone: clean(input.Phone || input.phone),
    Email: lower(input.Email || input.email),
    FirstTimeVisitor: !memberId && ['yes', 'true', '1'].includes(lower(input.FirstTimeVisitor ?? input.firstTimeVisitor ?? false)),
    CheckInAt: clean(input.CheckInAt || input.checkInAt) || nowIso(),
    Status: clean(input.Status || input.status) || 'Present',
    Notes: clean(input.Notes || input.notes)
  };
}

export function normalizeAttendanceCount(value) {
  const raw = clean(value);
  if (!/^\d+$/.test(raw)) throw inputError('Number of attendance must be a whole number of zero or more.');
  const count = Number(raw);
  if (!Number.isSafeInteger(count) || count > 1000000) {
    throw inputError('Number of attendance must be between 0 and 1,000,000.');
  }
  return count;
}

export function attendanceSummary(occurrences = [], attendance = []) {
  const totals = new Map();
  for (const row of attendance) {
    const key = clean(row.OccurrenceId);
    if (!key) continue;
    const current = totals.get(key) || { TotalAttendance: 0, MemberAttendance: 0, VisitorAttendance: 0, FirstTimeVisitors: 0 };
    current.TotalAttendance += 1;
    if (clean(row.AttendanceType) === 'Member' || clean(row.MemberId)) current.MemberAttendance += 1;
    else current.VisitorAttendance += 1;
    if (row.FirstTimeVisitor === true || ['yes', 'true', '1'].includes(lower(row.FirstTimeVisitor))) current.FirstTimeVisitors += 1;
    totals.set(key, current);
  }
  return (occurrences || []).map((row) => {
    const counted = totals.get(clean(row.OccurrenceId)) || {
      TotalAttendance: 0, MemberAttendance: 0, VisitorAttendance: 0, FirstTimeVisitors: 0
    };
    const recordedTotal = /^\d+$/.test(clean(row.AttendanceCount)) ? Number(row.AttendanceCount) : null;
    return {
      ...row,
      ...counted,
      TotalAttendance: recordedTotal === null
        ? counted.TotalAttendance
        : Math.max(recordedTotal, counted.TotalAttendance)
    };
  });
}

function requireCapability(user, capability) {
  const capabilities = serviceCapabilities(user);
  if (!capabilities[capability]) {
    const error = new Error('This church role is not permitted to perform that service or attendance action.');
    error.status = 403;
    throw error;
  }
  return capabilities;
}

async function requireServicesEdition(env) {
  const [organizationProfile, legacyProfile] = await Promise.all([
    getDocument(env, 'settings', 'organisationProfile').catch(() => null),
    getDocument(env, 'settings', 'schoolProfile').catch(() => null)
  ]);
  const organization = resolveOrganizationConfig({ env, organizationProfile, legacyProfile });
  if (!['church', 'faith', 'organization'].includes(organization.Edition) || !organization.FeatureFlags.services) {
    const error = new Error('Church services are not enabled for this organisation.');
    error.status = 403;
    throw error;
  }
}

const actorName = (user = {}) => clean(user.displayName || user.DisplayName || user.username || user.Username || 'Unknown staff');

async function writeServiceAudit(env, branchId, user, action, entityType, entityId, details = '') {
  const auditId = `SVC-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  await upsertDocument(env, churchCollectionPath(CHURCH_COLLECTIONS.serviceAudit, branchId), auditId, {
    AuditId: auditId,
    Timestamp: nowIso(),
    Action: clean(action),
    EntityType: clean(entityType),
    EntityId: clean(entityId),
    BranchId: branchId,
    Actor: actorName(user),
    ActorUsername: clean(user.username || user.Username),
    ActorRole: clean(user.role || user.Role),
    Details: clean(details)
  });
}

export async function listChurchServices(env, user, body = {}) {
  await requireServicesEdition(env);
  const capabilities = requireCapability(user, 'canView');
  const branchId = resolveMembershipBranch(user, body.BranchId || body.branchId);
  const [services, occurrences, attendance, members, audit] = await Promise.all([
    listCollection(env, churchCollectionPath(CHURCH_COLLECTIONS.services, branchId)).catch(() => []),
    listCollection(env, churchCollectionPath(CHURCH_COLLECTIONS.serviceOccurrences, branchId)).catch(() => []),
    listCollection(env, churchCollectionPath(CHURCH_COLLECTIONS.attendance, branchId)).catch(() => []),
    listCollection(env, churchCollectionPath(CHURCH_COLLECTIONS.members, branchId)).catch(() => []),
    capabilities.canViewAudit
      ? listCollection(env, churchCollectionPath(CHURCH_COLLECTIONS.serviceAudit, branchId)).catch(() => [])
      : Promise.resolve([])
  ]);
  return {
    ok: true,
    branchId,
    capabilities,
    services: services.sort((a, b) => clean(a.Name).localeCompare(clean(b.Name))),
    occurrences: attendanceSummary(occurrences, attendance)
      .sort((a, b) => `${clean(b.Date)}|${clean(b.StartTime)}`.localeCompare(`${clean(a.Date)}|${clean(a.StartTime)}`)),
    attendance: attendance.sort((a, b) => clean(b.CheckInAt).localeCompare(clean(a.CheckInAt))),
    members: members.map((row) => ({
      MemberId: clean(row.MemberId || row.__id),
      DisplayName: clean(row.DisplayName),
      MembershipStatus: clean(row.MembershipStatus)
    })).sort((a, b) => a.DisplayName.localeCompare(b.DisplayName)),
    audit: audit.sort((a, b) => clean(b.Timestamp).localeCompare(clean(a.Timestamp))).slice(0, 100)
  };
}

export async function saveChurchService(env, user, body = {}) {
  await requireServicesEdition(env);
  requireCapability(user, 'canManageServices');
  const branchId = resolveMembershipBranch(user, body.BranchId || body.branchId);
  const service = normalizeChurchService(body.service || body.Service || body, branchId);
  const path = churchCollectionPath(CHURCH_COLLECTIONS.services, branchId);
  const id = safeChurchDocumentId(service.ServiceId);
  const existing = await getDocument(env, path, id).catch(() => null);
  const payload = {
    ...(existing || {}), ...service,
    CreatedAt: existing?.CreatedAt || nowIso(),
    CreatedBy: existing?.CreatedBy || actorName(user),
    UpdatedAt: nowIso(), UpdatedBy: actorName(user)
  };
  delete payload.__id; delete payload.__name;
  await upsertDocument(env, path, id, payload);
  await writeServiceAudit(env, branchId, user, existing ? 'UPDATE' : 'CREATE', 'Service', service.ServiceId, service.Name);
  return { ok: true, message: existing ? 'Service definition updated.' : 'Service definition created.', service: payload };
}

export async function saveServiceOccurrence(env, user, body = {}) {
  await requireServicesEdition(env);
  requireCapability(user, 'canManageOccurrences');
  const branchId = resolveMembershipBranch(user, body.BranchId || body.branchId);
  const occurrence = normalizeServiceOccurrence(body.occurrence || body.Occurrence || body, branchId);
  const service = await getDocument(
    env,
    churchCollectionPath(CHURCH_COLLECTIONS.services, branchId),
    safeChurchDocumentId(occurrence.ServiceId)
  ).catch(() => null);
  if (!service) throw inputError('The selected service does not exist in this branch.');
  if (clean(service.Active || 'YES') === 'NO') throw inputError('An occurrence cannot be created for an inactive service.');
  const path = churchCollectionPath(CHURCH_COLLECTIONS.serviceOccurrences, branchId);
  const id = safeChurchDocumentId(occurrence.OccurrenceId);
  const existing = await getDocument(env, path, id).catch(() => null);
  const payload = {
    ...(existing || {}), ...occurrence,
    ServiceName: clean(service.Name),
    CreatedAt: existing?.CreatedAt || nowIso(),
    CreatedBy: existing?.CreatedBy || actorName(user),
    UpdatedAt: nowIso(), UpdatedBy: actorName(user)
  };
  delete payload.__id; delete payload.__name;
  await upsertDocument(env, path, id, payload);
  await writeServiceAudit(env, branchId, user, existing ? 'UPDATE' : 'CREATE', 'Service Occurrence', occurrence.OccurrenceId, `${service.Name} | ${occurrence.Date}`);
  return { ok: true, message: existing ? 'Service occurrence updated.' : 'Service occurrence created.', occurrence: payload };
}

export async function recordChurchAttendance(env, user, body = {}) {
  await requireServicesEdition(env);
  requireCapability(user, 'canRecordAttendance');
  const branchId = resolveMembershipBranch(user, body.BranchId || body.branchId);
  const incoming = body.attendance || body.Attendance || body;
  const occurrence = await getDocument(
    env,
    churchCollectionPath(CHURCH_COLLECTIONS.serviceOccurrences, branchId),
    safeChurchDocumentId(incoming.OccurrenceId || incoming.occurrenceId)
  ).catch(() => null);
  if (!occurrence) throw inputError('The selected service occurrence does not exist in this branch.');
  if (lower(occurrence.Status) === 'cancelled') throw inputError('Attendance cannot be recorded for a cancelled occurrence.');
  let member = null;
  if (clean(incoming.MemberId || incoming.memberId)) {
    member = await getDocument(
      env,
      churchCollectionPath(CHURCH_COLLECTIONS.members, branchId),
      safeChurchDocumentId(incoming.MemberId || incoming.memberId)
    ).catch(() => null);
    if (!member) throw inputError('The selected member does not exist in this branch.');
  }
  const attendance = normalizeAttendance({
    ...incoming,
    DisplayName: member ? clean(member.DisplayName) : clean(incoming.DisplayName || incoming.VisitorName)
  }, branchId);
  const path = churchCollectionPath(CHURCH_COLLECTIONS.attendance, branchId);
  const id = safeChurchDocumentId(attendance.AttendanceId);
  const existing = await getDocument(env, path, id).catch(() => null);
  const payload = {
    ...(existing || {}), ...attendance,
    ServiceId: clean(occurrence.ServiceId),
    ServiceName: clean(occurrence.ServiceName),
    OccurrenceDate: clean(occurrence.Date),
    CreatedAt: existing?.CreatedAt || nowIso(),
    CreatedBy: existing?.CreatedBy || actorName(user),
    UpdatedAt: nowIso(), UpdatedBy: actorName(user)
  };
  delete payload.__id; delete payload.__name;
  await upsertDocument(env, path, id, payload);
  await writeServiceAudit(
    env, branchId, user, existing ? 'UPDATE CHECK-IN' : 'CHECK-IN',
    'Attendance', attendance.AttendanceId, `${attendance.DisplayName} | ${occurrence.ServiceName}`
  );
  return {
    ok: true,
    message: existing ? 'Attendance record updated; no duplicate was created.' : 'Attendance recorded.',
    attendance: payload
  };
}

export async function recordChurchAttendanceTotal(env, user, body = {}) {
  await requireServicesEdition(env);
  requireCapability(user, 'canRecordAttendance');
  const branchId = resolveMembershipBranch(user, body.BranchId || body.branchId);
  const incoming = body.attendance || body.Attendance || body;
  const occurrenceId = clean(incoming.OccurrenceId || incoming.occurrenceId);
  const path = churchCollectionPath(CHURCH_COLLECTIONS.serviceOccurrences, branchId);
  const id = safeChurchDocumentId(occurrenceId);
  if (!id) throw inputError('OccurrenceId is required for attendance.');
  const occurrence = await getDocument(env, path, id).catch(() => null);
  if (!occurrence) throw inputError('The selected service occurrence does not exist in this branch.');
  if (lower(occurrence.Status) === 'cancelled') throw inputError('Attendance cannot be recorded for a cancelled occurrence.');
  const attendanceCount = normalizeAttendanceCount(incoming.AttendanceCount ?? incoming.attendanceCount);
  const recordedAt = nowIso();
  const payload = {
    ...occurrence,
    AttendanceCount: attendanceCount,
    AttendanceCountRecordedAt: recordedAt,
    AttendanceCountRecordedBy: actorName(user),
    UpdatedAt: recordedAt,
    UpdatedBy: actorName(user)
  };
  delete payload.__id; delete payload.__name;
  await upsertDocument(env, path, id, payload);
  await writeServiceAudit(
    env, branchId, user, 'RECORD TOTAL', 'Attendance', occurrenceId,
    `${clean(occurrence.ServiceName || occurrence.ServiceId)} | ${attendanceCount} attendee(s)`
  );
  return {
    ok: true,
    message: `Attendance total recorded: ${attendanceCount}.`,
    occurrence: payload
  };
}

export async function handleChurchServiceAction(env, user, body = {}) {
  const action = lower(body.Action || body.action || 'list');
  if (['list', 'getchurchservices'].includes(action)) return listChurchServices(env, user, body);
  if (['saveservice', 'savechurchservice'].includes(action)) return saveChurchService(env, user, body);
  if (['saveoccurrence', 'savechurchserviceoccurrence'].includes(action)) return saveServiceOccurrence(env, user, body);
  if (['recordattendance', 'recordchurchattendance'].includes(action)) return recordChurchAttendance(env, user, body);
  if (['recordattendancetotal', 'recordchurchattendancetotal'].includes(action)) return recordChurchAttendanceTotal(env, user, body);
  throw inputError('Choose a valid church service or attendance action.');
}
