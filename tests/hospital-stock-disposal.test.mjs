import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {disposalFixture,env,request,createHospitalService,stockOwner,actors} from './helpers/hospital-stock-disposal-fixture.mjs';

const period={fromDate:'2026-10-26',toDate:'2026-10-26'};
const path=name=>`hospitalWorkspaces/test-hospital/hospital${name}`;
const protectedRecords=f=>structuredClone(['Patients','Visits','StockReceipts','Dispenses','MedicineReturns','ChargeEvents','PharmacyReceipts','SupplierBills','SupplierPayments','SupplierRemittances','Invoices','Payments','Journals'].flatMap(name=>f.rows(name)));

test('independently witnessed disposal reduces quarantine only and preserves originals',async()=>{
  const f=await disposalFixture(),original=structuredClone(f.batch()),protectedBefore=protectedRecords(f),movements=structuredClone(f.rows('StockMovements'));
  const body=f.proposal(),{DisposalId}=await f.pharmacist.submitStockDisposal(body),submitted=structuredClone(f.rows('StockDisposals')[0]);
  assert.equal(f.batch().Quarantined,8);assert.equal(f.batch().OnHand,12);assert.equal(f.rows('StockMovements').length,movements.length);
  await f.owner.reviewStockDisposal(await f.review(DisposalId));assert.equal(f.batch().Quarantined,5);assert.equal(f.batch().OnHand,12);
  const disposal=f.rows('StockDisposals')[0];assert.equal(disposal.Status,'Approved');assert.equal(disposal.Witnessed,true);assert.equal(disposal.DecidedBy,stockOwner.username);
  for(const key of ['Reference','Quantity','DisposedAt','Method','Reason','Evidence','Before','SubmittedBy','SubmittedByName','CreatedAt','BatchRevision'])assert.deepEqual(disposal[key],submitted[key]);
  for(const key of ['Medicine','MedicineKey','UnitPriceCents','ExpiryDate','CreatedAt'])assert.equal(f.batch()[key],original[key]);
  assert.deepEqual(protectedRecords(f),protectedBefore);assert.deepEqual(f.rows('StockMovements').slice(0,movements.length),movements);
  const movement=f.rows('StockMovements').at(-1);assert.equal(movement.DisposalId,DisposalId);assert.equal(movement.Quantity,0);assert.equal(movement.QuarantinedQuantity,-3);assert.deepEqual(movement.After,{OnHand:12,Quarantined:5});assert.equal(f.rows('StockDisposalEvents').length,2);
});

test('disposal permissions enforce role, enabled module, subscription and branch boundaries',async()=>{
  const f=await disposalFixture(),{DisposalId}=await f.submit();
  for(const user of [actors.doctor,actors.laboratory,{...stockOwner,allowedSections:[]},{...stockOwner,role:'Hospital Cashier'},{...stockOwner,role:'Nurse'}]){
    const service=createHospitalService(env,user,f.db);await assert.rejects(service.stockDisposalQueue(request()),e=>e.status===403);await assert.rejects(service.submitStockDisposal(f.proposal()),e=>e.status===403);
  }
  await assert.rejects(f.owner.submitStockDisposal(f.proposal()),e=>e.status===403);
  const readOnly=createHospitalService(env,{...actors.pharmacist,subscriptionReadOnly:true},f.db);assert.equal((await readOnly.stockDisposalQueue(request())).disposals.length,1);await assert.rejects(readOnly.submitStockDisposal(f.proposal()),e=>e.status===403);
  const readOnlyOwner=createHospitalService(env,{...stockOwner,subscriptionReadOnly:true},f.db);await assert.rejects(readOnlyOwner.reviewStockDisposal(await f.review(DisposalId)),e=>e.status===403);
  const broad=createHospitalService(env,{...stockOwner,assignedBranchIds:['main','north']},f.db);
  for(const action of ['stockDisposalDetails','stockDisposalHistory'])await assert.rejects(broad[action](request({BranchId:'north',DisposalId,DateRange:period})),e=>e.status===404);
  assert.equal((await broad.stockDisposalQueue(request({BranchId:'north'}))).disposals.length,0);
  await assert.rejects(broad.reviewStockDisposal(await f.review(DisposalId,'Approve',{BranchId:'north'})),e=>e.status===404);
  const broadPharmacist=createHospitalService(env,{...actors.pharmacist,assignedBranchIds:['main','north']},f.db);await assert.rejects(broadPharmacist.submitStockDisposal(f.proposal({BranchId:'north'})),e=>e.status===404);
});

