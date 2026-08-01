import { onRequestPost as verifyFormPayment } from './verify-form-payment.js';
import { onRequestPost as verifyPayment } from './verify-payment.js';
import { getDocument } from '../lib/firestore.js';

function clean(value) {
  return String(value ?? '').trim();
}

function hexBytes(value) {
  const text = clean(value).toLowerCase();
  if (!text || text.length % 2 !== 0 || !/^[0-9a-f]+$/.test(text)) return null;
  const bytes = new Uint8Array(text.length / 2);
  for (let index = 0; index < text.length; index += 2) {
    bytes[index / 2] = Number.parseInt(text.slice(index, index + 2), 16);
  }
  return bytes;
}

async function validPaystackSignature(secret, payload, signature) {
  const signatureBytes = hexBytes(signature);
  if (!signatureBytes) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['verify']
  );
  return crypto.subtle.verify('HMAC', key, signatureBytes, payload);
}

function metadataFrom(event) {
  const value = event?.data?.metadata;
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function safeDocumentId(value) {
  return clean(value).replace(/[\/\\?#\[\]]/g, '-').replace(/\s+/g, '_').slice(0, 140);
}

function isAdmissionFormType(value) {
  return ['admissionform', 'admissionformpurchase', 'formpurchase']
    .includes(clean(value).toLowerCase().replace(/[^a-z0-9]/g, ''));
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const secret = clean(env.PAYSTACK_SECRET_KEY);
    if (!secret) {
      return Response.json({ ok: false, message: 'Payment webhook is not configured.' }, {
        status: 503,
        headers: { 'Cache-Control': 'no-store' }
      });
    }
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > 512 * 1024) {
      return Response.json({ ok: false, message: 'Webhook payload is too large.' }, {
        status: 413,
        headers: { 'Cache-Control': 'no-store' }
      });
    }
    const payload = await request.arrayBuffer();
    if (payload.byteLength > 512 * 1024) {
      return Response.json({ ok: false, message: 'Webhook payload is too large.' }, {
        status: 413,
        headers: { 'Cache-Control': 'no-store' }
      });
    }
    const signature = request.headers.get('x-paystack-signature');
    if (!await validPaystackSignature(secret, payload, signature)) {
      return Response.json({ ok: false, message: 'Invalid webhook signature.' }, {
        status: 401,
        headers: { 'Cache-Control': 'no-store' }
      });
    }
    let event;
    try {
      event = JSON.parse(new TextDecoder().decode(payload));
    } catch {
      return Response.json({ ok: false, message: 'Invalid webhook payload.' }, {
        status: 400,
        headers: { 'Cache-Control': 'no-store' }
      });
    }
    if (clean(event.event).toLowerCase() !== 'charge.success') {
      return Response.json({ ok: true, ignored: true }, {
        headers: { 'Cache-Control': 'no-store' }
      });
    }
    const reference = clean(event?.data?.reference);
    if (!reference) {
      return Response.json({ ok: false, message: 'Payment reference is missing.' }, {
        status: 400,
        headers: { 'Cache-Control': 'no-store' }
      });
    }
    const metadata = metadataFrom(event);
    let isAdmissionForm = isAdmissionFormType(metadata.paymentType || metadata.PaymentType);
    if (!clean(metadata.paymentType || metadata.PaymentType)) {
      const intent = await getDocument(env, 'paymentIntents', safeDocumentId(reference)).catch(() => null);
      isAdmissionForm = isAdmissionFormType(
        intent?.PaymentType || intent?.paymentType || intent?.IntentType || intent?.intentType
      );
    }
    const internalRequest = new Request(
      `${new URL(request.url).origin}${isAdmissionForm ? '/api/verify-form-payment' : '/api/verify-payment'}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference })
      }
    );
    const result = await (isAdmissionForm ? verifyFormPayment : verifyPayment)({
      ...context,
      request: internalRequest
    });
    const detail = await result.json().catch(() => ({}));
    if (!result.ok || detail.ok === false) {
      return Response.json({
        ok: false,
        message: 'The payment was verified but downstream processing must be retried.'
      }, {
        status: result.status >= 500 ? result.status : 502,
        headers: { 'Cache-Control': 'no-store' }
      });
    }
    return Response.json({
      ok: true,
      reference,
      processed: true
    }, {
      headers: { 'Cache-Control': 'no-store' }
    });
  } catch (error) {
    return Response.json({ ok: false, message: 'Payment webhook processing failed.' }, {
      status: Number(error?.status || 500),
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}

export async function onRequestGet() {
  return Response.json({ ok: false, message: 'Method not allowed.' }, {
    status: 405,
    headers: {
      Allow: 'POST',
      'Cache-Control': 'no-store'
    }
  });
}
