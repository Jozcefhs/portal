import {
  batchCommitDocuments,
  getDocument,
  listCollectionPage,
  listRootCollectionIds,
  upsertDocument
} from './firestore.js';
import { requiredDeploymentIdentity } from './deployment-identity.js';
import { CHURCH_COLLECTIONS, churchCollectionPath } from './church-foundation.js';
import { getSchoolStructure, schoolCollectionPaths } from './school-scope.js';
import {
  STAFF_ATTENDANCE_COLLECTIONS,
  canonicalStaffAttendanceCollectionPath,
  legacyStaffAttendanceCollectionPath
} from './staff-attendance-storage.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const nowIso = () => new Date().toISOString();

export const ORGANIZATION_BACKUP_FORMAT = 'dynamax-organization-backup';
export const ORGANIZATION_BACKUP_VERSION = 3;
const RESTORE_JOB_COLLECTION = 'systemRestoreJobs';
const MAX_RESTORE_DOCUMENTS = 200;

const EXCLUDED_ROOT_COLLECTIONS = new Set([
  RESTORE_JOB_COLLECTION,
  'requestIdempotency',
  'requestRateLimits',
  'staffLoginAttempts',
  'staffMfaChallenges',
  'staffMfaProfiles',
  'staffPasskeys',
  'staffPasskeyChallenges',
  'staffPasskeyOptionAttempts',
  'applicationSubmissionClaims'
]);

const SCHOOL_SCOPED_COLLECTIONS = Object.freeze([
  'applications',
  'students',
  'studentConductCases',
  'studentConductAudit'
]);

const EXTRA_NESTED_COLLECTIONS = Object.freeze([
  'settings/academics/classes',
  'settings/admission/classes'
]);

const SENSITIVE_SETTING_FIELDS = Object.freeze([
  'BrevoApiKey', 'ApiKey', 'Secret', 'PrivateKey', 'AccessToken',
  'GoogleAppsScriptSecret', 'DocumentStorageSecret'
]);

const IDENTITY_SETTING_FIELDS = Object.freeze([
  'WorkspaceId', 'DeploymentWorkspaceId', 'Edition', 'OrganisationEdition', 'OrganizationEdition',
  'SubscriptionPlan', 'SubscriptionStatus', 'SubscriptionActive', 'SubscriptionExpiresAt',
  'SubscriptionStartedAt', 'FeatureEntitlements', 'FeatureFlags', 'MaximumActiveUsers', 'MaxUsers'
]);

function safePath(value) {
  const path = clean(value).replace(/^\/+|\/+$/g, '');
  if (!path || path.split('/').some((part) => !part || part === '.' || part === '..')) return '';
  return path;
}

function withoutTransportMetadata(row = {}) {
  const copy = { ...row };
  delete copy.__name;
  delete copy.__createTime;
  delete copy.__updateTime;
  delete copy.__scopePath;
  return copy;
}

export function sanitizeBackupDocument(collectionPath, row = {}) {
  const copy = withoutTransportMetadata(row);
  const redactedFields = [];
  if (safePath(collectionPath) === 'settings') {
    SENSITIVE_SETTING_FIELDS.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(copy, field)) {
        delete copy[field];
        redactedFields.push(field);
      }
    });
  }
  if (redactedFields.length) copy.__redactedFields = redactedFields;
  return copy;
}