test('submitter cannot witness or reject own disposal, including a Super Admin account',async()=>{
  const f=await disposalFixture(),{DisposalId}=await f.submit();
  const elevated=createHospitalService(env,{...actors.pharmacist,role:'Super Admin'},f.db);
  for(const service of [f.pharmacist,elevated])for(const Decision of ['Approve','Reject'])await assert.rejects(service.reviewStockDisposal(await f.review(DisposalId,Decision)),e=>e.status===403);
  const second=createHospitalService(env,{...actors.pharmacist,username:'second-pharmacist'},f.db);await assert.rejects(second.reviewStockDisposal(await f.review(DisposalId,'Cancel')),e=>e.status===403);
  await f.pharmacist.reviewStockDisposal(await f.review(DisposalId,'Cancel'));assert.equal(f.batch().Quarantined,8);assert.equal(f.rows('StockDisposalGuards')[0].PendingDisposalId,'');
});

test('witness attestation and independent evidence are required to deduct stock',async()=>{
  const f=await disposalFixture(),{DisposalId}=await f.submit();
  for(const extra of [{Witnessed:false},{Witnessed:'true'},{Confirmed:false},{Evidence:''},{Reason:''}])await assert.rejects(f.owner.reviewStockDisposal(await f.review(DisposalId,'Approve',extra)));
  assert.equal(f.batch().Quarantined,8);assert.equal(f.rows('StockDisposals')[0].Status,'Pending');
});

test('rejecting or cancelling keeps stock and immutable submission evidence intact',async()=>{
  for(const Decision of ['Reject','Cancel']){
    const f=await disposalFixture(),{DisposalId}=await f.submit(),before=structuredClone(f.batch()),first=structuredClone(f.rows('StockDisposalEvents')[0]);
    await (Decision==='Cancel'?f.pharmacist:f.owner).reviewStockDisposal(await f.review(DisposalId,Decision,{Evidence:''}));
    assert.deepEqual(f.batch(),before);assert.deepEqual(f.rows('StockDisposalEvents')[0],first);assert.equal(f.rows('StockMovements').length,2);
    const replacement=await f.submit();assert.notEqual(replacement.DisposalId,DisposalId);assert.equal(f.rows('StockDisposals').length,2);
  }
});

test('only one pending disposal per batch survives concurrent submissions',async()=>{
  const f=await disposalFixture(),results=await Promise.allSettled([f.submit(),f.submit()]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.rows('StockDisposals').length,1);assert.equal(f.rows('StockDisposalEvents').length,1);
  await assert.rejects(f.submit(),/pending disposal/);assert.equal(f.batch().Quarantined,8);
});

test('permanent references and lost-response retries never create duplicate disposal records',async()=>{
  const f=await disposalFixture(),body=f.proposal(),{DisposalId}=await f.pharmacist.submitStockDisposal(body),before=f.commits.length;
  let reads=f.reads.length;assert.equal((await f.pharmacist.submitStockDisposal(body)).replayed,true);assert.equal(f.reads.length-reads,1);assert.equal(f.commits.length,before);
  reads=f.reads.length;assert.equal((await f.pharmacist.submitStockDisposal({...body,RequestId:crypto.randomUUID()})).Unchanged,true);assert.equal(f.reads.length-reads,2);assert.equal(f.commits.length,before);
  assert.equal((await f.pharmacist.submitStockDisposal({...body,RequestId:crypto.randomUUID(),Reference:' '+body.Reference.toUpperCase()+' '})).DisposalId,DisposalId);
  await assert.rejects(f.pharmacist.submitStockDisposal({...body,RequestId:crypto.randomUUID(),Quantity:2}),/reference already exists/);
  await assert.rejects(f.pharmacist.submitStockDisposal({...body,Quantity:2}),/request reference/);
});

