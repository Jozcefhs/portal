import { normalizeBillingCycle, normalizeSubscriptionPlan } from './subscription-plans.js';

export const SUBSCRIPTION_PLAN_ORDER = Object.freeze(['Free', 'Starter', 'Standard', 'Professional', 'Flex', 'Enterprise']);

const clean = (value) => String(value ?? '').trim();
const money = (value) => Math.round((Number(value) || 0) * 100) / 100;

function normalizedModuleKeys(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map(clean)
    .filter(Boolean))].sort();
}

export function flexConfigurationChange(current = {}, target = {}) {
  const currentModules = normalizedModuleKeys(current.modules);
  const targetModules = normalizedModuleKeys(target.modules);
  const currentSet = new Set(currentModules);
  const targetSet = new Set(targetModules);
  const currentUserLimit = Math.max(1, Math.floor(Number(current.userLimit) || 1));
  const targetUserLimit = Math.max(1, Math.floor(Number(target.userLimit) || 1));
  const addedModules = targetModules.filter((key) => !currentSet.has(key));
  const removedModules = currentModules.filter((key) => !targetSet.has(key));
  const addedUsers = Math.max(0, targetUserLimit - currentUserLimit);
  const removedUsers = Math.max(0, currentUserLimit - targetUserLimit);
  return {
    currentModules,
    targetModules,
    currentUserLimit,
    targetUserLimit,
    addedModules,
    removedModules,
    addedUsers,
    removedUsers,
    increased: addedModules.length > 0 || addedUsers > 0,
    reduced: removedModules.length > 0 || removedUsers > 0,
    changed: addedModules.length > 0 || removedModules.length > 0 || addedUsers > 0 || removedUsers > 0
  };
}

export function proratedFlexUpgrade({
  currentAmount,
  targetAmount,
  periodStartAt,
  paidThroughAt,
  now = Date.now()
} = {}) {
  const current = money(currentAmount);
  const target = money(targetAmount);
  const startMs = Date.parse(clean(periodStartAt));
  const endMs = Date.parse(clean(paidThroughAt));
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!(target > current)) throw new Error('A prorated Flex upgrade requires a higher full-cycle price.');
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs
      || !Number.isFinite(nowMs) || nowMs >= endMs) {
    throw new Error('The current paid subscription period is unavailable for automatic proration.');
  }
  const effectiveNow = Math.max(startMs, nowMs);
  const periodMilliseconds = endMs - startMs;
  const remainingMilliseconds = endMs - effectiveNow;
  const remainingFraction = remainingMilliseconds / periodMilliseconds;
  const amount = money((target - current) * remainingFraction);
  if (!(amount > 0)) throw new Error('The prorated Flex upgrade amount is too small to process automatically.');
  return {
    Type: 'FlexProration',
    CurrentFullCycleAmount: current,
    FullCycleAmount: target,
    ChargeAmount: amount,
    PeriodStartAt: new Date(startMs).toISOString(),
    PaidThroughAt: new Date(endMs).toISOString(),
    CalculatedAt: new Date(effectiveNow).toISOString(),
    RemainingFraction: Math.round(remainingFraction * 1000000) / 1000000,
    RemainingDays: Math.max(0, Math.ceil(remainingMilliseconds / (24 * 60 * 60 * 1000)))
  };
}

export function subscriptionChangeDecision(currentPlan, currentCycle, targetPlan, targetCycle, options = {}) {
  const fromPlan = normalizeSubscriptionPlan(currentPlan);
  const toPlan = normalizeSubscriptionPlan(targetPlan);
  const fromCycle = normalizeBillingCycle(currentCycle);
  const toCycle = normalizeBillingCycle(targetCycle);
  const fromRank = SUBSCRIPTION_PLAN_ORDER.indexOf(fromPlan);
  const toRank = SUBSCRIPTION_PLAN_ORDER.indexOf(toPlan);
  if (toPlan === 'Free') return { allowed: false, reason: 'The free trial cannot replace an active paid plan.' };
  if (fromPlan === 'Flex' && toPlan === 'Flex' && toCycle === fromCycle && options.configurationChanged === true) {
    return { allowed: true, kind: 'reconfigure', fromPlan, toPlan, fromCycle, toCycle };
  }
  if (toPlan === 'Flex' && fromPlan !== 'Flex') {
    return { allowed: true, kind: 'customize', fromPlan, toPlan, fromCycle, toCycle };
  }
  if (fromPlan === 'Flex' && toPlan !== 'Flex') {
    return { allowed: true, kind: 'bundle-change', fromPlan, toPlan, fromCycle, toCycle };
  }
  if (toRank < fromRank) return { allowed: false, reason: 'Plan downgrades require assistance from Dynamax support.' };
  if (toRank === fromRank && toCycle === fromCycle) {
    if (options.allowRenewal === true) {
      return { allowed: true, kind: 'renewal', fromPlan, toPlan, fromCycle, toCycle };
    }
    return { allowed: false, reason: 'This plan and billing cycle are already active.' };
  }
  return { allowed: true, kind: toRank > fromRank ? 'upgrade' : 'billing-cycle-change', fromPlan, toPlan, fromCycle, toCycle };
}
