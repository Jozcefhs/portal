import { requireFirestoreEnv, upsertDocument } from '../lib/firestore.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { readJsonBody, beginIdempotentRequest, completeIdempotentRequest, failIdempotentRequest } from '../lib/request-security.js';
import { validateAdmissionDocumentFile } from '../lib/document-files.js';
import { getStoredDocument, storedDocumentResponse, putStoredDocument } from '../lib/document-storage.js';
import { AUDIT_DOCUMENT_CATEGORIES, auditAttachments, auditError, getAuditRecord } from '../lib/external-audit-evidence.js';
import { externalAuditDate } from '../lib/external-audit.js';
import { recordBranchId } from '../lib/branch-scope.js';
import { authorizedScope, logAccess } from './external-audit.js';

const clean = (value) => String(value ?? '').trim();

export async function onRequestGet(context) {
  try {
    const { env, request } = context;
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    const input = Object.fromEntries(new URL(request.url).searchParams.entries());
    const scope = authorizedScope(user, input);
    const row = await getAuditRecord(env, scope, clean(input.register), clean(input.recordId));
    const index = Number(input.attachment);
    if (!/^\d+$/.test(clean(input.attachment)) || !Number.isSafeInteger(index)) throw auditError('Choose a valid supporting document.');
    const attachment = auditAttachments(row)[index];
    if (!attachment) throw auditError('The supporting document was not found.', 404);
    // Resolve only a reference taken from the authorised parent record. Never
    // accept a client URL or follow an external document URL on the server.
    const stored = await getStoredDocument(env, attachment.reference);
    const documentBranch = clean(stored.object?.customMetadata?.branchId).toLowerCase();
    if (documentBranch && documentBranch !== recordBranchId(row)) throw auditError('The supporting document does not belong to this record’s branch.', 404);
    await logAccess(env, user, 'FINANCIAL AUDIT DOCUMENT DOWNLOAD', scope.branchId, `${input.register}; ${input.recordId}; ${attachment.label}`);
    if (context.data) context.data.securityAuditHandled = true;
    return storedDocumentResponse(stored, { mode: 'download' });
  } catch (error) {
    return Response.json({ ok: false, message: Number(error.status || 500) >= 500 ? 'The supporting document could not be loaded.' : clean(error.message) },
      { status: Number(error.status || 500), headers: { 'Cache-Control': 'no-store' } });
  }
}

export async function onRequestPost(context) {
  let operation = null;
  try {
    const { env, request } = context;
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    if (user.role !== 'Super Admin') throw auditError('Only a Super Administrator can supply supporting audit documents.', 403);
    const input = await readJsonBody(request, { maxBytes: 12 * 1024 * 1024 });
    const scope = authorizedScope(user, input);
    if (scope.branchId === 'all') throw auditError('Choose the branch this document belongs to before uploading it.');
    const title = clean(input.title).slice(0, 180);
    const category = clean(input.category);
    const date = externalAuditDate(input.documentDate);
    if (!title || !AUDIT_DOCUMENT_CATEGORIES.includes(category)) throw auditError('Enter a title and choose a document category.');
    if (!date || date < scope.dateFrom || date > scope.dateTo) throw auditError('The document date must be within the selected audit period.');
    const relatedRegister = clean(input.relatedRegister);
    const relatedRecordId = clean(input.relatedRecordId);
    if (relatedRegister || relatedRecordId) await getAuditRecord(env, scope, relatedRegister, relatedRecordId);
    let file;
    try { file = validateAdmissionDocumentFile({ fileName: input.fileName, fileBase64: input.fileBase64 }); }
    catch (error) { throw auditError(error.message || 'The supporting document is invalid.'); }
    if (!['application/pdf', 'image/png', 'image/jpeg'].includes(file.mimeType)) throw auditError('Upload a PDF, PNG or JPG supporting document.');
    operation = await beginIdempotentRequest(env, request, input, { scope: 'external-audit-document', actor: user.username, ttlMinutes: 30 * 24 * 60 });
    if (!operation.enabled) throw auditError('An idempotency key is required for evidence uploads.');
    if (operation.replay) return Response.json(operation.response, { status: operation.status || 200, headers: { 'Cache-Control': 'no-store' } });
    const id = `EVID-${operation.documentId}`;
    const stored = await putStoredDocument(env, {
      category: 'financial-audit', branchId: scope.branchId, ownerId: id, documentType: category,
      fileName: file.fileName, mimeType: file.mimeType, fileBase64: clean(input.fileBase64), operationId: operation.documentId,
      customMetadata: { uploadedBy: user.username }
    });
    await upsertDocument(env, 'financialAuditEvidence', id, {
      EvidenceId: id, Title: title, EvidenceCategory: category, DocumentDate: date,
      BranchId: scope.branchId, RelatedRegister: relatedRegister, RelatedRecordId: relatedRecordId,
      FileName: file.fileName, MimeType: file.mimeType, DocumentUrl: stored.documentUrl,
      UploadedBy: user.username, UploadedAt: new Date().toISOString()
    });
    await logAccess(env, user, 'FINANCIAL AUDIT EVIDENCE SUPPLIED', scope.branchId, `${id}; ${category}`);
    if (context.data) context.data.securityAuditHandled = true;
    const result = { ok: true, message: 'Supporting document supplied. The financial source record was not changed.', evidenceId: id };
    await completeIdempotentRequest(env, operation, result, 200);
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (operation?.owner) await failIdempotentRequest(context.env, operation, error);
    return Response.json({ ok: false, message: Number(error.status || 500) >= 500 ? 'The supporting document could not be supplied.' : clean(error.message) },
      { status: Number(error.status || 500), headers: { 'Cache-Control': 'no-store' } });
  }
}
