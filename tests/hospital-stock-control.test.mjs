import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stockFixture,env,request,createHospitalService,stockOwner,actors} from './helpers/hospital-stock-control-fixture.mjs';
const period={fromDate:'2026-10-26',toDate:'2026-10-26'},expiry={fromDate:'2027-12-01',toDate:'2027-12-31'};

test('physical count submission preserves balances; second-officer approval applies one traceable difference',async()=>{
  const f=await stockFixture(),original=structuredClone(f.batch()),protectedRows=structuredClone([...f.rows('Patients'),...f.rows('Visits'),...f.rows('StockReceipts')]);
  const {CountId}=await f.submit();assert.equal(f.batch().OnHand,20);assert.equal(f.rows('StockMovements').length,1);
  await f.owner.reviewStockCount(await f.review(CountId));assert.equal(f.batch().OnHand,18);assert.equal(f.batch().LastStockCountId,CountId);
  const count=f.rows('StockCounts')[0];assert.deepEqual(count.Before,{OnHand:20,Quarantined:0});assert.deepEqual(count.Counted,{OnHand:18,Quarantined:0});assert.equal(count.Status,'Approved');
  const movement=f.rows('StockMovements').find(m=>m.Type==='Approved physical count');assert.equal(movement.Quantity,-2);assert.equal(movement.Actor,'stock-owner');
  for(const key of ['Medicine','MedicineKey','UnitPriceCents','ExpiryDate','CreatedAt'])assert.equal(f.batch()[key],original[key]);
  assert.deepEqual([...f.rows('Patients'),...f.rows('Visits'),...f.rows('StockReceipts')],protectedRows);assert.equal(f.rows('ChargeEvents').length,0);assert.equal(f.rows('SupplierPayments').length,0);
});
test('stock controls enforce roles, module permission, branch isolation and viewing-only subscriptions',async()=>{
  const f=await stockFixture();for(const user of [actors.doctor,actors.laboratory,{...stockOwner,allowedSections:[]},{...stockOwner,role:'Hospital Cashier'}]){const service=createHospitalService(env,user,f.db);await assert.rejects(service.stockExpiryRegister(request({DateRange:expiry})),e=>e.status===403);}
  await assert.rejects(f.owner.submitStockCount(f.proposal()),e=>e.status===403);
  const ro=createHospitalService(env,{...actors.pharmacist,subscriptionReadOnly:true},f.db);await assert.rejects(ro.submitStockCount(f.proposal()),e=>e.status===403);
  const broad=createHospitalService(env,{...stockOwner,assignedBranchIds:['main','north']},f.db);const {CountId}=await f.submit();for(const action of ['stockCountDetails','stockCountHistory'])await assert.rejects(broad[action](request({BranchId:'north',CountId,DateRange:period})),e=>e.status===404);
  await assert.rejects(broad.stockBatchForCount(request({BranchId:'north',BatchId:f.batch().BatchId})),e=>e.status===404);
});
test('counter cannot approve or reject own count; only the counter may cancel it',async()=>{
  const f=await stockFixture(),{CountId}=await f.submit();for(const Decision of ['Approve','Reject'])await assert.rejects(f.pharmacist.reviewStockCount(await f.review(CountId,Decision)),e=>e.status===403);
  const other=createHospitalService(env,{...actors.pharmacist,username:'second-pharmacist'},f.db);await assert.rejects(other.reviewStockCount(await f.review(CountId,'Cancel')),e=>e.status===403);
  await f.pharmacist.reviewStockCount(await f.review(CountId,'Cancel'));assert.equal(f.rows('StockCounts')[0].Status,'Cancelled');assert.equal(f.batch().OnHand,20);assert.equal(f.rows('StockCountGuards')[0].PendingCountId,'');
});
test('receipt, stock movement and changed-version conflicts cannot approve stale counts',async()=>{
  const f=await stockFixture(),{CountId}=await f.submit();await f.receive({Quantity:2});const details=await f.owner.stockCountDetails(request({CountId}));assert.equal(details.Stale,true);
  await assert.rejects(f.owner.reviewStockCount(await f.review(CountId)),e=>e.status===409);assert.equal(f.batch().OnHand,22);assert.equal(f.rows('StockCounts')[0].Status,'Pending');
  await f.owner.reviewStockCount(await f.review(CountId,'Reject'));const second=await f.submit({OnHand:22});await f.owner.reviewStockCount(await f.review(second.CountId));assert.equal(f.batch().OnHand,22);assert.equal(f.rows('StockCounts').length,2);
});
test('only one pending count can be created for a batch, including simultaneous requests',async()=>{
  const f=await stockFixture();const results=await Promise.allSettled([f.submit(),f.submit()]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.rows('StockCounts').length,1);assert.equal(f.rows('StockCountEvents').length,1);
  await assert.rejects(f.submit(),/pending count/);
});
test('simultaneous reviewers change stock and audit once',async()=>{
  const f=await stockFixture(),{CountId}=await f.submit(),body=await f.review(CountId),other=createHospitalService(env,{...stockOwner,username:'other-reviewer'},f.db);
  const results=await Promise.allSettled([f.owner.reviewStockCount(body),other.reviewStockCount({...body,RequestId:crypto.randomUUID()})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.batch().OnHand,18);assert.equal(f.rows('StockMovements').filter(m=>m.CountId===CountId).length,1);assert.equal(f.rows('Audit').filter(r=>r.Action==='Approve physical pharmacy count').length,1);
});
test('lost responses and repeated references do not duplicate counts, movements or decisions',async()=>{
  const f=await stockFixture(),body=f.proposal();const {CountId}=await f.pharmacist.submitStockCount(body);const writes=f.commits.length,reads=f.reads.length;
  assert.equal((await f.pharmacist.submitStockCount(body)).replayed,true);assert.equal(f.reads.length-reads,1);assert.equal(f.commits.length,writes);
  const before=f.reads.length;assert.equal((await f.pharmacist.submitStockCount({...body,RequestId:crypto.randomUUID()})).Unchanged,true);assert.equal(f.reads.length-before,2);assert.equal(f.commits.length,writes);
  await assert.rejects(f.pharmacist.submitStockCount({...body,RequestId:crypto.randomUUID(),OnHand:17}),/reference already exists/);
  let lost=true;const service=createHospitalService(env,stockOwner,{...f.db,batchCommitLiteralDocuments:async(...args)=>{await f.db.batchCommitLiteralDocuments(...args);if(lost){lost=false;throw Object.assign(Error('lost response'),{status:503});}}});
  const approval=await f.review(CountId);await assert.rejects(service.reviewStockCount(approval),/lost response/);const n=f.commits.length;assert.equal((await service.reviewStockCount(approval)).replayed,true);assert.equal(f.commits.length,n);assert.equal(f.batch().OnHand,18);
});
test('expiry and count pages are bounded, date-first and read-only with stable pagination',async()=>{
  const f=await stockFixture();await assert.rejects(f.owner.stockExpiryRegister(request()),/date/i);await assert.rejects(f.owner.stockExpiryRegister(request({DateRange:{fromDate:'2025-01-01',toDate:'2027-01-01'}})),/93 days/);
  for(let i=0;i<31;i++){const row={...f.batch(),BatchId:`batch-${String(i).padStart(2,'0')}`,__id:`batch-${String(i).padStart(2,'0')}`};f.store.set(`hospitalWorkspaces/test-hospital/hospitalMedicineBatches/${row.BatchId}`,row);}
  const n=f.commits.length,r=f.reads.length;const first=await f.owner.stockExpiryRegister(request({DateRange:expiry}));assert.equal(first.batches.length,30);assert.ok(first.next);const second=await f.owner.stockExpiryRegister(request({DateRange:expiry,Cursor:first.next}));assert.equal(second.batches.length,2);assert.equal(f.commits.length,n);assert.equal(f.reads.length,r);assert.equal(f.queries.at(-1).limit,31);assert.ok(f.queries.at(-1).filters.some(q=>q.field==='BranchId'));
  const {CountId}=await f.submit();const before=f.commits.length;const records=await f.owner.stockCountRegister(request({DateRange:period,Status:'Pending'}));assert.equal(records.counts[0].CountId,CountId);assert.equal((await f.owner.stockCountHistory(request({CountId,DateRange:period}))).events.length,1);assert.equal(f.commits.length,before);
});
test('count quantities, evidence, confirmations and time must be valid',async()=>{
  const f=await stockFixture();for(const value of [-1,'',null,{},'Infinity',1000001,'0.0001','1e3'])await assert.rejects(f.submit({OnHand:value}));
  for(const value of ['', '2026-02-30T12:00:00Z','2027-01-01T12:00:00Z','2026-10-25T12:00:00Z'])await assert.rejects(f.submit({CountedAt:value}));
  await assert.rejects(f.submit({Confirmed:false}),/Confirm/);await assert.rejects(f.submit({Reason:''}),/Reason/);await assert.rejects(f.submit({BatchRevision:'old'}),e=>e.status===409);
  const {CountId}=await f.submit({OnHand:'0.125'});await f.owner.reviewStockCount(await f.review(CountId));assert.equal(f.batch().OnHand,0.125);assert.equal(f.rows('StockCounts')[0].Difference.OnHand,-19.875);
});
test('reconciliation cannot reclassify quarantined stock into shelf stock',async()=>{
  const f=await stockFixture();await f.pharmacist.quarantineStock(request({BatchId:f.batch().BatchId,Revision:f.batch().__updateTime,Quantity:3,Reason:'Separate stock under review'}));
  await assert.rejects(f.submit({OnHand:20,Quarantined:0}),/cannot move stock/);assert.equal(f.batch().OnHand,17);assert.equal(f.batch().Quarantined,3);
  const {CountId}=await f.submit({OnHand:16,Quarantined:2});await f.owner.reviewStockCount(await f.review(CountId));assert.equal(f.batch().Quarantined,2);assert.equal(f.rows('StockMovements').at(-1).QuarantinedQuantity,-1);
});
test('expired batches stay marked expired after counting, and original stock movements are retained',async()=>{
  const f=await stockFixture(),old=f.batch(),path=`hospitalWorkspaces/test-hospital/hospitalMedicineBatches/${old.BatchId}`;f.store.set(path,{...old,ExpiryDate:'2026-10-26'});
  const {CountId}=await f.submit();await f.owner.reviewStockCount(await f.review(CountId));const page=await f.owner.stockExpiryRegister(request({DateRange:period}));assert.equal(page.batches[0].Expired,true);assert.equal(f.batch().ExpiryDate,'2026-10-26');assert.equal(f.rows('StockMovements')[0].Type,'Receipt');
});
test('submission and approval have fixed read/write budgets and never query patient or financial history',async()=>{
  const f=await stockFixture();let r=f.reads.length,q=f.queries.length;const {CountId}=await f.submit();assert.equal(f.reads.length-r,4);assert.equal(f.commits.at(-1).length,5);assert.equal(f.queries.length,q);
  const body=await f.review(CountId);r=f.reads.length;await f.owner.reviewStockCount(body);assert.equal(f.reads.length-r,4);assert.equal(f.commits.at(-1).length,7);assert.equal(f.queries.length,q);
});
test('backup discovery includes counts, event history and pending-count guards',async()=>{
  const {HOSPITAL_COLLECTIONS}=await import('../functions/lib/hospital-storage.js');for(const name of ['StockCounts','StockCountEvents','StockCountGuards'])assert.ok(HOSPITAL_COLLECTIONS.includes(name));
  const backup=await readFile(new URL('../functions/lib/organization-backup.js',import.meta.url),'utf8');assert.match(backup,/HOSPITAL_COLLECTIONS/);
});
test('a matching physical count records verification without a zero-quantity stock movement',async()=>{
  const f=await stockFixture(),{CountId}=await f.submit({OnHand:20});await f.owner.reviewStockCount(await f.review(CountId));assert.equal(f.batch().LastStockCountId,CountId);assert.equal(f.batch().OnHand,20);assert.equal(f.rows('StockMovements').length,1);assert.equal(f.commits.at(-1).length,6);
});
test('an actual dispensing makes the saved count stale without blocking patient care',async()=>{
  const f=await stockFixture(),order=await f.create();await f.pharmacist.reviewPrescription(await f.body(order,{Decision:'Approved',Reason:'Reviewed prescription'}));
  const {CountId}=await f.submit();await f.pharmacist.dispensePrescription(await f.body(order,{BatchId:f.batch().BatchId,BatchRevision:f.batch().__updateTime,Quantity:2}));
  const dispenses=structuredClone(f.rows('Dispenses')),charges=structuredClone(f.rows('ChargeEvents'));
  await assert.rejects(f.owner.reviewStockCount(await f.review(CountId)),e=>e.status===409);assert.equal(f.batch().OnHand,18);assert.deepEqual(f.rows('Dispenses'),dispenses);assert.deepEqual(f.rows('ChargeEvents'),charges);
});
test('cancelled references and rejected decisions cannot be reused to resurrect or duplicate a count',async()=>{
  const f=await stockFixture(),body=f.proposal(),{CountId}=await f.pharmacist.submitStockCount(body);await f.pharmacist.reviewStockCount(await f.review(CountId,'Cancel'));
  const writes=f.commits.length;const retry=await f.pharmacist.submitStockCount({...body,RequestId:crypto.randomUUID()});assert.equal(retry.Unchanged,true);assert.equal(f.commits.length,writes);assert.equal(f.rows('StockCounts')[0].Status,'Cancelled');
  await assert.rejects(f.owner.reviewStockCount(await f.review(CountId)),/already been decided/);
});