export async function organizationBackupDescriptors(env) {
  const identity = requiredDeploymentIdentity(env);
  const [rootIds, structure] = await Promise.all([
    listRootCollectionIds(env),
    getSchoolStructure(env)
  ]);
  const descriptors = rootIds
    .filter((collection) => !EXCLUDED_ROOT_COLLECTIONS.has(collection))
    .map((path) => ({ key: path, path, type: 'root' }));
  descriptors.push(...EXTRA_NESTED_COLLECTIONS.map((path) => ({ key: path, path, type: 'nested' })));
  const branches = structure.Branches?.length ? structure.Branches : [{ Id: 'main' }];
  branches.forEach((branch) => Object.keys(STAFF_ATTENDANCE_COLLECTIONS).forEach((key) => {
    const branchId = branch.Id || branch.id || 'main';
    const canonicalPath = canonicalStaffAttendanceCollectionPath(identity.edition, key, branchId);
    const legacyPath = legacyStaffAttendanceCollectionPath(key, branchId);
    descriptors.push({ key: canonicalPath, path: canonicalPath, type: 'staff-attendance' });
    descriptors.push({ key: legacyPath, path: legacyPath, type: 'staff-attendance-legacy' });
  }));
  if (identity.edition === 'school') {
    const schoolPaths = (await Promise.all(
      SCHOOL_SCOPED_COLLECTIONS.map((collection) => schoolCollectionPaths(env, collection))
    )).flat();
    descriptors.push(...schoolPaths.map((path) => ({ key: path, path, type: 'school' })));
  } else {
    branches.forEach((branch) => Object.values(CHURCH_COLLECTIONS).forEach((collection) => {
      const path = churchCollectionPath(collection, branch.Id || branch.id || 'main');
      descriptors.push({ key: path, path, type: 'organisation' });
    }));
  }
  const unique = new Map();
  descriptors.forEach((descriptor) => {
    const path = safePath(descriptor.path);
    if (path && !unique.has(path)) unique.set(path, { ...descriptor, key: path, path });
  });
  return [...unique.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export async function exportOrganizationBackupPage(env, options = {}) {
  const descriptors = await organizationBackupDescriptors(env);
  const cursor = Math.floor(Math.max(0, Number(options.cursor || 0) || 0));
  const pageToken = clean(options.pageToken);
  if (cursor >= descriptors.length && descriptors.length) {
    const error = new Error('The backup cursor is invalid. Start a new backup.');
    error.status = 400;
    error.code = 'BACKUP_CURSOR_INVALID';
    throw error;
  }
  const descriptor = descriptors[cursor];
  const page = descriptor
    ? await listCollectionPage(env, descriptor.path, {
        pageSize: Math.min(500, Math.max(25, Number(options.pageSize || 200) || 200)),
        pageToken
      })
    : { documents: [], nextPageToken: '' };
  const nextCursor = page.nextPageToken ? cursor : cursor + (descriptor ? 1 : 0);
  const complete = !page.nextPageToken && nextCursor >= descriptors.length;
  const identity = requiredDeploymentIdentity(env);
  return {
    ok: true,
    message: complete ? 'Database backup completed.' : 'Backup page prepared.',
    exportedAt: nowIso(),
    identity,
    collections: descriptor
      ? { [descriptor.path]: page.documents.map((row) => sanitizeBackupDocument(descriptor.path, row)) }
      : {},
    backup: {
      format: ORGANIZATION_BACKUP_FORMAT,
      version: ORGANIZATION_BACKUP_VERSION,
      complete,
      cursor,
      nextCursor: complete ? null : nextCursor,
      nextPageToken: complete ? null : (page.nextPageToken || null),
      currentCollection: descriptor?.path || '',
      totalCollections: descriptors.length,
      processedCollections: complete ? descriptors.length : nextCursor,
      pageSize: Number(options.pageSize || 200) || 200
    }
  };
}

function restoreError(message, status = 400, code = 'BACKUP_RESTORE_INVALID') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function restoreActor(user = {}) {
  return {
    username: lower(user.username || user.Username || user.__id),
    displayName: clean(user.displayName || user.DisplayName || user.username || user.Username),
    role: clean(user.role || user.Role)
  };
}

function validateManifest(identity, manifest = {}) {
  if (clean(manifest.format) !== ORGANIZATION_BACKUP_FORMAT) throw restoreError('This is not a Dynamax organisation backup.');
  if (Number(manifest.formatVersion || manifest.version) > ORGANIZATION_BACKUP_VERSION) {
    throw restoreError('This backup was created by a newer Dynamax version. Update the application before restoring it.', 409, 'BACKUP_VERSION_NEWER');
  }
  if (lower(manifest.workspaceId) !== identity.workspaceId || lower(manifest.edition) !== identity.edition) {
    throw restoreError('This backup belongs to a different organisation workspace or edition.', 409, 'BACKUP_IDENTITY_MISMATCH');
  }
}

function restoreCollectionPathAllowed(path, discoveredPaths, edition) {
  if (discoveredPaths.has(path)) return true;
  const parts = path.split('/');
  if (EXCLUDED_ROOT_COLLECTIONS.has(parts[0])) return false;
  // Firestore removes a collection from discovery when its final document is
  // deleted. Permit a well-formed root collection from an older backup so it
  // can genuinely recover data that no longer exists in the live database.
  if (parts.length === 1) return /^[A-Za-z0-9._-]{1,128}$/.test(parts[0]);
  if (EXTRA_NESTED_COLLECTIONS.includes(path)) return true;
  const canonicalAttendanceCollections = new Set(Object.values(STAFF_ATTENDANCE_COLLECTIONS));
  const legacyAttendanceCollections = new Set(
    Object.keys(STAFF_ATTENDANCE_COLLECTIONS).map((key) => legacyStaffAttendanceCollectionPath(key, 'main').split('/')[2])
  );
  const isAttendancePath = parts.length === 3
    && /^[a-z0-9._-]+$/i.test(parts[1])
    && (
      (parts[0] === (edition === 'school' ? 'schoolBranches' : 'organisationBranches')
        && canonicalAttendanceCollections.has(parts[2]))
      || (parts[0] === 'organisationBranches' && legacyAttendanceCollections.has(parts[2]))
    );
  if (isAttendancePath) return true;
  if (edition === 'school') {
    return /^schoolBranches\/[a-z0-9._-]+\/sections\/(?:primary|secondary)\/(?:applications|students|studentConductCases|studentConductAudit)$/i.test(path);
  }
  const churchCollections = new Set(Object.values(CHURCH_COLLECTIONS));
  return parts.length === 3
    && parts[0] === 'organisationBranches'
    && /^[a-z0-9._-]+$/i.test(parts[1])
    && churchCollections.has(parts[2]);
}

async function currentRestoreJob(env, jobId, actor) {
  const id = clean(jobId);
  if (!id) throw restoreError('Restore job ID is required.');
  const job = await getDocument(env, RESTORE_JOB_COLLECTION, id);
  if (!job) throw restoreError('This restore session no longer exists.', 404, 'BACKUP_RESTORE_JOB_MISSING');
  if (lower(job.ActorUsername) !== actor.username) throw restoreError('This restore session belongs to another administrator.', 403, 'BACKUP_RESTORE_ACTOR_MISMATCH');
  if (Date.parse(clean(job.ExpiresAt)) <= Date.now()) throw restoreError('This restore session has expired. Start again.', 410, 'BACKUP_RESTORE_EXPIRED');
  if (!['Prepared', 'Restoring'].includes(clean(job.Status))) throw restoreError('This restore session is no longer active.', 409, 'BACKUP_RESTORE_NOT_ACTIVE');
  return job;
}

export async function prepareOrganizationRestore(env, user, manifest = {}, collectionPaths = [], safetyBackupCreated = false) {
  const actor = restoreActor(user);
  if (actor.role !== 'Super Admin') throw restoreError('Only a Super Administrator can restore organisation data.', 403, 'BACKUP_RESTORE_FORBIDDEN');
  if (!safetyBackupCreated) throw restoreError('Create and download the automatic safety backup before restoring older data.', 409, 'BACKUP_SAFETY_REQUIRED');
  const identity = requiredDeploymentIdentity(env);
  validateManifest(identity, manifest);
  const allowed = new Set((await organizationBackupDescriptors(env)).map(({ path }) => path));
  const requested = [...new Set((Array.isArray(collectionPaths) ? collectionPaths : []).map(safePath).filter(Boolean))];
  if (!requested.length) throw restoreError('The selected backup contains no restorable collections.');
  requested.forEach((path) => {
    if (!restoreCollectionPathAllowed(path, allowed, identity.edition)) {
      throw restoreError(`The backup collection "${path}" is not valid for this organisation.`, 409, 'BACKUP_COLLECTION_NOT_ALLOWED');
    }
  });
  const jobId = `RESTORE-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const createdAt = nowIso();
  await upsertDocument(env, RESTORE_JOB_COLLECTION, jobId, {
    JobId: jobId,
    Status: 'Prepared',
    ActorUsername: actor.username,
    Actor: actor.displayName,
    WorkspaceId: identity.workspaceId,
    Edition: identity.edition,
    BackupCreatedAt: clean(manifest.createdAt),
    CollectionPaths: requested,
    CreatedAt: createdAt,
    UpdatedAt: createdAt,
    ExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
  });
  return { ok: true, jobId, message: 'Secure restore session prepared.', collections: requested.length };
}

function jobAllowsCollection(job, collectionPath) {
  const path = safePath(collectionPath);
  if (!path || !(Array.isArray(job.CollectionPaths) ? job.CollectionPaths : []).includes(path)) {
    throw restoreError('This collection is outside the prepared restore session.', 409, 'BACKUP_COLLECTION_NOT_PREPARED');
  }
  return path;
}

export async function clearOrganizationRestoreCollection(env, user, jobId, collectionPath) {
  const actor = restoreActor(user);
  const job = await currentRestoreJob(env, jobId, actor);
  const path = jobAllowsCollection(job, collectionPath);
  // Settings contain the live deployment and subscription bridge. Keep the
  // collection available while restored fields are overlaid so a recovery
  // cannot lock the administrator out between restore requests. Backup rows
  // still replace their corresponding settings documents during the write.
  if (path === 'settings') {
    await upsertDocument(env, RESTORE_JOB_COLLECTION, clean(jobId), {
      ...withoutTransportMetadata(job),
      Status: 'Restoring',
      UpdatedAt: nowIso()
    });
    return { ok: true, message: 'Settings are ready for protected restore.', removed: 0, more: false };
  }
  const page = await listCollectionPage(env, path, { pageSize: 400 });
  const rows = path === 'staffUsers'
    ? page.documents.filter((row) => lower(row.Username || row.__id) !== actor.username)
    : page.documents;
  if (rows.length) {
    await batchCommitDocuments(env, rows.map((row) => ({
      operation: 'delete', collectionPath: path, documentId: clean(row.__id)
    })));
  }
  await upsertDocument(env, RESTORE_JOB_COLLECTION, clean(jobId), {
    ...withoutTransportMetadata(job),
    Status: 'Restoring',
    UpdatedAt: nowIso()
  });
  return {
    ok: true,
    message: rows.length ? `Cleared ${rows.length} current record(s).` : 'Collection is ready.',
    removed: rows.length,
    more: page.documents.length >= 400
  };
}

async function protectedRestoreDocument(env, path, row, actor) {
  const copy = withoutTransportMetadata(row);
  const id = clean(copy.__id);
  delete copy.__id;
  if (!id) throw restoreError(`A record in "${path}" has no document ID.`);
  if (path === 'staffUsers' && lower(copy.Username || id) === actor.username) return null;
  if (path === 'settings') {
    const current = await getDocument(env, path, id).catch(() => null);
    const redacted = Array.isArray(copy.__redactedFields) ? copy.__redactedFields.map(clean).filter(Boolean) : [];
    delete copy.__redactedFields;
    [...redacted, ...(id === 'organisationProfile' ? IDENTITY_SETTING_FIELDS : [])].forEach((field) => {
      if (current && Object.prototype.hasOwnProperty.call(current, field)) copy[field] = current[field];
    });
  }
  return { collectionPath: path, documentId: id, data: copy };
}

export async function writeOrganizationRestoreChunk(env, user, jobId, collectionPath, documents = []) {
  const actor = restoreActor(user);
  const job = await currentRestoreJob(env, jobId, actor);
  const path = jobAllowsCollection(job, collectionPath);
  const rows = Array.isArray(documents) ? documents : [];
  if (!rows.length || rows.length > MAX_RESTORE_DOCUMENTS) {
    throw restoreError(`Each restore write must contain between 1 and ${MAX_RESTORE_DOCUMENTS} records.`);
  }
  const prepared = (await Promise.all(rows.map((row) => protectedRestoreDocument(env, path, row, actor)))).filter(Boolean);
  if (prepared.length) await batchCommitDocuments(env, prepared);
  return { ok: true, message: `Restored ${prepared.length} record(s).`, restored: prepared.length };
}

export async function completeOrganizationRestore(env, user, jobId) {
  const actor = restoreActor(user);
  const job = await currentRestoreJob(env, jobId, actor);
  await upsertDocument(env, RESTORE_JOB_COLLECTION, clean(jobId), {
    ...withoutTransportMetadata(job),
    Status: 'Completed',
    CompletedAt: nowIso(),
    UpdatedAt: nowIso()
  });
  return { ok: true, message: 'Organisation data restore completed successfully.', restoredAt: nowIso() };
}
