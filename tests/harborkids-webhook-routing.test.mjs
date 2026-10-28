import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';
import { onRequestPost } from '../functions/api/paystack-subscription-webhook.js';

const secret = 'sk_test_' + 'a'.repeat(40);
const reference = 'HK-303df366-e080-4db3-92bb-7501ced77f8c';
const url = 'https://dynamaxms.pages.dev/api/paystack-subscription-webhook';
const target = 'https://harborkids.pages.dev/api/paystack/webhook';
function signed(body, signature) {
  return new Request(url, { method: 'POST', headers: {
    'Content-Type': 'application/json',
    'x-paystack-signature': signature ?? createHmac('sha512', secret).update(body).digest('hex')
  }, body });
}

test('signed HarborKids charge forwards unchanged bytes and signature, then acknowledges success', async () => {
  const original = globalThis.fetch;
  const body = JSON.stringify({ event: 'charge.success', data: { reference, domain: 'test' } });
  const signature = createHmac('sha512', secret).update(body).digest('hex');
  let calls = 0;
  globalThis.fetch = async (destination, options) => {
    calls++;
    assert.equal(destination, target);
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['x-paystack-signature'], signature);
    assert.equal(new TextDecoder().decode(options.body), body);
    return new Response(null, { status: 200 });
  };
  try {
    const response = await onRequestPost({ request: signed(body), env: { PAYSTACK_SECRET_KEY: secret } });
    assert.equal(response.status, 200);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test('invalid signatures never forward and HarborKids delivery failures request Paystack retry', async () => {
  const original = globalThis.fetch;
  const body = JSON.stringify({ event: 'charge.success', data: { reference } });
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(null, { status: 503 }); };
  try {
    assert.equal((await onRequestPost({ request: signed(body, 'bad'), env: { PAYSTACK_SECRET_KEY: secret } })).status, 401);
    assert.equal(calls, 0);
    assert.equal((await onRequestPost({ request: signed(body), env: { PAYSTACK_SECRET_KEY: secret } })).status, 503);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test('other references do not route to HarborKids', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(null, { status: 200 }); };
  try {
    const body = JSON.stringify({ event: 'charge.success', data: { reference: 'DYNAMAX-123' } });
    const response = await onRequestPost({ request: signed(body), env: { PAYSTACK_SECRET_KEY: secret } });
    assert.notEqual(response.status, 200);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});
