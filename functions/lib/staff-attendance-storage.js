import { batchCommitDocuments, getDocument, listCollection, queryCollection, upsertDocument } from './firestore.js';
import { requiredDeploymentIdentity } from './deployment-identity.js';
import { safeScopeId } from './school-scope.js';

const clean = (value) => String(value ?? '').trim();

export const STAFF_ATTENDANCE_COLLECTIONS = Object.freeze({
  sites: 'staffAttendanceSites',
  policy: 'staffAttendancePolicy',
  daily: 'staffDailyAttendance',
  events: 'staffTimeEvents',
  state: 'staffTimeState',
  audit: 'staffTimeAudit',
  faceTemplates: 'staffAttendanceFaceTemplates'
});

const LEGACY_STAFF_ATTENDANCE_COLLECTIONS = Object.freeze({
  sites: 'churchStaffAttendanceSites',
  policy: 'churchStaffAttendancePolicy',
  daily: 'churchStaffDailyAttendance',
  events: 'churchStaffTimeEvents',
  state: 'churchStaffTimeState',
  audit: 'churchStaffTimeAudit',
  faceTemplates: 'churchStaffAttendanceFaceTemplates'
});

const MIGRATION_COLLECTION_KEYS = Object.freeze(Object.keys(STAFF_ATTENDANCE_COLLECTIONS));
const MIGRATION_MARKER_COLLECTION = 'staffAttendanceStorageMigrations';
const MIGRATION_MARKER_CACHE_MS = 60 * 1000;
const migrationMarkerCache = new Map();

function collectionName(collections, key) {
  const name = clean(collections[key]);
  if (!name) throw new Error(`Unknown staff-attendance collection: ${clean(key) || '(blank)'}`);
  return name;
}

