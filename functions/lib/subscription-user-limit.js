import { getDocument } from './firestore.js';
import { normalizeOrganizationEdition } from './organization-config.js';
import { normalizeSubscriptionPlan, subscriptionPlanUserLimit } from './subscription-plans.js';

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

function staffAccountEdition(row = {}) {
  const value = clean(
    row.Edition || row.edition
      || row.OrganisationEdition || row.organisationEdition
      || row.OrganizationEdition || row.organizationEdition
  );
  return value ? normalizeOrganizationEdition(value) : '';
}

export function staffAccountsForSubscription(rows = [], edition = 'school', currentUsername = '') {
  const expectedEdition = normalizeOrganizationEdition(edition);
  const currentIdentity = clean(currentUsername).toLowerCase();
  return rows.filter((row) => {
    const recordEdition = staffAccountEdition(row);
    if (recordEdition) return recordEdition === expectedEdition;
    const recordIdentity = clean(row.Username || row.username || row.__id).toLowerCase();
    // Unlabelled records pre-date edition isolation. They belong to the legacy
    // school workspace, except for the currently authenticated account whose
    // deployment identity is authoritative.
    return expectedEdition === 'school' || Boolean(currentIdentity && recordIdentity === currentIdentity);
  });
}

export function activeSeatDelta(existing, requestedActive) {
  const currentlyActive = Boolean(existing) && staffAccountIsActive(existing);
  return Number(Boolean(requestedActive)) - Number(currentlyActive);
}

export function subscriptionUserLimitError(limit, active = limit) {
  const error = new Error(
    `This subscription allows ${limit} active staff account(s), and ${active} are currently active across this organisation. Deactivate an account or upgrade the plan.`
  );
  error.status = 409;
  error.code = 'SUBSCRIPTION_USER_LIMIT';
  return error;
}

export function assertSubscriptionSeatAvailable(rows, existing, requestedActive, limit) {
  const normalizedLimit = Math.max(1, Number(limit || 5) || 5);
  const active = activeStaffAccountCount(rows);
  if (activeSeatDelta(existing, requestedActive) > 0 && active >= normalizedLimit) {
    throw subscriptionUserLimitError(normalizedLimit, active);
  }
  return { active, limit: normalizedLimit };
}

export async function loadSubscriptionUserLimit(env) {
  const profile = await getDocument(env, 'settings', 'organisationProfile').catch(() => null);
  if (profile) {
    const configuredPlan = clean(profile.Plan || profile.SubscriptionPlan);
    if (configuredPlan) {
      const plan = normalizeSubscriptionPlan(configuredPlan);
      if (plan !== 'Enterprise') return subscriptionPlanUserLimit(plan);
    }
    if (profile.UserLimit !== undefined && profile.UserLimit !== null && clean(profile.UserLimit)) {
      return Math.max(1, Number(profile.UserLimit || 5) || 5);
    }
  }
  const legacy = await getDocument(env, 'settings', 'schoolProfile').catch(() => null);
  const legacyPlan = clean(legacy?.SubscriptionPlan || legacy?.Plan || env.SUBSCRIPTION_PLAN);
  if (legacyPlan) {
    const plan = normalizeSubscriptionPlan(legacyPlan);
    if (plan !== 'Enterprise') return subscriptionPlanUserLimit(plan);
  }
  return Math.max(1, Number(legacy?.UserLimit || env.USER_LIMIT || 5) || 5);
}

export async function enforceSubscriptionUserLimit(env, rows, existing, requestedActive) {
  const limit = await loadSubscriptionUserLimit(env);
  return assertSubscriptionSeatAvailable(rows, existing, requestedActive, limit);
}
