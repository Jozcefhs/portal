// Verification only: every remote data operation is an allowlisted, timestamp-pinned runQuery.
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { buildStructuredQuery, firestoreDocumentToObject } from '../functions/lib/firestore.js';
import { CARD_REFUND_CAMPAIGN as c } from '../functions/lib/card-refund-batch.js';
import { financialPreviewFingerprint as fingerprint } from '../functions/lib/financial-preview-fingerprint.js';
const baseline = JSON.parse(await readFile('tmp/card-refund-discovery.json', 'utf8'));
const require = createRequire('C:/Users/DYNAMAX/AppData/Roaming/npm/node_modules/firebase-tools/lib/auth.js');
const auth = require('./auth.js'), { requireAuth } = require('./requireAuth.js'), { Client } = require('./apiv2.js');
const project = 'school-management-suite-27064';
const account = auth.getProjectDefaultAccount(process.cwd());
if (!account) throw new Error('Existing Firebase CLI sign-in required.');
await requireAuth({ project, ...account });
const client = new Client({ urlPrefix: 'https://firestore.googleapis.com', apiVersion: 'v1' });
const base = `/projects/${project}/databases/(default)/documents`;
const readTime = new Date(Date.now() - 5000).toISOString();
const allowed = new Set(['vendorRefundBatches','vendorEarnings','vendorClaimLots','vendorBalances','vendorSettlementRequests','vendorSettlementPayments','organizationCommerceSales','ledger','payments','accountingJournals','accountingAudit']);
async function query(collection, options = {}, at = readTime) {
  if (!allowed.has(collection)) throw new Error('Out-of-scope collection refused.');
  let startAfterName = ''; const rows = [];
  for (let page = 0; page < 30; page++) {
    const { endpoint, structuredQuery } = buildStructuredQuery(collection, { ...options, orderBy: [{ field: '__name__' }], limit: 500, ...(startAfterName ? { startAfterName } : {}) });
    if (!endpoint.endsWith(':runQuery')) throw new Error('Write operation refused.');
    const response = await client.post(`${base}/${endpoint}`, { structuredQuery, readTime: at }, { resolveOnHTTPError: true });
    const entries = Array.isArray(response.body) ? response.body : [response.body];
    if (response.status >= 400 || entries.some(row => row?.error)) throw new Error(`Read failed: ${collection}, status ${response.status}, ${entries.find(row => row?.error)?.error?.message || ''}`);
    const batch = entries.flatMap(row => row.document ? [firestoreDocumentToObject(row.document)] : []);
    rows.push(...batch);
    if (batch.length < 500) return rows;
    const next = batch.at(-1).__name;
    if (!next || next === startAfterName) throw new Error('Pagination stalled.');
    startAfterName = next;
  }
  throw new Error('Truncated verification refused.');
}
async function parallel(items, fn, workers = 4) {
  const output = []; let next = 0;
  await Promise.all(Array.from({ length: workers }, async () => { while (next < items.length) { const i = next++; output[i] = await fn(items[i]); } }));
  return output;
}
const unique = rows => [...new Map(rows.map(row => [row.__name, row])).values()];
async function queryValues(collection, values, fields, at = readTime) {
  const size = Math.floor(30 / fields.length), chunks = [];
  for (let i = 0; i < values.length; i += size) chunks.push(values.slice(i, i + size));
  return unique((await parallel(chunks, chunk => query(collection, { filterJoin: 'OR', filters: fields.map(field => ({ field, op: 'in', value: chunk })) }, at))).flat());
}
const batchRows = await query('vendorRefundBatches', { filters: [{ field: 'BatchId', op: '==', value: c.BatchId }] });
if (batchRows.length !== 1) throw new Error('One exact saved campaign required.');
const batch = batchRows[0];
const refs = [...new Set(batch.Rows.map(r => r.AdmissionNo))];
const aliases = [...new Set([...refs, ...baseline.relatedLedger.filter(r => refs.includes(r.AccountRef) || refs.includes(r.AdmissionNo)).map(r => r.ApplicationReference).filter(Boolean)])];
const beforeApproval = new Date(Date.parse(batch.ApprovedAt) - 1000).toISOString();
console.log(JSON.stringify({ stage: 'saved-batch', readOnly: true, readTime, beforeApproval, status: batch.Status, posted: batch.PostedCount, amount: batch.PostedCents / 100 }));
const current = {};
await parallel(['vendorEarnings','vendorClaimLots','vendorBalances','vendorSettlementRequests','vendorSettlementPayments'], async collection => {
  current[collection] = await query(collection, { filters: [{ field: 'VendorId', op: '==', value: c.VendorId }] });
});
await parallel(['ledger','accountingJournals'], async collection => {
  current[collection] = await query(collection, { filters: [{ field: 'Reference', op: '==', value: c.BatchId }] });
});
current.sales = await queryValues('organizationCommerceSales', batch.Rows.map(r => r.SaleNo), ['SaleNo']);
current.originalLedger = await queryValues('ledger', batch.Rows.map(r => r.LedgerNo), ['LedgerNo']);
current.audit = await queryValues('accountingAudit', [c.BatchId, ...batch.Rows.map(r => r.RefundId)], ['EntityId']);
const paymentKeys = ['AccountRef','AdmissionNo','ApplicationReference','accountRef','admissionNo','applicationReference'];
const [paymentsBefore, paymentsAfter] = await Promise.all([
  queryValues('payments', aliases, paymentKeys, beforeApproval), queryValues('payments', aliases, paymentKeys)
]);
console.log(JSON.stringify({ stage: 'read-complete', counts: Object.fromEntries(Object.entries(current).map(([k,v]) => [k,v.length])), paymentsBefore: paymentsBefore.length, paymentsAfter: paymentsAfter.length }));
const canonical = value => JSON.stringify(value, (_k,v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a],[b]) => a.localeCompare(b))) : v);
const equal = (a,b) => canonical(a) === canonical(b);
function preservation(before, after) {
  const lookup = new Map(after.map(r => [r.__name,r]));
  const missing = before.filter(r => !lookup.has(r.__name));
  const changed = before.filter(r => lookup.has(r.__name) && !equal(r, lookup.get(r.__name)));
  return { before: before.length, after: after.length, unchanged: before.length-missing.length-changed.length, missing: missing.map(r=>r.__id), changed: changed.map(r=>r.__id) };
}
const index = (rows, key) => new Map(rows.map(r => [r[key],r]));
const sales = index(current.sales,'SaleNo'), debits = index(current.originalLedger,'LedgerNo');
const entries = index(current.vendorEarnings,'EntryId'), lots = index(current.vendorClaimLots,'LotId');
const credits = index(current.ledger,'LedgerNo'), journals = index(current.accountingJournals,'JournalNo');
const audits = index(current.audit,'EntityId');
const failures = [];
for (const row of batch.Rows) {
  const entry = entries.get(row.EntryId), sale = sales.get(row.SaleNo), debit = debits.get(row.LedgerNo), lot = lots.get(row.LotId);
  const credit = credits.get(`WALLET-${row.RefundId}`), journal = journals.get(`SYS-${row.RefundId}`), refund = entries.get(row.RefundId), audit = audits.get(row.RefundId);
  const metadata = credit?.Metadata ? JSON.parse(credit.Metadata) : {};
  const checks = {
    posted: row.Status === 'Posted' && row.Amount === 3500,
    originalEvidenceUnchanged: row.SourceDigest === await fingerprint({ entry, sale, ledger: debit }),
    linkedCredit: credit?.Credit === 3500 && credit.Debit === 0 && credit.AccountRef === row.AdmissionNo && credit.AdmissionNo === row.AdmissionNo && credit.EntryType === 'Wallet Refund' && credit.FeeCategory === 'Wallet' && credit.Currency === 'NGN' && metadata.originalLedgerNo === row.LedgerNo && metadata.saleNo === row.SaleNo && metadata.refundId === row.RefundId,
    parentLabel: credit?.Description === `Refund: ${c.ItemName} - sales approval under review`,
    linkedVendorRefund: refund?.RefundCents === 350000 && refund.NetCents === -350000 && refund.OriginalEntryId === row.EntryId && refund.SaleNo === row.SaleNo && refund.BatchId === c.BatchId,
    clearedLot: lot?.RefundedCents === 350000 && lot.NetCents === 0 && lot.ReservedCents === 0 && lot.PaidCents === 0,
    balancedJournal: journal?.Status === 'Posted' && journal.SourceId === row.RefundId && journal.Lines?.length === 2 && journal.Lines[0].Debit === 3500 && journal.Lines[0].Credit === 0 && journal.Lines[1].Credit === 3500 && journal.Lines[1].Debit === 0 && journal.Lines[1].AccountCode === '2200' && journal.Lines[0].AccountCode === lot?.PayableAccount,
    audited: audit?.Action === 'CARD WALLET REFUND POSTED' && audit.UserRole === 'Accounts Officer'
  };
  if (Object.values(checks).some(v => !v)) failures.push({ sale: row.SaleNo, failures: Object.keys(checks).filter(k => !checks[k]) });
}
const originalPreservation = {
  salesAndReceiptFields: preservation(baseline.matchingSales,current.sales),
  walletPurchaseDebits: preservation(baseline.matchingLedger,current.originalLedger),
  vendorSaleEvidence: preservation(baseline.vendorData.vendorEarnings,current.vendorEarnings.filter(r=>r.Type==='Sale')),
  paymentsAndReceiptFields: preservation(paymentsBefore,paymentsAfter),
  vendorPayments: preservation(baseline.vendorData.vendorSettlementPayments,current.vendorSettlementPayments)
};
const request = current.vendorSettlementRequests.find(r=>r.SettlementId===batch.Requests[0].SettlementId);
const oldRequest = baseline.vendorData.vendorSettlementRequests.find(r=>r.SettlementId===request?.SettlementId);
const excludedRequestFields = new Set(['Status','PaymentStatus','RefundBatchId','UpdatedAt','History']);
const requestOriginalFields = r => Object.fromEntries(Object.entries(r || {}).filter(([k])=>!k.startsWith('__')&&!excludedRequestFields.has(k)));
const requestChecks = {
  cancelled: request?.Status === 'Cancelled' && request.PaymentStatus === 'Cancelled',
  amountPreserved: request?.AmountCents === 40600000 && request.PaidCents === 0,
  allocationsPreserved: equal(request?.Allocations,oldRequest?.Allocations),
  originalFieldsPreserved: equal(requestOriginalFields(request),requestOriginalFields(oldRequest)),
  originalHistoryPreserved: equal(request?.History?.slice(0,oldRequest?.History?.length),oldRequest?.History),
  cancellationAudited: request?.History?.length === oldRequest?.History?.length+1 && request.History.at(-1).BatchId===c.BatchId && request.History.at(-1).Role==='Accounts Officer' && request.RefundBatchId===c.BatchId
};
const balance=current.vendorBalances.find(r=>r.VendorId===c.VendorId);
const refundEntries=current.vendorEarnings.filter(r=>r.Type==='Refund'&&r.BatchId===c.BatchId);
const checks = {
  completed: batch.Status==='Completed'&&batch.PostedCount===255&&batch.PostedCents===89250000&&batch.Rows.length===255,
  scopeAndApproval: batch.PurchaseSetDigest===c.PurchaseSetDigest&&batch.ApprovedRole==='Accounts Officer'&&batch.ScopeKey===c.ScopeKey,
  correctStudents: refs.length===249,
  uniqueRefunds: new Set(batch.Rows.map(r=>r.RefundId)).size===255&&new Set(batch.Rows.map(r=>r.SaleNo)).size===255&&current.ledger.length===255&&refundEntries.length===255&&current.accountingJournals.length===255,
  creditTotal: current.ledger.reduce((s,r)=>s+Number(r.Credit||0),0)===892500,
  recordChecks: failures.length===0,
  originalsIntact: Object.values(originalPreservation).every(r=>!r.missing.length&&!r.changed.length),
  vendorRequestReconciled: Object.values(requestChecks).every(Boolean),
  vendorBalanceReconciled: balance?.RefundCents===89250000&&balance.NetCents===0&&balance.ReservedCents===0&&balance.PaidCents===0&&!balance.ActiveRefundBatchId,
  approvalAudited: audits.get(c.BatchId)?.Action==='CARD REFUND BATCH APPROVED'
};
const summary={readOnly:true,readTime,batchId:c.BatchId,status:batch.Status,approvedBy:batch.ApprovedBy,approvedAt:batch.ApprovedAt,completedAt:batch.CompletedAt,students:refs.length,purchases:batch.Rows.length,total:batch.PostedCents/100,checks,allPassed:Object.values(checks).every(Boolean),originalPreservation,requestChecks,vendor:{requestId:request.SettlementId,requestAmount:request.AmountCents/100,status:request.Status,allocations:request.Allocations.length,refundTotal:balance.RefundCents/100,netPayable:balance.NetCents/100,reserved:balance.ReservedCents/100,paid:balance.PaidCents/100,holdReleased:!balance.ActiveRefundBatchId},failures};
await writeFile('tmp/card-refund-verification.json',JSON.stringify({summary,batch,current,paymentsBefore,paymentsAfter},null,2));
console.log(JSON.stringify(summary,null,2));
if(!summary.allPassed)process.exitCode=2;
