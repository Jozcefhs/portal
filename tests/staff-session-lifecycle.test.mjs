import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { onRequestGet, onRequestPost } from '../functions/api/staff-session.js';
import {
  createStaffApprovalProof,
  createStaffSession,
  readStaffSession,
  staffSessionCookie
} from '../functions/lib/staff-auth.js';

const adminHtml = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const adminJs = fs.readFileSync(new URL('../js/admin.js', import.meta.url), 'utf8');
const sessionApi = fs.readFileSync(new URL('../functions/api/staff-session.js', import.meta.url), 'utf8');
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

test('signed staff sessions may be presented as an explicit bearer fallback', async () => {
  const token = await createStaffSession(env, user);
  const request = new Request('https://portal.example/api/admin', {
    headers: {
      Authorization: `Bearer ${token}`,
      Cookie: '__Host-digc_staff_session=stale.invalid'
    }
  });
  const restored = await readStaffSession(env, request);
  assert.equal(restored?.username, user.username);
  assert.equal(restored?.role, user.role);

  const response = await onRequestGet({
    env,
    request: new Request('https://portal.example/api/staff-session', {
      headers: { Authorization: `Bearer ${token}` }
    })
  });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.authenticated, true);
  assert.equal(data.user.username, user.username);
});

test('password sign-in can use the same memory-only fallback when cookies are rejected', () => {
  assert.match(sessionApi, /sessionToken: token/);
  assert.match(adminJs, /confirmFreshStaffSession\(data\.user, clean\(data\.sessionToken\)\)/);
});

test('malformed or forged explicit bearer credentials fail closed', async () => {
  const token = await createStaffSession(env, user);
  const cookie = staffSessionCookie(token).split(';', 1)[0];
  for (const authorization of ['Bearer ~.~', 'Bearer e30.invalid', 'Basic invalid']) {
    const request = new Request('https://portal.example/api/admin', {
      headers: { Authorization: authorization, Cookie: cookie }
    });
    assert.equal(await readStaffSession(env, request), null);
  }
});

test('a scoped approval proof can never be confused for a staff bearer session', async () => {
  const approvalProof = await createStaffApprovalProof(env, user, {
    recordId: 'WEB-MAT-1',
    recordType: 'requisition',
    action: 'review:Approved'
  });
  const request = new Request('https://portal.example/api/admin', {
    headers: { Authorization: `Bearer ${approvalProof}` }
  });
  assert.equal(await readStaffSession(env, request), null);
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
