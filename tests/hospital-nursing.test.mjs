import test from 'node:test';
import assert from 'node:assert/strict';
import {nursingFixture,nursingActors,chartFields,handoverFields,period} from './helpers/hospital-nursing-fixture.mjs';
import {request,env} from './helpers/hospital-fixture.mjs';
import {createHospitalService} from '../functions/lib/hospital-service.js';
import {hospitalCollectionPath,HOSPITAL_COLLECTIONS} from '../functions/lib/hospital-storage.js';
import {nursingChart,nursingTime} from '../functions/lib/hospital-nursing-model.js';
const reset=f=>{f.reads.length=0;f.queries.length=0;f.commits.length=0;};
const chart=f=>f.nurse.saveNursingChart(f.nBody({Chart:chartFields}));
const send=f=>f.nurse.saveNursingHandover(f.nBody({Handover:handoverFields}));
const handBody=(f,h,extra={})=>f.nBody({HandoverId:h.HandoverId,Revision:f.rows('NursingHandovers')[0].__updateTime,...extra});

test('nursing entry performs no automatic reads and clinical data remains role/module/branch restricted',async()=>{
  const f=await nursingFixture({medication:false});reset(f);await f.nurse.state();assert.equal(f.reads.length+f.queries.length+f.commits.length,0);
  for(const svc of [f.admin,f.clerk,f.cashier,f.pharmacist])await assert.rejects(svc.nursingContext(request(f.nScope)),{status:403});
  await assert.rejects(f.nurse.nursingContext(request({...f.nScope,BranchId:'north'})),{status:403});
  await assert.rejects(f.nurse.nursingContext(request({...f.nScope,PatientId:'wrong-person'})),/does not match/);
  const denied=createHospitalService(env,{...nursingActors.nurse,allowedSections:['hospitalInpatients']},f.db);await assert.rejects(denied.nursingContext(request(f.nScope)),{status:403});
});

test('nursing measurement validation preserves zeroes, units and calendar times without generating clinical advice',()=>{
  const now='2026-10-26T12:00:00Z';assert.equal(nursingChart({...chartFields,Measurements:{PainScore:0,SpO2Percent:100}},now).Measurements.PainScore,0);
  assert.deepEqual(nursingChart({Kind:'Fluid balance',ObservedAt:now,Measurements:{IntakeMl:0,OutputMl:25}},now).Measurements,{IntakeMl:0,OutputMl:25});
  assert.throws(()=>nursingChart({...chartFields,Measurements:{SystolicMmHg:110}},now),/both/);
  for(const v of [{PainScore:11},{SpO2Percent:101},{PulseBpm:-1},{PulseBpm:'invalid'}])assert.throws(()=>nursingChart({...chartFields,Measurements:v},now));
  assert.throws(()=>nursingTime('2026-02-30T12:00:00Z',now));assert.throws(()=>nursingTime('2026-10-28T12:00:00Z',now));
});

test('chart retries and fresh duplicate submissions preserve one original; corrections append history',async()=>{
  const f=await nursingFixture({medication:false}),body=f.nBody({Chart:chartFields});const c=await f.nurse.saveNursingChart(body);
  const original=structuredClone(f.rows('NursingEvents')[0]);reset(f);assert.equal((await f.nurse.saveNursingChart(body)).replayed,true);assert.equal(f.reads.length,1);assert.equal(f.commits.length,0);
  await assert.rejects(chart(f),/already exists/);
  const old=f.rows('NursingCharts')[0];await assert.rejects(f.receiver.saveNursingChart(f.nBody({ChartId:c.ChartId,Revision:old.__updateTime,Chart:{...chartFields,Notes:'Changed'},Reason:'Correction'})),{status:403});
  const correction=f.nBody({ChartId:c.ChartId,Revision:old.__updateTime,Chart:{...chartFields,Notes:'Corrected observation note'},Reason:'Correcting a transcription error'});
  await f.nurse.saveNursingChart(correction);assert.equal(f.rows('NursingEvents').length,2);assert.deepEqual(f.rows('NursingEvents')[0],original);assert.equal(f.rows('NursingCharts')[0].Content.Notes,'Corrected observation note');
  reset(f);assert.equal((await f.nurse.saveNursingChart(f.nBody({...correction,RequestId:crypto.randomUUID(),Revision:f.rows('NursingCharts')[0].__updateTime,AdmissionRevision:f.rows('Admissions')[0].__updateTime,VisitRevision:f.rows('Visits')[0].__updateTime}))).Unchanged,true);assert.equal(f.commits.length,0);
});

