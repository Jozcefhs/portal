// Cloudflare Pages Function: /api/upload-document
// Lets parents upload missing admission documents using their verification email/code.

import { listCollection, requireFirestoreEnv, upsertDocument } from '../lib/firestore.js';
import { listSchoolCollection, upsertSchoolDocument } from '../lib/school-scope.js';

function clean(value) {
  return String(value || '').trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function pick(row, names, fallback = '') {
  for (const name of names) {
    if (row && row[name] !== undefined && row[name] !== null && String(row[name]).trim() !== '') {
      return row[name];
    }
  }
  return fallback;
}

function safeDocumentId(value) {
  return clean(value)
    .replace(/[\/\\?#\[\]]/g, '-')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/-+/g, '-')
    .slice(0, 140);
}

const DOCUMENT_FIELDS = [
  { key: 'BirthCertificate', label: 'Birth Certificate' },
  { key: 'PreviousSchoolReport', label: 'Previous School Report' },
  { key: 'PassportPhotograph', label: 'Passport Photograph' },
  { key: 'MedicalReport', label: 'Medical Report' },
  { key: 'TransferCertificateDoc', label: 'Transfer Certificate' },
  { key: 'AcceptanceForm', label: 'Acceptance Form' }
];

function documentDefinition(documentType) {
  return DOCUMENT_FIELDS.find((item) => item.key === documentType || lower(item.label) === lower(documentType)) || null;
}

function documentEntry(app, documentType) {
  const documents = app.documents && typeof app.documents === 'object' ? app.documents : {};
  return documents[documentType] && typeof documents[documentType] === 'object' ? documents[documentType] : {};
}

function documentUrl(app, documentType) {
  const nested = documentEntry(app, documentType);
  return clean(nested.url || app[`Doc${documentType}Url`] || app[`${documentType}Url`] || app[`${documentType}Link`]);
}

function documentUploaded(app, documentType) {
  const nested = documentEntry(app, documentType);
  const flag = lower(nested.status || app[`Doc${documentType}`] || app[documentType] || app[`${documentType}Submitted`]);
  return ['yes', 'true', '1', 'uploaded', 'replaced'].includes(flag) || Boolean(documentUrl(app, documentType));
}

async function findFirestoreApplication(env, email, code) {
  requireFirestoreEnv(env);
  const rows = await listSchoolCollection(env, 'applications');
  return rows.find((row) => {
    const parent = row.parent && typeof row.parent === 'object' ? row.parent : {};
    const rowEmail = lower(pick(row, ['VerificationEmail', 'verificationEmail', 'ParentEmail', 'parentEmail', 'Email', 'email'], parent.email));
    const rowCode = clean(pick(row, ['VerificationCode', 'verificationCode'])).toUpperCase();
    return rowEmail === email && rowCode === code;
  }) || null;
}

async function enabledDocumentFields(env) {
  const rows = await listCollection(env, 'settings');
  const settings = rows.find((row) => row.__id === 'admissionDocuments');
  const enabled = settings && settings.Enabled && typeof settings.Enabled === 'object' ? settings.Enabled : {};
  return DOCUMENT_FIELDS.filter((item) => enabled[item.key] !== false);
}

async function saveFirestoreDocumentMetadata(env, app, definition, file, url, replaceExisting) {
  const now = new Date().toISOString();
  const reference = clean(pick(app, ['ApplicationReference', 'applicationReference', 'ApplicationID', '__id']));
  if (!reference) throw new Error('The Firestore application has no application reference.');
  const previousUrl = documentUrl(app, definition.key);
  const documents = app.documents && typeof app.documents === 'object' ? { ...app.documents } : {};
  documents[definition.key] = {
    type: definition.key,
    label: definition.label,
    status: replaceExisting && previousUrl ? 'Replaced' : 'Uploaded',
    fileName: file.fileName,
    mimeType: file.mimeType,
    url,
    previousUrl,
    uploadedAt: now,
    uploadedBy: 'Parent',
    storage: 'Google Drive'
  };
  const next = {
    ...app,
    documents,
    [`Doc${definition.key}`]: 'YES',
    [`Doc${definition.key}Url`]: url,
    IntelligenceUpdatedBy: 'Parent Upload',
    IntelligenceUpdatedAt: now,
    UpdatedAt: now
  };
  const enabledFields = await enabledDocumentFields(env);
  const completed = enabledFields.filter((item) => documentUploaded(next, item.key)).length;
  next.DocumentsCompletion = `${enabledFields.length ? Math.round((completed / enabledFields.length) * 100) : 100}%`;
  next.MissingDocuments = enabledFields.filter((item) => !documentUploaded(next, item.key)).map((item) => item.label).join(', ');
  const historyLine = [now, definition.label, replaceExisting && previousUrl ? 'Replaced' : 'Uploaded', file.fileName, url,
    previousUrl ? `Previous: ${previousUrl}` : ''].filter(Boolean).join(' | ');
  next.DocumentUploadHistory = clean(app.DocumentUploadHistory) ? `${clean(app.DocumentUploadHistory)}\n${historyLine}` : historyLine;
  delete next.__id;
  delete next.__name;
  await upsertSchoolDocument(env, 'applications', safeDocumentId(reference), next);
  return { application: next, previousUrl };
}

async function uploadViaAppsScript(env, payload) {
  const res = await fetch(env.GOOGLE_APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  });
  return res.json();
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();

    const email = String(body.email || '').trim().toLowerCase();
    const code = String(body.code || '').trim().toUpperCase();
    const documentType = String(body.documentType || '').trim();
    const fileName = String(body.fileName || '').trim();
    const mimeType = String(body.mimeType || 'application/octet-stream').trim();
    const fileBase64 = String(body.fileBase64 || '').trim();
    const thumbnailBase64 = String(body.thumbnailBase64 || '').trim();
    const thumbnailMimeType = String(body.thumbnailMimeType || 'image/jpeg').trim();
    const replaceExisting = Boolean(body.replaceExisting);

    if (!email || !code) {
      return Response.json({ ok: false, message: 'Email and verification code are required.' }, { status: 400 });
    }
    if (!documentType) {
      return Response.json({ ok: false, message: 'Select the document you are uploading.' }, { status: 400 });
    }
    if (!fileName || !fileBase64) {
      return Response.json({ ok: false, message: 'Choose a file to upload.' }, { status: 400 });
    }
    requireFirestoreEnv(env);
    const definition = documentDefinition(documentType);
    if (!definition) {
      return Response.json({ ok: false, message: `Invalid document type: ${documentType}` }, { status: 400 });
    }
    const enabledFields = await enabledDocumentFields(env);
    if (!enabledFields.some((item) => item.key === definition.key)) {
      return Response.json({ ok: false, message: `${definition.label} is not currently requested by the school.` }, { status: 409 });
    }
    const firestoreApp = await findFirestoreApplication(env, email, code);
    if (!firestoreApp) {
      return Response.json({ ok: false, message: 'Application not found in Firestore for that email/code.' }, { status: 404 });
    }
    const existingUrl = documentUrl(firestoreApp, definition.key);
    if ((existingUrl || documentUploaded(firestoreApp, definition.key)) && !replaceExisting) {
      return Response.json({
        ok: false,
        code: 'DOCUMENT_ALREADY_UPLOADED',
        message: `${definition.label} has already been uploaded. Choose replace if Admissions Office asked you to send a newer copy.`,
        existingUrl,
        documentType: definition.key,
        documentLabel: definition.label
      }, { status: 409 });
    }
    if (!env.GOOGLE_APPS_SCRIPT_URL || !env.GOOGLE_APPS_SCRIPT_SECRET) {
      return Response.json({
        ok: false,
        message: 'Firestore application lookup succeeded, but Google Drive file storage is not configured.'
      }, { status: 500 });
    }

    const payload = {
      Secret: env.GOOGLE_APPS_SCRIPT_SECRET,
      Action: 'uploadParentDocument',
      StorageOnly: 'YES',
      ApplicationReference: pick(firestoreApp, ['ApplicationReference', 'applicationReference', 'ApplicationID', '__id']),
      Email: email,
      VerificationCode: code,
      DocumentType: definition.key,
      FileName: fileName,
      MimeType: mimeType,
      FileBase64: fileBase64,
      ReplaceExisting: replaceExisting ? 'YES' : 'NO',
      ExistingUrl: existingUrl
    };

    const data = await uploadViaAppsScript(env, payload);
    if (!data.ok) {
      return Response.json(data, { status: 400 });
    }
    const saved = await saveFirestoreDocumentMetadata(env, firestoreApp, definition, { fileName, mimeType }, clean(data.documentUrl), replaceExisting);
    if (definition.key === 'PassportPhotograph' && thumbnailBase64 && thumbnailBase64.length <= 400000) {
      const reference = pick(firestoreApp, ['ApplicationReference', 'applicationReference', 'ApplicationID', '__id']);
      await upsertDocument(env, 'applicationPassportThumbnails', safeDocumentId(reference), {
        ApplicationReference: reference,
        MimeType: thumbnailMimeType.toLowerCase().startsWith('image/') ? thumbnailMimeType : 'image/jpeg',
        FileBase64: thumbnailBase64,
        UpdatedAt: new Date().toISOString()
      });
    }
    return Response.json({
      ok: true,
      code: replaceExisting && saved.previousUrl ? 'DOCUMENT_REPLACED' : 'DOCUMENT_UPLOADED',
      message: `${definition.label}${replaceExisting && saved.previousUrl ? ' replaced successfully.' : ' uploaded successfully.'}`,
      documentUrl: clean(data.documentUrl),
      previousDocumentUrl: saved.previousUrl,
      applicationReference: pick(firestoreApp, ['ApplicationReference', 'applicationReference', 'ApplicationID', '__id']),
      backend: 'firestore'
    });
  } catch (err) {
    return Response.json({ ok: false, message: String(err) }, { status: 500 });
  }
}
