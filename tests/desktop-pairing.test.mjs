import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  desktopCredentialHash,
  normalizeDesktopPairingCode,
  parseDesktopDeviceCredential,
  parseDesktopPairingCode,
  secureDesktopHashEqual
} from '../functions/lib/desktop-pairing.js';

const portalRoot = new URL('../', import.meta.url);

test('pairing and device credentials use separate strict formats', () => {
  const code = 'DXP-ABCD234567-JKLMNPQRSTUVWX23456789AB';
  assert.equal(normalizeDesktopPairingCode(`  ${code.toLowerCase()}  `), code);
  assert.deepEqual(parseDesktopPairingCode(code), { code, pairingId: 'abcd234567' });
  assert.equal(parseDesktopPairingCode('DXP-too-short'), null);
  assert.deepEqual(
    parseDesktopDeviceCredential('DXD.abcdefghijklmnop.ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef'),
    {
      credential: 'DXD.abcdefghijklmnop.ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef',
      deviceId: 'abcdefghijklmnop'
    }
  );
  assert.equal(parseDesktopDeviceCredential(code), null);
});

test('credential hashes compare without persisting the raw credential', async () => {
  const hash = await desktopCredentialHash('DXD.device.secret');
  assert.equal(hash.length, 64);
  assert.equal(await secureDesktopHashEqual(hash, await desktopCredentialHash('DXD.device.secret')), true);
  assert.equal(await secureDesktopHashEqual(hash, await desktopCredentialHash('DXD.device.other')), false);
});

test('pairing endpoint is organisation-admin controlled, one-time and plan independent', async () => {
  const [api, library] = await Promise.all([
    readFile(new URL('functions/api/desktop-pairing.js', portalRoot), 'utf8'),
    readFile(new URL('functions/lib/desktop-pairing.js', portalRoot), 'utf8')
  ]);
  assert.match(api, /requireStaffSession\(env, request\)/);
  assert.match(api, /organisationWideSuperAdmin/);
  assert.match(api, /consumeRequestAllowance/);
  assert.doesNotMatch(api, /subscriptionPlan|featureEntitlement|Starter|Enterprise/);
  assert.match(library, /Status: 'Used'/);
  assert.match(library, /expiresAtMs <= Date\.now\(\)/);
  assert.match(library, /CredentialHash: await desktopCredentialHash\(credential\)/);
  assert.doesNotMatch(library, /Credential:\s*credential/);
});

test('backend accepts revocable device credentials while retaining legacy migration support', async () => {
  const [backend, security] = await Promise.all([
    readFile(new URL('functions/api/backend.js', portalRoot), 'utf8'),
    readFile(new URL('functions/lib/backend-security.js', portalRoot), 'utf8')
  ]);
  assert.match(backend, /await requireBackendSecret\(env, body\)/);
  assert.match(backend, /verifyDesktopSecret\(env, supplied, 'desktop backend'\)/);
  assert.match(security, /verifyDesktopDeviceCredential\(env, credential\)/);
  assert.match(security, /has been revoked/);
});

test('desktop document bridges accept device credentials instead of requiring the Cloudflare secret', async () => {
  const sources = await Promise.all([
    readFile(new URL('functions/api/passport-photo.js', portalRoot), 'utf8'),
    readFile(new URL('functions/api/staff-document.js', portalRoot), 'utf8'),
    readFile(new URL('functions/api/import-firestore.js', portalRoot), 'utf8')
  ]);
  sources.forEach((source) => assert.match(source, /verifyDesktopCredential/));
  assert.doesNotMatch(sources[0], /suppliedSecret === clean\(env\.BACKEND_SHARED_SECRET\)/);
  assert.doesNotMatch(sources[1], /clean\(body\.Secret \|\| body\.secret\) === clean\(env\.BACKEND_SHARED_SECRET\)/);
});

test('web companion exposes pairing and device revocation to organisation administrators', async () => {
  const [html, javascript] = await Promise.all([
    readFile(new URL('admin.html', portalRoot), 'utf8'),
    readFile(new URL('js/admin.js', portalRoot), 'utf8')
  ]);
  assert.match(html, /id="staffDesktopSetup"/);
  assert.match(html, /Generate one-time pairing code/);
  assert.match(javascript, /desktopSetupButton\.hidden = !canManageOrganisationSettings\(user\)/);
  assert.match(javascript, /desktopPairingRequest\('revoke'/);
});
