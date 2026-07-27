import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse
} from '@simplewebauthn/server';
import {
  authenticateStaffPasskey,
  createStaffApprovalProof,
  createStaffSession,
  requireStaffSession,
  staffApprovalProofCookie,
  staffAccessFor,
  staffSessionCookie
} from '../lib/staff-auth.js';
import {
  deleteDocument,
  findOneByField,
  getDocument,
  queryCollection,
  requireFirestoreEnv,
  upsertDocument
} from '../lib/firestore.js';

const encoder = new TextEncoder();
const CEREMONY_SECONDS = 5 * 60;

function clean(value) {
  return String(value ?? '').trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function isActive(value) {
  return !['no', 'false', '0', 'inactive', 'disabled'].includes(lower(value ?? true));
}

function response(data, status = 200, cookies = []) {
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  const values = Array.isArray(cookies) ? cookies : [cookies];
  values.filter(Boolean).forEach((cookie) => headers.append('Set-Cookie', cookie));
  return Response.json(data, { status, headers });
}

export function bytesToBase64Url(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(value) {
  const normalized = clean(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function documentIdForCredential(credentialId) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(clean(credentialId)));
  return `PASSKEY-${bytesToBase64Url(digest)}`;
}

export function relyingPartySettings(request, env = {}) {
  const url = new URL(request.url);
  return {
    rpID: clean(env.WEBAUTHN_RP_ID) || url.hostname,
    origin: clean(env.WEBAUTHN_ORIGIN) || url.origin,
    rpName: clean(env.WEBAUTHN_RP_NAME) || 'DIGC Suite'
  };
}

async function userHandle(username) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(lower(username))));
}

async function userPasskeys(env, username) {
  return queryCollection(env, 'staffPasskeys', {
    filters: [{ field: 'UsernameKey', op: '==', value: lower(username) }]
  });
}

async function saveCeremony(env, type, challenge, username = '', scope = {}) {
  const ceremonyId = crypto.randomUUID();
  const now = Date.now();
  await upsertDocument(env, 'staffPasskeyChallenges', ceremonyId, {
    Type: type,
    Challenge: challenge,
    UsernameKey: lower(username),
    RecordId: clean(scope.recordId),
    RecordType: lower(scope.recordType),
    DecisionAction: clean(scope.action),
    CreatedAt: new Date(now).toISOString(),
    ExpiresAt: new Date(now + CEREMONY_SECONDS * 1000).toISOString()
  });
  return ceremonyId;
}

async function consumeCeremony(env, ceremonyId, expectedType) {
  const id = clean(ceremonyId);
  if (!id) {
    const error = new Error('The biometric request is missing. Please try again.');
    error.status = 400;
    throw error;
  }
  const ceremony = await getDocument(env, 'staffPasskeyChallenges', id);
  if (ceremony) await deleteDocument(env, 'staffPasskeyChallenges', id);
  if (!ceremony || clean(ceremony.Type) !== expectedType || Date.parse(ceremony.ExpiresAt) <= Date.now()) {
    const error = new Error('The biometric request expired. Please try again.');
    error.status = 400;
    throw error;
  }
  return ceremony;
}

async function registrationOptions(request, env) {
  const user = await requireStaffSession(env, request);
  const existing = await userPasskeys(env, user.username);
  const rp = relyingPartySettings(request, env);
  const options = await generateRegistrationOptions({
    rpName: rp.rpName,
    rpID: rp.rpID,
    userName: user.username,
    userDisplayName: user.displayName || user.username,
    userID: await userHandle(user.username),
    timeout: 60000,
    attestationType: 'none',
    excludeCredentials: existing.filter((item) => isActive(item.Active)).map((item) => ({
      id: item.CredentialId,
      transports: Array.isArray(item.Transports) ? item.Transports : undefined
    })),
    authenticatorSelection: {
      residentKey: 'required',
      requireResidentKey: true,
      userVerification: 'required'
    },
    preferredAuthenticatorType: 'localDevice',
    supportedAlgorithmIDs: [-7, -257]
  });
  return response({
    ok: true,
    ceremonyId: await saveCeremony(env, 'registration', options.challenge, user.username),
    options
  });
}

