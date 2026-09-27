import { getDocument } from './firestore.js';

function clean(value) {
  return String(value ?? '').trim();
}

function safeStaffId(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
}

export function staffProfileImageIds(record = {}, user = {}) {
  return [...new Set([
    clean(record.__id),
    safeStaffId(record.Username),
    safeStaffId(record.LoginUsername),
    safeStaffId(user.username),
    safeStaffId(user.loginUsername)
  ].filter(Boolean))];
}

// Only call after resolving the authenticated staff identity. Keep photos out
// of signed sessions, global caches and the general staff/dashboard responses.
export async function loadStaffProfileImage(env, record = {}, user = {}) {
  for (const profileId of staffProfileImageIds(record, user)) {
    const profileImage = await getDocument(env, 'staffProfileImages', profileId).catch(() => null);
    if (clean(profileImage?.ProfilePhotoDataUrl)) return profileImage;
  }
  return null;
}
