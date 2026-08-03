import { batchCommitDocuments, getDocument, listCollection, queryCollection, upsertDocument } from './firestore.js';
import { CHURCH_COLLECTIONS, churchCollectionPath, safeChurchDocumentId } from './church-foundation.js';
import { resolveMembershipBranch } from './church-membership.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const nowIso = () => new Date().toISOString();
const MANAGE_ROLES = new Set(['Super Admin', 'Church Administrator']);
const REPORT_ROLES = new Set([...MANAGE_ROLES, 'Pastor', 'Treasurer', 'Auditor']);

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function actorId(user = {}) {
  return lower(user.username || user.Username || user.email || user.Email);
}

function actorName(user = {}) {
  return clean(user.displayName || user.DisplayName || user.username || user.Username || 'Church staff');
}

function branchFor(user, body = {}) {
  return resolveMembershipBranch(user, body.BranchId || body.branchId || 'main');
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

export function haversineDistanceMetres(lat1, lon1, lat2, lon2) {
  const values = [lat1, lon1, lat2, lon2].map(number);
  if (values.some((value) => !Number.isFinite(value))) return Infinity;
  const [aLat, aLon, bLat, bLon] = values.map((value) => value * Math.PI / 180);
  const deltaLat = bLat - aLat;
  const deltaLon = bLon - aLon;
  const hav = Math.sin(deltaLat / 2) ** 2 + Math.cos(aLat) * Math.cos(bLat) * Math.sin(deltaLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(hav), Math.sqrt(1 - hav));
}

export function normalizeAttendanceSite(input = {}, existing = {}) {
  const name = clean(input.Name || input.SiteName || existing.Name);
  const latitude = number(input.Latitude ?? existing.Latitude);
  const longitude = number(input.Longitude ?? existing.Longitude);
  const radius = number(input.RadiusMetres ?? existing.RadiusMetres ?? 150);
  const maxAccuracy = number(input.MaxAccuracyMetres ?? existing.MaxAccuracyMetres ?? 100);
  const policy = clean(input.Policy || existing.Policy || 'GEOFENCE_OR_NETWORK').toUpperCase();
  const allowedPolicies = new Set(['GEOFENCE_ONLY', 'NETWORK_ONLY', 'GEOFENCE_OR_NETWORK']);
  if (!name) fail('Enter a location name.');
  if ((!Number.isFinite(latitude) || !Number.isFinite(longitude)) && policy !== 'NETWORK_ONLY') {
    fail('Enter valid latitude and longitude for this attendance location.');
  }
  if (!Number.isFinite(radius) || radius < 20 || radius > 5000) fail('The allowed radius must be between 20 and 5,000 metres.');
  if (!Number.isFinite(maxAccuracy) || maxAccuracy < 10 || maxAccuracy > 2000) fail('Maximum location accuracy must be between 10 and 2,000 metres.');
  if (!allowedPolicies.has(policy)) fail('Choose a valid attendance verification policy.');
  const ips = Array.isArray(input.AllowedPublicIps)
    ? input.AllowedPublicIps
    : clean(input.AllowedPublicIps ?? existing.AllowedPublicIps).split(/[\s,]+/);
  return {
    Name: name,
    Latitude: Number.isFinite(latitude) ? latitude : null,
    Longitude: Number.isFinite(longitude) ? longitude : null,
    RadiusMetres: radius,
    MaxAccuracyMetres: maxAccuracy,
    Policy: policy,
    AllowedPublicIps: [...new Set(ips.map(clean).filter(Boolean))],
    Active: lower(input.Active ?? existing.Active ?? 'YES') === 'no' ? 'NO' : 'YES'
  };
}

export function evaluateAttendancePresence(site = {}, location = {}, clientIp = '') {
  const policy = clean(site.Policy || 'GEOFENCE_OR_NETWORK').toUpperCase();
  const accuracy = number(location.Accuracy ?? location.accuracy);
  const distance = haversineDistanceMetres(
    site.Latitude,
    site.Longitude,
    location.Latitude ?? location.latitude,
    location.Longitude ?? location.longitude
  );
  const geofencePassed = Number.isFinite(distance)
    && distance <= number(site.RadiusMetres || 150)
    && Number.isFinite(accuracy)
    && accuracy <= number(site.MaxAccuracyMetres || 100);
  const networkPassed = (site.AllowedPublicIps || []).map(clean).includes(clean(clientIp));
  const passed = policy === 'GEOFENCE_ONLY'
    ? geofencePassed
    : policy === 'NETWORK_ONLY'
      ? networkPassed
      : geofencePassed || networkPassed;
  return {
    passed,
    geofencePassed,
    networkPassed,
    distanceMetres: Number.isFinite(distance) ? Math.round(distance) : null,
    accuracyMetres: Number.isFinite(accuracy) ? Math.round(accuracy) : null,
    verificationMethod: geofencePassed ? 'Geofence' : networkPassed ? 'Organisation network' : 'Not verified'
  };
}

async function ipFingerprint(value) {
  const data = new TextEncoder().encode(clean(value));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, '0')).join('').slice(0, 20);
}

