import { requireFirestoreEnv, upsertDocument } from '../lib/firestore.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { listSchoolCollection, schoolSectionFor, upsertSchoolDocument } from '../lib/school-scope.js';
import { admissionApplicationScopePath, admissionThumbnailDocumentId, validateAdmissionDocumentFile, validateAdmissionThumbnail } from '../lib/document-files.js';
import { deleteStoredDocument, putStoredDocument } from '../lib/document-storage.js';
import { readJsonBody } from '../lib/request-security.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();

function safeDocumentId(value) {
  return clean(value).replace(/[\/\\?#\[\]]/g, '-').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/-+/g, '-').slice(0, 140);
}

function referenceMatches(row = {}, value = '') {
  const wanted = lower(value);
  return wanted && [row.AdmissionNo, row.AccountRef, row.ApplicationReference, row.__id].some((candidate) => lower(candidate) === wanted);
}

function visibleToUser(row = {}, user = {}) {
  const section = lower(user.schoolSectionAccess || 'All');
  const branch = lower(user.branchId || '');
  return (section === 'all' || schoolSectionFor(row) === section)
    && (!branch || lower(row.BranchId || 'main') === branch);
}

function currentPassportUrl(row = {}) {
  return clean(row.documents?.PassportPhotograph?.url || row.DocPassportPhotographUrl || row.PassportPhotographUrl || row.PassportPhotographLink);
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    if (!(user.allowedSections || []).includes('students')) {
      const error = new Error('This staff account is not allowed to manage students.');
      error.status = 403;
      throw error;
    }
    const body = await readJsonBody(request, { maxBytes: 12 * 1024 * 1024 });
    const reference = clean(body.AccountRef || body.AdmissionNo || body.applicationReference);
    const operationId = clean(body.OperationId || body.operationId);
    if (!reference || !operationId) {
      const error = new Error('Student reference and upload operation are required.');
      error.status = 400;
      throw error;
    }
    const validated = validateAdmissionDocumentFile({
      fileName: body.fileName,
      fileBase64: body.fileBase64,
      documentType: 'PassportPhotograph'
    });
    const thumbnail = validateAdmissionThumbnail(body.thumbnailBase64 || body.fileBase64);
    const students = await listSchoolCollection(env, 'students', {
      branchId: user.branchId,
      schoolSectionAccess: user.schoolSectionAccess
    });
    const existing = students.find((row) => referenceMatches(row, reference) && visibleToUser(row, user));
    if (!existing) {
      const error = new Error('Student was not found in your current branch and school section.');
      error.status = 404;
      throw error;
    }
    const studentRef = clean(existing.AdmissionNo || existing.AccountRef || existing.__id);
    const studentDocumentId = safeDocumentId(existing.__id || studentRef);
    const stored = await putStoredDocument(env, {
      category: 'admissions',
      branchId: existing.BranchId || user.branchId || 'main',
      schoolSection: schoolSectionFor(existing),
      ownerId: studentRef,
      documentType: 'PassportPhotograph',
      fileName: validated.fileName,
      mimeType: validated.mimeType,
      fileBase64: body.fileBase64,
      operationId,
      customMetadata: { uploadedBy: lower(user.username), source: 'staff-student-register' }
    });
    const timestamp = new Date().toISOString();
    const previousUrl = currentPassportUrl(existing);
    const documents = existing.documents && typeof existing.documents === 'object' ? { ...existing.documents } : {};
    documents.PassportPhotograph = {
      type: 'PassportPhotograph',
      label: 'Passport Photograph',
      status: previousUrl ? 'Replaced' : 'Uploaded',
      fileName: validated.fileName,
      mimeType: validated.mimeType,
      url: stored.documentUrl,
      previousUrl,
      uploadedAt: timestamp,
      uploadedBy: user.displayName || user.username,
      storage: 'Cloudflare R2',
      uploadOperationId: operationId
    };
    const updated = {
      ...existing,
      documents,
      DocPassportPhotograph: 'YES',
      DocPassportPhotographUrl: stored.documentUrl,
      UpdatedAt: timestamp,
      UpdatedBy: user.displayName || user.username
    };
    delete updated.__id;
    delete updated.__name;
    // Keep __scopePath until upsertSchoolDocument resolves the exact existing
    // branch/section collection; that helper strips transport metadata itself.
    await upsertSchoolDocument(env, 'students', studentDocumentId, updated);
    const applicationScope = admissionApplicationScopePath(existing.__scopePath) || 'applications';
    const thumbnailId = await admissionThumbnailDocumentId(studentRef, applicationScope);
    await upsertDocument(env, 'applicationPassportThumbnails', thumbnailId, {
      ApplicationReference: studentRef,
      ApplicationScopePath: applicationScope,
      FileBase64: clean(body.thumbnailBase64 || body.fileBase64),
      MimeType: thumbnail.mimeType,
      UploadOperationId: operationId,
      UpdatedAt: timestamp,
      UpdatedBy: user.displayName || user.username
    });
    if (previousUrl && previousUrl !== stored.documentUrl) await deleteStoredDocument(env, previousUrl).catch(() => null);
    return Response.json({
      ok: true,
      message: `${studentRef} passport photograph uploaded.`,
      studentRef,
      document: { fileName: validated.fileName, url: stored.documentUrl }
    });
  } catch (error) {
    return Response.json({ ok: false, message: clean(error?.message || error) }, { status: Number(error?.status) || 500 });
  }
}
