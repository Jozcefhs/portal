const clean = (value) => String(value ?? '').trim();

export function paystackSecretMode(secret) {
  const value = clean(secret).toLowerCase();
  if (!value) return 'not-configured';
  if (value.startsWith('sk_live_')) return 'live';
  if (value.startsWith('sk_test_')) return 'test';
  return 'configured';
}

export async function paystackCredentialFingerprint(secret) {
  const value = clean(secret);
  if (!value) return '';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `${paystackSecretMode(value)}:${hex.slice(0, 24)}`;
}

export async function paystackEnvironmentIdentity(env = {}) {
  const secret = clean(env.PAYSTACK_SECRET_KEY);
  return {
    mode: paystackSecretMode(secret),
    fingerprint: await paystackCredentialFingerprint(secret)
  };
}

export function paystackCredentialMatches(record = {}, identity = {}) {
  const saved = clean(
    record.PaystackCredentialFingerprint
      || record.PendingPaystackCredentialFingerprint
  );
  return Boolean(saved && identity.fingerprint && saved === clean(identity.fingerprint));
}
