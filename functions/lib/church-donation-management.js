import {
  batchCommitDocuments,
  getDocument,
  listCollection,
  patchDocumentFields,
  upsertDocument
} from './firestore.js';
import { CHURCH_COLLECTIONS, churchCollectionPath, safeChurchDocumentId } from './church-foundation.js';
import { resolveMembershipBranch } from './church-membership.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const nowIso = () => new Date().toISOString();
const amount = (value) => {
  const parsed = Number(String(value ?? 0).replace(/,/g, ''));
  return Number.isFinite(parsed) ? Math.round((parsed + Number.EPSILON) * 100) / 100 : 0;
};

const MANAGE_ROLES = new Set(['Super Admin', 'Church Administrator', 'Treasurer']);
const VIEW_ROLES = new Set([...MANAGE_ROLES, 'Pastor', 'Auditor']);

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function actor(user = {}) {
  return clean(user.displayName || user.DisplayName || user.username || user.Username || 'Church staff');
}

function requireRole(user, roles, message) {
  if (!roles.has(clean(user.role || user.Role))) fail(message, 403);
}

function branchFor(user, body = {}) {
  return resolveMembershipBranch(user, body.BranchId || body.branchId || 'main');
}

function stripInternal(row = {}) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('__')));
}

function donorIdFor(input = {}) {
  const explicit = clean(input.DonorId || input.donorId);
  if (explicit) return safeChurchDocumentId(explicit);
  const email = lower(input.Email || input.DonorEmail || input.email);
  if (email) return safeChurchDocumentId(`DONOR-${email}`);
  const phone = clean(input.Phone || input.DonorPhone || input.phone).replace(/[^0-9+]/g, '');
  if (phone) return safeChurchDocumentId(`DONOR-${phone}`);
  return safeChurchDocumentId(`DONOR-${crypto.randomUUID()}`);
}

function normalizeDonor(input = {}, existing = {}, user = {}) {
  const displayName = clean(input.DisplayName || input.DonorName || input.Name || existing.DisplayName);
  const email = lower(input.Email || input.DonorEmail || existing.Email);
  const phone = clean(input.Phone || input.DonorPhone || existing.Phone);
  if (!displayName) fail('Enter the donor name.');
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('Enter a valid donor email address.');
  if (!email && !phone) fail('Enter at least an email address or phone number for quick reuse.');
  const now = nowIso();
  return {
    DonorId: donorIdFor({ ...existing, ...input }),
    DisplayName: displayName,
    Email: email,
    Phone: phone,
    Address: clean(input.Address || existing.Address),
    Notes: clean(input.Notes || existing.Notes),
    Active: lower(input.Active ?? existing.Active ?? 'YES') === 'no' ? 'NO' : 'YES',
    CreatedAt: clean(existing.CreatedAt) || now,
    CreatedBy: clean(existing.CreatedBy) || actor(user),
    UpdatedAt: now,
    UpdatedBy: actor(user)
  };
}

export function donationCurrencySettings(input = {}) {
  const mode = clean(input.ForeignCurrencyMode || input.Mode).toUpperCase();
  return {
    ForeignCurrencyMode: mode === 'BATCH_SETTLEMENT' ? 'BATCH_SETTLEMENT' : 'PER_DONATION',
    BaseCurrency: 'NGN'
  };
}

export async function getDonationCurrencySettings(env, branchId = 'main') {
  const path = churchCollectionPath(CHURCH_COLLECTIONS.donationSettings, branchId);
  const row = await getDocument(env, path, 'currency-policy').catch(() => null);
  return { ...donationCurrencySettings(row || {}), ...(row || {}) };
}

export async function saveDonationCurrencySettings(env, user, body = {}) {
  requireRole(user, MANAGE_ROLES, 'This staff account cannot change donation currency policy.');
  const branchId = branchFor(user, body);
  const path = churchCollectionPath(CHURCH_COLLECTIONS.donationSettings, branchId);
  const settings = {
    ...donationCurrencySettings(body),
    UpdatedAt: nowIso(),
    UpdatedBy: actor(user)
  };
  await upsertDocument(env, path, 'currency-policy', settings);
  return { ok: true, settings, message: 'Donation currency policy saved.' };
}

export async function saveDonor(env, user, body = {}) {
  requireRole(user, MANAGE_ROLES, 'This staff account cannot manage the donor register.');
  const branchId = branchFor(user, body);
  const path = churchCollectionPath(CHURCH_COLLECTIONS.donors, branchId);
  const id = donorIdFor(body);
  const existing = await getDocument(env, path, id).catch(() => null);
  const donor = normalizeDonor({ ...body, DonorId: id }, existing || {}, user);
  await upsertDocument(env, path, id, donor);
  return { ok: true, donor: { ...donor, __id: id }, message: existing ? 'Donor updated.' : 'Donor registered.' };
}

