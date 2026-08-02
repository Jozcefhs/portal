import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { onRequestPost as parentDashboardPost } from '../functions/api/parent-dashboard.js';
import {
  clearParentSessionCookie,
  createParentSession,
  hashParentPassword,
  parentSessionCookie,
  readParentSession,
  verifyParentPasswordHash
} from '../functions/lib/parent-auth.js';

const env = { PARENT_SESSION_SECRET: 'test-parent-session-secret-with-enough-entropy' };

test('parent passwords use a salted hash and remain case-sensitive', async () => {
  const credential = await hashParentPassword('FamilyPass9');
  assert.equal(credential.PasswordHashVersion, 'pbkdf2-sha256-v1');
  assert.equal(credential.PasswordIterations, 10000);
  assert.ok(credential.Salt.length >= 32);
  assert.equal(await verifyParentPasswordHash(credential, 'FamilyPass9'), true);
  assert.equal(await verifyParentPasswordHash(credential, 'FAMILYPASS9'), false);
  await assert.rejects(() => hashParentPassword('short'), /at least 8 characters/i);
});

test('parent session survives a new request without exposing a password', async () => {
  const token = await createParentSession(env, 'Parent@Example.com');
  const cookie = parentSessionCookie(token);
  assert.match(cookie, /__Host-digc_parent_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.doesNotMatch(token, /password|FamilyPass9/i);

  const request = new Request('https://school.example/api/parent-dashboard', {
    headers: { Cookie: cookie.split(';', 1)[0] }
  });
  assert.deepEqual(await readParentSession(env, request), { email: 'parent@example.com' });

  const [payload, signature] = token.split('.');
  const tampered = `${payload}.${signature[0] === 'a' ? 'b' : 'a'}${signature.slice(1)}`;
  const tamperedRequest = new Request(request.url, {
    headers: { Cookie: parentSessionCookie(tampered).split(';', 1)[0] }
  });
  assert.equal(await readParentSession(env, tamperedRequest), null);
});

test('parent sign out expires the persistent session cookie', async () => {
  const response = await parentDashboardPost({
    env: {},
    request: new Request('https://school.example/api/parent-dashboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'signOut' })
    })
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Set-Cookie') || '', /Max-Age=0/);
  assert.match(clearParentSessionCookie(), /Max-Age=0/);
});

test('parent portal uses browser password manager fields and never stores raw passwords in web storage', async () => {
  const [html, script, api, upload, passport, payment] = await Promise.all([
    readFile(new URL('../parent-dashboard.html', import.meta.url), 'utf8'),
    readFile(new URL('../js/parent-dashboard.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/parent-dashboard.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/upload-document.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/passport-photo.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/init-payment.js', import.meta.url), 'utf8')
  ]);
  assert.match(html, /id="parentEmail"[^>]*autocomplete="username"/);
  assert.match(html, /id="verificationCode"[^>]*type="password"[^>]*autocomplete="current-password"/);
  assert.match(html, /id="changeParentPasswordDialog"/);
  assert.match(html, /id="newParentPassword"[^>]*autocomplete="new-password"/);
  assert.match(script, /loadDashboard\(\{ sessionOnly: true, silent: true \}\)/);
  assert.match(script, /action: 'changeParentPassword'/);
  assert.match(script, /action: 'signOut'/);
  assert.doesNotMatch(script, /(?:localStorage|sessionStorage)\.setItem\([^\n]*(?:password|verificationCode)/i);
  assert.match(api, /parentSessionCookie/);
  assert.match(api, /saveParentPassword/);
  assert.match(upload, /readParentSession/);
  assert.match(passport, /readParentSession/);
  assert.match(payment, /readParentSession/);
});
