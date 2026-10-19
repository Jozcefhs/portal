// Authenticated proxy for private finance attachments stored in Cloudflare R2.

import { getDocument, requireFirestoreEnv } from '../lib/firestore.js';
import { getStoredDocument, storedDocumentResponse } from '../lib/document-storage.js';
import {
  financeDocumentDefinition,
  financeDocumentReferenceMatches,
  safeFinanceDocumentId,
  staffCanAccessFinanceDocument,
  storedFinanceDocumentUrl
} from '../lib/finance-document-access.js';
import { requireStaffSession } from '../lib/staff-auth.js';

const clean = (value) => String(value ?? '').trim();

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

    const stored = await getStoredDocument(env, storedUrl);
    return storedDocumentResponse(stored, {
      fallbackFileName: 'finance-document.bin',
      mode: url.searchParams.get('mode')
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
