import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ordersFixture,actors} from './helpers/hospital-orders-fixture.mjs';
import {request,env,actor} from './helpers/hospital-fixture.mjs';
import {createHospitalService} from '../functions/lib/hospital-service.js';
import {hospitalCollectionPath} from '../functions/lib/hospital-storage.js';
const Item={Code:'LAB-TEST',Name:'Synthetic panel',Specimen:'Labelled sample',Preparation:'Recorded local preparation',Instructions:'Recorded local handling',Active:true};
const range={fromDate:'2026-10-26',toDate:'2026-10-26'};
async function catalog(f,changes={},Kind='Laboratory'){
  const worker=Kind==='Laboratory'?f.laboratory:f.imaging;
  const saved=await worker.saveInvestigationCatalogItem(request({Kind,Item:{...Item,...changes}}));
  return (await worker.investigationCatalog(request({Kind,IncludeInactive:true}))).items.find(row=>row.CatalogId===saved.CatalogId);
}
async function ordered(f,item){
  const c=await f.doctor.orderVisitContext(request(f.scope));
  return f.doctor.createOrder(request({...f.scope,Kind:item.Kind,VisitRevision:c.visit.Revision,CareRevision:c.care.Revision,ConfirmPatient:true,
    CatalogId:item.CatalogId,CatalogRevision:item.Revision,Investigation:{Service:item.Name,Specimen:item.Specimen,Indication:'Clinician entered indication',Priority:'Routine'}}));
}
async function handle(f,order,Decision,extra={}){
  const c=await f.laboratory.orderDetails(request(order));
  return f.laboratory.recordSpecimen(request({...order,Revision:c.order.Revision,ConfirmPatient:true,SpecimenLabel:c.order.LabelToPrint,Decision,Note:'Identity and specimen checked',...extra}));
}

test('catalogue permissions separate configuration from patient and clinical access',async()=>{
  const f=await ordersFixture();await catalog(f);
  await assert.rejects(f.imaging.investigationCatalog(request({Kind:'Laboratory'})),{status:403});
  await assert.rejects(f.pharmacist.investigationCatalog(request({Kind:'Laboratory'})),{status:403});
  await assert.rejects(f.doctor.saveInvestigationCatalogItem(request({Kind:'Laboratory',Item})),{status:403});
  assert.equal((await f.doctor.investigationCatalog(request({Kind:'Laboratory'}))).items.length,1);
  const admin=createHospitalService(env,{...actor,role:'Super Admin',allowedSections:['hospitalLaboratory']},f.db);
  await admin.saveInvestigationCatalogItem(request({Kind:'Laboratory',Item:{...Item,Code:'ADMIN'}}));
  await assert.rejects(admin.investigationCatalog(request({Kind:'Imaging'})),{status:403});
  await assert.rejects(admin.orderDetails(request(await f.create('Laboratory'))),{status:403});
  await assert.rejects(admin.clinicalContext(request(f.scope)),{status:403});
  await assert.rejects(f.laboratory.investigationCatalog(request({Kind:'Laboratory',BranchId:'north'})),{status:403});
  const foreign=createHospitalService({...env,DYNAMAX_WORKSPACE_ID:'another-hospital'},actors.laboratory,f.db);
  assert.equal((await foreign.investigationCatalog(request({Kind:'Laboratory'}))).items.length,0);
});

test('catalogue creation, edits and inactive services retain permanent codes and all versions',async()=>{
  const f=await ordersFixture(),item=await catalog(f);
  await assert.rejects(f.laboratory.saveInvestigationCatalogItem(request({Kind:'Laboratory',Item})),{status:409});
  await assert.rejects(f.laboratory.saveInvestigationCatalogItem(request({Kind:'Laboratory',CatalogId:item.CatalogId,Revision:item.Revision,Item:{...Item,Code:'OTHER'},Reason:'Different code'})),/cannot change/);
  await assert.rejects(f.laboratory.saveInvestigationCatalogItem(request({Kind:'Laboratory',CatalogId:item.CatalogId,Revision:item.Revision,Item:{...Item,Active:false}})),/Reason/);
  await f.laboratory.saveInvestigationCatalogItem(request({Kind:'Laboratory',CatalogId:item.CatalogId,Revision:item.Revision,Item:{...Item,Name:'Renamed panel',Active:false},Reason:'Temporarily unavailable'}));
  assert.equal((await f.doctor.investigationCatalog(request({Kind:'Laboratory'}))).items.length,0);
  assert.equal((await f.doctor.investigationCatalog(request({Kind:'Laboratory',IncludeInactive:true}))).items[0].Code,Item.Code);
  assert.equal(f.rows('InvestigationCatalogVersions').length,2);
  assert.equal(f.rows('InvestigationCatalogVersions')[0].Name,Item.Name);
});

