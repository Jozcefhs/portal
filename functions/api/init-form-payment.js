// Cloudflare Pages Function: /api/init-form-payment
// Starts Paystack checkout for admission form purchase.

import { getAdmissionClasses, getSchoolCode } from './backend.js';
import { createDocumentIfAbsent, requireFirestoreEnv } from '../lib/firestore.js';
import { normalizeClassKey } from '../lib/class-names.js';
import { createDirectTransferRequest, normalizePublicPaymentMethod, publicPaymentMethods } from '../lib/direct-bank-transfer.js';
import {
  beginIdempotentRequest,
  completeIdempotentRequest,
  failIdempotentRequest,
  readJsonBody,
  verifyTurnstile
} from '../lib/request-security.js';

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
  requireFirestoreEnv(env);
  const data = await getAdmissionClasses(env);
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
  let idempotency = null;
  try {
    const { request, env } = context;
    const body = await readJsonBody(request, { maxBytes: 768 * 1024 });
    const applicantName = String(body.applicantName || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const phone = String(body.phone || '').trim();
    const classApplyingFor = String(body.classApplyingFor || '').trim();
    const paymentMethod = normalizePublicPaymentMethod(body.paymentMethod || body.PaymentMethod);

    if (!applicantName || !email || !classApplyingFor) {
      return Response.json({ ok: false, message: 'Applicant name, parent email, and class are required.' }, { status: 400 });
    }
    await verifyTurnstile(env, request, body, 'init_form_payment');
    const classSetup = await getAdmissionClassSetup(env, classApplyingFor);
    if (!classSetup.open) {
      return Response.json({ ok: false, message: `Admission is not currently open for ${classApplyingFor}.` }, { status: 400 });
    }
    const amount = toAmount(classSetup.amount);
    if (amount <= 0) {
      return Response.json({ ok: false, message: 'Admission form amount is not configured. Set it from Settings > Admission Classes in the desktop app.' }, { status: 500 });
    }
    const {
      turnstileToken: _turnstileToken,
      turnstileAction: _turnstileAction,
      idempotencyKey: _idempotencyKey,
      ...idempotencyPayload
    } = body;
    idempotency = await beginIdempotentRequest(env, request, body, {
      scope: 'init-form-payment',
      actor: email,
      ttlMinutes: 2 * 24 * 60,
      fingerprintPayload: idempotencyPayload
    });
    if (idempotency.replay) {
      return Response.json(idempotency.response, {
        status: idempotency.status || (idempotency.response?.ok === false ? 409 : 200),
        headers: { 'Cache-Control': 'no-store', 'Idempotency-Replayed': 'true' }
      });
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
      PaymentMethod: paymentMethod === 'direct_bank_transfer' ? 'Direct Bank Transfer' : 'Paystack',
      Status: paymentMethod === 'direct_bank_transfer' ? 'Awaiting Verification' : 'Pending',
      CreatedAt: new Date().toISOString()
    });

    if (paymentMethod === 'direct_bank_transfer') {
      const result = await createDirectTransferRequest(env, {
        reference,
        context: 'admission-form',
        branchId: body.branchId || body.BranchId || 'main',
        amount,
        currency: 'NGN',
        payerName: applicantName,
        payerEmail: email,
        payerPhone: phone,
        evidence: body,
        payload: {
          ApplicantName: applicantName,
          Email: email,
          Phone: phone,
          ClassApplyingFor: classApplyingFor,
          FormAmount: amount,
          FormLink: `${new URL(request.url).origin}/verify.html`
        }
      });
      await completeIdempotentRequest(env, idempotency, result, 200);
      return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
    }
    const publicMethods = await publicPaymentMethods(env, body.branchId || body.BranchId || 'main');
    if (!publicMethods.online.enabled) {
      const error = new Error('Automated online payment is disabled for this branch.');
      error.status = 503;
      throw error;
    }
    if (!env.PAYSTACK_SECRET_KEY) {
      const error = new Error('Online payment is not configured yet.');
      error.status = 503;
      throw error;
    }

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
      const error = new Error(paystackData.message || 'Could not start Paystack payment.');
      error.status = 400;
      throw error;
    }

    const result = {
      ok: true,
      authorizationUrl: paystackData.data.authorization_url,
      reference: paystackData.data.reference
    };
    await completeIdempotentRequest(env, idempotency, result, 200);
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (idempotency?.owner) await failIdempotentRequest(context.env, idempotency, err);
    return Response.json({ ok: false, message: err.message || String(err) }, {
      status: err.status || 500,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}
