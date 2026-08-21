import { queryCollection, requireFirestoreEnv } from '../lib/firestore.js';
import { readJsonBody, verifyTurnstile } from '../lib/request-security.js';

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
  const targeted = await queryCollection(env, 'formSales', {
    filters: [{ field: 'VerificationCode', op: '==', value: code }],
    limit: 10
  }).catch(() => []);
  const sale = targeted.find((row) => lower(row.Email) === email && clean(row.VerificationCode).toUpperCase() === code);
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

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await readJsonBody(request, { maxBytes: 64 * 1024 });
    const email = String(body.email || '').trim().toLowerCase();
    const code = String(body.code || '').trim().toUpperCase();

    if (!email || !code) {
      return Response.json({ ok: false, message: 'Email and code are required.' }, { status: 400 });
    }
    await verifyTurnstile(env, request, body, 'verify_admission');

    const data = await verifyFromFirestore(env, email, code);
    if (!data) return Response.json({ ok: false, message: 'No database form purchase matches that email and verification code.' }, { status: 404 });
    return Response.json(data, {
      status: data.ok ? 200 : 400,
      headers: { 'Cache-Control': 'no-store' }
    });
  } catch (err) {
    return Response.json({ ok: false, message: err.message || String(err) }, {
      status: err.status || 500,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}
