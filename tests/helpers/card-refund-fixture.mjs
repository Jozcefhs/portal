import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { handleCardRefundBatch, CARD_REFUND_CAMPAIGN } from '../../functions/lib/card-refund-batch.js';
import { financialPreviewFingerprint } from '../../functions/lib/financial-preview-fingerprint.js';
import { plain } from '../../functions/lib/vendor-settlement-rules.js';
import { objectToFirestoreFields, firestoreDocumentToObject } from '../../functions/lib/firestore.js';
import { validateRequisitionPosting } from '../../functions/lib/requisition-posting.js';
globalThis.crypto ||= webcrypto;

export async function cardRefundFixture({ count = 255, students = 249, reservations = 116 } = {}) {
  const c = { ...CARD_REFUND_CAMPAIGN, Count: count, Students: students, TotalCents: count * 350000 };
  const scope = { ScopeKey: c.ScopeKey, BranchId: 'main', SchoolSection: 'Secondary', OrganisationEdition: 'school' };
  const user = { username: 'test-accounts', role: 'Accounts Officer', displayName: 'Test accountant' };
  let revision = 0, conflict = false, changeEvidence = false, closedPeriod = false;
  const store = new Map(), commits = [];
  const put = (collection, id, row) => store.set(`${collection}/${id}`, { ...firestoreDocumentToObject({ fields: objectToFirestoreFields(plain(row)) }),
    __id: id, __updateTime: `r${++revision}` });
  const get = (collection, id) => structuredClone(store.get(`${collection}/${id}`) || null);
  const list = collection => [...store].filter(([key]) => key.startsWith(`${collection}/`)).map(([,value]) => structuredClone(value));
  const ids = [];
  for (let i = 0; i < count; i++) {
    const saleNo = `VSAL-test-${String(i).padStart(4,'0')}`, entryId = `${saleNo}--${c.VendorId}`, ledgerNo = `WALLET-${saleNo}`;
    ids.push(entryId);
    const item = { InventoryDocumentId: c.InventoryId, ItemName: c.ItemName, Quantity: 1, UnitPrice: 3500, Amount: 3500 };
    const common = { ...scope, SaleNo: saleNo, VendorId: c.VendorId, Items: [item], GrossCents: 350000, NetCents: 350000,
      ChargeCents: 0, PeriodId: '', CollectionMode: 'School collected', RuleSnapshot: { Mode: 'Full payment' },
      AccountsSnapshot: { PayableAccount: '2000' }, SettlementHold: false, Date: '2026-10-13T08:00:00Z' };
    const entry = { ...common, EntryId: entryId, LotId: entryId, Type: 'Sale', RefundCents: 0,
      OriginalPaymentMethod: 'Student Wallet', OriginalLedgerNo: ledgerNo };
    put('vendorEarnings', entryId, entry);
    put('vendorClaimLots', entryId, { ...common, LotId: entryId, RefundedCents: 0, PaidCents: 0,
      ReservedCents: i < reservations ? 350000 : 0, PayableAccount: '2000' });
    const admission = `DCA/TEST/${(i % students) + 1}`;
    const mixed = i === 0 ? [{ ItemName: 'Unrelated snack', VendorId: 'another-vendor', Amount: 200, Quantity: 1 }] : [];
    put('organizationCommerceSales', saleNo, { ...scope, SaleNo: saleNo, Items: [{ ...item, VendorId: c.VendorId }, ...mixed],
      CustomerType: 'Student', CustomerRef: admission, CustomerName: `Test student ${(i % students)+1}`, LedgerNo: ledgerNo,
      PaymentMethod: 'Student Wallet', PaymentStatus: 'Paid', Currency: 'NGN', Amount: 3500 + (i === 0 ? 200 : 0),
      InventoryStatus: 'Deducted', PaidAt: '2026-10-13T08:00:00Z', VendorSettlements: [entry] });
    put('ledger', ledgerNo, { ...scope, LedgerNo: ledgerNo, AccountRef: admission, AdmissionNo: admission, DisplayName: `Test student ${(i % students)+1}`,
      EntryType: 'Wallet Purchase', FeeCategory: 'Wallet', Currency: 'NGN', Debit: 3500 + (i === 0 ? 200 : 0), Credit: 0, ClassName: 'Grade 8' });
  }
  c.PurchaseSetDigest = await financialPreviewFingerprint({ entries: ids.sort() });
  put('vendorBalances', c.VendorId, { ...scope, VendorId: c.VendorId, GrossCents: c.TotalCents, NetCents: c.TotalCents,
    RefundCents: 0, ChargeCents: 0, PaidCents: 0, ReservedCents: reservations * 350000, ReviewRequired: false });
  if (reservations) put('vendorSettlementRequests', 'pending-request', { ...scope, VendorId: c.VendorId, SettlementId: 'pending-request',
    Status: 'Admin Reviewed', PaymentStatus: 'Awaiting approval', PaidCents: 0, AmountCents: reservations * 350000,
    History: [{ Action: 'Submitted', Username: 'test-vendor' }], Allocations: ids.slice(0,reservations).map(LotId => ({ LotId, AmountCents: 350000 })) });
  put('payments', 'old-payment', { Reference: 'receipt-123', Amount: 100000, ReceiptNo: 'original-receipt' });
  const commit = async (_env, writes, checks = []) => {
    if (changeEvidence) { changeEvidence = false; const check = checks[0]; put(check.collectionPath, check.documentId, { ...get(check.collectionPath, check.documentId), Changed: true }); }
    assert(writes.length <= 500);
    assert.equal(new Set(writes.map(w => `${w.collectionPath}/${w.documentId}`)).size, writes.length);
    if (conflict) { conflict = false; throw Object.assign(new Error('Conflict'), { status:409 }); }
    for (const check of checks) if (get(check.collectionPath, check.documentId)?.__updateTime !== check.updateTime) throw new Error('Evidence changed');
    for (const w of writes) {
      const old = get(w.collectionPath, w.documentId);
      if (w.exists === false && old || w.updateTime && old?.__updateTime !== w.updateTime) throw Object.assign(new Error('Conflict'), { status:409 });
    }
    commits.push(structuredClone(writes));
    for (const w of writes) put(w.collectionPath, w.documentId, w.data);
  };
  const d = { campaign: c, get: async (_e,col,id) => get(col,id), getMany: async (_e,col,ids) => ids.map(id => get(col,id)),
    query: async (_e,col,options) => { assert.equal(options.pageSize,250); return list(col).filter(row => options.filters.every(f => row[f.field] === f.value)); },
    write: (collectionPath,documentId,data,previous) => ({ collectionPath, documentId, data: plain(data), ...(previous ? { updateTime: previous.__updateTime } : { exists:false }) }),
    audit: (_scope,_user,Action,EntityId,Details,id) => d.write('accountingAudit', id, { Action, EntityId, Details }),
    commit, commitChecked: commit, authorize: async (_e,_u,body) => { if (body.approvalPassword !== 'test-only') throw new Error('Password required'); },
    validateJournal: async (_e,journal) => { if (closedPeriod) throw new Error('Accounting period is closed');
      validateRequisitionPosting(journal, [{Code:'2000',Type:'Liability',Active:'YES'},{Code:'2200',Type:'Liability',Active:'YES'}], [], 'school');
      assert.deepEqual(journal.Lines.map(l=>String(l.AccountCode)),['2000','2200']);
      assert.equal(journal.Lines.reduce((s,l)=>s+l.Debit-l.Credit,0),0);
      journal.TotalDebit = journal.Lines.reduce((s,l)=>s+l.Debit,0); journal.TotalCredit = journal.Lines.reduce((s,l)=>s+l.Credit,0);
    } };
  const run = (action,body={},who=user,where=scope) => handleCardRefundBatch({},who,where,{action,VendorId:c.VendorId,...body},d);
  const approve = async () => { const p = await run('previewCardRefundBatch'); return run('approveCardRefundBatch',{
    PreviewDigest: p.PreviewDigest, Confirmed:true, Notes:'Card sales approval under review', EvidenceReference:'test-decision', approvalPassword:'test-only' }); };
  return { c, scope, user, d, run, approve, put, get, list, store, commits,
    conflict: () => { conflict=true; }, changeEvidence: () => { changeEvidence=true; }, closePeriod: () => { closedPeriod=true; } };
}
