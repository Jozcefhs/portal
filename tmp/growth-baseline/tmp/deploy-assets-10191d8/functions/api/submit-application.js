import { listCollection, requireFirestoreEnv, upsertDocument } from '../lib/firestore.js';
import { getSchoolCode } from './backend.js';
import { getSchoolStructure, listSchoolCollection, schoolSectionFor, upsertSchoolDocument } from '../lib/school-scope.js';
import { legacyGoogleDataEnabled } from '../lib/backend-mode.js';

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
    const rows = await listCollection(env, 'settings');
    return rows.find((row) => row.__id === 'schoolProfile') || {};
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

async function submitToFirestore(env, email, code, receiptNo, application) {
  requireFirestoreEnv(env);
  const sales = await listCollection(env, 'formSales');
  const sale = sales.find((row) => lower(row.Email) === email && clean(row.VerificationCode).toUpperCase() === code);
  if (!sale) return null;
  if (['yes', 'true', '1'].includes(lower(sale.Used))) {
    return { ok: false, message: 'This verification code has already been used.' };
  }

  const applications = await listSchoolCollection(env, 'applications');
  const profile = await getSchoolProfile(env);
  const structure = await getSchoolStructure(env);
  const reference = nextApplicationReference(applications, await getSchoolCode(env));
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
  await upsertSchoolDocument(env, 'applications', safeDocumentId(reference), app);
  await upsertDocument(env, 'formSales', safeDocumentId(clean(sale.ReceiptNo) || receiptNo || sale.__id), {
    ...sale,
    Used: 'YES',
    UsedAt: now,
    ApplicationReference: reference,
    UpdatedAt: now
  });
  return {
    ok: true,
    message: 'Application submitted successfully.',
    applicationReference: reference,
    reference,
    backend: 'firestore'
  };
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();
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

    try {
      const firestoreResult = await submitToFirestore(env, email, code, verification.receiptNo || '', application);
      if (firestoreResult) {
        return Response.json(firestoreResult, { status: firestoreResult.ok ? 200 : 400 });
      }
      if (!legacyGoogleDataEnabled(env)) {
        return Response.json({ ok: false, message: 'No Firestore form purchase matches that email and verification code.' }, { status: 404 });
      }
    } catch (firestoreErr) {
      if (!legacyGoogleDataEnabled(env)) {
        return Response.json({ ok: false, message: firestoreErr.message || String(firestoreErr) }, { status: firestoreErr.status || 500 });
      }
    }

    if (!legacyGoogleDataEnabled(env) || !env.GOOGLE_APPS_SCRIPT_URL || !env.GOOGLE_APPS_SCRIPT_SECRET) {
      return Response.json({ ok: false, message: 'Server submission is not configured yet.' }, { status: 500 });
    }

    const payload = {
      Secret: env.GOOGLE_APPS_SCRIPT_SECRET,
      Action: 'submitApplication',
      VerificationEmail: email,
      VerificationCode: code,
      ReceiptNo: verification.receiptNo || '',
      Application: application
    };

    const res = await fetch(env.GOOGLE_APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (data.ok) {
      return Response.json(data, { status: 200 });
    }

    const recovered = await findSubmittedApplication(env, email, code);
    if (recovered.ok) {
      return Response.json(recovered, { status: 200 });
    }

    return Response.json(data, { status: 400 });

  } catch (err) {
    return Response.json({ ok: false, message: String(err) }, { status: 500 });
  }
}

async function findSubmittedApplication(env, email, code) {
  try {
    const url = new URL(env.GOOGLE_APPS_SCRIPT_URL);
    url.searchParams.set('action', 'getApplications');
    url.searchParams.set('secret', env.GOOGLE_APPS_SCRIPT_SECRET);

    const res = await fetch(url.toString(), { method: 'GET' });
    if (!res.ok) return { ok: false };

    const data = await res.json();
    const rows = Array.isArray(data) ? data : (data.applications || data.rows || []);
    const match = rows.find((row) => {
      const rowEmail = String(row.VerificationEmail || row.Email || '').trim().toLowerCase();
      const rowCode = String(row.VerificationCode || '').trim().toUpperCase();
      return rowEmail === email && rowCode === code;
    });

    if (!match) return { ok: false };
    const reference = String(match.ApplicationReference || match.ApplicationID || '').trim();
    return {
      ok: true,
      message: 'Application submitted successfully.',
      recovered: true,
      applicationReference: reference,
      reference
    };
  } catch (_) {
    return { ok: false };
  }
}
