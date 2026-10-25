import { loadDatedHistory } from './history-date-range.js';
import {
  batchCommitDocuments,
  getDocument,
  queryCollection, queryCollectionPages,
  upsertDocument
} from './firestore.js';
import { normalizeOrganizationEdition, resolveOrganizationConfig } from './organization-config.js';
import { branchPaymentConfiguration, withPaystackBranchRouting } from './direct-bank-transfer.js';
import QRCode from 'qrcode';
import { enforceActorBranch } from './branch-scope.js';
import { guestAccessWrite, hotelSelfServiceAction, hotelSelfServiceData, publicRoomMedia, assertNoKeyHandoff } from './hotel-self-service.js';

const PAYSTACK_INIT_URL = 'https://api.paystack.co/transaction/initialize';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const nowIso = () => new Date().toISOString();
const number = (value) => {
  const parsed = Number(String(value ?? 0).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};
const inputError = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

export const HOTEL_COLLECTIONS = Object.freeze({
  rooms: 'hotelRooms',
  reservations: 'hotelReservations',
  charges: 'hotelCharges',
  payments: 'hotelPayments',
  housekeeping: 'hotelHousekeeping',
  audit: 'hotelAudit'
});

const ROOM_STATUSES = new Map([
  ['available', 'Available'],
  ['occupied', 'Occupied'],
  ['cleaning', 'Cleaning'],
  ['maintenance', 'Maintenance'],
  ['out of service', 'Out of Service']
]);
const HOUSEKEEPING_STATUSES = new Map([
  ['clean', 'Clean'],
  ['dirty', 'Dirty'],
  ['cleaning', 'Cleaning'],
  ['inspected', 'Inspected'],
  ['maintenance', 'Maintenance']
]);
const RESERVATION_STATUSES = new Map([
  ['reserved', 'Reserved'],
  ['checked in', 'Checked In'],
  ['checked out', 'Checked Out'],
  ['cancelled', 'Cancelled'],
  ['no show', 'No Show']
]);
const PAYMENT_METHODS = new Map([
  ['cash', 'Cash'], ['bank transfer', 'Bank Transfer'], ['transfer', 'Bank Transfer'],
  ['pos', 'POS'], ['card', 'POS'], ['online', 'Online']
]);

const ROOM_MANAGERS = new Set([
  'Super Admin', 'Church Administrator', 'Organisation Administrator',
  'Operations Manager', 'Management', 'Hotel User'
]);
const RESERVATION_MANAGERS = new Set([...ROOM_MANAGERS, 'Front Desk']);
const PAYMENT_MANAGERS = new Set([...ROOM_MANAGERS, 'Front Desk', 'Accounts Officer']);

function safeId(value) {
  return clean(value).replace(/[\/\\?#\[\]]/g, '-').replace(/\s+/g, '_').slice(0, 140);
}

function actorName(user = {}) {
  return clean(user.displayName || user.RecordedBy || user.username || user.UserUsername) || 'Staff user';
}

export function branchIdFor(user = {}, body = {}) {
  return enforceActorBranch({ ...user, branchId: user.branchId || user.BranchId || user.UserBranchId }, body.BranchId || body.branchId, '', 'main');
}

export function hotelWrite(collectionPath, documentId, data, existing = null) {
  if (existing && !clean(existing.__updateTime)) throw inputError('The hotel record version is unavailable. Refresh and try again.', 409);
  const payload = { ...data };
  for (const key of ['__id', '__name', '__createTime', '__updateTime']) delete payload[key];
  return { collectionPath, documentId: safeId(documentId), data: payload,
    ...(existing ? { updateTime: existing.__updateTime } : { exists: false }) };
}

// Every booking/date/status mutation writes the room it read. That shared
// version makes the overlap check and reservation write one atomic operation.
function bookingRoomGuard(room, timestamp) {
  return hotelWrite(HOTEL_COLLECTIONS.rooms, room.RoomId || room.__id,
    { ...room, BookingRevisionAt: timestamp }, room);
}

export async function commitHotelChange(env, writes) {
  try { return await batchCommitDocuments(env, writes); }
  catch (error) {
    if ([409, 412].includes(Number(error.status))) throw inputError('Hotel records changed during this action. Refresh and try again; nothing was partially saved.', 409);
    throw error;
  }
}

function roleFor(user = {}) {
  return clean(user.role || user.Role || user.UserRole);
}

export function hotelCapabilities(user = {}) {
  const role = roleFor(user);
  return {
    canView: Boolean(role),
    canManageRooms: ROOM_MANAGERS.has(role),
    canManageReservations: RESERVATION_MANAGERS.has(role),
    canRecordPayments: PAYMENT_MANAGERS.has(role),
    canViewAudit: ['Super Admin', 'Church Administrator', 'Organisation Administrator', 'Operations Manager', 'Management', 'Auditor'].includes(role)
  };
}

export function requireCapability(user, capability) {
  const capabilities = hotelCapabilities(user);
  if (!capabilities[capability]) throw inputError('This staff account is not allowed to perform that hotel action.', 403);
  return capabilities;
}

async function hotelOrganization(env) {
  const [organizationProfile, legacyProfile] = await Promise.all([
    getDocument(env, 'settings', 'organisationProfile').catch(() => null),
    getDocument(env, 'settings', 'schoolProfile').catch(() => null)
  ]);
  return resolveOrganizationConfig({ env, organizationProfile, legacyProfile });
}

export async function requireHotelOrganization(env) {
  const organization = await hotelOrganization(env);
  const edition = normalizeOrganizationEdition(organization.Edition);
  if (!['faith', 'organization'].includes(edition)) {
    throw inputError('Hotel Services is available only to Religious Organisations and Other Organisations.', 403);
  }
  if (organization.FeatureFlags?.hotel !== true) {
    throw inputError('Hotel Services is not enabled for this organisation.', 403);
  }
  return { ...organization, Edition: edition };
}

async function requireHotelEdition(env) {
  return (await requireHotelOrganization(env)).Edition;
}

function normalizeDate(value, label) {
  const date = clean(value);
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw inputError(`${label} must be a valid date.`);
  }
  return date;
}

function normalizedStatus(value, options, label) {
  const status = options.get(lower(value));
  if (!status) throw inputError(`Choose a valid ${label}.`);
  return status;
}

function nightsBetween(arrivalDate, departureDate) {
  const start = Date.parse(`${arrivalDate}T00:00:00Z`);
  const end = Date.parse(`${departureDate}T00:00:00Z`);
  return Math.round((end - start) / 86400000);
}

export async function branchRows(env, collection, branchId) {
  const rows = await queryCollection(env, collection, {
    filters: [{ field: 'BranchId', op: '==', value: branchId }],
    limit: 1001
  });
  if (rows.length > 1000) throw inputError('This hotel branch has too many records for this operation. Contact support; no partial availability or balance was used.', 413);
  return rows;
}

async function writeAudit(env, branchId, user, action, entityType, entityId, details = '') {
  const auditId = `HOT-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  await upsertDocument(env, HOTEL_COLLECTIONS.audit, auditId, {
    AuditId: auditId,
    BranchId: branchId,
    Timestamp: nowIso(),
    Action: clean(action),
    EntityType: clean(entityType),
    EntityId: clean(entityId),
    Details: clean(details),
    Actor: actorName(user),
    ActorRole: roleFor(user)
  });
}

export function normalizeHotelRoom(input = {}, branchId = 'main') {
  const roomId = clean(input.RoomId || input.roomId) || safeId(`${branchId}-${input.RoomNumber || input.roomNumber}`);
  const roomNumber = clean(input.RoomNumber || input.roomNumber);
  if (!roomId) throw inputError('Room ID is required.');
  if (!roomNumber) throw inputError('Room number or name is required.');
  const capacity = Math.max(1, Math.trunc(number(input.Capacity || input.capacity || 1)));
  const nightlyRate = Math.max(0, number(input.NightlyRate ?? input.nightlyRate));
  const normalizedRoomStatus = normalizedStatus(input.Status || input.status || 'Available', ROOM_STATUSES, 'room status');
  return hotelRoomWithOperationalStatus({
    RoomId: roomId,
    BranchId: branchId,
    RoomNumber: roomNumber,
    RoomType: clean(input.RoomType || input.roomType) || 'Standard',
    Capacity: capacity,
    NightlyRate: nightlyRate,
    // Cleaning is a housekeeping state. Preserve compatibility with older
    // clients that submit it as the room status, but keep the room bookable.
    Status: normalizedRoomStatus === 'Cleaning' ? 'Available' : normalizedRoomStatus,
    HousekeepingStatus: normalizedStatus(input.HousekeepingStatus || input.housekeepingStatus || 'Clean', HOUSEKEEPING_STATUSES, 'housekeeping status'),
    Notes: clean(input.Notes || input.notes)
  });
}

export function normalizeHotelReservation(input = {}, branchId = 'main') {
  const reservationId = clean(input.ReservationId || input.reservationId) || `RSV-${crypto.randomUUID()}`;
  const guestName = clean(input.GuestName || input.guestName);
  const roomId = clean(input.RoomId || input.roomId);
  if (!guestName) throw inputError('Guest name is required.');
  if (!roomId) throw inputError('Select a room.');
  const arrivalDate = normalizeDate(input.ArrivalDate || input.arrivalDate, 'Arrival date');
  const departureDate = normalizeDate(input.DepartureDate || input.departureDate, 'Departure date');
  if (nightsBetween(arrivalDate, departureDate) < 1) throw inputError('Departure date must be after the arrival date.');
  return {
    ReservationId: reservationId,
    BranchId: branchId,
    GuestName: guestName,
    GuestPhone: clean(input.GuestPhone || input.guestPhone),
    GuestEmail: lower(input.GuestEmail || input.guestEmail),
    RoomId: roomId,
    ArrivalDate: arrivalDate,
    DepartureDate: departureDate,
    Adults: Math.max(1, Math.trunc(number(input.Adults || input.adults || 1))),
    Children: Math.max(0, Math.trunc(number(input.Children || input.children || 0))),
    NightlyRate: Math.max(0, number(input.NightlyRate ?? input.nightlyRate)),
    Status: normalizedStatus(input.Status || input.status || 'Reserved', RESERVATION_STATUSES, 'reservation status'),
    Source: clean(input.Source || input.source) || 'Direct',
    Notes: clean(input.Notes || input.notes)
  };
}

export function hotelReservationTotals(reservation, charges = [], payments = []) {
  const nights = Math.max(0, nightsBetween(clean(reservation.ArrivalDate), clean(reservation.DepartureDate)) || 0);
  const roomAmount = Math.max(0, number(reservation.NightlyRate)) * nights;
  const extraCharges = charges.filter((row) => clean(row.ReservationId) === clean(reservation.ReservationId))
    .reduce((sum, row) => sum + Math.max(0, number(row.Amount)), 0);
  const paid = payments.filter((row) => clean(row.ReservationId) === clean(reservation.ReservationId))
    .reduce((sum, row) => sum + Math.max(0, number(row.Amount)), 0);
  return {
    ...reservation,
    Nights: nights,
    RoomAmount: roomAmount,
    ExtraCharges: extraCharges,
    TotalAmount: roomAmount + extraCharges,
    AmountPaid: paid,
    Balance: Math.max(0, roomAmount + extraCharges - paid)
  };
}

export function hotelReservationCanCheckIn(reservation = {}) {
  return clean(reservation.Status) === 'Reserved' && Math.max(0, number(reservation.Balance)) <= 0.005;
}

export function hotelRoomWithOperationalStatus(room = {}) {
  // Either maintenance control must make the room unavailable, including
  // records saved by older clients with Status=Available and housekeeping=Maintenance.
  if (lower(room.Status) === 'out of service') return room;
  if (lower(room.HousekeepingStatus) === 'maintenance') return { ...room, Status: 'Maintenance' };
  return lower(room.Status) === 'cleaning' ? { ...room, Status: 'Available' } : room;
}

function hotelRoomUnavailableForBooking(room) {
  return ['maintenance', 'out of service'].includes(lower(hotelRoomWithOperationalStatus(room).Status));
}

export async function listHotelServices(env, user, body = {}) {
  const edition = await requireHotelEdition(env, user);
  const capabilities = requireCapability(user, 'canView');
  const branchId = branchIdFor(user, body);
  const selected = Object.hasOwn(body, 'HistoryDateRange')
    ? await loadDatedHistory(env, HOTEL_COLLECTIONS.reservations, body, 'CreatedAt', branchId) : null;
  const linkedFinancialRows = async collection => {
    if (!selected) return branchRows(env, collection, branchId);
    const ids = [...new Set(selected.map(row => clean(row.ReservationId || row.__id)).filter(Boolean))];
    const rows = [];
    for (let offset = 0; offset < ids.length; offset += 30) {
      rows.push(...await queryCollectionPages(env, collection, { filters: [{ field: 'ReservationId', op: 'in', value: ids.slice(offset, offset + 30) }], maxRows: 10000 }));
    }
    return rows.filter(row => clean(row.BranchId || 'main') === branchId);
  };
  const [rooms, reservations, charges, payments, housekeeping, audit] = await Promise.all([
    branchRows(env, HOTEL_COLLECTIONS.rooms, branchId),
    selected || branchRows(env, HOTEL_COLLECTIONS.reservations, branchId),
    linkedFinancialRows(HOTEL_COLLECTIONS.charges),
    linkedFinancialRows(HOTEL_COLLECTIONS.payments),
    Object.hasOwn(body, 'HistoryDateRange') ? loadDatedHistory(env, HOTEL_COLLECTIONS.housekeeping, body, 'CreatedAt', branchId) : branchRows(env, HOTEL_COLLECTIONS.housekeeping, branchId),
    capabilities.canViewAudit ? (Object.hasOwn(body, 'HistoryDateRange') ? loadDatedHistory(env, HOTEL_COLLECTIONS.audit, body, 'Timestamp', branchId) : branchRows(env, HOTEL_COLLECTIONS.audit, branchId)) : Promise.resolve([])
  ]);
  const decoratedReservations = reservations.map((row) => hotelReservationTotals(row, charges, payments));
  const operationalRooms = rooms.map(hotelRoomWithOperationalStatus);
  return {
    ok: true,
    edition,
    branchId,
    capabilities,
    ...await hotelSelfServiceData(env, branchId, capabilities),
    rooms: operationalRooms.sort((a, b) => clean(a.RoomNumber).localeCompare(clean(b.RoomNumber), undefined, { numeric: true })),
    reservations: decoratedReservations.sort((a, b) => `${clean(b.ArrivalDate)}|${clean(b.CreatedAt)}`.localeCompare(`${clean(a.ArrivalDate)}|${clean(a.CreatedAt)}`)),
    charges: charges.sort((a, b) => clean(b.ChargeDate || b.CreatedAt).localeCompare(clean(a.ChargeDate || a.CreatedAt))),
    payments: payments.sort((a, b) => clean(b.PaymentDate || b.CreatedAt).localeCompare(clean(a.PaymentDate || a.CreatedAt))),
    housekeeping: housekeeping.sort((a, b) => clean(b.CreatedAt).localeCompare(clean(a.CreatedAt))).slice(0, 200),
    audit: audit.sort((a, b) => clean(b.Timestamp).localeCompare(clean(a.Timestamp))).slice(0, 100)
  };
}

export async function saveHotelRoom(env, user, body = {}) {
  await requireHotelEdition(env, user);
  requireCapability(user, 'canManageRooms');
  const branchId = branchIdFor(user, body);
  const room = normalizeHotelRoom(body.room || body.Room || body, branchId);
  const existing = await getDocument(env, HOTEL_COLLECTIONS.rooms, safeId(room.RoomId)).catch(() => null);
  if (existing && clean(existing.BranchId) !== branchId) throw inputError('That room belongs to another branch.', 403);
  assertNoKeyHandoff(existing);
  // The full room editor must also support completing housekeeping maintenance.
  // An explicit room-status restriction with unchanged housekeeping is retained.
  if (existing && lower(existing.HousekeepingStatus) === 'maintenance'
    && completesHotelMaintenance(existing, room.HousekeepingStatus)
    && ['Available', 'Maintenance'].includes(room.Status)) {
    const completed = await resolveHotelHousekeepingRoom(env, existing, room.HousekeepingStatus, branchId);
    room.Status = completed.Status;
  }
  const payload = {
    ...(existing || {}), ...room,
    CreatedAt: existing?.CreatedAt || nowIso(),
    CreatedBy: existing?.CreatedBy || actorName(user),
    UpdatedAt: nowIso(),
    UpdatedBy: actorName(user)
  };
  delete payload.__id; delete payload.__name; delete payload.__updateTime;
  await commitHotelChange(env, [hotelWrite(HOTEL_COLLECTIONS.rooms, room.RoomId, payload, existing)]);
  await writeAudit(env, branchId, user, existing ? 'UPDATE' : 'CREATE', 'Room', room.RoomId, room.RoomNumber);
  return { ok: true, message: existing ? 'Room updated.' : 'Room created.', room: payload };
}

export async function saveHotelReservation(env, user, body = {}) {
  await requireHotelEdition(env, user);
  requireCapability(user, 'canManageReservations');
  const branchId = branchIdFor(user, body);
  const reservationInput = body.reservation || body.Reservation || body;
  const reservation = normalizeHotelReservation(reservationInput, branchId);
  const room = await getDocument(env, HOTEL_COLLECTIONS.rooms, safeId(reservation.RoomId)).catch(() => null);
  if (!room || clean(room.BranchId) !== branchId) throw inputError('The selected room does not exist in this branch.');
  if (hotelRoomUnavailableForBooking(room)) throw inputError('The selected room is not available for reservations.');
  if (!number(reservation.NightlyRate)) reservation.NightlyRate = Math.max(0, number(room.NightlyRate));
  if (reservation.Adults + reservation.Children > Math.max(1, number(room.Capacity))) throw inputError('The guest count exceeds the selected room capacity.');
  const existing = await getDocument(env, HOTEL_COLLECTIONS.reservations, safeId(reservation.ReservationId)).catch(() => null);
  if (existing && clean(existing.BranchId) !== branchId) throw inputError('That reservation belongs to another branch.', 403);
  assertNoKeyHandoff(existing);
  assertNoKeyHandoff(room);
  if (existing && !clean(reservationInput.Status || reservationInput.status)) reservation.Status = existing.Status;
  if (existing && ['checked out', 'cancelled', 'no show'].includes(lower(existing.Status))) throw inputError('A completed or cancelled reservation is locked.');
  if ((!existing && reservation.Status !== 'Reserved') || (existing && reservation.Status !== existing.Status)) {
    throw inputError('Use the reservation status action to check in, check out or cancel. Saving a reservation cannot change its status.', 409);
  }
  if (existing?.Status === 'Checked In' && clean(existing.RoomId) !== reservation.RoomId) throw inputError('A checked-in guest cannot be moved with the reservation editor.', 409);
  const reservations = await branchRows(env, HOTEL_COLLECTIONS.reservations, branchId);
  const conflict = reservations.find((row) => (
    clean(row.ReservationId) !== reservation.ReservationId &&
    clean(row.RoomId) === reservation.RoomId &&
    !['cancelled', 'no show', 'checked out'].includes(lower(row.Status)) &&
    reservation.ArrivalDate < clean(row.DepartureDate) &&
    reservation.DepartureDate > clean(row.ArrivalDate)
  ));
  if (conflict) throw inputError(`Room ${room.RoomNumber} is already reserved for part of that period.`, 409);
  const payload = {
    ...(existing || {}), ...reservation,
    RoomNumber: clean(room.RoomNumber),
    RoomType: clean(room.RoomType),
    CreatedAt: existing?.CreatedAt || nowIso(),
    CreatedBy: existing?.CreatedBy || actorName(user),
    UpdatedAt: nowIso(),
    UpdatedBy: actorName(user)
  };
  delete payload.__id; delete payload.__name; delete payload.__updateTime;
  const guards = [bookingRoomGuard(room, payload.UpdatedAt)];
  if (existing && clean(existing.RoomId) !== reservation.RoomId) {
    const previousRoom = await getDocument(env, HOTEL_COLLECTIONS.rooms, safeId(existing.RoomId));
    if (!previousRoom || clean(previousRoom.BranchId) !== branchId) throw inputError('The previous room could not be verified.', 409);
    guards.push(bookingRoomGuard(previousRoom, payload.UpdatedAt));
  }
  await commitHotelChange(env, [...guards, hotelWrite(HOTEL_COLLECTIONS.reservations, reservation.ReservationId, payload, existing)]);
  await writeAudit(env, branchId, user, existing ? 'UPDATE' : 'CREATE', 'Reservation', reservation.ReservationId, `${reservation.GuestName} | ${room.RoomNumber}`);
  return { ok: true, message: existing ? 'Reservation updated.' : 'Reservation created.', reservation: payload };
}

export async function changeHotelReservationStatus(env, user, body = {}) {
  await requireHotelEdition(env, user);
  requireCapability(user, 'canManageReservations');
  const branchId = branchIdFor(user, body);
  const reservationId = clean(body.ReservationId || body.reservationId);
  const status = normalizedStatus(body.Status || body.status, RESERVATION_STATUSES, 'reservation status');
  const reservation = await getDocument(env, HOTEL_COLLECTIONS.reservations, safeId(reservationId)).catch(() => null);
  if (!reservation || clean(reservation.BranchId) !== branchId) throw inputError('Reservation not found in this branch.', 404);
  assertNoKeyHandoff(reservation);
  const current = clean(reservation.Status);
  const allowed = {
    Reserved: new Set(['Checked In', 'Cancelled', 'No Show']),
    'Checked In': new Set(['Checked Out'])
  };
  if (!allowed[current]?.has(status)) throw inputError(`A ${current || 'new'} reservation cannot be changed to ${status}.`);
  const room = await getDocument(env, HOTEL_COLLECTIONS.rooms, safeId(reservation.RoomId)).catch(() => null);
  if (status === 'Checked In' && (!room || clean(room.BranchId) !== branchId || hotelRoomUnavailableForBooking(room))) {
    throw inputError('The room is unavailable. Complete maintenance or choose another room before check-in.', 409);
  }
  if (!room || clean(room.BranchId) !== branchId) throw inputError('The reservation room could not be verified.', 409);
  assertNoKeyHandoff(room);
  if (status === 'Checked In') {
    const stays = await branchRows(env, HOTEL_COLLECTIONS.reservations, branchId);
    if (stays.some(row => clean(row.ReservationId) !== reservationId && clean(row.RoomId) === clean(reservation.RoomId) && row.Status === 'Checked In')) {
      throw inputError('Another guest is still checked in to this room.', 409);
    }
  }
  if (status === 'Checked In' || status === 'Checked Out') {
    const [charges, payments] = await Promise.all([
      branchRows(env, HOTEL_COLLECTIONS.charges, branchId),
      branchRows(env, HOTEL_COLLECTIONS.payments, branchId)
    ]);
    const totals = hotelReservationTotals(reservation, charges, payments);
    if (totals.Balance > 0.005) {
      const action = status === 'Checked In' ? 'check-in' : 'check-out';
      throw inputError(`Full payment is required before ${action}. Balance: ${totals.Balance.toFixed(2)}.`, 409);
    }
  }
  const timestamp = nowIso();
  const payload = {
    ...reservation,
    Status: status,
    UpdatedAt: timestamp,
    UpdatedBy: actorName(user),
    ...(status === 'Checked In' ? { CheckedInAt: timestamp, CheckedInBy: actorName(user) } : {}),
    ...(status === 'Checked Out' ? { CheckedOutAt: timestamp, CheckedOutBy: actorName(user) } : {}),
    ...(status === 'Cancelled' ? { CancelledAt: timestamp, CancelledBy: actorName(user) } : {}),
    ...(status === 'No Show' ? { NoShowAt: timestamp, NoShowBy: actorName(user) } : {})
  };
  delete payload.__id; delete payload.__name; delete payload.__updateTime;
  const writes = [hotelWrite(HOTEL_COLLECTIONS.reservations, reservationId, payload, reservation)];
  if (room && clean(room.BranchId) === branchId) {
    const unavailable = hotelRoomUnavailableForBooking(room);
    const roomStatus = unavailable ? hotelRoomWithOperationalStatus(room).Status : status === 'Checked In'
      ? 'Occupied'
      : status === 'Checked Out'
        ? 'Available'
        : lower(room.Status) === 'occupied' ? clean(room.Status) : 'Available';
    const housekeepingStatus = status === 'Checked Out' && lower(room.HousekeepingStatus) !== 'maintenance'
      ? 'Dirty' : clean(room.HousekeepingStatus || 'Clean');
    const updatedRoom = { ...room, Status: roomStatus, HousekeepingStatus: housekeepingStatus, UpdatedAt: timestamp, UpdatedBy: actorName(user),
      ...(['Checked In', 'Checked Out'].includes(status) ? { KeyStocked: false } : {}) };
    delete updatedRoom.__id; delete updatedRoom.__name; delete updatedRoom.__updateTime;
    writes.push(hotelWrite(HOTEL_COLLECTIONS.rooms, reservation.RoomId, updatedRoom, room));
  }
  await commitHotelChange(env, writes);
  await writeAudit(env, branchId, user, 'STATUS', 'Reservation', reservationId, `${current} -> ${status}`);
  return { ok: true, message: `Reservation marked ${status}.`, reservation: payload };
}

export async function recordHotelCharge(env, user, body = {}) {
  await requireHotelEdition(env, user);
  requireCapability(user, 'canManageReservations');
  const branchId = branchIdFor(user, body);
  const reservationId = clean(body.ReservationId || body.reservationId);
  const description = clean(body.Description || body.description);
  const amount = Math.max(0, number(body.Amount ?? body.amount));
  if (!reservationId || !description || amount <= 0) throw inputError('Reservation, charge description and a positive amount are required.');
  const reservation = await getDocument(env, HOTEL_COLLECTIONS.reservations, safeId(reservationId)).catch(() => null);
  if (!reservation || clean(reservation.BranchId) !== branchId) throw inputError('Reservation not found in this branch.', 404);
  if (['checked out', 'cancelled', 'no show'].includes(lower(reservation.Status))) throw inputError('Charges cannot be added to a finalized reservation.', 409);
  assertNoKeyHandoff(reservation);
  const chargeId = safeId(body.ChargeId || body.chargeId || `CHG-${crypto.randomUUID()}`);
  const payload = {
    ChargeId: chargeId, ReservationId: reservationId, BranchId: branchId,
    Description: description, Amount: amount,
    ChargeDate: normalizeDate(body.ChargeDate || body.chargeDate || nowIso().slice(0, 10), 'Charge date'),
    CreatedAt: nowIso(), CreatedBy: actorName(user)
  };
  await commitHotelChange(env, [
    hotelWrite(HOTEL_COLLECTIONS.charges, chargeId, payload),
    hotelWrite(HOTEL_COLLECTIONS.reservations, reservationId,
      { ...reservation, BalanceRevisionAt: payload.CreatedAt }, reservation)
  ]);
  await writeAudit(env, branchId, user, 'CHARGE', 'Reservation', reservationId, `${description} | ${amount}`);
  return { ok: true, message: 'Guest charge recorded.', charge: payload };
}

export async function recordHotelPayment(env, user, body = {}) {
  const edition = await requireHotelEdition(env, user);
  requireCapability(user, 'canRecordPayments');
  const branchId = branchIdFor(user, body);
  const reservationId = clean(body.ReservationId || body.reservationId);
  const amount = Math.max(0, number(body.Amount ?? body.amount));
  if (!reservationId || amount <= 0) throw inputError('Reservation and a positive payment amount are required.');
  const reservation = await getDocument(env, HOTEL_COLLECTIONS.reservations, safeId(reservationId)).catch(() => null);
  if (!reservation || clean(reservation.BranchId) !== branchId) throw inputError('Reservation not found in this branch.', 404);
  if (['checked out', 'cancelled', 'no show'].includes(lower(reservation.Status))) throw inputError('Payments cannot be added to a finalized reservation.', 409);
  const [charges, existingPayments] = await Promise.all([
    branchRows(env, HOTEL_COLLECTIONS.charges, branchId),
    branchRows(env, HOTEL_COLLECTIONS.payments, branchId)
  ]);
  const outstanding = hotelReservationTotals(reservation, charges, existingPayments).Balance;
  if (amount - outstanding > 0.005) throw inputError(`Payment exceeds the outstanding guest balance of ${outstanding.toFixed(2)}.`, 409);
  const paymentId = safeId(body.PaymentId || body.paymentId || `PAY-${crypto.randomUUID()}`);
  const payload = {
    PaymentId: paymentId, ReservationId: reservationId, BranchId: branchId,
    GuestName: clean(reservation.GuestName), Amount: amount,
    Method: normalizedStatus(body.Method || body.method || 'Cash', PAYMENT_METHODS, 'payment method'),
    Reference: clean(body.Reference || body.reference),
    PaymentDate: normalizeDate(body.PaymentDate || body.paymentDate || nowIso().slice(0, 10), 'Payment date'),
    CreatedAt: nowIso(), CreatedBy: actorName(user)
  };
  const journalNo = `SYS-HOT-PAY-${paymentId}`;
  const accountCode = payload.Method === 'Cash' ? '1010' : payload.Method === 'Online' ? '1030' : '1020';
  const journal = {
    JournalNo: journalNo,
    Date: payload.PaymentDate,
    Status: 'Posted',
    Description: `Hotel payment - ${clean(reservation.GuestName)} - room ${clean(reservation.RoomNumber)}`,
    Reference: payload.Reference || paymentId,
    Source: 'Hotel Services Payment',
    SourceId: paymentId,
    RecordedBy: actorName(user),
    Department: 'Hotel Services',
    BranchId: branchId,
    OrganisationEdition: edition,
    Lines: [
      { AccountCode: accountCode, Debit: amount, Credit: 0, Description: 'Hotel guest payment', Department: 'Hotel Services' },
      { AccountCode: '4150', Debit: 0, Credit: amount, Description: 'Hotel services revenue', Department: 'Hotel Services' }
    ],
    TotalDebit: amount,
    TotalCredit: amount,
    CreatedAt: payload.CreatedAt,
    UpdatedAt: payload.CreatedAt
  };
  try {
    await batchCommitDocuments(env, [
      { collectionPath: HOTEL_COLLECTIONS.payments, documentId: paymentId, data: payload, exists: false },
      { collectionPath: 'accountingJournals', documentId: journalNo, data: journal, exists: false },
      hotelWrite(HOTEL_COLLECTIONS.reservations, reservationId,
        { ...reservation, BalanceRevisionAt: payload.CreatedAt }, reservation)
    ]);
  } catch (error) {
    if ([409, 412].includes(Number(error?.status))) throw inputError('That payment was already recorded or the guest balance changed. Refresh and try again.', 409);
    throw error;
  }
  await writeAudit(env, branchId, user, 'PAYMENT', 'Reservation', reservationId, `${payload.Method} | ${amount} | ${payload.Reference}`)
    .catch((error) => console.error(JSON.stringify({ event: 'hotel_payment_audit_failed', paymentId, message: error.message || String(error) })));
  return { ok: true, message: 'Guest payment recorded and posted to Finance and Accounting.', payment: payload, journal };
}

function completesHotelMaintenance(room, housekeepingStatus) {
  return lower(hotelRoomWithOperationalStatus(room).Status) === 'maintenance' && ['clean', 'inspected'].includes(lower(housekeepingStatus));
}

export function hotelRoomAfterHousekeeping(room, housekeepingStatus, hasCheckedInGuest = false) {
  const nextHousekeeping = normalizedStatus(housekeepingStatus, HOUSEKEEPING_STATUSES, 'housekeeping status');
  let roomStatus = hotelRoomWithOperationalStatus(room).Status;
  if (nextHousekeeping === 'Maintenance' && lower(roomStatus) !== 'out of service') roomStatus = 'Maintenance';
  else if (completesHotelMaintenance(room, nextHousekeeping)) {
    roomStatus = hasCheckedInGuest ? 'Occupied' : 'Available';
  }
  return { ...room, Status: roomStatus, HousekeepingStatus: nextHousekeeping };
}

async function resolveHotelHousekeepingRoom(env, room, housekeepingStatus, branchId) {
  // Maintenance temporarily hides occupancy. Check the actual stay before
  // releasing it, rather than assuming that a clean room must be vacant.
  const checkedInStays = completesHotelMaintenance(room, housekeepingStatus)
    ? await queryCollection(env, HOTEL_COLLECTIONS.reservations, {
      filters: [
        { field: 'BranchId', op: '==', value: branchId },
        { field: 'RoomId', op: '==', value: room.RoomId },
        { field: 'Status', op: '==', value: 'Checked In' }
      ],
      limit: 1
    })
    : [];
  return hotelRoomAfterHousekeeping(room, housekeepingStatus, checkedInStays.length > 0);
}

export async function setHotelHousekeepingStatus(env, user, body = {}) {
  await requireHotelEdition(env, user);
  requireCapability(user, 'canManageRooms');
  const branchId = branchIdFor(user, body);
  const roomId = clean(body.RoomId || body.roomId);
  const housekeepingStatus = normalizedStatus(body.HousekeepingStatus || body.housekeepingStatus, HOUSEKEEPING_STATUSES, 'housekeeping status');
  const room = await getDocument(env, HOTEL_COLLECTIONS.rooms, safeId(roomId)).catch(() => null);
  if (!room || clean(room.BranchId) !== branchId) throw inputError('Room not found in this branch.', 404);
  assertNoKeyHandoff(room);
  const timestamp = nowIso();
  const updatedRoom = {
    ...await resolveHotelHousekeepingRoom(env, { ...room, RoomId: roomId }, housekeepingStatus, branchId),
    UpdatedAt: timestamp, UpdatedBy: actorName(user)
  };
  delete updatedRoom.__id; delete updatedRoom.__name; delete updatedRoom.__updateTime;
  await commitHotelChange(env, [hotelWrite(HOTEL_COLLECTIONS.rooms, roomId, updatedRoom, room)]);
  const updateId = `HSK-${crypto.randomUUID()}`;
  await upsertDocument(env, HOTEL_COLLECTIONS.housekeeping, updateId, {
    UpdateId: updateId, RoomId: roomId, RoomNumber: clean(room.RoomNumber), BranchId: branchId,
    Status: housekeepingStatus, Notes: clean(body.Notes || body.notes), CreatedAt: timestamp, CreatedBy: actorName(user)
  });
  await writeAudit(env, branchId, user, 'HOUSEKEEPING', 'Room', roomId, housekeepingStatus);
  return { ok: true, message: `Room ${room.RoomNumber} marked ${housekeepingStatus}.`, room: updatedRoom };
}

function hotelQrSvg(value = '') {
  const qr = QRCode.create(clean(value), { errorCorrectionLevel: 'M' });
  const margin = 3;
  const size = qr.modules.size + (margin * 2);
  const modules = [];
  for (let row = 0; row < qr.modules.size; row += 1) {
    for (let column = 0; column < qr.modules.size; column += 1) {
      if (qr.modules.get(row, column)) modules.push(`M${column + margin} ${row + margin}h1v1h-1z`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="Hotel self-service booking QR code" shape-rendering="crispEdges"><path fill="#fff" d="M0 0h${size}v${size}H0z"/><path fill="#071b2c" d="${modules.join('')}"/></svg>`;
}

function publicHotelRoom(row = {}) {
  return {
    RoomId: clean(row.RoomId || row.__id),
    RoomNumber: clean(row.RoomNumber),
    RoomType: clean(row.RoomType),
    Capacity: Math.max(1, number(row.Capacity)),
    NightlyRate: Math.max(0, number(row.NightlyRate))
  };
}

function randomPaymentReference(code = 'ORG') {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const suffix = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase();
  return safeId(`HOT-${clean(code).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'ORG'}-${suffix}`);
}

export async function buildHotelSelfServiceQr(env, user, body = {}, requestOrigin = '') {
  const organization = await requireHotelOrganization(env);
  requireCapability(user, 'canManageReservations');
  const branchId = branchIdFor(user, body);
  let origin;
  try {
    origin = new URL(clean(requestOrigin));
  } catch {
    throw inputError('The public hotel booking address is unavailable on this deployment.', 503);
  }
  if (origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname)) {
    throw inputError('The public hotel booking address must use HTTPS.', 503);
  }
  const bookingUrl = `${origin.origin}/hotel-booking.html?branch=${encodeURIComponent(branchId)}`;
  return {
    bookingUrl,
    paymentLink: bookingUrl,
    branchId,
    organisationName: organization.Name,
    qrSvg: hotelQrSvg(bookingUrl)
  };
}

export async function getPublicHotelAvailability(env, body = {}) {
  const organization = await requireHotelOrganization(env);
  const branchId = clean(body.BranchId || body.branchId || 'main').toLowerCase() || 'main';
  const arrivalInput = clean(body.ArrivalDate || body.arrivalDate);
  const departureInput = clean(body.DepartureDate || body.departureDate);
  if (Boolean(arrivalInput) !== Boolean(departureInput)) throw inputError('Choose both arrival and departure dates.');
  const arrivalDate = arrivalInput ? normalizeDate(arrivalInput, 'Arrival date') : '';
  const departureDate = departureInput ? normalizeDate(departureInput, 'Departure date') : '';
  if (arrivalDate && nightsBetween(arrivalDate, departureDate) < 1) {
    throw inputError('Departure date must be after the arrival date.');
  }
  const [rooms, reservations, media] = await Promise.all([
    branchRows(env, HOTEL_COLLECTIONS.rooms, branchId),
    arrivalDate ? branchRows(env, HOTEL_COLLECTIONS.reservations, branchId) : Promise.resolve([]),
    publicRoomMedia(env, branchId)
  ]);
  const conflictingRoomIds = new Set(reservations.filter((row) => (
    !['cancelled', 'no show', 'checked out'].includes(lower(row.Status)) &&
    arrivalDate < clean(row.DepartureDate) &&
    departureDate > clean(row.ArrivalDate)
  )).map((row) => clean(row.RoomId)));
  const availableRooms = rooms
    .filter((row) => !hotelRoomUnavailableForBooking(row))
    .filter((row) => !conflictingRoomIds.has(clean(row.RoomId)))
    .map(publicHotelRoom)
    .sort((left, right) => left.RoomNumber.localeCompare(right.RoomNumber, undefined, { numeric: true }));
  return {
    ok: true,
    organisationName: organization.Name,
    branchId,
    currency: 'NGN',
    paymentRequiredBeforeCheckIn: true,
    arrivalDate,
    departureDate,
    roomTypes: media,
    rooms: availableRooms
  };
}

export async function initPublicHotelReservationPayment(env, body = {}, requestOrigin = '') {
  const organization = await requireHotelOrganization(env);
  if (clean(body.CompanyWebsite || body.companyWebsite)) throw inputError('The booking request could not be processed.');
  if (!clean(env.PAYSTACK_SECRET_KEY)) throw inputError('Online hotel payment is not configured yet.', 503);
  const branchId = clean(body.BranchId || body.branchId || 'main').toLowerCase() || 'main';
  const roomId = clean(body.RoomId || body.roomId);
  const room = await getDocument(env, HOTEL_COLLECTIONS.rooms, safeId(roomId)).catch(() => null);
  if (!room || clean(room.BranchId).toLowerCase() !== branchId) throw inputError('Choose an available room.');
  if (hotelRoomUnavailableForBooking(room)) throw inputError('That room is not currently available for booking.', 409);
  const paymentConfiguration = await branchPaymentConfiguration(env, branchId);
  if (!paymentConfiguration.online.enabled) throw inputError('Automated online payment is disabled for this branch.', 503);

  const reservationId = safeId(`RSV-WEB-${crypto.randomUUID()}`);
  const accessWrite = await guestAccessWrite(reservationId, branchId, body.GuestAccessToken);
  const reservation = normalizeHotelReservation({
    ReservationId: reservationId,
    GuestName: clean(body.GuestName || body.guestName).slice(0, 160),
    GuestPhone: clean(body.GuestPhone || body.guestPhone).slice(0, 40),
    GuestEmail: clean(body.GuestEmail || body.guestEmail).slice(0, 254),
    RoomId: roomId,
    ArrivalDate: body.ArrivalDate || body.arrivalDate,
    DepartureDate: body.DepartureDate || body.departureDate,
    Adults: body.Adults || body.adults || 1,
    Children: body.Children || body.children || 0,
    NightlyRate: room.NightlyRate,
    Status: 'Reserved',
    Source: 'Self-service QR',
    Notes: clean(body.Notes || body.notes).slice(0, 500)
  }, branchId);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(reservation.GuestEmail)) throw inputError('Enter a valid guest email address.');
  if (reservation.Adults + reservation.Children > Math.max(1, number(room.Capacity))) {
    throw inputError('The guest count exceeds the selected room capacity.');
  }
  const reservations = await branchRows(env, HOTEL_COLLECTIONS.reservations, branchId);
  const conflict = reservations.find((row) => (
    clean(row.RoomId) === reservation.RoomId &&
    !['cancelled', 'no show', 'checked out'].includes(lower(row.Status)) &&
    reservation.ArrivalDate < clean(row.DepartureDate) &&
    reservation.DepartureDate > clean(row.ArrivalDate)
  ));
  if (conflict) throw inputError(`Room ${room.RoomNumber} is no longer available for those dates.`, 409);

  const totals = hotelReservationTotals(reservation);
  if (totals.TotalAmount <= 0) throw inputError('This room does not have a payable rate. Please contact the hotel.', 409);
  const reference = randomPaymentReference(organization.Code);
  let origin;
  try {
    origin = new URL(clean(requestOrigin));
  } catch {
    throw inputError('The secure hotel payment address is unavailable.', 503);
  }
  if (origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname)) {
    throw inputError('The secure hotel payment address is unavailable.', 503);
  }
  const callbackUrl = `${origin.origin}/payment-success.html?type=hotel&source=public-hotel&branch=${encodeURIComponent(branchId)}&reference=${encodeURIComponent(reference)}`;
  const metadata = {
    paymentType: 'HotelReservation',
    hotelReservationId: reservationId,
    branchId,
    roomId,
    roomNumber: clean(room.RoomNumber),
    guestName: reservation.GuestName,
    guestEmail: reservation.GuestEmail,
    amount: totals.TotalAmount,
    currency: 'NGN'
  };
  const paystackResponse = await fetch(PAYSTACK_INIT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(withPaystackBranchRouting({
      email: reservation.GuestEmail,
      amount: Math.round(totals.TotalAmount * 100),
      currency: 'NGN',
      reference,
      callback_url: callbackUrl,
      metadata
    }, paymentConfiguration))
  });
  const paystackData = await paystackResponse.json().catch(() => null);
  if (!paystackResponse.ok || !paystackData?.status) {
    throw inputError(`Could not start hotel payment. ${paystackData?.message || 'Payment gateway returned an error.'}`);
  }
  const authorizationUrl = clean(paystackData.data?.authorization_url);
  if (!/^https:\/\/[A-Za-z0-9.-]+(?:\/|$)/.test(authorizationUrl)) {
    throw inputError('The payment gateway did not return a secure payment address.', 502);
  }
  const timestamp = nowIso();
  const storedReservation = {
    ...reservation,
    RoomNumber: clean(room.RoomNumber),
    RoomType: clean(room.RoomType),
    PaymentStatus: 'Pending',
    PaymentReference: reference,
    PaystackSubaccountCode: paymentConfiguration.paystack.subaccountCode,
    PaystackSettlementMode: paymentConfiguration.paystack.settlementMode,
    PaymentLink: authorizationUrl,
    CreatedAt: timestamp,
    CreatedBy: 'Public hotel self-service',
    UpdatedAt: timestamp,
    UpdatedBy: 'Public hotel self-service'
  };
  const intent = {
    PaymentType: 'HotelReservation',
    Reference: reference,
    ReservationId: reservationId,
    BranchId: branchId,
    RoomId: roomId,
    AccountRef: reservationId,
    Amount: totals.TotalAmount,
    Currency: 'NGN',
    PaystackSubaccountCode: paymentConfiguration.paystack.subaccountCode,
    PaystackSettlementMode: paymentConfiguration.paystack.settlementMode,
    Status: 'Pending',
    CreatedAt: timestamp,
    Metadata: metadata
  };
  try {
    await batchCommitDocuments(env, [
      bookingRoomGuard(room, timestamp),
      { collectionPath: HOTEL_COLLECTIONS.reservations, documentId: reservationId, data: storedReservation, exists: false },
      { collectionPath: 'paymentIntents', documentId: safeId(reference), data: intent, exists: false },
      ...(accessWrite ? [accessWrite] : [])
    ]);
  } catch (error) {
    error.status = 502;
    error.retryable = true;
    throw error;
  }
  await writeAudit(env, branchId, {
    role: 'Public Self-Service', username: 'public-hotel', displayName: 'Public hotel self-service'
  }, 'ONLINE INIT', 'Reservation', reservationId, `${reservation.GuestName} | ${room.RoomNumber} | ${reference}`).catch(() => null);
  return {
    ok: true,
    message: 'Reservation created. Continue to secure online payment.',
    authorizationUrl,
    reference,
    reservationId,
    amount: totals.TotalAmount,
    currency: 'NGN'
  };
}

