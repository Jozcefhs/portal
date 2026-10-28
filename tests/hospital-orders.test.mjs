import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ordersFixture,actors,medicine,rx} from './helpers/hospital-orders-fixture.mjs';
import {env,actor,request} from './helpers/hospital-fixture.mjs';
import {createHospitalService} from '../functions/lib/hospital-service.js';
import {hospitalCollectionPath} from '../functions/lib/hospital-storage.js';
import {quantity,money,chargeCents,cumulativeCredit} from '../functions/lib/hospital-orders-model.js';
const range={fromDate:'2026-10-26',toDate:'2026-10-26'};
const approve=async(f,order)=>f.pharmacist.reviewPrescription(await f.body(order,{Decision:'Approved',Reason:'Patient and prescription reviewed'}));
const stock=async(f,order)=>(await f.pharmacist.stockBatches(request(order))).batches[0];
const dispense=async(f,order,Quantity=4)=>{const b=await stock(f,order);return f.pharmacist.dispensePrescription(await f.body(order,{Quantity,BatchId:b.BatchId,BatchRevision:b.Revision}));};

test('clinical orders enforce role, module, branch, patient and edition boundaries',async()=>{
  const f=await ordersFixture(),order=await f.create();
  for(const user of [actor,{...actors.doctor,role:'Super Admin'},{...actors.doctor,role:'Hospital Cashier'}, {...actors.doctor,allowedSections:['hospitalPatients']}]){
    await assert.rejects(createHospitalService(env,user,f.db).orderDetails(request(order)),{status:403});
  }
  await assert.rejects(f.laboratory.orderDetails(request(order)),{status:403});
  const lab=await f.create('Laboratory');await assert.rejects(f.pharmacist.orderDetails(request(lab)),{status:403});
  await assert.rejects(f.doctor.orderDetails(request({...order,BranchId:'north'})),{status:403});
  await assert.rejects(f.doctor.orderDetails(request({...order,PatientId:'another-patient'})),{status:409});
  await assert.rejects(createHospitalService({...env,DYNAMAX_WORKSPACE_ID:'different-hospital'},actors.doctor,f.db).orderDetails(request(order)),{status:404});
  await assert.rejects(f.pharmacist.clinicalContext(request(f.scope)),{status:403});
});

test('issuing a prescription snapshots authorised instructions and allergies, preserving records on retries',async()=>{
  const f=await ordersFixture(),c=await f.doctor.orderVisitContext(request(f.scope));
  const body=request({...f.scope,Kind:'Prescription',Prescription:rx,VisitRevision:c.visit.Revision,CareRevision:c.care.Revision,ConfirmPatient:true});
  await assert.rejects(f.doctor.createOrder({...body,ConfirmPatient:false}));
  const order=await f.doctor.createOrder(body),count=f.commits.length;
  assert.equal((await f.doctor.createOrder(body)).replayed,true);assert.equal(f.commits.length,count);
  assert.equal(f.rows('Orders').length,1);assert.equal(f.rows('Orders')[0].Fields.Dose,rx.Dose);assert.equal(f.rows('Orders')[0].AllergySnapshot.Status,'Unknown');
  await assert.rejects(f.doctor.createOrder({...body,Prescription:{...rx,Dose:'Changed'}}),{status:409});
  assert.equal(f.rows('Patients').length,1);assert.equal(f.rows('Visits').length,1);
  assert.ok(!JSON.stringify(f.rows('Audit')).includes(rx.Dose));
  assert.equal((await f.pharmacist.orderDetails(request(order))).care.AllergyStatus,'Unknown');
});

