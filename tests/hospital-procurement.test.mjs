import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {procurementFixture,procurementActors,request,period,env} from './helpers/hospital-procurement-fixture.mjs';
import {createHospitalService} from '../functions/lib/hospital-service.js';
import {hospitalCollectionPath} from '../functions/lib/hospital-storage.js';
const reject=(promise,pattern)=>assert.rejects(promise,pattern);
const ledger=f=>[...f.store.entries()].filter(([k])=>k.startsWith('accountingJournals/')).map(([,v])=>v);
const refreshPurchase=(f,r)=>f.owner.pharmacyPurchase(request({PurchaseId:r.PurchaseId})).then(r=>r.purchase);
const refreshBill=(f,r)=>f.owner.supplierBill(request({BillId:r.BillId})).then(r=>r.bill);
const pay=(f,b,extra={})=>f.cashier.recordSupplierPayment(request({BillId:b.BillId,Revision:b.Revision,Amount:'5.00',Method:'Bank transfer',Reference:crypto.randomUUID(),Confirmed:true,...extra}));

test('approved purchases receive partial stock, invoice only received goods and settle without patient charges',async()=>{
  const f=await procurementFixture(),before=structuredClone(f.rows('Patients')),p=await f.approved();
  const r=await f.receive(p),p2=await refreshPurchase(f,p);assert.equal(p2.Status,'Part received');assert.equal(f.rows('MedicineBatches')[0].OnHand,5);assert.equal(ledger(f).length,0);
  const b=await f.approvedBill([r]);assert.equal(b.AmountCents,1000);assert.equal(f.rows('PharmacySuppliers')[0].OutstandingCents,1000);
  await pay(f,b);const partial=await refreshBill(f,b);assert.equal(partial.Status,'Part paid');await pay(f,partial);const settled=await refreshBill(f,b);assert.equal(settled.Status,'Settled');assert.equal(settled.BalanceCents,0);
  const r2=await f.receive(p2,{DeliveryLine:'2'});assert.equal((await refreshPurchase(f,p)).Status,'Received');assert.equal(r2.AmountCents,1000);
  assert.equal(f.rows('ChargeEvents').length,0);assert.deepEqual(f.rows('Patients'),before);assert.equal(ledger(f).length,3);
  for(const j of ledger(f)){assert.equal(j.TotalDebit,j.TotalCredit);assert.equal(j.HospitalSupplierId,f.supplier.SupplierId);assert.equal(j.HospitalSupplierBillId,b.BillId);assert.equal(j.Reference,b.Reference);assert.equal(j.HospitalPatientId,'');}
});
test('lost-response retries and fresh duplicate delivery references cannot receive stock twice',async()=>{
  const f=await procurementFixture(),p=await f.approved(),body=f.receiveBody(p,{DeliveryReference:'Delivery 001'}),commit=f.db.batchCommitLiteralDocuments;
  let lost=true;f.db.batchCommitLiteralDocuments=async(...args)=>{await commit(...args);if(lost){lost=false;throw Error('Lost response');}};
  const lostService=createHospitalService(env,procurementActors.pharmacist,f.db);await reject(lostService.receivePharmacyPurchase(body),/Lost response/);const before=f.commits.length,result=await f.pharmacist.receivePharmacyPurchase(body);assert.ok(result.ReceiptId);assert.equal(f.commits.length,before);assert.equal(f.rows('MedicineBatches')[0].OnHand,5);
  await reject(f.pharmacist.receivePharmacyPurchase(f.receiveBody(await refreshPurchase(f,p),{DeliveryReference:'  DELIVERY 001  '})),/already received/);assert.equal(f.rows('StockReceipts').length,1);
});
test('direct stock receiving and approved purchase receiving share the original delivery-line guard',async()=>{
  const f=await procurementFixture(),p=await f.approved();await f.pharmacist.receiveMedicine(request({Stock:{...f.item,Quantity:5,BatchNumber:'LOT-PROC',ExpiryDate:'2027-10-01',UnitPrice:'3.00',Supplier:f.supplier.Name,ReceiptReference:'DEL-SAME',LineReference:'1'}}));
  await reject(f.pharmacist.receivePharmacyPurchase(f.receiveBody(p,{DeliveryReference:'DEL-SAME'})),/already been recorded/);assert.equal(f.rows('MedicineBatches')[0].OnHand,5);assert.equal((await refreshPurchase(f,p)).Lines[0].ReceivedQuantity,0);
});
test('receiving rejects oversupply, expired stock, changed prices, stale revisions and unapproved orders atomically',async()=>{
  const f=await procurementFixture(),draft=await f.purchase();await reject(f.receive(draft),/approved/);const p=await f.approved(),n=f.commits.length;
  for(const change of [{Quantity:11},{ExpiryDate:'2026-10-26'},{Revision:'old'},{Confirmed:false}])await reject(f.pharmacist.receivePharmacyPurchase(f.receiveBody(p,change)),/remaining|future|changed|Confirm/);
  assert.equal(f.commits.length,n);await f.receive(p);const current=await refreshPurchase(f,p);await reject(f.receive(current,{UnitPrice:'4.00'}),/different selling price/);assert.equal(f.rows('MedicineBatches')[0].OnHand,5);
});
test('two simultaneous deliveries cannot overwrite remaining quantities',async()=>{
  const f=await procurementFixture(),p=await f.approved(),results=await Promise.allSettled([f.receive(p,{Quantity:7,DeliveryReference:'A'}),f.receive(p,{Quantity:7,DeliveryReference:'B'})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.rows('MedicineBatches')[0].OnHand,7);assert.equal(f.rows('PharmacyReceipts').length,1);
});
test('invoice references and atomic receipt claims prevent repeated or competing supplier charges',async()=>{
  const f=await procurementFixture(),r=await f.receive(await f.approved()),body=f.billBody([r],{Reference:'INV-001'}),result=await f.cashier.saveSupplierBill(body),n=f.commits.length;
  assert.deepEqual(await f.cashier.saveSupplierBill(body),{...result,replayed:true});assert.equal(f.commits.length,n);await reject(f.cashier.saveSupplierBill({...body,RequestId:crypto.randomUUID()}),/already exists/);await reject(f.bill([r],{Reference:'INV-002'}),/already claimed/);
  assert.equal(f.rows('SupplierBills').length,1);assert.equal(ledger(f).length,0);
  const f2=await procurementFixture(),r2=await f2.receive(await f2.approved()),results=await Promise.allSettled([f2.bill([r2]),f2.bill([r2])]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f2.rows('SupplierBills').length,1);
});
test('supplier bills require matching received stock, explicit variance reasons and a separate authorised approver',async()=>{
  const f=await procurementFixture(),r=await f.receive(await f.approved());await reject(f.bill([r],{Amount:'11.00'}),/Explain/);
  const b=await f.bill([r],{Amount:'11.00',VarianceReason:'Verified freight charge'});await reject(f.owner.transitionSupplierBill(request({BillId:b.BillId,Revision:b.Revision,Decision:'Approve',Reason:'Review',Confirmed:true})),/transition/);
  const submitted=await f.billTransition(b,'Submit',f.cashier);const cashierApprover=createHospitalService(env,{...procurementActors.manager,username:procurementActors.cashier.username},f.db);
  await reject(f.billTransition(submitted,'Approve',cashierApprover),/different authorised/);const approved=await f.billTransition(submitted,'Approve');assert.equal(approved.ExpectedCents,1000);assert.equal(approved.AmountCents,1100);assert.equal(ledger(f)[0].TotalDebit,11);
});
test('invoice cancellation releases its receipts but retains the cancelled bill and its event history',async()=>{
  const f=await procurementFixture(),r=await f.receive(await f.approved()),b=await f.bill([r]);const cancelled=await f.billTransition(b,'Cancel',f.cashier);assert.equal(cancelled.Status,'Cancelled');assert.equal(f.rows('PharmacyReceipts')[0].BillId,'');assert.equal(f.rows('SupplierBills').length,1);
  const reopened=await f.billTransition(cancelled,'Reopen',f.cashier);assert.equal(reopened.Status,'Draft');assert.equal(f.rows('PharmacyReceipts')[0].BillId,b.BillId);assert.equal(ledger(f).length,0);
});
test('unchanged supplier, purchase and bill saves produce no writes or duplicate audit events',async()=>{
  const f=await procurementFixture();let n=f.commits.length;
  const result=await f.owner.savePharmacySupplier(request({SupplierId:f.supplier.SupplierId,Revision:f.supplier.Revision,Supplier:f.supplier}));assert.equal(result.Unchanged,true);assert.equal(f.commits.length,n);
  const body=f.draftBody(),p=(await f.owner.pharmacyPurchase(request(await f.pharmacist.savePharmacyPurchase(body)))).purchase;n=f.commits.length;
  assert.equal((await f.pharmacist.savePharmacyPurchase({...body,RequestId:crypto.randomUUID(),PurchaseId:p.PurchaseId,Revision:p.Revision})).Unchanged,true);assert.equal(f.commits.length,n);
  const r=await f.receive(await f.approved()),bb=f.billBody([r]),b=(await f.owner.supplierBill(request(await f.cashier.saveSupplierBill(bb)))).bill;n=f.commits.length;
  assert.equal((await f.cashier.saveSupplierBill({...bb,RequestId:crypto.randomUUID(),BillId:b.BillId,Revision:b.Revision})).Unchanged,true);assert.equal(f.commits.length,n);
});
test('receipts, money and approvals remain scoped by role, branch, module and writable subscription',async()=>{
  const f=await procurementFixture(),p=await f.approved(),body=f.receiveBody(p);await reject(f.owner.receivePharmacyPurchase(body),/permit/);await reject(f.cashier.receivePharmacyPurchase(body),/permit/);await reject(f.pharmacist.savePharmacySupplier(request({Supplier:{Code:'BAD',Name:'Bad'}})),/permit/);
  for(const k of ['nurse','doctor','reception'])await reject(f[k].procurementRegister(request({Kind:'Purchases',DateRange:period})),/permit/);
  await reject(f.pharmacist.procurementRegister(request({Kind:'Bills',DateRange:period})),/permit/);const restricted=createHospitalService(env,{...procurementActors.owner,allowedSections:[]},f.db);await reject(restricted.pharmacySuppliers(request()),/permit/);
  const north=createHospitalService(env,{...procurementActors.owner,assignedBranchIds:['north'],activeBranchId:'north'},f.db);await reject(north.pharmacyPurchase(request({BranchId:'north',PurchaseId:p.PurchaseId})),/unavailable/);
  const ro=createHospitalService(env,{...procurementActors.pharmacist,subscriptionReadOnly:true},f.db);await reject(ro.receivePharmacyPurchase(body),/viewing only/i);
});
test('date-first registers and bounded supplier searches perform no background reads or read-audit writes',async()=>{
  const f=await procurementFixture();await f.approved();const q=f.queries.length,w=f.commits.length;await reject(f.owner.procurementRegister(request({Kind:'Purchases'})),/date|period/i);assert.equal(f.queries.length,q);
  const data=await f.owner.procurementRegister(request({Kind:'Purchases',DateRange:period}));assert.equal(data.rows.length,1);assert.equal(f.queries.length,q+1);assert.equal(f.queries.at(-1).limit,31);assert.equal(f.commits.length,w);
  const count=f.queries.length;await f.owner.pharmacyPurchase(request({PurchaseId:data.rows[0].PurchaseId}));await f.owner.pharmacySuppliers(request({Code:'SUP-TEST'}));assert.equal(f.queries.length,count);assert.equal(f.commits.length,w);
});
test('partial supplier payment retries, reference reuse and overpayments cannot duplicate postings',async()=>{
  const f=await procurementFixture(),b=await f.approvedBill([await f.receive(await f.approved())]);const body=request({BillId:b.BillId,Revision:b.Revision,Amount:'5.00',Method:'Bank transfer',Reference:'BANK-001',Confirmed:true});
  const first=await f.cashier.recordSupplierPayment(body),n=f.commits.length;assert.deepEqual(await f.cashier.recordSupplierPayment(body),{...first,replayed:true});assert.equal(f.commits.length,n);
  const current=await refreshBill(f,b);await reject(pay(f,current,{Reference:'bank-001'}),/already recorded/);await reject(pay(f,current,{Amount:'5.01'}),/outstanding/);await reject(pay(f,current,{Method:'Card'}),/disabled/);assert.equal(f.rows('SupplierPayments').length,1);assert.equal(ledger(f).length,2);
});
test('parallel payments cannot overspend the invoice or lose supplier balance updates',async()=>{
  const f=await procurementFixture(),b=await f.approvedBill([await f.receive(await f.approved())]);const result=await Promise.allSettled([pay(f,b,{Amount:'7.00'}),pay(f,b,{Amount:'7.00'})]);assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal((await refreshBill(f,b)).BalanceCents,300);assert.equal(f.rows('PharmacySuppliers')[0].OutstandingCents,300);
});
test('supplier returns and credit notes preserve stock history, bills and balanced corrections',async()=>{
  const f=await procurementFixture(),r=await f.receive(await f.approved()),b=await f.approvedBill([r]),receipt=f.rows('PharmacyReceipts')[0];
  const returned=await f.pharmacist.returnPharmacyPurchase(request({ReceiptId:r.ReceiptId,Revision:receipt.__updateTime,Quantity:2,Reference:'RETURN-1',Reason:'Unneeded sealed stock',Confirmed:true}));assert.equal(f.rows('MedicineBatches')[0].OnHand,3);assert.equal(f.rows('StockReceipts')[0].Quantity,5);assert.equal((await refreshBill(f,b)).BalanceCents,1000);
  const body=request({BillId:b.BillId,Revision:b.Revision,ReturnId:returned.ReturnId,Amount:'4.00',Reference:'CREDIT-1',Reason:'Supplier accepted return',Confirmed:true});await f.owner.creditSupplierBill(body);await f.owner.creditSupplierBill(body);assert.equal((await refreshBill(f,b)).BalanceCents,600);assert.equal(f.rows('SupplierCredits').length,1);assert.equal(f.rows('PharmacySuppliers')[0].OutstandingCents,600);
  const current=await refreshBill(f,b);await reject(f.owner.creditSupplierBill({...body,RequestId:crypto.randomUUID(),Revision:current.Revision,Reference:'CREDIT-2',Amount:'0.01'}),/already used/);assert.equal(ledger(f).at(-1).TotalCredit,4);
});
test('draft bill claims prevent changing their stock quantities until cancellation',async()=>{
  const f=await procurementFixture(),r=await f.receive(await f.approved());await f.bill([r]);const current=f.rows('PharmacyReceipts')[0];await reject(f.pharmacist.returnPharmacyPurchase(request({ReceiptId:r.ReceiptId,Revision:current.__updateTime,Quantity:1,Reference:'RETURN-1',Reason:'Returned',Confirmed:true})),/draft supplier bill/);assert.equal(f.rows('MedicineBatches')[0].OnHand,5);
});
test('actual payment reversals restore the liability and keep original payment values immutable',async()=>{
  const f=await procurementFixture(),b=await f.approvedBill([await f.receive(await f.approved())]);await pay(f,b,{Amount:'10.00',Reference:'PAY-REV'});const p=f.rows('SupplierPayments')[0],body=request({PaymentId:p.PaymentId,Revision:p.__updateTime,Amount:'4.00',Reference:'BANK-REFUND-1',Reason:'Confirmed bank refund',Confirmed:true});
  await f.owner.reverseSupplierPayment(body);await f.owner.reverseSupplierPayment(body);assert.equal(f.rows('SupplierPayments')[0].AmountCents,1000);assert.equal(f.rows('SupplierPayments')[0].ReversedCents,400);assert.equal((await refreshBill(f,b)).BalanceCents,400);assert.equal(f.rows('SupplierPaymentReversals').length,1);assert.equal(f.rows('PharmacySuppliers')[0].OutstandingCents,400);
  const payment=f.rows('SupplierPayments')[0];await reject(f.owner.reverseSupplierPayment({...body,RequestId:crypto.randomUUID(),Revision:payment.__updateTime,Amount:'7.00',Reference:'BANK-REFUND-2'}),/unreversed/);
});
test('closed accounting periods, missing mappings and wrong account types block financial posting without changing records',async()=>{
  for(const mode of ['closed','mapping','type']){const f=await procurementFixture(),b=await f.billTransition(await f.bill([await f.receive(await f.approved())]),'Submit',f.cashier);
    if(mode==='closed')f.store.set('accountingPeriods/closed',{StartDate:'2026-10-01',EndDate:'2026-10-31',Status:'Closed',__id:'closed'});
    if(mode==='mapping'){const [k,v]=[...f.store].find(([k])=>k.includes('hospitalBillingSettings/'));f.store.set(k,{...v,SupplierPayable:''});}
    if(mode==='type'){const v=f.store.get('chartOfAccounts/5005');f.store.set('chartOfAccounts/5005',{...v,Type:'Asset'});}
    const n=f.commits.length;await reject(f.billTransition(b,'Approve'),/closed|Configure|expense/);assert.equal(f.commits.length,n);assert.equal((await refreshBill(f,b)).Status,'Submitted');assert.equal(ledger(f).length,0);
  }
});
test('historical supplier and account snapshots survive supplier renaming and mapping changes',async()=>{
  const f=await procurementFixture(),p=await f.approved(),r=await f.receive(p),b=await f.approvedBill([r]),s=(await f.owner.pharmacySuppliers(request({Code:f.supplier.Code}))).items[0];
  await f.owner.savePharmacySupplier(request({SupplierId:s.SupplierId,Revision:s.Revision,Supplier:{...s,Name:'Renamed supplier'},Reason:'Official name change'}));assert.equal((await refreshBill(f,b)).Supplier.Name,'Synthetic supplier');assert.equal((await refreshPurchase(f,p)).Supplier.Name,'Synthetic supplier');
  const cfg=(await f.owner.billingSettings(request())).settings;f.store.set('chartOfAccounts/2101',{Code:'2101',Type:'Liability',Active:'YES',__id:'2101'});await f.owner.saveBillingSettings(request({Revision:cfg.Revision,Settings:{...cfg,SupplierPayable:'2101'}}));await pay(f,b);assert.ok(ledger(f).at(-1).Lines.some(l=>l.AccountCode==='2100'&&l.Debit===5));
});
test('fractional partial deliveries and cumulative returns exactly preserve the agreed purchase cents',async()=>{
  const f=await procurementFixture(),p=await f.approved({Lines:[{LineCode:'L1',CatalogId:f.item.CatalogId,CatalogRevision:f.item.Revision,Quantity:1,UnitCost:'0.01'}]});
  const a=await f.receive(p,{Quantity:'0.333',DeliveryReference:'A'}),b=await f.receive(await refreshPurchase(f,p),{Quantity:'0.333',DeliveryReference:'B'}),c=await f.receive(await refreshPurchase(f,p),{Quantity:'0.334',DeliveryReference:'C'});assert.equal(a.AmountCents+b.AmountCents+c.AmountCents,1);assert.equal(f.rows('MedicineBatches')[0].OnHand,1);
});
test('all procurement storage remains discoverable for backup, and indexed registers are date-bound',async()=>{
  const indexes=JSON.parse(await readFile(new URL('../firestore.hospital.indexes.json',import.meta.url),'utf8')).indexes;
  for(const name of ['PharmacySuppliers','PharmacyPurchases','PharmacyReceipts','PharmacySupplierReturns','SupplierBills','SupplierPayments','SupplierCredits','SupplierPaymentReversals','ProcurementEvents','ProcurementReferences'])assert.match(hospitalCollectionPath(env,name),new RegExp(`/hospital${name}$`));
  for(const name of ['PharmacyPurchases','PharmacyReceipts','PharmacySupplierReturns','SupplierBills','SupplierPayments'])assert.ok(indexes.some(i=>i.collectionGroup===`hospital${name}`&&i.fields.map(f=>f.fieldPath).join(',')==='BranchId,SupplierId,CreatedAt,__name__'));
});
test('supplier name aliases prevent accidental duplicate suppliers after renaming',async()=>{
  const f=await procurementFixture();await reject(f.owner.savePharmacySupplier(request({Supplier:{Code:'SUP-SECOND',Name:' SYNTHETIC SUPPLIER ',Active:true}})),/already belongs/);
  await f.owner.savePharmacySupplier(request({SupplierId:f.supplier.SupplierId,Revision:f.supplier.Revision,Supplier:{...f.supplier,Name:'New official supplier name'},Reason:'Legal name update'}));
  await reject(f.owner.savePharmacySupplier(request({Supplier:{Code:'SUP-SECOND',Name:'Synthetic supplier',Active:true}})),/already belongs/);assert.equal(f.rows('PharmacySuppliers').length,1);
});
test('supplier and dated purchase pagination keeps the 31-read/30-display bound and never scans another branch',async()=>{
  const f=await procurementFixture();for(let i=0;i<32;i++)await f.purchase({Reference:`PAGED-${i}`});
  const first=await f.owner.procurementRegister(request({Kind:'Purchases',DateRange:period,Status:'Draft',SupplierId:f.supplier.SupplierId}));assert.equal(first.rows.length,30);assert.ok(first.next);
  const second=await f.owner.procurementRegister(request({Kind:'Purchases',DateRange:period,Status:'Draft',SupplierId:f.supplier.SupplierId,Cursor:first.next}));assert.equal(second.rows.length,2);assert.equal(new Set([...first.rows,...second.rows].map(r=>r.PurchaseId)).size,32);assert.equal(second.next,null);
  const q=f.queries.at(-1);assert.equal(q.limit,31);assert.ok(q.filters.some(f=>f.field==='BranchId'&&f.value==='main'));await reject(f.owner.procurementRegister(request({Kind:'Purchases',DateRange:{fromDate:'2026-01-01',toDate:'2026-10-26'}})),/93 days/);
});
test('cancelled and closed purchase orders never accept deliveries; prior receipts remain',async()=>{
  const f=await procurementFixture(),p=await f.approved(),closed=await f.transition(p,'Close remaining');await reject(f.receive(closed),/open purchase/);
  const p2=await f.approved();await f.receive(p2);const p3=await refreshPurchase(f,p2);await reject(f.transition(p3,'Cancel'),/transition/);await f.transition(p3,'Close remaining');assert.equal(f.rows('PharmacyReceipts').length,1);assert.equal(f.rows('MedicineBatches')[0].OnHand,5);
});
test('unchanged purchase saves use just the operation and purchase lookups; invoice and payment notes are retained',async()=>{
  const f=await procurementFixture(),body=f.draftBody(),saved=await f.pharmacist.savePharmacyPurchase(body),p=await refreshPurchase(f,saved),n=f.reads.length;
  await f.pharmacist.savePharmacyPurchase({...body,RequestId:crypto.randomUUID(),PurchaseId:p.PurchaseId,Revision:p.Revision});assert.equal(f.reads.length-n,2);
  const bill=await f.approvedBill([await f.receive(await f.approved())]);await pay(f,bill,{Note:'Verified bank evidence'});assert.equal(f.rows('SupplierPayments')[0].Note,'Verified bank evidence');
});
test('cancelled invoices reopen against net returned quantities without inventing a replacement supplier reference',async()=>{
  const f=await procurementFixture(),r=await f.receive(await f.approved()),b=await f.bill([r]),cancelled=await f.billTransition(b,'Cancel',f.cashier),receipt=f.rows('PharmacyReceipts')[0];
  await f.pharmacist.returnPharmacyPurchase(request({ReceiptId:r.ReceiptId,Revision:receipt.__updateTime,Quantity:2,Reference:'RETURN-REOPEN',Reason:'Partial supplier return',Confirmed:true}));
  const draft=await f.billTransition(cancelled,'Reopen',f.cashier);assert.equal(draft.Reference,b.Reference);assert.equal(draft.ExpectedCents,600);assert.equal(draft.Lines[0].Quantity,3);await reject(f.billTransition(draft,'Submit',f.cashier),/Review the invoice total/);
  await f.cashier.saveSupplierBill(f.billBody([r],{BillId:draft.BillId,Revision:draft.Revision,Reference:draft.Reference,Amount:'6.00'}));const submitted=await f.billTransition(await refreshBill(f,b),'Submit',f.cashier);assert.equal((await f.billTransition(submitted,'Approve')).AmountCents,600);assert.equal(f.rows('SupplierBills').length,1);
});
