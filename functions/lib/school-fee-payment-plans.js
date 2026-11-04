import { getDocument, listCollection, batchCommitLiteralDocuments } from './firestore.js';
import { feeBranchId, feeSetupBranch } from './fee-branch-scope.js';
import { assignedStaffBranches } from './staff-branch-access.js';
import { DEFAULT_BILLING_CATEGORIES } from './billing-category-discounts.js';
import { financeDate, financeMoney, financeOperationId } from './accounting-mutation-guards.js';

const clean = value => String(value ?? '').trim();
const key = value => clean(value).toLowerCase().replace(/\s+/g, ' ');
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const COLLECTION = 'schoolFeePaymentPlans';
const MAX_RULES = 200;
export const SCHOOL_FEE_PAYMENT_PLAN_MODES = Object.freeze([
  'Existing fee-item rules', 'Full payment', 'Percentage', 'Fixed minimum', 'Equal installments'
]);
const label = (value, name, fallback = '') => {
  const text = clean(value || fallback).replace(/\s+/g, ' ');
  if (!text || text.length > 100 || /[\u0000-\u001f]/.test(clean(value))) fail(`Choose a valid ${name}.`);
  return ['all', '*'].includes(key(text)) ? 'All' : text;
};
const cents = (value, name) => {
  const amount = financeMoney(value, name);
  const result = Math.round(amount * 100);
  if (!Number.isSafeInteger(result)) fail(`${name} is too large.`);
  return result;
};
const money = value => value / 100;

export function normalizeSchoolFeePaymentPlan(input = {}) {
  const Name = label(input.Name, 'billing category');
  const AcademicSession = label(input.AcademicSession, 'academic session', 'All');
  const Term = label(input.Term, 'term', 'All');
  if ((AcademicSession === 'All') !== (Term === 'All')) fail('Choose both a specific session and term, or All for both.');
  const Mode = clean(input.Mode || SCHOOL_FEE_PAYMENT_PLAN_MODES[0]);
  if (!SCHOOL_FEE_PAYMENT_PLAN_MODES.includes(Mode)) fail('Choose a valid part-payment plan mode.');
  let Value = 0, InstallmentCount = 0, PercentageBasis = 'Total school fees';
  if (['Percentage', 'Fixed minimum'].includes(Mode)) {
    Value = financeMoney(input.Value, 'Plan value', { min: 0.01, max: Mode === 'Percentage' ? 100 : 100000000 });
  }
  if (Mode === 'Percentage') {
    PercentageBasis = clean(input.PercentageBasis || 'Total school fees');
    if (!['Total school fees', 'Outstanding balance'].includes(PercentageBasis)) fail('Choose Total school fees or Outstanding balance as the percentage basis.');
  }
  if (Mode === 'Equal installments') {
    if (!/^\d+$/.test(String(input.InstallmentCount ?? ''))) fail('Choose a whole number of installments from 2 to 12.');
    InstallmentCount = Number(input.InstallmentCount);
    if (InstallmentCount < 2 || InstallmentCount > 12) fail('Choose between 2 and 12 installments.');
  }
  if (input.DueDates !== undefined && !Array.isArray(input.DueDates)) fail('Installment due dates must be a list.');
  const DueDates = (input.DueDates || []).map(value => financeDate(value, 'Installment due date'));
  if (DueDates.length) {
    if (Mode !== 'Equal installments' || DueDates.length !== InstallmentCount) fail('Provide one due date for every installment, or leave all due dates empty.');
    if (AcademicSession === 'All') fail('Dated installments require a specific academic session and term.');
    if (DueDates.some((date, index) => index > 0 && date <= DueDates[index - 1])) fail('Installment due dates must be in strictly ascending order.');
  }
  return { Name, AcademicSession, Term, Mode, Value, PercentageBasis, InstallmentCount, DueDates };
}

function oneBranch(value) {
  if (key(value) === 'all' || key(value) === '*') fail('Choose one branch for part-payment plans.');
  return feeBranchId({ BranchId: value });
}

export const schoolFeePaymentPlansId = branch => financeOperationId('FEE-PLANS', oneBranch(branch));
export const schoolFeePaymentPlanRuleId = (branch, rule) => financeOperationId('FEE-PLAN', oneBranch(branch),
  key(rule.Name), key(rule.AcademicSession), key(rule.Term));

