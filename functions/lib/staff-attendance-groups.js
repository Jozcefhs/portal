import { batchCommitLiteralDocuments, listCollection } from './firestore.js';
import { requiredDeploymentIdentity } from './deployment-identity.js';
import { canonicalRecordEdition, staffRecordMatchesEdition } from './records-desk.js';
import {
  getStaffAttendanceDocument,
  resolveStaffAttendanceBranch,
  staffAttendanceCollectionPath
} from './staff-attendance-storage.js';
import { normalizeAttendanceGroup } from './staff-attendance-schedules.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const GROUP_LIMIT = 50;
const ASSIGNMENT_LIMIT = 1000;
const ASSIGNMENT_HISTORY_LIMIT = 3000;
const GROUP_HISTORY_LIMIT = 128;
const PAYLOAD_LIMIT = 128 * 1024;
const MANAGE_ROLES = new Set(['Super Admin', 'HR Director', 'HR Manager', 'HR Business Partner', 'HR Officer']);

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

export function canManageAttendanceGroups(user = {}) {
  const role = clean(user.role || user.Role);
  const edition = canonicalRecordEdition(user.edition || user.Edition || user.OrganisationEdition);
  return MANAGE_ROLES.has(role)
    || (edition === 'school' && role === 'ICT')
    || (edition === 'faith' && role === 'Church Administrator')
    || (edition === 'organization' && ['Executive Director', 'Organisation Administrator'].includes(role));
}

function boundedPayload(value) {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > PAYLOAD_LIMIT) {
    fail('The attendance group settings are too large. Reduce the number of groups or staff assignments.', 413);
  }
}

function managementContext(env, user, body, branchId) {
  const identity = requiredDeploymentIdentity(env);
  const actorEdition = canonicalRecordEdition(user.edition || user.Edition || user.OrganisationEdition);
  if (actorEdition && actorEdition !== identity.edition) fail('This staff account belongs to another organisation edition.', 403);
  const actor = { ...user, edition: identity.edition };
  if (actor.subscriptionReadOnly) fail('The subscription is read-only. Attendance group changes are disabled.', 403);
  if (!canManageAttendanceGroups(actor)) fail('Only organisation or HR attendance administrators can manage attendance groups.', 403);
  if (['no', 'false', '0', 'inactive', 'disabled'].includes(lower(user.Active ?? user.active))) {
    fail('This staff account is not active.', 403);
  }
  boundedPayload(body);
  return { actor, branch: resolveStaffAttendanceBranch(actor, branchId) };
}

function rosterData(stored) {
  if (!stored) return { Revision: '', Groups: [], Assignments: [] };
  if (!clean(stored.Revision) || !Array.isArray(stored.Groups) || !Array.isArray(stored.Assignments)) {
    fail('The saved attendance roster is invalid. Ask an administrator to review it before making changes.', 409);
  }
  return {
    Revision: clean(stored.Revision),
    Groups: stored.Groups,
    Assignments: stored.Assignments,
    UpdatedAt: clean(stored.UpdatedAt),
    UpdatedBy: clean(stored.UpdatedBy)
  };
}

export async function loadAttendanceRoster(env, branchId) {
  return rosterData(await getStaffAttendanceDocument(env, 'policy', branchId, 'roster'));
}

async function currentRoster(env, body, branchId) {
  const stored = await getStaffAttendanceDocument(env, 'policy', branchId, 'roster');
  const roster = rosterData(stored);
  if (clean(body.ExpectedRevision) !== roster.Revision) {
    fail('The attendance groups changed after this page was loaded. Refresh and try again.', 409);
  }
  if (stored && !clean(stored.__updateTime)) fail('The current attendance roster version is unavailable. Refresh and try again.', 409);
  return { stored, roster };
}

