import {
  authenticateStaff,
  clearStaffSessionCookie,
  createStaffSession,
  readStaffSession,
  staffSessionCookie,
  allowedSectionsFor
} from '../lib/staff-auth.js';
import { listCollection, requireFirestoreEnv, upsertDocument } from '../lib/firestore.js';
import { hashStaffPassword } from '../lib/staff-auth.js';

function response(data, status = 200, cookie = '') {
  const headers = { 'Cache-Control': 'no-store' };
  if (cookie) headers['Set-Cookie'] = cookie;
  return Response.json(data, { status, headers });
}

export async function onRequestGet(context) {
  try {
    const user = await readStaffSession(context.env, context.request);
    return response({
      ok: true,
      authenticated: Boolean(user),
      user: user ? { ...user, allowedSections: allowedSectionsFor(user) } : null
    });
  } catch (err) {
    return response({ ok: false, authenticated: false, message: err.message || String(err) }, err.status || 500);
  }
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || body.Action || 'login').trim().toLowerCase();
    if (action === 'logout') {
      return response({ ok: true, authenticated: false, message: 'Signed out.' }, 200, clearStaffSessionCookie());
    }
    requireFirestoreEnv(env);
    if (action === 'changepassword') {
      const sessionUser = await readStaffSession(env, request);
      if (!sessionUser) return response({ ok: false, message: 'Your staff session has expired.' }, 401);
      const password = String(body.password || '');
      if (password !== String(body.confirmPassword || '')) return response({ ok: false, message: 'Passwords do not match.' }, 400);
      const users = await listCollection(env, 'staffUsers');
      const existing = users.find((row) => String(row.Username || row.__id || '').trim().toLowerCase() === sessionUser.username.toLowerCase());
      if (!existing) return response({ ok: false, message: 'The Firestore staff account was not found.' }, 404);
      if (['no', 'false', '0', 'inactive', 'disabled'].includes(String(existing.Active ?? 'YES').trim().toLowerCase())) {
        return response({ ok: false, message: 'This staff account has been disabled.' }, 401, clearStaffSessionCookie());
      }
      const passwordFields = await hashStaffPassword(password);
      const updated = {
        ...existing,
        ...passwordFields,
        MustChangePassword: false,
        PasswordChangedAt: new Date().toISOString(),
        UpdatedAt: new Date().toISOString(),
        UpdatedBy: sessionUser.displayName || sessionUser.username
      };
      delete updated.__id;
      delete updated.__name;
      await upsertDocument(env, 'staffUsers', existing.__id, updated);
      const refreshedUser = {
        username: String(existing.Username || existing.__id || sessionUser.username).trim(),
        displayName: String(existing.DisplayName || existing.Username || sessionUser.displayName).trim(),
        role: String(existing.Role || sessionUser.role || 'Front Desk').trim(),
        department: String(existing.Department || sessionUser.department || '').trim(),
        branchId: String(existing.BranchId || sessionUser.branchId || '').trim(),
        schoolSectionAccess: String(existing.SchoolSectionAccess || sessionUser.schoolSectionAccess || 'All').trim(),
        mustChangePassword: false
      };
      const refreshedToken = await createStaffSession(env, refreshedUser);
      return response({ ok: true, authenticated: true, message: 'Password changed successfully.', user: { ...refreshedUser, allowedSections: allowedSectionsFor(refreshedUser) } }, 200, staffSessionCookie(refreshedToken));
    }
    const user = await authenticateStaff(env, body.username, body.password);
    if (!user) return response({ ok: false, message: 'Invalid username/password or inactive account.' }, 401);
    const token = await createStaffSession(env, user);
    return response({
      ok: true,
      authenticated: true,
      message: 'Signed in.',
      user: { ...user, allowedSections: allowedSectionsFor(user) }
    }, 200, staffSessionCookie(token));
  } catch (err) {
    return response({ ok: false, message: err.message || String(err) }, err.status || 500);
  }
}
