import { CHURCH_COLLECTIONS } from './church-foundation.js';
import { batchCommitLiteralDocuments, getDocuments } from './firestore.js';
import { requiredDeploymentIdentity } from './deployment-identity.js';
import { STAFF_ATTENDANCE_COLLECTIONS, legacyStaffAttendanceCollectionPath } from './staff-attendance-storage.js';

// Shared root collections require an explicit ownership contract. A BranchId on
// an account, a transfer or an organisation setting can mean its home branch.
const operationalRoots = new Set([
  'applications', 'students', 'studentConductCases', 'studentConductAudit', 'formPurchases',
  'payments', 'invoices', 'ledger', 'accountSummaries', 'walletTransactions',
  'academicStudentMemberships', 'academicTeacherAllocations', 'academicStudentAttendance',
  'academicAttendanceCorrections', 'academicScoreSheets', 'academicStudentScores',
  'academicScoreImports', 'academicScoreSyncBatches', 'academicCbtTests', 'academicResults',
  'academicResultClearances', 'academicResultEvents', 'academicCumulativeResults', 'academicCumulativeEvents',
  'academicPromotionDecisions', 'academicPromotionEvents', 'academicTranscripts', 'academicTranscriptEvents',
  'academicTimetableVersions', 'academicTimetableEntries', 'academicTimetableSubstitutions',
  'hrLeaveRequests', 'hrVacancies', 'hrPerformanceReviews', 'hrTrainingRecords', 'hrLifecycleRecords',
  'procurementRequests', 'procurementPurchases', 'financialAuditEvidence',
  'libraryLoans', 'libraryReservations', 'hotelReservations', 'hotelCharges', 'hotelPayments', 'hotelHousekeeping'
]);
const attendance = new Set(['daily', 'events', 'state', 'audit', 'faceTemplates'].flatMap(key => [
  STAFF_ATTENDANCE_COLLECTIONS[key], legacyStaffAttendanceCollectionPath(key, 'main').split('/').at(-1)
]));
const church = new Set(Object.values(CHURCH_COLLECTIONS).filter(name => !/Settings|Mappings|Routes|Types$/.test(name)));
const school = new Set(['students', 'applications', 'studentConductCases', 'studentConductAudit']);
const fail = message => Object.assign(new Error(message), { status: 409, code: 'BRANCH_RESET_SCOPE' });

export function resetBranchId(value) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(value) || value === 'all') {
    throw fail('Choose one configured branch for the reset.');
  }
  return value;
}

export function branchResetPathAllowed(path, branch, edition) {
  resetBranchId(branch);
  if (operationalRoots.has(path)) return true;
  const [root, id, collection, section, leaf, ...extra] = path.split('/');
  if (id !== branch || extra.length) return false;
  if (section === undefined && leaf === undefined) {
    if (root === (edition === 'school' ? 'schoolBranches' : 'organisationBranches')) {
      if (attendance.has(collection) || collection === 'hrPresenceReviews') return true;
    }
    return root === 'organisationBranches' && (attendance.has(collection) || (edition !== 'school' && church.has(collection)));
  }
  return edition === 'school' && root === 'schoolBranches' && collection === 'sections'
    && ['primary', 'secondary'].includes(section) && school.has(leaf);
}

export function branchOwnsResetRecord(path, row, branch, edition) {
  if (!branchResetPathAllowed(path, branch, edition)) return false;
  if (operationalRoots.has(path) && row.BranchId !== branch && row.branchId !== branch) return false;
  // Conflicting ownership, transfer endpoints and shared scopes are never inferred.
  return exclusivelyScoped(row, branch, edition);
}

function exclusivelyScoped(record, branch, edition) {
  for (const [field, value] of Object.entries(record)) {
    if (value == null || value === '') continue;
    if (/(?:branchids?|^(?:from|to|source|destination|target)branch|^branches)$/i.test(field)) {
      const owners = Array.isArray(value) ? value : [value];
      if (!owners.length || owners.some(id => id !== branch)) return false;
    } else if (/^(?:organisationedition|organizationedition)$/i.test(field) && value !== edition) return false;
    else if (/^scopekey$/i.test(field) && value !== edition + '--' + branch) return false;
    else if (/^(?:branchaccess|branchscope|scope)$/i.test(field)
      && ['all', 'all branches', 'global', 'organisation', 'organization', 'shared'].includes(String(value).toLowerCase())) return false;
    else if (typeof value === 'object' && !exclusivelyScoped(value, branch, edition)) return false;
  }
  return true;
}

export function assertResetJobScope(env, job, branchId, workingBranch) {
  const identity = requiredDeploymentIdentity(env);
  const branch = resetBranchId(branchId);
  if (job.JobType !== 'Reset' || job.BranchId !== branch || job.WorkspaceId !== identity.workspaceId
    || job.Edition !== identity.edition || (workingBranch && workingBranch !== 'all' && workingBranch !== branch)) {
    throw fail('The reset session does not match this branch and workspace. Open a new preview.');
  }
  return branch;
}

export async function clearBranchResetRecords(env, job, path, selection, db = { getDocuments, batchCommitLiteralDocuments }) {
  if (!job.CollectionPaths.includes(path) || !branchResetPathAllowed(path, job.BranchId, job.Edition)) throw fail('This collection is outside the branch reset.');
  if (!Array.isArray(selection) || !selection.length || selection.length > 100 ||
      selection.some(row => !row || typeof row.id !== 'string' || !row.id || row.id.includes('/') || !row.version) ||
      new Set(selection.map(row => row.id)).size !== selection.length) throw fail('Invalid reset selection. Refresh the preview.');
  const docs = await db.getDocuments(env, path, selection.map(row => row.id));
  const writes = [];
  docs.forEach((row, index) => {
    if (!row) return; // Acknowledgement lost after a successful batch.
    if (row.__id !== selection[index].id || !branchOwnsResetRecord(path, row, job.BranchId, job.Edition)
      || row.__updateTime !== selection[index].version) throw fail('A previewed record changed. Prepare a fresh branch preview.');
    writes.push({ operation: 'delete', collectionPath: path, documentId: row.__id, updateTime: row.__updateTime });
  });
  if (writes.length) {
    const removed = Number(job.RemovedRecords || 0) + writes.length;
    if (removed > job.ExpectedRecords) throw fail('The selection exceeds the confirmed record count.');
    writes.push({ collectionPath: 'systemRestoreJobs', documentId: job.JobId, updateTime: job.__updateTime,
      data: { RemovedRecords: removed, Status: 'Restoring', UpdatedAt: new Date().toISOString() },
      updateMask: ['RemovedRecords', 'Status', 'UpdatedAt'] });
    await db.batchCommitLiteralDocuments(env, writes);
    return { ok: true, removed: writes.length - 1 };
  }
  return { ok: true, removed: 0 };
}
