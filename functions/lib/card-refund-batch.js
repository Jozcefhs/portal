import { financialPreviewFingerprint as fingerprint } from './financial-preview-fingerprint.js';
import { amount, cents, clean, lower, plain, visible, fail } from './vendor-settlement-rules.js';

// Reviewed, finite campaign. No student identities are shipped in application code.
// The purchase-set digest prevents later sales or replacement records expanding approval.
export const CARD_REFUND_CAMPAIGN = Object.freeze({
  BatchId: 'NFC-S70-20261016-v1', ScopeKey: 'school--main', SchoolSection: 'Secondary',
  VendorId: 'VND-30ce4d88-e944-43dc-bfc8-5e574b31b439',
  InventoryId: 'ITEM-dd89d0fc-d155-48f5-af42-be52bec32129', ItemName: '4k RFID S70 NFC Card',
  Cutoff: '2026-10-16T17:20:21.803Z', Count: 255, Students: 249, UnitCents: 350000, TotalCents: 89250000,
  PurchaseSetDigest: '8d497bf6c1599cdf613c5df555236cd54eafc92aaa3c984b985d94782fbeda89'
});
export const CARD_REFUND_BATCHES = 'vendorRefundBatches';
const actorRole = user => clean(user.assignedRole || user.UserAssignedRole || user.role || user.Role);
const requireCondition = (ok, message) => { if (!ok) fail(message, 409, 'CARD_REFUND_REVIEW_REQUIRED'); };
const integer = value => Number.isSafeInteger(value) && value >= 0;
const recordCheck = (collectionPath, row) => ({ collectionPath, documentId: row.__id, updateTime: row.__updateTime });
const sourceDigest = (entry, sale, ledger) => fingerprint({ entry, sale, ledger });
const lotDigest = lot => { const { ReservedCents, UpdatedAt, ...rest } = plain(lot); return fingerprint(rest); };
const rowSummary = batch => ({ ok: true, BatchId: batch.BatchId, Status: batch.Status, ItemName: batch.ItemName,
  Count: batch.Count, Students: batch.Students, Total: amount(batch.TotalCents), PostedCount: batch.PostedCount || 0,
  PostedAmount: amount(batch.PostedCents), Requests: batch.Requests || [], ApprovedBy: batch.ApprovedBy || '',
  Rows: (batch.Rows || []).map(({ SourceDigest, LotDigest, ...row }) => row),
  message: batch.Status === 'Completed' ? 'All card refunds posted. Original payments, receipts and purchases were preserved.'
    : 'Approval is saved. Resume safely; only unposted purchases are processed. Vendor settlements remain on hold until completion.' });

