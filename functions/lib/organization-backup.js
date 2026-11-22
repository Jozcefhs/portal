import { assertResetJobScope, branchOwnsResetRecord, branchResetPathAllowed, clearBranchResetRecords, resetBranchId } from './branch-reset.js';
import { branchResetFilePrefixes } from './document-storage.js';
import { hasFullModuleAccess } from './module-authority.js';
import { assignedStaffBranches } from './staff-branch-access.js';
import {
  batchCommitDocuments,
  getDocument,
  listCollectionPage,
  listRootCollectionIds,
  queryCollection,
  upsertDocument
} from './firestore.js';
import { requiredDeploymentIdentity } from './deployment-identity.js';
import { CHURCH_COLLECTIONS, churchCollectionPath } from './church-foundation.js';
import { getSchoolStructure, normalizeSchoolStructure, schoolCollectionPaths } from './school-scope.js';
import {
  beginStaffAccountChange,
  commitStaffAccountChanges,
  staffAccountCondition,
  staffAccountDocumentId
} from './staff-account-integrity.js';
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
  'staffPasswordRecovery',
  'staffPasswordRecoveryLimits',
  'parentPasswordRecovery',
  'parentPasswordRecoveryLimits',
  'staffCredentialRevocations',
  'schoolSetupCredentials',
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

const SCHOOL_BRANCH_SETTING_COLLECTIONS = Object.freeze([
  'schoolClasses',
  'admissionClasses'
]);

const EXTRA_NESTED_COLLECTIONS = Object.freeze([
  'settings/academics/classes',
  'settings/admission/classes'
]);

const SENSITIVE_SETTING_FIELDS = Object.freeze([
  'BrevoApiKey', 'ApiKey', 'Secret', 'PrivateKey', 'AccessToken',
  'GoogleAppsScriptSecret', 'DocumentStorageSecret'
]);

const SUBSCRIPTION_IDENTITY_SETTING_FIELDS = Object.freeze([
  'Plan', 'PlanEntitlements', 'PlanModuleCatalogVersion', 'SubscriptionPriceSnapshot'
]);

const IDENTITY_SETTING_FIELDS = Object.freeze([
  'WorkspaceId', 'DeploymentWorkspaceId', 'Edition', 'OrganisationEdition', 'OrganizationEdition',
  'SubscriptionPlan', 'SubscriptionStatus', 'SubscriptionActive', 'SubscriptionExpiresAt',
  'SubscriptionStartedAt', 'FeatureEntitlements', 'FeatureFlags', 'MaximumActiveUsers', 'MaxUsers',
  ...SUBSCRIPTION_IDENTITY_SETTING_FIELDS
]);

const RESET_PRESERVED_ROOT_COLLECTIONS = new Set([
  'schoolsetupcredentials',
  'settings',
  'staffusers',
  'organisationbranches',
  'organizationbranches',
  'rolemoduleaccess',
  'subscriptions',
  'subscriptionpayments',
  'tenantregistrations',
  'tenantprojectpool',
  'managedorganisations',
  'managedorganizations'
]);

const RESET_PRESERVED_ROOT_PREFIXES = Object.freeze([
  'deployment',
  'feature',
  'integration',
  'permission',
  'role',
  'subscription',
  'tenant',
  'workspace'
]);

function safePath(value) {
  const path = clean(value).replace(/^\/+|\/+$/g, '');
  if (!path || path.split('/').some((part) => !part || part === '.' || part === '..')) return '';
  return path;
}

export function isOrganizationResetProtectedPath(value) {
  const path = safePath(value);
  if (!path) return true;
  const parts = path.split('/');
  const root = lower(parts[0]);
  // Preserve branch identity documents, while allowing their explicitly
  // discovered operational subcollections (students, applications, conduct)
  // to be cleared.
  if (root === 'schoolbranches') return parts.length === 1;
  if (RESET_PRESERVED_ROOT_COLLECTIONS.has(root)) return true;
  if (RESET_PRESERVED_ROOT_PREFIXES.some((prefix) => root.startsWith(prefix))) return true;
  return /(?:config|configuration|policies|policy|settings|structures|structure|templates|template)$/.test(root);
}

