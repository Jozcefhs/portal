import {
  batchCommitDocuments,
  createDocumentIfAbsent,
  getDocument,
  listCollection,
  patchDocumentFieldsIfCurrent
} from './firestore.js';

export const DESKTOP_PAIRING_COLLECTION = 'desktopPairingCodes';
export const DESKTOP_DEVICE_COLLECTION = 'desktopDevices';
export const DESKTOP_PAIRING_TTL_MINUTES = 15;

const encoder = new TextEncoder();
const PAIRING_CODE_PATTERN = /^DXP-([A-Z2-9]{10})-([A-Z2-9]{24})$/;
const DEVICE_CREDENTIAL_PATTERN = /^DXD\.([a-z0-9_-]{16,80})\.([A-Za-z0-9_-]{32,160})$/;
const FRIENDLY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const clean = (value) => String(value ?? '').trim();

function base64Url(bytes) {
  let binary = '';
  new Uint8Array(bytes).forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function friendlyToken(length) {
  const bytes = randomBytes(length);
  return Array.from(bytes, (byte) => FRIENDLY_ALPHABET[byte % FRIENDLY_ALPHABET.length]).join('');
}

export function normalizeDesktopPairingCode(value) {
  return clean(value).toUpperCase().replace(/\s+/g, '');
}

export function parseDesktopPairingCode(value) {
  const normalized = normalizeDesktopPairingCode(value);
  const match = normalized.match(PAIRING_CODE_PATTERN);
  return match ? { code: normalized, pairingId: match[1].toLowerCase() } : null;
}

export function parseDesktopDeviceCredential(value) {
  const supplied = clean(value);
  const match = supplied.match(DEVICE_CREDENTIAL_PATTERN);
  return match ? { credential: supplied, deviceId: match[1] } : null;
}

export async function desktopCredentialHash(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(clean(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function secureDesktopHashEqual(left, right) {
  const a = encoder.encode(clean(left));
  const b = encoder.encode(clean(right));
  if (typeof crypto.subtle.timingSafeEqual === 'function' && a.length === b.length) {
    return crypto.subtle.timingSafeEqual(a, b);
  }
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index] || 0) ^ (b[index] || 0);
  }
  return difference === 0;
}

function invalidPairingCode() {
  const error = new Error('This desktop pairing code is invalid, expired, or has already been used. Generate a new code in the web companion.');
  error.status = 401;
  error.code = 'DESKTOP_PAIRING_INVALID';
  return error;
}

function publicDevice(row = {}) {
  return {
    deviceId: clean(row.DeviceId || row.__id),
    deviceName: clean(row.DeviceName) || 'Desktop device',
    createdAt: clean(row.CreatedAt),
    createdBy: clean(row.CreatedByDisplayName || row.CreatedByUsername),
    active: row.Active !== false,
    revokedAt: clean(row.RevokedAt),
    revokedBy: clean(row.RevokedByDisplayName || row.RevokedByUsername)
  };
}

export async function createDesktopPairingCode(env, actor = {}) {
  const now = Date.now();
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + (DESKTOP_PAIRING_TTL_MINUTES * 60 * 1000)).toISOString();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const pairingId = friendlyToken(10);
    const code = `DXP-${pairingId}-${friendlyToken(24)}`;
    const result = await createDocumentIfAbsent(env, DESKTOP_PAIRING_COLLECTION, pairingId.toLowerCase(), {
      PairingId: pairingId.toLowerCase(),
      CodeHash: await desktopCredentialHash(code),
      Status: 'Pending',
      CreatedAt: createdAt,
      ExpiresAt: expiresAt,
      CreatedByUsername: clean(actor.username),
      CreatedByDisplayName: clean(actor.displayName || actor.username)
    });
    if (result.created) return { code, expiresAt, validForMinutes: DESKTOP_PAIRING_TTL_MINUTES };
  }
  const error = new Error('A pairing code could not be generated. Please try again.');
  error.status = 503;
  error.code = 'DESKTOP_PAIRING_GENERATION_FAILED';
  throw error;
}

