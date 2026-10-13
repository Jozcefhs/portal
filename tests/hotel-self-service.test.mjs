import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { enforceActorBranch } from '../functions/lib/branch-scope.js';
import { secureSecretEqual } from '../functions/lib/request-security.js';

const core = await readFile(new URL('../functions/lib/hotel-services.js', import.meta.url), 'utf8');
const extension = await readFile(new URL('../functions/lib/hotel-self-service.js', import.meta.url), 'utf8');
const clone = value => value == null ? value : structuredClone(value);
function load(source, context) {
  const names = [...source.matchAll(/^export (?:async )?(?:function|const) (\w+)/gm)].map(m => m[1]);
  const text = source.replace(/^import[\s\S]*?from '[^']+';\r?\n/gm, '').replace(/^export /gm, '');
  Object.assign(context, vm.runInContext(`(() => {${text}\nreturn {${names.join(',')}};})()`, context));
}
async function harness(edition = 'organization') {
  const docs = new Map(); let serial = 0;
  const env = { STAFF_SESSION_SECRET: 'test-only-signing-secret' };
  const user = { role: 'Hotel User', username: 'hotel-test', branchId: 'main' };
  const put = (collection, id, data) => docs.set(`${collection}/${id}`, { ...clone(data), __updateTime: String(++serial) });
  const get = (collection, id) => clone(docs.get(`${collection}/${id}`) || null);
  const context = vm.createContext({ crypto: globalThis.crypto, TextEncoder, Uint8Array, DataView, Date, URL, Response, atob,
    secureSecretEqual, enforceActorBranch,
    getDocument: async (_, c, id) => get(c, id),
    queryCollection: async (_, c, { filters = [], limit = 1000 }) => [...docs.entries()].filter(([key, value]) => key.startsWith(`${c}/`) && filters.every(f => value[f.field] === f.value)).slice(0, limit).map(([, v]) => clone(v)),
    batchCommitDocuments: async (_, writes) => {
      assert.equal(new Set(writes.map(w => `${w.collectionPath}/${w.documentId}`)).size, writes.length);
      for (const w of writes) {
        const old = get(w.collectionPath, w.documentId);
        if ((w.exists === false && old) || (w.updateTime && old?.__updateTime !== w.updateTime)) throw Object.assign(new Error('Conflict'), { status: 409 });
      }
      for (const w of writes) put(w.collectionPath, w.documentId, w.data);
    },
    upsertDocument: async (_, c, id, data) => put(c, id, data),
    resolveOrganizationConfig: () => ({ Edition: edition, Name: 'Test hotel', FeatureFlags: { hotel: true } }), normalizeOrganizationEdition: x => x,
    putStoredDocument: async (_, input) => ({ reference: `r2://test/${input.ownerId}`, mimeType: input.mimeType }),
    fetch: () => { throw new Error('Unexpected network request'); }
  });
  load(core, context); load(extension, context);
  const act = body => context.handleHotelAction(env, user, body);
  const deviceResult = await act({ action: 'saveHotelKeyDevice', Enabled: true, CheckInHour: 0, CheckOutHour: 23, UtcOffsetMinutes: 0 });
  const deviceId = deviceResult.keyDispenser.DeviceId;
  const device = () => get('hotelKeyDevices', deviceId);
  put('hotelRooms', 'R101', { RoomId: 'R101', RoomNumber: '101', BranchId: 'main', RoomType: 'Standard', Status: 'Available', HousekeepingStatus: 'Clean', Capacity: 2, NightlyRate: 10000 });
  await act({ action: 'saveHotelKeySlot', RoomId: 'R101', KeySlot: 'A01', KeyStocked: true, PhysicalKeyConfirmed: true });
  const id = `RSV-WEB-${crypto.randomUUID()}`;
  const token = 'a'.repeat(64);
  const date = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  put('hotelReservations', id, { ReservationId: id, BranchId: 'main', RoomId: 'R101', RoomNumber: '101', ArrivalDate: date, DepartureDate: tomorrow, NightlyRate: 10000, Status: 'Reserved', PaymentReference: 'HOT-TEST', GuestName: 'Test guest' });
  put('hotelPayments', 'PAYSTACK-HOT-TEST', { ReservationId: id, BranchId: 'main', Amount: 10000, Gateway: 'Paystack', GatewayReference: 'HOT-TEST' });
  const w = await context.guestAccessWrite(id, 'main', token); put(w.collectionPath, w.documentId, w.data);
  const guest = () => context.guestHotelCollection(env, { ReservationId: id, GuestAccessToken: token });
  const redeem = code => context.redeemHotelKey(env, device(), { Code: code, RequestId: crypto.randomUUID() });
  return { docs, env, user, api: context, act, put, get, guest, redeem, id, token, device, deviceId, deviceToken: deviceResult.deviceToken };
}