export function safeStaffAttendanceDocumentId(value) {
  return clean(value).replace(/[\/\\?#\[\]]/g, '-').replace(/\s+/g, '_').slice(0, 140);
}

export function resolveStaffAttendanceBranch(user = {}, requestedBranch = '') {
  const assigned = clean(user.branchId || user.BranchId);
  const requested = clean(requestedBranch);
  if (assigned && requested && assigned.toLowerCase() !== requested.toLowerCase()) {
    const error = new Error('This staff account is restricted to another organisation branch.');
    error.status = 403;
    throw error;
  }
  return safeScopeId(assigned || requested || 'main');
}

export function canonicalStaffAttendanceCollectionPath(edition, key, branchId = 'main') {
  const normalizedEdition = clean(edition).toLowerCase();
  if (!['school', 'faith', 'organization'].includes(normalizedEdition)) {
    throw new Error('A valid organisation edition is required for staff-attendance storage.');
  }
  const root = normalizedEdition === 'school' ? 'schoolBranches' : 'organisationBranches';
  return `${root}/${safeScopeId(branchId)}/${collectionName(STAFF_ATTENDANCE_COLLECTIONS, key)}`;
}

export function legacyStaffAttendanceCollectionPath(key, branchId = 'main') {
  return `organisationBranches/${safeScopeId(branchId)}/${collectionName(LEGACY_STAFF_ATTENDANCE_COLLECTIONS, key)}`;
}

export function staffAttendanceCollectionPath(env, key, branchId = 'main') {
  return canonicalStaffAttendanceCollectionPath(requiredDeploymentIdentity(env).edition, key, branchId);
}

export function staffAttendanceReadPaths(env, key, branchId = 'main') {
  return [...new Set([
    staffAttendanceCollectionPath(env, key, branchId),
    legacyStaffAttendanceCollectionPath(key, branchId)
  ])];
}

function migrationMarkerIdentity(env, branchId = 'main') {
  const identity = requiredDeploymentIdentity(env);
  const branch = safeScopeId(branchId);
  const documentId = safeStaffAttendanceDocumentId(`${identity.workspaceId}-${identity.edition}-${branch}`);
  return {
    identity,
    branch,
    documentId,
    cacheKey: `${clean(env.FIREBASE_PROJECT_ID)}|${documentId}`
  };
}

async function legacyReadsDisabled(env, branchId = 'main') {
  const marker = migrationMarkerIdentity(env, branchId);
  const cached = migrationMarkerCache.get(marker.cacheKey);
  if (cached?.pending) return cached.pending;
  if (cached && Date.now() < cached.expiresAt) return cached.disabled;
  const pending = getDocument(env, MIGRATION_MARKER_COLLECTION, marker.documentId)
    .then((stored) => {
      const disabled = clean(stored?.LegacyReadsDisabled).toUpperCase() === 'YES';
      migrationMarkerCache.set(marker.cacheKey, {
        disabled,
        expiresAt: disabled ? Number.POSITIVE_INFINITY : Date.now() + MIGRATION_MARKER_CACHE_MS
      });
      return disabled;
    })
    .catch((error) => {
      migrationMarkerCache.delete(marker.cacheKey);
      throw error;
    });
  migrationMarkerCache.set(marker.cacheKey, { pending, expiresAt: Number.POSITIVE_INFINITY });
  return pending;
}

async function activeStaffAttendanceReadPaths(env, key, branchId = 'main') {
  const paths = staffAttendanceReadPaths(env, key, branchId);
  return await legacyReadsDisabled(env, branchId) ? paths.slice(0, 1) : paths;
}

function storedRow(row, path, legacy = false) {
  return row ? { ...row, __storagePath: path, __legacyStorage: legacy } : null;
}

export async function getStaffAttendanceDocument(env, key, branchId, documentId) {
  const [canonicalPath, legacyPath] = await activeStaffAttendanceReadPaths(env, key, branchId);
  const canonical = await getDocument(env, canonicalPath, documentId);
  if (canonical) return storedRow(canonical, canonicalPath, false);
  if (!legacyPath) return null;
  const legacy = await getDocument(env, legacyPath, documentId);
  return storedRow(legacy, legacyPath, true);
}

export async function getCanonicalStaffAttendanceDocument(env, key, branchId, documentId) {
  const canonicalPath = staffAttendanceCollectionPath(env, key, branchId);
  const canonical = await getDocument(env, canonicalPath, documentId);
  return storedRow(canonical, canonicalPath, false);
}

function mergeStoredRows(canonicalRows, legacyRows, canonicalPath, legacyPath) {
  const merged = new Map();
  (legacyRows || []).forEach((row) => {
    const id = clean(row.__id);
    if (id) merged.set(id, storedRow(row, legacyPath, true));
  });
  (canonicalRows || []).forEach((row) => {
    const id = clean(row.__id);
    if (id) merged.set(id, storedRow(row, canonicalPath, false));
  });
  return [...merged.values()];
}

function compareQueryRows(left, right, orderBy = []) {
  for (const order of orderBy || []) {
    const field = clean(order.field || order.fieldPath);
    if (!field) continue;
    const direction = clean(order.direction).toUpperCase() === 'DESCENDING' ? -1 : 1;
    const comparison = clean(left[field]).localeCompare(clean(right[field]));
    if (comparison) return comparison * direction;
  }
  return clean(left.__id).localeCompare(clean(right.__id));
}

export async function listStaffAttendanceCollection(env, key, branchId) {
  const [canonicalPath, legacyPath] = await activeStaffAttendanceReadPaths(env, key, branchId);
  const [canonicalRows, legacyRows] = await Promise.all([
    listCollection(env, canonicalPath),
    legacyPath ? listCollection(env, legacyPath) : Promise.resolve([])
  ]);
  return mergeStoredRows(canonicalRows, legacyRows, canonicalPath, legacyPath);
}

export async function queryStaffAttendanceCollection(env, key, branchId, options = {}) {
  const [canonicalPath, legacyPath] = await activeStaffAttendanceReadPaths(env, key, branchId);
  const [canonicalRows, legacyRows] = await Promise.all([
    queryCollection(env, canonicalPath, options),
    legacyPath ? queryCollection(env, legacyPath, options) : Promise.resolve([])
  ]);
  const rows = mergeStoredRows(canonicalRows, legacyRows, canonicalPath, legacyPath)
    .sort((left, right) => compareQueryRows(left, right, options.orderBy));
  const limit = Number(options.limit || 0);
  return Number.isInteger(limit) && limit > 0 ? rows.slice(0, limit) : rows;
}

export function staffAttendanceDocumentData(row = {}) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('__')));
}

async function storageRows(env, key, branchId) {
  const canonicalPath = staffAttendanceCollectionPath(env, key, branchId);
  const legacyPath = legacyStaffAttendanceCollectionPath(key, branchId);
  const [canonical, legacy] = await Promise.all([
    listCollection(env, canonicalPath),
    canonicalPath === legacyPath ? Promise.resolve([]) : listCollection(env, legacyPath)
  ]);
  const canonicalIds = new Set(canonical.map((row) => clean(row.__id)).filter(Boolean));
  const missing = legacy.filter((row) => clean(row.__id) && !canonicalIds.has(clean(row.__id)));
  return { key, canonicalPath, legacyPath, canonical, legacy, missing };
}