async function organizationResetPlan(env, user, options) {
  const actor = restoreActor(user);
  if (actor.role !== 'Super Admin' && !actor.fullBackupAccess) throw restoreError('Administrator permission is required for branch reset.', 403);
  const branchId = resetBranchId(options?.branchId);
  const working = clean(user.branchId || user.BranchId);
  if (working && working !== 'all' && working !== branchId) throw restoreError('Switch to the selected working branch before resetting.', 403);
  const identity = requiredDeploymentIdentity(env);
  // A temporary read error must never resolve to the default branch for deletion.
  const structure = normalizeSchoolStructure(await getDocument(env, 'settings', 'schoolStructure') || {});
  const branch = structure.Branches.find(row => row.Id === branchId);
  if (!branch) throw restoreError('Choose a branch configured in this workspace.', 409);
  const includeFiles = options.includeFiles === true;
  if (includeFiles && (!env.DYNAMAX_DOCUMENTS?.list || !env.DYNAMAX_DOCUMENTS?.head || !env.DYNAMAX_DOCUMENTS?.delete)) {
    throw restoreError('Private storage must be connected to include branch files.', 503, 'RESET_R2_NOT_CONFIGURED');
  }
  if (includeFiles && branchId === 'main') {
    // Older writers used 'main' as a fallback for missing ownership.
    throw restoreError('Main Branch shares a legacy file prefix with unassigned uploads. Keep uploaded files for this reset.', 409);
  }
  if (includeFiles && structure.Branches.some(row => row.Id !== branchId && row.Id.replace(/^[._-]+|[._-]+$/g, '') === branchId)) {
    throw restoreError('Two branch identifiers share a storage prefix. Keep uploaded files for this reset.', 409);
  }
  return { identity, branchId, branchName: branch.Name || branchId,
    prefixes: includeFiles ? branchResetFilePrefixes(identity, branchId) : [],
    confirmation: `RESET ${identity.workspaceId} BRANCH ${branchId}${includeFiles ? ' WITH FILES' : ''}`.toUpperCase() };
}

function resetFileEligible(object, prefix, identity, branchId, cutoff) {
  const metadata = object.customMetadata;
  return object.key.startsWith(prefix) && object.key.slice(prefix.length).split('/').length === 4
    && metadata?.workspaceId === identity.workspaceId && metadata?.edition === identity.edition
    && metadata?.branchId === branchId && new Date(object.uploaded).getTime() <= Date.parse(cutoff);
}

export async function previewOrganizationReset(env, user, options = {}) {
  const plan = await organizationResetPlan(env, user, options);
  const cutoff = nowIso();
  let r2ObjectCount = 0;
  for (const prefix of plan.prefixes) {
    let cursor;
    do {
      const page = await env.DYNAMAX_DOCUMENTS.list({ prefix, cursor, limit: 1000, include: ['customMetadata'] });
      r2ObjectCount += page.objects.filter(object => resetFileEligible(object, prefix, plan.identity, plan.branchId, cutoff)).length;
      if (page.truncated && (!page.cursor || page.cursor === cursor)) throw restoreError('Storage preview could not advance.', 503);
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }
  return { ok: true, branchId: plan.branchId, branchName: plan.branchName, workspaceId: plan.identity.workspaceId,
    confirmation: plan.confirmation, cutoff, r2ObjectCount,
    ...(options.countsOnly === true ? { paths: (await organizationBackupDescriptors(env)).map(item => item.path)
      .filter(path => branchResetPathAllowed(path, plan.branchId, plan.identity.edition)) } : {}) };
}

export async function previewBranchResetCountPage(env, user, options) {
  const { identity, branchId } = await organizationResetPlan(env, user, { branchId: options.branchId });
  const path = options.collectionPath;
  if (typeof path !== 'string' || !branchResetPathAllowed(path, branchId, identity.edition)) throw restoreError('Collection outside the selected branch.', 409);
  // Shared collections may use either spelling. Firestore returns each match once for an OR query.
  const rows = await queryCollection(env, path, { orderBy: [{ field: '__name__' }], limit: 250,
    startAfterName: clean(options.cursor), ...(path.includes('/') ? {} : {
      filters: ['BranchId', 'branchId'].map(field => ({ field, op: '==', value: branchId })), filterJoin: 'OR'
    }) });
  const count = rows.filter(row => branchOwnsResetRecord(path, row, branchId, identity.edition)).length;
  return { ok: true, branchId, count, cursor: rows.length === 250 ? rows.at(-1).__name : '' };
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
    if (key === 'daily') {
      const path = canonicalPath.replace(/[^/]+$/, 'hrPresenceReviews');
      descriptors.push({ key: path, path, type: 'staff-presence-reviews' });
    }
  }));
  if (identity.edition === 'school') {
    const schoolPaths = (await Promise.all(
      SCHOOL_SCOPED_COLLECTIONS.map((collection) => schoolCollectionPaths(env, collection))
    )).flat();
    descriptors.push(...schoolPaths.map((path) => ({ key: path, path, type: 'school' })));
    branches.forEach((branch) => SCHOOL_BRANCH_SETTING_COLLECTIONS.forEach((collection) => {
      const branchId = clean(branch.Id || branch.id || 'main').toLowerCase() || 'main';
      const path = `organisationBranches/${branchId}/${collection}`;
      descriptors.push({ key: path, path, type: 'branch-school-setting' });
    }));
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
  const resetRows = [];
  let resetUncertain = 0;
  if (options.resetBranchId && descriptor && branchResetPathAllowed(descriptor.path, options.resetBranchId, identity.edition)) {
    for (const row of page.documents) {
      if (branchOwnsResetRecord(descriptor.path, row, options.resetBranchId, identity.edition)) resetRows.push(row);
      else if (descriptor.path.includes('/') || !row.BranchId && !row.branchId || [row.BranchId, row.branchId].includes(options.resetBranchId)) resetUncertain++;
    }
  }
  return {
    ok: true,
    message: complete ? 'Database backup completed.' : 'Backup page prepared.',
    ...(options.resetBranchId ? { resetSelection: resetRows.map(row => ({ id: row.__id, version: row.__updateTime })), resetUncertain } : {}),
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
    role: clean(user.role || user.Role),
    fullBackupAccess: hasFullModuleAccess(user, 'dataBackup') && assignedStaffBranches(user) === null
  };
}

