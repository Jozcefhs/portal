import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../functions/lib/hotel-services.js', import.meta.url), 'utf8');

// Execute the actual service handlers with an isolated in-memory database.
// No credentials, network requests or production records are used by these tests.
function hotelHarness() {
  const documents = new Map();
  const clone = (value) => value == null ? value : structuredClone(value);
  const key = (collection, id) => `${collection}/${id}`;
  const context = {
    crypto: globalThis.crypto,
    getDocument: async (_env, collection, id) => clone(documents.get(key(collection, id)) || null),
    upsertDocument: async (_env, collection, id, data) => {
      documents.set(key(collection, id), clone(data));
      return clone(data);
    },
    queryCollection: async (_env, collection, { filters = [], limit = 1000 } = {}) => {
      return [...documents.entries()]
        .filter(([path]) => path.startsWith(`${collection}/`))
        .map(([, row]) => row)
        .filter((row) => filters.every(({ field, op, value }) => {
          assert.equal(op, '==');
          return row[field] === value;
        }))
        .slice(0, limit).map(clone);
    },
    resolveOrganizationConfig: () => ({ Edition: 'faith', FeatureFlags: { hotel: true } }),
    normalizeOrganizationEdition: (value) => value,
    fetch: () => { throw new Error('Unexpected network request in hotel workflow test'); }
  };
  vm.createContext(context);
  const executable = source.replace(/^import[\s\S]*?from '[^']+';\r?\n/gm, '').replace(/^export /gm, '');
  vm.runInContext(executable, context, { filename: 'hotel-services.js' });
  for (const id of ['101', '102', '103']) {
    documents.set(key('hotelRooms', id), {
      RoomId: id, RoomNumber: id, BranchId: 'main', Status: 'Available',
      HousekeepingStatus: 'Clean', Capacity: 2, NightlyRate: 0
    });
  }
  const user = { role: 'Super Admin', branchId: 'main', displayName: 'Test manager' };
  return {
    api: context,
    documents,
    user,
    room: (id = '101') => clone(documents.get(key('hotelRooms', id))),
    act: (body) => context.handleHotelAction({}, user, body)
  };
}

test('both web and desktop save paths repeatedly count 3 -> 2 -> 3 -> 2 for maintenance', async () => {
  for (const action of ['saveRoom', 'saveHotelRoom', 'setHousekeepingStatus', 'setHotelHousekeepingStatus']) {
    const harness = hotelHarness();
    const update = (HousekeepingStatus) => harness.act({ ...harness.room(), action, HousekeepingStatus });
    const count = (data) => data.rooms.filter((room) => room.Status === 'Available').length;
    assert.equal(count(await harness.act({ action: 'list' })), 3);
    for (const completed of ['Clean', 'Inspected']) {
      assert.equal(count(await update('Maintenance')), 2, `${action}: maintenance blocks the room`);
      assert.equal(harness.room().Status, 'Maintenance', `${action}: restriction is persisted`);
      assert.equal(count(await update(completed)), 3, `${action}: completion releases the room`);
    }
    assert.equal(count(await update('Maintenance')), 2, `${action}: maintenance can be reapplied`);
    assert.equal(count(await harness.act({ action: 'list' })), 2, `${action}: refresh preserves the count`);
  }
});

test('legacy Available + Maintenance rooms are excluded from counts, public booking and check-in', async () => {
  const h = hotelHarness();
  h.documents.set('hotelRooms/101', { ...h.room(), HousekeepingStatus: 'Maintenance' });
  const listed = await h.act({ action: 'list' });
  assert.equal(listed.rooms.filter((room) => room.Status === 'Available').length, 2);
  const available = await h.api.getPublicHotelAvailability({}, { BranchId: 'main' });
  assert.equal(available.rooms.length, 2);
  assert.equal(available.rooms.some((room) => room.RoomId === '101'), false);
  const reservation = {
    ReservationId: 'RSV-1', RoomId: '101', GuestName: 'Test guest', BranchId: 'main',
    ArrivalDate: '2026-09-10', DepartureDate: '2026-09-11', NightlyRate: 0, Status: 'Reserved'
  };
  await assert.rejects(h.act({ action: 'saveReservation', ...reservation }), /not available for reservations/);
  await assert.rejects(h.api.initPublicHotelReservationPayment({ PAYSTACK_SECRET_KEY: 'unused-test-value' }, {
    RoomId: '101', BranchId: 'main'
  }), /not currently available for booking/);
  h.documents.set('hotelReservations/RSV-1', reservation);
  await assert.rejects(h.act({ action: 'changeReservationStatus', ReservationId: 'RSV-1', Status: 'Checked In' }), /room is unavailable/);
  assert.equal(h.documents.get('hotelReservations/RSV-1').Status, 'Reserved');
  // The housekeeping path also repairs the older inconsistent record.
  await h.act({ action: 'setHousekeepingStatus', RoomId: '101', HousekeepingStatus: 'Clean' });
  assert.equal(h.room().Status, 'Available');
});

test('maintenance completion never releases a checked-in room or an out-of-service room', async () => {
  for (const action of ['saveRoom', 'setHousekeepingStatus']) {
    const h = hotelHarness();
    h.documents.set('hotelRooms/101', { ...h.room(), Status: 'Occupied' });
    h.documents.set('hotelReservations/RSV-1', {
      ReservationId: 'RSV-1', BranchId: 'main', RoomId: '101', Status: 'Checked In',
      ArrivalDate: '2026-09-10', DepartureDate: '2026-09-11', NightlyRate: 0
    });
    await h.act({ ...h.room(), action, HousekeepingStatus: 'Maintenance' });
    await h.act({ ...h.room(), action, HousekeepingStatus: 'Clean' });
    assert.equal(h.room().Status, 'Occupied', `${action}: actual occupancy is restored`);
    h.documents.set('hotelRooms/102', { ...h.room('102'), Status: 'Out of Service' });
    await h.act({ ...h.room('102'), action, HousekeepingStatus: 'Maintenance' });
    await h.act({ ...h.room('102'), action, HousekeepingStatus: 'Clean' });
    assert.equal(h.room('102').Status, 'Out of Service');
  }
});

test('check-out, cancellation and no-show do not silently clear maintenance', async () => {
  for (const Status of ['Checked Out', 'Cancelled', 'No Show']) {
    const h = hotelHarness();
    h.documents.set('hotelRooms/101', { ...h.room(), Status: 'Maintenance', HousekeepingStatus: 'Maintenance' });
    h.documents.set('hotelReservations/RSV-1', {
      ReservationId: 'RSV-1', RoomId: '101', BranchId: 'main', NightlyRate: 0,
      ArrivalDate: '2026-09-10', DepartureDate: '2026-09-11',
      Status: Status === 'Checked Out' ? 'Checked In' : 'Reserved'
    });
    const data = await h.act({ action: 'changeReservationStatus', ReservationId: 'RSV-1', Status });
    assert.equal(h.room().Status, 'Maintenance');
    assert.equal(h.room().HousekeepingStatus, 'Maintenance');
    assert.equal(data.rooms.filter((room) => room.Status === 'Available').length, 2);
  }
});
