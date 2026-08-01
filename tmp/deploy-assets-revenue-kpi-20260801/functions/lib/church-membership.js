import { batchUpsertDocuments, getDocument, listCollection, upsertDocument } from './firestore.js';
import {
  CHURCH_COLLECTIONS,
  churchCollectionPath,
  safeChurchDocumentId
} from './church-foundation.js';
import { resolveOrganizationConfig } from './organization-config.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const nowIso = () => new Date().toISOString();
const inputError = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

export function assertImmutableRecordIdentity(label, currentValue, originalValue = '', storedValue = '') {
  const current = clean(currentValue);
  const original = clean(originalValue);
  const stored = clean(storedValue);
  if (original && original !== current) {
    throw inputError(`${clean(label) || 'Record ID'} cannot be changed while editing.`, 409);
  }
  if (stored && stored !== current) {
    throw inputError(`${clean(label) || 'Record ID'} conflicts with an existing record.`, 409);
  }
  return current;
}

export function recordWritePrecondition(existing = null) {
  if (!existing) return { exists: false };
  const updateTime = clean(existing.__updateTime);
  return updateTime ? { updateTime } : { exists: true };
}

export function validatedCsvImportRows(value, recordName = 'record') {
  const rows = Array.isArray(value) ? value : [];
  if (!rows.length) {
    throw inputError(`Choose a CSV containing at least one ${clean(recordName)} row.`);
  }
  if (rows.length > 499) {
    throw inputError(`A CSV import may contain at most 499 ${clean(recordName)} rows.`);
  }
  return rows;
}

export function stripFirestoreMetadata(record = {}) {
  return Object.fromEntries(
    Object.entries(record || {}).filter(([key]) => !String(key).startsWith('__'))
  );
}

export const CHURCH_STAFF_ROLES = Object.freeze([
  'Pastor',
  'Church Administrator',
  'Membership Officer',
  'Treasurer',
  'Auditor'
]);

const MEMBER_ROLES = new Set(['Super Admin', 'Pastor', 'Church Administrator', 'Membership Officer']);
const PASTORAL_ROLES = new Set(['Super Admin', 'Pastor']);

export function membershipCapabilities(user = {}) {
  const role = clean(user.role || user.Role);
  return {
    canView: MEMBER_ROLES.has(role),
    canEditMembers: MEMBER_ROLES.has(role),
    canManageHouseholds: MEMBER_ROLES.has(role),
    canViewPastoralNotes: PASTORAL_ROLES.has(role),
    canEditPastoralNotes: PASTORAL_ROLES.has(role),
    canViewAudit: PASTORAL_ROLES.has(role)
  };
}

export function resolveMembershipBranch(user = {}, requestedBranch = '') {
  const assigned = clean(user.branchId || user.BranchId);
  const requested = clean(requestedBranch);
  if (assigned && requested && lower(assigned) !== lower(requested)) {
    const error = new Error('This staff account is restricted to another church branch.');
    error.status = 403;
    throw error;
  }
  return clean(assigned || requested || 'main').toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'main';
}