async function originalEvidence(env, entry, lot, sale, ledger, campaign) {
  const inScope = row => row && lower(row.BranchId) === 'main' && lower(row.SchoolSection) === lower(campaign.SchoolSection);
  requireCondition(entry?.__updateTime && lot?.__updateTime && sale?.__updateTime && ledger?.__updateTime, 'Original sale, wallet debit or vendor lot is missing its revision.');
  requireCondition(entry.ScopeKey === campaign.ScopeKey && lot.ScopeKey === campaign.ScopeKey && inScope(entry) && inScope(lot)
    && inScope(sale) && inScope(ledger) && sale.OrganisationEdition === 'school', 'Original records have conflicting branches or sections.');
  requireCondition(entry.VendorId === campaign.VendorId && lot.VendorId === campaign.VendorId && entry.Type === 'Sale'
    && entry.CollectionMode === 'School collected' && entry.OriginalPaymentMethod === 'Student Wallet', 'Only the original school-collected wallet card sale can be refunded.');
  requireCondition(entry.LotId === lot.LotId && entry.SaleNo === sale.SaleNo && lot.SaleNo === sale.SaleNo
    && entry.OriginalLedgerNo === ledger.LedgerNo && sale.LedgerNo === ledger.LedgerNo, 'Original sale links do not reconcile.');
  const card = item => item.InventoryDocumentId === campaign.InventoryId && item.Quantity === 1
    && cents(item.Amount) === campaign.UnitCents && cents(item.UnitPrice) === campaign.UnitCents;
  const items = sale.Items?.filter(item => item.VendorId === campaign.VendorId) || [];
  requireCondition(entry.Items?.length === 1 && card(entry.Items[0]) && items.length === 1 && card(items[0])
    && lot.Items?.length === 1 && card(lot.Items[0]), 'This vendor sale is not exactly one approved card purchase. Mixed baskets from other vendors are preserved.');
  requireCondition(sale.PaymentStatus === 'Paid' && sale.PaymentMethod === 'Student Wallet' && sale.CustomerType === 'Student'
    && sale.Currency === 'NGN' && sale.InventoryStatus === 'Deducted' && Date.parse(sale.PaidAt) <= Date.parse(campaign.Cutoff)
    && Number.isFinite(Date.parse(sale.PaidAt)), 'The purchase is not a verified, paid card purchase within the approved cutoff.');
  requireCondition(clean(sale.CustomerRef) && sale.CustomerRef === ledger.AccountRef && ledger.AdmissionNo === ledger.AccountRef
    && ledger.FeeCategory === 'Wallet' && ledger.EntryType === 'Wallet Purchase' && ledger.Currency === 'NGN'
    && cents(ledger.Debit) === cents(sale.Amount) && cents(ledger.Credit) === 0, 'The original student wallet debit cannot be reconciled.');
  const links = sale.VendorSettlements?.filter(row => row.VendorId === campaign.VendorId) || [];
  requireCondition(links.length === 1 && links[0].EntryId === entry.EntryId && links[0].LotId === lot.LotId, 'The original vendor settlement link is ambiguous.');
  requireCondition(entry.GrossCents === campaign.UnitCents && entry.NetCents === campaign.UnitCents && entry.ChargeCents === 0
    && lot.GrossCents === campaign.UnitCents && lot.NetCents === campaign.UnitCents && lot.ChargeCents === 0
    && lot.RefundedCents === 0 && lot.PaidCents === 0 && integer(lot.ReservedCents) && !lot.PeriodId && !entry.PeriodId
    && !lot.SettlementHold && entry.RuleSnapshot?.Mode === 'Full payment' && lot.RuleSnapshot?.Mode === 'Full payment'
    && clean(lot.PayableAccount) === clean(entry.AccountsSnapshot?.PayableAccount),
  'A prior refund, vendor payment, deduction or stock hold needs finance review. Nothing will be refunded twice.');
  return { EntryId: entry.EntryId, LotId: lot.LotId, SaleNo: sale.SaleNo, LedgerNo: ledger.LedgerNo,
    AdmissionNo: ledger.AdmissionNo, StudentName: sale.CustomerName || ledger.DisplayName, ClassName: ledger.ClassName || '',
    Amount: amount(campaign.UnitCents), Status: 'Not posted', SourceDigest: await sourceDigest(entry, sale, ledger), LotDigest: await lotDigest(lot) };
}

