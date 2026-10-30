import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {procurementFixture,procurementActors,request,period,env} from './helpers/hospital-procurement-fixture.mjs';
import {createHospitalService} from '../functions/lib/hospital-service.js';
import {hospitalCollectionPath} from '../functions/lib/hospital-storage.js';
const ledger=f=>[...f.store].filter(([k])=>k.startsWith('accountingJournals/')).map(([,v])=>v);
const approved=async f=>f.approvedBill([await f.receive(await f.approved())]);
const fresh=(f,b)=>f.owner.supplierBill(request({BillId:b.BillId})).then(r=>r.bill);
const body=(f,bills,extra={})=>request({SupplierId:f.supplier.SupplierId,Amount:(bills.length*5).toFixed(2),Method:'Bank transfer',Reference:crypto.randomUUID(),Confirmed:true,Allocations:bills.map(b=>({BillId:b.BillId,Revision:b.Revision,Amount:'5.00'})),...extra});
const pay=(f,b,extra={})=>f.cashier.recordSupplierPayment(request({BillId:b.BillId,Revision:b.Revision,Amount:'1.00',Method:'Bank transfer',Reference:crypto.randomUUID(),Confirmed:true,...extra}));

test('twenty invoices settle atomically with bounded writes and two unique account lookups',async()=>{
  const f=await procurementFixture(),bills=[];for(let i=0;i<20;i++)bills.push(await approved(f));const before=f.reads.length;
  await f.cashier.recordSupplierRemittance(body(f,bills,{Amount:'200.00',Allocations:bills.map(b=>({BillId:b.BillId,Revision:b.Revision,Amount:'10.00'}))}));
  assert.equal(f.rows('SupplierBills').filter(b=>b.Status==='Settled').length,20);assert.equal(f.rows('PharmacySuppliers')[0].OutstandingCents,0);assert.ok(f.commits.at(-1).length<80);
  assert.equal(f.reads.slice(before).filter(([path])=>path==='chartOfAccounts').length,2);assert.equal(ledger(f).at(-1).TotalDebit,200);
});
test('bank evidence already recorded in another branch is rejected before invoice lookups',async()=>{
  const f=await procurementFixture(),b=await approved(f);await pay(f,b,{Reference:'BANK-CROSS-BRANCH'});
  const cashier=createHospitalService(env,{...procurementActors.cashier,assignedBranchIds:['main','north']},f.db),reads=f.reads.length;
  await assert.rejects(cashier.recordSupplierRemittance(body(f,[b],{BranchId:'north',Reference:'BANK-CROSS-BRANCH'})),/already recorded/);
  assert.equal(f.reads.slice(reads).filter(([path])=>path.endsWith('hospitalSupplierBills')).length,0);
});

