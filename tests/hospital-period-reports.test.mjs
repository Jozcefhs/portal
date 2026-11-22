import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, request, actor, env } from './helpers/hospital-fixture.mjs';
import { billingActors } from './helpers/hospital-billing-fixture.mjs';

const DateRange={fromDate:'2026-10-26',toDate:'2026-10-26'};
const visitPath='hospitalWorkspaces/test-hospital/hospitalVisits';
const entry = {BranchId:'main',WorkspaceId:env.DYNAMAX_WORKSPACE_ID,Date:'2026-10-26',Status:'Posted',
  Source:'Hospital Invoice',Currency:'NGN',TotalDebit:101.35,TotalCredit:101.35};
function put(f,path,id,row) {f.store.set(path+'/'+id,{...row,__id:id});}
const report=(f,Report,extra={})=>f.service.hospitalPeriodReport(request({Report,DateRange,...extra}));

test('arrival date uses WAT; averages include zero waits and exclude cancelled, pending and unreliable timings',async()=>{
  const f=fixture();
  const base={BranchId:'main',Department:'Surgery',Status:'Completed',CreatedAt:'2026-10-25T23:00:00.000Z',QueueStartedAt:'2026-10-25T23:04:30.000Z'};
  [{},{QueueStartedAt:base.CreatedAt},{Status:'Waiting',QueueStartedAt:''},{Status:'Cancelled'},
    {QueueStartedAt:''},{QueueStartedAt:'2026-10-25T22:00:00.000Z'},{Department:'Eye clinic'},
    {CreatedAt:'2026-10-26T23:00:00.000Z'},{BranchId:'north'}].forEach((row,i)=>put(f,visitPath,'v'+i,{...base,...row}));
  const result=await report(f,'waiting');
  assert.equal(result.count,7);assert.equal(result.next,null);
  assert.deepEqual(result.groups.find(g=>g.label==='Surgery'),{label:'Surgery',measured:2,waiting:1,cancelled:1,unknown:2,totalMs:270000,longestMs:270000});
  assert.equal(f.queries.length,1);assert.equal(f.reads.length,0);assert.equal(f.commits.length,0);
  assert.deepEqual(f.queries[0].select,['CreatedAt','QueueStartedAt','Status','Department']);
});

test('period revenue follows posted journals, including credits to older invoices; all other money movements are excluded',async()=>{
  const f=fixture(billingActors.cashier);
  [entry,{...entry,Source:'Hospital Credit',TotalDebit:130.05,TotalCredit:130.05,HospitalInvoiceId:'september-invoice'},
    ...['Hospital Payment','Hospital Refund','Hospital Supplier credit','Deposit'].map(Source=>({...entry,Source})),
    {...entry,Date:'2026-10-25'},{...entry,Date:'2026-10-27'},{...entry,Status:'Draft'},
    {...entry,BranchId:'north'},{...entry,WorkspaceId:'another-hospital'}].forEach((r,i)=>put(f,'accountingJournals','J'+i,r));
  const result=await report(f,'revenue');assert.equal(result.count,2);
  assert.deepEqual(result.groups,[{label:'2026-10-26',invoices:1,credits:1,billed:10135,credited:13005}]);
  assert.equal(f.reads.length,0);assert.equal(f.commits.length,0);
  assert.ok(!f.queries[0].select.includes('Lines'));
  put(f,'accountingJournals','bad',{...entry,TotalCredit:0.3});
  await assert.rejects(report(f,'revenue'),/finance review/);
});
test('same-day entries use a document cursor on the shared journal path and one snapshot',async()=>{
  const f=fixture(billingActors.cashier);
  for(let i=0;i<33;i++)put(f,'accountingJournals','HOSP-'+String(i).padStart(3,'0'),entry);
  const first=await report(f,'revenue');assert.equal(first.count,30);
  const second=await report(f,'revenue',{Cursor:first.next,ReadTime:first.readTime});
  assert.equal(second.count,3);assert.equal(second.next,null);
  assert.equal(f.queries[1].readTime,first.readTime);
  assert.match(f.queries[1].startAfterName,/documents\/accountingJournals\/HOSP-029$/);
  assert.equal(first.groups[0].billed+second.groups[0].billed,33*10135);
});
test('permissions, branch restrictions, dates and expired snapshots stop invalid reads',async()=>{
  const f=fixture(actor);
  for(const [kind,extra] of [['revenue',{}],['other',{}],['waiting',{BranchId:'north'}],
    ['waiting',{DateRange:{fromDate:'2026-01-01',toDate:'2026-12-31'}}],
    ['waiting',{Cursor:{id:'v'},ReadTime:'2026-10-25T12:00:00.000Z'}]]) await assert.rejects(report(f,kind,extra));
  assert.equal(f.queries.length,0);assert.equal(f.commits.length,0);
});
