import { getDocument, requireFirestoreEnv, upsertDocument } from '../lib/firestore.js';
import { putStoredDocument, resolveDocumentStorage } from '../lib/document-storage.js';
import { validateFinanceAttachment } from '../lib/finance-attachments.js';
import {
  beginIdempotentRequest,
  completeIdempotentRequest,
  failIdempotentRequest,
  readJsonBody
} from '../lib/request-security.js';
import { requireStaffSession } from '../lib/staff-auth.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();

function errorWithStatus(message, status = 400, code = '') {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
}

function safeId(value) {
  return clean(value).replace(/[\/\\?#\[\]]/g, '-').replace(/\s+/g, '_').slice(0, 140);
}

function actor(user = {}) {
  return clean(user.displayName || user.username);
}

function userDepartment(user = {}) {
  const explicit = clean(user.department);
  if (explicit) return explicit;
  return {
    'Admissions Officer': 'Admissions',
    'Accounts Officer': 'Accounts',
    Management: 'Management',
    'Tuck Shop User': 'Tuck Shop',
    'Clinic User': 'Clinic',
    'Kitchen User': 'Kitchen',
    'Front Desk': 'Front Desk',
    'Super Admin': 'Administration'
  }[clean(user.role)] || '';
}

function same(left, right) {
  return lower(left) === lower(right);
}

async function assertFinanceUploadAccess(env, user, input) {
  if (!userDepartment(user)) {
    throw errorWithStatus('A department must be assigned before finance documents can be uploaded.', 403);
  }
  if (input.kind !== 'imprest-receipt') return;
  const recordId = clean(input.recordId);
  if (!recordId) throw errorWithStatus('The imprest reference is required.', 400);
  const imprest = await getDocument(env, 'accountingImprests', safeId(recordId));
  if (!imprest) throw errorWithStatus('The selected imprest record was not found.', 404);
  const activeBranch = lower(user.branchId);
  if (activeBranch && activeBranch !== 'all' && lower(imprest.BranchId || 'main') !== activeBranch) {
    throw errorWithStatus('The selected imprest record does not belong to the active branch.', 403);
  }
  const privileged = ['Super Admin', 'Accounts Officer'].includes(clean(user.role));
  if (!privileged && !same(imprest.CustodianUsername || imprest.RequestedByUsername, user.username)) {
    throw errorWithStatus('Only the imprest custodian or Accounts can upload its retirement receipts.', 403);
  }
  if (lower(imprest.Status) !== 'issued') {
    throw errorWithStatus('Receipts can only be uploaded while the imprest is issued and awaiting retirement.', 409);
  }
}

async function writeUploadAudit(env, user, input, validated, documentUrl) {
  const timestamp = new Date().toISOString();
  const id = `WEB-AUDIT-${timestamp.replace(/[^0-9]/g, '')}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  await upsertDocument(env, 'accountingAudit', safeId(id), {
    AuditId: id,
    Timestamp: timestamp,
    Action: 'UPLOAD',
    RecordType: validated.definition.label,
    RecordId: clean(input.recordId) || 'Pending requisition',
    Details: `${validated.fileName} stored in Cloudflare R2.`,
    DocumentUrl: documentUrl,
    User: actor(user),
    UserRole: clean(user.role),
    Department: userDepartment(user),
    BranchId: clean(user.branchId) || 'main',
    SchoolSection: clean(user.schoolSectionAccess),
    SourcePlatform: 'Web'
  });
}

export async function onRequestPost(context) {
  let idempotency = null;
  try {
    const { request, env } = context;
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    const body = await readJsonBody(request, { maxBytes: 12 * 1024 * 1024 });
    const validated = validateFinanceAttachment(body);
    const input = { ...body, kind: validated.kind };
    await assertFinanceUploadAccess(env, user, input);
    idempotency = await beginIdempotentRequest(env, request, body, {
      scope: `finance-attachment-${validated.kind}`,
      actor: clean(user.username),
      ttlMinutes: 30 * 24 * 60
    });
    if (!idempotency.enabled) {
      throw errorWithStatus('An idempotency key is required for document uploads.', 400, 'IDEMPOTENCY_KEY_REQUIRED');
    }
    if (idempotency.replay) {
      return Response.json(idempotency.response, {
        status: idempotency.status || (idempotency.response?.ok === false ? 409 : 200),
        headers: { 'Cache-Control': 'no-store', 'Idempotency-Replayed': 'true' }
      });
    }
    const storage = await resolveDocumentStorage(env);
    if (!storage.configured) throw errorWithStatus(
      'Cloudflare R2 document storage is not connected to this deployment.',
      503,
      'DOCUMENT_STORAGE_NOT_CONFIGURED'
    );
    const stored = await putStoredDocument(env, {
      category: 'finance',
      branchId: clean(user.branchId) || 'main',
      schoolSection: clean(user.schoolSectionAccess) || 'all',
      ownerId: clean(input.recordId) || idempotency.documentId,
      documentType: validated.kind,
      fileName: validated.fileName,
      mimeType: validated.mimeType,
      fileBase64: clean(input.fileBase64),
      operationId: idempotency.documentId,
      customMetadata: {
        uploadedBy: clean(user.username),
        department: userDepartment(user)
      }
    });
    const documentUrl = stored.documentUrl;
    await writeUploadAudit(env, user, input, validated, documentUrl);
    const data = {
      ok: true,
      message: `${validated.definition.label} uploaded securely.`,
      documentUrl,
      fileName: validated.fileName
    };
    await completeIdempotentRequest(env, idempotency, data, 200);
    return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (idempotency?.owner) await failIdempotentRequest(context.env, idempotency, error);
    return Response.json({
      ok: false,
      code: clean(error.code),
      outcomeUncertain: Boolean(error.outcomeUncertain),
      message: error.message || String(error)
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
