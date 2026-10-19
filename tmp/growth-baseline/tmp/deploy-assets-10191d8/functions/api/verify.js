import { listCollection, requireFirestoreEnv } from '../lib/firestore.js';
import { legacyGoogleDataEnabled } from '../lib/backend-mode.js';

function clean(value) {
  return String(value ?? '').trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function isExpired(dateText) {
  const text = clean(dateText);
  if (!text) return false;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date < today;
}

async function verifyFromFirestore(env, email, code) {
  requireFirestoreEnv(env);
  const sales = await listCollection(env, 'formSales');
  const sale = sales.find((row) => lower(row.Email) === email && clean(row.VerificationCode).toUpperCase() === code);
  if (!sale) return null;
  if (isExpired(sale.ExpiryDate)) {
    return { ok: false, message: 'This verification code has expired. Please contact the Admissions Office.' };
  }
  if (['yes', 'true', '1'].includes(lower(sale.Used))) {
    return { ok: false, message: 'This verification code has already been used.' };
  }
  return {
    ok: true,
    message: 'Verification successful.',
    email,
    code,
    receiptNo: clean(sale.ReceiptNo),
    applicantName: clean(sale.ApplicantName),
    classApplyingFor: clean(sale.ClassApplyingFor),
    expiryDate: clean(sale.ExpiryDate),
    backend: 'firestore'
  };
}

async function verifyFromAppsScript(env, email, code) {
  if (!legacyGoogleDataEnabled(env) || !env.GOOGLE_APPS_SCRIPT_URL || !env.GOOGLE_APPS_SCRIPT_SECRET) {
    return { ok: false, message: 'Server verification is not configured yet.' };
  }
  const url = new URL(env.GOOGLE_APPS_SCRIPT_URL);
  url.searchParams.set('action', 'verify');
  url.searchParams.set('email', email);
  url.searchParams.set('code', code);
  url.searchParams.set('secret', env.GOOGLE_APPS_SCRIPT_SECRET);
  const res = await fetch(url.toString());
  return res.json();
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();
    const email = String(body.email || '').trim().toLowerCase();
    const code = String(body.code || '').trim().toUpperCase();

    if (!email || !code) {
      return Response.json({ ok: false, message: 'Email and code are required.' }, { status: 400 });
    }

    try {
      const firestoreResult = await verifyFromFirestore(env, email, code);
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

    const data = await verifyFromAppsScript(env, email, code);

    return Response.json(data, { status: data.ok ? 200 : 400 });
  } catch (err) {
    return Response.json({ ok: false, message: String(err) }, { status: 500 });
  }
}
