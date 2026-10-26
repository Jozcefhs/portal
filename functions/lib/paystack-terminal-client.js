// Provider access stays on the server. Never expose the secret, card data or PIN.
export async function terminalPaystackRequest(env, path, body, fetcher = fetch) {
  if (!/^sk_(live|test)_/.test(String(env.PAYSTACK_SECRET_KEY || ''))) {
    throw Object.assign(new Error('Configure this organisation’s Paystack connection first.'), { status: 409 });
  }
  if (!/^\/(terminal|paymentrequest|customer|transaction|split)(\/|\?|$)/.test(path)) throw new Error('Unsupported terminal API path.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetcher(`https://api.paystack.co${path}`, {
      method: body === undefined ? 'GET' : 'POST', signal: controller.signal, redirect: 'error',
      headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const result = await response.json();
    if (!response.ok || result.status !== true || !result.data) throw new Error('Provider did not confirm the request.');
    return result.data;
  } catch {
    // Do not echo provider responses: they may contain customer/card data.
    throw Object.assign(new Error('Paystack did not confirm this operation. Check this same payment before retrying; do not charge again.'), { status: 502 });
  } finally { clearTimeout(timer); }
}
