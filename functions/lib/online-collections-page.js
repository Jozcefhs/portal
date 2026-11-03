import { queryCollection } from './firestore.js';
import { accountingRequestBranch, accountingRowsForBranch } from './accounting-branch-scope.js';
import { historyDateRange } from './history-date-range.js';

const clean = value => String(value ?? '').trim();
const PAGE_SIZE = 50;
const SOURCES = [
  { collection: 'payments', date: 'PaidAt', filters: [{ field: 'Gateway', op: 'in', value: ['Paystack', 'paystack', 'PAYSTACK'] }] },
  { collection: 'paymentGatewayCharges', date: 'Date', filters: [] }
];
const badCursor = () => Object.assign(new Error('This payment page expired or belongs to another view. Refresh online collections.'), { status: 400 });
const encode = bytes => btoa(String.fromCharCode(...bytes));
const decode = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));

async function cursorKey(env) {
  if (!clean(env.FIREBASE_PRIVATE_KEY)) throw new Error('The payment page signing key is unavailable.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`online-collections-v1:${env.FIREBASE_PROJECT_ID}:${env.FIREBASE_PRIVATE_KEY}`));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(env, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await cursorKey(env), new TextEncoder().encode(JSON.stringify(value)));
  return `${encode(iv)}.${encode(new Uint8Array(bytes))}`;
}
async function unseal(env, token) {
  try {
    if (token.length > 12000) throw badCursor();
    const [iv, data, extra] = token.split('.');
    if (extra || !iv || !data) throw badCursor();
    return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(iv) }, await cursorKey(env), decode(data))));
  } catch { throw badCursor(); }
}

export function onlineCollectionsFilters(body = {}) {
  const year = clean(body.FinancialYear);
  if (year && !/^\d{4}$/.test(year)) throw Object.assign(new Error('Enter a valid financial year.'), { status: 400 });
  const from = clean(body.DateFrom) || (year ? `${year}-01-01` : '');
  const to = clean(body.DateTo) || (year ? `${year}-12-31` : '');
  const range = from || to ? historyDateRange({ fromDate: from, toDate: to }) : null;
  return { DateFrom: range?.fromDate || '', DateTo: range?.toDate || '' };
}

export function onlineCollectionsSummary(rows = []) {
  const total = (items, key) => items.reduce((sum, row) => sum + Math.round(Number(row[key] || 0) * 100), 0) / 100;
  const forms = rows.filter(row => /form/i.test(row.Source || ''));
  const other = rows.filter(row => !/form/i.test(row.Source || ''));
  return { GrossCollections: total(rows, 'GrossCollection'), PaystackCharges: total(rows, 'PaystackCharge'),
    NetSettlements: total(rows, 'NetRevenue'), FormSalesGross: total(forms, 'GrossCollection'),
    FormSalesCharges: total(forms, 'PaystackCharge'), FormSalesNet: total(forms, 'NetRevenue'),
    FormPaymentCharges: total(forms, 'PaystackCharge'), FeePaymentCharges: total(other, 'PaystackCharge') };
}

// Read only two bounded payment indexes. Never scan invoices, journals, audit or
// the whole accounting history just to open the online payment register.
export async function onlineCollectionsPage(env, body, buildReport, overrides = {}) {
  const db = { queryCollection, ...overrides };
  const branch = accountingRequestBranch(body), filter = onlineCollectionsFilters(body);
  const scope = JSON.stringify([env.FIREBASE_PROJECT_ID, clean(body.UserUsername).toLowerCase(), clean(body.UserRole), branch, filter]);
  const token = clean(body.PageToken);
  const cursor = token ? await unseal(env, token) : { scope, readTime: new Date(Date.now() - 2000).toISOString(), sources: {} };
  if (cursor.scope !== scope || !Number.isFinite(Date.parse(cursor.readTime)) || Date.parse(cursor.readTime) > Date.now()
      || Date.now() - Date.parse(cursor.readTime) > 50 * 60 * 1000 || !cursor.sources || typeof cursor.sources !== 'object') throw badCursor();
  const pages = await Promise.all(SOURCES.map(async source => {
    const previous = cursor.sources[source.collection];
    if (previous?.done) return { ...source, rows: [], next: previous };
    const filters = [...source.filters];
    // Untagged legacy charges belong to Main. Keep its bounded date index and
    // filter before returning; other branches use their own indexed slice.
    if (!['main', 'all'].includes(branch)) filters.push({ field: 'BranchId', op: '==', value: branch });
    if (filter.DateFrom) filters.push({ field: source.date, op: '>=', value: filter.DateFrom });
    if (filter.DateTo) filters.push({ field: source.date, op: '<=', value: `${filter.DateTo}\uf8ff` });
    if (previous?.name && !previous.name.startsWith(`projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${source.collection}/`)) throw badCursor();
    const rows = await db.queryCollection(env, source.collection, { filters, readTime: cursor.readTime,
      orderBy: [{ field: source.date, direction: 'DESCENDING' }, { field: '__name__', direction: 'DESCENDING' }],
      limit: PAGE_SIZE + 1, ...(previous?.name ? { startAfterName: previous.name, startAfterFieldValue: previous.date } : {}) });
    const loaded = rows.slice(0, PAGE_SIZE), last = loaded.at(-1);
    if (rows.length > PAGE_SIZE && (!last?.__name || !last[source.date])) throw new Error('Payment page cursor was missing. Refresh the view.');
    return { ...source, rows: accountingRowsForBranch(loaded, branch),
      next: rows.length > PAGE_SIZE ? { name: last.__name, date: last[source.date] } : { done: true } };
  }));
  const report = buildReport([], pages[1].rows, filter, pages[0].rows);
  report.summary = onlineCollectionsSummary(report.onlineTransactions);
  const nextSources = Object.fromEntries(pages.map(page => [page.collection, page.next]));
  const more = pages.some(page => !page.next.done);
  return { ok: true, gatewayReport: report, filter, branchId: branch, readTime: cursor.readTime,
    nextPageToken: more ? await seal(env, { scope, readTime: cursor.readTime, sources: nextSources }) : '',
    totalsScope: 'loaded-records', message: 'Online collections loaded.' };
}
