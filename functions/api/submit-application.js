import {
  batchUpsertDocuments,
  createDocumentIfAbsent,
  deleteDocument,
  getDocument,
  listCollection,
  requireFirestoreEnv
} from '../lib/firestore.js';
import { getAdmissionClasses, getSchoolCode } from './backend.js';
import {
  getSchoolStructure,
  listSchoolCollection,
  schoolSectionFor,
  scopedCollectionPath
} from '../lib/school-scope.js';
import {
  beginIdempotentRequest,
  completeIdempotentRequest,
  failIdempotentRequest,
  readJsonBody,
  verifyTurnstile
} from '../lib/request-security.js';
import { evaluateAdmissionAge } from '../lib/admission-age.js';

function clean(value) {
  return String(value ?? '').trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function safeDocumentId(value) {
  return clean(value)
    .replace(/[\/\\?#\[\]]/g, '-')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/-+/g, '-')
    .slice(0, 140);
}

function applicantName(application) {
  return [application.Surname, application.FirstName, application.MiddleName]
    .map(clean)
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameFormatOrder(value) {
  const parts = clean(value).toLowerCase().split(',').map((part) => part.trim()).filter(Boolean);
  return parts.length ? parts : ['surname', 'first name', 'middle name'];
}

function formattedApplicantName(application, profile = {}) {
  const values = {
    'first name': clean(application.FirstName || application.firstName),
    'middle name': clean(application.MiddleName || application.middleName),
    surname: clean(application.Surname || application.surname || application.LastName || application.lastName)
  };
  const name = nameFormatOrder(profile.NameFormat || profile.nameFormat)
    .map((key) => values[key])
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return name || applicantName(application);
}

async function getSchoolProfile(env) {
  try {
    requireFirestoreEnv(env);
    return await getDocument(env, 'settings', 'schoolProfile') || {};
  } catch (_err) {
    return {};
  }
}

function duplicateKey(application) {
  const first = lower(application.FirstName || application.firstName);
  const surname = lower(application.Surname || application.surname || application.LastName || application.lastName);
  const parentEmail = lower(application.ParentEmail || application.parentEmail);
  return first && surname && parentEmail ? `${first}|${surname}|${parentEmail}` : '';
}

function nextApplicationReference(applications, schoolCode = 'DCA') {
  const yearCode = String(new Date().getFullYear()).slice(-2);
  const prefix = clean(schoolCode).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'DCA';
  let maxNo = 0;
  (applications || []).forEach((row) => {
    const value = clean(row.ApplicationReference || row.ApplicationID || row.__id);
    const match = value.match(new RegExp(`^${prefix}/${yearCode}/(\\d+)$`, 'i')) || value.match(/(\d+)$/);
    if (match) maxNo = Math.max(maxNo, Number(match[1]));
  });
  return `${prefix}/${yearCode}/${String(maxNo + 1).padStart(6, '0')}`;
}

function applicationReferenceAtOffset(reference, offset) {
  const match = clean(reference).match(/^(.*?)(\d+)$/);
  if (!match) return `${clean(reference)}-${offset + 1}`;
  return `${match[1]}${String(Number(match[2]) + offset).padStart(match[2].length, '0')}`;
}

async function reserveApplicationReference(env, initialReference, email) {
  for (let offset = 0; offset < 100; offset += 1) {
    const reference = applicationReferenceAtOffset(initialReference, offset);
    const reservation = await createDocumentIfAbsent(
      env,
      'applicationReferenceReservations',
      safeDocumentId(reference),
      {
        ApplicationReference: reference,
        ReservedFor: email,
        ReservedAt: new Date().toISOString()
      }
    );
    if (reservation.created) return reference;
  }
  const error = new Error('Could not reserve a unique application reference. Please try again.');
  error.status = 409;
  throw error;
}

async function assertAdmissionAgeRequirement(env, application) {
  const className = clean(application.ClassApplyingFor || application.classApplyingFor);
  if (!className) {
    const error = new Error('Select a class currently open for admission.');
    error.status = 400;
    throw error;
  }
  const settings = await getAdmissionClasses(env);
  const classConfig = (settings.classes || []).find((item) => (
    lower(item.ClassName || item.className) === lower(className)
  ));
  if (!classConfig || lower(classConfig.Active || classConfig.active) !== 'yes') {
    const error = new Error(`${className} is no longer open for admission. Select another class.`);
    error.status = 400;
    throw error;
  }
  const result = evaluateAdmissionAge(
    classConfig,
    application.DateOfBirth || application.dateOfBirth
  );
  if (!result.ok) {
    const error = new Error(result.message);
    error.status = 400;
    throw error;
  }
  return result;
}

async function submitToFirestore(env, email, code, receiptNo, application) {
  requireFirestoreEnv(env);
  const sales = await listCollection(env, 'formSales');
  const sale = sales.find((row) => lower(row.Email) === email && clean(row.VerificationCode).toUpperCase() === code);
  if (!sale) return null;

  await assertAdmissionAgeRequirement(env, {
    ...application,
    ClassApplyingFor: clean(application.ClassApplyingFor || sale.ClassApplyingFor)
  });

  const applications = await listSchoolCollection(env, 'applications');
  const alreadySubmitted = applications.find((row) => (
    lower(row.VerificationEmail || row.Email) === email
      && clean(row.VerificationCode).toUpperCase() === code
  ));
  if (alreadySubmitted) {
    const savedReference = clean(alreadySubmitted.ApplicationReference || alreadySubmitted.ApplicationID || alreadySubmitted.__id);
    return {
      ok: true,
      message: 'Application submitted successfully.',
      applicationReference: savedReference,
      reference: savedReference,
      replayed: true,
      backend: 'firestore'
    };
  }
  if (['yes', 'true', '1'].includes(lower(sale.Used))) {
    return { ok: false, message: 'This verification code has already been used.' };
  }
  const claimId = safeDocumentId(`${clean(sale.__id || sale.ReceiptNo || receiptNo || email)}-${code}`);
  const claimed = await createDocumentIfAbsent(env, 'applicationSubmissionClaims', claimId, {
    VerificationEmail: email,
    VerificationCode: code,
    ReceiptNo: clean(sale.ReceiptNo || receiptNo),
    Status: 'Processing',
    CreatedAt: new Date().toISOString(),
    UpdatedAt: new Date().toISOString()
  });
  if (!claimed.created) {
    const existingReference = clean(claimed.document?.ApplicationReference);
    if (lower(claimed.document?.Status) === 'completed' && existingReference) {
      return {
        ok: true,
        message: 'Application submitted successfully.',
        applicationReference: existingReference,
        reference: existingReference,
        replayed: true,
        backend: 'firestore'
      };
    }
    const error = new Error('This application is already being processed. Please wait before trying again.');
    error.status = 409;
    throw error;
  }

  try {
    const profile = await getSchoolProfile(env);
    const structure = await getSchoolStructure(env);
    const reference = await reserveApplicationReference(
      env,
      nextApplicationReference(applications, await getSchoolCode(env)),
      email
    );
    const now = new Date().toISOString();
    const parentEmail = lower(application.ParentEmail || application.parentEmail || email);
    if (!parentEmail) {
      return { ok: false, message: 'Parent Dashboard Email is required.' };
    }
    const incomingDuplicateKey = duplicateKey({ ...application, ParentEmail: parentEmail });
    const duplicateRefs = incomingDuplicateKey
      ? applications
        .filter((row) => duplicateKey(row) === incomingDuplicateKey)
        .map((row) => clean(row.ApplicationReference || row.ApplicationID || row.__id))
        .filter(Boolean)
      : [];
    const displayName = formattedApplicantName(application, profile) || clean(sale.ApplicantName);
    const app = {
      ...application,
      ApplicationReference: reference,
      ApplicationID: reference,
      ApplicantName: displayName,
      Name: displayName,
      VerificationEmail: email,
      VerificationCode: code,
      Email: email,
      ParentEmail: parentEmail,
      ReceiptNo: receiptNo || clean(sale.ReceiptNo),
      ClassApplyingFor: clean(application.ClassApplyingFor || sale.ClassApplyingFor),
      BranchId: clean(application.BranchId || structure.ActiveBranchId),
      Status: 'Submitted',
      DuplicateWarning: duplicateRefs.length ? 'Possible duplicate' : '',
      DuplicateMatches: duplicateRefs.length ? `First name + surname + parent email match ${duplicateRefs.join(', ')}` : '',
      SubmittedAt: now,
      UpdatedAt: now
    };
    app.SchoolSection = schoolSectionFor(app);
    await batchUpsertDocuments(env, [
      {
        collectionPath: scopedCollectionPath('applications', app.BranchId, app.SchoolSection),
        documentId: safeDocumentId(reference),
        data: app
      },
      {
        collectionPath: 'formSales',
        documentId: safeDocumentId(clean(sale.ReceiptNo) || receiptNo || sale.__id),
        data: {
          ...sale,
          Used: 'YES',
          UsedAt: now,
          ApplicationReference: reference,
          UpdatedAt: now
        }
      },
      {
        collectionPath: 'applicationSubmissionClaims',
        documentId: claimId,
        data: {
          VerificationEmail: email,
          VerificationCode: code,
          ReceiptNo: clean(sale.ReceiptNo || receiptNo),
          Status: 'Completed',
          ApplicationReference: reference,
          CreatedAt: clean(claimed.document?.CreatedAt) || now,
          UpdatedAt: now,
          CompletedAt: now
        }
      }
    ]);
    return {
      ok: true,
      message: 'Application submitted successfully.',
      applicationReference: reference,
      reference,
      backend: 'firestore'
    };
  } catch (error) {
    await deleteDocument(env, 'applicationSubmissionClaims', claimId).catch(() => null);
    throw error;
  }
}

export async function onRequestPost(context) {
  let idempotency = null;
  try {
    const { request, env } = context;
    const body = await readJsonBody(request, { maxBytes: 768 * 1024 });
    const verification = body.verification || {};
    const application = body.application || {};

    const email = String(verification.email || '').trim().toLowerCase();
    const code = String(verification.code || '').trim().toUpperCase();
    application.ParentEmail = String(application.ParentEmail || '').trim().toLowerCase();

    if (!email || !code) {
      return Response.json({ ok: false, message: 'Verification information is missing. Please verify again.' }, { status: 400 });
    }
    if (!application.ParentEmail) {
      return Response.json({ ok: false, message: 'Parent Dashboard Email is required.' }, { status: 400 });
    }
    await verifyTurnstile(env, request, body, 'submit_application');
    const {
      turnstileToken: _turnstileToken,
      turnstileAction: _turnstileAction,
      idempotencyKey: _idempotencyKey,
      ...idempotencyPayload
    } = body;
    idempotency = await beginIdempotentRequest(env, request, body, {
      scope: 'submit-application',
      actor: email,
      ttlMinutes: 7 * 24 * 60,
      fingerprintPayload: idempotencyPayload
    });
    if (idempotency.replay) {
      return Response.json(idempotency.response, {
        status: idempotency.status || (idempotency.response?.ok === false ? 409 : 200),
        headers: { 'Cache-Control': 'no-store', 'Idempotency-Replayed': 'true' }
      });
    }

    const data = await submitToFirestore(env, email, code, verification.receiptNo || '', application);
    if (!data) {
      const error = new Error('No database form purchase matches that email and verification code.');
      error.status = 404;
      throw error;
    }
    if (data.ok) await completeIdempotentRequest(env, idempotency, data, 200);
    else await failIdempotentRequest(env, idempotency, Object.assign(new Error(data.message), { status: 400 }));
    return Response.json(data, { status: data.ok ? 200 : 400 });

  } catch (err) {
    if (idempotency?.owner) await failIdempotentRequest(context.env, idempotency, err);
    return Response.json({ ok: false, message: err.message || String(err) }, {
      status: err.status || 500,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}
