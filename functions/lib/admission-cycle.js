import { batchCommitDocuments, getDocument, listCollection, listCollectionPage } from './firestore.js';
import { schoolCollectionPaths } from './school-scope.js';
import { requiredDeploymentIdentity } from './deployment-identity.js';
import { requireDocumentStorage } from './document-storage.js';

const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const CYCLES = 'admissionCycles';
const AUDITS = 'admissionCycleBackups';
const POLICY = 'admissionRetention';
const MAX_BATCH = 20;
const MAX_BYTES = 8 * 1024 * 1024;
const DAY = 86400000;
const error = (message, status = 400) => Object.assign(new Error(message), { status });
const fieldsOnly = row => Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('__')));

// Deliberately allow-list only redundant personal form details. Unknown fields,
// all marks/answers, decisions, identity, finance links and document history stay.
export const REMOVABLE_APPLICANT_FIELDS = Object.freeze([
  'DateOfBirth', 'Religion', 'Nationality', 'StateOfOrigin', 'LGA', 'NIN', 'PreviousSchool',
  'FatherName', 'FatherPhone', 'FatherEmail', 'FatherOccupation', 'FatherOfficeAddress',
  'MotherName', 'MotherPhone', 'MotherEmail', 'MotherOccupation', 'MotherOfficeAddress',
  'GuardianName', 'GuardianPhone', 'LivingWith', 'ResidentialAddress', 'CityArea', 'StateOfResidence',
  'BloodGroup', 'Genotype', 'MedicalCondition', 'EmergencyContactName', 'EmergencyContactPhone',
  'ClassCompleted', 'HowHeard', 'ReasonForChoosingSchool',
  'ExpelledOrRefusedAdmission', 'ExpelledOrRefusedAdmissionDetails',
  'DisciplinaryDifficulty', 'DisciplinaryDifficultyDetails',
  'JuvenileArrestRecord', 'JuvenileArrestRecordDetails',
  'FailedAcademicSubject', 'FailedAcademicSubjectDetails'
]);

export function retentionDays(value) {
  if (value === null || value === 'never') return null;
  if (!['number', 'string'].includes(typeof value) || clean(value) === '') throw error('Enter a retention period in whole days, or select Keep indefinitely.');
  const days = Number(value);
  if (!Number.isInteger(days) || days < 0 || days > 36500) throw error('Retention must be 0 to 36,500 whole days.');
  return days;
}

export function admissionCycleScope(row, required = true) {
  const session = clean(row.AcademicSession || row.session).replace(/\s*\/\s*/g, '/');
  const terms = { 'first term': 'First Term', 'second term': 'Second Term', 'third term': 'Third Term' };
  const termKey = lower(row.Term || row.term);
  const term = Object.hasOwn(terms, termKey) ? terms[termKey] : '';
  if (!/^\d{4}\/\d{4}$/.test(session) || Number(session.slice(5)) !== Number(session.slice(0, 4)) + 1 || !term) {
    if (!required) return null;
    throw error('Select an explicit academic session (for example 2026/2027) and term. Unassigned historical applications are never guessed.');
  }
  return { AcademicSession: session, Term: term };
}

