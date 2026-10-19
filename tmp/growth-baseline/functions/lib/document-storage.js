import { requiredDeploymentIdentity } from './deployment-identity.js';

const clean = (value) => String(value ?? '').trim();

export const DOCUMENT_STORAGE_BINDING = 'DYNAMAX_DOCUMENTS';
export const DOCUMENT_STORAGE_PROVIDER = 'Cloudflare R2';
const REFERENCE_ORIGIN = 'r2://dynamax-documents';

function storageError(message, status = 500, code = 'DOCUMENT_STORAGE_ERROR') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function storageBinding(env = {}) {
  const bucket = env[DOCUMENT_STORAGE_BINDING];
  return bucket
    && typeof bucket.put === 'function'
    && typeof bucket.get === 'function'
    && typeof bucket.delete === 'function'
    ? bucket
    : null;
}

export function documentStorageConfigured(env = {}) {
  return Boolean(storageBinding(env));
}

export function requireDocumentStorage(env = {}) {
  const bucket = storageBinding(env);
  if (!bucket) {
    throw storageError(
      `Cloudflare R2 document storage is not connected. Bind an R2 bucket as ${DOCUMENT_STORAGE_BINDING}.`,
      503,
      'DOCUMENT_STORAGE_NOT_CONFIGURED'
    );
  }
  return bucket;
}

export async function resolveDocumentStorage(env = {}) {
  return {
    binding: DOCUMENT_STORAGE_BINDING,
    provider: DOCUMENT_STORAGE_PROVIDER,
    configured: documentStorageConfigured(env)
  };
}

function safeSegment(value, fallback = 'unspecified') {
  const normalized = clean(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 96);
  return normalized || fallback;
}

function safeExtension(fileName) {
  const match = clean(fileName).toLowerCase().match(/\.([a-z0-9]{1,10})$/);
  return match ? `.${match[1]}` : '';
}

