const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const GOOGLE_EMAIL_SCOPES = Object.freeze([
  'openid',
  'email',
  'https://www.googleapis.com/auth/gmail.send'
]);

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const clean = (value) => String(value ?? '').trim();

function oauthError(message, status = 503, code = 'GOOGLE_EMAIL_OAUTH_NOT_CONFIGURED') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function base64Url(bytes) {
  let binary = '';
  new Uint8Array(bytes).forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bytesFromBase64Url(value) {
  const normalized = clean(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomUrlToken(byteLength = 48) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

export async function sha256Base64Url(value) {
  return base64Url(await crypto.subtle.digest('SHA-256', encoder.encode(clean(value))));
}

async function verifierEncryptionKey(clientSecret) {
  const material = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(`dynamax-google-email-oauth-state:v1:${clean(clientSecret)}`)
  );
  return crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function protectPkceVerifier(clientSecret, stateHash, verifier) {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt({
    name: 'AES-GCM',
    iv,
    additionalData: encoder.encode(clean(stateHash))
  }, await verifierEncryptionKey(clientSecret), encoder.encode(clean(verifier)));
  return { ciphertext: base64Url(ciphertext), iv: base64Url(iv) };
}

export async function unprotectPkceVerifier(clientSecret, stateHash, ciphertext, iv) {
  try {
    const plaintext = await crypto.subtle.decrypt({
      name: 'AES-GCM',
      iv: bytesFromBase64Url(iv),
      additionalData: encoder.encode(clean(stateHash))
    }, await verifierEncryptionKey(clientSecret), bytesFromBase64Url(ciphertext));
    const verifier = decoder.decode(plaintext);
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw new Error('invalid verifier');
    return verifier;
  } catch (_error) {
    throw oauthError(
      'The Google connection request can no longer be completed. Start a new connection.',
      409,
      'GOOGLE_EMAIL_OAUTH_STATE_INVALID'
    );
  }
}

export function googleOAuthCredentials(env = {}) {
  const clientId = clean(env.GOOGLE_OAUTH_CLIENT_ID);
  const clientSecret = clean(env.GOOGLE_OAUTH_CLIENT_SECRET);
  if (!clientId || !clientSecret) {
    throw oauthError('Google email connection is not configured on the Dynamax control plane.');
  }
  return { clientId, clientSecret };
}

export function googleOAuthRedirectUri(env = {}, requestUrl = '') {
  let canonical;
  try { canonical = new URL(clean(env.CANONICAL_PORTAL_URL) || clean(requestUrl)); } catch (_error) { canonical = null; }
  if (!canonical || canonical.protocol !== 'https:') {
    throw oauthError('The canonical Dynamax portal URL is not configured for Google email connection.');
  }
  let redirect;
  try {
    redirect = clean(env.GOOGLE_OAUTH_REDIRECT_URI)
      ? new URL(clean(env.GOOGLE_OAUTH_REDIRECT_URI))
      : new URL('/api/google-email-callback', canonical.origin);
  } catch (_error) {
    redirect = null;
  }
  if (!redirect || redirect.protocol !== 'https:' || redirect.origin !== canonical.origin
      || redirect.pathname !== '/api/google-email-callback') {
    throw oauthError('The Google email callback URL must use the canonical Dynamax HTTPS portal.');
  }
  redirect.search = '';
  redirect.hash = '';
  return redirect.href;
}

export async function createGoogleOAuthStart(env = {}, requestUrl = '', now = Date.now()) {
  const { clientId, clientSecret } = googleOAuthCredentials(env);
  const redirectUri = googleOAuthRedirectUri(env, requestUrl);
  const state = randomUrlToken(48);
  const stateHash = await sha256Base64Url(state);
  const codeVerifier = randomUrlToken(64);
  const codeChallenge = await sha256Base64Url(codeVerifier);
  const protectedVerifier = await protectPkceVerifier(clientSecret, stateHash, codeVerifier);
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + (9 * 60 * 1000)).toISOString();
  const authorizationUrl = new URL(GOOGLE_AUTHORIZE_URL);
  authorizationUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_EMAIL_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  }).toString();
  return {
    authorizationUrl: authorizationUrl.href,
    stateHash,
    codeVerifierCiphertext: protectedVerifier.ciphertext,
    codeVerifierIv: protectedVerifier.iv,
    redirectUri,
    createdAt,
    expiresAt
  };
}

export async function exchangeGoogleAuthorizationCode(env, {
  code,
  codeVerifier,
  redirectUri
}, fetchImpl = fetch) {
  const { clientId, clientSecret } = googleOAuthCredentials(env);
  if (!clean(code) || !clean(codeVerifier) || !clean(redirectUri)) {
    throw oauthError('The Google authorization response is incomplete.', 400, 'GOOGLE_EMAIL_OAUTH_RESPONSE_INVALID');
  }
  const response = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: clean(code),
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: clean(redirectUri),
      grant_type: 'authorization_code',
      code_verifier: clean(codeVerifier)
    })
  });
  const data = await response.json().catch(() => ({}));
  const grantedScopes = new Set(clean(data.scope).split(/\s+/).filter(Boolean));
  if (!response.ok || !clean(data.access_token) || !clean(data.refresh_token)
      || !grantedScopes.has('https://www.googleapis.com/auth/gmail.send')) {
    throw oauthError(
      'Google did not issue the required offline email permission. Start the connection again and approve access.',
      502,
      'GOOGLE_EMAIL_TOKEN_EXCHANGE_FAILED'
    );
  }
  return {
    accessToken: clean(data.access_token),
    refreshToken: clean(data.refresh_token),
    scope: clean(data.scope),
    tokenType: clean(data.token_type),
    expiresIn: Number(data.expires_in || 0)
  };
}

export async function fetchVerifiedGoogleEmail(accessToken, fetchImpl = fetch) {
  const response = await fetchImpl(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${clean(accessToken)}`, Accept: 'application/json' }
  });
  const data = await response.json().catch(() => ({}));
  const email = clean(data.email).toLowerCase();
  if (!response.ok || data.email_verified !== true || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw oauthError(
      'Google did not return a verified email address for this connection.',
      502,
      'GOOGLE_EMAIL_IDENTITY_INVALID'
    );
  }
  return email;
}

export async function revokeGoogleRefreshToken(refreshToken, fetchImpl = fetch) {
  const token = clean(refreshToken);
  if (!token) return { attempted: false, revoked: false };
  try {
    const response = await fetchImpl(GOOGLE_REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token })
    });
    return { attempted: true, revoked: response.ok };
  } catch (_error) {
    return { attempted: true, revoked: false };
  }
}

export const GOOGLE_EMAIL_OAUTH_STATE_TTL_MINUTES = 9;
