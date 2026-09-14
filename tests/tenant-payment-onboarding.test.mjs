import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  assertFreshTenantControlRequest,
  signTenantControlRequest,
  verifyTenantControlRequest
} from '../functions/lib/tenant-control-plane.js';
import { setPagesProductionSecret } from '../functions/lib/cloudflare-pages-secrets.js';
import {
  normalizePaystackSecretKey,
  validatePaystackSecretKey
} from '../functions/lib/paystack-connection.js';

const localApi = await readFile(new URL('../functions/api/paystack-connection.js', import.meta.url), 'utf8');
const centralApi = await readFile(new URL('../functions/api/tenant-paystack-connection.js', import.meta.url), 'utf8');
const settingsApi = await readFile(new URL('../functions/api/settings.js', import.meta.url), 'utf8');
const setupPage = await readFile(new URL('../setup.html', import.meta.url), 'utf8');
const setupClient = await readFile(new URL('../js/setup.js', import.meta.url), 'utf8');
const middleware = await readFile(new URL('../functions/_middleware.js', import.meta.url), 'utf8');
const provisioner = await readFile(new URL('../scripts/provision-tenant-projects.mjs', import.meta.url), 'utf8');
const backfill = await readFile(new URL('../scripts/backfill-tenant-payment-onboarding.mjs', import.meta.url), 'utf8');
const workflow = await readFile(new URL('../.github/workflows/backfill-tenant-payment-onboarding.yml', import.meta.url), 'utf8');
const tenantFleetWorkflow = await readFile(new URL('../.github/workflows/deploy-tenant-pool.yml', import.meta.url), 'utf8');
const managedOrganisations = await readFile(new URL('../functions/lib/managed-organisations.js', import.meta.url), 'utf8');
const organisationFleetWorkflow = await readFile(new URL('../.github/workflows/deploy-organisations.yml', import.meta.url), 'utf8');
const organisationWorkflow = await readFile(new URL('../.github/workflows/deploy-organisation.yml', import.meta.url), 'utf8');

function controlKeyPair() {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
}

test('tenant control requests are signed, time-bound and bind the secret without exposing it in the canonical payload', async () => {
  const pair = controlKeyPair();
  const details = {
    action: 'connect-paystack', workspaceId: 'tenant-school-1', portalHost: 'tenant.example',
    requestId: '91a158ab-0ef4-4270-9151-3e49529a6614', issuedAt: new Date().toISOString(),
    replaceConfirmed: false, paystackSecretKey: 'sk_test_1234567890abcdef'
  };
  const signature = await signTenantControlRequest(pair.privateKey, details);
  assert.equal(await verifyTenantControlRequest(pair.publicKey, details, signature), true);
  assert.equal(await verifyTenantControlRequest(pair.publicKey, { ...details, workspaceId: 'another-tenant' }, signature), false);
  assert.equal(await verifyTenantControlRequest(pair.publicKey, { ...details, paystackSecretKey: 'sk_test_changed123456' }, signature), false);
  assert.doesNotThrow(() => assertFreshTenantControlRequest(details));
  assert.throws(() => assertFreshTenantControlRequest({ ...details, issuedAt: '2020-01-01T00:00:00.000Z' }), /expired/i);
});

test('Paystack keys are format-checked and validated server-side through a read-only integration endpoint', async () => {
  assert.equal(normalizePaystackSecretKey(' sk_live_1234567890abcdef '), 'sk_live_1234567890abcdef');
  assert.throws(() => normalizePaystackSecretKey('pk_live_1234567890abcdef'), /secret key/i);
  let authorization = '';
  const result = await validatePaystackSecretKey('sk_test_1234567890abcdef', async (url, options) => {
    assert.equal(url, 'https://api.paystack.co/integration/payment_session_timeout');
    authorization = options.headers.Authorization;
    return Response.json({ status: true, data: { payment_session_timeout: 30 } });
  });
  assert.equal(authorization, 'Bearer sk_test_1234567890abcdef');
  assert.deepEqual(result, { mode: 'test' });
  assert.equal(JSON.stringify(result).includes('1234567890abcdef'), false);
});

test('Cloudflare receives only the encrypted production variable', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return Response.json({ success: true, result: {} });
  };
  const env = { CLOUDFLARE_ACCOUNT_ID: 'account-1', CLOUDFLARE_PAGES_API_TOKEN: 'control-token' };
  const saved = await setPagesProductionSecret(env, 'tenant-school-1', 'PAYSTACK_SECRET_KEY', 'sk_live_1234567890abcdef', fetchImpl);
  const payload = JSON.parse(calls[0].options.body);
  assert.deepEqual(Object.keys(payload.deployment_configs), ['production']);
  assert.deepEqual(Object.keys(payload.deployment_configs.production.env_vars), ['PAYSTACK_SECRET_KEY']);
  assert.equal(payload.deployment_configs.production.env_vars.PAYSTACK_SECRET_KEY.type, 'secret_text');
  assert.equal(JSON.stringify(saved).includes('sk_live_'), false);
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0].url, /deployments|retry/);
});