test('catalogue retries and unchanged saves have bounded reads and no duplicate writes',async()=>{
  const f=await ordersFixture(),body=request({Kind:'Laboratory',Item});let reads=f.reads.length,writes=f.commits.length;
  const saved=await f.laboratory.saveInvestigationCatalogItem(body);
  assert.equal(f.reads.length-reads,2);assert.equal(f.commits.length-writes,1);assert.equal(f.commits.at(-1).length,4);
  reads=f.reads.length;writes=f.commits.length;assert.equal((await f.laboratory.saveInvestigationCatalogItem(body)).replayed,true);
  assert.equal(f.reads.length-reads,1);assert.equal(f.commits.length,writes);
  const item=(await f.doctor.investigationCatalog(request({Kind:'Laboratory'}))).items[0];reads=f.reads.length;
  assert.equal((await f.laboratory.saveInvestigationCatalogItem(request({Kind:'Laboratory',Item,CatalogId:saved.CatalogId,Revision:item.Revision}))).Unchanged,true);
  assert.equal(f.reads.length-reads,2);assert.equal(f.commits.length,writes);
  await assert.rejects(f.laboratory.saveInvestigationCatalogItem({...body,Item:{...Item,Name:'Changed retry'}}),{status:409});
});

test('concurrent catalogue creation and edits accept only one version atomically',async()=>{
  const f=await ordersFixture();const create=await Promise.allSettled([1,2].map(()=>f.laboratory.saveInvestigationCatalogItem(request({Kind:'Laboratory',Item}))));
  assert.equal(create.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.rows('InvestigationCatalogVersions').length,1);
  const item=(await f.doctor.investigationCatalog(request({Kind:'Laboratory'}))).items[0];
  const results=await Promise.allSettled(['First','Second'].map(Name=>f.laboratory.saveInvestigationCatalogItem(request({Kind:'Laboratory',Item:{...Item,Name},CatalogId:item.CatalogId,Revision:item.Revision,Reason:'Reviewed change'}))));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.rows('InvestigationCatalogVersions').length,2);
});

test('lost catalogue-save response can be replayed without another version',async()=>{
  const f=await ordersFixture(),body=request({Kind:'Laboratory',Item});let fail=true;
  const service=createHospitalService(env,actors.laboratory,{...f.db,batchCommitLiteralDocuments:async(...args)=>{await f.db.batchCommitLiteralDocuments(...args);if(fail){fail=false;throw Error('Lost response');}}});
  await assert.rejects(service.saveInvestigationCatalogItem(body),/Lost response/);const count=f.commits.length;
  assert.equal((await service.saveInvestigationCatalogItem(body)).replayed,true);assert.equal(f.commits.length,count);
  assert.equal(f.rows('InvestigationCatalogVersions').length,1);
});

test('signed orders snapshot catalogue instructions and survive renaming or deactivation',async()=>{
  const f=await ordersFixture(),item=await catalog(f),order=await ordered(f,item),before=structuredClone(f.rows('Orders')[0]);
  await f.laboratory.saveInvestigationCatalogItem(request({Kind:'Laboratory',CatalogId:item.CatalogId,Revision:item.Revision,Item:{...Item,Name:'Replacement name',Instructions:'New instructions',Active:false},Reason:'Changed service availability'}));
  const after=(await f.doctor.orderDetails(request(order))).order;
  assert.deepEqual(after.CatalogSnapshot,before.CatalogSnapshot);assert.equal(after.Fields.Service,Item.Name);
  await assert.rejects(ordered(f,item),/unavailable/);
  assert.equal(f.rows('Patients').length,1);assert.equal(f.rows('Invoices').length,0);assert.equal(f.rows('ChargeEvents').length,0);
});

