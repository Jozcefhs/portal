import { requiredDeploymentIdentity } from '../lib/deployment-identity.js';
import { requireFirestoreEnv } from '../lib/firestore.js';
import {
  deleteStoredDocument,
  putStoredDocument,
  resolveDocumentStorage
} from '../lib/document-storage.js';
import {
  academicCbtPaperDigest,
  validateAcademicCbtPaper
} from '../lib/academic-cbt-papers.js';
import {
  saveAcademicCbtTest,
  validateAcademicCbtTestInput
} from '../lib/academic-management.js';
import {
  beginIdempotentRequest,
  completeIdempotentRequest,
  failIdempotentRequest,
  readJsonBody
} from '../lib/request-security.js';
import { requireStaffSession } from '../lib/staff-auth.js';

const clean = (value) => String(value ?? '').trim();

function failure(message, status = 400, code = '') {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
}

export async function onRequestPost(context) {
  return handleRequest(context);
}

async function handleRequest(context) {
  let idempotency = null;
  let uploadedUrl = '';
  let storage = null;
  let testSaved = false;
  try {
    const { request, env } = context;
    const deployment = requiredDeploymentIdentity(env);
    if (deployment.edition !== 'school') throw failure('CBT is available only in the School edition.', 404);
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    const body = await readJsonBody(request, { maxBytes: 12 * 1024 * 1024 });
    const paper = validateAcademicCbtPaper(body);
    const preview = await validateAcademicCbtTestInput(env, user, { ...body, RequirePaper: false });
    idempotency = await beginIdempotentRequest(env, request, body, {
      scope: 'academic-cbt-paper', actor: clean(user.username), ttlMinutes: 30 * 24 * 60
    });
    if (!idempotency.enabled) throw failure('An idempotency key is required for CBT paper uploads.', 400, 'IDEMPOTENCY_KEY_REQUIRED');
    if (idempotency.replay) {
      return Response.json(idempotency.response, {
        status: idempotency.status || 200,
        headers: { 'Cache-Control': 'no-store', 'Idempotency-Replayed': 'true' }
      });
    }
    storage = await resolveDocumentStorage(env);
    if (!storage.configured) throw failure('Cloudflare R2 document storage is not connected.', 503, 'DOCUMENT_STORAGE_NOT_CONFIGURED');
    const fileBase64 = clean(body.FileBase64);
    const digest = await academicCbtPaperDigest(fileBase64);
    const stored = await putStoredDocument(env, {
      category: 'academic-cbt',
      branchId: preview.context.scope.branchId,
      schoolSection: preview.context.scope.schoolSection,
      ownerId: preview.record.CbtTestId,
      documentType: 'question-paper',
      operationId: idempotency.documentId,
      fileName: paper.fileName,
      mimeType: paper.mimeType,
      fileBase64,
      customMetadata: { uploadedBy: clean(user.username) }
    });
    uploadedUrl = stored.documentUrl;
    const saved = await saveAcademicCbtTest(env, user, {
      ...body,
      FileBase64: undefined,
      CbtTestId: preview.existing?.CbtTestId || '',
      PaperUrl: uploadedUrl,
      PaperFileName: paper.fileName,
      PaperMimeType: paper.mimeType,
      PaperDigest: digest,
      PaperByteLength: paper.byteLength,
      RequirePaper: true
    }, { validation: preview });
    testSaved = true;
    if (clean(preview.existing?.PaperUrl) && clean(preview.existing.PaperUrl) !== uploadedUrl) {
      await deleteStoredDocument(env, preview.existing.PaperUrl).catch(() => null);
    }
    const created = saved.cbtTest || {};
    const data = {
      ok: true,
      message: saved.message || 'CBT test scheduled online.',
      CbtTestId: preview.record.CbtTestId,
      RevisionToken: clean(created.RevisionToken),
      CbtTest: created
    };
    await completeIdempotentRequest(env, idempotency, data, 200);
    return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (uploadedUrl && storage && !testSaved) await deleteStoredDocument(context.env, uploadedUrl).catch(() => null);
    if (idempotency?.owner) await failIdempotentRequest(context.env, idempotency, error);
    return Response.json({
      ok: false,
      code: clean(error.code),
      outcomeUncertain: Boolean(error.outcomeUncertain),
      message: clean(error.message) || 'The CBT test could not be scheduled.'
    }, {
      status: Number(error.status || 500),
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}

export function onRequestGet() {
  return Response.json({ ok: false, message: 'Method not allowed.' }, {
    status: 405,
    headers: { Allow: 'POST', 'Cache-Control': 'no-store' }
  });
}
