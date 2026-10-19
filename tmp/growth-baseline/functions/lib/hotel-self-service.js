import { getDocument } from './firestore.js';
import { branchIdFor, branchRows, hotelWrite, commitHotelChange, requireCapability, requireHotelOrganization, hotelReservationTotals } from './hotel-services.js';
import { putStoredDocument, parseStoredDocumentReference, requireDocumentStorage } from './document-storage.js';
import { secureSecretEqual } from './request-security.js';

const clean = value => String(value ?? '').trim();
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const now = () => new Date().toISOString();
const hex = bytes => [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, '0')).join('');
const randomSecret = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export const HOTEL_MEDIA_MAX_BYTES = 8 * 1024 * 1024;
const DEVICE_COLLECTION = 'hotelKeyDevices';
const ACCESS_COLLECTION = 'hotelGuestAccess';
const CODE_COLLECTION = 'hotelKeyCodes';
const COMMAND_COLLECTION = 'hotelKeyCommands';
export const hotelHash = async text => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
const deviceIdFor = branch => hotelHash(`hotel-device:${branch}`);
const mediaIdFor = (branch, type) => hotelHash(`hotel-media:${branch}:${type.toLowerCase()}`);
const read = (env, collection, id) => getDocument(env, collection, id);
const write = hotelWrite;

export function assertNoKeyHandoff(record) {
  if (record?.KeyCommandId) fail('A physical key handoff is in progress or needs inspection. Resolve it in Key dispenser before changing this record.', 409);
}

function audit(branch, user, action, entityId, details) {
  const id = `HOT-KEY-${crypto.randomUUID()}`;
  return write('hotelAudit', id, { AuditId: id, BranchId: branch, Timestamp: now(), Action: action,
    EntityType: 'Self-service', EntityId: entityId, Details: details,
    Actor: clean(user?.username || user?.displayName || 'Key dispenser'), ActorRole: clean(user?.role || 'Device') });
}

async function secretHmac(env, purpose, text) {
  const secret = clean(env.HOTEL_KEY_SECRET || env.STAFF_SESSION_SECRET || env.BACKEND_SHARED_SECRET);
  if (!secret) fail('Secure hotel collection is not configured.', 503);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`hotel-v1:${purpose}:${text}`)));
}

async function codeFor(env, token, reservationId, version) {
  const bytes = await secretHmac(env, 'display-code', `${token}:${reservationId}:${version}`);
  // A deterministic, secret-keyed code lets the authenticated guest retrieve it
  // without storing the six digits in Firestore or exposing them in staff lists.
  return String(new DataView(bytes.buffer).getUint32(0) % 1000000).padStart(6, '0');
}
const codeIdFor = async (env, branch, code) => hex(await secretHmac(env, 'lookup-code', `${branch}:${code}`));

export async function guestAccessWrite(reservationId, branch, token) {
  if (!token) return null; // Older public booking clients remain supported.
  if (!/^[a-f0-9]{64}$/.test(token)) fail('The secure booking token is invalid. Reload the booking page.');
  return write(ACCESS_COLLECTION, reservationId, { ReservationId: reservationId, BranchId: branch,
    TokenHash: await hotelHash(token), CodeVersion: 0, CreatedAt: now() });
}

export async function publicRoomMedia(env, branch) {
  return (await branchRows(env, 'hotelRoomMedia', branch)).filter(row => row.Reference).map(row => ({
    RoomType: row.RoomType, Description: row.Description, MediaType: row.MediaType,
    MediaUrl: `/api/hotel-room-media?id=${encodeURIComponent(row.MediaId)}`
  }));
}

export async function hotelSelfServiceData(env, branch, capabilities) {
  const [roomTypes, device] = await Promise.all([publicRoomMedia(env, branch), read(env, DEVICE_COLLECTION, await deviceIdFor(branch))]);
  return { roomTypes, keyDispenser: device ? {
    DeviceId: device.DeviceId, Name: device.Name, Enabled: device.Enabled === true,
    CheckInHour: device.CheckInHour, CheckOutHour: device.CheckOutHour, UtcOffsetMinutes: device.UtcOffsetMinutes,
    ActiveCommandId: device.ActiveCommandId || '', LastSeenAt: device.LastSeenAt || '',
    ...(capabilities.canManageRooms ? { TokenConfigured: Boolean(device.TokenHash) } : {})
  } : null };
}