async function readSettings(env, branch, db) {
  const branchId = oneBranch(branch), id = await schoolFeePaymentPlansId(branchId);
  const row = await db.getDocument(env, COLLECTION, id);
  if (!row) return { id, row: null, settings: { branchId, rules: [], recordVersion: '' } };
  if (!clean(row.BranchId) || oneBranch(row.BranchId) !== branchId || !clean(row.__updateTime)
      || !Array.isArray(row.Rules) || row.Rules.length > MAX_RULES) fail('The saved part-payment settings need review before use.', 409);
  const seen = new Set();
  const rules = await Promise.all(row.Rules.map(async stored => {
    const normalized = normalizeSchoolFeePaymentPlan(stored);
    const RuleId = await schoolFeePaymentPlanRuleId(branchId, normalized);
    if (stored.RuleId !== RuleId || seen.has(RuleId)) fail('Duplicate or mismatched part-payment rules need review.', 409);
    seen.add(RuleId);
    return { ...normalized, RuleId };
  }));
  return { id, row, settings: { branchId, rules, recordVersion: row.__updateTime } };
}

// One branch document, independent of the number of fee components or rules.
export async function loadSchoolFeePaymentPlans(env, branch, overrides = {}) {
  return (await readSettings(env, branch, { getDocument, ...overrides })).settings;
}

export function selectSchoolFeePaymentPlan(settings, account = {}) {
  if (!settings || !clean(settings.branchId) || oneBranch(settings.branchId) !== feeBranchId(account)) return null;
  const category = key(account.BillingCategory || 'Regular');
  const ranked = (settings.rules || []).filter(rule => (key(rule.Name) === 'all' || key(rule.Name) === category)
    && (rule.AcademicSession === 'All' && rule.Term === 'All'
      || key(rule.AcademicSession) === key(account.AcademicSession) && key(rule.Term) === key(account.Term)))
    .map(rule => ({ rule, rank: Number(rule.AcademicSession !== 'All') * 2 + Number(key(rule.Name) === category) }))
    .sort((left, right) => right.rank - left.rank);
  if (ranked.length > 1 && ranked[1].rank === ranked[0].rank) fail('More than one part-payment rule matches this account. Review the settings.', 409);
  return ranked.length ? { ...ranked[0].rule, BranchId: settings.branchId, policyVersion: settings.recordVersion || '' } : null;
}

// This calculator never changes invoices, receipts, allocations or its inputs.
export function quoteSchoolFeePaymentPlan({ rule = null, originalTotal, balance, components = [], now = new Date() } = {}) {
  const remaining = cents(balance ?? money(components.reduce((sum, item) => sum + cents(item.Amount ?? 0, 'Fee amount'), 0)), 'Outstanding school fees');
  const original = cents(originalTotal ?? money(components.reduce((sum, item) => sum + cents(item.OriginalAmount ?? item.Amount ?? 0, 'Original fee amount'), 0)), 'Original school fees');
  if (remaining > original) fail('The outstanding balance exceeds the original school-fee total. Refresh billing before checkout.', 409);
  const normalized = rule ? normalizeSchoolFeePaymentPlan(rule) : null;
  const planMode = normalized?.Mode || 'Existing fee-item rules', credited = original - remaining;
  let minimum = remaining, description = 'Pay the outstanding school-fee balance in full.', nextInstallment;
  const schedule = [];
  if (planMode === 'Existing fee-item rules') {
    const eligible = components.filter(item => ['yes', 'y', 'true', '1'].includes(key(item.AllowInstallment))
      && ['total', 'both'].includes(key(item.PartPaymentMode || 'Item')));
    const configured = eligible.reduce((max, item) => Math.max(max, cents(item.MinAmount || 0, 'Fee-item minimum')), 0);
    minimum = eligible.length ? Math.min(remaining, configured || 100) : remaining;
    description = 'Uses the existing fee-item rules for total school-fee payments.';
  } else if (planMode === 'Percentage') {
    const base = normalized.PercentageBasis === 'Outstanding balance' ? remaining : original;
    minimum = Math.min(remaining, Number((BigInt(base) * BigInt(Math.round(normalized.Value * 100)) + 9999n) / 10000n));
    description = `Minimum ${normalized.Value}% of ${normalized.PercentageBasis.toLowerCase()}, capped at the outstanding balance.`;
  } else if (planMode === 'Fixed minimum') {
    minimum = Math.min(remaining, cents(normalized.Value, 'Fixed minimum'));
    description = 'Pay at least the fixed minimum, or the remaining balance when it is smaller.';
  } else if (planMode === 'Equal installments') {
    const count = normalized.InstallmentCount, portion = Math.floor(original / count);
    let cumulative = 0;
    for (let index = 0; index < count; index++) {
      const amount = index === count - 1 ? original - cumulative : portion;
      cumulative += amount;
      schedule.push({ number: index + 1, dueDate: normalized.DueDates[index] || '', amount: money(amount),
        cumulativeAmount: money(cumulative), remainingAmount: money(Math.max(0, Math.min(amount, cumulative - credited))) });
    }
    const firstUnpaid = schedule.findIndex(item => cents(item.cumulativeAmount, 'Installment total') > credited);
    if (firstUnpaid < 0) minimum = 0;
    else {
      let target = firstUnpaid;
      if (normalized.DueDates.length) {
        const today = financeDate(now instanceof Date ? now.toISOString().slice(0, 10) : clean(now).slice(0, 10), 'Quote date');
        for (let index = 0; index < schedule.length; index++) if (schedule[index].dueDate <= today) target = Math.max(target, index);
      }
      minimum = Math.min(remaining, cents(schedule[target].cumulativeAmount, 'Installment total') - credited);
      nextInstallment = { ...schedule[target], requiredAmount: money(minimum) };
    }
    description = `${count} portions of the original school-fee total. Existing credits reduce the next amount; overdue portions are due together.`;
  }
  return { total: money(remaining), minAmount: money(minimum), maxAmount: money(remaining),
    allowInstallment: remaining > 0 && minimum < remaining, planMode, policyVersion: clean(rule?.policyVersion || rule?.recordVersion),
    ruleId: clean(rule?.RuleId), ruleSnapshot: normalized,
    description, originalTotal: money(original), creditedAmount: money(credited), schedule, ...(nextInstallment ? { nextInstallment } : {}) };
}

