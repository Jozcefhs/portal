import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { emailProviderProfile } from '../functions/api/settings.js';

const root = new URL('../', import.meta.url);
const [setupHtml, setupScript, settingsApi, branchSettings, desktopBackend] = await Promise.all([
  readFile(new URL('setup.html', root), 'utf8'),
  readFile(new URL('js/setup.js', root), 'utf8'),
  readFile(new URL('functions/api/settings.js', root), 'utf8'),
  readFile(new URL('functions/lib/branch-profile-settings.js', root), 'utf8'),
  readFile(new URL('functions/api/backend.js', root), 'utf8')
]);

test('email-provider readiness exposes status without returning credentials', () => {
  const brevo = emailProviderProfile({
    EMAIL_PROVIDER: 'unknown',
    BREVO_API_KEY: 'brevo-secret',
    TENANT_CONTROL_PLANE_PRIVATE_KEY: 'tenant-private-key',
    CANONICAL_PORTAL_URL: 'https://dynamax.cc'
  });
  assert.deepEqual(brevo, {
    EmailProvider: 'unsupported',
    GmailConnectedEmail: '',
    EmailProviderConnectionReady: false,
    EmailProviderSelfServiceAvailable: true
  });
  assert.equal(JSON.stringify(brevo).includes('brevo-secret'), false);
  assert.equal(JSON.stringify(brevo).includes('tenant-private-key'), false);

  const gmail = emailProviderProfile({
    EMAIL_PROVIDER: 'gmail',
    GMAIL_OAUTH_CLIENT_ID: 'client-id',
    GMAIL_OAUTH_CLIENT_SECRET: 'client-secret',
    GMAIL_REFRESH_TOKEN: 'refresh-token',
    GMAIL_CONNECTED_EMAIL: 'office@example.org'
  });
  assert.equal(gmail.EmailProvider, 'gmail');
  assert.equal(gmail.GmailConnectedEmail, 'office@example.org');
  assert.equal(gmail.EmailProviderConnectionReady, true);
  assert.equal(JSON.stringify(gmail).includes('refresh-token'), false);
  assert.equal(JSON.stringify(gmail).includes('client-secret'), false);
});

test('email-provider self-service requires a tenant control key and HTTPS control plane', () => {
  assert.equal(emailProviderProfile({
    TENANT_CONTROL_PLANE_PRIVATE_KEY: 'private-key',
    CANONICAL_PORTAL_URL: 'http://localhost:8788'
  }).EmailProviderSelfServiceAvailable, false);
  assert.equal(emailProviderProfile({
    CANONICAL_PORTAL_URL: 'https://dynamax.cc'
  }).EmailProviderSelfServiceAvailable, false);
});

test('legacy server-side Brevo credentials remain ready during migration', () => {
  const profile = emailProviderProfile({}, { legacyBrevoApiKeyConfigured: true });
  assert.equal(profile.EmailProvider, 'brevo');
  assert.equal(profile.EmailProviderConnectionReady, true);
});

test('organisation settings offer Google OAuth, Brevo fallback and provider testing', () => {
  assert.match(setupHtml, /id="emailProviderPanel"/);
  assert.match(setupHtml, /id="connectGoogleEmail"[^>]*>Connect Google account/);
  assert.match(setupHtml, /id="useBrevoEmail"/);
  assert.match(setupHtml, /id="emailProviderTestRecipient"[^>]*type="email"/);
  assert.match(setupHtml, /never asks for or stores a Gmail password/i);
  assert.doesNotMatch(setupHtml, /id="gmail[^">]*password/i);
  assert.match(setupScript, /requestEmailProviderAction\('connect-google'\)/);
  assert.match(setupScript, /requestEmailProviderAction\('use-brevo'\)/);
  assert.match(setupScript, /requestEmailProviderAction\('test', \{ recipientEmail \}\)/);
  assert.match(setupScript, /activeEmailProvider = \['brevo', 'gmail'\]\.includes\(configuredProvider\) \? configuredProvider : 'unsupported'/);
  assert.match(setupScript, /Unsupported provider configuration/);
  assert.match(setupScript, /SettingsScope: 'organisation'/);
  assert.match(setupScript, /emailProviderPanel\?\.classList\.toggle\('settings-scope-locked', branchMode\)/);
  assert.match(setupScript, /Only its sender and reply-to identities below can be overridden here/);
});

test('Google callback feedback returns administrators to communication settings', () => {
  assert.match(setupScript, /get\('emailConnection'\)/);
  assert.match(setupScript, /get\('emailMessage'\)/);
  assert.match(setupScript, /requestedEmailConnection \? 'document-settings'/);
  assert.match(setupScript, /cleanUrl\.hash = 'document-settings'/);
});

test('provider selection remains organisation-only and transient in settings storage', () => {
  assert.match(settingsApi, /Object\.assign\(profile, emailProviderProfile\(env, \{ legacyBrevoApiKeyConfigured \}\)\)/);
  assert.match(settingsApi, /delete profile\.EmailProvider/);
  assert.doesNotMatch(branchSettings, /'EmailProvider'/);
  assert.doesNotMatch(branchSettings, /'GmailConnectedEmail'/);
});

test('desktop-compatible sender sync reports the active online provider', () => {
  assert.match(desktopBackend, /EmailProviderConnectionReady:\s*emailProviderConnectionReady/);
  assert.match(desktopBackend, /EmailProvider:\s*emailProvider/);
  assert.match(desktopBackend, /Google Workspace \/ Gmail is active for online delivery/);
  assert.match(desktopBackend, /clean\(env\.BREVO_API_KEY\) \|\| clean\(brevoSettings\?\.BrevoApiKey\)/);
});