test('pharmacy approval, stock and charges commit together with partial and full dispensing',async()=>{
  const f=await ordersFixture(),order=await f.create();await f.receive();
  await assert.rejects(dispense(f,order),/approve/);await approve(f,order);
  const first=await dispense(f,order,4),c=await f.pharmacist.orderDetails(request(order));
  assert.equal(c.order.Status,'Partially dispensed');assert.equal(c.order.DispensedQuantity,4);assert.deepEqual(c.order.Fields,{...rx,Instructions:'',MedicineKey:c.order.Fields.MedicineKey});
  assert.equal((await stock(f,order)).OnHand,16);assert.equal(f.rows('ChargeEvents')[0].AmountCents,5000);
  await dispense(f,order,6);assert.equal((await f.pharmacist.orderDetails(request(order))).order.Status,'Dispensed');
  await assert.rejects(dispense(f,order,1),/approve/);assert.equal(f.rows('Dispenses').length,2);
  assert.equal(f.rows('StockMovements').filter(r=>r.Type==='Dispense').length,2);assert.ok(first.DispenseId);
});

test('stock receipts deduplicate by supplier invoice line, and returns quarantine rather than replenishing usable stock',async()=>{
  const f=await ordersFixture(),order=await f.create(),ReceiptReference='INVOICE-TEST';await f.receive({ReceiptReference});
  await assert.rejects(f.receive({ReceiptReference}),/already been recorded/);await approve(f,order);const disp=await dispense(f,order,10);
  const original=f.rows('Dispenses')[0],body=await f.body(order,{DispenseId:disp.DispenseId,DispenseRevision:original.__updateTime,Quantity:3,Reason:'Patient returned unopened quantity'});
  await f.pharmacist.returnDispensedMedicine(body);const counts=[f.rows('MedicineReturns').length,f.rows('ChargeEvents').length];
  assert.equal((await f.pharmacist.returnDispensedMedicine(body)).replayed,true);assert.deepEqual([f.rows('MedicineReturns').length,f.rows('ChargeEvents').length],counts);
  const batch=await stock(f,order);assert.equal(batch.OnHand,10);assert.equal(batch.Quarantined,3);
  const saved=f.rows('Dispenses')[0];assert.equal(saved.Quantity,original.Quantity);assert.equal(saved.AmountCents,original.AmountCents);assert.equal(saved.ReturnedQuantity,3);
  assert.equal(f.rows('ChargeEvents').at(-1).AmountCents,-3750);assert.equal(f.rows('Orders')[0].Status,'Dispensed');
  await assert.rejects(f.pharmacist.returnDispensedMedicine(await f.body(order,{DispenseId:disp.DispenseId,DispenseRevision:saved.__updateTime,Quantity:8,Reason:'Too many'})),/exceeds/);
});

test('expired, mismatched, short-stock and stale batches cannot be dispensed',async()=>{
  const f=await ordersFixture(),order=await f.create();await f.receive({Quantity:2});await approve(f,order);
  await assert.rejects(dispense(f,order,3),/exceeds/);
  const mismatch=await f.receive({Strength:'Different strength'}),other=f.rows('MedicineBatches').find(r=>r.BatchId===mismatch.BatchId);
  await assert.rejects(f.pharmacist.dispensePrescription(await f.body(order,{Quantity:1,BatchId:other.BatchId,BatchRevision:other.__updateTime})),/matching medicine/);
  const b=await stock(f,order);await assert.rejects(f.pharmacist.dispensePrescription(await f.body(order,{Quantity:1,BatchId:b.BatchId,BatchRevision:'stale'})),{status:409});
  const future=createHospitalService(env,actors.pharmacist,{...f.db,now:()=>new Date('2028-01-01T12:00:00Z')});
  await assert.rejects(future.dispensePrescription(await f.body(order,{Quantity:1,BatchId:b.BatchId,BatchRevision:b.Revision})),/Expired/);
  assert.equal(f.rows('Dispenses').length,0);assert.equal(f.rows('ChargeEvents').length,0);
});

