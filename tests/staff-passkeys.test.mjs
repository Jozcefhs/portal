import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  base64UrlToBytes,
  bytesToBase64Url,
  relyingPartySettings
} from '../functions/api/staff-passkey.js';
import {
  createStaffAttendanceProof,
  readStaffAttendanceProof
} from '../functions/lib/staff-auth.js';

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
  assert.match(adminJs, /confirmFreshStaffSession\(completed\.user, sessionToken\)/);
  assert.match(adminJs, /if \(memoryToken && fallbackUser\)[\s\S]*?staffBearerToken = memoryToken;[\s\S]*?return fallbackUser/);
  assert.match(adminJs, /requestUrl\.origin === window\.location\.origin && requestUrl\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(adminJs, /headers\.set\('Authorization', `Bearer \$\{staffBearerToken\}`\)/);
  assert.doesNotMatch(adminJs, /(?:localStorage|sessionStorage).*staffBearerToken/);
  assert.doesNotMatch(adminJs, /const delays = \[120, 300, 700, 1200\]/);
  assert.match(adminJs, /this browser did not retain the new session/);
  assert.match(adminJs, /navigator\.credentials\.create/);
  assert.match(adminJs, /navigator\.credentials\.get/);
  assert.match(passkeyApi, /action === 'approval-options'/);
  assert.match(passkeyApi, /action === 'approval-verify'/);
  assert.match(passkeyApi, /action === 'attendance-options'/);
  assert.match(passkeyApi, /action === 'attendance-verify'/);
  assert.match(passkeyApi, /sessionToken: token/);
  assert.match(passkeyApi, /}, 200, staffSessionCookie\(token\)\)/);
});

test('credential-manager cold starts retry once without repeating the server ceremony', () => {
  assert.match(adminJs, /function retryableCredentialManagerError\(error\)/);
  assert.match(adminJs, /\['NotReadableError', 'UnknownError'\]\.includes\(name\)/);
  assert.match(adminJs, /unknown error occur\(\?:red\|ed\) while talking to/);
  assert.match(adminJs, /window\.setTimeout\(resolve, 350\)/);
  assert.match(adminJs, /async function getPasskeyCredential\(options, mediation = 'required'\)/);
  assert.match(adminJs, /getPasskeyCredential\(started\.options, 'optional'\)/);
  assert.match(adminJs, /function warmPasskeyCredentialManager\(\)/);
  assert.match(adminJs, /isUserVerifyingPlatformAuthenticatorAvailable/);
  assert.equal((adminJs.match(/navigator\.credentials\.get\(/g) || []).length, 1);
  assert.equal((adminJs.match(/getPasskeyCredential\(started\.options(?:, 'optional')?\)/g) || []).length, 4);
  assert.equal((adminJs.match(/getPasskeyCredential\(started\.options, 'optional'\)/g) || []).length, 1);
  const retrySource = adminJs.slice(
    adminJs.indexOf('function retryableCredentialManagerError'),
    adminJs.indexOf('async function getPasskeyCredential')
  );
  assert.doesNotMatch(retrySource, /NotAllowedError|AbortError|SecurityError/);
});

test('bearer-backed sessions also protect files and biometric approval decisions', () => {
  assert.match(adminJs, /data-protected-file=/);
  assert.match(adminJs, /staffFetch\(resourceUrl/);
  assert.match(adminJs, /response\.blob\(\)/);
  assert.match(adminJs, /URL\.createObjectURL/);
  assert.match(adminJs, /response\.headers\.get\('Content-Disposition'\)/);
  assert.doesNotMatch(adminJs, /<a[^>]+href="\/api\/staff-(?:document|payroll)/);
  assert.match(passkeyApi, /approvalProof: proof/);
  assert.match(adminJs, /headers\.set\('X-DIGC-Approval-Proof', approvalProof\)/);
  assert.doesNotMatch(adminJs, /(?:localStorage|sessionStorage).*financeDecisionApprovalProof/);
});

test('passkey API requires user verification and validates origin, RP ID and one-time challenges', () => {
  assert.match(passkeyApi, /userVerification: 'required'/);
  assert.match(passkeyApi, /requireUserVerification: true/);
  assert.match(passkeyApi, /expectedOrigin: rp\.origin/);
  assert.match(passkeyApi, /expectedRPID: rp\.rpID/);
  assert.match(passkeyApi, /deleteDocumentIfCurrent\(env, 'staffPasskeyChallenges', id, ceremony\)/);
  assert.match(passkeyApi, /\[404, 409, 412\]\.includes\(Number\(cause\?\.status\)\)/);
  assert.match(passkeyApi, /FIRESTORE_WRITE_CONFLICT/);
  assert.match(passkeyApi, /This biometric request was already used/);
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
    rpName: 'Dynamax'
  });
});

test('attendance identity proofs are short-lived and scoped to user, location and action', async () => {
  const env = { STAFF_SESSION_SECRET: 'attendance-test-secret-that-is-long-enough' };
  const proof = await createStaffAttendanceProof(env, { username: 'Ada' }, {
    siteId: 'main-premises', direction: 'IN', method: 'passkey'
  });
  const accepted = await readStaffAttendanceProof(env, proof, 'ada', {
    siteId: 'main-premises', direction: 'IN'
  });
  assert.equal(accepted.method, 'passkey');
  assert.equal(await readStaffAttendanceProof(env, proof, 'another-user', {
    siteId: 'main-premises', direction: 'IN'
  }), null);
  assert.equal(await readStaffAttendanceProof(env, proof, 'ada', {
    siteId: 'another-site', direction: 'IN'
  }), null);
  assert.equal(await readStaffAttendanceProof(env, proof, 'ada', {
    siteId: 'main-premises', direction: 'OUT'
  }), null);
});
