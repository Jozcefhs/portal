import { modulePermissionRole } from './module-authority.js';
import { getDocument, queryCollection, listCollection, batchCommitLiteralDocuments } from './firestore.js';
import { feeBranchId, feeSetupBranch } from './fee-branch-scope.js';
import { assignedStaffBranches } from './staff-branch-access.js';
import { studentProfileValue } from './student-billing-profile.js';

const clean = value => String(value ?? '').trim();
const key = value => clean(value).toLowerCase().replace(/\s+/g, ' ');
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
export const DEFAULT_BILLING_CATEGORIES = ['Regular', 'School Staff Child', 'Church Staff Child', 'Sibling Discount', 'Partial Scholarship', 'Full Scholarship', 'Sponsored'];
const standardTerms = ['First Term', 'Second Term', 'Third Term'];
const wildcard = value => ['', '*', 'all'].includes(key(value));
const selectableName = value => typeof value === 'string' && !wildcard(value) && !/[\u0000-\u001f]/.test(value);

function discountScope(input, dimension) {
  const scopeField = `${dimension}Scope`, namesField = `${dimension}Names`;
  const mode = input[scopeField] === undefined ? 'All' : input[scopeField];
  const names = input[namesField] === undefined ? [] : input[namesField];
  if (!['All', 'Selected'].includes(mode) || !Array.isArray(names) || !names.every(selectableName)) {
    fail(`Choose a valid ${dimension.toLowerCase()} selection.`);
  }
  if (mode === 'Selected' && !names.length) fail(`Select at least one ${dimension.toLowerCase()}.`);
  if (mode === 'All' && names.length) fail(`Clear the selected names to apply this discount to every ${dimension.toLowerCase()}.`);
  return { [scopeField]: mode, [namesField]: [...new Set(names.map(clean))].sort() };
}

function publicRule(row) {
  if (!row) return null;
  const rates = row.Rates === undefined ? [] : row.Rates;
  if (!Array.isArray(rates) || rates.length > 100 || new Set(rates.map(rate => rate?.RateId)).size !== rates.length) {
    fail('Review the stored discount rates for this category.', 409);
  }
  return { Name: row.Name, BranchId: feeBranchId(row), DiscountType: row.DiscountType, DiscountValue: row.DiscountValue,
    Currency: row.Currency || 'NGN', Rates: rates.map(rate => scopedRate(row.Name, rate)),
    recordVersion: row.__updateTime || row.recordVersion || '' };
}