async function verifyRegistration(request, env, body) {
  const user = await requireStaffSession(env, request);
  const ceremony = await consumeCeremony(env, body.ceremonyId, 'registration');
  if (lower(ceremony.UsernameKey) !== lower(user.username)) {
    return response({ ok: false, message: 'This biometric request belongs to another staff account.' }, 403);
  }
  const rp = relyingPartySettings(request, env);
  const verification = await verifyRegistrationResponse({
    response: body.credential,
    expectedChallenge: ceremony.Challenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpID,
    requireUserVerification: true
  });
  if (!verification.verified || !verification.registrationInfo) {
    return response({ ok: false, message: 'The biometric credential could not be verified.' }, 400);
  }
  const credential = verification.registrationInfo.credential;
  const duplicate = await findOneByField(env, 'staffPasskeys', 'CredentialId', credential.id);
  if (duplicate && lower(duplicate.Username) !== lower(user.username)) {
    return response({ ok: false, message: 'This biometric credential is already linked to another staff account.' }, 409);
  }
  const id = await documentIdForCredential(credential.id);
  const now = new Date().toISOString();
  await upsertDocument(env, 'staffPasskeys', id, {
    CredentialId: credential.id,
    PublicKey: bytesToBase64Url(credential.publicKey),
    Counter: Number(credential.counter || 0),
    Transports: credential.transports || body.credential?.response?.transports || [],
    Username: user.username,
    UsernameKey: lower(user.username),
    DisplayName: user.displayName,
    DeviceType: verification.registrationInfo.credentialDeviceType,
    BackedUp: Boolean(verification.registrationInfo.credentialBackedUp),
    Active: true,
    CreatedAt: now,
    LastUsedAt: ''
  });
  return response({ ok: true, message: 'Biometric sign-in is ready on this account.' });
}

async function authenticationOptions(request, env) {
  const rp = relyingPartySettings(request, env);
  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    timeout: 60000,
    userVerification: 'required'
  });
  return response({
    ok: true,
    ceremonyId: await saveCeremony(env, 'authentication', options.challenge),
    options
  });
}

async function approvalOptions(request, env, body) {
  const user = await requireStaffSession(env, request);
  const scope = {
    recordId: clean(body.recordId),
    recordType: lower(body.recordType),
    action: clean(body.decisionAction)
  };
  if (!scope.recordId || !['requisition', 'bill'].includes(scope.recordType) ||
      !['review:Approved', 'accountsReview'].includes(scope.action)) {
    return response({ ok: false, message: 'The document approval request is invalid.' }, 400);
  }
  const credentials = (await userPasskeys(env, user.username)).filter((item) => isActive(item.Active));
  if (!credentials.length) {
    return response({ ok: false, message: 'Set up biometric sign-in before using it to approve documents.' }, 400);
  }
  const rp = relyingPartySettings(request, env);
  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    allowCredentials: credentials.map((item) => ({
      id: item.CredentialId,
      transports: Array.isArray(item.Transports) ? item.Transports : undefined
    })),
    timeout: 60000,
    userVerification: 'required'
  });
  return response({
    ok: true,
    ceremonyId: await saveCeremony(env, 'approval', options.challenge, user.username, scope),
    options
  });
}