for (const edition of ['faith', 'organization']) test(`${edition}: verified payment -> private code -> single physical release -> check-in`, async () => {
  const h = await harness(edition);
  const pass = await h.guest(); assert.match(pass.code, /^\d{6}$/);
  assert.equal((await h.guest()).code, pass.code);
  const request = { Code: pass.code, RequestId: crypto.randomUUID() };
  const claim = await h.api.redeemHotelKey(h.env, h.device(), request);
  assert.equal(claim.newCommand, true); assert.equal(claim.slot, 'A01');
  assert.equal(h.get('hotelReservations', h.id).Status, 'Reserved', 'not checked in before release sensor');
  assert.equal(h.get('hotelRooms', 'R101').KeyStocked, false);
  const replay = await h.api.redeemHotelKey(h.env, h.device(), request);
  assert.equal(replay.newCommand, false); assert.equal(replay.slot, undefined);
  await assert.rejects(h.redeem(pass.code), /busy|inspection/);
  const result = await h.api.confirmHotelKey(h.env, h.device(), { CommandId: claim.commandId, Outcome: 'released' });
  assert.equal(result.state, 'Dispensed'); assert.equal(h.get('hotelReservations', h.id).Status, 'Checked In');
  assert.equal(h.get('hotelRooms', 'R101').Status, 'Occupied');
  assert.equal((await h.api.confirmHotelKey(h.env, h.device(), { CommandId: claim.commandId, Outcome: 'released' })).state, 'Dispensed');
  await assert.rejects(h.redeem(pass.code), /invalid|used/);
  assert.equal((await h.guest()).code, undefined);
  const data = await h.act({ action: 'list' });
  assert.equal(data.keyDispenser.TokenHash, undefined); assert.equal(data.deviceToken, undefined);
  assert.ok(!JSON.stringify(data).includes(h.token));
});

test('guest credentials, device credentials, branch and role gates fail closed', async () => {
  const h = await harness();
  await assert.rejects(h.api.guestHotelCollection(h.env, { ReservationId: h.id, GuestAccessToken: 'b'.repeat(64) }), /invalid/);
  await assert.rejects(h.api.guestHotelCollection(h.env, { ReservationId: h.id }), /private booking/);
  const req = token => new Request('https://hotel.test/api/hotel-key-device', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await h.api.authenticateHotelDevice(h.env, req(h.deviceToken), h.deviceId)).BranchId, 'main');
  await assert.rejects(h.api.authenticateHotelDevice(h.env, req('b'.repeat(64)), h.deviceId), /authentication failed/);
  await assert.rejects(h.api.hotelSelfServiceAction(h.env, { role: 'Front Desk', branchId: 'main' }, { action: 'saveHotelKeyDevice' }), /not allowed/);
  h.put('hotelRooms', 'OTHER', { RoomId: 'OTHER', BranchId: 'other', RoomType: 'Standard' });
  await assert.rejects(h.act({ action: 'saveHotelKeySlot', RoomId: 'OTHER', KeySlot: 'B01' }), /this branch/);
  assert.ok(!(await h.api.publicRoomMedia(h.env, 'other')).length);
  const rotated = await h.act({ action: 'saveHotelKeyDevice', Enabled: false, RotateToken: true });
  assert.notEqual(rotated.deviceToken, h.deviceToken);
  await assert.rejects(h.api.authenticateHotelDevice(h.env, req(h.deviceToken), h.deviceId), /authentication failed/);
});

test('unpaid, manual-only, changed, expired and cancelled stays cannot collect', async () => {
  for (const mutation of ['unpaid', 'manual', 'cancelled', 'changed', 'expired', 'dirty', 'empty', 'occupied']) {
    const h = await harness(); const pass = await h.guest();
    if (mutation === 'unpaid') h.put('hotelCharges', 'C1', { BranchId: 'main', ReservationId: h.id, Amount: 1 });
    if (mutation === 'manual') h.put('hotelPayments', 'PAYSTACK-HOT-TEST', { BranchId: 'main', ReservationId: h.id, Amount: 10000, Method: 'Cash' });
    if (mutation === 'cancelled') h.put('hotelReservations', h.id, { ...h.get('hotelReservations', h.id), Status: 'Cancelled' });
    if (mutation === 'changed') h.put('hotelReservations', h.id, { ...h.get('hotelReservations', h.id), RoomId: 'R102' });
    if (mutation === 'expired') {
      const [key, row] = [...h.docs].find(([key]) => key.startsWith('hotelKeyCodes/'));
      h.put('hotelKeyCodes', key.split('/')[1], { ...row, ExpiresAt: '2020-01-01T00:00:00Z' });
    }
    if (mutation === 'dirty') h.put('hotelRooms', 'R101', { ...h.get('hotelRooms', 'R101'), HousekeepingStatus: 'Dirty' });
    if (mutation === 'empty') h.put('hotelRooms', 'R101', { ...h.get('hotelRooms', 'R101'), KeyStocked: false });
    if (mutation === 'occupied') h.put('hotelReservations', 'OTHER', { ReservationId: 'OTHER', BranchId: 'main', RoomId: 'R101', Status: 'Checked In' });
    await assert.rejects(h.redeem(pass.code), undefined, mutation);
    assert.equal(h.device().ActiveCommandId, undefined, mutation);
  }
});

