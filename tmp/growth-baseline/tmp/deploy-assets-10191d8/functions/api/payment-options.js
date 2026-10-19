// Cloudflare Pages Function: /api/payment-options
// Returns unpaid online fee items for a verified application.

import { getPayableFees } from './backend.js';
import { requireFirestoreEnv } from '../lib/firestore.js';
import { legacyGoogleDataEnabled } from '../lib/backend-mode.js';

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();
    const email = String(body.email || '').trim().toLowerCase();
    const code = String(body.code || '').trim().toUpperCase();

    if (!email || !code) {
      return Response.json({ ok: false, message: 'Email and verification code are required.' }, { status: 400 });
    }

    try {
      requireFirestoreEnv(env);
      const firestoreData = await getPayableFees(env, { Email: email, VerificationCode: code });
      return Response.json(firestoreData, { status: 200 });
    } catch (firestoreErr) {
      if (!legacyGoogleDataEnabled(env) || !env.GOOGLE_APPS_SCRIPT_URL || !env.GOOGLE_APPS_SCRIPT_SECRET) {
        return Response.json({ ok: false, message: firestoreErr.message || String(firestoreErr) }, { status: firestoreErr.status || 500 });
      }
    }

    if (!legacyGoogleDataEnabled(env) || !env.GOOGLE_APPS_SCRIPT_URL || !env.GOOGLE_APPS_SCRIPT_SECRET) {
      return Response.json({ ok: false, message: 'Server payment lookup is not configured yet.' }, { status: 500 });
    }

    const res = await fetch(env.GOOGLE_APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Secret: env.GOOGLE_APPS_SCRIPT_SECRET,
        Action: 'getPayableFees',
        Email: email,
        VerificationCode: code
      })
    });

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (_err) {
      return Response.json({
        ok: false,
        message: 'Payment lookup could not read the Apps Script response. Confirm the Web App URL ends with /exec and the latest Apps Script deployment is active.'
      }, { status: 502 });
    }

    return Response.json(data, { status: data.ok ? 200 : 400 });
  } catch (err) {
    return Response.json({ ok: false, message: String(err) }, { status: 500 });
  }
}
