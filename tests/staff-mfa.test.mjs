import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  base32Decode,
  base32Encode,
  evaluateStaffMfaRequirement,
  normalizeStaffMfaPolicy,
  totpCodeForSecret,
  verifyTotpCode
} from '../functions/lib/staff-mfa.js';

const portalRoot = new URL('../', import.meta.url);
const [
  adminHtml,
  adminJs,
  styleCss,
  mfaApi,
  mfaLibrary,
  staffSessionApi,
  passkeyApi,
  middleware,
  backupLibrary,
  securityAuditLibrary
] = await Promise.all([
  readFile(new URL('admin.html', portalRoot), 'utf8'),
  readFile(new URL('js/admin.js', portalRoot), 'utf8'),
  readFile(new URL('css/style.css', portalRoot), 'utf8'),
  readFile(new URL('functions/api/staff-mfa.js', portalRoot), 'utf8'),
  readFile(new URL('functions/lib/staff-mfa.js', portalRoot), 'utf8'),
  readFile(new URL('functions/api/staff-session.js', portalRoot), 'utf8'),
  readFile(new URL('functions/api/staff-passkey.js', portalRoot), 'utf8'),
  readFile(new URL('functions/_middleware.js', portalRoot), 'utf8'),
  readFile(new URL('functions/lib/organization-backup.js', portalRoot), 'utf8'),
  readFile(new URL('functions/lib/security-audit.js', portalRoot), 'utf8')
]);

test('base32 encoding round-trips authenticator secrets', () => {
  const source = new TextEncoder().encode('12345678901234567890');
  const encoded = base32Encode(source);
  assert.equal(encoded, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.deepEqual(base32Decode(encoded), source);
});

test('TOTP generation follows the RFC 6238 SHA-1 vector', async () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(await totpCodeForSecret(secret, 59_000, 8), '94287082');
  const code = await totpCodeForSecret(secret, 59_000, 6);
  assert.deepEqual(await verifyTotpCode(secret, code, { epochMilliseconds: 59_000 }), {
    verified: true,
    step: 1
  });
  assert.deepEqual(await verifyTotpCode(secret, '000000', { epochMilliseconds: 59_000 }), {
    verified: false,
    step: -1
  });
});

test('two-factor policy normalizes modes, roles and bounded grace periods', () => {
  assert.deepEqual(normalizeStaffMfaPolicy({ mode: 'required-roles', requiredRoles: ['Accounts Officer', 'Accounts Officer'], graceDays: 99 }), {
    Mode: 'REQUIRED_ROLES',
    RequiredRoles: ['Accounts Officer'],
    GraceDays: 30,
    EnforceFrom: '',
    UpdatedAt: '',
    UpdatedBy: ''
  });
  assert.equal(normalizeStaffMfaPolicy({ mode: 'unknown' }).Mode, 'OPTIONAL');
});

test('policy enforcement respects voluntary enrollment, selected roles and grace periods', () => {
  const now = Date.parse('2026-08-10T12:00:00.000Z');
  const optional = evaluateStaffMfaRequirement({ Mode: 'OPTIONAL' }, {}, 0, { role: 'Front Desk' }, now);
  assert.equal(optional.required, false);
  const enrolled = evaluateStaffMfaRequirement({ Mode: 'OPTIONAL' }, { TotpActive: true }, 0, { role: 'Front Desk' }, now);
  assert.equal(enrolled.required, true);
  assert.equal(enrolled.enrollmentRequired, false);

  const duringGrace = evaluateStaffMfaRequirement({
    Mode: 'REQUIRED_ROLES', RequiredRoles: ['Accounts Officer'], EnforceFrom: '2026-08-12T12:00:00.000Z'
  }, {}, 0, { role: 'Accounts Officer' }, now);
  assert.equal(duringGrace.required, false);
  assert.equal(duringGrace.policyRequired, true);
  assert.equal(duringGrace.dueAt, '2026-08-12T12:00:00.000Z');

  const enforced = evaluateStaffMfaRequirement({
    Mode: 'REQUIRED_ALL', EnforceFrom: '2026-08-09T12:00:00.000Z'
  }, {}, 0, { role: 'Front Desk' }, now);
  assert.equal(enforced.required, true);
  assert.equal(enforced.enrollmentRequired, true);
});

