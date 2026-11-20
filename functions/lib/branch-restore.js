import { branchResetPathAllowed, branchOwnsResetRecord, exclusivelyScoped, resetBranchId } from './branch-reset.js';
import { requiredDeploymentIdentity } from './deployment-identity.js';
import { batchCommitLiteralDocuments, getDocument, getDocuments, queryCollection } from './firestore.js';
import { validateManifest } from './organization-backup.js';
import { normalizeSchoolStructure } from './school-scope.js';
import { branchResetFilePrefixes, containsReference } from './document-storage.js';

const database = { getDocument, getDocuments, queryCollection, commit: batchCommitLiteralDocuments };
const jobs = 'systemRestoreJobs';
const fail = message => Object.assign(new Error(message), { status: 409 });
const hospitalRecords = new Set(['Visits', 'Appointments', 'AppointmentEvents', 'ClinicQueueEvents',
  'AppointmentWaitlist', 'AppointmentWaitlistEvents', 'Encounters', 'Consultations', 'ClinicalEntries',
  'Orders', 'OrderEvents', 'InvestigationReports', 'CareSummaries', 'DischargeSummaries', 'NursingCharts']);

export function collectionKind(path, { workspaceId, edition }, branch) {
  if (typeof path !== 'string') return '';
  if (branchResetPathAllowed(path, branch, edition)) return 'operational';
  if (edition === 'school' && ['admissionClasses', 'schoolClasses'].some(name => path === `organisationBranches/${branch}/${name}`)) return 'branch';
  const prefix = `hospitalWorkspaces/${workspaceId}/hospital`;
  if (edition === 'hospital' && path.startsWith(prefix) && hospitalRecords.has(path.slice(prefix.length))) return 'hospital';
  return '';
}

export function owns(path, row, identity, branch) {
  if ([row.WorkspaceId, row.workspaceId].some(id => id && id !== identity.workspaceId)) return false;
  const kind = collectionKind(path, identity, branch);
  if (kind === 'operational') return branchOwnsResetRecord(path, row, branch, identity.edition);
  if (kind === 'hospital' && row.BranchId !== branch && row.branchId !== branch) return false;
  return !!kind && exclusivelyScoped(row, branch, identity.edition);
}

function fields(row) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('__')));
}

// Shared by backup creation and exact-match restore so the same records qualify for both.
export async function readOwnedBranchPage(env, db, identity, branch, path, cursor, readTime) {
  const kind = collectionKind(path, identity, branch);
  if (!kind) throw fail('This collection is outside the selected branch.');
  const rows = await db.queryCollection(env, path, { orderBy: [{ field: '__name__' }], limit: 250,
    startAfterName: cursor, ...(readTime ? { readTime } : {}), ...(path.includes('/') && kind !== 'hospital' ? {} : {
      filters: ['BranchId', 'branchId'].map(field => ({ field, op: '==', value: branch })), filterJoin: 'OR'
    }) });
  const next = rows.length === 250 ? rows.at(-1).__name : '';
  if (rows.length === 250 && (!next || next === cursor)) throw fail('The database could not advance to the next page.');
  return { rows: rows.filter(row => owns(path, row, identity, branch)), cursor: next };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

async function digest(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(value)));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
}

function checkRows(rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 100) throw fail('Preview at most 100 records at a time.');
  const seen = new Set();
  for (const row of rows) {
    const id = row?.__id;
    if (typeof id !== 'string' || !id || id !== id.trim() || id.includes('/') || id === '.' || id === '..' || seen.has(id)) {
      throw fail('The backup contains a missing, duplicate or invalid document ID.');
    }
    seen.add(id);
  }
}

async function inspect(env, db, identity, branch, path, rows, remove) {
  checkRows(rows);
  if (!collectionKind(path, identity, branch)) throw fail('This collection is outside the selected branch.');
  const candidates = remove ? rows : rows.filter(row => !row.__redactedFields && owns(path, row, identity, branch));
  const live = candidates.length ? await db.getDocuments(env, path, candidates.map(row => row.__id)) : [];
  if (live.length !== candidates.length) throw fail('The database returned an incomplete preview.');
  const details = [], changes = [];
  candidates.forEach((row, i) => {
    const current = live[i];
    if (current && (current.__id !== row.__id || !current.__updateTime)) throw fail('Could not verify the live record version.');
    if (remove) {
      if (!current || !owns(path, current, identity, branch) || !row.version || current.__updateTime !== row.version) throw fail('A removal candidate changed. Preview the backup again.');
      details.push({ id: row.__id, action: 'remove' });
      changes.push({ id: row.__id, version: current.__updateTime, remove: true });
      return;
    }
    const data = fields(row);
    let action = 'create';
    if (current) {
      if (!owns(path, current, identity, branch)) action = 'conflict';
      else action = JSON.stringify(canonical(fields(current))) === JSON.stringify(canonical(data)) ? 'unchanged' : 'update';
    }
    details.push({ id: row.__id, action });
    if (action === 'create' || action === 'update') changes.push({ id: row.__id, version: current?.__updateTime || '', data });
  });
  return { details, changes, skipped: rows.length - candidates.length };
}

