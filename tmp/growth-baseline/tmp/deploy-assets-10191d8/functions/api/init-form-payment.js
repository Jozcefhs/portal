// Cloudflare Pages Function: /api/init-form-payment
// Starts Paystack checkout for admission form purchase.

import { getAdmissionClasses, getSchoolCode } from './backend.js';
import { createDocumentIfAbsent, requireFirestoreEnv } from '../lib/firestore.js';
import { normalizeClassKey } from '../lib/class-names.js';
import { legacyGoogleDataEnabled } from '../lib/backend-mode.js';

const PAYSTACK_INIT_URL = 'https://api.paystack.co/transaction/initialize';

function cleanReference(value) {
  return String(value || '')
    .replace(/[^A-Za-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 90);
}

function toAmount(value) {
  const amount = Number(String(value || '0').replace(/,/g, ''));
  return Number.isFinite(amount) ? amount : 0;
}

function normalizeClassName(value) {
  return normalizeClassKey(value);
}

async function getAdmissionClassSetup(env, className) {
  if (!className) return { open: false, amount: 0 };
  try {
    requireFirestoreEnv(env);
    const data = await getAdmissionClasses(env);
    const wanted = normalizeClassName(className);
    const matched = (data.classes || []).find((item) => {
      return normalizeClassName(item.ClassName || item.className || item) === wanted &&
        String(item.Active || 'YES').toUpperCase() === 'YES';
    });
    if (matched) {
      return {
        open: true,
        amount: toAmount(matched.FormAmount || matched.formAmount || data.formAmount || env.ADMISSION_FORM_AMOUNT)
      };
    }
    return { open: false, amount: 0 };
  } catch (firestoreErr) {
    if (!legacyGoogleDataEnabled(env)) throw firestoreErr;
  }

  if (!legacyGoogleDataEnabled(env) || !env.GOOGLE_APPS_SCRIPT_URL || !env.GOOGLE_APPS_SCRIPT_SECRET) {
    return { open: true, amount: toAmount(env.ADMISSION_FORM_AMOUNT) };
  }

  const url = new URL(env.GOOGLE_APPS_SCRIPT_URL);
  url.searchParams.set('action', 'getAdmissionClasses');
  url.searchParams.set('secret', env.GOOGLE_APPS_SCRIPT_SECRET);
  const response = await fetch(url.toString());
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (_err) {
    throw new Error('Could not confirm available classes because the server returned a non-JSON response.');
  }
  if (!data.ok) throw new Error(data.message || 'Could not confirm available classes.');
  const wanted = normalizeClassName(className);
  const matched = (data.classes || []).find((item) => {
    return normalizeClassName(item.ClassName || item.className || item) === wanted &&
      String(item.Active || 'YES').toUpperCase() === 'YES';
  });
  if (!matched) return { open: false, amount: 0 };
  return {
    open: true,
    amount: toAmount(matched.FormAmount || matched.formAmount || data.formAmount || env.ADMISSION_FORM_AMOUNT)
  };
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();
    const applicantName = String(body.applicantName || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const phone = String(body.phone || '').trim();
    const classApplyingFor = String(body.classApplyingFor || '').trim();

    if (!applicantName || !email || !classApplyingFor) {
      return Response.json({ ok: false, message: 'Applicant name, parent email, and class are required.' }, { status: 400 });
    }
    if (!env.PAYSTACK_SECRET_KEY) {
      return Response.json({ ok: false, message: 'Paystack secret key is not configured.' }, { status: 500 });
    }
    const classSetup = await getAdmissionClassSetup(env, classApplyingFor);
    if (!classSetup.open) {
      return Response.json({ ok: false, message: `Admission is not currently open for ${classApplyingFor}.` }, { status: 400 });
    }
    const amount = toAmount(classSetup.amount);
    if (amount <= 0) {
      return Response.json({ ok: false, message: 'Admission form amount is not configured. Set it from Settings > Admission Classes in the desktop app.' }, { status: 500 });
    }

    const origin = new URL(request.url).origin;
    const reference = cleanReference(`${await getSchoolCode(env)}-FORM-${Date.now()}`);
    const callbackUrl = `${origin}/payment-success.html?type=form&reference=${encodeURIComponent(reference)}`;
    await createDocumentIfAbsent(env, 'paymentIntents', reference, {
      Reference: reference,
      PaymentType: 'AdmissionForm',
      ApplicantName: applicantName,
      ParentEmail: email,
      ClassApplyingFor: classApplyingFor,
      Amount: amount,
      Currency: 'NGN',
      Status: 'Pending',
      CreatedAt: new Date().toISOString()
    });

    const paystackRes = await fetch(PAYSTACK_INIT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email,
        amount: Math.round(amount * 100),
        currency: 'NGN',
        reference,
        callback_url: callbackUrl,
        metadata: {
          paymentType: 'AdmissionForm',
          applicantName,
          phone,
          classApplyingFor,
          formAmount: amount
        }
      })
    });
    const paystackData = await paystackRes.json();
    if (!paystackData.status) {
      return Response.json({ ok: false, message: paystackData.message || 'Could not start Paystack payment.' }, { status: 400 });
    }

    return Response.json({
      ok: true,
      authorizationUrl: paystackData.data.authorization_url,
      reference: paystackData.data.reference
    });
  } catch (err) {
    return Response.json({ ok: false, message: String(err) }, { status: 500 });
  }
}
