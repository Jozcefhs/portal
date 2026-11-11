import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { customPortalHostname, domainError, domainSetupState, pagesDomain, paymentReferenceId, readRootPortalZone } from '../functions/lib/tenant-custom-domain.js';
import { tenantControlCanonicalRequest } from '../functions/lib/tenant-control-plane.js';

test('setup accepts real subdomains and rejects root domains, reserved hosts and URL input', () => {
  assert.equal(customPortalHostname('Portal.SampleAcademy.co.uk.'), 'portal.sampleacademy.co.uk');
  assert.equal(customPortalHostname('SampleAcademy.co.uk.', 'root'), 'sampleacademy.co.uk');
  assert.throws(() => customPortalHostname('portal.sampleacademy.co.uk', 'root'));
  assert.throws(() => customPortalHostname('co.uk', 'root'));
  for (const host of ['sampleacademy.co.uk','sampleacademy.com','foo.pages.dev','sub.localhost',
    '127.0.0.1','https://portal.example.com','user@portal.example.com','portal.example.com:443','a.dynamax.cc']) {
    assert.throws(() => customPortalHostname(host));
  }
});

test('Pages setup checks for an existing attachment before adding and reports DNS records', async () => {
  const calls = [];
  const host = 'portal.example.com';
  const pending = { name: host, status: 'pending',
    validation_data: { method: 'txt', txt_name: '_verify.portal.example.com', txt_value: 'challenge' } };
  const provider = await pagesDomain({ CLOUDFLARE_ACCOUNT_ID: 'account', CLOUDFLARE_PAGES_API_TOKEN: 'token' },
    'tenant-one', host, { attach: true, fetcher: async (url, init) => {
      calls.push([url, init.method, init.body]);
      return init.method === 'GET' ? Response.json({}, { status: 404 }) : Response.json({ success: true, result: pending });
    } });
  assert.deepEqual(calls.map(call => call[1]), ['GET','POST']);
  assert.deepEqual(JSON.parse(calls[1][2]), { name: host });
  const state = domainSetupState({ CustomPortalHostname: host, CloudflareProject: 'tenant-one', PortalUrl: 'https://tenant-one.pages.dev' }, provider);
  assert.equal(state.status, 'pending');
  assert.equal(state.dns.target, 'tenant-one.pages.dev');
  assert.equal(state.certificateRecord.type, 'TXT');
  assert.equal(state.primaryUrl, 'https://tenant-one.pages.dev');
});

test('control signature binds the chosen hostname, observed origin and payment outcome', async () => {
  const original = { action: 'domain-activate', workspaceId: 'tenant-one', portalHost: 'tenant-one.pages.dev',
    observedOrigin: 'https://portal.example.com', hostname: 'portal.example.com', paymentCheck: 'checkout-verified' };
  const canonical = await tenantControlCanonicalRequest(original);
  for (const change of [{ hostname: 'portal.example.org' }, { observedOrigin: 'https://portal.example.org' }, { paymentCheck: 'not-configured' }, { domainKind: 'root' }]) {
    assert.notEqual(await tenantControlCanonicalRequest({ ...original, ...change }), canonical);
  }
});

function route(file, globals) {
  const source = readFileSync(new URL('../functions/api/' + file + '.js', import.meta.url), 'utf8');
  return vm.runInNewContext(source.replace(/^import .*;$/gm, '').replace('export async', 'async') + '\nonRequestPost',
    { Response, URL, Date, crypto, AbortSignal, domainError, customPortalHostname, paymentReferenceId, ...globals });
}

