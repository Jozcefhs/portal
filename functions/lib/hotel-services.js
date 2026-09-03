import {
  batchCommitDocuments,
  createDocumentIfAbsent,
  getDocument,
  queryCollection,
  upsertDocument
} from './firestore.js';
import { normalizeOrganizationEdition, resolveOrganizationConfig } from './organization-config.js';

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

function branchIdFor(user = {}, body = {}) {
  return clean(body.BranchId || body.branchId || user.branchId || user.BranchId || user.UserBranchId) || 'main';
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

function requireCapability(user, capability) {
  const capabilities = hotelCapabilities(user);
  if (!capabilities[capability]) throw inputError('This staff account is not allowed to perform that hotel action.', 403);
  return capabilities;
}

async function requireHotelEdition(env, user = {}) {
  const requested = clean(user.edition || user.OrganisationEdition || user.OrganizationEdition);
  const edition = normalizeOrganizationEdition(requested || resolveOrganizationConfig({ env }).Edition);
  if (!['faith', 'organization'].includes(edition)) {
    throw inputError('Hotel Services is available only to Religious Organisations and Other Organisations.', 403);
  }
  return edition;
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

async function branchRows(env, collection, branchId) {
  return queryCollection(env, collection, {
    filters: [{ field: 'BranchId', op: '==', value: branchId }],
    limit: 1000
  });
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
  return {
    RoomId: roomId,
    BranchId: branchId,
    RoomNumber: roomNumber,
    RoomType: clean(input.RoomType || input.roomType) || 'Standard',
    Capacity: capacity,
    NightlyRate: nightlyRate,
    Status: normalizedStatus(input.Status || input.status || 'Available', ROOM_STATUSES, 'room status'),
    HousekeepingStatus: normalizedStatus(input.HousekeepingStatus || input.housekeepingStatus || 'Clean', HOUSEKEEPING_STATUSES, 'housekeeping status'),
    Notes: clean(input.Notes || input.notes)
  };
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

export async function listHotelServices(env, user, body = {}) {
  const edition = await requireHotelEdition(env, user);
  const capabilities = requireCapability(user, 'canView');
  const branchId = branchIdFor(user, body);
  const [rooms, reservations, charges, payments, housekeeping, audit] = await Promise.all([
    branchRows(env, HOTEL_COLLECTIONS.rooms, branchId),
    branchRows(env, HOTEL_COLLECTIONS.reservations, branchId),
    branchRows(env, HOTEL_COLLECTIONS.charges, branchId),
    branchRows(env, HOTEL_COLLECTIONS.payments, branchId),
    branchRows(env, HOTEL_COLLECTIONS.housekeeping, branchId),
    capabilities.canViewAudit ? branchRows(env, HOTEL_COLLECTIONS.audit, branchId) : Promise.resolve([])
  ]);
  const decoratedReservations = reservations.map((row) => hotelReservationTotals(row, charges, payments));
  return {
    ok: true,
    edition,
    branchId,
    capabilities,
    rooms: rooms.sort((a, b) => clean(a.RoomNumber).localeCompare(clean(b.RoomNumber), undefined, { numeric: true })),
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
  const payload = {
    ...(existing || {}), ...room,
    CreatedAt: existing?.CreatedAt || nowIso(),
    CreatedBy: existing?.CreatedBy || actorName(user),
    UpdatedAt: nowIso(),
    UpdatedBy: actorName(user)
  };
  delete payload.__id; delete payload.__name; delete payload.__updateTime;
  await upsertDocument(env, HOTEL_COLLECTIONS.rooms, safeId(room.RoomId), payload);
  await writeAudit(env, branchId, user, existing ? 'UPDATE' : 'CREATE', 'Room', room.RoomId, room.RoomNumber);
  return { ok: true, message: existing ? 'Room updated.' : 'Room created.', room: payload };
}

export async function saveHotelReservation(env, user, body = {}) {
  await requireHotelEdition(env, user);
  requireCapability(user, 'canManageReservations');
  const branchId = branchIdFor(user, body);
  const reservation = normalizeHotelReservation(body.reservation || body.Reservation || body, branchId);
  const room = await getDocument(env, HOTEL_COLLECTIONS.rooms, safeId(reservation.RoomId)).catch(() => null);
  if (!room || clean(room.BranchId) !== branchId) throw inputError('The selected room does not exist in this branch.');
  if (['maintenance', 'out of service'].includes(lower(room.Status))) throw inputError('The selected room is not available for reservations.');
  if (!number(reservation.NightlyRate)) reservation.NightlyRate = Math.max(0, number(room.NightlyRate));
  if (reservation.Adults + reservation.Children > Math.max(1, number(room.Capacity))) throw inputError('The guest count exceeds the selected room capacity.');
  const existing = await getDocument(env, HOTEL_COLLECTIONS.reservations, safeId(reservation.ReservationId)).catch(() => null);
  if (existing && clean(existing.BranchId) !== branchId) throw inputError('That reservation belongs to another branch.', 403);
  if (existing && ['checked out', 'cancelled'].includes(lower(existing.Status))) throw inputError('A checked-out or cancelled reservation is locked.');
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
  await upsertDocument(env, HOTEL_COLLECTIONS.reservations, safeId(reservation.ReservationId), payload);
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
  const current = clean(reservation.Status);
  const allowed = {
    Reserved: new Set(['Checked In', 'Cancelled', 'No Show']),
    'Checked In': new Set(['Checked Out'])
  };
  if (!allowed[current]?.has(status)) throw inputError(`A ${current || 'new'} reservation cannot be changed to ${status}.`);
  if (status === 'Checked Out') {
    const [charges, payments] = await Promise.all([
      branchRows(env, HOTEL_COLLECTIONS.charges, branchId),
      branchRows(env, HOTEL_COLLECTIONS.payments, branchId)
    ]);
    const balance = hotelReservationTotals(reservation, charges, payments).Balance;
    if (balance > 0.005) throw inputError(`Record the outstanding guest balance before check-out. Balance: ${balance.toFixed(2)}.`, 409);
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
  await upsertDocument(env, HOTEL_COLLECTIONS.reservations, safeId(reservationId), payload);
  const room = await getDocument(env, HOTEL_COLLECTIONS.rooms, safeId(reservation.RoomId)).catch(() => null);
  if (room && clean(room.BranchId) === branchId) {
    const roomStatus = status === 'Checked In'
      ? 'Occupied'
      : status === 'Checked Out'
        ? 'Cleaning'
        : lower(room.Status) === 'occupied' ? clean(room.Status) : 'Available';
    const housekeepingStatus = status === 'Checked Out' ? 'Dirty' : clean(room.HousekeepingStatus || 'Clean');
    const updatedRoom = { ...room, Status: roomStatus, HousekeepingStatus: housekeepingStatus, UpdatedAt: timestamp, UpdatedBy: actorName(user) };
    delete updatedRoom.__id; delete updatedRoom.__name; delete updatedRoom.__updateTime;
    await upsertDocument(env, HOTEL_COLLECTIONS.rooms, safeId(reservation.RoomId), updatedRoom);
  }
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
  const chargeId = safeId(body.ChargeId || body.chargeId || `CHG-${crypto.randomUUID()}`);
  const payload = {
    ChargeId: chargeId, ReservationId: reservationId, BranchId: branchId,
    Description: description, Amount: amount,
    ChargeDate: normalizeDate(body.ChargeDate || body.chargeDate || nowIso().slice(0, 10), 'Charge date'),
    CreatedAt: nowIso(), CreatedBy: actorName(user)
  };
  const result = await createDocumentIfAbsent(env, HOTEL_COLLECTIONS.charges, chargeId, payload);
  if (!result.created) throw inputError('That hotel charge has already been recorded.', 409);
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
      { AccountCode: '4140', Debit: 0, Credit: amount, Description: 'Hotel services revenue', Department: 'Hotel Services' }
    ],
    TotalDebit: amount,
    TotalCredit: amount,
    CreatedAt: payload.CreatedAt,
    UpdatedAt: payload.CreatedAt
  };
  try {
    await batchCommitDocuments(env, [
      { collectionPath: HOTEL_COLLECTIONS.payments, documentId: paymentId, data: payload, exists: false },
      { collectionPath: 'accountingJournals', documentId: journalNo, data: journal, exists: false }
    ]);
  } catch (error) {
    if ([409, 412].includes(Number(error?.status))) throw inputError('That hotel payment has already been recorded.', 409);
    throw error;
  }
  await writeAudit(env, branchId, user, 'PAYMENT', 'Reservation', reservationId, `${payload.Method} | ${amount} | ${payload.Reference}`)
    .catch((error) => console.error(JSON.stringify({ event: 'hotel_payment_audit_failed', paymentId, message: error.message || String(error) })));
  return { ok: true, message: 'Guest payment recorded and posted to Finance and Accounting.', payment: payload, journal };
}

export async function setHotelHousekeepingStatus(env, user, body = {}) {
  await requireHotelEdition(env, user);
  requireCapability(user, 'canManageRooms');
  const branchId = branchIdFor(user, body);
  const roomId = clean(body.RoomId || body.roomId);
  const housekeepingStatus = normalizedStatus(body.HousekeepingStatus || body.housekeepingStatus, HOUSEKEEPING_STATUSES, 'housekeeping status');
  const room = await getDocument(env, HOTEL_COLLECTIONS.rooms, safeId(roomId)).catch(() => null);
  if (!room || clean(room.BranchId) !== branchId) throw inputError('Room not found in this branch.', 404);
  const timestamp = nowIso();
  const roomStatus = housekeepingStatus === 'Clean' || housekeepingStatus === 'Inspected'
    ? (lower(room.Status) === 'cleaning' ? 'Available' : clean(room.Status))
    : housekeepingStatus === 'Maintenance' ? 'Maintenance' : clean(room.Status);
  const updatedRoom = { ...room, HousekeepingStatus: housekeepingStatus, Status: roomStatus, UpdatedAt: timestamp, UpdatedBy: actorName(user) };
  delete updatedRoom.__id; delete updatedRoom.__name; delete updatedRoom.__updateTime;
  await upsertDocument(env, HOTEL_COLLECTIONS.rooms, safeId(roomId), updatedRoom);
  const updateId = `HSK-${crypto.randomUUID()}`;
  await upsertDocument(env, HOTEL_COLLECTIONS.housekeeping, updateId, {
    UpdateId: updateId, RoomId: roomId, RoomNumber: clean(room.RoomNumber), BranchId: branchId,
    Status: housekeepingStatus, Notes: clean(body.Notes || body.notes), CreatedAt: timestamp, CreatedBy: actorName(user)
  });
  await writeAudit(env, branchId, user, 'HOUSEKEEPING', 'Room', roomId, housekeepingStatus);
  return { ok: true, message: `Room ${room.RoomNumber} marked ${housekeepingStatus}.`, room: updatedRoom };
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
  else throw inputError('Choose a valid Hotel Services action.');
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