export function normalizeBillingDiscount(input) {
  const Name = clean(input.Name), DiscountType = clean(input.DiscountType || 'None');
  if (!Name || Name.length > 100 || /[\u0000-\u001f]/.test(Name) || ['all', '*'].includes(key(Name))) fail('Choose a valid billing category.');
  if (!['None', 'Percentage', 'Fixed amount'].includes(DiscountType)) fail('Choose None, Percentage or Fixed amount.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(String(input.DiscountValue ?? 0))) fail('Enter a non-negative discount with at most two decimal places.');
  const DiscountValue = Number(input.DiscountValue ?? 0);
  if (!Number.isFinite(DiscountValue) || DiscountValue > 100000000 || DiscountType === 'Percentage' && DiscountValue > 100) fail('Percentage must be between 0 and 100; fixed discounts must be at most 100,000,000.');
  if (key(Name) === 'full scholarship' && DiscountType !== 'None') fail('Full Scholarship already exempts standard fees. Keep its explicitly assigned fee exceptions in Fee Setup.');
  return { Name, DiscountType, DiscountValue: DiscountType === 'None' ? 0 : DiscountValue, Currency: 'NGN',
    ...discountScope(input, 'Class'), ...discountScope(input, 'Term') };
}

export async function billingDiscountId(branch, name) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([feeBranchId({ BranchId: branch }), key(name)])));
  return `DISCOUNT-${Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function matchesAccountCategory(rule, account) {
  return rule && feeBranchId(rule) === feeBranchId(account) && key(rule.Name) === key(account.BillingCategory || 'Regular');
}

function matchesDiscountClass(rule, account) {
  if (rule.ClassScope === 'All') return true;
  const currentClass = studentProfileValue(account, 'ClassName', ['className', 'ClassApplyingFor', 'classApplyingFor', 'ClassAdmitted', 'classAdmitted']);
  // Fee-item aliases can conflate distinct configured programmes (e.g. Crèche
  // and Playgroup). A discount selection identifies the actual catalogue name.
  return rule.ClassNames.some(name => key(name) === key(currentClass));
}

function rateForTerm(classRates, term, fallback) {
  const matches = classRates.filter(rate => rate.TermScope === 'All' || rate.TermNames.some(name => key(name) === term));
  if (matches.length > 1) fail('Overlapping discount rates require finance review before billing.', 409);
  return matches[0] || fallback;
}

export function selectBillingDiscount(rows, account) {
  const rule = publicRule((rows || []).find(row => matchesAccountCategory(row, account)));
  if (!rule || !rule.Rates.length) return rule;
  const rates = rule.Rates.filter(rate => matchesDiscountClass(rate, account));
  if (!rates.length && rule.DiscountType === 'None') return null;
  return { ...rule, Rates: rates };
}

// Older desktops calculate account-screen fees for the displayed account's
// term using a single rate. Hypothetical fee lookup uses a separate API.
export function desktopBillingOverview(overview, clientVersion) {
  if (Number(clientVersion) >= 1 || !overview.accounts?.some(account => account.BillingDiscount?.Rates?.length)) return overview;
  return { ...overview, accounts: overview.accounts.map(account => {
    const policy = account.BillingDiscount;
    if (!policy?.Rates?.length) return account;
    const rate = rateForTerm(policy.Rates.filter(row => matchesDiscountClass(row, account)), key(account.Term), policy);
    return { ...account, BillingDiscount: { Name: policy.Name, BranchId: policy.BranchId, Currency: policy.Currency,
      recordVersion: policy.recordVersion, DiscountType: rate.DiscountType, DiscountValue: rate.DiscountValue } };
  }) };
}

// Fetch the entire category policy. Batch generation shares it across learners
// and recovery needs to see even policies outside the learner's current class.
export async function loadBillingDiscount(env, account, overrides = {}) {
  const db = { getDocument, ...overrides };
  const row = await db.getDocument(env, 'billingCategoryDiscounts', await billingDiscountId(feeBranchId(account), account.BillingCategory || 'Regular'));
  return matchesAccountCategory(row, account) ? publicRule(row) : null;
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
  // Quotes can be recalculated for a different profile or period. Always
  // restart from their component prices. Posted invoices are overlaid later.
  if (fees.some(fee => fee.BillingDiscount?.BeforeAmount != null)) {
    fees = fees.map(fee => {
      if (fee.BillingDiscount?.BeforeAmount == null) return fee;
      const { BillingDiscount, ...base } = fee;
      return { ...base, Amount: BillingDiscount.BeforeAmount };
    });
  }
  const rule = account.BillingDiscount;
  if (!rule || key(account.BillingCategory) === 'full scholarship') return fees;
  if (!matchesAccountCategory(rule, account)) return fees;
  const policy = publicRule(rule);
  const fallback = normalizeBillingDiscount(policy);
  const classRates = policy.Rates.filter(rate => matchesDiscountClass(rate, account));
  const groups = new Map(), result = [...fees];
  fees.forEach((fee, index) => {
    const description = [fee.FeeCode, fee.FeeName, fee.FeeCategory].map(key).join(' ').replace(/[_-]/g, ' ');
    if (!eligible(fee) || /\bacceptance\b/.test(description) || feeBranchId(fee) !== feeBranchId(account)) return;
    const term = key(wildcard(fee.Term) ? account.Term : fee.Term);
    const period = JSON.stringify([feeBranchId(fee), key(wildcard(fee.AcademicSession) ? account.AcademicSession : fee.AcademicSession), term]);
    if (!groups.has(period)) {
      groups.set(period, { rate: rateForTerm(classRates, term, fallback), rows: [] });
    }
    const group = groups.get(period);
    if (group.rate.DiscountType === 'None' || !group.rate.DiscountValue) return;
    if (clean(fee.Currency || 'NGN').toUpperCase() !== fallback.Currency) fail('Review the fee currency before applying the billing discount.', 409);
    const cents = Math.round(Number(fee.Amount ?? 0) * 100);
    if (!Number.isSafeInteger(cents) || cents < 0) fail('Review the fee amount before applying the billing discount.', 409);
    group.rows.push({ index, cents: BigInt(cents), order: key(fee.FeeCode || fee.__id || fee.FeeName) });
  });
  for (const { rate, rows } of groups.values()) {
    const total = rows.reduce((sum, row) => sum + row.cents, 0n);
    if (!total) continue;
    const raw = rate.DiscountType === 'Percentage' ? (total * BigInt(Math.round(rate.DiscountValue * 100)) + 5000n) / 10000n : BigInt(Math.round(rate.DiscountValue * 100));
    const discount = raw > total ? total : raw;
    rows.forEach(row => { row.share = discount * row.cents / total; row.remainder = discount * row.cents % total; });
    let left = discount - rows.reduce((sum, row) => sum + row.share, 0n);
    rows.sort((a, b) => a.remainder === b.remainder ? a.order.localeCompare(b.order) : a.remainder > b.remainder ? -1 : 1);
    for (const row of rows) { if (left > 0n) { row.share++; left--; }
      result[row.index] = { ...fees[row.index], Amount: Number(row.cents - row.share) / 100,
        BillingDiscount: { Category: policy.Name, Type: rate.DiscountType, Value: rate.DiscountValue, ...(rate.RateId ? { RateId: rate.RateId } : {}),
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

async function loadDiscountClasses(env, branch, db) {
  const { classes } = await db.getSchoolClasses(env, { BranchId: branch, IncludeAcademicClasses: true });
  return [...new Set(classes.filter(row => row.Active !== 'NO').map(row => row.ClassName).filter(selectableName))];
}

async function loadDiscountTerms(env, branch, db) {
  const rows = await db.queryCollection(env, 'academicTerms', {
    filters: [{ field: 'BranchId', op: '==', value: branch }], limit: 501
  });
  if (rows.length > 500) fail('The branch term catalogue exceeds the supported size. Review its terms.', 409);
  const names = [...standardTerms, ...rows.filter(row => feeBranchId(row) === branch && ['active', 'planned'].includes(key(row.Status)))
    .map(row => row.Name).filter(selectableName)];
  const options = new Map();
  for (const name of names) if (!options.has(key(name))) options.set(key(name), clean(name));
  return [...options.values()];
}

function scopedRate(name, input) {
  if (typeof input?.RateId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(input.RateId) || input.RateId === 'default') fail('Choose a valid scoped discount rate.');
  const { DiscountType, DiscountValue, ClassScope, ClassNames, TermScope, TermNames } = normalizeBillingDiscount({ ...input, Name: name });
  if (ClassScope === 'All' && TermScope === 'All') fail('Select classes or terms for this rate. Use the default rate for all classes and terms.');
  return { RateId: input.RateId, DiscountType, DiscountValue, ClassScope, ClassNames, TermScope, TermNames };
}

function scopesOverlap(a, b, dimension) {
  const scope = `${dimension}Scope`, names = `${dimension}Names`;
  return a[scope] === 'All' || b[scope] === 'All' || a[names].some(name => b[names].some(other => key(other) === key(name)));
}

// Old clients omit both fields. Keep the stored selection for that dimension.
// Previously selected, retired options can be retained or removed explicitly.
async function resolveSavedScope(input, previous, body, dimension, loadOptions) {
  const scopeField = `${dimension}Scope`, namesField = `${dimension}Names`;
  if (previous && !Object.hasOwn(body, scopeField) && !Object.hasOwn(body, namesField)) {
    return { [scopeField]: previous[scopeField], [namesField]: previous[namesField] };
  }
  const names = input[namesField], retained = new Set(previous?.[namesField]);
  if (names.every(name => retained.has(name))) return { [scopeField]: input[scopeField], [namesField]: names };
  const options = new Map((await loadOptions()).map(name => [key(name), name]));
  const canonical = names.map(name => {
    if (retained.has(name)) return name;
    if (!options.has(key(name))) fail(`Choose a ${dimension.toLowerCase()} available in this branch: ${name}.`);
    return options.get(key(name));
  });
  return { [scopeField]: input[scopeField], [namesField]: [...new Set(canonical)].sort() };
}

export async function handleBillingDiscounts(env, user, body, overrides = {}) {
  const db = { getDocument, queryCollection, listCollection, batchCommitLiteralDocuments, ...overrides };
  const role = modulePermissionRole(user, 'accounts');
  if (!clean(user.username) || !['Super Admin', 'Director', 'Accounts Officer', 'Management', 'Treasurer'].includes(role) ||
      !(user.allowedSections || []).some(section => ['accounts', 'accounting'].includes(section))) fail('Accounts access is required to manage billing discounts.', 403);
  const branch = feeSetupBranch({ BranchId: body.BranchId || user.branchId || 'main', DeviceBranchId: user.deviceBranchId });
  const allowed = assignedStaffBranches(user);
  if (allowed !== null && !allowed.includes(branch)) fail('Choose one of your assigned branches.', 403);
  if (body.action === 'list') {
    const withOptions = body.IncludeOptions === true;
    const [rules, categories, classes, terms] = await Promise.all([loadBillingDiscounts(env, branch, db), db.listCollection(env, 'billingCategories'),
      withOptions && loadDiscountClasses(env, branch, db), withOptions && loadDiscountTerms(env, branch, db)]);
    if (db.desktopClient && !(Number(body.ScopedRatesVersion) >= 1) && rules.some(policy => policy.Rates.some(rate =>
      (rate.DiscountValue || Number(policy.DiscountValue)) &&
      (rate.DiscountValue !== Number(policy.DiscountValue) || rate.DiscountType !== policy.DiscountType)))) {
      fail('This branch uses class or term-specific discount rates. Update the desktop app to view fee estimates or edit its discounts.', 409);
    }
    const names = new Map([...DEFAULT_BILLING_CATEGORIES, ...categories.map(row => row.Name), ...rules.map(row => row.Name)].filter(Boolean).map(name => [key(name), name]));
    return { ok: true, scopedRatesVersion: 1, branchId: branch, rules, categories: [...names.values()].sort(), ...(withOptions ? { classes, terms } : {}) };
  }
  if (body.action !== 'save') fail('Choose a valid billing discount action.');
  if (user.subscriptionActive === false || user.subscriptionReadOnly === true) fail('This subscription is read-only.', 403);
  if (body.RemoveRate !== undefined && typeof body.RemoveRate !== 'boolean') fail('Choose a valid discount rate action.');
  const input = normalizeBillingDiscount(body), id = await billingDiscountId(branch, input.Name);
  const old = await db.getDocument(env, 'billingCategoryDiscounts', id);
  if (old && (!old.__updateTime || !matchesAccountCategory(old, { BranchId: branch, BillingCategory: input.Name }))) fail('Review this discount record before saving.', 409);
  const previous = publicRule(old), rateId = body.RateId === undefined ? 'default' : body.RateId;
  if (typeof rateId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(rateId)) fail('Choose a valid discount rate.');
  const rates = previous?.Rates || [];
  const value = { Name: previous?.Name || input.Name, BranchId: branch, Currency: 'NGN',
    DiscountType: previous?.DiscountType || 'None', DiscountValue: previous?.DiscountValue || 0, Rates: rates };
  if (rateId === 'default') {
    if (body.RemoveRate === true || input.ClassScope !== 'All' || input.TermScope !== 'All') fail('The default rate covers all classes and terms. Set it to None to disable it.');
    value.DiscountType = input.DiscountType;
    value.DiscountValue = input.DiscountValue;
  } else if (body.RemoveRate === true) {
    if (!previous) fail('This category has no saved discount rate to remove.');
    value.Rates = rates.filter(rate => rate.RateId !== rateId);
  } else {
    const priorRate = rates.find(rate => rate.RateId === rateId);
    const [classes, terms] = await Promise.all([
      resolveSavedScope(input, priorRate, body, 'Class', () => loadDiscountClasses(env, branch, db)),
      resolveSavedScope(input, priorRate, body, 'Term', () => loadDiscountTerms(env, branch, db))
    ]);
    const updated = scopedRate(value.Name, { ...input, RateId: rateId, ...classes, ...terms });
    if (rates.some(rate => rate.RateId !== rateId && scopesOverlap(rate, updated, 'Class') && scopesOverlap(rate, updated, 'Term'))) {
      fail('This rate overlaps another saved rate for the same class and term. Choose separate classes or terms.');
    }
    if (!priorRate && rates.length >= 100) fail('A billing category can have at most 100 scoped rates.');
    value.Rates = priorRate ? rates.map(rate => rate.RateId === rateId ? updated : rate) : [...rates, updated];
  }
  if (previous && Object.entries(value).every(([field, val]) => JSON.stringify(previous[field]) === JSON.stringify(val))) {
    return { ok: true, changed: false, rule: previous, message: 'This discount is already saved.' };
  }
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
