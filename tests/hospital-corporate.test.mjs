import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {corporateFixture,companyFields,coverFields} from './helpers/hospital-corporate-fixture.mjs';
import {billingActors,period,mapping} from './helpers/hospital-billing-fixture.mjs';
import {env,request} from './helpers/hospital-fixture.mjs';
import {createHospitalService} from '../functions/lib/hospital-service.js';
import {balances} from '../functions/lib/hospital-billing-model.js';
import {corporateBalance,splitCorporateCharge} from '../functions/lib/hospital-corporate-model.js';
import {hospitalCollectionPath} from '../functions/lib/hospital-storage.js';
const reset=f=>{f.reads.length=0;f.queries.length=0;f.commits.length=0;};
const ledger=(f,code)=>Math.round([...f.store.entries()].filter(([key])=>key.startsWith('accountingJournals/')).flatMap(([,j])=>j.Lines).filter(l=>l.AccountCode===code).reduce((n,l)=>n+l.Debit-l.Credit,0)*100);
const payment=(f,inv,extra={})=>f.billBody(inv,{Payer:'Corporate',Amount:'80',Method:'Bank transfer',Reference:crypto.randomUUID(),...extra});

test('corporate account saves preserve codes, financial counters and historical versions; no-op saves write nothing',async()=>{
  const f=await corporateFixture(),inv=await f.corpInvoice(),body=request({CompanyId:f.company().CompanyId,Company:companyFields,Revision:f.company().__updateTime});reset(f);
  assert.equal((await f.admin.saveCorporateAccount(body)).Unchanged,true);assert.equal(f.commits.length,0);
  await f.admin.saveCorporateAccount({...body,RequestId:crypto.randomUUID(),Company:{...companyFields,Name:'Renamed employer'}});assert.equal(f.company().BilledCents,8000);assert.equal(f.rows('CorporateAccountVersions').length,2);assert.equal(f.invoice(inv.InvoiceId).CorporateCoverage.Company.Name,companyFields.Name);
  await assert.rejects(f.admin.saveCorporateAccount(request({CompanyId:f.company().CompanyId,Company:{...companyFields,Code:'OTHER'},Revision:f.company().__updateTime})),/codes cannot be changed/);
  await assert.rejects(f.admin.saveCorporateAccount(body),/changed/);
});

test('corporate permissions exclude collection by administrators and configuration by cashiers and HMO officers',async()=>{
  const f=await corporateFixture();await assert.rejects(f.cashier.saveCorporateAccount(request({Company:companyFields})),/role/);await assert.rejects(f.hmo.findCorporateAccount(request({Code:companyFields.Code})),/role/);
  await assert.rejects(f.cashier.saveCorporateCoverage(request()),/role/);await assert.rejects(f.doctor.hospitalCorporateStatement(request()),/role/);
  const readonly=createHospitalService(env,{...billingActors.admin,subscriptionReadOnly:true},f.db);await assert.rejects(readonly.saveCorporateAccount(request({Company:companyFields})),/viewing only/);
  await assert.rejects(f.admin.findCorporateAccount(request({Code:companyFields.Code,BranchId:'north'})),/branch/);
  const other=createHospitalService({...env,DYNAMAX_WORKSPACE_ID:'other-hospital'},billingActors.cashier,f.db);assert.equal((await other.findCorporateAccount(request({Code:companyFields.Code}))).company,null);
});

test('verified corporate coverage splits recorded charges, stores due date and original authorisation, and bills each source only once',async()=>{
  const f=await corporateFixture(),inv=await f.corpInvoice(),row=f.invoice(inv.InvoiceId);assert.equal(row.PatientCents,2000);assert.equal(row.CorporateCents,8000);assert.equal(row.HmoCents,0);assert.equal(row.DueDate,'2026-11-25');
  assert.equal(corporateBalance(f.company()),8000);assert.equal(ledger(f,'1150'),8000);assert.equal(ledger(f,'1130'),2000);assert.equal(ledger(f,'4300'),-10000);assert.equal(f.rows('Claims').length,0);
  const c=f.rows('CorporateCoverage')[0];await f.admin.saveCorporateCoverage(request({...f.scope,CompanyId:f.company().CompanyId,CompanyRevision:f.company().__updateTime,Revision:c.__updateTime,Coverage:{...coverFields,CoveragePercent:'50'},ConfirmPatient:true}));
  assert.equal(row.CorporateCoverage.CoverageBasisPoints,8000);assert.equal(f.rows('CorporateCoverageVersions').length,2);
  await assert.rejects(f.cashier.issueHospitalInvoice(request({...f.scope,ChargeIds:row.Lines.map(l=>l.ChargeId),UseCorporate:true,CorporateCoverageRevision:c.__updateTime,ConfirmPatient:true})),/already billed/);
  assert.equal(splitCorporateCharge({AmountCents:999,ServiceCode:'OTHER'},c).PatientCents,999);
});