test('primary switch checks a staff session and a recent verified payment on the actual custom host', async () => {
  const host = 'https://portal.example.com';
  const env = { TENANT_CONTROL_PLANE_PRIVATE_KEY: 'configured', PUBLIC_PORTAL_URL: 'https://tenant-one.pages.dev',
    CANONICAL_PORTAL_URL: 'https://dynamax.cc', PAYSTACK_SECRET_KEY: 'configured' };
  let actor = { source: 'setup-password' };
  let intent = { Reference: 'valid-reference', Status: 'Completed', PortalCheckoutOrigin: host,
    PortalReturnVerifiedOrigin: host, PortalPaymentCredential: 'current', PortalReturnVerifiedAt: new Date().toISOString() };
  const signed = [];
  const post = route('portal-domain', {
    requireSetupAdministrator: async () => actor, resolveSetupSettingsAccess: () => ({ scope: 'organisation' }),
    requiredDeploymentIdentity: () => ({ workspaceId: 'tenant-one' }), readJsonBody: request => request.json(),
    getDocument: async () => intent, paystackCredentialFingerprint: async () => 'current',
    signTenantControlRequest: async (_key, details) => { signed.push(details); return 'signed'; },
    fetch: async () => Response.json({ ok: true })
  });
  const run = (origin = host, headerOrigin = origin) => post({ env, request: new Request(origin + '/api/portal-domain', {
    method: 'POST', headers: { Origin: headerOrigin }, body: JSON.stringify({ action: 'activate', paymentReference: 'valid-reference' })
  }) });
  assert.equal((await run()).status, 403);
  actor = { source: 'staff-session' };
  assert.equal((await run(host, 'https://unrelated.example.org')).status, 403);
  intent = { ...intent, PortalReturnVerifiedOrigin: 'https://tenant-one.pages.dev' };
  assert.equal((await run()).status, 409);
  assert.equal(signed.length, 0);
  intent = { ...intent, PortalReturnVerifiedOrigin: host };
  assert.equal((await run()).status, 200);
  assert.equal(signed[0].paymentCheck, 'checkout-verified');
  assert.equal(signed[0].observedOrigin, host);
});

test('platform keeps the current address until Cloudflare activation and scoped tenant evidence both pass', async () => {
  const hostname = 'portal.example.com';
  const registration = { PortalUrl: 'https://tenant-one.pages.dev', AdminActivatedAt: 'yes', Reference: 'r',
    __updateTime: 'revision', CloudflareProject: 'tenant-one', TenantControlPublicKey: 'key', CustomPortalHostname: hostname,
    PaystackConnected: true };
  let status = 'pending';
  const writes = [];
  const post = route('tenant-custom-domain', {
    requirePlatformFirestoreEnv: () => ({}), assertFreshTenantControlRequest: () => {},
    queryCollection: async () => [registration], verifyTenantControlRequest: async () => true,
    assertTenantProjectAssignment: async () => {}, readJsonBody: request => request.json(),
    pagesDomain: async () => ({ name: hostname, status }), domainSetupState,
    patchDocumentFieldsIfCurrent: async (_env, _collection, _id, patch, version) => writes.push([patch, version])
  });
  const run = (paymentCheck = 'checkout-verified', observedOrigin = 'https://' + hostname) => post({
    env: {}, request: new Request('https://dynamax.cc/api/tenant-custom-domain', { method: 'POST',
      body: JSON.stringify({ action: 'domain-activate', portalHost: 'tenant-one.pages.dev', workspaceId: 'tenant-one', paymentCheck, observedOrigin })
    })
  });
  assert.equal((await run()).status, 409);
  status = 'active';
  assert.equal((await run('not-configured')).status, 409);
  assert.equal((await run('checkout-verified', registration.PortalUrl)).status, 409);
  assert.equal(writes.length, 0);
  assert.equal((await run()).status, 200);
  assert.equal(writes[0][0].PrimaryPortalUrl, 'https://' + hostname);
  assert.equal(writes[0][1].updateTime, 'revision');
});