export function validateHotelMedia(base64, mime) {
  if (!['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'].includes(mime)) fail('Use a JPG, PNG, WebP, MP4 or WebM file.');
  if (!base64 || base64.length > Math.ceil(HOTEL_MEDIA_MAX_BYTES / 3) * 4 + 4) fail('Room media must be no larger than 8 MB.', 413);
  let bytes;
  try {
    const binary = atob(base64);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  } catch { fail('The media file could not be decoded.'); }
  if (bytes.length < 12 || bytes.length > HOTEL_MEDIA_MAX_BYTES) fail('The media file is empty or larger than 8 MB.', 413);
  const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end));
  const valid = mime === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : mime === 'image/png' ? hex(bytes.slice(0, 8)) === '89504e470d0a1a0a'
    : mime === 'image/webp' ? ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP'
    : mime === 'video/mp4' ? ascii(4, 8) === 'ftyp'
    : hex(bytes.slice(0, 4)) === '1a45dfa3';
  if (!valid) fail('The file contents do not match its media type.');
  return bytes;
}

async function saveMedia(env, user, body, branch) {
  const type = clean(body.RoomType).slice(0, 100);
  if (!type) fail('Select a room type.');
  if (!(await branchRows(env, 'hotelRooms', branch)).some(r => clean(r.RoomType).toLowerCase() === type.toLowerCase())) fail('Create a room of this type in this branch first.');
  const id = await mediaIdFor(branch, type);
  const old = await read(env, 'hotelRoomMedia', id);
  const mime = clean(body.MimeType).toLowerCase();
  const stored = body.Remove === true ? null : await putStoredDocument(env, {
    bytes: validateHotelMedia(clean(body.FileBase64), mime), mimeType: mime,
    fileName: `room.${({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm' })[mime]}`,
    operationId: crypto.randomUUID(), branchId: branch, category: 'hotel-room-media', ownerId: id, documentType: 'public-showcase'
  });
  // Keep the previous object recoverable; only the current approved reference is public.
  await commitHotelChange(env, [write('hotelRoomMedia', id, { MediaId: id, BranchId: branch, RoomType: type,
    Description: clean(body.Description).slice(0, 600), Reference: stored?.reference || '',
    MediaType: mime.startsWith('video/') ? 'video' : 'image', MimeType: stored ? mime : '', UpdatedAt: now() }, old),
  audit(branch, user, 'ROOM MEDIA', id, stored ? 'Room-type showcase published' : 'Room-type showcase removed')]);
  return { message: stored ? 'Room-type media published.' : 'Room-type media removed.' };
}

export async function hotelRoomMediaResponse(env, request) {
  await requireHotelOrganization(env);
  const id = new URL(request.url).searchParams.get('id');
  if (!/^[a-f0-9]{64}$/.test(id || '')) fail('Room media not found.', 404);
  const media = await read(env, 'hotelRoomMedia', id);
  if (!media?.Reference) fail('Room media not found.', 404);
  const { key } = parseStoredDocumentReference(env, media.Reference);
  const bucket = requireDocumentStorage(env);
  const metadata = await bucket.head(key);
  if (!metadata) fail('Room media not found.', 404);
  let range;
  const rawRange = request.headers.get('Range');
  if (rawRange) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rawRange);
    if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${metadata.size}` } });
    const start = match[1] ? Number(match[1]) : Math.max(0, metadata.size - Number(match[2]));
    const end = match[1] && match[2] ? Math.min(Number(match[2]), metadata.size - 1) : metadata.size - 1;
    if (start > end || start >= metadata.size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${metadata.size}` } });
    range = { offset: start, length: end - start + 1 };
  }
  const object = await bucket.get(key, range ? { range } : {});
  if (!object) fail('Room media not found.', 404);
  return new Response(object.body, { status: range ? 206 : 200, headers: {
    'Content-Type': media.MimeType, 'Content-Length': String(range?.length || object.size), 'Accept-Ranges': 'bytes',
    ...(range ? { 'Content-Range': `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}` } : {}),
    'Cache-Control': 'public, max-age=60', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy': "sandbox; default-src 'none'", 'ETag': object.httpEtag
  } });
}

function boundedInteger(value, fallback, min, max) {
  const number = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(number) || number < min || number > max) fail('Check-in/out hours or UTC offset are invalid.');
  return number;
}

