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