test('new catalogue orders reject stale versions and altered service or specimen fields',async()=>{
  const f=await ordersFixture(),item=await catalog(f);
  await assert.rejects(ordered(f,{...item,Revision:'outdated'}),/changed/);
  await assert.rejects(ordered(f,{...item,Name:'Changed service'}),/changed/);
  await assert.rejects(ordered(f,{...item,Specimen:'Changed specimen'}),/changed/);
  await assert.rejects(ordered(f,{...item,Kind:'Imaging'}),/unavailable/);
  assert.equal(f.rows('Orders').length,0);
});

test('catalogue paging reads only one bounded branch/type query and requires no audit writes',async()=>{
  const f=await ordersFixture();for(let i=0;i<33;i++)await catalog(f,{Code:`TEST-${i}`});
  let reads=f.reads.length,queries=f.queries.length,commits=f.commits.length;
  const first=await f.doctor.investigationCatalog(request({Kind:'Laboratory',Query:'synthetic'}));
  assert.equal(first.items.length,30);assert.ok(first.next);assert.equal(f.reads.length,reads);assert.equal(f.queries.length-queries,1);assert.equal(f.commits.length,commits);
  assert.equal(f.queries.at(-1).limit,31);assert.ok(f.queries.at(-1).filters.some(f=>f.field==='BranchId'&&f.value==='main'));
  const next=await f.doctor.investigationCatalog(request({Kind:'Laboratory',Query:'synthetic',Cursor:first.next}));
  assert.equal(next.items.length,3);assert.equal(new Set([...first.items,...next.items].map(row=>row.CatalogId)).size,33);
});

test('catalogue history requires dates and preserves saved versions in backups and indexes',async()=>{
  const f=await ordersFixture(),item=await catalog(f),queries=f.queries.length;
  await assert.rejects(f.laboratory.investigationCatalogHistory(request({CatalogId:item.CatalogId})),/dates/);assert.equal(f.queries.length,queries);
  const history=await f.laboratory.investigationCatalogHistory(request({CatalogId:item.CatalogId,DateRange:range}));assert.equal(history.versions.length,1);
  for(const name of ['InvestigationCatalog','InvestigationCatalogVersions'])assert.match(hospitalCollectionPath(env,name),/test-hospital/);
  const indexes=JSON.parse(await readFile(new URL('../firestore.hospital.indexes.json',import.meta.url),'utf8'));
  for(const name of ['hospitalInvestigationCatalog','hospitalInvestigationCatalogVersions'])assert.ok(indexes.indexes.some(row=>row.collectionGroup===name));
});

test('new laboratory orders require receipt and retain each rejected/recollected specimen',async()=>{
  const f=await ordersFixture(),order=await f.create('Laboratory');await handle(f,order,'Collected');
  const first=structuredClone(f.rows('Orders')[0].CurrentSpecimen);assert.match(first.Label,/-S01$/);
  await assert.rejects(f.laboratory.recordInvestigationReport(await f.body(order,{Text:'Unreceived result'},f.laboratory)),/receive/);
  await handle(f,order,'Rejected');await handle(f,order,'Collected');const second=f.rows('Orders')[0].CurrentSpecimen;
  assert.match(second.Label,/-S02$/);assert.notEqual(first.Label,second.Label);
  await assert.rejects(handle(f,order,'Received',{SpecimenLabel:first.Label}),/label/);
  await handle(f,order,'Received');const r=await f.laboratory.recordInvestigationReport(await f.body(order,{Text:'Verified specimen findings'},f.laboratory));
  assert.equal(f.rows('InvestigationReports').find(row=>row.ReportId===r.ReportId).SpecimenSnapshot.Label,second.Label);
  assert.equal(f.rows('OrderEvents').filter(row=>row.Specimen?.Label===first.Label).length,2);
  assert.equal(f.rows('ChargeEvents').length,0);assert.equal(f.rows('StockMovements').length,0);
});

