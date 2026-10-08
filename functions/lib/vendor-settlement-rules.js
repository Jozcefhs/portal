// Integer minor units are the source of truth for all vendor settlement amounts.
export const clean = value => String(value ?? '').trim();
export const lower = value => clean(value).toLowerCase();
export function fail(message, status = 400, code = 'VENDOR_SETTLEMENT_INVALID') {
  throw Object.assign(new Error(message), { status, code });
}
export function cents(value) {
  const number = Number(value ?? 0);
  const result = Math.round((number + Number.EPSILON) * 100);
  if (!Number.isFinite(number) || !Number.isSafeInteger(result)) fail('Enter a valid money amount.');
  return result;
}
export const amount = value => Number(value || 0) / 100;
export const plain = row => Object.fromEntries(Object.entries(row || {}).filter(([key]) => !key.startsWith('__')));
export function dateOnly(value) {
  const text = clean(value);
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00Z`) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) fail('Use a valid YYYY-MM-DD date.');
  return text;
}
export function normalizedEdition(value) {
  const edition = lower(value);
  if (['faith', 'church', 'religious'].includes(edition)) return 'faith';
  if (['organization', 'organisation', 'other'].includes(edition)) return 'organization';
  if (edition && edition !== 'school') fail('Unknown organisation edition.', 403);
  return 'school';
}
export function settlementScope(user = {}) {
  const edition = normalizedEdition(user.edition || user.Edition || user.OrganisationEdition);
  const branch = lower(user.branchId || user.BranchId || 'main');
  if (!/^[a-z0-9_-]{1,100}$/.test(branch)) fail('Choose a configured branch.', 403);
  return { ScopeKey: `${edition}--${branch}`, BranchId: branch, OrganisationEdition: edition,
    SchoolSection: edition === 'school' ? clean(user.schoolSectionAccess || user.SchoolSectionAccess || 'All') : 'All' };
}
export function visible(row, scope) {
  return row?.ScopeKey === scope.ScopeKey && (scope.OrganisationEdition !== 'school'
    || lower(scope.SchoolSection) === 'all' || lower(row.SchoolSection) === lower(scope.SchoolSection));
}
export function normalizeRule(body = {}, timestamp = new Date().toISOString(), allowInherit = false) {
  const mode = clean(body.Mode || 'Full payment');
  if (![...['Full payment', 'Percentage', 'Fixed charge'], ...(allowInherit ? ['Inherit default'] : [])].includes(mode)) fail('Choose a valid settlement rule.');
  const effectiveDate = dateOnly(body.EffectiveDate || timestamp.slice(0, 10));
  if (effectiveDate < timestamp.slice(0, 10)) fail('Rule changes cannot be backdated.');
  const basis = mode === 'Fixed charge' ? clean(body.Basis || 'Per sale') : 'Per sale';
  if (!['Per sale', 'Per period'].includes(basis)) fail('Choose a fixed-charge basis.');
  const cycle = basis === 'Per period' ? clean(body.Cycle || 'Monthly') : '';
  if (cycle && !['Daily', 'Weekly', 'Monthly'].includes(cycle)) fail('Choose Daily, Weekly or Monthly.');
  const rate = mode === 'Percentage' ? Number(body.Rate) : 0;
  if (!Number.isFinite(rate) || rate < 0 || rate > 100 || Math.round(rate * 100) / 100 !== rate) fail('Commission must be between 0 and 100 percent, with at most two decimal places.');
  const fixed = mode === 'Fixed charge' ? cents(body.FixedAmount) : 0;
  if (mode === 'Fixed charge' && fixed <= 0) fail('The fixed charge must be greater than zero.');
  return { RuleId: `RULE-${crypto.randomUUID()}`, Mode: mode, Rate: rate, FixedCents: fixed, Basis: basis, Cycle: cycle,
    EffectiveDate: effectiveDate, EffectiveAt: effectiveDate === timestamp.slice(0, 10) ? timestamp : `${effectiveDate}T00:00:00.000Z`,
    RefundPolicy: basis === 'Per period' ? 'Recalculate period charge against remaining sales' : 'Proportional reversal',
    FixedChargeCap: 'Confirmed sales after refunds', CreatedAt: timestamp };
}
const defaultRule = Object.freeze({ RuleId: 'DEFAULT-FULL', Mode: 'Full payment', Rate: 0, FixedCents: 0, Basis: 'Per sale', Cycle: '', EffectiveAt: '1970-01-01T00:00:00.000Z' });
function applicable(history, timestamp) {
  return (history || []).filter(rule => clean(rule.EffectiveAt) <= timestamp)
    .sort((a, b) => clean(b.EffectiveAt).localeCompare(clean(a.EffectiveAt)) || clean(b.CreatedAt).localeCompare(clean(a.CreatedAt)))[0];
}
export function effectiveRule(vendor = {}, settings = {}, timestamp = new Date().toISOString()) {
  const override = applicable(vendor.RuleHistory, timestamp);
  return { ...(override && override.Mode !== 'Inherit default' ? override : applicable(settings.RuleHistory, timestamp) || defaultRule) };
}
export function ruleDescription(rule = defaultRule) {
  if (rule.Mode === 'Percentage') return `${rule.Rate}% of confirmed sales after refunds`;
  if (rule.Mode === 'Fixed charge') return `${amount(rule.FixedCents).toFixed(2)} ${rule.Basis === 'Per period' ? `per ${lower(rule.Cycle)} period` : 'per vendor sale'}; capped at sales after refunds`;
  return 'Full payment; no school commission or charge';
}
export function periodKey(rule, timestamp, timezone = 'Africa/Lagos') {
  let day;
  try { day = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp)); }
  catch { fail('Choose a valid business timezone.'); }
  dateOnly(day);
  if (rule.Cycle === 'Monthly') return day.slice(0, 7);
  if (rule.Cycle === 'Weekly') {
    const date = new Date(`${day}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    return date.toISOString().slice(0, 10);
  }
  return day;
}
export function chargeFor(rule, grossCents) {
  if (!Number.isSafeInteger(grossCents) || grossCents < 0) fail('The vendor sale amount is invalid.');
  if (rule.Mode === 'Full payment') return 0;
  if (rule.Mode === 'Percentage') return Math.min(grossCents, Math.round(grossCents * rule.Rate / 100));
  if (rule.Mode === 'Fixed charge') return Math.min(grossCents, rule.FixedCents);
  fail('The saved vendor settlement rule is invalid.');
}
export function balanceView(balance = {}) {
  const net = Number(balance.NetCents || 0), paid = Number(balance.PaidCents || 0), reserved = Number(balance.ReservedCents || 0);
  const needsReview = balance.ReviewRequired === true || net < paid + reserved;
  return { GrossSales: amount(balance.GrossCents), Refunds: amount(balance.RefundCents), SchoolDeductions: amount(balance.ChargeCents),
    NetEntitlement: amount(net), Paid: amount(paid), Reserved: amount(reserved), Outstanding: amount(net - paid),
    Available: needsReview ? 0 : amount(Math.max(0, net - paid - reserved)), NeedsReview: needsReview,
    ReconciliationDifference: amount(net - (Number(balance.GrossCents || 0) - Number(balance.RefundCents || 0) - Number(balance.ChargeCents || 0))) };
}
export function allocateClaim(lots, wantedCents) {
  if (!Number.isSafeInteger(wantedCents) || wantedCents <= 0) fail('Request an amount greater than zero.');
  let remaining = wantedCents;
  const allocations = [];
  for (const lot of lots) {
    if (lot.SettlementHold) continue;
    const available = Math.max(0, Number(lot.NetCents || 0) - Number(lot.PaidCents || 0) - Number(lot.ReservedCents || 0));
    const take = Math.min(available, remaining);
    if (take) allocations.push({ LotId: lot.LotId, AmountCents: take });
    remaining -= take;
    if (!remaining) return allocations;
  }
  fail('The selected period does not have enough unclaimed earnings. Refresh the statement.', 409);
}
