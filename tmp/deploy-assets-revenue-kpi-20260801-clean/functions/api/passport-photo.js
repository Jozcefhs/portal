// Authenticated, lazy passport-photo proxy for Firestore applications.
// Firestore remains authoritative; Google Drive only stores the private bytes.

import { getDocument, requireFirestoreEnv } from '../lib/firestore.js';
import { getSchoolDocumentById, querySchoolCollection } from '../lib/school-scope.js';
import { resolveDocumentStorage } from '../lib/document-storage.js';
import { readJsonBody } from '../lib/request-security.js';
import {
  admissionApplicationScopePath,
  admissionThumbnailDocumentId,
  validateAdmissionThumbnail
} from '../lib/document-files.js';

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

function passportEntry(row) {
  const documents = row && row.documents && typeof row.documents === 'object' ? row.documents : {};
  return documents.PassportPhotograph && typeof documents.PassportPhotograph === 'object'
    ? documents.PassportPhotograph
    : {};
}

function passportUrl(row) {
  const passport = passportEntry(row);
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

function uniqueApplications(rows = []) {
  const seen = new Set();
  return rows.filter((row) => {
    if (!row) return false;
    const key = `${clean(row.__scopePath)}|${clean(row.__id || applicationReference(row))}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function legacyThumbnailBelongsToApplication(thumbnail, application, scopePath) {
  if (!thumbnail) return false;
  const savedScope = admissionApplicationScopePath(thumbnail.ApplicationScopePath);
  if (savedScope) return lower(savedScope) === lower(scopePath);
  if (scopePath === 'applications') return true;
  const thumbnailOperationId = clean(thumbnail.UploadOperationId);
  const applicationOperationId = clean(passportEntry(application).uploadOperationId);
  return Boolean(thumbnailOperationId && applicationOperationId && thumbnailOperationId === applicationOperationId);
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
    const body = await readJsonBody(request, { maxBytes: 64 * 1024 });
    const reference = clean(body.applicationReference || body.ApplicationReference || body.accountRef || body.AccountRef);
    if (!reference) return Response.json({ ok: false, message: 'Application reference is required.' }, { status: 400 });
    const requestedScopePath = clean(body.scopePath || body.ScopePath);
    const targetScopePath = admissionApplicationScopePath(requestedScopePath);
    if (requestedScopePath && !targetScopePath) {
      return Response.json({ ok: false, message: 'The application scope is invalid.' }, { status: 400 });
    }

    const direct = targetScopePath
      ? await getDocument(env, targetScopePath, safeDocumentId(reference)).catch(() => null)
      : await getSchoolDocumentById(env, 'applications', safeDocumentId(reference)).catch(() => null);
    const directApplication = direct
      ? { ...direct, __scopePath: direct.__scopePath || targetScopePath || 'applications' }
      : null;
    let candidates = directApplication &&
      (sameText(applicationReference(directApplication), reference) || sameText(directApplication.__id, reference))
      ? [directApplication]
      : [];
    if (!candidates.length || !targetScopePath) {
      const queried = await querySchoolCollection(env, 'applications', {
        filters: [
          { field: 'ApplicationReference', op: '==', value: reference },
          { field: 'ApplicationID', op: '==', value: reference }
        ],
        filterJoin: 'OR',
        limit: 20,
        ...(targetScopePath ? { scopePath: targetScopePath } : {})
      }).catch(() => []);
      candidates = uniqueApplications([...candidates, ...queried]).filter((row) =>
        sameText(applicationReference(row), reference) || sameText(row.__id, reference)
      );
    }
    const application = candidates.length === 1 ? candidates[0] : null;
    if (!application) return Response.json({ ok: false, message: 'Application was not found in the database.' }, { status: 404 });

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
    const scopePath = admissionApplicationScopePath(application.__scopePath) || 'applications';
    const referenceValue = applicationReference(application);
    const scopedThumbnailId = await admissionThumbnailDocumentId(referenceValue, scopePath);
    let thumbnail = await getDocument(env, 'applicationPassportThumbnails', scopedThumbnailId).catch(() => null);
    if (!thumbnail) {
      const legacyThumbnail = await getDocument(
        env,
        'applicationPassportThumbnails',
        safeDocumentId(referenceValue)
      ).catch(() => null);
      if (legacyThumbnailBelongsToApplication(legacyThumbnail, application, scopePath)) {
        thumbnail = legacyThumbnail;
      }
    }
    if (thumbnail && clean(thumbnail.FileBase64)) {
      let validatedThumbnail = null;
      try {
        validatedThumbnail = validateAdmissionThumbnail(thumbnail.FileBase64);
      } catch {
        validatedThumbnail = null;
      }
      if (validatedThumbnail) {
        return new Response(decodeBase64(thumbnail.FileBase64), {
          status: 200,
          headers: {
            'Content-Type': validatedThumbnail.mimeType,
            'Content-Disposition': 'inline',
            'Cache-Control': 'private, max-age=300',
            'X-Content-Type-Options': 'nosniff'
          }
        });
      }
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
