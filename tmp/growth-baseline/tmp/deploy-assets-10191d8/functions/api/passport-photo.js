// Authenticated, lazy passport-photo proxy for Firestore applications.
// Firestore remains authoritative; Google Drive only stores the private bytes.

import { getDocument, listCollection, requireFirestoreEnv } from '../lib/firestore.js';
import { listSchoolCollection } from '../lib/school-scope.js';

function clean(value) {
  return String(value ?? '').trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function sameText(a, b) {
  return lower(a) === lower(b);
}

function pick(row, keys, fallback = '') {
  for (const key of keys) {
    if (row && row[key] !== undefined && row[key] !== null && clean(row[key])) return row[key];
  }
  return fallback;
}

function applicationReference(row) {
  return clean(pick(row, ['ApplicationReference', 'applicationReference', 'ApplicationID', 'applicationId', '__id']));
}

function safeDocumentId(value) {
  return clean(value).replace(/[\/\\?#\[\]]/g, '-').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/-+/g, '-').slice(0, 140);
}

function passportUrl(row) {
  const documents = row && row.documents && typeof row.documents === 'object' ? row.documents : {};
  const passport = documents.PassportPhotograph && typeof documents.PassportPhotograph === 'object' ? documents.PassportPhotograph : {};
  return clean(passport.url || row.DocPassportPhotographUrl || row.PassportPhotographUrl || row.PassportPhotographLink);
}

function parentOwnsApplication(row, email, code) {
  const parent = row && row.parent && typeof row.parent === 'object' ? row.parent : {};
  const emails = [row.VerificationEmail, row.verificationEmail, row.ParentEmail, row.parentEmail, row.Email, row.email, parent.email]
    .map(lower)
    .filter(Boolean);
  const rowCode = clean(pick(row, ['VerificationCode', 'verificationCode'])).toUpperCase();
  return emails.includes(email) && rowCode === code;
}

function decodeBase64(value) {
  const binary = atob(clean(value));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function loadDriveFile(env, documentUrl) {
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
      DocumentUrl: documentUrl
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok || !data.fileBase64) {
    const error = new Error(data.message || 'Passport photograph could not be loaded.');
    error.status = response.status >= 400 ? response.status : 502;
    throw error;
  }
  return data;
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    requireFirestoreEnv(env);
    const body = await request.json().catch(() => ({}));
    const reference = clean(body.applicationReference || body.ApplicationReference || body.accountRef || body.AccountRef);
    if (!reference) return Response.json({ ok: false, message: 'Application reference is required.' }, { status: 400 });

    const applications = await listSchoolCollection(env, 'applications');
    const application = applications.find((row) => sameText(applicationReference(row), reference) || sameText(row.__id, reference));
    if (!application) return Response.json({ ok: false, message: 'Application was not found in Firestore.' }, { status: 404 });

    const suppliedSecret = clean(body.Secret || body.secret);
    const staffAuthorized = Boolean(env.BACKEND_SHARED_SECRET) && suppliedSecret === clean(env.BACKEND_SHARED_SECRET);
    if (!staffAuthorized) {
      const email = lower(body.email || body.ParentEmail || body.Email);
      const code = clean(body.code || body.VerificationCode).toUpperCase();
      if (!email || !code || !parentOwnsApplication(application, email, code)) {
        return Response.json({ ok: false, message: 'Unauthorized passport photograph request.' }, { status: 403 });
      }
    }

    const url = passportUrl(application);
    if (!url) return Response.json({ ok: false, message: 'No passport photograph has been uploaded.' }, { status: 404 });
    const thumbnail = await getDocument(env, 'applicationPassportThumbnails', safeDocumentId(applicationReference(application)));
    if (thumbnail && clean(thumbnail.FileBase64)) {
      return new Response(decodeBase64(thumbnail.FileBase64), {
        status: 200,
        headers: {
          'Content-Type': clean(thumbnail.MimeType) || 'image/jpeg',
          'Content-Disposition': 'inline',
          'Cache-Control': 'private, max-age=300',
          'X-Content-Type-Options': 'nosniff'
        }
      });
    }
    const file = await loadDriveFile(env, url);
    const mimeType = clean(file.mimeType) || 'application/octet-stream';
    if (!mimeType.toLowerCase().startsWith('image/')) {
      return Response.json({ ok: false, message: 'The uploaded passport document is not a previewable image.' }, { status: 415 });
    }
    return new Response(decodeBase64(file.fileBase64), {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': 'inline',
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  } catch (err) {
    return Response.json({ ok: false, message: clean(err && err.message ? err.message : err) }, { status: err.status || 500 });
  }
}