test('one remittance pays multiple invoices with one journal, balance update and security audit, preserving patient and stock records',async()=>{
  const f=await procurementFixture(),bills=[await approved(f),await approved(f)],patients=structuredClone(f.rows('Patients')),stock=structuredClone(f.rows('MedicineBatches')),audits=f.rows('Audit').length,journals=ledger(f).length;
  const result=await f.cashier.recordSupplierRemittance(body(f,bills));assert.ok(result.RemittanceId);assert.equal(f.rows('SupplierRemittances').length,1);assert.equal(f.rows('SupplierPayments').length,2);
  assert.equal(ledger(f).length,journals+1);assert.equal(f.rows('Audit').length,audits+1);assert.equal(f.rows('PharmacySuppliers')[0].OutstandingCents,1000);
  for(const b of bills){const next=await fresh(f,b);assert.equal(next.PaidCents,500);assert.equal(next.BalanceCents,500);assert.equal(next.Status,'Part paid');assert.equal(next.AmountCents,b.AmountCents);}
  const last=ledger(f).at(-1);assert.equal(last.TotalDebit,10);assert.equal(last.TotalCredit,10);assert.equal(last.HospitalSupplierRemittanceId,result.RemittanceId);assert.equal(last.Lines.length,2);
  assert.deepEqual(f.rows('Patients'),patients);assert.deepEqual(f.rows('MedicineBatches'),stock);assert.equal(f.rows('ChargeEvents').length,0);
  assert.equal(f.commits.at(-1).filter(w=>w.collectionPath.endsWith('/hospitalPharmacySuppliers')).length,1);
});
test('lost response retries read only the receipt and never repeat invoices, journal or audit',async()=>{
  const f=await procurementFixture(),bills=[await approved(f),await approved(f)],input=body(f,bills),commit=f.db.batchCommitLiteralDocuments;let lost=true;
  f.db.batchCommitLiteralDocuments=async(...args)=>{await commit(...args);if(lost){lost=false;throw Error('Lost response');}};
  const lostService=createHospitalService(env,procurementActors.cashier,f.db);
  await assert.rejects(lostService.recordSupplierRemittance(input),/Lost response/);const writes=f.commits.length,reads=f.reads.length,queries=f.queries.length;
  assert.equal((await f.cashier.recordSupplierRemittance(input)).replayed,true);assert.equal(f.commits.length,writes);assert.equal(f.reads.length,reads+1);assert.equal(f.queries.length,queries);
  await assert.rejects(f.cashier.recordSupplierRemittance({...input,Note:'different body'}),/different information/);
});
test('single and multi-invoice payments share normalised reference guards in both directions',async()=>{
  for(const first of ['single','batch']){const f=await procurementFixture(),b=await approved(f);
    if(first==='single')await pay(f,b,{Reference:'BANK 001'});else await f.cashier.recordSupplierRemittance(body(f,[b],{Reference:'BANK 001'}));
    const current=await fresh(f,b),before=f.commits.length;
    await assert.rejects(first==='single'?f.cashier.recordSupplierRemittance(body(f,[current],{Reference:' bank 001 '})):pay(f,current,{Reference:' bank 001 '}),/already/);
    assert.equal(f.commits.length,before);
  }
});
test('invalid allocation batches fail entirely: mismatch, repeated bill, overpay, stale revision, unapproved and cross supplier or branch',async()=>{
  const f=await procurementFixture(),a=await approved(f),b=await approved(f),draft=await f.bill([await f.receive(await f.approved())]);
  const mutations=[x=>({...x,Amount:'9.99'}),x=>({...x,Confirmed:false}),x=>({...x,Allocations:[]}),x=>({...x,Allocations:Array(21).fill(x.Allocations[0])}),x=>({...x,Allocations:[x.Allocations[0],x.Allocations[0]]}),x=>({...x,Amount:'16.00',Allocations:[x.Allocations[0],{...x.Allocations[1],Amount:'11.00'}]}),x=>({...x,Allocations:[x.Allocations[0],{...x.Allocations[1],Revision:'old'}]}),x=>({...x,Allocations:[x.Allocations[0],{BillId:draft.BillId,Revision:draft.Revision,Amount:'5.00'}]}),x=>({...x,SupplierId:'another-supplier'}),x=>({...x,Method:'Card terminal'})];
  const before=structuredClone([...f.store]);for(const change of mutations)await assert.rejects(f.cashier.recordSupplierRemittance(change(body(f,[a,b]))));assert.deepEqual([...f.store],before);
  const path=hospitalCollectionPath(env,'SupplierBills')+'/'+b.BillId,original=f.store.get(path);f.store.set(path,{...original,BranchId:'north'});
  const unchanged=structuredClone([...f.store]);await assert.rejects(f.cashier.recordSupplierRemittance(body(f,[a,b])),/unavailable/);assert.deepEqual([...f.store],unchanged);
});
test('cashier alone can record, finance roles can view, unrelated modules, branches and read-only subscriptions cannot bypass checks',async()=>{
  const f=await procurementFixture(),b=await approved(f),input=body(f,[b]);
  for(const role of ['owner','manager','pharmacist','director','nurse','doctor','reception'])await assert.rejects(f[role].recordSupplierRemittance(input),e=>e.status===403);
  for(const changes of [{allowedSections:[]},{subscriptionReadOnly:true},{assignedBranchIds:['north']}])await assert.rejects(createHospitalService(env,{...procurementActors.cashier,...changes},f.db).recordSupplierRemittance(input),e=>e.status===403);
  const result=await f.cashier.recordSupplierRemittance(input);for(const role of ['owner','manager','cashier'])assert.ok((await f[role].supplierRemittance(request(result))).remittance);
  for(const role of ['pharmacist','director','nurse'])await assert.rejects(f[role].supplierRemittance(request(result)),e=>e.status===403);
});
test('competing batch and individual payments cannot lose balance updates or partially apply a batch',async()=>{
  const f=await procurementFixture(),bills=[await approved(f),await approved(f)],results=await Promise.allSettled([f.cashier.recordSupplierRemittance(body(f,bills)),pay(f,bills[0])]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
  const batchWon=results[0].status==='fulfilled';assert.equal(f.rows('SupplierPayments').length,batchWon?2:1);assert.equal((await fresh(f,bills[1])).PaidCents,batchWon?500:0);assert.equal(f.rows('PharmacySuppliers')[0].OutstandingCents,batchWon?1000:1900);
});
test('two payments with identical evidence cannot be committed even for different invoices concurrently',async()=>{
  const f=await procurementFixture(),a=await approved(f),b=await approved(f),results=await Promise.allSettled([f.cashier.recordSupplierRemittance(body(f,[a],{Reference:'SHARED'})),f.cashier.recordSupplierRemittance(body(f,[b],{Reference:'SHARED'}))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.rows('SupplierRemittances').length,1);assert.equal(f.rows('PharmacySuppliers')[0].OutstandingCents,1500);
});
test('reversals leave original remittance and allocation amounts immutable and appear in its history without audit duplication',async()=>{
  const f=await procurementFixture(),bills=[await approved(f),await approved(f)],saved=await f.cashier.recordSupplierRemittance(body(f,bills)),original=structuredClone(f.rows('SupplierRemittances')[0]),p=f.rows('SupplierPayments')[0],audits=f.rows('Audit').length;
  const reversal=request({PaymentId:p.PaymentId,Revision:p.__updateTime,Amount:'2.00',Reference:'REFUND-1',Reason:'Verified supplier refund',Confirmed:true});await f.owner.reverseSupplierPayment(reversal);await f.owner.reverseSupplierPayment(reversal);
  assert.deepEqual(f.rows('SupplierRemittances')[0],original);assert.equal(f.rows('Audit').length,audits+1);assert.equal(f.rows('SupplierPaymentReversals')[0].RemittanceId,saved.RemittanceId);
  const detail=await f.owner.supplierRemittance(request(saved));assert.equal(detail.remittance.AmountCents,1000);assert.equal(detail.remittance.ReversedCents,200);assert.equal(detail.remittance.NetPaidCents,800);
  assert.equal(f.rows('PharmacySuppliers')[0].OutstandingCents,1200);assert.equal(ledger(f).at(-1).HospitalSupplierRemittanceId,saved.RemittanceId);
  const history=await f.owner.procurementHistory(request({Kind:'Remittance',EntityId:saved.RemittanceId,DateRange:period}));assert.equal(history.rows.length,2);assert.ok(history.rows.some(r=>r.Action==='Reverse supplier remittance allocation'));
});
test('different saved liability mappings balance correctly and only unique accounts are read',async()=>{
  const f=await procurementFixture(),a=await approved(f),cfg=(await f.owner.billingSettings(request())).settings;f.store.set('chartOfAccounts/2101',{Code:'2101',Type:'Liability',Active:'YES',__id:'2101'});await f.owner.saveBillingSettings(request({Revision:cfg.Revision,Settings:{...cfg,SupplierPayable:'2101'}}));const b=await approved(f),before=f.reads.length;
  await f.cashier.recordSupplierRemittance(body(f,[a,b]));const last=ledger(f).at(-1);assert.equal(last.Lines.length,3);assert.equal(last.Lines.find(l=>l.AccountCode==='2100').Debit,5);assert.equal(last.Lines.find(l=>l.AccountCode==='2101').Debit,5);const accountReads=f.reads.slice(before).filter(([path])=>path==='chartOfAccounts');assert.equal(accountReads.length,3);
});
test('closed periods and invalid bank mapping block the whole remittance without financial writes',async()=>{
  for(const mode of ['closed','mapping']){const f=await procurementFixture(),b=await approved(f);if(mode==='closed')f.store.set('accountingPeriods/closed',{StartDate:'2026-10-01',EndDate:'2026-10-31',Status:'Closed',__id:'closed'});else{const [k,row]=[...f.store].find(([k])=>k.includes('/hospitalBillingSettings/'));f.store.set(k,{...row,Bank:''});}const before=structuredClone([...f.store]);await assert.rejects(f.cashier.recordSupplierRemittance(body(f,[b])),/closed|Configure/);assert.deepEqual([...f.store],before);}
});
test('date-first remittance registers and bounded details never scan invoices or write on read',async()=>{
  const f=await procurementFixture(),bills=[await approved(f),await approved(f)],saved=await f.cashier.recordSupplierRemittance(body(f,bills)),queries=f.queries.length,commits=f.commits.length;
  await assert.rejects(f.owner.procurementRegister(request({Kind:'Remittances'})),/date/i);assert.equal(f.queries.length,queries);
  const list=await f.owner.procurementRegister(request({Kind:'Remittances',DateRange:period,SupplierId:f.supplier.SupplierId}));assert.equal(list.rows.length,1);assert.equal(f.queries.at(-1).limit,31);assert.ok(f.queries.at(-1).filters.some(x=>x.field==='SupplierId'));
  const reads=f.reads.length,q=f.queries.length;await f.owner.supplierRemittance(request(saved));assert.equal(f.reads.length,reads+3);assert.equal(f.queries.length,q);assert.equal(f.commits.length,commits);
  assert.match(hospitalCollectionPath(env,'SupplierRemittances'),/hospitalSupplierRemittances$/);const indexes=JSON.parse(await readFile(new URL('../firestore.hospital.indexes.json',import.meta.url),'utf8')).indexes;assert.equal(indexes.filter(x=>x.collectionGroup==='hospitalSupplierRemittances').length,2);
});
