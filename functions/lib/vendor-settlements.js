import { batchCommitDocuments, getDocument, queryCollectionPages, listCollection } from './firestore.js';
import { getAccountingChartRows } from './accounting-reference-cache.js';
import { validateRequisitionPosting } from './requisition-posting.js';
import { assertRequisitionTransition } from './requisition-workflow.js';
import { findStaffUserRecord, verifyStaffApprovalPassword } from './staff-auth.js';
import { accountingChartForEdition } from './accounting-edition-scope.js';
import { amount, allocateClaim, balanceView, cents, chargeFor, clean, dateOnly, effectiveRule, fail, lower,
  normalizeRule, periodKey, plain, ruleDescription, settlementScope, visible } from './vendor-settlement-rules.js';

export const VENDOR_COLLECTIONS = Object.freeze({ vendors: 'commerceVendors', balances: 'vendorBalances',
  entries: 'vendorEarnings', lots: 'vendorClaimLots', requests: 'vendorSettlementRequests',
  payments: 'vendorSettlementPayments', periods: 'vendorChargePeriods', operations: 'vendorSettlementOperations' });
const management = new Set(['Super Admin', 'Director', 'Accounts Officer']);
const operators = new Set([...management, 'Admin', 'Management', 'Tuck Shop User', 'Store User', 'Restaurant User', 'Operations Manager']);
const role = user => clean(user.assignedRole || user.UserAssignedRole || user.role || user.Role);
const actor = user => clean(user.displayName || user.username);
const defaults = Object.freeze({ Enabled: false, AccountingConfirmed: false, PayableAccount: '2000', CommissionAccount: '4090',
  VendorReceivableAccount: '1110', BusinessTimezone: 'Africa/Lagos', RuleHistory: [] });
const inventoryCollections = Object.freeze({ tuckShop: 'tuckShopInventory', organizationStore: 'storeItems', restaurant: 'restaurantInventory' });
function id(value, label = 'record') {
  const result = clean(value);
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(result)) fail(`Choose a valid ${label}.`);
  return result;
}
function write(collectionPath, documentId, data, previous = null) {
  if (previous && !clean(previous.__updateTime)) fail('Refresh this record before changing it.', 409);
  return { collectionPath, documentId, data: plain(data), ...(previous ? { updateTime: previous.__updateTime } : { exists: false }) };
}
function audit(scope, user, action, entityId, details, operationId = crypto.randomUUID()) {
  return write('accountingAudit', `VENDOR-${operationId}`, { ...scope, AuditId: `VENDOR-${operationId}`, Timestamp: new Date().toISOString(),
    Action: action, EntityType: 'Vendor Settlement', EntityId: entityId, User: actor(user), UserRole: role(user),
    ActorUsername: clean(user.username), SourcePlatform: clean(user.sourcePlatform || 'Web'), Details: details });
}
async function commit(env, writes) {
  try { return await batchCommitDocuments(env, writes); }
  catch (error) {
    if ([409, 412].includes(Number(error.status))) fail('A vendor balance, rule or request changed. Refresh before retrying; nothing was partially posted.', 409, 'VENDOR_WRITE_CONFLICT');
    throw error;
  }
}
async function rows(env, collection, scope, vendorId = '') {
  const filters = [{ field: 'ScopeKey', op: '==', value: scope.ScopeKey }];
  if (vendorId) filters.push({ field: 'VendorId', op: '==', value: vendorId });
  return (await queryCollectionPages(env, collection, { filters, pageSize: 250, maxRows: 10000 })).filter(row => visible(row, scope));
}
async function scoped(env, collection, recordId, scope) {
  const row = await getDocument(env, collection, id(recordId));
  if (!row || !visible(row, scope)) fail('This record is unavailable in your branch or section.', 404);
  return row;
}
async function settingsFor(env, scope) {
  return { ...defaults, ...(await getDocument(env, 'settings', `vendor-settlement-${scope.ScopeKey}`) || {}) };
}
function assertEnabled(settings) {
  if (settings.Enabled !== true || settings.AccountingConfirmed !== true) fail('Accounts must confirm the vendor arrangement and account mappings before vendor sales or settlements are enabled.', 409);
}
function requireRole(user, allowed) {
  if (!allowed.has(role(user))) fail('Your role cannot perform this vendor action.', 403);
}
function requireAccess(user, action) {
  if (!clean(user.username)) fail('Sign in to manage vendor settlements.', 401);
  if (!(user.allowedSections || []).includes('vendorSettlements')) fail('Vendor settlements are not available for this account.', 403);
  if (!operators.has(role(user)) && role(user) !== 'Vendor User') fail('Your role cannot access vendor settlements.', 403);
  if (!['bootstrap', 'statement', 'previewHistorical', 'previewSale'].includes(action)
    && (user.subscriptionActive === false || user.subscriptionReadOnly === true)) fail('This workspace is read-only until the subscription is renewed.', 403);
}
async function ownVendor(env, user, scope, vendorId) {
  const vendor = await scoped(env, VENDOR_COLLECTIONS.vendors, vendorId, scope);
  if (role(user) === 'Vendor User' && lower(vendor.LoginUsername) !== lower(user.username)) fail('This vendor is not linked to your account.', 403);
  return vendor;
}
function publicVendor(vendor) {
  const { BankAccountNumber, ...rest } = plain(vendor);
  return { ...rest, BankAccountMasked: BankAccountNumber ? `••••${clean(BankAccountNumber).slice(-4)}` : '', RecordVersion: vendor.__updateTime };
}
function publicRequest(request) {
  const { BankAccountNumber, ...rest } = plain(request);
  return { ...rest, BankAccountMasked: BankAccountNumber ? `••••${clean(BankAccountNumber).slice(-4)}` : '', RecordVersion: request.__updateTime,
    Amount: amount(request.AmountCents), Paid: amount(request.PaidCents), Unpaid: amount(request.AmountCents - (request.PaidCents || 0)) };
}
function balanceFor(vendor, previous = null) {
  return previous || { ScopeKey: vendor.ScopeKey, BranchId: vendor.BranchId, OrganisationEdition: vendor.OrganisationEdition,
    SchoolSection: vendor.SchoolSection, VendorId: vendor.VendorId, GrossCents: 0, RefundCents: 0, ChargeCents: 0, NetCents: 0,
    ReservedCents: 0, PaidCents: 0, DirectSalesCents: 0, DirectChargeCents: 0, DirectChargePaidCents: 0 };
}
async function validateJournal(env, journal, edition) {
  const [chart, periods] = await Promise.all([getAccountingChartRows(env, { fresh: true }), listCollection(env, 'accountingPeriods')]);
  validateRequisitionPosting(journal, chart, periods, edition);
  const debit = journal.Lines.reduce((sum, line) => sum + cents(line.Debit), 0);
  const credit = journal.Lines.reduce((sum, line) => sum + cents(line.Credit), 0);
  if (debit !== credit || !debit || journal.Lines.some(line => cents(line.Debit) < 0 || cents(line.Credit) < 0)) fail('The vendor journal does not balance.', 409);
  journal.TotalDebit = amount(debit); journal.TotalCredit = amount(credit);
}
async function authorize(env, user, body, options) {
  const method = options?.authorizationMethod || (await verifyStaffApprovalPassword(env, user.username, body.approvalPassword) ? 'Password' : '');
  if (!method) fail('Confirm this decision with your current password or a valid approval proof.', 403);
  return method;
}
function checkVersion(body, row) {
  if (!clean(body.RecordVersion) || body.RecordVersion !== row.__updateTime) fail('This record changed or has not been refreshed. Reload before proceeding.', 409);
}
async function operation(env, scope, user, body, action) {
  const requestId = id(body.RequestId, 'request reference');
  const key = `${scope.ScopeKey}--${requestId}`;
  const businessFields = new Set(['VendorId', 'SettlementId', 'EntryId', 'SaleNo', 'Amount', 'From', 'To', 'Status', 'Date', 'Reference', 'EvidenceReference',
    'Notes', 'PaymentAccount', 'PaymentMethod', 'OpeningReference', 'GrossSales', 'Refunds', 'SchoolDeductions', 'PriorPayments', 'OffsetAccount', 'PreviewDigest', 'Confirmed', 'Kind', 'ReplacesSettlementId']);
  const fields = Object.fromEntries(Object.entries(body).filter(([key]) => businessFields.has(key)).sort(([a], [b]) => a.localeCompare(b)));
  const fingerprint = JSON.stringify(fields);
  const previous = await getDocument(env, VENDOR_COLLECTIONS.operations, key);
  if (previous) {
    if (previous.Action !== action || previous.Username !== user.username || previous.VendorId !== clean(body.VendorId)
      || previous.Fingerprint !== fingerprint || previous.SubjectId !== clean(body.SettlementId || body.SaleNo || body.OpeningReference)) fail('This request reference was used for another operation.', 409);
    return { replay: { ok: true, replayed: true, message: 'This vendor action was already recorded.', ...previous.Result } };
  }
  return { key, entry: { ...scope, Action: action, Username: user.username, VendorId: clean(body.VendorId),
    SubjectId: clean(body.SettlementId || body.SaleNo || body.OpeningReference), Fingerprint: fingerprint, CreatedAt: new Date().toISOString() } };
}
function operationWrite(op, result) { return write(VENDOR_COLLECTIONS.operations, op.key, { ...op.entry, Result: result }); }

