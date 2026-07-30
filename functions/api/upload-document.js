// Cloudflare Pages Function: /api/upload-document
// Lets parents upload missing admission documents using their verification email/code.

import {
  createDocumentIfAbsent,
  getDocument,
  patchDocumentFields,
  requireFirestoreEnv,
  upsertDocument
} from '../lib/firestore.js';
import { querySchoolCollection, upsertSchoolDocument } from '../lib/school-scope.js';
import { resolveDocumentStorage } from '../lib/document-storage.js';
import {
  beginIdempotentRequest,
  completeIdempotentRequest,
  failIdempotentRequest,
  readJsonBody,
  releaseIdempotentRequest,
  verifyTurnstile
} from '../lib/request-security.js';

const UPLOAD_OPERATION_COLLECTION = 'documentUploadOperations';

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

function uploadError(message, status = 500, code = '', options = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  Object.assign(error, options);
  return error;
}

async function sha256(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
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

function uploadOperationState(operation = {}) {
  return lower(operation.Status || 'prepared');
}

async function loadUploadOperation(env, operationId, expected = {}) {
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const claimed = await createDocumentIfAbsent(env, UPLOAD_OPERATION_COLLECTION, operationId, {
    OperationId: operationId,
    IdempotencyDocumentId: operationId,
    RequestFingerprint: clean(expected.RequestFingerprint),
    ApplicationReference: clean(expected.ApplicationReference),
    DocumentType: clean(expected.DocumentType),
    FileDigest: clean(expected.FileDigest),
    FileName: clean(expected.FileName),
    MimeType: clean(expected.MimeType),
    ReplaceExisting: Boolean(expected.ReplaceExisting),
    Status: 'Prepared',
    DriveState: 'NotStarted',
    MetadataState: 'Pending',
    Attempt: 0,
    CreatedAt: now,
    UpdatedAt: now,
    ExpiresAt: new Date(nowDate.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
  });
  const operation = claimed.document || {};
  const immutableFields = ['RequestFingerprint', 'ApplicationReference', 'DocumentType', 'FileDigest'];
  const mismatch = immutableFields.find((field) => clean(operation[field]) && clean(operation[field]) !== clean(expected[field]));
  if (mismatch) {
    throw uploadError(
      'This upload operation is already bound to a different file or application.',
      409,
      'UPLOAD_OPERATION_CONFLICT'
    );
  }
  return operation;
}

async function updateUploadOperation(env, operationId, fields = {}) {
  return patchDocumentFields(env, UPLOAD_OPERATION_COLLECTION, operationId, {
    ...fields,
    UpdatedAt: new Date().toISOString()
  });
}

function completedUploadResult(operation, definition, applicationReference) {
  if (operation.Result && typeof operation.Result === 'object') return operation.Result;
  const documentUrlValue = clean(operation.DocumentUrl);
  if (!documentUrlValue) return null;
  const previousDocumentUrl = clean(operation.PreviousDocumentUrl);
  const replaced = Boolean(operation.ReplaceExisting && previousDocumentUrl);
  return {
    ok: true,
    code: replaced ? 'DOCUMENT_REPLACED' : 'DOCUMENT_UPLOADED',
    message: `${definition.label}${replaced ? ' replaced successfully.' : ' uploaded successfully.'}`,
    documentUrl: documentUrlValue,
    previousDocumentUrl,
    applicationReference,
    backend: 'firestore'
  };
}

async function findFirestoreApplication(env, email, code) {
  requireFirestoreEnv(env);
  const rows = await querySchoolCollection(env, 'applications', {
    filters: [{ field: 'VerificationCode', op: '==', value: code }],
    limit: 20
  });
  return rows.find((row) => {
    const parent = row.parent && typeof row.parent === 'object' ? row.parent : {};
    const rowEmail = lower(pick(row, ['VerificationEmail', 'verificationEmail', 'ParentEmail', 'parentEmail', 'Email', 'email'], parent.email));
    const rowCode = clean(pick(row, ['VerificationCode', 'verificationCode'])).toUpperCase();
    return rowEmail === email && rowCode === code;
  }) || null;
}

async function enabledDocumentFields(env) {
  const settings = await getDocument(env, 'settings', 'admissionDocuments').catch(() => null);
  const enabled = settings && settings.Enabled && typeof settings.Enabled === 'object' ? settings.Enabled : {};
  return DOCUMENT_FIELDS.filter((item) => enabled[item.key] !== false);
}

async function saveFirestoreDocumentMetadata(env, app, definition, file, url, replaceExisting, operationId) {
  const now = new Date().toISOString();
  const reference = clean(pick(app, ['ApplicationReference', 'applicationReference', 'ApplicationID', '__id']));
  if (!reference) throw new Error('The database application has no application reference.');
  const previousUrl = documentUrl(app, definition.key);
  const documents = app.documents && typeof app.documents === 'object' ? { ...app.documents } : {};
  const currentEntry = documentEntry(app, definition.key);
  if (clean(currentEntry.uploadOperationId) === clean(operationId) && clean(currentEntry.url) === clean(url)) {
    return {
      application: app,
      previousUrl: clean(currentEntry.previousUrl),
      alreadySaved: true
    };
  }
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
    storage: 'Google Drive',
    uploadOperationId: clean(operationId)
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

async function uploadViaAppsScript(storageUrl, payload) {
  const res = await fetch(storageUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  });
  const text = await res.text().catch(() => '');
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  return {
    ...(data && typeof data === 'object' ? data : {}),
    httpOk: res.ok,
    httpStatus: res.status,
    rawMessage: clean(data?.message || text).slice(0, 1000)
  };
}

export async function onRequestPost(context) {
  let idempotency = null;
  let driveAttemptStarted = false;
  let driveOutcomeRecorded = false;
  try {
    const { request, env } = context;
    const body = await readJsonBody(request, { maxBytes: 12 * 1024 * 1024 });

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
    const base64Limit = Math.ceil((8 * 1024 * 1024) / 3) * 4 + 4;
    if (fileBase64.length > base64Limit) {
      return Response.json({ ok: false, message: 'The selected file exceeds the 8 MB upload limit.' }, {
        status: 413,
        headers: { 'Cache-Control': 'no-store' }
      });
    }
    if (thumbnailBase64.length > 400000) {
      return Response.json({ ok: false, message: 'The image preview is too large.' }, {
        status: 413,
        headers: { 'Cache-Control': 'no-store' }
      });
    }
    await verifyTurnstile(env, request, body, 'upload_document');
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
      return Response.json({ ok: false, message: 'Application not found in the database for that email/code.' }, { status: 404 });
    }
    const applicationReference = clean(pick(firestoreApp, ['ApplicationReference', 'applicationReference', 'ApplicationID', '__id']));
    if (!applicationReference) {
      throw uploadError('The database application has no application reference.', 500, 'APPLICATION_REFERENCE_MISSING');
    }
    const [fileDigest, thumbnailDigest] = await Promise.all([
      sha256(fileBase64),
      thumbnailBase64 ? sha256(thumbnailBase64) : Promise.resolve('')
    ]);
    idempotency = await beginIdempotentRequest(env, request, body, {
      scope: `upload-${definition.key}`,
      actor: `${email}:${applicationReference}`,
      ttlMinutes: 7 * 24 * 60,
      leaseMinutes: 15,
      fingerprintPayload: {
        email,
        applicationReference,
        documentType: definition.key,
        fileName,
        mimeType,
        fileDigest,
        thumbnailDigest,
        replaceExisting
      }
    });
    if (idempotency.replay) {
      if (idempotency.uncertain && idempotency.documentId) {
        const durableOperation = await getDocument(
          env,
          UPLOAD_OPERATION_COLLECTION,
          idempotency.documentId
        ).catch(() => null);
        const operationMatches = durableOperation
          && clean(durableOperation.ApplicationReference) === applicationReference
          && clean(durableOperation.DocumentType) === definition.key
          && clean(durableOperation.FileDigest) === fileDigest;
        if (operationMatches && ['completed', 'metadatasaved'].includes(uploadOperationState(durableOperation))) {
          const reconciledResult = completedUploadResult(durableOperation, definition, applicationReference);
          if (reconciledResult) {
            return Response.json(reconciledResult, {
              headers: {
                'Cache-Control': 'no-store',
                'Idempotency-Replayed': 'true',
                'Idempotency-Reconciled': 'true'
              }
            });
          }
        }
      }
      return Response.json(idempotency.response, {
        status: idempotency.status || (idempotency.response?.ok === false ? 409 : 200),
        headers: { 'Cache-Control': 'no-store', 'Idempotency-Replayed': 'true' }
      });
    }
    if (!idempotency.enabled) {
      throw uploadError(
        'An Idempotency-Key header is required for document uploads.',
        400,
        'IDEMPOTENCY_KEY_REQUIRED'
      );
    }

    const operationId = idempotency.documentId;
    let operation = await loadUploadOperation(env, operationId, {
      RequestFingerprint: idempotency.fingerprint,
      ApplicationReference: applicationReference,
      DocumentType: definition.key,
      FileDigest: fileDigest,
      FileName: fileName,
      MimeType: mimeType,
      ReplaceExisting: replaceExisting
    });
    let operationState = uploadOperationState(operation);
    if (['completed', 'metadatasaved'].includes(operationState)) {
      const replayResult = completedUploadResult(operation, definition, applicationReference);
      if (!replayResult) {
        throw uploadError(
          'The upload metadata is marked as saved, but its durable result is incomplete. Admissions must reconcile this operation.',
          503,
          'UPLOAD_RECONCILIATION_REQUIRED',
          { outcomeUncertain: true }
        );
      }
      try {
        await completeIdempotentRequest(env, idempotency, replayResult, 200);
        await updateUploadOperation(env, operationId, {
          Status: 'Completed',
          IdempotencyState: 'Completed',
          CompletedAt: new Date().toISOString()
        }).catch(() => null);
      } catch {
        await updateUploadOperation(env, operationId, {
          IdempotencyState: 'FinalizationPending'
        }).catch(() => null);
        await releaseIdempotentRequest(env, idempotency);
      }
      return Response.json(replayResult, {
        headers: { 'Cache-Control': 'no-store', 'Idempotency-Replayed': 'true' }
      });
    }
    if (['uploading', 'uploaduncertain', 'uncertain', 'metadataconflict'].includes(operationState)) {
      throw uploadError(
        'The Google Drive upload may already have been accepted. Automatic re-upload is suppressed to avoid a duplicate; Admissions must reconcile this operation.',
        503,
        'DRIVE_UPLOAD_OUTCOME_UNCERTAIN',
        {
          outcomeUncertain: true,
          uncertaintyReason: clean(operation.UncertaintyReason || operation.MetadataConflictReason)
        }
      );
    }
    if (!['prepared', 'drivesaved'].includes(operationState)) {
      throw uploadError(
        `The durable upload operation is in the unresolved "${clean(operation.Status) || 'unknown'}" state. Automatic re-upload is suppressed.`,
        503,
        'UPLOAD_OPERATION_UNRESOLVED',
        {
          outcomeUncertain: true,
          uncertaintyReason: clean(operation.UncertaintyReason || operation.MetadataConflictReason)
        }
      );
    }

    let savedDocumentUrl = '';
    const existingUrl = documentUrl(firestoreApp, definition.key);
    if (operationState === 'drivesaved') {
      savedDocumentUrl = clean(operation.DocumentUrl);
      if (!savedDocumentUrl) {
        throw uploadError(
          'Google Drive is marked as saved, but no durable file URL is available. Admissions must reconcile this operation.',
          503,
          'DRIVE_UPLOAD_RECONCILIATION_REQUIRED',
          { outcomeUncertain: true }
        );
      }
      driveOutcomeRecorded = true;
    } else {
      if ((existingUrl || documentUploaded(firestoreApp, definition.key)) && !replaceExisting) {
        throw uploadError(
          `${definition.label} has already been uploaded. Choose replace if Admissions Office asked you to send a newer copy.`,
          409,
          'DOCUMENT_ALREADY_UPLOADED'
        );
      }
      const storage = await resolveDocumentStorage(env);
      if (!storage.url || !storage.secret) {
        throw uploadError(
          'Database application lookup succeeded, but Google Drive file storage is not configured.',
          503,
          'DOCUMENT_STORAGE_NOT_CONFIGURED'
        );
      }
      const attemptId = crypto.randomUUID();
      const attempt = Math.max(0, Number(operation.Attempt || 0)) + 1;
      operation = await updateUploadOperation(env, operationId, {
        Status: 'Uploading',
        DriveState: 'RequestStarted',
        Attempt: attempt,
        AttemptId: attemptId,
        UploadStartedAt: new Date().toISOString(),
        OutcomeUncertain: false
      });
      operationState = uploadOperationState(operation);

      const payload = {
        Secret: storage.secret,
        Action: 'uploadParentDocument',
        StorageOnly: 'YES',
        OperationId: operationId,
        UploadOperationId: operationId,
        StorageOperationId: operationId,
        UploadAttemptId: attemptId,
        RequestFingerprint: idempotency.fingerprint,
        ApplicationReference: applicationReference,
        Email: email,
        VerificationCode: code,
        DocumentType: definition.key,
        FileName: fileName,
        MimeType: mimeType,
        FileBase64: fileBase64,
        ReplaceExisting: replaceExisting ? 'YES' : 'NO',
        ExistingUrl: existingUrl
      };

      let data;
      driveAttemptStarted = true;
      try {
        data = await uploadViaAppsScript(storage.url, payload);
      } catch (error) {
        const uncertaintyReason = `No authoritative response was received from document storage: ${clean(error?.message || error)}`.slice(0, 500);
        await updateUploadOperation(env, operationId, {
          Status: 'UploadUncertain',
          DriveState: 'OutcomeUncertain',
          OutcomeUncertain: true,
          UncertaintyReason: uncertaintyReason,
          UncertainAt: new Date().toISOString()
        }).catch(() => null);
        throw uploadError(
          'Google Drive may have accepted the file, but no authoritative response was received. Automatic re-upload is suppressed.',
          503,
          'DRIVE_UPLOAD_OUTCOME_UNCERTAIN',
          { outcomeUncertain: true, uncertaintyReason }
        );
      }

      savedDocumentUrl = clean(data.documentUrl);
      const storageStatus = Number(data.httpStatus || 0);
      const authoritativeRejection = data.ok === false
        || (storageStatus >= 400 && storageStatus < 500);
      if (authoritativeRejection) {
        const storageCode = clean(data.code) || 'DOCUMENT_STORAGE_REJECTED';
        const storageMessage = clean(data.rawMessage || data.message)
          || 'Google Drive document storage rejected the upload.';
        driveOutcomeRecorded = true;
        await updateUploadOperation(env, operationId, {
          Status: 'Prepared',
          DriveState: 'Rejected',
          StorageHttpStatus: storageStatus,
          LastStorageErrorCode: storageCode,
          LastStorageError: storageMessage.slice(0, 500),
          LastRejectedAt: new Date().toISOString(),
          OutcomeUncertain: false
        }).catch(() => null);
        throw uploadError(
          storageMessage,
          424,
          storageCode,
          { outcomeUncertain: false }
        );
      }
      if (data.ok !== true || data.httpOk !== true || !savedDocumentUrl) {
        const uncertaintyReason = clean(data.rawMessage || data.message || `Storage returned HTTP ${data.httpStatus || 'unknown'}`)
          .slice(0, 500);
        await updateUploadOperation(env, operationId, {
          Status: 'UploadUncertain',
          DriveState: 'OutcomeUncertain',
          StorageHttpStatus: Number(data.httpStatus || 0),
          OutcomeUncertain: true,
          UncertaintyReason: uncertaintyReason,
          UncertainAt: new Date().toISOString()
        }).catch(() => null);
        throw uploadError(
          'Google Drive did not return an authoritative saved-file result. Automatic re-upload is suppressed to avoid a duplicate.',
          503,
          'DRIVE_UPLOAD_OUTCOME_UNCERTAIN',
          { outcomeUncertain: true, uncertaintyReason }
        );
      }

      try {
        operation = await updateUploadOperation(env, operationId, {
          Status: 'DriveSaved',
          DriveState: 'Saved',
          DocumentUrl: savedDocumentUrl,
          StorageHttpStatus: Number(data.httpStatus || 200),
          StorageMessage: clean(data.rawMessage || data.message).slice(0, 500),
          DriveSavedAt: new Date().toISOString(),
          OutcomeUncertain: false
        });
        operationState = uploadOperationState(operation);
        driveOutcomeRecorded = true;
      } catch (error) {
        throw uploadError(
          'Google Drive accepted the file, but its result could not be saved durably. Automatic re-upload is suppressed.',
          503,
          'DRIVE_RESULT_PERSISTENCE_FAILED',
          {
            outcomeUncertain: true,
            uncertaintyReason: clean(error?.message || error)
          }
        );
      }
    }

    const latestApplication = await findFirestoreApplication(env, email, code);
    if (!latestApplication) {
      throw uploadError(
        'The application disappeared after Google Drive saved the file. Admissions must reconcile the saved file.',
        503,
        'UPLOAD_METADATA_TARGET_MISSING'
      );
    }
    const latestEntry = documentEntry(latestApplication, definition.key);
    const latestUrl = documentUrl(latestApplication, definition.key);
    const metadataAlreadySaved = clean(latestEntry.uploadOperationId) === operationId
      && clean(latestEntry.url) === savedDocumentUrl;
    if (!metadataAlreadySaved && !replaceExisting && latestUrl && latestUrl !== savedDocumentUrl) {
      const conflictReason = `${definition.label} was updated by another upload before this Drive result could be attached.`;
      await updateUploadOperation(env, operationId, {
        Status: 'MetadataConflict',
        DriveState: 'Saved',
        MetadataState: 'Conflict',
        DocumentUrl: savedDocumentUrl,
        ManualReconciliationRequired: true,
        MetadataConflictReason: conflictReason
      }).catch(() => null);
      throw uploadError(
        `${conflictReason} Automatic overwrite is suppressed; Admissions must reconcile the saved Drive file.`,
        503,
        'UPLOAD_METADATA_CONFLICT'
      );
    }

    const saved = await saveFirestoreDocumentMetadata(
      env,
      latestApplication,
      definition,
      { fileName, mimeType },
      savedDocumentUrl,
      replaceExisting,
      operationId
    );
    if (definition.key === 'PassportPhotograph' && thumbnailBase64 && thumbnailBase64.length <= 400000) {
      await upsertDocument(env, 'applicationPassportThumbnails', safeDocumentId(applicationReference), {
        ApplicationReference: applicationReference,
        MimeType: thumbnailMimeType.toLowerCase().startsWith('image/') ? thumbnailMimeType : 'image/jpeg',
        FileBase64: thumbnailBase64,
        UploadOperationId: operationId,
        UpdatedAt: new Date().toISOString()
      }).catch(() => null);
    }
    const result = {
      ok: true,
      code: replaceExisting && saved.previousUrl ? 'DOCUMENT_REPLACED' : 'DOCUMENT_UPLOADED',
      message: `${definition.label}${replaceExisting && saved.previousUrl ? ' replaced successfully.' : ' uploaded successfully.'}`,
      documentUrl: savedDocumentUrl,
      previousDocumentUrl: saved.previousUrl,
      applicationReference,
      backend: 'firestore'
    };
    await updateUploadOperation(env, operationId, {
      Status: 'MetadataSaved',
      DriveState: 'Saved',
      MetadataState: 'Saved',
      DocumentUrl: savedDocumentUrl,
      PreviousDocumentUrl: clean(saved.previousUrl),
      Result: result,
      MetadataSavedAt: new Date().toISOString(),
      OutcomeUncertain: false
    });
    try {
      await completeIdempotentRequest(env, idempotency, result, 200);
      await updateUploadOperation(env, operationId, {
        Status: 'Completed',
        IdempotencyState: 'Completed',
        CompletedAt: new Date().toISOString()
      }).catch(() => null);
    } catch {
      await updateUploadOperation(env, operationId, {
        IdempotencyState: 'FinalizationPending'
      }).catch(() => null);
      await releaseIdempotentRequest(env, idempotency);
    }
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (caught) {
    const err = caught instanceof Error ? caught : uploadError(clean(caught) || 'The document upload failed.');
    if (idempotency?.owner) {
      if (err?.outcomeUncertain === true || (driveAttemptStarted && !driveOutcomeRecorded)) {
        err.outcomeUncertain = true;
        await failIdempotentRequest(context.env, idempotency, err);
      } else {
        await releaseIdempotentRequest(context.env, idempotency);
      }
    }
    return Response.json({
      ok: false,
      code: clean(err?.code),
      message: err.message || String(err),
      outcomeUncertain: err?.outcomeUncertain === true
    }, {
      status: err.status || 500,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}
