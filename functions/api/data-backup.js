import { requireFirestoreEnv } from '../lib/firestore.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { readJsonBody } from '../lib/request-security.js';
import {
  clearOrganizationRestoreCollection,
  completeOrganizationRestore,
  exportOrganizationBackupPage,
  prepareOrganizationRestore,
  writeOrganizationRestoreChunk
} from '../lib/organization-backup.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();

function requireBackupAdministrator(user) {
  if (clean(user.role || user.Role) === 'Super Admin') return;
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
    if (action === 'export') {
      result = await exportOrganizationBackupPage(env, {
        cursor: body.cursor,
        pageToken: body.pageToken,
        pageSize: 200
      });
    } else if (action === 'prepare-restore') {
      result = await prepareOrganizationRestore(env, user, body.manifest, body.collectionPaths, body.safetyBackupCreated === true);
    } else if (action === 'clear-collection') {
      result = await clearOrganizationRestoreCollection(env, user, body.jobId, body.collectionPath);
    } else if (action === 'write-collection') {
      result = await writeOrganizationRestoreChunk(env, user, body.jobId, body.collectionPath, body.documents);
    } else if (action === 'complete-restore') {
      result = await completeOrganizationRestore(env, user, body.jobId);
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