export async function staffAttendanceStorageMigrationStatus(env, branchId = 'main') {
  const branch = safeScopeId(branchId);
  const [collections, legacyReadFallbackDisabled] = await Promise.all([
    Promise.all(MIGRATION_COLLECTION_KEYS.map((key) => storageRows(env, key, branch))),
    legacyReadsDisabled(env, branch)
  ]);
  const summary = collections.map((item) => ({
    key: item.key,
    canonicalPath: item.canonicalPath,
    legacyPath: item.legacyPath,
    canonicalRecords: item.canonical.length,
    legacyRecords: item.legacy.length,
    missingCanonicalRecords: item.missing.length
  }));
  const legacyRecords = summary.reduce((total, item) => total + item.legacyRecords, 0);
  const missingCanonicalRecords = summary.reduce((total, item) => total + item.missingCanonicalRecords, 0);
  return {
    branchId: branch,
    edition: requiredDeploymentIdentity(env).edition,
    collections: summary,
    legacyRecords,
    missingCanonicalRecords,
    legacyReadsDisabled: legacyReadFallbackDisabled,
    verified: missingCanonicalRecords === 0,
    cleanupEligible: legacyRecords > 0 && missingCanonicalRecords === 0
  };
}

async function commitMissingRows(env, snapshot) {
  let pending = snapshot.missing;
  let copied = 0;
  for (let attempt = 0; pending.length && attempt < 3; attempt += 1) {
    const migratedAt = new Date().toISOString();
    try {
      for (let offset = 0; offset < pending.length; offset += 400) {
        const chunk = pending.slice(offset, offset + 400);
        await batchCommitDocuments(env, chunk.map((row) => ({
          collectionPath: snapshot.canonicalPath,
          documentId: clean(row.__id),
          data: {
            ...staffAttendanceDocumentData(row),
            StorageVersion: 2,
            MigratedFrom: snapshot.legacyPath,
            MigratedAt: migratedAt
          },
          exists: false
        })));
        copied += chunk.length;
      }
      return copied;
    } catch (error) {
      if (![409, 412].includes(Number(error?.status)) && error?.code !== 'FIRESTORE_WRITE_CONFLICT') throw error;
      const current = await listCollection(env, snapshot.canonicalPath);
      const currentIds = new Set(current.map((row) => clean(row.__id)).filter(Boolean));
      pending = pending.filter((row) => !currentIds.has(clean(row.__id)));
    }
  }
  if (pending.length) {
    const error = new Error('Staff-attendance storage changed during migration. Run the copy step again.');
    error.status = 409;
    throw error;
  }
  return copied;
}

export async function migrateLegacyStaffAttendanceStorage(env, branchId = 'main') {
  const branch = safeScopeId(branchId);
  const marker = migrationMarkerIdentity(env, branch);
  migrationMarkerCache.delete(marker.cacheKey);
  const snapshots = await Promise.all(MIGRATION_COLLECTION_KEYS.map((key) => storageRows(env, key, branch)));
  let copied = 0;
  for (const snapshot of snapshots) copied += await commitMissingRows(env, snapshot);
  return { copied, ...(await staffAttendanceStorageMigrationStatus(env, branch)) };
}

export async function cleanupLegacyStaffAttendanceStorage(env, branchId = 'main', confirmation = '') {
  if (clean(confirmation) !== 'DELETE LEGACY STAFF ATTENDANCE') {
    const error = new Error('Enter DELETE LEGACY STAFF ATTENDANCE to confirm legacy cleanup.');
    error.status = 400;
    throw error;
  }
  const branch = safeScopeId(branchId);
  const snapshots = await Promise.all(MIGRATION_COLLECTION_KEYS.map((key) => storageRows(env, key, branch)));
  const missing = snapshots.reduce((total, snapshot) => total + snapshot.missing.length, 0);
  if (missing) {
    const error = new Error(`${missing} legacy staff-attendance record(s) are not yet present in canonical storage. Run migration before cleanup.`);
    error.status = 409;
    throw error;
  }
  const deletions = snapshots.flatMap((snapshot) => snapshot.legacy.map((row) => ({
    collectionPath: snapshot.legacyPath,
    documentId: clean(row.__id),
    operation: 'delete'
  })));
  for (let offset = 0; offset < deletions.length; offset += 400) {
    await batchCommitDocuments(env, deletions.slice(offset, offset + 400));
  }
  const verified = await staffAttendanceStorageMigrationStatus(env, branch);
  if (verified.legacyRecords || verified.missingCanonicalRecords) {
    const error = new Error('Legacy cleanup could not be verified. No migration-complete marker was written.');
    error.status = 409;
    throw error;
  }
  const marker = migrationMarkerIdentity(env, branch);
  await upsertDocument(env, MIGRATION_MARKER_COLLECTION, marker.documentId, {
    WorkspaceId: marker.identity.workspaceId,
    Edition: marker.identity.edition,
    BranchId: branch,
    StorageVersion: 2,
    LegacyReadsDisabled: 'YES',
    CompletedAt: new Date().toISOString()
  });
  migrationMarkerCache.set(marker.cacheKey, {
    disabled: true,
    expiresAt: Number.POSITIVE_INFINITY
  });
  return { deleted: deletions.length, ...verified, legacyReadsDisabled: true };
}
