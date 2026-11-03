import { getDocument, queryCollection, listCollection, batchCommitLiteralDocuments } from './firestore.js';
import { feeBranchId, feeSetupBranch } from './fee-branch-scope.js';
import { assignedStaffBranches } from './staff-branch-access.js';

const clean = value => String(value ?? '').trim();
const key = value => clean(value).toLowerCase().replace(/\s+/g, ' ');
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
export const DEFAULT_BILLING_CATEGORIES = ['Regular', 'School Staff Child', 'Church Staff Child', 'Sibling Discount', 'Partial Scholarship', 'Full Scholarship', 'Sponsored'];
const publicRule = row => row ? ({ Name: row.Name, BranchId: feeBranchId(row), DiscountType: row.DiscountType,
  DiscountValue: row.DiscountValue, Currency: row.Currency || 'NGN', recordVersion: row.__updateTime || row.recordVersion || '' }) : null;

export function normalizeBillingDiscount(input) {
  const Name = clean(input.Name), DiscountType = clean(input.DiscountType || 'None');
  if (!Name || Name.length > 100 || /[\u0000-\u001f]/.test(Name) || ['all', '*'].includes(key(Name))) fail('Choose a valid billing category.');
  if (!['None', 'Percentage', 'Fixed amount'].includes(DiscountType)) fail('Choose None, Percentage or Fixed amount.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(String(input.DiscountValue ?? 0))) fail('Enter a non-negative discount with at most two decimal places.');
  const DiscountValue = Number(input.DiscountValue ?? 0);
  if (!Number.isFinite(DiscountValue) || DiscountValue > 100000000 || DiscountType === 'Percentage' && DiscountValue > 100) fail('Percentage must be between 0 and 100; fixed discounts must be at most 100,000,000.');
  if (key(Name) === 'full scholarship' && DiscountType !== 'None') fail('Full Scholarship already exempts standard fees. Keep its explicitly assigned fee exceptions in Fee Setup.');
  return { Name, DiscountType, DiscountValue: DiscountType === 'None' ? 0 : DiscountValue, Currency: 'NGN' };
}

export async function billingDiscountId(branch, name) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([feeBranchId({ BranchId: branch }), key(name)])));
  return `DISCOUNT-${Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function selectBillingDiscount(rows, account) {
  const row = (rows || []).find(row => feeBranchId(row) === feeBranchId(account) && key(row.Name) === key(account.BillingCategory || 'Regular'));
  return publicRule(row);
}

export async function loadBillingDiscount(env, account, overrides = {}) {
  const db = { getDocument, ...overrides };
  const row = await db.getDocument(env, 'billingCategoryDiscounts', await billingDiscountId(feeBranchId(account), account.BillingCategory || 'Regular'));
  return selectBillingDiscount(row ? [row] : [], account);
}

export async function loadBillingDiscounts(env, branch, overrides = {}) {
  const db = { queryCollection, ...overrides };
  const rows = await db.queryCollection(env, 'billingCategoryDiscounts', {
    filters: branch && branch !== 'all' ? [{ field: 'BranchId', op: '==', value: feeBranchId({ BranchId: branch }) }] : [], limit: 501
  });
  if (rows.length > 500) fail('Narrow the billing categories to one branch.', 409);
  return rows.map(publicRule);
}

// Apply one total discount after component overrides, then distribute its cents
// proportionally so invoices, parent payable amounts and previews agree exactly.
export function applyTotalBillingDiscount(fees, account, eligible) {
  const rule = account.BillingDiscount;
  if (!rule || rule.DiscountType === 'None' || Number(rule.DiscountValue) === 0 || key(account.BillingCategory) === 'full scholarship') return fees;
  if (feeBranchId(rule) !== feeBranchId(account) || key(rule.Name) !== key(account.BillingCategory || 'Regular')) return fees;
  const valid = normalizeBillingDiscount(rule);
  const groups = new Map(), result = [...fees];
  fees.forEach((fee, index) => {
    const description = [fee.FeeCode, fee.FeeName, fee.FeeCategory].map(key).join(' ').replace(/[_-]/g, ' ');
    if (!eligible(fee) || /\bacceptance\b/.test(description) || feeBranchId(fee) !== feeBranchId(account)) return;
    if (clean(fee.Currency || 'NGN').toUpperCase() !== valid.Currency) fail('Review the fee currency before applying the billing discount.', 409);
    const cents = Math.round(Number(fee.BillingDiscount?.BeforeAmount ?? fee.Amount ?? 0) * 100);
    if (!Number.isSafeInteger(cents) || cents < 0) fail('Review the fee amount before applying the billing discount.', 409);
    const period = JSON.stringify([feeBranchId(fee), /^(all|\*)?$/i.test(clean(fee.AcademicSession)) ? account.AcademicSession : fee.AcademicSession,
      /^(all|\*)?$/i.test(clean(fee.Term)) ? account.Term : fee.Term]);
    if (!groups.has(period)) groups.set(period, []);
    groups.get(period).push({ index, cents: BigInt(cents), order: key(fee.FeeCode || fee.__id || fee.FeeName) });
  });
  for (const rows of groups.values()) {
    const total = rows.reduce((sum, row) => sum + row.cents, 0n);
    if (!total) continue;
    const raw = valid.DiscountType === 'Percentage' ? (total * BigInt(Math.round(valid.DiscountValue * 100)) + 5000n) / 10000n : BigInt(Math.round(valid.DiscountValue * 100));
    const discount = raw > total ? total : raw;
    rows.forEach(row => { row.share = discount * row.cents / total; row.remainder = discount * row.cents % total; });
    let left = discount - rows.reduce((sum, row) => sum + row.share, 0n);
    rows.sort((a, b) => a.remainder === b.remainder ? a.order.localeCompare(b.order) : a.remainder > b.remainder ? -1 : 1);
    for (const row of rows) { if (left > 0n) { row.share++; left--; }
      result[row.index] = { ...fees[row.index], Amount: Number(row.cents - row.share) / 100,
        BillingDiscount: { Category: valid.Name, Type: valid.DiscountType, Value: valid.DiscountValue,
          BeforeAmount: Number(row.cents) / 100, Amount: Number(row.share) / 100,
          BaseTotal: Number(total) / 100, TotalDiscount: Number(discount) / 100, PolicyVersion: rule.recordVersion || '' } };
    }
  }
  return result;
}

// A new policy is a quote for unbilled fees, never permission to replace a
// posted charge in the parent's checkout. Retain its saved allocation too.
export function billingFeesWithPostedAmounts(fees, account, invoices) {
  const period = (row, field) => /^(all|\*)?$/i.test(clean(row[field])) ? key(account[field]) : key(row[field]);
  return fees.map(fee => {
    const posted = invoices.filter(row => feeBranchId(row) === feeBranchId(account) && key(row.FeeCode) === key(fee.FeeCode) &&
      !['void', 'voided', 'cancelled', 'canceled'].includes(key(row.Status)) &&
      period(row, 'AcademicSession') === period(fee, 'AcademicSession') && period(row, 'Term') === period(fee, 'Term'));
    if (!posted.length || !fee.BillingDiscount && !posted.some(row => row.BillingDiscount)) return fee;
    if (posted.length !== 1) fail('Multiple invoices need finance review before this discounted fee can be paid.', 409);
    return { ...fee, Amount: Number(posted[0].Debit ?? posted[0].Amount ?? 0), BillingDiscount: posted[0].BillingDiscount || null };
  });
}

export async function handleBillingDiscounts(env, user, body, overrides = {}) {
  const db = { getDocument, queryCollection, listCollection, batchCommitLiteralDocuments, ...overrides };
  const role = user.assignedRole || user.role;
  if (!clean(user.username) || !['Super Admin', 'Director', 'Accounts Officer', 'Management', 'Treasurer'].includes(role) ||
      !(user.allowedSections || []).some(section => ['accounts', 'accounting'].includes(section))) fail('Accounts access is required to manage billing discounts.', 403);
  const branch = feeSetupBranch({ BranchId: body.BranchId || user.branchId || 'main', DeviceBranchId: user.deviceBranchId });
  const allowed = assignedStaffBranches(user);
  if (allowed !== null && !allowed.includes(branch)) fail('Choose one of your assigned branches.', 403);
  if (body.action === 'list') {
    const [rules, categories] = await Promise.all([loadBillingDiscounts(env, branch, db), db.listCollection(env, 'billingCategories')]);
    const names = new Map([...DEFAULT_BILLING_CATEGORIES, ...categories.map(row => row.Name), ...rules.map(row => row.Name)].filter(Boolean).map(name => [key(name), name]));
    return { ok: true, branchId: branch, rules, categories: [...names.values()].sort() };
  }
  if (body.action !== 'save') fail('Choose a valid billing discount action.');
  if (user.subscriptionActive === false || user.subscriptionReadOnly === true) fail('This subscription is read-only.', 403);
  const input = normalizeBillingDiscount(body), id = await billingDiscountId(branch, input.Name);
  const old = await db.getDocument(env, 'billingCategoryDiscounts', id);
  const value = { ...input, BranchId: branch };
  if (old && Object.entries(value).every(([field, val]) => old[field] === val)) return { ok: true, changed: false, rule: publicRule(old), message: 'This discount is already saved.' };
  if ((old?.__updateTime || '') !== clean(body.recordVersion)) fail('This discount changed. Reload its settings before saving.', 409);
  const stamp = new Date().toISOString(), auditId = `BILLING-DISCOUNT-${crypto.randomUUID()}`;
  const saved = await db.batchCommitLiteralDocuments(env, [
    { collectionPath: 'billingCategoryDiscounts', documentId: id, ...(old ? { updateTime: old.__updateTime } : { exists: false }),
      data: { ...value, CreatedAt: old?.CreatedAt || stamp, UpdatedAt: stamp, UpdatedBy: user.username } },
    { collectionPath: 'accountingAudit', documentId: auditId, exists: false, data: {
      AuditId: auditId, Timestamp: stamp, Action: 'Saved total school-fee discount', EntityType: 'Billing category', EntityId: input.Name,
      BranchId: branch, User: user.displayName || user.username, ActorUsername: user.username, UserRole: role,
      Before: publicRule(old), After: value, Details: 'Applies to new billing. Existing invoices, payments and ledgers preserved.' } }
  ]);
  return { ok: true, changed: true, rule: publicRule({ ...value, __updateTime: saved.writeResults[0].updateTime }),
    message: 'Discount saved for this branch. Existing invoices and payments are unchanged; existing billing differences require finance review.' };
}
