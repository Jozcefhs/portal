import { secureTextEqual } from './backend-security.js';

const clean = (value) => String(value ?? '').trim();

export function requirePlatformAdmin(env = {}, password = '') {
  const expected = clean(env.ADMIN_WEB_PASSWORD);
  if (!expected) {
    const error = new Error('Dynamax administration is not configured. Add ADMIN_WEB_PASSWORD in Cloudflare.');
    error.status = 503;
    throw error;
  }
  if (!secureTextEqual(password, expected)) {
    const error = new Error('Invalid administration password.');
    error.status = 401;
    throw error;
  }
}