test('concurrent guests cannot command the same machine twice', async () => {
  const h = await harness(); const pass = await h.guest();
  const outcomes = await Promise.allSettled([h.redeem(pass.code), h.redeem(pass.code)]);
  assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal([...h.docs.keys()].filter(key => key.startsWith('hotelKeyCommands/')).length, 1);
});

test('unknown release disables the machine, keeps holds and requires physical staff resolution', async () => {
  const h = await harness(); const pass = await h.guest(); const claim = await h.redeem(pass.code);
  await h.api.confirmHotelKey(h.env, h.device(), { CommandId: claim.commandId, Outcome: 'unknown' });
  assert.equal(h.device().Enabled, false); assert.ok(h.device().ActiveCommandId);
  await assert.rejects(h.act({ action: 'saveHotelKeyDevice', Enabled: true }), /Resolve/);
  await assert.rejects(h.act({ action: 'resolveHotelKeyCommand', Outcome: 'not-released', Reason: 'Checked the slot' }), /physical inspection/);
  await assert.rejects(h.act({ action: 'changeReservationStatus', ReservationId: h.id, Status: 'Cancelled' }), /handoff/);
  await assert.rejects(h.act({ action: 'recordCharge', ReservationId: h.id, Description: 'Fee', Amount: 1 }), /handoff/);
  await assert.rejects(h.act({ action: 'setHousekeepingStatus', RoomId: 'R101', HousekeepingStatus: 'Dirty' }), /handoff/);
  await h.act({ action: 'resolveHotelKeyCommand', Outcome: 'not-released', Reason: 'Controller stopped, key still in slot.', PhysicalInspection: true });
  assert.equal(h.get('hotelReservations', h.id).Status, 'Reserved'); assert.equal(h.get('hotelRooms', 'R101').KeyStocked, false);
  await h.act({ action: 'saveHotelKeySlot', RoomId: 'R101', KeySlot: 'A01', KeyStocked: true, PhysicalKeyConfirmed: true });
  await h.act({ action: 'saveHotelKeyDevice', Enabled: true });
  assert.notEqual((await h.guest()).code, pass.code);
});

test('at most 20 attempts per device, regardless of changing request IDs', async () => {
  const h = await harness();
  for (let n = 0; n < 20; n++) await assert.rejects(h.redeem('000000'), /invalid/);
  await assert.rejects(h.redeem('111111'), error => error.status === 429);
});

test('physical key mapping is unique and requires inspected rooms and explicit confirmation', async () => {
  const h = await harness();
  h.put('hotelRooms', 'R102', { ...h.get('hotelRooms', 'R101'), RoomId: 'R102', RoomNumber: '102', KeySlot: '' });
  await assert.rejects(h.act({ action: 'saveHotelKeySlot', RoomId: 'R102', KeySlot: 'a01' }), /already assigned/);
  await assert.rejects(h.act({ action: 'saveHotelKeySlot', RoomId: 'R102', KeySlot: 'A02', KeyStocked: true }), /Confirm/);
});

test('room type media validates bytes, publishes only scoped public URLs and supports removal', async () => {
  const h = await harness();
  const png = Buffer.from('89504e470d0a1a0a0000000000000000', 'hex').toString('base64');
  await h.act({ action: 'saveHotelRoomMedia', RoomType: 'Standard', FileBase64: png, MimeType: 'image/png', Description: 'Garden view' });
  const rows = await h.api.publicRoomMedia(h.env, 'main'); assert.equal(rows.length, 1); assert.equal(rows[0].Description, 'Garden view');
  assert.match(rows[0].MediaUrl, /^\/api\/hotel-room-media\?id=[a-f0-9]{64}$/); assert.equal(rows[0].Reference, undefined);
  assert.equal((await h.api.publicRoomMedia(h.env, 'other')).length, 0);
  await assert.rejects(h.act({ action: 'saveHotelRoomMedia', RoomType: 'Standard', FileBase64: png, MimeType: 'video/mp4' }), /contents/);
  assert.throws(() => h.api.validateHotelMedia('x'.repeat(12 * 1024 * 1024), 'image/png'), /8 MB/);
  assert.throws(() => h.api.validateHotelMedia(png, 'image/svg+xml'), /Use a JPG/);
  await h.act({ action: 'saveHotelRoomMedia', RoomType: 'Standard', Remove: true });
  assert.equal((await h.api.publicRoomMedia(h.env, 'main')).length, 0);
});

