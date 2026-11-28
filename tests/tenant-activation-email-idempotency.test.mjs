import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  activationEmailDeliveryDecision,
  issueTenantActivation,
  sendPlatformActivationEmail,
  TENANT_ACTIVATION_EMAIL_CLAIM_MINUTES,
  TENANT_ACTIVATION_TTL_HOURS
} from '../functions/lib/tenant-activation.js';

const now = Date.parse('2026-09-17T12:00:00.000Z');
const future = new Date(now + TENANT_ACTIVATION_TTL_HOURS * 60 * 60 * 1000).toISOString();
const past = new Date(now - 1000).toISOString();

test('a paid registration with a retry-safe failure sends one usable activation link through the Firestore claim', async (t) => {
  const registration = {
    Reference: 'registration-test', WorkspaceId: 'school-test', PortalUrl: 'https://school.example',
    OrganisationName: 'Example School', Email: 'owner@example.org', PaymentStatus: 'Paid',
    ActivationEmailDeliveryStatus: 'Failed', ActivationEmailRetrySafe: true
  };
  const fields = Object.fromEntries(Object.entries(registration).map(([key, value]) =>
    [key, typeof value === 'boolean' ? { booleanValue: value } : { stringValue: value }]));
  const registrationPath = 'tenantRegistrations/registration-test';
  const documents = new Map([[registrationPath, { fields, name: registrationPath, updateTime: new Date().toISOString() }]]);
  const emails = [];
  t.mock.method(globalThis, 'fetch', async (endpoint, options = {}) => {
    const url = new URL(endpoint);
    if (url.origin === 'https://oauth2.googleapis.com') return Response.json({ access_token: 'fixture', expires_in: 3600 });
    if (url.origin === 'https://api.brevo.com') {
      emails.push(JSON.parse(options.body));
      return Response.json({ messageId: 'delivery-fixture' }, { status: 201 });
    }
    assert.equal(url.hostname, 'firestore.googleapis.com');
    let path = url.pathname.split('/documents/')[1];
    if (options.method === 'POST') path += '/' + url.searchParams.get('documentId');
    const previous = documents.get(path);
    if (!options.body) return previous ? Response.json(previous) : Response.json({}, { status: 404 });
    const expectedVersion = url.searchParams.get('currentDocument.updateTime');
    if (expectedVersion && previous?.updateTime !== expectedVersion) return Response.json({}, { status: 412 });
    const document = {
      name: path, updateTime: new Date().toISOString(),
      fields: { ...previous?.fields, ...JSON.parse(options.body).fields }
    };
    documents.set(path, document);
    return Response.json(document);
  });
  const env = {
    FIREBASE_PROJECT_ID: 'fixture', FIREBASE_CLIENT_EMAIL: 'fixture@example.org',
    FIREBASE_PRIVATE_KEY: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }),
    BREVO_API_KEY: 'fixture', DYNAMAX_SENDER_EMAIL: 'sender@example.org'
  };
  const first = await issueTenantActivation(env, { Reference: registration.Reference });
  assert.equal(first.emailStatus, 'Sent', first.emailMessage);
  const repeat = await issueTenantActivation(env, { Reference: registration.Reference });
  assert.equal(repeat.emailDeliverySuppressed, true);
  assert.equal(emails.length, 1);
  assert.equal(emails[0].to[0].email, registration.Email);
  assert.ok(emails[0].textContent.includes(first.activationUrl));
  assert.equal(new URL(first.activationUrl).origin, registration.PortalUrl);
  assert.equal(documents.get(registrationPath).fields.ActivationEmailDeliveryStatus.stringValue, 'Sent');
});

test('activation delivery addresses the registered contact and includes the single-use workspace link', async (t) => {
  const url = 'https://school.example/activate-account.html#activation=fixture&token=fixture';
  const deliveries = [];
  t.mock.method(globalThis, 'fetch', async (endpoint, options) => {
    assert.equal(String(endpoint), 'https://api.brevo.com/v3/smtp/email');
    deliveries.push(JSON.parse(options.body));
    return Response.json({ messageId: 'fixture-id' }, { status: 201 });
  });
  const result = await sendPlatformActivationEmail({
    BREVO_API_KEY: 'fixture', DYNAMAX_SENDER_EMAIL: 'sender@notify.example.org', DYNAMAX_REPLY_TO_EMAIL: 'support@example.org'
  },
    { Email: 'Owner@example.org', OrganisationName: 'Example school' }, url);
  assert.equal(result.providerMessageId, 'fixture-id');
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].to[0].email, 'owner@example.org');
  assert.equal(deliveries[0].sender.email, 'sender@notify.example.org');
  assert.equal(deliveries[0].replyTo.email, 'support@example.org');
  const { htmlContent, textContent } = deliveries[0];
  assert.ok(textContent.split('\n').includes(url), 'The plain-text URL is on its own line');
  const escapedUrl = url.replace('&', '&amp;');
  assert.ok(htmlContent.includes(`href="${escapedUrl}"`), 'The button opens the issued activation');
  const fallback = htmlContent.slice(htmlContent.indexOf('</a>') + 4);
  const visibleUrl = fallback.match(/<code\b[^>]*>([^<]+)<\/code>/)?.[1];
  assert.equal(visibleUrl, escapedUrl, 'Copying the visible text must preserve the entire URL and token');
  assert.match(deliveries[0].subject, /Example school/);
});

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
