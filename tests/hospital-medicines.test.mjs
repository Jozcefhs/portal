import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ordersFixture,actors,medicine,rx} from './helpers/hospital-orders-fixture.mjs';
import {request,env,actor} from './helpers/hospital-fixture.mjs';
import {createHospitalService} from '../functions/lib/hospital-service.js';
import {hospitalCollectionPath} from '../functions/lib/hospital-storage.js';
const Item={Code:'MED-TEST',...medicine,HandlingNotes:'Local storage instructions',Active:true};
const DateRange={fromDate:'2026-10-26',toDate:'2026-10-26'};
async function catalog(f,changes={}){
  const saved=await f.pharmacist.saveMedicineCatalogItem(request({Item:{...Item,...changes}}));
  return (await f.pharmacist.medicineCatalog(request({IncludeInactive:true}))).items.find(row=>row.CatalogId===saved.CatalogId);
}
async function ordered(f,item,extra={}){
  const c=await f.doctor.orderVisitContext(request(f.scope));
  return f.doctor.createOrder(request({...f.scope,Kind:'Prescription',VisitRevision:c.visit.Revision,CareRevision:c.care.Revision,ConfirmPatient:true,
    Prescription:rx,MedicineCatalogId:item.CatalogId,MedicineCatalogRevision:item.Revision,...extra}));
}
const receipt=(item,extra={})=>request({MedicineCatalogId:item.CatalogId,MedicineCatalogRevision:item.Revision,
  Stock:{...medicine,Quantity:20,BatchNumber:'CAT-LOT',ExpiryDate:'2027-12-31',Supplier:'Synthetic supplier',ReceiptReference:'CAT-RECEIPT',LineReference:'1',UnitPrice:'12.50'},...extra});
const edit=(item,changes={},extra={})=>request({CatalogId:item.CatalogId,Revision:item.Revision,Item:{...Item,...changes},Reason:'Reviewed local catalogue',...extra});

