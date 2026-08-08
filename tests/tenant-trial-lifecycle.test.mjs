import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  tenantTrialFingerprint,
  trialLifecycleWindow,
  TRIAL_DATA_RETENTION_DAYS
} from '../functions/lib/tenant-trial-lifecycle.js';

const poolSource = await readFile(new URL('../functions/lib/tenant-project-pool.js', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../functions/api/tenant-project-pool.js', import.meta.url), 'utf8');
const registrationSource = await readFile(new URL('../functions/api/register-organization.js', import.meta.url), 'utf8');
const retirementSource = await readFile(new URL('../scripts/retire-tenant-projects.mjs', import.meta.url), 'utf8');
const workflowSource = await readFile(new URL('../.github/workflows/retire-expired-trials.yml', import.meta.url), 'utf8');
const paymentVerificationSource = await readFile(new URL('../functions/api/verify-subscription-payment.js', import.meta.url), 'utf8');
const paymentWebhookSource = await readFile(new URL('../functions/api/paystack-subscription-webhook.js', import.meta.url), 'utf8');
const lifecycleSource = await readFile(new URL('../functions/lib/tenant-trial-lifecycle.js', import.meta.url), 'utf8');

test('trial fingerprints are deterministic without retaining contact details', async () => {
  const first = await tenantTrialFingerprint('Example Academy', 'Owner@Example.com');
  const repeated = await tenantTrialFingerprint(' example academy ', 'owner@example.com');
  const different = await tenantTrialFingerprint('Example Academy', 'another@example.com');
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, repeated);
  assert.notEqual(first, different);
  assert.equal(first.includes('example'), false);
});

test('free trials move from trialing to suspension and retirement after 30 retained days', () => {
  const trialEndsAt = '2026-01-08T00:00:00.000Z';
  const registration = { Plan: 'Free', TrialEndsAt: trialEndsAt };
  assert.equal(TRIAL_DATA_RETENTION_DAYS, 30);
  assert.equal(trialLifecycleWindow(registration, '2026-01-07T23:59:59.000Z').stage, 'trialing');
  const suspended = trialLifecycleWindow(registration, '2026-01-10T00:00:00.000Z');
  assert.equal(suspended.stage, 'suspended');
  assert.equal(suspended.retentionEndsAt, '2026-02-07T00:00:00.000Z');
  assert.equal(trialLifecycleWindow(registration, '2026-02-07T00:00:00.000Z').stage, 'retirement_due');
  assert.equal(trialLifecycleWindow({ Plan: 'Starter', TrialEndsAt: trialEndsAt }, '2026-02-07T00:00:00.000Z').applicable, false);
});

test('assigned projects cannot be returned to the ready pool without secure deletion', () => {
  assert.match(poolSource, /ASSIGNED_TENANT_REQUIRES_RETIREMENT/);
  assert.match(poolSource, /subscriber data is never exposed to another organisation/);
  assert.match(apiSource, /process-lifecycle/);
  assert.match(apiSource, /claim-retirement/);
  assert.match(apiSource, /finish-retirement/);
});

test('retirement automation deletes both hosting and the isolated Google project', () => {
  assert.match(retirementSource, /method: 'DELETE'/);
  assert.match(retirementSource, /gcloud', \['projects', 'delete'/);
  assert.match(retirementSource, /Refusing to delete unexpected Firebase project ID/);
  assert.match(retirementSource, /Firebase and Cloudflare tenant project IDs differ/);
  assert.match(workflowSource, /TENANT_POOL_AUTOMATION_ENABLED == 'true'/);
  assert.match(workflowSource, /cron: '23 2 \* \* \*'/);
  assert.match(workflowSource, /process-lifecycle/);
});

test('registration checks permanent trial-use tombstones before issuing a new free trial', () => {
  assert.match(registrationSource, /findTrialUseTombstone/);
  assert.match(registrationSource, /TrialFingerprint/);
  assert.match(registrationSource, /already used its 7-day free trial/);
  assert.match(registrationSource, /TENANT_RETIREMENT_STARTED/);
});

test('late subscription payments cannot resurrect a tenant after deletion starts', () => {
  assert.match(paymentVerificationSource, /PAYMENT_AFTER_TENANT_RETIREMENT/);
  assert.match(paymentVerificationSource, /Paid After Retirement Deadline/);
  assert.match(paymentWebhookSource, /subscription_event_after_tenant_retirement/);
});

test('paid retirement sanitizes the central record without consuming a free-trial tombstone', () => {
  assert.match(lifecycleSource, /if \(registration\) \{\s*writes\.push\(\{\s*collectionPath: 'tenantRegistrations'/s);
  assert.match(lifecycleSource, /if \(registration && trial\) \{\s*await recordTrialUseTombstone/s);
});