test('specimen states prevent fresh duplicate clicks as well as exact retries',async()=>{
  const f=await ordersFixture(),order=await f.create('Laboratory');await assert.rejects(handle(f,order,'Received'),/collection/);
  await handle(f,order,'Collected');await assert.rejects(handle(f,order,'Collected'),/already recorded/);
  const c=await f.laboratory.orderDetails(request(order)),body=request({...order,Revision:c.order.Revision,ConfirmPatient:true,SpecimenLabel:c.order.LabelToPrint,Decision:'Received',Note:'Received intact'});
  let reads=f.reads.length,commits=f.commits.length;
  await f.laboratory.recordSpecimen(body);assert.equal(f.reads.length-reads,5);assert.equal(f.commits.length-commits,1);assert.equal(f.commits.at(-1).length,4);
  reads=f.reads.length;commits=f.commits.length;assert.equal((await f.laboratory.recordSpecimen(body)).replayed,true);assert.equal(f.reads.length-reads,1);assert.equal(f.commits.length,commits);
  await assert.rejects(handle(f,order,'Received'),/twice/);assert.equal(f.commits.length,commits+1,'only explicit details access audit was added');
});

test('concurrent specimen receipt and rejection cannot overwrite one another',async()=>{
  const f=await ordersFixture(),order=await f.create('Laboratory');await handle(f,order,'Collected');const c=await f.laboratory.orderDetails(request(order));
  const results=await Promise.allSettled(['Received','Rejected'].map(Decision=>f.laboratory.recordSpecimen(request({...order,Revision:c.order.Revision,ConfirmPatient:true,SpecimenLabel:c.order.LabelToPrint,Decision,Note:'Reviewed specimen'}))));
  assert.equal(results.filter(row=>row.status==='fulfilled').length,1);assert.equal(f.rows('OrderEvents').filter(row=>row.Specimen).length,2);
});

test('specimen handling checks patient confirmation, branch, permissions and actual time',async()=>{
  const f=await ordersFixture(),order=await f.create('Laboratory');
  await assert.rejects(handle(f,order,'Collected',{ConfirmPatient:false}),/Confirm/);
  await assert.rejects(handle(f,order,'Collected',{OccurredAt:'2027-01-01T12:00:00Z'}),/handling time/);
  await assert.rejects(handle(f,order,'Collected',{OccurredAt:'2026-01-01T12:00:00Z'}),/handling time/);
  await assert.rejects(handle(f,order,'Collected',{Note:''}),/Note/);
  await assert.rejects(f.doctor.recordSpecimen(request(order)),{status:403});
  assert.equal(f.rows('Orders')[0].SpecimenSequence,0);
});

test('recollection cannot be recorded before the previous specimen was rejected',async()=>{
  const f=await ordersFixture(),order=await f.create('Laboratory');
  f.db.now=()=>new Date('2026-10-26T12:03:00Z');
  await handle(f,order,'Collected',{OccurredAt:'2026-10-26T12:01:00Z'});
  await handle(f,order,'Rejected',{OccurredAt:'2026-10-26T12:02:00Z'});
  await assert.rejects(handle(f,order,'Collected',{OccurredAt:'2026-10-26T12:01:30Z'}),/handling time/);
  assert.equal(f.rows('Orders')[0].CurrentSpecimen.Status,'Rejected');
  await handle(f,order,'Collected',{OccurredAt:'2026-10-26T12:02:30Z'});
  assert.equal(f.rows('Orders')[0].CurrentSpecimen.Sequence,2);
});

test('earlier laboratory orders retain their original collection and report workflow',async()=>{
  const f=await ordersFixture(),order=await f.create('Laboratory'),path=`${hospitalCollectionPath(env,'Orders')}/${order.OrderId}`;
  const old=f.store.get(path);delete old.SpecimenWorkflow;delete old.SpecimenSequence;
  await handle(f,order,'Collected');assert.equal(f.rows('Orders')[0].SpecimenLabel,old.OrderNumber);
  await f.laboratory.recordInvestigationReport(await f.body(order,{Text:'Earlier workflow report'},f.laboratory));
  assert.equal(f.rows('InvestigationReports')[0].Text,'Earlier workflow report');assert.equal(f.rows('Orders')[0].SpecimenWorkflow,undefined);
});

test('read-only subscriptions cannot save catalogues or specimen handling',async()=>{
  const f=await ordersFixture(),order=await f.create('Laboratory'),readonly=createHospitalService(env,{...actors.laboratory,subscriptionReadOnly:true},f.db);
  await assert.rejects(readonly.saveInvestigationCatalogItem(request({Kind:'Laboratory',Item})),{status:403});
  await assert.rejects(readonly.recordSpecimen(request({...order,ConfirmPatient:true,Note:'Read only',Decision:'Collected'})),{status:403});
  assert.equal(f.rows('InvestigationCatalog').length,0);
});