export async function listStaffAttendance(env, user, body = {}) {
  const branchId = branchFor(user, body);
  const username = actorId(user);
  if (!username) fail('The signed-in staff account has no username.', 401);
  const role = clean(user.role || user.Role);
  const [sites, events, storedState] = await Promise.all([
    listCollection(env, churchCollectionPath(CHURCH_COLLECTIONS.staffAttendanceSites, branchId)).catch(() => []),
    queryCollection(env, churchCollectionPath(CHURCH_COLLECTIONS.staffTimeEvents, branchId), {
      orderBy: [{ field: 'Timestamp', direction: 'DESCENDING' }],
      limit: 500
    }).catch(() => []),
    getDocument(
      env,
      churchCollectionPath(CHURCH_COLLECTIONS.staffTimeState, branchId),
      safeChurchDocumentId(username)
    ).catch(() => null)
  ]);
  const sorted = events.sort((a, b) => clean(b.Timestamp).localeCompare(clean(a.Timestamp)));
  const sortedSites = sites.sort((a, b) => clean(a.Name).localeCompare(clean(b.Name)));
  const own = sorted.filter((row) => actorId(row) === username).slice(0, 100);
  const latest = own[0] || null;
  return {
    ok: true,
    branchId,
    sites: sortedSites.filter((row) => lower(row.Active || 'YES') !== 'no'),
    configuredSites: MANAGE_ROLES.has(role) ? sortedSites : [],
    myEvents: own,
    recentEvents: REPORT_ROLES.has(role) ? sorted.slice(0, 250) : [],
    state: clean(storedState?.State) || (latest?.Direction === 'IN' ? 'CLOCKED_IN' : 'CLOCKED_OUT'),
    nextDirection: clean(storedState?.NextDirection) || (latest?.Direction === 'IN' ? 'OUT' : 'IN'),
    stateVersion: clean(storedState?.__updateTime),
    capabilities: { canManage: MANAGE_ROLES.has(role), canReport: REPORT_ROLES.has(role) }
  };
}

export async function saveAttendanceSite(env, user, body = {}) {
  if (!MANAGE_ROLES.has(clean(user.role || user.Role))) fail('Only church administrators can manage attendance locations.', 403);
  const branchId = branchFor(user, body);
  const id = safeChurchDocumentId(clean(body.SiteId) || `SITE-${crypto.randomUUID().slice(0, 8)}`);
  const site = {
    SiteId: id,
    ...normalizeAttendanceSite(body),
    BranchId: branchId,
    UpdatedAt: nowIso(),
    UpdatedBy: actorName(user)
  };
  await upsertDocument(env, churchCollectionPath(CHURCH_COLLECTIONS.staffAttendanceSites, branchId), id, site);
  return { ok: true, site, message: 'Attendance location saved.' };
}

export async function clockStaffAttendance(env, user, body = {}, requestContext = {}) {
  const branchId = branchFor(user, body);
  const username = actorId(user);
  if (!username) fail('The signed-in staff account has no username.', 401);
  const siteId = safeChurchDocumentId(body.SiteId);
  if (!siteId) fail('Choose the attendance location.');
  const workspace = await listStaffAttendance(env, user, body);
  const site = workspace.sites.find((row) => safeChurchDocumentId(row.SiteId || row.__id) === siteId);
  if (!site) fail('The selected attendance location is inactive or unavailable.', 404);
  const presence = evaluateAttendancePresence(site, body.Location || body, requestContext.clientIp || '');
  if (!presence.passed) {
    const details = presence.accuracyMetres && presence.accuracyMetres > Number(site.MaxAccuracyMetres)
      ? 'Your device location is not accurate enough. Move outdoors or connect to the approved organisation network.'
      : 'You appear to be outside the approved premises and network.';
    fail(details, 403);
  }
  const expected = workspace.nextDirection;
  const direction = clean(body.Direction || expected).toUpperCase();
  if (!['IN', 'OUT'].includes(direction)) fail('Choose Clock in or Clock out.');
  if (direction !== expected) fail(expected === 'IN' ? 'You are already clocked out.' : 'You are already clocked in.', 409);
  const timestamp = nowIso();
  const eventId = safeChurchDocumentId(`TIME-${timestamp}-${username}-${crypto.randomUUID().slice(0, 8)}`);
  const event = {
    EventId: eventId,
    BranchId: branchId,
    Username: username,
    DisplayName: actorName(user),
    Role: clean(user.role || user.Role),
    Direction: direction,
    Timestamp: timestamp,
    SiteId: siteId,
    SiteName: clean(site.Name),
    VerificationMethod: presence.verificationMethod,
    DistanceMetres: presence.distanceMetres,
    AccuracyMetres: presence.accuracyMetres,
    IpFingerprint: await ipFingerprint(requestContext.clientIp || ''),
    Notes: clean(body.Notes),
    ManualOverride: false
  };
  const eventPath = churchCollectionPath(CHURCH_COLLECTIONS.staffTimeEvents, branchId);
  const statePath = churchCollectionPath(CHURCH_COLLECTIONS.staffTimeState, branchId);
  const stateDocument = {
    Username: username,
    BranchId: branchId,
    State: direction === 'IN' ? 'CLOCKED_IN' : 'CLOCKED_OUT',
    NextDirection: direction === 'IN' ? 'OUT' : 'IN',
    LastEventId: eventId,
    LastTimestamp: timestamp,
    UpdatedAt: timestamp
  };
  await batchCommitDocuments(env, [
    { collectionPath: eventPath, documentId: eventId, data: event, exists: false },
    {
      collectionPath: statePath,
      documentId: safeChurchDocumentId(username),
      data: stateDocument,
      ...(workspace.stateVersion ? { updateTime: workspace.stateVersion } : { exists: false })
    }
  ]);
  return { ok: true, event, state: direction === 'IN' ? 'CLOCKED_IN' : 'CLOCKED_OUT', message: direction === 'IN' ? 'Clock-in recorded.' : 'Clock-out recorded.' };
}

