import { requireFirestoreEnv } from '../lib/firestore.js';
import {
  adminResetStaffMfa,
  beginTotpSetup,
  confirmTotpSetup,
  disableStaffTotp,
  mfaSessionResponse,
  regenerateStaffRecoveryCodes,
  resolveStaffMfaActor,
  saveStaffMfaPolicy,
  staffMfaAdministrationStatus,
  staffMfaStatus,
  verifyStaffMfaLogin
} from '../lib/staff-mfa.js';
import { readJsonBody } from '../lib/request-security.js';

function clean(value) {
  return String(value ?? '').trim();
}

function response(data, status = 200, cookies = [], extraHeaders = {}) {
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  Object.entries(extraHeaders || {}).forEach(([key, value]) => headers.set(key, String(value)));
  const values = Array.isArray(cookies) ? cookies : [cookies];
  values.filter(Boolean).forEach((cookie) => headers.append('Set-Cookie', cookie));
  return Response.json(data, { status, headers });
}

export async function onRequestPost({ request, env }) {
  try {
    requireFirestoreEnv(env);
    const body = await readJsonBody(request, { maxBytes: 64 * 1024 });
    const action = clean(body.action).toLowerCase();

    if (action === 'status') {
      const status = await staffMfaStatus(env, request);
      return response({ ok: true, ...status });
    }
    if (action === 'setup-totp') {
      const actor = await resolveStaffMfaActor(env, request, body.mfaTicket, { allowEnrollmentTicket: true });
      const setup = await beginTotpSetup(env, actor);
      return response({ ok: true, message: 'Scan the QR code, then enter the six-digit code from your authenticator app.', setup });
    }
    if (action === 'confirm-totp-setup') {
      const actor = await resolveStaffMfaActor(env, request, body.mfaTicket, { allowEnrollmentTicket: true });
      const result = await confirmTotpSetup(env, actor, body.code, body.currentPassword);
      if (result.session) {
        const completed = mfaSessionResponse(result.session, 'Authenticator app enrolled and sign-in completed.');
        return response({ ...completed.body, recoveryCodes: result.recoveryCodes, profile: result.profile }, 200, completed.cookie);
      }
      return response({
        ok: true,
        authenticated: true,
        message: 'Authenticator app enrolled. Save the recovery codes now.',
        recoveryCodes: result.recoveryCodes,
        profile: result.profile
      });
    }
    if (action === 'verify-login') {
      const completed = mfaSessionResponse(
        await verifyStaffMfaLogin(env, body.mfaTicket, body.method, body.code)
      );
      return response(completed.body, 200, completed.cookie);
    }
    if (action === 'regenerate-recovery') {
      const recoveryCodes = await regenerateStaffRecoveryCodes(env, request, body);
      return response({
        ok: true,
        message: 'New recovery codes generated. Every previous recovery code is now invalid.',
        recoveryCodes
      });
    }
    if (action === 'disable-totp') {
      await disableStaffTotp(env, request, body);
      return response({ ok: true, message: 'Authenticator verification disabled. Any registered passkey remains active.' });
    }
    if (action === 'admin-status') {
      return response({ ok: true, ...(await staffMfaAdministrationStatus(env, request)) });
    }
    if (action === 'save-policy') {
      const policy = await saveStaffMfaPolicy(env, request, body);
      return response({ ok: true, message: 'Organisation two-factor policy saved.', policy });
    }
    if (action === 'admin-reset') {
      await adminResetStaffMfa(env, request, body);
      return response({ ok: true, message: 'Two-factor authentication reset for the selected staff account.' });
    }
    return response({ ok: false, message: 'Choose a valid two-factor authentication action.' }, 400);
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500
      ? (error?.message || 'Two-factor authentication is temporarily unavailable.')
      : (error?.message || 'Two-factor authentication could not be completed.');
    return response({ ok: false, message }, status, [], error?.retryAfter ? { 'Retry-After': error.retryAfter } : {});
  }
}