export async function finalizeHotelOnlinePayment(env, intent = {}, settlement = {}) {
  await requireHotelEdition(env);
  const reservationId = clean(intent.ReservationId || intent.hotelReservationId);
  const branchId = clean(intent.BranchId || intent.branchId || 'main').toLowerCase() || 'main';
  const reference = clean(settlement.Reference || settlement.reference || intent.Reference);
  const amount = Math.max(0, number(settlement.GrossAmount ?? settlement.Amount ?? intent.Amount));
  if (!reservationId || !reference || amount <= 0) throw inputError('The verified hotel payment is incomplete.', 409);
  const reservation = await getDocument(env, HOTEL_COLLECTIONS.reservations, safeId(reservationId)).catch(() => null);
  if (!reservation || clean(reservation.BranchId).toLowerCase() !== branchId) {
    throw inputError('The hotel reservation for this payment was not found.', 409);
  }
  const paymentId = safeId(`PAYSTACK-${reference}`);
  const existingPayment = await getDocument(env, HOTEL_COLLECTIONS.payments, paymentId).catch(() => null);
  if (existingPayment) {
    if (clean(existingPayment.ReservationId) !== reservationId || Math.abs(number(existingPayment.Amount) - amount) > 0.01) {
      throw inputError('That online payment reference is already linked to another hotel payment.', 409);
    }
    return { ok: true, payment: existingPayment, reservation };
  }
  const paidAt = clean(settlement.PaidAt) || nowIso();
  const suppliedFee = Math.max(0, number(settlement.GatewayFee));
  const suppliedNet = number(settlement.NetAmount);
  const netAmount = Math.min(amount, suppliedNet > 0 ? suppliedNet : Math.max(0, amount - suppliedFee));
  const gatewayFee = Math.max(0, amount - netAmount);
  const payment = {
    PaymentId: paymentId,
    ReservationId: reservationId,
    BranchId: branchId,
    GuestName: clean(reservation.GuestName),
    Amount: amount,
    GrossAmount: amount,
    GatewayFee: gatewayFee,
    NetAmount: netAmount,
    Currency: clean(settlement.Currency || intent.Currency || 'NGN').toUpperCase(),
    Method: 'Online',
    Gateway: 'Paystack',
    Reference: reference,
    GatewayReference: reference,
    PaymentDate: paidAt.slice(0, 10),
    PaidAt: paidAt,
    CreatedAt: nowIso(),
    CreatedBy: 'Paystack Verification'
  };
  const journalNo = safeId(`SYS-HOT-PAY-${paymentId}`);
  const journal = {
    JournalNo: journalNo,
    Date: payment.PaymentDate,
    Status: 'Posted',
    Description: `Hotel online payment - ${clean(reservation.GuestName)} - room ${clean(reservation.RoomNumber)}`,
    Reference: reference,
    Source: 'Hotel Services Payment',
    SourceId: paymentId,
    RecordedBy: 'Paystack Verification',
    Department: 'Hotel Services',
    BranchId: branchId,
    Lines: [
      { AccountCode: '1030', Debit: netAmount, Credit: 0, Description: 'Hotel online payment settlement', Department: 'Hotel Services' },
      ...(gatewayFee > 0 ? [{ AccountCode: '6060', Debit: gatewayFee, Credit: 0, Description: 'Online payment transaction charge', Department: 'Hotel Services' }] : []),
      { AccountCode: '4150', Debit: 0, Credit: amount, Description: 'Hotel services revenue', Department: 'Hotel Services' }
    ],
    TotalDebit: amount,
    TotalCredit: amount,
    CreatedAt: payment.CreatedAt,
    UpdatedAt: payment.CreatedAt
  };
  const [charges, payments] = await Promise.all([
    branchRows(env, HOTEL_COLLECTIONS.charges, branchId),
    branchRows(env, HOTEL_COLLECTIONS.payments, branchId)
  ]);
  const totals = hotelReservationTotals(reservation, charges, [...payments, payment]);
  const updatedReservation = {
    ...reservation,
    PaymentStatus: totals.Balance <= 0.005 ? 'Paid' : 'Part Paid',
    OnlinePaidAt: paidAt,
    PaymentReference: reference,
    BalanceRevisionAt: payment.CreatedAt,
    UpdatedAt: nowIso(),
    UpdatedBy: 'Paystack Verification'
  };
  delete updatedReservation.__id;
  delete updatedReservation.__name;
  delete updatedReservation.__updateTime;
  try {
    await batchCommitDocuments(env, [
      { collectionPath: HOTEL_COLLECTIONS.payments, documentId: paymentId, data: payment, exists: false },
      { collectionPath: 'accountingJournals', documentId: journalNo, data: journal, exists: false },
      hotelWrite(HOTEL_COLLECTIONS.reservations, reservationId, updatedReservation, reservation)
    ]);
  } catch (error) {
    if (![409, 412].includes(Number(error?.status))) throw error;
    const recorded = await getDocument(env, HOTEL_COLLECTIONS.payments, paymentId).catch(() => null);
    if (!recorded) throw error;
    if (clean(recorded.ReservationId) !== reservationId || Math.abs(number(recorded.Amount) - amount) > 0.01) {
      throw inputError('That online payment reference is already linked to another hotel payment.', 409);
    }
    return { ok: true, payment: recorded, reservation: await getDocument(env, HOTEL_COLLECTIONS.reservations, safeId(reservationId)) };
  }
  await writeAudit(env, branchId, {
    role: 'Payment Gateway', username: 'paystack', displayName: 'Paystack Verification'
  }, 'PAYMENT', 'Reservation', reservationId, `Online | ${amount} | ${reference}`).catch(() => null);
  return { ok: true, payment, reservation: { ...totals, ...updatedReservation }, journal };
}

