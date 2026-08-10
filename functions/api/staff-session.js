import {
  authenticateStaff,
  clearLegacyStaffSessionCookie,
  clearStaffApprovalProofCookie,
  clearStaffSessionCookie,
  createStaffSession,
  finalizeStaffAuthentication,
  findStaffUserRecord,
  readStaffSession,
  staffSessionCookie,
  staffAccessFor,
  staffUserForAccess,
  verifyStaffApprovalPassword
} from '../lib/staff-auth.js';
import { batchUpsertDocuments, getDocument, listCollection, requireFirestoreEnv, upsertDocument } from '../lib/firestore.js';
import { hashStaffPassword } from '../lib/staff-auth.js';
import {
  checkStaffLoginAllowed,
  clearStaffLoginFailures,
  recordStaffLoginFailure
} from '../lib/login-protection.js';
import { beginStaffMfaLogin } from '../lib/staff-mfa.js';
import { readJsonBody } from '../lib/request-security.js';

function response(data, status = 200, cookies = [], extraHeaders = {}) {
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  Object.entries(extraHeaders || {}).forEach(([key, value]) => headers.set(key, String(value)));
  const values = Array.isArray(cookies) ? cookies : [cookies];
  values.filter(Boolean).forEach((cookie) => headers.append('Set-Cookie', cookie));
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

function clean(value) {
  return String(value ?? '').trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function publicSessionError(error) {
  if (clean(error?.code) === 'FIRESTORE_QUOTA_EXHAUSTED'
    || clean(error?.upstreamCode).toUpperCase() === 'RESOURCE_EXHAUSTED'
    || /quota|resource exhausted/i.test(clean(error?.message))) {
    return 'The database temporarily refused this request because a resource limit was reached. This is not necessarily the daily read quota. Please try again shortly.';
  }
  return error?.message || String(error);
}

function safeStaffId(value) {
  return lower(value).replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
}

export function staffProfileImageIds(record = {}, user = {}) {
  return [...new Set([
    clean(record.__id),
    safeStaffId(record.Username),
    safeStaffId(record.LoginUsername),
    safeStaffId(user.username),
    safeStaffId(user.loginUsername)
  ].filter(Boolean))];
}

async function loadStaffProfileImage(env, record = {}, user = {}) {
  for (const profileId of staffProfileImageIds(record, user)) {
    const profileImage = await getDocument(env, 'staffProfileImages', profileId).catch(() => null);
    if (clean(profileImage?.ProfilePhotoDataUrl)) return profileImage;
  }
  return null;
}

function environmentAdminProfile(env, sessionUser) {
  const configuredUsername = clean(env.ADMIN_WEB_USERNAME || 'admin');
  if (sessionUser.role !== 'Super Admin' || lower(sessionUser.username) !== lower(configuredUsername)) return null;
  const createdAt = new Date().toISOString();
  return {
    __id: safeStaffId(configuredUsername),
    Username: configuredUsername,
    UsernameKey: lower(configuredUsername),
    LoginUsername: configuredUsername,
    LoginUsernameKey: lower(configuredUsername),
    DisplayName: clean(sessionUser.displayName || env.ADMIN_WEB_DISPLAY_NAME || 'Super Admin'),
    Role: 'Super Admin',
    Department: clean(sessionUser.department),
    BranchId: clean(sessionUser.branchId),
    SchoolSectionAccess: clean(sessionUser.schoolSectionAccess || 'All'),
    ApprovalEnabled: true,
    Active: true,
    MustChangePassword: false,
    CreatedAt: createdAt,
    CreatedBy: 'Cloudflare Environment Admin'
  };
}

function isActiveStaffRecord(record) {
  return !['no', 'false', '0', 'inactive', 'disabled'].includes(lower(record?.Active ?? true));
}

function authoritativeSessionUser(record, sessionUser, profilePhotoUrl = '') {
  const role = clean(record.Role || sessionUser.role) || 'Front Desk';
  const inferredDepartment = {
    'Tuck Shop User': 'Tuck Shop',
    'Clinic User': 'Clinic',
    'Kitchen User': 'Kitchen',
    'Store User': 'Organisation Store',
    'Restaurant User': 'Restaurant'
  }[role] || '';
  const list = (value) => Array.isArray(value)
    ? value.map(clean).filter(Boolean)
    : clean(value).split(',').map(clean).filter(Boolean);
  return {
    username: clean(record.Username || record.__id || sessionUser.username),
    loginUsername: clean(record.LoginUsername || sessionUser.loginUsername || record.Username || sessionUser.username),
    displayName: clean(record.DisplayName || sessionUser.displayName || record.Username || sessionUser.username),
    profilePhotoUrl: clean(profilePhotoUrl || record.ProfilePhotoDataUrl || sessionUser.profilePhotoUrl),
    role,
    department: clean(record.Department || sessionUser.department || inferredDepartment),
    branchId: clean(record.BranchId || sessionUser.branchId),
    schoolSectionAccess: clean(record.SchoolSectionAccess || sessionUser.schoolSectionAccess) || 'All',
    approvalEnabled: !['no', 'false', '0', ''].includes(lower(record.ApprovalEnabled ?? sessionUser.approvalEnabled ?? false)),
    approvalMaxAmount: Number(record.ApprovalMaxAmount || sessionUser.approvalMaxAmount || 0) || 0,
    approvalAccounts: list(record.ApprovalAccounts ?? sessionUser.approvalAccounts),
    biometricLookupEnabled: !['no', 'false', '0', ''].includes(
      lower(record.BiometricLookupEnabled ?? sessionUser.biometricLookupEnabled ?? false)
    ),
    tabAccess: list(record.TabAccess ?? sessionUser.tabAccess),
    mustChangePassword: record.MustChangePassword === undefined
      ? Boolean(sessionUser.mustChangePassword)
      : !['no', 'false', '0'].includes(lower(record.MustChangePassword))
  };
}

export async function onRequestGet(context) {
  try {
    const sessionUser = await readStaffSession(context.env, context.request);
    if (!sessionUser) {
      return response({ ok: true, authenticated: false, user: null });
    }
    const stored = await findStaffUserRecord(context.env, sessionUser.username);
    const authoritativeRecord = stored || environmentAdminProfile(context.env, sessionUser);
    if (!authoritativeRecord || !isActiveStaffRecord(authoritativeRecord)) {
      const error = new Error('This staff account has been disabled or deleted.');
      error.status = 401;
      throw error;
    }
    const profileImage = await loadStaffProfileImage(context.env, authoritativeRecord, sessionUser);
    const user = authoritativeSessionUser(
      authoritativeRecord,
      sessionUser,
      profileImage?.ProfilePhotoDataUrl
    );
    const access = user ? await staffAccessFor(context.env, user) : null;
    return response({
      ok: true,
      authenticated: Boolean(user),
      user: user ? staffUserForAccess(user, access) : null
    });
  } catch (err) {
    const status = err.status || 500;
    const cookies = status === 401
      ? [clearStaffSessionCookie(), clearLegacyStaffSessionCookie(), clearStaffApprovalProofCookie()]
      : [];
    return response({ ok: false, authenticated: false, message: publicSessionError(err) }, status, cookies);
  }
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await readJsonBody(request, { maxBytes: 512 * 1024 });
    const action = String(body.action || body.Action || 'login').trim().toLowerCase();
    if (action === 'logout') {
      return response(
        { ok: true, authenticated: false, message: 'Signed out. You can sign in again at any time.' },
        200,
        [clearStaffSessionCookie(), clearLegacyStaffSessionCookie(), clearStaffApprovalProofCookie()]
      );
    }
    requireFirestoreEnv(env);
    if (action === 'updateprofile') {
      const sessionUser = await readStaffSession(env, request);
      if (!sessionUser) return response({ ok: false, message: 'Your staff session has expired.' }, 401);
      const existing = await findStaffUserRecord(env, sessionUser.username).catch(() => null)
        || environmentAdminProfile(env, sessionUser);
      if (!existing) return response({ ok: false, message: 'The database staff account was not found.' }, 404);
      if (['no', 'false', '0', 'inactive', 'disabled'].includes(String(existing.Active ?? 'YES').trim().toLowerCase())) {
        return response(
          { ok: false, message: 'This staff account has been disabled.' },
          401,
          [clearStaffSessionCookie(), clearLegacyStaffSessionCookie()]
        );
      }
      const displayName = String(body.displayName || '').trim();
      if (!displayName) return response({ ok: false, message: 'Display name is required.' }, 400);
      const updatedAt = new Date().toISOString();
      const photo = profilePhoto(body.profilePhotoDataUrl);
      const staffDocumentId = clean(existing.__id || safeStaffId(existing.Username || sessionUser.username));
      if (!staffDocumentId) return response({ ok: false, message: 'The staff profile identifier is invalid.' }, 400);
      const updated = {
        ...existing,
        DisplayName: displayName,
        ProfilePhotoDataUrl: '',
        UpdatedAt: updatedAt,
        UpdatedBy: sessionUser.username
      };
      delete updated.__id;
      delete updated.__name;
      await batchUpsertDocuments(env, [
        {
          collectionPath: 'staffUsers',
          documentId: staffDocumentId,
          data: updated
        },
        {
          collectionPath: 'staffProfileImages',
          documentId: staffDocumentId,
          data: {
            Username: clean(existing.Username || sessionUser.username),
            ProfilePhotoDataUrl: photo,
            UpdatedAt: updatedAt
          }
        }
      ]);
      const refreshedUser = {
        ...sessionUser,
        displayName,
        profilePhotoUrl: photo,
        mustChangePassword: Boolean(sessionUser.mustChangePassword)
      };
      const refreshedToken = await createStaffSession(env, refreshedUser);
      const access = await staffAccessFor(env, refreshedUser);
      return response({
        ok: true,
        authenticated: true,
        message: 'Profile updated.',
        user: staffUserForAccess(refreshedUser, access)
      }, 200, staffSessionCookie(refreshedToken));
    }
    if (action === 'changepassword') {
      const sessionUser = await readStaffSession(env, request);
      if (!sessionUser) return response({ ok: false, message: 'Your staff session has expired.' }, 401);
      if (!sessionUser.mustChangePassword) {
        return response({ ok: false, message: 'Use Edit Profile to change your login details.' }, 403);
      }
      const password = String(body.password || '');
      if (password !== String(body.confirmPassword || '')) return response({ ok: false, message: 'Passwords do not match.' }, 400);
      if (password.length < 6) return response({ ok: false, message: 'Password must contain at least 6 characters.' }, 400);
      const existing = await findStaffUserRecord(env, sessionUser.username).catch(() => null)
        || environmentAdminProfile(env, sessionUser);
      if (!existing) return response({ ok: false, message: 'The database staff account was not found.' }, 404);
      if (['no', 'false', '0', 'inactive', 'disabled'].includes(String(existing.Active ?? 'YES').trim().toLowerCase())) {
        return response(
          { ok: false, message: 'This staff account has been disabled.' },
          401,
          [clearStaffSessionCookie(), clearLegacyStaffSessionCookie()]
        );
      }
      const passwordFields = await hashStaffPassword(password);
      const profileImage = await loadStaffProfileImage(env, existing, sessionUser);
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
        loginUsername: String(existing.LoginUsername || existing.Username || existing.__id || sessionUser.username).trim(),
        displayName: String(existing.DisplayName || existing.Username || sessionUser.displayName).trim(),
        profilePhotoUrl: String(profileImage?.ProfilePhotoDataUrl || existing.ProfilePhotoDataUrl || sessionUser.profilePhotoUrl || '').trim(),
        role: String(existing.Role || sessionUser.role || 'Front Desk').trim(),
        department: String(existing.Department || sessionUser.department || '').trim(),
        branchId: String(existing.BranchId || sessionUser.branchId || '').trim(),
        schoolSectionAccess: String(existing.SchoolSectionAccess || sessionUser.schoolSectionAccess || 'All').trim(),
        mustChangePassword: false
      };
      const refreshedToken = await createStaffSession(env, refreshedUser);
      const access = await staffAccessFor(env, refreshedUser);
      return response(
        { ok: true, authenticated: true, message: 'Password changed successfully.', user: staffUserForAccess(refreshedUser, access) },
        200,
        staffSessionCookie(refreshedToken)
      );
    }
    if (action === 'updatelogindetails') {
      const sessionUser = await readStaffSession(env, request);
      if (!sessionUser) return response({ ok: false, message: 'Your staff session has expired.' }, 401);
      const existing = await findStaffUserRecord(env, sessionUser.username).catch(() => null)
        || environmentAdminProfile(env, sessionUser);
      if (!existing) return response({ ok: false, message: 'The database staff account was not found.' }, 404);
      if (!isActiveStaffRecord(existing)) {
        return response(
          { ok: false, message: 'This staff account has been disabled.' },
          401,
          [clearStaffSessionCookie(), clearLegacyStaffSessionCookie(), clearStaffApprovalProofCookie()]
        );
      }
      const currentPassword = String(body.currentPassword || '');
      if (!currentPassword || !(await verifyStaffApprovalPassword(env, sessionUser.username, currentPassword))) {
        return response({ ok: false, message: 'The current password is incorrect.' }, 401);
      }
      const loginUsername = clean(body.loginUsername);
      if (!/^[a-z0-9][a-z0-9._@-]{2,79}$/i.test(loginUsername)) {
        return response({
          ok: false,
          message: 'Login username must be 3 to 80 characters and use only letters, numbers, dots, underscores, @ or hyphens.'
        }, 400);
      }
      const users = await listCollection(env, 'staffUsers');
      const existingId = lower(existing.__id);
      const conflict = users.find((row) =>
        lower(row.__id) !== existingId &&
        [row.LoginUsernameKey, row.LoginUsername, row.Username, row.__id]
          .some((value) => lower(value) === lower(loginUsername)));
      if (conflict) return response({ ok: false, message: 'That login username is already in use.' }, 409);

      const newPassword = String(body.newPassword || '');
      const confirmPassword = String(body.confirmPassword || '');
      if (newPassword !== confirmPassword) return response({ ok: false, message: 'New passwords do not match.' }, 400);
      if (newPassword && newPassword.length < 6) {
        return response({ ok: false, message: 'New password must contain at least 6 characters.' }, 400);
      }
      const passwordFields = newPassword ? await hashStaffPassword(newPassword) : {};
      const changedAt = new Date().toISOString();
      const canonicalUsername = clean(existing.Username || existing.__id || sessionUser.username);
      const priorLoginUsername = clean(existing.LoginUsername || canonicalUsername);
      const updated = {
        ...existing,
        LoginUsername: loginUsername,
        LoginUsernameKey: lower(loginUsername),
        ...passwordFields,
        ...(newPassword ? { MustChangePassword: false, PasswordChangedAt: changedAt } : {}),
        LoginUsernameChangedAt: lower(priorLoginUsername) === lower(loginUsername)
          ? clean(existing.LoginUsernameChangedAt)
          : changedAt,
        UpdatedAt: changedAt,
        UpdatedBy: sessionUser.displayName || sessionUser.username
      };
      delete updated.__id;
      delete updated.__name;
      const auditId = `STAFF-LOGIN-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
      await batchUpsertDocuments(env, [
        {
          collectionPath: 'staffUsers',
          documentId: existing.__id,
          data: updated
        },
        {
          collectionPath: 'staffSecurityAudit',
          documentId: auditId,
          data: {
            AuditId: auditId,
            Timestamp: changedAt,
            Action: 'UPDATE OWN LOGIN DETAILS',
            Username: canonicalUsername,
            Actor: sessionUser.displayName || sessionUser.username,
            ActorUsername: sessionUser.username,
            SourcePlatform: 'Web',
            Details: [
              lower(priorLoginUsername) === lower(loginUsername) ? '' : 'Login username changed',
              newPassword ? 'Password changed' : ''
            ].filter(Boolean).join(' | ') || 'Login details confirmed'
          }
        }
      ]);
      const profileImage = await loadStaffProfileImage(env, existing, sessionUser);
      const refreshedUser = authoritativeSessionUser(
        updated,
        { ...sessionUser, loginUsername, mustChangePassword: false },
        profileImage?.ProfilePhotoDataUrl
      );
      const refreshedToken = await createStaffSession(env, refreshedUser);
      const access = await staffAccessFor(env, refreshedUser);
      return response({
        ok: true,
        authenticated: true,
        message: newPassword
          ? 'Login username and password updated successfully.'
          : 'Login username updated successfully.',
        user: staffUserForAccess(refreshedUser, access)
      }, 200, staffSessionCookie(refreshedToken));
    }
    const attempt = await checkStaffLoginAllowed(env, body.username, request);
    if (!attempt.allowed) {
      return response(
        { ok: false, message: 'Too many sign-in attempts. Please wait and try again.' },
        429,
        [],
        { 'Retry-After': attempt.retryAfter }
      );
    }
    const passwordUser = await authenticateStaff(env, body.username, body.password, { recordLogin: false });
    if (!passwordUser) {
      const failure = await recordStaffLoginFailure(env, body.username, request, attempt);
      if (failure.locked) {
        return response(
          { ok: false, message: 'Too many sign-in attempts. Please wait and try again.' },
          429,
          [],
          { 'Retry-After': failure.retryAfter }
        );
      }
      return response({ ok: false, message: 'Invalid username/password or inactive account.' }, 401);
    }
    await clearStaffLoginFailures(env, body.username, request, attempt);
    const mfa = await beginStaffMfaLogin(env, passwordUser);
    if (mfa.required) {
      return response({ ok: true, ...mfa });
    }
    const user = await finalizeStaffAuthentication(env, passwordUser.username, 'Web Password');
    if (!user) return response({ ok: false, message: 'This staff account is inactive or no longer exists.' }, 401);
    const staffRecord = await findStaffUserRecord(env, user.username).catch(() => null);
    const profileImage = await loadStaffProfileImage(env, staffRecord || {}, user);
    if (profileImage?.ProfilePhotoDataUrl) user.profilePhotoUrl = clean(profileImage.ProfilePhotoDataUrl);
    const token = await createStaffSession(env, user);
    const access = await staffAccessFor(env, user);
    return response({
      ok: true,
      authenticated: true,
      message: 'Signed in.',
      mfaEnrollmentDueAt: clean(mfa.requirement?.dueAt),
      sessionToken: token,
      user: staffUserForAccess(user, access)
    }, 200, staffSessionCookie(token));
  } catch (err) {
    return response({ ok: false, message: publicSessionError(err) }, err.status || 500);
  }
}
