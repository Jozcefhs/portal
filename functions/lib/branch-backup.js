import { requiredDeploymentIdentity } from './deployment-identity.js';
import { getDocument, queryCollection } from './firestore.js';
import { normalizeSchoolStructure } from './school-scope.js';
import { organizationBackupDescriptors, sanitizeBackupDocument, ORGANIZATION_BACKUP_FORMAT, ORGANIZATION_BACKUP_VERSION } from './organization-backup.js';
import { resetBranchId } from './branch-reset.js';
import { collectionKind, readOwnedBranchPage } from './branch-restore.js';

const database = { getDocument, queryCollection, organizationBackupDescriptors };
const invalid = message => Object.assign(new Error(message), { status: 400 });

export async function exportBranchBackup(env, user, action, body, db = database) {
  const branchId = resetBranchId(body.branchId);
  const working = user.branchId || user.BranchId;
  if (working && working !== 'all' && working !== branchId) throw invalid('Switch to the selected working branch before backing it up.');
  const identity = requiredDeploymentIdentity(env);
  const structure = normalizeSchoolStructure(await db.getDocument(env, 'settings', 'schoolStructure') || {});
  if (!structure.Branches.some(branch => branch.Id === branchId)) throw invalid('Choose a branch configured in this workspace.');
  if (action === 'plan-branch-backup') {
    const descriptors = await db.organizationBackupDescriptors(env);
    return { ok: true, format: ORGANIZATION_BACKUP_FORMAT, formatVersion: ORGANIZATION_BACKUP_VERSION,
      ...identity, scope: 'branch', branchId, createdAt: new Date(Date.now() - 2000).toISOString(),
      paths: descriptors.map(item => item.path).filter(path => collectionKind(path, identity, branchId)) };
  }
  const path = body.collectionPath;
  if (action !== 'export-branch-page' || !collectionKind(path, identity, branchId)) throw invalid('This collection is outside the selected branch.');
  const stamp = Date.parse(body.createdAt);
  if (!Number.isFinite(stamp) || stamp > Date.now() || Date.now() - stamp > 55 * 60000) throw invalid('This backup expired. Start a new backup.');
  const page = await readOwnedBranchPage(env, db, identity, branchId, path, body.cursor || '', body.createdAt);
  return { ok: true, ...identity, branchId, collectionPath: path, createdAt: body.createdAt,
    documents: page.rows.map(row => sanitizeBackupDocument(path, row)), cursor: page.cursor };
}
