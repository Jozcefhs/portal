import test from 'node:test';
import assert from 'node:assert/strict';
import { sendConfiguredEmail } from '../functions/lib/email-service.js';

const message = { toEmail: 'parent@example.org', subject: 'Sample referral', textContent: 'Attached referral.',
  htmlContent: '<p>Attached referral.</p>', attachments: [{ name: 'referral.pdf', content: 'JVBERi1zYW1wbGU=' }], requireAttachments: true };
const brevo = { ORGANISATION_EDITION: 'school', ORGANISATION_NAME: 'Example School', BREVO_API_KEY: 'test-key',
  BREVO_SENDER_EMAIL: 'office@example.org', BREVO_SENDER_NAME: 'Test School' };
const gmail = { ORGANISATION_EDITION: 'school', EMAIL_PROVIDER: 'gmail', GMAIL_OAUTH_CLIENT_ID: 'test-client',
  GMAIL_OAUTH_CLIENT_SECRET: 'test-secret', GMAIL_REFRESH_TOKEN: 'test-refresh', GMAIL_CONNECTED_EMAIL: 'office@example.org',
  DYNAMAX_SENDER_EMAIL: 'office@example.org' };

for (const [provider, env] of [['brevo', brevo], ['gmail', gmail]]) {
  test(`${provider}: a required PDF is never dropped after attachment rejection`, async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async url => {
      if (String(url).includes('oauth2.googleapis.com/token')) return Response.json({ access_token: 'test', expires_in: 3600 });
      calls++;
      return Response.json(provider === 'brevo' ? { code: 'invalid_parameter', message: 'attachment too large' }
        : { error: { message: 'invalid attachment', status: 'INVALID_ARGUMENT' } }, { status: 400 });
    };
    try {
      await assert.rejects(sendConfiguredEmail(env, message), error => error.retrySafe === true);
      assert.equal(calls, 1, 'must not resend with an empty attachment list');
    } finally { globalThis.fetch = original; }
  });
  test(`${provider}: missing and malformed required PDF fail before contacting provider`, async () => {
    const original = globalThis.fetch; let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error('Unexpected provider call'); };
    try {
      for (const attachments of [[], [{ name: 'referral.pdf', content: '?' }], [{ name: '', content: 'JVBERg==' }]]) {
        await assert.rejects(sendConfiguredEmail(env, { ...message, attachments }), error => error.code === 'EMAIL_REQUIRED_ATTACHMENT_INVALID');
      }
      assert.equal(calls, 0);
    } finally { globalThis.fetch = original; }
  });
}
