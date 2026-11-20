import { branchRestoreRequest } from '../lib/branch-restore.js';
import { exportBranchBackup } from '../lib/branch-backup.js';
import { backupDocuments } from '../lib/backup-documents.js';
import { assignedStaffBranches } from '../lib/staff-branch-access.js';
import { modulePermissionRole } from '../lib/module-authority.js';
import { requireFirestoreEnv } from '../lib/firestore.js';
import { requireStaffSession, verifyStaffApprovalPassword } from '../lib/staff-auth.js';
import { readJsonBody } from '../lib/request-security.js';
import {
  clearOrganizationResetObjects,
  clearOrganizationResetRecords,
  completeOrganizationReset,
  exportOrganizationBackupPage,
  prepareOrganizationReset,
  previewBranchResetCountPage,
  previewOrganizationReset
} from '../lib/organization-backup.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();

function requireBackupAdministrator(user) {
  if (modulePermissionRole(user, 'dataBackup') === 'Super Admin' && assignedStaffBranches(user) === null) return;
  const error = new Error('Only a Super Administrator can back up or restore organisation data.');
  error.status = 403;
  throw error;
}

export async function onRequestPost({ request, env }) {
  try {
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    requireBackupAdministrator(user);
    const body = await readJsonBody(request, { maxBytes: 8 * 1024 * 1024 });
    const action = lower(body.action || 'export');
    let result;
    if (['list-backup-documents', 'inspect-backup-document', 'read-backup-document'].includes(action)) {
      result = await backupDocuments(env, user, action, body);
      if (result instanceof Response) return result;
    } else if (action === 'plan-branch-backup' || action === 'export-branch-page') {
      result = await exportBranchBackup(env, user, action, body);
    } else if (action === 'export') {
      result = await exportOrganizationBackupPage(env, {
        resetBranchId: body.resetBranchId,
        cursor: body.cursor,
        pageToken: body.pageToken,
        pageSize: 200
      });
    } else if (['preview-branch-restore', 'preview-branch-restore-rows', 'preview-branch-restore-live', 'prepare-branch-restore', 'apply-branch-restore'].includes(action)) {
      result = await branchRestoreRequest(env, user, action, body);
    } else if (['prepare-restore', 'clear-collection', 'write-collection', 'complete-restore'].includes(action)) {
      throw Object.assign(new Error('Refresh Backup & Restore and select one branch to preview the backup.'), { status: 409 });
    } else if (action === 'preview-reset') {
      result = await previewOrganizationReset(env, user, body);
    } else if (action === 'preview-reset-counts') {
      result = await previewBranchResetCountPage(env, user, body);
    } else if (action === 'prepare-reset') {
      const password = String(body.currentPassword || '');
      if (!password || !(await verifyStaffApprovalPassword(env, user.username, password))) {
        const error = new Error('The current Super Administrator password is incorrect.');
        error.status = 401;
        error.code = 'RESET_APPROVAL_FAILED';
        throw error;
      }
      result = await prepareOrganizationReset(env, user, {
        confirmation: body.confirmation, branchId: body.branchId, includeFiles: body.includeFiles,
        cutoff: body.cutoff, recordCount: body.recordCount,
        safetyBackupCreated: body.safetyBackupCreated === true
      });
    } else if (action === 'clear-reset-records') {
      result = await clearOrganizationResetRecords(env, user, body);
    } else if (action === 'clear-reset-r2') {
      result = await clearOrganizationResetObjects(env, user, body.jobId, body.branchId);
    } else if (action === 'complete-reset') {
      result = await completeOrganizationReset(env, user, body.jobId, body.branchId);
    } else {
      const error = new Error('Unknown backup or restore action.');
      error.status = 400;
      throw error;
    }
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({
      ok: false,
      message: error?.message || 'Backup or restore failed.',
      ...(error?.code ? { code: error.code } : {})
    }, { status: Number(error?.status || 500), headers: { 'Cache-Control': 'no-store' } });
  }
}