async function preview(env, scope, c, d) {
  const query = collection => d.query(env, collection, { filters: [{ field: 'VendorId', op: '==', value: c.VendorId }], pageSize: 250, maxRows: 10000 });
  const [earnings, lots, requests, balance] = await Promise.all([query('vendorEarnings'), query('vendorClaimLots'),
    query('vendorSettlementRequests'), d.get(env, 'vendorBalances', c.VendorId)]);
  requireCondition(visible(balance, scope) && !balance.ActiveRefundBatchId, 'The vendor balance is unavailable or another refund batch is in progress.');
  const candidates = earnings.filter(row => row.Type === 'Sale' && row.ScopeKey === c.ScopeKey
    && Date.parse(row.Date) <= Date.parse(c.Cutoff) && row.Items?.some(item => item.InventoryDocumentId === c.InventoryId))
    .sort((a, b) => a.EntryId.localeCompare(b.EntryId));
  requireCondition(candidates.length === c.Count && await fingerprint({ entries: candidates.map(row => row.EntryId).sort() }) === c.PurchaseSetDigest,
    'The purchase list differs from the 255 reviewed purchases. Nothing was posted; the campaign needs a fresh finance review.');
  const [sales, ledgers] = await Promise.all([d.getMany(env, 'organizationCommerceSales', candidates.map(row => row.SaleNo)),
    d.getMany(env, 'ledger', candidates.map(row => row.OriginalLedgerNo))]);
  const lotMap = new Map(lots.map(row => [row.LotId, row])), rows = [], errors = [];
  for (let i = 0; i < candidates.length; i++) {
    const entry = candidates[i];
    try { rows.push(await originalEvidence(env, entry, lotMap.get(entry.LotId), sales[i], ledgers[i], c)); }
    catch (error) { rows.push({ EntryId: entry.EntryId, SaleNo: entry.SaleNo, AdmissionNo: sales[i]?.CustomerRef || '',
      StudentName: sales[i]?.CustomerName || '', Amount: amount(c.UnitCents), Status: 'Blocked', Problem: error.message }); }
  }
  const targetIds = new Set(candidates.map(row => row.LotId)), affected = requests.filter(r => !['Cancelled', 'Rejected'].includes(r.Status)
    && r.Allocations?.some(a => targetIds.has(a.LotId)));
  const released = new Map();
  for (const r of affected) {
    if (!visible(r, scope) || r.PaidCents !== 0 || r.PaymentStatus === 'Paid' || !integer(r.AmountCents)
      || !['Submitted', 'Accounts Confirmed', 'Admin Reviewed', 'Approved'].includes(r.Status)
      || r.Allocations.some(a => !targetIds.has(a.LotId) || !integer(a.AmountCents) || !a.AmountCents)
      || r.Allocations.reduce((sum, a) => sum + a.AmountCents, 0) !== r.AmountCents) {
      errors.push(`Request ${r.SettlementId} has paid, unrelated or inconsistent allocations; Accounts must reconcile it first.`);
      continue;
    }
    for (const a of r.Allocations) released.set(a.LotId, (released.get(a.LotId) || 0) + a.AmountCents);
  }
  if (candidates.some(e => lotMap.get(e.LotId)?.ReservedCents !== (released.get(e.LotId) || 0))) errors.push('Card reservations do not match the unpaid vendor requests.');
  const release = [...released.values()].reduce((a, b) => a + b, 0);
  if (![balance.ReservedCents, balance.RefundCents, balance.NetCents, balance.PaidCents].every(integer)
    || balance.ReservedCents < release || balance.NetCents - balance.PaidCents < c.TotalCents || balance.ReviewRequired)
    errors.push('The vendor balance needs reconciliation before batch approval.');
  if (new Set(rows.map(row => row.AdmissionNo)).size !== c.Students) errors.push('The student count differs from the reviewed 249 buyers.');
  if (affected.length + released.size + 3 > 500) errors.push('Too many request records to reconcile atomically; Accounts must reconcile them first.');
  if (rows.every(row => row.Status === 'Not posted')) {
    const accounts = new Map();
    for (const e of candidates) { const code = clean(lotMap.get(e.LotId).PayableAccount); accounts.set(code, (accounts.get(code) || 0) + c.UnitCents); }
    try {
      await d.validateJournal(env, { Date: new Date().toISOString().slice(0, 10), Status: 'Posted',
        Lines: [...accounts].map(([AccountCode, value]) => ({ AccountCode, Debit: amount(value), Credit: 0 }))
          .concat({ AccountCode: '2200', Debit: 0, Credit: amount(c.TotalCents) }) }, scope.OrganisationEdition);
    } catch (error) { errors.push(error.message); }
  }
  const digest = await fingerprint({ campaign: c, rows, requests: affected, balance });
  return { c, rows, affected, released, release, balance, lots, digest,
    result: { ok: true, BatchId: c.BatchId, Status: 'Preview', ItemName: c.ItemName, Count: c.Count, Students: c.Students,
      Total: amount(c.TotalCents), PostedCount: 0, PostedAmount: 0, Rows: rows.map(({ SourceDigest, LotDigest, ...row }) => row),
      Requests: affected.map(r => ({ SettlementId: r.SettlementId, Amount: amount(r.AmountCents), Status: r.Status })),
      Errors: errors, CanApprove: !errors.length && rows.every(row => row.Status === 'Not posted'), PreviewDigest: digest,
      message: 'Read-only review. Approval cancels the listed unpaid vendor requests, preserves their history and posts linked wallet refunds. No cards are restocked.' } };
}

