import {
  batchCommitDocuments,
  createDocumentIfAbsent,
  getDocument,
  listCollection,
  patchDocumentFieldsIfCurrent
} from './firestore.js';
import { canonicalSchoolBranchId, getSchoolStructure } from './school-scope.js';

export const DESKTOP_PAIRING_COLLECTION = 'desktopPairingCodes';
export const DESKTOP_PAIRING_REQUEST_COLLECTION = 'desktopPairingRequests';
export const DESKTOP_DEVICE_COLLECTION = 'desktopDevices';
export const DESKTOP_PAIRING_TTL_MINUTES = 15;
export const DESKTOP_APPROVAL_TTL_MINUTES = 60;

const encoder = new TextEncoder();
const PAIRING_CODE_PATTERN = /^DXP-([A-Z2-9]{10})-([A-Z2-9]{24})$/;
const DEVICE_CREDENTIAL_PATTERN = /^DXD\.([A-Za-z0-9_-]{16,80})\.([A-Za-z0-9_-]{32,160})$/;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{16,80}$/;
const CREDENTIAL_HASH_PATTERN = /^[a-f0-9]{64}$/;
const REQUEST_ID_PATTERN = /^[a-f0-9]{32,64}$/;
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

function randomHex(length) {
  return Array.from(randomBytes(length), (byte) => byte.toString(16).padStart(2, '0')).join('');
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

function invalidApprovalRequest(message = 'This desktop approval request is invalid or no longer available.') {
  const error = new Error(message);
  error.status = 401;
  error.code = 'DESKTOP_APPROVAL_INVALID';
  return error;
}

function approvalRequestUnavailable(message, status = 409, code = 'DESKTOP_APPROVAL_UNAVAILABLE') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function validDeviceName(deviceName) {
  const normalized = clean(deviceName).slice(0, 80);
  if (normalized.length >= 2) return normalized;
  const error = new Error('Enter a name for this desktop device.');
  error.status = 400;
  error.code = 'DESKTOP_DEVICE_NAME_REQUIRED';
  throw error;
}

function requestStatus(row = {}, now = Date.now()) {
  const status = clean(row.Status || 'Pending').toLowerCase();
  const expiresAtMs = Date.parse(clean(row.ExpiresAt));
  if (status === 'pending' && (!Number.isFinite(expiresAtMs) || expiresAtMs <= now)) return 'expired';
  return status;
}

function publicPairingRequest(row = {}) {
  return {
    requestId: clean(row.PairingRequestId || row.__id),
    deviceId: clean(row.DeviceId),
    deviceName: clean(row.DeviceName) || 'Desktop device',
    status: requestStatus(row),
    requestedAt: clean(row.RequestedAt),
    expiresAt: clean(row.ExpiresAt),
    branchId: clean(row.BranchId),
    branchName: clean(row.BranchName),
    reviewedAt: clean(row.ReviewedAt || row.ApprovedAt || row.RejectedAt),
    reviewedBy: clean(row.ReviewedByDisplayName || row.ReviewedByUsername)
  };
}

function publicDevice(row = {}) {
  return {
    deviceId: clean(row.DeviceId || row.__id),
    deviceName: clean(row.DeviceName) || 'Desktop device',
    createdAt: clean(row.CreatedAt),
    createdBy: clean(row.CreatedByDisplayName || row.CreatedByUsername),
    branchId: clean(row.BranchId),
    branchName: clean(row.BranchName),
    organisationWide: !clean(row.BranchId),
    active: row.Active !== false,
    revokedAt: clean(row.RevokedAt),
    revokedBy: clean(row.RevokedByDisplayName || row.RevokedByUsername)
  };
}

function withoutFirestoreMetadata(row = {}) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('__')));
}

async function authenticatedPairingRequest(env, requestId, claimToken) {
  const normalizedId = clean(requestId).toLowerCase();
  const claim = clean(claimToken);
  if (!REQUEST_ID_PATTERN.test(normalizedId) || claim.length < 32) throw invalidApprovalRequest();
  const request = await getDocument(env, DESKTOP_PAIRING_REQUEST_COLLECTION, normalizedId);
  if (!request) throw invalidApprovalRequest();
  const suppliedHash = await desktopCredentialHash(claim);
  if (!await secureDesktopHashEqual(request.ClaimHash, suppliedHash)) throw invalidApprovalRequest();
  return request;
}