export async function snapshotVendorCart(env, items, user, timestamp = new Date().toISOString()) {
  if (!(items || []).some(item => clean(item.VendorId))) return items;
  const scope = settlementScope(user), settings = await settingsFor(env, scope);
  assertEnabled(settings);
  const vendorIds = [...new Set(items.map(item => clean(item.VendorId)).filter(Boolean))];
  if (vendorIds.length > 20) fail('A checkout can contain at most 20 vendors.');
  const vendors = new Map();
  for (const vendorId of vendorIds) {
    const vendor = await scoped(env, VENDOR_COLLECTIONS.vendors, vendorId, scope);
    if (vendor.Active === 'NO') fail(`${vendor.Name} is not active.`, 409);
    if (scope.OrganisationEdition === 'school' && items.some(item => item.VendorId === vendorId
      && clean(item.SchoolSection) && lower(item.SchoolSection) !== lower(vendor.SchoolSection))) fail('Product ownership and vendor school section differ. Review the stock record.', 409);
    vendors.set(vendorId, vendor);
  }
  return items.map(item => {
    const vendor = vendors.get(clean(item.VendorId));
    return vendor ? { ...item, VendorName: vendor.Name, SchoolSection: vendor.SchoolSection,
      VendorRule: effectiveRule(vendor, settings, timestamp), VendorSettings: {
        PayableAccount: settings.PayableAccount, CommissionAccount: settings.CommissionAccount,
        VendorReceivableAccount: settings.VendorReceivableAccount, BusinessTimezone: settings.BusinessTimezone },
      VendorBankDetailsVersion: vendor.BankDetailsVersion } : item;
  });
}

// These writes join checkout's existing stock/wallet/sale/journal commit. No side-effect is performed here.
export async function prepareVendorSale(env, sale, journal) {
  const grouped = new Map();
  for (const item of sale.Items || []) {
    if (!clean(item.VendorId)) continue;
    if (!item.VendorRule || !item.VendorSettings) fail('The vendor rule snapshot is missing. Refresh the cart.', 409);
    const group = grouped.get(item.VendorId) || { vendorId: item.VendorId, name: item.VendorName,
      rule: item.VendorRule, settings: item.VendorSettings, section: item.SchoolSection, items: [], gross: 0 };
    group.items.push({ ItemName: item.ItemName, InventoryDocumentId: item.InventoryDocumentId, Quantity: item.Quantity, UnitPrice: item.UnitPrice, Amount: item.Amount });
    group.gross += cents(item.Amount); grouped.set(item.VendorId, group);
  }
  if (!grouped.size) return { writes: [], journal, settlements: [] };
  if (sale.PaymentStatus && lower(sale.PaymentStatus) !== 'paid') fail('Vendor earnings require a confirmed paid sale.',409);
  const scope = settlementScope({ edition: sale.OrganisationEdition, branchId: sale.BranchId, schoolSectionAccess: 'All' });
  const date = clean(sale.SaleDate || sale.CreatedAt), timestamp = clean(sale.PaidAt || date);
  const saleNo = id(sale.SaleNo, 'sale reference');
  const direct = sale.CollectionMode === 'Vendor collected';
  if (direct && (sale.PaymentMethod === 'Student Wallet' || sale.PaymentMethod === 'Paystack Online' || grouped.size !== 1
    || (sale.Items || []).some(item => !item.VendorId))) fail('Direct vendor collection requires one vendor and cash, bank transfer or card payment.');
  const writes = [], settlements = [];
  for (const group of grouped.values()) {
    const vendor = await scoped(env, VENDOR_COLLECTIONS.vendors, group.vendorId, scope);
    const previous = await getDocument(env, VENDOR_COLLECTIONS.balances, group.vendorId);
    if (previous && !visible(previous, scope)) fail('The vendor balance has a conflicting scope.', 409);
    const balance = balanceFor(vendor, previous), rule = group.rule;
    let charge = chargeFor(rule, group.gross), periodId = '';
    if (rule.Mode === 'Fixed charge' && rule.Basis === 'Per period') {
      periodId = `${group.vendorId}--${lower(rule.Cycle)}--${periodKey(rule, date, group.settings.BusinessTimezone)}`;
      const saved = await getDocument(env, VENDOR_COLLECTIONS.periods, periodId);
      // The first applicable rule fixes a period's charge. Mid-period rule changes start next period for that charge.
      const period = saved || { ...scope, SchoolSection: group.section, VendorId: group.vendorId, Rule: rule, GrossCents: 0, ChargeCents: 0 };
      group.rule = period.Rule;
      const newGross = period.GrossCents + group.gross;
      const newCharge = chargeFor(period.Rule, newGross);
      charge = newCharge - period.ChargeCents;
      writes.push(write(VENDOR_COLLECTIONS.periods, periodId, { ...period, GrossCents: newGross, ChargeCents: newCharge, UpdatedAt: timestamp }, saved));
    }
    const entryId = `${saleNo}--${group.vendorId}`;
    const entry = { ...scope, SchoolSection: group.section, EntryId: entryId, LotId: entryId, VendorId: group.vendorId, VendorName: group.name,
      SaleNo: saleNo, Date: timestamp, SaleDate: date, Type: direct ? 'Vendor collected sale' : 'Sale', CollectionMode: direct ? 'Vendor collected' : 'School collected',
      GrossCents: group.gross, RefundCents: 0, ChargeCents: charge, NetCents: direct ? 0 : group.gross - charge,
      RuleSnapshot: group.rule, AccountsSnapshot: group.settings, PeriodId: periodId, Items: group.items, RecordedBy: sale.RecordedBy,
      OriginalPaymentMethod: sale.PaymentMethod, OriginalLedgerNo: clean(sale.LedgerNo), CreatedAt: timestamp,
      SettlementHold: sale.InventoryStatus === 'Review Required' };
    if (direct) { balance.DirectSalesCents += group.gross; balance.DirectChargeCents += charge; }
    else { balance.GrossCents += group.gross; balance.ChargeCents += charge; balance.NetCents += group.gross - charge; }
    if (entry.SettlementHold) balance.ReviewRequired = true;
    writes.push(write(VENDOR_COLLECTIONS.entries, entryId, entry),
      write(VENDOR_COLLECTIONS.lots, entryId, { ...scope, SchoolSection: group.section, LotId: entryId, VendorId: group.vendorId,
        Date: timestamp, SaleNo: saleNo, GrossCents: group.gross, RefundedCents: 0, ChargeCents: charge, NetCents: entry.NetCents,
        PaidCents: 0, ReservedCents: 0, CollectionMode: entry.CollectionMode, PayableAccount: group.settings.PayableAccount,
        AccountsSnapshot: group.settings, RuleSnapshot: group.rule, PeriodId: periodId, Items: group.items, UpdatedAt: timestamp,
        SettlementHold: entry.SettlementHold }),
      write(VENDOR_COLLECTIONS.balances, group.vendorId, { ...balance, UpdatedAt: timestamp }, previous));
    settlements.push(entry);
  }
  const rewritten = { ...journal, Lines: journal.Lines.map(line => ({ ...line })) };
  const vendorGross = settlements.reduce((sum, entry) => sum + entry.GrossCents, 0);
  if (direct) rewritten.Lines = [];
  else {
    // Preserve the school-owned portion of the original revenue credit, including gateway-fee debits.
    const originalCredit = rewritten.Lines.findLast(line => cents(line.Credit) > 0);
    if (!originalCredit || cents(originalCredit.Credit) < vendorGross) fail('The original sale journal cannot be split safely.', 409);
    originalCredit.Credit = amount(cents(originalCredit.Credit) - vendorGross);
    rewritten.Lines = rewritten.Lines.filter(line => cents(line.Debit) || cents(line.Credit));
  }
  for (const entry of settlements) {
    if (direct) {
      if (entry.ChargeCents) rewritten.Lines.push({ AccountCode: entry.AccountsSnapshot.VendorReceivableAccount, Debit: amount(entry.ChargeCents), Credit: 0,
        VendorId: entry.VendorId, Description: `Commission receivable from ${entry.VendorName}` });
    } else if (entry.NetCents) rewritten.Lines.push({ AccountCode: entry.AccountsSnapshot.PayableAccount, Debit: 0, Credit: amount(entry.NetCents),
      VendorId: entry.VendorId, Description: `Money owed to ${entry.VendorName}` });
    if (entry.ChargeCents) rewritten.Lines.push({ AccountCode: entry.AccountsSnapshot.CommissionAccount, Debit: 0, Credit: amount(entry.ChargeCents),
      VendorId: entry.VendorId, Description: `Agreed charge for ${entry.VendorName}` });
  }
  if (!rewritten.Lines.length) return { writes, journal: null, settlements };
  await validateJournal(env, rewritten, scope.OrganisationEdition);
  rewritten.VendorSettlement = 'YES';
  return { writes, journal: rewritten, settlements };
}