test('tenant endpoint requires organisation-wide Super Administrator authority and returns no secret', () => {
  assert.match(localApi, /requireSetupAdministrator/);
  assert.match(localApi, /access\.scope !== 'organisation'/);
  assert.match(localApi, /TENANT_CONTROL_PLANE_PRIVATE_KEY/);
  assert.match(localApi, /signTenantControlRequest/);
  assert.match(localApi, /confirmReplacement/);
  assert.doesNotMatch(localApi, /localStorage|sessionStorage|upsertDocument|patchDocumentFields/);
  assert.doesNotMatch(localApi, /paystackSecretKey:\s*clean\(data/);
});

test('central endpoint verifies tenant identity before validating or installing the Paystack secret', () => {
  const verifyIndex = centralApi.indexOf('verifyTenantControlRequest');
  const validateIndex = centralApi.indexOf('validatePaystackSecretKey(details.paystackSecretKey)');
  const installIndex = centralApi.indexOf("setPagesProductionSecret(env, cloudflareProject, 'PAYSTACK_SECRET_KEY'");
  assert.ok(verifyIndex >= 0 && validateIndex > verifyIndex && installIndex > validateIndex);
  assert.match(centralApi, /WorkspaceId/);
  assert.match(centralApi, /portalHost\(row\.PortalUrl\)/);
  assert.match(centralApi, /tenantControlRequests/);
  assert.match(centralApi, /PaystackConnected: true/);
  assert.match(centralApi, /queueTenantPaystackDeployment/);
  assert.match(centralApi, /findManagedOrganisationForTenant/);
  assert.match(centralApi, /queueManagedOrganisationPaystackDeployment/);
  assert.match(centralApi, /__controlCollection/);
  assert.match(centralApi, /PaystackDeploymentRequestedAt/);
  assert.doesNotMatch(centralApi, /PaystackSecretKey:\s*details\.paystackSecretKey/);
  assert.doesNotMatch(centralApi, /console\.(log|error).*paystackSecretKey/);
  assert.match(middleware, /PLATFORM_SUBSCRIPTION_PROXY_PATHS[\s\S]*?'\/api\/tenant-paystack-connection'/);
});

test('settings UI accepts the secret only in a password field and never loads a saved value', () => {
  assert.match(settingsApi, /PaystackConnectionMode: paystackSecretMode\(env\.PAYSTACK_SECRET_KEY\)/);
  assert.match(setupPage, /id="paystackSecretKey" type="password"/);
  assert.doesNotMatch(setupPage, /id="paystackSecretKey"[^>]+name=/);
  assert.match(setupPage, /id="paystackWebhookUrl"/);
  assert.match(setupClient, /fetch\('\/api\/paystack-connection'/);
  assert.match(setupClient, /paystackSecretKeyField\.value = ''/);
  assert.doesNotMatch(setupClient, /setField\('paystackSecretKey'/);
});

test('new and existing pooled tenants receive asymmetric control keys without exposing private material centrally', () => {
  assert.match(provisioner, /generateKeyPairSync\('rsa'/);
  assert.match(provisioner, /TENANT_CONTROL_PLANE_PRIVATE_KEY: secret\(tenantControlPrivateKey\)/);
  assert.match(provisioner, /TenantControlPublicKey: tenantControl\.publicKey/);
  assert.match(backfill, /TenantControlKeyConfigured !== true/);
  assert.match(backfill, /TENANT_CONTROL_PLANE_PRIVATE_KEY = \{ type: 'secret_text'/);
  assert.match(backfill, /action: 'set-control-key'/);
  assert.match(backfill, /variables\.PAYSTACK_SECRET_KEY = null/);
  assert.match(backfill, /action: 'reset-paystack-connection'/);
  assert.match(backfill, /deploy\/organisations\.json/);
  assert.match(backfill, /action: 'register-managed-organisation'/);
  assert.doesNotMatch(backfill, /\/retry|retryProductionDeployment/);
  assert.doesNotMatch(backfill, /process\.stdout\.write\([^\n]+privateKey/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /clear_paystack_keys:/);
  assert.match(workflow, /DYNAMAX_CLEAR_TENANT_PAYSTACK_KEYS/);
  assert.match(workflow, /include_managed_organisations:/);
  assert.match(workflow, /gh workflow run deploy-organisations\.yml/);
  assert.match(workflow, /gh workflow run deploy-platform\.yml/);
  assert.match(workflow, /gh workflow run deploy-tenant-pool\.yml/);
  assert.match(workflow, /DYNAMAX_TENANT_PROVISIONER_SECRET/);
  assert.match(workflow, /CLOUDFLARE_API_TOKEN/);
  assert.match(tenantFleetWorkflow, /cron: '\*\/5 \* \* \* \*'/);
  assert.match(tenantFleetWorkflow, /PaystackDeploymentPending == true/);
  assert.match(tenantFleetWorkflow, /complete-paystack-deployment/);
});

test('dedicated managed organisations use the same signed Paystack onboarding and queued deployment lifecycle', () => {
  assert.match(managedOrganisations, /MANAGED_ORGANISATION_COLLECTION = 'managedOrganisations'/);
  assert.match(managedOrganisations, /validTenantControlPublicKey/);
  assert.match(managedOrganisations, /PaystackDeploymentPending: true/);
  assert.match(managedOrganisations, /PaystackDeploymentRequestedAt/);
  assert.match(managedOrganisations, /completeManagedOrganisationPaystackDeployment/);
  assert.doesNotMatch(managedOrganisations, /PaystackSecretKey/);
  assert.match(organisationFleetWorkflow, /cron: '\*\/5 \* \* \* \*'/);
  assert.match(organisationFleetWorkflow, /managed-organisation-deployment-matrix\.mjs/);
  assert.match(organisationFleetWorkflow, /--pending-only/);
  assert.match(organisationWorkflow, /complete-managed-paystack-deployment/);
  assert.match(organisationWorkflow, /paystack_deployment_requested_at/);
});