export async function hotelSelfServiceAction(env, user, body) {
  await requireHotelOrganization(env);
  requireCapability(user, 'canManageRooms');
  const branch = branchIdFor(user, body);
  const action = clean(body.action || body.Action).toLowerCase();
  if (action === 'savehotelroommedia') return saveMedia(env, user, body, branch);
  const id = await deviceIdFor(branch);
  const device = await read(env, DEVICE_COLLECTION, id);
  if (action === 'savehotelkeydevice') {
    if (device?.ActiveCommandId && (body.RotateToken === true || body.Enabled === true)) fail('Resolve the active key handoff before rotating credentials or enabling the dispenser.', 409);
    const token = !device || body.RotateToken === true ? randomSecret() : '';
    const updated = { ...device, DeviceId: id, BranchId: branch, Name: clean(body.Name || device?.Name || 'Reception key dispenser').slice(0, 100),
      Enabled: body.Enabled === true, TokenHash: token ? await hotelHash(token) : device.TokenHash,
      CheckInHour: boundedInteger(body.CheckInHour, device?.CheckInHour ?? 14, 0, 23),
      CheckOutHour: boundedInteger(body.CheckOutHour, device?.CheckOutHour ?? 12, 1, 23),
      UtcOffsetMinutes: boundedInteger(body.UtcOffsetMinutes, device?.UtcOffsetMinutes ?? 60, -720, 840), UpdatedAt: now() };
    await commitHotelChange(env, [write(DEVICE_COLLECTION, id, updated, device), audit(branch, user, 'DEVICE SETUP', id, updated.Enabled ? 'Enabled' : 'Disabled')]);
    return { message: 'Dispenser settings saved. Store a new device token securely; it is shown only once.', ...(token ? { deviceToken: token } : {}) };
  }
  if (!device) fail('Register a dispenser first.');
  if (action === 'savehotelkeyslot') {
    if (device.ActiveCommandId) fail('Resolve the active key handoff before changing slots.', 409);
    const room = await read(env, 'hotelRooms', clean(body.RoomId));
    if (!room || room.BranchId !== branch) fail('Room not found in this branch.', 404);
    assertNoKeyHandoff(room);
    const slot = clean(body.KeySlot);
    if (slot && !/^[A-Za-z0-9_-]{1,32}$/.test(slot)) fail('Use 1–32 letters, numbers, hyphens or underscores for the slot.');
    const rooms = await branchRows(env, 'hotelRooms', branch);
    if (slot && rooms.some(r => r.RoomId !== room.RoomId && clean(r.KeySlot).toLowerCase() === slot.toLowerCase())) fail('That slot is already assigned to another room.', 409);
    const stocked = body.KeyStocked === true;
    if (stocked && (!slot || body.PhysicalKeyConfirmed !== true)) fail('Confirm that the correct physical room key is in this slot.');
    if (stocked && (room.Status !== 'Available' || !['Clean', 'Inspected'].includes(room.HousekeepingStatus))) fail('Only load a key for an available, clean or inspected room.', 409);
    const stays = stocked ? await branchRows(env, 'hotelReservations', branch) : [];
    if (stays.some(r => r.RoomId === room.RoomId && r.Status === 'Checked In')) fail('A guest is still checked in to this room.', 409);
    await commitHotelChange(env, [write('hotelRooms', room.RoomId, { ...room, KeySlot: slot, KeyStocked: stocked, UpdatedAt: now() }, room),
      write(DEVICE_COLLECTION, id, { ...device, UpdatedAt: now() }, device), audit(branch, user, 'KEY SLOT', room.RoomId, `${slot || 'Unmapped'}: ${stocked ? 'physical key confirmed' : 'empty'}`)]);
    return { message: 'Room key slot updated.' };
  }
  if (action === 'resolvehotelkeycommand') {
    if (!device.ActiveCommandId || device.Enabled) fail('Disable the dispenser, then inspect the machine and resolve its active handoff.', 409);
    if (clean(body.Reason).length < 10 || body.PhysicalInspection !== true) fail('Confirm physical inspection and enter a clear explanation (at least 10 characters).');
    if (!['released', 'not-released'].includes(body.Outcome)) fail('Confirm whether the key was physically released.');
    const command = await read(env, COMMAND_COLLECTION, device.ActiveCommandId);
    if (!command || command.BranchId !== branch) fail('The active command could not be verified.', 409);
    return finishCommand(env, device, command, body.Outcome === 'released', user, clean(body.Reason).slice(0, 500));
  }
  fail('Choose a valid Hotel Services action.');
}