export function protectRestoreStaffActor(env, actor, rows) {
  // Resolve the destination from live records, never the backup's Username.
  // Legacy account document IDs may differ from the canonical/login username.
  const matches = rows.filter((row) => [row.Username, row.username, row.__id]
    .some((value) => lower(value) === actor.username));
  if (matches.length > 1) {
    throw restoreError('The signed-in administrator has conflicting account records. Resolve them before restoring staff.', 409);
  }
  const current = matches[0];
  const environmentAdmin = actor.role === 'Super Admin'
    && actor.username === lower(env.ADMIN_WEB_USERNAME || 'admin');
  if (!current && !environmentAdmin) {
    throw restoreError('The signed-in administrator account could not be verified. Sign in again before restoring staff.', 409);
  }
  if (current && !clean(current.__id)) {
    throw restoreError('The administrator document identity is missing. Reload before restoring staff.', 409);
  }
  return {
    ...actor,
    protectedStaffIds: new Set([current ? clean(current.__id) : '', staffAccountDocumentId(actor.username)].filter(Boolean)),
    protectedStaffNames: new Set([actor.username, current?.Username, current?.username,
      current?.LoginUsername, current?.loginUsername].map(lower).filter(Boolean))
  };
}

export function isProtectedRestoreStaff(row, actor) {
  return actor.protectedStaffIds?.has(clean(row.__id))
    || [row.Username, row.username, row.UsernameKey, row.LoginUsername, row.loginUsername, row.LoginUsernameKey]
      .some((value) => actor.protectedStaffNames?.has(lower(value)) || lower(value) === actor.username);
}

export function validateManifest(identity, manifest = {}) {
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
    return /^schoolBranches\/[a-z0-9._-]+\/sections\/(?:primary|secondary)\/(?:applications|students|studentConductCases|studentConductAudit)$/i.test(path)
      || /^organisationBranches\/[a-z0-9._-]+\/(?:schoolClasses|admissionClasses)$/i.test(path);
  }
  const churchCollections = new Set(Object.values(CHURCH_COLLECTIONS));
  return parts.length === 3
    && parts[0] === 'organisationBranches'
    && /^[a-z0-9._-]+$/i.test(parts[1])
    && churchCollections.has(parts[2]);
}

export function wholeRestorePathAllowed(path, identity) {
  if (typeof path !== 'string' || !path || path.length > 1024 ||
      !path.split('/').every(part => /^[A-Za-z0-9._-]+$/.test(part) && part !== '.' && part !== '..')) return false;
  const root = path.split('/')[0];
  if (EXCLUDED_ROOT_COLLECTIONS.has(root) || ['tenantregistrations','tenantprojectpool','managedorganisations',
      'managedorganizations','subscriptions','subscriptionpayments'].includes(lower(root))) return false;
  if (path.endsWith('/hrPresenceReviews') && path.split('/').length === 3) {
    return path.startsWith(identity.edition === 'school' ? 'schoolBranches/' : 'organisationBranches/');
  }
  return restoreCollectionPathAllowed(path, new Set(), identity.edition);
}