test('changed allergy information requires a new pharmacy review; concurrent saves cannot oversell',async()=>{
  const f=await ordersFixture(),order=await f.create();await f.receive({Quantity:5});await approve(f,order);
  const c=await f.doctor.clinicalContext(request(f.scope));
  await f.doctor.recordTriage(request({...f.scope,VisitRevision:c.visit.Revision,EncounterRevision:c.encounter?.Revision||'',CareRevision:c.care.Revision,
    Triage:{Complaint:'New observation',Urgency:'Routine',AllergyStatus:'Known allergies',Allergies:'Recorded allergy',Vitals:{}}}));
  await assert.rejects(dispense(f,order,3),/Allergy information changed/);await approve(f,order);
  const b=await stock(f,order),one=await f.body(order,{Quantity:3,BatchId:b.BatchId,BatchRevision:b.Revision});
  const outcomes=await Promise.allSettled([f.pharmacist.dispensePrescription(one),f.pharmacist.dispensePrescription({...one,RequestId:crypto.randomUUID()})]);
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.rows('Dispenses').length,1);assert.equal((await stock(f,order)).OnHand,2);
});

test('lost dispensing responses retry without duplicate stock movements, charges or audit entries',async()=>{
  const f=await ordersFixture(),order=await f.create();await f.receive();await approve(f,order);
  const b=await stock(f,order),body=await f.body(order,{Quantity:2,BatchId:b.BatchId,BatchRevision:b.Revision});
  const original=f.db.batchCommitLiteralDocuments;let lose=true;
  const service=createHospitalService(env,actors.pharmacist,{...f.db,batchCommitLiteralDocuments:async(...args)=>{await original(...args);if(lose){lose=false;throw Error('Lost response');}}});
  await assert.rejects(service.dispensePrescription(body),/Lost response/);const count=f.commits.length;
  assert.equal((await service.dispensePrescription(body)).replayed,true);assert.equal(f.commits.length,count);assert.equal(f.rows('ChargeEvents').length,1);
});

test('laboratory specimens must match patient/order and draft reports cannot be released without independent verification',async()=>{
  const f=await ordersFixture(),order=await f.create('Laboratory');
  await assert.rejects(f.laboratory.recordInvestigationReport(await f.body(order,{Text:'Synthetic result'},f.laboratory)),/Collect/);
  const c=await f.laboratory.orderDetails(request(order));
  await assert.rejects(f.laboratory.recordSpecimen(await f.body(order,{SpecimenLabel:'WRONG',Decision:'Collected',Note:'Collected'},f.laboratory)),/label/);
  await f.laboratory.recordSpecimen(await f.body(order,{SpecimenLabel:c.order.LabelToPrint,Decision:'Collected',Note:'Identity and label checked'},f.laboratory));
  await f.laboratory.recordSpecimen(await f.body(order,{SpecimenLabel:c.order.LabelToPrint,Decision:'Received',Note:'Received and identity checked'},f.laboratory));
  const report=await f.laboratory.recordInvestigationReport(await f.body(order,{Text:'Synthetic result',Critical:false},f.laboratory));
  const doctorView=await f.doctor.orderDetails(request(order));assert.equal(doctorView.latestReport,null);assert.equal(doctorView.releasedReport,null);
  await assert.rejects(f.laboratory.releaseInvestigationReport(await f.body(order,{ReportId:report.ReportId},f.laboratory)),/Verify/);
  await assert.rejects(f.laboratory.verifyInvestigationReport(await f.body(order,{ReportId:report.ReportId},f.laboratory)),{status:403});
  await f.verifier.verifyInvestigationReport(await f.body(order,{ReportId:report.ReportId},f.verifier));
  const body=await f.body(order,{ReportId:report.ReportId},f.verifier);await f.verifier.releaseInvestigationReport(body);
  assert.equal((await f.verifier.releaseInvestigationReport(body)).replayed,true);
  assert.equal((await f.doctor.orderDetails(request(order))).releasedReport.Text,'Synthetic result');
});

