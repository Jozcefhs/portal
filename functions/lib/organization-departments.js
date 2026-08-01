import { batchUpsertDocuments, deleteDocument, getDocument, listCollection, upsertDocument } from './firestore.js';
import { CHURCH_COLLECTIONS, churchCollectionPath, safeChurchDocumentId } from './church-foundation.js';
import {
  assertImmutableRecordIdentity,
  importChurchMembers,
  recordWritePrecondition,
  resolveMembershipBranch,
  saveChurchMember,
  stripFirestoreMetadata,
  validatedCsvImportRows
} from './church-membership.js';
import { staffRecordMatchesEdition } from './records-desk.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const nowIso = () => new Date().toISOString();
const number = (value) => {
  const parsed = Number(String(value ?? 0).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};
const yes = (value) => value === true || ['yes', 'true', '1', 'paid', 'successful', 'success'].includes(lower(value));
const inputError = (message, status = 400) => Object.assign(new Error(message), { status });
const actor = (user = {}) => clean(user.displayName || user.DisplayName || user.username || user.Username || 'Unknown staff');
const role = (user = {}) => clean(user.role || user.Role);

const VIEW_ROLES = new Set(['Super Admin', 'Pastor', 'Church Administrator', 'Membership Officer', 'Treasurer', 'Auditor']);
const MANAGE_ROLES = new Set(['Super Admin', 'Pastor', 'Church Administrator']);
const OFFERING_ROLES = new Set(['Super Admin', 'Pastor', 'Church Administrator', 'Treasurer']);
const REMITTANCE_ROLES = new Set(['Super Admin', 'Treasurer', 'Accountant', 'Finance Officer']);

export function departmentCapabilities(user = {}) {
  return {
    canView: VIEW_ROLES.has(role(user)) || Boolean((user.allowedSections || []).includes('members')),
    canManageDepartments: MANAGE_ROLES.has(role(user)),
    canManageMembers: MANAGE_ROLES.has(role(user)) || role(user) === 'Membership Officer',
    canRecordMeetings: MANAGE_ROLES.has(role(user)) || role(user) === 'Membership Officer',
    canSubmitOfferings: OFFERING_ROLES.has(role(user)),
    canConfirmRemittance: REMITTANCE_ROLES.has(role(user)),
    canManagePrograms: MANAGE_ROLES.has(role(user)),
    canManageForeignVisitors: MANAGE_ROLES.has(role(user)) || role(user) === 'Membership Officer'
  };
}

function activeStaffRecord(row = {}) {
  return !['no', 'false', '0', 'inactive', 'disabled'].includes(lower(row.Active ?? 'YES'));
}

export function departmentAssignablePeople(members = [], staffUsers = [], branchId = 'main', user = {}) {
  const normalizedBranch = resolveMembershipBranch({}, branchId);
  const memberRows = (members || []).map((row) => {
    const personId = clean(row.MemberId || row.__id);
    return {
      PersonKey: `member:${personId}`,
      PersonId: personId,
      PersonType: 'Member',
      DisplayName: authoritativeMemberName(row),
      Detail: clean(row.MembershipStatus) || 'Member'
    };
  }).filter((row) => row.PersonId && row.DisplayName);
  const staffRows = (staffUsers || []).filter((row) =>
    activeStaffRecord(row)
    && staffRecordMatchesEdition(row, user)
    && resolveMembershipBranch({}, row.BranchId || 'main') === normalizedBranch
  ).map((row) => {
    const sourceId = clean(row.__id || row.Username || row.LoginUsername);
    return {
      PersonKey: `staff:${sourceId}`,
      PersonId: clean(row.Username || row.LoginUsername || sourceId),
      SourceId: sourceId,
      PersonType: 'Staff',
      DisplayName: clean(row.DisplayName || row.Username || row.LoginUsername || sourceId),
      Detail: [clean(row.Role), clean(row.Department)].filter(Boolean).join(' · ') || 'Staff'
    };
  }).filter((row) => row.SourceId && row.DisplayName);
  return [...memberRows, ...staffRows].sort((a, b) =>
    a.DisplayName.localeCompare(b.DisplayName) || a.PersonType.localeCompare(b.PersonType));
}

function requireCapability(user, capability) {
  const capabilities = departmentCapabilities(user);
  if (!capabilities[capability]) throw inputError('This account is not permitted to perform that department action.', 403);
  return capabilities;
}

function path(name, branchId) {
  return churchCollectionPath(CHURCH_COLLECTIONS[name], branchId);
}

async function audit(env, branchId, user, action, entityType, entityId, details = '') {
  const write = departmentAuditWrite(branchId, user, action, entityType, entityId, details);
  await upsertDocument(env, write.collectionPath, write.documentId, write.data);
}

function departmentAuditWrite(branchId, user, action, entityType, entityId, details = '') {
  const id = `DEP-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  return {
    collectionPath: path('departmentAudit', branchId),
    documentId: id,
    data: {
      AuditId: id, Timestamp: nowIso(), Action: clean(action), EntityType: clean(entityType),
      EntityId: clean(entityId), Details: clean(details), BranchId: branchId,
      Actor: actor(user), ActorRole: role(user), ActorUsername: clean(user.username || user.Username)
    }
  };
}

export function normalizedDepartment(input = {}, branchId = 'main') {
  const DepartmentId = clean(input.DepartmentId || input.departmentId);
  const Name = clean(input.Name || input.name || input.DepartmentName);
  if (!DepartmentId) throw inputError('Department ID is required.');
  if (!Name) throw inputError('Department name is required.');
  return {
    DepartmentId, Name, BranchId: branchId, Description: clean(input.Description),
    DepartmentType: clean(input.DepartmentType) || 'Department',
    AreaZone: clean(input.AreaZone), MeetingFrequency: clean(input.MeetingFrequency) || 'As scheduled',
    Active: yes(input.Active ?? 'YES') ? 'YES' : 'NO',
    IsForeignDesk: yes(input.IsForeignDesk) || lower(Name) === 'foreign desk',
    IsHomeChurch: yes(input.IsHomeChurch) || ['home church', 'home cell'].includes(lower(input.DepartmentType))
  };
}

async function saveDepartment(env, user, body, branchId) {
  requireCapability(user, 'canManageDepartments');
  const department = normalizedDepartment(body.department || body, branchId);
  const id = safeChurchDocumentId(department.DepartmentId);
  const existing = await getDocument(env, path('departments', branchId), id);
  assertImmutableRecordIdentity(
    'Department ID',
    department.DepartmentId,
    body.OriginalDepartmentId || body.originalDepartmentId,
    existing?.DepartmentId
  );
  if (existing && !belongsToBranch(existing, branchId)) {
    throw inputError('The department record belongs to another branch.', 409);
  }
  const payload = {
    ...(existing || {}), ...department, CreatedAt: existing?.CreatedAt || nowIso(),
    CreatedBy: existing?.CreatedBy || actor(user), UpdatedAt: nowIso(), UpdatedBy: actor(user)
  };
  delete payload.__id; delete payload.__name;
  await upsertDocument(
    env,
    path('departments', branchId),
    id,
    payload,
    recordWritePrecondition(existing)
  );
  await audit(env, branchId, user, existing ? 'UPDATE' : 'CREATE', 'Department', department.DepartmentId, department.Name);
  return { message: existing ? 'Department updated.' : 'Department created.' };
}

async function importDepartments(env, user, body, branchId) {
  requireCapability(user, 'canManageDepartments');
  const rows = validatedCsvImportRows(body.departments, 'department');
  const collectionPath = path('departments', branchId);
  const existingRows = await listCollection(env, collectionPath);
  const existingById = new Map(existingRows.map((row) => [
    safeChurchDocumentId(row.DepartmentId || row.__id),
    row
  ]));
  const seen = new Set();
  const writes = rows.map((row) => {
    const department = normalizedDepartment(row, branchId);
    const id = safeChurchDocumentId(department.DepartmentId);
    if (seen.has(id)) throw inputError(`Duplicate DepartmentId in import: ${department.DepartmentId}`);
    seen.add(id);
    const existing = existingById.get(id);
    return {
      collectionPath,
      documentId: id,
      data: {
        ...stripFirestoreMetadata(existing),
        ...department,
        CreatedAt: existing?.CreatedAt || nowIso(),
        CreatedBy: existing?.CreatedBy || actor(user),
        UpdatedAt: nowIso(),
        UpdatedBy: actor(user),
        ImportSource: 'CSV'
      }
    };
  });
  const imported = writes.length;
  const auditId = `DEP-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  writes.push({
    collectionPath: path('departmentAudit', branchId),
    documentId: auditId,
    data: {
      AuditId: auditId,
      Timestamp: nowIso(),
      Action: 'IMPORT',
      EntityType: 'Department',
      EntityId: `${imported} records`,
      Details: 'CSV department import',
      BranchId: branchId,
      Actor: actor(user),
      ActorRole: role(user),
      ActorUsername: clean(user.username || user.Username)
    }
  });
  await batchUpsertDocuments(env, writes);
  return { message: `${imported} department record(s) imported.`, imported };
}

async function deleteDepartment(env, user, body, branchId) {
  requireCapability(user, 'canManageDepartments');
  const id = safeChurchDocumentId(body.DepartmentId);
  if (!id) throw inputError('Department ID is required.');
  const [members, meetings] = await Promise.all([
    listCollection(env, path('departmentMembers', branchId)),
    listCollection(env, path('departmentMeetings', branchId))
  ]);
  if (members.some((row) => safeChurchDocumentId(row.DepartmentId) === id)
    || meetings.some((row) => safeChurchDocumentId(row.DepartmentId) === id)) {
    throw inputError('Remove or reassign this department’s members and meetings before deleting it.', 409);
  }
  await deleteDocument(env, path('departments', branchId), id);
  await audit(env, branchId, user, 'DELETE', 'Department', body.DepartmentId);
  return { message: 'Department deleted.' };
}

async function savePosition(env, user, body, branchId) {
  requireCapability(user, 'canManageDepartments');
  const PositionId = clean(body.PositionId);
  const DepartmentId = clean(body.DepartmentId);
  const Name = clean(body.Name || body.PositionName);
  if (!PositionId || !DepartmentId || !Name) throw inputError('Position ID, department and name are required.');
  const id = safeChurchDocumentId(`${DepartmentId}--${PositionId}`);
  const [department, existing] = await Promise.all([
    getDocument(env, path('departments', branchId), safeChurchDocumentId(DepartmentId)),
    getDocument(env, path('departmentPositions', branchId), id)
  ]);
  if (!department || !belongsToBranch(department, branchId)) {
    throw inputError('The selected department does not exist in this branch.', 404);
  }
  assertImmutableRecordIdentity(
    'Position ID',
    PositionId,
    body.OriginalPositionId || body.originalPositionId,
    existing?.PositionId
  );
  assertImmutableRecordIdentity(
    'Position department',
    DepartmentId,
    body.OriginalDepartmentId || body.originalDepartmentId,
    existing?.DepartmentId
  );
  if (existing && !belongsToBranch(existing, branchId)) {
    throw inputError('The position record belongs to another branch.', 409);
  }
  await upsertDocument(env, path('departmentPositions', branchId), id, {
    ...(existing || {}), PositionId, DepartmentId, Name, Description: clean(body.Description),
    Active: yes(body.Active ?? 'YES') ? 'YES' : 'NO', BranchId: branchId,
    CreatedAt: existing?.CreatedAt || nowIso(), UpdatedAt: nowIso(), UpdatedBy: actor(user)
  }, recordWritePrecondition(existing));
  await audit(env, branchId, user, existing ? 'UPDATE' : 'CREATE', 'Position', PositionId, `${DepartmentId} | ${Name}`);
  return { message: existing ? 'Position updated.' : 'Position created.' };
}

async function deleteMember(env, user, body, branchId) {
  requireCapability(user, 'canManageMembers');
  const memberId = clean(body.MemberId);
  const id = safeChurchDocumentId(memberId);
  if (!id) throw inputError('Member ID is required.');
  const memberPath = path('members', branchId);
  const [existing, assignments] = await Promise.all([
    getDocument(env, memberPath, id),
    listCollection(env, path('departmentMembers', branchId))
  ]);
  if (!existing || !belongsToBranch(existing, branchId)) {
    throw inputError('Member was not found in this branch.', 404);
  }
  if (assignments.some((row) => safeChurchDocumentId(row.MemberId) === id)) {
    throw inputError('Remove this member from every department before deleting the member profile.', 409);
  }
  const auditWrite = departmentAuditWrite(
    branchId,
    user,
    'DELETE',
    'Member',
    memberId,
    authoritativeMemberName(existing)
  );
  await batchUpsertDocuments(env, [
    {
      collectionPath: memberPath,
      documentId: id,
      operation: 'delete',
      ...(existing.__updateTime ? { updateTime: existing.__updateTime } : { exists: true })
    },
    auditWrite
  ]);
  return { message: 'Member profile deleted.' };
}

async function deletePosition(env, user, body, branchId) {
  requireCapability(user, 'canManageDepartments');
  const positionId = clean(body.PositionId);
  const departmentId = clean(body.DepartmentId);
  if (!positionId || !departmentId) throw inputError('Position ID and department are required.');
  const id = safeChurchDocumentId(`${departmentId}--${positionId}`);
  const positionPath = path('departmentPositions', branchId);
  const [existing, assignments] = await Promise.all([
    getDocument(env, positionPath, id),
    listCollection(env, path('departmentMembers', branchId))
  ]);
  if (!existing || !belongsToBranch(existing, branchId)) {
    throw inputError('Position was not found in this branch.', 404);
  }
  const inUse = assignments.some((row) =>
    safeChurchDocumentId(row.DepartmentId) === safeChurchDocumentId(departmentId)
    && safeChurchDocumentId(row.PositionId) === safeChurchDocumentId(positionId));
  if (inUse) {
    throw inputError('Reassign or remove every member using this position before deleting it.', 409);
  }
  const auditWrite = departmentAuditWrite(
    branchId,
    user,
    'DELETE',
    'Position',
    positionId,
    `${departmentId} | ${clean(existing.Name || existing.PositionName)}`
  );
  await batchUpsertDocuments(env, [
    {
      collectionPath: positionPath,
      documentId: id,
      operation: 'delete',
      ...(existing.__updateTime ? { updateTime: existing.__updateTime } : { exists: true })
    },
    auditWrite
  ]);
  return { message: 'Department position deleted.' };
}

function authoritativeMemberName(member = {}) {
  return clean(member.DisplayName || [
    member.Title,
    member.FirstName,
    member.MiddleName,
    member.Surname || member.LastName
  ].map(clean).filter(Boolean).join(' '));
}

function belongsToBranch(record = {}, branchId = '') {
  const recordBranch = clean(record.BranchId || record.branchId);
  return !recordBranch || lower(recordBranch) === lower(branchId);
}

export function authoritativeDepartmentMemberAssignment(
  input = {},
  branchId = 'main',
  department = null,
  member = null,
  position = null
) {
  const DepartmentId = clean(input.DepartmentId);
  const MemberId = clean(input.MemberId);
  const PositionId = clean(input.PositionId);
  if (!DepartmentId || !MemberId) throw inputError('Department and member are required.');
  if (!department || !belongsToBranch(department, branchId)) {
    throw inputError('Department was not found in this branch.', 404);
  }
  if (!member || !belongsToBranch(member, branchId)) {
    throw inputError('Member was not found in this branch.', 404);
  }
  const authoritativeDepartmentId = clean(department.DepartmentId || DepartmentId);
  if (safeChurchDocumentId(authoritativeDepartmentId) !== safeChurchDocumentId(DepartmentId)) {
    throw inputError('Department was not found in this branch.', 404);
  }
  const authoritativeMemberId = clean(member.MemberId || MemberId);
  if (safeChurchDocumentId(authoritativeMemberId) !== safeChurchDocumentId(MemberId)) {
    throw inputError('Member was not found in this branch.', 404);
  }
  const DisplayName = authoritativeMemberName(member);
  if (!DisplayName) throw inputError('The selected member does not have a usable name.', 409);
  if (PositionId) {
    if (!position || !belongsToBranch(position, branchId)) {
      throw inputError('The selected position does not exist in this department.', 404);
    }
    if (safeChurchDocumentId(position.PositionId) !== safeChurchDocumentId(PositionId)
      || safeChurchDocumentId(position.DepartmentId) !== safeChurchDocumentId(DepartmentId)) {
      throw inputError('The selected position does not belong to this department.');
    }
  }
  return {
    DepartmentId: authoritativeDepartmentId,
    DepartmentName: clean(department.Name || department.DepartmentName),
    MemberId: authoritativeMemberId,
    DisplayName,
    PositionId,
    PositionName: PositionId ? clean(position.Name || position.PositionName) : '',
    JoinedDate: clean(input.JoinedDate),
    Status: clean(input.Status) || 'Active',
    BranchId: branchId
  };
}

async function saveDepartmentMember(env, user, body, branchId) {
  requireCapability(user, 'canManageMembers');
  const DepartmentId = clean(body.DepartmentId);
  const MemberId = clean(body.MemberId);
  const PositionId = clean(body.PositionId);
  if (!DepartmentId || !MemberId) throw inputError('Department and member are required.');
  const [department, member, position] = await Promise.all([
    getDocument(env, path('departments', branchId), safeChurchDocumentId(DepartmentId)),
    getDocument(env, path('members', branchId), safeChurchDocumentId(MemberId)),
    PositionId
      ? getDocument(
        env,
        path('departmentPositions', branchId),
        safeChurchDocumentId(`${DepartmentId}--${PositionId}`)
      )
      : Promise.resolve(null)
  ]);
  const assignment = authoritativeDepartmentMemberAssignment(
    body,
    branchId,
    department,
    member,
    position
  );
  const membershipId = safeChurchDocumentId(`${DepartmentId}--${MemberId}`);
  const existing = await getDocument(env, path('departmentMembers', branchId), membershipId).catch(() => null);
  await upsertDocument(env, path('departmentMembers', branchId), membershipId, {
    ...(existing || {}), ...assignment, MembershipId: membershipId,
    CreatedAt: existing?.CreatedAt || nowIso(), UpdatedAt: nowIso(), UpdatedBy: actor(user)
  });
  await audit(env, branchId, user, existing ? 'UPDATE' : 'ASSIGN', 'Department Member', membershipId);
  return { message: existing ? 'Department member updated.' : 'Member assigned to department.' };
}

async function batchAssignDepartmentPeople(env, user, body, branchId) {
  requireCapability(user, 'canManageMembers');
  const DepartmentId = clean(body.DepartmentId);
  const personKeys = [...new Set((Array.isArray(body.PersonKeys) ? body.PersonKeys : []).map(clean).filter(Boolean))];
  if (!DepartmentId) throw inputError('Choose a department for the batch assignment.');
  if (!personKeys.length) throw inputError('Select at least one member or staff account.');
  if (personKeys.length > 200) throw inputError('Assign a maximum of 200 people at a time.');
  const [department, members, staffUsers, existingAssignments] = await Promise.all([
    getDocument(env, path('departments', branchId), safeChurchDocumentId(DepartmentId)),
    listCollection(env, path('members', branchId)),
    listCollection(env, 'staffUsers'),
    listCollection(env, path('departmentMembers', branchId))
  ]);
  if (!department || !belongsToBranch(department, branchId)) throw inputError('Department was not found in this branch.', 404);
  const authoritativeDepartmentId = clean(department.DepartmentId || DepartmentId);
  const departmentName = clean(department.Name || department.DepartmentName);
  const membersById = new Map(members.map((row) => [safeChurchDocumentId(row.MemberId || row.__id), row]));
  const eligibleStaff = staffUsers.filter((row) =>
    activeStaffRecord(row)
    && staffRecordMatchesEdition(row, user)
    && resolveMembershipBranch({}, row.BranchId || 'main') === branchId
  );
  const staffById = new Map(eligibleStaff.map((row) => [safeChurchDocumentId(row.__id || row.Username), row]));
  const existingById = new Map(existingAssignments.map((row) => [safeChurchDocumentId(row.MembershipId || row.__id), row]));
  const joinedDate = clean(body.JoinedDate);
  const status = clean(body.Status) || 'Active';
  let created = 0;
  let updated = 0;
  const writes = personKeys.map((personKey) => {
    const separator = personKey.indexOf(':');
    const personType = lower(separator >= 0 ? personKey.slice(0, separator) : '');
    const sourceId = clean(separator >= 0 ? personKey.slice(separator + 1) : '');
    if (!sourceId || !['member', 'staff'].includes(personType)) throw inputError(`Invalid person selection: ${personKey}`);
    let membershipId;
    let assignment;
    if (personType === 'member') {
      const member = membersById.get(safeChurchDocumentId(sourceId));
      if (!member) throw inputError(`Member was not found in this branch: ${sourceId}`, 404);
      assignment = authoritativeDepartmentMemberAssignment({
        DepartmentId: authoritativeDepartmentId,
        MemberId: clean(member.MemberId || sourceId),
        JoinedDate: joinedDate,
        Status: status
      }, branchId, department, member, null);
      membershipId = safeChurchDocumentId(`${authoritativeDepartmentId}--${assignment.MemberId}`);
      assignment.PersonKey = `member:${assignment.MemberId}`;
      assignment.PersonType = 'Member';
    } else {
      const staff = staffById.get(safeChurchDocumentId(sourceId));
      if (!staff) throw inputError(`Staff account was not found in this church branch: ${sourceId}`, 404);
      const staffId = clean(staff.__id || sourceId);
      const staffUsername = clean(staff.Username || staff.LoginUsername || staffId);
      membershipId = safeChurchDocumentId(`${authoritativeDepartmentId}--staff--${staffId}`);
      assignment = {
        DepartmentId: authoritativeDepartmentId,
        DepartmentName: departmentName,
        MemberId: '',
        StaffId: staffId,
        StaffUsername: staffUsername,
        DisplayName: clean(staff.DisplayName || staffUsername),
        PersonKey: `staff:${staffId}`,
        PersonType: 'Staff',
        PositionId: '',
        PositionName: '',
        JoinedDate: joinedDate,
        Status: status,
        BranchId: branchId
      };
    }
    const existing = existingById.get(membershipId);
    if (existing) updated += 1;
    else created += 1;
    return {
      collectionPath: path('departmentMembers', branchId),
      documentId: membershipId,
      data: {
        ...stripFirestoreMetadata(existing),
        ...assignment,
        MembershipId: membershipId,
        CreatedAt: existing?.CreatedAt || nowIso(),
        CreatedBy: existing?.CreatedBy || actor(user),
        UpdatedAt: nowIso(),
        UpdatedBy: actor(user)
      }
    };
  });
  writes.push(departmentAuditWrite(
    branchId,
    user,
    'BATCH ASSIGN',
    'Department Member',
    authoritativeDepartmentId,
    `${created} assigned | ${updated} already assigned or updated`
  ));
  await batchUpsertDocuments(env, writes);
  return {
    assigned: created,
    updated,
    message: `${created} person(s) assigned to ${departmentName}${updated ? `; ${updated} existing assignment(s) updated.` : '.'}`
  };
}

async function removeDepartmentMember(env, user, body, branchId) {
  requireCapability(user, 'canManageMembers');
  const membershipId = safeChurchDocumentId(
    body.MembershipId || (
      clean(body.DepartmentId) && clean(body.MemberId)
        ? `${clean(body.DepartmentId)}--${clean(body.MemberId)}`
        : ''
    )
  );
  if (!membershipId) throw inputError('Department membership ID is required.');
  const membershipPath = path('departmentMembers', branchId);
  const existing = await getDocument(env, membershipPath, membershipId);
  if (!existing) throw inputError('Department membership was not found.', 404);
  const auditWrite = departmentAuditWrite(
    branchId,
    user,
    'REMOVE',
    'Department Member',
    membershipId,
    `${clean(existing.DisplayName || existing.MemberId)} | ${clean(existing.DepartmentName || existing.DepartmentId)}`
  );
  await batchUpsertDocuments(env, [
    {
      collectionPath: membershipPath,
      documentId: membershipId,
      operation: 'delete',
      ...(existing.__updateTime ? { updateTime: existing.__updateTime } : { exists: true })
    },
    auditWrite
  ]);
  return { message: 'Member removed from department.' };
}

async function saveMeeting(env, user, body, branchId) {
  requireCapability(user, 'canRecordMeetings');
  const MeetingId = clean(body.MeetingId);
  const DepartmentId = clean(body.DepartmentId);
  const Date = clean(body.Date);
  if (!MeetingId || !DepartmentId || !/^\d{4}-\d{2}-\d{2}$/.test(Date)) {
    throw inputError('Meeting ID, department and a valid date are required.');
  }
  const existing = await getDocument(env, path('departmentMeetings', branchId), safeChurchDocumentId(MeetingId)).catch(() => null);
  await upsertDocument(env, path('departmentMeetings', branchId), safeChurchDocumentId(MeetingId), {
    ...(existing || {}), MeetingId, DepartmentId, Date, Title: clean(body.Title) || 'Department meeting',
    AreaZone: clean(body.AreaZone), Location: clean(body.Location), Notes: clean(body.Notes), BranchId: branchId,
    CreatedAt: existing?.CreatedAt || nowIso(), UpdatedAt: nowIso(), UpdatedBy: actor(user)
  });
  await audit(env, branchId, user, existing ? 'UPDATE' : 'CREATE', 'Department Meeting', MeetingId, `${DepartmentId} | ${Date}`);
  return { message: existing ? 'Meeting updated.' : 'Meeting recorded.' };
}

async function recordAttendance(env, user, body, branchId) {
  requireCapability(user, 'canRecordMeetings');
  const MeetingId = clean(body.MeetingId);
  const MemberId = clean(body.MemberId);
  const DisplayName = clean(body.DisplayName);
  if (!MeetingId || (!MemberId && !DisplayName)) throw inputError('Meeting and attendee are required.');
  const id = safeChurchDocumentId(`${MeetingId}--${MemberId || DisplayName}`);
  const existing = await getDocument(env, path('departmentAttendance', branchId), id).catch(() => null);
  await upsertDocument(env, path('departmentAttendance', branchId), id, {
    ...(existing || {}), AttendanceId: id, MeetingId, MemberId, DisplayName,
    Status: clean(body.Status) || 'Present', CheckedInAt: clean(body.CheckedInAt) || nowIso(),
    BranchId: branchId, UpdatedAt: nowIso(), UpdatedBy: actor(user)
  });
  return { message: existing ? 'Attendance updated.' : 'Attendance recorded.' };
}

async function saveDepartmentOffering(env, user, body, branchId) {
  requireCapability(user, 'canSubmitOfferings');
  const OfferingId = clean(body.OfferingId);
  const DepartmentId = clean(body.DepartmentId);
  const Amount = number(body.Amount);
  if (!OfferingId || !DepartmentId || Amount <= 0) throw inputError('Offering ID, department and an amount greater than zero are required.');
  const method = clean(body.PaymentMethod) || 'Cash';
  const onlinePaid = ['online', 'card', 'transfer'].includes(lower(method)) && yes(body.PaymentStatus);
  const existing = await getDocument(env, path('departmentOfferings', branchId), safeChurchDocumentId(OfferingId)).catch(() => null);
  await upsertDocument(env, path('departmentOfferings', branchId), safeChurchDocumentId(OfferingId), {
    ...(existing || {}), OfferingId, DepartmentId, MeetingId: clean(body.MeetingId),
    Date: clean(body.Date) || nowIso().slice(0, 10), Amount, Currency: clean(body.Currency) || 'NGN',
    PaymentMethod: method, PaymentReference: clean(body.PaymentReference),
    Status: onlinePaid ? 'Paid' : 'Awaiting Remittance',
    RemittanceStatus: onlinePaid ? 'Paid' : 'Unpaid',
    SubmittedAt: existing?.SubmittedAt || nowIso(), SubmittedBy: existing?.SubmittedBy || actor(user),
    PaidAt: onlinePaid ? nowIso() : clean(existing?.PaidAt), PaidBy: onlinePaid ? 'Online payment confirmation' : clean(existing?.PaidBy),
    BranchId: branchId, Notes: clean(body.Notes), UpdatedAt: nowIso(), UpdatedBy: actor(user)
  });
  await audit(env, branchId, user, onlinePaid ? 'ONLINE PAYMENT CONFIRMED' : 'SUBMIT', 'Department Offering', OfferingId, `${DepartmentId} | ${Amount}`);
  return { message: onlinePaid ? 'Offering submitted and automatically marked paid.' : 'Offering submitted for remittance.' };
}

async function markOfferingPaid(env, user, body, branchId) {
  requireCapability(user, 'canConfirmRemittance');
  const id = safeChurchDocumentId(body.OfferingId);
  const existing = await getDocument(env, path('departmentOfferings', branchId), id);
  if (!existing) throw inputError('Department offering was not found.', 404);
  const payload = {
    ...existing, Status: 'Paid', RemittanceStatus: 'Paid', PaidAt: nowIso(), PaidBy: actor(user),
    RemittanceReference: clean(body.RemittanceReference || body.PaymentReference), UpdatedAt: nowIso(), UpdatedBy: actor(user)
  };
  delete payload.__id; delete payload.__name;
  await upsertDocument(env, path('departmentOfferings', branchId), id, payload);
  await audit(env, branchId, user, 'MARK PAID', 'Department Offering', body.OfferingId, payload.RemittanceReference);
  return { message: 'Offering remittance marked paid.' };
}

async function saveProgram(env, user, body, branchId) {
  requireCapability(user, 'canManagePrograms');
  const ProgramId = clean(body.ProgramId);
  const Name = clean(body.Name || body.ProgramName);
  if (!ProgramId || !Name) throw inputError('Program ID and name are required.');
  const existing = await getDocument(env, path('specialPrograms', branchId), safeChurchDocumentId(ProgramId)).catch(() => null);
  await upsertDocument(env, path('specialPrograms', branchId), safeChurchDocumentId(ProgramId), {
    ...(existing || {}), ProgramId, Name, StartDate: clean(body.StartDate), EndDate: clean(body.EndDate),
    Venue: clean(body.Venue), Description: clean(body.Description), RegistrationOpen: yes(body.RegistrationOpen ?? 'YES'),
    BranchId: branchId, CreatedAt: existing?.CreatedAt || nowIso(), UpdatedAt: nowIso(), UpdatedBy: actor(user)
  });
  return { message: existing ? 'Special program updated.' : 'Special program created.' };
}

async function registerParticipant(env, user, body, branchId) {
  requireCapability(user, 'canManagePrograms');
  const ProgramId = clean(body.ProgramId);
  const FullName = clean(body.FullName);
  const Country = clean(body.Country);
  if (!ProgramId || !FullName || !Country) throw inputError('Program, participant name and country are required.');
  const RegistrationId = clean(body.RegistrationId) || `REG-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  await upsertDocument(env, path('programRegistrations', branchId), safeChurchDocumentId(RegistrationId), {
    RegistrationId, ProgramId, FullName, Country, Email: lower(body.Email), Phone: clean(body.Phone),
    Status: clean(body.Status) || 'Registered', RegisteredAt: nowIso(), RegisteredBy: actor(user), BranchId: branchId
  });
  return { message: 'Participant registered.' };
}

async function saveForeignVisitor(env, user, body, branchId) {
  requireCapability(user, 'canManageForeignVisitors');
  const VisitorId = clean(body.VisitorId) || `VIS-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const FullName = clean(body.FullName);
  const Country = clean(body.Country);
  if (!FullName || !Country) throw inputError('Visitor name and country are required.');
  await upsertDocument(env, path('foreignVisitors', branchId), safeChurchDocumentId(VisitorId), {
    VisitorId, FullName, Country, Email: lower(body.Email), Phone: clean(body.Phone),
    VisitDate: clean(body.VisitDate) || nowIso().slice(0, 10), Purpose: clean(body.Purpose),
    FollowUpOfficer: clean(body.FollowUpOfficer), Notes: clean(body.Notes), BranchId: branchId,
    UpdatedAt: nowIso(), UpdatedBy: actor(user)
  });
  return { message: 'Foreign visitor recorded.' };
}

export function departmentSummaries(departments, departmentMembers, meetings, attendance, offerings, registrations) {
  const attendanceByMeeting = new Map();
  attendance.forEach((row) => attendanceByMeeting.set(clean(row.MeetingId), (attendanceByMeeting.get(clean(row.MeetingId)) || 0) + 1));
  const departmentRows = departments.map((department) => {
    const id = clean(department.DepartmentId || department.__id);
    const deptMeetings = meetings.filter((row) => clean(row.DepartmentId) === id);
    const deptOfferings = offerings.filter((row) => clean(row.DepartmentId) === id);
    return {
      DepartmentId: id, Name: clean(department.Name), DepartmentType: clean(department.DepartmentType),
      AreaZone: clean(department.AreaZone),
      Members: departmentMembers.filter((row) => clean(row.DepartmentId) === id && lower(row.Status || 'active') === 'active').length,
      Meetings: deptMeetings.length,
      Attendance: deptMeetings.reduce((sum, row) => sum + (attendanceByMeeting.get(clean(row.MeetingId)) || 0), 0),
      Offerings: deptOfferings.reduce((sum, row) => sum + number(row.Amount), 0),
      Unremitted: deptOfferings.filter((row) => lower(row.RemittanceStatus) !== 'paid').reduce((sum, row) => sum + number(row.Amount), 0)
    };
  });
  const homeCells = departmentRows.filter((row) => ['home church', 'home cell'].includes(lower(row.DepartmentType)));
  const areas = {};
  homeCells.forEach((row) => {
    const key = row.AreaZone || 'Unassigned';
    areas[key] ||= { AreaZone: key, HomeChurches: 0, Attendance: 0 };
    areas[key].HomeChurches += 1; areas[key].Attendance += row.Attendance;
  });
  const countries = {};
  registrations.forEach((row) => { const key = clean(row.Country) || 'Not specified'; countries[key] = (countries[key] || 0) + 1; });
  return {
    departments: departmentRows,
    homeChurchAreas: Object.values(areas),
    participantsByCountry: Object.entries(countries).map(([Country, Participants]) => ({ Country, Participants }))
  };
}

export async function listOrganizationDepartments(env, user, body = {}) {
  const capabilities = requireCapability(user, 'canView');
  const branchId = resolveMembershipBranch(user, body.BranchId || body.branchId);
  const names = ['members', 'departments', 'departmentPositions', 'departmentMembers', 'departmentMeetings',
    'departmentAttendance', 'departmentOfferings', 'specialPrograms', 'programRegistrations',
    'foreignVisitors', 'departmentAudit'];
  const [rows, staffUsers] = await Promise.all([
    Promise.all(names.map((name) => listCollection(env, path(name, branchId)).catch(() => []))),
    listCollection(env, 'staffUsers').catch(() => [])
  ]);
  const data = Object.fromEntries(names.map((name, index) => [name, rows[index]]));
  return {
    ok: true, branchId, capabilities, ...data,
    assignablePeople: departmentAssignablePeople(data.members, staffUsers, branchId, user),
    summaries: departmentSummaries(data.departments, data.departmentMembers, data.departmentMeetings,
      data.departmentAttendance, data.departmentOfferings, data.programRegistrations)
  };
}

export async function handleOrganizationDepartmentAction(env, user, body = {}) {
  const action = lower(body.Action || body.action || 'list');
  if (action === 'list') return listOrganizationDepartments(env, user, body);
  const branchId = resolveMembershipBranch(user, body.BranchId || body.branchId);
  let result;
  if (['savemember', 'savechurchmember'].includes(action)) {
    requireCapability(user, 'canManageMembers');
    result = await saveChurchMember(env, user, { ...body, BranchId: branchId });
  }
  else if (['importmembers', 'importchurchmembers'].includes(action)) {
    requireCapability(user, 'canManageMembers');
    result = await importChurchMembers(env, user, { ...body, BranchId: branchId });
  }
  else if (action === 'savedepartment') result = await saveDepartment(env, user, body, branchId);
  else if (action === 'importdepartments') result = await importDepartments(env, user, body, branchId);
  else if (action === 'deletedepartment') result = await deleteDepartment(env, user, body, branchId);
  else if (action === 'saveposition') result = await savePosition(env, user, body, branchId);
  else if (action === 'deletemember') result = await deleteMember(env, user, body, branchId);
  else if (action === 'deleteposition') result = await deletePosition(env, user, body, branchId);
  else if (action === 'savedepartmentmember') result = await saveDepartmentMember(env, user, body, branchId);
  else if (action === 'batchassigndepartmentpeople') result = await batchAssignDepartmentPeople(env, user, body, branchId);
  else if (action === 'removedepartmentmember') result = await removeDepartmentMember(env, user, body, branchId);
  else if (action === 'savemeeting') result = await saveMeeting(env, user, body, branchId);
  else if (action === 'recordattendance') result = await recordAttendance(env, user, body, branchId);
  else if (action === 'saveoffering') result = await saveDepartmentOffering(env, user, body, branchId);
  else if (action === 'markofferingpaid') result = await markOfferingPaid(env, user, body, branchId);
  else if (action === 'saveprogram') result = await saveProgram(env, user, body, branchId);
  else if (action === 'registerparticipant') result = await registerParticipant(env, user, body, branchId);
  else if (action === 'saveforeignvisitor') result = await saveForeignVisitor(env, user, body, branchId);
  else throw inputError('Choose a valid department action.');
  return { ...(await listOrganizationDepartments(env, user, { BranchId: branchId })), ...result };
}