function base64Bytes(value) {
  const raw = clean(value).replace(/^data:[^;,]+;base64,/i, '');
  let binary = '';
  try {
    binary = atob(raw);
  } catch {
    throw storageError('The uploaded file is not valid base64 data.', 400, 'INVALID_DOCUMENT_FILE');
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function metadataValue(value, maximum = 1024) {
  return clean(value).replace(/[\r\n]+/g, ' ').slice(0, maximum);
}

function identityPrefix(identity) {
  return `v1/${safeSegment(identity.edition)}/${safeSegment(identity.workspaceId)}/`;
}

export function storedDocumentReference(key) {
  const normalized = clean(key).replace(/^\/+/, '');
  if (!normalized) throw storageError('The stored document key is missing.', 500, 'DOCUMENT_STORAGE_KEY_MISSING');
  return `${REFERENCE_ORIGIN}/${normalized}`;
}

export function parseStoredDocumentReference(env = {}, reference = '') {
  const raw = clean(reference);
  if (!raw.startsWith(`${REFERENCE_ORIGIN}/`)) {
    throw storageError(
      'This document still uses the retired Google Drive transport and must be migrated to Cloudflare R2 before it can be opened.',
      409,
      'LEGACY_DOCUMENT_NOT_MIGRATED'
    );
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw storageError('The stored document reference is invalid.', 400, 'INVALID_DOCUMENT_REFERENCE');
  }
  if (url.protocol !== 'r2:' || url.hostname !== 'dynamax-documents') {
    throw storageError('The stored document reference is invalid.', 400, 'INVALID_DOCUMENT_REFERENCE');
  }
  const key = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  const identity = requiredDeploymentIdentity(env);
  if (!key.startsWith(identityPrefix(identity))) {
    throw storageError(
      'This document belongs to a different Dynamax workspace.',
      403,
      'DOCUMENT_WORKSPACE_MISMATCH'
    );
  }
  return { key, identity };
}

export async function putStoredDocument(env = {}, input = {}) {
  const bucket = requireDocumentStorage(env);
  const identity = requiredDeploymentIdentity(env);
  const operationId = clean(input.operationId || input.storageOperationId);
  if (!operationId) {
    throw storageError('A stable storage operation ID is required.', 400, 'DOCUMENT_OPERATION_ID_REQUIRED');
  }
  const fileName = metadataValue(input.fileName || 'document.bin', 180);
  const mimeType = metadataValue(input.mimeType || 'application/octet-stream', 120).toLowerCase();
  const branchId = safeSegment(input.branchId || 'main');
  const schoolSection = safeSegment(input.schoolSection || 'all');
  const category = safeSegment(input.category || 'general');
  const ownerId = safeSegment(input.ownerId || input.recordId || 'unassigned');
  const documentType = safeSegment(input.documentType || input.kind || 'document');
  const key = [
    identityPrefix(identity).replace(/\/$/, ''),
    category,
    branchId,
    schoolSection,
    ownerId,
    documentType,
    `${safeSegment(operationId, 'operation')}${safeExtension(fileName)}`
  ].join('/');
  const bytes = input.bytes instanceof Uint8Array ? input.bytes : base64Bytes(input.fileBase64);
  const uploadedAt = new Date().toISOString();
  const customMetadata = {
    workspaceId: identity.workspaceId,
    edition: identity.edition,
    category,
    branchId,
    schoolSection,
    ownerId,
    documentType,
    operationId: metadataValue(operationId, 180),
    fileName,
    mimeType,
    uploadedAt
  };
  for (const [name, value] of Object.entries(input.customMetadata || {})) {
    const safeName = safeSegment(name, '').slice(0, 64);
    if (safeName && value !== undefined && value !== null) customMetadata[safeName] = metadataValue(value);
  }
  const stored = await bucket.put(key, bytes, {
    httpMetadata: { contentType: mimeType },
    customMetadata
  });
  if (!stored) {
    throw storageError('Cloudflare R2 did not confirm the document upload.', 502, 'DOCUMENT_STORAGE_WRITE_FAILED');
  }
  const reference = storedDocumentReference(key);
  return {
    key,
    reference,
    documentUrl: reference,
    fileName,
    mimeType,
    size: bytes.byteLength,
    etag: clean(stored.etag),
    uploadedAt
  };
}

export async function getStoredDocument(env = {}, reference = '') {
  const bucket = requireDocumentStorage(env);
  const { key } = parseStoredDocumentReference(env, reference);
  const object = await bucket.get(key);
  if (!object) {
    throw storageError('The requested document was not found in Cloudflare R2.', 404, 'DOCUMENT_NOT_FOUND');
  }
  return {
    object,
    key,
    fileName: metadataValue(object.customMetadata?.fileName || 'document.bin', 180),
    mimeType: metadataValue(
      object.httpMetadata?.contentType || object.customMetadata?.mimeType || 'application/octet-stream',
      120
    ).toLowerCase()
  };
}

export async function deleteStoredDocument(env = {}, reference = '') {
  const bucket = requireDocumentStorage(env);
  const { key } = parseStoredDocumentReference(env, reference);
  await bucket.delete(key);
  return { ok: true, key };
}

export function storedDocumentResponse(stored, options = {}) {
  const fallback = clean(options.fallbackFileName || 'document.bin');
  const fileName = clean(stored?.fileName || fallback)
    .replace(/[^\x20-\x7e]|[\r\n"\\/:*?<>|]+/g, '_')
    .slice(0, 160) || fallback;
  const mimeType = clean(stored?.mimeType || 'application/octet-stream').toLowerCase();
  const inlineSafe = ['application/pdf', 'image/jpeg', 'image/png'].includes(mimeType);
  const disposition = inlineSafe && clean(options.mode).toLowerCase() !== 'download' ? 'inline' : 'attachment';
  const headers = new Headers();
  if (typeof stored?.object?.writeHttpMetadata === 'function') stored.object.writeHttpMetadata(headers);
  headers.set('Content-Type', mimeType);
  headers.set('Content-Disposition', `${disposition}; filename="${fileName}"`);
  headers.set('Cache-Control', 'private, no-store');
  headers.set('Content-Security-Policy', "sandbox; default-src 'none'; object-src 'none'; script-src 'none'");
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Content-Type-Options', 'nosniff');
  if (stored?.object?.httpEtag) headers.set('ETag', stored.object.httpEtag);
  return new Response(stored.object.body, { status: 200, headers });
}
