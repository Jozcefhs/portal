import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { generateKeyPairSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as signing from '../functions/lib/tenant-control-plane.js';
import { activeTenantControlRecord } from '../functions/lib/tenant-email-provider.js';
import { contactOwnerRegistry } from '../functions/lib/owner-recovery-client.js';

const source = (await readFile(new URL('../functions/api/tenant-owner-recovery.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?$/gm, '').replace(/^export /gm, '');
const keys = generateKeyPairSync('rsa', { modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });

function fixture() {
  const details = { action: 'issue-owner-recovery', workspaceId: 'example-tenant', portalHost: 'example-tenant.pages.dev',
    edition: 'school', founderUsername: 'original', activationId: 'ACT-123-ABCD', issuedAt: new Date().toISOString(),
    requestId: crypto.randomUUID() };
  const activation = { ActivationId: details.activationId, WorkspaceId: details.workspaceId,
    PortalUrl: 'https://' + details.portalHost, Status: 'Used', UsedAt: details.issuedAt, RegistrationReference: 'original-registration' };
  const registration = { Reference: activation.RegistrationReference, WorkspaceId: details.workspaceId, PortalUrl: activation.PortalUrl,
    CloudflareProject: 'example-tenant', Email: 'original-owner@example.test', AdminUsername: details.founderUsername,
    AdminActivatedAt: activation.UsedAt, Status: 'Active', SubscriptionStatus: 'Active', Edition: 'school', TenantControlPublicKey: keys.publicKey };
  const mail = [], receipts = new Set();
  const context = vm.createContext({ ...signing, crypto, Date, Response, activeTenantControlRecord,
    requirePlatformFirestoreEnv: () => ({}),
    getDocument: (_env, collection, id) => collection === 'tenantActivations' && id === activation.ActivationId
      ? activation : collection === 'tenantRegistrations' && id === registration.Reference ? registration : null,
    createDocumentIfAbsent: (_env, _collection, id) => { const created = !receipts.has(id); receipts.add(id); return { created }; },
    assertTenantProjectAssignment: (_env, project, check) => {
      assert.equal(project, 'example-tenant'); assert.equal(check.workspaceId, 'example-tenant');
      assert.equal(check.registrationReference, 'original-registration');
    },
    sendConfiguredEmail: (_env, message) => { mail.push(message); }
  });
  vm.runInContext(source, context);
  const invoke = async (body, signature) => context.registeredOwnerRecovery(
    { BREVO_API_KEY: 'test', BREVO_SENDER_EMAIL: 'sender@example.test' }, body,
    signature ?? await signing.signTenantControlRequest(keys.privateKey, body));
  return { details, activation, registration, context, mail, invoke };
}

test('central delivery uses only the completed registration, returns a digest and rejects replay', async () => {
  const f = fixture();
  const request = { ...f.details, email: 'claimed@example.test', code: 'claimed-code' };
  const challenge = await f.invoke(request);
  assert.equal(f.mail.length, 1);
  assert.equal(f.mail[0].toEmail, 'original-owner@example.test');
  const code = f.mail[0].textContent.match(/[a-f0-9]{48}/)[0];
  assert.equal(challenge.codeHash, await signing.tenantControlSecretHash(code));
  assert.ok(!JSON.stringify(challenge).includes(code));
  assert.equal(challenge.email, undefined);
  await assert.rejects(f.invoke(request));
  const check = await f.invoke({ ...request, action: 'check-owner-recovery', requestId: crypto.randomUUID() });
  assert.equal(check.binding, challenge.binding);
  assert.equal(check.email, 'original-owner@example.test');
  assert.equal(f.mail.length, 1);
});

test('each request is signed for the action, founder, activation, workspace, portal and edition', async () => {
  const f = fixture(), signature = await signing.signTenantControlRequest(keys.privateKey, f.details);
  for (const [key, value] of Object.entries({ action: 'check-owner-recovery', founderUsername: 'another',
    activationId: 'ACT-222-DEAD', workspaceId: 'other-workspace', portalHost: 'another.pages.dev', edition: 'faith' })) {
    const altered = { ...f.details, [key]: value };
    assert.equal(await signing.verifyTenantControlRequest(keys.publicKey, altered, signature), false);
    await assert.rejects(f.invoke(altered, signature));
  }
  assert.equal(f.mail.length, 0);
});

test('incomplete activations, different founders, inactive and reassigned tenants cannot issue a code', async () => {
  for (const reason of ['incomplete', 'identity', 'time', 'disabled', 'reassigned']) {
    const f = fixture();
    if (reason === 'incomplete') f.activation.Status = 'Pending';
    if (reason === 'identity') f.registration.AdminUsername = 'someone-else';
    if (reason === 'time') f.registration.AdminActivatedAt = 'different';
    if (reason === 'disabled') f.registration.Status = 'Suspended';
    if (reason === 'reassigned') f.context.assertTenantProjectAssignment = () => { throw new Error('assignment changed'); };
    await assert.rejects(f.invoke(f.details));
    assert.equal(f.mail.length, 0);
  }
});

test('tenant and registry exchange signed requests without forwarding credentials or following redirects', async t => {
  const f = fixture();
  const env = { CANONICAL_PORTAL_URL: 'https://platform.example.test', PUBLIC_PORTAL_URL: f.activation.PortalUrl,
    TENANT_CONTROL_PLANE_PRIVATE_KEY: keys.privateKey };
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url.href, 'https://platform.example.test/api/tenant-owner-recovery');
    assert.equal(options.redirect, 'error');
    const details = JSON.parse(options.body);
    assert.deepEqual(Object.keys(details).sort(), Object.keys(f.details).sort());
    const reply = await f.invoke(details, options.headers['X-Dynamax-Tenant-Signature']);
    return Response.json({ ok: true, ...reply });
  });
  const identity = { workspaceId: f.details.workspaceId, edition: f.details.edition };
  const first = { Username: f.details.founderUsername, ActivationId: f.details.activationId };
  const issued = await contactOwnerRegistry(env, identity, first, 'issue-owner-recovery');
  const checked = await contactOwnerRegistry(env, identity, first, 'check-owner-recovery');
  assert.equal(issued.binding, checked.binding);
  assert.equal(f.mail.length, 1);
  await assert.rejects(contactOwnerRegistry({ ...env, CANONICAL_PORTAL_URL: env.PUBLIC_PORTAL_URL }, identity, first, 'issue-owner-recovery'));
  assert.equal(fetchMock.mock.callCount(), 2);
});