export async function handleHotelAction(env, user, body = {}) {
  const action = lower(body.action || body.Action || 'list');
  if (['list', 'gethotelservices'].includes(action)) return listHotelServices(env, user, body);
  if (['saveroom', 'savehotelroom'].includes(action)) await saveHotelRoom(env, user, body);
  else if (['savereservation', 'savehotelreservation'].includes(action)) await saveHotelReservation(env, user, body);
  else if (['changereservationstatus', 'changehotelreservationstatus'].includes(action)) await changeHotelReservationStatus(env, user, body);
  else if (['recordcharge', 'recordhotelcharge'].includes(action)) await recordHotelCharge(env, user, body);
  else if (['recordpayment', 'recordhotelpayment'].includes(action)) await recordHotelPayment(env, user, body);
  else if (['sethousekeepingstatus', 'sethotelhousekeepingstatus'].includes(action)) await setHotelHousekeepingStatus(env, user, body);
  else {
    const extra = await hotelSelfServiceAction(env, user, body);
    return { ...await listHotelServices(env, user, body), ...extra };
  }
  const result = await listHotelServices(env, user, body);
  result.message = ({
    saveroom: 'Room saved.', savehotelroom: 'Room saved.',
    savereservation: 'Reservation saved.', savehotelreservation: 'Reservation saved.',
    changereservationstatus: 'Reservation status updated.', changehotelreservationstatus: 'Reservation status updated.',
    recordcharge: 'Guest charge recorded.', recordhotelcharge: 'Guest charge recorded.',
    recordpayment: 'Guest payment recorded and posted to Finance and Accounting.', recordhotelpayment: 'Guest payment recorded and posted to Finance and Accounting.',
    sethousekeepingstatus: 'Housekeeping status updated.', sethotelhousekeepingstatus: 'Housekeeping status updated.'
  })[action];
  return result;
}