test('password sign-in is not authenticated until the pending MFA challenge succeeds', () => {
  assert.match(staffSessionApi, /authenticateStaff\(env, body\.username, body\.password, \{ recordLogin: false \}\)/);
  assert.match(staffSessionApi, /beginStaffMfaLogin\(env, passwordUser\)/);
  assert.match(staffSessionApi, /if \(mfa\.required\)[\s\S]*?return response\(\{ ok: true, \.\.\.mfa \}\)/);
  assert.ok(staffSessionApi.indexOf('if (mfa.required)') < staffSessionApi.indexOf('createStaffSession(env, user)'));
  assert.match(mfaApi, /action === 'verify-login'/);
  assert.match(mfaLibrary, /deleteDocumentIfCurrent\(env, CHALLENGE_COLLECTION, id, challenge\)/);
  assert.match(mfaLibrary, /MAX_CHALLENGE_ATTEMPTS = 5/);
});

test('MFA secrets and recovery credentials are protected at rest', () => {
  assert.match(mfaLibrary, /name: 'AES-GCM'/);
  assert.match(mfaLibrary, /additionalData: encoder\.encode\(lower\(username\)\)/);
  assert.match(mfaLibrary, /TotpCiphertext/);
  assert.match(mfaLibrary, /RecoveryCodeHashes/);
  assert.doesNotMatch(mfaLibrary, /TotpSecret\s*:/);
  assert.match(mfaLibrary, /tokenDocumentId\(ticket\)/);
  assert.match(mfaLibrary, /crypto\.subtle\.timingSafeEqual/);
  assert.match(mfaLibrary, /!actor\.viaTicket && !await verifyStaffApprovalPassword\(env, username, currentPassword\)/);
});

test('passkey MFA is account-bound and reuses the verified pending challenge', () => {
  assert.match(passkeyApi, /mfaTicket/);
  assert.match(passkeyApi, /pendingMfa \? 'mfa-authentication' : 'authentication'/);
  assert.match(passkeyApi, /MfaChallengeId/);
  assert.match(passkeyApi, /stored\.UsernameKey \|\| stored\.Username/);
  assert.match(passkeyApi, /completeStaffMfaPasskeyLogin\(env, mfaTicket, stored\.Username\)/);
});

test('staff and administrator interfaces expose complete two-factor controls', () => {
  assert.match(adminHtml, /id="staffMfaSettings"/);
  assert.match(adminHtml, /id="staffMfaLoginDialog"/);
  assert.match(adminHtml, /id="staffMfaDialog"/);
  assert.match(adminHtml, /Authenticator app/);
  assert.match(adminHtml, /Recovery code/);
  assert.match(adminJs, /save-policy/);
  assert.match(adminJs, /admin-reset/);
  assert.match(adminJs, /Save two-factor policy/);
  assert.match(adminJs, /Grace period \(days\)/);
  assert.match(styleCss, /staff-mfa-dialog::backdrop/);
  assert.match(styleCss, /staff-mfa-policy-settings/);
});

test('MFA routes are low-read identity paths, audited, and excluded from tenant backups', () => {
  assert.match(middleware, /'\/api\/staff-mfa'/);
  assert.match(securityAuditLibrary, /\['\/api\/staff-mfa', 'Identity & access'\]/);
  assert.match(backupLibrary, /'staffMfaChallenges'/);
  assert.match(backupLibrary, /'staffMfaProfiles'/);
  assert.match(backupLibrary, /'staffPasskeys'/);
});
