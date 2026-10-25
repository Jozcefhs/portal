import { listCollectionPage, queryCollection } from './firestore.js';
import { recordBranchId, resolveRequestedBranch } from './branch-scope.js';
import { feeBranchId } from './fee-branch-scope.js';
import { loadBranchFinancePage } from './finance-branch-reads.js';

const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const pick = (row, ...keys) => keys.map(key => row[key]).find(value => value !== undefined && value !== null && value !== '');
const fail = (message, status = 400) => { const error = new Error(message); error.status = status; throw error; };
const collections = ['feeItems', 'payments', 'manualPaymentCorrections'];
const financeRoles = new Set(['Super Admin', 'Director', 'Management', 'Admin', 'Accounts Officer', 'Treasurer', 'Auditor']);

export function feeCollectionDate(value) {
  const text = clean(value);
  const match = /^\d{4}-\d{2}-\d{2}$/.test(text);
  if (match) return Number.isFinite(Date.parse(`${text}T00:00:00Z`)) && new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) === text ? text : '';
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/i.test(text)
    || !feeCollectionDate(text.slice(0, 10))) return '';
  const timestamp = text.replace(' ', 'T');
  // Legacy timestamps without an offset were recorded in local school time.
  if (!Number.isFinite(Date.parse(timestamp))) return '';
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(text)) return text.slice(0, 10);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(timestamp));
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type).value).join('-');
}

export function feeCollectionScope(user, body) {
  if (!clean(user.username) || !financeRoles.has(user.assignedRole || user.role)
    || !(user.allowedSections || []).some(section => ['accounts', 'incomeAnalytics'].includes(section))) {
    fail('Your staff account is not permitted to view fee collection totals.', 403);
  }
  const dateFrom = feeCollectionDate(body.dateFrom), dateTo = feeCollectionDate(body.dateTo);
  if (dateFrom !== body.dateFrom || dateTo !== body.dateTo || !dateFrom || !dateTo || dateFrom > dateTo) fail('Choose a valid start and end date.');
  const edition = user.edition || 'school';
  const section = edition === 'school' ? lower(user.schoolSectionAccess || 'all') : 'all';
  if (!['all', 'primary', 'secondary'].includes(section)) fail('Your school section access needs review.', 403);
  return { dateFrom, dateTo, branchId: resolveRequestedBranch(user, body.branchId, { allowAll: true }),
    schoolSection: section, edition };
}

function visible(row, scope, catalogue = false) {
  const branch = catalogue ? feeBranchId(row) : recordBranchId(row);
  if (scope.branchId !== 'all' && branch !== scope.branchId) return false;
  const section = lower(row.SchoolSection || row.schoolSection);
  return scope.schoolSection === 'all' || section === scope.schoolSection || (catalogue && (!section || section === 'all'));
}

function cents(value, name) {
  const text = clean(value ?? 0).replace(/[₦,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(text)) fail(`A ${name} amount is invalid. Finance must review it before this report can be completed.`, 409);
  const result = Math.round(Number(text) * 100);
  if (!Number.isSafeInteger(result) || result < 0) fail(`A ${name} amount is outside the supported range.`, 409);
  return result;
}

function component(row) {
  const code = clean(pick(row, 'FeeCode', 'feeCode'));
  const name = clean(pick(row, 'FeeName', 'feeName')) || code || 'Unspecified fee';
  const currency = clean(pick(row, 'Currency', 'currency') || 'NGN').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) fail('A fee receipt has an invalid currency.', 409);
  return { key: JSON.stringify([currency, code ? `code:${lower(code)}` : `name:${lower(name)}`]),
    code, name, category: clean(pick(row, 'FeeCategory', 'feeCategory')), currency };
}

function wallet(row) {
  return lower(pick(row, 'FeeCategory', 'feeCategory')) === 'wallet'
    || /^wallet[_ -]?(topup|top.?up|deposit)$/i.test(clean(pick(row, 'FeeCode', 'feeCode')));
}

function inPeriod(date, scope) { return date && date >= scope.dateFrom && date <= scope.dateTo; }

