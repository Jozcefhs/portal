import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fundsFixture,fundMapping} from './helpers/hospital-funds-fixture.mjs';
import {billingFixture,billingActors,plan,period,mapping} from './helpers/hospital-billing-fixture.mjs';
import {env,request} from './helpers/hospital-fixture.mjs';
import {createHospitalService} from '../functions/lib/hospital-service.js';
import {balances,fundsAvailable} from '../functions/lib/hospital-billing-model.js';
import {hospitalCollectionPath} from '../functions/lib/hospital-storage.js';
const reset=f=>{f.reads.length=0;f.queries.length=0;f.commits.length=0;};
const journals=f=>[...f.store.entries()].filter(([key])=>key.startsWith('accountingJournals/')).map(([,r])=>r);
const ledger=(f,code)=>Math.round(journals(f).flatMap(r=>r.Lines).filter(r=>r.AccountCode===code).reduce((sum,r)=>sum+r.Debit-r.Credit,0)*100);
const balanced=f=>journals(f).forEach(r=>{assert.equal(r.TotalDebit,r.TotalCredit);assert.equal(r.Status,'Posted');});

test('patient prepayments require no visit, post a liability and retain the original receipt',async()=>{
  const f=await fundsFixture(),person=await f.otherPatient(false),number=f.rows('Patients').find(r=>r.PatientId===person.PatientId).HospitalNumber;
  const result=await f.cashier.hospitalDepositPatient(request({HospitalNumber:number}));assert.equal(result.patient.PatientId,person.PatientId);
  reset(f);const receipt=await f.receive(person),row=f.fund(receipt.FundId);
  assert.equal(row.AmountCents,20000);assert.equal(fundsAvailable(row),20000);assert.equal(f.rows('Visits').length,1);
  assert.equal(ledger(f,'1010'),20000);assert.equal(ledger(f,'2320'),-20000);assert.equal(ledger(f,'4300'),0);
  assert.equal(f.commits.length,1);assert.equal(f.commits[0].length,6);assert.equal(f.queries.length,2);balanced(f);
});

test('advance receipt retries read once, write nothing and reject reference reuse with changed details',async()=>{
  const f=await fundsFixture(),body=request({Kind:'Patient',PatientId:f.scope.PatientId,Amount:'200',Method:'Cash',Reference:'RCPT-1',ConfirmPatient:true});
  const receipt=await f.cashier.receiveHospitalFunds(body);reset(f);assert.equal((await f.cashier.receiveHospitalFunds(body)).FundId,receipt.FundId);assert.equal(f.reads.length,1);assert.equal(f.commits.length,0);assert.equal(f.queries.length,0);
  assert.equal((await f.cashier.receiveHospitalFunds({...body,RequestId:crypto.randomUUID()})).Unchanged,true);assert.equal(f.commits.length,0);
  await assert.rejects(f.cashier.receiveHospitalFunds({...body,RequestId:crypto.randomUUID(),Amount:'201'}),/already recorded/);assert.equal(f.rows('Funds').length,1);
});

test('ordinary invoice receipts and advance receipts share the same duplicate reference guard',async()=>{
  const f=await fundsFixture(),inv=await f.issue();await f.receive({Reference:'BANK-ONE'});
  await assert.rejects(f.cashier.recordHospitalPayment(await f.billBody(inv,{Amount:'10',Method:'Bank transfer',Reference:'bank-one',Payer:'Patient'})),/already used/);
  await f.cashier.recordHospitalPayment(await f.billBody(inv,{Amount:'10',Method:'Bank transfer',Reference:'BANK-TWO',Payer:'Patient'}));
  await assert.rejects(f.receive({Reference:'bank-two'}),/already recorded/);assert.equal(f.rows('PaymentReferences').length,2);
  const all=createHospitalService(env,{...billingActors.cashier,assignedBranchIds:['main','north']},f.db);
  await assert.rejects(all.receiveHospitalFunds(request({BranchId:'north',Kind:'Hmo',Insurer:plan.Insurer,Amount:'200',Method:'Bank transfer',Reference:'BANK-ONE',ConfirmPatient:true})),/already recorded/);
});