test('critical imaging reports retain amendments and require communication plus clinician acknowledgement',async()=>{
  const f=await ordersFixture(),order=await f.create('Imaging');
  const report=await f.imaging.recordInvestigationReport(await f.body(order,{Text:'Synthetic critical report',Critical:true},f.imaging));
  await f.imagingVerifier.verifyInvestigationReport(await f.body(order,{ReportId:report.ReportId},f.imagingVerifier));
  await assert.rejects(f.imagingVerifier.releaseInvestigationReport(await f.body(order,{ReportId:report.ReportId},f.imagingVerifier)),/Communication/);
  await f.imagingVerifier.releaseInvestigationReport(await f.body(order,{ReportId:report.ReportId,Communication:'Contacted attending clinician by phone'},f.imagingVerifier));
  assert.equal(f.rows('Orders')[0].CriticalNeedsAcknowledgement,true);
  await f.doctor.acknowledgeCriticalResult(await f.body(order,{ReportId:report.ReportId,Note:'Reviewed and follow-up documented'},f.doctor));
  assert.equal(f.rows('Orders')[0].CriticalNeedsAcknowledgement,false);
  const original=structuredClone(f.rows('InvestigationReports')[0]);
  await assert.rejects(f.imaging.recordInvestigationReport(await f.body(order,{Text:'Correction'},f.imaging)),/why/);
  const correction=await f.imaging.recordInvestigationReport(await f.body(order,{Text:'Corrected report',Reason:'Corrected transcription',Critical:false},f.imaging));
  assert.deepEqual(f.rows('InvestigationReports')[0],original);assert.equal((await f.doctor.orderDetails(request(order))).releasedReport.ReportId,report.ReportId);
  await f.imagingVerifier.verifyInvestigationReport(await f.body(order,{ReportId:correction.ReportId},f.imagingVerifier));
  await f.imagingVerifier.releaseInvestigationReport(await f.body(order,{ReportId:correction.ReportId},f.imagingVerifier));
  assert.equal((await f.doctor.orderDetails(request(order))).releasedReport.Text,'Corrected report');
  assert.equal(f.rows('InvestigationReports').length,2);assert.equal(f.rows('InvestigationReports')[1].PreviousReportId,report.ReportId);
  const history=await f.doctor.releasedReportHistory(request({...order,DateRange:range}));assert.equal(history.reports.length,2);
  assert.deepEqual(new Set(history.reports.map(row=>row.Text)),new Set(['Synthetic critical report','Corrected report']));
  assert.equal(history.reports.find(row=>row.ReportId===correction.ReportId).PreviousReleasedReportId,report.ReportId);
});

test('cancellation preserves partial dispensing and historical records; read-only access never writes',async()=>{
  const f=await ordersFixture(),order=await f.create();await f.receive();await approve(f,order);await dispense(f,order,2);
  await f.doctor.cancelOrder(await f.body(order,{Reason:'Treatment plan changed'},f.doctor));
  await assert.rejects(dispense(f,order,1),/cancelled/);assert.equal(f.rows('Orders')[0].DispensedQuantity,2);assert.equal(f.rows('Dispenses').length,1);
  const readOnly=createHospitalService(env,{...actors.pharmacist,subscriptionReadOnly:true},f.db);
  await assert.rejects(readOnly.receiveMedicine(request({Stock:{...medicine,Quantity:1,BatchNumber:'OTHER',ExpiryDate:'2028-01-01',Supplier:'Example',ReceiptReference:'Other',LineReference:'1',UnitPrice:'1'}})),{status:403});
  assert.equal((await readOnly.orderDetails(request(order))).order.Status,'Cancelled');
});