async function approve(env, user, scope, body, c, d) {
  await d.authorize(env, user, body);
  const saved = await d.get(env, CARD_REFUND_BATCHES, c.BatchId);
  if (saved) { requireCondition(visible(saved, scope) && saved.PurchaseSetDigest === c.PurchaseSetDigest, 'The saved batch has a conflicting scope.'); return rowSummary(saved); }
  const p = await preview(env, scope, c, d);
  requireCondition(body.Confirmed === true && body.PreviewDigest === p.digest && p.result.CanApprove, 'Load and confirm an unchanged, eligible refund preview first.');
  requireCondition(clean(body.Notes) && clean(body.EvidenceReference), 'Provide the refund reason and approval evidence reference.');
  const at = new Date().toISOString(), approvedBy = clean(user.displayName || user.username), writes = [];
  for (const r of p.affected) writes.push(d.write('vendorSettlementRequests', r.SettlementId, { ...r,
    Status: 'Cancelled', PaymentStatus: 'Cancelled', RefundBatchId: c.BatchId, UpdatedAt: at,
    History: [...(r.History || []), { Action: 'Cancelled for card refund batch', BatchId: c.BatchId, By: approvedBy,
      Username: user.username, Role: actorRole(user), At: at, Notes: clean(body.Notes), AuthorizationMethod: 'Password' }] }, r));
  for (const [lotId, reserved] of p.released) {
    const lot = p.lots.find(row => row.LotId === lotId);
    writes.push(d.write('vendorClaimLots', lotId, { ...lot, ReservedCents: lot.ReservedCents - reserved, UpdatedAt: at }, lot));
  }
  const batch = { ...scope, ...c, Status: 'Approved', Rows: p.rows, PostedCount: 0, PostedCents: 0,
    ApprovedAt: at, ApprovedBy: approvedBy, ApprovedByUsername: user.username, ApprovedRole: actorRole(user),
    Notes: clean(body.Notes).slice(0, 2000), EvidenceReference: clean(body.EvidenceReference).slice(0, 2000),
    PreviewDigest: p.digest, Requests: p.result.Requests.map(r => ({ ...r, Status: 'Cancelled for refund' })) };
  writes.push(d.write('vendorBalances', c.VendorId, { ...p.balance, ActiveRefundBatchId: c.BatchId,
    ReservedCents: p.balance.ReservedCents - p.release, UpdatedAt: at }, p.balance),
  d.write(CARD_REFUND_BATCHES, c.BatchId, batch), d.audit(scope, user, 'CARD REFUND BATCH APPROVED', c.BatchId,
    `${c.Count} purchases; NGN ${amount(c.TotalCents)}; unpaid reservations released NGN ${amount(p.release)}; ${batch.EvidenceReference}`, `${c.BatchId}-approved`));
  await d.commit(env, writes);
  return rowSummary(batch);
}