// Preview has no write path. Apply repeats both ownership checks and uses a
// Firestore precondition on every changed row and on the job cursor.
export async function branchRestoreRequest(env, user, action, body, db = database) {
  const identity = requiredDeploymentIdentity(env);
  const branch = resetBranchId(body.branchId);
  const working = user.branchId || user.BranchId;
  if (working && working !== 'all' && working !== branch) throw fail('Switch to the selected working branch before restoring.');
  const actor = String(user.username || user.Username || '').trim().toLowerCase();
  if (!actor) throw fail('Sign in again before restoring.');
  const structure = normalizeSchoolStructure(await db.getDocument(env, 'settings', 'schoolStructure') || {});
  const selected = structure.Branches.find(row => row.Id === branch);
  if (!selected) throw fail('The selected branch is no longer configured.');
  const mode = body.mode;
  if (!['merge', 'exact'].includes(mode)) throw fail('Select a restore mode.');
  const phrase = `RESTORE ${branch} ${mode}`.toUpperCase();
  const applyFile = action === 'apply-branch-restore-document';
  if (action !== 'apply-branch-restore' && !applyFile) {
    validateManifest(identity, body.manifest);
    if (body.manifest?.branchId && body.manifest.branchId !== branch) throw fail('This backup belongs to a different branch.');
  }
  if (action === 'preview-branch-restore') {
    if (!Array.isArray(body.paths) || body.paths.some(path => typeof path !== 'string')) throw fail('Invalid backup collection list.');
    return { ok: true, branchId: branch, name: selected.Name, phrase, paths: body.paths.filter(path => collectionKind(path, identity, branch)) };
  }
  const path = body.collectionPath;
  const inspectFile = file => inspectRestoreFile(env, identity, branch, structure, file);
  const fileHash = file => digest(['uploaded-document', identity, branch, mode, file]);
  if (action === 'preview-branch-restore-documents') {
    if (!Array.isArray(body.files) || body.files.length > 40) throw fail('Compare up to 40 files at a time.');
    const details = [];
    for (const file of body.files) {
      const state = await inspectFile(file);
      details.push({ key: file.key, state, hash: state === 'create' ? await fileHash(file) : '' });
    }
    return { ok: true, details };
  }
  if (action === 'preview-branch-restore-live') {
    const kind = collectionKind(path, identity, branch);
    if (mode !== 'exact' || !kind) throw fail('This collection is outside the exact-match preview.');
    const page = await readOwnedBranchPage(env, db, identity, branch, path, body.cursor || '');
    return { ok: true, rows: page.rows.map(row => ({ __id: row.__id, version: row.__updateTime })), cursor: page.cursor };
  }
  const remove = body.remove === true;
  if (remove && mode !== 'exact') throw fail('Keeping newer records does not allow removals.');
  if (action === 'preview-branch-restore-rows') {
    const { details, changes, skipped } = await inspect(env, db, identity, branch, path, body.documents, remove);
    return { ok: true, details, skipped, hash: changes.length ? await digest([identity, branch, mode, path, changes]) : '' };
  }
  if (action === 'prepare-branch-restore') {
    if (body.confirmation !== phrase || body.safetyBackupCreated !== true) throw fail('Confirm the branch and download the safety backup first.');
    const hashes = body.hashes;
    if (!Array.isArray(hashes) || !hashes.length || hashes.length > 8000 || hashes.some(hash => !/^[a-f0-9]{64}$/.test(hash)) || new Set(hashes).size !== hashes.length) throw fail('Invalid restore preview. Preview the backup again.');
    const jobId = 'BR-' + crypto.randomUUID();
    await db.commit(env, [{ collectionPath: jobs, documentId: jobId, exists: false, data: {
      JobType: 'BranchRestore', Status: 'Prepared', BranchId: branch, WorkspaceId: identity.workspaceId, Edition: identity.edition,
      ActorUsername: actor, CreatedAt: new Date().toISOString(), ExpiresAt: new Date(Date.now() + 7200000).toISOString(),
      BackupCreatedAt: body.manifest.createdAt || '', Mode: mode, Hashes: hashes, NextChunk: 0, Restored: 0
    } }]);
    return { ok: true, jobId };
  }
  if ((!applyFile && action !== 'apply-branch-restore') || !/^BR-[a-f0-9-]{36}$/.test(body.jobId || '')) throw fail('Unknown branch restore session.');
  const job = await db.getDocument(env, jobs, body.jobId);
  if (!job || job.JobType !== 'BranchRestore' || job.ActorUsername !== actor || job.WorkspaceId !== identity.workspaceId ||
      job.Edition !== identity.edition || job.BranchId !== branch || job.Mode !== mode || !job.__updateTime || Date.parse(job.ExpiresAt) <= Date.now()) throw fail('The restore session expired or belongs to another branch or administrator.');
  const i = body.index;
  if (!Number.isInteger(i) || i < 0 || i >= job.Hashes.length || body.hash !== job.Hashes[i] || i > job.NextChunk) throw fail('This batch does not match the confirmed preview.');
  if (i < job.NextChunk) return { ok: true, restored: job.Restored, complete: job.Status === 'Completed' };
  const writes = [];
  if (applyFile) {
    const file = body.file;
    if (await fileHash(file) !== job.Hashes[i] || file.size !== body.byteLength || !body.binary) throw fail('File does not match the confirmed preview.');
    const state = await inspectFile(file);
    if (state !== 'create' && state !== 'unchanged') throw fail('The live file changed. Preview again.');
    if (file.owner) {
      const [row] = await db.getDocuments(env, file.owner.path, [file.owner.id]);
      if (!row || !owns(file.owner.path, row, identity, branch) || !containsReference(row, file.key)) throw fail('The linked branch record changed. Preview again.');
    }
    if (state === 'create') {
      const [, edition, workspaceId, category, branchId, schoolSection, ownerId, documentType] = file.key.split('/');
      const result = await putRestoreFile(env.DYNAMAX_DOCUMENTS, file, body.binary, {
        onlyIf: new Headers({ 'If-None-Match': '*' }), sha256: file.sha256, httpMetadata: { contentType: file.type },
        customMetadata: { edition, workspaceId, category, branchId, schoolSection, ownerId, documentType, fileName: file.name, mimeType: file.type }
      });
      if (!result && await inspectFile(file) !== 'unchanged') throw fail('Another file now uses this location. Preview again.');
    }
  } else {
    const { changes } = await inspect(env, db, identity, branch, path, body.documents, remove);
    if (await digest([identity, branch, mode, path, changes]) !== job.Hashes[i]) throw fail('The backup or live records changed. Preview the backup again.');
    for (const { id, version, data } of changes) writes.push({ collectionPath: path, documentId: id,
      ...(remove ? { operation: 'delete' } : { data, restoreJsonTypes: true }), ...(version ? { updateTime: version } : { exists: false }) });
  }
  const complete = i + 1 === job.Hashes.length;
  const progress = { NextChunk: i + 1, Restored: job.Restored + writes.length, Status: complete ? 'Completed' : 'Restoring', UpdatedAt: new Date().toISOString() };
  if (applyFile) progress.DocumentsProcessed = (job.DocumentsProcessed || 0) + 1;
  writes.push({ collectionPath: jobs, documentId: body.jobId, data: progress, updateMask: Object.keys(progress), updateTime: job.__updateTime });
  await db.commit(env, writes);
  return { ok: true, restored: progress.Restored, complete };
}

