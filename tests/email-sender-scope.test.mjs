import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  classifyBrevoFailure,
  resolveEmailSenderProfile,
  selectActiveBrevoSender
} from '../functions/lib/email-service.js';

const faithEnv = {
  ORGANISATION_EDITION: 'faith',
  ORGANISATION_NAME: 'Dynamax Gospel Centre',
  BREVO_API_KEY: 'shared-secret',
  BREVO_SENDER_EMAIL: 'school@example.test',
  BREVO_SENDER_NAME: 'School Sender',
  SCHOOL_EMAIL: 'admissions@example.test',
  SCHOOL_NAME: 'Example School'
};

test('faith email sender uses only organisation-scoped identity fields', () => {
  const resolved = resolveEmailSenderProfile(faithEnv, {
    brevo: {
      BrevoSenderEmail: 'school-db@example.test',
      BrevoSenderName: 'School Database Sender',
      OrganisationSenderEmail: 'church@example.test',
      OrganisationSenderName: 'Church Office',
      OrganisationReplyToEmail: 'pastor@example.test',
      OrganisationReplyToName: 'Senior Pastor'
    },
    organizationProfile: {
      Edition: 'faith',
      Name: 'Dynamax Gospel Centre'
    },
    schoolProfile: {
      SchoolName: 'Example School',
      BrevoSenderEmail: 'school-profile@example.test'
    }
  });

  assert.equal(resolved.scope, 'organisation');
  assert.equal(resolved.senderEmail, 'church@example.test');
  assert.equal(resolved.senderName, 'Church Office');
  assert.equal(resolved.replyToEmail, 'pastor@example.test');
  assert.equal(resolved.replyToName, 'Senior Pastor');
});

test('faith email sender fails closed instead of falling back to school configuration', () => {
  const resolved = resolveEmailSenderProfile(faithEnv, {
    brevo: {
      BrevoSenderEmail: 'school-db@example.test',
      BrevoSenderName: 'School Database Sender'
    },
    organizationProfile: {
      Edition: 'faith',
      Name: 'Dynamax Gospel Centre'
    },
    schoolProfile: {
      SchoolName: 'Example School',
      BrevoSenderEmail: 'school-profile@example.test'
    }
  });

  assert.equal(resolved.scope, 'organisation');
  assert.equal(resolved.senderEmail, '');
  assert.equal(resolved.senderName, 'Dynamax Gospel Centre');
  assert.notEqual(resolved.senderEmail, faithEnv.BREVO_SENDER_EMAIL);
  assert.notEqual(resolved.senderEmail, faithEnv.SCHOOL_EMAIL);
});

test('school email sender retains the existing school configuration', () => {
  const resolved = resolveEmailSenderProfile({
    ...faithEnv,
    ORGANISATION_EDITION: 'school'
  }, {
    brevo: {
      BrevoSenderEmail: 'school-db@example.test',
      BrevoSenderName: 'School Database Sender',
      ExecutiveSenderEmail: 'principal@example.test',
      ExecutiveSenderName: 'Principal'
    },
    organizationProfile: { Edition: 'school', Name: 'Example School' },
    schoolProfile: { SchoolName: 'Example School' },
    senderProfile: 'executive'
  });

  assert.equal(resolved.scope, 'school');
  assert.equal(resolved.senderEmail, 'principal@example.test');
  assert.equal(resolved.senderName, 'Principal');
});

test('faith executive sender uses the organisation executive identity', () => {
  const resolved = resolveEmailSenderProfile(faithEnv, {
    brevo: {
      OrganisationSenderEmail: 'church@example.test',
      OrganisationSenderName: 'Church Office',
      OrganisationExecutiveSenderEmail: 'senior-pastor@example.test',
      OrganisationExecutiveSenderName: 'Senior Pastor'
    },
    organizationProfile: { Edition: 'faith', Name: 'Dynamax Gospel Centre' },
    senderProfile: 'executive'
  });

  assert.equal(resolved.senderEmail, 'senior-pastor@example.test');
  assert.equal(resolved.senderName, 'Senior Pastor');
  assert.equal(resolved.fallbackSenderEmail, 'church@example.test');
  assert.equal(resolved.fallbackSenderName, 'Church Office');
  assert.equal(resolved.useExecutiveProfile, true);
});