async function verifyAuthentication(request, env, body) {
  const ceremony = await consumeCeremony(env, body.ceremonyId, 'authentication');
  const credentialId = clean(body.credential?.id);
  const stored = credentialId ? await findOneByField(env, 'staffPasskeys', 'CredentialId', credentialId) : null;
  if (!stored || !isActive(stored.Active)) {
    return response({ ok: false, message: 'Biometric sign-in was not recognized.' }, 401);
  }
  const rp = relyingPartySettings(request, env);
  const verification = await verifyAuthenticationResponse({
    response: body.credential,
    expectedChallenge: ceremony.Challenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpID,
    requireUserVerification: true,
    credential: {
      id: stored.CredentialId,
      publicKey: base64UrlToBytes(stored.PublicKey),
      counter: Number(stored.Counter || 0),
      transports: Array.isArray(stored.Transports) ? stored.Transports : undefined
    }
  });
  if (!verification.verified) {
    return response({ ok: false, message: 'Biometric sign-in could not be verified.' }, 401);
  }
  const user = await authenticateStaffPasskey(env, stored.Username);
  if (!user) {
    return response({ ok: false, message: 'This staff account is inactive or no longer exists.' }, 401);
  }
  const updated = { ...stored, Counter: verification.authenticationInfo.newCounter, LastUsedAt: new Date().toISOString() };
  delete updated.__id;
  delete updated.__name;
  await upsertDocument(env, 'staffPasskeys', stored.__id, updated);
  const access = await staffAccessFor(env, user);
  const token = await createStaffSession(env, user);
  return response({
    ok: true,
    authenticated: true,
    message: 'Signed in with your device.',
    user: { ...user, ...access }
  }, 200, staffSessionCookie(token));
}

async function verifyApproval(request, env, body) {
  const user = await requireStaffSession(env, request);
  const ceremony = await consumeCeremony(env, body.ceremonyId, 'approval');
  if (lower(ceremony.UsernameKey) !== lower(user.username)) {
    return response({ ok: false, message: 'This verification request belongs to another staff account.' }, 403);
  }
  const credentialId = clean(body.credential?.id);
  const stored = credentialId ? await findOneByField(env, 'staffPasskeys', 'CredentialId', credentialId) : null;
  if (!stored || !isActive(stored.Active) || lower(stored.Username) !== lower(user.username)) {
    return response({ ok: false, message: 'This biometric credential is not linked to the signed-in officer.' }, 401);
  }
  const rp = relyingPartySettings(request, env);
  const verification = await verifyAuthenticationResponse({
    response: body.credential,
    expectedChallenge: ceremony.Challenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpID,
    requireUserVerification: true,
    credential: {
      id: stored.CredentialId,
      publicKey: base64UrlToBytes(stored.PublicKey),
      counter: Number(stored.Counter || 0),
      transports: Array.isArray(stored.Transports) ? stored.Transports : undefined
    }
  });
  if (!verification.verified) {
    return response({ ok: false, message: 'Biometric approval verification failed.' }, 401);
  }
  const updated = { ...stored, Counter: verification.authenticationInfo.newCounter, LastUsedAt: new Date().toISOString() };
  delete updated.__id;
  delete updated.__name;
  await upsertDocument(env, 'staffPasskeys', stored.__id, updated);
  const proof = await createStaffApprovalProof(env, user, {
    recordId: ceremony.RecordId,
    recordType: ceremony.RecordType,
    action: ceremony.DecisionAction
  });
  return response(
    { ok: true, message: 'Identity verified. You may confirm this decision now.' },
    200,
    staffApprovalProofCookie(proof)
  );
}

async function passkeyStatus(request, env) {
  const user = await requireStaffSession(env, request);
  const registered = (await userPasskeys(env, user.username)).filter((item) => isActive(item.Active));
  return response({ ok: true, registered: registered.length });
}

export async function onRequestPost({ request, env }) {
  try {
    requireFirestoreEnv(env);
    const body = await request.json().catch(() => ({}));
    const action = lower(body.action);
    if (action === 'registration-options') return registrationOptions(request, env);
    if (action === 'registration-verify') return verifyRegistration(request, env, body);
    if (action === 'authentication-options') return authenticationOptions(request, env);
    if (action === 'authentication-verify') return verifyAuthentication(request, env, body);
    if (action === 'approval-options') return approvalOptions(request, env, body);
    if (action === 'approval-verify') return verifyApproval(request, env, body);
    if (action === 'status') return passkeyStatus(request, env);
    return response({ ok: false, message: 'Unsupported biometric action.' }, 400);
  } catch (error) {
    const isVerificationError = /challenge|origin|rp id|verification|credential|authenticator/i.test(clean(error?.message));
    return response({
      ok: false,
      message: isVerificationError ? 'Biometric verification failed. Please try again.' : (error.message || String(error))
    }, error.status || (isVerificationError ? 400 : 500));
  }
}
