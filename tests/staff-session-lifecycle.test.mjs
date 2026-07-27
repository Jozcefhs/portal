import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { onRequestPost } from '../functions/api/staff-session.js';
import { createStaffSession, readStaffSession, staffSessionCookie } from '../functions/lib/staff-auth.js';

const adminHtml = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const adminJs = fs.readFileSync(new URL('../js/admin.js', import.meta.url), 'utf8');
const serviceWorker = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

const env = { STAFF_SESSION_SECRET: 'test-only-session-secret-with-sufficient-length' };
const user = {
  username: 'staff.user',
  displayName: 'Staff User',
  role: 'Front Desk',
  department: 'Administration'
};

test('logout clears staff and approval cookies without requiring database access', async () => {
  const request = new Request('https://portal.example/api/staff-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'logout' })
  });
  const response = await onRequestPost({ request, env: {} });
  const cookies = response.headers.get('set-cookie') || '';
  assert.equal(response.status, 200);
  assert.match(cookies, /__Host-digc_staff_session=;/);
  assert.match(cookies, /school_staff_session=;/);
  assert.match(cookies, /staff_approval_proof=;/);
  assert.match(cookies, /Max-Age=0/);
});

test('a fresh staff session can replace the signed-out session', async () => {
  const token = await createStaffSession(env, user);
  const cookie = staffSessionCookie(token).split(';', 1)[0];
  const request = new Request('https://portal.example/api/staff-session', {
    headers: { Cookie: cookie }
  });
  const restored = await readStaffSession(env, request);
  assert.equal(restored?.username, user.username);
  assert.equal(restored?.displayName, user.displayName);
});

test('new sessions use an unambiguous host-only cookie while legacy sessions remain readable', async () => {
  const token = await createStaffSession(env, user);
  const cookie = staffSessionCookie(token);
  assert.match(cookie, /^__Host-digc_staff_session=/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);

  const legacyRequest = new Request('https://portal.example/api/staff-session', {
    headers: { Cookie: `school_staff_session=${token}` }
  });
  assert.equal((await readStaffSession(env, legacyRequest))?.username, user.username);
});

test('authenticated API responses are never handled by the offline cache', () => {
  assert.match(serviceWorker, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(serviceWorker, /if \(event\.request\.method !== 'GET' \|\| url\.pathname\.startsWith\('\/api\/'\)\) return/);
});

test('staff-facing interface uses Database terminology', () => {
  assert.doesNotMatch(adminHtml, /Firestore/i);
  assert.doesNotMatch(adminJs, /Firestore/i);
  assert.match(adminHtml, /Both use the same database\./);
});
