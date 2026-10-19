// Authenticated staff proxy for viewing or downloading private admission documents.

import { deleteDocument, getDocument, requireFirestoreEnv } from '../lib/firestore.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { listSchoolCollection, upsertSchoolDocument } from '../lib/school-scope.js';

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

function decodeBase64(value) {
  const binary = atob(clean(value));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function safeFileName(value, fallback) {
  return clean(value || fallback).replace(/[^\x20-\x7e]|[\r\n"\\/:*?<>|]+/g, '_').slice(0, 160) || fallback;
}

async function loadDriveFile(env, url) {
  if (!env.GOOGLE_APPS_SCRIPT_URL || !env.GOOGLE_APPS_SCRIPT_SECRET) {
    const error = new Error('Private document storage is not configured.');
    error.status = 500;
    throw error;
  }
  const response = await fetch(env.GOOGLE_APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      Secret: env.GOOGLE_APPS_SCRIPT_SECRET,
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
  if (!env.GOOGLE_APPS_SCRIPT_URL || !env.GOOGLE_APPS_SCRIPT_SECRET) throw Object.assign(new Error('Private document storage is not configured.'), { status: 500 });
  const response = await fetch(env.GOOGLE_APPS_SCRIPT_URL, {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ Secret: env.GOOGLE_APPS_SCRIPT_SECRET, Action: 'deleteStoredDocument', DocumentUrl: url })
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
    const key = clean((body && (body.DocumentType || body.documentType)) || requestUrl.searchParams.get('documentType'));
    const requestedMode = clean((body && (body.Mode || body.mode)) || requestUrl.searchParams.get('mode'));
    const mode = lower(requestedMode) === 'download' ? 'attachment' : 'inline';
    const definition = DOCUMENTS.find(([candidate]) => candidate === key);
    if (!applicationReference || !definition) {
      return Response.json({ ok: false, message: 'A valid application reference and document type are required.' }, { status: 400 });
    }

    const applications = await listSchoolCollection(env, 'applications');
    const application = applications.find((row) => lower(reference(row)) === lower(applicationReference));
    if (!application) return Response.json({ ok: false, message: 'Application not found.' }, { status: 404 });
    if (user && user.role !== 'Super Admin') {
      const branchAllowed = !clean(user.branchId) || !clean(application.BranchId) || lower(user.branchId) === lower(application.BranchId);
      const section = lower(user.schoolSectionAccess || 'all');
      const sectionAllowed = section === 'all' || !clean(application.SchoolSection) || section === lower(application.SchoolSection);
      if (!branchAllowed || !sectionAllowed) return Response.json({ ok: false, message: 'This application belongs to another school branch or section.' }, { status: 403 });
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
      if (key === 'PassportPhotograph') await deleteDocument(env, 'applicationPassportThumbnails', application.__id || applicationReference).catch(() => {});
      return Response.json({ ok: true, message: `${definition[1]} deleted. The Drive file was moved to trash.` }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const file = await loadDriveFile(env, storedUrl);
    const fileName = safeFileName(file.fileName || metadata.fileName, `${key}.bin`);
    const mimeType = clean(file.mimeType || metadata.mimeType) || 'application/octet-stream';
    return new Response(decodeBase64(file.fileBase64), {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': `${mode}; filename="${fileName}"`,
        'Cache-Control': 'private, no-store',
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
  const body = await context.request.json().catch(() => ({}));
  return handleRequest(context, body);
}