test('corporate coverage is explicit, revision-checked and date-valid; HMO and corporate cannot bill the same invoice',async()=>{
  const f=await corporateFixture();await assert.rejects(f.corpInvoice(f.scope,{CorporateCoverageRevision:'old'}),/changed/);await assert.rejects(f.corpInvoice(f.scope,{UseHmo:true}),/either corporate/);
  f.rows('CorporateCoverage')[0].To='2026-10-25';await assert.rejects(f.corpInvoice(),/valid dates/);assert.equal(f.rows('Invoices').length,0);
  await assert.rejects(f.admin.saveCorporateCoverage(request({...f.scope,CompanyId:f.company().CompanyId,CompanyRevision:f.company().__updateTime,Coverage:{...coverFields,Services:[],AllServices:false},ConfirmPatient:true})),/covered service/);
});

test('credit limits apply atomically across concurrent patient invoices, and inactive accounts still accept old debt payments',async()=>{
  const f=await corporateFixture();await f.admin.saveCorporateAccount(request({CompanyId:f.company().CompanyId,Revision:f.company().__updateTime,Company:{...companyFields,CreditLimit:'100'}}));
  const scope=await f.otherPatient();await f.coverage();await f.coverage(scope);
  const results=await Promise.allSettled([f.corpInvoice(),f.corpInvoice(scope)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.rows('Invoices').length,1);assert.equal(corporateBalance(f.company()),8000);
  await assert.rejects(f.corpInvoice(),/credit limit/);
  const inv={InvoiceId:f.rows('Invoices')[0].InvoiceId};await f.admin.saveCorporateAccount(request({CompanyId:f.company().CompanyId,Revision:f.company().__updateTime,Company:{...companyFields,Active:false}}));
  await assert.rejects(f.corpInvoice(),/inactive/);
  const row=f.invoice(inv.InvoiceId);await f.cashier.recordHospitalPayment(request({InvoiceId:row.InvoiceId,PatientId:row.PatientId,Revision:row.__updateTime,Amount:'80',Payer:'Corporate',Method:'Cash',Reference:'OLD-DEBT',ConfirmPatient:true}));assert.equal(corporateBalance(f.company()),0);
});

test('corporate invoice payment, credit and refund reconcile company balance and ledger without rewriting originals',async()=>{
  const f=await corporateFixture(),inv=await f.corpInvoice(),original=structuredClone(f.invoice(inv.InvoiceId).Lines),paid=await f.cashier.recordHospitalPayment(await payment(f,inv));
  assert.equal(corporateBalance(f.company()),0);await f.admin.creditHospitalCharge(await f.billBody(inv,{Adjustment:{OriginalChargeId:original[0].ChargeId,Amount:'50',Reference:'HALF-SERVICE',Reason:'Half cancelled'}}));
  assert.equal(corporateBalance(f.company()),-4000);assert.equal(f.invoice(inv.InvoiceId).CorporateCreditCents,4000);const p=f.rows('Payments')[0];
  await f.admin.refundHospitalPayment(await f.billBody(inv,{PaymentId:paid.PaymentId,PaymentRevision:p.__updateTime,Amount:'40',Reference:'CORP-REFUND',Reason:'Credited overpayment'}));
  assert.equal(corporateBalance(f.company()),0);assert.equal(ledger(f,'1150'),0);assert.equal(ledger(f,'1130'),1000);assert.equal(ledger(f,'4300'),-5000);assert.deepEqual(f.invoice(inv.InvoiceId).Lines,original);assert.equal(p.AmountCents,8000);assert.equal(f.rows('CorporateEvents').length,4);
});

test('corporate remittance pays several patients in one batch and allocation returns preserve account balances',async()=>{
  const f=await corporateFixture(),a=await f.corpInvoice(),b=await f.corpInvoice(await f.otherPatient()),receipt=await f.receive({Kind:'Corporate',CompanyCode:companyFields.Code,Amount:'200'});
  reset(f);const result=await f.cashier.allocateHospitalFunds(f.allocations(receipt,[[a,'80'],[b,'40']]));assert.equal(corporateBalance(f.company()),4000);assert.equal(ledger(f,'1150'),4000);assert.equal(ledger(f,'2350'),-8000);
  assert.equal(f.queries.length,2);assert.equal(f.reads.filter(([p])=>p.endsWith('hospitalCorporateAccounts')).length,1);assert.equal(f.commits.length,1);assert.equal(f.commits[0].length,15);
  await f.admin.returnHospitalAllocation(f.returnBody(receipt,result.PaymentIds[0],{Amount:'10'}));assert.equal(corporateBalance(f.company()),5000);assert.equal(ledger(f,'1150'),5000);assert.equal(ledger(f,'2350'),-9000);
  await f.admin.refundHospitalFunds(f.fundBody(receipt,{Amount:'90',Reference:'UNUSED-CORP',Reason:'Refund unused advance'}));assert.equal(ledger(f,'2350'),0);assert.equal(corporateBalance(f.company()),5000);assert.equal(f.fund(receipt.FundId).AmountCents,20000);
});

test('corporate receipt identity uses company IDs and shares ordinary payment reference deduplication',async()=>{
  const f=await corporateFixture(),inv=await f.corpInvoice(),receipt=await f.receive({Kind:'Corporate',CompanyCode:companyFields.Code,Reference:'CORPORATE-BANK'});
  await assert.rejects(f.cashier.recordHospitalPayment(await payment(f,inv,{Reference:'CORPORATE-BANK'})),/already used/);
  const other=await f.admin.saveCorporateAccount(request({Company:{...companyFields,Code:'OTHER',Name:'Other employer'}}));f.invoice(inv.InvoiceId).CompanyId=other.CompanyId;await assert.rejects(f.cashier.allocateHospitalFunds(f.allocations(receipt,[[inv,'80']])),/different company/);
  await assert.rejects(f.receive({Kind:'Corporate',CompanyCode:'MISSING'}),/not available/);
});

test('corporate no-op coverage and retry receipts cause no duplicate history or postings',async()=>{
  const f=await corporateFixture(),c=await f.coverage(),body=request({...f.scope,CompanyId:f.company().CompanyId,CompanyRevision:f.company().__updateTime,Revision:c.Revision,Coverage:coverFields,ConfirmPatient:true});reset(f);
  assert.equal((await f.admin.saveCorporateCoverage(body)).Unchanged,true);assert.equal(f.commits.length,0);
  const inv=await f.corpInvoice(),pay=await payment(f,inv);await f.cashier.recordHospitalPayment(pay);reset(f);await f.cashier.recordHospitalPayment(pay);assert.equal(f.reads.length,1);assert.equal(f.commits.length,0);assert.equal(f.queries.length,0);
  assert.equal((await f.cashier.recordHospitalPayment({...pay,RequestId:crypto.randomUUID()})).Unchanged,true);assert.equal(f.commits.length,0);
});

test('corporate cumulative credits round exactly to the original shares',async()=>{
  const f=await corporateFixture();await f.coverage(f.scope,{CoveragePercent:'33.33'});const {ChargeId}=await f.charge({UnitPrice:'0.03'}),c=f.rows('CorporateCoverage')[0];
  const inv=await f.cashier.issueHospitalInvoice(request({...f.scope,ChargeIds:[ChargeId],UseCorporate:true,CorporateCoverageRevision:c.__updateTime,ConfirmPatient:true}));
  for(let i=0;i<3;i++)await f.admin.creditHospitalCharge(await f.billBody(inv,{Adjustment:{OriginalChargeId:ChargeId,Amount:'0.01',Reference:`CENT-${i}`,Reason:'Correction'}}));
  assert.equal(balances(f.invoice(inv.InvoiceId)).CorporateBalanceCents,0);assert.equal(balances(f.invoice(inv.InvoiceId)).PatientBalanceCents,0);assert.equal(corporateBalance(f.company()),0);assert.equal(ledger(f,'4300'),0);
});

test('statements load only requested dates and company, exclude clinical notes, and reuse current counters',async()=>{
  const f=await corporateFixture(),inv=await f.corpInvoice();reset(f);await f.cashier.state();assert.equal(f.reads.length,0);assert.equal(f.queries.length,0);
  await assert.rejects(f.cashier.hospitalCorporateStatement(request({CompanyId:f.company().CompanyId,Kind:'Invoices'})),/dates/);assert.equal(f.reads.length,0);
  const found=await f.cashier.findCorporateAccount(request({Code:companyFields.Code}));assert.equal(found.company.BalanceCents,8000);assert.equal(f.reads.length,1);assert.equal(f.queries.length,0);assert.equal(f.commits.length,0);
  for(const Kind of ['Invoices','Events']){const data=await f.cashier.hospitalCorporateStatement(request({CompanyId:f.company().CompanyId,Kind,DateRange:period}));assert.equal(data.rows.length,1);if(Kind==='Invoices'){assert.equal(data.rows[0].InvoiceId,inv.InvoiceId);assert.equal(data.rows[0].CorporateCoverage,undefined);assert.equal(data.rows[0].Lines,undefined);}}
  assert.equal(f.queries.length,2);assert.ok(f.queries.every(q=>q.limit===31&&q.filters.some(r=>r.field==='CompanyId')));
});

test('new corporate mappings remain optional for older clients; unsafe settings and closed periods fail',async()=>{
  const f=await corporateFixture(),s=(await f.admin.billingSettings(request())).settings;assert.equal((await f.admin.saveBillingSettings(request({Settings:mapping,Revision:s.Revision}))).Unchanged,true);
  f.store.set('accountingPeriods/closed',{StartDate:'2026-10-01',EndDate:'2026-10-31',Status:'Closed'});await assert.rejects(f.corpInvoice(),/closed/);assert.equal(f.company().BilledCents,undefined);
  await assert.rejects(f.admin.saveCorporateAccount(request({Company:{...companyFields,PaymentTermsDays:366}})),/0–365/);await assert.rejects(f.admin.saveCorporateAccount(request({Company:{...companyFields,CreditLimit:'-1'}})),/credit limit/i);
});

test('corporate records, invoice links, remittance links and journals survive backup serialization',async()=>{
  const f=await corporateFixture(),inv=await f.corpInvoice(),receipt=await f.receive({Kind:'Corporate',CompanyCode:companyFields.Code}),paid=await f.cashier.allocateHospitalFunds(f.allocations(receipt,[[inv,'80']]));
  const copy=new Map(JSON.parse(JSON.stringify([...f.store]))),path=name=>hospitalCollectionPath(env,name);assert.equal(copy.get(`${path('Invoices')}/${inv.InvoiceId}`).CompanyId,f.company().CompanyId);assert.equal(copy.get(`${path('Funds')}/${receipt.FundId}`).CompanyId,f.company().CompanyId);assert.equal(copy.get(`accountingJournals/HOSP-${paid.PaymentIds[0]}`).HospitalInvoiceId,inv.InvoiceId);
  for(const name of ['CorporateAccounts','CorporateAccountVersions','CorporateCoverage','CorporateCoverageVersions','CorporateEvents'])assert.ok(path(name).endsWith(`hospital${name}`));
  const indexes=JSON.parse(await readFile(new URL('../firestore.hospital.indexes.json',import.meta.url),'utf8')).indexes;
  for(const name of ['hospitalInvoices','hospitalCorporateEvents'])assert.ok(indexes.some(i=>i.collectionGroup===name&&JSON.stringify(i.fields.map(f=>f.fieldPath))===JSON.stringify(['BranchId','CompanyId','CreatedAt'])));
});

test('lost corporate invoice response replays without duplicating the company balance or source charges',async()=>{
  const f=await corporateFixture(),coverage=await f.coverage(),charge=await f.charge(),body=request({...f.scope,ChargeIds:[charge.ChargeId],UseCorporate:true,CorporateCoverageRevision:coverage.Revision,ConfirmPatient:true});
  let once=true;const service=createHospitalService(env,billingActors.cashier,{...f.db,batchCommitLiteralDocuments:async(...args)=>{await f.db.batchCommitLiteralDocuments(...args);if(once){once=false;throw Error('response lost');}}});
  await assert.rejects(service.issueHospitalInvoice(body),/response lost/);reset(f);assert.equal((await service.issueHospitalInvoice(body)).replayed,true);assert.equal(f.reads.length,1);assert.equal(f.commits.length,0);assert.equal(f.rows('Invoices').length,1);assert.equal(f.company().BilledCents,8000);assert.equal(f.rows('CorporateEvents').length,1);
});

test('new invoices and credits read only accounts actually used by their payer split',async()=>{
  const f=await corporateFixture();await f.coverage(f.scope,{AllServices:true,CoveragePercent:'100'});reset(f);const inv=await f.corpInvoice();
  assert.deepEqual(f.reads.filter(([p])=>p==='chartOfAccounts').map(([,id])=>id).sort(),['1150','4300']);
  reset(f);await f.admin.creditHospitalCharge(await f.billBody(inv,{Adjustment:{OriginalChargeId:f.invoice(inv.InvoiceId).Lines[0].ChargeId,Amount:'10',Reference:'READ-CREDIT',Reason:'Correct service charge'}}));
  assert.deepEqual(f.reads.filter(([p])=>p==='chartOfAccounts').map(([,id])=>id).sort(),['1150','4300']);assert.equal(f.queries.length,2);
});

test('company identity survives renaming and zero credit limits stop only new debt',async()=>{
  const f=await corporateFixture(),inv=await f.corpInvoice(),receipt=await f.receive({Kind:'Corporate',CompanyCode:companyFields.Code,Reference:'BEFORE-RENAME'});
  await f.admin.saveCorporateAccount(request({CompanyId:f.company().CompanyId,Revision:f.company().__updateTime,Company:{...companyFields,Name:'Renamed sponsor',CreditLimit:'0'}}));
  await f.cashier.allocateHospitalFunds(f.allocations(receipt,[[inv,'80']]));assert.equal(corporateBalance(f.company()),0);assert.equal(f.invoice(inv.InvoiceId).CorporateCoverage.Company.Name,companyFields.Name);assert.equal(f.fund(receipt.FundId).CompanyName,companyFields.Name);
  await assert.rejects(f.corpInvoice(),/credit limit/);
  assert.equal((await f.receive({Kind:'Corporate',CompanyCode:companyFields.Code,Reference:'BEFORE-RENAME'})).Unchanged,true);
});

test('corporate lifetime counters do not use the single-invoice amount cap',async()=>{
  const f=await corporateFixture();await f.admin.saveCorporateAccount(request({CompanyId:f.company().CompanyId,Revision:f.company().__updateTime,Company:{...companyFields,CreditLimit:''}}));
  f.company().BilledCents=100000000000;f.company().PaidCents=100000000000;await f.corpInvoice();assert.equal(f.company().BilledCents,100000008000);assert.equal(corporateBalance(f.company()),8000);
});

test('corporate statement pages retain every equal-timestamp invoice and isolate other companies',async()=>{
  const f=await corporateFixture();await f.admin.saveCorporateAccount(request({CompanyId:f.company().CompanyId,Revision:f.company().__updateTime,Company:{...companyFields,CreditLimit:''}}));
  for(let i=0;i<31;i++)await f.corpInvoice();reset(f);const payload=request({CompanyId:f.company().CompanyId,Kind:'Invoices',DateRange:period});
  const first=await f.cashier.hospitalCorporateStatement(payload),second=await f.cashier.hospitalCorporateStatement({...payload,RequestId:crypto.randomUUID(),Cursor:first.next});
  assert.equal(first.rows.length,30);assert.equal(second.rows.length,1);assert.equal(new Set([...first.rows,...second.rows].map(r=>r.InvoiceId)).size,31);assert.ok(f.queries.every(q=>q.limit===31&&q.filters.some(r=>r.field==='BranchId'&&r.value==='main')));
  const other=await f.admin.saveCorporateAccount(request({Company:{...companyFields,Code:'EMPTY-CORP'}}));assert.equal((await f.cashier.hospitalCorporateStatement(request({...other,Kind:'Invoices',DateRange:period}))).rows.length,0);
});
