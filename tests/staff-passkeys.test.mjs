import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  base64UrlToBytes,
  bytesToBase64Url,
  relyingPartySettings
} from '../functions/api/staff-passkey.js';

const portalRoot = new URL('../', import.meta.url);
const [indexHtml, adminHtml, adminJs, preferencesJs, passkeyApi, staffAuth] = await Promise.all([
  readFile(new URL('index.html', portalRoot), 'utf8'),
  readFile(new URL('admin.html', portalRoot), 'utf8'),
  readFile(new URL('js/admin.js', portalRoot), 'utf8'),
  readFile(new URL('js/preferences.js', portalRoot), 'utf8'),
  readFile(new URL('functions/api/staff-passkey.js', portalRoot), 'utf8'),
  readFile(new URL('functions/lib/staff-auth.js', portalRoot), 'utf8')
]);

test('landing settings include a persisted biometric preference', () => {
  assert.match(indexHtml, /name="biometric"/);
  assert.match(indexHtml, /face, fingerprint or PIN/);
  assert.match(preferencesJs, /biometric: false/);
  assert.match(preferencesJs, /dataset\.biometric/);
});

test('staff portal offers passkey registration and authentication', () => {
  assert.match(adminHtml, /id="staffPasskeyLogin"/);
  assert.match(adminHtml, /Sign in with biometrics/);
  assert.match(adminHtml, /id="staffPasskeySetup"/);
  assert.match(adminHtml, /autocomplete="username webauthn"/);
  assert.match(adminJs, /passkeyLoginButton\.hidden = !supported \|\| Boolean\(currentUser\)/);
  assert.match(adminJs, /passkeyLoginButton\.classList\.toggle\('is-preferred', preferred\)/);
  assert.match(adminJs, /confirmFreshStaffSession\(completed\.user\)/);
  assert.match(adminJs, /const delays = \[120, 300, 700, 1200\]/);
  assert.match(adminJs, /this browser did not retain the new session/);
  assert.match(adminJs, /navigator\.credentials\.create/);
  assert.match(adminJs, /navigator\.credentials\.get/);
  assert.match(passkeyApi, /action === 'approval-options'/);
  assert.match(passkeyApi, /action === 'approval-verify'/);
  assert.match(passkeyApi, /}, 200, staffSessionCookie\(token\)\)/);
});

test('passkey API requires user verification and validates origin, RP ID and one-time challenges', () => {
  assert.match(passkeyApi, /userVerification: 'required'/);
  assert.match(passkeyApi, /requireUserVerification: true/);
  assert.match(passkeyApi, /expectedOrigin: rp\.origin/);
  assert.match(passkeyApi, /expectedRPID: rp\.rpID/);
  assert.match(passkeyApi, /deleteDocument\(env, 'staffPasskeyChallenges', id\)/);
  assert.match(passkeyApi, /already linked to another staff account/);
});

test('passkey authentication still checks the current staff account status', () => {
  assert.match(passkeyApi, /authenticateStaffPasskey\(env, stored\.Username\)/);
  assert.match(staffAuth, /export async function authenticateStaffPasskey/);
  assert.match(staffAuth, /if \(!active\) return null/);
});

test('passkey binary encoding round-trips credential data', () => {
  const bytes = new Uint8Array([0, 1, 2, 127, 128, 250, 255]);
  assert.deepEqual(base64UrlToBytes(bytesToBase64Url(bytes)), bytes);
});

test('relying party defaults are derived from the current secure origin', () => {
  const settings = relyingPartySettings(new Request('https://digc-suite.pages.dev/admin.html'), {});
  assert.deepEqual(settings, {
    rpID: 'digc-suite.pages.dev',
    origin: 'https://digc-suite.pages.dev',
    rpName: 'DIGC Suite'
  });
});