test('medicine catalogue permissions separate administration, prescribing and dispensing',async()=>{
  const f=await ordersFixture();await catalog(f);
  for(const service of [f.service,f.laboratory,f.imaging])await assert.rejects(service.medicineCatalog(request()),{status:403});
  assert.equal((await f.doctor.medicineCatalog(request())).items.length,1);
  await assert.rejects(f.doctor.saveMedicineCatalogItem(request({Item})),{status:403});
  for(const role of ['Super Admin','Hospital Administrator','Medical Director']){
    const admin=createHospitalService(env,{...actor,role,allowedSections:['hospitalPharmacy']},f.db);
    assert.equal((await admin.medicineCatalog(request())).items.length,1);
    await assert.rejects(admin.receiveMedicine(receipt({})),{status:403});
    await assert.rejects(admin.listOrders(request({Kind:'Prescription',DateRange})),{status:403});
    await assert.rejects(admin.clinicalContext(request(f.scope)),{status:403});
    assert.ok((await admin.state()).capabilities.includes('pharmacy.configure'));
  }
  const disabled=createHospitalService(env,{...actors.pharmacist,allowedSections:[]},f.db);
  await assert.rejects(disabled.medicineCatalog(request()),{status:403});
});
test('catalogues are isolated by workspace and assigned branch',async()=>{
  const f=await ordersFixture(),item=await catalog(f);
  await assert.rejects(f.pharmacist.medicineCatalog(request({BranchId:'north'})),{status:403});
  const north=createHospitalService(env,{...actors.pharmacist,assignedBranchIds:['north']},f.db);
  assert.equal((await north.medicineCatalog(request({BranchId:'north'}))).items.length,0);
  await assert.rejects(north.medicineCatalogHistory(request({CatalogId:item.CatalogId,DateRange,BranchId:'north'})),{status:404});
  const foreign=createHospitalService({...env,DYNAMAX_WORKSPACE_ID:'another-hospital'},actors.pharmacist,f.db);
  assert.equal((await foreign.medicineCatalog(request())).items.length,0);
});
test('catalogue codes and medicine identity are immutable; versions retain notes and availability',async()=>{
  const f=await ordersFixture(),item=await catalog(f);
  for(const name of ['Code',...Object.keys(medicine)])await assert.rejects(f.pharmacist.saveMedicineCatalogItem(edit(item,{[name]:'Different'})),{status:409});
  await assert.rejects(f.pharmacist.saveMedicineCatalogItem(edit(item,{Active:false},{Reason:''})),/Reason/);
  await f.pharmacist.saveMedicineCatalogItem(edit(item,{Active:false,HandlingNotes:'Revised notes'}));
  assert.equal((await f.pharmacist.medicineCatalog(request())).items.length,0);
  assert.equal((await f.pharmacist.medicineCatalog(request({IncludeInactive:true}))).items.length,1);
  const versions=(await f.doctor.medicineCatalogHistory(request({CatalogId:item.CatalogId,DateRange}))).versions;
  assert.equal(versions.length,2);assert.ok(versions.some(row=>row.HandlingNotes===Item.HandlingNotes&&row.Active));
});
test('same code or normalized medicine definition cannot create duplicate catalogue records',async()=>{
  const f=await ordersFixture();await catalog(f);
  await assert.rejects(f.pharmacist.saveMedicineCatalogItem(request({Item})),/already exists/);
  await assert.rejects(f.pharmacist.saveMedicineCatalogItem(request({Item:{...Item,Code:'OTHER',Medicine:'  SYNTHETIC   MEDICINE  '}})),/already have/);
  assert.equal(f.rows('MedicineCatalog').length,1);assert.equal(f.rows('MedicineCatalogIdentities').length,1);
});
test('concurrent catalogue creations and edits leave one current record and intact history',async()=>{
  const f=await ordersFixture();
  const created=await Promise.allSettled(['ONE','TWO'].map(Code=>f.pharmacist.saveMedicineCatalogItem(request({Item:{...Item,Code}}))));
  assert.equal(created.filter(r=>r.status==='fulfilled').length,1);
  const item=(await f.pharmacist.medicineCatalog(request())).items[0];
  const edited=await Promise.allSettled(['First','Second'].map(HandlingNotes=>f.pharmacist.saveMedicineCatalogItem(edit(item,{Code:item.Code,HandlingNotes}))));
  assert.equal(edited.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.rows('MedicineCatalogVersions').length,2);
});
test('creation, edit, no-op and retry have bounded reads and atomic writes',async()=>{
  const f=await ordersFixture(),body=request({Item});let reads=f.reads.length,commits=f.commits.length;
  await f.pharmacist.saveMedicineCatalogItem(body);
  assert.equal(f.reads.length-reads,3);assert.equal(f.commits.length-commits,1);assert.equal(f.commits.at(-1).length,5);
  reads=f.reads.length;commits=f.commits.length;assert.equal((await f.pharmacist.saveMedicineCatalogItem(body)).replayed,true);
  assert.equal(f.reads.length-reads,1);assert.equal(f.commits.length,commits);
  const item=(await f.pharmacist.medicineCatalog(request())).items[0];
  reads=f.reads.length;commits=f.commits.length;assert.equal((await f.pharmacist.saveMedicineCatalogItem(edit(item))).Unchanged,true);
  assert.equal(f.reads.length-reads,2);assert.equal(f.commits.length,commits);
  reads=f.reads.length;await f.pharmacist.saveMedicineCatalogItem(edit(item,{HandlingNotes:'Updated'}));
  assert.equal(f.reads.length-reads,2);assert.equal(f.commits.at(-1).length,4);
});
test('lost catalogue response replays one receipt without another version',async()=>{
  const f=await ordersFixture(),body=request({Item});let fail=true;
  const service=createHospitalService(env,actors.pharmacist,{...f.db,batchCommitLiteralDocuments:async(...args)=>{await f.db.batchCommitLiteralDocuments(...args);if(fail){fail=false;throw Error('Lost response');}}});
  await assert.rejects(service.saveMedicineCatalogItem(body),/Lost response/);
  const count=f.commits.length;assert.equal((await service.saveMedicineCatalogItem(body)).replayed,true);
  assert.equal(f.commits.length,count);assert.equal(f.rows('MedicineCatalogVersions').length,1);
});
test('catalogue paging is bounded, cached by clients and performs no access-audit writes',async()=>{
  const f=await ordersFixture();for(let i=0;i<33;i++)await catalog(f,{Code:`MED-${i}`,Strength:`Strength ${i}`});
  const reads=f.reads.length,queries=f.queries.length,commits=f.commits.length;
  const first=await f.doctor.medicineCatalog(request({Query:'synthetic'}));
  assert.equal(first.items.length,30);assert.ok(first.next);assert.equal(f.reads.length,reads);assert.equal(f.queries.length-queries,1);assert.equal(f.commits.length,commits);
  assert.equal(f.queries.at(-1).limit,31);assert.ok(f.queries.at(-1).filters.some(f=>f.field==='BranchId'&&f.value==='main'));
  const second=await f.doctor.medicineCatalog(request({Query:'synthetic',Cursor:first.next}));
  assert.equal(new Set([...first.items,...second.items].map(row=>row.CatalogId)).size,33);
});
test('medicine history requires dates and includes new collections in backup and indexes',async()=>{
  const f=await ordersFixture(),item=await catalog(f),queries=f.queries.length;
  await assert.rejects(f.pharmacist.medicineCatalogHistory(request({CatalogId:item.CatalogId})),/dates/);assert.equal(f.queries.length,queries);
  for(const name of ['MedicineCatalog','MedicineCatalogVersions','MedicineCatalogIdentities'])assert.match(hospitalCollectionPath(env,name),/test-hospital/);
  const indexes=JSON.parse(await readFile(new URL('../firestore.hospital.indexes.json',import.meta.url),'utf8'));
  for(const name of ['hospitalMedicineCatalog','hospitalMedicineCatalogVersions'])assert.ok(indexes.indexes.some(row=>row.collectionGroup===name));
});
test('prescriptions and receipts keep snapshots after catalogue edits without changing existing stock or charges',async()=>{
  const f=await ordersFixture(),item=await catalog(f),order=await ordered(f,item);
  await f.pharmacist.receiveMedicine(receipt(item));
  const originals=['Patients','Visits','Orders','MedicineBatches','StockReceipts','StockMovements'].map(name=>[name,structuredClone(f.rows(name))]);
  await f.pharmacist.saveMedicineCatalogItem(edit(item,{HandlingNotes:'Different instructions',Active:false}));
  for(const [name,rows] of originals)assert.deepEqual(f.rows(name),rows,name);
  assert.equal((await f.doctor.orderDetails(request(order))).order.MedicineCatalogSnapshot.HandlingNotes,Item.HandlingNotes);
  assert.equal(f.rows('StockReceipts')[0].MedicineCatalogSnapshot.VersionId,item.VersionId);
  assert.equal(f.rows('ChargeEvents').length,0);assert.equal(f.rows('Invoices').length,0);
  await assert.rejects(ordered(f,item),/unavailable/);await assert.rejects(f.pharmacist.receiveMedicine(receipt(item)),/unavailable/);
});
test('stale catalogue revisions and altered medicine identities cannot be prescribed or received',async()=>{
  const f=await ordersFixture(),item=await catalog(f);
  await assert.rejects(ordered(f,{...item,Revision:'old'}),/changed/);
  for(const name of Object.keys(medicine))await assert.rejects(ordered(f,item,{Prescription:{...rx,[name]:'Different'}}),/details differ/);
  await assert.rejects(f.pharmacist.receiveMedicine(receipt({...item,Revision:'old'})),/changed/);
  await assert.rejects(f.pharmacist.receiveMedicine(receipt(item,{Stock:{...receipt(item).Stock,Unit:'bottle'}})),/details differ/);
  assert.equal(f.rows('Orders').length,0);assert.equal(f.rows('MedicineBatches').length,0);
});
test('catalogue-linked issue/receipt adds one exact read; receipt retries preserve stock balance',async()=>{
  const f=await ordersFixture(),item=await catalog(f),c=await f.doctor.orderVisitContext(request(f.scope));
  const body=request({...f.scope,Kind:'Prescription',VisitRevision:c.visit.Revision,CareRevision:c.care.Revision,ConfirmPatient:true,Prescription:rx,MedicineCatalogId:item.CatalogId,MedicineCatalogRevision:item.Revision});
  let reads=f.reads.length;await f.doctor.createOrder(body);assert.equal(f.reads.length-reads,5);assert.equal(f.commits.at(-1).length,6);
  reads=f.reads.length;const stock=receipt(item);await f.pharmacist.receiveMedicine(stock);assert.equal(f.reads.length-reads,4);assert.equal(f.commits.at(-1).length,5);
  let commits=f.commits.length;reads=f.reads.length;assert.equal((await f.pharmacist.receiveMedicine(stock)).replayed,true);
  assert.equal(f.reads.length-reads,1);assert.equal(f.commits.length,commits);assert.equal(f.rows('MedicineBatches')[0].OnHand,20);
  await assert.rejects(f.pharmacist.receiveMedicine({...stock,RequestId:crypto.randomUUID()}),/already been recorded/);
});
test('legacy manual prescriptions and batches continue to work with catalogue stock',async()=>{
  const f=await ordersFixture(),order=await f.create(),item=await catalog(f);
  await f.pharmacist.receiveMedicine(receipt(item));
  await f.pharmacist.reviewPrescription(await f.body(order,{Decision:'Approved',Reason:'Reviewed'}));
  const batch=(await f.pharmacist.stockBatches(request({OrderId:order.OrderId,PatientId:order.PatientId}))).batches[0];
  await f.pharmacist.dispensePrescription(await f.body(order,{BatchId:batch.BatchId,BatchRevision:batch.Revision,Quantity:2}));
  assert.equal(f.rows('MedicineBatches')[0].OnHand,18);assert.equal(f.rows('Dispenses').length,1);assert.equal(f.rows('ChargeEvents').length,1);
});
test('read-only subscriptions cannot change the catalogue; malformed inputs do not query records',async()=>{
  const f=await ordersFixture(),service=createHospitalService(env,{...actors.pharmacist,subscriptionReadOnly:true},f.db);
  await assert.rejects(service.saveMedicineCatalogItem(request({Item})),{status:403});
  const count=f.reads.length;
  for(const changes of [{Code:'bad code'},{Medicine:''},{Strength:42},{Active:'yes'},{HandlingNotes:'x'.repeat(2001)}])await assert.rejects(f.pharmacist.saveMedicineCatalogItem(request({Item:{...Item,...changes}})));
  assert.equal(f.reads.length,count);assert.equal(f.rows('MedicineCatalog').length,0);
});