// Never import credentials or installation identity from an archive. Preserve
// those live fields even when an older archive has no redaction metadata.
export function wholeRestoreFields(path, row, current) {
  const data = Object.fromEntries(Object.entries(row).filter(([field]) => !field.startsWith('__')));
  if (path !== 'settings') return row.__redactedFields ? null : data;
  if (row.__id === 'staffAccountIntegrity') return null;
  const redacted = Array.isArray(row.__redactedFields) ? row.__redactedFields : [];
  if (!current && (redacted.length || row.__id === 'organisationProfile')) return null;
  const protectedFields = [...SENSITIVE_SETTING_FIELDS, ...redacted, ...(row.__id === 'organisationProfile' ? IDENTITY_SETTING_FIELDS : [])];
  for (const field of protectedFields) {
    if (current && Object.hasOwn(current, field)) data[field] = current[field];
    else delete data[field];
  }
  return data;
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
  if (actor.role !== 'Super Admin' && !actor.fullBackupAccess) throw restoreError('Only a Super Administrator can restore organisation data.', 403, 'BACKUP_RESTORE_FORBIDDEN');
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

export async function prepareOrganizationReset(env, user, options = {}) {
  const actor = restoreActor(user);
  if (actor.role !== 'Super Admin' && !actor.fullBackupAccess) throw restoreError('Only a Super Administrator can reset organisation test data.', 403, 'RESET_FORBIDDEN');
  if (options.safetyBackupCreated !== true) {
    throw restoreError('Download the automatic encrypted safety backup before resetting test data.', 409, 'RESET_SAFETY_REQUIRED');
  }
  const plan = await organizationResetPlan(env, user, options);
  if (clean(options.confirmation).toUpperCase() !== plan.confirmation) throw restoreError(`Type ${plan.confirmation} to confirm.`, 409, 'RESET_CONFIRMATION_INVALID');
  const cutoff = clean(options.cutoff);
  const time = Date.parse(cutoff);
  if (!Number.isFinite(time) || time > Date.now() || Date.now() - time > 2 * 3600000) throw restoreError('The preview expired. Preview the branch again.', 409);
  if (!Number.isSafeInteger(options.recordCount) || options.recordCount < 0) throw restoreError('A previewed record count is required.');
  const jobId = `RESET-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const createdAt = nowIso();
  const collectionPaths = (await organizationBackupDescriptors(env)).map(item => item.path)
    .filter(path => path.includes('/') || !isOrganizationResetProtectedPath(path))
    .filter(path => branchResetPathAllowed(path, plan.branchId, plan.identity.edition));
  await upsertDocument(env, RESTORE_JOB_COLLECTION, jobId, {
    JobId: jobId, JobType: 'Reset', Status: 'Prepared', ActorUsername: actor.username, Actor: actor.displayName,
    WorkspaceId: plan.identity.workspaceId, Edition: plan.identity.edition, BranchId: plan.branchId, BranchName: plan.branchName,
    CollectionPaths: collectionPaths, IncludeFiles: options.includeFiles === true, FileIndex: 0, FileCursor: '', FileCutoff: cutoff,
    ExpectedRecords: options.recordCount, RemovedRecords: 0, RemovedObjects: 0, CreatedAt: createdAt, UpdatedAt: createdAt,
    ExpiresAt: new Date(Date.now() + 2 * 3600000).toISOString()
  });
  return { ok: true, jobId, branchId: plan.branchId };
}

async function branchResetJob(env, user, jobId, branchId) {
  const job = await currentRestoreJob(env, jobId, restoreActor(user));
  assertResetJobScope(env, job, branchId, user.branchId || user.BranchId);
  return job;
}

export async function clearOrganizationResetRecords(env, user, body) {
  const job = await branchResetJob(env, user, body.jobId, body.branchId);
  return clearBranchResetRecords(env, job, body.collectionPath, body.selection);
}

function jobAllowsCollection(job, collectionPath) {
  const path = safePath(collectionPath);
  if (!path || !(Array.isArray(job.CollectionPaths) ? job.CollectionPaths : []).includes(path)) {
    throw restoreError('This collection is outside the prepared restore session.', 409, 'BACKUP_COLLECTION_NOT_PREPARED');
  }
  return path;
}

export async function clearOrganizationRestoreCollection(env, user, jobId, collectionPath) {
  let actor = restoreActor(user);
  const job = await currentRestoreJob(env, jobId, actor);
  if (job.JobType === 'Reset') throw restoreError('Reset jobs require a verified branch and previewed records.', 409, 'RESET_BRANCH_REQUIRED');
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
  const staffState = path === 'staffUsers' ? await beginStaffAccountChange(env) : null;
  if (staffState) actor = protectRestoreStaffActor(env, actor, staffState.rows);
  const page = await listCollectionPage(env, path, { pageSize: 400 });
  const rows = path === 'staffUsers'
    ? page.documents.filter((row) => !isProtectedRestoreStaff(row, actor))
    : page.documents;
  if (rows.length) {
    const writes = rows.map((row) => ({
      operation: 'delete', collectionPath: path, documentId: clean(row.__id),
      ...(staffState ? staffAccountCondition(row) : {})
    }));
    if (staffState) await commitStaffAccountChanges(env, staffState, writes);
    else await batchCommitDocuments(env, writes);
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
  if (path === 'staffUsers' && isProtectedRestoreStaff({ ...copy, __id: id }, actor)) return null;
  let condition = {};
  if (path === 'settings') {
    // An unavailable read is not evidence that protected live values are absent.
    const current = await getDocument(env, path, id);
    const redacted = Array.isArray(copy.__redactedFields) ? copy.__redactedFields.map(clean).filter(Boolean) : [];
    if (!current && (id === 'organisationProfile' || redacted.length)) {
      throw restoreError('Protected live settings are missing. Restore cannot safely preserve organisation identity or credentials.', 409);
    }
    if (current && !clean(current.__updateTime)) {
      throw restoreError('Reload the live settings before restoring this chunk.', 409);
    }
    condition = current ? { updateTime: current.__updateTime } : { exists: false };
    delete copy.__redactedFields;
    [...redacted, ...(id === 'organisationProfile' ? IDENTITY_SETTING_FIELDS : [])].forEach((field) => {
      if (current && Object.prototype.hasOwnProperty.call(current, field)) copy[field] = current[field];
      else if (current) {
        // Absence is also part of the live identity/credential configuration.
        // A backup must not inject an old entitlement, identity or secret.
        delete copy[field];
      }
    });
  }
  return { collectionPath: path, documentId: id, data: copy, ...condition };
}

export async function writeOrganizationRestoreChunk(env, user, jobId, collectionPath, documents = []) {
  let actor = restoreActor(user);
  const job = await currentRestoreJob(env, jobId, actor);
  if (clean(job.JobType) === 'Reset') throw restoreError('Reset sessions cannot write records.', 409, 'RESET_WRITE_FORBIDDEN');
  const path = jobAllowsCollection(job, collectionPath);
  const rows = Array.isArray(documents) ? documents : [];
  if (!rows.length || rows.length > MAX_RESTORE_DOCUMENTS) {
    throw restoreError(`Each restore write must contain between 1 and ${MAX_RESTORE_DOCUMENTS} records.`);
  }
  const staffState = path === 'staffUsers' ? await beginStaffAccountChange(env) : null;
  if (staffState) actor = protectRestoreStaffActor(env, actor, staffState.rows);
  const prepared = (await Promise.all(rows.map((row) => protectedRestoreDocument(env, path, row, actor)))).filter(Boolean);
  if (prepared.length) {
    if (staffState) {
      const existingById = new Map(staffState.rows.map((row) => [clean(row.__id), row]));
      await commitStaffAccountChanges(env, staffState, prepared.map((write) => ({
        ...write, ...staffAccountCondition(existingById.get(write.documentId))
      })));
    } else await batchCommitDocuments(env, prepared);
  }
  return { ok: true, message: `Restored ${prepared.length} record(s).`, restored: prepared.length };
}

export async function completeOrganizationRestore(env, user, jobId) {
  const actor = restoreActor(user);
  const job = await currentRestoreJob(env, jobId, actor);
  if (clean(job.JobType) === 'Reset') throw restoreError('Complete this operation as a test-data reset.', 409, 'RESET_COMPLETION_REQUIRED');
  await upsertDocument(env, RESTORE_JOB_COLLECTION, clean(jobId), {
    ...withoutTransportMetadata(job),
    Status: 'Completed',
    CompletedAt: nowIso(),
    UpdatedAt: nowIso()
  });
  return { ok: true, message: 'Organisation data restore completed successfully.', restoredAt: nowIso() };
}

export async function clearOrganizationResetObjects(env, user, jobId, branchId) {
  const job = await branchResetJob(env, user, jobId, branchId);
  if (!job.IncludeFiles || job.RemovedRecords !== job.ExpectedRecords) throw restoreError('File removal is outside this reset stage.', 409);
  const identity = requiredDeploymentIdentity(env);
  const prefixes = branchResetFilePrefixes(identity, branchId);
  const index = Number(job.FileIndex);
  if (index === prefixes.length) return { ok: true, more: false };
  const prefix = prefixes[index];
  if (!prefix) throw restoreError('Invalid file reset position.', 409);
  const bucket = env.DYNAMAX_DOCUMENTS;
  if (job.PendingFiles?.length) {
    const keys = job.PendingFiles;
    if (!keys.every(key => typeof key === 'string' && key.startsWith(prefix))) throw restoreError('File ownership could not be verified.', 409);
    // A retry may resume after the original file was deleted or replaced.
    // Recheck each current object before handing its key to the bucket.
    const confirmed = [];
    let alreadyRemoved = 0;
    const objects = await Promise.all(keys.map(key => bucket.head(key)));
    objects.forEach((object, pos) => {
      if (!object) alreadyRemoved++;
      else if (object.key === keys[pos] && resetFileEligible(object, prefix, identity, branchId, job.FileCutoff)) confirmed.push(object.key);
    });
    if (confirmed.length) await bucket.delete(confirmed);
    const removed = alreadyRemoved + confirmed.length;
    const fields = { PendingFiles: [], FileIndex: job.NextFileIndex, FileCursor: job.NextFileCursor,
      RemovedObjects: Number(job.RemovedObjects || 0) + removed, UpdatedAt: nowIso() };
    await batchCommitDocuments(env, [{ collectionPath: RESTORE_JOB_COLLECTION, documentId: jobId, data: fields,
      updateMask: Object.keys(fields), updateTime: job.__updateTime }]);
    return { ok: true, removed, more: fields.FileIndex < prefixes.length };
  }
  const page = await bucket.list({ prefix, cursor: job.FileCursor || undefined, limit: 20, include: ['customMetadata'] });
  if (page.truncated && (!page.cursor || page.cursor === job.FileCursor)) throw restoreError('Storage reset could not advance.', 503);
  const keys = page.objects.filter(object => resetFileEligible(object, prefix, identity, branchId, job.FileCutoff)).map(object => object.key);
  const nextIndex = page.truncated ? index : index + 1;
  const cursor = page.truncated ? page.cursor : '';
  const fields = keys.length ? { PendingFiles: keys, NextFileCursor: cursor, NextFileIndex: nextIndex, UpdatedAt: nowIso() }
    : { FileIndex: nextIndex, FileCursor: cursor, UpdatedAt: nowIso() };
  await batchCommitDocuments(env, [{ collectionPath: RESTORE_JOB_COLLECTION, documentId: jobId, data: fields,
    updateMask: Object.keys(fields), updateTime: job.__updateTime }]);
  return { ok: true, removed: 0, more: keys.length > 0 || nextIndex < prefixes.length };
}

export async function completeOrganizationReset(env, user, jobId, branchId) {
  const job = await branchResetJob(env, user, jobId, branchId);
  if (job.ExpectedRecords !== job.RemovedRecords || (job.IncludeFiles && job.FileIndex !== branchResetFilePrefixes(requiredDeploymentIdentity(env), branchId).length)) {
    throw restoreError('The previewed branch reset has not finished. Refresh the preview before retrying.', 409);
  }
  const completedAt = nowIso();
  const fields = { Status: 'Completed', CompletedAt: completedAt, UpdatedAt: completedAt };
  await batchCommitDocuments(env, [{ collectionPath: RESTORE_JOB_COLLECTION, documentId: jobId, data: fields,
    updateMask: Object.keys(fields), updateTime: job.__updateTime }]);
  return { ok: true, branchId, message: `Reset completed for ${job.BranchName || branchId}.`,
    removedRecords: job.RemovedRecords, removedObjects: job.RemovedObjects, resetAt: completedAt };
}