export async function registerDonorFromPaidDonation(env, donation = {}) {
  if (!donation.SaveDonorProfileRequested) return null;
  if (!['paid', 'completed'].includes(lower(donation.Status || donation.PaymentStatus))) return null;
  const branchId = clean(donation.BranchId || 'main');
  const path = churchCollectionPath(CHURCH_COLLECTIONS.donors, branchId);
  const id = donorIdFor(donation);
  const existing = await getDocument(env, path, id).catch(() => null);
  const donor = normalizeDonor({
    DonorId: id,
    DonorName: donation.DonorName,
    DonorEmail: donation.DonorEmail,
    DonorPhone: donation.DonorPhone
  }, existing || {}, { displayName: 'Verified online giving' });
  await upsertDocument(env, path, id, donor);
  return donor;
}

export function buildDonationInsights(donations = []) {
  const paid = donations.filter((row) => ['paid', 'completed'].includes(lower(row.Status || row.PaymentStatus)));
  const byDonor = new Map();
  const byCurrency = new Map();
  paid.forEach((row) => {
    const currency = clean(row.TransactionCurrency || row.Currency || 'NGN').toUpperCase();
    const original = amount(row.Amount);
    const converted = currency === 'NGN'
      ? amount(row.BaseAmount || row.Amount)
      : lower(row.ConversionStatus) === 'converted' ? amount(row.BaseAmount) : 0;
    const key = lower(row.DonorId || row.DonorEmail || row.DonorPhone || row.DonorName || 'anonymous');
    const donor = byDonor.get(key) || {
      DonorId: clean(row.DonorId),
      DonorName: clean(row.DonorName) || 'Anonymous donor',
      DonorEmail: clean(row.DonorEmail),
      DonationCount: 0,
      SettledNgnTotal: 0
    };
    donor.DonationCount += 1;
    donor.SettledNgnTotal = amount(donor.SettledNgnTotal + converted);
    byDonor.set(key, donor);
    const holding = byCurrency.get(currency) || { Currency: currency, PaidAmount: 0, AwaitingAmount: 0, DonationCount: 0 };
    holding.PaidAmount = amount(holding.PaidAmount + original);
    holding.DonationCount += 1;
    if (currency !== 'NGN' && lower(row.ConversionStatus) !== 'converted') {
      holding.AwaitingAmount = amount(holding.AwaitingAmount + original);
    }
    byCurrency.set(currency, holding);
  });
  return {
    topDonors: [...byDonor.values()]
      .filter((row) => row.SettledNgnTotal > 0)
      .sort((a, b) => b.SettledNgnTotal - a.SettledNgnTotal || b.DonationCount - a.DonationCount)
      .slice(0, 10),
    foreignHoldings: [...byCurrency.values()]
      .filter((row) => row.Currency !== 'NGN')
      .sort((a, b) => b.AwaitingAmount - a.AwaitingAmount || a.Currency.localeCompare(b.Currency))
  };
}

export function allocateCurrencySettlement(donations = [], grossNgnValue, conversionFeeValue = 0) {
  if (!donations.length) fail('Select at least one donation for settlement.');
  const currency = clean(donations[0].TransactionCurrency || donations[0].Currency).toUpperCase();
  if (!currency || currency === 'NGN') fail('Choose foreign-currency donations.');
  if (donations.some((row) => clean(row.TransactionCurrency || row.Currency).toUpperCase() !== currency)) {
    fail('A settlement batch can contain only one currency.');
  }
  const totalForeign = amount(donations.reduce((sum, row) => sum + amount(row.Amount), 0));
  const grossNgn = amount(grossNgnValue);
  const feeNgn = amount(conversionFeeValue);
  if (grossNgn <= 0) fail('Enter the gross NGN proceeds received from conversion.');
  if (feeNgn < 0 || feeNgn >= grossNgn) fail('Conversion charges must be zero or less than the gross NGN proceeds.');
  const rate = Math.round(((grossNgn / totalForeign) + Number.EPSILON) * 1e8) / 1e8;
  let allocatedGross = 0;
  let allocatedFee = 0;
  const allocations = donations.map((row, index) => {
    const last = index === donations.length - 1;
    const ratio = amount(row.Amount) / totalForeign;
    const baseAmount = last ? amount(grossNgn - allocatedGross) : amount(grossNgn * ratio);
    const baseConversionFee = last ? amount(feeNgn - allocatedFee) : amount(feeNgn * ratio);
    allocatedGross = amount(allocatedGross + baseAmount);
    allocatedFee = amount(allocatedFee + baseConversionFee);
    return {
      DonationId: clean(row.DonationId || row.__id),
      Amount: amount(row.Amount),
      BaseAmount: baseAmount,
      BaseConversionFee: baseConversionFee,
      BaseNetAmount: amount(baseAmount - baseConversionFee)
    };
  });
  return { currency, totalForeign, grossNgn, feeNgn, netNgn: amount(grossNgn - feeNgn), rate, allocations };
}