test('date-first order registers paginate without broad reads, while exact medicine lookup remains bounded',async()=>{
  const f=await ordersFixture();f.queries.length=0;
  await f.doctor.state();assert.equal(f.queries.length,0);
  await assert.rejects(f.doctor.listOrders(request({Kind:'Prescription'})),/Choose valid/);assert.equal(f.queries.length,0);
  for(let i=0;i<32;i++)await f.create();
  const first=await f.doctor.listOrders(request({Kind:'Prescription',DateRange:range}));
  const second=await f.doctor.listOrders(request({Kind:'Prescription',DateRange:range,Cursor:first.next}));
  assert.equal(first.orders.length,30);assert.equal(second.orders.length,2);assert.equal(new Set([...first.orders,...second.orders].map(r=>r.OrderId)).size,32);
  assert.ok(f.queries.every(q=>q.limit===31&&q.filters.some(x=>x.field==='BranchId')&&q.filters.some(x=>x.field==='CreatedAt')));
});

test('prescribing and investigation roles cannot fulfil each other’s work; invalid quantities cannot alter stock',async()=>{
  const f=await ordersFixture(),lab=await f.create('Laboratory'),imaging=await f.create('Imaging');
  await assert.rejects(f.imaging.recordInvestigationReport(await f.body(lab,{Text:'Cross department'},f.doctor)),{status:403});
  await assert.rejects(f.laboratory.recordInvestigationReport(await f.body(imaging,{Text:'Cross department'},f.doctor)),{status:403});
  for(const value of [0,-1,NaN,Infinity,'',true,{},'1.0001','1e5'])assert.throws(()=>quantity(value));
  for(const value of [-1,'1.111','',true,NaN])assert.throws(()=>money(value));
  assert.equal(quantity('0.125'),0.125);assert.equal(money('12.50'),1250);
  assert.equal(chargeCents(0.333,7),2);assert.equal(chargeCents(1000000,1000000000),1000000000000000);
  const credits=[0.111,0.222,0.333].map((amount,index)=>cumulativeCredit(2,amount,0.333)-cumulativeCredit(2,index===0?0:[0.111,0.222][index-1],0.333));
  assert.deepEqual(credits,[1,0,1]);assert.equal(credits.reduce((sum,n)=>sum+n,0),2);
  assert.equal(f.rows('MedicineBatches').length,0);
});

test('backup serialization retains order, dispense, batch, return and charge relationships',async()=>{
  const f=await ordersFixture(),order=await f.create();await f.receive();await approve(f,order);const saved=await dispense(f,order,4);
  const dispenseRow=f.rows('Dispenses')[0];await f.pharmacist.returnDispensedMedicine(await f.body(order,{DispenseId:saved.DispenseId,DispenseRevision:dispenseRow.__updateTime,Quantity:1,Reason:'Recorded return'}));
  const restored=new Map(JSON.parse(JSON.stringify([...f.store]))),get=(name,key)=>restored.get(`${hospitalCollectionPath(env,name)}/${key}`);
  assert.equal(get('Orders',order.OrderId).PatientId,order.PatientId);assert.equal(get('Dispenses',saved.DispenseId).BatchId,dispenseRow.BatchId);
  assert.equal(get('MedicineBatches',dispenseRow.BatchId).Quarantined,1);assert.equal(get('ChargeEvents',saved.DispenseId).SourceId,saved.DispenseId);
  assert.equal(get('MedicineReturns',f.rows('MedicineReturns')[0].ReturnId).DispenseId,saved.DispenseId);
});