export function summarizeFeeCollectionRows(collection, documents, scope) {
  const rows = new Map();
  const warnings = { undated: 0, unfinished: 0, walletsExcluded: 0 };
  const add = (row, values = {}) => {
    const identity = component(row);
    const current = rows.get(identity.key) || { ...identity, receipts: 0, grossCents: 0, gatewayCents: 0, correctionCents: 0 };
    for (const [key, amount] of Object.entries(values)) {
      current[key] += amount;
      if (!Number.isSafeInteger(current[key])) fail('The report total exceeds the supported range.', 409);
    }
    rows.set(identity.key, current);
  };
  for (const row of documents) {
    if (!visible(row, scope, collection === 'feeItems')) continue;
    if (collection === 'feeItems') {
      if (!wallet(row)) add({ ...row, FeeCode: pick(row, 'FeeCode', 'feeCode') || row.__id });
      continue;
    }
    const correction = collection === 'manualPaymentCorrections';
    const date = feeCollectionDate(correction ? row.RecordedAt : pick(row, 'PaidAt', 'paidAt', 'PaymentDate', 'Date', 'date', 'CreatedAt', 'createdAt'));
    if (!date) { warnings.undated++; continue; }
    if (!inPeriod(date, scope)) continue;
    if (wallet(row)) { warnings.walletsExcluded++; continue; }
    if (correction) { add(row, { correctionCents: cents(row.Amount, 'correction') }); continue; }
    // Older imported receipts omit Status; the existing payment register treats
    // those rows as paid too. Explicit pending/rejected states remain excluded.
    const status = lower(pick(row, 'Status', 'status') || 'Paid');
    if (!['paid', 'completed', 'success', 'successful', 'settled'].includes(status)) continue;
    const processing = lower(pick(row, 'ProcessingStatus', 'processingStatus'));
    if (processing && processing !== 'completed') { warnings.unfinished++; continue; }
    const credited = cents(pick(row, 'Amount', 'amount'), 'receipt');
    const gross = cents(pick(row, 'GrossAmount', 'grossAmount') ?? credited / 100, 'gross receipt');
    const gateway = cents(pick(row, 'GatewayFee', 'gatewayFee') ?? 0, 'gateway charge');
    if (gateway > gross) fail('A gateway charge exceeds its receipt. Finance review is required.', 409);
    add(row, { receipts: 1, grossCents: gross, gatewayCents: gateway });
  }
  return { rows: [...rows.values()], warnings };
}

export async function getFeeCollectionSummaryPage(env, user, body = {}, io = { list: listCollectionPage, query: queryCollection }) {
  const scope = feeCollectionScope(user, body);
  const collection = clean(body.collection || collections[0]);
  if (!collections.includes(collection)) fail('Invalid fee report collection.');
  const pageToken = clean(body.pageToken);
  if (pageToken.length > 8192) fail('Invalid fee report page token.');
  const readTime = clean(body.readTime) || new Date().toISOString();
  const age = Date.now() - Date.parse(readTime);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(readTime) || !Number.isFinite(age) || age < -5000 || age > 50 * 60 * 1000
    || (!body.readTime && (pageToken || collection !== collections[0]))) fail('The report snapshot expired or is missing. Generate it again.');
  const page = await (io.page || loadBranchFinancePage)(env, collection, scope.branchId, {
    pageSize: collection === 'manualPaymentCorrections' ? 20 : 500, pageToken, readTime
  }, { listCollectionPage: io.list, queryCollection: io.query });
  let documents = page.documents;
  let undatedCorrections = 0;
  if (collection === 'manualPaymentCorrections') {
    documents = [];
    // Only corrections in this scope and period need a receipt lookup. The
    // original fee identity is read at the same snapshot, never guessed.
    for (const row of page.documents) {
      if (!visible(row, scope)) continue;
      const recordedDate = feeCollectionDate(row.RecordedAt);
      if (!recordedDate) { undatedCorrections++; continue; }
      if (!inPeriod(recordedDate, scope)) continue;
      if (row.Result?.Receipt?.Type === 'Wallet') continue;
      const payments = await io.query(env, 'payments', { filters: [{ field: 'Reference', op: '==', value: row.Reference }], limit: 2, readTime });
      if (payments.length !== 1 || !visible(payments[0], scope)) fail('A corrected receipt could not be verified in this report scope.', 409);
      const payment = payments[0];
      if (row.OriginalPaymentId && payment.__id !== row.OriginalPaymentId) fail('A corrected receipt identity is inconsistent. Finance review is required.', 409);
      documents.push({ ...payment, Amount: row.Amount, RecordedAt: row.RecordedAt });
    }
  }
  const result = summarizeFeeCollectionRows(collection, documents, scope);
  result.warnings.undated += undatedCorrections;
  const nextCollection = page.nextPageToken ? collection : collections[collections.indexOf(collection) + 1];
  return { ok: true, ...result, scope, readTime, collection, scanned: page.documents.length,
    next: nextCollection ? { collection: nextCollection, pageToken: page.nextPageToken || '' } : null,
    complete: !nextCollection };
}
