const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();

export function secureTextEqual(left, right) {
  const a = new TextEncoder().encode(clean(left));
  const b = new TextEncoder().encode(clean(right));
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index % (a.length || 1)] || 0) ^ (b[index % (b.length || 1)] || 0);
  }
  return difference === 0;
}

export function isActiveStaffUser(user) {
  if (!user) return false;
  if (user.Active === undefined) return true;
  return !['no', 'false', '0', 'inactive', 'disabled'].includes(lower(user.Active));
}

export function resolveAuthoritativeDesktopActor(body = {}, users = [], env = {}) {
  const username = clean(body.UserUsername || body.userUsername);
  if (!username) {
    const error = new Error('Your signed-in username is required for this protected action.');
    error.status = 401;
    error.code = 'BACKEND_ACTOR_REQUIRED';
    throw error;
  }
  const user = users.find((row) => lower(row.Username || row.username || row.__id) === lower(username));
  if (user && isActiveStaffUser(user)) {
    const authoritativeUsername = clean(user.Username || user.username || user.__id);
    return {
      username: authoritativeUsername,
      displayName: clean(user.DisplayName || user.displayName || authoritativeUsername),
      role: clean(user.Role || user.role) || 'Front Desk',
      department: clean(user.Department || user.department),
      source: 'staffUsers'
    };
  }
  const recoveryUsername = clean(env.ADMIN_WEB_USERNAME);
  if (recoveryUsername && lower(recoveryUsername) === lower(username)) {
    return {
      username: recoveryUsername,
      displayName: clean(env.ADMIN_WEB_DISPLAY_NAME || 'Super Admin'),
      role: 'Super Admin',
      department: '',
      source: 'environment-admin'
    };
  }
  const error = new Error(user ? 'This staff account is disabled.' : 'The signed-in staff account was not found in Firestore.');
  error.status = 403;
  error.code = user ? 'BACKEND_ACTOR_DISABLED' : 'BACKEND_ACTOR_NOT_FOUND';
  throw error;
}

export function applyAuthoritativeActor(body, actor) {
  return {
    ...body,
    UserUsername: actor.username,
    UserRole: actor.role,
    UserDepartment: actor.department,
    RecordedBy: actor.displayName
  };
}