async function bootstrap(env, user, scope) {
  let vendors = await rows(env, VENDOR_COLLECTIONS.vendors, scope);
  if (role(user) === 'Vendor User') vendors = vendors.filter(vendor => lower(vendor.LoginUsername) === lower(user.username));
  const ids = new Set(vendors.map(vendor => vendor.VendorId));
  const [balances, requests, settings, chart, suppliers] = await Promise.all([
    rows(env, VENDOR_COLLECTIONS.balances, scope), rows(env, VENDOR_COLLECTIONS.requests, scope), settingsFor(env, scope),
    management.has(role(user)) ? getAccountingChartRows(env) : Promise.resolve([]),
    management.has(role(user)) ? listCollection(env, 'accountingVendors') : Promise.resolve([]) ]);
  return { ok: true, vendors: vendors.map(publicVendor), balances: balances.filter(row => ids.has(row.VendorId)).map(row => ({ VendorId: row.VendorId,
    ...balanceView(row), DirectSales: amount(row.DirectSalesCents), DirectChargeDue: amount(row.DirectChargeCents - row.DirectChargePaidCents) })),
    requests: requests.filter(row => ids.has(row.VendorId)).map(row => ({ ...publicRequest(row),
      ...(role(user) === 'Accounts Officer' ? { BankAccountNumber: row.BankAccountNumber } : {}) })),
    suppliers: suppliers.filter(row => lower(row.BranchId || 'main') === scope.BranchId).map(row => ({ SupplierId: row.__id, Name: row.Name || row.VendorName })),
    settings: { ...plain(settings), RecordVersion: settings.__updateTime || '' },
    chart: accountingChartForEdition(chart, scope.OrganisationEdition).map(({ Code, Name, Type, Active }) => ({ Code, Name, Type, Active })),
    capabilities: { manage: management.has(role(user)), operate: operators.has(role(user)), vendor: role(user) === 'Vendor User',
      confirm: role(user) === 'Accounts Officer', review: role(user) === 'Admin', approve: ['Director', 'Super Admin'].includes(role(user)), pay: role(user) === 'Accounts Officer',
      saleSections: (scope.OrganisationEdition === 'school' ? ['tuckShop'] : ['organizationStore','restaurant']).filter(section => (user.allowedSections || []).includes(section)),
      edition: scope.OrganisationEdition, section: scope.SchoolSection, branchId: scope.BranchId } };
}
async function saveSettings(env, user, scope, body) {
  requireRole(user, management);
  if (scope.OrganisationEdition === 'school' && lower(scope.SchoolSection) !== 'all') fail('Only an organisation-wide finance officer can change the branch default.', 403);
  const original = await getDocument(env, 'settings', `vendor-settlement-${scope.ScopeKey}`);
  if (original) checkVersion(body, original);
  const timestamp = new Date().toISOString(), rule = normalizeRule(body.Rule || {}, timestamp);
  const history = [...(original?.RuleHistory || []), rule];
  if (history.length > 120) fail('Archive reviewed rule history before adding more revisions.', 409);
  const settings = { ...defaults, ...plain(original), ...scope, Enabled: body.Enabled === true, AccountingConfirmed: body.AccountingConfirmed === true,
    PayableAccount: id(body.PayableAccount || '2000'), CommissionAccount: id(body.CommissionAccount || '4090'),
    VendorReceivableAccount: id(body.VendorReceivableAccount || '1110'), BusinessTimezone: clean(body.BusinessTimezone || 'Africa/Lagos'),
    RuleHistory: history, UpdatedAt: timestamp, UpdatedBy: actor(user) };
  periodKey({ Cycle: 'Daily' }, timestamp, settings.BusinessTimezone);
  const chart = accountingChartForEdition(await getAccountingChartRows(env, { fresh: true }), scope.OrganisationEdition);
  for (const [key, expected] of [['PayableAccount', 'Liability'], ['CommissionAccount', 'Revenue'], ['VendorReceivableAccount', 'Asset']]) {
    const account = chart.find(row => clean(row.Code || row.__id) === settings[key] && row.Active !== 'NO');
    if (!account || account.Type !== expected || ['PayableAccount', 'CommissionAccount', 'VendorReceivableAccount'].filter(other => settings[other] === settings[key]).length !== 1)
      fail(`Choose an active, distinct ${lower(expected)} account for ${key}.`);
  }
  if (settings.Enabled) assertEnabled(settings);
  await commit(env, [write('settings', `vendor-settlement-${scope.ScopeKey}`, settings, original),
    audit(scope, user, 'VENDOR DEFAULT RULE CHANGED', scope.ScopeKey, `${ruleDescription(rule)}; enabled ${settings.Enabled}; accountant confirmation ${settings.AccountingConfirmed}`)]);
  return { ok: true, message: 'Vendor defaults saved. Previous sales retain their recorded rules.' };
}
async function saveVendor(env, user, scope, body) {
  requireRole(user, management);
  const vendorId = body.VendorId ? id(body.VendorId) : `VND-${crypto.randomUUID()}`;
  const original = await getDocument(env, VENDOR_COLLECTIONS.vendors, vendorId);
  if (original && !visible(original, scope)) fail('This vendor is outside your scope.', 403);
  if (original) checkVersion(body, original);
  const timestamp = new Date().toISOString(), name = clean(body.Name);
  if (!name || name.length > 160) fail('Enter a vendor name of at most 160 characters.');
  const section = scope.OrganisationEdition === 'school' ? clean(body.SchoolSection || original?.SchoolSection || (lower(scope.SchoolSection) === 'all' ? 'Secondary' : scope.SchoolSection)) : 'All';
  if (scope.OrganisationEdition === 'school' && !['Primary', 'Secondary'].includes(section)) fail('Choose Primary or Secondary for the vendor account.');
  if (lower(scope.SchoolSection) !== 'all' && lower(section) !== lower(scope.SchoolSection)) fail('The vendor belongs to another section.', 403);
  const account = clean(body.BankAccountNumber || original?.BankAccountNumber);
  if (account && !/^\d{6,34}$/.test(account)) fail('Enter a valid bank account number.');
  const bankChanged = account !== clean(original?.BankAccountNumber) || clean(body.BankName) !== clean(original?.BankName) || clean(body.BankAccountName) !== clean(original?.BankAccountName);
  const history = [...(original?.RuleHistory || [])];
  if (body.Rule) history.push(normalizeRule(body.Rule, timestamp, true));
  if (history.length > 120) fail('Too many rule revisions. Contact Accounts before adding more.', 409);
  const vendor = { ...plain(original), ...scope, SchoolSection: section, VendorId: vendorId, Name: name,
    ContactPerson: clean(body.ContactPerson), Phone: clean(body.Phone), Email: clean(body.Email), SupplierId: clean(body.SupplierId),
    LoginUsername: lower(body.LoginUsername), BankName: clean(body.BankName), BankAccountName: clean(body.BankAccountName), BankAccountNumber: account,
    BankDetailsVersion: bankChanged || !original ? crypto.randomUUID() : original.BankDetailsVersion,
    Active: body.Active === 'NO' ? 'NO' : 'YES', RuleHistory: history, CreatedAt: original?.CreatedAt || timestamp, UpdatedAt: timestamp, UpdatedBy: actor(user) };
  if (vendor.LoginUsername) {
    const linked = await findStaffUserRecord(env, vendor.LoginUsername);
    if (!linked || clean(linked.AssignedRole || linked.Role) !== 'Vendor User'
      || ['no','false','0','inactive','disabled'].includes(lower(linked.Active ?? true))
      || (clean(linked.BranchId) && lower(linked.BranchId) !== scope.BranchId)
      || (scope.OrganisationEdition === 'school' && clean(linked.SchoolSectionAccess) && lower(linked.SchoolSectionAccess) !== 'all'
        && lower(linked.SchoolSectionAccess) !== lower(section))) fail('Link an active Vendor User login authorised for this branch and section.');
    vendor.LoginUsername = lower(linked.Username || linked.__id);
  }
  if (vendor.SupplierId) {
    const supplier = await getDocument(env, 'accountingVendors', vendor.SupplierId);
    if (!supplier || lower(supplier.BranchId || 'main') !== scope.BranchId) fail('Choose a supplier in this branch.');
  }
  if (original && (original.ScopeKey !== vendor.ScopeKey || original.SchoolSection !== vendor.SchoolSection)) fail('Existing vendor accounts cannot be moved between branches or sections. Create a separate account.', 409);
  await commit(env, [write(VENDOR_COLLECTIONS.vendors, vendorId, vendor, original), audit(scope, user, original ? 'VENDOR UPDATED' : 'VENDOR CREATED', vendorId,
    `${name}; active ${vendor.Active}; login link changed ${lower(original?.LoginUsername) !== vendor.LoginUsername}; bank details changed ${bankChanged}; rule ${ruleDescription(effectiveRule(vendor, await settingsFor(env, scope), timestamp))}`)]);
  return { ok: true, message: 'Vendor saved. A linked login must have the restricted Vendor User role.', VendorId: vendorId };
}
async function products(env, scope) {
  const allowed = scope.OrganisationEdition === 'school' ? ['tuckShop'] : ['organizationStore', 'restaurant'];
  const result = [];
  for (const section of allowed) {
    const inventory = await listCollection(env, inventoryCollections[section]);
    result.push(...inventory.filter(row => lower(row.BranchId || 'main') === scope.BranchId
      && (!row.OrganisationEdition || row.OrganisationEdition === scope.OrganisationEdition)
      && (scope.OrganisationEdition !== 'school' || lower(scope.SchoolSection) === 'all' || lower(row.SchoolSection || 'Secondary') === lower(scope.SchoolSection)))
      .map(row => ({ Section: section, InventoryId: row.__id, ItemCode: row.ItemCode, ItemName: row.ItemName, VendorId: row.VendorId || '',
        Quantity: row.Quantity, Price: row.Price ?? row.SalePrice, SchoolSection: row.SchoolSection, RecordVersion: row.__updateTime })));
    result.filter(row => row.Section === section).forEach(row => { const original = inventory.find(r => r.__id === row.InventoryId);
      Object.assign(row, { Category:original.Category, Unit:original.Unit, Active:original.Active || 'YES' }); });
  }
  return result;
}
async function saveProduct(env, user, scope, body) {
  requireRole(user, operators);
  const section = clean(body.Section || (scope.OrganisationEdition === 'school' ? 'tuckShop' : 'organizationStore'));
  if (!(scope.OrganisationEdition === 'school' ? ['tuckShop'] : ['organizationStore', 'restaurant']).includes(section)) fail('Choose a store available in this edition.');
  const vendor = body.VendorId ? await ownVendor(env, user, scope, body.VendorId) : null;
  const itemId = body.InventoryId ? clean(body.InventoryId) : `ITEM-${crypto.randomUUID()}`;
  if (!itemId || /[\/\\]/.test(itemId) || itemId.length > 240) fail('The stock record reference is invalid.');
  const previous = await getDocument(env, inventoryCollections[section], itemId);
  if (previous) {
    if (lower(previous.BranchId || 'main') !== scope.BranchId || (previous.OrganisationEdition && previous.OrganisationEdition !== scope.OrganisationEdition)
      || (scope.OrganisationEdition === 'school' && lower(scope.SchoolSection) !== 'all' && lower(previous.SchoolSection || 'Secondary') !== lower(scope.SchoolSection))) fail('The stock record is outside your scope.', 403);
    checkVersion(body, previous);
  }
  const name = clean(body.ItemName || previous?.ItemName), quantity = Number(body.Quantity ?? previous?.Quantity ?? 0), price = Number(body.Price ?? previous?.Price ?? previous?.SalePrice ?? 0);
  if (!name || !Number.isSafeInteger(quantity) || quantity < 0 || cents(price) <= 0) fail('Enter an item name, whole-number stock quantity and positive price.');
  const item = { ...plain(previous), BranchId: scope.BranchId, OrganisationEdition: scope.OrganisationEdition,
    SchoolSection: vendor?.SchoolSection || previous?.SchoolSection || (lower(scope.SchoolSection) === 'all' ? 'Secondary' : scope.SchoolSection),
    ItemName: name, ItemCode: previous?.ItemCode || itemId, Quantity: quantity, Price: amount(cents(price)), SalePrice: amount(cents(price)),
    Category: clean(body.Category || previous?.Category || 'General Item'), Unit: clean(body.Unit || previous?.Unit || 'pcs'),
    Active: body.Active === 'NO' ? 'NO' : 'YES', VendorId: vendor?.VendorId || '', OwnershipType: vendor ? 'Vendor' : 'School',
    StoreType: section === 'organizationStore' ? 'Organisation Store' : clean(previous?.StoreType), UpdatedAt: new Date().toISOString(), UpdatedBy: actor(user) };
  await commit(env, [write(inventoryCollections[section], itemId, item, previous), audit(scope, user, 'VENDOR PRODUCT SAVED', itemId,
    `${name}; owner ${vendor?.Name || 'School'}; quantity ${quantity}; price ${price}`)]);
  return { ok: true, message: 'Product ownership saved. Previous sale ownership is unchanged.' };
}
async function statement(env, user, scope, body) {
  const vendor = await ownVendor(env, user, scope, body.VendorId);
  const from = dateOnly(body.From || '1970-01-01'), to = dateOnly(body.To || new Date().toISOString().slice(0, 10));
  if (from > to) fail('The start date must not follow the end date.');
  const [entries, lots, requests, payments, balance] = await Promise.all([
    rows(env, VENDOR_COLLECTIONS.entries, scope, vendor.VendorId), rows(env, VENDOR_COLLECTIONS.lots, scope, vendor.VendorId),
    rows(env, VENDOR_COLLECTIONS.requests, scope, vendor.VendorId), rows(env, VENDOR_COLLECTIONS.payments, scope, vendor.VendorId),
    getDocument(env, VENDOR_COLLECTIONS.balances, vendor.VendorId) ]);
  const inRange = row => clean(row.Date).slice(0, 10) >= from && clean(row.Date).slice(0, 10) <= to;
  const selected = entries.filter(inRange).sort((a, b) => clean(a.Date).localeCompare(clean(b.Date)));
  return { ok: true, vendor: publicVendor(vendor), from, to, balance: balanceView(balance), entries: selected.map(row => ({ ...plain(row),
    Gross: amount(row.GrossCents), Refund: amount(row.RefundCents), SchoolCharge: amount(row.ChargeCents), Net: amount(row.NetCents), RuleLabel: ruleDescription(row.RuleSnapshot),
    SettlementHold: lots.find(lot => lot.LotId === row.LotId)?.SettlementHold === true })),
    availableInPeriod: balanceView(balance).NeedsReview ? 0 : amount(Math.max(0, Math.min(Number(balance?.NetCents || 0) - Number(balance?.PaidCents || 0) - Number(balance?.ReservedCents || 0),
      lots.filter(inRange).reduce((sum, row) => sum + Math.max(0, row.NetCents - row.PaidCents - row.ReservedCents), 0)))),
    requests: requests.map(publicRequest), payments: payments.filter(inRange).map(plain),
    directSales: amount(balance?.DirectSalesCents), directChargeDue: amount((balance?.DirectChargeCents || 0) - (balance?.DirectChargePaidCents || 0)) };
}
async function requestSettlement(env, user, scope, body) {
  const vendor = await ownVendor(env, user, scope, body.VendorId), settings = await settingsFor(env, scope);
  assertEnabled(settings);
  if (vendor.Active === 'NO') fail('This vendor is inactive.', 409);
  const op = await operation(env, scope, user, body, 'requestSettlement'); if (op.replay) return op.replay;
  const from = dateOnly(body.From), to = dateOnly(body.To); if (from > to) fail('Choose a valid statement period.');
  const wanted = cents(body.Amount);
  const previous = await getDocument(env, VENDOR_COLLECTIONS.balances, vendor.VendorId), balance = balanceFor(vendor, previous);
  if (balanceView(balance).NeedsReview || wanted <= 0 || wanted > balance.NetCents - balance.PaidCents - balance.ReservedCents) fail('This amount is unavailable or the vendor balance requires review.', 409);
  const lots = (await rows(env, VENDOR_COLLECTIONS.lots, scope, vendor.VendorId)).filter(row => row.Date.slice(0, 10) >= from && row.Date.slice(0, 10) <= to)
    .sort((a, b) => clean(a.Date).localeCompare(clean(b.Date)));
  const allocations = allocateClaim(lots, wanted);
  if (allocations.length > 150) fail('This request spans too many sales. Choose a shorter period.', 413);
  const timestamp = new Date().toISOString(), settlementId = `VREQ-${id(body.RequestId)}`;
  let replaced = null;
  if (body.ReplacesSettlementId) {
    replaced = await scoped(env, VENDOR_COLLECTIONS.requests, body.ReplacesSettlementId, scope);
    if (replaced.VendorId !== vendor.VendorId || !['Rejected', 'Cancelled'].includes(replaced.Status)
      || replaced.ReplacedBy) fail('Cancel or reject the previous request before revising it; completed claims cannot be resubmitted.', 409);
    checkVersion(body, replaced);
  }
  const request = { ...scope, SchoolSection: vendor.SchoolSection, SettlementId: settlementId, VendorId: vendor.VendorId, VendorName: vendor.Name,
    From: from, To: to, AmountCents: wanted, PaidCents: 0, Status: 'Submitted', PaymentStatus: 'Awaiting approval',
    Allocations: allocations.map(allocation => ({ ...allocation, PayableAccount: lots.find(row => row.LotId === allocation.LotId).PayableAccount })),
    Snapshot: lots.filter(row => allocations.some(allocation => allocation.LotId === row.LotId)).map(row => ({ LotId: row.LotId, SaleNo: row.SaleNo, Date: row.Date,
      Gross: amount(row.GrossCents), Refund: amount(row.RefundedCents), Charge: amount(row.ChargeCents), Net: amount(row.NetCents), RuleSnapshot: row.RuleSnapshot,
      RuleLabel: ruleDescription(row.RuleSnapshot), Items: row.Items })),
    PayableAccount: settings.PayableAccount, BankName: vendor.BankName, BankAccountName: vendor.BankAccountName, BankAccountNumber: vendor.BankAccountNumber,
    BankDetailsVersion: vendor.BankDetailsVersion, Revision: replaced ? replaced.Revision + 1 : 1,
    ReplacesSettlementId: replaced?.SettlementId || '', RequestedByUsername: user.username, RequestedBy: actor(user), RequestedAt: timestamp,
    Notes: clean(body.Notes).slice(0, 2000), History: [{ Action: 'Submitted', By: actor(user), Username: user.username, At: timestamp }], UpdatedAt: timestamp };
  const writes = allocations.map(allocation => { const lot = lots.find(row => row.LotId === allocation.LotId);
    return write(VENDOR_COLLECTIONS.lots, lot.LotId, { ...lot, ReservedCents: lot.ReservedCents + allocation.AmountCents }, lot); });
  await commit(env, [...writes, ...(replaced ? [write(VENDOR_COLLECTIONS.requests, replaced.SettlementId, { ...replaced, ReplacedBy: settlementId }, replaced)] : []),
    write(VENDOR_COLLECTIONS.balances, vendor.VendorId, { ...balance, ReservedCents: balance.ReservedCents + wanted }, previous),
    write(VENDOR_COLLECTIONS.requests, settlementId, request), operationWrite(op, { SettlementId: settlementId }),
    audit(scope, user, 'VENDOR PAYMENT REQUESTED', settlementId, `${vendor.Name}; ${amount(wanted)}; period ${from} to ${to}`)]);
  return { ok: true, message: 'Request submitted to Accounts. The claimed earnings are reserved.', SettlementId: settlementId };
}
async function decision(env, user, scope, body, options) {
  const request = await scoped(env, VENDOR_COLLECTIONS.requests, body.SettlementId, scope);
  await ownVendor(env, user, scope, request.VendorId);
  const op = await operation(env, scope, user, { ...body, VendorId: request.VendorId }, 'decision'); if (op.replay) return op.replay;
  checkVersion(body, request);
  const next = clean(body.Status), timestamp = new Date().toISOString();
  let method = 'Authenticated session';
  if (next === 'Cancelled') {
    if (request.RequestedByUsername !== user.username && !management.has(role(user))) fail('Only the requester or Accounts can cancel this request.', 403);
    if (['Cancelled'].includes(request.Status) || request.PaymentStatus === 'Paid') fail('This request cannot be cancelled. Review it with Accounts.', 409);
    if (!['Submitted', 'Rejected'].includes(request.Status)) {
      requireRole(user, management);
      if (!clean(body.Notes)) fail('Give a reason for withdrawing the unpaid balance.');
      method = await authorize(env, user, body, options);
    }
  } else if (next === 'Posted') {
    fail('Use Record payment; approval alone cannot mark a vendor paid.', 409);
  } else { assertRequisitionTransition(request, role(user), next); method = await authorize(env, user, body, options); }
  if (next === 'Rejected' && !clean(body.Notes)) fail('Give a reason for rejecting the request.');
  const previous = await scoped(env, VENDOR_COLLECTIONS.balances, request.VendorId, scope), writes = [];
  if (['Rejected', 'Cancelled'].includes(next) && request.Status !== 'Rejected') {
    let alreadyPaid = Number(request.PaidCents || 0);
    for (const allocation of request.Allocations) {
      const used = Math.min(alreadyPaid, allocation.AmountCents); alreadyPaid -= used;
      const reserved = allocation.AmountCents - used;
      if (!reserved) continue;
      const lot = await scoped(env, VENDOR_COLLECTIONS.lots, allocation.LotId, scope);
      if (lot.ReservedCents < reserved) fail('The claim reservation requires reconciliation.', 409);
      writes.push(write(VENDOR_COLLECTIONS.lots, lot.LotId, { ...lot, ReservedCents: lot.ReservedCents - reserved }, lot));
    }
    const updatedBalance = { ...previous, ReservedCents: previous.ReservedCents - (request.AmountCents - request.PaidCents) };
    const changedLots = new Map(writes.map(w => [w.documentId, w.data]));
    updatedBalance.ReviewRequired = (await rows(env, VENDOR_COLLECTIONS.lots, scope, request.VendorId))
      .some(lot => { const r = changedLots.get(lot.LotId) || lot; return r.SettlementHold && r.GrossCents > r.RefundedCents || r.NetCents < r.PaidCents + r.ReservedCents; });
    writes.push(write(VENDOR_COLLECTIONS.balances, request.VendorId, updatedBalance, previous));
  } else if (!['Rejected', 'Cancelled'].includes(next) && balanceView(previous).NeedsReview) fail('A refund or adjustment affected this claim. Accounts must reconcile it before approval.', 409);
  const vendor = await ownVendor(env, user, scope, request.VendorId);
  const updated = { ...request, Status: next, PaymentStatus: next === 'Approved' ? 'Awaiting payment' : ['Rejected', 'Cancelled'].includes(next) ? next : 'Awaiting approval',
    ...(next === 'Admin Reviewed' ? { AdminReviewedAt: timestamp } : {}),
    ...(next === 'Approved' ? { ApprovedAt: timestamp, ApprovedBy: actor(user), BankDetailsVersion: vendor.BankDetailsVersion,
      BankName: vendor.BankName, BankAccountName: vendor.BankAccountName, BankAccountNumber: vendor.BankAccountNumber } : {}),
    History: [...request.History, { Action: next, By: actor(user), Username: user.username, At: timestamp, Notes: clean(body.Notes).slice(0, 2000), AuthorizationMethod: method }], UpdatedAt: timestamp };
  await commit(env, [...writes, write(VENDOR_COLLECTIONS.requests, request.SettlementId, updated, request), operationWrite(op, { SettlementId: request.SettlementId }),
    audit(scope, user, `VENDOR REQUEST ${next.toUpperCase()}`, request.SettlementId, `${request.VendorName}; ${amount(request.AmountCents)}`)]);
  return { ok: true, message: `Vendor request ${next.toLowerCase()}. No bank transfer was initiated.` };
}
async function pay(env, user, scope, body, options) {
  requireRole(user, new Set(['Accounts Officer']));
  const request = await scoped(env, VENDOR_COLLECTIONS.requests, body.SettlementId, scope);
  const op = await operation(env, scope, user, { ...body, VendorId: request.VendorId }, 'pay'); if (op.replay) return op.replay;
  checkVersion(body, request);
  if (request.Status !== 'Approved' || !request.ApprovedAt) fail('Only a final-approved request can be paid.', 409);
  const value = cents(body.Amount), unpaid = request.AmountCents - request.PaidCents;
  if (value <= 0 || value > unpaid) fail('Enter a positive amount no greater than the approved unpaid balance.');
  const reference = clean(body.Reference), evidence = clean(body.EvidenceReference);
  if (!reference || !evidence) fail('Enter the payment reference and evidence reference.');
  const paymentMethod = clean(body.PaymentMethod || 'Bank Transfer');
  if (!['Cash', 'Bank Transfer', 'POS / Card'].includes(paymentMethod)) fail('Choose a valid recorded payment method.');
  const date = dateOnly(body.Date), timestamp = new Date().toISOString(), authorizationMethod = await authorize(env, user, body, options);
  const vendor = await ownVendor(env, user, scope, request.VendorId);
  if (vendor.BankDetailsVersion !== request.BankDetailsVersion) fail('Vendor bank details changed after approval. Cancel the unpaid request and submit a new one for review.', 409);
  const previous = await scoped(env, VENDOR_COLLECTIONS.balances, request.VendorId, scope);
  if (balanceView(previous).NeedsReview || previous.ReservedCents < value) fail('The vendor balance or claim reservations require review before payment.', 409);
  const account = id(body.PaymentAccount || '1020'), chart = await getAccountingChartRows(env, { fresh: true });
  const cash = chart.find(row => clean(row.Code || row.__id) === account && row.Active !== 'NO');
  if (!cash || cash.Type !== 'Asset' || !['1010', '1020', '1030'].includes(account)) fail('Choose an active cash, bank or clearing account.');
  const paymentId = `VPAY-${id(body.RequestId)}`, journal = { ...scope, JournalNo: `SYS-${paymentId}`, Date: date, Status: 'Posted',
    Source: 'Vendor Settlement', SourceId: paymentId, Reference: reference, Description: `Payment to ${request.VendorName}`, VendorId: request.VendorId,
    System: 'YES', Lines: [{ AccountCode: account, Debit: 0, Credit: amount(value), Description: reference }], CreatedAt: timestamp, CreatedBy: actor(user) };
  let remaining = value, alreadyPaid = request.PaidCents, writes = [];
  for (const allocation of request.Allocations) {
    const used = Math.min(alreadyPaid, allocation.AmountCents); alreadyPaid -= used;
    const available = allocation.AmountCents - used, take = Math.min(available, remaining);
    if (!take) continue;
    const lot = await scoped(env, VENDOR_COLLECTIONS.lots, allocation.LotId, scope);
    if (lot.ReservedCents < take || lot.NetCents < lot.PaidCents + take) fail('A selected sale was refunded or its reservation changed. Reconcile the request first.', 409);
    writes.push(write(VENDOR_COLLECTIONS.lots, lot.LotId, { ...lot, ReservedCents: lot.ReservedCents - take, PaidCents: lot.PaidCents + take }, lot));
    journal.Lines.push({ AccountCode: lot.PayableAccount || allocation.PayableAccount || request.PayableAccount, Debit: amount(take), Credit: 0,
      VendorId: request.VendorId, Description: lot.SaleNo });
    remaining -= take; if (!remaining) break;
  }
  if (remaining) fail('The approved allocation does not cover this payment.', 409);
  await validateJournal(env, journal, scope.OrganisationEdition);
  const paid = request.PaidCents + value, updated = { ...request, PaidCents: paid, PaymentStatus: paid === request.AmountCents ? 'Paid' : 'Part-paid',
    History: [...request.History, { Action: 'Payment recorded', PaymentId: paymentId, Amount: amount(value), By: actor(user), Username: user.username, At: timestamp, AuthorizationMethod: authorizationMethod }], UpdatedAt: timestamp };
  const payment = { ...scope, SchoolSection: request.SchoolSection, PaymentId: paymentId, VendorId: request.VendorId, VendorName: request.VendorName,
    SettlementId: request.SettlementId, Amount: amount(value), Date: date, Reference: reference, EvidenceReference: evidence.slice(0, 2000),
    PaymentMethod: paymentMethod,
    JournalNo: journal.JournalNo, RecordedBy: actor(user), RecordedByUsername: user.username, CreatedAt: timestamp };
  await commit(env, [...writes, write(VENDOR_COLLECTIONS.requests, request.SettlementId, updated, request),
    write(VENDOR_COLLECTIONS.balances, request.VendorId, { ...previous, PaidCents: previous.PaidCents + value, ReservedCents: previous.ReservedCents - value }, previous),
    write(VENDOR_COLLECTIONS.payments, paymentId, payment), write('accountingJournals', journal.JournalNo, journal),
    operationWrite(op, { PaymentId: paymentId }), audit(scope, user, 'VENDOR PAYMENT RECORDED', paymentId, `${request.VendorName}; ${amount(value)}; reference ${reference}`)]);
  return { ok: true, message: `${updated.PaymentStatus} recorded. No bank transfer was initiated.`, PaymentId: paymentId };
}

