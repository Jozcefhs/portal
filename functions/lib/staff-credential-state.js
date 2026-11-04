import { getDocument } from './firestore.js';

export async function credentialStateId(username) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(username || '').trim().toLowerCase()));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

// A recovery writes this marker atomically with the password. Old signed
// sessions and in-flight password/MFA challenges must not acquire a new epoch.
export async function staffCredentialEpochCurrent(env, username, epoch = '') {
  if (!env.FIREBASE_PROJECT_ID) return true; // Pure signing tests / unconfigured deployments.
  const state = await getDocument(env, 'staffCredentialRevocations', await credentialStateId(username));
  return !state || String(state.Epoch || '') === String(epoch || '');
}

// Enrollment and administrator recovery share this revision. A new device
// cannot appear between recovery's factor read and its atomic revocation.
export async function staffCredentialWriteGuard(env, username, expectedEpoch = '') {
  const documentId = await credentialStateId(username);
  const current = await getDocument(env, 'staffCredentialRevocations', documentId);
  if (String(current?.Epoch || '') !== String(expectedEpoch || '')) {
    throw Object.assign(new Error('Account security changed. Sign in again before enrolling a device.'), { status: 401 });
  }
  if (current && !current.__updateTime) throw Object.assign(new Error('The account security revision is unavailable. Try again.'), { status: 409 });
  const data = Object.fromEntries(Object.entries(current || {}).filter(([key]) => !key.startsWith('__')));
  return { collectionPath: 'staffCredentialRevocations', documentId,
    ...(current ? { updateTime: current.__updateTime } : { exists: false }),
    data: { ...data, Epoch: String(expectedEpoch || ''), Revision: crypto.randomUUID() } };
}
