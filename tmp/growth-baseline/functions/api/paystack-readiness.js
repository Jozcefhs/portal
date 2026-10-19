import { paystackSecretMode } from '../lib/paystack-environment.js';

// Deployment health only: never return the key, its fingerprint, or account details.
export function onRequestGet({ env }) {
  const mode = paystackSecretMode(env.PAYSTACK_SECRET_KEY);
  return Response.json({ ok: true, mode }, {
    headers: { 'Cache-Control': 'no-store' }
  });
}