test('collection times use configured hotel UTC offset, not the server time zone', async () => {
  const h = await harness();
  const window = h.api.hotelCollectionWindow({ ArrivalDate: '2026-10-13', DepartureDate: '2026-10-15' }, { CheckInHour: 14, CheckOutHour: 12, UtcOffsetMinutes: 60 });
  assert.equal(window.NotBefore, '2026-10-13T13:00:00.000Z'); assert.equal(window.ExpiresAt, '2026-10-15T11:00:00.000Z');
});

test('room-type filtering cannot leave an invisible room selected at the old price', async () => {
  const source = await readFile(new URL('../js/hotel-booking.js', import.meta.url), 'utf8');
  const context = vm.createContext({
    availableRooms: [{ RoomId: '101' }, { RoomId: '201' }], roomPage: 0, ROOMS_PER_PAGE: 12,
    selectedRoomId: { value: '101' }, bookingForm: { dataset: { idempotencyKey: 'old-selection' } },
    roomCount: {}, roomChoices: {}, roomPager: {}, roomPageLabel: {}, roomPrevious: {}, roomNext: {},
    renderRoomShowcase: () => {}, filteredRooms: () => [{ RoomId: '201', RoomNumber: '201', RoomType: 'Deluxe', Capacity: 2, NightlyRate: 50000 }],
    clean: x => String(x || ''), escapeHtml: x => String(x || ''), money: x => `NGN ${x}`, updateTotal: () => {}
  });
  vm.runInContext(source.slice(source.indexOf('function renderRoomPage()'), source.indexOf('function renderRoomShowcase()')), context);
  context.renderRoomPage();
  assert.equal(context.selectedRoomId.value, '201');
  assert.equal(context.bookingForm.dataset.idempotencyKey, undefined);
  assert.match(context.roomChoices.innerHTML, /aria-pressed="true"/);
  assert.match(context.roomChoices.innerHTML, /50000/);
});

test('media response streams full objects and byte ranges without exposing storage references', async () => {
  const h = await harness();
  const id = 'a'.repeat(64);
  h.put('hotelRoomMedia', id, { BranchId: 'main', Reference: 'r2://fixture', MimeType: 'video/mp4' });
  h.api.parseStoredDocumentReference = () => ({ key: 'private/room.mp4' });
  h.api.requireDocumentStorage = () => ({
    head: async () => ({ size: 100 }),
    get: async (_key, options) => ({ size: 100, httpEtag: '"fixture"', body: new Uint8Array(options.range?.length || 100) })
  });
  const response = await h.api.hotelRoomMediaResponse(h.env, new Request(`https://hotel.test/api/hotel-room-media?id=${id}`, { headers: { Range: 'bytes=10-19' } }));
  assert.equal(response.status, 206); assert.equal(response.headers.get('Content-Range'), 'bytes 10-19/100');
  assert.equal((await response.arrayBuffer()).byteLength, 10);
  const invalid = await h.api.hotelRoomMediaResponse(h.env, new Request(`https://hotel.test/api/hotel-room-media?id=${id}`, { headers: { Range: 'bytes=200-300' } }));
  assert.equal(invalid.status, 416);
});

test('future arrival codes exist but cannot actuate before the collection window', async () => {
  const h = await harness();
  const reservation = h.get('hotelReservations', h.id);
  h.put('hotelReservations', h.id, { ...reservation, ArrivalDate: '2099-01-01', DepartureDate: '2099-01-02' });
  const pass = await h.guest(); assert.match(pass.code, /^\d{6}$/);
  await assert.rejects(h.redeem(pass.code), /window/);
});

test('code records contain no plaintext credentials and database failure cannot authorize a release', async () => {
  const h = await harness(); const pass = await h.guest();
  const access = h.get('hotelGuestAccess', h.id);
  const code = h.get('hotelKeyCodes', access.CodeId);
  assert.equal(access.GuestAccessToken, undefined); assert.equal(code.Code, undefined);
  const original = h.api.batchCommitDocuments;
  h.api.batchCommitDocuments = async (env, writes) => {
    if (writes.some(w => w.collectionPath === 'hotelKeyCommands')) throw new Error('Simulated database outage');
    return original(env, writes);
  };
  await assert.rejects(h.redeem(pass.code), /outage/);
  assert.equal(h.get('hotelReservations', h.id).Status, 'Reserved');
  assert.equal(h.get('hotelRooms', 'R101').KeyStocked, true);
  assert.equal(h.device().ActiveCommandId, undefined);
});