function localToday(basePolicy = {}) {
  const timeZone = clean(basePolicy.TimeZone) || 'Africa/Lagos';
  let parts;
  try {
    parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date()).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  } catch {
    fail('The attendance policy time zone is invalid. Correct the branch policy before configuring groups.');
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function commitRoster(env, actor, branchId, current, changes, action, detail = {}) {
  const timestamp = new Date().toISOString();
  const username = lower(actor.username || actor.Username);
  if (!username) fail('A verified staff identity is required to change attendance groups.', 403);
  const roster = {
    Revision: crypto.randomUUID(),
    Groups: changes.Groups ?? current.roster.Groups,
    Assignments: changes.Assignments ?? current.roster.Assignments,
    UpdatedAt: timestamp,
    UpdatedBy: username
  };
  if (roster.Groups.length > GROUP_LIMIT) fail(`A branch can have at most ${GROUP_LIMIT} attendance groups.`);
  if (new Set(roster.Assignments.map((row) => lower(row.Username))).size > ASSIGNMENT_LIMIT) {
    fail(`A branch can assign at most ${ASSIGNMENT_LIMIT} staff members to attendance groups.`);
  }
  if (roster.Assignments.length > ASSIGNMENT_HISTORY_LIMIT) {
    fail('The attendance assignment history limit has been reached. Ask support to archive older history safely before making more changes.', 409);
  }
  boundedPayload(roster);
  const canonicalPath = staffAttendanceCollectionPath(env, 'policy', branchId);
  const canonical = current.stored && !current.stored.__legacyStorage;
  const writes = [{
    collectionPath: canonicalPath,
    documentId: 'roster',
    data: roster,
    ...(canonical ? { updateTime: current.stored.__updateTime } : { exists: false })
  }];
  // A compatible legacy roster is copied forward only if its source has not
  // changed; the masked write keeps every other historical legacy field intact.
  if (current.stored?.__legacyStorage) {
    writes.push({
      collectionPath: current.stored.__storagePath,
      documentId: clean(current.stored.__id) || 'roster',
      data: { Revision: current.roster.Revision },
      updateMask: ['Revision'],
      updateTime: current.stored.__updateTime
    });
  }
  writes.push({
    collectionPath: staffAttendanceCollectionPath(env, 'audit', branchId),
    documentId: `ROSTER-${roster.Revision}`,
    data: { Action: action, BranchId: branchId, Username: username, Timestamp: timestamp,
      PreviousRevision: current.roster.Revision, Revision: roster.Revision, ...detail },
    exists: false
  });
  try {
    await batchCommitLiteralDocuments(env, writes);
  } catch (error) {
    if ([409, 412].includes(Number(error?.status)) || error?.code === 'FIRESTORE_WRITE_CONFLICT') {
      fail('The attendance groups changed while saving. Refresh and try again; no changes were applied.', 409);
    }
    throw error;
  }
  return roster;
}

export async function saveAttendanceGroup(env, user, body = {}, branchId = 'main', basePolicy = {}) {
  const { actor, branch } = managementContext(env, user, body, branchId);
  if (!body.Group || typeof body.Group !== 'object' || Array.isArray(body.Group)) fail('Enter an attendance group.');
  const current = await currentRoster(env, body, branch);
  const requestedId = clean(body.Group.GroupId);
  const existing = requestedId ? current.roster.Groups.find((row) => clean(row.GroupId) === requestedId) : null;
  if (requestedId && !existing) fail('The attendance group no longer exists. Refresh and try again.', 404);
  const today = localToday(basePolicy);
  const group = normalizeAttendanceGroup({
    ...body.Group,
    GroupId: existing?.GroupId || crypto.randomUUID(),
    EffectiveFrom: today
  }, existing || {}, basePolicy);
  if (current.roster.Groups.some((row) => row.GroupId !== group.GroupId && lower(row.Name) === lower(group.Name))) {
    fail('An attendance group with this name already exists. Choose a different name.');
  }
  const scheduleFields = ['ScheduleType', 'DaySchedules', 'AnchorDate', 'CycleDays',
    'GraceMinutes', 'ClockInOpenMinutesBefore', 'OvertimeMinimumMinutes'];
  const scheduleChanged = !existing || scheduleFields.some((key) => JSON.stringify(group[key]) !== JSON.stringify(existing[key]));
  if (existing?.History !== undefined && !Array.isArray(existing.History)) {
    fail('The saved group schedule history is invalid. Ask an administrator to review it before making changes.', 409);
  }
  // Only server-loaded definitions may enter history. Flat, effective-dated
  // versions let absence checks resolve a prior shift even if nobody clocked in.
  const history = (existing?.History || []).map((row) => normalizeAttendanceGroup(row, {}, basePolicy));
  if (existing && scheduleChanged && clean(existing.EffectiveFrom) < today) {
    history.push(normalizeAttendanceGroup(existing, {}, basePolicy));
  }
  if (history.length > GROUP_HISTORY_LIMIT) {
    fail('The attendance group schedule history limit has been reached. Ask support to archive older history safely before changing this schedule.', 409);
  }
  const timestamp = new Date().toISOString();
  const saved = { ...group, GroupId: existing?.GroupId || group.GroupId,
    EffectiveFrom: scheduleChanged ? today : existing.EffectiveFrom,
    History: history,
    CreatedAt: existing?.CreatedAt || timestamp, UpdatedAt: timestamp,
    UpdatedBy: lower(actor.username || actor.Username) };
  const groups = current.roster.Groups.filter((row) => row.GroupId !== saved.GroupId).concat(saved);
  const roster = await commitRoster(env, actor, branch, current, { Groups: groups }, 'SAVE_ATTENDANCE_GROUP', {
    GroupId: saved.GroupId, GroupName: saved.Name
  });
  return { ok: true, message: 'Attendance group saved. Existing attendance records were not changed.', roster };
}

export function attendanceHrRecordMatchesScope(row = {}, staffUsers = [], actor = {}, branchId = 'main') {
  if (lower(row.BranchId || row.branchId || 'main') !== lower(branchId)) return false;
  const editionLabel = clean(row.Edition || row.edition || row.OrganisationEdition || row.organisationEdition
    || row.OrganizationEdition || row.organizationEdition);
  if (editionLabel) return Boolean(canonicalRecordEdition(editionLabel)) && staffRecordMatchesEdition(row, actor);
  // HR records historically omitted Edition. Infer it only through one
  // authoritative staff identity, never through the requesting admin's edition.
  const username = lower(row.Username || row.username);
  if (!username) return false;
  const matches = staffUsers.filter((staff) => lower(staff.Username || staff.username || staff.__id) === username);
  return matches.length === 1 && staffRecordMatchesEdition(matches[0], actor)
    && lower(matches[0].BranchId || matches[0].branchId || 'main') === lower(branchId);
}

async function eligibleStaff(env, actor, branchId, assignments, { allowInactive = false } = {}) {
  // Do not turn directory read failures into an empty directory or accept a
  // client-supplied name/role/branch instead of the authoritative staff account.
  const [staff, employees] = await Promise.all([listCollection(env, 'staffUsers'), listCollection(env, 'hrEmployees')]);
  const targetIds = new Set(assignments.map((row) => lower(row.Username)));
  const exited = new Set(employees.filter((row) => attendanceHrRecordMatchesScope(row, staff, actor, branchId)
    && /exited|terminated/i.test(clean(row.Status))).map((row) => lower(row.Username)));
  const targets = new Map();
  for (const row of staff) {
    const username = lower(row.Username || row.__id);
    if (!targetIds.has(username) || !staffRecordMatchesEdition(row, actor)
      || lower(row.BranchId || row.branchId || 'main') !== lower(branchId)) continue;
    if (targets.has(username)) fail(`The staff identity ${username} is ambiguous. Correct the duplicate account before assigning it.`, 409);
    targets.set(username, row);
  }
  for (const username of targetIds) {
    const row = targets.get(username);
    if (!row || (!allowInactive && (['no', 'false', '0', 'inactive', 'disabled', 'off'].includes(lower(row.Active)) || exited.has(username)))) {
      fail(`Staff member ${username} is unavailable, inactive, or outside this branch and edition.`);
    }
  }
  return targets;
}

export async function requireAttendanceStaff(env, user, branchId, username, options = {}) {
  const identity = requiredDeploymentIdentity(env);
  const actorEdition = canonicalRecordEdition(user.edition || user.Edition || user.OrganisationEdition);
  if (actorEdition && actorEdition !== identity.edition) fail('This staff account belongs to another organisation edition.', 403);
  const actor = { ...user, edition: identity.edition };
  const branch = resolveStaffAttendanceBranch(actor, branchId);
  const wanted = lower(username);
  if (!wanted) fail('Choose a staff member for attendance.');
  const targets = await eligibleStaff(env, actor, branch, [{ Username: wanted }], options);
  const row = targets.get(wanted);
  return { Username: wanted, DisplayName: clean(row.DisplayName || row.Username || wanted), Role: clean(row.Role) };
}

export async function assignAttendanceGroups(env, user, body = {}, branchId = 'main', basePolicy = {}) {
  const { actor, branch } = managementContext(env, user, body, branchId);
  if (!Array.isArray(body.Assignments) || !body.Assignments.length || body.Assignments.length > ASSIGNMENT_LIMIT) {
    fail(`Choose between 1 and ${ASSIGNMENT_LIMIT} staff assignments.`);
  }
  const current = await currentRoster(env, body, branch);
  const today = localToday(basePolicy);
  const targets = new Set();
  const groupIds = new Set(current.roster.Groups.map((row) => clean(row.GroupId)));
  const requested = body.Assignments.map((row) => {
    const Username = lower(row?.Username);
    const GroupId = clean(row?.GroupId);
    if (!Username || Username.length > 150) fail('Choose a valid staff username for every assignment.');
    if (targets.has(Username)) fail(`Staff member ${Username} appears more than once in this assignment request.`);
    if (GroupId && !groupIds.has(GroupId)) fail('One of the selected attendance groups no longer exists. Refresh and try again.');
    targets.add(Username);
    return { Username, GroupId, EffectiveFrom: today };
  });
  await eligibleStaff(env, actor, branch, requested);
  const changes = requested.filter((row) => {
    const latest = current.roster.Assignments.filter((previous) => lower(previous.Username) === row.Username
      && clean(previous.EffectiveFrom) <= today).sort((a, b) => clean(b.EffectiveFrom).localeCompare(clean(a.EffectiveFrom)))[0];
    return clean(latest?.GroupId) !== row.GroupId;
  });
  const changedTargets = new Set(changes.map((row) => row.Username));
  const assignments = current.roster.Assignments.filter((row) => !(changedTargets.has(lower(row.Username))
    && clean(row.EffectiveFrom) === today)).concat(changes);
  const roster = await commitRoster(env, actor, branch, current, { Assignments: assignments }, 'ASSIGN_ATTENDANCE_GROUPS', {
    Assignments: changes
  });
  return { ok: true, message: 'Staff attendance groups assigned from today. Existing attendance records were not changed.', roster };
}

export async function deleteAttendanceGroup(env, user, body = {}, branchId = 'main', basePolicy = {}) {
  const { actor, branch } = managementContext(env, user, body, branchId);
  const current = await currentRoster(env, body, branch);
  const groupId = clean(body.GroupId);
  const group = current.roster.Groups.find((row) => clean(row.GroupId) === groupId);
  if (!group) fail('The attendance group no longer exists. Refresh and try again.', 404);
  if (current.roster.Assignments.some((row) => clean(row.GroupId) === groupId)) {
    fail('This attendance group has current or historical staff assignments. Keep it to preserve attendance history; staff can be reassigned to another group.', 409);
  }
  const roster = await commitRoster(env, actor, branch, current,
    { Groups: current.roster.Groups.filter((row) => row.GroupId !== groupId) }, 'DELETE_ATTENDANCE_GROUP', {
      GroupId: groupId, GroupName: group.Name, EffectiveFrom: localToday(basePolicy)
    });
  return { ok: true, message: 'Attendance group deleted. Existing attendance records were not changed.', roster };
}