test('one patient advance pays multiple invoices with exact account reads and one atomic commit',async()=>{
  const f=await fundsFixture(),one=await f.issue(),two=await f.issue(),receipt=await f.receive(),body=f.allocations(receipt,[[one,'100'],[two,'60']],{Reference:'SCHEDULE-1'}),original=structuredClone(f.invoice(one.InvoiceId).Lines);
  reset(f);const result=await f.cashier.allocateHospitalFunds(body);
  assert.equal(result.PaymentIds.length,2);assert.equal(f.commits.length,1);assert.equal(f.commits[0].length,13);
  assert.equal(f.queries.length,2);assert.ok(f.queries.every(q=>q.path==='accountingPeriods'&&q.limit===101));
  assert.deepEqual(f.reads.filter(([p])=>p==='chartOfAccounts').map(([,id])=>id).sort(),['1130','2320']);
  assert.equal(f.reads.filter(([p])=>p.endsWith('hospitalPatients')).length,1);
  assert.equal(f.fund(receipt.FundId).AppliedCents,16000);assert.equal(fundsAvailable(f.fund(receipt.FundId)),4000);
  assert.equal(balances(f.invoice(one.InvoiceId)).PatientBalanceCents,0);assert.equal(balances(f.invoice(two.InvoiceId)).PatientBalanceCents,4000);
  assert.deepEqual(f.invoice(one.InvoiceId).Lines,original);assert.equal(ledger(f,'1010'),20000);assert.equal(ledger(f,'2320'),-4000);assert.equal(ledger(f,'1130'),4000);assert.equal(ledger(f,'4300'),-20000);balanced(f);
  reset(f);await f.cashier.allocateHospitalFunds(body);assert.equal(f.reads.length,1);assert.equal(f.commits.length,0);
  assert.equal((await f.cashier.allocateHospitalFunds({...body,RequestId:crypto.randomUUID()})).Unchanged,true);assert.equal(f.commits.length,0);
  await assert.rejects(f.cashier.allocateHospitalFunds({...body,RequestId:crypto.randomUUID(),Allocations:body.Allocations.map(r=>({...r,Amount:'1'}))}),/different set/);
});

test('HMO remittance allocates across different patients and preserves approved claim submissions',async()=>{
  const f=await fundsFixture(),one=await f.coveredInvoice(),two=await f.coveredInvoice(await f.otherPatient()),receipt=await f.receive({Kind:'Hmo',Insurer:plan.Insurer});
  const versions=structuredClone(f.rows('ClaimVersions'));reset(f);await f.cashier.allocateHospitalFunds(f.allocations(receipt,[[one,'60'],[two,'30']]));
  assert.equal(f.commits.length,1);assert.equal(f.commits[0].length,15);assert.equal(f.queries.length,2);
  assert.deepEqual(f.reads.filter(([p])=>p==='chartOfAccounts').map(([,id])=>id).sort(),['1140','2330']);
  assert.equal(f.rows('Claims').find(r=>r.InvoiceId===one.InvoiceId).Status,'Settled');assert.equal(f.rows('Claims').find(r=>r.InvoiceId===two.InvoiceId).Status,'Partially settled');
  assert.deepEqual(f.rows('ClaimVersions'),versions);assert.equal(ledger(f,'2330'),-11000);assert.equal(ledger(f,'1140'),3000);assert.equal(ledger(f,'1130'),4000);balanced(f);
});