async function paidReservation(env, reservation) {
  const [charges, payments] = await Promise.all([branchRows(env, 'hotelCharges', reservation.BranchId), branchRows(env, 'hotelPayments', reservation.BranchId)]);
  const verified = payments.find(p => p.ReservationId === reservation.ReservationId && p.Gateway === 'Paystack' && p.GatewayReference === reservation.PaymentReference);
  if (!verified || hotelReservationTotals(reservation, charges, payments).Balance > 0.005) fail('Full verified online payment is required for key collection.', 409);
}

export function hotelCollectionWindow(reservation, device) {
  const time = (date, hour) => new Date(Date.parse(`${date}T00:00:00Z`) + (hour * 60 - device.UtcOffsetMinutes) * 60000).toISOString();
  return { NotBefore: time(reservation.ArrivalDate, device.CheckInHour), ExpiresAt: time(reservation.DepartureDate, device.CheckOutHour) };
}

export async function guestHotelCollection(env, body) {
  await requireHotelOrganization(env);
  const id = clean(body.ReservationId);
  const token = clean(body.GuestAccessToken);
  if (!/^RSV-WEB-[a-f0-9-]{36}$/.test(id) || !/^[a-f0-9]{64}$/.test(token)) fail('Use the private booking link saved on the device used to book.', 403);
  const access = await read(env, ACCESS_COLLECTION, id);
  if (!access || !await secureSecretEqual(access.TokenHash, await hotelHash(token))) fail('The private booking link is invalid.', 403);
  const reservation = await read(env, 'hotelReservations', id);
  if (!reservation || reservation.BranchId !== access.BranchId) fail('Reservation not found.', 404);
  const summary = { ok: true, reservationId: id, roomNumber: reservation.RoomNumber, arrivalDate: reservation.ArrivalDate, departureDate: reservation.DepartureDate, status: reservation.Status };
  if (reservation.Status === 'Checked In') return { ...summary, message: 'You are checked in. Your key collection code has been used.' };
  if (reservation.Status !== 'Reserved') return { ...summary, message: 'This reservation is no longer eligible for key collection.' };
  if (reservation.KeyCommandId) return { ...summary, message: 'Key release is in progress or needs staff inspection. Do not retry the machine; contact reception if no key was released.' };
  await paidReservation(env, reservation);
  const deviceId = await deviceIdFor(reservation.BranchId);
  const device = await read(env, DEVICE_COLLECTION, deviceId);
  const room = await read(env, 'hotelRooms', reservation.RoomId);
  if (!device?.Enabled || !room?.KeySlot || room.BranchId !== reservation.BranchId) return { ...summary, message: 'Payment confirmed. Collect your room key from reception; self-service collection is not configured for this room.' };
  const window = hotelCollectionWindow(reservation, device);
  if (Date.parse(window.ExpiresAt) <= Date.now()) return { ...summary, message: 'The collection window has ended. Contact reception.' };
  // Serializing on the access record, reservation and device prevents a stale
  // guest request from issuing a credential after cancellation or configuration changes.
  for (let version = Math.max(0, Number(access.CodeVersion || 0)); version < Number(access.CodeVersion || 0) + 20; version += 1) {
    const code = await codeFor(env, token, id, version);
    const codeId = await codeIdFor(env, reservation.BranchId, code);
    const existing = await read(env, CODE_COLLECTION, codeId);
    if (existing && (existing.ReservationId !== id || existing.Status !== 'Ready')) continue;
    const codeRecord = { ReservationId: id, BranchId: reservation.BranchId, RoomId: room.RoomId,
      ArrivalDate: reservation.ArrivalDate, DepartureDate: reservation.DepartureDate, Status: 'Ready', ...window };
    await commitHotelChange(env, [write(CODE_COLLECTION, codeId, codeRecord, existing),
      write(ACCESS_COLLECTION, id, { ...access, CodeId: codeId, CodeVersion: version }, access),
      write('hotelReservations', id, { ...reservation, KeyCodeRevisionAt: now() }, reservation),
      write(DEVICE_COLLECTION, deviceId, { ...device, CodeRevisionAt: now() }, device)]);
    return { ...summary, code, notBefore: window.NotBefore, expiresAt: window.ExpiresAt,
      message: 'Keep this code private. Enter it at the key dispenser during your collection window. Save your private booking link to retrieve it again.' };
  }
  fail('A collection code could not be allocated. Contact reception.', 503);
}

