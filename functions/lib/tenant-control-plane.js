const encoder = new TextEncoder();

const clean = (value) => String(value ?? '').trim();

function bytesFromBase64(value) {
  const binary = atob(String(value || '').replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function base64Url(bytes) {
  let binary = '';
  new Uint8Array(bytes).forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemBytes(value, label) {
  const text = clean(value);
  const body = text
    .replace(`-----BEGIN ${label}-----`, '')
    .replace(`-----END ${label}-----`, '')
    .replace(/\s+/g, '');
  if (!text.includes(`-----BEGIN ${label}-----`) || !body) {
    const error = new Error('The tenant control-plane signing key is not configured correctly.');
    error.status = 503;
    error.code = 'TENANT_CONTROL_KEY_INVALID';
    throw error;
  }
  try {
    return bytesFromBase64(body);
  } catch (_error) {
    const error = new Error('The tenant control-plane signing key is not configured correctly.');
    error.status = 503;
    error.code = 'TENANT_CONTROL_KEY_INVALID';
    throw error;
  }
}

export function validTenantControlPublicKey(value) {
  const text = clean(value);
  return text.length <= 5000
    && text.includes('-----BEGIN PUBLIC KEY-----')
    && text.includes('-----END PUBLIC KEY-----');
}

export async function tenantControlSecretHash(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(clean(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function tenantControlCanonicalRequest(details = {}) {
  const action = clean(details.action).toLowerCase();
  const protectedCredential = action === 'connect-paystack'
    ? details.paystackSecretKey
    : ['use-brevo', 'disconnect-google'].includes(action)
      ? details.gmailRefreshToken
      : '';
  return JSON.stringify([
    action,
    clean(details.workspaceId).toLowerCase(),
    clean(details.portalHost).toLowerCase(),
    clean(details.requestId),
    clean(details.issuedAt),
    details.replaceConfirmed === true,
    await tenantControlSecretHash(protectedCredential)
  ]);
}

export function assertFreshTenantControlRequest(details = {}, now = Date.now()) {
  const requestId = clean(details.requestId);
  const issuedAt = Date.parse(clean(details.issuedAt));
  if (!/^[A-Za-z0-9-]{16,96}$/.test(requestId) || !Number.isFinite(issuedAt)) {
    const error = new Error('The tenant control request is incomplete.');
    error.status = 400;
    error.code = 'TENANT_CONTROL_REQUEST_INVALID';
    throw error;
  }
  if (Math.abs(now - issuedAt) > 5 * 60 * 1000) {
    const error = new Error('The tenant control request expired. Try again.');
    error.status = 409;
    error.code = 'TENANT_CONTROL_REQUEST_EXPIRED';
    throw error;
  }
}

export async function signTenantControlRequest(privateKeyPem, details = {}) {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemBytes(privateKeyPem, 'PRIVATE KEY'),
    { name: 'RSA-PSS', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    { name: 'RSA-PSS', saltLength: 32 },
    key,
    encoder.encode(await tenantControlCanonicalRequest(details))
  );
  return base64Url(signature);
}

export async function verifyTenantControlRequest(publicKeyPem, details = {}, signature = '') {
  if (!validTenantControlPublicKey(publicKeyPem) || !clean(signature)) return false;
  try {
    const key = await crypto.subtle.importKey(
      'spki',
      pemBytes(publicKeyPem, 'PUBLIC KEY'),
      { name: 'RSA-PSS', hash: 'SHA-256' },
      false,
      ['verify']
    );
    return crypto.subtle.verify(
      { name: 'RSA-PSS', saltLength: 32 },
      key,
      bytesFromBase64(signature),
      encoder.encode(await tenantControlCanonicalRequest(details))
    );
  } catch (_error) {
    return false;
  }
}