function signedLine(code, debitCents, vendorId, description) {
  return { AccountCode: code, Debit: amount(Math.max(0, debitCents)), Credit: amount(Math.max(0, -debitCents)), VendorId: vendorId, Description: description };
}
async function refund(env, user, scope, body, options) {
  requireRole(user, new Set(['Accounts Officer']));
  const vendor = await ownVendor(env, user, scope, body.VendorId);
  const op = await operation(env, scope, user, body, 'refund'); if (op.replay) return op.replay;
  const original = await scoped(env, VENDOR_COLLECTIONS.entries, body.EntryId, scope);
  if (original.VendorId !== vendor.VendorId || !['Sale', 'Vendor collected sale'].includes(original.Type)) fail('Choose the original vendor sale.');
  const lot = await scoped(env, VENDOR_COLLECTIONS.lots, original.LotId, scope);
  const value = cents(body.Amount);
  if (value <= 0 || value > lot.GrossCents - lot.RefundedCents) fail('Refund no more than the original unrefunded sale amount.');
  if (!clean(body.Notes) || !clean(body.Reference) || !clean(body.EvidenceReference)) fail('Provide a refund reason, reference and evidence.');
  const authorizationMethod = await authorize(env, user, body, options), date = dateOnly(body.Date), timestamp = new Date().toISOString();
  const balance = await scoped(env, VENDOR_COLLECTIONS.balances, vendor.VendorId, scope);
  const allLots = await rows(env, VENDOR_COLLECTIONS.lots, scope, vendor.VendorId), updates = new Map(), writes = [];
  const changed = { ...lot, RefundedCents: lot.RefundedCents + value };
  let reversal = 0;
  if (lot.PeriodId) {
    const period = await scoped(env, VENDOR_COLLECTIONS.periods, lot.PeriodId, scope);
    const periodLots = allLots.filter(r => r.PeriodId === lot.PeriodId).sort((a, b) => clean(a.Date).localeCompare(clean(b.Date)) || a.LotId.localeCompare(b.LotId));
    if (periodLots.length > 150) fail('This period requires an accountant-reviewed adjustment; it contains too many sales for one safe refund.', 413);
    const newCharge = chargeFor(period.Rule, period.GrossCents - value);
    let remainingCharge = newCharge;
    for (const old of periodLots) {
      const row = old.LotId === lot.LotId ? changed : { ...old };
      const charge = Math.min(remainingCharge, row.GrossCents - row.RefundedCents); remainingCharge -= charge;
      reversal += old.ChargeCents - charge;
      row.ChargeCents = charge;
      row.NetCents = row.CollectionMode === 'Vendor collected' ? 0 : row.GrossCents - row.RefundedCents - charge;
      updates.set(row.LotId, row);
    }
    writes.push(write(VENDOR_COLLECTIONS.periods, lot.PeriodId, { ...period, GrossCents: period.GrossCents - value, ChargeCents: newCharge }, period));
  } else {
    // Reverse the original agreed per-sale deduction proportionally, not today's rule.
    changed.ChargeCents = Math.round(original.ChargeCents * (lot.GrossCents - changed.RefundedCents) / lot.GrossCents);
    reversal = lot.ChargeCents - changed.ChargeCents;
    changed.NetCents = original.CollectionMode === 'Vendor collected' ? 0 : lot.GrossCents - changed.RefundedCents - changed.ChargeCents;
    updates.set(lot.LotId, changed);
  }
  const direct = original.CollectionMode === 'Vendor collected';
  const updatedBalance = { ...balance, DirectSalesCents: balance.DirectSalesCents - (direct ? value : 0),
    RefundCents: balance.RefundCents + (direct ? 0 : value) };
  // A period charge spans both collection methods. A refund can move that charge
  // between a payable and a direct-collection receivable; retain each lot's mapping.
  for (const [lotId, row] of updates) {
    const old = allLots.find(r => r.LotId === lotId);
    if (old.CollectionMode === 'Vendor collected') updatedBalance.DirectChargeCents += row.ChargeCents - old.ChargeCents;
    else { updatedBalance.ChargeCents += row.ChargeCents - old.ChargeCents; updatedBalance.NetCents += row.NetCents - old.NetCents; }
  }
  updatedBalance.ReviewRequired = allLots.some(old => { const row = updates.get(old.LotId) || old; return row.SettlementHold && row.GrossCents > row.RefundedCents || row.NetCents < row.PaidCents + row.ReservedCents; });
  const refundId = `VREF-${id(body.RequestId)}`, lines = [];
  for (const [lotId, row] of updates) {
    const old = allLots.find(r => r.LotId === lotId), chargeDelta = old.ChargeCents - row.ChargeCents;
    if (old.CollectionMode !== 'Vendor collected' && old.NetCents !== row.NetCents) lines.push(signedLine(old.PayableAccount, old.NetCents - row.NetCents, vendor.VendorId, old.SaleNo));
    if (chargeDelta) {
      lines.push(signedLine(old.AccountsSnapshot.CommissionAccount, chargeDelta, vendor.VendorId, 'Agreed deduction reversal'));
      if (old.CollectionMode === 'Vendor collected') lines.push(signedLine(old.AccountsSnapshot.VendorReceivableAccount, -chargeDelta, vendor.VendorId, 'Vendor-collected refund'));
    }
    writes.push(write(VENDOR_COLLECTIONS.lots, lotId, { ...row, UpdatedAt: timestamp }, old));
  }
  if (!direct) {
    if (original.OriginalPaymentMethod === 'Student Wallet') {
      const ledger = await getDocument(env, 'ledger', original.OriginalLedgerNo);
      if (!ledger || lower(ledger.BranchId) !== scope.BranchId) fail('The original wallet purchase cannot be verified.', 409);
      lines.push(signedLine('2200', -value, vendor.VendorId, 'Return to original student wallet'));
      writes.push(write('ledger', `WALLET-${refundId}`, { ...scope, SchoolSection: vendor.SchoolSection, LedgerNo: `WALLET-${refundId}`, Date: timestamp,
        AccountRef: ledger.AccountRef, AdmissionNo: ledger.AdmissionNo, ApplicationReference: ledger.ApplicationReference,
        EntryType: 'Wallet Refund', FeeCategory: 'Wallet', Debit: 0, Credit: amount(value), Reference: clean(body.Reference),
        Description: `Refund of ${original.SaleNo}`, RecordedBy: actor(user), Metadata: JSON.stringify({ originalLedgerNo: original.OriginalLedgerNo, refundId }) }));
    } else {
      const account = id(body.PaymentAccount || '1020');
      if (!['1010', '1020', '1030'].includes(account)) fail('Choose the cash, bank or clearing account used for this refund.');
      lines.push(signedLine(account, -value, vendor.VendorId, clean(body.Reference)));
    }
  }
  const journal = { ...scope, JournalNo: `SYS-${refundId}`, Date: date, Status: 'Posted', System: 'YES', Source: 'Vendor Refund', SourceId: refundId,
    Reference: clean(body.Reference), Description: `Refund linked to ${original.SaleNo}`, Lines: lines, CreatedAt: timestamp, RecordedBy: actor(user) };
  if (lines.length) { await validateJournal(env, journal, scope.OrganisationEdition); writes.push(write('accountingJournals', journal.JournalNo, journal)); }
  const entry = { ...scope, SchoolSection: vendor.SchoolSection, EntryId: refundId, VendorId: vendor.VendorId, Type: 'Refund', Date: date,
    OriginalEntryId: original.EntryId, SaleNo: original.SaleNo, CollectionMode: original.CollectionMode, GrossCents: 0, RefundCents: value, ChargeCents: -reversal,
    NetCents: updatedBalance.NetCents - balance.NetCents,
    RuleSnapshot: original.RuleSnapshot, Items: original.Items, Notes: clean(body.Notes), Reference: clean(body.Reference),
    EvidenceReference: clean(body.EvidenceReference), JournalNo: lines.length ? journal.JournalNo : '', AuthorizationMethod: authorizationMethod, RecordedBy: actor(user), CreatedAt: timestamp,
    LotAdjustments: [...updates.values()].map(row => ({ LotId: row.LotId, NetCents: row.NetCents, ChargeCents: row.ChargeCents })) };
  await commit(env, [...writes, write(VENDOR_COLLECTIONS.balances, vendor.VendorId, updatedBalance, balance), write(VENDOR_COLLECTIONS.entries, refundId, entry),
    operationWrite(op, { RefundId: refundId }), audit(scope, user, 'VENDOR REFUND RECORDED', refundId, `${vendor.Name}; ${amount(value)}; original ${original.SaleNo}`)]);
  return { ok: true, message: `Linked refund recorded; original sale and approvals preserved.${updatedBalance.ReviewRequired ? ' Cancel affected unpaid claims or record vendor recovery before further payment.' : ''} Stock is not restocked automatically: record a stock receipt only after inspecting returned goods.`, RefundId: refundId };
}
async function historicalPreview(env, user, scope, body) {
  requireRole(user, management);
  const vendor = await ownVendor(env, user, scope, body.VendorId), settings = await settingsFor(env, scope);
  const gross = cents(body.GrossSales), refunds = cents(body.Refunds), charge = cents(body.SchoolDeductions), paid = cents(body.PriorPayments);
  if ([gross, refunds, charge, paid].some(n => n < 0) || refunds + charge > gross || paid > gross - refunds - charge) fail('The reviewed historical amounts must reconcile to a non-negative outstanding balance.');
  const plan = { ...scope, VendorId: vendor.VendorId, OpeningReference: id(body.OpeningReference, 'historical reference'),
    Date: dateOnly(body.Date), GrossCents: gross, RefundCents: refunds, ChargeCents: charge, PaidCents: paid,
    NetCents: gross - refunds - charge, OutstandingCents: gross - refunds - charge - paid,
    OffsetAccount: id(body.OffsetAccount), PayableAccount: settings.PayableAccount,
    EvidenceReference: clean(body.EvidenceReference), Notes: clean(body.Notes), Source: 'Reviewed historical opening' };
  if (!plan.EvidenceReference || !plan.Notes) fail('Give the reviewed statement evidence and an opening-balance explanation.');
  const chart = accountingChartForEdition(await getAccountingChartRows(env, { fresh: true }), scope.OrganisationEdition);
  if (!chart.some(row => clean(row.Code) === plan.OffsetAccount && ['Revenue', 'Equity'].includes(row.Type) && row.Active !== 'NO')) fail('Accounts must select an active revenue or equity offset: already-collected funds must not debit cash again.');
  const bytes = new TextEncoder().encode(JSON.stringify(plan));
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
  return { ok: true, preview: plan, PreviewDigest: digest, Outstanding: amount(plan.OutstandingCents),
    message: 'Preview only. Original sales, student wallets and historical journals will not be rewritten.' };
}
async function recordOpening(env, user, scope, body, options) {
  requireRole(user, new Set(['Accounts Officer']));
  const op = await operation(env, scope, user, body, 'recordOpening'); if (op.replay) return op.replay;
  const preview = await historicalPreview(env, user, scope, body);
  if (body.Confirmed !== true || body.PreviewDigest !== preview.PreviewDigest) fail('Load and confirm an unchanged historical preview first.', 409);
  const authorizationMethod = await authorize(env, user, body, options), p = preview.preview, timestamp = new Date().toISOString();
  const vendor = await ownVendor(env, user, scope, p.VendorId), previous = await getDocument(env, VENDOR_COLLECTIONS.balances, p.VendorId);
  const balance = balanceFor(vendor, previous), openingId = `${scope.ScopeKey}--OPEN-${p.OpeningReference}`;
  const settings = await settingsFor(env, scope); assertEnabled(settings);
  const journal = { ...scope, JournalNo: `SYS-${openingId}`, Date: p.Date, Status: 'Posted', System: 'YES', Source: p.Source, SourceId: openingId,
    Description: p.Notes, Reference: p.OpeningReference, CreatedAt: timestamp, RecordedBy: actor(user),
    Lines: [signedLine(p.OffsetAccount, p.OutstandingCents, p.VendorId, 'Reviewed historical reclassification'), signedLine(p.PayableAccount, -p.OutstandingCents, p.VendorId, 'Outstanding vendor opening')] };
  const writes = [];
  if (p.OutstandingCents) { await validateJournal(env, journal, scope.OrganisationEdition); writes.push(write('accountingJournals', journal.JournalNo, journal)); }
  await commit(env, [...writes,
    write(VENDOR_COLLECTIONS.entries, openingId, { ...p, SchoolSection: vendor.SchoolSection, EntryId: openingId, LotId: openingId, Type: p.Source,
      RuleSnapshot: { Mode: 'Full payment' }, RecordedBy: actor(user), AuthorizationMethod: authorizationMethod, CreatedAt: timestamp }),
    write(VENDOR_COLLECTIONS.lots, openingId, { ...scope, SchoolSection: vendor.SchoolSection, VendorId: p.VendorId, LotId: openingId, SaleNo: p.OpeningReference,
      Date: p.Date, GrossCents: p.OutstandingCents, RefundedCents: 0, ChargeCents: 0, NetCents: p.OutstandingCents, PaidCents: 0, ReservedCents: 0,
      PayableAccount: p.PayableAccount, CollectionMode: 'School collected', RuleSnapshot: { Mode: 'Full payment' }, Items: [] }),
    write(VENDOR_COLLECTIONS.balances, p.VendorId, { ...balance, GrossCents: balance.GrossCents + p.GrossCents, RefundCents: balance.RefundCents + p.RefundCents,
      ChargeCents: balance.ChargeCents + p.ChargeCents, NetCents: balance.NetCents + p.NetCents, PaidCents: balance.PaidCents + p.PaidCents }, previous),
    ...(p.PaidCents ? [write(VENDOR_COLLECTIONS.payments, openingId, { ...scope, SchoolSection: vendor.SchoolSection, VendorId: p.VendorId,
      PaymentId: openingId, Date: p.Date, Amount: amount(p.PaidCents), Type: 'Prior payment — reviewed opening', Reference: p.OpeningReference, EvidenceReference: p.EvidenceReference })] : []),
    operationWrite(op, { OpeningId: openingId }), audit(scope, user, 'VENDOR HISTORICAL OPENING RECORDED', openingId, `${vendor.Name}; outstanding ${amount(p.OutstandingCents)}; evidence ${p.EvidenceReference}`)]);
  return { ok: true, message: 'Reviewed opening recorded as a new adjustment. No old transaction was edited.', OpeningId: openingId };
}
async function recordRecovery(env, user, scope, body, options) {
  requireRole(user, new Set(['Accounts Officer']));
  const vendor = await ownVendor(env, user, scope, body.VendorId), op = await operation(env, scope, user, body, 'recordRecovery'); if (op.replay) return op.replay;
  const value = cents(body.Amount), date = dateOnly(body.Date), timestamp = new Date().toISOString();
  const kind = clean(body.Kind || 'Overpayment recovery'), returned = kind === 'Commission returned';
  if (!['Commission received','Commission returned','Overpayment recovery'].includes(kind)) fail('Choose a valid vendor money movement.');
  if (value <= 0 || !clean(body.Reference) || !clean(body.EvidenceReference)) fail('Enter a positive amount, reference and evidence.');
  const authorizationMethod = await authorize(env, user, body, options), previous = await scoped(env, VENDOR_COLLECTIONS.balances, vendor.VendorId, scope);
  const account = id(body.PaymentAccount || '1020'); if (!['1010', '1020', '1030'].includes(account)) fail('Choose a cash, bank or clearing account.');
  const recoveryId = `VREC-${id(body.RequestId)}`, lines = [signedLine(account, returned ? -value : value, vendor.VendorId, clean(body.Reference))], writes = [], updated = { ...previous };
  const lots = await rows(env, VENDOR_COLLECTIONS.lots, scope, vendor.VendorId), changed = new Map();
  if (kind === 'Commission received' || returned) {
    const due = previous.DirectChargeCents - previous.DirectChargePaidCents;
    if (value > (returned ? -due : due)) fail(returned ? 'The amount exceeds the refundable collected commission.' : 'The amount exceeds the outstanding direct-collection charge.');
    const settings = await settingsFor(env, scope);
    // A mapping change must not misdirect settlement of an existing receivable.
    const entries = await rows(env, VENDOR_COLLECTIONS.entries, scope, vendor.VendorId);
    const codes = new Set(entries.filter(e => e.Type === 'Vendor collected sale' && e.ChargeCents).map(e => e.AccountsSnapshot.VendorReceivableAccount));
    if (codes.size > 1) fail('Multiple historical receivable mappings require an accountant-reviewed journal instead of automatic receipt.', 409);
    lines.push(signedLine([...codes][0] || settings.VendorReceivableAccount, returned ? value : -value, vendor.VendorId, kind));
    updated.DirectChargePaidCents += returned ? -value : value;
  } else {
    let remaining = value;
    for (const lot of lots) {
      const take = Math.min(remaining, Math.max(0, lot.PaidCents - lot.NetCents));
      if (!take) continue;
      const row = { ...lot, PaidCents: lot.PaidCents - take }; changed.set(lot.LotId, row);
      writes.push(write(VENDOR_COLLECTIONS.lots, lot.LotId, row, lot));
      lines.push(signedLine(lot.PayableAccount, -take, vendor.VendorId, `Recovery for ${lot.SaleNo}`));
      remaining -= take;
    }
    if (remaining || writes.length > 150) fail('The amount exceeds the recoverable vendor overpayment or requires a shorter adjustment.');
    updated.PaidCents -= value;
  }
  updated.ReviewRequired = lots.some(old => { const r = changed.get(old.LotId) || old; return r.SettlementHold && r.GrossCents > r.RefundedCents || r.NetCents < r.PaidCents + r.ReservedCents; });
  const journal = { ...scope, JournalNo: `SYS-${recoveryId}`, Date: date, Status: 'Posted', System: 'YES', Source: returned ? 'Vendor commission returned' : 'Vendor money received', SourceId: recoveryId,
    Reference: clean(body.Reference), Description: `${kind} — ${vendor.Name}`, Lines: lines, CreatedAt: timestamp, RecordedBy: actor(user) };
  await validateJournal(env, journal, scope.OrganisationEdition);
  await commit(env, [...writes, write(VENDOR_COLLECTIONS.balances, vendor.VendorId, updated, previous), write('accountingJournals', journal.JournalNo, journal),
    write(VENDOR_COLLECTIONS.payments, recoveryId, { ...scope, SchoolSection: vendor.SchoolSection, PaymentId: recoveryId, VendorId: vendor.VendorId,
      Type: kind, Amount: (returned ? 1 : -1) * amount(value), Date: date, Reference: clean(body.Reference), EvidenceReference: clean(body.EvidenceReference),
      AuthorizationMethod: authorizationMethod, JournalNo: journal.JournalNo, RecordedBy: actor(user) }), operationWrite(op, { RecoveryId: recoveryId }),
    audit(scope, user, returned ? 'VENDOR COMMISSION RETURNED' : 'VENDOR MONEY RECEIVED', recoveryId, `${vendor.Name}; ${amount(value)}; ${kind}`)]);
  return { ok: true, message: 'Vendor money movement recorded; no bank transfer initiated.', RecoveryId: recoveryId };
}

