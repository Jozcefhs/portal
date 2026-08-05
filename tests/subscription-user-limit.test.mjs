import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  activeSeatDelta,
  activeStaffAccountCount,
  assertSubscriptionSeatAvailable,
  staffAccountIsActive
} from '../functions/lib/subscription-user-limit.js';

test('staff account activity accepts legacy boolean and text values', () => {
  assert.equal(staffAccountIsActive({}), true);
  assert.equal(staffAccountIsActive({ Active: true }), true);
  assert.equal(staffAccountIsActive({ Active: 'YES' }), true);
  assert.equal(staffAccountIsActive({ Active: false }), false);
  assert.equal(staffAccountIsActive({ Active: 'disabled' }), false);
});

test('only a new activation consumes a subscription seat', () => {
  assert.equal(activeSeatDelta(null, true), 1);
  assert.equal(activeSeatDelta({ Active: false }, true), 1);
  assert.equal(activeSeatDelta({ Active: true }, true), 0);
  assert.equal(activeSeatDelta({ Active: true }, false), -1);
});

test('the limit blocks both new users and reactivation at capacity', () => {
  const rows = Array.from({ length: 5 }, (_value, index) => ({ Username: `user-${index}`, Active: true }));
  assert.equal(activeStaffAccountCount(rows), 5);
  assert.throws(
    () => assertSubscriptionSeatAvailable(rows, null, true, 5),
    (error) => error.status === 409 && error.code === 'SUBSCRIPTION_USER_LIMIT'
  );
  assert.throws(
    () => assertSubscriptionSeatAvailable(rows, { Username: 'inactive', Active: false }, true, 5),
    (error) => error.status === 409 && error.code === 'SUBSCRIPTION_USER_LIMIT'
  );
});

test('editing an active user and saving inactive users remain allowed at capacity', () => {
  const rows = Array.from({ length: 5 }, (_value, index) => ({ Username: `user-${index}`, Active: true }));
  assert.doesNotThrow(() => assertSubscriptionSeatAvailable(rows, rows[0], true, 5));
  assert.doesNotThrow(() => assertSubscriptionSeatAvailable(rows, null, false, 5));
});

test('all staff write endpoints use the authoritative subscription guard', async () => {
  const [webSource, desktopSource] = await Promise.all([
    readFile(new URL('../functions/api/staff-users.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8')
  ]);
  assert.match(webSource, /await enforceSubscriptionUserLimit\(env, rows, existing, active\)/);
  assert.match(webSource, /const seatDelta = activeSeatDelta\(existing, requestedActive\)/);
  assert.match(desktopSource, /await enforceSubscriptionUserLimit\(env, users, existing, active\)/);
});