export async function settleCurrencyBatch(env, user, body = {}) {
  requireRole(user, MANAGE_ROLES, 'This staff account cannot settle foreign-currency donations.');
  const branchId = branchFor(user, body);
  const donationIds = [...new Set((Array.isArray(body.DonationIds) ? body.DonationIds : clean(body.DonationIds).split(','))
    .map(clean).filter(Boolean))];
  if (!donationIds.length) fail('Select the donations included in this conversion.');
  const donationPath = churchCollectionPath(CHURCH_COLLECTIONS.donations, branchId);
  const rows = (await Promise.all(donationIds.map((id) => getDocument(env, donationPath, safeChurchDocumentId(id))))).filter(Boolean);
  if (rows.length !== donationIds.length) fail('One or more selected donations could not be found.', 404);
  rows.forEach((row) => {
    if (!['paid', 'completed'].includes(lower(row.Status || row.PaymentStatus))) fail('Only paid donations can be settled.');
    if (lower(row.ConversionStatus) === 'converted') fail('One or more selected donations have already been converted.');
  });
  const allocation = allocateCurrencySettlement(rows, body.GrossNgnProceeds, body.ConversionFee);
  const batchId = safeChurchDocumentId(clean(body.SettlementBatchId) || `FX-${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}`);
  const settledAt = clean(body.SettlementDate) || nowIso().slice(0, 10);
  const allocationById = new Map(allocation.allocations.map((item) => [safeChurchDocumentId(item.DonationId), item]));
  const updatedDonations = rows.map((row) => {
    const id = safeChurchDocumentId(row.DonationId || row.__id);
    const share = allocationById.get(id);
    return {
      ...stripInternal(row),
      ...share,
      BaseCurrency: 'NGN',
      ExchangeRate: allocation.rate,
      ExchangeRateDate: settledAt,
      ExchangeRateSource: clean(body.ExchangeRateSource) || 'Recorded currency settlement',
      ConversionStatus: 'Converted',
      ConversionMode: 'BATCH_SETTLEMENT',
      SettlementBatchId: batchId,
      AccountingStatus: 'Pending',
      UpdatedAt: nowIso(),
      UpdatedBy: actor(user)
    };
  });
  const settlement = {
    SettlementBatchId: batchId,
    BranchId: branchId,
    Currency: allocation.currency,
    ForeignAmount: allocation.totalForeign,
    GrossNgnProceeds: allocation.grossNgn,
    ConversionFee: allocation.feeNgn,
    NetNgnProceeds: allocation.netNgn,
    ExchangeRate: allocation.rate,
    DonationIds: updatedDonations.map((row) => row.DonationId),
    DonationCount: updatedDonations.length,
    Reference: clean(body.Reference),
    SettlementDate: settledAt,
    AccountingStatus: 'Pending',
    CreatedAt: nowIso(),
    CreatedBy: actor(user)
  };
  const settlementPath = churchCollectionPath(CHURCH_COLLECTIONS.currencySettlements, branchId);
  await batchCommitDocuments(env, [
    ...updatedDonations.map((row) => ({
      collectionPath: donationPath,
      documentId: safeChurchDocumentId(row.DonationId),
      data: row,
      updateTime: rows.find((source) => safeChurchDocumentId(source.DonationId || source.__id) === safeChurchDocumentId(row.DonationId))?.__updateTime
    })),
    { collectionPath: settlementPath, documentId: batchId, data: settlement, exists: false }
  ]);
  return { ok: true, settlement: { ...settlement, __id: batchId }, donations: updatedDonations, message: `${updatedDonations.length} donation(s) settled at NGN ${allocation.rate} per ${allocation.currency}.` };
}

export async function markCurrencySettlementAccounting(env, branchId, batchId, status, message = '') {
  const path = churchCollectionPath(CHURCH_COLLECTIONS.currencySettlements, branchId);
  await patchDocumentFields(env, path, safeChurchDocumentId(batchId), {
    AccountingStatus: clean(status) || 'Pending',
    AccountingMessage: clean(message),
    UpdatedAt: nowIso()
  });
}

export async function donationWorkspaceSupplement(env, user, body = {}, donations = []) {
  requireRole(user, VIEW_ROLES, 'This staff account cannot view donation management data.');
  const branchId = branchFor(user, body);
  const canManage = MANAGE_ROLES.has(clean(user.role || user.Role));
  const [donors, settings, settlements] = await Promise.all([
    canManage ? listCollection(env, churchCollectionPath(CHURCH_COLLECTIONS.donors, branchId)).catch(() => []) : Promise.resolve([]),
    getDonationCurrencySettings(env, branchId),
    listCollection(env, churchCollectionPath(CHURCH_COLLECTIONS.currencySettlements, branchId)).catch(() => [])
  ]);
  return {
    donors: donors.sort((a, b) => clean(a.DisplayName).localeCompare(clean(b.DisplayName))),
    settings,
    settlements: settlements.sort((a, b) => clean(b.CreatedAt).localeCompare(clean(a.CreatedAt))).slice(0, 100),
    ...buildDonationInsights(donations)
  };
}
