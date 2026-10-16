import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { cardRefundFixture } from './helpers/card-refund-fixture.mjs';
import { CARD_REFUND_BATCHES, CARD_REFUND_CAMPAIGN } from '../functions/lib/card-refund-batch.js';
import { balanceView } from '../functions/lib/vendor-settlement-rules.js';
import { cardRefundReport } from '../js/card-refund-batch.js';

const small = () => cardRefundFixture({count:3,students:2,reservations:2});
test('255 refunds total 892500 for 249 students; six repeat buyers get 7000; original documents and receipts retain revisions', async () => {
  const f = await cardRefundFixture();
  const before = new Map(f.store);
  const preview = await f.run('previewCardRefundBatch');
  assert.equal(f.commits.length,0); assert(preview.CanApprove); assert.equal(preview.Total,892500);
  await f.approve();
  const cancelled = f.get('vendorSettlementRequests','pending-request');
  assert.equal(cancelled.Status,'Cancelled'); assert.equal(cancelled.PaidCents,0); assert.equal(cancelled.AmountCents,40600000);
  assert.deepEqual(cancelled.Allocations,before.get('vendorSettlementRequests/pending-request').Allocations);
  assert.equal(cancelled.History.length,2);
  assert(balanceView(f.get('vendorBalances',f.c.VendorId)).NeedsReview);
  for (let i=0;i<255;i++) { const r=await f.run('postCardRefundBatch'); assert.equal(r.PostedCount,i+1); }
  const result=await f.run('previewCardRefundBatch');
  assert.equal(result.Status,'Completed'); assert.equal(result.PostedAmount,892500);
  const refunds=f.list('ledger').filter(r=>r.EntryType==='Wallet Refund'); assert.equal(refunds.length,255);
  const totals=new Map(); for(const r of refunds) totals.set(r.AccountRef,(totals.get(r.AccountRef)||0)+r.Credit);
  assert.equal(totals.size,249); assert.equal([...totals.values()].filter(v=>v===7000).length,6);
  for (const [key,value] of before) if (/^(ledger|organizationCommerceSales|vendorEarnings|payments)\//.test(key)) assert.deepEqual(f.store.get(key),value,key);
  assert.equal(f.list('accountingJournals').length,255); assert.equal(f.list('accountingAudit').length,256);
  const balance=f.get('vendorBalances',f.c.VendorId); assert.equal(balance.ReservedCents,0); assert.equal(balance.NetCents,0);
  assert.equal(balance.RefundCents,89250000); assert.equal(balance.ActiveRefundBatchId,''); assert(!balanceView(balance).NeedsReview);
  const commits=f.commits.length; await f.run('postCardRefundBatch'); await f.approve(); assert.equal(f.commits.length,commits);
  assert.match(cardRefundReport(result),/₦892,500.00/); assert.doesNotMatch(cardRefundReport(result),/>Not posted</);
});

test('scope is frozen by exact purchase-set digest, count and total; callers cannot change it', async()=>{
  const f=await small(); const p=await f.run('previewCardRefundBatch',{Amount:1,Count:1,InventoryId:'other'});
  assert.equal(p.Total,10500); assert.equal(p.Count,3);
  const entry=f.list('vendorEarnings')[0]; f.store.delete(`vendorEarnings/${entry.EntryId}`);
  f.put('vendorEarnings','replacement',{...entry,EntryId:'replacement'});
  await assert.rejects(f.run('previewCardRefundBatch'),/differs/); assert.equal(f.commits.length,0);
  assert.equal(CARD_REFUND_CAMPAIGN.TotalCents,89250000);
});

test('only Accounts Officer can approve and post; password, confirmation and unchanged review are mandatory', async()=>{
  const f=await small(), p=await f.run('previewCardRefundBatch');
  for(const role of ['Super Admin','Director','Admin','Vendor User','Tuck Shop User']) {
    await assert.rejects(f.run('approveCardRefundBatch',{}, {...f.user,role}),/Accounts Officer/);
    await assert.rejects(f.run('postCardRefundBatch',{}, {...f.user,role}),/Accounts Officer/);
  }
  await assert.rejects(f.run('approveCardRefundBatch',{}),/Password/);
  await assert.rejects(f.run('postCardRefundBatch'),/approve/);
  await assert.rejects(f.run('approveCardRefundBatch',{approvalPassword:'test-only',PreviewDigest:p.PreviewDigest}),/confirm/);
  f.put('vendorBalances',f.c.VendorId,{...f.get('vendorBalances',f.c.VendorId),UpdatedAt:'changed'});
  await assert.rejects(f.run('approveCardRefundBatch',{approvalPassword:'test-only',Confirmed:true,PreviewDigest:p.PreviewDigest}),/unchanged/);
  await assert.rejects(f.run('previewCardRefundBatch',{},f.user,{...f.scope,ScopeKey:'school--another'}),/not available/);
  await assert.rejects(f.run('previewCardRefundBatch',{},f.user,{...f.scope,SchoolSection:'Primary'}),/not available/);
  await assert.rejects(f.run('previewCardRefundBatch',{VendorId:'other'}),/not available/);
  assert.equal(f.commits.length,0);
});

test('partial/full prior refunds, vendor payments, stock holds and missing evidence block approval', async()=>{
  for(const change of [{RefundedCents:1},{RefundedCents:350000},{PaidCents:1},{SettlementHold:true},{ChargeCents:1},{PeriodId:'monthly'}]) {
    const f=await small(), lot=f.list('vendorClaimLots')[0]; f.put('vendorClaimLots',lot.LotId,{...lot,...change});
    const p=await f.run('previewCardRefundBatch'); assert(!p.CanApprove); assert.equal(p.Rows[0].Status,'Blocked');
    await assert.rejects(f.approve()); assert.equal(f.commits.length,0);
  }
  const f=await small(); f.store.delete(`ledger/${f.list('ledger')[0].LedgerNo}`);
  assert.equal((await f.run('previewCardRefundBatch')).CanApprove,false);
});

test('paid or mixed vendor requests and unmatched reservations cannot be silently cancelled', async()=>{
  for(const change of [{PaidCents:1},{Allocations:[{LotId:'unrelated',AmountCents:350000},{LotId:'VSAL-test-0000--'+CARD_REFUND_CAMPAIGN.VendorId,AmountCents:350000}]},{AmountCents:1}]) {
    const f=await small(); f.put('vendorSettlementRequests','pending-request',{...f.get('vendorSettlementRequests','pending-request'),...change});
    assert(!(await f.run('previewCardRefundBatch')).CanApprove); await assert.rejects(f.approve()); assert.equal(f.commits.length,0);
  }
});

test('lost response and concurrent retries cannot double-credit a purchase', async()=>{
  const f=await small(); await f.approve();
  const outcomes=await Promise.allSettled([f.run('postCardRefundBatch'),f.run('postCardRefundBatch')]);
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(f.list('ledger').filter(r=>r.Credit>0).length,1);
  await f.run('postCardRefundBatch'); // retry after a lost response resumes the next approved purchase
  await f.run('postCardRefundBatch'); await f.run('postCardRefundBatch');
  assert.equal(f.list('ledger').filter(r=>r.Credit>0).length,3);
});

test('changed evidence, conditional-write conflicts and closed periods preserve all prior refunds and stop safely', async()=>{
  for(const mode of ['source','conflict','closed','race']) {
    const f=await small(); await f.approve(); await f.run('postCardRefundBatch');
    const before=f.list('ledger');
    if(mode==='source') { const row=f.get(CARD_REFUND_BATCHES,f.c.BatchId).Rows[1], sale=f.get('organizationCommerceSales',row.SaleNo); f.put('organizationCommerceSales',sale.SaleNo,{...sale,CustomerRef:'wrong-student'}); }
    if(mode==='conflict') f.conflict(); if(mode==='closed') f.closePeriod(); if(mode==='race') f.changeEvidence();
    await assert.rejects(f.run('postCardRefundBatch'));
    assert.deepEqual(f.list('ledger'),before); assert.equal(f.get(CARD_REFUND_BATCHES,f.c.BatchId).PostedCount,1);
    assert(balanceView(f.get('vendorBalances',f.c.VendorId)).NeedsReview);
  }
});

test('original wallet identity, branch, currency, card amount and vendor links are validated', async()=>{
  for(const [col,change] of [['ledger',{AccountRef:'wrong'}],['ledger',{BranchId:'other'}],['ledger',{Currency:'USD'}],
    ['organizationCommerceSales',{PaymentStatus:'Pending'}],['organizationCommerceSales',{Amount:1}],['organizationCommerceSales',{VendorSettlements:[]}],
    ['organizationCommerceSales',{PaidAt:'2026-10-17T00:00:00Z'}]]) {
    const f=await small(), row=f.list(col)[0]; f.put(col,row.__id,{...row,...change});
    assert(!(await f.run('previewCardRefundBatch')).CanApprove); assert.equal(f.commits.length,0);
  }
});

test('parent portal includes wallet refunds and the batch report escapes names', async()=>{
  const source=await readFile(new URL('../functions/api/parent-dashboard.js',import.meta.url),'utf8');
  assert.match(source,/walletEntries/); assert.match(source,/FeeCategory.*wallet/is);
  const walletFunction=source.slice(source.indexOf('function walletBalance('),source.indexOf('function parseMetadata('));
  const balance=runInNewContext(`${walletFunction}\nwalletBalance`,{asMoneyNumber:Number});
  const f=await small(); await f.approve();
  const original=f.list('ledger'), opening={FeeCategory:'Wallet',Credit:50000,Debit:0};
  for(let i=0;i<f.c.Count;i++) await f.run('postCardRefundBatch');
  for(const ref of new Set(original.map(row=>row.AccountRef))) {
    const before=original.filter(row=>row.AccountRef===ref);
    const after=f.list('ledger').filter(row=>row.AccountRef===ref && row.FeeCategory.toLowerCase()==='wallet');
    const credits=after.filter(row=>row.EntryType==='Wallet Refund');
    assert.equal(balance([opening,...after])-balance([opening,...before]),before.length*3500);
    assert.equal(credits.length,before.length);
    assert(credits.every(row=>row.AdmissionNo===ref && row.Description==='Refund: 4k RFID S70 NFC Card - sales approval under review'));
    assert(credits.every(row=>JSON.parse(row.Metadata).originalLedgerNo));
  }
  const report=cardRefundReport({Rows:[{AdmissionNo:'x',StudentName:'<script>x</script>',Amount:3500,Status:'Posted'}],PostedAmount:3500,Total:3500});
  assert(!report.includes('<script>')); assert(report.includes('&lt;script&gt;'));
});
