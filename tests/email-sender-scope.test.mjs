import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { resolveEmailSenderProfile } from '../functions/lib/email-service.js';

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
