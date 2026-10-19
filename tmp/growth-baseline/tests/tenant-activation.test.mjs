import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  hashTenantActivationToken,
  tenantActivationUrl,
  TENANT_ACTIVATION_TTL_HOURS
} from '../functions/lib/tenant-activation.js';

const activationSource = await readFile(new URL('../functions/lib/tenant-activation.js', import.meta.url), 'utf8');
const centralApiSource = await readFile(new URL('../functions/api/tenant-activation.js', import.meta.url), 'utf8');
const completionSource = await readFile(new URL('../functions/api/complete-tenant-activation.js', import.meta.url), 'utf8');
const registrationSource = await readFile(new URL('../functions/api/register-organization.js', import.meta.url), 'utf8');
const activationPage = await readFile(new URL('../activate-account.html', import.meta.url), 'utf8');
const activationClient = await readFile(new URL('../js/activate-account.js', import.meta.url), 'utf8');
const onboardingSource = await readFile(new URL('../functions/lib/registration-onboarding.js', import.meta.url), 'utf8');
const onboardingApi = await readFile(new URL('../functions/api/registration-status.js', import.meta.url), 'utf8');
const onboardingPage = await readFile(new URL('../onboarding-status.html', import.meta.url), 'utf8');
const onboardingClient = await readFile(new URL('../js/onboarding-status.js', import.meta.url), 'utf8');
const middlewareSource = await readFile(new URL('../functions/_middleware.js', import.meta.url), 'utf8');

test('activation tokens are hashed deterministically and never placed in the request URL', async () => {
  const first = await hashTenantActivationToken('one-time-secret');
  const second = await hashTenantActivationToken('one-time-secret');
  assert.equal(first, second);
  assert.equal(first.length, 64);
  assert.notEqual(first, await hashTenantActivationToken('another-secret'));

  const activationUrl = new URL(tenantActivationUrl('https://tenant.example/path', 'ACT-123', 'raw-token'));
  assert.equal(activationUrl.origin, 'https://tenant.example');
  assert.equal(activationUrl.pathname, '/activate-account.html');
  assert.equal(activationUrl.search, '');
  assert.match(activationUrl.hash, /activation=ACT-123/);
  assert.match(activationUrl.hash, /token=raw-token/);
  assert.equal(TENANT_ACTIVATION_TTL_HOURS, 48);
});

test('central activation records retain only a token hash and use conditional claim and completion writes', () => {
  assert.match(activationSource, /TokenHash: tokenHash/);
  assert.doesNotMatch(activationSource, /\bToken:\s*token\b/);
  assert.match(activationSource, /patchDocumentFieldsIfCurrent/);
  assert.match(activationSource, /batchCommitDocuments/);
  assert.match(activationSource, /Status: 'Claimed'/);
  assert.match(activationSource, /Status: 'Used'/);
  assert.match(activationSource, /AdminActivatedAt/);
  assert.match(centralApiSource, /requirePlatformFirestoreEnv/);
  assert.match(centralApiSource, /X-Dynamax-Portal/);
});

test('the tenant creates exactly one local Super Administrator without sending its password centrally', () => {
  assert.match(completionSource, /documentId: 'firstAdministrator', exists: false/);
  assert.match(completionSource, /collectionPath: 'staffUsers'/);
  assert.match(completionSource, /Role: 'Super Admin'/);
  assert.match(completionSource, /hashStaffPassword\(account\.password\)/);
  assert.match(completionSource, /listCollection\(env, 'staffUsers'/);
  assert.match(completionSource, /action: 'claim', activationId: body\.activationId, token: body\.token/);
  assert.match(completionSource, /action: 'complete', activationId: body\.activationId, token: body\.token/);
  assert.doesNotMatch(completionSource, /action: 'claim'[^}]+password/s);
  assert.doesNotMatch(completionSource, /action: 'complete'[^}]+password/s);
});

test('registration returns activation only after its idempotent result is stored without the raw link', () => {
  const completionIndex = registrationSource.indexOf('completeIdempotentRequest(platformEnv, idempotency, result, 200)');
  const activationIndex = registrationSource.indexOf('activationResponse(env, platformEnv, result.reference)', completionIndex);
  assert.ok(completionIndex >= 0);
  assert.ok(activationIndex > completionIndex);
  assert.match(registrationSource, /issueTenantActivation/);
  assert.match(registrationSource, /issueRegistrationOnboarding/);
  assert.match(registrationSource, /onboardingResponse\(request, platformEnv, result\.reference, activation\)/);
});

test('pending registrations redirect through a hashed, expiring onboarding status link', () => {
  assert.match(onboardingSource, /OnboardingStatusTokenHash: tokenHash/);
  assert.doesNotMatch(onboardingSource, /OnboardingStatusToken:\s*token/);
  assert.match(onboardingSource, /onboardingUrl\.hash = new URLSearchParams/);
  assert.match(onboardingApi, /inspectRegistrationOnboarding/);
  assert.match(onboardingApi, /consumeRequestAllowance/);
  assert.match(onboardingApi, /issueTenantActivation/);
  assert.match(onboardingPage, /Preparing your workspace/);
  assert.match(onboardingClient, /history\.replaceState/);
  assert.match(onboardingClient, /\/api\/registration-status/);
  assert.match(onboardingClient, /window\.location\.replace\(data\.destinationUrl\)/);
  assert.match(middlewareSource, /'\/api\/registration-status'/);
});

test('activation interface collects the administrator account and removes the secret fragment immediately', () => {
  assert.match(activationPage, /Create the first administrator/);
  assert.match(activationPage, /name="username"/);
  assert.match(activationPage, /name="password"/);
  assert.match(activationClient, /history\.replaceState/);
  assert.match(activationClient, /\/api\/complete-tenant-activation/);
  assert.match(activationClient, /Create administrator account|Creating account/);
});
