import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAuthoritativeActor,
  configuredDesktopSecret,
  isActiveStaffUser,
  requireConfiguredDesktopSecret,
  resolveAuthoritativeDesktopActor,
  secureTextEqual,
  verifyDesktopSecret
} from '../../functions/lib/backend-security.js';

test('shared-secret comparison accepts only an exact value', () => {
  assert.equal(secureTextEqual('school-secret', 'school-secret'), true);
  assert.equal(secureTextEqual('school-secret', 'school-secret-x'), false);
  assert.equal(secureTextEqual('', 'school-secret'), false);
});

test('desktop backend authentication fails closed when its secret is missing or invalid', () => {
  assert.equal(configuredDesktopSecret({ BACKEND_SHARED_SECRET: 'primary-secret' }), 'primary-secret');
  assert.equal(configuredDesktopSecret({ GOOGLE_APPS_SCRIPT_SECRET: 'retired-secret' }), '');
  assert.throws(
    () => requireConfiguredDesktopSecret({}),
    (error) => error?.status === 503 && error?.code === 'BACKEND_SECRET_NOT_CONFIGURED'
  );
  assert.throws(
    () => verifyDesktopSecret({ BACKEND_SHARED_SECRET: 'primary-secret' }, 'wrong-secret'),
    (error) => error?.status === 401 && error?.code === 'BACKEND_SECRET_INVALID'
  );
  assert.equal(
    verifyDesktopSecret({ BACKEND_SHARED_SECRET: 'primary-secret' }, 'primary-secret'),
    true
  );
});

test('authoritative staff record replaces client-supplied role and actor metadata', () => {
  const actor = resolveAuthoritativeDesktopActor(
    { UserUsername: 'ada', UserRole: 'Super Admin', RecordedBy: 'Forged' },
    [{ Username: 'Ada', DisplayName: 'Ada Okafor', Role: 'Accounts Officer', Department: 'Accounts', BranchId: 'main', Active: true }]
  );
  const body = applyAuthoritativeActor({ UserRole: 'Super Admin', RecordedBy: 'Forged' }, actor);
  assert.deepEqual(
    { username: body.UserUsername, role: body.UserRole, department: body.UserDepartment, branchId: body.UserBranchId, name: body.RecordedBy },
    { username: 'Ada', role: 'Accounts Officer', department: 'Accounts', branchId: 'main', name: 'Ada Okafor' }
  );
});

test('missing and disabled staff actors are rejected', () => {
  assert.throws(() => resolveAuthoritativeDesktopActor({ UserUsername: 'missing' }, []), /not found/i);
  assert.throws(
    () => resolveAuthoritativeDesktopActor({ UserUsername: 'disabled' }, [{ Username: 'disabled', Active: 'NO' }]),
    /disabled/i
  );
  assert.equal(isActiveStaffUser({ Active: 'YES' }), true);
  assert.equal(isActiveStaffUser({ Active: 'disabled' }), false);
});

test('configured environment administrator remains an explicit recovery identity', () => {
  const actor = resolveAuthoritativeDesktopActor(
    { UserUsername: 'recovery-admin', UserRole: 'Front Desk' },
    [],
    { ADMIN_WEB_USERNAME: 'recovery-admin', ADMIN_WEB_DISPLAY_NAME: 'Recovery Administrator' }
  );
  assert.equal(actor.role, 'Super Admin');
  assert.equal(actor.source, 'environment-admin');
});
