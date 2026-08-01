// Authenticated staff proxy for viewing or downloading private admission documents.

import { deleteDocument, getDocument, requireFirestoreEnv } from '../lib/firestore.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { getSchoolDocumentById, querySchoolCollection, upsertSchoolDocument } from '../lib/school-scope.js';
import { resolveDocumentStorage } from '../lib/document-storage.js';
import { readJsonBody } from '../lib/request-security.js';
import {
  admissionApplicationScopePath,
  admissionThumbnailDocumentId,
  safeStoredDocument
} from '../lib/document-files.js';

const DOCUMENTS = [
  ['BirthCertificate', 'Birth Certificate'],
  ['PreviousSchoolReport', 'Previous School Report'],
  ['PassportPhotograph', 'Passport Photograph'],
  ['MedicalReport', 'Medical Report'],
  ['TransferCertificateDoc', 'Transfer Certificate'],
  ['AcceptanceForm', 'Acceptance Form']
];

function clean(value) { return String(value ?? '').trim(); }
function lower(value) { return clean(value).toLowerCase(); }

export function applicationDocumentScope(application = {}) {
  const scopePath = admissionApplicationScopePath(application.__scopePath);
  const match = /^schoolBranches\/([^/]+)\/sections\/(primary|secondary)\/applications$/i.exec(scopePath);
  const pathBranchId = lower(match?.[1]);
  const pathSchoolSection = lower(match?.[2]);
  const fieldBranchId = lower(application.BranchId || application.branchId);
  const fieldSchoolSection = lower(application.SchoolSection || application.schoolSection);
  const branchConflict = Boolean(pathBranchId && fieldBranchId && pathBranchId !== fieldBranchId);
  const sectionConflict = Boolean(
    pathSchoolSection &&
    fieldSchoolSection &&
    pathSchoolSection !== fieldSchoolSection
  );
  return {
    branchId: fieldBranchId || pathBranchId,
    schoolSection: fieldSchoolSection || pathSchoolSection,
    valid: !branchConflict && !sectionConflict
  };
}

export function staffCanAccessApplicationDocument(user = {}, application = {}) {
  if (lower(user.role || user.Role) === 'super admin') return true;
  const scope = applicationDocumentScope(application);
  if (!scope.valid) return false;

  const assignedBranch = lower(user.branchId || user.BranchId);
  if (assignedBranch && assignedBranch !== 'all') {
    if (!scope.branchId || assignedBranch !== scope.branchId) return false;
  }

  const assignedSection = lower(
    user.schoolSectionAccess ||
    user.SchoolSectionAccess ||
    user.schoolSection ||
    user.SchoolSection ||
    'all'
  );
  if (assignedSection && assignedSection !== 'all') {
    if (!scope.schoolSection || assignedSection !== scope.schoolSection) return false;
  }
  return true;
}

function reference(row) {
  return clean(row.ApplicationReference || row.applicationReference || row.ApplicationID || row.applicationId || row.__id);
}

function documentEntry(row, key) {
  const documents = row.documents && typeof row.documents === 'object' ? row.documents : {};
  return documents[key] && typeof documents[key] === 'object' ? documents[key] : {};
}

function documentUrl(row, key) {
  const entry = documentEntry(row, key);
  return clean(entry.url || row[`Doc${key}Url`] || row[`${key}Url`] || row[`${key}Link`]);
}

function legacyThumbnailBelongsToApplication(thumbnail, application) {
  if (!thumbnail) return false;
  const applicationScope = admissionApplicationScopePath(application.__scopePath) || 'applications';
  const savedScope = admissionApplicationScopePath(thumbnail.ApplicationScopePath);
  if (savedScope) return lower(savedScope) === lower(applicationScope);
  if (applicationScope === 'applications') return true;
  const thumbnailOperationId = clean(thumbnail.UploadOperationId);
  const applicationOperationId = clean(documentEntry(application, 'PassportPhotograph').uploadOperationId);
  return Boolean(thumbnailOperationId && applicationOperationId && thumbnailOperationId === applicationOperationId);
}