test('medication planning has a stable per-prescription/time identity and rejects duplicate or cancelled orders',async()=>{
  const f=await nursingFixture(),body=f.nBody({OrderId:f.order.OrderId,OrderRevision:f.rows('Orders')[0].__updateTime,DueAt:'2026-10-26T12:00:00Z'});
  const r=await Promise.all([f.nurse.planMedicationDose(body),f.nurse.planMedicationDose(body)]);assert.equal(r[0].DoseId,r[1].DoseId);assert.equal(f.rows('MedicationDoses').length,1);
  await assert.rejects(f.plan(),/already has a dose/);
  await assert.rejects(f.plan('2026-10-26T12:00:01Z'),/to the minute/);
  const o=f.rows('Orders')[0];f.store.set(`${hospitalCollectionPath(env,'Orders')}/${o.OrderId}`,{...o,Status:'Cancelled'});
  await assert.rejects(f.plan('2026-10-26T12:01:00Z'),/cancelled/);
});

test('given medication consumes patient supply once without further pharmacy stock movement or billing charges',async()=>{
  const f=await nursingFixture(),dose=await f.plan(),stock=structuredClone(f.rows('MedicineBatches')),charges=structuredClone(f.rows('ChargeEvents')),movements=structuredClone(f.rows('StockMovements'));
  const body=f.doseBody(dose);await f.nurse.recordMedicationDose(body);assert.equal(f.rows('MedicationDoses')[0].Status,'Given');assert.equal(f.rows('Dispenses')[0].AdministeredQuantity,1);
  assert.deepEqual(f.rows('MedicineBatches'),stock);assert.deepEqual(f.rows('ChargeEvents'),charges);assert.deepEqual(f.rows('StockMovements'),movements);
  reset(f);assert.equal((await f.nurse.recordMedicationDose(body)).replayed,true);assert.equal(f.reads.length,1);assert.equal(f.commits.length,0);
  await assert.rejects(f.nurse.recordMedicationDose(f.doseBody(dose)),/already recorded/);assert.equal(f.rows('Dispenses')[0].AdministeredQuantity,1);
});

test('withheld, refused and omitted doses retain reasons without consuming supply',async()=>{
  const f=await nursingFixture();let minute=0;
  for(const Outcome of ['Withheld','Refused','Unavailable','Omitted']){
    const dose=await f.plan(`2026-10-26T12:${String(minute++).padStart(2,'0')}:00Z`);
    await assert.rejects(f.nurse.recordMedicationDose(f.doseBody(dose,{Outcome})),/Note/);
    await f.nurse.recordMedicationDose(f.doseBody(dose,{Outcome,Note:'Recorded reason for non-administration'}));
  }
  assert.equal(f.rows('Dispenses')[0].AdministeredQuantity||0,0);assert.equal(f.rows('MedicationDoses').length,4);
});

