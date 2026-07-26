import { getDocument, upsertDocument } from './firestore.js';

const MAX_IMAGE_DATA_URL_LENGTH = 350000;

function clean(value) {
  return String(value ?? '').trim();
}

function enabled(value) {
  return value === true || ['yes', 'true', '1', 'on'].includes(clean(value).toLowerCase());
}

export function approvalProfileId(username) {
  return clean(username)
    .toLowerCase()
    .replace(/[\/\\?#\[\]]/g, '-')
    .replace(/\s+/g, '_')
    .slice(0, 140);
}

export function validateApprovalImage(value, label) {
  const dataUrl = clean(value);
  if (!dataUrl) return '';
  if (!/^data:image\/(?:png|jpe?g|webp);base64,[a-z0-9+/=\s]+$/i.test(dataUrl)) {
    const error = new Error(`${label} must be a PNG, JPG or WebP image.`);
    error.status = 400;
    throw error;
  }
  if (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
    const error = new Error(`${label} is too large. Choose an image under 250 KB.`);
    error.status = 400;
    throw error;
  }
  return dataUrl;
}

export async function loadStaffApprovalProfile(env, username) {
  const id = approvalProfileId(username);
  if (!id) return null;
  return getDocument(env, 'staffApprovalProfiles', id);
}

export function publicStaffApprovalProfile(profile = {}) {
  return {
    SignatureDataUrl: clean(profile.SignatureDataUrl),
    StampDataUrl: clean(profile.StampDataUrl),
    HasSignature: Boolean(clean(profile.SignatureDataUrl)),
    HasStamp: Boolean(clean(profile.StampDataUrl)),
    ApplySignatureOnApproval: enabled(profile.ApplySignatureOnApproval),
    ApplyStampOnApproval: enabled(profile.ApplyStampOnApproval),
    ApplySignatureOnPosting: enabled(profile.ApplySignatureOnPosting),
    ApplyStampOnPosting: enabled(profile.ApplyStampOnPosting),
    UpdatedAt: clean(profile.UpdatedAt)
  };
}

export async function saveStaffApprovalProfile(env, user, body) {
  const id = approvalProfileId(user.username);
  if (!id) {
    const error = new Error('The signed-in staff identity is invalid.');
    error.status = 400;
    throw error;
  }
  const existing = await loadStaffApprovalProfile(env, user.username);
  const now = new Date().toISOString();
  const payload = {
    ...(existing || {}),
    Username: clean(user.username),
    DisplayName: clean(user.displayName || user.username),
    SignatureDataUrl: validateApprovalImage(body.SignatureDataUrl, 'Signature'),
    StampDataUrl: validateApprovalImage(body.StampDataUrl, 'Stamp'),
    ApplySignatureOnApproval: enabled(body.ApplySignatureOnApproval),
    ApplyStampOnApproval: enabled(body.ApplyStampOnApproval),
    ApplySignatureOnPosting: enabled(body.ApplySignatureOnPosting),
    ApplyStampOnPosting: enabled(body.ApplyStampOnPosting),
    CreatedAt: existing?.CreatedAt || now,
    UpdatedAt: now
  };
  delete payload.__id;
  delete payload.__name;
  await upsertDocument(env, 'staffApprovalProfiles', id, payload);
  return publicStaffApprovalProfile(payload);
}