export async function authenticateHotelDevice(env, request, deviceId) {
  await requireHotelOrganization(env);
  if (!/^[a-f0-9]{64}$/.test(clean(deviceId))) fail('Device authentication failed.', 401);
  const token = clean(request.headers.get('Authorization')).replace(/^Bearer /, '');
  const device = await read(env, DEVICE_COLLECTION, deviceId);
  if (!/^[a-f0-9]{64}$/.test(token) || !device || !await secureSecretEqual(device.TokenHash, await hotelHash(token))) fail('Device authentication failed.', 401);
  return device;
}

export async function redeemHotelKey(env, device, body) {
  if (!device.Enabled) fail('Key collection is disabled. Contact reception.', 409);
  const requestId = clean(body.RequestId);
  if (!/^[a-f0-9-]{36}$/.test(requestId) || !/^\d{6}$/.test(clean(body.Code))) fail('A six-digit code and persistent UUID request ID are required.');
  const codeId = await codeIdFor(env, device.BranchId, clean(body.Code));
  const commandId = await hotelHash(`${device.DeviceId}:${requestId}`);
  const previous = await read(env, COMMAND_COLLECTION, commandId);
  if (previous) {
    if (previous.CodeId !== codeId) fail('Do not reuse a request ID for another code.', 409);
    return { ok: true, commandId, state: previous.Status, newCommand: false, message: 'Replay: never actuate again. Re-send a persisted release result, or ask reception to inspect the dispenser.' };
  }
  if (device.ActiveCommandId) fail('The dispenser is busy or needs inspection. Contact reception.', 409);
  // Device-wide attempt budget is independent of client IP and counts every new
  // attempt. CAS prevents parallel requests bypassing the budget.
  const inside = Date.now() - Date.parse(device.AttemptWindow || '') < 15 * 60000;
  const attempts = inside ? Number(device.Attempts || 0) : 0;
  if (attempts >= 20) fail('Too many collection attempts. Wait 15 minutes or contact reception.', 429);
  await commitHotelChange(env, [write(DEVICE_COLLECTION, device.DeviceId, { ...device, Attempts: attempts + 1, AttemptWindow: inside ? device.AttemptWindow : now(), LastSeenAt: now() }, device)]);
  device = await read(env, DEVICE_COLLECTION, device.DeviceId);
  if (!device.Enabled || device.ActiveCommandId) fail('The dispenser state changed. Contact reception.', 409);
  const code = await read(env, CODE_COLLECTION, codeId);
  if (!code || code.Status !== 'Ready' || code.BranchId !== device.BranchId || Date.now() < Date.parse(code.NotBefore) || Date.now() >= Date.parse(code.ExpiresAt)) fail('Code invalid, used, or outside its collection window. Contact reception.', 409);
  const reservation = await read(env, 'hotelReservations', code.ReservationId);
  const access = await read(env, ACCESS_COLLECTION, code.ReservationId);
  if (!reservation || reservation.BranchId !== device.BranchId || access?.CodeId !== codeId || reservation.Status !== 'Reserved'
    || reservation.RoomId !== code.RoomId || reservation.ArrivalDate !== code.ArrivalDate || reservation.DepartureDate !== code.DepartureDate) fail('This code is no longer eligible. Contact reception.', 409);
  assertNoKeyHandoff(reservation);
  const currentWindow = hotelCollectionWindow(reservation, device);
  if (Date.now() < Date.parse(currentWindow.NotBefore) || Date.now() >= Date.parse(currentWindow.ExpiresAt)) fail('Outside the current collection hours. Contact reception.', 409);
  await paidReservation(env, reservation);
  const room = await read(env, 'hotelRooms', reservation.RoomId);
  if (!room || room.BranchId !== device.BranchId || !room.KeySlot || room.KeyStocked !== true || room.Status !== 'Available' || !['Clean', 'Inspected'].includes(room.HousekeepingStatus)) fail('The room or its physical key is not ready. Contact reception.', 409);
  assertNoKeyHandoff(room);
  const stays = await branchRows(env, 'hotelReservations', device.BranchId);
  if (stays.some(r => r.RoomId === room.RoomId && r.ReservationId !== reservation.ReservationId && r.Status === 'Checked In')) fail('The room is still occupied. Contact reception.', 409);
  const command = { CommandId: commandId, DeviceId: device.DeviceId, BranchId: device.BranchId, RequestId: requestId,
    CodeId: codeId, ReservationId: reservation.ReservationId, RoomId: room.RoomId, Slot: room.KeySlot, Status: 'Issued', CreatedAt: now() };
  await commitHotelChange(env, [write(COMMAND_COLLECTION, commandId, command), write(CODE_COLLECTION, codeId, { ...code, Status: 'Claimed' }, code),
    write('hotelReservations', reservation.ReservationId, { ...reservation, KeyCommandId: commandId }, reservation),
    write('hotelRooms', room.RoomId, { ...room, KeyCommandId: commandId, KeyStocked: false }, room),
    write(DEVICE_COLLECTION, device.DeviceId, { ...device, ActiveCommandId: commandId }, device), audit(device.BranchId, null, 'KEY CLAIMED', reservation.ReservationId, `Command ${commandId}`)]);
  return { ok: true, commandId, state: 'Issued', newCommand: true, slot: room.KeySlot,
    message: 'Persist command ID before actuation. Release this slot once; confirm using the physical release sensor. Never repeat actuation on retries.' };
}