test('one bad or stale invoice aborts the entire batch without partial payments',async()=>{
  const f=await fundsFixture(),one=await f.issue(),two=await f.issue(),receipt=await f.receive();
  for(const Allocations of [
    [{InvoiceId:one.InvoiceId,Revision:f.invoice(one.InvoiceId).__updateTime,Amount:'50'},{InvoiceId:two.InvoiceId,Revision:'old',Amount:'50'}],
    [{InvoiceId:one.InvoiceId,Revision:f.invoice(one.InvoiceId).__updateTime,Amount:'101'}],
    [{InvoiceId:one.InvoiceId,Revision:f.invoice(one.InvoiceId).__updateTime,Amount:'100'},{InvoiceId:two.InvoiceId,Revision:f.invoice(two.InvoiceId).__updateTime,Amount:'101'}]
  ]){reset(f);await assert.rejects(f.cashier.allocateHospitalFunds(f.fundBody(receipt,{Reference:crypto.randomUUID(),Allocations})),/changed|exceed/);assert.equal(f.commits.length,0);assert.equal(f.rows('Payments').length,0);}
  const duplicate=f.allocations(receipt,[[one,'10'],[one,'10']]);await assert.rejects(f.cashier.allocateHospitalFunds(duplicate),/only once/);
  await assert.rejects(f.cashier.allocateHospitalFunds({...duplicate,Allocations:Array(21).fill(duplicate.Allocations[0])}),/1 and 20/);
});

test('deposit allocations reject another patient and HMO allocations require the same insurer and approved claim',async()=>{
  const f=await fundsFixture(),other=await f.coveredInvoice(await f.otherPatient()),deposit=await f.receive(),remit=await f.receive({Kind:'Hmo',Insurer:'Other insurer'});
  await assert.rejects(f.cashier.allocateHospitalFunds(f.allocations(deposit,[[other,'10']])),/different patient/);
  await assert.rejects(f.cashier.allocateHospitalFunds(f.allocations(remit,[[other,'10']])),/different insurer/);
  const own=await f.coveredInvoice(),good=await f.receive({Kind:'Hmo',Insurer:plan.Insurer});f.rows('Claims').find(r=>r.InvoiceId===own.InvoiceId).Status='Submitted';
  reset(f);await assert.rejects(f.cashier.allocateHospitalFunds(f.allocations(good,[[other,'10'],[own,'10']])),/approval/);assert.equal(f.commits.length,0);
  f.invoice(other.InvoiceId).BranchId='north';await assert.rejects(f.cashier.allocateHospitalFunds(f.allocations(good,[[other,'10']])),/branch/);
});