export async function putRestoreFile(bucket, file, source, options) {
  if (!(source instanceof ReadableStream)) return bucket.put(file.key, source, options);
  // R2 requires a known stream length. Browser uploads may arrive chunked.
  const target = new FixedLengthStream(file.size);
  const stop = new AbortController();
  const transfer = source.pipeTo(target.writable, {signal: stop.signal}).then(() => null, error => error);
  try {
    const stored = await bucket.put(file.key, target.readable, options);
    if (stored) {
      const error = await transfer;
      if (error) throw error;
    }
    return stored;
  } finally {
    stop.abort();
    if (!target.readable.locked) await target.readable.cancel().catch(() => {});
    await transfer;
  }
}

async function inspectRestoreFile(env, identity, branch, structure, file) {
  const prefixes = branchResetFilePrefixes(identity, branch);
  const key = file?.key;
  if (structure.Branches.some(row => row.Id !== branch && row.Id.replace(/^[._-]+|[._-]+$/g, '') === branch)) return 'unverified';
  if (typeof key !== 'string' || !prefixes.some(prefix => key.startsWith(prefix)) || key.split('/').length !== 9 ||
      key.split('/').some(segment => !/^[a-z0-9][a-z0-9._-]*$/i.test(segment)) || key.length > 1024) return 'unverified';
  if (branch === 'main' && !file.owner || file.owner && (!collectionKind(file.owner.path, identity, branch) ||
      typeof file.owner.id !== 'string' || !file.owner.id || /[/]/.test(file.owner.id) || ['.', '..'].includes(file.owner.id))) return 'unverified';
  if (typeof file.name !== 'string' || file.name.length > 256 || typeof file.type !== 'string' || file.type.length > 160 ||
      /[\x00-\x1f\x7f]/.test(file.name + file.type) || !Number.isSafeInteger(file.size) || file.size < 0 ||
      !/^[a-f0-9]{64}$/.test(file.sha256)) throw fail('Invalid archived document details.');
  const bucket = env.DYNAMAX_DOCUMENTS;
  if (!bucket?.head || !bucket?.put) throw fail('Private document storage is unavailable.');
  const current = await bucket.head(key);
  if (!current) return 'create';
  const meta = current.customMetadata || {};
  if (meta.workspaceId && meta.workspaceId !== identity.workspaceId || meta.edition && meta.edition !== identity.edition ||
      meta.branchId && meta.branchId !== branch) return 'unverified';
  const sha256 = current.checksums?.toJSON?.().sha256;
  return current.size === file.size && (sha256 ? sha256 === file.sha256 :
    (current.etag && current.etag === file.etag || current.version && current.version === file.version)) ? 'unchanged' : 'conflict';
}
