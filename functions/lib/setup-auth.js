import { secureTextEqual } from './backend-security.js';
import { readStaffSession } from './staff-auth.js';

const clean = (value) => String(value ?? '').trim();

export async function requireSetupAdministrator(env, request, password = '') {
  const expected = clean(env.ADMIN_WEB_PASSWORD);
  if (expected && secureTextEqual(password, expected)) {
    return {
      username: clean(env.ADMIN_WEB_USERNAME) || 'admin',
      displayName: clean(env.ADMIN_WEB_DISPLAY_NAME) || 'Setup Administrator',
      role: 'Super Admin',
      source: 'setup-password'
    };
  }
  const staff = await readStaffSession(env, request).catch(() => null);
  if (staff && clean(staff.role || staff.Role) === 'Super Admin') {
    return { ...staff, source: 'staff-session' };
  }
  if (!expected) {
    const error = new Error('Setup login is not configured. Add ADMIN_WEB_PASSWORD in Cloudflare.');
    error.status = 503;
    throw error;
  }
  const error = new Error('Invalid setup password or Super Administrator session.');
  error.status = 401;
  throw error;
}