export async function handleSchoolFeePaymentPlans(env, user = {}, body = {}, overrides = {}) {
  const db = { getDocument, listCollection, batchCommitLiteralDocuments, ...overrides };
  const role = user.assignedRole || user.role;
  if (user.edition && key(user.edition) !== 'school') fail('Part-payment plans are available only in the School edition.', 403);
  if (!clean(user.username) || !['Super Admin', 'Director', 'Accounts Officer', 'Management', 'Treasurer'].includes(role)
      || !(user.allowedSections || []).some(section => ['accounts', 'accounting'].includes(section))) fail('Accounts access is required to manage part-payment plans.', 403);
  const branchId = feeSetupBranch({ BranchId: body.BranchId || user.branchId || 'main', DeviceBranchId: user.deviceBranchId });
  const allowed = assignedStaffBranches(user);
  if (allowed !== null && !allowed.includes(branchId)) fail('Choose one of your assigned branches.', 403);
  if (!['list', 'save'].includes(body.action)) fail('Choose a valid part-payment plan action.');
  if (body.action === 'save' && (user.subscriptionActive === false || user.subscriptionReadOnly === true)) fail('This subscription is read-only.', 403);
  const { id, row, settings } = await readSettings(env, branchId, db);
  if (body.action === 'list') {
    const categories = await db.listCollection(env, 'billingCategories');
    const names = new Map(['All', ...DEFAULT_BILLING_CATEGORIES, ...categories.map(item => item.Name), ...settings.rules.map(item => item.Name)]
      .filter(Boolean).map(name => [key(name), name]));
    return { ok: true, ...settings, categories: [...names.values()].sort() };
  }
  const normalized = normalizeSchoolFeePaymentPlan(body), RuleId = await schoolFeePaymentPlanRuleId(branchId, normalized);
  const rule = { ...normalized, RuleId }, previous = settings.rules.find(item => item.RuleId === RuleId);
  if (previous && JSON.stringify(previous) === JSON.stringify(rule)) return { ok: true, changed: false, rule,
    recordVersion: settings.recordVersion, message: 'This part-payment plan is already saved.' };
  if (settings.recordVersion !== clean(body.recordVersion)) fail('These part-payment plans changed. Reload the settings before saving.', 409);
  if (!previous && settings.rules.length >= MAX_RULES) fail('This branch already has 200 part-payment rules. Update an existing rule.', 409);
  const stamp = new Date().toISOString(), auditId = `FEE-PAYMENT-PLAN-${crypto.randomUUID()}`;
  const rules = [...settings.rules.filter(item => item.RuleId !== RuleId), rule].sort((left, right) => left.RuleId.localeCompare(right.RuleId));
  const saved = await db.batchCommitLiteralDocuments(env, [
    { collectionPath: COLLECTION, documentId: id, ...(row ? { updateTime: settings.recordVersion } : { exists: false }),
      data: { BranchId: branchId, Rules: rules, CreatedAt: row?.CreatedAt || stamp, UpdatedAt: stamp, UpdatedBy: user.username } },
    { collectionPath: 'accountingAudit', documentId: auditId, exists: false, data: {
      AuditId: auditId, Timestamp: stamp, Action: 'Saved total school-fee part-payment plan', EntityType: 'School-fee payment plan', EntityId: RuleId,
      BranchId: branchId, User: user.displayName || user.username, ActorUsername: user.username, UserRole: role,
      Before: previous || null, After: rule, Details: 'Applies to new total-school-fee checkouts. Fee items, invoices, payments and ledger records are unchanged.' } }
  ]);
  return { ok: true, changed: true, rule, recordVersion: saved.writeResults[0].updateTime,
    message: 'Part-payment plan saved for new total-school-fee checkouts in this branch. Existing invoices, payments and individual fee-item rules are unchanged.' };
}
