import { paystackSecretMode } from './paystack-environment.js';

const clean = (value) => String(value ?? '').trim();

export function normalizePaystackSecretKey(value) {
  const secret = clean(value);
  if (secret.length > 200 || !/^sk_(test|live)_[A-Za-z0-9]{10,}$/i.test(secret)) {
    const error = new Error('Enter a valid Paystack secret key beginning with sk_test_ or sk_live_.');
    error.status = 400;
    error.code = 'PAYSTACK_SECRET_INVALID';
    throw error;
  }
  return secret;
}

export async function validatePaystackSecretKey(value, fetchImpl = fetch) {
  const secret = normalizePaystackSecretKey(value);
  let response;
  try {
    response = await fetchImpl('https://api.paystack.co/integration/payment_session_timeout', {
      method: 'GET',
      signal: AbortSignal.timeout(12_000),
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${secret}`
      }
    });
  } catch (_error) {
    const error = new Error('Paystack could not be reached to validate this key. Try again.');
    error.status = 502;
    error.code = 'PAYSTACK_VALIDATION_UNAVAILABLE';
    throw error;
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.status !== true) {
    const error = new Error(response.status === 401
      ? 'Paystack rejected this secret key. Copy the secret key again from Paystack API Keys & Webhooks.'
      : 'Paystack could not validate this key. Check the key and any Paystack IP restrictions, then try again.');
    error.status = 400;
    error.code = 'PAYSTACK_SECRET_REJECTED';
    throw error;
  }
  return { mode: paystackSecretMode(secret) };
}