test('concurrent administration attempts cannot double record a dose or over-consume shared supply',async()=>{
  const f=await nursingFixture(),first=await f.plan(),second=await f.plan('2026-10-26T12:01:00Z');
  const results=await Promise.allSettled([f.nurse.recordMedicationDose(f.doseBody(first,{Quantity:7})),f.receiver.recordMedicationDose(f.doseBody(second,{Quantity:7}))]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
  const pending=f.rows('MedicationDoses').find(r=>r.Status==='Pending');await assert.rejects(f.receiver.recordMedicationDose(f.doseBody(pending,{Quantity:7})),/remaining dispensed supply/);
  assert.equal(f.rows('Dispenses')[0].AdministeredQuantity,7);
});

test('administration corrections preserve the original event and reconcile only patient supply',async()=>{
  const f=await nursingFixture(),dose=await f.plan();await f.nurse.recordMedicationDose(f.doseBody(dose,{Quantity:3}));const old=structuredClone(f.rows('NursingEvents').at(-1)),stock=structuredClone(f.rows('MedicineBatches'));
  await assert.rejects(f.receiver.recordMedicationDose(f.doseBody(dose,{Correction:true,Reason:'Wrong quantity',Quantity:2})),{status:403});
  await f.nurse.recordMedicationDose(f.doseBody(dose,{Correction:true,Reason:'Correcting transcribed quantity',Quantity:2}));assert.equal(f.rows('Dispenses')[0].AdministeredQuantity,2);assert.deepEqual(f.rows('NursingEvents').at(-2),old);assert.deepEqual(f.rows('MedicineBatches'),stock);
  reset(f);assert.equal((await f.nurse.recordMedicationDose(f.doseBody(dose,{Correction:true,Reason:'Same values',Quantity:2}))).Unchanged,true);assert.equal(f.commits.length,0);
});

test('recorded administration and pharmacy returns cannot claim the same supplied units',async()=>{
  const f=await nursingFixture(),dose=await f.plan();await f.nurse.recordMedicationDose(f.doseBody(dose,{Quantity:6}));
  const s=f.rows('Dispenses')[0];await assert.rejects(f.pharmacist.returnDispensedMedicine(await f.pharmacyBody({DispenseId:s.DispenseId,DispenseRevision:s.__updateTime,Quantity:5,Reason:'Return'})),/unused dispensed quantity/);
  await f.pharmacist.returnDispensedMedicine(await f.pharmacyBody({DispenseId:s.DispenseId,DispenseRevision:s.__updateTime,Quantity:4,Reason:'Unused supply returned'}));
  const next=await f.plan('2026-10-26T12:01:00Z');await assert.rejects(f.nurse.recordMedicationDose(f.doseBody(next)),/remaining dispensed supply/);assert.equal(f.rows('Dispenses')[0].AdministeredQuantity,6);assert.equal(f.rows('Dispenses')[0].ReturnedQuantity,4);
});

test('changed allergies stop administration until the pharmacist re-reviews fully dispensed medication',async()=>{
  const f=await nursingFixture(),dose=await f.plan(),c=f.rows('CareSummaries')[0];f.store.set(`${hospitalCollectionPath(env,'CareSummaries')}/${c.PatientId}`,{...c,AllergyStatus:'Known allergies',Allergies:'Clinician-recorded allergy',AllergyRecordedAt:'2026-10-26T12:00:00Z',__updateTime:'changed-allergies'});
  await assert.rejects(f.nurse.recordMedicationDose(f.doseBody(dose)),/pharmacist must review/);
  await f.pharmacist.reviewPrescription(await f.pharmacyBody({Decision:'Approved',Reason:'New allergy information reviewed'}));assert.equal(f.rows('Orders')[0].Status,'Dispensed');
  await f.nurse.recordMedicationDose(f.doseBody(dose));assert.equal(f.rows('Dispenses')[0].AdministeredQuantity,1);
});

test('expired, wrong-patient, held and unreviewed supplies cannot record a Given administration',async()=>{
  const f=await nursingFixture(),dose=await f.plan(),original=f.rows('Dispenses')[0],path=`${hospitalCollectionPath(env,'Dispenses')}/${original.DispenseId}`;
  f.store.set(path,{...original,ExpiryDate:'2026-10-26'});await assert.rejects(f.nurse.recordMedicationDose(f.doseBody(dose)),/expired/);
  f.store.set(path,{...original,PatientId:'different-patient'});await assert.rejects(f.nurse.recordMedicationDose(f.doseBody(dose)),/supply/);f.store.set(path,original);
  await assert.rejects(f.nurse.recordMedicationDose(f.doseBody(dose,{ConfirmMedicationReview:false})),/Confirm the prescription/);
  await f.pharmacist.reviewPrescription(await f.pharmacyBody({Decision:'On hold',Reason:'Review required'}));await assert.rejects(f.nurse.recordMedicationDose(f.doseBody(dose)),/on hold/);assert.equal(f.rows('Dispenses')[0].AdministeredQuantity||0,0);
});

test('handover recipient lookup is bounded, branch restricted and does not load the staff roster',async()=>{
  const f=await nursingFixture({medication:false});reset(f);const h=await send(f);assert.ok(h.HandoverId);assert.equal(f.queries.length,1);assert.equal(f.queries[0].path,'staffUsers');assert.equal(f.queries[0].limit,2);
  const row=f.store.get('staffUsers/receiver');f.store.set('staffUsers/receiver',{...row,BranchIds:['north']});
  await assert.rejects(f.nurse.saveNursingHandover(f.nBody({Handover:{...handoverFields,ShiftStart:'2026-10-26T09:00:00Z'}})),/active clinical officer/);
  await assert.rejects(f.nurse.saveNursingHandover(f.nBody({Handover:{...handoverFields,Recipient:'nurse'}})),/different receiving officer/);
});

test('only the named receiver can acknowledge a handover and retries do not repeat its event',async()=>{
  const f=await nursingFixture({medication:false}),h=await send(f),original=structuredClone(f.rows('NursingEvents')[0]);
  await assert.rejects(f.nurse.acknowledgeNursingHandover(handBody(f,h,{Decision:'Acknowledged',Note:'Read-back completed'})),{status:403});
  const body=handBody(f,h,{Decision:'Acknowledged',Note:'Read-back completed'});await f.receiver.acknowledgeNursingHandover(body);assert.equal(f.rows('NursingHandovers')[0].Status,'Acknowledged');assert.deepEqual(f.rows('NursingEvents')[0],original);
  reset(f);assert.equal((await f.receiver.acknowledgeNursingHandover(body)).replayed,true);assert.equal(f.reads.length,1);assert.equal(f.commits.length,0);
  await assert.rejects(f.receiver.acknowledgeNursingHandover(handBody(f,h,{Decision:'Acknowledged',Note:'Again'})),/already received a response/);
});

test('clarification and revisions retain earlier handovers and need a fresh receiving acknowledgement',async()=>{
  const f=await nursingFixture({medication:false}),h=await send(f);
  await f.receiver.acknowledgeNursingHandover(handBody(f,h,{Decision:'Clarification requested',Note:'Please clarify the pending work'}));
  const earlier=structuredClone(f.rows('NursingEvents'));
  await f.nurse.saveNursingHandover(handBody(f,h,{Handover:{...handoverFields,OutstandingTasks:'Clarified pending work'},Reason:'Responding to receiving nurse'}));assert.equal(f.rows('NursingHandovers')[0].Status,'Awaiting acknowledgement');assert.equal(f.rows('NursingHandovers')[0].ResponseNote,undefined);assert.deepEqual(f.rows('NursingEvents').slice(0,2),earlier);
  await f.receiver.acknowledgeNursingHandover(handBody(f,h,{Decision:'Acknowledged',Note:'Clarification understood'}));assert.equal(f.rows('NursingEvents').length,4);
});

test('fresh duplicate shifts and no-op edits do not create repeated handover events',async()=>{
  const f=await nursingFixture({medication:false}),h=await send(f);await assert.rejects(send(f),/already exists/);reset(f);
  assert.equal((await f.nurse.saveNursingHandover(handBody(f,h,{Handover:handoverFields}))).Unchanged,true);assert.equal(f.commits.length,0);assert.equal(f.queries.length,0);
});

test('nursing entries invalidate discharge approval and serialize against transfers/discharge',async()=>{
  const f=await nursingFixture({medication:false});await f.sign(f.admission);
  const results=await Promise.allSettled([chart(f),f.clerk.dischargeHospitalPatient(f.body(f.admission))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
  if(f.rows('NursingCharts').length)await assert.rejects(f.clerk.dischargeHospitalPatient(f.body(f.admission)),/Clinical work changed/);
});

test('closed admissions allow attributed chart corrections but prohibit new bedside entries',async()=>{
  const f=await nursingFixture({medication:false}),c=await chart(f);await f.sign(f.admission);await f.clerk.dischargeHospitalPatient(f.body(f.admission));
  await assert.rejects(f.nurse.saveNursingChart(f.nBody({Chart:{...chartFields,Kind:'Nursing note'}})),/closed/);
  await f.director.saveNursingChart(f.nBody({ChartId:c.ChartId,Revision:f.rows('NursingCharts')[0].__updateTime,Chart:{...chartFields,Notes:'Attributed correction'},Reason:'Record correction'}));assert.equal(f.rows('Admissions')[0].Status,'Discharged');assert.equal(f.rows('Visits')[0].Status,'Completed');assert.equal(f.rows('Beds')[0].AdmissionId,'');
});

test('date-first registers and inbox use bounded scoped queries and retained snapshots have no per-row reads',async()=>{
  const f=await nursingFixture({medication:false});await chart(f);await send(f);reset(f);
  for(const method of ['nursingRegister','nursingPrescriptions','nursingSupplies','nursingInbox'])await assert.rejects(f.nurse[method](request({...f.nScope,Kind:'Charts'})));
  assert.equal(f.reads.length+f.queries.length+f.commits.length,0);
  await f.receiver.nursingInbox(request({DateRange:period}));assert.equal(f.reads.length,0);assert.equal(f.queries.length,1);assert.equal(f.queries[0].limit,31);assert.ok(f.queries[0].filters.some(r=>r.field==='Recipient'&&r.value==='receiver'));
  reset(f);await f.nurse.nursingRegister(request({...f.nScope,Kind:'Charts',DateRange:period}));assert.equal(f.reads.length,4);assert.equal(f.queries.length,1);assert.equal(f.queries[0].limit,31);assert.ok(f.queries[0].filters.some(r=>r.field==='AdmissionId'));
});

test('equal-time nursing records paginate without loss and all nursing references survive backup serialization',async()=>{
  const f=await nursingFixture({medication:false});await chart(f);const sample=f.rows('NursingCharts')[0],path=hospitalCollectionPath(env,'NursingCharts');
  for(let i=0;i<65;i++){const ChartId=`chart-${String(i).padStart(4,'0')}`;f.store.set(`${path}/${ChartId}`,{...sample,ChartId,__id:ChartId});}
  const ids=[];let Cursor;do{const r=await f.nurse.nursingRegister(request({...f.nScope,Kind:'Charts',DateRange:period,...(Cursor?{Cursor}:{})}));ids.push(...r.entries.map(e=>e.ChartId));Cursor=r.next;}while(Cursor);assert.equal(ids.length,66);assert.equal(new Set(ids).size,66);
  for(const name of ['NursingCharts','MedicationDoses','NursingHandovers','NursingEvents'])assert.ok(HOSPITAL_COLLECTIONS.includes(name));
  const restored=new Map(JSON.parse(JSON.stringify([...f.store])));assert.ok(restored.has(`${hospitalCollectionPath(env,'Admissions')}/${sample.AdmissionId}`));assert.ok(restored.has(`${hospitalCollectionPath(env,'Visits')}/${sample.VisitId}`));
});

test('lost administration response retries from one receipt without duplicated consumption or audit',async()=>{
  const f=await nursingFixture(),dose=await f.plan();let once=true;
  const svc=createHospitalService(env,nursingActors.nurse,{...f.db,batchCommitLiteralDocuments:async(...args)=>{await f.db.batchCommitLiteralDocuments(...args);if(once){once=false;throw Object.assign(Error('Lost response'),{status:503});}}});
  const body=f.doseBody(dose);await assert.rejects(svc.recordMedicationDose(body),/Lost response/);const count=f.rows('Audit').length;reset(f);
  assert.equal((await svc.recordMedicationDose(body)).replayed,true);assert.equal(f.reads.length,1);assert.equal(f.commits.length,0);assert.equal(f.rows('Dispenses')[0].AdministeredQuantity,1);assert.equal(f.rows('Audit').length,count);
});

test('read-only subscriptions cannot mutate charts, doses or handovers',async()=>{
  const f=await nursingFixture(),svc=createHospitalService(env,{...nursingActors.nurse,subscriptionReadOnly:true},f.db);reset(f);
  await assert.rejects(svc.saveNursingChart(f.nBody({Chart:chartFields})),{status:403});await assert.rejects(svc.planMedicationDose(f.nBody({OrderId:f.order.OrderId,DueAt:'2026-10-26T12:00:00Z'})),{status:403});await assert.rejects(svc.saveNursingHandover(f.nBody({Handover:handoverFields})),{status:403});assert.equal(f.commits.length,0);
});

test('chart and administration records preserve where the care occurred across bed transfers',async()=>{
  const f=await nursingFixture(),c=await chart(f),dose=await f.plan(),ward=await f.ward('SECOND','Second ward'),bed=await f.bed(ward);
  await f.clerk.transferHospitalBed(f.body(f.admission,{BedId:bed.BedId,BedRevision:bed.__updateTime,Reason:'Transfer for continued care'}));
  await f.nurse.saveNursingChart(f.nBody({ChartId:c.ChartId,Revision:f.rows('NursingCharts')[0].__updateTime,Chart:{...chartFields,Notes:'Correct the original bedside chart'},Reason:'Original entry clarification'}));
  assert.equal(f.rows('NursingCharts')[0].WardName,'General ward');
  await f.nurse.recordMedicationDose(f.doseBody(dose));const d=f.rows('MedicationDoses')[0];assert.equal(d.WardName,'General ward');assert.equal(d.AdministrationLocation.WardName,'Second ward');assert.equal(d.SupplySnapshot.BatchNumber,'NURSE-LOT');
});

test('administration and a concurrent return cannot consume the same supplied quantity',async()=>{
  const f=await nursingFixture(),dose=await f.plan(),s=f.rows('Dispenses')[0];
  const r=await f.pharmacyBody({DispenseId:s.DispenseId,DispenseRevision:s.__updateTime,Quantity:6,Reason:'Unused medicines returned'}),give=f.doseBody(dose,{Quantity:6});
  const results=await Promise.allSettled([f.nurse.recordMedicationDose(give),f.pharmacist.returnDispensedMedicine(r)]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.find(x=>x.status==='rejected').reason.status,409);
  const supply=f.rows('Dispenses')[0];assert.ok((supply.AdministeredQuantity||0)+supply.ReturnedQuantity<=supply.Quantity);
});

test('administration correction to not-given retains original supply use and correction evidence',async()=>{
  const f=await nursingFixture(),dose=await f.plan();await f.nurse.recordMedicationDose(f.doseBody(dose));const old=structuredClone(f.rows('NursingEvents').at(-1));
  await f.nurse.recordMedicationDose(f.doseBody(dose,{Correction:true,Outcome:'Withheld',Note:'Medicine was not given',Reason:'Correcting an incorrectly recorded administration'}));
  assert.equal(f.rows('Dispenses')[0].AdministeredQuantity,0);assert.deepEqual(f.rows('NursingEvents').at(-2),old);assert.equal(f.rows('NursingEvents').at(-1).Snapshot.Status,'Withheld');assert.equal(f.rows('ChargeEvents').length,1);
});

test('normal bedside actions have bounded exact read/write budgets and supply pages omit prices',async()=>{
  const f=await nursingFixture();reset(f);await chart(f);assert.equal(f.queries.length,0);assert.equal(f.reads.length,6);assert.equal(f.commits.length,1);assert.equal(f.commits[0].length,6);
  const dose=await f.plan(),body=f.doseBody(dose);reset(f);await f.nurse.recordMedicationDose(body);assert.equal(f.reads.length,8);assert.equal(f.queries.length,0);assert.equal(f.commits.length,1);assert.equal(f.commits[0].length,8);
  reset(f);const supplies=await f.nurse.nursingSupplies(request({...f.nScope,OrderId:f.order.OrderId,DateRange:period}));assert.equal(f.queries.length,1);assert.equal(f.queries[0].limit,31);assert.equal(supplies.supplies[0].UnitPriceCents,undefined);assert.equal(supplies.supplies[0].AmountCents,undefined);
});