test('unvalidated executive sender falls back to the active organisation sender', () => {
  const selected = selectActiveBrevoSender({
    senderEmail: 'senior-pastor@example.test',
    senderName: 'Senior Pastor',
    fallbackSenderEmail: 'church@example.test',
    fallbackSenderName: 'Church Office'
  }, [
    { email: 'senior-pastor@example.test', active: false },
    { email: 'church@example.test', active: true }
  ]);

  assert.equal(selected.senderEmail, 'church@example.test');
  assert.equal(selected.senderName, 'Senior Pastor');
  assert.equal(selected.replyToEmail, 'senior-pastor@example.test');
  assert.equal(selected.replyToName, 'Senior Pastor');
  assert.equal(selected.usedFallback, true);
  assert.equal(selected.verified, true);
});

test('active executive sender remains the delivery sender', () => {
  const selected = selectActiveBrevoSender({
    senderEmail: 'senior-pastor@example.test',
    senderName: 'Senior Pastor',
    fallbackSenderEmail: 'church@example.test',
    fallbackSenderName: 'Church Office',
    replyToEmail: 'office@example.test',
    replyToName: 'Office'
  }, [
    { email: 'senior-pastor@example.test', active: true },
    { email: 'church@example.test', active: true }
  ]);

  assert.equal(selected.senderEmail, 'senior-pastor@example.test');
  assert.equal(selected.replyToEmail, 'office@example.test');
  assert.equal(selected.usedFallback, false);
  assert.equal(selected.verified, true);
});

test('Brevo failures are converted to safe and actionable delivery messages', () => {
  assert.deepEqual(
    classifyBrevoFailure(401, { code: 'unauthorized', message: 'Key not found' }),
    {
      code: 'BREVO_CREDENTIAL_INVALID',
      status: 503,
      message: 'Brevo rejected the Cloudflare email credential. Replace the encrypted BREVO_API_KEY secret, then redeploy the portal.'
    }
  );
  assert.equal(
    classifyBrevoFailure(402, { code: 'not_enough_credit' }).code,
    'BREVO_CREDIT_EXHAUSTED'
  );
  assert.equal(
    classifyBrevoFailure(400, { code: 'invalid_parameter', message: 'sender is not valid' }).code,
    'BREVO_SENDER_NOT_VALIDATED'
  );
  assert.equal(
    classifyBrevoFailure(400, { code: 'invalid_parameter', message: 'attachment too large' }).code,
    'BREVO_ATTACHMENT_REJECTED'
  );
  assert.equal(
    classifyBrevoFailure(429, { message: 'Too many requests' }).code,
    'BREVO_RATE_LIMITED'
  );
});

test('backend stores school and organisation sender identities in separate fields', async () => {
  const backend = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
  const churchPayments = await readFile(new URL('../functions/lib/church-payments.js', import.meta.url), 'utf8');

  assert.match(backend, /OrganisationSenderEmail: senderEmail/);
  assert.match(backend, /BrevoSenderEmail: senderEmail/);
  assert.match(backend, /SenderScope: organisationScoped \? 'organisation' : 'school'/);
  assert.match(backend, /saveBrevoSettings\(env, body, deploymentIdentity\)/);
  assert.match(churchPayments, /resolveEmailSenderProfile\(env, \{ brevo, organizationProfile \}\)/);
  assert.doesNotMatch(churchPayments, /env\.SCHOOL_EMAIL/);
  assert.doesNotMatch(churchPayments, /env\.BREVO_SENDER_EMAIL/);
});

test('backend safely ignores submitted Brevo credentials and reports secret readiness', async () => {
  const backend = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');

  assert.doesNotMatch(
    backend,
    /if \(submittedApiKey && !environmentApiKeyConfigured\) \{[\s\S]*?throw err;[\s\S]*?\}/
  );
  assert.match(backend, /SubmittedCredentialIgnored: Boolean\(submittedApiKey\)/);
  assert.match(
    backend,
    /online delivery still needs the BREVO_API_KEY encrypted Cloudflare secret/
  );
});

test('executive delivery verifies the configured sender even when it matches the shared sender', async () => {
  const emailSource = await readFile(new URL('../functions/lib/email-service.js', import.meta.url), 'utf8');
  assert.match(emailSource, /fetch\('https:\/\/api\.brevo\.com\/v3\/senders'/);
  assert.doesNotMatch(
    emailSource,
    /clean\(profile\.senderEmail\)\.toLowerCase\(\) === clean\(profile\.fallbackSenderEmail\)\.toLowerCase\(\)/
  );
  assert.match(emailSource, /throw brevoFailureError\(response\.status, providerError\)/);
});