test('lost approval response, exact request retry and fresh identical review write once',async()=>{
  const f=await disposalFixture(),{DisposalId}=await f.submit(),body=await f.review(DisposalId);let lost=true;
  const service=createHospitalService(env,stockOwner,{...f.db,batchCommitLiteralDocuments:async(...args)=>{await f.db.batchCommitLiteralDocuments(...args);if(lost){lost=false;throw Object.assign(Error('lost response'),{status:503});}}});
  await assert.rejects(service.reviewStockDisposal(body),/lost response/);const count=f.commits.length,reads=f.reads.length;
  assert.equal((await service.reviewStockDisposal(body)).replayed,true);assert.equal(f.reads.length-reads,1);assert.equal(f.commits.length,count);
  const secondReads=f.reads.length;assert.equal((await service.reviewStockDisposal({...body,RequestId:crypto.randomUUID()})).Unchanged,true);assert.equal(f.reads.length-secondReads,2);assert.equal(f.commits.length,count);
  assert.equal(f.batch().Quarantined,5);assert.equal(f.rows('StockMovements').filter(r=>r.DisposalId===DisposalId).length,1);assert.equal(f.rows('Audit').filter(r=>r.Action==='Approve quarantined pharmacy disposal').length,1);
});

test('different concurrent witnesses cannot deduct the same disposal twice',async()=>{
  const f=await disposalFixture(),{DisposalId}=await f.submit(),body=await f.review(DisposalId),second=createHospitalService(env,{...stockOwner,username:'second-witness'},f.db);
  const results=await Promise.allSettled([f.owner.reviewStockDisposal(body),second.reviewStockDisposal({...body,RequestId:crypto.randomUUID()})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.batch().Quarantined,5);assert.equal(f.rows('StockDisposalEvents').length,2);
});

test('concurrent approval and cancellation retain exactly one final decision',async()=>{
  const f=await disposalFixture(),{DisposalId}=await f.submit(),approve=await f.review(DisposalId),cancel=await f.review(DisposalId,'Cancel');
  const results=await Promise.allSettled([f.owner.reviewStockDisposal(approve),f.pharmacist.reviewStockDisposal(cancel)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const row=f.rows('StockDisposals')[0];assert.equal(f.batch().Quarantined,row.Status==='Approved'?5:8);assert.equal(f.rows('StockDisposalEvents').length,2);assert.equal(f.rows('StockDisposalGuards')[0].PendingDisposalId,'');
});

test('subsequent receipt or quarantine movement blocks stale approval but permits rejection',async()=>{
  for(const mutation of ['receipt','quarantine']){
    const f=await disposalFixture(),{DisposalId}=await f.submit();
    if(mutation==='receipt')await f.receive({Quantity:2});else await f.pharmacist.quarantineStock(request({BatchId:f.batch().BatchId,Revision:f.batch().__updateTime,Quantity:1,Reason:'Separate quarantined addition'}));
    const before=structuredClone(f.batch());assert.equal((await f.owner.stockDisposalDetails(request({DisposalId}))).Stale,true);await assert.rejects(f.owner.reviewStockDisposal(await f.review(DisposalId)),e=>e.status===409);assert.deepEqual(f.batch(),before);
    await f.owner.reviewStockDisposal(await f.review(DisposalId,'Reject'));assert.deepEqual(f.batch(),before);
  }
});

test('physical counts and disposal decisions serialize on the batch revision',async()=>{
  const f=await disposalFixture(),{DisposalId}=await f.submit();
  const {CountId}=await f.pharmacist.submitStockCount(request({BatchId:f.batch().BatchId,BatchRevision:f.batch().__updateTime,Reference:'COUNT-DISPOSAL-CONFLICT',CountedAt:'2026-10-26T12:00:00Z',OnHand:12,Quarantined:7,Reason:'Separate physical count',Confirmed:true}));
  const count=(await f.owner.stockCountDetails(request({CountId}))).count;
  await f.owner.reviewStockCount(request({CountId,Revision:count.Revision,Decision:'Approve',Reason:'Count confirmed independently',Confirmed:true}));
  await assert.rejects(f.owner.reviewStockDisposal(await f.review(DisposalId)),e=>e.status===409);assert.equal(f.batch().Quarantined,7);
});

test('disposal makes an earlier pending physical count stale',async()=>{
  const f=await disposalFixture(),{CountId}=await f.pharmacist.submitStockCount(request({BatchId:f.batch().BatchId,BatchRevision:f.batch().__updateTime,Reference:'COUNT-BEFORE-DISPOSAL',CountedAt:'2026-10-26T12:00:00Z',OnHand:12,Quarantined:8,Reason:'Count evidence',Confirmed:true}));
  const {DisposalId}=await f.submit();await f.owner.reviewStockDisposal(await f.review(DisposalId));const count=(await f.owner.stockCountDetails(request({CountId}))).count;
  await assert.rejects(f.owner.reviewStockCount(request({CountId,Revision:count.Revision,Decision:'Approve',Reason:'Count checked',Confirmed:true})),e=>e.status===409);assert.equal(f.batch().Quarantined,5);
});

test('actual dispensing and patient return remain usable while disposal is pending',async()=>{
  const f=await disposalFixture(),order=await f.create();await f.pharmacist.reviewPrescription(await f.body(order,{Decision:'Approved',Reason:'Reviewed prescription'}));
  const {DispenseId}=await f.pharmacist.dispensePrescription(await f.body(order,{BatchId:f.batch().BatchId,BatchRevision:f.batch().__updateTime,Quantity:2}));
  const {DisposalId}=await f.submit();const original=f.rows('Dispenses').find(r=>r.DispenseId===DispenseId);
  await f.pharmacist.returnDispensedMedicine(await f.body(order,{DispenseId,DispenseRevision:original.__updateTime,Quantity:1,Reason:'Unused patient return'}));
  const before=protectedRecords(f);await assert.rejects(f.owner.reviewStockDisposal(await f.review(DisposalId)),e=>e.status===409);assert.deepEqual(protectedRecords(f),before);assert.equal(f.batch().Quarantined,9);assert.equal(f.batch().OnHand,10);
});

test('disposal validates quantity, physical time, revision and retained evidence',async()=>{
  const f=await disposalFixture();
  for(const Quantity of [0,-1,'',null,{},'Infinity',1000001,'0.0001','1e3',9])await assert.rejects(f.submit({Quantity}));
  for(const DisposedAt of ['', '2026-02-30T12:00:00Z','2026-10-26T13:00:00Z','2026-10-25T12:00:00Z','2026-10-26T12:00:00'])await assert.rejects(f.submit({DisposedAt}));
  for(const extra of [{Reference:''},{Reason:''},{Method:''},{Evidence:''},{Confirmed:false},{Confirmed:'true'},{BatchRevision:'stale'}])await assert.rejects(f.submit(extra));
  assert.equal(f.rows('StockDisposals').length,0);
  const {DisposalId}=await f.submit({Quantity:'0.125'});await f.owner.reviewStockDisposal(await f.review(DisposalId));assert.equal(f.batch().Quarantined,7.875);assert.equal(f.rows('StockMovements').at(-1).QuarantinedQuantity,-0.125);
});

test('full quarantine disposal reaches zero without changing expired stock identity or shelf quantity',async()=>{
  const f=await disposalFixture(),old=f.batch();f.store.set(`${path('MedicineBatches')}/${old.BatchId}`,{...old,ExpiryDate:'2026-10-25'});
  const {DisposalId}=await f.submit({Quantity:8});await f.owner.reviewStockDisposal(await f.review(DisposalId));assert.equal(f.batch().Quarantined,0);assert.equal(f.batch().OnHand,12);assert.equal(f.batch().ExpiryDate,'2026-10-25');await assert.rejects(f.submit({Quantity:1}),/exceeds/);
});

test('closed permanent references cannot resurrect a disposal or acquire a different decision',async()=>{
  const f=await disposalFixture(),body=f.proposal(),{DisposalId}=await f.pharmacist.submitStockDisposal(body);await f.pharmacist.reviewStockDisposal(await f.review(DisposalId,'Cancel'));
  const count=f.commits.length,result=await f.pharmacist.submitStockDisposal({...body,RequestId:crypto.randomUUID()});assert.equal(result.Unchanged,true);assert.equal(result.Status,'Cancelled');assert.equal(f.commits.length,count);
  await assert.rejects(f.owner.reviewStockDisposal(await f.review(DisposalId)),/already been decided/);assert.equal(f.rows('StockDisposals').length,1);
});

test('pending queue is date-independent, bounded, branch-filtered and read-only',async()=>{
  const f=await disposalFixture(),{DisposalId}=await f.submit(),row=f.rows('StockDisposals')[0];
  for(let i=0;i<31;i++){const key=`pending-${String(i).padStart(2,'0')}`;f.store.set(`${path('StockDisposals')}/${key}`,{...row,DisposalId:key,CreatedAt:'2020-01-01T00:00:00Z',__id:key});}
  f.store.set(`${path('StockDisposals')}/other-branch`,{...row,DisposalId:'other-branch',BranchId:'north',__id:'other-branch'});
  f.store.set(`${path('StockDisposals')}/closed`,{...row,DisposalId:'closed',Status:'Approved',__id:'closed'});
  const commits=f.commits.length,reads=f.reads.length;const first=await f.owner.stockDisposalQueue(request());assert.equal(first.disposals.length,30);assert.ok(first.next);const second=await f.owner.stockDisposalQueue(request({Cursor:first.next}));assert.equal(second.disposals.length,2);assert.ok(second.disposals.some(r=>r.DisposalId===DisposalId));assert.equal(second.next,null);
  assert.equal(f.commits.length,commits);assert.equal(f.reads.length,reads);assert.equal(f.queries.at(-1).limit,31);assert.deepEqual(f.queries.at(-1).filters,[{field:'BranchId',op:'==',value:'main'},{field:'Status',op:'==',value:'Pending'}]);
});

test('dated register and retained event history require bounded dates and no audit writes',async()=>{
  const f=await disposalFixture(),{DisposalId}=await f.submit();await f.owner.reviewStockDisposal(await f.review(DisposalId));
  for(const action of ['stockDisposalRegister','stockDisposalHistory']){
    await assert.rejects(f.owner[action](request({DisposalId})),/date/i);await assert.rejects(f.owner[action](request({DisposalId,DateRange:{fromDate:'2025-01-01',toDate:'2027-01-01'}})),/93 days/);
  }
  await assert.rejects(f.owner.stockDisposalRegister(request({DateRange:period,Status:'Invalid'})),/status/);
  const before=f.commits.length;const register=await f.owner.stockDisposalRegister(request({DateRange:period,Status:'Approved'}));assert.equal(register.disposals[0].DisposalId,DisposalId);assert.equal((await f.owner.stockDisposalHistory(request({DisposalId,DateRange:period}))).events.length,2);assert.equal(f.queries.at(-1).limit,31);assert.equal(f.commits.length,before);
});

test('submission and witnessed completion use fixed exact budgets and no history scans',async()=>{
  const f=await disposalFixture();let reads=f.reads.length,queries=f.queries.length;const {DisposalId}=await f.submit();assert.equal(f.reads.length-reads,4);assert.equal(f.commits.at(-1).length,5);assert.equal(f.queries.length,queries);
  const review=await f.review(DisposalId);reads=f.reads.length;await f.owner.reviewStockDisposal(review);assert.equal(f.reads.length-reads,4);assert.equal(f.commits.at(-1).length,7);assert.equal(f.queries.length,queries);
  for(const commit of f.commits.slice(-2))for(const write of commit)assert.ok(!/hospital(?:Invoices|Payments|ChargeEvents|SupplierBills|SupplierPayments)|[Jj]ournal|[Nn]otification/.test(write.collectionPath));
});

test('backend dispatcher, backup discovery and additive indexes include every disposal workflow',async()=>{
  const {HOSPITAL_COLLECTIONS}=await import('../functions/lib/hospital-storage.js');for(const name of ['StockDisposals','StockDisposalEvents','StockDisposalGuards'])assert.ok(HOSPITAL_COLLECTIONS.includes(name));
  const [api,backup,indexText]=await Promise.all(['../functions/api/staff-hospital.js','../functions/lib/organization-backup.js','../firestore.hospital.indexes.json'].map(file=>readFile(new URL(file,import.meta.url),'utf8')));
  for(const action of ['stockDisposalQueue','stockDisposalRegister','stockDisposalDetails','stockDisposalHistory','submitStockDisposal','reviewStockDisposal'])assert.ok(api.includes(`'${action}'`));assert.match(backup,/HOSPITAL_COLLECTIONS/);
  const indexes=JSON.parse(indexText).indexes;
  for(const [collectionGroup,fields] of [['hospitalStockDisposals',['BranchId','CreatedAt','__name__']],['hospitalStockDisposals',['BranchId','Status','CreatedAt','__name__']],['hospitalStockDisposalEvents',['BranchId','DisposalId','CreatedAt','__name__']]])assert.ok(indexes.some(i=>i.collectionGroup===collectionGroup&&JSON.stringify(i.fields.map(f=>f.fieldPath))===JSON.stringify(fields)));
});

test('physical disposal timestamps respect timezone, calendar and subsecond future boundaries',async()=>{
  const f=await disposalFixture();
  for(const DisposedAt of ['2026-10-26T12:00:00.001Z','2026-10-26T13:00:00.001+01:00','2026-10-26T12:60:00Z','2026-10-26T12:00:60Z','2026-10-25T24:00:00Z','2026-10-26T12:00:00+00:99','2026-13-01T12:00:00Z'])await assert.rejects(f.submit({DisposedAt}));
  const {DisposalId}=await f.submit({DisposedAt:'2026-10-26T13:00:00+01:00'});assert.equal(f.rows('StockDisposals')[0].DisposedAt,'2026-10-26T13:00:00+01:00');await f.owner.reviewStockDisposal(await f.review(DisposalId));assert.equal(f.batch().Quarantined,5);
});

test('a concurrent identical request returns one permanent disposal and one submission audit',async()=>{
  const f=await disposalFixture(),body=f.proposal(),results=await Promise.all([f.pharmacist.submitStockDisposal(body),f.pharmacist.submitStockDisposal(body)]);
  assert.equal(results[0].DisposalId,results[1].DisposalId);assert.equal(f.rows('StockDisposals').length,1);assert.equal(f.rows('StockDisposalEvents').length,1);assert.equal(f.rows('Audit').filter(r=>r.Action==='Submit quarantined pharmacy disposal').length,1);
});

test('reject and cancel fresh identical decisions are no-ops while changed evidence conflicts',async()=>{
  for(const Decision of ['Reject','Cancel']){
    const f=await disposalFixture(),{DisposalId}=await f.submit(),service=Decision==='Cancel'?f.pharmacist:f.owner,body=await f.review(DisposalId,Decision);
    let reads=f.reads.length;await service.reviewStockDisposal(body);assert.equal(f.reads.length-reads,3);assert.equal(f.commits.at(-1).length,5);
    const count=f.commits.length;reads=f.reads.length;assert.equal((await service.reviewStockDisposal({...body,RequestId:crypto.randomUUID()})).Unchanged,true);assert.equal(f.reads.length-reads,2);assert.equal(f.commits.length,count);
    await assert.rejects(service.reviewStockDisposal({...body,RequestId:crypto.randomUUID(),Evidence:'Different evidence'}),/already been decided/);assert.equal(f.batch().Quarantined,8);
  }
});
