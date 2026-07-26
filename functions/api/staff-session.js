import {
  authenticateStaff,
  clearStaffSessionCookie,
  createStaffSession,
  readStaffSession,
  staffSessionCookie,
  staffAccessFor
} from '../lib/staff-auth.js';
import { listCollection, requireFirestoreEnv, upsertDocument } from '../lib/firestore.js';
import { hashStaffPassword } from '../lib/staff-auth.js';

function response(data, status = 200, cookie = '') {
  const headers = { 'Cache-Control': 'no-store' };
  if (cookie) headers['Set-Cookie'] = cookie;
  return Response.json(data, { status, headers });
}

function profilePhoto(value) {
  const photo = String(value || '').trim();
  if (!photo) return '';
  if (photo.length > 350000 || !/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=\s]+$/i.test(photo)) {
    const err = new Error('Choose a valid PNG, JPG or WebP profile picture.');
    err.status = 400;
    throw err;
  }
  return photo;
}

export async function onRequestGet(context) {
  try {
    const sessionUser = await readStaffSession(context.env, context.request);
    let user = sessionUser;
    if (sessionUser) {
      const users = await listCollection(context.env, 'staffUsers').catch(() => []);
      const stored = users.find((row) => String(row.Username || row.__id || '').trim().toLowerCase() === sessionUser.username.toLowerCase());
      if (stored) {
        user = {
          ...sessionUser,
          displayName: String(stored.DisplayName || sessionUser.displayName || sessionUser.username).trim(),
          profilePhotoUrl: String(stored.ProfilePhotoDataUrl || '').trim()
        };
      }
    }
    const access = user ? await staffAccessFor(context.env, user) : null;
    return response({
      ok: true,
      authenticated: Boolean(user),
      user: user ? { ...user, ...access } : null
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
    if (action === 'updateprofile') {
      const sessionUser = await readStaffSession(env, request);
      if (!sessionUser) return response({ ok: false, message: 'Your staff session has expired.' }, 401);
      const users = await listCollection(env, 'staffUsers');
      const existing = users.find((row) => String(row.Username || row.__id || '').trim().toLowerCase() === sessionUser.username.toLowerCase());
      if (!existing) return response({ ok: false, message: 'The Firestore staff account was not found.' }, 404);
      if (['no', 'false', '0', 'inactive', 'disabled'].includes(String(existing.Active ?? 'YES').trim().toLowerCase())) {
        return response({ ok: false, message: 'This staff account has been disabled.' }, 401, clearStaffSessionCookie());
      }
      const displayName = String(body.displayName || '').trim();
      if (!displayName) return response({ ok: false, message: 'Display name is required.' }, 400);
      const updatedAt = new Date().toISOString();
      const updated = {
        ...existing,
        DisplayName: displayName,
        ProfilePhotoDataUrl: profilePhoto(body.profilePhotoDataUrl),
        UpdatedAt: updatedAt,
        UpdatedBy: sessionUser.username
      };
      delete updated.__id;
      delete updated.__name;
      await upsertDocument(env, 'staffUsers', existing.__id, updated);
      const refreshedUser = {
        ...sessionUser,
        displayName,
        profilePhotoUrl: updated.ProfilePhotoDataUrl,
        mustChangePassword: Boolean(sessionUser.mustChangePassword)
      };
      const refreshedToken = await createStaffSession(env, refreshedUser);
      const access = await staffAccessFor(env, refreshedUser);
      return response({
        ok: true,
        authenticated: true,
        message: 'Profile updated.',
        user: { ...refreshedUser, ...access }
      }, 200, staffSessionCookie(refreshedToken));
    }
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
        profilePhotoUrl: String(existing.ProfilePhotoDataUrl || sessionUser.profilePhotoUrl || '').trim(),
        role: String(existing.Role || sessionUser.role || 'Front Desk').trim(),
        department: String(existing.Department || sessionUser.department || '').trim(),
        branchId: String(existing.BranchId || sessionUser.branchId || '').trim(),
        schoolSectionAccess: String(existing.SchoolSectionAccess || sessionUser.schoolSectionAccess || 'All').trim(),
        mustChangePassword: false
      };
      const refreshedToken = await createStaffSession(env, refreshedUser);
      const access = await staffAccessFor(env, refreshedUser);
      return response({ ok: true, authenticated: true, message: 'Password changed successfully.', user: { ...refreshedUser, ...access } }, 200, staffSessionCookie(refreshedToken));
    }
    const user = await authenticateStaff(env, body.username, body.password);
    if (!user) return response({ ok: false, message: 'Invalid username/password or inactive account.' }, 401);
    const token = await createStaffSession(env, user);
    const access = await staffAccessFor(env, user);
    return response({
      ok: true,
      authenticated: true,
      message: 'Signed in.',
      user: { ...user, ...access }
    }, 200, staffSessionCookie(token));
  } catch (err) {
    return response({ ok: false, message: err.message || String(err) }, err.status || 500);
  }
}
