import { getDocument } from './firestore.js';

function clean(value) {
  return String(value ?? '').trim();
}

export function staffAccountIsActive(row = {}) {
  const value = row.Active === undefined ? 'YES' : row.Active;
  return !['no', 'false', '0', 'inactive', 'disabled'].includes(clean(value).toLowerCase());
}

export function activeStaffAccountCount(rows = []) {
  return rows.filter((row) => staffAccountIsActive(row)).length;
}

export function activeSeatDelta(existing, requestedActive) {
  const currentlyActive = Boolean(existing) && staffAccountIsActive(existing);
  return Number(Boolean(requestedActive)) - Number(currentlyActive);
}

export function subscriptionUserLimitError(limit) {
  const error = new Error(
    `This subscription allows ${limit} active staff account(s). Deactivate an account or upgrade the plan.`
  );
  error.status = 409;
  error.code = 'SUBSCRIPTION_USER_LIMIT';
  return error;
}

export function assertSubscriptionSeatAvailable(rows, existing, requestedActive, limit) {
  const normalizedLimit = Math.max(1, Number(limit || 5) || 5);
  const active = activeStaffAccountCount(rows);
  if (activeSeatDelta(existing, requestedActive) > 0 && active >= normalizedLimit) {
    throw subscriptionUserLimitError(normalizedLimit);
  }
  return { active, limit: normalizedLimit };
}

export async function loadSubscriptionUserLimit(env) {
  const profile = await getDocument(env, 'settings', 'organisationProfile').catch(() => null);
  if (profile?.UserLimit !== undefined && profile?.UserLimit !== null && clean(profile.UserLimit)) {
    return Math.max(1, Number(profile.UserLimit || 5) || 5);
  }
  const legacy = await getDocument(env, 'settings', 'schoolProfile').catch(() => null);
  return Math.max(1, Number(legacy?.UserLimit || env.USER_LIMIT || 5) || 5);
}

export async function enforceSubscriptionUserLimit(env, rows, existing, requestedActive) {
  const limit = await loadSubscriptionUserLimit(env);
  return assertSubscriptionSeatAvailable(rows, existing, requestedActive, limit);
}