test('report corrections never silently clear an earlier unacknowledged critical result',async()=>{
  const f=await ordersFixture(),order=await f.create('Imaging');
  const first=await f.imaging.recordInvestigationReport(await f.body(order,{Text:'Original critical report',Critical:true},f.imaging));
  await f.imagingVerifier.verifyInvestigationReport(await f.body(order,{ReportId:first.ReportId},f.imagingVerifier));
  await f.imagingVerifier.releaseInvestigationReport(await f.body(order,{ReportId:first.ReportId,Communication:'Called attending doctor'},f.imagingVerifier));
  const next=await f.imaging.recordInvestigationReport(await f.body(order,{Text:'Corrected report',Reason:'Authorised correction',Critical:false},f.imaging));
  await f.imagingVerifier.verifyInvestigationReport(await f.body(order,{ReportId:next.ReportId},f.imagingVerifier));
  await f.imagingVerifier.releaseInvestigationReport(await f.body(order,{ReportId:next.ReportId},f.imagingVerifier));
  const c=await f.doctor.orderDetails(request(order));assert.equal(c.order.CriticalNeedsAcknowledgement,true);assert.equal(c.order.CriticalPendingCount,1);
  const pending=await f.doctor.pendingCriticalAlerts(request(order));assert.equal(pending.alerts.length,1);assert.equal(pending.alerts[0].report.Text,'Original critical report');
  const body=await f.body(order,{ReportId:first.ReportId,Note:'Original and corrected reports reviewed'},f.doctor);
  await f.doctor.acknowledgeCriticalResult(body);assert.equal((await f.doctor.acknowledgeCriticalResult(body)).replayed,true);
  assert.equal((await f.doctor.pendingCriticalAlerts(request(order))).alerts.length,0);assert.equal(f.rows('CriticalAlerts')[0].Status,'Acknowledged');
  assert.equal(f.rows('InvestigationReports').length,2);
});

test('stock movements are dated and branch-bound, with matching index definitions for operational queries',async()=>{
  const f=await ordersFixture(),{BatchId}=await f.receive();f.queries.length=0;
  await assert.rejects(f.pharmacist.stockHistory(request({BatchId})),/Choose valid/);assert.equal(f.queries.length,0);
  const rows=await f.pharmacist.stockHistory(request({BatchId,DateRange:range}));assert.equal(rows.movements.length,1);assert.equal(rows.movements[0].Type,'Receipt');
  assert.equal((await f.pharmacist.stockHistory(request({BatchId,DateRange:{fromDate:'2026-10-25',toDate:'2026-10-25'}}))).movements.length,0);
  const config=JSON.parse(await readFile(new URL('../firestore.hospital.indexes.json',import.meta.url),'utf8'));
  for(const [name,fields] of [['Orders',['BranchId','Kind','CreatedAt']],['OrderEvents',['BranchId','OrderId','CreatedAt']],['MedicineBatches',['BranchId','MedicineKey','ExpiryDate']],
    ['Dispenses',['BranchId','OrderId','CreatedAt']],['StockMovements',['BranchId','BatchId','CreatedAt']],['CriticalAlerts',['BranchId','OrderId','Status','CreatedAt']]]){
    assert.ok(config.indexes.some(row=>row.collectionGroup===`hospital${name}`&&row.queryScope==='COLLECTION'&&JSON.stringify(row.fields.map(f=>f.fieldPath))===JSON.stringify(fields)),name);
  }
});

test('quarantining damaged or recalled stock preserves receipt history and cannot be retried twice',async()=>{
  const f=await ordersFixture(),{BatchId}=await f.receive();const original=structuredClone(f.rows('StockReceipts')[0]),batch=f.rows('MedicineBatches')[0];
  const body=request({BatchId,Revision:batch.__updateTime,Quantity:5,Reason:'Manufacturer recall recorded'});
  await f.pharmacist.quarantineStock(body);const count=f.commits.length;assert.equal((await f.pharmacist.quarantineStock(body)).replayed,true);assert.equal(f.commits.length,count);
  assert.equal(f.rows('MedicineBatches')[0].OnHand,15);assert.equal(f.rows('MedicineBatches')[0].Quarantined,5);assert.deepEqual(f.rows('StockReceipts')[0],original);
  const current=f.rows('MedicineBatches')[0];await assert.rejects(f.pharmacist.quarantineStock(request({BatchId,Revision:current.__updateTime,Quantity:16,Reason:'Too many'})),/exceeds/);
});
