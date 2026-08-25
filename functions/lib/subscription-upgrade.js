import { normalizeBillingCycle, normalizeSubscriptionPlan } from './subscription-plans.js';

export const SUBSCRIPTION_PLAN_ORDER = Object.freeze(['Free', 'Starter', 'Standard', 'Professional', 'Flex', 'Enterprise']);

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