async function configuredDeviceBranch(env, suppliedBranchId, organisationWide = false) {
  const requested = clean(suppliedBranchId).toLowerCase();
  if (organisationWide === true) {
    return { id: '', name: 'Organisation-wide' };
  }
  if (!requested || ['all', 'organisation', 'organization', 'organisation-wide', 'organization-wide'].includes(requested)) {
    const error = new Error('Choose a configured branch, or explicitly approve this computer for organisation-wide access.');
    error.status = 400;
    error.code = 'DESKTOP_APPROVAL_BRANCH_REQUIRED';
    throw error;
  }
  const branchId = canonicalSchoolBranchId(requested);
  const structure = await getSchoolStructure(env);
  const branch = structure.Branches.find((row) => canonicalSchoolBranchId(row.Id) === branchId);
  if (branch) return { id: branch.Id, name: branch.Name };
  const error = new Error('Choose a branch that is configured for this organisation.');
  error.status = 400;
  error.code = 'DESKTOP_APPROVAL_BRANCH_INVALID';
  throw error;
}

export async function createDesktopApprovalRequest(env, options = {}) {
  const deviceName = validDeviceName(options.deviceName);
  const deviceId = clean(options.deviceId);
  const credentialHash = clean(options.credentialHash).toLowerCase();
  if (!DEVICE_ID_PATTERN.test(deviceId) || !CREDENTIAL_HASH_PATTERN.test(credentialHash)) {
    const error = new Error('This desktop did not provide a valid device credential request.');
    error.status = 400;
    error.code = 'DESKTOP_APPROVAL_DEVICE_INVALID';
    throw error;
  }
  const existingDevice = await getDocument(env, DESKTOP_DEVICE_COLLECTION, deviceId);
  if (existingDevice) {
    throw approvalRequestUnavailable('This desktop device identifier is already registered. Create a new approval request.', 409, 'DESKTOP_DEVICE_ALREADY_EXISTS');
  }

  const now = Date.now();
  const requestedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + (DESKTOP_APPROVAL_TTL_MINUTES * 60 * 1000)).toISOString();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const requestId = randomHex(18);
    const claimToken = base64Url(randomBytes(32));
    const result = await createDocumentIfAbsent(env, DESKTOP_PAIRING_REQUEST_COLLECTION, requestId, {
      PairingRequestId: requestId,
      ClaimHash: await desktopCredentialHash(claimToken),
      DeviceId: deviceId,
      DeviceName: deviceName,
      CredentialHash: credentialHash,
      Status: 'Pending',
      RequestedAt: requestedAt,
      ExpiresAt: expiresAt
    });
    if (result.created) {
      return {
        status: 'pending', requestId, claimToken, expiresAt,
        validForMinutes: DESKTOP_APPROVAL_TTL_MINUTES
      };
    }
  }
  throw approvalRequestUnavailable('A desktop approval request could not be created. Please try again.', 503, 'DESKTOP_APPROVAL_GENERATION_FAILED');
}

export async function getDesktopApprovalStatus(env, requestId, claimToken) {
  const request = await authenticatedPairingRequest(env, requestId, claimToken);
  return publicPairingRequest(request);
}

export async function listDesktopApprovalRequests(env) {
  const requests = await listCollection(env, DESKTOP_PAIRING_REQUEST_COLLECTION);
  return requests
    .map(publicPairingRequest)
    .filter((row) => row.status === 'pending')
    .sort((left, right) => clean(right.requestedAt).localeCompare(clean(left.requestedAt)));
}