test('root zone inspection checks the exact domain and the Pages account', async () => {
  const hostname = 'sampleacademy.co.uk';
  const zoneId = 'a'.repeat(32);
  const env = { CLOUDFLARE_ACCOUNT_ID: 'pages-account', CLOUDFLARE_ZONE_READ_API_TOKEN: 'read-only' };
  const zone = { id: zoneId, name: hostname, type: 'full', account: { id: 'pages-account' },
    status: 'pending', name_servers: ['one.ns.cloudflare.com', 'two.ns.cloudflare.com'] };
  const read = result => readRootPortalZone(env, hostname, zoneId, async (url, request) => {
    assert.equal(url, 'https://api.cloudflare.com/client/v4/zones/' + zoneId);
    assert.equal(request.headers.Authorization, 'Bearer read-only');
    return Response.json({ success: true, result });
  });
  assert.deepEqual(await read(zone), { status: 'pending', nameservers: zone.name_servers });
  await assert.rejects(read({ ...zone, account: { id: 'different-account' } }), { status: 409 });
  await assert.rejects(read({ ...zone, name: 'another.example.com' }), { status: 409 });
});

test('root setup waits for approved active DNS before Pages attachment and still gates the primary switch', async () => {
  const host = 'sampleacademy.co.uk';
  const registration = { PortalUrl: 'https://tenant-one.pages.dev', CloudflareProject: 'tenant-one', Reference: 'R-1',
    AdminActivatedAt: 'yes', __updateTime: 'v1', CustomPortalHostname: host, CustomPortalDomainKind: 'root',
    PaystackConnected: true };
  let dnsStatus = 'pending', pagesStatus = 'active';
  const attaches = [], writes = [];
  const post = route('tenant-custom-domain', {
    requirePlatformFirestoreEnv: () => ({}), assertFreshTenantControlRequest: () => {},
    queryCollection: async () => [registration], verifyTenantControlRequest: async () => true,
    assertTenantProjectAssignment: async () => {}, readJsonBody: request => request.json(),
    readRootPortalZone: async () => ({ status: dnsStatus, nameservers: ['one.ns.cloudflare.com'] }),
    pagesDomain: async (_env, _project, _host, options) => {
      attaches.push(options.attach);
      return { status: pagesStatus };
    },
    domainSetupState, patchDocumentFieldsIfCurrent: async (_env, _collection, _id, data) => writes.push(data)
  });
  const run = (action, extra = {}) => post({ env: {}, request: new Request('https://dynamax.cc/api/tenant-custom-domain',
    { method: 'POST', body: JSON.stringify({ action, hostname: host, domainKind: 'root', portalHost: 'tenant-one.pages.dev',
      observedOrigin: 'https://' + host, workspaceId: 'tenant-one', ...extra }) }) });
  assert.equal((await run('domain-attach', { domainKind: 'either' })).status, 400);
  assert.equal((await (await run('domain-attach')).json()).status, 'awaiting-zone');
  assert.equal((await run('domain-activate', { paymentCheck: 'checkout-verified' })).status, 409);
  registration.CustomPortalRootZoneId = 'a'.repeat(32);
  const pending = await (await run('domain-attach')).json();
  assert.equal(pending.status, 'awaiting-nameservers');
  assert.deepEqual(pending.nameservers, ['one.ns.cloudflare.com']);
  assert.equal(pending.dns, null);
  assert.deepEqual(attaches, []);
  dnsStatus = 'active';
  assert.equal((await (await run('domain-attach')).json()).status, 'active');
  assert.deepEqual(attaches, [true]);
  assert.equal((await run('domain-activate', { paymentCheck: 'not-configured' })).status, 409);
  pagesStatus = 'pending';
  assert.equal((await run('domain-activate', { paymentCheck: 'checkout-verified' })).status, 409);
  assert.deepEqual(writes, []);
  pagesStatus = 'active';
  assert.equal((await run('domain-activate', { paymentCheck: 'checkout-verified' })).status, 200);
  assert.equal(writes[0].PrimaryPortalUrl, 'https://' + host);
});