async function postNext(env, user, scope, c, d) {
  const batch = await d.get(env, CARD_REFUND_BATCHES, c.BatchId);
  requireCondition(visible(batch, scope) && batch.ApprovedRole === 'Accounts Officer' && batch.ApprovedByUsername
    && batch.PurchaseSetDigest === c.PurchaseSetDigest && batch.TotalCents === c.TotalCents && batch.Rows.length === c.Count,
  'An Accounts Officer must approve this exact batch first.');
  if (batch.Status === 'Completed') return rowSummary(batch);
  requireCondition(['Approved', 'Processing'].includes(batch.Status) && integer(batch.PostedCount)
    && batch.PostedCount < c.Count && batch.PostedCents === batch.PostedCount * c.UnitCents, 'Batch progress requires finance review.');
  const planned = batch.Rows[batch.PostedCount];
  const [entry, lot, sale, ledger, balance] = await Promise.all([
    d.get(env, 'vendorEarnings', planned.EntryId), d.get(env, 'vendorClaimLots', planned.LotId),
    d.get(env, 'organizationCommerceSales', planned.SaleNo), d.get(env, 'ledger', planned.LedgerNo), d.get(env, 'vendorBalances', c.VendorId)]);
  const checked = await originalEvidence(env, entry, lot, sale, ledger, c);
  requireCondition(checked.SourceDigest === planned.SourceDigest && checked.LotDigest === planned.LotDigest && lot.ReservedCents === 0,
    `Purchase ${planned.SaleNo} changed after approval. Previous refunds remain posted; this one needs review.`);
  requireCondition(visible(balance, scope) && balance.ActiveRefundBatchId === c.BatchId
    && integer(balance.RefundCents) && integer(balance.NetCents) && balance.NetCents >= c.UnitCents, 'The vendor batch hold or balance changed.');
  const refundId = `VREF-CARD-${await fingerprint({ scope: c.ScopeKey, entry: entry.EntryId })}`;
  const at = new Date().toISOString(), actor = clean(user.displayName || user.username), value = amount(c.UnitCents);
  const journal = { ...scope, SchoolSection: c.SchoolSection, JournalNo: `SYS-${refundId}`, Date: at.slice(0, 10), Status: 'Posted',
    System: 'YES', Source: 'Vendor Refund', SourceId: refundId, Reference: c.BatchId, Description: `Refund: ${c.ItemName}`,
    Lines: [{ AccountCode: lot.PayableAccount, Debit: value, Credit: 0, VendorId: c.VendorId, Description: entry.SaleNo },
      { AccountCode: '2200', Debit: 0, Credit: value, VendorId: c.VendorId, Description: 'Return to original student wallet' }],
    CreatedAt: at, RecordedBy: actor };
  await d.validateJournal(env, journal, scope.OrganisationEdition);
  const credit = { ...scope, SchoolSection: ledger.SchoolSection, LedgerNo: `WALLET-${refundId}`, Date: at,
    AccountRef: ledger.AccountRef, AdmissionNo: ledger.AdmissionNo, ApplicationReference: ledger.ApplicationReference || '',
    DisplayName: ledger.DisplayName, ClassName: ledger.ClassName, Currency: 'NGN', Department: 'Tuck Shop',
    EntryType: 'Wallet Refund', FeeCategory: 'Wallet', Debit: 0, Credit: value, Reference: c.BatchId,
    Description: `Refund: ${c.ItemName} - sales approval under review`, RecordedBy: actor,
    Metadata: JSON.stringify({ originalLedgerNo: ledger.LedgerNo, saleNo: sale.SaleNo, refundId, refundBatchId: c.BatchId }) };
  const refunded = { ...scope, SchoolSection: c.SchoolSection, EntryId: refundId, VendorId: c.VendorId, Type: 'Refund', Date: at.slice(0, 10),
    OriginalEntryId: entry.EntryId, SaleNo: entry.SaleNo, CollectionMode: entry.CollectionMode, GrossCents: 0, RefundCents: c.UnitCents,
    ChargeCents: 0, NetCents: -c.UnitCents, RuleSnapshot: entry.RuleSnapshot, Items: entry.Items, Notes: batch.Notes,
    Reference: c.BatchId, EvidenceReference: batch.EvidenceReference, JournalNo: journal.JournalNo,
    AuthorizationMethod: 'Accounts Officer approved batch', ApprovedByUsername: batch.ApprovedByUsername,
    BatchId: c.BatchId, RecordedBy: actor, CreatedAt: at, LotAdjustments: [{ LotId: lot.LotId, NetCents: 0, ChargeCents: 0 }] };
  const count = batch.PostedCount + 1, completed = count === c.Count;
  const updated = { ...batch, PostedCount: count, PostedCents: count * c.UnitCents, Status: completed ? 'Completed' : 'Processing',
    UpdatedAt: at, ...(completed ? { CompletedAt: at } : {}),
    Rows: batch.Rows.map((row, i) => i === batch.PostedCount ? { ...row, Status: 'Posted', RefundId: refundId, PostedAt: at } : row) };
  const writes = [d.write('ledger', credit.LedgerNo, credit), d.write('accountingJournals', journal.JournalNo, journal),
    d.write('vendorEarnings', refundId, refunded), d.write('vendorClaimLots', lot.LotId, { ...lot, RefundedCents: c.UnitCents, NetCents: 0, UpdatedAt: at }, lot),
    d.write('vendorBalances', c.VendorId, { ...balance, RefundCents: balance.RefundCents + c.UnitCents,
      NetCents: balance.NetCents - c.UnitCents, ActiveRefundBatchId: completed ? '' : c.BatchId, UpdatedAt: at }, balance),
    d.write(CARD_REFUND_BATCHES, c.BatchId, updated, batch),
    d.audit(scope, user, 'CARD WALLET REFUND POSTED', refundId, `${planned.AdmissionNo}; NGN ${value}; ${entry.SaleNo}; batch ${c.BatchId}`, refundId)];
  // Evidence is read-locked; original sale, debit, payment and receipt documents are never written.
  await d.commitChecked(env, writes, [recordCheck('vendorEarnings', entry), recordCheck('organizationCommerceSales', sale), recordCheck('ledger', ledger)]);
  return rowSummary(updated);
}

export async function handleCardRefundBatch(env, user, scope, body, d) {
  const c = d.campaign || CARD_REFUND_CAMPAIGN; // Dependency injection is internal-only, never request input.
  const read = body.action === 'previewCardRefundBatch';
  if (!(read ? ['Super Admin', 'Director', 'Accounts Officer'] : ['Accounts Officer']).includes(actorRole(user))) fail('Only an Accounts Officer can approve or post card refunds.', 403);
  requireCondition(scope.ScopeKey === c.ScopeKey && (lower(scope.SchoolSection) === 'all' || lower(scope.SchoolSection) === lower(c.SchoolSection))
    && body.VendorId === c.VendorId, 'This card refund campaign is not available in this vendor, branch or section.');
  if (body.action === 'approveCardRefundBatch') return approve(env, user, scope, body, c, d);
  if (body.action === 'postCardRefundBatch') return postNext(env, user, scope, c, d);
  const saved = await d.get(env, CARD_REFUND_BATCHES, c.BatchId);
  if (saved) { requireCondition(visible(saved, scope), 'The batch is outside your scope.'); return rowSummary(saved); }
  return (await preview(env, scope, c, d)).result;
}