export async function recordManualAttendance(env, user, body = {}) {
  if (!MANAGE_ROLES.has(clean(user.role || user.Role))) fail('Only church administrators can record an attendance correction.', 403);
  const branchId = branchFor(user, body);
  const username = lower(body.Username);
  const direction = clean(body.Direction).toUpperCase();
  const reason = clean(body.Reason);
  if (!username) fail('Enter the staff username.');
  if (!['IN', 'OUT'].includes(direction)) fail('Choose Clock in or Clock out.');
  if (reason.length < 5) fail('Enter a clear reason for the manual correction.');
  const timestamp = clean(body.Timestamp) || nowIso();
  const eventId = safeChurchDocumentId(`MANUAL-${timestamp}-${username}-${crypto.randomUUID().slice(0, 8)}`);
  const event = {
    EventId: eventId,
    BranchId: branchId,
    Username: username,
    DisplayName: clean(body.DisplayName) || username,
    Direction: direction,
    Timestamp: timestamp,
    SiteId: clean(body.SiteId),
    SiteName: clean(body.SiteName),
    VerificationMethod: 'Authorised correction',
    ManualOverride: true,
    OverrideReason: reason,
    RecordedBy: actorName(user),
    CreatedAt: nowIso()
  };
  const eventPath = churchCollectionPath(CHURCH_COLLECTIONS.staffTimeEvents, branchId);
  const auditPath = churchCollectionPath(CHURCH_COLLECTIONS.staffTimeAudit, branchId);
  const statePath = churchCollectionPath(CHURCH_COLLECTIONS.staffTimeState, branchId);
  const stateId = safeChurchDocumentId(username);
  const currentState = await getDocument(env, statePath, stateId).catch(() => null);
  await batchCommitDocuments(env, [
    { collectionPath: eventPath, documentId: eventId, data: event, exists: false },
    { collectionPath: auditPath, documentId: eventId, data: { ...event, Action: 'MANUAL_ATTENDANCE_CORRECTION' }, exists: false },
    {
      collectionPath: statePath,
      documentId: stateId,
      data: {
        Username: username,
        BranchId: branchId,
        State: direction === 'IN' ? 'CLOCKED_IN' : 'CLOCKED_OUT',
        NextDirection: direction === 'IN' ? 'OUT' : 'IN',
        LastEventId: eventId,
        LastTimestamp: timestamp,
        UpdatedAt: nowIso(),
        UpdatedBy: actorName(user)
      },
      ...(currentState?.__updateTime ? { updateTime: currentState.__updateTime } : { exists: false })
    }
  ]);
  return { ok: true, event, message: 'Attendance correction recorded with an audit trail.' };
}

export async function handleStaffAttendanceAction(env, user, body = {}, requestContext = {}) {
  const action = lower(body.action || body.Action || 'list');
  if (action === 'list') return listStaffAttendance(env, user, body);
  if (action === 'savesite') return saveAttendanceSite(env, user, body);
  if (action === 'clock') return clockStaffAttendance(env, user, body, requestContext);
  if (action === 'manual') return recordManualAttendance(env, user, body);
  fail('Choose a valid staff attendance action.');
}