function decodeBase64(value) {
  const binary = atob(clean(value));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function safeFileName(value, fallback) {
  return clean(value || fallback).replace(/[^\x20-\x7e]|[\r\n"\\/:*?<>|]+/g, '_').slice(0, 160) || fallback;
}

function safeDocumentId(value) {
  return clean(value)
    .replace(/[\/\\?#\[\]]/g, '-')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/-+/g, '-')
    .slice(0, 140);
}

function uniqueApplications(rows = []) {
  const seen = new Set();
  return rows.filter((row) => {
    if (!row) return false;
    const key = `${clean(row.__scopePath)}|${clean(row.__id || reference(row))}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function loadDriveFile(env, url) {
  const storage = await resolveDocumentStorage(env);
  if (!storage.url || !storage.secret) {
    const error = new Error('Private document storage is not configured.');
    error.status = 500;
    throw error;
  }
  const response = await fetch(storage.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      Secret: storage.secret,
      Action: 'getStoredDocument',
      DocumentUrl: url
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok || !data.fileBase64) {
    const error = new Error(data.message || 'The uploaded document could not be loaded.');
    error.status = response.status >= 400 ? response.status : 502;
    throw error;
  }
  return data;
}

async function deleteDriveFile(env, url) {
  const storage = await resolveDocumentStorage(env);
  if (!storage.url || !storage.secret) throw Object.assign(new Error('Private document storage is not configured.'), { status: 500 });
  const response = await fetch(storage.url, {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ Secret: storage.secret, Action: 'deleteStoredDocument', DocumentUrl: url })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw Object.assign(new Error(data.message || 'The stored document could not be deleted.'), { status: response.status >= 400 ? response.status : 502 });
  return data;
}

async function recalculateDocuments(env, application) {
  const settings = await getDocument(env, 'settings', 'admissionDocuments').catch(() => null);
  const enabled = settings?.Enabled && typeof settings.Enabled === 'object' ? settings.Enabled : {};
  const active = DOCUMENTS.filter(([key]) => enabled[key] !== false);
  const uploaded = active.filter(([key]) => Boolean(documentUrl(application, key)));
  application.DocumentsCompletion = `${active.length ? Math.round((uploaded.length / active.length) * 100) : 100}%`;
  application.MissingDocuments = active.filter(([key]) => !documentUrl(application, key)).map(([, label]) => label).join(', ');
}

async function handleRequest(context, body = null) {
  try {
    const { request, env } = context;
    requireFirestoreEnv(env);
    const sharedSecretAuthorized = body && clean(env.BACKEND_SHARED_SECRET) && clean(body.Secret || body.secret) === clean(env.BACKEND_SHARED_SECRET);
    let user = null;
    if (!sharedSecretAuthorized) {
      user = await requireStaffSession(env, request);
      if (!(user.allowedSections || []).includes('admissions')) {
        return Response.json({ ok: false, message: 'Your role cannot access admission documents.' }, { status: 403 });
      }
    }

    const requestUrl = new URL(request.url);
    const applicationReference = clean((body && (body.ApplicationReference || body.applicationReference)) || requestUrl.searchParams.get('applicationReference'));
    const requestedScopePath = clean(
      (body && (body.ScopePath || body.scopePath))
      || requestUrl.searchParams.get('scopePath')
    );
    const applicationScopePath = admissionApplicationScopePath(requestedScopePath);
    const key = clean((body && (body.DocumentType || body.documentType)) || requestUrl.searchParams.get('documentType'));
    const requestedMode = clean((body && (body.Mode || body.mode)) || requestUrl.searchParams.get('mode'));
    const mode = lower(requestedMode) === 'download' ? 'attachment' : 'inline';
    const definition = DOCUMENTS.find(([candidate]) => candidate === key);
    if (!applicationReference || !definition) {
      return Response.json({ ok: false, message: 'A valid application reference and document type are required.' }, { status: 400 });
    }
    if (requestedScopePath && !applicationScopePath) {
      return Response.json({ ok: false, message: 'The application scope is invalid.' }, { status: 400 });
    }

    const direct = applicationScopePath
      ? await getDocument(env, applicationScopePath, safeDocumentId(applicationReference)).catch(() => null)
      : await getSchoolDocumentById(env, 'applications', safeDocumentId(applicationReference)).catch(() => null);
    const directApplication = direct
      ? { ...direct, __scopePath: direct.__scopePath || applicationScopePath || 'applications' }
      : null;
    let candidates = directApplication && lower(reference(directApplication)) === lower(applicationReference)
      ? [directApplication]
      : [];
    if (!candidates.length || !applicationScopePath) {
      const queried = await querySchoolCollection(env, 'applications', {
        filters: [
          { field: 'ApplicationReference', op: '==', value: applicationReference },
          { field: 'ApplicationID', op: '==', value: applicationReference }
        ],
        filterJoin: 'OR',
        limit: 20,
        ...(applicationScopePath ? { scopePath: applicationScopePath } : {})
      }).catch(() => []);
      candidates = uniqueApplications([...candidates, ...queried])
        .filter((row) => lower(reference(row)) === lower(applicationReference));
    }
    const application = candidates.length === 1 ? candidates[0] : null;
    if (!application) return Response.json({ ok: false, message: 'Application not found.' }, { status: 404 });
    if (user && !staffCanAccessApplicationDocument(user, application)) {
      return Response.json({ ok: false, message: 'This application belongs to another school branch or section.' }, { status: 403 });
    }
    const storedUrl = documentUrl(application, key);
    if (!storedUrl) return Response.json({ ok: false, message: `${definition[1]} has not been uploaded.` }, { status: 404 });

    const metadata = documentEntry(application, key);
    const action = lower((body && body.action) || requestUrl.searchParams.get('action'));
    if (action === 'delete') {
      const role = clean((user && user.role) || (body && (body.UserRole || body.userRole)));
      if (!['Super Admin', 'Admissions Officer'].includes(role)) {
        return Response.json({ ok: false, message: 'Only Super Admin or Admissions Officer can delete admission documents.' }, { status: 403 });
      }
      await deleteDriveFile(env, storedUrl);
      const documents = application.documents && typeof application.documents === 'object' ? { ...application.documents } : {};
      delete documents[key];
      const updated = { ...application, documents, [`Doc${key}`]: 'NO', [`Doc${key}Url`]: '', UpdatedAt: new Date().toISOString(), IntelligenceUpdatedBy: user?.displayName || clean(body?.RecordedBy) || 'Admissions Office' };
      delete updated.__id; delete updated.__name;
      await recalculateDocuments(env, updated);
      await upsertSchoolDocument(env, 'applications', application.__id || applicationReference, updated);
      if (key === 'PassportPhotograph') {
        const thumbnailReference = reference(application);
        const applicationScope = admissionApplicationScopePath(application.__scopePath) || 'applications';
        const scopedThumbnailId = await admissionThumbnailDocumentId(thumbnailReference, applicationScope);
        await deleteDocument(env, 'applicationPassportThumbnails', scopedThumbnailId).catch(() => {});
        const legacyThumbnailId = safeDocumentId(thumbnailReference);
        const legacyThumbnail = await getDocument(
          env,
          'applicationPassportThumbnails',
          legacyThumbnailId
        ).catch(() => null);
        if (legacyThumbnailBelongsToApplication(legacyThumbnail, application)) {
          await deleteDocument(env, 'applicationPassportThumbnails', legacyThumbnailId).catch(() => {});
        }
      }
      return Response.json({ ok: true, message: `${definition[1]} deleted. The Drive file was moved to trash.` }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const file = await loadDriveFile(env, storedUrl);
    const stored = safeStoredDocument(
      file.fileName || metadata.fileName || `${key}.bin`,
      file.fileBase64
    );
    const fileName = safeFileName(stored.fileName, `${key}.bin`);
    const mimeType = stored.mimeType;
    const disposition = stored.valid && stored.inlineSafe ? mode : 'attachment';
    return new Response(decodeBase64(file.fileBase64), {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': `${disposition}; filename="${fileName}"`,
        'Cache-Control': 'private, no-store',
        'Content-Security-Policy': "sandbox; default-src 'none'; object-src 'none'; script-src 'none'",
        'X-Content-Type-Options': 'nosniff'
      }
    });
  } catch (error) {
    return Response.json({ ok: false, message: clean(error && error.message ? error.message : error) }, { status: error.status || 500 });
  }
}

export async function onRequestGet(context) {
  return handleRequest(context);
}

export async function onRequestPost(context) {
  const body = await readJsonBody(context.request, { maxBytes: 64 * 1024 });
  return handleRequest(context, body);
}