async function finishCommand(env, device, command, released, user = null, reason = '') {
  const [reservation, room, code] = await Promise.all([read(env, 'hotelReservations', command.ReservationId), read(env, 'hotelRooms', command.RoomId), read(env, CODE_COLLECTION, command.CodeId)]);
  if (!reservation || !room || !code || reservation.KeyCommandId !== command.CommandId || room.KeyCommandId !== command.CommandId || device.ActiveCommandId !== command.CommandId) fail('Key handoff state is inconsistent; contact support.', 409);
  const stamp = now();
  const state = released ? 'Dispensed' : 'Resolved without release';
  await commitHotelChange(env, [write(COMMAND_COLLECTION, command.CommandId, { ...command, Status: state, CompletedAt: stamp, Resolution: reason }, command),
    write(CODE_COLLECTION, command.CodeId, { ...code, Status: 'Consumed' }, code),
    write('hotelReservations', reservation.ReservationId, { ...reservation, KeyCommandId: '',
      ...(released ? { Status: 'Checked In', CheckedInAt: stamp, CheckedInBy: user?.username || 'Physical key dispenser' } : {}) }, reservation),
    write('hotelRooms', room.RoomId, { ...room, KeyCommandId: '', KeyStocked: false, ...(released ? { Status: 'Occupied' } : {}) }, room),
    write(DEVICE_COLLECTION, device.DeviceId, { ...device, ActiveCommandId: '', LastSeenAt: stamp }, device),
    audit(device.BranchId, user, 'KEY RESULT', reservation.ReservationId, `${state}${reason ? `: ${reason}` : ''}`)]);
  return { ok: true, commandId: command.CommandId, state, message: released ? 'Key released; guest checked in.' : 'Handoff cleared. Inspect and reload the correct key before enabling collection. The guest must retrieve a new code.' };
}

export async function confirmHotelKey(env, device, body) {
  const id = clean(body.CommandId);
  if (!/^[a-f0-9]{64}$/.test(id)) fail('Invalid command.');
  const command = await read(env, COMMAND_COLLECTION, id);
  if (!command || command.DeviceId !== device.DeviceId || command.BranchId !== device.BranchId) fail('Command not found for this device.', 404);
  if (['Dispensed', 'Resolved without release'].includes(command.Status)) return { ok: true, commandId: id, state: command.Status, message: 'Result already recorded; never release again.' };
  if (!['released', 'failed', 'unknown'].includes(body.Outcome)) fail('Outcome must be released, failed or unknown.');
  if (command.Status === 'Review') fail('Staff inspection is required before resolving this command.', 409);
  if (body.Outcome === 'released') return finishCommand(env, device, command, true);
  await commitHotelChange(env, [write(COMMAND_COLLECTION, id, { ...command, Status: 'Review', ReportedOutcome: body.Outcome, ReportedAt: now() }, command),
    write(DEVICE_COLLECTION, device.DeviceId, { ...device, Enabled: false, LastSeenAt: now() }, device), audit(device.BranchId, null, 'KEY INSPECTION REQUIRED', command.ReservationId, body.Outcome)]);
  return { ok: true, commandId: id, state: 'Review', message: 'Dispenser disabled. Staff must physically inspect and resolve the handoff. Do not actuate again.' };
}