export async function approveDesktopApprovalRequest(env, requestId, branchId, actor = {}, options = {}) {
  const normalizedId = clean(requestId).toLowerCase();
  if (!REQUEST_ID_PATTERN.test(normalizedId)) throw approvalRequestUnavailable('Choose a valid desktop approval request.', 400);
  const request = await getDocument(env, DESKTOP_PAIRING_REQUEST_COLLECTION, normalizedId);
  if (!request) throw approvalRequestUnavailable('That desktop approval request no longer exists.', 404);
  const status = requestStatus(request);
  if (status === 'expired') throw approvalRequestUnavailable('That desktop approval request has expired. Ask the computer to submit a new request.', 410, 'DESKTOP_APPROVAL_EXPIRED');
  if (status !== 'pending') throw approvalRequestUnavailable(`That desktop approval request is already ${status}.`);
  if (!DEVICE_ID_PATTERN.test(clean(request.DeviceId)) || !CREDENTIAL_HASH_PATTERN.test(clean(request.CredentialHash))) {
    throw approvalRequestUnavailable('That desktop approval request is incomplete. Ask the computer to submit a new request.', 409, 'DESKTOP_APPROVAL_DEVICE_INVALID');
  }

  const branch = await configuredDeviceBranch(env, branchId, options.organisationWide === true);
  const reviewedAt = new Date().toISOString();
  const reviewerUsername = clean(actor.username);
  const reviewerDisplayName = clean(actor.displayName || actor.username);
  const updatedRequest = {
    ...withoutFirestoreMetadata(request),
    Status: 'Approved',
    BranchId: branch.id,
    BranchName: branch.name,
    ApprovedAt: reviewedAt,
    ReviewedAt: reviewedAt,
    ReviewedByUsername: reviewerUsername,
    ReviewedByDisplayName: reviewerDisplayName
  };
  const device = {
    DeviceId: clean(request.DeviceId),
    DeviceName: clean(request.DeviceName),
    CredentialHash: clean(request.CredentialHash),
    BranchId: branch.id,
    BranchName: branch.name,
    PairingRequestId: normalizedId,
    Active: true,
    CreatedAt: reviewedAt,
    CreatedByUsername: reviewerUsername,
    CreatedByDisplayName: reviewerDisplayName
  };
  try {
    await batchCommitDocuments(env, [
      {
        collectionPath: DESKTOP_PAIRING_REQUEST_COLLECTION,
        documentId: normalizedId,
        updateTime: request.__updateTime,
        data: updatedRequest
      },
      {
        collectionPath: DESKTOP_DEVICE_COLLECTION,
        documentId: device.DeviceId,
        exists: false,
        data: device
      }
    ]);
  } catch (error) {
    if ([409, 412].includes(Number(error?.status)) || error?.code === 'FIRESTORE_WRITE_CONFLICT') {
      throw approvalRequestUnavailable('That desktop approval request changed before it could be approved. Reload and try again.');
    }
    throw error;
  }
  return { request: publicPairingRequest(updatedRequest), device: publicDevice(device) };
}

export async function rejectDesktopApprovalRequest(env, requestId, actor = {}) {
  const normalizedId = clean(requestId).toLowerCase();
  if (!REQUEST_ID_PATTERN.test(normalizedId)) throw approvalRequestUnavailable('Choose a valid desktop approval request.', 400);
  const request = await getDocument(env, DESKTOP_PAIRING_REQUEST_COLLECTION, normalizedId);
  if (!request) throw approvalRequestUnavailable('That desktop approval request no longer exists.', 404);
  const status = requestStatus(request);
  if (status === 'expired') throw approvalRequestUnavailable('That desktop approval request has expired.', 410, 'DESKTOP_APPROVAL_EXPIRED');
  if (status !== 'pending') throw approvalRequestUnavailable(`That desktop approval request is already ${status}.`);
  const reviewedAt = new Date().toISOString();
  const updates = {
    Status: 'Rejected',
    RejectedAt: reviewedAt,
    ReviewedAt: reviewedAt,
    ReviewedByUsername: clean(actor.username),
    ReviewedByDisplayName: clean(actor.displayName || actor.username)
  };
  await patchDocumentFieldsIfCurrent(env, DESKTOP_PAIRING_REQUEST_COLLECTION, normalizedId, updates, request);
  return publicPairingRequest({ ...request, ...updates });
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
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(normalizedId)) {
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
