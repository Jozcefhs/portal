import test from 'node:test';
import assert from 'node:assert/strict';
import {billingFixture,billingActors,plan,mapping,period} from './helpers/hospital-billing-fixture.mjs';
import {env,request,actor} from './helpers/hospital-fixture.mjs';
import {createHospitalService} from '../functions/lib/hospital-service.js';
import {hospitalCollectionPath} from '../functions/lib/hospital-storage.js';
import {hospitalCapabilities} from '../functions/lib/hospital-model.js';
import {splitCharge,balances,planFields} from '../functions/lib/hospital-billing-model.js';

const collection=name=>hospitalCollectionPath(env,name);
const journals=f=>[...f.store.entries()].filter(([k])=>k.startsWith('accountingJournals/')).map(([,r])=>r);
const totalJournals=f=>journals(f).forEach(r=>{assert.equal(r.TotalDebit,r.TotalCredit);assert.equal(r.Status,'Posted');assert.equal(r.Edition,'hospital');});
async function approve(f,inv){
  for(const Status of ['Submitted','Approved']){const data=await f.hmo.hospitalInvoiceDetails(request({...inv,PatientId:f.scope.PatientId}));await f.hmo.updateHmoClaim(request({...inv,PatientId:f.scope.PatientId,Revision:data.claim.Revision,Status,Reference:'HMO-ACK',Note:'Staff recorded insurer response',ConfirmPatient:true}));}
}
async function pharmacyInvoice(f,paid=false){
  const order=await f.create();await f.pharmacist.reviewPrescription(await f.body(order,{Decision:'Approved',Reason:'Reviewed'}));const batch=await f.receive();
  const stock=f.rows('MedicineBatches')[0];await f.pharmacist.dispensePrescription(await f.body(order,{BatchId:stock.BatchId,BatchRevision:stock.__updateTime,Quantity:4}));
  const charge=f.rows('ChargeEvents')[0],inv=await f.cashier.issueHospitalInvoice(request({...f.scope,ChargeIds:[charge.ChargeId],ConfirmPatient:true}));
  if(paid)await f.cashier.recordHospitalPayment(await f.billBody(inv,{Amount:'50',Method:'Cash',Reference:'RCPT-1',Payer:'Patient'}));
  const disp=f.rows('Dispenses')[0];await f.pharmacist.returnDispensedMedicine(await f.body(order,{DispenseId:disp.DispenseId,DispenseRevision:disp.__updateTime,Quantity:1,Reason:'Returned unused'}));
  return {order,inv,credit:f.rows('ChargeEvents').find(r=>r.Source==='Return')};
}
test('Hospital billing permissions are explicit and never grant access to clinical notes',async()=>{
  const f=await billingFixture();
  for(const u of Object.values(billingActors))assert.ok(!hospitalCapabilities(u).includes('clinical.read'));
  await assert.rejects(f.doctor.billingInvoices(request({DateRange:period})),/role/);
  await assert.rejects(f.cashier.saveHmoPlan(request({Plan:plan})),/role/);
  await assert.rejects(f.hmo.createServiceCharge(request({})),/role/);
  await assert.rejects(f.cashier.refundHospitalPayment(request({})),/role/);
  const readOnly=createHospitalService(env,{...billingActors.admin,subscriptionReadOnly:true},f.db);
  await assert.rejects(readOnly.saveBillingSettings(request({Settings:mapping})),/viewing only/);
  await assert.rejects(f.cashier.billingInvoices(request({BranchId:'north',DateRange:period})),/branch/);
  assert.throws(()=>createHospitalService({...env,ORGANISATION_EDITION:'school'},billingActors.admin,f.db),/Hospital edition/);
});
test('settings, plan and eligibility changes retain versions; identical saves make no writes',async()=>{
  const f=await billingFixture();let s=(await f.admin.billingSettings(request())).settings,n=f.commits.length;
  assert.equal((await f.admin.saveBillingSettings(request({Settings:mapping,Revision:s.Revision}))).Unchanged,true);assert.equal(f.commits.length,n);
  const coverage=await f.cover();const p=(await f.hmo.findHmoPlans(request({Code:plan.Code}))).plan;n=f.commits.length;
  assert.equal((await f.hmo.saveHmoPlan(request({Plan:plan,Revision:p.Revision}))).Unchanged,true);assert.equal(f.commits.length,n);
  assert.equal((await f.hmo.saveHmoEligibility(request({...f.scope,PlanId:p.PlanId,PlanRevision:p.Revision,Revision:coverage.Revision,Eligibility:coverage,ConfirmPatient:true}))).Unchanged,true);assert.equal(f.commits.length,n);
  await f.hmo.saveHmoPlan(request({Plan:{...plan,Name:'Updated plan'},Revision:p.Revision}));assert.equal(f.rows('HmoPlanVersions').length,2);assert.equal(f.rows('HmoEligibility')[0].Plan.Name,plan.Name);
  await assert.rejects(f.hmo.saveHmoPlan(request({Plan:plan,Revision:p.Revision})),/changed/);
});
test('service reference and issued charge links prevent duplicates even with fresh request IDs',async()=>{
  const f=await billingFixture(),payload=request({...f.scope,Category:'Consultation',ServiceCode:'CONSULT',Description:'Consultation',Quantity:1,UnitPrice:'100',Reference:'VISIT-CONSULT',ConfirmPatient:true});
  const a=await f.cashier.createServiceCharge(payload),b=await f.cashier.createServiceCharge(payload);assert.equal(a.ChargeId,b.ChargeId);
  const n=f.commits.length;assert.equal((await f.cashier.createServiceCharge({...payload,RequestId:crypto.randomUUID()})).Unchanged,true);assert.equal(f.commits.length,n);
  await assert.rejects(f.cashier.createServiceCharge({...payload,RequestId:crypto.randomUUID(),UnitPrice:'999'}),/already charged/);
  const issue=request({...f.scope,ChargeIds:[a.ChargeId],ConfirmPatient:true}),inv=await f.cashier.issueHospitalInvoice(issue);await f.cashier.issueHospitalInvoice(issue);
  await assert.rejects(f.cashier.issueHospitalInvoice({...issue,RequestId:crypto.randomUUID()}),/already billed/);
  assert.equal(f.rows('Invoices').length,1);assert.equal(journals(f).length,1);assert.equal(f.rows('ChargeEvents')[0].InvoiceId,inv.InvoiceId);totalJournals(f);
});
test('concurrent invoices claim a source once and competing payments cannot exceed the balance',async()=>{
  const f=await billingFixture(),charge=await f.charge(),payload={...f.scope,ChargeIds:[charge.ChargeId],ConfirmPatient:true};
  const results=await Promise.allSettled([f.cashier.issueHospitalInvoice(request(payload)),f.cashier.issueHospitalInvoice(request(payload))]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.rows('Invoices').length,1);
  const inv={InvoiceId:f.rows('Invoices')[0].InvoiceId},body=await f.billBody(inv,{Amount:'80',Method:'Cash',Reference:'ONE',Payer:'Patient'});
  const payments=await Promise.allSettled([f.cashier.recordHospitalPayment(body),f.cashier.recordHospitalPayment({...body,RequestId:crypto.randomUUID(),Reference:'TWO'})]);
  assert.equal(payments.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.rows('Payments').length,1);assert.equal(f.rows('Invoices')[0].PatientPaidCents,8000);
});
test('HMO tariff and co-payment are snapshotted; uncovered services remain self-pay',async()=>{
  const f=await billingFixture(),coverage=await f.cover(),inv=await f.issue({UseHmo:true,EligibilityRevision:coverage.Revision});
  const row=f.rows('Invoices')[0];assert.equal(row.PatientCents,2000);assert.equal(row.HmoCents,6000);assert.equal(row.Lines[0].SourceAmountCents,10000);
  const p=(await f.hmo.findHmoPlans(request({Code:plan.Code}))).plan;await f.hmo.saveHmoPlan(request({Plan:{...plan,Services:[{...plan.Services[0],Tariff:'999'}]},Revision:p.Revision}));
  assert.equal(f.rows('Invoices')[0].Coverage.Plan.Services[0].TariffCents,8000);
  const uncovered=splitCharge({AmountCents:4500,ServiceCode:'OTHER'},row.Coverage.Plan);assert.equal(uncovered.PatientCents,4500);assert.equal(uncovered.HmoCents,0);
  await assert.rejects(f.cashier.recordHospitalPayment(await f.billBody(inv,{Amount:'20.01',Payer:'Patient',Method:'Cash',Reference:'TOO-MUCH'})),/exceeds/);
  await assert.rejects(f.cashier.recordHospitalPayment(await f.billBody(inv,{Amount:'60',Payer:'Hmo',Method:'Bank transfer',Reference:'SETTLEMENT'})),/approval/);
});
test('HMO rejection, resubmission, approval and partial settlements preserve history',async()=>{
  const f=await billingFixture(),coverage=await f.cover(),inv=await f.issue({UseHmo:true,EligibilityRevision:coverage.Revision});
  for(const Status of ['Submitted','Rejected','Submitted','Approved']){const d=await f.hmo.hospitalInvoiceDetails(request({...inv,PatientId:f.scope.PatientId}));await f.hmo.updateHmoClaim(request({...inv,PatientId:f.scope.PatientId,Status,Revision:d.claim.Revision,Reference:`${Status}-REF`,Note:'Recorded insurer decision',ConfirmPatient:true}));}
  assert.equal(f.rows('ClaimVersions').length,4);assert.equal(f.rows('Claims')[0].SubmissionNumber,2);
  await f.cashier.recordHospitalPayment(await f.billBody(inv,{Amount:'25',Payer:'Hmo',Method:'Bank transfer',Reference:'HMO-PART1'}));assert.equal(f.rows('Claims')[0].Status,'Partially settled');
  await f.cashier.recordHospitalPayment(await f.billBody(inv,{Amount:'35',Payer:'Hmo',Method:'Bank transfer',Reference:'HMO-PART2'}));assert.equal(f.rows('Claims')[0].Status,'Settled');
  assert.equal(balances(f.rows('Invoices')[0]).HmoBalanceCents,0);assert.equal(f.rows('Payments').length,2);totalJournals(f);
});
test('receipts deduplicate by reference across new requests and preserve partial payment balances',async()=>{
  const f=await billingFixture(),inv=await f.issue(),body=await f.billBody(inv,{Amount:'30',Payer:'Patient',Method:'Cash',Reference:'CASH-001'});
  await f.cashier.recordHospitalPayment(body);let n=f.commits.length;await f.cashier.recordHospitalPayment(body);assert.equal(f.commits.length,n);
  assert.equal((await f.cashier.recordHospitalPayment({...body,RequestId:crypto.randomUUID()})).Unchanged,true);assert.equal(f.commits.length,n);
  await assert.rejects(f.cashier.recordHospitalPayment({...body,RequestId:crypto.randomUUID(),Amount:'40'}),/already used/);
  await assert.rejects(f.cashier.recordHospitalPayment({...body,RequestId:crypto.randomUUID(),Method:'Card terminal'}),/disabled/);
  await f.cashier.recordHospitalPayment(await f.billBody(inv,{Amount:'70',Payer:'Patient',Method:'Bank transfer',Reference:'BANK-001'}));assert.equal(balances(f.rows('Invoices')[0]).PatientBalanceCents,0);totalJournals(f);
});
test('medicine return credit and controlled refund preserve invoices, payments and stock originals',async()=>{
  const f=await billingFixture(),{inv,credit}=await pharmacyInvoice(f,true),before=structuredClone(f.rows('Invoices')[0].Lines);
  await f.cashier.creditHospitalCharge(await f.billBody(inv,{ChargeId:credit.ChargeId}));assert.deepEqual(f.rows('Invoices')[0].Lines,before);assert.equal(balances(f.rows('Invoices')[0]).PatientBalanceCents,-1250);
  const payment=f.rows('Payments')[0],payload=await f.billBody(inv,{PaymentId:payment.PaymentId,PaymentRevision:payment.__updateTime,Amount:'12.50',Reference:'REFUND-1',Reason:'Returned medicine'});
  await f.admin.refundHospitalPayment(payload);assert.equal(f.rows('Payments')[0].AmountCents,5000);assert.equal(f.rows('Refunds').length,1);assert.equal(balances(f.rows('Invoices')[0]).PatientBalanceCents,0);
  const n=f.commits.length;await f.admin.refundHospitalPayment(payload);assert.equal(f.commits.length,n);assert.equal((await f.admin.refundHospitalPayment({...payload,RequestId:crypto.randomUUID()})).Unchanged,true);
  await assert.rejects(f.admin.refundHospitalPayment(await f.billBody(inv,{PaymentId:payment.PaymentId,PaymentRevision:f.rows('Payments')[0].__updateTime,Amount:'1',Reference:'REFUND-2',Reason:'Extra'})),/exceeds/);
  assert.equal(f.rows('MedicineBatches')[0].OnHand,16);assert.equal(f.rows('MedicineBatches')[0].Quarantined,1);totalJournals(f);
});
test('HMO returns use original tariff split, require claim adjustment, and retain earlier submissions',async()=>{
  const f=await billingFixture(),order=await f.create();await f.pharmacist.reviewPrescription(await f.body(order,{Decision:'Approved',Reason:'Reviewed'}));await f.receive();const b=f.rows('MedicineBatches')[0];
  await f.pharmacist.dispensePrescription(await f.body(order,{BatchId:b.BatchId,BatchRevision:b.__updateTime,Quantity:4}));const charge=f.rows('ChargeEvents')[0];
  const coverage=await f.cover({Services:[{ServiceCode:charge.ServiceCode,Name:'Agreed medicine',Tariff:'10',CopayPercent:'20'}]});
  const inv=await f.cashier.issueHospitalInvoice(request({...f.scope,ChargeIds:[charge.ChargeId],UseHmo:true,EligibilityRevision:coverage.Revision,ConfirmPatient:true}));await approve(f,inv);
  const d=f.rows('Dispenses')[0];await f.pharmacist.returnDispensedMedicine(await f.body(order,{DispenseId:d.DispenseId,DispenseRevision:d.__updateTime,Quantity:1,Reason:'Unused'}));
  await f.cashier.creditHospitalCharge(await f.billBody(inv,{ChargeId:f.rows('ChargeEvents').find(r=>r.Source==='Return').ChargeId}));
  const row=f.rows('Invoices')[0];assert.equal(row.PatientCreditCents,200);assert.equal(row.HmoCreditCents,800);assert.equal(f.rows('Claims')[0].Status,'Adjustment required');assert.equal(f.rows('ClaimVersions').length,2);
  await assert.rejects(f.cashier.recordHospitalPayment(await f.billBody(inv,{Amount:'24',Payer:'Hmo',Method:'Bank transfer',Reference:'PAY-AFTER-RETURN'})),/approval/);totalJournals(f);
});
test('closed accounting periods, inactive accounts, missing confirmation and invalid values prevent posting',async()=>{
  const f=await billingFixture();await assert.rejects(f.issue({ConfirmPatient:false}),/Confirm/);
  f.store.set('accountingPeriods/period-1',{StartDate:'2026-10-01',EndDate:'2026-10-31',Status:'Closed'});await assert.rejects(f.issue(),/closed/);assert.equal(f.rows('Invoices').length,0);
  f.store.set('accountingPeriods/period-1',{startDate:'2026-10-01',endDate:'2026-10-31',status:'closed'});await assert.rejects(f.issue(),/closed/);
  f.store.delete('accountingPeriods/period-1');f.store.get('chartOfAccounts/4300').Active='NO';await assert.rejects(f.issue(),/active revenue/);
  assert.throws(()=>planFields({...plan,Services:[{...plan.Services[0],CopayPercent:101}]}),/Co-payment/);
  await assert.rejects(f.charge({UnitPrice:'-1'}),/price/);await assert.rejects(f.charge({Quantity:0}),/quantity/);
});
test('date-first reads are bounded and branch-scoped with zero automatic history or mutation on open',async()=>{
  const f=await billingFixture();f.queries.length=0;f.commits.length=0;f.reads.length=0;await f.cashier.state();assert.equal(f.reads.length,0);assert.equal(f.queries.length,0);assert.equal(f.commits.length,0);
  for(const method of ['billingInvoices','billingCharges','hmoClaims'])await assert.rejects(f[method==='hmoClaims'?'hmo':'cashier'][method](request()),/dates/);
  assert.equal(f.queries.length,0);await f.cashier.billingInvoices(request({DateRange:period}));assert.equal(f.queries.length,1);assert.equal(f.queries[0].limit,31);assert.ok(f.queries[0].filters.some(r=>r.field==='BranchId'&&r.value==='main'));assert.equal(f.commits.length,1);
});
test('billing retries have a one-read zero-write budget and payment posting does not scan transaction history',async()=>{
  const f=await billingFixture(),inv=await f.issue(),body=await f.billBody(inv,{Amount:'10',Method:'Cash',Reference:'BUDGET-1',Payer:'Patient'});
  f.queries.length=0;await f.cashier.recordHospitalPayment(body);assert.equal(f.queries.length,2);assert.ok(f.queries.every(q=>q.path==='accountingPeriods'));assert.equal(f.queries[0].limit,101);
  f.reads.length=0;f.commits.length=0;f.queries.length=0;await f.cashier.recordHospitalPayment(body);assert.equal(f.reads.length,1);assert.equal(f.queries.length,0);assert.equal(f.commits.length,0);
});
test('unbilled service corrections void a record with a reason; invoiced corrections retain credit notes',async()=>{
  const f=await billingFixture(),charge=await f.charge(),row=f.rows('ChargeEvents')[0];
  await f.cashier.voidServiceCharge(request({...f.scope,ChargeId:charge.ChargeId,Revision:row.__updateTime,Reason:'Service entered twice'}));
  assert.equal(f.rows('ChargeEvents')[0].Status,'Voided');assert.equal(f.rows('ChargeEvents')[0].AmountCents,10000);
  await assert.rejects(f.cashier.issueHospitalInvoice(request({...f.scope,ChargeIds:[charge.ChargeId],ConfirmPatient:true})),/already billed/);
  const inv=await f.issue(),original=f.rows('Invoices')[0].Lines[0],Adjustment={OriginalChargeId:original.ChargeId,Amount:'25',Reference:'ADJ-001',Reason:'Service partly cancelled'};
  await assert.rejects(f.cashier.creditHospitalCharge(await f.billBody(inv,{Adjustment})),/role/);
  const body=await f.billBody(inv,{Adjustment});await f.admin.creditHospitalCharge(body);assert.equal(f.rows('Invoices')[0].PatientCreditCents,2500);
  assert.equal((await f.admin.creditHospitalCharge({...body,RequestId:crypto.randomUUID()})).Unchanged,true);
  await assert.rejects(f.admin.creditHospitalCharge(await f.billBody(inv,{Adjustment:{...Adjustment,Reference:'ADJ-002',Amount:'76'}})),/exceed/);
  assert.equal(f.rows('CreditNotes').length,1);assert.equal(f.rows('Invoices')[0].Lines[0].SourceAmountCents,10000);totalJournals(f);
});
test('expired eligibility, foreign sources, identity mismatches and stale settings cannot be billed',async()=>{
  const f=await billingFixture(),coverage=await f.cover();f.store.get(`${collection('HmoEligibility')}/${coverage.EligibilityId}`).To='2026-10-25';
  await assert.rejects(f.issue({UseHmo:true,EligibilityRevision:coverage.Revision}),/valid dates/);
  const charge=await f.charge();await assert.rejects(f.cashier.issueHospitalInvoice(request({...f.scope,PatientId:'another-patient',ChargeIds:[charge.ChargeId],ConfirmPatient:true})),/patient/);
  await assert.rejects(f.charge({Category:'Laboratory',OrderId:'nonexistent-order'}),/matching investigation/);
  await assert.rejects(f.admin.saveBillingSettings(request({Settings:mapping,Revision:'stale'})),/changed/);
});
test('a lost committed payment response retries without duplicating receipts, journals or audit',async()=>{
  const f=await billingFixture(),inv=await f.issue(),body=await f.billBody(inv,{Amount:'10',Payer:'Patient',Method:'Cash',Reference:'LOST-RESPONSE'});
  let once=true;const service=createHospitalService(env,billingActors.cashier,{...f.db,batchCommitLiteralDocuments:async(e,w)=>{await f.db.batchCommitLiteralDocuments(e,w);if(once){once=false;throw Error('connection interrupted');}}});
  await assert.rejects(service.recordHospitalPayment(body),/interrupted/);const n=f.commits.length;assert.equal((await service.recordHospitalPayment(body)).replayed,true);assert.equal(f.commits.length,n);
  assert.equal(f.rows('Payments').length,1);assert.equal(journals(f).length,2);assert.equal(f.rows('Invoices')[0].PatientPaidCents,1000);
});
test('invoice, receipt, credit and HMO references survive backup serialization with posted journals',async()=>{
  const f=await billingFixture(),coverage=await f.cover(),inv=await f.issue({UseHmo:true,EligibilityRevision:coverage.Revision});await f.cashier.recordHospitalPayment(await f.billBody(inv,{Amount:'20',Payer:'Patient',Method:'Cash',Reference:'BACKUP-1'}));
  const restored=new Map(JSON.parse(JSON.stringify([...f.store]))),row=restored.get(`${collection('Invoices')}/${inv.InvoiceId}`),payment=f.rows('Payments')[0];
  assert.equal(restored.get(`${collection('ChargeEvents')}/${row.Lines[0].ChargeId}`).InvoiceId,row.InvoiceId);
  assert.equal(restored.get(`${collection('Claims')}/${row.InvoiceId}`).Authorization,'AUTH-1');
  assert.equal(restored.get(`accountingJournals/HOSP-${payment.PaymentId}`).HospitalInvoiceId,row.InvoiceId);
  assert.equal(row.Coverage.MemberNumber,'MEM-1');assert.equal(row.PatientPaidCents,2000);
});
test('HMO credits and refunds reconcile to original shared-ledger receivables after settlement',async()=>{
  const f=await billingFixture(),coverage=await f.cover(),inv=await f.issue({UseHmo:true,EligibilityRevision:coverage.Revision});await approve(f,inv);
  await f.cashier.recordHospitalPayment(await f.billBody(inv,{Amount:'60',Payer:'Hmo',Method:'Bank transfer',Reference:'SETTLED-1'}));
  const original=f.rows('Invoices')[0].Lines[0];await f.admin.creditHospitalCharge(await f.billBody(inv,{Adjustment:{OriginalChargeId:original.ChargeId,Amount:'50',Reference:'SERVICE-HALF',Reason:'Half of service fee credited'}}));
  const receipt=f.rows('Payments')[0];await f.admin.refundHospitalPayment(await f.billBody(inv,{PaymentId:receipt.PaymentId,PaymentRevision:receipt.__updateTime,Amount:'30',Reference:'HMO-REFUND',Reason:'Insurer credited overpayment'}));
  assert.equal(f.rows('Claims')[0].SettledCents,3000);assert.equal(f.rows('Claims')[0].Status,'Adjustment required');await approve(f,inv);assert.equal(f.rows('Claims')[0].Status,'Settled');
  const net=Code=>Math.round(journals(f).flatMap(j=>j.Lines).filter(l=>l.AccountCode===Code).reduce((n,l)=>n+l.Debit-l.Credit,0)*100),row=f.rows('Invoices')[0];
  assert.equal(net(mapping.PatientReceivable),balances(row).PatientBalanceCents);assert.equal(net(mapping.HmoReceivable),balances(row).HmoBalanceCents);
  assert.equal(-net(mapping.Revenue),row.PatientCents+row.HmoCents-row.PatientCreditCents-row.HmoCreditCents);totalJournals(f);
});
test('one bank transfer reference cannot be recorded again in another hospital branch',async()=>{
  const f=await billingFixture(),inv=await f.issue();await f.cashier.recordHospitalPayment(await f.billBody(inv,{Amount:'10',Payer:'Patient',Method:'Bank transfer',Reference:'SHARED-BANK-REF'}));
  const user={...actor,assignedBranchIds:['north']},reception=createHospitalService(env,user,f.db);
  const registered=await reception.savePatient(request({BranchId:'north',Patient:{FirstName:'Another',LastName:'Patient'}})),visit=await reception.checkIn(request({BranchId:'north',PatientId:registered.PatientId,Department:'Outpatients'}));
  const cashier=createHospitalService(env,{...billingActors.cashier,assignedBranchIds:['north']},f.db),admin=createHospitalService(env,{...billingActors.admin,assignedBranchIds:['north']},f.db);
  await admin.saveBillingSettings(request({BranchId:'north',Settings:mapping}));const scope={BranchId:'north',PatientId:registered.PatientId,VisitId:visit.VisitId,ConfirmPatient:true};
  const charge=await cashier.createServiceCharge(request({...scope,Category:'Consultation',ServiceCode:'CONSULT',Description:'Consultation',Quantity:1,UnitPrice:'100',Reference:'NORTH-VISIT'}));
  const issued=await cashier.issueHospitalInvoice(request({...scope,ChargeIds:[charge.ChargeId]})),row=(await cashier.hospitalInvoiceDetails(request({...scope,...issued}))).invoice;
  await assert.rejects(cashier.recordHospitalPayment(request({...scope,...issued,Revision:row.Revision,Amount:'10',Payer:'Patient',Method:'Bank transfer',Reference:'SHARED-BANK-REF'})),/already used/);
  assert.equal(f.rows('Payments').length,1);assert.equal(f.rows('Invoices').find(r=>r.BranchId==='north').PatientPaidCents,0);
});