export async function admissionHash(value) {
  const digest = await crypto.subtle.digest('SHA-256', typeof value === 'string' ? new TextEncoder().encode(value) : value);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function admissionCycleId(env, scope) {
  const identity = requiredDeploymentIdentity(env);
  if (identity.edition !== 'school') throw error('Admission cycles are available only to schools.', 403);
  return admissionHash(JSON.stringify([identity.workspaceId, admissionCycleScope(scope)]));
}

export function requireAdmissionCycleAdministrator(user) {
  if (user.role !== 'Super Admin' || user.assignedBranchId ||
      (user.canSwitchBranches !== true && user.branchId) ||
      !['', 'all'].includes(lower(user.schoolSectionAccess))) {
    throw error('Only a school-wide Super Administrator can close admission cycles or remove applicant details.', 403);
  }
}

export function applicantProtection(row, students = []) {
  if (row.AdmissionDetailsRemovedAt) return 'Already cleaned; admission history retained';
  if (['yes', 'true', '1'].includes(lower(row.Enrolled)) || row.EnrolledAt ||
      row.AdmissionNo || row.AdmissionNumber ||
      /admitted|enrolled|offer|admission letter|probation/i.test(`${clean(row.Status)} ${clean(row.ResultStatus)}`) ||
      ['OfferSent', 'AcceptanceFeePaid', 'AdmissionLetterSent'].some(key => ['yes', 'true', '1'].includes(lower(row[key]))) ||
      Number(row.AcceptanceFeeAmount || 0) > 0) return 'Enrolled, admitted, or admission/acceptance in progress';
  const refs = [row.ApplicationReference, row.ApplicationID, row.__id].map(lower).filter(Boolean);
  if (students.some(student => [student.ApplicationReference, student.ApplicationID, student.AdmissionNo, student.AccountRef]
    .some(value => clean(value) && refs.includes(lower(value))))) return 'Linked to a student record';
  if (['yes', 'true', '1'].includes(lower(row.RetentionHold)) || row.RetentionHoldReason) return 'Retention hold';
  return '';
}

export function removableApplicantFields(row) {
  return REMOVABLE_APPLICANT_FIELDS.filter(key => Object.hasOwn(row, key));
}

export function compactApplicant(row, metadata) {
  const next = fieldsOnly(row);
  for (const key of removableApplicantFields(row)) delete next[key];
  return { ...next, AdmissionDetailsRemovedAt: metadata.at, AdmissionDetailsRemovedBy: metadata.actor,
    AdmissionCycleId: metadata.cycleId, AdmissionBackupId: metadata.backupId,
    AdmissionBackupSha256: metadata.sha256, UpdatedAt: metadata.at };
}

// A cycle revision participates in the application's atomic creation. Closing
// cannot race a successful new submission into a previously checked open cycle.
export async function admissionSubmissionFence(env, application, dependencies = {}) {
  const get = dependencies.get || getDocument;
  const scope = admissionCycleScope(application);
  const id = await admissionCycleId(env, scope);
  const cycle = await get(env, CYCLES, id);
  if (cycle?.Status === 'Closed') throw error(`Admissions for ${scope.AcademicSession}, ${scope.Term} are closed. Contact the school.`, 409);
  if (cycle && !cycle.__updateTime) throw error('The admission-cycle revision could not be verified. Retry submission.', 409);
  return { collectionPath: CYCLES, documentId: id,
    data: { ...fieldsOnly(cycle || {}), ...scope, WorkspaceId: requiredDeploymentIdentity(env).workspaceId,
      Status: 'Open', LastSubmissionAt: new Date().toISOString() },
    ...(cycle ? { updateTime: cycle.__updateTime } : { exists: false }) };
}

export async function activeAdmissionRows(env, rows, dependencies = {}) {
  if (!rows.length) return rows;
  const workspace = requiredDeploymentIdentity(env).workspaceId;
  const cycles = await (dependencies.list || listCollection)(env, CYCLES);
  const closed = new Set(cycles.filter(row => row.Status === 'Closed' && row.WorkspaceId === workspace).map(row => JSON.stringify(admissionCycleScope(row))));
  return rows.filter(row => {
    const scope = admissionCycleScope(row, false);
    return !row.AdmissionDetailsRemovedAt && (!scope || !closed.has(JSON.stringify(scope)));
  });
}

function sourceAddress(row) {
  const path = clean(row.__scopePath);
  if (!/^(applications|schoolBranches\/[a-z0-9._-]+\/sections\/(primary|secondary)\/applications)$/.test(path) ||
      !row.__id || clean(row.__id).includes('/') || !row.__updateTime) throw error('An applicant source or revision could not be verified. Nothing was removed.', 409);
  return { collectionPath: path, documentId: row.__id };
}

function verifyDue(cycle, now) {
  if (!cycle || cycle.Status !== 'Closed') throw error('Close the admission cycle before cleanup.', 409);
  if (retentionDays(cycle.RetentionDays) === null) throw error('This cycle is retained indefinitely. No cleanup is permitted.', 409);
  const due = Date.parse(cycle.EligibleAfter);
  if (!Number.isFinite(due) || now < due) throw error(`The retention period has not ended. Eligible after ${cycle.EligibleAfter || 'a valid retention date'}.`, 409);
}

export function createAdmissionCycleService(env, user, dependencies = {}) {
  requireAdmissionCycleAdministrator(user);
  const identity = requiredDeploymentIdentity(env);
  if (identity.edition !== 'school') throw error('Admission cycles are available only to schools.', 403);
  const get = dependencies.get || getDocument;
  const list = dependencies.list || listCollection;
  const page = dependencies.page || listCollectionPage;
  const pathsFor = dependencies.paths || schoolCollectionPaths;
  const commit = dependencies.commit || batchCommitDocuments;
  const now = dependencies.now || (() => Date.now());
  const actor = clean(user.username);
  if (!actor) throw error('The administrator identity is missing.', 403);

  async function allRows(collection) {
    const paths = await pathsFor(env, collection);
    const rows = [];
    let bytes = 0;
    // Full pagination, fail closed on oversized datasets rather than silently
    // using a truncated list to determine enrollment protection.
    for (const path of paths) {
      let token = '';
      const seen = new Set();
      do {
        const result = await page(env, path, { pageSize: 25, ...(token ? { pageToken: token } : {}) });
        bytes += new TextEncoder().encode(JSON.stringify(result.documents)).byteLength;
        if (bytes > 24 * 1024 * 1024) throw error('This admission archive exceeds the safe preview size. No records were removed.', 413);
        rows.push(...result.documents.map(row => ({ ...row, __scopePath: path })));
        if (rows.length > 20000) throw error('This admission archive needs a smaller server-side export scope. No records were removed.', 413);
        token = clean(result.nextPageToken);
        if (token && seen.has(token)) throw error('The record listing did not complete. No records were removed.', 502);
        seen.add(token);
      } while (token);
    }
    return rows;
  }

  async function policy() {
    const saved = await get(env, 'settings', POLICY);
    return { days: saved ? retentionDays(saved.Days) : null, revision: saved?.__updateTime || '' };
  }

  async function savePolicy(body) {
    const days = retentionDays(body.days);
    const saved = await get(env, 'settings', POLICY);
    if (clean(body.revision) !== clean(saved?.__updateTime)) throw error('Retention settings changed. Reload before saving.', 409);
    await commit(env, [{ collectionPath: 'settings', documentId: POLICY,
      data: { Days: days === null ? 'never' : days, UpdatedAt: new Date(now()).toISOString(), UpdatedBy: actor },
      ...(saved ? { updateTime: saved.__updateTime } : { exists: false }) }]);
    return { ok: true, policy: await policy() };
  }

  async function state() {
    return { ok: true, policy: await policy(), cycles: (await list(env, CYCLES)).filter(row => row.Status === 'Closed' && row.WorkspaceId === identity.workspaceId)
      .map(row => ({ ...fieldsOnly(row), id: row.__id })) };
  }

  async function preview(body) {
    const scope = admissionCycleScope(body);
    const id = await admissionCycleId(env, scope);
    const [cycle, applications, students, currentPolicy] = await Promise.all([
      get(env, CYCLES, id), allRows('applications'), allRows('students'), policy()
    ]);
    const matching = applications.filter(row => JSON.stringify(admissionCycleScope(row, false)) === JSON.stringify(scope));
    const unassigned = applications.filter(row => clean(row.AcademicSession) === scope.AcademicSession && !admissionCycleScope(row, false)).length;
    const classified = matching.map(row => ({ row, reason: applicantProtection(row, students) }));
    const eligible = classified.filter(item => !item.reason && removableApplicantFields(item.row).length);
    const batch = eligible.slice(0, MAX_BATCH);
    const sources = batch.map(({ row }) => ({ ...sourceAddress(row), revision: row.__updateTime,
      fields: removableApplicantFields(row) }));
    const fingerprint = await admissionHash(JSON.stringify({ workspace: identity.workspaceId, scope,
      cycleRevision: cycle?.__updateTime || '', policyRevision: currentPolicy.revision, sources }));
    const reports = classified.map(({ row, reason }) => ({ reference: clean(row.ApplicationReference || row.ApplicationID || row.__id),
      name: clean(row.ApplicantName || row.Name), branch: clean(row.BranchId || 'main'),
      protectedReason: reason, fields: reason ? [] : removableApplicantFields(row) }));
    return { ok: true, scope, cycleId: id, cycle: cycle ? fieldsOnly(cycle) : null, policy: currentPolicy,
      fingerprint, total: matching.length, unassigned, eligible: eligible.length,
      protected: classified.filter(item => item.reason).length,
      batch: batch.map(({ row }) => reports[matching.indexOf(row)]),
      records: reports, due: Boolean(cycle?.Status === 'Closed' && retentionDays(cycle.RetentionDays) !== null && Number.isFinite(Date.parse(cycle.EligibleAfter)) && now() >= Date.parse(cycle.EligibleAfter)),
      _sources: batch.map(item => item.row), _cycle: cycle };
  }

  async function close(body) {
    const checked = await preview(body);
    if (checked.cycle?.Status === 'Closed') return { ok: true, alreadyClosed: true, cycle: checked.cycle };
    if (body.fingerprint !== checked.fingerprint) throw error('The preview changed. Review it again before closing.', 409);
    if (body.confirmation !== `CLOSE ${checked.scope.AcademicSession} ${checked.scope.Term}`) throw error('Type the displayed CLOSE confirmation exactly.');
    const at = new Date(now()).toISOString();
    const days = checked.policy.days;
    const cycle = { ...checked.scope, Status: 'Closed', ClosedAt: at, ClosedBy: actor,
      RetentionDays: days === null ? 'never' : days, EligibleAfter: days === null ? '' : new Date(now() + days * DAY).toISOString(),
      WorkspaceId: identity.workspaceId, ApplicationsAtClose: checked.total, UnassignedExcludedAtClose: checked.unassigned };
    const writes = [{ collectionPath: CYCLES, documentId: checked.cycleId, data: cycle,
      ...(checked._cycle ? { updateTime: checked._cycle.__updateTime } : { exists: false }) }];
    // Bind the retention setting to the reviewed close operation too.
    if (checked.policy.revision) writes.push({ collectionPath: 'settings', documentId: POLICY,
      data: { LastCycleClosedAt: at }, updateMask: ['LastCycleClosedAt'], updateTime: checked.policy.revision });
    else writes.push({ collectionPath: 'settings', documentId: POLICY, data: { Days: 'never', UpdatedAt: at, UpdatedBy: actor }, exists: false });
    await commit(env, writes);
    return { ok: true, cycle };
  }

  async function cleanup(body) {
    const checked = await preview(body);
    verifyDue(checked._cycle, now());
    if (checked.fingerprint !== body.fingerprint) throw error('Applications or settings changed. Review a fresh preview; nothing was removed.', 409);
    if (body.confirmation !== `CLEAN ${checked.scope.AcademicSession} ${checked.scope.Term}`) throw error('Type the displayed CLEAN confirmation exactly.');
    if (!checked._sources.length) return { ok: true, cleaned: 0, remaining: 0 };
    const bucket = requireDocumentStorage(env);
    const id = crypto.randomUUID();
    // Not a document reference: generic parent/document APIs cannot fetch this
    // private backup. Only the authenticated administrator download below can.
    const key = `private-admission-backups/${identity.workspaceId}/${checked.cycleId}/${id}.json`;
    const at = new Date(now()).toISOString();
    const backup = { format: 'dynamax-admission-cycle-backup', version: 1, workspaceId: identity.workspaceId,
      cycleId: checked.cycleId, scope: checked.scope, createdAt: at, createdBy: actor,
      documents: checked._sources.map(row => ({ ...sourceAddress(row), revision: row.__updateTime, data: fieldsOnly(row) })) };
    const bytes = new TextEncoder().encode(JSON.stringify(backup));
    if (bytes.byteLength > MAX_BYTES) throw error('The selected batch exceeds the safe backup size. No records were removed.', 413);
    const sha256 = await admissionHash(bytes);
    const stored = await bucket.put(key, bytes, { onlyIf: { etagDoesNotMatch: '*' },
      httpMetadata: { contentType: 'application/json' }, customMetadata: { workspaceId: identity.workspaceId, sha256 } });
    if (!stored) throw error('Backup storage did not confirm the write. Nothing was removed.', 502);
    const readback = await bucket.get(key);
    if (!readback || readback.size !== bytes.byteLength || readback.size > MAX_BYTES) throw error('Backup read-back failed. Nothing was removed.', 502);
    const verified = await readback.arrayBuffer();
    if (await admissionHash(verified) !== sha256) throw error('Backup checksum verification failed. Nothing was removed.', 502);
    // Read-back bytes must also parse as the expected recoverable archive.
    const parsed = JSON.parse(new TextDecoder().decode(verified));
    if (parsed.workspaceId !== identity.workspaceId || parsed.cycleId !== checked.cycleId || parsed.documents.length !== checked._sources.length)
      throw error('Backup contents could not be verified. Nothing was removed.', 502);
    const finalCheck = await preview(body);
    if (finalCheck.fingerprint !== checked.fingerprint) throw error('Records changed during backup. Nothing was removed; review again.', 409);
    verifyDue(finalCheck._cycle, now());
    const metadata = { AdmissionDetailsRemovedAt: at, AdmissionDetailsRemovedBy: actor,
      AdmissionCycleId: checked.cycleId, AdmissionBackupId: id, AdmissionBackupSha256: sha256, UpdatedAt: at };
    const writes = checked._sources.map(row => ({ ...sourceAddress(row), literalDocumentId: true,
      updateTime: row.__updateTime, data: metadata,
      // Firestore removes masked fields omitted from data. Do not reserialize
      // retained marks/answers/history: even their original types stay intact.
      updateMask: [...removableApplicantFields(row), ...Object.keys(metadata)] }));
    writes.push({ collectionPath: AUDITS, documentId: id, exists: false, data: {
      WorkspaceId: identity.workspaceId, CycleId: checked.cycleId, ...checked.scope, Key: key,
      Sha256: sha256, Bytes: bytes.byteLength, Count: checked._sources.length, VerifiedAt: at, CleanedBy: actor,
      Sources: backup.documents.map(doc => ({ collectionPath: doc.collectionPath, documentId: doc.documentId, revision: doc.revision }))
    } });
    writes.push({ collectionPath: CYCLES, documentId: checked.cycleId, updateTime: finalCheck._cycle.__updateTime,
      data: { LastCleanupAt: at, LastBackupId: id }, updateMask: ['LastCleanupAt', 'LastBackupId'] });
    // Marks/history and the backup receipt are committed atomically with field
    // removal. Any enrollment/edit/concurrent cleanup invalidates the revision.
    await commit(env, writes);
    return { ok: true, cleaned: checked._sources.length, remaining: checked.eligible - checked._sources.length,
      backupId: id, sha256, bytes: bytes.byteLength };
  }

  async function backups(body) {
    const id = await admissionCycleId(env, body);
    return { ok: true, backups: (await list(env, AUDITS)).filter(row => row.CycleId === id && row.WorkspaceId === identity.workspaceId)
      .map(row => ({ id: row.__id, count: row.Count, verifiedAt: row.VerifiedAt, sha256: row.Sha256, bytes: row.Bytes })) };
  }

  async function download(body) {
    if (!/^[a-f0-9-]{36}$/.test(clean(body.backupId))) throw error('Choose a saved admission backup.');
    const receipt = await get(env, AUDITS, body.backupId);
    if (!receipt || receipt.WorkspaceId !== identity.workspaceId ||
        receipt.CycleId !== await admissionCycleId(env, body) ||
        receipt.Key !== `private-admission-backups/${identity.workspaceId}/${receipt.CycleId}/${body.backupId}.json`)
      throw error('This backup was not found in the selected school and cycle.', 404);
    const stored = await requireDocumentStorage(env).get(receipt.Key);
    if (!stored || stored.size !== receipt.Bytes || stored.size > MAX_BYTES) throw error('The saved backup is unavailable.', 409);
    const bytes = await stored.arrayBuffer();
    if (await admissionHash(bytes) !== receipt.Sha256) throw error('Backup integrity check failed. Contact support.', 409);
    return new Response(bytes, { headers: { 'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="admission-backup-${body.backupId}.json"`,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'" } });
  }

  return { state, policy, savePolicy, preview, close, cleanup, backups, download };
}

export function publicAdmissionPreview(preview) {
  const { _sources, _cycle, ...safe } = preview;
  return safe;
}