function validEmail(value) {
  const email = lower(value);
  return !email || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

export function normalizeChurchHousehold(input = {}, branchId = 'main') {
  const householdId = clean(input.HouseholdId || input.householdId);
  const householdName = clean(input.HouseholdName || input.householdName || input.Name || input.name);
  if (!householdId) throw inputError('HouseholdId is required.');
  if (!householdName) throw inputError('Household name is required.');
  return {
    HouseholdId: householdId,
    BranchId: resolveMembershipBranch({}, branchId),
    HouseholdName: householdName,
    PrimaryContactMemberId: clean(input.PrimaryContactMemberId || input.primaryContactMemberId),
    Phone: clean(input.Phone || input.phone),
    Email: lower(input.Email || input.email),
    Address: clean(input.Address || input.address),
    CityArea: clean(input.CityArea || input.cityArea),
    State: clean(input.State || input.state),
    Status: clean(input.Status || input.status) || 'Active',
    Notes: clean(input.Notes || input.notes)
  };
}

export function normalizeChurchMember(input = {}, branchId = 'main') {
  const memberId = clean(input.MemberId || input.memberId);
  const firstName = clean(input.FirstName || input.firstName);
  const surname = clean(input.Surname || input.surname || input.LastName || input.lastName);
  const displayName = clean(input.DisplayName || input.displayName) || [firstName, surname].filter(Boolean).join(' ');
  const email = lower(input.Email || input.email);
  if (!memberId) throw inputError('MemberId is required.');
  if (!displayName) throw inputError('A member name is required.');
  if (!validEmail(email)) throw inputError('Enter a valid member email address.');
  return {
    MemberId: memberId,
    BranchId: resolveMembershipBranch({}, branchId),
    HouseholdId: clean(input.HouseholdId || input.householdId),
    Title: clean(input.Title || input.title),
    FirstName: firstName,
    MiddleName: clean(input.MiddleName || input.middleName),
    Surname: surname,
    DisplayName: displayName,
    Gender: clean(input.Gender || input.gender),
    DateOfBirth: clean(input.DateOfBirth || input.dateOfBirth),
    MaritalStatus: clean(input.MaritalStatus || input.maritalStatus),
    Phone: clean(input.Phone || input.phone),
    Email: email,
    Address: clean(input.Address || input.address),
    CityArea: clean(input.CityArea || input.cityArea),
    State: clean(input.State || input.state),
    MembershipStatus: clean(input.MembershipStatus || input.membershipStatus) || 'Active',
    MembershipDate: clean(input.MembershipDate || input.membershipDate),
    BaptismStatus: clean(input.BaptismStatus || input.baptismStatus),
    Ministry: clean(input.Ministry || input.ministry),
    Occupation: clean(input.Occupation || input.occupation),
    EmergencyContactName: clean(input.EmergencyContactName || input.emergencyContactName),
    EmergencyContactPhone: clean(input.EmergencyContactPhone || input.emergencyContactPhone),
    PastoralNotes: clean(input.PastoralNotes || input.pastoralNotes),
    Notes: clean(input.Notes || input.notes)
  };
}

export function publicChurchMember(row = {}, capabilities = {}) {
  const copy = { ...row };
  delete copy.__name;
  if (!capabilities.canViewPastoralNotes) delete copy.PastoralNotes;
  return copy;
}

function requireCapability(user, capability) {
  const capabilities = membershipCapabilities(user);
  if (!capabilities[capability]) {
    const error = new Error('This church role is not permitted to perform that membership action.');
    error.status = 403;
    throw error;
  }
  return capabilities;
}

async function requireChurchEdition(env) {
  const [organizationProfile, legacyProfile] = await Promise.all([
    getDocument(env, 'settings', 'organisationProfile').catch(() => null),
    getDocument(env, 'settings', 'schoolProfile').catch(() => null)
  ]);
  const organization = resolveOrganizationConfig({ env, organizationProfile, legacyProfile });
  if (!['church', 'faith', 'organization'].includes(organization.Edition) || !organization.FeatureFlags.members) {
    const error = new Error('Church membership is not enabled for this organisation.');
    error.status = 403;
    throw error;
  }
  return organization;
}

function actorName(user = {}) {
  return clean(user.displayName || user.DisplayName || user.username || user.Username || 'Unknown staff');
}

async function writeMembershipAudit(env, branchId, user, action, entityType, entityId, details = '') {
  const auditId = `MEM-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  await upsertDocument(env, churchCollectionPath(CHURCH_COLLECTIONS.membershipAudit, branchId), auditId, {
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

export async function listChurchMembership(env, user, body = {}) {
  await requireChurchEdition(env);
  const capabilities = requireCapability(user, 'canView');
  const branchId = resolveMembershipBranch(user, body.BranchId || body.branchId);
  const [members, households, audit] = await Promise.all([
    listCollection(env, churchCollectionPath(CHURCH_COLLECTIONS.members, branchId)).catch(() => []),
    listCollection(env, churchCollectionPath(CHURCH_COLLECTIONS.households, branchId)).catch(() => []),
    capabilities.canViewAudit
      ? listCollection(env, churchCollectionPath(CHURCH_COLLECTIONS.membershipAudit, branchId)).catch(() => [])
      : Promise.resolve([])
  ]);
  return {
    ok: true,
    branchId,
    capabilities,
    members: members.map((row) => publicChurchMember(row, capabilities))
      .sort((a, b) => clean(a.DisplayName).localeCompare(clean(b.DisplayName))),
    households: households.map((row) => {
      const copy = { ...row }; delete copy.__name; return copy;
    }).sort((a, b) => clean(a.HouseholdName).localeCompare(clean(b.HouseholdName))),
    audit: audit.sort((a, b) => clean(b.Timestamp).localeCompare(clean(a.Timestamp))).slice(0, 100)
  };
}

export async function saveChurchHousehold(env, user, body = {}) {
  await requireChurchEdition(env);
  requireCapability(user, 'canManageHouseholds');
  const branchId = resolveMembershipBranch(user, body.BranchId || body.branchId);
  const household = normalizeChurchHousehold(body.household || body.Household || body, branchId);
  const path = churchCollectionPath(CHURCH_COLLECTIONS.households, branchId);
  const id = safeChurchDocumentId(household.HouseholdId);
  const existing = await getDocument(env, path, id).catch(() => null);
  const payload = {
    ...(existing || {}),
    ...household,
    CreatedAt: existing?.CreatedAt || nowIso(),
    CreatedBy: existing?.CreatedBy || actorName(user),
    UpdatedAt: nowIso(),
    UpdatedBy: actorName(user)
  };
  delete payload.__id; delete payload.__name;
  await upsertDocument(env, path, id, payload);
  await writeMembershipAudit(env, branchId, user, existing ? 'UPDATE' : 'CREATE', 'Household', household.HouseholdId, household.HouseholdName);
  return { ok: true, message: existing ? 'Household updated.' : 'Household created.', household: payload };
}

export async function saveChurchMember(env, user, body = {}) {
  await requireChurchEdition(env);
  const capabilities = requireCapability(user, 'canEditMembers');
  const branchId = resolveMembershipBranch(user, body.BranchId || body.branchId);
  const incoming = body.member || body.Member || body;
  if ((incoming.PastoralNotes !== undefined || incoming.pastoralNotes !== undefined) && !capabilities.canEditPastoralNotes) {
    const error = new Error('Only a Pastor or Super Admin may edit pastoral notes.');
    error.status = 403;
    throw error;
  }
  const member = normalizeChurchMember(incoming, branchId);
  const memberPath = churchCollectionPath(CHURCH_COLLECTIONS.members, branchId);
  const id = safeChurchDocumentId(member.MemberId);
  const existing = await getDocument(env, memberPath, id);
  const originalMemberId = clean(
    body.OriginalMemberId || body.originalMemberId ||
    incoming.OriginalMemberId || incoming.originalMemberId
  );
  assertImmutableRecordIdentity('Member ID', member.MemberId, originalMemberId, existing?.MemberId);
  if (existing && resolveMembershipBranch({}, existing.BranchId || branchId) !== branchId) {
    throw inputError('The member record belongs to another branch.', 409);
  }
  if (member.HouseholdId) {
    const household = await getDocument(
      env,
      churchCollectionPath(CHURCH_COLLECTIONS.households, branchId),
      safeChurchDocumentId(member.HouseholdId)
    ).catch(() => null);
    if (!household) {
      const error = new Error('The selected household does not exist in this branch.');
      error.status = 400;
      throw error;
    }
  }
  if (!capabilities.canEditPastoralNotes) member.PastoralNotes = clean(existing?.PastoralNotes);
  const payload = {
    ...(existing || {}),
    ...member,
    CreatedAt: existing?.CreatedAt || nowIso(),
    CreatedBy: existing?.CreatedBy || actorName(user),
    UpdatedAt: nowIso(),
    UpdatedBy: actorName(user)
  };
  delete payload.__id; delete payload.__name;
  await upsertDocument(env, memberPath, id, payload, recordWritePrecondition(existing));
  await writeMembershipAudit(env, branchId, user, existing ? 'UPDATE' : 'CREATE', 'Member', member.MemberId, member.DisplayName);
  return {
    ok: true,
    message: existing ? 'Member profile updated.' : 'Member profile created.',
    member: publicChurchMember(payload, capabilities)
  };
}

export async function importChurchMembers(env, user, body = {}) {
  await requireChurchEdition(env);
  const capabilities = requireCapability(user, 'canEditMembers');
  const branchId = resolveMembershipBranch(user, body.BranchId || body.branchId);
  const rows = validatedCsvImportRows(body.members, 'member');
  const path = churchCollectionPath(CHURCH_COLLECTIONS.members, branchId);
  const [existingMembers, households] = await Promise.all([
    listCollection(env, path),
    listCollection(env, churchCollectionPath(CHURCH_COLLECTIONS.households, branchId))
  ]);
  const existingById = new Map(existingMembers.map((row) => [safeChurchDocumentId(row.MemberId || row.__id), row]));
  const householdIds = new Set(households.map((row) => safeChurchDocumentId(row.HouseholdId || row.__id)));
  const seen = new Set();
  const writes = rows.map((row) => {
    const member = normalizeChurchMember(row, branchId);
    const id = safeChurchDocumentId(member.MemberId);
    if (seen.has(id)) throw inputError(`Duplicate MemberId in import: ${member.MemberId}`);
    seen.add(id);
    if (member.HouseholdId && !householdIds.has(safeChurchDocumentId(member.HouseholdId))) {
      throw inputError(`Household ${member.HouseholdId} does not exist in branch ${branchId}.`);
    }
    const existing = existingById.get(id);
    if (!capabilities.canEditPastoralNotes) member.PastoralNotes = clean(existing?.PastoralNotes);
    return {
      collectionPath: path,
      documentId: id,
      data: {
        ...stripFirestoreMetadata(existing),
        ...member,
        CreatedAt: existing?.CreatedAt || nowIso(),
        CreatedBy: existing?.CreatedBy || actorName(user),
        UpdatedAt: nowIso(),
        UpdatedBy: actorName(user),
        ImportSource: 'CSV'
      }
    };
  });
  const imported = writes.length;
  const auditId = `MEM-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  writes.push({
    collectionPath: churchCollectionPath(CHURCH_COLLECTIONS.membershipAudit, branchId),
    documentId: auditId,
    data: {
      AuditId: auditId,
      Timestamp: nowIso(),
      Action: 'IMPORT',
      EntityType: 'Member',
      EntityId: `${imported} records`,
      BranchId: branchId,
      Actor: actorName(user),
      ActorUsername: clean(user.username || user.Username),
      ActorRole: clean(user.role || user.Role),
      Details: 'CSV member import'
    }
  });
  await batchUpsertDocuments(env, writes);
  return { ok: true, message: `${imported} member record(s) imported.`, imported };
}

export async function handleChurchMembershipAction(env, user, body = {}) {
  const action = lower(body.Action || body.action || 'list');
  if (['list', 'getchurchmembership'].includes(action)) return listChurchMembership(env, user, body);
  if (['savemember', 'savechurchmember'].includes(action)) return saveChurchMember(env, user, body);
  if (['savehousehold', 'savechurchhousehold'].includes(action)) return saveChurchHousehold(env, user, body);
  if (['importmembers', 'importchurchmembers'].includes(action)) return importChurchMembers(env, user, body);
  const error = new Error('Choose a valid church membership action.');
  error.status = 400;
  throw error;
}
