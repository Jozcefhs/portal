import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { featureFlagsForEdition } from '../functions/lib/organization-config.js';
import {
  hotelCapabilities,
  hotelReservationCanCheckIn,
  hotelReservationTotals,
  normalizeHotelReservation,
  normalizeHotelRoom
} from '../functions/lib/hotel-services.js';
import { defaultModulesForRole } from '../functions/lib/role-module-access.js';
import {
  SUBSCRIPTION_FLEX_PRICE_ESTIMATES_USD,
  normalizeSubscriptionPlanCatalog,
  subscriptionModulesForEdition
} from '../functions/lib/subscription-plans.js';

const adminJs = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const backendJs = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
const staffApi = await readFile(new URL('../functions/api/staff-hotel.js', import.meta.url), 'utf8');
const hotelService = await readFile(new URL('../functions/lib/hotel-services.js', import.meta.url), 'utf8');
const publicHotelApi = await readFile(new URL('../functions/api/public-hotel.js', import.meta.url), 'utf8');
const publicHotelPage = await readFile(new URL('../hotel-booking.html', import.meta.url), 'utf8');
const publicHotelJs = await readFile(new URL('../js/hotel-booking.js', import.meta.url), 'utf8');
const verifyPaymentApi = await readFile(new URL('../functions/api/verify-payment.js', import.meta.url), 'utf8');

test('Hotel Services is a Flex module for religious and other organisations', () => {
  for (const edition of ['faith', 'organization']) {
    const hotel = subscriptionModulesForEdition(edition).find((module) => module.Key === 'hotel');
    assert.ok(hotel, `${edition} should include Hotel Services`);
    assert.deepEqual(hotel.Requires, ['accounting']);
    assert.equal(hotel.SuggestedMonthlyAmountUSD, 6);
    assert.equal(hotel.SuggestedYearlyAmountUSD, 60);
    assert.equal(featureFlagsForEdition(edition).hotel, true);
  }
  assert.equal(subscriptionModulesForEdition('school').some((module) => module.Key === 'hotel'), false);
  assert.equal(SUBSCRIPTION_FLEX_PRICE_ESTIMATES_USD.hotel, 6);
});

test('existing plan-management catalogues are migrated to include Hotel Services', () => {
  const catalog = normalizeSubscriptionPlanCatalog({
    Currency: 'NGN',
    UsdToNgnRate: 1350,
    ModuleCatalogVersion: 7,
    Plans: {
      Professional: {
        EntitlementsByEdition: {
          faith: ['accounting', 'restaurant'],
          organization: ['accounting']
        }
      },
      Flex: {
        ModulePricesByEdition: { faith: {}, organization: {} }
      }
    }
  });
  assert.ok(catalog.Plans.Professional.EntitlementsByEdition.faith.includes('hotel'));
  assert.ok(catalog.Plans.Professional.EntitlementsByEdition.organization.includes('hotel'));
  assert.deepEqual(catalog.Plans.Flex.ModulePricesByEdition.faith.hotel, {
    MonthlyAmount: 8100,
    YearlyAmount: 81000
  });
  assert.deepEqual(catalog.Plans.Flex.ModulePricesByEdition.organization.hotel, {
    MonthlyAmount: 8100,
    YearlyAmount: 81000
  });
});

test('Hotel User and organisation administrators receive the hotel workspace by default', () => {
  assert.deepEqual(
    defaultModulesForRole('Hotel User', { edition: 'faith' }),
    ['hotel', 'financeRequests', 'payroll', 'humanResources', 'staffAttendance']
  );
  assert.equal(defaultModulesForRole('Church Administrator', { edition: 'faith' }).includes('hotel'), true);
  assert.equal(defaultModulesForRole('Organisation Administrator', { edition: 'organization' }).includes('hotel'), true);
  assert.equal(defaultModulesForRole('Front Desk', { edition: 'faith' }).includes('hotel'), true);
});

test('hotel role capabilities separate rooms, reservations and payments', () => {
  assert.equal(hotelCapabilities({ role: 'Hotel User' }).canManageRooms, true);
  assert.equal(hotelCapabilities({ role: 'Front Desk' }).canManageReservations, true);
  assert.equal(hotelCapabilities({ role: 'Front Desk' }).canManageRooms, false);
  assert.equal(hotelCapabilities({ role: 'Accounts Officer' }).canRecordPayments, true);
  assert.equal(hotelCapabilities({ role: 'Auditor' }).canViewAudit, true);
});