async function completeInventoryReview(env, user, scope, body, options) {
  requireRole(user,new Set(['Accounts Officer']));
  const original = await scoped(env,VENDOR_COLLECTIONS.entries,body.EntryId,scope);
  await ownVendor(env,user,scope,original.VendorId);
  if (!['Sale','Vendor collected sale'].includes(original.Type)) fail('Choose the original paid sale.');
  const op = await operation(env,scope,user,{...body,VendorId:original.VendorId},'completeInventoryReview'); if (op.replay) return op.replay;
  if (!clean(body.Notes) || !clean(body.EvidenceReference)) fail('Enter the stock issue evidence and review notes.');
  const method = await authorize(env,user,body,options), timestamp = new Date().toISOString();
  const commerce = options.commerce || await import('./organization-commerce.js');
  const prepared = await commerce.preparePaidCommerceInventoryCompletion(env,original.SaleNo,user,timestamp);
  const writes = [...prepared.writes];
  for (const entry of prepared.sale.VendorSettlements || []) {
    const vendor = await ownVendor(env,user,scope,entry.VendorId), lot = await scoped(env,VENDOR_COLLECTIONS.lots,entry.LotId,scope);
    if (lot.RefundedCents) fail('This sale has a linked refund. Accounts must review the returned goods and remaining quantities before repairing the stock issue.',409);
    const balance = await scoped(env,VENDOR_COLLECTIONS.balances,vendor.VendorId,scope);
    const reviewed = {...lot,SettlementHold:false,InventoryReviewedAt:timestamp};
    const allLots = await rows(env,VENDOR_COLLECTIONS.lots,scope,vendor.VendorId);
    const needsReview = allLots.some(old => { const row = old.LotId === lot.LotId ? reviewed : old; return row.SettlementHold && row.GrossCents > row.RefundedCents || row.NetCents < row.PaidCents + row.ReservedCents; });
    writes.push(write(VENDOR_COLLECTIONS.lots,lot.LotId,reviewed,lot),write(VENDOR_COLLECTIONS.balances,vendor.VendorId,{...balance,ReviewRequired:needsReview},balance));
  }
  const reviewId = `VSTOCK-${id(body.RequestId)}`;
  writes.push(write(VENDOR_COLLECTIONS.entries,reviewId,{...scope,SchoolSection:original.SchoolSection,VendorId:original.VendorId,
    EntryId:reviewId,OriginalEntryId:original.EntryId,SaleNo:original.SaleNo,Date:timestamp,Type:'Stock issue reviewed',GrossCents:0,RefundCents:0,ChargeCents:0,NetCents:0,
    Notes:clean(body.Notes),EvidenceReference:clean(body.EvidenceReference),AuthorizationMethod:method,RecordedBy:actor(user)}),
    operationWrite(op,{SaleNo:original.SaleNo}),audit(scope,user,'VENDOR SALE STOCK REVIEW COMPLETED',original.SaleNo,clean(body.EvidenceReference)));
  await commit(env,writes);
  return {ok:true,message:'The original paid sale stock issue and vendor holds were completed together. No new sale, payment or earnings were created.'};
}

