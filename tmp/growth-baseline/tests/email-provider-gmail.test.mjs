import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildGmailRawMessage,
  classifyGmailFailure,
  gmailConfiguration
} from '../functions/lib/gmail-email-provider.js';
import {
  resolveEmailProvider,
  sendConfiguredEmail
} from '../functions/lib/email-service.js';

const gmailEnv = {
  ORGANISATION_EDITION: 'school',
  ORGANISATION_NAME: 'Example School',
  EMAIL_PROVIDER: 'gmail',
  GMAIL_OAUTH_CLIENT_ID: 'client-id.apps.googleusercontent.com',
  GMAIL_OAUTH_CLIENT_SECRET: 'client-secret',
  GMAIL_REFRESH_TOKEN: 'refresh-token',
  GMAIL_CONNECTED_EMAIL: 'connected@example.com',
  DYNAMAX_SENDER_EMAIL: 'branch-office@example.org',
  DYNAMAX_SENDER_NAME: 'Branch Office'
};

function decodeRaw(raw) {
  const standard = String(raw).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(standard.padEnd(Math.ceil(standard.length / 4) * 4, '='), 'base64').toString('utf8');
}

test('provider selection is backward compatible and rejects unsupported providers', () => {
  assert.equal(resolveEmailProvider({}), 'brevo');
  assert.equal(resolveEmailProvider({ EMAIL_PROVIDER: 'BREVO' }), 'brevo');
  assert.equal(resolveEmailProvider({ EMAIL_PROVIDER: 'Gmail' }), 'gmail');
  assert.equal(resolveEmailProvider({ EMAIL_PROVIDER: 'gmail' }, 'brevo'), 'brevo');
  assert.throws(
    () => resolveEmailProvider({ EMAIL_PROVIDER: 'plain-smtp' }),
    (error) => error.code === 'EMAIL_PROVIDER_UNSUPPORTED'
  );
});

test('Gmail configuration requires the complete secure OAuth connection', () => {
  assert.equal(gmailConfiguration(gmailEnv).connectedEmail, 'connected@example.com');
  assert.throws(
    () => gmailConfiguration({ ...gmailEnv, GMAIL_REFRESH_TOKEN: '' }),
    (error) => error.code === 'GMAIL_CONFIGURATION_MISSING' && error.provider === 'gmail'
  );
});

