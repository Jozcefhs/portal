// Authenticated proxy for private finance attachments stored in Google Drive.

import { getDocument, requireFirestoreEnv } from '../lib/firestore.js';
import { resolveDocumentStorage } from '../lib/document-storage.js';
import { safeStoredDocument } from '../lib/document-files.js';
import {
  financeDocumentDefinition,
  financeDocumentReferenceMatches,
  safeFinanceDocumentId,
  staffCanAccessFinanceDocument,
  storedFinanceDocumentUrl
} from '../lib/finance-document-access.js';
import { requireStaffSession } from '../lib/staff-auth.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();

function decodeBase64(value) {
  const binary = atob(clean(value));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function safeFileName(value, fallback) {
  return clean(value || fallback).replace(/[^\x20-\x7e]|[\r\n"\\/:*?<>|]+/g, '_').slice(0, 160) || fallback;
}

async function loadDriveFile(env, documentUrl) {
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
      DocumentUrl: documentUrl
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok || !data.fileBase64) {
    const error = new Error(data.message || 'The finance document could not be loaded.');
    error.status = response.status >= 400 ? response.status : 502;
    throw error;
  }
  return data;
}

export async function onRequestGet(context) {
  try {
    const { request, env } = context;
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    const url = new URL(request.url);
    const recordType = clean(url.searchParams.get('recordType'));
    const recordId = clean(url.searchParams.get('recordId'));
    const definition = financeDocumentDefinition(recordType);
    if (!definition || !recordId) {
      return Response.json({ ok: false, message: 'A valid finance record and document type are required.' }, {
        status: 400,
        headers: { 'Cache-Control': 'no-store' }
      });
    }

    const record = await getDocument(env, definition.collection, safeFinanceDocumentId(recordId));
    if (!record || !financeDocumentReferenceMatches(record, definition, recordId)) {
      return Response.json({ ok: false, message: 'The finance record was not found.' }, {
        status: 404,
        headers: { 'Cache-Control': 'no-store' }
      });
    }
    if (!staffCanAccessFinanceDocument(user, record)) {
      return Response.json({ ok: false, message: 'You do not have access to this finance document.' }, {
        status: 403,
        headers: { 'Cache-Control': 'no-store' }
      });
    }

    const storedUrl = storedFinanceDocumentUrl(record, definition, url.searchParams.get('line'));
    if (!storedUrl) {
      return Response.json({ ok: false, message: 'The requested finance document has not been uploaded.' }, {
        status: 404,
        headers: { 'Cache-Control': 'no-store' }
      });
    }

    const file = await loadDriveFile(env, storedUrl);
    const stored = safeStoredDocument(file.fileName || 'finance-document.bin', file.fileBase64);
    const fileName = safeFileName(stored.fileName, 'finance-document.bin');
    const requestedMode = lower(url.searchParams.get('mode'));
    const disposition = stored.valid && stored.inlineSafe && requestedMode !== 'download'
      ? 'inline'
      : 'attachment';
    return new Response(decodeBase64(file.fileBase64), {
      status: 200,
      headers: {
        'Content-Type': stored.mimeType,
        'Content-Disposition': `${disposition}; filename="${fileName}"`,
        'Cache-Control': 'private, no-store',
        'Content-Security-Policy': "sandbox; default-src 'none'; object-src 'none'; script-src 'none'",
        'Cross-Origin-Resource-Policy': 'same-origin',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  } catch (error) {
    return Response.json({ ok: false, message: clean(error?.message || error) }, {
      status: Number(error?.status || 500),
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}

export function onRequestPost() {
  return Response.json({ ok: false, message: 'Method not allowed.' }, {
    status: 405,
    headers: { Allow: 'GET', 'Cache-Control': 'no-store' }
  });
}
