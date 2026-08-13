import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  activeSeatDelta,
  activeStaffAccountCount,
  assertSubscriptionSeatAvailable,
  staffAccountsForSubscription,
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

test('reactivation counts only active accounts in the subscriber organisation edition', () => {
  const rows = [
    { Username: 'faith-admin', OrganisationEdition: 'faith', Active: true },
    { Username: 'faith-two', OrganisationEdition: 'church', Active: 'YES' },
    { Username: 'faith-three', OrganisationEdition: 'religious', Active: true },
    { Username: 'faith-inactive', OrganisationEdition: 'faith', Active: false },
    { Username: 'school-one', OrganisationEdition: 'school', Active: true },
    { Username: 'school-two', Active: true }
  ];
  const faithRows = staffAccountsForSubscription(rows, 'faith', 'faith-admin');
  assert.equal(faithRows.length, 4);
  assert.equal(activeStaffAccountCount(faithRows), 3);
  assert.doesNotThrow(() => assertSubscriptionSeatAvailable(faithRows, faithRows[3], true, 5));
});

test('seat limits remain organisation-wide across branches within one edition', () => {
  const rows = [
    { Username: 'one', OrganisationEdition: 'faith', BranchId: 'main', Active: true },
    { Username: 'two', OrganisationEdition: 'faith', BranchId: 'branch-b', Active: true },
    { Username: 'three', OrganisationEdition: 'faith', BranchId: 'branch-c', Active: true },
    { Username: 'four', OrganisationEdition: 'faith', BranchId: 'main', Active: true },
    { Username: 'five', OrganisationEdition: 'faith', BranchId: 'branch-b', Active: true },
    { Username: 'inactive', OrganisationEdition: 'faith', BranchId: 'main', Active: false }
  ];
  const faithRows = staffAccountsForSubscription(rows, 'church', 'one');
  assert.throws(
    () => assertSubscriptionSeatAvailable(faithRows, faithRows[5], true, 5),
    (error) => error.status === 409 && /5 are currently active across this organisation/.test(error.message)
  );
});

test('all staff write endpoints use the authoritative subscription guard', async () => {
  const [webSource, desktopSource] = await Promise.all([
    readFile(new URL('../functions/api/staff-users.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8')
  ]);
  assert.match(webSource, /staffAccountsForSubscription\(rows, actor\.edition, actor\.username\)/);
  assert.match(webSource, /await enforceSubscriptionUserLimit\(env, subscriptionRows, existing, active\)/);
  assert.match(webSource, /const seatDelta = activeSeatDelta\(existing, requestedActive\)/);
  assert.match(desktopSource, /staffAccountsForSubscription\(users, edition, body\.UserUsername\)/);
  assert.match(desktopSource, /await enforceSubscriptionUserLimit\(env, subscriptionRows, existing, active\)/);
});

test('the staff account limit links administrators to the Dynamax plans', async () => {
  const [adminSource, registrationPage] = await Promise.all([
    readFile(new URL('../js/admin.js', import.meta.url), 'utf8'),
    readFile(new URL('../register-organization.html', import.meta.url), 'utf8')
  ]);
  assert.match(adminSource, /data-subscription-plans-link/);
  assert.match(adminSource, /href="register-organization\.html#plans"/);
  assert.match(adminSource, /subscription allows\|upgrade the plan/);
  assert.match(registrationPage, /id="plans"/);
});