test('concurrent receipt creation and competing allocations cannot spend a balance twice',async()=>{
  const f=await fundsFixture(),one=await f.issue(),two=await f.issue();const receives=await Promise.allSettled([f.receive({Reference:'RACE'}),f.receive({Reference:'RACE'})]);
  assert.ok(receives.some(r=>r.status==='fulfilled'));assert.equal(f.rows('Funds').length,1);const receipt={FundId:f.rows('Funds')[0].FundId};
  const a=f.allocations(receipt,[[one,'100']]),b=f.allocations(receipt,[[two,'100']]);reset(f);
  const results=await Promise.allSettled([f.cashier.allocateHospitalFunds(a),f.cashier.allocateHospitalFunds(b)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.rows('Payments').length,1);assert.equal(f.fund(receipt.FundId).AppliedCents,10000);assert.equal(f.commits.length,1);
});

test('competing ordinary invoice payments and advance allocations do not overpay the invoice',async()=>{
  const f=await fundsFixture(),inv=await f.issue(),receipt=await f.receive(),a=f.allocations(receipt,[[inv,'100']]),b=await f.billBody(inv,{Amount:'100',Method:'Cash',Payer:'Patient',Reference:'RACE-PAY'});
  const results=await Promise.allSettled([f.cashier.allocateHospitalFunds(a),f.cashier.recordHospitalPayment(b)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.rows('Payments').length,1);assert.equal(balances(f.invoice(inv.InvoiceId)).PatientBalanceCents,0);balanced(f);
});

test('lost allocation response is safely replayed from the operation receipt',async()=>{
  const f=await fundsFixture(),inv=await f.issue(),receipt=await f.receive(),body=f.allocations(receipt,[[inv,'70']]),commit=f.db.batchCommitLiteralDocuments;
  let once=true;f.db.batchCommitLiteralDocuments=async(...args)=>{await commit(...args);if(once){once=false;throw Error('response lost');}};
  const service=createHospitalService(env,billingActors.cashier,f.db);await assert.rejects(service.allocateHospitalFunds(body),/response lost/);reset(f);
  assert.equal((await service.allocateHospitalFunds(body)).replayed,true);assert.equal(f.reads.length,1);assert.equal(f.commits.length,0);assert.equal(f.rows('Payments').length,1);
});

test('allocation return reopens invoice debt without deleting payments or creating a cash refund',async()=>{
  const f=await fundsFixture(),inv=await f.issue(),receipt=await f.receive(),result=await f.cashier.allocateHospitalFunds(f.allocations(receipt,[[inv,'100']])),PaymentId=result.PaymentIds[0],body=f.returnBody(receipt,PaymentId,{Amount:'40',Reference:'RETURN-1'});
  await f.admin.returnHospitalAllocation(body);assert.equal(f.fund(receipt.FundId).AmountCents,20000);assert.equal(f.fund(receipt.FundId).AppliedCents,6000);assert.equal(fundsAvailable(f.fund(receipt.FundId)),14000);
  assert.equal(f.rows('Payments')[0].AmountCents,10000);assert.equal(f.rows('Payments')[0].ReturnedToFundCents,4000);assert.equal(balances(f.invoice(inv.InvoiceId)).PatientBalanceCents,4000);
  assert.equal(f.rows('Refunds').length,0);assert.equal(ledger(f,'1010'),20000);assert.equal(ledger(f,'1130'),4000);assert.equal(ledger(f,'2320'),-14000);
  reset(f);await f.admin.returnHospitalAllocation(body);assert.equal(f.reads.length,1);assert.equal(f.commits.length,0);assert.equal((await f.admin.returnHospitalAllocation({...body,RequestId:crypto.randomUUID()})).Unchanged,true);
  await assert.rejects(f.admin.returnHospitalAllocation(f.returnBody(receipt,PaymentId,{Amount:'61'})),/exceeds/);
  const p=f.rows('Payments')[0];await assert.rejects(f.admin.refundHospitalPayment(await f.billBody(inv,{PaymentId,PaymentRevision:p.__updateTime,Amount:'1',Reference:'DIRECT',Reason:'No direct allocation cash refund'})),/Return this allocation/);balanced(f);
});

test('returning HMO allocations restores approved or partially settled state with correct net totals',async()=>{
  const f=await fundsFixture(),inv=await f.coveredInvoice(),receipt=await f.receive({Kind:'Hmo',Insurer:plan.Insurer}),{PaymentIds}=await f.cashier.allocateHospitalFunds(f.allocations(receipt,[[inv,'60']]));
  await f.admin.returnHospitalAllocation(f.returnBody(receipt,PaymentIds[0],{Amount:'10'}));let claim=f.rows('Claims')[0];assert.equal(claim.Status,'Partially settled');assert.equal(claim.SettledCents,5000);
  await f.admin.returnHospitalAllocation(f.returnBody(receipt,PaymentIds[0],{Amount:'50'}));claim=f.rows('Claims')[0];assert.equal(claim.Status,'Approved');assert.equal(claim.SettledCents,0);
  await f.cashier.recordHospitalPayment(await f.billBody(inv,{Amount:'60',Payer:'Hmo',Method:'Bank transfer',Reference:'AFTER-RETURN'}));assert.equal(f.rows('Claims')[0].SettledCents,6000);assert.equal(f.rows('Claims')[0].Status,'Settled');balanced(f);
});

test('only unused funds can be refunded, preserving original totals and ledger reconciliation',async()=>{
  const f=await fundsFixture(),inv=await f.issue(),receipt=await f.receive(),{PaymentIds}=await f.cashier.allocateHospitalFunds(f.allocations(receipt,[[inv,'100']]));
  await assert.rejects(f.admin.refundHospitalFunds(f.fundBody(receipt,{Amount:'101',Reference:'TOO-MUCH',Reason:'Refund'})),/unused balance/);
  await f.admin.returnHospitalAllocation(f.returnBody(receipt,PaymentIds[0],{Amount:'40'}));const body=f.fundBody(receipt,{Amount:'140',Reference:'REFUND-ADVANCE',Reason:'Unused balance returned'});
  await f.admin.refundHospitalFunds(body);assert.equal(f.fund(receipt.FundId).AmountCents,20000);assert.equal(f.fund(receipt.FundId).RefundedCents,14000);assert.equal(fundsAvailable(f.fund(receipt.FundId)),0);
  assert.equal(ledger(f,'1010'),6000);assert.equal(ledger(f,'2320'),0);assert.equal(ledger(f,'1130'),4000);assert.equal(ledger(f,'4300'),-10000);balanced(f);
  reset(f);await f.admin.refundHospitalFunds(body);assert.equal(f.reads.length,1);assert.equal(f.commits.length,0);assert.equal((await f.admin.refundHospitalFunds({...body,RequestId:crypto.randomUUID()})).Unchanged,true);
  await assert.rejects(f.admin.refundHospitalFunds({...body,RequestId:crypto.randomUUID(),Amount:'1'}),/already recorded/);assert.equal(f.rows('FundRefunds').length,1);
});

test('concurrent refund and allocation respect the same receipt revision',async()=>{
  const f=await fundsFixture(),inv=await f.issue(),receipt=await f.receive(),a=f.allocations(receipt,[[inv,'100']]),b=f.fundBody(receipt,{Amount:'150',Reference:'RACE-REFUND',Reason:'Unused advance'});
  const results=await Promise.allSettled([f.cashier.allocateHospitalFunds(a),f.admin.refundHospitalFunds(b)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.ok(fundsAvailable(f.fund(receipt.FundId))>=0);balanced(f);
});

test('advance refunds and invoice refunds cannot reuse a refund reference',async()=>{
  const f=await fundsFixture(),inv=await f.issue(),receipt=await f.receive();await f.cashier.recordHospitalPayment(await f.billBody(inv,{Amount:'100',Payer:'Patient',Method:'Cash',Reference:'PAID'}));
  await f.admin.creditHospitalCharge(await f.billBody(inv,{Adjustment:{OriginalChargeId:f.invoice(inv.InvoiceId).Lines[0].ChargeId,Amount:'10',Reference:'CREDIT',Reason:'Correction'}}));
  await f.admin.refundHospitalFunds(f.fundBody(receipt,{Amount:'10',Reference:'REFUND-SHARED',Reason:'Unused'}));const payment=f.rows('Payments')[0];
  await assert.rejects(f.admin.refundHospitalPayment(await f.billBody(inv,{PaymentId:payment.PaymentId,PaymentRevision:payment.__updateTime,Amount:'10',Reference:'REFUND-SHARED',Reason:'Credit'})),/already used/);
});

test('existing billing mappings remain compatible and advance receipts retain their original accounts',async()=>{
  const old=await billingFixture();assert.equal((await old.admin.billingSettings(request())).settings.PatientDeposit,'');await assert.rejects(old.cashier.receiveHospitalFunds(request({Kind:'Patient',PatientId:old.scope.PatientId,Amount:'1',Method:'Cash',Reference:'NO-MAP',ConfirmPatient:true})),/PatientDeposit/);
  const f=await fundsFixture(),receipt=await f.receive(),config=(await f.admin.billingSettings(request())).settings;
  assert.equal((await f.admin.saveBillingSettings(request({Settings:mapping,Revision:config.Revision}))).Unchanged,true);
  await f.admin.saveBillingSettings(request({Settings:{...fundMapping,PatientDeposit:'2340'},Revision:config.Revision}));
  const inv=await f.issue();await f.cashier.allocateHospitalFunds(f.allocations(receipt,[[inv,'50']]));await f.admin.refundHospitalFunds(f.fundBody(receipt,{Amount:'150',Reference:'OLD-ACCOUNTS',Reason:'Unused'}));
  assert.equal(ledger(f,'2320'),0);assert.equal(ledger(f,'2340'),0);assert.equal(f.fund(receipt.FundId).LiabilityAccount,'2320');
});

test('closed accounting periods, inactive liability accounts, invalid amounts and terminal payments fail safely',async()=>{
  const f=await fundsFixture();f.store.set('accountingPeriods/closed',{StartDate:'2026-10-01',EndDate:'2026-10-31',Status:'Closed'});await assert.rejects(f.receive(),/closed/);f.store.delete('accountingPeriods/closed');
  f.store.get('chartOfAccounts/2320').Active='NO';await assert.rejects(f.receive(),/active liability/);f.store.get('chartOfAccounts/2320').Active='YES';
  await assert.rejects(f.receive({Amount:'0'}),/amount/);await assert.rejects(f.receive({Method:'Card terminal'}),/disabled/);await assert.rejects(f.receive({ConfirmPatient:false}),/Confirm/);assert.equal(f.rows('Funds').length,0);
});

test('deposit and remittance permissions enforce role, branch and subscription boundaries',async()=>{
  const f=await fundsFixture(),receipt=await f.receive(),hmo=await f.receive({Kind:'Hmo',Insurer:plan.Insurer});
  await assert.rejects(f.hmo.hospitalFundDetails(request(receipt)),/role/);assert.equal((await f.hmo.hospitalFundDetails(request(hmo))).fund.Kind,'Hmo');
  await assert.rejects(f.hmo.receiveHospitalFunds(request()),/role/);await assert.rejects(f.admin.allocateHospitalFunds(request()),/role/);await assert.rejects(f.cashier.returnHospitalAllocation(request()),/role/);await assert.rejects(f.cashier.refundHospitalFunds(request()),/role/);
  await assert.rejects(f.cashier.hospitalFundDetails(request({...receipt,BranchId:'north'})),/branch/);
  const readonly=createHospitalService(env,{...billingActors.cashier,subscriptionReadOnly:true},f.db);await assert.rejects(readonly.receiveHospitalFunds(request({Kind:'Patient',PatientId:f.scope.PatientId,Amount:'1',Method:'Cash',Reference:'READ-ONLY',ConfirmPatient:true})),/viewing only/);
  const other=createHospitalService({...env,DYNAMAX_WORKSPACE_ID:'other-hospital'},billingActors.cashier,f.db);await assert.rejects(other.hospitalFundDetails(request(receipt)),/not available/);
});

test('fund history is date-first, branch-filtered and paginated; invoice lookup is exact and bounded',async()=>{
  const f=await fundsFixture(),receipt=await f.receive(),inv=await f.issue();reset(f);await f.cashier.state();assert.equal(f.reads.length,0);assert.equal(f.queries.length,0);
  for(const method of ['hospitalFunds','hospitalFundHistory','hospitalFundAllocations'])await assert.rejects(f.cashier[method](request({...receipt,Kind:'Patient'})),/dates/);assert.equal(f.reads.length,0);assert.equal(f.queries.length,0);
  for(const method of ['hospitalFunds','hospitalFundHistory','hospitalFundAllocations'])await f.cashier[method](request({...receipt,Kind:'Patient',DateRange:period}));
  assert.equal(f.queries.length,3);assert.ok(f.queries.every(q=>q.limit===31&&q.filters.some(r=>r.field==='BranchId'&&r.value==='main')));
  const found=await f.cashier.hospitalFundInvoice(request({...receipt,InvoiceNumber:f.invoice(inv.InvoiceId).InvoiceNumber}));assert.equal(found.invoice.InvoiceId,inv.InvoiceId);assert.equal(f.queries.at(-1).limit,2);assert.equal(f.queries.at(-1).filters.find(r=>r.field==='InvoiceNumber').value,f.invoice(inv.InvoiceId).InvoiceNumber);
  await assert.rejects(f.cashier.hospitalFunds(request({Kind:'Patient',DateRange:{fromDate:'2025-01-01',toDate:'2026-10-26'}})),/93/);
});

test('advance collections and bounded query indexes are included without deleting existing definitions',async()=>{
  for(const name of ['Funds','FundEvents','FundAllocationBatches','FundAllocationReturns','FundRefunds'])assert.ok(hospitalCollectionPath(env,name).endsWith(`hospital${name}`));
  const data=JSON.parse(await readFile(new URL('../firestore.hospital.indexes.json',import.meta.url),'utf8'));
  for(const [collectionGroup,fields]of [['hospitalFunds',['BranchId','Kind','CreatedAt']],['hospitalFunds',['BranchId','Kind','PatientId','CreatedAt']],['hospitalFunds',['BranchId','Kind','InsurerKey','CreatedAt']],['hospitalFundEvents',['BranchId','FundId','CreatedAt']],['hospitalPayments',['BranchId','SourceFundId','CreatedAt']],['hospitalInvoices',['BranchId','InvoiceNumber']]])assert.ok(data.indexes.some(r=>r.collectionGroup===collectionGroup&&JSON.stringify(r.fields.map(f=>f.fieldPath))===JSON.stringify(fields)),`${collectionGroup} ${fields}`);
});

test('twenty invoice allocations stay within one bounded atomic write and account lookup budget',async()=>{
  const f=await fundsFixture(),invoices=[];for(let i=0;i<20;i++)invoices.push(await f.issue());const receipt=await f.receive({Amount:'2000'});
  const body=f.allocations(receipt,invoices.map(inv=>[inv,'100']));reset(f);await f.cashier.allocateHospitalFunds(body);
  assert.equal(f.commits.length,1);assert.equal(f.commits[0].length,85);assert.equal(f.queries.length,2);assert.equal(f.reads.filter(([p])=>p==='chartOfAccounts').length,2);assert.equal(f.rows('Payments').length,20);assert.equal(fundsAvailable(f.fund(receipt.FundId)),0);balanced(f);
});

test('equal-timestamp receipt pages do not lose or repeat records',async()=>{
  const f=await fundsFixture();for(let i=0;i<32;i++)await f.receive({Reference:`PAGE-${i}`});reset(f);
  const first=await f.cashier.hospitalFunds(request({Kind:'Patient',DateRange:period})),second=await f.cashier.hospitalFunds(request({Kind:'Patient',DateRange:period,Cursor:first.next}));
  assert.equal(first.rows.length,30);assert.equal(second.rows.length,2);assert.equal(new Set([...first.rows,...second.rows].map(r=>r.FundId)).size,32);assert.equal(second.next,null);assert.equal(f.queries.length,2);assert.ok(f.queries.every(q=>q.limit===31));
});

test('return and refund references and source journals survive backup serialization',async()=>{
  const f=await fundsFixture(),inv=await f.issue(),receipt=await f.receive(),result=await f.cashier.allocateHospitalFunds(f.allocations(receipt,[[inv,'100']]));
  await f.admin.returnHospitalAllocation(f.returnBody(receipt,result.PaymentIds[0]));await f.admin.refundHospitalFunds(f.fundBody(receipt,{Amount:'110',Reference:'BACKUP-REFUND',Reason:'Unused advance'}));
  const restored=new Map(JSON.parse(JSON.stringify([...f.store]))),path=name=>hospitalCollectionPath(env,name),fund=restored.get(`${path('Funds')}/${receipt.FundId}`),payment=restored.get(`${path('Payments')}/${result.PaymentIds[0]}`);
  assert.equal(payment.SourceFundId,fund.FundId);assert.equal(restored.get(`${path('FundAllocationBatches')}/${result.BatchId}`).PaymentIds[0],payment.PaymentId);
  assert.equal(restored.get(`accountingJournals/HOSP-${payment.PaymentId}`).HospitalFundId,fund.FundId);assert.equal(restored.get(`${path('Invoices')}/${inv.InvoiceId}`).PatientAllocationReturnCents,1000);
  assert.equal(fund.AmountCents,20000);assert.equal(fund.RefundedCents,11000);assert.equal(fundsAvailable(fund),0);assert.equal(f.rows('FundAllocationReturns').length,1);assert.equal(f.rows('FundRefunds').length,1);
});
