// Cloudflare Pages Function: /api/payment-options
// Returns unpaid online fee items for a verified application.

import { getPayableFees } from './backend.js';
import { requireFirestoreEnv } from '../lib/firestore.js';
import { readJsonBody, verifyTurnstile } from '../lib/request-security.js';
import { requireGuestFeePaymentToken } from '../lib/guest-fee-payment.js';

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await readJsonBody(request, { maxBytes: 64 * 1024 });
    const guestToken = String(body.guestPaymentToken || body.GuestPaymentToken || '').trim();
    const guestAccess = guestToken ? await requireGuestFeePaymentToken(env, guestToken) : null;
    const email = String(guestAccess?.parentEmail || body.email || '').trim().toLowerCase();
    const code = guestAccess ? '' : String(body.code || '').trim().toUpperCase();

    if (!email || (!code && !guestAccess)) {
      return Response.json({ ok: false, message: 'Email and verification code are required.' }, { status: 400 });
    }
    await verifyTurnstile(env, request, body, 'payment_lookup');

    requireFirestoreEnv(env);
    const firestoreData = await getPayableFees(env, guestAccess ? {
        Email: email,
        AuthenticatedParentEmail: email,
        AccountRef: guestAccess.accountRef,
        SourceType: guestAccess.sourceType,
        ScopePath: guestAccess.scopePath
      } : { Email: email, VerificationCode: code });
      const { Email: _privateEmail, ...guestAccount } = firestoreData.account || {};
      const responseData = guestAccess ? {
        ...firestoreData,
        guestPayment: true,
        account: guestAccount,
        fees: (firestoreData.fees || []).filter((fee) => {
          const code = String(fee.FeeCode || '').trim().toUpperCase();
          const category = String(fee.FeeCategory || '').trim().toLowerCase();
          return code !== 'WALLET_TOPUP' && category !== 'wallet' && category !== 'store';
        })
      } : firestoreData;
    return Response.json(responseData, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' }
    });
  } catch (err) {
    return Response.json({ ok: false, message: err.message || String(err) }, {
      status: err.status || 500,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}