export async function exchangeDesktopPairingCode(env, suppliedCode, deviceName) {
  const parsed = parseDesktopPairingCode(suppliedCode);
  if (!parsed) throw invalidPairingCode();
  const pairing = await getDocument(env, DESKTOP_PAIRING_COLLECTION, parsed.pairingId);
  const expiresAtMs = Date.parse(clean(pairing?.ExpiresAt));
  if (!pairing || clean(pairing.Status) !== 'Pending' || !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    throw invalidPairingCode();
  }
  const suppliedHash = await desktopCredentialHash(parsed.code);
  if (!await secureDesktopHashEqual(pairing.CodeHash, suppliedHash)) throw invalidPairingCode();

  const normalizedDeviceName = clean(deviceName).slice(0, 80);
  if (normalizedDeviceName.length < 2) {
    const error = new Error('Enter a name for this desktop device.');
    error.status = 400;
    error.code = 'DESKTOP_DEVICE_NAME_REQUIRED';
    throw error;
  }

  const now = new Date().toISOString();
  const deviceId = base64Url(randomBytes(18));
  const credential = `DXD.${deviceId}.${base64Url(randomBytes(32))}`;
  try {
    await batchCommitDocuments(env, [
      {
        collectionPath: DESKTOP_PAIRING_COLLECTION,
        documentId: parsed.pairingId,
        updateTime: pairing.__updateTime,
        data: {
          PairingId: parsed.pairingId,
          CodeHash: clean(pairing.CodeHash),
          Status: 'Used',
          CreatedAt: clean(pairing.CreatedAt),
          ExpiresAt: clean(pairing.ExpiresAt),
          CreatedByUsername: clean(pairing.CreatedByUsername),
          CreatedByDisplayName: clean(pairing.CreatedByDisplayName),
          UsedAt: now,
          DeviceId: deviceId,
          DeviceName: normalizedDeviceName
        }
      },
      {
        collectionPath: DESKTOP_DEVICE_COLLECTION,
        documentId: deviceId,
        exists: false,
        data: {
          DeviceId: deviceId,
          DeviceName: normalizedDeviceName,
          CredentialHash: await desktopCredentialHash(credential),
          Active: true,
          CreatedAt: now,
          CreatedByUsername: clean(pairing.CreatedByUsername),
          CreatedByDisplayName: clean(pairing.CreatedByDisplayName)
        }
      }
    ]);
  } catch (error) {
    if ([409, 412].includes(Number(error?.status)) || error?.code === 'FIRESTORE_WRITE_CONFLICT') {
      throw invalidPairingCode();
    }
    throw error;
  }
  return {
    credential,
    device: publicDevice({ DeviceId: deviceId, DeviceName: normalizedDeviceName, Active: true, CreatedAt: now,
      CreatedByUsername: pairing.CreatedByUsername, CreatedByDisplayName: pairing.CreatedByDisplayName })
  };
}

export async function verifyDesktopDeviceCredential(env, suppliedCredential) {
  const parsed = parseDesktopDeviceCredential(suppliedCredential);
  if (!parsed) return null;
  const device = await getDocument(env, DESKTOP_DEVICE_COLLECTION, parsed.deviceId);
  if (!device || device.Active === false || clean(device.RevokedAt)) return null;
  const suppliedHash = await desktopCredentialHash(parsed.credential);
  if (!await secureDesktopHashEqual(device.CredentialHash, suppliedHash)) return null;
  return publicDevice(device);
}

export async function listDesktopDevices(env) {
  const devices = await listCollection(env, DESKTOP_DEVICE_COLLECTION);
  return devices
    .map(publicDevice)
    .sort((left, right) => clean(right.createdAt).localeCompare(clean(left.createdAt)));
}

export async function revokeDesktopDevice(env, deviceId, actor = {}) {
  const normalizedId = clean(deviceId);
  if (!/^[a-z0-9_-]{16,80}$/.test(normalizedId)) {
    const error = new Error('Choose a valid desktop device.');
    error.status = 400;
    throw error;
  }
  const current = await getDocument(env, DESKTOP_DEVICE_COLLECTION, normalizedId);
  if (!current) {
    const error = new Error('That desktop device no longer exists.');
    error.status = 404;
    throw error;
  }
  if (current.Active === false || clean(current.RevokedAt)) return publicDevice(current);
  const revokedAt = new Date().toISOString();
  await patchDocumentFieldsIfCurrent(env, DESKTOP_DEVICE_COLLECTION, normalizedId, {
    Active: false,
    RevokedAt: revokedAt,
    RevokedByUsername: clean(actor.username),
    RevokedByDisplayName: clean(actor.displayName || actor.username)
  }, current);
  return publicDevice({ ...current, Active: false, RevokedAt: revokedAt,
    RevokedByUsername: actor.username, RevokedByDisplayName: actor.displayName });
}
