export const PAID_SUBSCRIPTION_GRACE_DAYS = 7;
export const PAID_DATA_RETENTION_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;
const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();

export function lifecycleTimestampMilliseconds(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const seconds = Number(value.seconds ?? value._seconds);
    if (Number.isFinite(seconds)) {
      return (seconds * 1000) + Math.floor(Number(value.nanoseconds ?? value._nanoseconds ?? 0) / 1000000);
    }
  }
  const parsed = Date.parse(clean(value));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function calendarPeriodEnd(startValue, billingCycle) {
  const startMs = lifecycleTimestampMilliseconds(startValue);
  if (!Number.isFinite(startMs)) return '';
  const result = new Date(startMs);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  if (lower(billingCycle) === 'yearly') result.setUTCFullYear(result.getUTCFullYear() + 1);
  else result.setUTCMonth(result.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result.toISOString();
}

export function paystackPaidThroughAt(data = {}) {
  const candidates = [
    data.next_payment_date,
    data.nextPaymentDate,
    data.subscription?.next_payment_date,
    data.subscription?.nextPaymentDate,
    data.invoice?.next_payment_date,
    data.period_end,
    data.periodEnd
  ];
  for (const candidate of candidates) {
    const milliseconds = lifecycleTimestampMilliseconds(candidate);
    if (Number.isFinite(milliseconds)) return new Date(milliseconds).toISOString();
  }
  return '';
}

export function paidSubscriptionPeriodEnd({ paidAt, billingCycle, providerPaidThroughAt = '' } = {}) {
  const paidMs = lifecycleTimestampMilliseconds(paidAt);
  const providerMs = lifecycleTimestampMilliseconds(providerPaidThroughAt);
  if (Number.isFinite(providerMs) && (!Number.isFinite(paidMs) || providerMs > paidMs)) {
    return new Date(providerMs).toISOString();
  }
  return calendarPeriodEnd(paidAt, billingCycle);
}

export function paidSubscriptionRecoveryFields({ paidAt, billingCycle, providerPaidThroughAt = '' } = {}) {
  const safePaidAt = Number.isFinite(lifecycleTimestampMilliseconds(paidAt))
    ? new Date(lifecycleTimestampMilliseconds(paidAt)).toISOString()
    : new Date().toISOString();
  const paidThroughAt = paidSubscriptionPeriodEnd({
    paidAt: safePaidAt,
    billingCycle,
    providerPaidThroughAt
  });
  return {
    SubscriptionStatus: 'Active',
    PaymentStatus: 'Paid',
    LifecycleStage: 'Active',
    PaidAt: safePaidAt,
    LastSuccessfulPaymentAt: safePaidAt,
    PaidThroughAt: paidThroughAt,
    RenewalDueAt: paidThroughAt,
    GracePeriodStartedAt: '',
    GracePeriodEndsAt: '',
    DataRetentionEndsAt: '',
    ExpiredPaidThroughAt: '',
    RetirementRequestReference: '',
    RenewalReminder7DaySentAt: '',
    RenewalReminder3DaySentAt: '',
    RenewalReminder1DaySentAt: '',
    PaymentGraceNoticeSentAt: '',
    PaidSuspensionNoticeSentAt: '',
    PaidDeletionWarning30DaySentAt: '',
    PaidDeletionWarning7DaySentAt: '',
    PaidDeletionWarning1DaySentAt: '',
    LastLifecycleEmailError: ''
  };
}

export function paidLifecycleWindow(registration = {}, now = Date.now()) {
  const plan = lower(registration.Plan || registration.SubscriptionPlan);
  const savedPaidThrough = clean(registration.PaidThroughAt || registration.RenewalDueAt);
  const derivedPaidThrough = savedPaidThrough || paidSubscriptionPeriodEnd({
    paidAt: registration.LastSuccessfulPaymentAt || registration.PaidAt,
    billingCycle: registration.BillingCycle
  });
  const paidThroughMs = lifecycleTimestampMilliseconds(derivedPaidThrough);
  const nowMs = lifecycleTimestampMilliseconds(now);
  if (!plan || plan === 'free' || !Number.isFinite(paidThroughMs) || !Number.isFinite(nowMs)) {
    return {
      applicable: false,
      kind: 'paid',
      stage: 'not_applicable',
      paidThroughAt: '',
      graceEndsAt: '',
      retentionEndsAt: '',
      daysUntilDue: 0,
      graceRemainingDays: 0,
      remainingDays: 0,
      periodKey: ''
    };
  }
  const paidThroughAt = new Date(paidThroughMs).toISOString();
  const sameExpiredPeriod = clean(registration.ExpiredPaidThroughAt) === paidThroughAt;
  const savedGraceMs = sameExpiredPeriod
    ? lifecycleTimestampMilliseconds(registration.GracePeriodEndsAt)
    : NaN;
  const graceEndsMs = Number.isFinite(savedGraceMs)
    ? savedGraceMs
    : paidThroughMs + (PAID_SUBSCRIPTION_GRACE_DAYS * DAY_MS);
  const savedRetentionMs = sameExpiredPeriod
    ? lifecycleTimestampMilliseconds(registration.DataRetentionEndsAt)
    : NaN;
  const retentionEndsMs = Number.isFinite(savedRetentionMs)
    ? savedRetentionMs
    : graceEndsMs + (PAID_DATA_RETENTION_DAYS * DAY_MS);
  const stage = nowMs < paidThroughMs
    ? 'active'
    : nowMs < graceEndsMs
      ? 'payment_grace'
      : nowMs < retentionEndsMs
        ? 'suspended'
        : 'retirement_due';
  return {
    applicable: true,
    kind: 'paid',
    stage,
    paidThroughAt,
    graceEndsAt: new Date(graceEndsMs).toISOString(),
    retentionEndsAt: new Date(retentionEndsMs).toISOString(),
    daysUntilDue: Math.max(0, Math.ceil((paidThroughMs - nowMs) / DAY_MS)),
    graceRemainingDays: Math.max(0, Math.ceil((graceEndsMs - nowMs) / DAY_MS)),
    remainingDays: Math.max(0, Math.ceil((retentionEndsMs - nowMs) / DAY_MS)),
    periodKey: paidThroughAt.replace(/[^0-9]/g, '').slice(0, 14)
  };
}