test('hotel room, stay and guest-account calculations are validated', () => {
  const room = normalizeHotelRoom({
    RoomId: 'ROOM-101', RoomNumber: '101', RoomType: 'Executive', Capacity: 3,
    NightlyRate: '45,000', Status: 'available', HousekeepingStatus: 'clean'
  }, 'main');
  assert.equal(room.NightlyRate, 45000);
  assert.equal(room.Status, 'Available');
  const stay = normalizeHotelReservation({
    ReservationId: 'RSV-1', GuestName: 'Ada Guest', RoomId: 'ROOM-101',
    ArrivalDate: '2026-09-10', DepartureDate: '2026-09-13', NightlyRate: 45000
  }, 'main');
  const totals = hotelReservationTotals(
    stay,
    [{ ReservationId: 'RSV-1', Amount: 5000 }],
    [{ ReservationId: 'RSV-1', Amount: 40000 }]
  );
  assert.equal(totals.Nights, 3);
  assert.equal(totals.TotalAmount, 140000);
  assert.equal(totals.Balance, 100000);
  assert.equal(hotelReservationCanCheckIn({ Status: 'Reserved', Balance: 100000 }), false);
  assert.equal(hotelReservationCanCheckIn({ Status: 'Reserved', Balance: 0 }), true);
  assert.equal(hotelReservationCanCheckIn({ Status: 'Checked In', Balance: 0 }), false);
  assert.throws(() => normalizeHotelReservation({
    ReservationId: 'RSV-2', GuestName: 'Invalid Stay', RoomId: 'ROOM-101',
    ArrivalDate: '2026-09-13', DepartureDate: '2026-09-13'
  }), /after the arrival/i);
});

test('web and desktop backend routes expose the full hotel workflow behind staff access', () => {
  assert.match(staffApi, /allowedSections[^\n]+includes\('hotel'\)/);
  assert.match(staffApi, /subscriptionReadOnly/);
  assert.match(adminJs, /\['hotel', 'Hotel Services'\]/);
  assert.match(adminJs, /loadHotelServices\(\)/);
  for (const action of [
    'getHotelServices', 'saveHotelRoom', 'saveHotelReservation',
    'changeHotelReservationStatus', 'recordHotelCharge', 'recordHotelPayment',
    'setHotelHousekeepingStatus'
  ]) assert.match(backendJs, new RegExp(`['"]${action}['"]`));
  assert.match(backendJs, /\['4140', 'Hotel Services Revenue'/);
  assert.match(hotelService, /Source: 'Hotel Services Payment'/);
  assert.match(hotelService, /AccountCode: '4140'/);
  assert.match(hotelService, /batchCommitDocuments/);
});

test('Hotel Services uses task tabs and blocks unpaid check-in in both UI and backend', () => {
  for (const label of [
    'Reservations & check-in', 'Rooms & housekeeping', 'Charges', 'Payments', 'Self-service QR'
  ]) assert.match(adminJs, new RegExp(label.replace(/[&]/g, '\\&')));
  assert.match(adminJs, /Payment required/);
  assert.match(hotelService, /Full payment is required before \$\{action\}/);
  assert.match(hotelService, /totals\.Balance > 0\.005/);
});

test('public hotel self-service uses a generic branch QR and server-priced Paystack checkout', () => {
  assert.match(staffApi, /buildHotelSelfServiceQr/);
  assert.match(hotelService, /hotel-booking\.html\?branch=\$\{encodeURIComponent\(branchId\)\}/);
  assert.match(hotelService, /NightlyRate: room\.NightlyRate/);
  assert.match(hotelService, /paymentType: 'HotelReservation'/);
  assert.match(hotelService, /PAYSTACK_INIT_URL/);
  assert.match(hotelService, /AccountCode: '6060'/);
  assert.match(hotelService, /Debit: netAmount/);
  assert.match(publicHotelApi, /verifyTurnstile/);
  assert.match(publicHotelApi, /hotel_booking/);
  assert.match(publicHotelApi, /consumeRequestAllowance/);
  assert.match(publicHotelPage, /hotelBookingForm/);
  assert.match(publicHotelPage, /hotelRoomChoices/);
  assert.match(publicHotelJs, /\/api\/public-hotel/);
  assert.match(publicHotelJs, /authorizationUrl/);
  assert.match(verifyPaymentApi, /finalizeHotelOnlinePayment/);
  assert.match(verifyPaymentApi, /hotelReservation/);
});