test('Gmail delivery refreshes OAuth and sends a MIME message from the connected mailbox', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === 'https://oauth2.googleapis.com/token') {
      return new Response(JSON.stringify({ access_token: 'access-token', expires_in: 3600 }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
      return new Response(JSON.stringify({ id: 'gmail-message-id', threadId: 'thread-id' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const result = await sendConfiguredEmail(gmailEnv, {
      toEmail: 'parent@example.net',
      toName: 'Parent Name',
      subject: 'Term result',
      textContent: 'The result is attached.',
      htmlContent: '<p>The result is attached.</p>',
      attachments: [{ name: 'signature.png', content: 'aW1hZ2U=' }]
    });

    assert.equal(result.provider, 'gmail');
    assert.equal(result.providerMessageId, 'gmail-message-id');
    assert.equal(result.attachmentFallback, false);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, 'https://oauth2.googleapis.com/token');
    const tokenRequest = new URLSearchParams(requests[0].options.body);
    assert.equal(tokenRequest.get('client_id'), gmailEnv.GMAIL_OAUTH_CLIENT_ID);
    assert.equal(tokenRequest.get('client_secret'), gmailEnv.GMAIL_OAUTH_CLIENT_SECRET);
    assert.equal(tokenRequest.get('refresh_token'), gmailEnv.GMAIL_REFRESH_TOKEN);
    assert.equal(tokenRequest.get('grant_type'), 'refresh_token');
    assert.equal(requests[1].options.headers.authorization, 'Bearer access-token');
    const mime = decodeRaw(JSON.parse(requests[1].options.body).raw);
    assert.match(mime, /From: Branch Office <connected@example\.com>/);
    assert.match(mime, /Reply-To: Branch Office <branch-office@example\.org>/);
    assert.match(mime, /To: Parent Name <parent@example\.net>/);
    assert.match(mime, /Subject: Term result/);
    assert.match(mime, /Content-Disposition: attachment; filename="signature\.png"/);
    assert.match(mime, /aW1hZ2U=/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Gmail retries without an optional attachment only after an authoritative rejection', async () => {
  const originalFetch = globalThis.fetch;
  const sentMessages = [];
  let sendAttempt = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      return new Response(JSON.stringify({ access_token: 'access-token' }), { status: 200 });
    }
    if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
      sendAttempt += 1;
      sentMessages.push(decodeRaw(JSON.parse(options.body).raw));
      if (sendAttempt === 1) {
        return new Response(JSON.stringify({
          error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Invalid raw MIME attachment' }
        }), { status: 400 });
      }
      return new Response(JSON.stringify({ id: 'accepted-without-attachment' }), { status: 200 });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const result = await sendConfiguredEmail(gmailEnv, {
      toEmail: 'recipient@example.net',
      subject: 'Optional endorsement',
      textContent: 'Document',
      htmlContent: '<p>Document</p>',
      attachments: [{ name: 'stamp.png', content: 'c3RhbXA=' }]
    });
    assert.equal(sendAttempt, 2);
    assert.match(sentMessages[0], /filename="stamp\.png"/);
    assert.doesNotMatch(sentMessages[1], /filename="stamp\.png"/);
    assert.equal(result.attachmentFallback, true);
    assert.equal(result.providerMessageId, 'accepted-without-attachment');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('an ambiguous Gmail send result is marked uncertain and never retried', async () => {
  const originalFetch = globalThis.fetch;
  let sendAttempts = 0;
  globalThis.fetch = async (url) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      return new Response(JSON.stringify({ access_token: 'access-token' }), { status: 200 });
    }
    sendAttempts += 1;
    throw new TypeError('connection closed');
  };
  try {
    await assert.rejects(
      sendConfiguredEmail(gmailEnv, {
        toEmail: 'recipient@example.net',
        subject: 'Do not duplicate',
        textContent: 'Message',
        htmlContent: '<p>Message</p>',
        attachments: [{ name: 'stamp.png', content: 'c3RhbXA=' }]
      }),
      (error) => error.code === 'EMAIL_DELIVERY_UNCERTAIN'
        && error.deliveryUncertain === true
        && error.provider === 'gmail'
    );
    assert.equal(sendAttempts, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('provider HTTP 5xx responses remain uncertain and non-retry-safe', async () => {
  const originalFetch = globalThis.fetch;
  for (const provider of ['brevo', 'gmail']) {
    let sendAttempts = 0;
    globalThis.fetch = async (url) => {
      if (url === 'https://oauth2.googleapis.com/token') {
        return new Response(JSON.stringify({ access_token: 'access-token' }), { status: 200 });
      }
      sendAttempts += 1;
      return new Response(JSON.stringify({ error: { message: 'Temporary upstream error' } }), { status: 503 });
    };
    const env = provider === 'gmail'
      ? gmailEnv
      : {
          ORGANISATION_EDITION: 'school',
          ORGANISATION_NAME: 'Example School',
          BREVO_API_KEY: 'brevo-key',
          BREVO_SENDER_EMAIL: 'office@example.org',
          BREVO_SENDER_NAME: 'School Office'
        };
    await assert.rejects(
      sendConfiguredEmail(env, {
        toEmail: 'recipient@example.net',
        subject: 'Do not retry',
        textContent: 'Message',
        htmlContent: '<p>Message</p>'
      }),
      (error) => error.deliveryUncertain === true
        && error.retrySafe === false
        && error.provider === provider
    );
    assert.equal(sendAttempts, 1);
  }
  globalThis.fetch = originalFetch;
});

test('Gmail failures provide provider-specific recovery guidance', () => {
  assert.equal(classifyGmailFailure(401, {}).code, 'GMAIL_CREDENTIAL_INVALID');
  assert.equal(classifyGmailFailure(403, { error: { message: 'insufficient authentication scopes' } }).code, 'GMAIL_PERMISSION_DENIED');
  assert.equal(classifyGmailFailure(429, {}).code, 'GMAIL_RATE_LIMITED');
  assert.equal(classifyGmailFailure(503, {}).code, 'GMAIL_PROVIDER_UNAVAILABLE');
  assert.equal(classifyGmailFailure(503, {}, 'token').code, 'GMAIL_PROVIDER_UNAVAILABLE');
});

test('Gmail MIME blocks header injection and private attachment URLs', async () => {
  const raw = await buildGmailRawMessage({
    fromEmail: 'connected@example.com',
    fromName: 'School Office',
    toEmail: 'parent@example.net',
    toName: 'Parent,\r\nBcc: hidden@example.net',
    subject: 'Result\r\nBcc: hidden@example.net',
    textContent: 'Result',
    htmlContent: '<p>Result</p>'
  });
  const mime = decodeRaw(raw);
  assert.doesNotMatch(mime, /\r\nBcc:/i);
  assert.match(mime, /Subject: Result Bcc: hidden@example\.net/);
  assert.match(mime, /To: =\?UTF-8\?B\?/);
  assert.doesNotMatch(mime, /To: Parent,/);

  await assert.rejects(
    buildGmailRawMessage({
      fromEmail: 'connected@example.com',
      toEmail: 'parent@example.net',
      subject: 'Unsafe attachment',
      textContent: 'Attachment',
      htmlContent: '<p>Attachment</p>',
      attachments: [{ name: 'private.txt', url: 'https://127.0.0.1/private' }]
    }),
    (error) => error.code === 'GMAIL_ATTACHMENT_REJECTED'
  );
});

test('church donation email and central activation use the shared provider boundary safely', async () => {
  const churchPayments = await readFile(new URL('../functions/lib/church-payments.js', import.meta.url), 'utf8');
  const tenantActivation = await readFile(new URL('../functions/lib/tenant-activation.js', import.meta.url), 'utf8');

  assert.match(churchPayments, /sendConfiguredEmail\(env, \{/);
  assert.match(churchPayments, /branchId\s*\n\s*\}\)/);
  assert.doesNotMatch(churchPayments, /https:\/\/api\.brevo\.com\/v3\/smtp\/email/);
  assert.match(tenantActivation, /providerOverride: 'brevo'/);
  assert.match(tenantActivation, /senderOverride: \{ email: senderEmail, name: senderName \}/);
  assert.doesNotMatch(tenantActivation, /https:\/\/api\.brevo\.com\/v3\/smtp\/email/);
});