export async function handleVendorSettlementAction(env, user, body = {}, options = {}) {
  const action = clean(body.action || body.Action || 'bootstrap'), scope = settlementScope(user);
  requireAccess(user, action);
  switch (action) {
    case 'previewSale':
    case 'recordSale': {
      requireRole(user, operators);
      const section = clean(body.Section);
      if (!(scope.OrganisationEdition === 'school' ? ['tuckShop'] : ['organizationStore','restaurant']).includes(section)
        || !(user.allowedSections || []).includes(section)) fail('This sales workspace is not assigned to your account.',403);
      const commerce = await import('./organization-commerce.js');
      return action === 'previewSale' ? commerce.previewOrganizationCommerceSale(env, section, body, user)
        : commerce.recordManualOrganizationCommerceSale(env, section, body, user);
    }
    case 'bootstrap': {
      const data = await bootstrap(env, user, scope);
      const allowed = new Set(data.vendors.map(vendor => vendor.VendorId));
      return { ...data, products: (await products(env, scope)).filter(item => role(user) !== 'Vendor User' || allowed.has(item.VendorId)) };
    }
    case 'statement': return statement(env, user, scope, body);
    case 'saveSettings': return saveSettings(env, user, scope, body);
    case 'saveVendor': return saveVendor(env, user, scope, body);
    case 'saveProduct': return saveProduct(env, user, scope, body);
    case 'requestSettlement': return requestSettlement(env, user, scope, body);
    case 'decision': return decision(env, user, scope, body, options);
    case 'pay': return pay(env, user, scope, body, options);
    case 'refund': return refund(env, user, scope, body, options);
    case 'previewHistorical': return historicalPreview(env, user, scope, body);
    case 'recordOpening': return recordOpening(env, user, scope, body, options);
    case 'recordRecovery': return recordRecovery(env, user, scope, body, options);
    case 'completeInventoryReview': return completeInventoryReview(env,user,scope,body,options);
    default: fail('Unknown vendor settlement action.');
  }
}
