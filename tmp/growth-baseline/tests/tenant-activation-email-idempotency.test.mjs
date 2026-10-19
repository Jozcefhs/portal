import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  activationEmailDeliveryDecision,
  TENANT_ACTIVATION_EMAIL_CLAIM_MINUTES,
  TENANT_ACTIVATION_TTL_HOURS
} from '../functions/lib/tenant-activation.js';

const now = Date.parse('2026-09-17T12:00:00.000Z');
const future = new Date(now + TENANT_ACTIVATION_TTL_HOURS * 60 * 60 * 1000).toISOString();
const past = new Date(now - 1000).toISOString();

test('sent and uncertain activation email outcomes suppress automatic duplicate delivery', () => {
  const sent = activationEmailDeliveryDecision({
    ActivationEmailDeliveryStatus: 'Sent',
    ActivationEmailActivationExpiresAt: future,
    ActivationEmailSentAt: new Date(now - 60_000).toISOString()
  }, now);
  assert.equal(sent.shouldSend, false);
  assert.equal(sent.status, 'Sent');

  const uncertain = activationEmailDeliveryDecision({
    ActivationEmailDeliveryStatus: 'Uncertain',
    ActivationEmailActivationExpiresAt: future,
    ActivationEmailDeliveryUncertain: true,
    ActivationEmailRetrySafe: false
  }, now);
  assert.equal(uncertain.shouldSend, false);
  assert.equal(uncertain.status, 'Uncertain');
  assert.match(uncertain.reason, /automatic resend is suppressed/i);
});

test('an active send claim suppresses a concurrent status-check delivery', () => {
  const decision = activationEmailDeliveryDecision({
    ActivationEmailDeliveryStatus: 'Sending',
    ActivationEmailDeliveryStartedAt: new Date(now - 30_000).toISOString(),
    ActivationEmailActivationExpiresAt: future
  }, now);
  assert.equal(decision.shouldSend, false);
  assert.equal(decision.status, 'Sending');
  assert.equal(decision.markUncertain, undefined);
});

test('an abandoned send claim becomes uncertain instead of being retried', () => {
  const decision = activationEmailDeliveryDecision({
    ActivationEmailDeliveryStatus: 'Sending',
    ActivationEmailDeliveryStartedAt: new Date(
      now - (TENANT_ACTIVATION_EMAIL_CLAIM_MINUTES * 60 * 1000) - 1
    ).toISOString(),
    ActivationEmailActivationExpiresAt: future
  }, now);
  assert.equal(decision.shouldSend, false);
  assert.equal(decision.status, 'Uncertain');
  assert.equal(decision.markUncertain, true);
});

test('only authoritatively retry-safe failures or expired links can start another email', () => {
  const retrySafe = activationEmailDeliveryDecision({
    ActivationEmailDeliveryStatus: 'Failed',
    ActivationEmailRetrySafe: true,
    ActivationEmailActivationExpiresAt: future
  }, now);
  assert.equal(retrySafe.shouldSend, true);

  const unsafe = activationEmailDeliveryDecision({
    ActivationEmailDeliveryStatus: 'Failed',
    ActivationEmailRetrySafe: false,
    ActivationEmailActivationExpiresAt: future
  }, now);
  assert.equal(unsafe.shouldSend, false);
  assert.equal(unsafe.markUncertain, true);

  const expiredUncertain = activationEmailDeliveryDecision({
    ActivationEmailDeliveryStatus: 'Uncertain',
    ActivationEmailRetrySafe: false,
    ActivationEmailActivationExpiresAt: past
  }, now);
  assert.equal(expiredUncertain.shouldSend, true);
});

test('legacy sent timestamps remain duplicate-safe during their activation lifetime', () => {
  const recentLegacy = activationEmailDeliveryDecision({
    ActivationEmailSentAt: new Date(now - 60_000).toISOString()
  }, now);
  assert.equal(recentLegacy.shouldSend, false);
  assert.equal(recentLegacy.status, 'Sent');

  const expiredLegacy = activationEmailDeliveryDecision({
    ActivationEmailSentAt: new Date(
      now - (TENANT_ACTIVATION_TTL_HOURS * 60 * 60 * 1000) - 1
    ).toISOString()
  }, now);
  assert.equal(expiredLegacy.shouldSend, true);
});

test('issue flow claims delivery durably and preserves uncertain provider diagnostics', async () => {
  const source = await readFile(new URL('../functions/lib/tenant-activation.js', import.meta.url), 'utf8');
  assert.match(source, /ActivationEmailDeliveryStatus: 'Sending'/);
  assert.match(source, /patchDocumentFieldsIfCurrent\(platformEnv, 'tenantRegistrations'/);
  assert.match(source, /error\?\.deliveryUncertain === true \|\| error\?\.retrySafe !== true/);
  assert.match(source, /ActivationEmailDeliveryUncertain: finalStatus === 'Uncertain'/);
  assert.match(source, /ActivationEmailRetrySafe: finalStatus === 'Failed' && delivery\.retrySafe === true/);
  assert.doesNotMatch(source, /ActivationEmailSentAt: emailSentAt/);
});
